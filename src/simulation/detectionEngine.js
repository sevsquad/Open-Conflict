// ═══════════════════════════════════════════════════════════════
// DETECTION ENGINE — Physical-range, km-based detection system.
// Three-tier model: Identified / Contact / Undetected.
// Ranges in real-world km, converted to hexes via cellSizeKm.
// Uses horizon formula, "look over" LOS, random detection rolls.
// ═══════════════════════════════════════════════════════════════

import { hexDistance, hexRange, computeEnhancedLOS, offsetToAxial, axialToOffset, roundHex, hexDistanceAxial, getNeighbors } from "../mapRenderer/HexMath.js";
import { LOS_TERRAIN, isAirUnit } from "./orderTypes.js";
import { parsePosition, positionToLabel } from "./prompts.js";
import {
  OBSERVER_VISUAL_KM, DEFAULT_OBSERVER_VISUAL_KM,
  TARGET_SIZE_MOD, DEFAULT_TARGET_SIZE_MOD,
  CONTACT_RANGE_MULT,
  CANOPY_HEIGHT,
  ATMOSPHERIC_CAP, DEFAULT_ATMOSPHERIC_CAP,
  WEATHER_RANGE_MOD,
  TIME_RANGE_MOD,
  POSTURE_RANGE_MOD,
  TERRAIN_CONCEALMENT,
  ACTION_SIZE_BOOST,
  CLOSE_RANGE_FLOORS,
  INTEL_DEGRADATION,
  RECON_RANGE_BONUS_KM,
  SPECIAL_CAPABILITY_DETECTION_MODS,
  SKYLINE_SILHOUETTE_BOOST,
  POSTURE_CONCEALMENT,
  AIR_CANOPY_PENALTY,
} from "./detectionRanges.js";


// Earth radius in km — for horizon formula
const EARTH_RADIUS_KM = 6371;


/**
 * Compute full detection state for all actors.
 *
 * @param {Object} gameState  - current game state (units, scenario, environment, diplomacy)
 * @param {Object} terrainData - hex grid with cells, cellSizeKm
 * @param {Object} sealedOrders - optional { actorId: { unitOrders: { unitId: {...} } } }
 * @param {Object} previousVisibility - previous turn's visibilityState (for lastKnown)
 * @returns {Object} visibilityState with three-tier detection per actor
 */
export function computeDetection(gameState, terrainData, sealedOrders = null, previousVisibility = null) {
  const actors = gameState.scenario.actors;
  const allUnits = gameState.units.filter(u => u.status !== "destroyed" && u.status !== "eliminated");
  const env = gameState.environment || {};
  const currentTurn = gameState.game?.turn || 1;
  const cellSizeKm = terrainData?.cellSizeKm || 1;

  const actorVisibility = {};

  for (const actor of actors) {
    const myUnits = allUnits.filter(u => u.actor === actor.id);
    const enemyUnits = allUnits.filter(u => u.actor !== actor.id);

    const visibleCells = new Set();
    const detectedUnits = new Set();   // Identified tier — full details
    const contactUnits = new Set();    // Contact tier — "something is here"
    const detectionDetails = {};       // unitId → detection context for prompts

    // Build RECON targets and action boosts for this actor
    const reconTargets = buildReconTargets(actor.id, sealedOrders);
    const unitActions = buildUnitActions(sealedOrders);

    // Phase 1: Compute visible cells for each observer (for FOW overlay)
    for (const observer of myUnits) {
      const obsPos = parsePosition(observer.position);
      if (!obsPos) continue;
      const idRangeKm = getBaseIdRange(observer, null, env);
      const maxRangeHex = Math.ceil((idRangeKm * CONTACT_RANGE_MULT) / cellSizeKm);
      computeVisibleCells(obsPos, maxRangeHex, terrainData, visibleCells);
    }

    // Phase 2: Check each enemy unit for detection — best result wins
    for (const target of enemyUnits) {
      const tgtPos = parsePosition(target.position);
      if (!tgtPos) continue;

      let bestTier = "UNDETECTED";  // "IDENTIFIED" > "CONTACT" > "UNDETECTED"
      let bestDetail = null;

      for (const observer of myUnits) {
        const obsPos = parsePosition(observer.position);
        if (!obsPos) continue;

        const result = evaluateDetection(
          observer, obsPos, target, tgtPos,
          terrainData, env, cellSizeKm, reconTargets, unitActions
        );

        if (!result) continue;

        // Upgrade tier if this observer got a better result
        if (result.tier === "IDENTIFIED") {
          bestTier = "IDENTIFIED";
          bestDetail = result;
          break; // Can't do better than identified
        } else if (result.tier === "CONTACT" && bestTier !== "IDENTIFIED") {
          bestTier = "CONTACT";
          bestDetail = result;
        }
      }

      if (bestTier === "IDENTIFIED") {
        detectedUnits.add(target.id);
        if (bestDetail) detectionDetails[target.id] = bestDetail;
      } else if (bestTier === "CONTACT") {
        contactUnits.add(target.id);
        if (bestDetail) detectionDetails[target.id] = bestDetail;
      }
    }

    // Phase 3: Build lastKnown from previous turn's visibility
    const lastKnown = buildLastKnown(
      actor.id, enemyUnits, detectedUnits, contactUnits,
      previousVisibility, currentTurn
    );

    actorVisibility[actor.id] = {
      visibleCells,
      detectedUnits,
      contactUnits,
      detectionDetails,
      lastKnown,
    };
  }

  // Phase 4: Merge allied visibility
  mergeAlliedVisibility(actorVisibility, gameState.diplomacy);

  return { actorVisibility };
}


// ═══════════════════════════════════════════════════════════════
// CORE DETECTION MATH
// ═══════════════════════════════════════════════════════════════

/**
 * Compute base identification range in km for an observer looking at a target.
 * id_range = observer_visual_km × target_size × posture × weather × time
 * Special capabilities (submarine, radar, drone_equipped) modify observer range
 * and target size multiplicatively.
 */
function getBaseIdRange(observer, target, env) {
  let visualKm = OBSERVER_VISUAL_KM[observer.type] || DEFAULT_OBSERVER_VISUAL_KM;
  let targetSize = target ? (TARGET_SIZE_MOD[target.type] || DEFAULT_TARGET_SIZE_MOD) : 1.0;
  const postureMod = target ? (POSTURE_RANGE_MOD[target.posture] || 0.85) : 1.0;
  const weatherMod = WEATHER_RANGE_MOD[env.weather] || 1.0;
  const timeMod = TIME_RANGE_MOD[env.timeOfDay] || 1.0;

  // Apply observer's special capability detection mods (e.g. radar extends range)
  if (observer.specialCapabilities) {
    for (const cap of observer.specialCapabilities) {
      const mod = SPECIAL_CAPABILITY_DETECTION_MODS[cap];
      if (mod?.observerRangeMod != null) {
        visualKm *= mod.observerRangeMod;
      }
    }
  }

  // Apply target's special capability detection mods (e.g. submarine shrinks signature)
  if (target?.specialCapabilities) {
    for (const cap of target.specialCapabilities) {
      const mod = SPECIAL_CAPABILITY_DETECTION_MODS[cap];
      if (mod?.targetSizeMod != null) {
        targetSize *= mod.targetSizeMod;
      }
    }
  }

  return visualKm * targetSize * postureMod * weatherMod * timeMod;
}


/**
 * Compute horizon distance in km based on elevation advantage.
 * horizon = sqrt(2 × R × h) where R = earth radius, h = height advantage in km.
 * Capped by atmospheric visibility.
 */
function computeHorizon(observerElev, surroundingAvgElev, env) {
  const heightAdv = Math.max(0, observerElev - surroundingAvgElev);
  const atmCap = ATMOSPHERIC_CAP[env.weather] || DEFAULT_ATMOSPHERIC_CAP;

  if (heightAdv <= 0) return atmCap;

  const horizonKm = Math.sqrt(2 * EARTH_RADIUS_KM * (heightAdv / 1000));
  return Math.min(atmCap, horizonKm);
}


/**
 * Get the average elevation of hexes surrounding a position (for horizon calc).
 * Uses the 6 immediate neighbors.
 */
function getSurroundingAvgElev(pos, terrainData) {
  // Use proper hex neighbors (offset coords with row parity) instead of rectangular grid
  const neighbors = getNeighbors(pos.col, pos.row);
  let sum = 0, count = 0;
  for (const [c, r] of neighbors) {
    const cell = terrainData.cells?.[`${c},${r}`];
    if (cell) { sum += cell.elevation ?? 0; count++; }
  }
  return count > 0 ? sum / count : 0;
}


/**
 * Evaluate whether an observer can detect a target.
 * Returns null if out of range or LOS blocked, otherwise returns
 * { tier: "IDENTIFIED"|"CONTACT", ...context }.
 */
function evaluateDetection(observer, obsPos, target, tgtPos, terrainData, env, cellSizeKm, reconTargets, unitActions) {
  const distHex = hexDistance(obsPos.col, obsPos.row, tgtPos.col, tgtPos.row);
  const distKm = distHex * cellSizeKm;

  // Compute identification range in km
  let idRangeKm = getBaseIdRange(observer, target, env);

  // Compute target size boosts (additive to base, applied once)
  const baseSizeMod = TARGET_SIZE_MOD[target.type] || DEFAULT_TARGET_SIZE_MOD;
  let sizeBoostTotal = 0;

  // Action-based boost (firing, moving, etc.)
  const targetAction = unitActions[target.id];
  if (targetAction) {
    sizeBoostTotal += ACTION_SIZE_BOOST[targetAction] || 0;
  }

  // Skyline silhouette: target on a crest is backlit against the sky
  const skyline = isSkylineSilhouette(obsPos, tgtPos, terrainData);
  if (skyline) {
    sizeBoostTotal += SKYLINE_SILHOUETTE_BOOST;
  }

  // Apply combined size boost
  if (sizeBoostTotal > 0) {
    idRangeKm = (idRangeKm / (baseSizeMod || 1)) * (baseSizeMod + sizeBoostTotal);
  }

  // RECON bonus: if observer has RECON order toward a hex near the target
  const reconTarget = reconTargets[observer.id];
  if (reconTarget) {
    const distToRecon = hexDistance(tgtPos.col, tgtPos.row, reconTarget.col, reconTarget.row);
    const reconBonusHex = Math.ceil(RECON_RANGE_BONUS_KM / cellSizeKm);
    if (distToRecon <= reconBonusHex) {
      idRangeKm += RECON_RANGE_BONUS_KM;
    }
  }

  // Contact range = identification range × multiplier
  const detectRangeKm = idRangeKm * CONTACT_RANGE_MULT;

  // Horizon limit
  const obsCell = terrainData.cells?.[`${obsPos.col},${obsPos.row}`];
  const obsElev = obsCell?.elevation ?? 0;
  const surroundingElev = getSurroundingAvgElev(obsPos, terrainData);
  const horizonKm = computeHorizon(obsElev, surroundingElev, env);

  // Effective ranges (capped by horizon)
  const effectiveIdKm = Math.min(idRangeKm, horizonKm);
  const effectiveDetectKm = Math.min(detectRangeKm, horizonKm);

  // Convert to hex distances
  const effectiveIdHex = Math.floor(effectiveIdKm / cellSizeKm);
  const effectiveDetectHex = Math.floor(effectiveDetectKm / cellSizeKm);

  // Quick range check — outside max detection range = not detected
  if (distHex > effectiveDetectHex) return null;

  // LOS check (enhanced with "look over" canopy logic)
  const los = computeEnhancedLOS(
    obsPos.col, obsPos.row, tgtPos.col, tgtPos.row,
    terrainData, LOS_TERRAIN, CANOPY_HEIGHT
  );
  if (los.result === "BLOCKED") return null;

  // Same hex = guaranteed identification
  if (distHex === 0) {
    return {
      tier: "IDENTIFIED",
      observerUnitId: observer.id,
      targetUnitId: target.id,
      distance: distHex,
      distKm: 0,
      probability: 1.0,
      reason: `${observer.name} and ${target.name} occupy the same hex`,
    };
  }

  // Compute detection probability within range
  const tgtKey = `${tgtPos.col},${tgtPos.row}`;
  const targetCell = terrainData.cells?.[tgtKey];
  const targetTerrain = targetCell?.terrain || "open_ground";

  // Distance factor: closer = higher probability (linear falloff)
  const effectiveRangeKm = distHex <= effectiveIdHex ? effectiveIdKm : effectiveDetectKm;
  const distanceFactor = 1.0 - (distKm / (effectiveRangeKm || 1)) * 0.5;

  // Terrain concealment
  const concealment = TERRAIN_CONCEALMENT[targetTerrain] ?? 1.0;

  // Posture concealment — fieldworks offset open terrain, panic worsens it
  const postureConceal = POSTURE_CONCEALMENT[target.posture] ?? 1.0;

  // LOS quality modifier
  const losMod = los.result === "PARTIAL" ? 0.5 : 1.0;

  // Air-to-ground canopy penalty: aircraft can't see through tree cover
  // without FLIR/thermal. Only applies when observer is air and target is ground.
  const isAirObserver = isAirUnit(observer);
  const isGroundTarget = !isAirUnit(target);
  const canopyPenalty = (isAirObserver && isGroundTarget)
    ? (AIR_CANOPY_PENALTY[targetTerrain] ?? 1.0)
    : 1.0;

  // Base probability
  let probability = distanceFactor * concealment * postureConceal * losMod * canopyPenalty;

  // Close-range floor — can't hide a tank one hex away
  const floor = CLOSE_RANGE_FLOORS[distHex] ?? 0;
  probability = Math.max(probability, floor);

  // Clamp
  probability = Math.min(1.0, Math.max(0, probability));

  // Roll the dice
  // Math.random() is intentional — crypto RNG adds no value for game sim rolls
  const roll = Math.random();
  if (roll >= probability) return null;  // Failed detection roll

  // Determine tier based on range
  const tier = distHex <= effectiveIdHex ? "IDENTIFIED" : "CONTACT";

  return {
    tier,
    observerUnitId: observer.id,
    targetUnitId: target.id,
    observerPos: observer.position,
    targetPos: target.position,
    distance: distHex,
    distKm: Math.round(distKm * 10) / 10,
    probability: Math.round(probability * 100) / 100,
    los: los.result,
    terrain: targetTerrain,
    skylineSilhouette: skyline,
    reason: describeDetectionContext(observer, target, distHex, distKm, targetTerrain, los, env, tier, skyline),
  };
}


// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Build a map of { unitId: targetHex } for units with RECON orders.
 */
function buildReconTargets(actorId, sealedOrders) {
  const targets = {};
  if (!sealedOrders?.[actorId]?.unitOrders) return targets;

  for (const [unitId, orders] of Object.entries(sealedOrders[actorId].unitOrders)) {
    if (orders.actionOrder?.id === "RECON" && orders.actionOrder?.target) {
      targets[unitId] = parsePosition(orders.actionOrder.target);
    }
  }
  return targets;
}


/**
 * Build a map of { unitId: actionId } from all sealed orders.
 * Used for action-based detection boosts.
 */
function buildUnitActions(sealedOrders) {
  const actions = {};
  if (!sealedOrders) return actions;

  for (const actorOrders of Object.values(sealedOrders)) {
    if (!actorOrders?.unitOrders) continue;
    for (const [unitId, orders] of Object.entries(actorOrders.unitOrders)) {
      // Prefer action order (ATTACK, FIRE_MISSION, etc.) over movement
      if (orders.actionOrder?.id) {
        actions[unitId] = orders.actionOrder.id;
      } else if (orders.movementOrder?.id) {
        actions[unitId] = orders.movementOrder.id;
      }
    }
  }
  return actions;
}


/**
 * Check if a target is silhouetted against the sky from the observer's perspective.
 * Extends the observer→target ray past the target by up to 3 hexes and checks
 * if the target elevation is strictly higher than all of them.
 * Returns true if silhouetted (target is on a crest with nothing higher behind it).
 */
function isSkylineSilhouette(obsPos, tgtPos, terrainData) {
  const tgtKey = `${tgtPos.col},${tgtPos.row}`;
  const tgtElev = terrainData.cells?.[tgtKey]?.elevation ?? 0;

  const obsAx = offsetToAxial(obsPos.col, obsPos.row);
  const tgtAx = offsetToAxial(tgtPos.col, tgtPos.row);

  const dist = hexDistanceAxial(obsAx.q, obsAx.r, tgtAx.q, tgtAx.r);
  if (dist === 0) return false;

  // Direction vector in axial coords (normalized to 1-hex steps)
  const dq = (tgtAx.q - obsAx.q) / dist;
  const dr = (tgtAx.r - obsAx.r) / dist;

  // Walk 1-3 hexes past the target along the same ray
  let behindCount = 0;
  for (let i = 1; i <= 3; i++) {
    const ax = roundHex(tgtAx.q + dq * i, tgtAx.r + dr * i);
    const off = axialToOffset(ax.q, ax.r);
    const key = `${off.col},${off.row}`;
    const cell = terrainData.cells?.[key];
    if (!cell) continue;  // Off-map hex: skip

    if (cell.elevation >= tgtElev) return false;  // Something behind is same height or higher
    behindCount++;
  }

  // Need at least 1 valid behind-hex to confirm silhouette
  return behindCount > 0;
}


/**
 * Add all hexes within detection range that have clear LOS to the visible set.
 * Used for FOW overlay rendering.
 */
function computeVisibleCells(obsPos, maxRangeHex, terrainData, visibleCells) {
  const cells = hexRange(obsPos.col, obsPos.row, maxRangeHex);
  for (const cell of cells) {
    const key = `${cell.col},${cell.row}`;
    if (visibleCells.has(key)) continue;

    const los = computeEnhancedLOS(
      obsPos.col, obsPos.row, cell.col, cell.row,
      terrainData, LOS_TERRAIN, CANOPY_HEIGHT
    );
    if (los.result !== "BLOCKED") {
      visibleCells.add(key);
    }
  }
}


/**
 * Build a human-readable description of the detection context.
 */
function describeDetectionContext(observer, target, distHex, distKm, terrain, los, env, tier, skyline = false) {
  const parts = [];
  parts.push(`${observer.name} (${observer.type}) at ${positionToLabel(observer.position)}`);
  parts.push(`${tier === "IDENTIFIED" ? "identified" : "detected contact from"} ${target.name} (${target.type}, ${target.posture}) at ${positionToLabel(target.position)}`);
  parts.push(`${distHex} hex / ${distKm.toFixed(1)}km away`);
  parts.push(`target in ${terrain.replace(/_/g, " ")}`);
  if (skyline) parts.push("target silhouetted on crest");
  if (los.result === "PARTIAL") parts.push("partial LOS");
  if (env.weather && env.weather !== "clear") parts.push(`weather: ${env.weather}`);
  if (env.timeOfDay) parts.push(`time: ${env.timeOfDay}`);
  return parts.join("; ");
}


/**
 * Build lastKnown map from previous visibility state.
 * Units that were detected/contacted last turn but not this turn get ghost entries.
 */
function buildLastKnown(actorId, enemyUnits, detectedUnits, contactUnits, previousVisibility, currentTurn) {
  const lastKnown = {};

  // Carry over previous lastKnown entries (aging them)
  const prevActor = previousVisibility?.actorVisibility?.[actorId];
  if (prevActor?.lastKnown) {
    for (const [unitId, info] of Object.entries(prevActor.lastKnown)) {
      const age = currentTurn - info.turn;
      if (age >= INTEL_DEGRADATION.EXPIRE_AFTER) continue;
      if (detectedUnits.has(unitId)) continue;    // currently identified
      if (contactUnits.has(unitId)) continue;      // currently in contact

      lastKnown[unitId] = { ...info, stale: age >= INTEL_DEGRADATION.STALE_AFTER };
    }
  }

  // Add newly-lost contacts: units detected last turn but not this turn
  const prevDetected = prevActor?.detectedUnits;
  if (prevDetected) {
    const prevSet = prevDetected instanceof Set ? prevDetected : new Set(prevDetected || []);
    for (const unitId of prevSet) {
      if (detectedUnits.has(unitId)) continue;
      if (contactUnits.has(unitId)) continue;
      if (lastKnown[unitId]) continue;

      const unit = enemyUnits.find(u => u.id === unitId);
      if (!unit) continue;

      lastKnown[unitId] = {
        position: unit.position,
        turn: currentTurn - 1,
        type: unit.type,
        strength: unit.strength,
        stale: false,
      };
    }
  }

  // Also track previously-contacted units that lost contact
  const prevContact = prevActor?.contactUnits;
  if (prevContact) {
    const prevSet = prevContact instanceof Set ? prevContact : new Set(prevContact || []);
    for (const unitId of prevSet) {
      if (detectedUnits.has(unitId)) continue;
      if (contactUnits.has(unitId)) continue;
      if (lastKnown[unitId]) continue;

      const unit = enemyUnits.find(u => u.id === unitId);
      if (!unit) continue;

      // Contact-tier last-known: we only knew the position, not the type
      lastKnown[unitId] = {
        position: unit.position,
        turn: currentTurn - 1,
        type: "unknown",  // was only a contact, not identified
        strength: null,
        stale: false,
      };
    }
  }

  return lastKnown;
}


/**
 * Merge visibility between allied actors.
 * Allied actors share visibleCells, detectedUnits, and contactUnits.
 */
function mergeAlliedVisibility(actorVisibility, diplomacy) {
  if (!diplomacy) return;

  for (const [pairKey, rel] of Object.entries(diplomacy)) {
    if (rel.status !== "allied") continue;

    const [aId, bId] = pairKey.split("||");
    const aVis = actorVisibility[aId];
    const bVis = actorVisibility[bId];
    if (!aVis || !bVis) continue;

    // Merge visible cells
    for (const cell of bVis.visibleCells) aVis.visibleCells.add(cell);
    for (const cell of aVis.visibleCells) bVis.visibleCells.add(cell);

    // Merge detected (identified) units
    for (const unitId of bVis.detectedUnits) aVis.detectedUnits.add(unitId);
    for (const unitId of aVis.detectedUnits) bVis.detectedUnits.add(unitId);

    // Merge contact units (upgrade to identified if one side identified)
    for (const unitId of bVis.contactUnits) {
      if (!aVis.detectedUnits.has(unitId)) aVis.contactUnits.add(unitId);
    }
    for (const unitId of aVis.contactUnits) {
      if (!bVis.detectedUnits.has(unitId)) bVis.contactUnits.add(unitId);
    }

    // Merge lastKnown — take the more recent entry
    for (const [unitId, info] of Object.entries(bVis.lastKnown)) {
      if (!aVis.lastKnown[unitId] || aVis.lastKnown[unitId].turn < info.turn) {
        aVis.lastKnown[unitId] = { ...info };
      }
    }
    for (const [unitId, info] of Object.entries(aVis.lastKnown)) {
      if (!bVis.lastKnown[unitId] || bVis.lastKnown[unitId].turn < info.turn) {
        bVis.lastKnown[unitId] = { ...info };
      }
    }
  }
}


/**
 * Serialize a visibilityState for storage in gameState.
 * Sets can't be JSON-serialized, so convert them to arrays.
 */
export function serializeVisibility(visibilityState) {
  if (!visibilityState?.actorVisibility) return null;

  const serialized = { actorVisibility: {} };
  for (const [actorId, vis] of Object.entries(visibilityState.actorVisibility)) {
    serialized.actorVisibility[actorId] = {
      visibleCells: [...vis.visibleCells],
      detectedUnits: [...vis.detectedUnits],
      contactUnits: [...(vis.contactUnits || [])],
      detectionDetails: vis.detectionDetails || {},
      lastKnown: vis.lastKnown,
    };
  }
  return serialized;
}


/**
 * Deserialize a stored visibilityState back into Sets.
 */
export function deserializeVisibility(stored) {
  if (!stored?.actorVisibility) return null;

  const deserialized = { actorVisibility: {} };
  for (const [actorId, vis] of Object.entries(stored.actorVisibility)) {
    deserialized.actorVisibility[actorId] = {
      visibleCells: new Set(vis.visibleCells || []),
      detectedUnits: new Set(vis.detectedUnits || []),
      contactUnits: new Set(vis.contactUnits || []),
      detectionDetails: vis.detectionDetails || {},
      lastKnown: vis.lastKnown || {},
    };
  }
  return deserialized;
}
