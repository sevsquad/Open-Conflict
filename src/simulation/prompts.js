// ═══════════════════════════════════════════════════════════════
// PROMPT ARCHITECTURE — D.1 through D.6
// System prompt, adjudication prompt builder, third-person framing
// ═══════════════════════════════════════════════════════════════

import { ADJUDICATION_SCHEMA_EXAMPLE } from "./schemas.js";

// ── D.1: System Prompt ──────────────────────────────────────

export function buildSystemPrompt() {
  return `You are an impartial conflict simulation adjudicator. Your role is to evaluate player-submitted actions and determine realistic outcomes based on the scenario data, reference materials, and current game state provided to you.

## AUTHORITY AND IDENTITY

You are a neutral evaluator — not a participant, advisor, or storyteller. You assess plausibility and determine outcomes.

Reference hierarchy (in order of priority):
1. Current game state (unit positions, strengths, diplomatic status)
2. Scenario-specific data (actor profiles, objectives, constraints, special rules)
3. Reference corpus documents (escalation framework, adjudicator guidance)
4. General knowledge (use only when the above sources are insufficient, and flag when you do)

You MUST respond with valid JSON conforming to the adjudication schema provided.

## ANTI-SYCOPHANCY INSTRUCTIONS [D.2]

Evaluate each action as if you are a third-party review panel assessing a submitted operational plan — not a collaborator helping players succeed.

Mandatory requirements:
- You MUST identify at least one weakness, risk, or limitation for EVERY player action in the weaknesses_identified field, regardless of how well-argued or reasonable the action appears.
- A player's justification for their action is NOT sufficient basis for a favorable assessment. You must independently verify plausibility against the reference data and game state.
- If an action is implausible given the current state (unit capabilities, terrain, logistics, political constraints), assign "low" or "infeasible" feasibility. Do not soften the assessment.
- Treat each actor's actions with equal scrutiny. Do not favor the actor whose action you process first or whose framing is more persuasive.

## DE-ESCALATION REFLECTION [D.3]

For EVERY adjudication, you MUST complete the de_escalation_assessment section. This is mandatory even during active combat.

Before determining outcomes, explicitly consider:
1. What de-escalation options are currently available to the involved actors?
2. Which diplomatic off-ramps are being closed or opened by this turn's actions?
3. What is the historical base rate for conflicts at this escalation level? Do they typically escalate or de-escalate?
4. Reference the escalation framework document to identify the current level and direction.

This requirement exists to counteract documented LLM escalation bias. You are not required to bias toward de-escalation — you are required to explicitly consider the full range of plausible responses.

## CITATION REQUIREMENTS [D.4]

Every feasibility assessment and outcome determination MUST cite specific sources:
- [state: entity_id.attribute] — reference to current game state
- [scenario: section_name] — reference to scenario data (actors, objectives, constraints, initial conditions)
- [corpus: document_name] — reference to corpus documents (escalation framework, adjudicator guidance)
- [terrain: grid_reference] — reference to terrain data

If you cannot cite a specific source for a factual claim, state that explicitly rather than asserting it as fact. Unsourced claims should be flagged in meta.ambiguities.

## OUTPUT FORMAT [D.6]

Respond with a single JSON object containing these sections IN ORDER:

1. **adjudication.situation_assessment** — Summarize the relevant current state
2. **adjudication.action_interpretation** — Restate each actor's action in precise terms
3. **adjudication.feasibility_analysis** — Assess each action's feasibility with citations and weaknesses
4. **adjudication.de_escalation_assessment** — Mandatory escalation/de-escalation analysis
5. **adjudication.outcome_determination** — What happens, with narrative and probability
6. **adjudication.state_updates** — Specific, atomic state changes (entity, attribute, old_value, new_value, justification)
7. **meta** — Confidence level, moderator notes, ambiguities

## BEHAVIORAL CONSTRAINTS

- Do NOT invent units, capabilities, events, or conditions not established in the game state or scenario data.
- Do NOT perform mathematical calculations for combat outcomes. Describe qualitative outcomes and provide proportional state updates.
- When multiple actors take simultaneous actions, resolve them as collisions between independently planned actions. Neither actor has first-mover advantage.
- Do NOT reference your training data for specific military outcomes — use only the provided reference materials.
- If you lack sufficient information to determine a definitive outcome, say so in meta.ambiguities. A qualified assessment is more useful than a confident fabrication.`;
}

// ── D.5: Third-Person Framing ───────────────────────────────

/**
 * Reformat a player's action as a third-person intelligence report.
 * This reduces sycophancy by distancing the LLM from direct requests.
 */
export function reformatActionAsIntelReport(actor, actionText, gameState) {
  const actorInfo = gameState.scenario?.actors?.find(a => a.id === actor.id);
  const actorName = actorInfo?.name || actor.name || actor.id;

  // Gather relevant unit info for this actor
  const actorUnits = (gameState.units || []).filter(u => u.actor === actor.id);
  let unitSummary = "";
  if (actorUnits.length > 0) {
    const unitLines = actorUnits.map(u =>
      `  - ${u.name} (${u.type}): position ${u.position}, strength ${u.strength}%, supply ${u.supply}%, status: ${u.status}`
    );
    unitSummary = `\nCurrent disposition of ${actorName} forces:\n${unitLines.join("\n")}`;
  }

  return `INTELLIGENCE REPORT — ${actorName}
${actorName} has issued the following orders: ${actionText}
${unitSummary}
Assess the feasibility and likely outcomes of these orders based on current game state, terrain, and reference data.`;
}

// ── Terrain Summary Builder ─────────────────────────────────

const TERRAIN_LABELS = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", forested_hills: "Forested Hills", mountain_forest: "Mtn Forest",
  mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert", ice: "Ice/Glacier",
  light_urban: "Light Urban", dense_urban: "Dense Urban",
};

/**
 * Build a condensed terrain summary for prompt injection.
 * Adapted from Viewer.jsx exportLLM logic (lines 441-493).
 */
export function buildTerrainSummary(terrainData) {
  if (!terrainData) return "No terrain data loaded.";

  const D = terrainData;
  const lines = [];

  lines.push(`TERRAIN MAP: ${D.cols}\u00D7${D.rows} cells, ${D.cellSizeKm}km/cell`);
  if (D.center) lines.push(`Center: ${D.center.lat.toFixed(4)}, ${D.center.lng.toFixed(4)}`);
  if (D.bbox) lines.push(`Bounds: S${D.bbox.south.toFixed(4)} N${D.bbox.north.toFixed(4)} W${D.bbox.west.toFixed(4)} E${D.bbox.east.toFixed(4)}`);
  lines.push(`Map size: ${D.widthKm || (D.cols * D.cellSizeKm)}km x ${D.heightKm || Math.round(D.rows * D.cellSizeKm * (Math.sqrt(3) / 2))}km`);

  // Terrain distribution
  const terrCt = {};
  let elevMin = Infinity, elevMax = -Infinity;
  for (const k in D.cells) {
    const cell = D.cells[k];
    const t = cell.terrain;
    terrCt[t] = (terrCt[t] || 0) + 1;
    if (cell.elevation !== undefined) {
      if (cell.elevation < elevMin) elevMin = cell.elevation;
      if (cell.elevation > elevMax) elevMax = cell.elevation;
    }
  }
  const total = Object.values(terrCt).reduce((s, v) => s + v, 0);

  lines.push("");
  lines.push("TERRAIN DISTRIBUTION:");
  Object.entries(terrCt)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => {
      lines.push(`  ${(TERRAIN_LABELS[t] || t).padEnd(16)} ${((n / total) * 100).toFixed(1)}% (${n} cells)`);
    });

  if (elevMin !== Infinity) {
    lines.push("");
    lines.push(`ELEVATION: ${elevMin}m to ${elevMax}m`);
  }

  // Key features summary
  const featCt = {};
  for (const k in D.cells) {
    const cell = D.cells[k];
    const feats = [...(cell.features || []), ...(cell.attributes || [])];
    if (cell.infrastructure) feats.push(cell.infrastructure);
    for (const f of feats) featCt[f] = (featCt[f] || 0) + 1;
  }
  const significantFeats = Object.entries(featCt)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (significantFeats.length > 0) {
    lines.push("");
    lines.push("KEY FEATURES:");
    significantFeats.forEach(([f, n]) => {
      lines.push(`  ${f.replace(/_/g, " ").padEnd(22)} ${n} cells`);
    });
  }

  // Named features
  const nameIdx = {};
  for (const k in D.cells) {
    const fn = D.cells[k].feature_names;
    if (!fn) continue;
    for (const [type, name] of Object.entries(fn)) {
      if (!nameIdx[type]) nameIdx[type] = {};
      if (!nameIdx[type][name]) nameIdx[type][name] = 0;
      nameIdx[type][name]++;
    }
  }
  if (Object.keys(nameIdx).length > 0) {
    lines.push("");
    lines.push("NAMED FEATURES:");
    for (const [type, names] of Object.entries(nameIdx)) {
      for (const [name, count] of Object.entries(names).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${type}: ${name} (${count} cells)`);
      }
    }
  }

  return lines.join("\n");
}

// ── Full Adjudication Prompt Builder ────────────────────────

/**
 * Assemble the complete user prompt for an adjudication call.
 */
export function buildAdjudicationPrompt({ scenario, gameState, terrainData, actions, corpus }) {
  const sections = [];

  // Corpus reference documents
  sections.push("═══ REFERENCE DOCUMENTS ═══");
  sections.push(corpus);

  // Scenario context
  sections.push("");
  sections.push("═══ SCENARIO ═══");
  sections.push(`Title: ${scenario.title}`);
  if (scenario.description) sections.push(`Description: ${scenario.description}`);
  if (scenario.turnDuration) sections.push(`Turn duration: ${scenario.turnDuration}`);
  if (scenario.startDate) sections.push(`Start date: ${scenario.startDate}`);
  if (scenario.escalationLevel) sections.push(`Current escalation level: ${scenario.escalationLevel}`);
  sections.push("");
  sections.push("Actors:");
  for (const actor of scenario.actors) {
    sections.push(`  ${actor.name} (${actor.id}):`);
    sections.push(`    Objectives: ${actor.objectives.join("; ")}`);
    sections.push(`    Constraints: ${actor.constraints.join("; ")}`);
    if (actor.briefing) sections.push(`    Briefing: ${actor.briefing}`);
  }
  if (scenario.initialConditions) {
    sections.push("");
    sections.push(`Initial Conditions: ${scenario.initialConditions}`);
  }
  if (scenario.specialRules) {
    sections.push("");
    sections.push(`Special Rules: ${scenario.specialRules}`);
  }

  // Terrain summary
  sections.push("");
  sections.push("═══ TERRAIN ═══");
  sections.push(buildTerrainSummary(terrainData));

  // Current game state
  sections.push("");
  sections.push("═══ CURRENT GAME STATE ═══");
  sections.push(`Turn: ${gameState.game.turn}`);
  sections.push(`Phase: ${gameState.game.phase}`);

  if (gameState.units && gameState.units.length > 0) {
    sections.push("");
    sections.push("Units:");
    for (const u of gameState.units) {
      sections.push(`  ${u.id} | ${u.name} (${u.type}) | Actor: ${u.actor} | Position: ${u.position} | Strength: ${u.strength}% | Supply: ${u.supply}% | Status: ${u.status}${u.notes ? ` | Notes: ${u.notes}` : ""}`);
    }
  }

  if (gameState.diplomacy && Object.keys(gameState.diplomacy).length > 0) {
    sections.push("");
    sections.push("Diplomatic State:");
    for (const [pair, status] of Object.entries(gameState.diplomacy)) {
      sections.push(`  ${pair}: ${status}`);
    }
  }

  // Recent turn history (last 3 turns for context)
  if (gameState.turnLog && gameState.turnLog.length > 0) {
    const recentTurns = gameState.turnLog.slice(-3);
    sections.push("");
    sections.push("RECENT HISTORY (last 3 turns):");
    for (const t of recentTurns) {
      sections.push(`  Turn ${t.turn}: ${t.adjudication?.narrative || "No narrative recorded"}`);
    }
  }

  // Player actions (reformatted as intelligence reports)
  sections.push("");
  sections.push("═══ ACTIONS TO ADJUDICATE (Turn " + gameState.game.turn + ") ═══");
  for (const { actor, report } of actions) {
    sections.push("");
    sections.push(report);
  }

  // Schema example
  sections.push("");
  sections.push("═══ REQUIRED OUTPUT FORMAT ═══");
  sections.push("Respond with ONLY a valid JSON object matching this schema:");
  sections.push(JSON.stringify(ADJUDICATION_SCHEMA_EXAMPLE, null, 2));

  return sections.join("\n");
}
