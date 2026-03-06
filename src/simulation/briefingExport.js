// ═══════════════════════════════════════════════════════════════
// BRIEFING EXPORT — Generate .md briefings for external LLM play
// Two modes: per-actor (fog-of-war) and full (moderator view)
// ═══════════════════════════════════════════════════════════════

import { positionToLabel, buildTerrainSummary } from "./prompts.js";
import { SCALE_TIERS } from "./schemas.js";
import { formatFortuneForPrompt } from "./fortuneRoll.js";
import { MOVEMENT_BUDGETS, TERRAIN_COSTS, WEAPON_RANGE_KM } from "./orderTypes.js";
import { OBSERVER_VISUAL_KM, TARGET_SIZE_MOD, DEFAULT_OBSERVER_VISUAL_KM, DEFAULT_TARGET_SIZE_MOD } from "./detectionRanges.js";

// ── Capabilities Reference Table Builder ─────────────────────
// Shared helper for both actor and full briefings.
// Deduplicates by templateId (or type+movementType fallback) so
// identical unit types don't repeat rows.

function buildCapabilitiesTable(units, terrainData) {
  if (!units.length) return [];

  const lines = [];
  lines.push("## Unit Capabilities Reference");
  lines.push("");

  // Deduplicate: one row per unique template/type combo
  const seen = new Map();
  for (const u of units) {
    const key = u.templateId || `${u.type}|${u.movementType || "foot"}`;
    if (seen.has(key)) continue;
    const rangeKm = u.weaponRangeKm || WEAPON_RANGE_KM[u.type] || WEAPON_RANGE_KM.infantry;
    const moveBudget = MOVEMENT_BUDGETS[u.movementType || "foot"] ?? 3;
    const visionKm = OBSERVER_VISUAL_KM[u.type] ?? DEFAULT_OBSERVER_VISUAL_KM;
    const signature = TARGET_SIZE_MOD[u.type] ?? DEFAULT_TARGET_SIZE_MOD;
    const rangeStr = (rangeKm.effective === 0 && rangeKm.max === 0)
      ? "—"
      : `${rangeKm.effective} / ${rangeKm.max}`;
    seen.set(key, {
      name: u.templateId ? u.templateId.replace(/_/g, " ") : u.type,
      moveType: u.movementType || "foot",
      moveBudget,
      rangeStr,
      visionKm,
      signature,
    });
  }

  lines.push("| Unit Type | Move Type | Move (hex) | Weapon Range eff/max (km) | Vision (km) | Signature |");
  lines.push("|-----------|-----------|------------|---------------------------|-------------|-----------|");
  for (const [, row] of seen) {
    lines.push(`| ${row.name} | ${row.moveType} | ${row.moveBudget} | ${row.rangeStr} | ${row.visionKm} | ${row.signature}× |`);
  }
  lines.push("");

  // Terrain movement costs — only terrains present on the current map
  if (terrainData?.cells) {
    const terrainTypes = new Set();
    for (const cell of Object.values(terrainData.cells)) {
      if (cell.terrain) terrainTypes.add(cell.terrain);
    }
    const sorted = [...terrainTypes].sort((a, b) => {
      const ca = TERRAIN_COSTS[a] ?? 1.0;
      const cb = TERRAIN_COSTS[b] ?? 1.0;
      return ca - cb;
    });
    if (sorted.length > 0) {
      lines.push("**Terrain Movement Costs** *(multiply against move budget — 1.0× = normal, higher = slower)*");
      lines.push("");
      lines.push("| Terrain | Cost | Terrain | Cost |");
      lines.push("|---------|------|---------|------|");
      // Two-column layout to keep it compact
      for (let i = 0; i < sorted.length; i += 2) {
        const t1 = sorted[i];
        const c1 = TERRAIN_COSTS[t1] ?? 1.0;
        const t2 = sorted[i + 1];
        const c2 = t2 ? (TERRAIN_COSTS[t2] ?? 1.0) : "";
        const col2t = t2 || "";
        const col2c = t2 ? `${c2}×` : "";
        lines.push(`| ${t1} | ${c1}× | ${col2t} | ${col2c} |`);
      }
      lines.push("");
    }
  }

  return lines;
}

// ── Per-Actor Briefing (respects fog of war) ────────────────

/**
 * Build a markdown briefing for one actor's commander perspective.
 * Contains only information that actor would have access to.
 * @param {Object} visibilityState - from computeDetection(); used to filter enemy units
 */
export function buildActorBriefing(gameState, actorId, terrainData, { fortuneRolls, frictionEvents, visibilityState } = {}) {
  const actor = gameState.scenario.actors.find(a => a.id === actorId);
  if (!actor) return `# Error: Actor "${actorId}" not found`;

  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const lines = [];

  // Header
  lines.push(`# OPERATIONAL BRIEFING — ${actor.name}`);
  lines.push(`## Turn ${gameState.game.turn} · ${SCALE_TIERS[scaleKey]?.label || scaleKey}`);
  lines.push("");

  // Scenario context
  lines.push("## Situation");
  if (gameState.scenario.title) lines.push(`**Scenario:** ${gameState.scenario.title}`);
  if (gameState.scenario.description) lines.push(`\n${gameState.scenario.description}`);
  if (gameState.game.currentDate) lines.push(`\n**Date:** ${gameState.game.currentDate}`);
  if (gameState.environment) {
    const env = gameState.environment;
    const envParts = [];
    if (env.climate && env.climate !== "temperate") envParts.push(`Climate: ${env.climate}`);
    if (env.weather) envParts.push(`Weather: ${env.weather}`);
    if (env.visibility) envParts.push(`Visibility: ${env.visibility}`);
    if (env.groundCondition) envParts.push(`Ground: ${env.groundCondition}`);
    if (env.timeOfDay) envParts.push(`Time: ${env.timeOfDay}`);
    if (env.stability && env.stability !== "medium") envParts.push(`Stability: ${env.stability}`);
    if (env.severity && env.severity !== "moderate") envParts.push(`Severity: ${env.severity}`);
    if (envParts.length) lines.push(`\n**Environment:** ${envParts.join(" · ")}`);
  }
  lines.push("");

  // Your objectives and constraints
  lines.push("## Your Objectives & Constraints");
  lines.push(`**You are:** ${actor.name}${actor.role ? ` (${actor.role})` : ""}`);
  if (actor.objectives?.length) {
    lines.push("\n**Objectives:**");
    actor.objectives.forEach(o => lines.push(`- ${o}`));
  }
  if (actor.constraints?.length) {
    lines.push("\n**Constraints:**");
    actor.constraints.forEach(c => lines.push(`- ${c}`));
  }
  lines.push("");

  // Your forces
  const myUnits = gameState.units.filter(u => u.actor === actorId);
  if (myUnits.length > 0) {
    lines.push("## Your Forces");
    lines.push("");
    lines.push("| Unit | Type | Echelon | Position | Strength | Supply | Status | Posture |");
    lines.push("|------|------|---------|----------|----------|--------|--------|---------|");
    for (const u of myUnits) {
      lines.push(`| ${u.name} | ${u.type} | ${u.echelon || "—"} | ${positionToLabel(u.position)} | ${u.strength}% | ${u.supply}% | ${u.status} | ${u.posture || "ready"} |`);
    }
    lines.push("");
  }

  // Unit capabilities reference — movement, weapon ranges, vision, terrain costs
  if (myUnits.length > 0) {
    lines.push(...buildCapabilitiesTable(myUnits, terrainData));
  }

  // Known enemy forces — filtered by detection state
  const actorVis = visibilityState?.actorVisibility?.[actorId];
  const detectedSet = actorVis?.detectedUnits instanceof Set
    ? actorVis.detectedUnits
    : new Set(actorVis?.detectedUnits || []);
  const contactSet = actorVis?.contactUnits instanceof Set
    ? actorVis.contactUnits
    : new Set(actorVis?.contactUnits || []);
  const lastKnown = actorVis?.lastKnown || {};

  // Identified enemies — full details
  const identifiedUnits = gameState.units.filter(u => u.actor !== actorId && detectedSet.has(u.id));
  if (identifiedUnits.length > 0) {
    lines.push("## Identified Enemy Forces");
    lines.push("*(Positively identified — high-confidence intelligence)*");
    lines.push("");
    lines.push("| Unit | Actor | Type | Echelon | Position | Strength | Status |");
    lines.push("|------|-------|------|---------|----------|----------|--------|");
    for (const u of identifiedUnits) {
      const enemyActor = gameState.scenario.actors.find(a => a.id === u.actor)?.name || u.actor;
      lines.push(`| ${u.name} | ${enemyActor} | ${u.type} | ${u.echelon || "—"} | ${positionToLabel(u.position)} | ${u.strength}% | ${u.status} |`);
    }
    lines.push("");
  }

  // Contact-tier enemies — minimal details (just position and "unknown enemy activity")
  const contactUnits = gameState.units.filter(u => u.actor !== actorId && contactSet.has(u.id));
  if (contactUnits.length > 0) {
    lines.push("## Unidentified Contacts");
    lines.push("*(Detected activity — type and strength unknown)*");
    lines.push("");
    lines.push("| Position | Notes |");
    lines.push("|----------|-------|");
    for (const u of contactUnits) {
      lines.push(`| ${positionToLabel(u.position)} | Enemy activity detected |`);
    }
    lines.push("");
  }

  // Last-known positions — ghost intel from previous turns
  const lastKnownEntries = Object.entries(lastKnown).filter(([unitId]) => {
    // Don't show last-known for units currently detected or in contact
    return !detectedSet.has(unitId) && !contactSet.has(unitId);
  });
  if (lastKnownEntries.length > 0) {
    lines.push("## Last Known Positions");
    lines.push("*(Historical intelligence — positions may be outdated)*");
    lines.push("");
    lines.push("| Type | Last Position | Turns Ago | Reliability |");
    lines.push("|------|---------------|-----------|-------------|");
    for (const [unitId, info] of lastKnownEntries) {
      const age = (gameState.game?.turn || 1) - (info.turn || 0);
      const reliability = info.stale ? "Stale" : "Recent";
      lines.push(`| ${info.type || "unknown"} | ${positionToLabel(info.position)} | ${age} | ${reliability} |`);
    }
    lines.push("");
  }

  // Terrain summary
  if (terrainData) {
    lines.push("## Terrain");
    const summary = buildTerrainSummary(terrainData, { units: myUnits, scaleTier });
    lines.push(summary);
    lines.push("");
  }

  // Recent history (last 2-3 turns) — uses per-actor narrative if available
  if (gameState.turnLog.length > 0) {
    lines.push("## Recent History");
    const recentTurns = gameState.turnLog.slice(-3);
    for (const entry of recentTurns) {
      lines.push(`\n### Turn ${entry.turn}`);
      // Prefer per-actor narrative (FOW-safe) over omniscient master narrative
      const actorNarrative = entry.actorNarratives?.[actorId];
      if (actorNarrative) {
        lines.push(actorNarrative);
      } else if (entry.adjudication?.narrative) {
        // Fallback to master narrative for old turn logs that don't have per-actor data
        lines.push(entry.adjudication.narrative);
      }
    }
    lines.push("");
  }

  // Fortune & friction (if available this turn)
  if (fortuneRolls || frictionEvents?.events?.length) {
    lines.push("## Fortune & Friction (This Turn)");
    if (fortuneRolls) {
      const actorRoll = fortuneRolls.actorRolls?.[actorId];
      if (actorRoll) {
        lines.push(`\n**Your fortune roll:** ${actorRoll.roll} — ${actorRoll.descriptor}`);
      }
      if (fortuneRolls.wildCard?.triggered) {
        lines.push(`**Wild card:** ${fortuneRolls.wildCard.roll} — ${fortuneRolls.wildCard.descriptor}`);
      }
    }
    if (frictionEvents?.events?.length) {
      lines.push("\n**Friction events:**");
      for (const evt of frictionEvents.events) {
        const badge = evt.positive ? "[+]" : `[${evt.severity}]`;
        lines.push(`- ${badge} ${evt.text}`);
      }
    }
    lines.push("");
  }

  // Coordinate system explanation
  lines.push("## Coordinate System");
  lines.push("Columns are labeled A-Z (left to right), rows are numbered 1-N (top to bottom).");
  lines.push("Example: **H4** = column H (8th from left), row 4 (4th from top).");
  if (terrainData?.cellSizeKm) {
    lines.push(`Each hex is approximately **${terrainData.cellSizeKm} km** across.`);
  }
  lines.push("");

  // Orders prompt
  lines.push("## Your Orders");
  lines.push(`You are the commander of **${actor.name}**. Based on the above situation, issue your orders for this turn.`);
  lines.push("");
  lines.push("Be specific about:");
  lines.push("- Which units do what (reference by name)");
  lines.push("- Where they move or attack (reference grid coordinates like H4, B7)");
  lines.push("- Your overall intent and priorities");
  lines.push("- Any coordination between units");

  return lines.join("\n");
}

// ── Full Briefing (moderator view, all info) ────────────────

/**
 * Build a full situational briefing showing all forces and objectives.
 * No fog of war — shows everything for moderator or external analysis.
 */
export function buildFullBriefing(gameState, terrainData, { fortuneRolls, frictionEvents } = {}) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const lines = [];

  // Header
  lines.push(`# FULL SITUATIONAL BRIEFING`);
  lines.push(`## ${gameState.scenario.title || "Simulation"} — Turn ${gameState.game.turn} · ${SCALE_TIERS[scaleKey]?.label || scaleKey}`);
  lines.push("");

  // Scenario
  lines.push("## Scenario");
  if (gameState.scenario.description) lines.push(gameState.scenario.description);
  if (gameState.game.currentDate) lines.push(`\n**Date:** ${gameState.game.currentDate}`);
  if (gameState.environment) {
    const env = gameState.environment;
    const envParts = [];
    if (env.climate && env.climate !== "temperate") envParts.push(`Climate: ${env.climate}`);
    if (env.weather) envParts.push(`Weather: ${env.weather}`);
    if (env.visibility) envParts.push(`Visibility: ${env.visibility}`);
    if (env.groundCondition) envParts.push(`Ground: ${env.groundCondition}`);
    if (env.timeOfDay) envParts.push(`Time: ${env.timeOfDay}`);
    if (env.stability && env.stability !== "medium") envParts.push(`Stability: ${env.stability}`);
    if (env.severity && env.severity !== "moderate") envParts.push(`Severity: ${env.severity}`);
    if (envParts.length) lines.push(`\n**Environment:** ${envParts.join(" · ")}`);
  }
  lines.push("");

  // Each actor's objectives, constraints, and forces
  for (const actor of gameState.scenario.actors) {
    lines.push(`## ${actor.name}${actor.role ? ` (${actor.role})` : ""}`);
    if (actor.objectives?.length) {
      lines.push("\n**Objectives:**");
      actor.objectives.forEach(o => lines.push(`- ${o}`));
    }
    if (actor.constraints?.length) {
      lines.push("\n**Constraints:**");
      actor.constraints.forEach(c => lines.push(`- ${c}`));
    }

    const actorUnits = gameState.units.filter(u => u.actor === actor.id);
    if (actorUnits.length > 0) {
      lines.push("\n**Forces:**");
      lines.push("");
      lines.push("| Unit | Type | Echelon | Position | Strength | Supply | Status | Posture |");
      lines.push("|------|------|---------|----------|----------|--------|--------|---------|");
      for (const u of actorUnits) {
        lines.push(`| ${u.name} | ${u.type} | ${u.echelon || "—"} | ${positionToLabel(u.position)} | ${u.strength}% | ${u.supply}% | ${u.status} | ${u.posture || "ready"} |`);
      }
    }
    lines.push("");
  }

  // Unit capabilities reference — all units across all actors
  if (gameState.units.length > 0) {
    lines.push(...buildCapabilitiesTable(gameState.units, terrainData));
  }

  // Terrain summary
  if (terrainData) {
    lines.push("## Terrain");
    const summary = buildTerrainSummary(terrainData, { scaleTier });
    lines.push(summary);
    lines.push("");
  }

  // Recent history
  if (gameState.turnLog.length > 0) {
    lines.push("## Recent History");
    const recentTurns = gameState.turnLog.slice(-3);
    for (const entry of recentTurns) {
      lines.push(`\n### Turn ${entry.turn}`);
      if (entry.actions && Object.keys(entry.actions).length > 0) {
        for (const [actorId, text] of Object.entries(entry.actions)) {
          const name = gameState.scenario.actors.find(a => a.id === actorId)?.name || actorId;
          lines.push(`\n**${name}'s orders:** ${text}`);
        }
      }
      if (entry.adjudication?.narrative) {
        lines.push(`\n**Outcome:** ${entry.adjudication.narrative}`);
      }
    }
    lines.push("");
  }

  // Fortune & friction
  if (fortuneRolls || frictionEvents?.events?.length) {
    lines.push("## Fortune & Friction (This Turn)");
    if (fortuneRolls) {
      lines.push("\n**Fortune rolls:**");
      for (const [actorId, roll] of Object.entries(fortuneRolls.actorRolls || {})) {
        const name = gameState.scenario.actors.find(a => a.id === actorId)?.name || actorId;
        lines.push(`- ${name}: ${roll.roll} — ${roll.descriptor}`);
      }
      if (fortuneRolls.wildCard) {
        lines.push(`- Wild Card: ${fortuneRolls.wildCard.roll} — ${fortuneRolls.wildCard.descriptor}${fortuneRolls.wildCard.triggered ? " ⚡" : ""}`);
      }
    }
    if (frictionEvents?.events?.length) {
      lines.push("\n**Friction events:**");
      for (const evt of frictionEvents.events) {
        const badge = evt.positive ? "[+]" : `[${evt.severity}]`;
        lines.push(`- ${badge} ${evt.text}`);
      }
    }
    lines.push("");
  }

  // Coordinate system
  lines.push("## Coordinate System");
  lines.push("Columns A-Z (left to right), rows 1-N (top to bottom). Example: **H4** = column H, row 4.");
  if (terrainData?.cellSizeKm) {
    lines.push(`Each hex ≈ **${terrainData.cellSizeKm} km** across.`);
  }

  return lines.join("\n");
}

// ── File download helper ────────────────────────────────────

/**
 * Trigger a file download in the browser.
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type (default: text/markdown)
 */
export function downloadFile(content, filename, mimeType = "text/markdown") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a PNG download from a data URL.
 */
export function downloadDataURL(dataURL, filename) {
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
