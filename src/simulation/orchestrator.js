// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR — Core turn cycle logic
// Prompt assembly, LLM calls, validation, state management
// ═══════════════════════════════════════════════════════════════

import { createGameState, validateAdjudication, validateStateUpdates, validatePositionUpdates, SCALE_TIERS, advanceDate, DIPLOMATIC_STATUSES, getSupplyConsumption, progressEnvironment, parseTurnDuration, initDiplomacy } from "./schemas.js";
import { buildSystemPrompt, buildAdjudicationPrompt, buildTerrainSummary, reformatActionAsIntelReport, labelToCommaPosition, buildRebuttalPrompt, formatOrderBundles } from "./prompts.js";
import { loadCorpus } from "./corpus.js";
import { generateFortuneRolls, generateUnitFortuneRolls } from "./fortuneRoll.js";
import { generateFrictionEvents, applyDetectionReveals } from "./frictionEvents.js";
import { buildAllBundles } from "./orderComputer.js";
import { findTemplateAcrossEras } from "./eraTemplates.js";
import { WEAPON_RANGE_KM } from "./orderTypes.js";

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

// ── Order Normalization ─────────────────────────────────────

/**
 * Convert SimGame's order format to orderComputer's expected format.
 * SimGame: { id: "MOVE", target: "3,4" }
 * orderComputer: { type: "MOVE", targetHex: "3,4" }
 */
function normalizeOrdersForComputer(unitOrders) {
  const normalized = {};
  for (const [actorId, actorOrders] of Object.entries(unitOrders)) {
    normalized[actorId] = {};
    for (const [unitId, orders] of Object.entries(actorOrders)) {
      const norm = { intent: orders.intent || "" };
      if (orders.movementOrder) {
        norm.movementOrder = {
          type: orders.movementOrder.id,
          targetHex: orders.movementOrder.target,
        };
      }
      if (orders.actionOrder) {
        norm.actionOrder = {
          type: orders.actionOrder.id,
          targetHex: orders.actionOrder.target,
          subtype: orders.actionOrder.subtype || null,
        };
      }
      normalized[actorId][unitId] = norm;
    }
  }
  return normalized;
}

// ── Adjudication ────────────────────────────────────────────

// Wraps fetch() with an AbortController that fires after `ms` milliseconds.
// If an external AbortSignal is provided (e.g. user cancel), aborts on
// whichever fires first: timeout or external cancel.
const FETCH_TIMEOUT_MS = 900_000; // 15 minutes — cancel button is the real escape hatch

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Save a network traffic log for debugging adjudication issues.
// Fire-and-forget — never blocks adjudication flow.
function saveNetLog(entry) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `adj_${entry.gameId || "unknown"}_t${entry.turn || 0}_a${entry.attempt || 0}_${ts}.json`;
  fetch("/api/netlog/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: entry })
  }).catch(() => {}); // best-effort, never fail adjudication
}

const MAX_RETRIES = 3;
// Exponential backoff for rate-limit retries: wait 5s, 15s, 30s
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000];

/**
 * Run a full adjudication cycle for the current turn.
 *
 * @param {Object} gameState - Current game state
 * @param {Object} playerActions - { actorId: "action text", ... }
 * @param {Object} terrainData - Full terrain grid data
 * @param {Object} logger - Logger instance
 * @param {Object} structuredOrders - { unitOrders, actorIntents } from sealed orders
 * @param {Object} detectionContext - { actorVisibility } from computeDetection() (optional)
 * @returns {{ adjudication, promptLog, error }}
 */
export async function adjudicate(gameState, playerActions, terrainData, logger, structuredOrders = null, detectionContext = null, abortSignal = null) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;

  // Scale-conditional corpus loading
  const corpus = loadCorpus(scaleTier);
  // Scale-aware system prompt
  const systemPrompt = buildSystemPrompt(scaleKey, { maxTokens });

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
  // Per-unit fortune rolls when structured orders are available; per-actor fallback otherwise
  const fortuneRolls = structuredOrders?.unitOrders
    ? generateUnitFortuneRolls(gameState.units, structuredOrders.unitOrders)
    : generateFortuneRolls(gameState.scenario.actors);
  const frictionEvents = generateFrictionEvents(gameState, scaleTier);

  // Apply detection reveals from friction events that grant intel
  // (civilian_tip, signals_intercept, aerial_observation, etc.)
  let detectionReveals = [];
  if (detectionContext?.visibilityState && frictionEvents?.events) {
    detectionReveals = applyDetectionReveals(
      frictionEvents.events, gameState, detectionContext.visibilityState
    );
  }

  if (logger) {
    logger.log(gameState.game.turn, "fortune_rolls", fortuneRolls);
    logger.log(gameState.game.turn, "friction_events", frictionEvents);
    if (detectionReveals.length > 0) {
      logger.log(gameState.game.turn, "detection_reveals", detectionReveals);
    }
  }

  // Build pre-computed order bundles when structured orders are available.
  // Replaces raw text actions with dense computed data (paths, LOS, force ratios, etc.)
  let orderBundleSection = null;
  if (structuredOrders?.unitOrders) {
    const normalizedOrders = normalizeOrdersForComputer(structuredOrders.unitOrders);
    const unitFortuneMap = fortuneRolls.unitRolls || {};
    const bundles = buildAllBundles(normalizedOrders, gameState, terrainData, unitFortuneMap, {}, detectionContext);
    orderBundleSection = formatOrderBundles(
      bundles,
      structuredOrders.actorIntents || {},
      gameState.scenario.actors,
      { wildCard: fortuneRolls.wildCard },
      frictionEvents?.events || []
    );
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
    orderBundleSection,
    detectionContext,
    maxTokens,
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // Calculate dynamic max_tokens based on scenario complexity
  // Base scales logarithmically with grid area (bigger maps = longer narratives)
  // Per-unit cost covers feasibility assessment + citations + weaknesses + state update
  // Detection context adds ~500 tokens per actor for actor_perspectives narratives
  const unitCount = gameState.units.length;
  const actorCount = gameState.scenario.actors.length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  // Raised from 6000/500 — Sonnet's narrative quality needs ~1000 tokens/unit
  const baseTokens = 8000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  const perUnitTokens = 1000;
  const perspectiveTokens = detectionContext ? (actorCount * 800) : 0;
  // High ceiling — Sonnet supports 64K, user's plan allows up to 80K.
  // Completing in one shot is cheaper than truncation retries that double output usage.
  const maxTokens = Math.min(
    baseTokens + (unitCount * perUnitTokens) + perspectiveTokens,
    64000
  );

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
    const requestBody = {
      provider: gameState.game.config.llm.provider,
      model: gameState.game.config.llm.model,
      temperature: gameState.game.config.llm.temperature,
      messages: retryMessages,
      max_tokens: maxTokens
    };
    const fetchStart = Date.now();
    try {
      const resp = await fetchWithTimeout("/api/llm/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }, FETCH_TIMEOUT_MS, abortSignal);
      llmResponse = await resp.json();
    } catch (e) {
      if (e.name === "AbortError") {
        lastError = abortSignal?.aborted ? "Adjudication cancelled" : "Request timed out";
      } else {
        lastError = `Network error calling LLM: ${e.message}`;
      }
      saveNetLog({
        type: "adjudicate", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: Date.now() - fetchStart, error: lastError,
        request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (abortSignal?.aborted) break;
      continue;
    }

    const fetchDuration = Date.now() - fetchStart;

    if (!llmResponse.ok) {
      // Detect rate limiting and back off before retrying
      const errLower = (llmResponse.error || "").toLowerCase();
      const isRateLimit = errLower.includes("rate") || errLower.includes("429") || errLower.includes("overloaded");
      lastError = `LLM API error: ${llmResponse.error}`;
      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = RATE_LIMIT_BACKOFF_MS[attempt - 1] || 30_000;
        lastError += ` (rate limited, waiting ${delay / 1000}s)`;
        if (logger) logger.log(gameState.game.turn, "rate_limited", { attempt, delay, error: llmResponse.error });
        await sleep(delay);
      }
      saveNetLog({
        type: "adjudicate", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: fetchDuration, error: lastError,
        request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length },
        response: { ok: false, error: llmResponse.error },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    // Log successful response
    saveNetLog({
      type: "adjudicate", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
      durationMs: fetchDuration,
      request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length },
      response: {
        ok: true, contentLength: llmResponse.content?.length,
        usage: llmResponse.usage, model: llmResponse.model, stop_reason: llmResponse.stop_reason
      },
    });

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

    // Validate positions — clamp impossible moves, log corrections
    if (parsed.adjudication?.state_updates && terrainData) {
      const posResult = validatePositionUpdates(parsed.adjudication.state_updates, gameState, terrainData);
      for (const c of posResult.corrections) {
        // Apply correction in-place: replace LLM's proposed position with clamped position
        const update = parsed.adjudication.state_updates.find(u => u.entity === c.entity);
        if (update) {
          update.position = c.corrected;
          // Annotate justification so it's visible in turn log
          const tag = `[ENGINE CORRECTED: ${c.reason}]`;
          if (update.justification) {
            update.justification += ` ${tag}`;
          } else {
            update.justification = tag;
          }
        }
      }
      if (logger && (posResult.corrections.length > 0 || posResult.warnings.length > 0)) {
        logger.log(gameState.game.turn, "position_validation", {
          corrections: posResult.corrections,
          warnings: posResult.warnings
        });
      }
    }

    // Log hedge language warnings from adjudication validation
    if (validation.warnings?.length > 0 && logger) {
      logger.log(gameState.game.turn, "hedge_language_warnings", validation.warnings);
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
 * Re-adjudicate after player challenges.
 * Constructs a multi-turn conversation: original prompt → original response → challenges + rebuttals.
 * Uses the SAME fortune rolls and friction events (not regenerated).
 *
 * @param {Object} gameState - Current game state
 * @param {Object} playerActions - Original player actions
 * @param {Object} terrainData - Full terrain grid data
 * @param {Object} originalResult - The original adjudication result (from adjudicate())
 * @param {Object} rebuttals - { actorId: "challenge text", ... } (from challengers)
 * @param {Object} logger - Logger instance
 * @param {Object} counterRebuttals - { actorId: "counter-rebuttal text", ... } (from non-challengers)
 * @returns {{ adjudication, promptLog, error }}
 */
export async function adjudicateRebuttal(gameState, playerActions, terrainData, originalResult, rebuttals, logger, counterRebuttals = {}, abortSignal = null) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;

  const corpus = loadCorpus(scaleTier);
  const systemPrompt = buildSystemPrompt(scaleKey, { maxTokens });

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
    maxTokens,
  });

  // Build rebuttal prompt (includes both challenges and counter-rebuttals)
  const rebuttalPrompt = buildRebuttalPrompt(rebuttals, gameState.scenario.actors, counterRebuttals);

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
  const unitCount = gameState.units.length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  const baseTokens = 8000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  const maxTokens = Math.min(
    baseTokens + (unitCount * 1000),
    64000
  );

  // Same retry logic as adjudicate()
  let lastError = null;
  let retryMessages = [...messages];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (logger) {
      logger.log(gameState.game.turn, "rebuttal_prompt_sent", { attempt });
    }

    let llmResponse;
    const rebuttalRequestBody = {
      provider: gameState.game.config.llm.provider,
      model: gameState.game.config.llm.model,
      temperature: gameState.game.config.llm.temperature,
      messages: retryMessages,
      max_tokens: maxTokens
    };
    const rebuttalFetchStart = Date.now();
    try {
      const resp = await fetchWithTimeout("/api/llm/adjudicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rebuttalRequestBody)
      }, FETCH_TIMEOUT_MS, abortSignal);
      llmResponse = await resp.json();
    } catch (e) {
      if (e.name === "AbortError") {
        lastError = abortSignal?.aborted ? "Rebuttal cancelled" : "Request timed out";
      } else {
        lastError = `Network error calling LLM: ${e.message}`;
      }
      saveNetLog({
        type: "rebuttal", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: Date.now() - rebuttalFetchStart, error: lastError,
        request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (abortSignal?.aborted) break;
      continue;
    }

    const rebuttalFetchDuration = Date.now() - rebuttalFetchStart;

    if (!llmResponse.ok) {
      const errLower = (llmResponse.error || "").toLowerCase();
      const isRateLimit = errLower.includes("rate") || errLower.includes("429") || errLower.includes("overloaded");
      lastError = `LLM API error: ${llmResponse.error}`;
      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = RATE_LIMIT_BACKOFF_MS[attempt - 1] || 30_000;
        lastError += ` (rate limited, waiting ${delay / 1000}s)`;
        if (logger) logger.log(gameState.game.turn, "rate_limited", { attempt, delay, error: llmResponse.error });
        await sleep(delay);
      }
      saveNetLog({
        type: "rebuttal", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: rebuttalFetchDuration, error: lastError,
        request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length },
        response: { ok: false, error: llmResponse.error },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      continue;
    }

    saveNetLog({
      type: "rebuttal", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
      durationMs: rebuttalFetchDuration,
      request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length },
      response: {
        ok: true, contentLength: llmResponse.content?.length,
        usage: llmResponse.usage, model: llmResponse.model, stop_reason: llmResponse.stop_reason
      },
    });

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

    // Validate positions — same as adjudicate()
    if (parsed.adjudication?.state_updates && terrainData) {
      const posResult = validatePositionUpdates(parsed.adjudication.state_updates, gameState, terrainData);
      for (const c of posResult.corrections) {
        const update = parsed.adjudication.state_updates.find(u => u.entity === c.entity);
        if (update) {
          update.position = c.corrected;
          const tag = `[ENGINE CORRECTED: ${c.reason}]`;
          update.justification = update.justification ? `${update.justification} ${tag}` : tag;
        }
      }
      if (logger && (posResult.corrections.length > 0 || posResult.warnings.length > 0)) {
        logger.log(gameState.game.turn, "position_validation_rebuttal", {
          corrections: posResult.corrections,
          warnings: posResult.warnings
        });
      }
    }

    if (validation.warnings?.length > 0 && logger) {
      logger.log(gameState.game.turn, "hedge_language_warnings_rebuttal", validation.warnings);
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
 * Normalize a value the LLM proposed for a numeric field.
 * Strips trailing "%", parses to number, clamps to [min, max].
 * Returns currentValue unchanged if the result is NaN.
 */
function normalizeNumericValue(newValue, currentValue, min = 0, max = 100) {
  if (newValue == null) return currentValue; // null/undefined → keep current
  let v = newValue;
  if (typeof v === "string") v = v.replace(/%/g, "").trim();
  v = Number(v);
  if (isNaN(v)) return currentValue;
  return Math.max(min, Math.min(max, v));
}

// Numeric fields that need normalization (strip "%", clamp 0-100)
const NUMERIC_FIELDS = new Set([
  "supply", "strength", "morale", "ammo", "fuel",
  "fatigue", "entrenchment", "cohesion"
]);

// Fields managed by the engine — LLM proposals are silently dropped
const MECHANICAL_FIELDS = new Set(["supply"]);

/**
 * Apply validated state updates from an adjudication to the game state.
 * Returns a new game state object (immutable update).
 *
 * Bug fixes from analysis:
 * - Position values from LLM (Excel-style "H4") are normalized to comma format ("7,3")
 * - turnLog.actions is now populated with playerActions
 * - Impossible actions (feasibility="impossible") skip state_updates for that entity
 * - Numeric fields are normalized (strip "%", parse, clamp 0-100) to prevent NaN
 * - Supply is mechanically managed — LLM proposals are dropped to prevent double-dipping
 */
export function applyStateUpdates(gameState, adjudication, playerActions = {}) {
  if (!adjudication?.adjudication?.state_updates) return gameState;

  const updates = adjudication.adjudication.state_updates;
  const newUnits = gameState.units.map(u => ({ ...u }));

  // Collect entities with "impossible" feasibility — skip state changes for THOSE SPECIFIC UNITS only.
  // Previous bug: matched on actor, blanket-blocking all units from that actor even if only one had impossible orders.
  const impossibleEntities = new Set();
  const assessments = adjudication.adjudication.feasibility_analysis?.assessments || [];
  for (const a of assessments) {
    if (a.feasibility === "impossible" && a.action) {
      // Match the specific unit named in the assessment's action field (e.g., "Thunder Battery move L7→A5")
      const matchedUnit = newUnits.find(u => a.action.includes(u.name));
      if (matchedUnit) impossibleEntities.add(matchedUnit.id);
    }
  }

  for (const update of updates) {
    const { entity, attribute, new_value } = update;

    // Skip state updates for entities with impossible actions
    if (impossibleEntities.has(entity)) continue;

    // Skip mechanically-managed fields — engine handles these, LLM proposals cause double-dipping
    if (MECHANICAL_FIELDS.has(attribute)) continue;

    // Find and update matching unit
    const unitIdx = newUnits.findIndex(u => u.id === entity);
    if (unitIdx !== -1 && attribute in newUnits[unitIdx]) {
      let normalizedValue = new_value;

      // Normalize position values: LLM returns Excel-style ("H4"), state uses comma ("7,3")
      if (attribute === "position" && typeof new_value === "string") {
        normalizedValue = labelToCommaPosition(new_value);
      }

      // Normalize numeric fields: strip "%", parse to number, clamp 0-100
      if (NUMERIC_FIELDS.has(attribute)) {
        normalizedValue = normalizeNumericValue(new_value, newUnits[unitIdx][attribute]);
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

  // Build turn log entry — only store fields the UI actually displays
  // (narrative, actions, stateUpdates, moderatorNotes).
  // feasibilityAnalysis, deEscalationAssessment, citations are available
  // during review via pendingAdjudication but don't need to persist in the log.
  // Extract per-actor narratives from actor_perspectives for FOW-safe turn history
  const actorNarratives = {};
  const perspectives = adjudication.adjudication.actor_perspectives;
  if (perspectives) {
    for (const [actorId, persp] of Object.entries(perspectives)) {
      if (persp.narrative) actorNarratives[actorId] = persp.narrative;
    }
  }

  const turnLogEntry = {
    turn: gameState.game.turn,
    timestamp: new Date().toISOString(),
    actions: playerActions,
    adjudication: {
      narrative: adjudication.adjudication.outcome_determination?.narrative || "",
      outcome_type: adjudication.adjudication.outcome_determination?.outcome_type || "",
      stateUpdates: updates,
    },
    actorNarratives,  // per-actor FOW-safe narratives for briefings
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
      // Heal invalid supply values (NaN/undefined/string) before arithmetic
      const currentSupply = (typeof u.supply === "number" && !isNaN(u.supply)) ? u.supply : 100;
      const consumption = getSupplyConsumption(u);
      const newSupply = Math.max(0, currentSupply - consumption);
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

  let result = {
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

  // Process reinforcement queue — spawn units whose arrival turn has come
  result = processReinforcementQueue(result);

  return result;
}

/**
 * Process the reinforcement queue: promote scheduled reinforcements whose
 * arrivalTurn <= current turn into the active units array.
 * Also handles new actor injection with diplomacy/supply initialization.
 */
function processReinforcementQueue(gameState) {
  const queue = gameState.reinforcementQueue || [];
  if (queue.length === 0) return gameState;

  const currentTurn = gameState.game.turn;
  const arriving = queue.filter(r => r.arrivalTurn <= currentTurn);
  const remaining = queue.filter(r => r.arrivalTurn > currentTurn);

  if (arriving.length === 0) return { ...gameState, reinforcementQueue: remaining };

  const scaleTier = SCALE_TIERS[gameState.game?.scale]?.tier || 3;
  let newUnits = [...gameState.units];
  let newActors = [...gameState.scenario.actors];
  let newDiplomacy = { ...(gameState.diplomacy || {}) };
  let newSupplyNetwork = { ...(gameState.supplyNetwork || {}) };

  for (const reinf of arriving) {
    // Add new actor if specified and not already present
    if (reinf.newActor && !newActors.find(a => a.id === reinf.newActor.id)) {
      newActors.push(reinf.newActor);
      // Initialize diplomacy pairs for new actor (tier 4+)
      if (scaleTier >= 4) {
        for (const existing of newActors) {
          if (existing.id === reinf.newActor.id) continue;
          const key = [existing.id, reinf.newActor.id].sort().join("-");
          if (!newDiplomacy[key]) {
            newDiplomacy[key] = { status: "neutral", channels: ["none"], agreements: [] };
          }
        }
      }
      // Initialize supply network for new actor (tier 3+)
      if (scaleTier >= 3 && !newSupplyNetwork[reinf.newActor.id]) {
        newSupplyNetwork[reinf.newActor.id] = { depots: [], resupplyRate: 50 };
      }
    }

    // Add the unit to active roster
    newUnits.push(reinf.unit);
  }

  return {
    ...gameState,
    units: newUnits,
    scenario: { ...gameState.scenario, actors: newActors },
    diplomacy: newDiplomacy,
    supplyNetwork: newSupplyNetwork,
    reinforcementQueue: remaining,
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
 * Migrate old save data to current format.
 * Backfills weaponRangeKm on units that predate the km-based weapon range system.
 */
function migrateGameState(gs) {
  if (!gs?.units) return gs;
  for (const unit of gs.units) {
    if (unit.weaponRangeKm) continue;
    // Try template-specific range first (searches all eras since saves don't store eraId)
    if (unit.templateId) {
      const tpl = findTemplateAcrossEras(unit.templateId);
      if (tpl?.defaults?.weaponRangeKm) {
        unit.weaponRangeKm = tpl.defaults.weaponRangeKm;
        continue;
      }
    }
    // Fallback: generic per-type range
    unit.weaponRangeKm = WEAPON_RANGE_KM[unit.type] || WEAPON_RANGE_KM.infantry;
  }
  return gs;
}

/**
 * Load game state from server.
 */
export async function loadGameState(file) {
  const resp = await fetch(`/api/game/load?file=${encodeURIComponent(file)}`);
  if (!resp.ok) throw new Error(`Failed to load game: ${resp.statusText}`);
  const gs = await resp.json();
  return migrateGameState(gs);
}

/**
 * List saved games.
 */
export async function listSavedGames() {
  const resp = await fetch("/api/game/list");
  return resp.json();
}

/**
 * Delete a game save file (server only allows autosave files).
 */
export async function deleteGameSave(file) {
  const resp = await fetch(`/api/game/delete?file=${encodeURIComponent(file)}`, { method: "DELETE" });
  return resp.json();
}

/**
 * Autosave game state with rolling 5-turn window.
 * Saves as {gameId}_autosave_t{turn}.json, then prunes old autosaves.
 */
export async function autosave(gameState) {
  const gameId = gameState.game.id;
  const turn = gameState.game.turn;
  const filename = `${gameId}_autosave_t${turn}.json`;

  await fetch("/api/game/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: gameState })
  });

  // Prune old autosaves beyond the 5-turn window
  const AUTOSAVE_WINDOW = 5;
  const list = await listSavedGames();
  const prefix = `${gameId}_autosave_t`;
  const autosaves = list
    .filter(g => g.file.startsWith(prefix))
    .sort((a, b) => {
      const tA = parseInt(a.file.match(/_t(\d+)\.json$/)?.[1] || "0");
      const tB = parseInt(b.file.match(/_t(\d+)\.json$/)?.[1] || "0");
      return tB - tA; // newest first
    });

  for (const old of autosaves.slice(AUTOSAVE_WINDOW)) {
    await deleteGameSave(old.file).catch(() => {});
  }
}

/**
 * Fetch available LLM providers.
 */
export async function getProviders() {
  const resp = await fetch("/api/llm/providers");
  return resp.json();
}
