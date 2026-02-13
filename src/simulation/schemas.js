// ═══════════════════════════════════════════════════════════════
// SCHEMAS & VALIDATION — Game state and LLM adjudication output
// ═══════════════════════════════════════════════════════════════

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
          feasibility: "high | moderate | low | infeasible",
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
      narrative: "2-4 paragraph narrative of what happens this turn",
      outcome_type: "success | partial_success | failure | mixed | unintended_consequences",
      probability_assessment: "How likely this outcome was, with justification",
      key_interactions: "How simultaneous actions from multiple actors interacted"
    },
    state_updates: [
      {
        entity: "unit_id or state category",
        attribute: "which field changes",
        old_value: "current value",
        new_value: "proposed new value",
        justification: "Why this change follows from the adjudication"
      }
    ]
  },
  meta: {
    confidence: "high | moderate | low",
    notes: "Anything to flag for the moderator",
    ambiguities: ["Areas where the adjudicator had insufficient information"]
  }
};

// ── Validation helpers ──

const VALID_FEASIBILITY = new Set(["high", "moderate", "low", "infeasible"]);
const VALID_OUTCOME_TYPE = new Set(["success", "partial_success", "failure", "mixed", "unintended_consequences"]);
const VALID_ESCALATION_DIR = new Set(["escalating", "stable", "de-escalating"]);
const VALID_CONFIDENCE = new Set(["high", "moderate", "low"]);

/**
 * Validate an LLM adjudication response. Returns { valid, errors }.
 * Phase 1: structural checks only (no JSON Schema library).
 */
export function validateAdjudication(response) {
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

  // 4. de_escalation_assessment (MANDATORY — D.3)
  if (!adj.de_escalation_assessment) {
    errors.push("Missing adjudication.de_escalation_assessment (REQUIRED per D.3)");
  } else {
    if (!adj.de_escalation_assessment.current_escalation_level) errors.push("Missing de_escalation_assessment.current_escalation_level");
    if (adj.de_escalation_assessment.escalation_direction && !VALID_ESCALATION_DIR.has(adj.de_escalation_assessment.escalation_direction)) {
      errors.push(`Invalid escalation_direction: '${adj.de_escalation_assessment.escalation_direction}'`);
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

  // meta
  if (response.meta) {
    if (response.meta.confidence && !VALID_CONFIDENCE.has(response.meta.confidence)) {
      errors.push(`Invalid meta.confidence: '${response.meta.confidence}'`);
    }
  }

  return { valid: errors.length === 0, errors };
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
      // Check old_value matches current state
      if (attribute in unit && old_value !== undefined && old_value !== null) {
        if (JSON.stringify(unit[attribute]) !== JSON.stringify(old_value)) {
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

/**
 * Create a fresh game state object.
 */
export function createGameState({ scenario, terrainRef, terrainSummary, llmConfig }) {
  const now = new Date().toISOString();
  const id = `game_${now.replace(/[-:T]/g, "").slice(0, 14)}`;

  return {
    game: {
      id,
      name: scenario.title,
      createdAt: now,
      turn: 1,
      phase: "planning",
      status: "active",
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
      startDate: scenario.startDate || "",
      turnDuration: scenario.turnDuration || "1 day",
      actors: scenario.actors || [],
      initialConditions: scenario.initialConditions || "",
      specialRules: scenario.specialRules || "",
      escalationLevel: scenario.escalationLevel || "Level 1: Peacetime Competition"
    },
    terrain: {
      _ref: terrainRef,
      summary: terrainSummary
    },
    units: scenario.units || [],
    turnLog: [],
    promptLog: []
  };
}
