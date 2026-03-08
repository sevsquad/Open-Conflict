// ═══════════════════════════════════════════════════════════════
// ORDER COMPUTER — Pre-computes ranges, paths, LOS, force ratios,
// and other hard math so the LLM doesn't have to.
// Consumes structured orders + game state, outputs dense data bundles.
// ═══════════════════════════════════════════════════════════════

import { hexDistance, hexLine, computeLOS } from "../mapRenderer/HexMath.js";
import {
  WEAPON_RANGE_KM, MOVEMENT_BUDGETS, TERRAIN_COSTS, TERRAIN_DEFENSE,
  LOS_TERRAIN, ECHELON_WEIGHTS, ORDER_TYPES,
  NAVAL_TERRAIN_COSTS, AMPHIBIOUS_TERRAIN_COSTS,
} from "./orderTypes.js";
import { parsePosition, positionToLabel } from "./prompts.js";

// ═══════════════════════════════════════════════════════════════
// 1. MOVEMENT PATH & FEASIBILITY
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the movement path from origin to destination.
 * Walks a hex line, sums terrain-weighted cost, compares to movement budget.
 *
 * @param {string} fromPos - origin position ("3,4" or "D5")
 * @param {string} toPos   - destination position
 * @param {Object} terrainData - { cells: { "col,row": { terrain, elevation, features } } }
 * @param {string} movementType - "foot", "wheeled", "tracked", etc.
 * @returns {{ path, pathTerrain, distanceHexes, distanceKm, totalCost, budget,
 *             feasibility, roadOnPath, bridgeAvailable, riverCrossings, elevationChange }}
 */
export function computeMovePath(fromPos, toPos, terrainData, movementType = "foot") {
  const from = parsePosition(fromPos);
  const to = parsePosition(toPos);
  if (!from || !to) {
    return { path: [], feasibility: "INFEASIBLE", error: "Invalid position" };
  }

  const line = hexLine(from.col, from.row, to.col, to.row);
  const distanceHexes = line.length - 1;
  const cellSizeKm = terrainData.cellSizeKm || 1;
  const distanceKm = distanceHexes * cellSizeKm;

  // Walk the path, sum terrain costs, gather info
  const pathTerrain = [];
  let totalCost = 0;
  let roadOnPath = true;       // true if every hex has a road/highway
  let bridgeAvailable = false;
  let riverCrossings = 0;
  let maxElev = -Infinity, minElev = Infinity;

  for (let i = 0; i < line.length; i++) {
    const { col, row } = line[i];
    const key = `${col},${row}`;
    const cell = terrainData.cells[key];
    const terrain = cell?.terrain || "open_ground";
    const elev = cell?.elevation ?? 0;
    const features = cell?.features || [];

    pathTerrain.push({
      hex: positionToLabel(key),
      terrain,
      elevation: elev,
      features: features.filter(f => f !== ""),
    });

    if (elev > maxElev) maxElev = elev;
    if (elev < minElev) minElev = elev;

    // Skip cost for the origin hex (you're already there)
    if (i === 0) continue;

    // Base terrain cost — movement-type-aware for naval and amphibious units
    let cost = getTerrainCostForMovement(terrain, movementType);

    // River without bridge is expensive; with bridge is cheap
    if (features.includes("river") || features.includes("river_crossing")) {
      if (features.includes("bridge")) {
        bridgeAvailable = true;
        cost = Math.min(cost, 1.0); // bridge negates river penalty
      } else {
        riverCrossings++;
        cost = Math.max(cost, 3.0);
      }
    }

    // Road/highway reduces cost (take the better of terrain cost or road cost)
    const hasRoad = features.some(f =>
      f === "highway" || f === "major_road" || f === "road"
    );
    if (!hasRoad) roadOnPath = false;

    // Road discount: road cost is 0.5 for wheeled, 0.7 for tracked, 0.8 for foot
    if (hasRoad) {
      const roadCost = movementType === "wheeled" ? 0.5
        : movementType === "tracked" ? 0.7
        : 0.8;
      cost = Math.min(cost, roadCost);
    }

    totalCost += cost;
  }

  const budget = MOVEMENT_BUDGETS[movementType] ?? 3;
  const startElev = pathTerrain[0]?.elevation ?? 0;
  const endElev = pathTerrain[pathTerrain.length - 1]?.elevation ?? 0;

  // Feasibility: compare total cost to budget with 20% margin for MARGINAL
  let feasibility;
  if (totalCost <= budget) {
    feasibility = "FEASIBLE";
  } else if (totalCost <= budget * 1.2) {
    feasibility = "MARGINAL";
  } else {
    feasibility = "UNLIKELY";
  }

  return {
    path: pathTerrain.map(p => p.hex),
    pathTerrain,
    distanceHexes,
    distanceKm,
    totalCost: Math.round(totalCost * 10) / 10,
    budget,
    feasibility,
    roadOnPath,
    bridgeAvailable,
    riverCrossings,
    elevationChange: {
      net: endElev - startElev,
      maxGain: maxElev - startElev,
      maxLoss: startElev - minElev,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. RANGE COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute hex distance and classify into range band.
 * Uses km-based weapon ranges (from era template or fallback table),
 * converted to hex counts via cellSizeKm. Mirrors detection system pattern.
 *
 * @param {string} fromPos - origin position
 * @param {string} toPos   - target position
 * @param {Object|string} unit - unit object with .type and optional .weaponRangeKm, or type string
 * @param {number} cellSizeKm - km per hex (from terrain data)
 * @returns {{ hexes, km, band, rangeKm }}
 *   band: "POINT_BLANK" | "EFFECTIVE" | "MAX" | "OUT_OF_RANGE"
 */
export function computeRange(fromPos, toPos, unit, cellSizeKm = 1) {
  const from = parsePosition(fromPos);
  const to = parsePosition(toPos);
  if (!from || !to) return { hexes: 0, km: 0, band: "OUT_OF_RANGE", rangeKm: null };

  const hexes = hexDistance(from.col, from.row, to.col, to.row);
  const km = hexes * cellSizeKm;

  // Resolve weapon range: unit-specific (from era template) → fallback by type
  const unitType = typeof unit === "string" ? unit : unit.type;
  const rangeKm = (typeof unit === "object" && unit.weaponRangeKm)
    ? unit.weaponRangeKm
    : WEAPON_RANGE_KM[unitType] || WEAPON_RANGE_KM.infantry;

  // Convert km ranges to hex counts
  let pbHex  = Math.floor(rangeKm.pointBlank / cellSizeKm);
  let effHex = Math.floor(rangeKm.effective / cellSizeKm);
  let maxHex = Math.floor(rangeKm.max / cellSizeKm);

  // Floor: any combatant can engage at least to adjacent hex
  if (rangeKm.max > 0) {
    maxHex = Math.max(1, maxHex);
    effHex = Math.max(1, effHex);
    // pointBlank stays as-is (0 = same-hex point blank is valid)
  }

  // Enforce ordering: max >= effective >= pointBlank
  effHex = Math.min(effHex, maxHex);
  pbHex  = Math.min(pbHex, effHex);

  let band;
  if (hexes <= pbHex)  band = "POINT_BLANK";
  else if (hexes <= effHex) band = "EFFECTIVE";
  else if (hexes <= maxHex) band = "MAX";
  else band = "OUT_OF_RANGE";

  return { hexes, km, band, rangeKm };
}

// ═══════════════════════════════════════════════════════════════
// 3. LINE OF SIGHT
// ═══════════════════════════════════════════════════════════════

/**
 * Compute LOS between two positions using terrain data.
 * Wrapper around HexMath.computeLOS with the project's LOS_TERRAIN lookup.
 *
 * @param {string} fromPos - origin position
 * @param {string} toPos   - target position
 * @param {Object} terrainData
 * @returns {{ result: "CLEAR"|"PARTIAL"|"BLOCKED", detail: string|null }}
 */
export function computeLineofsight(fromPos, toPos, terrainData) {
  const from = parsePosition(fromPos);
  const to = parsePosition(toPos);
  if (!from || !to) return { result: "BLOCKED", detail: "invalid position" };

  return computeLOS(from.col, from.row, to.col, to.row, terrainData, LOS_TERRAIN);
}

// ═══════════════════════════════════════════════════════════════
// 4. FORCE RATIO
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the force ratio between attackers and defenders at a hex.
 * Uses echelon weights, terrain defense modifier, entrenchment, and combined arms.
 *
 * @param {Array} attackers - units attacking (need .strength, .echelon, .type)
 * @param {Array} defenders - units defending (need .strength, .echelon, .entrenchment)
 * @param {Object} defenderCell - { terrain, features } at defender position
 * @returns {{ ratio, label, attackerPower, defenderPower, combinedArms, anchor }}
 */
export function computeForceRatio(attackers, defenders, defenderCell) {
  if (!defenders.length) {
    return { ratio: Infinity, label: "UNDEFENDED", attackerPower: 0, defenderPower: 0, combinedArms: false, anchor: "" };
  }

  // Attacker power: sum of (strength/100 * echelon_weight)
  let attackerPower = 0;
  const attackerTypes = new Set();
  for (const u of attackers) {
    const weight = ECHELON_WEIGHTS[u.echelon] || 1;
    attackerPower += (u.strength / 100) * weight;
    attackerTypes.add(u.type);
  }

  // Combined arms bonus: infantry-type + armor-type attacking together = 1.5x
  const hasInfantryType = attackerTypes.has("infantry") || attackerTypes.has("mechanized")
    || attackerTypes.has("parachute_infantry") || attackerTypes.has("glider_infantry")
    || attackerTypes.has("armored_infantry");
  const hasArmorType = attackerTypes.has("armor") || attackerTypes.has("tank_destroyer");
  const combinedArms = hasInfantryType && hasArmorType;
  if (combinedArms) attackerPower *= 1.5;

  // Defender power: sum of (strength/100 * echelon_weight) * terrain modifier
  let defenderPower = 0;
  for (const u of defenders) {
    const weight = ECHELON_WEIGHTS[u.echelon] || 1;
    defenderPower += (u.strength / 100) * weight;
  }

  // Terrain defensive modifier
  const terrainDef = TERRAIN_DEFENSE[defenderCell?.terrain] || "POOR";
  const terrainMult = terrainDef === "EXCELLENT" ? 2.0
    : terrainDef === "STRONG" ? 1.5
    : terrainDef === "MODERATE" ? 1.3
    : 1.0;
  defenderPower *= terrainMult;

  // Entrenchment bonus: average defender entrenchment adds up to +0.5 multiplier
  const avgEntrenchment = defenders.reduce((s, u) => s + (u.entrenchment || 0), 0) / defenders.length;
  defenderPower *= 1 + (avgEntrenchment / 100) * 0.5;

  const ratio = defenderPower > 0 ? attackerPower / defenderPower : Infinity;
  const ratioStr = ratio === Infinity ? "∞" : ratio.toFixed(1);

  let label;
  if (ratio >= 3) label = "OVERWHELMING";
  else if (ratio >= 2) label = "FAVORABLE";
  else if (ratio >= 1) label = "CONTESTED";
  else if (ratio >= 0.5) label = "UNFAVORABLE";
  else label = "DIRE";

  // Inline anchor for LLM context
  const anchor = "Ref: 3:1 needed vs prepared defense, 2:1 with combined arms";

  return {
    ratio: Math.round(ratio * 10) / 10,
    label,
    ratioStr: `${ratioStr}:1 (${label})`,
    attackerPower: Math.round(attackerPower * 10) / 10,
    defenderPower: Math.round(defenderPower * 10) / 10,
    combinedArms,
    anchor,
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. TERRAIN DEFENSIVE VALUE
// ═══════════════════════════════════════════════════════════════

/**
 * Describe the defensive value of a hex based on terrain + features.
 * Returns a human-readable label with feature modifiers.
 *
 * @param {string} posStr - hex position
 * @param {Object} terrainData
 * @returns {{ base, modifiers, summary }}
 */
export function computeTerrainDefense(posStr, terrainData) {
  const pos = parsePosition(posStr);
  if (!pos) return { base: "UNKNOWN", modifiers: [], summary: "Unknown terrain" };

  const cell = terrainData.cells[`${pos.col},${pos.row}`];
  if (!cell) return { base: "UNKNOWN", modifiers: [], summary: "No terrain data" };

  const base = TERRAIN_DEFENSE[cell.terrain] || "POOR";
  const modifiers = [];

  const features = cell.features || [];
  if (features.includes("building") || features.includes("building_dense")) {
    modifiers.push("buildings provide hard cover");
  }
  if (features.includes("ridgeline")) {
    modifiers.push("ridgeline gives observation advantage");
  }
  if (features.includes("river")) {
    modifiers.push("river protects flank");
  }
  if (features.includes("treeline")) {
    modifiers.push("treeline provides concealment");
  }
  if (features.includes("military_base")) {
    modifiers.push("prepared military facilities");
  }

  const summary = modifiers.length > 0
    ? `${base} (${cell.terrain} + ${modifiers.join(", ")})`
    : `${base} (${cell.terrain})`;

  return { base, modifiers, summary };
}

// ═══════════════════════════════════════════════════════════════
// 6. NEARBY UNITS
// ═══════════════════════════════════════════════════════════════

/**
 * Find all units within a given radius of a position.
 * Separates into friendly and enemy arrays.
 *
 * @param {string} posStr - center position
 * @param {number} radius - hex radius to search
 * @param {Array} allUnits - all units in game state
 * @param {string} myActorId - the acting unit's actor ID
 * @returns {{ friendly: Array, enemy: Array }}
 */
export function findNearbyUnits(posStr, radius, allUnits, myActorId) {
  const pos = parsePosition(posStr);
  if (!pos) return { friendly: [], enemy: [] };

  const friendly = [];
  const enemy = [];

  for (const u of allUnits) {
    const uPos = parsePosition(u.position);
    if (!uPos) continue;

    const dist = hexDistance(pos.col, pos.row, uPos.col, uPos.row);
    if (dist > radius) continue;

    const entry = {
      unit: u.name,
      unitId: u.id,
      hex: positionToLabel(u.position),
      distance: dist,
      type: u.type,
      strength: u.strength,
      status: u.status,
    };

    if (u.actor === myActorId) {
      friendly.push(entry);
    } else {
      enemy.push(entry);
    }
  }

  // Sort by distance
  friendly.sort((a, b) => a.distance - b.distance);
  enemy.sort((a, b) => a.distance - b.distance);

  return { friendly, enemy };
}

// ═══════════════════════════════════════════════════════════════
// 7. OBSERVER AVAILABILITY (for artillery)
// ═══════════════════════════════════════════════════════════════

/**
 * Find the best friendly observer for an artillery target hex.
 * Checks LOS from each friendly unit to the target.
 *
 * @param {string} targetPos - the hex being fired on
 * @param {Array} friendlyUnits - units on the same side
 * @param {Object} terrainData
 * @returns {{ observer, los, distance } | null}
 */
export function findObserver(targetPos, friendlyUnits, terrainData) {
  const target = parsePosition(targetPos);
  if (!target) return null;

  let best = null;

  for (const u of friendlyUnits) {
    // Skip artillery (they can't observe for themselves at range)
    if (u.type === "artillery") continue;

    const uPos = parsePosition(u.position);
    if (!uPos) continue;

    const dist = hexDistance(uPos.col, uPos.row, target.col, target.row);
    const los = computeLineofsight(u.position, targetPos, terrainData);

    // Prefer CLEAR over PARTIAL, and closer over farther
    if (los.result === "BLOCKED") continue;

    const score = (los.result === "CLEAR" ? 100 : 50) - dist;
    if (!best || score > best.score) {
      best = {
        observer: u.name,
        observerId: u.id,
        hex: positionToLabel(u.position),
        los: los.result,
        losDetail: los.detail,
        distance: dist,
        score,
      };
    }
  }

  if (!best) return null;
  // Remove internal score from output
  const { score, ...result } = best;
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 8. FIRE SUPPORT AVAILABILITY
// ═══════════════════════════════════════════════════════════════

/**
 * Find all friendly units that can provide fire support to a target hex.
 * Includes range check and observer info for artillery.
 *
 * @param {string} targetPos - the hex being attacked
 * @param {Array} friendlyUnits - all friendly units
 * @param {Object} terrainData
 * @returns {Array<{ unit, range, inRange, hasLos, observer }>}
 */
export function findFireSupport(targetPos, friendlyUnits, terrainData) {
  const results = [];

  for (const u of friendlyUnits) {
    // Only units that can shoot: combat types with ranged capability
    if (!["artillery", "armor", "infantry", "mechanized", "air_defense", "tank_destroyer", "armored_infantry", "parachute_infantry", "glider_infantry"].includes(u.type)) continue;

    const range = computeRange(u.position, targetPos, u, terrainData.cellSizeKm || 1);
    if (range.band === "OUT_OF_RANGE") continue;

    const los = computeLineofsight(u.position, targetPos, terrainData);

    const entry = {
      unit: u.name,
      unitId: u.id,
      type: u.type,
      range: range.hexes,
      rangeBand: range.band,
      inRange: true,
      hasLos: los.result !== "BLOCKED",
    };

    // Artillery needs an observer if it doesn't have direct LOS
    if (u.type === "artillery" && !entry.hasLos) {
      const obs = findObserver(targetPos, friendlyUnits, terrainData);
      entry.observer = obs
        ? `${obs.observer} at ${obs.hex} — ${obs.los} LOS, ${obs.distance} hex`
        : "No observer — map registration only";
    }

    results.push(entry);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// 9. BUILD ORDER BUNDLE
// ═══════════════════════════════════════════════════════════════

/**
 * Build the complete pre-computed data bundle for a single unit's orders.
 * This is the main entry point — assembles all the computed data the LLM needs.
 *
 * @param {Object} unit - the unit object from game state
 * @param {Object} orders - { movementOrder: {type, targetHex}, actionOrder: {type, targetHex, targetUnit, subtype}, intent }
 * @param {Object} gameState - full game state
 * @param {Object} terrainData - terrain grid data
 * @param {Object} fortuneRoll - { roll, descriptor } for this unit (or null)
 * @param {Object|null} frictionEvent - friction event assigned to this unit (or null)
 * @returns {Object} the complete bundle
 */
export function buildOrderBundle(unit, orders, gameState, terrainData, fortuneRoll = null, frictionEvent = null) {
  const allUnits = gameState.units || [];
  const cellSizeKm = terrainData.cellSizeKm || 1;

  const bundle = {
    // === Unit identity ===
    unitId: unit.id,
    unitName: unit.name,
    unitType: unit.type,
    echelon: unit.echelon,
    actor: unit.actor,
    position: positionToLabel(unit.position),
    strength: unit.strength,
    supply: unit.supply,
    status: unit.status,
    posture: unit.posture,
    movementType: unit.movementType || "foot",

    // Scale-conditional fields (include if present)
    ...(unit.morale !== undefined && { morale: unit.morale }),
    ...(unit.ammo !== undefined && { ammo: unit.ammo }),
    ...(unit.fuel !== undefined && { fuel: unit.fuel }),
    ...(unit.entrenchment !== undefined && { entrenchment: unit.entrenchment }),
    ...(unit.cohesion !== undefined && { cohesion: unit.cohesion }),

    // === Orders ===
    movementOrder: orders.movementOrder || null,
    actionOrder: orders.actionOrder || null,
    intent: orders.intent || "",

    // === Pre-computed data (filled below) ===
    movement: null,
    combat: null,
    nearby: null,
    fortuneRoll: fortuneRoll,
    frictionEvent: frictionEvent,
  };

  // Determine the "effective position" — where the unit WILL be after movement
  const effectivePos = orders.movementOrder?.targetHex
    ? orders.movementOrder.targetHex
    : unit.position;

  // === Movement computation ===
  if (orders.movementOrder?.targetHex) {
    bundle.movement = computeMovePath(
      unit.position,
      orders.movementOrder.targetHex,
      terrainData,
      unit.movementType || "foot"
    );
  }

  // === Combat computation (uses effective position) ===
  if (orders.actionOrder?.targetHex) {
    const targetHex = orders.actionOrder.targetHex;
    const range = computeRange(effectivePos, targetHex, unit, cellSizeKm);
    const los = computeLineofsight(effectivePos, targetHex, terrainData);
    const terrainDef = computeTerrainDefense(targetHex, terrainData);

    // Find defenders at the target hex
    const defenders = allUnits.filter(u => {
      const uPos = parsePosition(u.position);
      const tPos = parsePosition(targetHex);
      if (!uPos || !tPos) return false;
      return uPos.col === tPos.col && uPos.row === tPos.row && u.actor !== unit.actor;
    });

    // Find co-attackers (friendly units also attacking this hex)
    const coAttackers = allUnits.filter(u =>
      u.actor === unit.actor && u.id !== unit.id
    );

    const forceRatio = defenders.length > 0
      ? computeForceRatio([unit], defenders, terrainData.cells[posToKey(targetHex)])
      : null;

    // Elevation advantage
    const effPos = parsePosition(effectivePos);
    const tgtPos = parsePosition(targetHex);
    const effElev = effPos ? (terrainData.cells[`${effPos.col},${effPos.row}`]?.elevation ?? 0) : 0;
    const tgtElev = tgtPos ? (terrainData.cells[`${tgtPos.col},${tgtPos.row}`]?.elevation ?? 0) : 0;
    const elevAdvantage = effElev > tgtElev + 50 ? "ATTACKER_HIGH"
      : tgtElev > effElev + 50 ? "DEFENDER_HIGH"
      : "LEVEL";

    // Fire support from friendly units
    const friendlyUnits = allUnits.filter(u => u.actor === unit.actor && u.id !== unit.id);
    const fireSupport = findFireSupport(targetHex, friendlyUnits, terrainData);

    // Check for combined arms at the target
    const attackerTypesAtTarget = new Set([unit.type]);
    // TODO: when we have full order data for all units, check co-attackers targeting the same hex

    bundle.combat = {
      targetHex: positionToLabel(targetHex),
      rangeHexes: range.hexes,
      rangeKm: range.km,
      rangeBand: range.band,
      inEffectiveRange: range.band === "POINT_BLANK" || range.band === "EFFECTIVE",
      los: los.result,
      losDetail: los.detail,
      elevationAdvantage: elevAdvantage,
      defenderTerrain: terrainDef.summary,
      defenders: defenders.map(d => ({
        name: d.name,
        type: d.type,
        strength: d.strength,
        status: d.status,
        entrenchment: d.entrenchment || 0,
      })),
      forceRatio: forceRatio?.ratioStr || "N/A (no defender)",
      combinedArms: forceRatio?.combinedArms || false,
      forceRatioAnchor: forceRatio?.anchor || "",
      fireSupport,
    };
  }

  // === Artillery fire mission specifics ===
  if (orders.actionOrder?.type === "FIRE_MISSION" && orders.actionOrder?.targetHex) {
    const targetHex = orders.actionOrder.targetHex;
    const range = computeRange(unit.position, targetHex, unit, cellSizeKm);
    const los = computeLineofsight(unit.position, targetHex, terrainData);
    const terrainDef = computeTerrainDefense(targetHex, terrainData);
    const friendlyUnits = allUnits.filter(u => u.actor === unit.actor && u.id !== unit.id);
    const observer = findObserver(targetHex, friendlyUnits, terrainData);

    // Find units at the target
    const targetUnits = allUnits.filter(u => {
      const uPos = parsePosition(u.position);
      const tPos = parsePosition(targetHex);
      if (!uPos || !tPos) return false;
      return uPos.col === tPos.col && uPos.row === tPos.row;
    });

    bundle.combat = {
      targetHex: positionToLabel(targetHex),
      subtype: orders.actionOrder.subtype || "HE",
      rangeHexes: range.hexes,
      rangeKm: range.km,
      rangeBand: range.band,
      inEffectiveRange: range.band === "POINT_BLANK" || range.band === "EFFECTIVE",
      los: los.result,
      losDetail: los.detail,
      observer: observer
        ? `${observer.observer} at ${observer.hex} — ${observer.los} LOS, ${observer.distance} hex`
        : "No observer — map registration only",
      defenderTerrain: terrainDef.summary,
      targetUnits: targetUnits.map(u => ({
        name: u.name,
        actor: u.actor,
        type: u.type,
        strength: u.strength,
        status: u.status,
        entrenchment: u.entrenchment || 0,
      })),
    };
  }

  // === Nearby context ===
  const nearby = findNearbyUnits(effectivePos, 3, allUnits, unit.actor);
  // Remove self from friendly list
  bundle.nearby = {
    friendly: nearby.friendly.filter(f => f.unitId !== unit.id),
    enemy: nearby.enemy,
  };

  // === Check for enemies ON the movement path ===
  if (bundle.movement?.path?.length > 2) {
    const pathEnemies = [];
    for (let i = 1; i < bundle.movement.path.length - 1; i++) {
      const pathHex = bundle.movement.path[i];
      for (const e of nearby.enemy) {
        if (e.hex === pathHex) {
          pathEnemies.push({ ...e, onPathIndex: i });
        }
      }
    }
    if (pathEnemies.length > 0) {
      bundle.movement.enemiesOnPath = pathEnemies;
    }
  }

  return bundle;
}

// ═══════════════════════════════════════════════════════════════
// 10. BUILD ALL BUNDLES
// ═══════════════════════════════════════════════════════════════

/**
 * Build order bundles for all units across all actors.
 * This is the top-level entry point called by the orchestrator.
 *
 * @param {Object} allOrders - { actorId: { unitId: { movementOrder, actionOrder, intent } } }
 * @param {Object} gameState
 * @param {Object} terrainData
 * @param {Object} unitFortuneRolls - { unitId: { roll, descriptor } }
 * @param {Object} unitFrictionEvents - { unitId: { id, text, severity, ... } }
 * @returns {Array<Object>} array of order bundles
 */
export function buildAllBundles(allOrders, gameState, terrainData, unitFortuneRolls = {}, unitFrictionEvents = {}, detectionContext = null) {
  const bundles = [];

  for (const unit of gameState.units) {
    const actorOrders = allOrders[unit.actor];
    const unitOrders = actorOrders?.[unit.id] || { movementOrder: null, actionOrder: null, intent: "" };

    // Skip units with no orders (they default to HOLD)
    const hasOrders = unitOrders.movementOrder || unitOrders.actionOrder;

    const fortune = unitFortuneRolls[unit.id] || null;
    const friction = unitFrictionEvents[unit.id] || null;

    const bundle = buildOrderBundle(unit, unitOrders, gameState, terrainData, fortune, friction);
    bundle.isHold = !hasOrders;

    // Filter enemy info in bundle to only include detected enemies
    // This actor's orders should only reference enemies they actually know about
    if (detectionContext) {
      const actorVis = detectionContext.actorVisibility?.[unit.actor];
      if (actorVis) {
        const detectedSet = new Set(actorVis.detectedUnits || []);
        const contactSet = new Set(actorVis.contactUnits || []);
        const knownEnemies = new Set([...detectedSet, ...contactSet]);

        // Filter nearby enemies to only those this actor detected
        if (bundle.nearby?.enemy) {
          bundle.nearby.enemy = bundle.nearby.enemy.filter(e => knownEnemies.has(e.unitId));
        }

        // Filter enemies on movement path
        if (bundle.movement?.enemiesOnPath) {
          bundle.movement.enemiesOnPath = bundle.movement.enemiesOnPath.filter(e => knownEnemies.has(e.unitId));
          if (bundle.movement.enemiesOnPath.length === 0) delete bundle.movement.enemiesOnPath;
        }

        // Filter defenders at attack target (H3: was bundle.action, correct path is bundle.combat)
        if (bundle.combat?.defenders) {
          bundle.combat.defenders = bundle.combat.defenders.filter(d => {
            // Look up the unit by name to get its ID
            const defUnit = gameState.units.find(u => u.name === d.name);
            return defUnit && knownEnemies.has(defUnit.id);
          });
        }
      }
    }

    bundles.push(bundle);
  }

  return bundles;
}

// ── Internal helpers ───────────────────────────────────────────

// Convert a position string to a cell key like "3,4"
function posToKey(posStr) {
  const p = parsePosition(posStr);
  return p ? `${p.col},${p.row}` : posStr;
}

/**
 * Get terrain movement cost based on movement type.
 * Naval units move through water cheaply but can't cross land.
 * Amphibious units can do both but slower on each.
 * Ground units use the standard TERRAIN_COSTS (water = 999).
 */
function getTerrainCostForMovement(terrain, movementType) {
  if (movementType === "naval") {
    // Ships: water is passable, everything else is impassable
    return NAVAL_TERRAIN_COSTS[terrain] ?? 999;
  }
  if (movementType === "amphibious") {
    // Amphibious: check water costs first, then land costs with penalty
    if (terrain in NAVAL_TERRAIN_COSTS) {
      return AMPHIBIOUS_TERRAIN_COSTS[terrain] ?? NAVAL_TERRAIN_COSTS[terrain] * 1.5;
    }
    return (TERRAIN_COSTS[terrain] ?? 1.0) * 1.5;
  }
  // Ground units: standard costs (water = 999)
  return TERRAIN_COSTS[terrain] ?? 1.0;
}
