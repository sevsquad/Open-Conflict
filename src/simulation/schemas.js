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
  naval:          [4, 6],
  special_forces: [1, 4],
  logistics:      [2, 6],
  headquarters:   [2, 6],
  engineer:       [2, 5],
  air_defense:    [3, 6],
  other:          [1, 6],
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
      narrative: "2-4 paragraph narrative of what happens this turn",
      outcome_type: "success | partial_success | failure | mixed | unintended_consequences",
      probability_assessment: "How likely this outcome was, with justification",
      key_interactions: "How simultaneous actions from multiple actors interacted",
      fortune_effects: {
        actor_effects: [{ actor: "actor_id", roll: 73, effect_applied: "How this actor's fortune roll affected the outcome" }],
        wild_card_effect: "Description of wild card event impact, or null if not triggered"
      }
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
  fields.detected = true;                          // All tiers (defaults visible until fog of war)
  if (tierNumber >= 3) fields.parentHQ = "";       // Tiers 3+
  fields.movementType = "foot";                    // All tiers
  fields.specialCapabilities = [];                 // All tiers
  return fields;
}

// Movement type options
export const MOVEMENT_TYPES = ["foot", "wheeled", "tracked", "air", "naval", "amphibious"];

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
      const key = `${actors[i].id}-${actors[j].id}`;
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
  // Per-turn supply % consumed by posture
  attacking: 25, moving: 15, defending: 10, dug_in: 5, reserve: 5,
  ready: 8, retreating: 15, routing: 5,
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

export const DEFAULT_ENVIRONMENT = {
  weather: "clear",
  visibility: "good",
  groundCondition: "dry",
  timeOfDay: "morning",
};

// Weather transition probabilities — each weather has weighted possible next states.
// Higher weight = more likely. Weather tends to persist or shift gradually.
const WEATHER_TRANSITIONS = {
  clear:    { clear: 60, overcast: 30, fog: 10 },
  overcast: { overcast: 40, clear: 20, rain: 25, fog: 10, storm: 5 },
  rain:     { rain: 40, overcast: 30, storm: 15, clear: 10, snow: 5 },
  storm:    { storm: 30, rain: 40, overcast: 25, clear: 5 },
  snow:     { snow: 50, overcast: 25, clear: 15, storm: 10 },
  fog:      { fog: 40, overcast: 30, clear: 25, rain: 5 },
};

// Time of day progression based on turn duration
const TIME_PROGRESSION = ["dawn", "morning", "afternoon", "dusk", "night"];

// Visibility changes with weather
const WEATHER_VISIBILITY = {
  clear: "good", overcast: "good", rain: "moderate", storm: "poor", snow: "moderate", fog: "poor",
};

// Ground condition changes over time with weather
const GROUND_WEATHER_EFFECT = {
  rain: "wet", storm: "muddy", snow: "snow_covered", clear: null, overcast: null, fog: null,
};

/**
 * Progress weather/environment for a new turn.
 * Uses weighted random transitions for weather, advances time of day.
 */
export function progressEnvironment(env, turnDurationMs) {
  if (!env) return { ...DEFAULT_ENVIRONMENT };
  const newEnv = { ...env };

  // Weather transition (weighted random)
  const transitions = WEATHER_TRANSITIONS[env.weather] || WEATHER_TRANSITIONS.clear;
  const totalWeight = Object.values(transitions).reduce((s, w) => s + w, 0);
  let roll = Math.random() * totalWeight;
  for (const [weather, weight] of Object.entries(transitions)) {
    roll -= weight;
    if (roll <= 0) { newEnv.weather = weather; break; }
  }

  // Visibility follows weather
  newEnv.visibility = WEATHER_VISIBILITY[newEnv.weather] || "good";

  // Ground condition degrades with rain/storm, slowly recovers in clear
  const groundEffect = GROUND_WEATHER_EFFECT[newEnv.weather];
  if (groundEffect) {
    newEnv.groundCondition = groundEffect;
  } else if (env.groundCondition === "wet" && newEnv.weather === "clear") {
    // Wet dries to dry in clear weather
    newEnv.groundCondition = "dry";
  }
  // Muddy stays muddy unless clear for extended periods (simplified: stays for one clear turn)

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
export function createGameState({ scenario, terrainRef, terrainSummary, llmConfig }) {
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
      escalationLevel: scenario.escalationLevel || (scaleTier.tier >= 4 ? "Level 1: Peacetime Competition" : "")
    },
    environment: scenario.environment || { ...DEFAULT_ENVIRONMENT },
    terrain: {
      _ref: terrainRef,
      summary: terrainSummary
    },
    units: scenario.units || [],
    supplyNetwork: scaleTier.tier >= 3 ? initSupplyNetwork(scenario.units || [], scenario.actors || []) : {},
    diplomacy: scaleTier.tier >= 4 ? initDiplomacy(scenario.actors || []) : {},
    turnLog: [],
    promptLog: []
  };
}
