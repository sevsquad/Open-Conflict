// ═══════════════════════════════════════════════════════════════
// PROMPT ARCHITECTURE — D.1 through D.7
// Modular, scale-aware system prompt + adjudication prompt builder
// ═══════════════════════════════════════════════════════════════

import { ADJUDICATION_SCHEMA_EXAMPLE, SCALE_TIERS } from "./schemas.js";
import { cellCoord, labelToColRow, formatCellDetail, isFeatureRelevant, getTerrainLabelForTier, buildElevationBands, buildElevationNarrative, buildFeatureRegions, buildNamedFeatures } from "./terrainCodec.js";
import { getNeighbors, hexRange } from "../mapRenderer/HexMath.js";

// ── Scale Declaration Blocks ────────────────────────────────
// Tells the LLM what scale it's operating at and what to focus on.

const SCALE_DECLARATIONS = {
  sub_tactical: `This scenario operates at SUB-TACTICAL scale. You are adjudicating fireteam-to-squad-level actions over 1-5 minute turns in 50-200m hexes.
Focus on: individual weapon systems, cover/concealment per position, suppression, ammunition expenditure, individual casualties, micro-terrain (walls, fences, doors, windows). The decisive question at this scale is whether a fireteam can suppress, flank, or eliminate a specific position given the cover and LOS between them.
Do NOT reason about logistics chains, diplomacy, strategic reserves, or air campaigns — they are above this scale's resolution.`,

  tactical: `This scenario operates at TACTICAL scale. You are adjudicating platoon-to-company-level operations over 15 min to 2 hour turns in 200m-2km hexes.
Focus on: platoon/company-level fire and maneuver, supporting fire effectiveness (mortars, direct fire), local coordination, terrain features (hedgerows, buildings, bridges, treelines), engagement ranges, ammo resupply from company trains, casualty evacuation, morale/cohesion. The platoon is the smallest independently maneuverable unit — squads exist within platoons but are not individually ordered at this scale.
Do NOT reason about national politics, strategic logistics, industrial base, WMD frameworks, or alliance management — they are above this scale's resolution.`,

  grand_tactical: `This scenario operates at GRAND TACTICAL scale. You are adjudicating battalion-to-brigade-level combined-arms operations over 2-8 hour turns in 2-5km hexes.
Focus on: combined-arms synergy (infantry-armor-artillery coordination), terrain as tactical features (ridgelines as defensive lines, urban areas as strongpoints, bridges as chokepoints, forests as concealment), reserve commitment decisions, forward logistics. The decisive question at this scale is how well different branches work together — a combined-arms battle group (e.g. 1x armor co + 2x mech inf co + 1x eng plt) is more effective than the same units operating independently. Task organization matters.
Individual soldier actions are below resolution. National strategy is above resolution.`,

  operational: `This scenario operates at OPERATIONAL scale. You are adjudicating division-to-corps-level maneuver over 12-48 hour turns in 5-10km hexes.
Focus on: multi-division maneuver along operational axes, supply lines and depots, road/rail networks as lines of communication, air support allocation across the front, operational reserves and their commitment timing, engineer assets at scale (bridging rivers, obstacle belts), infrastructure (airfields, rail junctions, ports as objectives).
Do NOT reason about individual terrain features (fences, hedgerows, individual buildings) or per-soldier tracking — they are below this scale's resolution.`,

  strategic: `This scenario operates at STRATEGIC scale. You are adjudicating corps-to-army-level operations over 2-7 day turns in 10-20km hexes.
Focus on: national logistics (production capacity, rail throughput, port capacity), air campaigns (strategic bombing, air superiority), naval operations, strategic reserves and mobilization timelines, political constraints (ROE, alliance obligations, red lines), escalation dynamics, intelligence/deception at strategic scale, coalition coordination, WMD considerations.
Do NOT reason about individual terrain features below major road/rail/river or battalion-level detail — they are below this scale's resolution.`,

  theater: `This scenario operates at THEATER scale. You are adjudicating army-group-to-national-level campaigns over 1 week to 1 month turns in 20km+ hexes.
Focus on: national economies and industrial production, alliance politics and coalition management, full diplomacy (negotiations, treaties, sanctions), escalation dynamics (this is where nuclear thresholds live), information warfare, trade/sanctions/economic warfare, public opinion and war weariness, mobilization and force generation, grand strategic objectives.
Do NOT reason about any terrain detail below major geographic features (mountain ranges, major rivers, coastlines, major cities) or anything below division-level — they are below this scale's resolution.`,
};

// ── Resolution Guidance Blocks ──────────────────────────────
// Quantitative anchors (not rigid rules) to prevent nonsensical LLM outputs.

const RESOLUTION_GUIDANCE = {
  sub_tactical: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- A single engagement between squads in good cover: 0-2 casualties per side over a 5-minute turn
- A squad caught in the open by automatic weapons fire: loses 30-60% in the same time
- Suppressive fire pins a fireteam for 1-3 turns depending on volume and accuracy
- Room clearing: 1-2 casualties expected for the clearing team per defended room
- Ammunition: a rifleman carries ~210 rounds; sustained fire consumes 30-60 rounds per 5-minute engagement
- Movement: sprint 100m in ~15 seconds; tactical bound 50-100m in 1-2 minutes with cover
Adjust for: cover quality, weapon type, training level, suppression state, visibility, fatigue.`,

  tactical: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- Platoon assault on prepared position without fire support: succeeds ~30% of the time
- With effective suppressive fire from adjacent platoons or mortars: ~60%
- Expect 10-20% attacker casualties in a successful assault on a defended position
- Company-level attack with combined arms: expects 5-15% casualties if successful
- Mortar fire on exposed infantry: 5-10% casualties per fire mission
- Movement: road march 4-8km per hour; cross-country 2-4km/hr; through forest 1-2km/hr
- Ammunition: sustained company engagement consumes 15-25% ammo per hour of combat
Adjust for: surprise, prepared defenses, fire support quality, weather, morale, training.`,

  grand_tactical: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- Pure infantry battalion attacking prepared defense: needs 3:1 superiority
- Combined-arms task force (inf+armor+arty): needs 2:1 (synergy bonus is the decisive multiplier)
- Forest/urban defense multiplies effective strength by 1.5-2x
- River crossing without bridge: attacker at 0.5x effective strength
- Engineer bridging/obstacle clearance can negate specific terrain penalties
- Active combat: expect 5-15% strength loss per side per turn of active engagement
- Reserve commitment at the decisive point can be battle-winning; too early wastes it
- Ammo: sustained combat consumes ~20-30% ammo per turn
- Movement: road march 15-25km/turn, cross-country 8-12km/turn, mountain 3-6km/turn
Adjust for: surprise, air superiority, prepared defenses, weather, fatigue, combined-arms quality, task organization.`,

  operational: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- A division attacking along a single axis consumes supply at 3x the defensive rate
- Without resupply, combat effectiveness degrades ~10% per turn
- Successful penetration requires 5:1 local superiority at the point of attack
- Exploitation after breakthrough: 20-40km per day along roads, less cross-country
- Supply consumption: an attacking division needs ~3000 tons/day; defending ~1000 tons/day
- Air superiority provides ~1.5x combat multiplier; air supremacy ~2x
- Movement: mechanized forces 30-50km/day on roads; infantry 15-25km/day
- Mountain terrain: movement at 0.3x road rate, supply throughput at 0.5x, strong defensive advantage (+2x effective strength)
- River crossing without bridging assets: attack at 0.5x strength, 1 turn delay for engineer bridging
- High-ground defense: +1.5x effective strength; denying high ground to the enemy is an operational priority
- Supply through mountain terrain: throughput reduced to 40-60% of plains capacity
Adjust for: supply state, air situation, terrain, weather, force quality, C2 disruption.`,

  strategic: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- Sustained offensive operations consume an army's combat power at 2-5% per day
- Strategic bombing degrades industrial output ~1-3% per week of sustained campaign
- Political constraints may limit operations more than military factors
- Mobilization takes weeks to months depending on national preparedness
- Strategic airlift can move ~1 brigade equivalent per week per major air transport wing
- Naval blockade: reduces trade throughput by 50-90% depending on geography and force ratio
- Alliance fatigue: extended operations without progress strain coalition cohesion
- Mountain ranges block operational axes — forces funnel through passes and valleys (identify from terrain)
- Supply throughput through mountain terrain: 30-50% of plains capacity, critical constraint on offensive tempo
- Geographic barriers (mountains, major rivers) define theater boundaries and army group sectors
Adjust for: industrial base, political will, alliance dynamics, geography, nuclear threshold proximity.`,

  theater: `COMBAT RESOLUTION ANCHORS (guidelines, adjust for specific circumstances):
- An army group offensive might last 2-4 turns (weeks to months)
- Success depends on: industrial production replacing losses, alliance cohesion, strategic logistics
- War economies take 6-12 months to fully mobilize from peacetime
- Attrition warfare: expect 1-3% force losses per week of sustained operations
- Strategic bombing campaigns take months to show decisive economic effects
- Naval campaigns: establishing sea control takes weeks of sustained operations
- Information warfare effects are gradual and cumulative over multiple turns
- Major mountain ranges and coastlines define campaign-level constraints on force employment
- Geographic barriers channel national-level offensives into predictable axes — deception must account for geography
- Terrain determines WHERE forces can operate; logistics determines IF they can sustain operations there
Think in campaigns, not battles. The key question is whether the enemy's political will breaks before yours.`,
};

// ── D.1: System Prompt (Modular, Scale-Aware) ───────────────

/**
 * Build the system prompt from modular sections based on scale tier.
 * Sections: identity, scale declaration, order validation, resolution guidance,
 * anti-sycophancy, de-escalation (tier 4+ only), citations, output format, behavioral constraints.
 */
export function buildSystemPrompt(scaleKey = "grand_tactical") {
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const sections = [];

  // ── Identity & Authority (always) ──
  sections.push(`You are an impartial conflict simulation adjudicator. Your role is to evaluate player-submitted actions and determine realistic outcomes based on the scenario data, reference materials, and current game state provided to you.

## AUTHORITY AND IDENTITY

You are a neutral evaluator — not a participant, advisor, or storyteller. You assess plausibility and determine outcomes.

Reference hierarchy (in order of priority):
1. Current game state (unit positions, strengths, status)
2. Scenario-specific data (actor profiles, objectives, constraints, special rules)
3. Reference corpus documents (adjudicator guidance${scaleTier >= 4 ? ", escalation framework" : ""})
4. General knowledge (use only when the above sources are insufficient, and flag when you do)

You MUST respond with valid JSON conforming to the adjudication schema provided.`);

  // ── Scale Declaration (always) ──
  sections.push(`\n## SCALE DECLARATION\n\n${SCALE_DECLARATIONS[scaleKey] || SCALE_DECLARATIONS.grand_tactical}`);

  // ── Order Validation D.7 (always) ──
  sections.push(`\n## ORDER VALIDATION [D.7]

Before adjudicating outcomes, screen each actor's orders for IMPOSSIBLE actions.
An action is IMPOSSIBLE (not merely infeasible) if it:
1. Requires physical capabilities the unit does not possess (infantry flying, vehicles swimming oceans, units teleporting between distant hexes in a single turn)
2. Requires technology that does not exist in the scenario's setting or era
3. Violates fundamental physical laws

For IMPOSSIBLE actions:
- Do NOT generate an outcome. The action does not occur.
- Set feasibility to "impossible" and explain why.
- Do NOT generate state_updates for impossible actions.
- Describe the realistic response: competent officers refuse impossible orders. The unit holds position or takes a sensible default action (defend, hold, maintain).
- This is DISTINCT from "infeasible" — infeasible actions CAN be attempted (and fail badly). Impossible actions CANNOT be attempted at all.

Examples:
- "Infantry swim across the Pacific Ocean" → IMPOSSIBLE
- "Infantry assault fortified position at 1:5 without support" → INFEASIBLE (attempt it, fail)
- "Napoleonic cavalry conduct an airstrike" → IMPOSSIBLE
- "Attack without air superiority" → INFEASIBLE (risky but doable)`);

  // ── Resolution Guidance (always, scale-specific) ──
  sections.push(`\n## RESOLUTION GUIDANCE\n\n${RESOLUTION_GUIDANCE[scaleKey] || RESOLUTION_GUIDANCE.grand_tactical}`);

  // ── Fortune of War (chaos dice) ──
  sections.push(`\n## FORTUNE OF WAR (CHAOS DICE)

Each turn, per-actor fortune rolls (1-100) and a wild card roll are generated BEFORE your adjudication. These represent the irreducible randomness of conflict — fog of war, equipment reliability, weather microeffects, human error, lucky breaks.

You MUST incorporate fortune rolls into your adjudication:
- Low rolls (1-20): Something goes wrong for that actor beyond what the plan's weaknesses would suggest. Identify a specific, plausible mishap appropriate to the scale and situation.
- Mid rolls (21-80): Fortune is roughly neutral. Adjudicate based on plan quality and game state alone.
- High rolls (81-100): Something goes unexpectedly right. Identify a specific, plausible benefit. This should NOT override fundamentally flawed plans — a lucky break on a suicidal attack still results in failure, just less catastrophically.

Wild card events (when triggered) introduce an element NEITHER player planned for. Weave it into the narrative and state updates.

IMPORTANT: Fortune rolls modify outcomes at the margins. They do NOT override physics, logistics, or force ratios. A roll of 100 does not make an impossible action succeed. A roll of 1 does not destroy a well-positioned, well-supplied force. They add texture and unpredictability.`);

  // ── Friction Events ──
  sections.push(`\n## FRICTION EVENTS

Each turn, 1-3 friction events are generated representing the unpredictable complications of conflict. These are FACTS about what has happened or is happening this turn. They are NOT suggestions — you MUST incorporate them into your adjudication.

For each friction event:
1. Acknowledge it in situation_assessment or action_interpretation
2. Factor it into feasibility_analysis where relevant
3. Reflect its impact in outcome_determination narrative and state_updates

Friction events may affect one specific actor or all actors. They range from minor inconveniences to significant complications. Some may be beneficial (e.g., captured intelligence, enemy mistakes).

Do NOT ignore friction events. Do NOT invent additional friction events beyond those provided. Treat them as ground truth.`);

  // ── Anti-Sycophancy D.2 (always) ──
  sections.push(`\n## ANTI-SYCOPHANCY INSTRUCTIONS [D.2]

Evaluate each action as if you are a third-party review panel assessing a submitted operational plan — not a collaborator helping players succeed.

Mandatory requirements:
- You MUST identify at least one weakness, risk, or limitation for EVERY player action in the weaknesses_identified field, regardless of how well-argued or reasonable the action appears.
- A player's justification for their action is NOT sufficient basis for a favorable assessment. You must independently verify plausibility against the reference data and game state.
- If an action is implausible given the current state (unit capabilities, terrain, logistics${scaleTier >= 4 ? ", political constraints" : ""}), assign "low" or "infeasible" feasibility. Do not soften the assessment.
- Treat each actor's actions with equal scrutiny. Do not favor the actor whose action you process first or whose framing is more persuasive.`);

  // ── De-Escalation Reflection D.3 (tiers 4-6 only) ──
  if (scaleTier >= 4) {
    sections.push(`\n## DE-ESCALATION REFLECTION [D.3]

For EVERY adjudication, you MUST complete the de_escalation_assessment section. This is mandatory even during active combat.

Before determining outcomes, explicitly consider:
1. What de-escalation options are currently available to the involved actors?
2. Which diplomatic off-ramps are being closed or opened by this turn's actions?
3. What is the historical base rate for conflicts at this escalation level? Do they typically escalate or de-escalate?
4. Reference the escalation framework document to identify the current level and direction.

This requirement exists to counteract documented LLM escalation bias. You are not required to bias toward de-escalation — you are required to explicitly consider the full range of plausible responses.`);
  }

  // ── Citation Requirements D.4 (always) ──
  sections.push(`\n## CITATION REQUIREMENTS [D.4]

Every feasibility assessment and outcome determination MUST cite specific sources:
- [state: entity_id.attribute] — reference to current game state
- [scenario: section_name] — reference to scenario data (actors, objectives, constraints, initial conditions)${scaleTier >= 4 ? "\n- [corpus: document_name] — reference to corpus documents (escalation framework, adjudicator guidance)" : "\n- [corpus: document_name] — reference to corpus documents (adjudicator guidance)"}
- [terrain: grid_reference] — reference to terrain data

If you cannot cite a specific source for a factual claim, state that explicitly rather than asserting it as fact. Unsourced claims should be flagged in meta.ambiguities.`);

  // ── Output Format D.6 (always, but sections vary) ──
  const outputSections = [
    "1. **adjudication.situation_assessment** — Summarize the relevant current state",
    "2. **adjudication.action_interpretation** — Restate each actor's action in precise terms",
    "3. **adjudication.feasibility_analysis** — Assess each action's feasibility with citations and weaknesses",
  ];

  if (scaleTier >= 4) {
    outputSections.push("4. **adjudication.de_escalation_assessment** — Mandatory escalation/de-escalation analysis");
  }

  outputSections.push(
    `${scaleTier >= 4 ? "5" : "4"}. **adjudication.outcome_determination** — What happens, with narrative and probability`,
    `${scaleTier >= 4 ? "6" : "5"}. **adjudication.state_updates** — Specific, atomic state changes (entity, attribute, old_value, new_value, justification)`,
    `${scaleTier >= 4 ? "7" : "6"}. **meta** — Confidence level, moderator notes, ambiguities`,
  );

  sections.push(`\n## OUTPUT FORMAT [D.6]

Respond with a single JSON object containing these sections IN ORDER:

${outputSections.join("\n")}`);

  // ── Behavioral Constraints (always) ──
  sections.push(`\n## BEHAVIORAL CONSTRAINTS

- Do NOT invent units, capabilities, events, or conditions not established in the game state or scenario data.
- Do NOT perform mathematical calculations for combat outcomes. Use the resolution guidance anchors qualitatively and provide proportional state updates.
- When multiple actors take simultaneous actions, resolve them as collisions between independently planned actions. Neither actor has first-mover advantage.
- Do NOT reference your training data for specific military outcomes — use only the provided reference materials and resolution guidance.
- If you lack sufficient information to determine a definitive outcome, say so in meta.ambiguities. A qualified assessment is more useful than a confident fabrication.
- State update positions MUST use Excel-style cell references (e.g., "H4", not "7,3"). This matches the coordinate system used throughout this prompt.`);

  return sections.join("\n");
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
    const unitLines = actorUnits.map(u => {
      let line = `  - ${u.name} (${u.type}`;
      if (u.echelon) line += `, ${u.echelon}`;
      line += `): position ${positionToLabel(u.position)}, strength ${u.strength}%, supply ${u.supply}%, status: ${u.status}`;
      if (u.posture && u.posture !== "ready") line += `, posture: ${u.posture}`;
      if (u.morale !== undefined && u.morale !== 100) line += `, morale: ${u.morale}%`;
      if (u.ammo !== undefined && u.ammo !== 100) line += `, ammo: ${u.ammo}%`;
      if (u.fuel !== undefined && u.fuel !== 100) line += `, fuel: ${u.fuel}%`;
      if (u.entrenchment !== undefined && u.entrenchment > 0) line += `, entrenched: ${u.entrenchment}%`;
      if (u.movementType && u.movementType !== "foot") line += `, ${u.movementType}`;
      if (u.taskOrg) line += `, task org: ${u.taskOrg}`;
      return line;
    });
    unitSummary = `\nCurrent disposition of ${actorName} forces:\n${unitLines.join("\n")}`;
  }

  return `INTELLIGENCE REPORT — ${actorName}
${actorName} has issued the following orders: ${actionText}
${unitSummary}
Assess the feasibility and likely outcomes of these orders based on current game state, terrain, and reference data.`;
}

// ── Position helpers ─────────────────────────────────────────

// Convert any position format to {col, row} numbers.
// Handles "7,3" (comma format from presets) and "H4" (Excel label).
export function parsePosition(posStr) {
  if (!posStr) return null;
  const comma = posStr.match(/^(\d+),(\d+)$/);
  if (comma) return { col: parseInt(comma[1]), row: parseInt(comma[2]) };
  return labelToColRow(posStr);
}

// Always output Excel-style labels for LLM prompt consistency.
export function positionToLabel(posStr) {
  const p = parsePosition(posStr);
  return p ? cellCoord(p.col, p.row) : posStr;
}

// Convert an Excel-style label ("H4") back to comma format ("7,3") for internal state.
export function labelToCommaPosition(label) {
  const p = labelToColRow(label);
  return p ? `${p.col},${p.row}` : label;
}

// ── Terrain Summary Builder ─────────────────────────────────

const TERRAIN_LABELS = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", forested_hills: "Forested Hills", mountain_forest: "Mtn Forest",
  mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert", ice: "Ice/Glacier",
  light_urban: "Light Urban", dense_urban: "Dense Urban",
  jungle: "Jungle", jungle_hills: "Jungle Hills", jungle_mountains: "Jungle Mtns",
  boreal: "Boreal", boreal_hills: "Boreal Hills", boreal_mountains: "Boreal Mtns",
  tundra: "Tundra", savanna: "Savanna", savanna_hills: "Savanna Hills",
  mangrove: "Mangrove",
};

// Tier 2: Decoded terrain at each unit position + immediate neighbors.
// Now passes scaleTier through to formatCellDetail for feature filtering.
function buildTier2UnitContext(terrainData, units, scaleTier) {
  if (!units?.length) return [];
  const D = terrainData;
  const lines = ["UNIT-LOCAL TERRAIN (pre-decoded at each unit position + neighbors):"];
  const seen = new Set();

  for (const u of units) {
    const pos = parsePosition(u.position);
    if (!pos) continue;

    const key = `${pos.col},${pos.row}`;
    const cell = D.cells[key];
    lines.push(`  ${u.name} at ${cellCoord(pos.col, pos.row)}:`);
    lines.push(`    ${formatCellDetail(pos.col, pos.row, cell, scaleTier)}`);
    seen.add(key);

    // 6 hex neighbors — gives local tactical picture
    const neighbors = getNeighbors(pos.col, pos.row);
    const neighborDetails = [];
    for (const [nc, nr] of neighbors) {
      if (nc < 0 || nc >= D.cols || nr < 0 || nr >= D.rows) continue;
      const nk = `${nc},${nr}`;
      if (seen.has(nk)) {
        neighborDetails.push(cellCoord(nc, nr) + "(above)");
        continue;
      }
      seen.add(nk);
      neighborDetails.push(formatCellDetail(nc, nr, D.cells[nk], scaleTier));
    }
    if (neighborDetails.length) lines.push(`    neighbors: ${neighborDetails.join("; ")}`);
  }

  return { lines, seen };
}

// Tier 3: Broader terrain around action-referenced locations.
function buildTier3ActionContext(terrainData, actionTexts, tier2Cells, scaleTier) {
  const D = terrainData;
  const allText = Object.values(actionTexts).join(" ");
  if (!allText.trim()) return [];

  // Extract Excel-style cell references (e.g. "H4", "AA12") from action text
  const cellRefs = [...allText.matchAll(/\b([A-Z]{1,3})(\d{1,3})\b/g)]
    .map(m => labelToColRow(m[0]))
    .filter(p => p && p.col >= 0 && p.col < D.cols && p.row >= 0 && p.row < D.rows);

  // Find named features (proper nouns like "Stonebrook") mentioned in action text
  const namedLocations = [];
  for (const key in D.cells) {
    const fn = D.cells[key]?.feature_names;
    if (!fn) continue;
    for (const name of Object.values(fn)) {
      if (name.length >= 3 && allText.toLowerCase().includes(name.toLowerCase())) {
        const [c, r] = key.split(",").map(Number);
        namedLocations.push({ col: c, row: r });
      }
    }
  }

  // Decode cells in radius-2 around each referenced location, skipping Tier 2 cells
  const extraCells = new Set();
  for (const loc of [...cellRefs, ...namedLocations]) {
    const ring = hexRange(loc.col, loc.row, 2);
    for (const { col, row } of ring) {
      const k = `${col},${row}`;
      if (col >= 0 && col < D.cols && row >= 0 && row < D.rows && !tier2Cells.has(k)) {
        extraCells.add(k);
      }
    }
  }

  if (extraCells.size === 0) return [];
  const lines = ["ACTION-REFERENCED TERRAIN:"];
  for (const k of extraCells) {
    const [c, r] = k.split(",").map(Number);
    lines.push(`  ${formatCellDetail(c, r, D.cells[k], scaleTier)}`);
  }
  return lines;
}

/**
 * Build tiered terrain context for LLM adjudication.
 * Now accepts scaleTier to filter features and collapse terrain types.
 *
 * Tier 1 (always): Aggregate stats, elevation bands, feature regions, named features.
 * Tier 2 (when units present): Pre-decoded cells at unit positions + neighbors.
 * Tier 3 (when actions present): Pre-decoded cells around action-referenced locations.
 */
export function buildTerrainSummary(terrainData, { units = [], actionTexts = {}, scaleTier = null } = {}) {
  if (!terrainData) return "No terrain data loaded.";

  const D = terrainData;
  const lines = [];

  // ── Tier 1: Aggregate context ──
  lines.push(`TERRAIN MAP: ${D.cols}\u00D7${D.rows} cells, ${D.cellSizeKm}km/cell`);
  if (D.center) lines.push(`Center: ${D.center.lat.toFixed(4)}, ${D.center.lng.toFixed(4)}`);
  if (D.bbox) lines.push(`Bounds: S${D.bbox.south.toFixed(4)} N${D.bbox.north.toFixed(4)} W${D.bbox.west.toFixed(4)} E${D.bbox.east.toFixed(4)}`);
  lines.push(`Map size: ${D.widthKm || (D.cols * D.cellSizeKm)}km x ${D.heightKm || Math.round(D.rows * D.cellSizeKm * (Math.sqrt(3) / 2))}km`);
  lines.push("COORDINATES: Columns A-Z, AA-AZ, etc. (left=west). Rows 1-N (row 1=north). Cell H4 = column H, row 4.");

  // Terrain distribution — collapse types at higher tiers
  const terrCt = {};
  for (const k in D.cells) {
    const rawType = D.cells[k].terrain;
    const displayType = (scaleTier && scaleTier >= 4)
      ? getTerrainLabelForTier(rawType, scaleTier)
      : (TERRAIN_LABELS[rawType] || rawType);
    terrCt[displayType] = (terrCt[displayType] || 0) + 1;
  }
  const total = Object.values(terrCt).reduce((s, v) => s + v, 0);

  lines.push("");
  lines.push("TERRAIN DISTRIBUTION:");
  Object.entries(terrCt)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => {
      lines.push(`  ${t.padEnd(16)} ${((n / total) * 100).toFixed(1)}% (${n} cells)`);
    });

  // Elevation: geographic narrative at tier 4+, raw bands at tier 1-3
  if (scaleTier && scaleTier >= 4) {
    const elevLines = buildElevationNarrative(D, scaleTier);
    if (elevLines.length > 0) {
      lines.push("");
      lines.push(...elevLines);
    }
  } else {
    const elevLines = buildElevationBands(D);
    if (elevLines.length > 0) {
      lines.push("");
      lines.push(...elevLines);
    }
  }

  // Feature regions — tier-filtered to reduce noise at higher scales
  const featLines = buildFeatureRegions(D, scaleTier);
  if (featLines.length > 0) {
    lines.push("");
    lines.push(...featLines);
  }

  const namedLines = buildNamedFeatures(D);
  if (namedLines.length > 0) {
    lines.push("");
    lines.push(...namedLines);
  }

  // ── Tier 2: Pre-decoded cells at unit positions + neighbors ──
  const tier2 = buildTier2UnitContext(D, units, scaleTier);
  if (tier2.lines?.length) {
    lines.push("");
    lines.push(...tier2.lines);
  }

  // ── Tier 3: Pre-decoded cells around action-referenced locations ──
  if (Object.keys(actionTexts).length > 0) {
    const tier3Lines = buildTier3ActionContext(D, actionTexts, tier2.seen || new Set(), scaleTier);
    if (tier3Lines.length > 0) {
      lines.push("");
      lines.push(...tier3Lines);
    }
  }

  return lines.join("\n");
}

// ── Full Adjudication Prompt Builder ────────────────────────

/**
 * Assemble the complete user prompt for an adjudication call.
 * Now scale-aware: filters sections based on game scale tier.
 */
export function buildAdjudicationPrompt({ scenario, gameState, terrainData, actions, corpus, playerActions, fortuneRolls, frictionEvents }) {
  const sections = [];
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;

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
  // Only show escalation level at operational+ scale
  if (scaleTier >= 4 && scenario.escalationLevel) {
    sections.push(`Current escalation level: ${scenario.escalationLevel}`);
  }
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

  // Terrain summary (scale-filtered)
  sections.push("");
  sections.push("═══ TERRAIN ═══");
  sections.push(buildTerrainSummary(terrainData, {
    units: gameState.units,
    actionTexts: playerActions || {},
    scaleTier,
  }));

  // Current game state
  sections.push("");
  sections.push("═══ CURRENT GAME STATE ═══");
  sections.push(`Turn: ${gameState.game.turn}`);
  sections.push(`Phase: ${gameState.game.phase}`);
  if (gameState.game.currentDate) {
    sections.push(`Simulation Date: ${gameState.game.currentDate}`);
  }

  // Environment conditions
  if (gameState.environment) {
    const env = gameState.environment;
    const envParts = [];
    if (env.weather) envParts.push(`Weather: ${env.weather}`);
    if (env.visibility) envParts.push(`Visibility: ${env.visibility}`);
    if (env.groundCondition) envParts.push(`Ground: ${env.groundCondition.replace(/_/g, " ")}`);
    if (env.timeOfDay) envParts.push(`Time of Day: ${env.timeOfDay}`);
    if (envParts.length > 0) {
      sections.push(`Environment: ${envParts.join(", ")}`);
    }
  }

  if (gameState.units && gameState.units.length > 0) {
    sections.push("");
    sections.push("Units:");
    for (const u of gameState.units) {
      let unitLine = `  ${u.id} | ${u.name} (${u.type}`;
      if (u.echelon) unitLine += `, ${u.echelon}`;
      unitLine += `) | Actor: ${u.actor} | Position: ${positionToLabel(u.position)} | Strength: ${u.strength}% | Supply: ${u.supply}%`;
      if (u.posture) unitLine += ` | Posture: ${u.posture}`;
      unitLine += ` | Status: ${u.status}`;
      // Scale-conditional attributes
      if (u.morale !== undefined && u.morale !== 100) unitLine += ` | Morale: ${u.morale}%`;
      if (u.ammo !== undefined && u.ammo !== 100) unitLine += ` | Ammo: ${u.ammo}%`;
      if (u.fuel !== undefined && u.fuel !== 100) unitLine += ` | Fuel: ${u.fuel}%`;
      if (u.fatigue !== undefined && u.fatigue > 0) unitLine += ` | Fatigue: ${u.fatigue}%`;
      if (u.entrenchment !== undefined && u.entrenchment > 0) unitLine += ` | Entrenchment: ${u.entrenchment}%`;
      if (u.movementType && u.movementType !== "foot") unitLine += ` | Movement: ${u.movementType}`;
      if (u.parentHQ) unitLine += ` | HQ: ${u.parentHQ}`;
      if (u.taskOrg) unitLine += ` | TaskOrg: ${u.taskOrg}`;
      if (u.notes) unitLine += ` | Notes: ${u.notes}`;
      sections.push(unitLine);
    }
  }

  // Supply network (Tier 3+)
  if (scaleTier >= 3 && gameState.supplyNetwork && Object.keys(gameState.supplyNetwork).length > 0) {
    sections.push("");
    sections.push("Supply Network:");
    for (const [actorId, net] of Object.entries(gameState.supplyNetwork)) {
      const actorName = scenario.actors.find(a => a.id === actorId)?.name || actorId;
      if (net.depots?.length > 0) {
        for (const d of net.depots) {
          sections.push(`  ${actorName} depot "${d.name}" at ${positionToLabel(d.position)}: ${d.current}/${d.capacity} supply points`);
        }
      }
      sections.push(`  ${actorName} resupply rate: ${net.resupplyRate} points/turn`);
    }
  }

  // Diplomacy (only at tier 4+)
  if (scaleTier >= 4 && gameState.diplomacy && Object.keys(gameState.diplomacy).length > 0) {
    sections.push("");
    sections.push("Diplomatic State:");
    for (const [pair, rel] of Object.entries(gameState.diplomacy)) {
      const [aId, bId] = pair.split("-");
      const aName = scenario.actors.find(a => a.id === aId)?.name || aId;
      const bName = scenario.actors.find(a => a.id === bId)?.name || bId;
      let dipLine = `  ${aName} ↔ ${bName}: ${rel.status || "unknown"}`;
      if (rel.channels && rel.channels[0] !== "none") dipLine += ` (channels: ${rel.channels.join(", ")})`;
      if (rel.agreements?.length > 0) dipLine += ` [${rel.agreements.length} agreement(s)]`;
      sections.push(dipLine);
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

  // Fortune of war (chaos dice)
  if (fortuneRolls) {
    sections.push("");
    sections.push("═══ FORTUNE OF WAR (Turn " + gameState.game.turn + ") ═══");
    sections.push("Per-actor fortune rolls:");
    for (const actor of scenario.actors) {
      const r = fortuneRolls.actorRolls?.[actor.id];
      if (r) sections.push(`  ${actor.name} (${actor.id}): ${r.roll} — ${r.descriptor}`);
    }
    if (fortuneRolls.wildCard?.triggered) {
      sections.push(`\nWild card: ${fortuneRolls.wildCard.roll} — TRIGGERED: ${fortuneRolls.wildCard.descriptor}`);
    } else if (fortuneRolls.wildCard) {
      sections.push(`\nWild card: ${fortuneRolls.wildCard.roll} — Not triggered`);
    }
  }

  // Friction events
  if (frictionEvents?.events?.length > 0) {
    sections.push("");
    sections.push("═══ FRICTION EVENTS (Turn " + gameState.game.turn + ") ═══");
    sections.push("These events have already occurred — incorporate into your adjudication:");
    for (let i = 0; i < frictionEvents.events.length; i++) {
      const evt = frictionEvents.events[i];
      const posTag = evt.positive ? ", POSITIVE" : "";
      const actorTag = evt.affectedActor
        ? `Affects: ${scenario.actors.find(a => a.id === evt.affectedActor)?.name || evt.affectedActor}`
        : "Affects: all actors";
      sections.push(`${i + 1}. [${evt.severity.toUpperCase()}] ${evt.text} (${actorTag}${posTag})`);
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
  sections.push(JSON.stringify(getSchemaForScale(scaleTier), null, 2));

  return sections.join("\n");
}

// ── Scale-Conditional Schema Example ────────────────────────
// Adjusts the schema example shown to the LLM based on scale tier.

function getSchemaForScale(scaleTier) {
  if (scaleTier >= 4) {
    // Full schema with de-escalation assessment
    return ADJUDICATION_SCHEMA_EXAMPLE;
  }

  // Tiers 1-3: remove de_escalation_assessment from schema example
  const { de_escalation_assessment, ...adjWithout } = ADJUDICATION_SCHEMA_EXAMPLE.adjudication;
  return {
    adjudication: adjWithout,
    meta: ADJUDICATION_SCHEMA_EXAMPLE.meta,
  };
}

// ── Rebuttal Prompt Builder ─────────────────────────────────

/**
 * Build a rebuttal prompt for the challenge phase.
 * Rebuttals are per-actor text challenging the adjudication's feasibility assessment.
 * Heavy anti-sycophancy framing to prevent the LLM from caving to player pressure.
 *
 * @param {Object} rebuttals - { actorId: "rebuttal text", ... }
 * @param {Array} actors - scenario actors array
 * @returns {string} formatted rebuttal prompt
 */
export function buildRebuttalPrompt(rebuttals, actors) {
  const lines = [];

  lines.push(`═══ PLAYER REBUTTALS ═══`);
  lines.push(``);
  lines.push(`One or more players have challenged your feasibility assessment. Review their arguments below.`);
  lines.push(``);
  lines.push(`CRITICAL INSTRUCTIONS FOR HANDLING REBUTTALS:`);
  lines.push(`- You are NOT obligated to change your assessment. Most rebuttals should be rejected.`);
  lines.push(`- Only adjust your assessment if the player identifies a SPECIFIC FACTUAL ERROR in your reasoning or points to CONCRETE DATA in the game state that you overlooked.`);
  lines.push(`- Rhetorical arguments, emotional appeals, claims of "realism," and appeals to player intent do NOT warrant changes.`);
  lines.push(`- "My plan is good because I said so" is not a valid rebuttal. The player must identify what SPECIFIC FACT you got wrong.`);
  lines.push(`- If you maintain your assessment, explain clearly why the rebuttal was insufficient.`);
  lines.push(`- If you DO change an assessment, explain exactly which factual error or overlooked data caused the change.`);
  lines.push(`- Do NOT change outcome_determination or state_updates unless a feasibility change logically requires it.`);
  lines.push(``);

  for (const [actorId, rebuttalText] of Object.entries(rebuttals)) {
    if (!rebuttalText?.trim()) continue;
    const actor = actors.find(a => a.id === actorId);
    const actorName = actor?.name || actorId;
    lines.push(`── Rebuttal from ${actorName} ──`);
    lines.push(rebuttalText.trim());
    lines.push(``);
  }

  lines.push(`Respond with a COMPLETE adjudication JSON (same schema as before). If no changes are warranted, return the same adjudication. Your response must be valid JSON only.`);

  return lines.join("\n");
}
