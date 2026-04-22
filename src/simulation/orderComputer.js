// ═══════════════════════════════════════════════════════════════
// ORDER COMPUTER — Pre-computes ranges, paths, LOS, force ratios,
// and other hard math so the LLM doesn't have to.
// Consumes structured orders + game state, outputs dense data bundles.
// ═══════════════════════════════════════════════════════════════

import { hexDistance, hexLine, hexLineThrough, computeLOS } from "../mapRenderer/HexMath.js";
import {
  WEAPON_RANGE_KM, MOVEMENT_BUDGETS, TERRAIN_COSTS, TERRAIN_DEFENSE,
  LOS_TERRAIN, ECHELON_WEIGHTS, ORDER_TYPES,
  NAVAL_TERRAIN_COSTS, AMPHIBIOUS_TERRAIN_COSTS,
  isAirUnit, isHelicopter,
} from "./orderTypes.js";
import { parsePosition, positionToLabel } from "./prompts.js";
import { buildEffectiveTerrain } from "./terrainMerge.js";

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
export function computeMovePath(fromPos, toPos, terrainData, movementType = "foot", waypoints = null) {
  const from = parsePosition(fromPos);
  const to = parsePosition(toPos);
  if (!from || !to) {
    return { path: [], feasibility: "INFEASIBLE", error: "Invalid position" };
  }

  // Build hex path through waypoints if provided, otherwise straight line
  const chain = [from];
  if (waypoints?.length > 0) {
    for (const wp of waypoints) {
      const p = parsePosition(wp);
      if (p) chain.push(p);
    }
  }
  chain.push(to);
  const line = chain.length === 2
    ? hexLine(from.col, from.row, to.col, to.row)
    : hexLineThrough(chain);
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

    // Obstacles (mines, wire, AT ditches) impose heavy movement cost
    if (features.includes("obstacle")) {
      cost = Math.max(cost, 2.5);
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

  // Hex-level fortification from terrain mods (fieldworks that persist after units leave)
  const hexFort = defenderCell?.hexFortification || 0;
  if (hexFort > 0) defenderPower *= 1 + (hexFort / 100) * 0.5;

  // Terrain damage from sustained combat reduces defensive value
  const hexDamage = defenderCell?.terrainDamage || 0;
  if (hexDamage > 0) defenderPower *= 1 - (hexDamage / 100) * 0.3;

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
  // Terrain modification overlays
  if (cell.hexFortification > 0) {
    modifiers.push(`fortified position (${cell.hexFortification}% defense bonus)`);
  }
  if (cell.terrainDamage > 0) {
    modifiers.push(`terrain damaged (${cell.terrainDamage}% degraded)`);
  }
  if (features.includes("obstacle")) {
    modifiers.push(`obstacle (${cell.obstacleMeta?.subtype || "general"}) impedes movement`);
  }
  if (features.includes("smoke")) {
    modifiers.push("smoke obscures LOS");
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
// 9. AIR DEFENSE THREAT & AIR SUPERIORITY
// ═══════════════════════════════════════════════════════════════

// AD engagement ranges by category (in hexes at grand-tactical scale).
// Scales naturally with hex size — at larger scales these still represent
// the same ~3-40km physical ranges, just fewer hexes.
const AD_RANGES = {
  gun_ad: 1,
  ir_missile_ad: 2,
  radar_missile_ad: 4,
};

// Threat effectiveness: AD_EFFECTIVENESS[adType][altitude][speed] → numeric 0-5
// 0=NONE, 1=NEGLIGIBLE, 2=LOW, 3=MODERATE, 4=HIGH, 5=VERY_HIGH
const AD_EFFECTIVENESS = {
  gun_ad: {
    LOW:    { slow: 5, medium: 4, fast: 1, supersonic: 1 },
    MEDIUM: { slow: 3, medium: 2, fast: 1, supersonic: 0 },
    HIGH:   { slow: 0, medium: 0, fast: 0, supersonic: 0 },
  },
  ir_missile_ad: {
    LOW:    { slow: 4, medium: 4, fast: 3, supersonic: 2 },
    MEDIUM: { slow: 2, medium: 2, fast: 1, supersonic: 1 },
    HIGH:   { slow: 0, medium: 0, fast: 0, supersonic: 0 },
  },
  radar_missile_ad: {
    LOW:    { slow: 2, medium: 2, fast: 1, supersonic: 1 },
    MEDIUM: { slow: 5, medium: 5, fast: 4, supersonic: 3 },
    HIGH:   { slow: 4, medium: 4, fast: 4, supersonic: 3 },
  },
};

const THREAT_LABELS = ["NONE", "NEGLIGIBLE", "LOW", "MODERATE", "HIGH", "VERY_HIGH"];

// ASL labels by ratio (friendly air power : enemy air+AD power in sector)
const ASL_THRESHOLDS = [
  { min: 3.0,  label: "AIR_SUPREMACY" },
  { min: 1.5,  label: "AIR_SUPERIORITY" },
  { min: 0.67, label: "CONTESTED" },
  { min: 0.33, label: "AIR_DENIAL" },
  { min: 0,    label: "ENEMY_SUPREMACY" },
];

// Air orders that indicate active air combat capability in a sector
const AIR_COMBAT_ORDERS = new Set(["AIR_SUPERIORITY", "CAP"]);

// Air orders that are affected by AD and ASL
const AIR_MISSION_ORDERS = new Set([
  "CAS", "AIR_SUPERIORITY", "INTERDICTION", "SEAD",
  "STRATEGIC_STRIKE", "AIR_RECON", "CAP", "ESCORT", "AIRLIFT",
]);

/**
 * Find all AD units belonging to a specific actor (or all enemy actors).
 * Returns each AD unit with its AD categories and position.
 *
 * @param {Array} allUnits - all units in the game
 * @param {string} excludeActorId - actor whose AD we want to find (null = all)
 * @param {string} onlyActorId - if set, only return AD from this actor
 * @returns {Array<{ unit, adTypes: string[], position: {col,row} }>}
 */
function findADUnits(allUnits, { excludeActorId = null, onlyActorId = null } = {}) {
  const results = [];
  for (const u of allUnits) {
    if (excludeActorId && u.actor === excludeActorId) continue;
    if (onlyActorId && u.actor !== onlyActorId) continue;
    const caps = u.specialCapabilities || [];
    const adTypes = caps.filter(c => c in AD_RANGES);
    if (adTypes.length === 0) continue;
    const pos = parsePosition(u.position);
    if (!pos) continue;
    results.push({ unit: u, adTypes, position: pos });
  }
  return results;
}

/**
 * Compute the AD threat at a single hex for a given altitude and aircraft speed.
 * Checks all enemy AD units in range and returns the aggregate threat.
 *
 * @param {string} hexPos - position to evaluate
 * @param {string} altitude - "LOW", "MEDIUM", or "HIGH"
 * @param {string} speed - aircraft speed tier ("slow", "medium", "fast", "supersonic")
 * @param {Array} enemyADUnits - from findADUnits()
 * @param {Array} allUnits - all units (for infantry organic AD check)
 * @param {string} aircraftActorId - the actor flying the aircraft
 * @returns {{ threat: string, threatLevel: number, adSources: Array }}
 */
export function computeADThreatAtHex(hexPos, altitude, speed, enemyADUnits, allUnits, aircraftActorId) {
  const pos = parsePosition(hexPos);
  if (!pos) return { threat: "NONE", threatLevel: 0, adSources: [] };

  let maxThreat = 0;
  const adSources = [];

  // Check dedicated AD units
  for (const ad of enemyADUnits) {
    const dist = hexDistance(pos.col, pos.row, ad.position.col, ad.position.row);
    for (const adType of ad.adTypes) {
      const range = AD_RANGES[adType] || 0;
      if (dist > range) continue;

      const eff = AD_EFFECTIVENESS[adType]?.[altitude]?.[speed] || 0;
      if (eff === 0) continue;

      // Closer AD is more effective — within half range, full effect; beyond, degrade
      const rangeFactor = dist <= Math.ceil(range / 2) ? 1.0 : 0.7;
      const adjustedEff = Math.round(eff * rangeFactor);

      if (adjustedEff > 0) {
        adSources.push({
          unit: ad.unit.name,
          type: adType,
          distance: dist,
          effectiveness: THREAT_LABELS[Math.min(adjustedEff, 5)],
        });
        maxThreat = Math.max(maxThreat, adjustedEff);
      }
    }
  }

  // Infantry organic AD — minor threat to LOW altitude slow/medium aircraft
  if (altitude === "LOW") {
    for (const u of allUnits) {
      if (u.actor === aircraftActorId) continue;
      if (u.type !== "infantry" && u.type !== "mechanized" && u.type !== "parachute_infantry") continue;
      const uPos = parsePosition(u.position);
      if (!uPos) continue;
      const dist = hexDistance(pos.col, pos.row, uPos.col, uPos.row);
      if (dist > 0) continue; // Same hex only — small arms are short range
      const infantryThreat = speed === "slow" ? 2 : speed === "medium" ? 1 : 0;
      if (infantryThreat > 0) {
        adSources.push({
          unit: u.name,
          type: "small_arms",
          distance: 0,
          effectiveness: THREAT_LABELS[infantryThreat],
        });
        maxThreat = Math.max(maxThreat, infantryThreat);
      }
    }
  }

  return {
    threat: THREAT_LABELS[Math.min(maxThreat, 5)],
    threatLevel: maxThreat,
    adSources,
  };
}

/**
 * Compute AD threat along a flight path (list of hex positions).
 * Returns per-segment threat and an aggregate mission threat.
 *
 * @param {Array<{hex: string, altitude: string}>} flightPath - waypoints with altitude
 * @param {string} speed - aircraft speed tier
 * @param {Array} enemyADUnits - from findADUnits()
 * @param {Array} allUnits - all units
 * @param {string} aircraftActorId - the actor flying
 * @returns {{ segments: Array, aggregateThreat: string, aggregateLevel: number }}
 */
export function computeFlightPathADThreat(flightPath, speed, enemyADUnits, allUnits, aircraftActorId) {
  if (!flightPath || flightPath.length === 0) {
    return { segments: [], aggregateThreat: "NONE", aggregateLevel: 0 };
  }

  const segments = [];
  let maxThreat = 0;

  for (const wp of flightPath) {
    const threat = computeADThreatAtHex(wp.hex, wp.altitude, speed, enemyADUnits, allUnits, aircraftActorId);
    segments.push({
      hex: positionToLabel(wp.hex),
      altitude: wp.altitude,
      ...threat,
    });
    maxThreat = Math.max(maxThreat, threat.threatLevel);
  }

  return {
    segments,
    aggregateThreat: THREAT_LABELS[Math.min(maxThreat, 5)],
    aggregateLevel: maxThreat,
  };
}

/**
 * Compute Air Superiority Level (ASL) for a sector centered on a hex.
 * Sums air combat power per side, computes ratio, returns ASL label.
 *
 * Air combat power = Σ(strength/100 × capability_weight) for each air unit
 * on AIR_SUPERIORITY or CAP orders in the sector.
 * Enemy AD units in the sector contribute to the enemy side (denial effect).
 *
 * @param {string} sectorCenter - hex position at center of sector
 * @param {number} sectorRadius - radius in hexes (typically 2-3)
 * @param {Array} allUnits - all game units
 * @param {string} friendlyActorId - the actor requesting ASL
 * @param {Object} allOrders - { actorId: { unitId: { actionOrder } } }
 * @returns {{ asl: string, ratio: number, friendlyPower: number, enemyPower: number, detail: string }}
 */
export function computeAirSuperiority(sectorCenter, sectorRadius, allUnits, friendlyActorId, allOrders = {}) {
  const center = parsePosition(sectorCenter);
  if (!center) return { asl: "CONTESTED", ratio: 1.0, friendlyPower: 0, enemyPower: 0, detail: "invalid position" };

  let friendlyPower = 0;
  let enemyPower = 0;
  const friendlyDetail = [];
  const enemyDetail = [];

  for (const u of allUnits) {
    const uPos = parsePosition(u.position);
    if (!uPos) continue;
    const dist = hexDistance(center.col, center.row, uPos.col, uPos.row);
    if (dist > sectorRadius) continue;

    if (isAirUnit(u)) {
      // Air units contribute to their side if on air combat orders
      const unitOrders = allOrders[u.actor]?.[u.id];
      const actionType = unitOrders?.actionOrder?.type;
      const isAirCombat = AIR_COMBAT_ORDERS.has(actionType);

      // Weight by strength and capabilities
      let weight = (u.strength || 100) / 100;
      const caps = u.specialCapabilities || [];
      if (caps.includes("air_superiority")) weight *= 1.2;
      const profile = u.airProfile || {};
      if (profile.radarEquipped) weight *= 1.1;
      if (profile.speed === "supersonic") weight *= 1.1;
      else if (profile.speed === "fast") weight *= 1.05;

      if (u.actor === friendlyActorId) {
        if (isAirCombat) {
          friendlyPower += weight;
          friendlyDetail.push(u.name);
        }
      } else {
        if (isAirCombat) {
          enemyPower += weight;
          enemyDetail.push(u.name);
        }
      }
    } else {
      // AD units contribute to their side's denial capability (at reduced weight)
      const caps = u.specialCapabilities || [];
      const adTypes = caps.filter(c => c in AD_RANGES);
      if (adTypes.length === 0) continue;

      const adWeight = ((u.strength || 100) / 100) * 0.5;
      if (u.actor === friendlyActorId) {
        friendlyPower += adWeight;
      } else {
        enemyPower += adWeight;
        enemyDetail.push(`${u.name} (AD)`);
      }
    }
  }

  // Compute ratio — avoid division by zero
  const ratio = enemyPower === 0
    ? (friendlyPower > 0 ? 10.0 : 1.0) // No enemy → supremacy if we have anything
    : friendlyPower / enemyPower;

  // Map ratio to ASL label
  let asl = "ENEMY_SUPREMACY";
  for (const t of ASL_THRESHOLDS) {
    if (ratio >= t.min) { asl = t.label; break; }
  }

  const detail = friendlyDetail.length === 0 && enemyDetail.length === 0
    ? "No air combat assets in sector"
    : `Friendly: ${friendlyDetail.join(", ") || "none"} | Enemy: ${enemyDetail.join(", ") || "none"}`;

  return { asl, ratio: Math.round(ratio * 100) / 100, friendlyPower, enemyPower, detail };
}

/**
 * Identify and prioritize enemy units in a CAS sector for targeting.
 * Priority: 1) units with ATTACK orders, 2) units defending vs friendly attacks,
 * 3) all other units in sector.
 *
 * @param {string} sectorCenter - CAS sector center hex
 * @param {number} sectorRadius - sector radius (typically 2)
 * @param {Array} allUnits - all game units
 * @param {string} friendlyActorId - the CAS-ordering actor
 * @param {Object} allOrders - { actorId: { unitId: orders } }
 * @returns {Array<{ unit: string, unitId: string, type: string, strength: number,
 *   priority: string, hex: string, terrain: string }>}
 */
export function computeCASTargets(sectorCenter, sectorRadius, allUnits, friendlyActorId, allOrders = {}, terrainData = null) {
  const center = parsePosition(sectorCenter);
  if (!center) return [];

  const targets = [];

  for (const u of allUnits) {
    if (u.actor === friendlyActorId) continue; // Skip friendlies
    if (isAirUnit(u)) continue; // CAS targets ground units
    const uPos = parsePosition(u.position);
    if (!uPos) continue;
    const dist = hexDistance(center.col, center.row, uPos.col, uPos.row);
    if (dist > sectorRadius) continue;

    // Determine priority based on enemy orders
    const unitOrders = allOrders[u.actor]?.[u.id];
    const actionType = unitOrders?.actionOrder?.type;
    let priority;
    if (actionType === "ATTACK" || actionType === "ASSAULT") {
      priority = "ATTACKING"; // First priority — blunt the enemy offensive
    } else if (actionType === "DEFEND" || actionType === "DIG_IN" || actionType === "HOLD") {
      priority = "DEFENDING"; // Second priority — soften defenders
    } else {
      priority = "OPPORTUNITY"; // Third priority — targets of opportunity
    }

    // Get terrain at target's position for CAS effectiveness assessment
    const cellKey = `${uPos.col},${uPos.row}`;
    const cellTerrain = terrainData?.cells?.[cellKey]?.terrain || "unknown";

    targets.push({
      unit: u.name,
      unitId: u.id,
      type: u.type,
      strength: u.strength,
      priority,
      hex: positionToLabel(u.position),
      terrain: cellTerrain,
    });
  }

  // Sort by priority: ATTACKING first, then DEFENDING, then OPPORTUNITY
  const priorityOrder = { ATTACKING: 0, DEFENDING: 1, OPPORTUNITY: 2 };
  targets.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

  return targets;
}

/**
 * Compute CAS effectiveness modifier suggestion based on multiple factors.
 * Returns a suggested modifier range and the reasoning.
 *
 * @param {Object} aircraft - the CAS unit (needs strength, airProfile, specialCapabilities)
 * @param {string} asl - Air Superiority Level in the sector
 * @param {string} altitude - mission altitude
 * @param {number} adThreatLevel - 0-5 aggregate AD threat
 * @param {string} weather - weather condition
 * @param {string} era - era identifier (e.g., "ww2", "modern")
 * @returns {{ modifierLow: number, modifierHigh: number, factors: Array<string> }}
 */
export function computeCASEffectiveness(aircraft, asl, altitude, adThreatLevel, weather = "clear", era = "modern") {
  const factors = [];

  // Base modifier by era
  let baseLow, baseHigh;
  if (era.includes("ww1")) {
    baseLow = 1.02; baseHigh = 1.05; // WW1: minimal ground attack capability
    factors.push("WW1 era — very limited CAS capability");
  } else if (era.includes("ww2")) {
    baseLow = 1.1; baseHigh = 1.3;
    factors.push("WW2 era — unguided weapons");
  } else if (era.includes("cold")) {
    baseLow = 1.15; baseHigh = 1.4;
    factors.push("Cold War — early PGMs available");
  } else {
    baseLow = 1.2; baseHigh = 1.5;
    factors.push("Modern era — precision weapons");
  }

  // Aircraft strength scaling
  const strength = (aircraft.strength || 100) / 100;
  baseLow *= strength;
  baseHigh *= strength;
  if (strength < 0.5) factors.push(`Low aircraft strength (${aircraft.strength}%)`);

  // Altitude effect on CAS
  const caps = aircraft.specialCapabilities || [];
  const hasPrecision = caps.includes("precision_strike");
  if (altitude === "LOW") {
    // Low = best CAS effectiveness but higher AD risk
    factors.push("LOW altitude — excellent target ID");
  } else if (altitude === "MEDIUM") {
    baseLow *= 0.85; baseHigh *= 0.9;
    factors.push("MEDIUM altitude — good CAS, reduced target ID");
  } else if (altitude === "HIGH") {
    if (hasPrecision) {
      baseLow *= 0.75; baseHigh *= 0.85;
      factors.push("HIGH altitude — precision weapons compensate partially");
    } else {
      baseLow *= 0.5; baseHigh *= 0.6;
      factors.push("HIGH altitude — poor CAS without precision weapons");
    }
  }

  // ASL effect — CAS under contested skies is less effective
  if (asl === "AIR_SUPREMACY") {
    baseLow *= 1.05; baseHigh *= 1.05;
    factors.push("Air supremacy — unrestricted CAS operations");
  } else if (asl === "CONTESTED") {
    baseLow *= 0.8; baseHigh *= 0.85;
    factors.push("Contested airspace — CAS disrupted by air threats");
  } else if (asl === "AIR_DENIAL" || asl === "ENEMY_SUPREMACY") {
    baseLow *= 0.5; baseHigh *= 0.6;
    factors.push("Enemy air dominance — CAS severely constrained");
  }

  // AD threat penalty
  if (adThreatLevel >= 4) {
    baseLow *= 0.6; baseHigh *= 0.7;
    factors.push("Heavy AD threat — aircraft evading, reduced effectiveness");
  } else if (adThreatLevel >= 3) {
    baseLow *= 0.8; baseHigh *= 0.85;
    factors.push("Moderate AD threat — some evasive action required");
  } else if (adThreatLevel >= 2) {
    factors.push("Low AD threat — minor impact on operations");
  }

  // Weather
  if (weather === "storm" || weather === "fog") {
    if (hasPrecision && !era.includes("ww")) {
      baseLow *= 0.8; baseHigh *= 0.85;
      factors.push("Bad weather — precision weapons partially effective");
    } else {
      baseLow *= 0.5; baseHigh *= 0.6;
      factors.push("Bad weather — severely degraded CAS effectiveness");
    }
  } else if (weather === "overcast") {
    if (!hasPrecision) {
      baseLow *= 0.85; baseHigh *= 0.9;
      factors.push("Overcast — reduced visual target acquisition");
    }
  }

  // Clamp: modifier should be at least 1.0 (CAS shouldn't make things worse)
  baseLow = Math.max(1.0, Math.round(baseLow * 100) / 100);
  baseHigh = Math.max(baseLow, Math.round(baseHigh * 100) / 100);

  return { modifierLow: baseLow, modifierHigh: baseHigh, factors };
}

// ═══════════════════════════════════════════════════════════════
// 10. AIR-TO-AIR INTERCEPTION
// ═══════════════════════════════════════════════════════════════

// Speed tier numeric values for comparison — approximate km/h
const SPEED_KMH = { slow: 300, medium: 600, fast: 1200, supersonic: 1800 };

// Speed advantage thresholds for catch computation
// If interceptor is this much faster (ratio), catch bonus applies
const SPEED_CATCH_BONUS = { dominant: 1.5, advantage: 1.2, parity: 0.8 };

// Interdiction score bands — labels and CAS effect
const INTERDICTION_BANDS = [
  { max: 25,  label: "HARASSING_PASS",        effectivenessReduction: 0.10, cancelled: false },
  { max: 50,  label: "CONTESTED_ENGAGEMENT",   effectivenessReduction: 0.30, cancelled: false },
  { max: 74,  label: "SERIOUS_INTERCEPTION",   effectivenessReduction: 0.50, cancelled: false },
  { max: 89,  label: "DRIVEN_OFF",             effectivenessReduction: 1.00, cancelled: true },
  { max: 100, label: "DEVASTATING_INTERCEPTION", effectivenessReduction: 1.00, cancelled: true },
];

// Air mission orders that can be intercepted
const INTERCEPTABLE_ORDERS = new Set(["CAS", "INTERDICTION", "STRATEGIC_STRIKE", "SEAD", "AIR_RECON", "AIRLIFT"]);

/**
 * Compute catch probability for an interceptor vs. a target mission.
 * Returns 0-100 probability and whether the catch succeeds.
 *
 * @param {Object} interceptor - unit with airProfile
 * @param {Object} target - unit with airProfile
 * @param {number} distanceHexes - hex distance from interceptor to target's AO
 * @param {number} sectorRadius - patrol sector radius
 * @param {number} fortuneRoll - 1-6 fortune roll (higher = better for interceptor)
 * @returns {{ catchProbability: number, caught: boolean, factors: Array<string> }}
 */
function computeCatch(interceptor, target, distanceHexes, sectorRadius, fortuneRoll = 3) {
  const iProfile = interceptor.airProfile || {};
  const tProfile = target.airProfile || {};
  const factors = [];

  let probability = 50; // Base 50% chance

  // Detection capability — radar is a huge advantage
  if (iProfile.radarEquipped) {
    probability += 25;
    factors.push("Interceptor has radar (+25%)");
  } else {
    probability -= 15;
    factors.push("Visual detection only (-15%)");
  }

  // Stealth on the target massively reduces detection
  const tCaps = target.specialCapabilities || [];
  if (tCaps.includes("stealth")) {
    probability -= 30;
    factors.push("Target has stealth (-30%)");
  }

  // ECM on the target degrades radar detection
  if (tProfile.ecm && iProfile.radarEquipped) {
    probability -= 10;
    factors.push("Target ECM degrades radar (-10%)");
  }

  // Speed differential — dominant factor
  const iSpeed = SPEED_KMH[iProfile.speed] || 600;
  const tSpeed = SPEED_KMH[tProfile.speed] || 600;
  const speedRatio = iSpeed / tSpeed;

  if (speedRatio >= SPEED_CATCH_BONUS.dominant) {
    probability += 20;
    factors.push(`Speed dominance (${iProfile.speed} vs ${tProfile.speed}, +20%)`);
  } else if (speedRatio >= SPEED_CATCH_BONUS.advantage) {
    probability += 10;
    factors.push(`Speed advantage (+10%)`);
  } else if (speedRatio < SPEED_CATCH_BONUS.parity) {
    // Interceptor is significantly slower — very hard to catch
    const penalty = speedRatio < 0.5 ? -35 : -20;
    probability += penalty;
    factors.push(`Interceptor slower (${penalty}%)`);
  }

  // Distance to target's AO — deeper in patrol sector = easier catch
  if (distanceHexes <= Math.ceil(sectorRadius / 2)) {
    probability += 10;
    factors.push("Target deep in patrol sector (+10%)");
  } else if (distanceHexes > sectorRadius) {
    probability -= 15;
    factors.push("Target at sector edge (-15%)");
  }

  // Fuel — low fuel forces disengagement
  const iFuel = interceptor.fuel;
  if (iFuel !== undefined && iFuel < 30) {
    probability -= 15;
    factors.push("Interceptor low fuel (-15%)");
  }

  // Fortune roll — minor influence, weighted toward center
  // Roll 1-6: 1-2 = bad luck (-5 to -10), 3-4 = neutral, 5-6 = good luck (+5 to +10)
  const fortuneModifier = (fortuneRoll - 3.5) * 3; // Range: roughly -7.5 to +7.5
  probability += fortuneModifier;
  if (Math.abs(fortuneModifier) > 3) {
    factors.push(`Fortune ${fortuneModifier > 0 ? "+" : ""}${Math.round(fortuneModifier)}%`);
  }

  // Clamp to 2-98 — never guaranteed catch or escape (leave room for narrative)
  probability = Math.max(2, Math.min(98, Math.round(probability)));

  // Determine if catch succeeds — compare against a d100 roll
  const catchRoll = Math.floor(Math.random() * 100) + 1;
  const caught = catchRoll <= probability;

  return { catchProbability: probability, caught, factors };
}

/**
 * Compute interdiction score (1-100) when interceptor catches the target.
 * Higher score = worse outcome for the target.
 *
 * @param {Object} interceptor - unit with airProfile
 * @param {Object} target - unit with airProfile
 * @param {number} fortuneRoll - 1-6
 * @returns {{ score: number, band: Object, factors: Array<string> }}
 */
function computeInterdictionScore(interceptor, target, fortuneRoll = 3) {
  const iProfile = interceptor.airProfile || {};
  const tProfile = target.airProfile || {};
  const factors = [];

  let score = 50; // Base score

  // Interceptor maneuverability vs target
  const iManeuver = iProfile.maneuverability || 5;
  const tManeuver = tProfile.maneuverability || 5;
  const maneuverDiff = iManeuver - tManeuver;
  score += maneuverDiff * 4; // Each point of advantage = +4 score
  if (Math.abs(maneuverDiff) >= 2) {
    factors.push(`Maneuverability ${maneuverDiff > 0 ? "advantage" : "disadvantage"} (${maneuverDiff > 0 ? "+" : ""}${maneuverDiff * 4})`);
  }

  // Weapons package — BVR is devastating, missiles better than guns-only
  const iWeapons = iProfile.weaponsPackage || ["guns"];
  if (iWeapons.includes("bvr_missiles")) {
    score += 15;
    factors.push("BVR missiles (+15)");
  } else if (iWeapons.includes("radar_missiles") || iWeapons.includes("ir_missiles")) {
    score += 8;
    factors.push("Missiles (+8)");
  }

  // Target defensive armament (rear gunners) — reduces interdiction effectiveness
  if (tProfile.defensiveArmament) {
    score -= 10;
    factors.push("Target defensive armament (-10)");
  }

  // Target ECM — degrades missile guidance
  if (tProfile.ecm) {
    score -= 8;
    factors.push("Target ECM (-8)");
  }

  // Speed advantage in the engagement
  const iSpeed = SPEED_KMH[iProfile.speed] || 600;
  const tSpeed = SPEED_KMH[tProfile.speed] || 600;
  if (iSpeed > tSpeed * 1.3) {
    score += 8;
    factors.push("Speed advantage in engagement (+8)");
  } else if (tSpeed > iSpeed * 1.3) {
    score -= 8;
    factors.push("Target faster — can disengage (-8)");
  }

  // Interceptor readiness — degraded readiness = less effective
  const iReadiness = interceptor.readiness;
  if (iReadiness !== undefined && iReadiness < 50) {
    score -= 10;
    factors.push("Interceptor low readiness (-10)");
  }

  // Fortune roll — moderate influence
  const fortuneModifier = (fortuneRoll - 3.5) * 5; // Range: roughly -12.5 to +12.5
  score += fortuneModifier;
  if (Math.abs(fortuneModifier) > 5) {
    factors.push(`Fortune ${fortuneModifier > 0 ? "+" : ""}${Math.round(fortuneModifier)}`);
  }

  // Clamp to 1-100
  score = Math.max(1, Math.min(100, Math.round(score)));

  // Determine band
  let band = INTERDICTION_BANDS[INTERDICTION_BANDS.length - 1];
  for (const b of INTERDICTION_BANDS) {
    if (score <= b.max) { band = b; break; }
  }

  return { score, band, factors };
}

/**
 * Resolve escort engagement when an escorted package is intercepted.
 * Returns whether the escort drives off the interceptor, both engage,
 * or the interceptor breaks through.
 *
 * @param {Object} escort - escort fighter unit with airProfile
 * @param {Object} interceptor - intercepting unit with airProfile
 * @param {number} fortuneRoll - 1-6
 * @returns {{ result: string, escortDamage: number, interceptorDamage: number, detail: string }}
 */
function resolveEscortEngagement(escort, interceptor, fortuneRoll = 3) {
  const eProfile = escort.airProfile || {};
  const iProfile = interceptor.airProfile || {};

  // Escort advantage score based on relative capabilities
  let escortAdvantage = 0;

  // Maneuverability comparison
  escortAdvantage += ((eProfile.maneuverability || 5) - (iProfile.maneuverability || 5)) * 5;

  // Weapons comparison
  const eWeapons = eProfile.weaponsPackage || ["guns"];
  const iWeapons = iProfile.weaponsPackage || ["guns"];
  if (eWeapons.includes("bvr_missiles") && !iWeapons.includes("bvr_missiles")) escortAdvantage += 10;
  if (!eWeapons.includes("bvr_missiles") && iWeapons.includes("bvr_missiles")) escortAdvantage -= 10;

  // Radar advantage
  if (eProfile.radarEquipped && !iProfile.radarEquipped) escortAdvantage += 8;
  if (!eProfile.radarEquipped && iProfile.radarEquipped) escortAdvantage -= 8;

  // Escort strength
  const eStrength = (escort.strength || 100) / 100;
  escortAdvantage += (eStrength - 0.5) * 20; // Full strength = +10, half = 0

  // Fortune
  escortAdvantage += (fortuneRoll - 3.5) * 4;

  // Determine outcome
  if (escortAdvantage > 15) {
    // Escort drives off interceptor
    return {
      result: "ESCORT_DRIVES_OFF",
      escortDamage: Math.max(0, Math.round(3 - escortAdvantage * 0.1)),
      interceptorDamage: Math.round(Math.min(15, 5 + escortAdvantage * 0.3)),
      detail: "Escort successfully engages and drives off the interceptor",
    };
  } else if (escortAdvantage > -15) {
    // Both engaged — mutual attrition, CAS continues
    const baseDmg = Math.round(5 + Math.abs(escortAdvantage) * 0.2);
    return {
      result: "MUTUAL_ENGAGEMENT",
      escortDamage: Math.round(baseDmg * (escortAdvantage < 0 ? 1.3 : 0.8)),
      interceptorDamage: Math.round(baseDmg * (escortAdvantage > 0 ? 1.3 : 0.8)),
      detail: "Escort and interceptor engage in extended air combat; CAS continues with reduced escort",
    };
  } else {
    // Interceptor breaks through
    return {
      result: "INTERCEPTOR_BREAKS_THROUGH",
      escortDamage: Math.round(Math.min(15, 8 + Math.abs(escortAdvantage) * 0.3)),
      interceptorDamage: Math.max(0, Math.round(3 + escortAdvantage * 0.1)),
      detail: "Interceptor outmaneuvers or outguns the escort and reaches the strike package",
    };
  }
}

/**
 * Compute losses for both interceptor and target based on interdiction score.
 * Returns percentage strength losses for each side.
 *
 * @param {number} interdictionScore - 1-100
 * @param {Object} interceptor - unit
 * @param {Object} target - unit
 * @returns {{ targetLoss: number, interceptorLoss: number }}
 */
function computeInterceptionLosses(interdictionScore, interceptor, target) {
  const tProfile = target.airProfile || {};

  // Target losses scale with interdiction score
  let targetLoss;
  if (interdictionScore <= 25) targetLoss = 2;        // Harassing — minimal damage
  else if (interdictionScore <= 50) targetLoss = 5;    // Contested — minor losses
  else if (interdictionScore <= 74) targetLoss = 8;    // Serious — notable losses
  else if (interdictionScore <= 89) targetLoss = 12;   // Driven off — moderate losses
  else targetLoss = 18;                                 // Devastating — severe losses

  // Interceptor always takes some risk — air combat is mutual
  let interceptorLoss = Math.max(1, Math.round(targetLoss * 0.3));

  // Defensive armament increases interceptor risk
  if (tProfile.defensiveArmament) {
    interceptorLoss += 2;
  }

  return { targetLoss, interceptorLoss };
}

/**
 * Full interception resolution: find interceptors, resolve catch, escort,
 * interdiction, and losses. Returns a complete interception result for
 * the LLM to narrate.
 *
 * @param {Object} missionUnit - the air unit on a mission (CAS, interdiction, etc.)
 * @param {string} missionHex - target hex of the mission
 * @param {Array} allUnits - all game units
 * @param {Object} allOrders - { actorId: { unitId: orders } }
 * @param {number} fortuneRoll - 1-6 fortune roll
 * @returns {Object|null} interception result, or null if no interception
 */
export function resolveInterception(missionUnit, missionHex, allUnits, allOrders, fortuneRoll = 3) {
  const mCenter = parsePosition(missionHex);
  if (!mCenter) return null;

  const sectorRadius = 3; // CAP/AIR_SUPERIORITY patrol radius for interception

  // Find enemy interceptors: air units on AIR_SUPERIORITY or CAP orders within sector
  const interceptors = [];
  for (const u of allUnits) {
    if (u.actor === missionUnit.actor) continue;
    if (!isAirUnit(u)) continue;
    const uPos = parsePosition(u.position);
    if (!uPos) continue;
    const dist = hexDistance(mCenter.col, mCenter.row, uPos.col, uPos.row);
    if (dist > sectorRadius) continue;

    const unitOrders = allOrders[u.actor]?.[u.id];
    const actionType = unitOrders?.actionOrder?.type;
    if (!AIR_COMBAT_ORDERS.has(actionType)) continue;

    interceptors.push({ unit: u, distance: dist });
  }

  if (interceptors.length === 0) return null;

  // Use the closest interceptor (most likely to catch)
  interceptors.sort((a, b) => a.distance - b.distance);
  const interceptor = interceptors[0];

  // Phase 1: Catch
  const catchResult = computeCatch(interceptor.unit, missionUnit, interceptor.distance, sectorRadius, fortuneRoll);

  if (!catchResult.caught) {
    return {
      interceptorName: interceptor.unit.name,
      interceptorId: interceptor.unit.id,
      targetName: missionUnit.name,
      targetId: missionUnit.id,
      caught: false,
      catchProbability: catchResult.catchProbability,
      catchFactors: catchResult.factors,
      summary: `${interceptor.unit.name} attempted to intercept ${missionUnit.name} but failed to achieve contact (${catchResult.catchProbability}% catch probability). Mission continues unopposed.`,
    };
  }

  // Check for escort
  let escortResult = null;
  const escortUnit = findEscortForUnit(missionUnit, allUnits, allOrders);
  if (escortUnit) {
    escortResult = resolveEscortEngagement(escortUnit, interceptor.unit, fortuneRoll);

    if (escortResult.result === "ESCORT_DRIVES_OFF") {
      return {
        interceptorName: interceptor.unit.name,
        interceptorId: interceptor.unit.id,
        targetName: missionUnit.name,
        targetId: missionUnit.id,
        caught: true,
        catchProbability: catchResult.catchProbability,
        catchFactors: catchResult.factors,
        escortName: escortUnit.name,
        escortId: escortUnit.id,
        escort: escortResult,
        interdiction: null,
        summary: `${interceptor.unit.name} intercepted ${missionUnit.name} but was driven off by escort ${escortUnit.name}. Mission continues unimpeded. Escort lost ~${escortResult.escortDamage}% strength, interceptor lost ~${escortResult.interceptorDamage}% strength.`,
      };
    }
  }

  // Phase 2: Interdiction Score
  const interdiction = computeInterdictionScore(interceptor.unit, missionUnit, fortuneRoll);

  // Compute losses
  const losses = computeInterceptionLosses(interdiction.score, interceptor.unit, missionUnit);

  // If escort was mutual engagement, reduce interdiction effectiveness
  if (escortResult?.result === "MUTUAL_ENGAGEMENT") {
    interdiction.score = Math.max(1, Math.round(interdiction.score * 0.7));
    // Re-determine band after adjustment
    for (const b of INTERDICTION_BANDS) {
      if (interdiction.score <= b.max) { interdiction.band = b; break; }
    }
    losses.targetLoss = Math.max(1, Math.round(losses.targetLoss * 0.7));
    interdiction.factors.push("Escort reduced interdiction effectiveness (-30%)");
  }

  const bandLabel = interdiction.band.label.replace(/_/g, " ").toLowerCase();
  const missionCancelled = interdiction.band.cancelled;

  return {
    interceptorName: interceptor.unit.name,
    interceptorId: interceptor.unit.id,
    targetName: missionUnit.name,
    targetId: missionUnit.id,
    caught: true,
    catchProbability: catchResult.catchProbability,
    catchFactors: catchResult.factors,
    ...(escortUnit && {
      escortName: escortUnit.name,
      escortId: escortUnit.id,
      escort: escortResult,
    }),
    interdiction: {
      score: interdiction.score,
      band: interdiction.band.label,
      effectivenessReduction: interdiction.band.effectivenessReduction,
      missionCancelled,
      factors: interdiction.factors,
    },
    losses: {
      targetLoss: losses.targetLoss,
      interceptorLoss: losses.interceptorLoss,
    },
    summary: `${interceptor.unit.name} intercepted ${missionUnit.name} (${catchResult.catchProbability}% catch). ${escortResult ? `Escort ${escortUnit.name}: ${escortResult.detail}. ` : ""}Interdiction score: ${interdiction.score} (${bandLabel}). ${missionCancelled ? "Mission cancelled." : `Mission effectiveness reduced by ${Math.round(interdiction.band.effectivenessReduction * 100)}%.`} Target lost ~${losses.targetLoss}% strength, interceptor lost ~${losses.interceptorLoss}% strength.`,
  };
}

/**
 * Find the escort unit assigned to protect a mission unit.
 * Checks all friendly air units for ESCORT orders targeting this unit.
 *
 * @param {Object} missionUnit - the unit being escorted
 * @param {Array} allUnits - all game units
 * @param {Object} allOrders - { actorId: { unitId: orders } }
 * @returns {Object|null} the escort unit, or null
 */
function findEscortForUnit(missionUnit, allUnits, allOrders) {
  for (const u of allUnits) {
    if (u.actor !== missionUnit.actor) continue;
    if (!isAirUnit(u)) continue;
    if (u.id === missionUnit.id) continue;

    const unitOrders = allOrders[u.actor]?.[u.id];
    if (unitOrders?.actionOrder?.type !== "ESCORT") continue;
    if (unitOrders?.actionOrder?.targetUnit !== missionUnit.id) continue;

    return u;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 11. FLIGHT PLANNING & WAYPOINTS
// ═══════════════════════════════════════════════════════════════

// Fuel consumption per hex by speed tier (abstract units per hex traversed)
const FUEL_PER_HEX = { slow: 4, medium: 3, fast: 2, supersonic: 2 };

// On-station fuel burn rate per turn (abstract units while loitering in AO)
const ON_STATION_FUEL_RATE = 10;

/**
 * Build a flight plan for an air mission. If the player provided waypoints,
 * use them. Otherwise, generate a default direct path (base → AO → base).
 *
 * @param {Object} unit - air unit with baseHex and airProfile
 * @param {Object} actionOrder - { type, targetHex, altitude, waypoints }
 * @returns {{ outbound: Array<{hex,altitude}>, onStation: {hex,altitude}, inbound: Array<{hex,altitude}>,
 *             totalHexes: number, roundTrip: boolean }}
 */
export function buildFlightPlan(unit, actionOrder) {
  const baseHex = unit.baseHex || unit.position;
  const targetHex = actionOrder?.targetHex || unit.position;
  const altitude = actionOrder?.altitude || "MEDIUM";
  const waypoints = actionOrder?.waypoints || [];

  if (waypoints.length > 0) {
    // Player-defined waypoints: build outbound from waypoints, inbound = reverse
    const outbound = waypoints.map(wp => ({
      hex: wp.hex || wp,
      altitude: (wp.altitude || altitude).toUpperCase(),
    }));
    // Add target hex at mission altitude if not already the last waypoint
    const lastWp = outbound[outbound.length - 1];
    if (lastWp?.hex !== targetHex) {
      outbound.push({ hex: targetHex, altitude: altitude.toUpperCase() });
    }

    // Inbound = reverse of outbound (same waypoints, return journey)
    const inbound = [...outbound].reverse();

    // Count total hexes traversed
    let totalHexes = 0;
    const allPoints = [{ hex: baseHex }, ...outbound, ...inbound, { hex: baseHex }];
    for (let i = 1; i < allPoints.length; i++) {
      const from = parsePosition(allPoints[i - 1].hex);
      const to = parsePosition(allPoints[i].hex);
      if (from && to) totalHexes += hexDistance(from.col, from.row, to.col, to.row);
    }

    return {
      outbound,
      onStation: { hex: targetHex, altitude: altitude.toUpperCase() },
      inbound,
      totalHexes,
      roundTrip: true,
    };
  }

  // Default direct path: base → target at mission altitude → base
  const from = parsePosition(baseHex);
  const to = parsePosition(targetHex);
  const directDist = (from && to) ? hexDistance(from.col, from.row, to.col, to.row) : 0;

  return {
    outbound: [{ hex: targetHex, altitude: altitude.toUpperCase() }],
    onStation: { hex: targetHex, altitude: altitude.toUpperCase() },
    inbound: [{ hex: baseHex, altitude: altitude.toUpperCase() }],
    totalHexes: directDist * 2, // Round trip
    roundTrip: true,
  };
}

/**
 * Compute fuel consumption for a complete flight plan.
 * Returns fuel needed for the round trip and available on-station time.
 *
 * @param {Object} flightPlan - from buildFlightPlan()
 * @param {string} speed - aircraft speed tier
 * @param {number} totalFuel - available fuel (0-100)
 * @returns {{ transitFuel: number, onStationFuel: number, onStationTurns: number,
 *             feasible: boolean, fuelRemaining: number }}
 */
export function computeFlightPlanFuel(flightPlan, speed, totalFuel = 100) {
  const fuelPerHex = FUEL_PER_HEX[speed] || 3;
  const transitFuel = flightPlan.totalHexes * fuelPerHex;

  // Fuel available for on-station operations after transit
  const onStationFuel = Math.max(0, totalFuel - transitFuel);
  const onStationTurns = ON_STATION_FUEL_RATE > 0 ? Math.floor(onStationFuel / ON_STATION_FUEL_RATE) : 0;

  return {
    transitFuel,
    onStationFuel,
    onStationTurns,
    feasible: transitFuel <= totalFuel,
    fuelRemaining: Math.max(0, totalFuel - transitFuel - ON_STATION_FUEL_RATE),
  };
}

/**
 * Compute off-map transit penalties for aircraft based at off-screen airports.
 * Reduces available sorties/fuel/on-station time proportional to transit distance.
 *
 * @param {string} transitDistance - "near" (~25km), "medium" (~100km), "far" (~250km)
 * @param {number} cellSizeKm - hex size in km
 * @returns {{ transitHexes: number, fuelPenalty: number, sortiePenalty: number }}
 */
export function computeOffMapTransit(transitDistance, cellSizeKm = 5) {
  const distanceKm = { near: 25, medium: 100, far: 250 };
  const km = distanceKm[transitDistance] || 100;
  const transitHexes = Math.ceil(km / cellSizeKm);

  return {
    transitHexes,
    // Fuel penalty as percentage of total fuel used for transit (round trip)
    fuelPenalty: Math.min(50, Math.round((transitHexes * 2 * 3) / 100 * 100)), // ~3 fuel/hex avg
    // Sortie penalty: off-map transit takes time, reducing available sorties
    sortiePenalty: transitDistance === "far" ? 2 : transitDistance === "medium" ? 1 : 0,
  };
}

/**
 * Validate a flight plan against fuel range and produce a complete assessment.
 * Combines flight plan, AD threat, and fuel computation into one result.
 *
 * @param {Object} unit - air unit
 * @param {Object} actionOrder - action order with targetHex, altitude, waypoints
 * @param {Array} enemyADUnits - from findADUnits()
 * @param {Array} allUnits - all game units
 * @returns {Object} complete flight plan assessment
 */
export function assessFlightPlan(unit, actionOrder, enemyADUnits, allUnits) {
  const airProfile = unit.airProfile || {};
  const speed = airProfile.speed || "medium";

  // Build the flight plan
  const plan = buildFlightPlan(unit, actionOrder);

  // Compute fuel
  const fuel = computeFlightPlanFuel(plan, speed, unit.fuel ?? 100);

  // Build waypoint list with altitude for AD threat computation
  const allWaypoints = [
    ...plan.outbound,
    plan.onStation,
    ...plan.inbound,
  ];

  // Compute AD threat along the full route
  const adThreat = computeFlightPathADThreat(allWaypoints, speed, enemyADUnits, allUnits, unit.actor);

  // Determine overall feasibility
  let feasibility = "FEASIBLE";
  if (!fuel.feasible) feasibility = "IMPOSSIBLE"; // Not enough fuel for round trip
  else if (adThreat.aggregateLevel >= 4) feasibility = "HIGH_RISK";
  else if (adThreat.aggregateLevel >= 3) feasibility = "RISKY";

  return {
    flightPlan: plan,
    fuel,
    adThreat: {
      segments: adThreat.segments,
      aggregate: adThreat.aggregateThreat,
    },
    feasibility,
    summary: `${plan.totalHexes} hex round trip, transit fuel cost ${fuel.transitFuel} of ${100}, on-station ${fuel.onStationTurns} turn(s), AD threat ${adThreat.aggregateThreat}. ${feasibility === "IMPOSSIBLE" ? "FUEL INSUFFICIENT — mission cannot complete round trip." : ""}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// 12. BUILD ORDER BUNDLE (renamed from 10 after air sections added)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the complete pre-computed data bundle for a single unit's orders.
 * Main entry point — assembles all computed data the LLM needs.
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

    // Air-specific fields (include if present)
    ...(unit.readiness !== undefined && { readiness: unit.readiness }),
    ...(unit.munitions !== undefined && { munitions: unit.munitions }),
    ...(unit.sorties !== undefined && { sorties: unit.sorties }),
    ...(unit.baseHex && { baseHex: unit.baseHex }),
    ...(unit.forcedRTB && { forcedRTB: true }),

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

  // === DISEMBARK handling ===
  // Embarked unit disembarking: position becomes the transport's destination (or current pos)
  if (orders.movementOrder?.type === "DISEMBARK" && unit.embarkedIn) {
    const transport = allUnits.find(u => u.id === unit.embarkedIn);
    if (transport) {
      // Find the transport's orders to determine where it's going
      const transportOrders = gameState._pendingOrders?.[transport.actor]?.[transport.id];
      const transportDest = transportOrders?.movementOrder?.targetHex || transport.position;
      const destLabel = positionToLabel(transportDest);
      bundle.movement = {
        path: [destLabel],
        pathTerrain: [],
        distanceHexes: 0,
        distanceKm: 0,
        totalCost: 0,
        budget: 0,
        feasibility: "FEASIBLE",
        roadOnPath: false,
        bridgeAvailable: false,
        riverCrossings: 0,
        elevationChange: { net: 0, maxGain: 0, maxLoss: 0 },
        isDisembark: true,
        transportName: transport.name,
        transportDestination: destLabel,
      };
      bundle.movementOrder = { type: "DISEMBARK", targetHex: transportDest };
    }
  }

  // Determine the "effective position" — where the unit WILL be after movement
  const effectivePos = orders.movementOrder?.type === "DISEMBARK"
    ? (bundle.movement?.transportDestination || unit.position)
    : (orders.movementOrder?.targetHex || unit.position);

  // === Movement computation (skip for embarked units and DISEMBARK) ===
  if (orders.movementOrder?.targetHex && orders.movementOrder?.type !== "DISEMBARK") {
    // Skip movement computation for embarked units without DISEMBARK — they're passive cargo
    if (!unit.embarkedIn) {
      bundle.movement = computeMovePath(
        unit.position,
        orders.movementOrder.targetHex,
        terrainData,
        unit.movementType || "foot",
        orders.movementOrder.waypoints
      );
    }
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

  // === Air context computation (air units with air mission orders) ===
  const actionType = orders.actionOrder?.type;
  if (isAirUnit(unit) && actionType && AIR_MISSION_ORDERS.has(actionType)) {
    const airProfile = unit.airProfile || {};
    const speed = airProfile.speed || "medium";
    const altitude = orders.actionOrder?.altitude || (isHelicopter(unit) ? "LOW" : "MEDIUM");
    const targetHex = orders.actionOrder?.targetHex || unit.position;
    const sectorRadius = 2; // Standard CAS/ASL sector radius

    // Find enemy AD units (excluding this unit's actor)
    const enemyAD = findADUnits(allUnits, { excludeActorId: unit.actor });

    // AD threat at the target/mission area
    const adThreat = computeADThreatAtHex(targetHex, altitude, speed, enemyAD, allUnits, unit.actor);

    // Air superiority level in the sector
    const pendingOrders = gameState._pendingOrders || {};
    const asl = computeAirSuperiority(targetHex, sectorRadius, allUnits, unit.actor, pendingOrders);

    const airContext = {
      altitude,
      speed,
      airProfile,
      adThreat: {
        threat: adThreat.threat,
        threatLevel: adThreat.threatLevel,
        sources: adThreat.adSources,
      },
      airSuperiority: {
        asl: asl.asl,
        ratio: asl.ratio,
        detail: asl.detail,
      },
    };

    // CAS-specific: identify targets and compute effectiveness
    if (actionType === "CAS") {
      const weather = gameState.environment?.weather || "clear";
      const era = gameState.scenario?.eraSelections?.[unit.actor] || "modern";
      airContext.casTargets = computeCASTargets(targetHex, sectorRadius, allUnits, unit.actor, pendingOrders, terrainData);
      airContext.casEffectiveness = computeCASEffectiveness(unit, asl.asl, altitude, adThreat.threatLevel, weather, era);
    }

    // SEAD-specific: identify the target AD unit
    if (actionType === "SEAD" && orders.actionOrder?.targetUnit) {
      const targetAD = allUnits.find(u => u.id === orders.actionOrder.targetUnit);
      if (targetAD) {
        const targetCaps = targetAD.specialCapabilities || [];
        airContext.seadTarget = {
          unit: targetAD.name,
          adTypes: targetCaps.filter(c => c in AD_RANGES),
          strength: targetAD.strength,
          vulnerableToHARM: targetCaps.includes("radar_missile_ad"),
        };
      }
    }

    // AIR_SUPERIORITY / CAP: show enemy air assets in sector
    if (actionType === "AIR_SUPERIORITY" || actionType === "CAP") {
      const enemyAir = allUnits.filter(u => {
        if (u.actor === unit.actor || !isAirUnit(u)) return false;
        const uPos = parsePosition(u.position);
        if (!uPos) return false;
        const center = parsePosition(targetHex);
        if (!center) return false;
        return hexDistance(center.col, center.row, uPos.col, uPos.row) <= sectorRadius;
      });
      airContext.enemyAirInSector = enemyAir.map(u => ({
        unit: u.name,
        type: u.type,
        strength: u.strength,
        speed: u.airProfile?.speed || "unknown",
        maneuverability: u.airProfile?.maneuverability || 0,
      }));
    }

    // Flight plan assessment (AD threat along route, fuel feasibility)
    const flightAssessment = assessFlightPlan(unit, orders.actionOrder, enemyAD, allUnits);
    airContext.flightPlan = {
      totalHexes: flightAssessment.flightPlan.totalHexes,
      feasibility: flightAssessment.feasibility,
      fuel: flightAssessment.fuel,
      routeAdThreat: flightAssessment.adThreat.aggregate,
      summary: flightAssessment.summary,
    };

    // Interception resolution for interceptable missions
    if (INTERCEPTABLE_ORDERS.has(actionType)) {
      const interceptionResult = resolveInterception(unit, targetHex, allUnits, pendingOrders, fortuneRoll?.roll ?? 3);
      if (interceptionResult) {
        airContext.interception = interceptionResult;
      }
    }

    bundle.airContext = airContext;
  }

  return bundle;
}

// ═══════════════════════════════════════════════════════════════
// 12. BUILD ALL BUNDLES
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
  // Merge terrain modifications (bridges, smoke, obstacles, etc.) into effective terrain
  const effectiveTerrain = buildEffectiveTerrain(terrainData, gameState.terrainMods);
  const bundles = [];

  for (const unit of gameState.units) {
    const actorOrders = allOrders[unit.actor];
    const unitOrders = actorOrders?.[unit.id] || { movementOrder: null, actionOrder: null, intent: "" };

    // Skip units with no orders (they default to HOLD)
    const hasOrders = unitOrders.movementOrder || unitOrders.actionOrder;

    const fortune = unitFortuneRolls[unit.id] || null;
    const friction = unitFrictionEvents[unit.id] || null;

    // Stash all orders on gameState so DISEMBARK can look up transport's destination
    if (!gameState._pendingOrders) gameState._pendingOrders = allOrders;

    const bundle = buildOrderBundle(unit, unitOrders, gameState, effectiveTerrain, fortune, friction);
    bundle.isHold = !hasOrders;

    // Annotate transport units with their cargo manifest
    const cargo = unit.cargo || [];
    if (cargo.length > 0) {
      const cargoUnits = cargo.map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
      bundle.cargoManifest = cargoUnits.map(u => ({ id: u.id, name: u.name, type: u.type }));
      bundle.transportCapacity = unit.transportCapacity || 0;
    }

    // Mark embarked units (so prompt formatting can handle them)
    if (unit.embarkedIn) {
      const transport = gameState.units.find(u => u.id === unit.embarkedIn);
      bundle.embarkedIn = transport ? transport.name : unit.embarkedIn;
    }

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

  // Second pass: annotate coordinated attacks and movement congestion.
  const attackGroups = {};
  const movementCounts = {};
  for (const bundle of bundles) {
    const targetHex = bundle.actionOrder?.targetHex || null;
    if (targetHex && bundle.actor && bundle.actionOrder?.type && ["ATTACK", "SUPPORT_FIRE", "FIRE_MISSION", "SHORE_BOMBARDMENT", "CAS"].includes(bundle.actionOrder.type)) {
      const key = `${bundle.actor}:${targetHex}`;
      if (!attackGroups[key]) attackGroups[key] = [];
      attackGroups[key].push(bundle);
    }
    const moveTarget = bundle.movementOrder?.targetHex || null;
    if (moveTarget) {
      movementCounts[moveTarget] = (movementCounts[moveTarget] || 0) + 1;
    }
  }

  for (const bundle of bundles) {
    const targetHex = bundle.actionOrder?.targetHex || null;
    if (targetHex && bundle.actor) {
      const groupKey = `${bundle.actor}:${targetHex}`;
      const group = attackGroups[groupKey] || [];
      if (group.length > 1) {
        const teammates = group
          .filter(other => other.unitId !== bundle.unitId)
          .map(other => ({ unitId: other.unitId, unitName: other.unitName, orderType: other.actionOrder?.type || null }));
        if (!bundle.combat) bundle.combat = {};
        bundle.combat.coAttackers = teammates;
        bundle.combat.coordinationBonus = `${group.length} units converging on ${positionToLabel(targetHex)}`;
      }
    }

    const moveTarget = bundle.movementOrder?.targetHex || null;
    if (moveTarget && bundle.movement) {
      const count = movementCounts[moveTarget] || 0;
      const cell = effectiveTerrain.cells?.[moveTarget];
      const bridgeish = !!(cell?.features || []).some(f => f === "bridge" || f === "dam" || f === "river_crossing");
      if (count > 1 || bridgeish) {
        bundle.movement.congestion = {
          unitsSharingDestination: count,
          bottleneck: bridgeish,
        };
      }
    }
  }

  // Clean up temp stash
  delete gameState._pendingOrders;

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
