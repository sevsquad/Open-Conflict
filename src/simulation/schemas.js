// ═══════════════════════════════════════════════════════════════
// SCHEMAS & VALIDATION — Game state and LLM adjudication output
// ═══════════════════════════════════════════════════════════════

// ── Scale Tiers ──────────────────────────────────────────────
// Determines what data, rules, and UI elements are relevant.

export const SCALE_TIERS = {
  sub_tactical:  { key: "sub_tactical",  tier: 1, label: "Sub-Tactical",  hexRange: "50-200m",  turnRange: "1-5 min",    echelons: ["fireteam", "squad"],                                defaultTurn: "5 minutes" },
  tactical:      { key: "tactical",      tier: 2, label: "Tactical",      hexRange: "200m-2km", turnRange: "15 min-2 hr", echelons: ["platoon", "company"],                               defaultTurn: "1 hour" },
  grand_tactical:{ key: "grand_tactical",tier: 3, label: "Grand Tactical",hexRange: "2-5km",    turnRange: "2-8 hr",     echelons: ["battalion", "brigade"],                              defaultTurn: "4 hours" },
  operational:   { key: "operational",   tier: 4, label: "Operational",   hexRange: "5-10km",   turnRange: "12-48 hr",   echelons: ["division", "corps"],                                 defaultTurn: "1 day" },
  strategic:     { key: "strategic",     tier: 5, label: "Strategic",     hexRange: "10-20km",  turnRange: "2-7 days",   echelons: ["corps", "army"],                                     defaultTurn: "3 days" },
  theater:       { key: "theater",       tier: 6, label: "Theater",       hexRange: "20km+",    turnRange: "1 wk-1 mo",  echelons: ["army_group", "national_forces", "coalition_command"], defaultTurn: "1 week" },
};

export const SCALE_KEYS = Object.keys(SCALE_TIERS);

// Which systems are active at each tier (min tier where system appears)
export const SCALE_SYSTEMS = {
  escalation_framework: 4,  // Tiers 4-6
  diplomacy:            4,  // Tiers 4-6
  de_escalation:        4,  // Tiers 4-6 (mandatory assessment)
  supply_network:       3,  // Tiers 3-6
  command_hierarchy:    3,  // Tiers 3-6
  combined_arms:        3,  // Tier 3 only (key concept)
  morale:               1,  // Tiers 1-3
  fatigue:              1,  // Tiers 1-2
  ammo_tracking:        1,  // Tiers 1-3
  fuel_tracking:        2,  // Tiers 2-4
  entrenchment:         1,  // Tiers 1-3
  cohesion:             1,  // Tiers 1-3 — organizational integrity
  air_operations:       3,  // Tiers 3-6 — air mission orders, ASL, AD envelopes
};

/** Check if a system is active at a given scale tier number */
export function isSystemActive(systemKey, tierNumber, maxTier = 6) {
  const minTier = SCALE_SYSTEMS[systemKey];
  if (minTier === undefined) return false;
  // Some systems have a max tier (combined_arms is tier 3 only)
  if (systemKey === "combined_arms") return tierNumber === 3;
  if (systemKey === "fatigue") return tierNumber <= 2;
  if (systemKey === "morale") return tierNumber <= 3;
  if (systemKey === "ammo_tracking") return tierNumber <= 3;
  if (systemKey === "fuel_tracking") return tierNumber >= 2 && tierNumber <= 4;
  if (systemKey === "entrenchment") return tierNumber <= 3;
  if (systemKey === "cohesion") return tierNumber <= 3;
  return tierNumber >= minTier && tierNumber <= maxTier;
}

// ── Unit Branch / Echelon / Posture ─────────────────────────

// Echelons available at each scale tier
export const SCALE_ECHELONS = {
  sub_tactical:   ["fireteam", "squad", "weapons_team", "sniper_team"],
  tactical:       ["squad", "platoon", "company", "mortar_section", "anti_tank_team", "forward_observer"],
  grand_tactical: ["company", "battalion", "battle_group", "brigade", "artillery_battery", "engineer_company"],
  operational:    ["brigade", "division", "corps_asset", "aviation_brigade"],
  strategic:      ["corps", "army", "air_force_wing", "naval_task_force"],
  theater:        ["army_group", "national_forces", "coalition_command"],
};

// Which unit branches (the `type` field) are relevant at each scale [minTier, maxTier]
export const BRANCH_SCALE_RELEVANCE = {
  infantry:       [1, 6],
  mechanized:     [2, 5],
  armor:          [2, 5],
  artillery:      [2, 6],
  recon:          [1, 5],
  air:            [3, 6],
  naval:          [2, 6],
  special_forces: [1, 4],
  logistics:      [2, 6],
  headquarters:   [2, 6],
  engineer:       [2, 5],
  air_defense:    [3, 6],
  other:          [1, 6],
  parachute_infantry: [1, 4],  // Airborne infantry (WW2+)
  glider_infantry:    [1, 4],  // Glider-delivered infantry (WW2)
  tank_destroyer:     [2, 5],  // Purpose-built AT vehicles (WW2+)
  armored_infantry:   [2, 5],  // Half-track/APC mounted infantry (WW2+)
};

// Valid postures
export const POSTURES = [
  "ready", "attacking", "defending", "moving", "dug_in", "retreating", "reserve", "routing",
];

// Display labels for echelons
export const ECHELON_LABELS = {
  fireteam: "Fireteam", squad: "Squad", weapons_team: "Weapons Team", sniper_team: "Sniper Team",
  platoon: "Platoon", company: "Company", mortar_section: "Mortar Section",
  anti_tank_team: "AT Team", forward_observer: "Forward Observer",
  battalion: "Battalion", battle_group: "Battle Group", brigade: "Brigade",
  artillery_battery: "Arty Battery", engineer_company: "Engineer Co.",
  division: "Division", corps_asset: "Corps Asset", aviation_brigade: "Aviation Bde",
  corps: "Corps", army: "Army", air_force_wing: "Air Force Wing", naval_task_force: "Naval TF",
  army_group: "Army Group", national_forces: "National Forces", coalition_command: "Coalition Cmd",
};

/** Get branches relevant to a scale key */
export function getBranchesForScale(scaleKey) {
  const tier = SCALE_TIERS[scaleKey]?.tier || 3;
  return Object.entries(BRANCH_SCALE_RELEVANCE)
    .filter(([, [min, max]]) => tier >= min && tier <= max)
    .map(([branch]) => branch);
}

/** Get echelons available at a scale key */
export function getEchelonsForScale(scaleKey) {
  return SCALE_ECHELONS[scaleKey] || SCALE_ECHELONS.grand_tactical;
}

/** Get the default echelon for a scale (the primary maneuver echelon) */
export function getDefaultEchelon(scaleKey) {
  const echelons = getEchelonsForScale(scaleKey);
  // Second entry is typically the main maneuver echelon
  return echelons[1] || echelons[0] || "battalion";
}

// ── Adjudication output schema example (included in LLM prompt) ──

export const ADJUDICATION_SCHEMA_EXAMPLE = {
  adjudication: {
    situation_assessment: {
      current_state_summary: "Brief summary of relevant game state",
      key_terrain_factors: "Terrain considerations affecting this turn",
      active_conditions: ["Ongoing effects from prior turns"]
    },
    action_interpretation: {
      actions_received: [
        {
          actor: "actor_id",
          action_summary: "Third-person summary of what was ordered",
          intent_assessment: "Adjudicator's interpretation of the action's purpose"
        }
      ]
    },
    feasibility_analysis: {
      assessments: [
        {
          actor: "actor_id",
          action: "Which action is being assessed",
          feasibility: "high | moderate | low | infeasible | impossible",
          reasoning: "Why this feasibility rating",
          citations: ["[source_type: source_name] references to corpus, scenario, or state"],
          weaknesses_identified: ["At least one weakness, risk, or limitation (REQUIRED)"]
        }
      ]
    },
    de_escalation_assessment: {
      current_escalation_level: "Level from escalation framework",
      escalation_direction: "escalating | stable | de-escalating",
      de_escalation_options_available: ["Specific de-escalation paths not taken"],
      diplomatic_offramps_status: "Which diplomatic options remain open or were closed",
      historical_base_rate: "In comparable historical situations, what typically happened"
    },
    outcome_determination: {
      narrative: "Vivid narrative of what happens this turn — describe the key events, engagements, and turning points",
      outcome_type: "success | partial_success | failure | mixed | unintended_consequences",
      probability_assessment: "How likely this outcome was, with justification",
      key_interactions: "How simultaneous actions from multiple actors interacted"
      // NOTE: Do NOT include fortune_effects — that data is already in the prompt. Do not echo it back.
    },
    state_updates: [
      {
        entity: "unit_id or state category",
        attribute: "which field changes",
        old_value: "current value",
        new_value: "proposed new value (clamp numerics to valid ranges; do not propose then correct — propose the correct value once)",
        justification: "Why this change follows from the adjudication"
      }
    ],
    // Per-actor perspectives — each actor gets a narrative describing ONLY what they observe.
    // Keyed by actor ID. Required when detection context is provided.
    actor_perspectives: {
      "actor_id": {
        narrative: "What this actor observes happening this turn (fog-of-war filtered)",
        known_enemy_actions: "Observable enemy activity from this actor's viewpoint",
        intel_assessment: "Summary of what this actor's intelligence picture looks like",
        detection_resolutions: [
          {
            unitId: "enemy_unit_id",
            detected: true,
            description: "How/why this unit was or was not detected"
          }
        ]
      }
    }
  },
  meta: {
    confidence: "high | moderate | low",
    notes: "Anything to flag for the moderator (optional)"
  }
};

// ── Validation helpers ──

const VALID_FEASIBILITY = new Set(["high", "moderate", "low", "infeasible", "impossible"]);
const VALID_OUTCOME_TYPE = new Set(["success", "partial_success", "failure", "mixed", "unintended_consequences"]);
const VALID_ESCALATION_DIR = new Set(["escalating", "stable", "de-escalating"]);
const VALID_CONFIDENCE = new Set(["high", "moderate", "low"]);

/**
 * Validate an LLM adjudication response. Returns { valid, errors }.
 * Phase 1: structural checks only (no JSON Schema library).
 */
export function validateAdjudication(response, { scaleTier = 3 } = {}) {
  const errors = [];

  if (!response || typeof response !== "object") {
    return { valid: false, errors: ["Response is not an object"] };
  }

  const adj = response.adjudication;
  if (!adj || typeof adj !== "object") {
    errors.push("Missing 'adjudication' top-level field");
    return { valid: false, errors };
  }

  // 1. situation_assessment
  if (!adj.situation_assessment) {
    errors.push("Missing adjudication.situation_assessment");
  } else {
    if (!adj.situation_assessment.current_state_summary) errors.push("Missing situation_assessment.current_state_summary");
  }

  // 2. action_interpretation
  if (!adj.action_interpretation) {
    errors.push("Missing adjudication.action_interpretation");
  } else if (!Array.isArray(adj.action_interpretation.actions_received) || adj.action_interpretation.actions_received.length === 0) {
    errors.push("action_interpretation.actions_received must be a non-empty array");
  }

  // 3. feasibility_analysis
  if (!adj.feasibility_analysis) {
    errors.push("Missing adjudication.feasibility_analysis");
  } else if (!Array.isArray(adj.feasibility_analysis.assessments) || adj.feasibility_analysis.assessments.length === 0) {
    errors.push("feasibility_analysis.assessments must be a non-empty array");
  } else {
    for (const a of adj.feasibility_analysis.assessments) {
      if (!a.actor) errors.push("feasibility assessment missing 'actor'");
      if (a.feasibility && !VALID_FEASIBILITY.has(a.feasibility)) {
        errors.push(`Invalid feasibility value: '${a.feasibility}'. Must be one of: ${[...VALID_FEASIBILITY].join(", ")}`);
      }
      if (!Array.isArray(a.weaknesses_identified) || a.weaknesses_identified.length === 0) {
        errors.push(`Feasibility assessment for '${a.actor || "unknown"}' must include at least one weakness_identified`);
      }
      if (!Array.isArray(a.citations) || a.citations.length === 0) {
        errors.push(`Feasibility assessment for '${a.actor || "unknown"}' must include at least one citation`);
      }
    }
  }

  // 4. de_escalation_assessment (MANDATORY at tiers 4+ — D.3)
  if (scaleTier >= 4) {
    if (!adj.de_escalation_assessment) {
      errors.push("Missing adjudication.de_escalation_assessment (REQUIRED per D.3 at this scale)");
    } else {
      if (!adj.de_escalation_assessment.current_escalation_level) errors.push("Missing de_escalation_assessment.current_escalation_level");
      if (adj.de_escalation_assessment.escalation_direction && !VALID_ESCALATION_DIR.has(adj.de_escalation_assessment.escalation_direction)) {
        errors.push(`Invalid escalation_direction: '${adj.de_escalation_assessment.escalation_direction}'`);
      }
    }
  }

  // 5. outcome_determination
  if (!adj.outcome_determination) {
    errors.push("Missing adjudication.outcome_determination");
  } else {
    if (!adj.outcome_determination.narrative) errors.push("Missing outcome_determination.narrative");
    if (adj.outcome_determination.outcome_type && !VALID_OUTCOME_TYPE.has(adj.outcome_determination.outcome_type)) {
      errors.push(`Invalid outcome_type: '${adj.outcome_determination.outcome_type}'`);
    }
  }

  // 6. state_updates
  if (!Array.isArray(adj.state_updates)) {
    errors.push("adjudication.state_updates must be an array");
  } else {
    for (const u of adj.state_updates) {
      if (!u.entity) errors.push("state_update missing 'entity'");
      if (!u.attribute) errors.push("state_update missing 'attribute'");
      if (!u.justification) errors.push("state_update missing 'justification'");
    }
  }

  // 7. actor_perspectives (soft validation — warn but don't fail for backward compat)
  if (adj.actor_perspectives && typeof adj.actor_perspectives === "object") {
    for (const [actorId, perspective] of Object.entries(adj.actor_perspectives)) {
      if (!perspective.narrative) {
        errors.push(`actor_perspectives.${actorId} missing 'narrative'`);
      }
      if (perspective.detection_resolutions && !Array.isArray(perspective.detection_resolutions)) {
        errors.push(`actor_perspectives.${actorId}.detection_resolutions must be an array`);
      }
    }
  }

  // meta
  if (response.meta) {
    if (response.meta.confidence && !VALID_CONFIDENCE.has(response.meta.confidence)) {
      errors.push(`Invalid meta.confidence: '${response.meta.confidence}'`);
    }
  }

  // Hedge language detection (warnings, not hard errors)
  const warnings = [];
  if (adj.outcome_determination?.narrative) {
    const narrative = adj.outcome_determination.narrative;
    const hedgePatterns = [
      { re: /\b(?:near|around|approximately|roughly)\s+[A-Z]{1,3}\d+/gi, label: "vague position" },
      { re: /\b(?:in the (?:area|vicinity) of)\s+[A-Z]{1,3}\d+/gi, label: "vague position" },
      { re: /\bor (?:approaches|just (?:west|east|north|south) of)\b/gi, label: "non-deterministic outcome" },
      { re: /\b(?:some disruption|minimal progress|some casualties)\b/gi, label: "unquantified effect" },
    ];
    for (const { re, label } of hedgePatterns) {
      const matches = narrative.match(re);
      if (matches) {
        for (const m of matches) {
          warnings.push(`Hedge language (${label}): "${m}"`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Convert Excel-style label ("H4") to comma format ("7,3") for validation comparison.
// Inlined here to avoid circular import with prompts.js.
function normalizePositionForValidation(val) {
  if (typeof val !== "string") return val;
  if (/^\d+,\d+$/.test(val)) return val;
  const match = val.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return val;
  const letters = match[1].toUpperCase();
  const col = letters.split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = parseInt(match[2]) - 1;
  return `${col},${row}`;
}

// Normalize a value for old_value comparison: strip "%", parse numbers.
function normalizeOldValue(val, attribute) {
  if (attribute === "position") return normalizePositionForValidation(String(val));
  if (typeof val === "string") {
    const stripped = val.replace(/%/g, "").trim();
    const num = Number(stripped);
    if (!isNaN(num)) return num;
  }
  return val;
}

/**
 * Validate proposed state updates against current game state.
 * Returns { valid, errors, warnings }.
 */
export function validateStateUpdates(stateUpdates, gameState) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(stateUpdates)) {
    return { valid: false, errors: ["state_updates is not an array"], warnings };
  }

  const unitIndex = new Map();
  if (Array.isArray(gameState.units)) {
    for (const u of gameState.units) unitIndex.set(u.id, u);
  }

  for (const update of stateUpdates) {
    const { entity, attribute, old_value } = update;

    // Check if entity is a known unit
    if (unitIndex.has(entity)) {
      const unit = unitIndex.get(entity);
      // Check old_value matches current state (normalize both sides for format tolerance)
      if (attribute in unit && old_value !== undefined && old_value !== null) {
        const normalizedOld = normalizeOldValue(old_value, attribute);
        const normalizedCurrent = normalizeOldValue(unit[attribute], attribute);
        if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedOld)) {
          errors.push(
            `State mismatch for ${entity}.${attribute}: LLM says old_value is ${JSON.stringify(old_value)}, but current state is ${JSON.stringify(unit[attribute])}`
          );
        }
      }
      // Check unit isn't destroyed/removed
      if (unit.status === "destroyed" || unit.status === "eliminated") {
        warnings.push(`Update references ${entity} which has status '${unit.status}'`);
      }
    }
    // Non-unit entities (diplomacy, etc.) get a warning only in Phase 1
    // since we don't have deep state category tracking yet
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Position Validation Helpers ─────────────────────────────
// Duplicated from HexMath/prompts to avoid circular imports.

function parsePositionForValidation(posStr) {
  if (!posStr) return null;
  const comma = String(posStr).match(/^(\d+),(\d+)$/);
  if (comma) return { col: parseInt(comma[1]), row: parseInt(comma[2]) };
  const label = String(posStr).match(/^([A-Z]+)(\d+)$/i);
  if (!label) return null;
  const letters = label[1].toUpperCase();
  const col = letters.split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = parseInt(label[2]) - 1;
  return { col, row };
}

// Hex distance via axial Chebyshev (offset → axial → max(|dq|, |dr|, |dq+dr|))
function hexDistanceForValidation(c1, r1, c2, r2) {
  // Odd-r offset to axial conversion
  const q1 = c1 - (r1 - (r1 & 1)) / 2;
  const s1 = r1;
  const q2 = c2 - (r2 - (r2 & 1)) / 2;
  const s2 = r2;
  const dq = q1 - q2, dr = s1 - s2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// Walk hex line from 'from' toward 'to', stop at 'budget' hexes (approximate)
function clampPositionToLine(from, to, budget, terrainData) {
  const dist = hexDistanceForValidation(from.col, from.row, to.col, to.row);
  if (dist <= budget) return to;
  const fraction = budget / dist;
  const col = Math.round(from.col + (to.col - from.col) * fraction);
  const row = Math.round(from.row + (to.row - from.row) * fraction);
  // Ensure clamped position is in bounds
  const clampCol = Math.max(0, Math.min(col, (terrainData?.cols || 12) - 1));
  const clampRow = Math.max(0, Math.min(row, (terrainData?.rows || 15) - 1));
  return { col: clampCol, row: clampRow };
}

function posToLabel(col, row) {
  let s = "", n = col;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s + (row + 1);
}

// Movement budgets for validation (matches orderTypes.js MOVEMENT_BUDGETS)
const VALIDATION_MOVEMENT_BUDGETS = {
  foot: 3, wheeled: 5, tracked: 4, air: 8, naval: 6, amphibious: 4, static: 0,
};

const IMPASSABLE_TERRAIN = new Set(["coastal_water", "deep_water", "lake"]);
const WATER_TERRAIN = new Set(["coastal_water", "deep_water", "lake"]);

/**
 * Validate position state updates against terrain data and movement constraints.
 * Called AFTER the LLM proposes state updates but BEFORE they're applied.
 * Catches out-of-bounds, impassable terrain, and movement budget violations.
 *
 * Returns { corrections, warnings } where corrections contain clamped positions
 * that should replace the LLM's proposals.
 */
export function validatePositionUpdates(stateUpdates, gameState, terrainData) {
  const corrections = [];
  const warnings = [];

  if (!Array.isArray(stateUpdates) || !terrainData?.cells) {
    return { corrections, warnings };
  }

  const unitIndex = new Map();
  if (Array.isArray(gameState.units)) {
    for (const u of gameState.units) unitIndex.set(u.id, u);
  }

  for (const update of stateUpdates) {
    if (update.attribute !== "position") continue;

    const unit = unitIndex.get(update.entity);
    if (!unit) continue;

    // Embarked units skip position validation — their position is managed by the transport
    if (unit.embarkedIn) continue;

    // Normalize the proposed position to col,row
    const newPosStr = update.new_value;
    const newPos = parsePositionForValidation(newPosStr);
    if (!newPos) {
      warnings.push(`${update.entity}: proposed position "${newPosStr}" is not a valid coordinate`);
      continue;
    }

    // 1. Bounds check
    if (newPos.col < 0 || newPos.col >= terrainData.cols || newPos.row < 0 || newPos.row >= terrainData.rows) {
      corrections.push({
        entity: update.entity,
        old_position: unit.position,
        proposed: newPosStr,
        corrected: posToLabel(...Object.values(parsePositionForValidation(unit.position) || { col: 0, row: 0 })),
        reason: `Out of bounds (${newPosStr} not in ${terrainData.cols}x${terrainData.rows} grid)`,
      });
      continue;
    }

    // 2. Terrain passability check
    const cellKey = `${newPos.col},${newPos.row}`;
    const cell = terrainData.cells[cellKey];
    const terrain = cell?.terrain || "open_ground";
    const movType = unit.movementType || "foot";

    if (IMPASSABLE_TERRAIN.has(terrain) && movType !== "naval" && movType !== "amphibious") {
      const curPos = parsePositionForValidation(unit.position);
      corrections.push({
        entity: update.entity,
        old_position: unit.position,
        proposed: newPosStr,
        corrected: curPos ? posToLabel(curPos.col, curPos.row) : unit.position,
        reason: `Impassable terrain (${terrain}) for ${movType} unit`,
      });
      continue;
    }

    // Naval units can't end on land hexes
    if (movType === "naval" && !WATER_TERRAIN.has(terrain)) {
      const curPos = parsePositionForValidation(unit.position);
      corrections.push({
        entity: update.entity,
        old_position: unit.position,
        proposed: newPosStr,
        corrected: curPos ? posToLabel(curPos.col, curPos.row) : unit.position,
        reason: `Naval unit cannot occupy land terrain (${terrain})`,
      });
      continue;
    }

    // 3. Movement distance vs budget check
    const currentPos = parsePositionForValidation(unit.position);
    if (currentPos) {
      const dist = hexDistanceForValidation(currentPos.col, currentPos.row, newPos.col, newPos.row);
      const budget = VALIDATION_MOVEMENT_BUDGETS[movType] || 3;

      // Allow generous 1.5x margin for roads, bridges, fortune bonuses.
      // This catches egregious violations (10 hexes on a 3-hex budget) without
      // micro-managing moves that are slightly over budget.
      if (dist > budget * 1.5) {
        const clamped = clampPositionToLine(currentPos, newPos, budget, terrainData);
        corrections.push({
          entity: update.entity,
          old_position: unit.position,
          proposed: newPosStr,
          corrected: posToLabel(clamped.col, clamped.row),
          reason: `Movement ${dist} hexes exceeds budget ${budget} x1.5 (${movType}), clamped to ${budget} hexes`,
        });
      }
    }
  }

  return { corrections, warnings };
}

// ── Time Helpers ────────────────────────────────────────────

/**
 * Parse a human-readable turn duration string into milliseconds.
 * Handles: "5 minutes", "4 hours", "1 day", "3 days", "1 week", "2 weeks", "1 month"
 * Returns 0 if unparseable.
 */
export function parseTurnDuration(str) {
  if (!str || typeof str !== "string") return 0;
  const s = str.trim().toLowerCase();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hr|hrs|hours?|days?|weeks?|months?|mo)$/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = match[2];
  if (unit.startsWith("min")) return n * 60 * 1000;
  if (unit.startsWith("h"))   return n * 3600 * 1000;
  if (unit.startsWith("d"))   return n * 86400 * 1000;
  if (unit.startsWith("w"))   return n * 7 * 86400 * 1000;
  if (unit.startsWith("mo"))  return n * 30 * 86400 * 1000;
  return 0;
}

/**
 * Advance a date string by a turn duration string.
 * Returns new ISO date string, or the original if parsing fails.
 */
export function advanceDate(isoDate, turnDuration) {
  if (!isoDate) return isoDate;
  const ms = parseTurnDuration(turnDuration);
  if (!ms) return isoDate;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return new Date(d.getTime() + ms).toISOString();
}

// ── Scale-Conditional Unit Fields ─────────────────────────
// Returns which extra fields a unit should have at a given tier.

export function getUnitFieldsForScale(tierNumber) {
  const fields = {};
  if (tierNumber <= 3) fields.morale = 100;       // Tiers 1-3
  if (tierNumber <= 2) fields.fatigue = 0;         // Tiers 1-2
  if (tierNumber <= 3) fields.ammo = 100;          // Tiers 1-3
  if (tierNumber >= 2 && tierNumber <= 4) fields.fuel = 100; // Tiers 2-4
  if (tierNumber <= 3) fields.entrenchment = 0;    // Tiers 1-3
  if (tierNumber <= 3) fields.cohesion = 100;      // Tiers 1-3
  fields.detected = true;                          // All tiers (defaults visible until fog of war)
  if (tierNumber >= 3) fields.parentHQ = "";       // Tiers 3+
  fields.movementType = "foot";                    // All tiers
  fields.specialCapabilities = [];                 // All tiers
  return fields;
}

/**
 * Extra fields for air-branch units. Applied on top of getUnitFieldsForScale().
 * Only called when the unit's baseType === "air" AND tier >= 3 (air_operations system active).
 */
export function getAirUnitFields(tierNumber) {
  const fields = {};
  if (tierNumber >= 3) fields.readiness = 100;     // Tiers 3-6 — operational readiness (0-100)
  if (tierNumber === 3) fields.fuel = 100;          // Tier 3 only — persistent helicopter fuel (0-100)
  if (tierNumber >= 3 && tierNumber <= 4) fields.munitions = 100; // Tiers 3-4 — ordnance available (0-100)
  if (tierNumber >= 4) fields.sorties = 0;          // Tiers 4-6 — computed at turn start from readiness + turn duration
  fields.baseHex = "";                              // Airfield hex where the unit is based
  return fields;
}

// Movement type options
export const MOVEMENT_TYPES = ["foot", "wheeled", "tracked", "air", "naval", "amphibious", "static"];

// ── Diplomacy ────────────────────────────────────────────────

export const DIPLOMATIC_STATUSES = ["allied", "friendly", "neutral", "tense", "hostile", "at_war"];
export const DIPLOMATIC_CHANNELS = ["direct", "back_channel", "third_party", "UN_mediated", "none"];

/**
 * Initialize diplomacy state between all actor pairs.
 * Only active at Tier 4+.
 */
export function initDiplomacy(actors, defaultStatus = "hostile") {
  const diplomacy = {};
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const key = [actors[i].id, actors[j].id].sort().join("||");
      diplomacy[key] = {
        status: defaultStatus,
        channels: ["none"],
        agreements: [],
      };
    }
  }
  return diplomacy;
}

// ── Supply Network ──────────────────────────────────────────
// Simple depot/LOC model for Tier 3+. Each actor has depots (position + capacity)
// and units consume supply each turn based on posture.

export const SUPPLY_CONSUMPTION = {
  // Per-turn supply % consumed by posture (tuned so a day of attacking ≈ 90%, survivable with resupply)
  attacking: 15, moving: 8, defending: 5, dug_in: 3, reserve: 2,
  ready: 3, retreating: 8, routing: 3,
};

/**
 * Initialize supply network for an actor.
 * Depots are placed at HQ positions by default.
 */
export function initSupplyNetwork(units, actors) {
  const network = {};
  for (const actor of actors) {
    const hq = units.find(u => u.actor === actor.id && u.type === "headquarters");
    const depots = hq ? [{ id: `depot_${actor.id}_main`, position: hq.position, capacity: 500, current: 500, name: `${actor.name} Main Depot` }] : [];
    network[actor.id] = { depots, resupplyRate: 50 }; // 50 supply points per turn replenish
  }
  return network;
}

/**
 * Calculate supply consumption for a unit based on posture and combat status.
 * Returns the amount of supply % to deduct this turn.
 */
export function getSupplyConsumption(unit) {
  const base = SUPPLY_CONSUMPTION[unit.posture] || SUPPLY_CONSUMPTION.ready;
  // Units in combat consume more
  if (unit.status === "engaged" || unit.status === "damaged") return Math.round(base * 1.5);
  return base;
}

// ── Environment Defaults ────────────────────────────────────

export const WEATHER_OPTIONS = ["clear", "overcast", "rain", "storm", "snow", "fog"];
export const VISIBILITY_OPTIONS = ["unlimited", "good", "moderate", "poor", "zero"];
export const GROUND_OPTIONS = ["dry", "wet", "muddy", "frozen", "snow_covered"];
export const TIME_OF_DAY_OPTIONS = ["dawn", "morning", "afternoon", "dusk", "night"];
export const CLIMATE_OPTIONS = ["temperate", "arctic", "desert", "tropical", "maritime", "mountain"];
export const STABILITY_OPTIONS = ["low", "medium", "high"];
export const SEVERITY_OPTIONS = ["mild", "moderate", "harsh"];

export const DEFAULT_ENVIRONMENT = {
  weather: "clear",
  visibility: "good",
  groundCondition: "dry",
  timeOfDay: "morning",
  climate: "temperate",
  stability: "medium",
  severity: "moderate",
  groundTurnsInState: 0, // tracks turns in current ground condition for persistence
};

// Climate-specific weather transition tables. Each climate is a full Markov table
// where weights represent relative probability of transitioning to each weather state.
const CLIMATE_PROFILES = {
  // Balanced mid-latitude weather — all types possible, gradual shifts
  temperate: {
    clear:    { clear: 60, overcast: 30, fog: 10 },
    overcast: { overcast: 40, clear: 20, rain: 25, fog: 10, storm: 5 },
    rain:     { rain: 40, overcast: 30, storm: 15, clear: 10, snow: 5 },
    storm:    { storm: 30, rain: 40, overcast: 25, clear: 5 },
    snow:     { snow: 50, overcast: 25, clear: 15, storm: 10 },
    fog:      { fog: 40, overcast: 30, clear: 25, rain: 5 },
  },
  // Polar/subarctic — snow dominates, rain impossible, long stable cold spells
  arctic: {
    clear:    { clear: 40, overcast: 30, snow: 20, fog: 10 },
    overcast: { overcast: 35, snow: 35, clear: 15, fog: 10, storm: 5 },
    rain:     { snow: 50, overcast: 30, storm: 15, clear: 5 },  // rain becomes snow
    storm:    { storm: 25, snow: 45, overcast: 25, clear: 5 },
    snow:     { snow: 70, overcast: 15, storm: 10, clear: 5 },
    fog:      { fog: 35, overcast: 30, snow: 20, clear: 15 },
  },
  // Arid — clear skies dominate, rain/snow nearly impossible, dawn fog possible
  desert: {
    clear:    { clear: 80, overcast: 12, fog: 8 },
    overcast: { overcast: 30, clear: 55, rain: 10, fog: 5 },
    rain:     { rain: 15, overcast: 35, clear: 45, storm: 5 },
    storm:    { storm: 10, rain: 20, overcast: 35, clear: 35 },
    snow:     { clear: 50, overcast: 30, snow: 10, fog: 10 },  // snow clears fast
    fog:      { fog: 25, clear: 55, overcast: 20 },
  },
  // Equatorial/monsoon — frequent heavy rain, high humidity fog, no snow
  tropical: {
    clear:    { clear: 35, overcast: 40, fog: 15, rain: 10 },
    overcast: { overcast: 30, rain: 40, fog: 10, clear: 10, storm: 10 },
    rain:     { rain: 45, storm: 20, overcast: 25, clear: 10 },
    storm:    { storm: 35, rain: 40, overcast: 20, clear: 5 },
    snow:     { rain: 50, overcast: 30, clear: 20 },  // snow impossible, becomes rain
    fog:      { fog: 35, overcast: 30, rain: 20, clear: 15 },
  },
  // Coastal/oceanic — overcast and fog dominate, rapid changes, moderate rain
  maritime: {
    clear:    { clear: 30, overcast: 40, fog: 20, rain: 10 },
    overcast: { overcast: 40, rain: 20, fog: 15, clear: 15, storm: 10 },
    rain:     { rain: 35, overcast: 35, storm: 10, clear: 15, fog: 5 },
    storm:    { storm: 25, rain: 35, overcast: 30, clear: 10 },
    snow:     { snow: 30, overcast: 30, rain: 20, clear: 10, fog: 10 },
    fog:      { fog: 45, overcast: 30, clear: 15, rain: 10 },
  },
  // High altitude — volatile, storms arrive fast, clear windows short
  mountain: {
    clear:    { clear: 35, overcast: 30, fog: 15, snow: 10, storm: 10 },
    overcast: { overcast: 30, storm: 20, snow: 20, rain: 15, clear: 10, fog: 5 },
    rain:     { rain: 30, storm: 25, overcast: 25, snow: 10, clear: 10 },
    storm:    { storm: 35, rain: 25, snow: 20, overcast: 15, clear: 5 },
    snow:     { snow: 45, storm: 15, overcast: 20, clear: 10, fog: 10 },
    fog:      { fog: 35, overcast: 25, clear: 20, snow: 10, rain: 10 },
  },
};

// Time of day progression based on turn duration
const TIME_PROGRESSION = ["dawn", "morning", "afternoon", "dusk", "night"];

// Visibility changes with weather
const WEATHER_VISIBILITY = {
  clear: "good", overcast: "good", rain: "moderate", storm: "poor", snow: "moderate", fog: "poor",
};

// Weather → ground condition effects (null = no immediate change)
const GROUND_WEATHER_EFFECT = {
  rain: "wet", storm: "muddy", snow: "snow_covered", clear: null, overcast: null, fog: null,
};

// How many turns of non-aggravating weather are needed to recover ground condition.
// Ground degrades instantly but recovers slowly — storms have lasting consequences.
const GROUND_RECOVERY_TURNS = {
  wet: 2,          // 2 dry turns → dry
  muddy: 2,        // 2 dry turns → wet (then 2 more → dry)
  snow_covered: 3, // 3 non-snow turns → dry (unless arctic)
  frozen: 4,       // 4 non-snow/storm turns → dry (unless arctic)
};

// Weather conditions that prevent ground from drying
const GROUND_AGGRAVATORS = {
  wet:          ["rain", "storm", "snow"],
  muddy:        ["rain", "storm"],
  snow_covered: ["snow", "storm"],
  frozen:       ["snow", "storm"],
};

// Stability multiplier for self-transition weight (how much weather persists)
const STABILITY_MULTIPLIERS = { low: 0.5, medium: 1.0, high: 2.0 };

// Severity categories — "harsh" weathers get boosted, "mild" weathers get boosted
const MILD_WEATHERS = ["clear", "overcast"];
const HARSH_WEATHERS = ["storm", "snow", "fog"];
const SEVERITY_MODIFIERS = {
  mild:     { mild: 1.3, harsh: 0.5, neutral: 1.0 },
  moderate: { mild: 1.0, harsh: 1.0, neutral: 1.0 },
  harsh:    { mild: 0.5, harsh: 1.5, neutral: 1.0 },
};

/**
 * Apply stability and severity modifiers to a base transition row.
 * Stability scales the self-transition weight (how sticky current weather is).
 * Severity shifts weight between mild (clear/overcast) and harsh (storm/snow/fog) states.
 * Returns a new object with adjusted weights, normalized to preserve total weight.
 */
function applyWeatherModifiers(transitions, currentWeather, stability, severity) {
  const stabMul = STABILITY_MULTIPLIERS[stability] || 1.0;
  const sevMods = SEVERITY_MODIFIERS[severity] || SEVERITY_MODIFIERS.moderate;

  const originalTotal = Object.values(transitions).reduce((s, w) => s + w, 0);
  const adjusted = {};

  for (const [weather, weight] of Object.entries(transitions)) {
    let w = weight;

    // Stability: scale the self-transition weight
    if (weather === currentWeather) {
      w *= stabMul;
    }

    // Severity: boost mild or harsh weathers
    if (MILD_WEATHERS.includes(weather)) {
      w *= sevMods.mild;
    } else if (HARSH_WEATHERS.includes(weather)) {
      w *= sevMods.harsh;
    } else {
      w *= sevMods.neutral;
    }

    adjusted[weather] = Math.max(w, 0.1); // keep tiny floor so nothing becomes impossible
  }

  // Renormalize to original total so the random roll logic stays consistent
  const newTotal = Object.values(adjusted).reduce((s, w) => s + w, 0);
  const scale = originalTotal / newTotal;
  for (const key of Object.keys(adjusted)) {
    adjusted[key] *= scale;
  }

  return adjusted;
}

/**
 * Progress weather/environment for a new turn.
 * Uses climate-specific Markov transitions modified by stability and severity.
 * Ground conditions persist realistically — mud doesn't dry in one turn.
 */
export function progressEnvironment(env, turnDurationMs) {
  if (!env) return { ...DEFAULT_ENVIRONMENT };
  const newEnv = { ...env };

  const climate = env.climate || "temperate";
  const stability = env.stability || "medium";
  const severity = env.severity || "moderate";

  // Get base transition table for this climate, falling back to temperate
  const profile = CLIMATE_PROFILES[climate] || CLIMATE_PROFILES.temperate;
  const baseTransitions = profile[env.weather] || profile.clear;

  // Apply stability/severity modifiers
  const transitions = applyWeatherModifiers(baseTransitions, env.weather, stability, severity);

  // Weighted random weather roll
  const totalWeight = Object.values(transitions).reduce((s, w) => s + w, 0);
  let roll = Math.random() * totalWeight;
  for (const [weather, weight] of Object.entries(transitions)) {
    roll -= weight;
    if (roll <= 0) { newEnv.weather = weather; break; }
  }

  // Visibility follows weather
  newEnv.visibility = WEATHER_VISIBILITY[newEnv.weather] || "good";

  // Ground condition: degrades instantly, recovers over multiple turns
  const groundEffect = GROUND_WEATHER_EFFECT[newEnv.weather];
  const currentGround = env.groundCondition || "dry";
  const aggravators = GROUND_AGGRAVATORS[currentGround] || [];
  const isAggravating = aggravators.includes(newEnv.weather);

  if (groundEffect && groundEffect !== currentGround) {
    // Weather worsens ground — check if it's actually worse
    const severity_order = ["dry", "wet", "muddy"];
    const currentIdx = severity_order.indexOf(currentGround);
    const effectIdx = severity_order.indexOf(groundEffect);
    if (effectIdx > currentIdx || groundEffect === "snow_covered") {
      // Ground gets worse — apply immediately, reset persistence counter
      newEnv.groundCondition = groundEffect;
      newEnv.groundTurnsInState = 0;
    } else if (isAggravating) {
      // Same severity or re-aggravation — reset counter (no drying progress)
      newEnv.groundTurnsInState = 0;
    } else {
      newEnv.groundTurnsInState = (env.groundTurnsInState || 0) + 1;
    }
  } else if (isAggravating) {
    // Weather maintains current bad ground — reset drying counter
    newEnv.groundTurnsInState = 0;
  } else if (currentGround !== "dry") {
    // Non-aggravating weather — ground starts drying, increment counter
    newEnv.groundTurnsInState = (env.groundTurnsInState || 0) + 1;

    // Check if enough turns have passed to recover one step
    const turnsNeeded = GROUND_RECOVERY_TURNS[currentGround] || 2;
    // Arctic climate prevents snow/frozen from thawing
    const arcticLock = climate === "arctic" && (currentGround === "snow_covered" || currentGround === "frozen");

    if (!arcticLock && newEnv.groundTurnsInState >= turnsNeeded) {
      // Step down one level
      if (currentGround === "frozen") newEnv.groundCondition = "snow_covered";
      else if (currentGround === "snow_covered") newEnv.groundCondition = "dry";
      else if (currentGround === "muddy") newEnv.groundCondition = "wet";
      else if (currentGround === "wet") newEnv.groundCondition = "dry";
      newEnv.groundTurnsInState = 0;
    }
  } else {
    newEnv.groundTurnsInState = 0;
  }

  // Time of day advances based on turn duration
  if (turnDurationMs) {
    const hoursPerTurn = turnDurationMs / (3600 * 1000);
    const currentIdx = TIME_PROGRESSION.indexOf(env.timeOfDay);
    if (currentIdx >= 0) {
      // Each time period is roughly 4-5 hours, so advance based on turn hours
      const periodsToAdvance = Math.floor(hoursPerTurn / 4);
      if (periodsToAdvance > 0) {
        const newIdx = (currentIdx + periodsToAdvance) % TIME_PROGRESSION.length;
        newEnv.timeOfDay = TIME_PROGRESSION[newIdx];
      }
    }
  }

  return newEnv;
}

/**
 * Create a fresh game state object.
 */
export function createGameState({ scenario, terrainRef, terrainSummary, llmConfig, folder }) {
  const now = new Date().toISOString();
  const id = `game_${now.replace(/[-:T]/g, "").slice(0, 14)}`;
  const scaleTier = SCALE_TIERS[scenario.scale] || SCALE_TIERS.grand_tactical;

  // Compute the initial simulation date from startDate, or leave empty
  const startDate = scenario.startDate || "";
  let currentDate = "";
  if (startDate) {
    const parsed = new Date(startDate);
    if (!isNaN(parsed.getTime())) {
      currentDate = parsed.toISOString();
    }
  }

  return {
    game: {
      id,
      name: scenario.title,
      folder: folder || null, // game folder name in games/ — null for legacy saves
      createdAt: now,
      turn: 1,
      phase: "planning",
      status: "active",
      scale: scaleTier.key,
      currentDate,
      config: {
        llm: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          temperature: llmConfig.temperature ?? 0.4
        },
        maxTurns: scenario.maxTurns || 20
      }
    },
    scenario: {
      title: scenario.title,
      description: scenario.description || "",
      startDate,
      turnDuration: scenario.turnDuration || scaleTier.defaultTurn,
      actors: scenario.actors || [],
      initialConditions: scenario.initialConditions || "",
      specialRules: scenario.specialRules || "",
      escalationLevel: scenario.escalationLevel || (scaleTier.tier >= 4 ? "Level 1: Peacetime Competition" : ""),
      eraSelections: scenario.eraSelections || {},
    },
    environment: scenario.environment || { ...DEFAULT_ENVIRONMENT },
    terrain: {
      _ref: terrainRef,
      summary: terrainSummary
    },
    units: scenario.units || [],
    supplyNetwork: scaleTier.tier >= 3 ? initSupplyNetwork(scenario.units || [], scenario.actors || []) : {},
    diplomacy: scaleTier.tier >= 4 ? initDiplomacy(scenario.actors || []) : {},
    reinforcementQueue: [],
    turnLog: [],
    promptLog: []
  };
}
