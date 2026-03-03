// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR — Core turn cycle logic
// Prompt assembly, LLM calls, validation, state management
// ═══════════════════════════════════════════════════════════════

import { createGameState, validateAdjudication, validateStateUpdates, SCALE_TIERS, advanceDate, DIPLOMATIC_STATUSES, getSupplyConsumption, progressEnvironment, parseTurnDuration } from "./schemas.js";
import { buildSystemPrompt, buildAdjudicationPrompt, buildTerrainSummary, reformatActionAsIntelReport, labelToCommaPosition, buildRebuttalPrompt } from "./prompts.js";
import { loadCorpus } from "./corpus.js";
import { generateFortuneRolls } from "./fortuneRoll.js";
import { generateFrictionEvents } from "./frictionEvents.js";

// ── Game Creation ───────────────────────────────────────────

/**
 * Create a new game from scenario configuration and terrain data.
 */
export function createGame({ scenario, terrainRef, terrainData, llmConfig }) {
  const scaleTier = SCALE_TIERS[scenario.scale]?.tier || 3;
  return createGameState({
    scenario,
    terrainRef,
    terrainSummary: buildTerrainSummary(terrainData, { scaleTier }),
    llmConfig
  });
}

// ── Adjudication ────────────────────────────────────────────

const MAX_RETRIES = 3;

/**
 * Run a full adjudication cycle for the current turn.
 *
 * @param {Object} gameState - Current game state
 * @param {Object} playerActions - { actorId: "action text", ... }
 * @param {Object} terrainData - Full terrain grid data
 * @param {Object} logger - Logger instance
 * @returns {{ adjudication, promptLog, error }}
 */
export async function adjudicate(gameState, playerActions, terrainData, logger) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;

  // Scale-conditional corpus loading
  const corpus = loadCorpus(scaleTier);
  // Scale-aware system prompt
  const systemPrompt = buildSystemPrompt(scaleKey);

  // D.5: Reformat actions as intelligence reports
  const actions = [];
  for (const [actorId, actionText] of Object.entries(playerActions)) {
    const actor = gameState.scenario.actors.find(a => a.id === actorId) || { id: actorId, name: actorId };
    const report = reformatActionAsIntelReport(actor, actionText, gameState);
    actions.push({ actor, report });

    if (logger) {
      logger.log(gameState.game.turn, "action_submitted", { actorId, actionText });
    }
  }

  // Generate pre-adjudication randomness (chaos dice + friction)
  const fortuneRolls = generateFortuneRolls(gameState.scenario.actors);
  const frictionEvents = generateFrictionEvents(gameState, scaleTier);
  if (logger) {
    logger.log(gameState.game.turn, "fortune_rolls", fortuneRolls);
    logger.log(gameState.game.turn, "friction_events", frictionEvents);
  }

  // Build the full adjudication prompt
  const userPrompt = buildAdjudicationPrompt({
    scenario: gameState.scenario,
    gameState,
    terrainData,
    actions,
    corpus,
    playerActions,
    fortuneRolls,
    frictionEvents,
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // Calculate dynamic max_tokens based on scenario complexity
  // Base scales logarithmically with grid area (bigger maps = longer narratives)
  // Per-unit cost covers feasibility assessment + citations + weaknesses + state update
  const unitCount = gameState.scenario.actors.flatMap(a => a.units).length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  const baseTokens = 6000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  const perUnitTokens = 500;
  const maxTokens = baseTokens + (unitCount * perUnitTokens);

  // Attempt adjudication with retry logic (C.5)
  let lastError = null;
  let retryMessages = [...messages];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (logger) {
      logger.log(gameState.game.turn, "prompt_sent", {
        attempt,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        provider: gameState.game.config.llm.provider,
        model: gameState.game.config.llm.model,
        temperature: gameState.game.config.llm.temperature
      });
    }

    // Call the LLM via server proxy
    let llmResponse;
    try {
      const resp = await fetch("/api/llm/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: gameState.game.config.llm.provider,
          model: gameState.game.config.llm.model,
          temperature: gameState.game.config.llm.temperature,
          messages: retryMessages,
          max_tokens: maxTokens
        })
      });
      llmResponse = await resp.json();
    } catch (e) {
      lastError = `Network error calling LLM: ${e.message}`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    if (!llmResponse.ok) {
      lastError = `LLM API error: ${llmResponse.error}`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    if (logger) {
      logger.log(gameState.game.turn, "response_received", {
        attempt,
        contentLength: llmResponse.content?.length,
        usage: llmResponse.usage,
        model: llmResponse.model,
        stop_reason: llmResponse.stop_reason
      });
    }

    // Detect truncation before wasting time on JSON.parse
    if (llmResponse.stop_reason === 'max_tokens') {
      lastError = `LLM response truncated (hit ${llmResponse.usage?.output} token output limit, requested ${maxTokens})`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      // Retry with original messages + conciseness hint (don't append broken response)
      retryMessages = [
        ...messages,
        { role: "user", content: "IMPORTANT: Your previous response was cut off due to token limits. Be more concise — shorter justifications, shorter narrative, only include state_updates for fields that actually changed. Respond with ONLY valid JSON." }
      ];
      continue;
    }

    // Parse JSON from response
    let parsed;
    try {
      // Handle potential markdown code fences around JSON
      let content = llmResponse.content.trim();
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      parsed = JSON.parse(content);
    } catch (e) {
      lastError = `Failed to parse LLM response as JSON: ${e.message}`;
      if (logger) logger.log(gameState.game.turn, "validation_result", { attempt, valid: false, error: lastError });

      // Append error for retry
      retryMessages = [
        ...messages,
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: `Your previous response was not valid JSON. Error: ${e.message}\n\nPlease respond with ONLY a valid JSON object conforming to the adjudication schema. Do not include any text before or after the JSON.` }
      ];
      continue;
    }

    // Validate the adjudication structure (scale-aware)
    const validation = validateAdjudication(parsed, { scaleTier });
    if (logger) {
      logger.log(gameState.game.turn, "validation_result", { attempt, valid: validation.valid, errors: validation.errors });
    }

    if (!validation.valid) {
      lastError = `Adjudication validation failed: ${validation.errors.join("; ")}`;

      if (attempt < MAX_RETRIES) {
        retryMessages = [
          ...messages,
          { role: "assistant", content: llmResponse.content },
          { role: "user", content: `Your previous response failed validation with these errors:\n${validation.errors.map(e => `- ${e}`).join("\n")}\n\nPlease regenerate your response as valid JSON conforming to the adjudication schema. Ensure all required fields are present.` }
        ];
        continue;
      }
    }

    // Validate state updates against current game state
    if (parsed.adjudication?.state_updates) {
      const stateValidation = validateStateUpdates(parsed.adjudication.state_updates, gameState);
      if (logger && (stateValidation.errors.length > 0 || stateValidation.warnings.length > 0)) {
        logger.log(gameState.game.turn, "validation_result", {
          type: "state_updates",
          valid: stateValidation.valid,
          errors: stateValidation.errors,
          warnings: stateValidation.warnings
        });
      }
      // State update mismatches are warnings in Phase 1, not hard failures
    }

    // Build prompt log entry
    const promptLog = {
      turn: gameState.game.turn,
      timestamp: new Date().toISOString(),
      systemPrompt: systemPrompt.slice(0, 200) + "...", // Truncated for storage
      userPromptLength: userPrompt.length,
      rawResponse: llmResponse.content,
      model: llmResponse.model || gameState.game.config.llm.model,
      temperature: gameState.game.config.llm.temperature,
      tokenUsage: llmResponse.usage,
      attempts: attempt
    };

    return {
      adjudication: parsed,
      promptLog,
      fortuneRolls,
      frictionEvents,
      error: validation.valid ? null : `Validation warnings: ${validation.errors.join("; ")}`
    };
  }

  // All retries exhausted
  return {
    adjudication: null,
    promptLog: null,
    fortuneRolls,
    frictionEvents,
    error: `Adjudication failed after ${MAX_RETRIES} attempts. Last error: ${lastError}`
  };
}

// ── Rebuttal Adjudication ────────────────────────────────────

/**
 * Re-adjudicate after player rebuttals.
 * Constructs a multi-turn conversation: original prompt → original response → rebuttal.
 * Uses the SAME fortune rolls and friction events (not regenerated).
 *
 * @param {Object} gameState - Current game state
 * @param {Object} playerActions - Original player actions
 * @param {Object} terrainData - Full terrain grid data
 * @param {Object} originalResult - The original adjudication result (from adjudicate())
 * @param {Object} rebuttals - { actorId: "rebuttal text", ... }
 * @param {Object} logger - Logger instance
 * @returns {{ adjudication, promptLog, error }}
 */
export async function adjudicateRebuttal(gameState, playerActions, terrainData, originalResult, rebuttals, logger) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;

  const corpus = loadCorpus(scaleTier);
  const systemPrompt = buildSystemPrompt(scaleKey);

  // Rebuild the original user prompt (same context)
  const actions = [];
  for (const [actorId, actionText] of Object.entries(playerActions)) {
    const actor = gameState.scenario.actors.find(a => a.id === actorId) || { id: actorId, name: actorId };
    const report = reformatActionAsIntelReport(actor, actionText, gameState);
    actions.push({ actor, report });
  }

  const userPrompt = buildAdjudicationPrompt({
    scenario: gameState.scenario,
    gameState,
    terrainData,
    actions,
    corpus,
    playerActions,
    fortuneRolls: originalResult.fortuneRolls,
    frictionEvents: originalResult.frictionEvents,
  });

  // Build rebuttal prompt
  const rebuttalPrompt = buildRebuttalPrompt(rebuttals, gameState.scenario.actors);

  // Multi-turn conversation: system → original prompt → original response → rebuttal
  const originalResponseJSON = JSON.stringify(originalResult.adjudication);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
    { role: "assistant", content: originalResponseJSON },
    { role: "user", content: rebuttalPrompt },
  ];

  if (logger) {
    logger.log(gameState.game.turn, "rebuttal_submitted", { rebuttals });
  }

  // Dynamic max_tokens (same formula as adjudicate)
  const unitCount = gameState.scenario.actors.flatMap(a => a.units).length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  const baseTokens = 6000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  const maxTokens = baseTokens + (unitCount * 500);

  // Same retry logic as adjudicate()
  let lastError = null;
  let retryMessages = [...messages];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (logger) {
      logger.log(gameState.game.turn, "rebuttal_prompt_sent", { attempt });
    }

    let llmResponse;
    try {
      const resp = await fetch("/api/llm/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: gameState.game.config.llm.provider,
          model: gameState.game.config.llm.model,
          temperature: gameState.game.config.llm.temperature,
          messages: retryMessages,
          max_tokens: maxTokens
        })
      });
      llmResponse = await resp.json();
    } catch (e) {
      lastError = `Network error calling LLM: ${e.message}`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    if (!llmResponse.ok) {
      lastError = `LLM API error: ${llmResponse.error}`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    if (logger) {
      logger.log(gameState.game.turn, "rebuttal_response_received", {
        attempt,
        contentLength: llmResponse.content?.length,
        usage: llmResponse.usage,
        stop_reason: llmResponse.stop_reason
      });
    }

    // Detect truncation before wasting time on JSON.parse
    if (llmResponse.stop_reason === 'max_tokens') {
      lastError = `Rebuttal response truncated (hit ${llmResponse.usage?.output} token output limit, requested ${maxTokens})`;
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      retryMessages = [
        ...messages,
        { role: "user", content: "IMPORTANT: Your previous response was cut off due to token limits. Be more concise — shorter justifications, shorter narrative, only include state_updates for fields that actually changed. Respond with ONLY valid JSON." }
      ];
      continue;
    }

    // Parse JSON
    let parsed;
    try {
      let content = llmResponse.content.trim();
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      parsed = JSON.parse(content);
    } catch (e) {
      lastError = `Failed to parse rebuttal response as JSON: ${e.message}`;
      retryMessages = [
        ...messages,
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: `Your previous response was not valid JSON. Error: ${e.message}\n\nPlease respond with ONLY a valid JSON object conforming to the adjudication schema.` }
      ];
      continue;
    }

    const validation = validateAdjudication(parsed, { scaleTier });
    if (!validation.valid && attempt < MAX_RETRIES) {
      lastError = `Rebuttal validation failed: ${validation.errors.join("; ")}`;
      retryMessages = [
        ...messages,
        { role: "assistant", content: llmResponse.content },
        { role: "user", content: `Your previous response failed validation:\n${validation.errors.map(e => `- ${e}`).join("\n")}\n\nPlease regenerate as valid JSON.` }
      ];
      continue;
    }

    const promptLog = {
      turn: gameState.game.turn,
      timestamp: new Date().toISOString(),
      type: "rebuttal",
      model: llmResponse.model || gameState.game.config.llm.model,
      temperature: gameState.game.config.llm.temperature,
      tokenUsage: llmResponse.usage,
      attempts: attempt,
      rawResponse: llmResponse.content,
    };

    return {
      adjudication: parsed,
      promptLog,
      error: validation.valid ? null : `Rebuttal validation warnings: ${validation.errors.join("; ")}`
    };
  }

  return {
    adjudication: null,
    promptLog: null,
    error: `Rebuttal adjudication failed after ${MAX_RETRIES} attempts. Last error: ${lastError}`
  };
}

// ── State Management ────────────────────────────────────────

/**
 * Apply validated state updates from an adjudication to the game state.
 * Returns a new game state object (immutable update).
 *
 * Bug fixes from analysis:
 * - Position values from LLM (Excel-style "H4") are normalized to comma format ("7,3")
 * - turnLog.actions is now populated with playerActions
 * - Impossible actions (feasibility="impossible") skip state_updates for that entity
 */
export function applyStateUpdates(gameState, adjudication, playerActions = {}) {
  if (!adjudication?.adjudication?.state_updates) return gameState;

  const updates = adjudication.adjudication.state_updates;
  const newUnits = gameState.units.map(u => ({ ...u }));

  // Collect entities with "impossible" feasibility — they should have no state changes
  const impossibleEntities = new Set();
  const assessments = adjudication.adjudication.feasibility_analysis?.assessments || [];
  for (const a of assessments) {
    if (a.feasibility === "impossible" && a.actor) {
      // Mark all units belonging to this actor as having impossible orders
      for (const u of newUnits) {
        if (u.actor === a.actor) impossibleEntities.add(u.id);
      }
    }
  }

  for (const update of updates) {
    const { entity, attribute, new_value } = update;

    // Skip state updates for entities with impossible actions
    if (impossibleEntities.has(entity)) continue;

    // Find and update matching unit
    const unitIdx = newUnits.findIndex(u => u.id === entity);
    if (unitIdx !== -1 && attribute in newUnits[unitIdx]) {
      let normalizedValue = new_value;

      // Normalize position values: LLM returns Excel-style ("H4"), state uses comma ("7,3")
      if (attribute === "position" && typeof new_value === "string") {
        normalizedValue = labelToCommaPosition(new_value);
      }

      newUnits[unitIdx] = { ...newUnits[unitIdx], [attribute]: normalizedValue };
    }
  }

  // Update escalation level if the adjudication provides one (tier 4+ only)
  const deEscalation = adjudication.adjudication.de_escalation_assessment;
  let newEscalationLevel = gameState.scenario.escalationLevel;
  if (deEscalation?.current_escalation_level) {
    newEscalationLevel = deEscalation.current_escalation_level;
  }

  // Apply diplomacy state updates (entity = "diplomacy", attribute = pairKey like "actor_1-actor_2")
  let newDiplomacy = gameState.diplomacy ? { ...gameState.diplomacy } : {};
  for (const update of updates) {
    if (update.entity === "diplomacy" && update.attribute && update.new_value) {
      const pairKey = update.attribute;
      if (newDiplomacy[pairKey]) {
        const dVal = typeof update.new_value === "string" ? { status: update.new_value } : update.new_value;
        newDiplomacy[pairKey] = { ...newDiplomacy[pairKey], ...dVal };
      }
    }
  }

  // Build turn log entry — now includes playerActions
  const turnLogEntry = {
    turn: gameState.game.turn,
    timestamp: new Date().toISOString(),
    actions: playerActions,
    adjudication: {
      narrative: adjudication.adjudication.outcome_determination?.narrative || "",
      outcome_type: adjudication.adjudication.outcome_determination?.outcome_type || "",
      stateUpdates: updates,
      deEscalationAssessment: deEscalation || {},
      feasibilityAnalysis: adjudication.adjudication.feasibility_analysis || {},
      citations: adjudication.adjudication.feasibility_analysis?.assessments?.flatMap(a => a.citations || []) || []
    },
    moderatorNotes: ""
  };

  return {
    ...gameState,
    units: newUnits,
    diplomacy: newDiplomacy,
    scenario: {
      ...gameState.scenario,
      escalationLevel: newEscalationLevel
    },
    turnLog: [...gameState.turnLog, turnLogEntry]
  };
}

/**
 * Advance to the next turn. Increments turn counter, advances simulation clock,
 * and applies per-turn supply consumption (Tier 3+).
 */
export function advanceTurn(gameState) {
  const newDate = advanceDate(gameState.game.currentDate, gameState.scenario.turnDuration);
  const scaleTier = SCALE_TIERS[gameState.game?.scale]?.tier || 3;

  // Apply per-turn supply consumption (Tier 3+)
  let newUnits = gameState.units;
  if (scaleTier >= 3) {
    newUnits = gameState.units.map(u => {
      if (u.status === "destroyed" || u.status === "eliminated") return u;
      const consumption = getSupplyConsumption(u);
      const newSupply = Math.max(0, u.supply - consumption);
      return newSupply !== u.supply ? { ...u, supply: newSupply } : u;
    });
  }

  // Resupply from depots (simplified: each actor's depot replenishes units proportionally)
  let newSupplyNetwork = gameState.supplyNetwork;
  if (scaleTier >= 3 && gameState.supplyNetwork) {
    newSupplyNetwork = { ...gameState.supplyNetwork };
    for (const [actorId, net] of Object.entries(newSupplyNetwork)) {
      if (!net.depots?.length) continue;
      const totalAvail = net.depots.reduce((s, d) => s + d.current, 0);
      if (totalAvail <= 0) continue;
      // Find actor's units that need supply
      const actorUnits = newUnits.filter(u => u.actor === actorId && u.supply < 100 && u.status !== "destroyed" && u.status !== "eliminated");
      if (actorUnits.length === 0) continue;
      // Distribute resupplyRate evenly among needy units
      const perUnit = Math.min(Math.floor(net.resupplyRate / actorUnits.length), 100);
      let totalConsumed = 0;
      newUnits = newUnits.map(u => {
        if (u.actor !== actorId || u.supply >= 100 || u.status === "destroyed" || u.status === "eliminated") return u;
        const add = Math.min(perUnit, 100 - u.supply, totalAvail - totalConsumed);
        if (add <= 0) return u;
        totalConsumed += add;
        return { ...u, supply: u.supply + add };
      });
      // Deduct from depot
      if (totalConsumed > 0) {
        const newDepots = net.depots.map(d => ({ ...d, current: Math.max(0, d.current - totalConsumed) }));
        newSupplyNetwork[actorId] = { ...net, depots: newDepots };
      }
    }
  }

  // Progress weather/environment between turns
  const turnMs = parseTurnDuration(gameState.scenario?.turnDuration);
  const newEnvironment = progressEnvironment(gameState.environment, turnMs);

  return {
    ...gameState,
    units: newUnits,
    supplyNetwork: newSupplyNetwork,
    environment: newEnvironment,
    game: {
      ...gameState.game,
      turn: gameState.game.turn + 1,
      phase: "planning",
      currentDate: newDate || gameState.game.currentDate || ""
    }
  };
}

/**
 * Pause the game (kill switch — F.6).
 */
export function pauseGame(gameState) {
  return {
    ...gameState,
    game: {
      ...gameState.game,
      status: "paused"
    }
  };
}

/**
 * Resume a paused game.
 */
export function resumeGame(gameState) {
  return {
    ...gameState,
    game: {
      ...gameState.game,
      status: "active"
    }
  };
}

/**
 * End the game.
 */
export function endGame(gameState) {
  return {
    ...gameState,
    game: {
      ...gameState.game,
      status: "ended"
    }
  };
}

// ── Persistence ─────────────────────────────────────────────

/**
 * Save game state to server.
 */
export async function saveGameState(gameState) {
  const filename = `${gameState.game.id}.json`;
  const resp = await fetch("/api/game/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: gameState })
  });
  return resp.json();
}

/**
 * Load game state from server.
 */
export async function loadGameState(file) {
  const resp = await fetch(`/api/game/load?file=${encodeURIComponent(file)}`);
  if (!resp.ok) throw new Error(`Failed to load game: ${resp.statusText}`);
  return resp.json();
}

/**
 * List saved games.
 */
export async function listSavedGames() {
  const resp = await fetch("/api/game/list");
  return resp.json();
}

/**
 * Fetch available LLM providers.
 */
export async function getProviders() {
  const resp = await fetch("/api/llm/providers");
  return resp.json();
}
