// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR — Core turn cycle logic
// Prompt assembly, LLM calls, validation, state management
// ═══════════════════════════════════════════════════════════════

import { createGameState, validateAdjudication, validateStateUpdates } from "./schemas.js";
import { buildSystemPrompt, buildAdjudicationPrompt, buildTerrainSummary, reformatActionAsIntelReport } from "./prompts.js";
import { loadCorpus } from "./corpus.js";

// ── Game Creation ───────────────────────────────────────────

/**
 * Create a new game from scenario configuration and terrain data.
 */
export function createGame({ scenario, terrainRef, terrainData, llmConfig }) {
  return createGameState({
    scenario,
    terrainRef,
    terrainSummary: buildTerrainSummary(terrainData),
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
  const corpus = loadCorpus();
  const systemPrompt = buildSystemPrompt();

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

  // Build the full adjudication prompt
  const userPrompt = buildAdjudicationPrompt({
    scenario: gameState.scenario,
    gameState,
    terrainData,
    actions,
    corpus
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

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
          messages: retryMessages
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
        model: llmResponse.model
      });
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

    // Validate the adjudication structure
    const validation = validateAdjudication(parsed);
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
      error: validation.valid ? null : `Validation warnings: ${validation.errors.join("; ")}`
    };
  }

  // All retries exhausted
  return {
    adjudication: null,
    promptLog: null,
    error: `Adjudication failed after ${MAX_RETRIES} attempts. Last error: ${lastError}`
  };
}

// ── State Management ────────────────────────────────────────

/**
 * Apply validated state updates from an adjudication to the game state.
 * Returns a new game state object (immutable update).
 */
export function applyStateUpdates(gameState, adjudication) {
  if (!adjudication?.adjudication?.state_updates) return gameState;

  const updates = adjudication.adjudication.state_updates;
  const newUnits = gameState.units.map(u => ({ ...u }));

  for (const update of updates) {
    const { entity, attribute, new_value } = update;

    // Find and update matching unit
    const unitIdx = newUnits.findIndex(u => u.id === entity);
    if (unitIdx !== -1 && attribute in newUnits[unitIdx]) {
      newUnits[unitIdx] = { ...newUnits[unitIdx], [attribute]: new_value };
    }
  }

  // Update escalation level if the adjudication provides one
  const deEscalation = adjudication.adjudication.de_escalation_assessment;
  let newEscalationLevel = gameState.scenario.escalationLevel;
  if (deEscalation?.current_escalation_level) {
    newEscalationLevel = deEscalation.current_escalation_level;
  }

  // Build turn log entry
  const turnLogEntry = {
    turn: gameState.game.turn,
    timestamp: new Date().toISOString(),
    actions: {}, // Will be filled by caller
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
    scenario: {
      ...gameState.scenario,
      escalationLevel: newEscalationLevel
    },
    turnLog: [...gameState.turnLog, turnLogEntry]
  };
}

/**
 * Advance to the next turn.
 */
export function advanceTurn(gameState) {
  return {
    ...gameState,
    game: {
      ...gameState.game,
      turn: gameState.game.turn + 1,
      phase: "planning"
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
