// ═══════════════════════════════════════════════════════════════
// BRIEFING EXPORT — Generate .md briefings for external LLM play
// Two modes: per-actor (fog-of-war) and full (moderator view)
// ═══════════════════════════════════════════════════════════════

import { positionToLabel, buildTerrainSummary } from "./prompts.js";
import { SCALE_TIERS } from "./schemas.js";
import { formatFortuneForPrompt } from "./fortuneRoll.js";

// ── Per-Actor Briefing (respects fog of war) ────────────────

/**
 * Build a markdown briefing for one actor's commander perspective.
 * Contains only information that actor would have access to.
 */
export function buildActorBriefing(gameState, actorId, terrainData, { fortuneRolls, frictionEvents } = {}) {
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
    if (env.weather) envParts.push(`Weather: ${env.weather}`);
    if (env.visibility) envParts.push(`Visibility: ${env.visibility}`);
    if (env.groundCondition) envParts.push(`Ground: ${env.groundCondition}`);
    if (env.timeOfDay) envParts.push(`Time: ${env.timeOfDay}`);
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

  // Known enemy forces (only detected units if fog of war applies)
  const enemyUnits = gameState.units.filter(u => u.actor !== actorId && u.detected !== false);
  if (enemyUnits.length > 0) {
    lines.push("## Known Enemy Forces");
    lines.push("*(Based on current intelligence — may be incomplete)*");
    lines.push("");
    lines.push("| Unit | Actor | Type | Echelon | Position | Strength | Status |");
    lines.push("|------|-------|------|---------|----------|----------|--------|");
    for (const u of enemyUnits) {
      const enemyActor = gameState.scenario.actors.find(a => a.id === u.actor)?.name || u.actor;
      lines.push(`| ${u.name} | ${enemyActor} | ${u.type} | ${u.echelon || "—"} | ${positionToLabel(u.position)} | ${u.strength}% | ${u.status} |`);
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

  // Recent history (last 2-3 turns)
  if (gameState.turnLog.length > 0) {
    lines.push("## Recent History");
    const recentTurns = gameState.turnLog.slice(-3);
    for (const entry of recentTurns) {
      lines.push(`\n### Turn ${entry.turn}`);
      if (entry.adjudication?.narrative) {
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
    if (env.weather) envParts.push(`Weather: ${env.weather}`);
    if (env.visibility) envParts.push(`Visibility: ${env.visibility}`);
    if (env.groundCondition) envParts.push(`Ground: ${env.groundCondition}`);
    if (env.timeOfDay) envParts.push(`Time: ${env.timeOfDay}`);
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
