// ═══════════════════════════════════════════════════════════════
// AIR LOGISTICS — Readiness, fuel, sortie generation, and basing
// Post-adjudication state updates for air units.
// ═══════════════════════════════════════════════════════════════

import { parseTurnDuration } from "./schemas.js";
import { isAirUnit } from "./orderTypes.js";

// ── Readiness costs per mission type ──
// Each sortie/mission costs this much readiness (out of 100).
const READINESS_COST = {
  CAS: 10,
  AIR_SUPERIORITY: 5,
  SEAD: 15,
  STRATEGIC_STRIKE: 10,
  INTERDICTION: 10,
  ESCORT: 5,
  CAP: 5,
  AIR_RECON: 5,
  AIRLIFT: 5,
};

// Readiness recovery rates per turn (depends on airfield availability)
const READINESS_RECOVERY = {
  functional_airfield: 15,
  damaged_airfield: 5,
  no_airfield: 0,
  rest_sortie_bonus: 5, // Per unused sortie
};

// Fuel consumption per turn for persistent aircraft (tier 3 helicopters)
const FUEL_PER_TURN = 30; // ~3 turns of operations

// Fuel penalty for combat maneuvers on top of base consumption
const FUEL_COMBAT_PENALTY = 5;

// Munitions consumption per strike mission
const MUNITIONS_PER_STRIKE = {
  CAS: 20,
  INTERDICTION: 15,
  STRATEGIC_STRIKE: 25,
  SEAD: 20,
};

// Turn duration multipliers for sortie computation
// Longer turns = more sortie cycles possible
function getTurnDurationMultiplier(turnDurationMs) {
  if (!turnDurationMs || isNaN(turnDurationMs)) return 1;
  const hours = turnDurationMs / (1000 * 60 * 60);
  if (hours <= 4) return 1;
  if (hours <= 12) return 1;
  if (hours <= 24) return 2;
  if (hours <= 48) return 3;
  if (hours <= 168) return 7; // 1 week
  return Math.floor(hours / 24); // Beyond 1 week: 1 sortie cycle per day
}

/**
 * Compute available sorties for an air unit this turn (tier 4+).
 * Formula: floor(readiness / 20) × turnDurationMultiplier × airfieldModifier
 *
 * @param {Object} unit - air unit with readiness field
 * @param {number} turnDurationMs - turn duration in milliseconds
 * @param {string} airfieldStatus - "functional", "damaged", or "none"
 * @returns {number} available sorties
 */
export function computeSorties(unit, turnDurationMs, airfieldStatus = "functional") {
  const readiness = unit.readiness ?? 100;
  const baseSorties = Math.floor(readiness / 20);
  const multiplier = getTurnDurationMultiplier(turnDurationMs);
  const airfieldMod = airfieldStatus === "damaged" ? 0.5 : airfieldStatus === "none" ? 0 : 1;
  return Math.max(0, Math.floor(baseSorties * multiplier * airfieldMod));
}

/**
 * Compute fuel consumption for a persistent aircraft this turn.
 * Includes base consumption + combat penalty if on a combat mission.
 *
 * @param {Object} unit - air unit with fuel field
 * @param {string|null} missionType - action order type, or null if resting
 * @returns {number} fuel consumed this turn
 */
export function computeFuelConsumption(unit, missionType) {
  let consumption = FUEL_PER_TURN;
  if (missionType && missionType !== "HOLD") {
    consumption += FUEL_COMBAT_PENALTY;
  }
  return consumption;
}

/**
 * Compute bingo fuel — minimum fuel to return to nearest airfield.
 * Simplified: 1 turn of consumption as reserve (enough to fly back).
 * The actual waypoint-based distance computation is in Phase 6.
 *
 * @param {Object} unit - air unit with fuel field
 * @returns {number} bingo fuel threshold
 */
export function computeBingoFuel(unit) {
  return FUEL_PER_TURN; // Reserve = 1 turn of base consumption
}

/**
 * Check if a unit is at bingo fuel (must RTB next turn).
 *
 * @param {Object} unit - air unit
 * @returns {{ atBingo: boolean, warning: boolean, fuelRemaining: number }}
 */
export function checkBingoStatus(unit) {
  const fuel = unit.fuel ?? 100;
  const bingo = computeBingoFuel(unit);
  const oneTurnBuffer = bingo + FUEL_PER_TURN;

  return {
    atBingo: fuel <= bingo,
    warning: fuel <= oneTurnBuffer && fuel > bingo,
    fuelRemaining: fuel,
    bingoFuel: bingo,
  };
}

/**
 * Apply per-turn air logistics updates to all units.
 * Called during advanceTurn() after supply processing.
 *
 * Handles:
 * - Readiness recovery for air units at airfields
 * - Fuel consumption for persistent air units (tier 3 helicopters)
 * - Munitions replenishment at airfields
 * - Sortie regeneration (tier 4+)
 *
 * @param {Array} units - all game units
 * @param {number} scaleTier - current scale tier
 * @param {string} turnDuration - turn duration string (e.g., "4 hours")
 * @param {Object} allOrders - orders from this turn (to determine mission costs)
 * @returns {Array} updated units
 */
export function applyAirTurnUpdates(units, scaleTier, turnDuration, allOrders = {}) {
  if (scaleTier < 2) return units; // Helicopters at tier 2+, fixed-wing at tier 3+

  const turnMs = parseTurnDuration(turnDuration);

  return units.map(u => {
    if (!isAirUnit(u)) return u;
    if (u.status === "destroyed" || u.status === "eliminated") return u;

    const changes = {};
    const unitOrders = allOrders[u.actor]?.[u.id];
    const missionType = unitOrders?.actionOrder?.type || null;

    // ── Readiness updates ──
    if (u.readiness !== undefined) {
      let readiness = u.readiness;

      // Mission cost (already applied during adjudication, but verify floor)
      // The LLM may have adjusted readiness via state_updates — we trust that.
      // Here we apply recovery.

      // Recovery: based on airfield status
      // Simplified: if unit has a baseHex, assume functional airfield
      const atAirfield = !!u.baseHex;
      const recovery = atAirfield ? READINESS_RECOVERY.functional_airfield : READINESS_RECOVERY.no_airfield;
      readiness = Math.min(100, readiness + recovery);

      if (readiness !== u.readiness) {
        changes.readiness = readiness;
      }
    }

    // ── Fuel updates (persistent aircraft — helicopters at any tier, fixed-wing at tier 3) ──
    if (u.fuel !== undefined) {
      const consumption = computeFuelConsumption(u, missionType);
      const newFuel = Math.max(0, u.fuel - consumption);
      if (newFuel !== u.fuel) {
        changes.fuel = newFuel;
      }
    }

    // ── Munitions replenishment ──
    // Mission consumption is handled by the LLM via state_updates during adjudication.
    // Here we only handle replenishment at airfield between turns.
    if (u.munitions !== undefined) {
      const atAirfieldForMunitions = !!u.baseHex;
      if (atAirfieldForMunitions && u.munitions < 100) {
        const newMunitions = Math.min(100, u.munitions + 25); // 25% replenishment per turn
        if (newMunitions !== u.munitions) {
          changes.munitions = newMunitions;
        }
      }
    }

    // ── Sortie regeneration (tier 4+) ──
    if (u.sorties !== undefined && scaleTier >= 4) {
      const airfieldStatus = u.baseHex ? "functional" : "none";
      const newSorties = computeSorties(u, turnMs, airfieldStatus);
      if (newSorties !== u.sorties) {
        changes.sorties = newSorties;
      }
    }

    // ── Bingo fuel check — force RTB status ──
    // If fuel is at or below bingo threshold after consumption,
    // mark the unit so the LLM and UI know it must return to base.
    const postFuel = changes.fuel ?? u.fuel;
    if (postFuel !== undefined) {
      const bingoThreshold = computeBingoFuel(u);
      if (postFuel <= bingoThreshold && !u.forcedRTB) {
        changes.forcedRTB = true;
      } else if (postFuel > bingoThreshold && u.forcedRTB) {
        changes.forcedRTB = false; // Refueled — clear the flag
      }
    }

    // Return updated unit if anything changed
    if (Object.keys(changes).length === 0) return u;
    return { ...u, ...changes };
  });
}

/**
 * Apply readiness cost for a completed mission.
 * Called during state update processing (post-adjudication).
 *
 * @param {Object} unit - air unit
 * @param {string} missionType - the mission that was flown
 * @param {number} strengthLoss - percentage strength lost during mission (0-100)
 * @returns {{ readiness: number }} updated readiness value
 */
export function applyMissionReadinessCost(unit, missionType, strengthLoss = 0) {
  const readiness = unit.readiness ?? 100;
  const missionCost = READINESS_COST[missionType] || 5;
  // Combat damage adds proportional readiness loss
  const damageCost = Math.round(strengthLoss * 0.5);
  const newReadiness = Math.max(0, readiness - missionCost - damageCost);
  return { readiness: newReadiness };
}

/**
 * Get airfield capacity information for a hex.
 * Checks terrain features for airfield types.
 *
 * @param {string} hexPos - hex position to check
 * @param {Object} terrainData - terrain grid data
 * @returns {{ isAirfield: boolean, capacity: number, type: string }}
 */
export function getAirfieldInfo(hexPos, terrainData) {
  if (!terrainData?.cells) return { isAirfield: false, capacity: 0, type: "none" };

  // Parse position to cell key
  const pos = hexPos?.includes(",") ? hexPos : null;
  if (!pos) return { isAirfield: false, capacity: 0, type: "none" };

  const cell = terrainData.cells[pos];
  if (!cell) return { isAirfield: false, capacity: 0, type: "none" };

  const features = cell.features || [];
  const featureNames = cell.feature_names || [];

  // Check for airfield-related features.
  // Parser normalizes OSM aeroway tags → "airfield" or "helipad" feature strings.
  if (features.includes("airfield")) {
    // Determine type from feature names (e.g., "Ramstein Air Base", "Heathrow Airport")
    const name = (featureNames.join(" ") || "").toLowerCase();
    if (name.includes("international") || name.includes("airport")) {
      return { isAirfield: true, capacity: 10, type: "international_airport" };
    }
    if (name.includes("air force") || name.includes("air base") || name.includes("afb")) {
      return { isAirfield: true, capacity: 8, type: "major_airbase" };
    }
    return { isAirfield: true, capacity: 4, type: "regional_airfield" };
  }

  // Helipad / FARP
  if (features.includes("helipad")) {
    return { isAirfield: true, capacity: 2, type: "farp" };
  }

  return { isAirfield: false, capacity: 0, type: "none" };
}

/**
 * Count how many air units are based at a given airfield hex.
 *
 * @param {string} airfieldHex - the airfield position
 * @param {Array} allUnits - all game units
 * @returns {number} count of air units based there
 */
export function countUnitsAtAirfield(airfieldHex, allUnits) {
  return allUnits.filter(u => isAirUnit(u) && u.baseHex === airfieldHex).length;
}

/**
 * Validate whether an airfield can accept another air unit (capacity check).
 *
 * @param {string} airfieldHex - airfield position
 * @param {Object} terrainData - terrain data
 * @param {Array} allUnits - all units
 * @returns {{ canBase: boolean, currentOccupancy: number, capacity: number, type: string }}
 */
export function validateAirfieldCapacity(airfieldHex, terrainData, allUnits) {
  const info = getAirfieldInfo(airfieldHex, terrainData);
  if (!info.isAirfield) {
    return { canBase: false, currentOccupancy: 0, capacity: 0, type: "none" };
  }
  const occupancy = countUnitsAtAirfield(airfieldHex, allUnits);
  return {
    canBase: occupancy < info.capacity,
    currentOccupancy: occupancy,
    capacity: info.capacity,
    type: info.type,
  };
}
