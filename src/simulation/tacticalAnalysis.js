// ═══════════════════════════════════════════════════════════════
// TACTICAL ANALYSIS — Pre-computed situational awareness for AI.
// Run once per turn before AI order generation. Produces:
//   - Force projection heatmap (internal)
//   - Sector force balance (LEFT/CENTER/RIGHT)
//   - Frontline + gap detection
//   - Unit vulnerability assessment
//   - Recon confidence layer
//
// All computations respect FOW: only IDENTIFIED/CONTACT enemies
// contribute. UNDETECTED enemies are invisible.
// ═══════════════════════════════════════════════════════════════

import { hexDistance } from "../mapRenderer/HexMath.js";
import { WEAPON_RANGE_KM, MOVEMENT_BUDGETS, TERRAIN_COSTS } from "./orderTypes.js";
import { OBSERVER_VISUAL_KM, DEFAULT_OBSERVER_VISUAL_KM, WEATHER_RANGE_MOD, TIME_RANGE_MOD } from "./detectionRanges.js";

/**
 * Parse a position value into { col, row }. Handles both "col,row" strings
 * (e.g. "7,3") and object format ({ col, row }). Returns null if invalid.
 */
function parsePos(pos) {
  if (!pos) return null;
  if (typeof pos === "object" && pos.col !== undefined) return pos;
  const m = String(pos).match(/^(\d+),(\d+)$/);
  if (m) return { col: parseInt(m[1]), row: parseInt(m[2]) };
  return null;
}

// ── Combat Power Constants ──────────────────────────────────
// Base "heat" value per unit type. Multiplied by strength/100.
const COMBAT_POWER = {
  armor:              3.0,
  tank_destroyer:     2.5,
  attack_helicopter:  2.5,
  mechanized:         2.0,
  mech_inf:           2.0,
  mechanized_infantry:2.0,
  armored_infantry:   2.0,
  infantry:           1.5,
  parachute_infantry: 1.5,
  glider_infantry:    1.5,
  airborne:           1.5,
  anti_tank:          1.5,
  air_defense:        1.0,
  artillery:          1.0,
  special_forces:     0.5,
  recon:              0.5,
  engineer:           0.8,
  transport:          0.1,
  headquarters:       0.2,
  logistics:          0.2,
  air:                2.0,
  naval:              2.0,
};

// Terrain types that give defensive bonus
const DEFENSIVE_TERRAIN = new Set([
  "forest", "dense_forest", "light_urban", "dense_urban",
  "suburban", "urban_commercial", "urban_industrial", "urban_dense_core",
  "bldg_residential", "bldg_commercial", "bldg_highrise", "bldg_fortified",
  "mountain", "mountain_forest", "jungle", "jungle_hills",
]);

// ── A1: Force Projection Heatmap ─────────────────────────────
// For each hex, compute net friendly vs enemy influence.
// This is internal computation — not shown to AI directly.

/**
 * Compute the force projection heatmap for a given actor.
 * Returns a Map<hexKey, { friendly, enemy, net }>.
 *
 * @param {string} actorId - The actor computing the heatmap
 * @param {Object} gameState - Current game state
 * @param {Object} terrainData - Terrain grid with cells
 * @param {Object} detectionContext - FOW detection data
 */
function computeHeatmap(actorId, gameState, terrainData, detectionContext) {
  const units = gameState.units || [];
  const cols = terrainData?.cols || 12;
  const rows = terrainData?.rows || 15;
  const maxRadius = 6; // max influence radius in hexes

  // Determine which enemies this actor can see (FOW filter)
  const visibleEnemies = new Set();
  if (detectionContext?.actorVisibility?.[actorId]) {
    const vis = detectionContext.actorVisibility[actorId];
    for (const id of (vis.detectedUnits || [])) visibleEnemies.add(id);
    for (const id of (vis.contactUnits || [])) visibleEnemies.add(id);
  } else {
    // No FOW — all enemies visible
    for (const u of units) {
      if (u.actor !== actorId && u.status !== "destroyed" && u.status !== "eliminated") {
        visibleEnemies.add(u.id);
      }
    }
  }

  // Get active units with positions (parse "col,row" strings to {col,row})
  const activeUnits = units
    .filter(u => u.status !== "destroyed" && u.status !== "eliminated" && u.position)
    .map(u => ({ ...u, position: parsePos(u.position) }))
    .filter(u => u.position !== null);

  // Pre-compute combat power for each unit
  const unitPower = new Map();
  for (const u of activeUnits) {
    const type = (u.type || "infantry").toLowerCase();
    const basePower = COMBAT_POWER[type] || 1.0;
    const strengthMod = (u.strength ?? 100) / 100;
    unitPower.set(u.id, basePower * strengthMod);
  }

  // Compute heatmap
  const heatmap = new Map();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hexKey = `${c},${r}`;
      let friendly = 0;
      let enemy = 0;

      // Terrain defensive modifier for units ON this hex
      const cell = terrainData?.cells?.[hexKey];
      const terrain = cell?.terrain || "open_ground";
      const defenseMod = DEFENSIVE_TERRAIN.has(terrain) ? 1.3 : 1.0;

      for (const u of activeUnits) {
        const dist = hexDistance(c, r, u.position.col, u.position.row);
        if (dist > maxRadius) continue;

        const power = unitPower.get(u.id) || 1.0;
        // Inverse distance decay: power / (dist + 1)
        const decayed = power / (dist + 1);
        // Apply terrain bonus only to units at distance 0 (on this hex)
        const adjusted = dist === 0 ? decayed * defenseMod : decayed;

        if (u.actor === actorId) {
          friendly += adjusted;
        } else if (visibleEnemies.has(u.id)) {
          enemy += adjusted;
        }
        // Undetected enemies: invisible (FOW)
      }

      heatmap.set(hexKey, { friendly, enemy, net: friendly - enemy });
    }
  }

  return heatmap;
}


// ── A2: Sector Force Balance ─────────────────────────────────
// Divide map into 3 sectors (LEFT/CENTER/RIGHT by column thirds).

function computeSectors(actorId, gameState, terrainData, heatmap, detectionContext) {
  const units = gameState.units || [];
  const cols = terrainData?.cols || 12;
  const third = Math.ceil(cols / 3);

  // Determine visible enemies (same logic as heatmap)
  const visibleEnemies = new Set();
  if (detectionContext?.actorVisibility?.[actorId]) {
    const vis = detectionContext.actorVisibility[actorId];
    for (const id of (vis.detectedUnits || [])) visibleEnemies.add(id);
    for (const id of (vis.contactUnits || [])) visibleEnemies.add(id);
  } else {
    for (const u of units) {
      if (u.actor !== actorId && u.status !== "destroyed" && u.status !== "eliminated") {
        visibleEnemies.add(u.id);
      }
    }
  }

  const sectors = [
    { name: "LEFT", colStart: 0, colEnd: third },
    { name: "CENTER", colStart: third, colEnd: third * 2 },
    { name: "RIGHT", colStart: third * 2, colEnd: cols },
  ];

  // VP hex data for sector analysis
  const vc = gameState.scenario?.victoryConditions;
  const vpControl = gameState.game?.vpControl || {};

  const result = [];

  for (const sector of sectors) {
    let friendlyCount = 0, friendlyPower = 0;
    let enemyCount = 0, enemyPower = 0;
    const vpHexes = [];

    // Count units in this sector
    for (const u of units) {
      if (u.status === "destroyed" || u.status === "eliminated" || !u.position) continue;
      const uPos = parsePos(u.position);
      if (!uPos || uPos.col < sector.colStart || uPos.col >= sector.colEnd) continue;

      const type = (u.type || "infantry").toLowerCase();
      const power = (COMBAT_POWER[type] || 1.0) * ((u.strength ?? 100) / 100);

      if (u.actor === actorId) {
        friendlyCount++;
        friendlyPower += power;
      } else if (visibleEnemies.has(u.id)) {
        enemyCount++;
        enemyPower += power;
      }
    }

    // VP hexes in this sector
    if (vc?.hexVP) {
      for (const vp of vc.hexVP) {
        const parts = vp.hex.split(",");
        const col = parseInt(parts[0]);
        if (col >= sector.colStart && col < sector.colEnd) {
          vpHexes.push({
            name: vp.name,
            vp: vp.vp,
            controller: vpControl[vp.hex] || null,
          });
        }
      }
    }

    // Force ratio label
    const ratio = enemyPower > 0 ? friendlyPower / enemyPower : (friendlyPower > 0 ? 99 : 0);
    let forceLabel;
    if (ratio >= 3) forceLabel = "OVERWHELMING";
    else if (ratio >= 1.5) forceLabel = "FAVORABLE";
    else if (ratio >= 0.7) forceLabel = "CONTESTED";
    else if (ratio >= 0.3) forceLabel = "UNFAVORABLE";
    else if (enemyPower > 0) forceLabel = "DIRE";
    else forceLabel = "UNCONTESTED";

    // Assessment
    let assessment;
    if (forceLabel === "OVERWHELMING" || forceLabel === "FAVORABLE") {
      assessment = vpHexes.some(v => v.controller !== actorId) ? "ATTACK OPPORTUNITY" : "HOLD";
    } else if (forceLabel === "CONTESTED") {
      assessment = "CONTESTED";
    } else if (forceLabel === "UNFAVORABLE" || forceLabel === "DIRE") {
      assessment = "DEFENSIVE PRIORITY";
    } else {
      assessment = vpHexes.length > 0 ? "FLANKING CORRIDOR" : "UNCONTESTED";
    }

    // Column labels (A-based)
    const startLabel = String.fromCharCode(65 + sector.colStart);
    const endLabel = String.fromCharCode(65 + Math.min(sector.colEnd - 1, 25));

    result.push({
      name: sector.name,
      cols: `${startLabel}-${endLabel}`,
      friendly: { count: friendlyCount, power: Math.round(friendlyPower * 10) / 10 },
      enemy: { count: enemyCount, power: Math.round(enemyPower * 10) / 10 },
      forceLabel,
      vpHexes,
      assessment,
    });
  }

  return result;
}


// ── A3: Frontline + Gap Detection ────────────────────────────
// Find where control changes, identify gaps in defensive coverage.
// Gap definition is DYNAMIC — based on each unit's coverage radius.

function computeGaps(actorId, gameState, terrainData) {
  const units = gameState.units || [];
  const env = gameState.environment || {};
  const cellSizeKm = terrainData?.cellSizeKm || 1;

  // Get friendly maneuver units (not HQ, logistics, artillery)
  const nonCombatTypes = new Set(["headquarters", "logistics", "artillery"]);
  const friendlyUnits = units.filter(u =>
    u.actor === actorId &&
    u.status !== "destroyed" && u.status !== "eliminated" &&
    u.position &&
    !nonCombatTypes.has((u.type || "").toLowerCase())
  );

  if (friendlyUnits.length < 2) return { gaps: [], frontline: [] };

  // Compute effective coverage radius per unit
  // coverage = min(observationRange, movementRange + weaponRange)
  const weatherMod = WEATHER_RANGE_MOD[env.weather] || 1.0;
  const timeMod = TIME_RANGE_MOD[env.timeOfDay] || 1.0;

  const unitCoverage = friendlyUnits.map(u => {
    const type = (u.type || "infantry").toLowerCase();

    // Observation range in hexes
    const obsKm = (OBSERVER_VISUAL_KM[type] || DEFAULT_OBSERVER_VISUAL_KM) * weatherMod * timeMod;
    const obsHex = obsKm / cellSizeKm;

    // Movement range in hexes (approximate — uses base budget, not terrain-weighted)
    const movType = u.movementType || "foot";
    const moveHex = MOVEMENT_BUDGETS[movType] || 3;

    // Weapon range in hexes
    const weaponKm = (WEAPON_RANGE_KM[type] || WEAPON_RANGE_KM.infantry)?.max || 0.8;
    const weaponHex = weaponKm / cellSizeKm;

    // Coverage = min(obs, move + weapon) — capped at 6 to be reasonable
    const coverage = Math.min(obsHex, moveHex + weaponHex, 6);

    return {
      unit: u,
      coverage: Math.round(coverage * 10) / 10,
      position: parsePos(u.position),
    };
  });

  // Sort by column then row to find frontline ordering
  unitCoverage.sort((a, b) =>
    a.position.col - b.position.col || a.position.row - b.position.row
  );

  // Find gaps: check each pair of adjacent frontline units
  const gaps = [];
  for (let i = 0; i < unitCoverage.length - 1; i++) {
    const a = unitCoverage[i];
    const b = unitCoverage[i + 1];
    const dist = hexDistance(
      a.position.col, a.position.row,
      b.position.col, b.position.row
    );

    // Gap exists if the distance exceeds the sum of their coverage radii
    const combinedCoverage = a.coverage + b.coverage;
    if (dist > combinedCoverage) {
      const gapSize = Math.round((dist - combinedCoverage) * 10) / 10;

      // Check if any VP hex is behind this gap
      const vc = gameState.scenario?.victoryConditions;
      let exposedVP = null;
      if (vc?.hexVP) {
        // "Behind" = closer to friendly rear (higher column for left-to-right)
        const midCol = (a.position.col + b.position.col) / 2;
        const midRow = (a.position.row + b.position.row) / 2;
        for (const vp of vc.hexVP) {
          const parts = vp.hex.split(",");
          const vpCol = parseInt(parts[0]);
          const vpRow = parseInt(parts[1]);
          const vpDist = hexDistance(Math.round(midCol), Math.round(midRow), vpCol, vpRow);
          if (vpDist <= 4) {
            exposedVP = vp.name;
            break;
          }
        }
      }

      gaps.push({
        between: [a.unit.name, b.unit.name],
        hexGap: dist,
        gapSize,
        exposedVP,
      });
    }
  }

  // Build frontline description (unit positions in order)
  const frontline = unitCoverage.map(u => {
    let label = "";
    let n = u.position.col;
    do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return `${label}${u.position.row + 1}`;
  });

  return { gaps, frontline };
}


// ── A4: Unit Vulnerability Assessment ────────────────────────
// Per-unit tactical assessment: enemies in range, flank exposure, isolation.

function computeVulnerability(actorId, gameState, terrainData, detectionContext) {
  const units = gameState.units || [];
  const cellSizeKm = terrainData?.cellSizeKm || 1;

  // Visible enemies
  const visibleEnemies = new Set();
  if (detectionContext?.actorVisibility?.[actorId]) {
    const vis = detectionContext.actorVisibility[actorId];
    for (const id of (vis.detectedUnits || [])) visibleEnemies.add(id);
    for (const id of (vis.contactUnits || [])) visibleEnemies.add(id);
  } else {
    for (const u of units) {
      if (u.actor !== actorId && u.status !== "destroyed" && u.status !== "eliminated") {
        visibleEnemies.add(u.id);
      }
    }
  }

  const friendlyUnits = units
    .filter(u => u.actor === actorId && u.status !== "destroyed" && u.status !== "eliminated" && u.position)
    .map(u => ({ ...u, position: parsePos(u.position) }))
    .filter(u => u.position !== null);
  const detectedEnemies = units
    .filter(u => visibleEnemies.has(u.id) && u.position && u.status !== "destroyed" && u.status !== "eliminated")
    .map(u => ({ ...u, position: parsePos(u.position) }))
    .filter(u => u.position !== null);

  const assessments = {};

  for (const u of friendlyUnits) {
    const type = (u.type || "infantry").toLowerCase();
    const myRange = (WEAPON_RANGE_KM[type] || WEAPON_RANGE_KM.infantry)?.max || 0.8;

    let enemiesInRange = 0;  // enemies I can shoot
    let inEnemyRange = 0;    // enemies that can shoot me

    for (const e of detectedEnemies) {
      const dist = hexDistance(u.position.col, u.position.row, e.position.col, e.position.row);
      const distKm = dist * cellSizeKm;

      if (distKm <= myRange) enemiesInRange++;

      const eType = (e.type || "infantry").toLowerCase();
      const eRange = (WEAPON_RANGE_KM[eType] || WEAPON_RANGE_KM.infantry)?.max || 0.8;
      if (distKm <= eRange) inEnemyRange++;
    }

    // Adjacent friendlies (within 2 hexes)
    let adjacentFriendlies = 0;
    for (const f of friendlyUnits) {
      if (f.id === u.id) continue;
      const dist = hexDistance(u.position.col, u.position.row, f.position.col, f.position.row);
      if (dist <= 2) adjacentFriendlies++;
    }

    // Isolation check: no friendlies within 3 hexes AND enemy within 5
    const nearestFriendlyDist = friendlyUnits
      .filter(f => f.id !== u.id)
      .reduce((min, f) => {
        const d = hexDistance(u.position.col, u.position.row, f.position.col, f.position.row);
        return Math.min(min, d);
      }, 99);

    const nearestEnemyDist = detectedEnemies.reduce((min, e) => {
      const d = hexDistance(u.position.col, u.position.row, e.position.col, e.position.row);
      return Math.min(min, d);
    }, 99);

    const isolated = nearestFriendlyDist > 3 && nearestEnemyDist <= 5;

    // Terrain rating
    const hexKey = `${u.position.col},${u.position.row}`;
    const cell = terrainData?.cells?.[hexKey];
    const terrain = cell?.terrain || "open_ground";
    const goodTerrain = DEFENSIVE_TERRAIN.has(terrain);

    // Classification
    let classification;
    if (isolated) classification = "ISOLATED";
    else if (inEnemyRange >= 2 && adjacentFriendlies === 0) classification = "EXPOSED";
    else if (inEnemyRange === 0 && enemiesInRange === 0 && nearestEnemyDist > 5) classification = "IDLE";
    else if (goodTerrain && adjacentFriendlies >= 1) classification = "WELL-POSITIONED";
    else if (inEnemyRange > 0 && adjacentFriendlies < 2) classification = "EXPOSED";
    else classification = "ENGAGED";

    assessments[u.id] = {
      classification,
      enemiesInRange,
      inEnemyRange,
      adjacentFriendlies,
      isolated,
      terrainRating: goodTerrain ? "good" : "poor",
    };
  }

  return assessments;
}


// ── A5: Recon Confidence Layer ───────────────────────────────
// Per-sector estimate of how much the actor can trust their picture.

function computeReconConfidence(actorId, sectors, terrainData, detectionContext) {
  const cols = terrainData?.cols || 12;
  const rows = terrainData?.rows || 15;
  const third = Math.ceil(cols / 3);

  // Get visible hexes for this actor
  const visibleHexes = new Set();
  if (detectionContext?.actorVisibility?.[actorId]?.visibleCells) {
    const cells = detectionContext.actorVisibility[actorId].visibleCells;
    // visibleCells could be a Set or array
    if (cells instanceof Set) {
      cells.forEach(k => visibleHexes.add(k));
    } else if (Array.isArray(cells)) {
      cells.forEach(k => visibleHexes.add(k));
    }
  }

  const sectorBounds = [
    { colStart: 0, colEnd: third },
    { colStart: third, colEnd: third * 2 },
    { colStart: third * 2, colEnd: cols },
  ];

  const confidences = [];

  for (let i = 0; i < sectors.length; i++) {
    const bounds = sectorBounds[i];
    let totalHexes = 0;
    let visibleCount = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = bounds.colStart; c < bounds.colEnd; c++) {
        totalHexes++;
        if (visibleHexes.has(`${c},${r}`)) visibleCount++;
      }
    }

    const coverage = totalHexes > 0 ? Math.round((visibleCount / totalHexes) * 100) : 0;
    let confidence;
    if (coverage >= 60) confidence = "HIGH";
    else if (coverage >= 30) confidence = "MEDIUM";
    else if (coverage > 0) confidence = "LOW";
    else confidence = "UNKNOWN";

    confidences.push({ coverage, confidence });
  }

  return confidences;
}


// ── A6: Format for AI Prompt ─────────────────────────────────
// Converts all computed data into a text section for the AI user message.

function formatTacticalContext(sectors, reconConfidence, gapData, vulnerabilities, units, actorId) {
  const lines = [];

  // Sector assessment with confidence
  lines.push("═══ TACTICAL SITUATION ═══");
  lines.push("SECTOR ASSESSMENT:");
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i];
    const conf = reconConfidence[i];
    const vpStr = s.vpHexes.length > 0
      ? s.vpHexes.map(v => {
          const tag = v.controller === actorId ? "yours" :
                      v.controller === "contested" ? "contested" :
                      v.controller ? "enemy-held" : "unclaimed";
          return `${v.name} (${v.vp}VP, ${tag})`;
        }).join(", ")
      : "No VP";
    lines.push(`  ${s.name} (cols ${s.cols}): You ${s.friendly.power} / Enemy ${s.enemy.power} — ${s.forceLabel} | VP: ${vpStr} | ${s.assessment} (${conf.confidence} confidence — ${conf.coverage}% visible)`);
  }
  lines.push("");

  // Frontline + gaps
  if (gapData.frontline.length > 0) {
    lines.push(`DEFENSIVE LINE: ${gapData.frontline.join("→")}`);
    if (gapData.gaps.length > 0) {
      for (const g of gapData.gaps) {
        const vpWarn = g.exposedVP ? `, ${g.exposedVP} exposed behind it` : "";
        lines.push(`  GAP: ${g.gapSize} hex gap between ${g.between[0]} and ${g.between[1]}${vpWarn}`);
      }
    } else {
      lines.push("  No significant gaps detected — line is continuous");
    }
    lines.push("");
  }

  return lines.join("\n");
}


// Format vulnerability tag for inline unit listing
function formatVulnerabilityTag(assessment) {
  if (!assessment) return "";
  const a = assessment;
  switch (a.classification) {
    case "ISOLATED":
      return ` | ISOLATED — no friendly support within 3 hexes, enemy nearby`;
    case "EXPOSED":
      return ` | EXPOSED — ${a.inEnemyRange} enemies in range, ${a.adjacentFriendlies} friendlies nearby`;
    case "IDLE":
      return ` | IDLE — no enemies within engagement range`;
    case "WELL-POSITIONED":
      return ` | WELL-POSITIONED — ${a.terrainRating} terrain, mutual support`;
    case "ENGAGED":
      return ` | ENGAGED — ${a.enemiesInRange} enemies in range`;
    default:
      return "";
  }
}


// ── Main Entry Point ─────────────────────────────────────────

/**
 * Compute full tactical analysis for an actor.
 * Returns { textSection, vulnerabilities } where textSection is a string
 * to inject into the AI user message, and vulnerabilities is a map of
 * unit ID → assessment for inline annotation.
 *
 * @param {string} actorId - The actor to compute for
 * @param {Object} gameState - Current game state
 * @param {Object} terrainData - Terrain grid
 * @param {Object} detectionContext - FOW data (optional)
 * @returns {{ textSection: string, vulnerabilities: Object }}
 */
export function computeTacticalAnalysis(actorId, gameState, terrainData, detectionContext = null) {
  // A1: Heatmap (internal — foundation for sectors)
  const heatmap = computeHeatmap(actorId, gameState, terrainData, detectionContext);

  // A2: Sector force balance
  const sectors = computeSectors(actorId, gameState, terrainData, heatmap, detectionContext);

  // A3: Frontline + gap detection
  const gapData = computeGaps(actorId, gameState, terrainData);

  // A4: Unit vulnerability assessment
  const vulnerabilities = computeVulnerability(actorId, gameState, terrainData, detectionContext);

  // A5: Recon confidence
  const reconConfidence = computeReconConfidence(actorId, sectors, terrainData, detectionContext);

  // A6: Format for prompt
  const textSection = formatTacticalContext(sectors, reconConfidence, gapData, vulnerabilities, gameState.units, actorId);

  return {
    textSection,
    vulnerabilities,
    formatVulnerabilityTag,
    heatmap,
    sectors,
    gapData,
    reconConfidence,
  };
}
