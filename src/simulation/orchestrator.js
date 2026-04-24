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
import { applyAirTurnUpdates } from "./airLogistics.js";
import { getTurnBudgetKey } from "./llmBudget.js";

// ── Game Creation ───────────────────────────────────────────

/**
 * Create a new game from scenario configuration and terrain data.
 */
export function createGame({ scenario, terrainRef, terrainData, llmConfig, folder }) {
  const scaleTier = SCALE_TIERS[scenario.scale]?.tier || 3;
  return createGameState({
    scenario,
    terrainRef,
    terrainSummary: buildTerrainSummary(terrainData, { scaleTier }),
    llmConfig,
    folder
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
          waypoints: orders.movementOrder.waypoints || null,
        };
      }
      if (orders.actionOrder) {
        norm.actionOrder = {
          type: orders.actionOrder.id,
          targetHex: orders.actionOrder.target,
          subtype: orders.actionOrder.subtype || null,
          altitude: orders.actionOrder.altitude || null,       // Air altitude profile (LOW/MEDIUM/HIGH)
          targetUnit: orders.actionOrder.targetUnit || null,   // For ESCORT/SEAD — target unit ID
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

export function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Forward external abort to our controller; clean up listener on completion
  // to prevent closure accumulation when the signal never fires.
  const onExternalAbort = externalSignal ? () => controller.abort() : null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => {
      clearTimeout(timer);
      if (onExternalAbort && externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    });
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
  }).catch(e => console.warn("[saveNetLog] failed:", e.message)); // best-effort, never fail adjudication
}

const MAX_RETRIES = 3;
// Exponential backoff for rate-limit retries: wait 5s, 15s, 30s
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000];

function getAdjudicationTokenCap(model) {
  const normalized = String(model || "").toLowerCase();
  if (normalized.endsWith("-pro")) return 12000;
  if (normalized.startsWith("gpt-5")) return 24000;
  return 64000;
}

function isTokenLimitStopReason(stopReason) {
  const normalized = String(stopReason || "").toLowerCase();
  return normalized === "max_tokens"
    || normalized === "max_output_tokens"
    || normalized === "incomplete"
    || normalized === "length"; // OpenAI Chat Completions uses "length" for truncation
}

/**
 * Parse a position value into { col, row }. Handles both "col,row" strings
 * (e.g. "7,3") and object format ({ col, row }). Returns null if invalid.
 */
function parsePos(pos) {
  if (!pos) return null;
  if (typeof pos === "object" && pos.col !== undefined) return pos;
  const m = String(pos).match(/^(\d+),(\d+)$/);
  if (m) return { col: parseInt(m[1]), row: parseInt(m[2]) };
  return null;
}

/**
 * Validate that strength losses only occur between units within weapon range.
 * For each unit that lost strength, checks if ANY enemy unit was within
 * max weapon range. If not, caps the loss to 5% (friction-level damage).
 *
 * Skips validation if the opposing side has artillery or air units —
 * can't determine indirect fire sources reliably.
 *
 * Returns { corrections: [{ entity, original, corrected, reason }] }
 */
function validateCombatRange(stateUpdates, gameState, terrainData) {
  const corrections = [];
  const cellSizeKm = terrainData?.cellSizeKm || 1;
  const units = gameState.units || [];

  // Build lookup: unit name (lowercase) → unit object
  const unitByName = new Map();
  for (const u of units) unitByName.set(u.name.toLowerCase(), u);

  // Build set of actors that have artillery or air units (indirect fire sources)
  const actorsWithIndirect = new Set();
  for (const u of units) {
    if (u.status === "destroyed") continue;
    const t = (u.type || "").toLowerCase();
    if (t === "artillery" || t === "air" || t === "attack_helicopter" || t === "naval") {
      actorsWithIndirect.add(u.actor);
    }
  }

  // Check each strength-loss state_update
  for (const update of stateUpdates) {
    if (update.attribute !== "strength") continue;

    const unit = unitByName.get((update.entity || "").toLowerCase());
    if (!unit) continue;

    const oldStrength = unit.strength ?? 100;
    const newStrength = update.new_value;
    if (typeof newStrength !== "number" || newStrength >= oldStrength) continue; // no loss

    // Skip if any enemy actor has indirect fire capability
    const enemyActors = units
      .filter(u => u.actor !== unit.actor && u.status !== "destroyed")
      .map(u => u.actor);
    const hasIndirect = enemyActors.some(a => actorsWithIndirect.has(a));
    if (hasIndirect) continue;

    // Check if ANY enemy is within max weapon range of this unit
    const unitPos = parsePos(unit.position);
    if (!unitPos) continue;

    let enemyInRange = false;
    for (const enemy of units) {
      if (enemy.actor === unit.actor || enemy.status === "destroyed") continue;
      const enemyPos = parsePos(enemy.position);
      if (!enemyPos) continue;

      // Hex distance between the two units
      const q1 = unitPos.col - (unitPos.row - (unitPos.row & 1)) / 2;
      const q2 = enemyPos.col - (enemyPos.row - (enemyPos.row & 1)) / 2;
      const dq = q1 - q2, dr = unitPos.row - enemyPos.row;
      const hexDist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
      const distKm = hexDist * cellSizeKm;

      // Check if the enemy's max weapon range covers this unit
      const enemyType = (enemy.type || "infantry").toLowerCase();
      const enemyRange = WEAPON_RANGE_KM[enemyType] || WEAPON_RANGE_KM.infantry;
      if (distKm <= enemyRange.max) {
        enemyInRange = true;
        break;
      }
    }

    if (!enemyInRange) {
      // No enemy in range — cap strength loss to 5% (friction)
      const maxLoss = 5;
      const cappedStrength = Math.max(newStrength, oldStrength - maxLoss);
      if (cappedStrength !== newStrength) {
        corrections.push({
          entity: update.entity,
          original: newStrength,
          corrected: cappedStrength,
          reason: `No enemy within weapon range — strength loss capped from ${oldStrength - newStrength}% to ${oldStrength - cappedStrength}%`
        });
      }
    }
  }

  return { corrections };
}

/**
 * Detect units that the LLM failed to mention in state_updates.
 * Compares the unit roster against entities referenced in the adjudication.
 * Returns array of unit names that were forgotten (empty = all covered).
 */
function detectForgottenUnits(stateUpdates, units) {
  if (!stateUpdates || !units?.length) return [];
  // Collect all entity names the LLM mentioned (case-insensitive match)
  const mentionedLower = new Set(
    stateUpdates.map(u => (u.entity || "").toLowerCase())
  );
  return units
    .filter(u => !mentionedLower.has(u.name.toLowerCase()))
    .map(u => u.name);
}

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
export async function adjudicate(gameState, playerActions, terrainData, logger, structuredOrders = null, detectionContext = null, abortSignal = null, onStatus = null) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const llmModel = gameState.game?.config?.llm?.model;

  // Calculate dynamic max_tokens early — needed by buildSystemPrompt and LLM call.
  const unitCount = gameState.units.length;
  const actorCount = gameState.scenario.actors.length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  const baseTokens = 8000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  // 500 per unit covers ~3-5 state_updates + narrative mention per unit.
  // Previous 1000 inflated max_tokens to 59k, causing verbose output and budget bloat.
  const perUnitTokens = 500;
  const perspectiveTokens = detectionContext ? (actorCount * 800) : 0;
  const maxTokens = Math.min(
    baseTokens + (unitCount * perUnitTokens) + perspectiveTokens,
    getAdjudicationTokenCap(llmModel)
  );

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

  // Attempt adjudication with retry logic (C.5)
  let lastError = null;
  let retryMessages = [...messages];
  let forgottenUnitsRetried = false; // cap at one forgotten-unit retry per turn
  let attemptsUsed = 0;
  const budgetKey = getTurnBudgetKey(gameState);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attemptsUsed = attempt;
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
      max_tokens: maxTokens,
      budget_key: budgetKey,
    };
    if (onStatus) onStatus(attempt > 1 ? `Retry ${attempt}/${MAX_RETRIES} — sending to ${requestBody.provider}...` : `Sending to ${requestBody.provider}...`);
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
        request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length, budget_key: requestBody.budget_key },
      });
      if (onStatus) onStatus(`Error: ${lastError}`);
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (abortSignal?.aborted) break;
      continue;
    }

    const fetchDuration = Date.now() - fetchStart;

    if (!llmResponse.ok) {
      // Detect rate limiting and back off before retrying
      const errLower = (llmResponse.error || "").toLowerCase();
      const isRateLimit = errLower.includes("rate") || errLower.includes("429") || errLower.includes("overloaded");
      const shouldRetry = llmResponse.retryable === true;
      lastError = `LLM API error: ${llmResponse.error}`;
      if (attempt < MAX_RETRIES && shouldRetry) {
        const delay = isRateLimit
          ? (RATE_LIMIT_BACKOFF_MS[attempt - 1] || 30_000)
          : 2_000; // Brief pause before non-rate-limit retries to avoid hammering
        if (isRateLimit) lastError += ` (rate limited, waiting ${delay / 1000}s)`;
        if (onStatus) onStatus(isRateLimit ? `Rate limited — waiting ${delay / 1000}s...` : `API error — retrying...`);
        if (logger) logger.log(gameState.game.turn, isRateLimit ? "rate_limited" : "api_error_retry", { attempt, delay, error: llmResponse.error });
        await sleep(delay);
      } else if (onStatus) {
        onStatus(`API error: ${llmResponse.error}`);
      }
      saveNetLog({
        type: "adjudicate", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: fetchDuration, error: lastError,
        request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length, budget_key: requestBody.budget_key },
        response: { ok: false, error: llmResponse.error, retryable: llmResponse.retryable, errorCode: llmResponse.errorCode },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (!shouldRetry) break;
      continue;
    }

    // Log successful response
    saveNetLog({
      type: "adjudicate", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
      durationMs: fetchDuration,
      request: { provider: requestBody.provider, model: requestBody.model, max_tokens: requestBody.max_tokens, messageCount: retryMessages.length, budget_key: requestBody.budget_key },
      response: {
        ok: true, contentLength: llmResponse.content?.length,
        usage: llmResponse.usage, model: llmResponse.model, stop_reason: llmResponse.stop_reason
      },
    });

    // Format token usage for status display
    const usageStr = llmResponse.usage
      ? `${((llmResponse.usage.input || 0) / 1000).toFixed(1)}k in / ${((llmResponse.usage.output || 0) / 1000).toFixed(1)}k out`
      : "";
    if (onStatus) onStatus(`Response received (${usageStr}) — validating...`);

    if (logger) {
      logger.log(gameState.game.turn, "response_received", {
        attempt,
        contentLength: llmResponse.content?.length,
        usage: llmResponse.usage,
        model: llmResponse.model,
        stop_reason: llmResponse.stop_reason
      });
    }

    if (isTokenLimitStopReason(llmResponse.stop_reason) || !llmResponse.content?.trim()) {
      lastError = `LLM response truncated or incomplete (stop_reason=${llmResponse.stop_reason || "unknown"}, output=${llmResponse.usage?.output ?? "unknown"}, requested=${maxTokens})`;
      if (onStatus) onStatus("Response truncated — retrying with shorter output...");
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      retryMessages = [
        ...messages,
        { role: "user", content: "IMPORTANT: Your previous response was cut off or incomplete. Respond with ONLY valid JSON. Be much more concise: compact narrative, shorter justifications, and only include state_updates for fields that actually changed." }
      ];
      continue;
    }

    // Parse JSON from response
    let parsed;
    try {
      // Handle potential markdown code fences around JSON
      let content = (llmResponse.content || "").trim();
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      parsed = JSON.parse(content);
    } catch (e) {
      lastError = `Failed to parse LLM response as JSON: ${e.message}`;
      if (onStatus) onStatus("Invalid JSON response — retrying...");
      if (logger) logger.log(gameState.game.turn, "validation_result", { attempt, valid: false, error: lastError });

      // Don't feed the entire broken response back — just tell the LLM what went wrong.
      // Sending the full broken response back doubles input tokens on retry for no benefit.
      retryMessages = [
        ...messages,
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
      if (onStatus) onStatus(`Validation failed (${validation.errors.length} errors) — retrying...`);

      if (attempt < MAX_RETRIES) {
        // Truncate the broken response to limit retry cost — the LLM just needs
        // to see the structure errors, not re-read its entire output
        const truncatedContent = (llmResponse.content || "").slice(0, 2000) + "\n...[truncated]";
        retryMessages = [
          ...messages,
          { role: "assistant", content: truncatedContent },
          { role: "user", content: `Your previous response failed validation with these errors:\n${validation.errors.map(e => `- ${e}`).join("\n")}\n\nPlease regenerate your response as valid JSON conforming to the adjudication schema. Ensure all required fields are present.` }
        ];
      }
      // Invalid on final retry — fall through to error return at end of loop
      continue;
    }

    // M19: Save a deep copy before engine mutations (position validation, etc.)
    // so adjudicateRebuttal sends the original LLM output, not the mutated version
    const rawAdjudication = JSON.parse(JSON.stringify(parsed));

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
          update.new_value = c.corrected;
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

    // Validate combat range — cap strength losses between units that are out of weapon range
    if (parsed.adjudication?.state_updates && terrainData) {
      const rangeResult = validateCombatRange(parsed.adjudication.state_updates, gameState, terrainData);
      for (const c of rangeResult.corrections) {
        const update = parsed.adjudication.state_updates.find(u => u.entity === c.entity && u.attribute === "strength");
        if (update) {
          update.new_value = c.corrected;
          const tag = `[ENGINE CORRECTED: ${c.reason}]`;
          update.justification = update.justification ? `${update.justification} ${tag}` : tag;
        }
      }
      if (logger && rangeResult.corrections.length > 0) {
        logger.log(gameState.game.turn, "combat_range_validation", {
          corrections: rangeResult.corrections
        });
      }
    }

    // Log hedge language warnings from adjudication validation
    if (validation.warnings?.length > 0 && logger) {
      logger.log(gameState.game.turn, "hedge_language_warnings", validation.warnings);
    }

    // ── Forgotten-unit detection ──────────────────────────────
    // Check which units the LLM failed to include in state_updates.
    // Escalation policy:
    //   1st occurrence → note it, remind LLM next turn
    //   2nd consecutive turn → retry immediately (once), then remind next turn
    const forgotten = detectForgottenUnits(
      parsed.adjudication?.state_updates, gameState.units
    );
    let forgottenUnitResult = null;

    if (forgotten.length > 0) {
      const prevFailures = gameState.game.forgottenUnits?.consecutiveFailures || 0;
      const shouldRetry = prevFailures >= 1 && !forgottenUnitsRetried;

      if (logger) {
        logger.log(gameState.game.turn, "forgotten_units", {
          count: forgotten.length,
          units: forgotten,
          consecutiveFailures: prevFailures + 1,
          action: shouldRetry ? "retrying" : "noted_for_next_turn"
        });
      }

      if (shouldRetry) {
        // 2nd+ consecutive turn of forgetting — retry once this turn
        forgottenUnitsRetried = true;
        const truncatedContent = (llmResponse.content || "").slice(0, 2000) + "\n...[truncated]";
        retryMessages = [
          ...messages,
          { role: "assistant", content: truncatedContent },
          { role: "user", content: `You forgot to include state_updates for these units: ${forgotten.join(", ")}.\n\nEvery unit in the roster MUST have at least one state_update (even if just confirming position). Add the missing units and return the complete JSON.` }
        ];
        continue;
      }

      // 1st occurrence (or already retried) — note for next turn's prompt
      forgottenUnitResult = {
        names: forgotten,
        consecutiveFailures: prevFailures + 1
      };
    }

    // ── Compile adjudicator accuracy score ──────────────────────
    // Counts corrections made by validation pipeline. Fed back to the
    // adjudicator next turn so it can self-correct.
    const totalUpdates = parsed.adjudication?.state_updates?.length || 0;
    const posCorrections = parsed.adjudication?.state_updates
      ? parsed.adjudication.state_updates.filter(u => u.justification?.includes("[ENGINE CORRECTED")).length
      : 0;
    // rangeResult only exists if we ran combat range validation
    const rangeViolations = (parsed.adjudication?.state_updates && terrainData)
      ? parsed.adjudication.state_updates.filter(u =>
          u.attribute === "strength" && u.justification?.includes("No enemy within weapon range")
        ).length
      : 0;
    const hedgeWarnings = validation.warnings?.length || 0;
    const forgottenCount = forgotten.length;
    const totalCorrections = posCorrections + rangeViolations;
    const accuracy = totalUpdates > 0
      ? Math.round(((totalUpdates - totalCorrections) / totalUpdates) * 100)
      : 100;

    const adjudicatorScore = {
      lastTurn: {
        totalUpdates,
        positionCorrections: posCorrections,
        rangeViolations,
        hedgeWarnings,
        forgottenUnits: forgottenCount,
        accuracy
      }
    };

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
      rawAdjudication,  // M19: pre-mutation copy for use in rebuttal
      promptLog,
      fortuneRolls,
      frictionEvents,
      forgottenUnits: forgottenUnitResult,  // null if all units covered
      adjudicatorScore,
      error: validation.valid ? null : `Validation warnings: ${validation.errors.join("; ")}`
    };
  }

  // All retries exhausted
  return {
    adjudication: null,
    promptLog: null,
    fortuneRolls,
    frictionEvents,
    error: `Adjudication failed after ${attemptsUsed || 0} attempt${attemptsUsed === 1 ? "" : "s"}. Last error: ${lastError}`
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
export async function adjudicateRebuttal(gameState, playerActions, terrainData, originalResult, rebuttals, logger, counterRebuttals = {}, abortSignal = null, structuredOrders = null, detectionContext = null, onStatus = null) {
  const scaleKey = gameState.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const llmModel = gameState.game?.config?.llm?.model;

  // Calculate maxTokens early — needed by buildSystemPrompt
  const unitCount = gameState.units.length;
  const actorCount = gameState.scenario.actors.length;
  const gridArea = (terrainData?.cols || 12) * (terrainData?.rows || 15);
  const baseTokens = 8000 + Math.round(2000 * Math.log10(Math.max(gridArea / 100, 1)));
  const perspectiveTokens = actorCount * 800; // M7: was missing from rebuttal calculation
  const maxTokens = Math.min(
    baseTokens + (unitCount * 1000) + perspectiveTokens,
    getAdjudicationTokenCap(llmModel)
  );

  const corpus = loadCorpus(scaleTier);
  const systemPrompt = buildSystemPrompt(scaleKey, { maxTokens });

  // Rebuild the original user prompt (same context)
  const actions = [];
  for (const [actorId, actionText] of Object.entries(playerActions)) {
    const actor = gameState.scenario.actors.find(a => a.id === actorId) || { id: actorId, name: actorId };
    const report = reformatActionAsIntelReport(actor, actionText, gameState);
    actions.push({ actor, report });
  }

  // M6: Build order bundles for rebuttal so the LLM sees the same pre-computed data
  let orderBundleSection = null;
  if (structuredOrders?.unitOrders) {
    const normalizedOrders = normalizeOrdersForComputer(structuredOrders.unitOrders);
    const unitFortuneMap = originalResult.fortuneRolls?.unitRolls || {};
    const bundles = buildAllBundles(normalizedOrders, gameState, terrainData, unitFortuneMap, {}, detectionContext);
    orderBundleSection = formatOrderBundles(
      bundles,
      structuredOrders.actorIntents || {},
      gameState.scenario.actors,
      { wildCard: originalResult.fortuneRolls?.wildCard },
      originalResult.frictionEvents?.events || []
    );
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
    orderBundleSection,
    detectionContext,
    maxTokens,
  });

  // Build rebuttal prompt (includes both challenges and counter-rebuttals)
  const rebuttalPrompt = buildRebuttalPrompt(rebuttals, gameState.scenario.actors, counterRebuttals);

  // Multi-turn conversation: system → original prompt → original response → rebuttal
  // M19: Use rawAdjudication (pre-mutation) if available, so the LLM sees its original output
  const originalResponseJSON = JSON.stringify(originalResult.rawAdjudication || originalResult.adjudication);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
    { role: "assistant", content: originalResponseJSON },
    { role: "user", content: rebuttalPrompt },
  ];

  if (logger) {
    logger.log(gameState.game.turn, "rebuttal_submitted", { rebuttals });
  }

  // Same retry logic as adjudicate()
  let lastError = null;
  let retryMessages = [...messages];
  let attemptsUsed = 0;
  const budgetKey = getTurnBudgetKey(gameState);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attemptsUsed = attempt;
    if (logger) {
      logger.log(gameState.game.turn, "rebuttal_prompt_sent", { attempt });
    }

    let llmResponse;
    const rebuttalRequestBody = {
      provider: gameState.game.config.llm.provider,
      model: gameState.game.config.llm.model,
      temperature: gameState.game.config.llm.temperature,
      messages: retryMessages,
      max_tokens: maxTokens,
      budget_key: budgetKey,
    };
    if (onStatus) onStatus(attempt > 1 ? `Retry ${attempt}/${MAX_RETRIES} — sending rebuttal...` : `Sending rebuttal to ${rebuttalRequestBody.provider}...`);
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
        request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length, budget_key: rebuttalRequestBody.budget_key },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (abortSignal?.aborted) break;
      continue;
    }

    const rebuttalFetchDuration = Date.now() - rebuttalFetchStart;

    if (!llmResponse.ok) {
      const errLower = (llmResponse.error || "").toLowerCase();
      const isRateLimit = errLower.includes("rate") || errLower.includes("429") || errLower.includes("overloaded");
      const shouldRetry = llmResponse.retryable === true;
      lastError = `LLM API error: ${llmResponse.error}`;
      if (attempt < MAX_RETRIES && shouldRetry) {
        const delay = isRateLimit
          ? (RATE_LIMIT_BACKOFF_MS[attempt - 1] || 30_000)
          : 2_000; // Brief pause before non-rate-limit retries to avoid hammering
        if (isRateLimit) lastError += ` (rate limited, waiting ${delay / 1000}s)`;
        if (logger) logger.log(gameState.game.turn, isRateLimit ? "rate_limited" : "api_error_retry", { attempt, delay, error: llmResponse.error });
        await sleep(delay);
      }
      saveNetLog({
        type: "rebuttal", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
        durationMs: rebuttalFetchDuration, error: lastError,
        request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length, budget_key: rebuttalRequestBody.budget_key },
        response: { ok: false, error: llmResponse.error, retryable: llmResponse.retryable, errorCode: llmResponse.errorCode },
      });
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      if (!shouldRetry) break;
      continue;
    }

    saveNetLog({
      type: "rebuttal", gameId: gameState.game.id, turn: gameState.game.turn, attempt,
      durationMs: rebuttalFetchDuration,
      request: { provider: rebuttalRequestBody.provider, model: rebuttalRequestBody.model, max_tokens: rebuttalRequestBody.max_tokens, messageCount: retryMessages.length, budget_key: rebuttalRequestBody.budget_key },
      response: {
        ok: true, contentLength: llmResponse.content?.length,
        usage: llmResponse.usage, model: llmResponse.model, stop_reason: llmResponse.stop_reason
      },
    });

    const rebuttalUsageStr = llmResponse.usage
      ? `${((llmResponse.usage.input || 0) / 1000).toFixed(1)}k in / ${((llmResponse.usage.output || 0) / 1000).toFixed(1)}k out`
      : "";
    if (onStatus) onStatus(`Response received (${rebuttalUsageStr}) — validating...`);

    if (logger) {
      logger.log(gameState.game.turn, "rebuttal_response_received", {
        attempt,
        contentLength: llmResponse.content?.length,
        usage: llmResponse.usage,
        stop_reason: llmResponse.stop_reason
      });
    }

    if (isTokenLimitStopReason(llmResponse.stop_reason) || !llmResponse.content?.trim()) {
      lastError = `Rebuttal response truncated or incomplete (stop_reason=${llmResponse.stop_reason || "unknown"}, output=${llmResponse.usage?.output ?? "unknown"}, requested=${maxTokens})`;
      if (onStatus) onStatus("Response truncated — retrying...");
      if (logger) logger.log(gameState.game.turn, "error", { attempt, error: lastError });
      retryMessages = [
        ...messages,
        { role: "user", content: "IMPORTANT: Your previous response was cut off or incomplete. Respond with ONLY valid JSON. Be much more concise: compact narrative, shorter justifications, and only include state_updates for fields that actually changed." }
      ];
      continue;
    }

    // Parse JSON
    let parsed;
    try {
      let content = (llmResponse.content || "").trim();
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      parsed = JSON.parse(content);
    } catch (e) {
      lastError = `Failed to parse rebuttal response as JSON: ${e.message}`;
      // Don't feed the broken response back — just tell the LLM what went wrong
      retryMessages = [
        ...messages,
        { role: "user", content: `Your previous response was not valid JSON. Error: ${e.message}\n\nPlease respond with ONLY a valid JSON object conforming to the adjudication schema.` }
      ];
      continue;
    }

    const validation = validateAdjudication(parsed, { scaleTier });
    if (!validation.valid) {
      lastError = `Rebuttal validation failed: ${validation.errors.join("; ")}`;
      if (attempt < MAX_RETRIES) {
        const truncatedContent = (llmResponse.content || "").slice(0, 2000) + "\n...[truncated]";
        retryMessages = [
          ...messages,
          { role: "assistant", content: truncatedContent },
          { role: "user", content: `Your previous response failed validation:\n${validation.errors.map(e => `- ${e}`).join("\n")}\n\nPlease regenerate as valid JSON.` }
        ];
        continue;
      }
      // Final retry also invalid — fall through to error return at end of loop
      continue;
    }

    // Validate positions — same as adjudicate()
    if (parsed.adjudication?.state_updates && terrainData) {
      const posResult = validatePositionUpdates(parsed.adjudication.state_updates, gameState, terrainData);
      for (const c of posResult.corrections) {
        const update = parsed.adjudication.state_updates.find(u => u.entity === c.entity);
        if (update) {
          update.new_value = c.corrected;
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
    error: `Rebuttal adjudication failed after ${attemptsUsed || 0} attempt${attemptsUsed === 1 ? "" : "s"}. Last error: ${lastError}`
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
  "fatigue", "entrenchment", "cohesion",
  "readiness", "munitions", "sorties",
]);

// Fields managed by the engine — LLM proposals are silently dropped
const MECHANICAL_FIELDS = new Set(["supply"]);

// Whitelist of attributes the LLM is allowed to modify via state_updates.
// Anything not on this list is silently dropped. This prevents the LLM from
// changing identity fields (id, actor, name, type) or internal engine fields.
const ALLOWED_UPDATE_ATTRIBUTES = new Set([
  "position", "posture", "status", "strength", "morale", "ammo", "fuel",
  "fatigue", "entrenchment", "cohesion", "supply",
  // Air-specific fields (LLM can adjust readiness/munitions via combat results)
  "readiness", "munitions", "sorties", "baseHex",
  // Combat results
  "casualties", "kills",
  // Special states
  "retreating", "routing", "pinned", "suppressed",
]);

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
      // Use word-boundary regex to avoid partial matches (e.g., "Fox" matching "Foxtrot")
      const matchedUnit = newUnits.find(u => {
        const escaped = u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(a.action);
      });
      if (matchedUnit) impossibleEntities.add(matchedUnit.id);
    }
  }

  // Terrain modifications overlay — track changes from engineering, smoke, combat
  let newTerrainMods = gameState.terrainMods ? { ...gameState.terrainMods } : {};

  for (const update of updates) {
    const { entity, attribute, new_value } = update;

    // Skip state updates for entities with impossible actions
    if (impossibleEntities.has(entity)) continue;

    // Skip mechanically-managed fields — engine handles these, LLM proposals cause double-dipping
    if (MECHANICAL_FIELDS.has(attribute)) continue;

    // Security: only allow whitelisted attributes. Prevents LLM from changing
    // identity fields (id, actor, name, type) or internal engine fields.
    // Terrain and diplomacy entities bypass the unit attribute whitelist.
    if (!ALLOWED_UPDATE_ATTRIBUTES.has(attribute) && entity !== "diplomacy" && entity !== "terrain") continue;

    // Find and update matching unit.
    // Guard uses the allowlist, not field existence — LLM must be able to set new
    // fields like "routing" or "pinned" that aren't present at unit initialization.
    const unitIdx = newUnits.findIndex(u => u.id === entity);
    if (unitIdx !== -1) {
      let normalizedValue = new_value;

      // Normalize position values: LLM returns Excel-style ("H4"), state uses comma ("7,3")
      // Guard: if labelToCommaPosition returns non-comma format, keep current position
      if (attribute === "position" && typeof new_value === "string") {
        const converted = labelToCommaPosition(new_value);
        normalizedValue = (converted && converted.includes(",")) ? converted : newUnits[unitIdx].position;
      }

      // Normalize baseHex: same validation as position — must be a valid "col,row" string
      if (attribute === "baseHex" && typeof new_value === "string") {
        if (new_value === "") {
          normalizedValue = "";  // Empty string = no base (valid)
        } else {
          const converted = labelToCommaPosition(new_value);
          normalizedValue = (converted && converted.includes(",")) ? converted : newUnits[unitIdx].baseHex;
        }
      }

      // Normalize numeric fields: strip "%", parse to number, clamp 0-100
      if (NUMERIC_FIELDS.has(attribute)) {
        normalizedValue = normalizeNumericValue(new_value, newUnits[unitIdx][attribute]);
      }

      // DIG_IN fortification accrual: when entrenchment increases, accrue 50% to hex.
      // This makes fieldworks persist on the terrain even if the unit moves away.
      if (attribute === "entrenchment" && typeof normalizedValue === "number") {
        const oldEntrench = newUnits[unitIdx].entrenchment || 0;
        if (normalizedValue > oldEntrench) {
          const hexAccrual = Math.round((normalizedValue - oldEntrench) * 0.5);
          const unitPos = newUnits[unitIdx].position;
          if (hexAccrual > 0 && unitPos) {
            if (!newTerrainMods[unitPos]) newTerrainMods[unitPos] = {};
            const existing = newTerrainMods[unitPos].fortification?.level || 0;
            newTerrainMods[unitPos] = {
              ...newTerrainMods[unitPos],
              fortification: { level: Math.min(100, existing + hexAccrual), turn: gameState.game.turn }
            };
          }
        }
      }

      newUnits[unitIdx] = { ...newUnits[unitIdx], [attribute]: normalizedValue };
    }
  }

  // ── Transport mechanics (cargo sync, disembark, transport destruction) ──

  // 1. Sync cargo positions: embarked units track their transport's final position
  for (const unit of newUnits) {
    if (unit.cargo?.length > 0) {
      for (const cargoId of unit.cargo) {
        const cargoUnit = newUnits.find(u => u.id === cargoId);
        if (cargoUnit) cargoUnit.position = unit.position;
      }
    }
  }

  // 2. Transport destruction: if a transport with cargo is destroyed, damage all cargo
  for (const unit of newUnits) {
    if ((unit.status === "destroyed" || unit.status === "eliminated") && unit.cargo?.length > 0) {
      for (const cargoId of unit.cargo) {
        const cargoUnit = newUnits.find(u => u.id === cargoId);
        if (cargoUnit && cargoUnit.status !== "destroyed") {
          cargoUnit.strength = Math.min(cargoUnit.strength || 100, 20);
          if (cargoUnit.morale !== undefined) cargoUnit.morale = Math.floor((cargoUnit.morale || 100) / 2);
          cargoUnit.status = "damaged";
          // Eject survivors from destroyed transport
          cargoUnit.embarkedIn = null;
        }
      }
      unit.cargo = [];
    }
  }

  // 3. Resolve DISEMBARK orders: remove unit from transport cargo
  for (const update of updates) {
    if (update.entity && update.attribute === "position") {
      const unit = newUnits.find(u => u.id === update.entity);
      if (unit?.embarkedIn) {
        // Check if this unit had a DISEMBARK order by looking at playerActions
        const actorActions = playerActions[unit.actor];
        const unitAction = actorActions?.[unit.id] || actorActions?.unitOrders?.[unit.id];
        const hadDisembark = unitAction?.movementOrder?.type === "DISEMBARK" ||
                             unitAction?.movementOrder?.id === "DISEMBARK";
        if (hadDisembark) {
          const transport = newUnits.find(u => u.id === unit.embarkedIn);
          if (transport?.cargo) {
            transport.cargo = transport.cargo.filter(id => id !== unit.id);
          }
          unit.embarkedIn = null;
        }
      }
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

  // Apply terrain modifications (entity = "terrain", attribute = cell coordinate like "H4")
  for (const update of updates) {
    if (update.entity !== "terrain") continue;
    if (!update.attribute || !update.new_value) continue;

    // Convert Excel-style coordinate to comma format: "H4" -> "7,3"
    const cellKey = labelToCommaPosition(update.attribute);
    if (!cellKey || !cellKey.includes(",")) continue;

    const modValue = typeof update.new_value === "string"
      ? (() => { try { return JSON.parse(update.new_value); } catch { return null; } })()
      : update.new_value;
    if (!modValue?.type) continue;

    if (!newTerrainMods[cellKey]) newTerrainMods[cellKey] = {};
    const cellMods = { ...newTerrainMods[cellKey] };

    switch (modValue.type) {
      case "bridge_built":
        cellMods.bridge_built = { turn: gameState.game.turn };
        delete cellMods.bridge_destroyed;
        break;
      case "bridge_destroyed":
        cellMods.bridge_destroyed = { turn: gameState.game.turn };
        delete cellMods.bridge_built;
        break;
      case "obstacle":
        cellMods.obstacle = { turn: gameState.game.turn, subtype: modValue.subtype || "general" };
        delete cellMods.obstacle_cleared;
        break;
      case "obstacle_cleared":
        cellMods.obstacle_cleared = { turn: gameState.game.turn };
        delete cellMods.obstacle;
        break;
      case "fortification": {
        const level = Math.max(0, Math.min(100, Number(modValue.level) || 0));
        cellMods.fortification = { level, turn: gameState.game.turn };
        break;
      }
      case "smoke": {
        const turnsRemaining = Math.max(1, Math.min(3, Number(modValue.turnsRemaining) || 2));
        cellMods.smoke = { turnsRemaining, turn: gameState.game.turn };
        break;
      }
      case "terrain_damaged": {
        const level = Math.max(0, Math.min(100, Number(modValue.level) || 0));
        cellMods.terrain_damaged = { level, turn: gameState.game.turn };
        break;
      }
      default:
        continue;
    }

    newTerrainMods[cellKey] = cellMods;
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
    terrainMods: newTerrainMods,
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
      // Deduct from depots proportionally based on each depot's share of total supply.
      // Without proportional distribution, totalConsumed was subtracted from EVERY depot,
      // draining N× the actual consumption (where N = depot count).
      if (totalConsumed > 0) {
        let remaining = totalConsumed;
        const newDepots = net.depots.map(d => {
          if (remaining <= 0 || d.current <= 0) return d;
          // Each depot's share: proportional to its current supply / totalAvail
          const share = Math.min(Math.ceil(totalConsumed * (d.current / totalAvail)), remaining, d.current);
          remaining -= share;
          return { ...d, current: d.current - share };
        });
        newSupplyNetwork[actorId] = { ...net, depots: newDepots };
      }
    }
  }

  // Apply air logistics: readiness recovery, fuel, munitions, sortie regeneration
  // Tier 2+ — helicopters exist at tier 2, fixed-wing at tier 3+
  if (scaleTier >= 2) {
    newUnits = applyAirTurnUpdates(newUnits, scaleTier, gameState.scenario?.turnDuration);
  }

  // Progress weather/environment between turns
  const turnMs = parseTurnDuration(gameState.scenario?.turnDuration);
  const newEnvironment = progressEnvironment(gameState.environment, turnMs);

  // Decay smoke in terrain modifications — decrement turnsRemaining, remove expired
  let newTerrainMods = gameState.terrainMods ? { ...gameState.terrainMods } : {};
  let terrainModsChanged = false;
  for (const cellKey of Object.keys(newTerrainMods)) {
    if (newTerrainMods[cellKey]?.smoke) {
      terrainModsChanged = true;
      const remaining = newTerrainMods[cellKey].smoke.turnsRemaining - 1;
      if (remaining <= 0) {
        const { smoke, ...rest } = newTerrainMods[cellKey];
        newTerrainMods[cellKey] = rest;
        if (Object.keys(newTerrainMods[cellKey]).length === 0) {
          delete newTerrainMods[cellKey];
        }
      } else {
        newTerrainMods[cellKey] = {
          ...newTerrainMods[cellKey],
          smoke: { ...newTerrainMods[cellKey].smoke, turnsRemaining: remaining }
        };
      }
    }
  }

  // ── VP Tracking ──────────────────────────────────────────────
  // Compute VP status if scenario defines victoryConditions with hex VP.
  // Determines who controls each VP hex based on unit occupancy.
  const vc = gameState.scenario?.victoryConditions;
  let newVpStatus = gameState.game?.vpStatus || null;
  if (vc?.hexVP?.length > 0) {
    const prevControl = gameState.game?.vpControl || {};
    const newControl = { ...prevControl };
    const vpByActor = {};

    // Initialize VP per actor to 0
    for (const actor of (gameState.scenario.actors || [])) {
      vpByActor[actor.id] = 0;
    }

    for (const vp of vc.hexVP) {
      const hexKey = vp.hex; // "col,row" format
      // Find non-destroyed units occupying this hex
      // Positions are stored as "col,row" strings — compare directly
      const occupiers = newUnits.filter(u =>
        u.status !== "destroyed" && u.status !== "eliminated" &&
        u.position && String(u.position) === hexKey
      );

      const actorsOnHex = [...new Set(occupiers.map(u => u.actor))];

      if (actorsOnHex.length === 1) {
        // Single actor controls this hex
        newControl[hexKey] = actorsOnHex[0];
      } else if (actorsOnHex.length > 1) {
        // Contested — no VP awarded, control doesn't change
        newControl[hexKey] = "contested";
      }
      // If no units on hex: last holder retains control (already in prevControl)

      // Award VP to controlling actor (if not contested)
      const controller = newControl[hexKey];
      if (controller && controller !== "contested" && vpByActor[controller] !== undefined) {
        vpByActor[controller] += (vp.vp || 0);
      }
    }

    // ── CVP Loss Check ──────────────────────────────────────
    // Each actor's cvpHexes are must-hold. Lose ALL = game loss.
    // Track CVP status per actor: { actorId: { total, held, lost } }
    const cvpStatus = {};
    for (const actor of (gameState.scenario.actors || [])) {
      const hexes = actor.cvpHexes || [];
      if (hexes.length === 0) continue;
      let held = 0;
      for (const hex of hexes) {
        // A CVP hex is "held" if the actor controls it OR if no one else does
        const ctrl = newControl[hex];
        if (!ctrl || ctrl === actor.id) held++;
        // If contested or another actor holds it, it's lost
      }
      cvpStatus[actor.id] = { total: hexes.length, held, lost: hexes.length - held };
    }

    // Compute VP history for rate calculation
    const prevVpHistory = gameState.game?.vpHistory || [];
    const newVpHistory = [...prevVpHistory, { turn: gameState.game.turn, vp: { ...vpByActor } }];
    // Keep last 5 turns for rate calc
    if (newVpHistory.length > 5) newVpHistory.shift();

    newVpStatus = { vp: vpByActor, cvp: cvpStatus };
    // Store control map and history alongside vpStatus in game state
    var newVpControl = newControl;
    var newVpHistory_final = newVpHistory;
  }

  let result = {
    ...gameState,
    units: newUnits,
    supplyNetwork: newSupplyNetwork,
    terrainMods: terrainModsChanged ? newTerrainMods : (gameState.terrainMods || {}),
    environment: newEnvironment,
    game: {
      ...gameState.game,
      turn: gameState.game.turn + 1,
      phase: "planning",
      currentDate: newDate || gameState.game.currentDate || "",
      ...(newVpStatus ? { vpStatus: newVpStatus, vpControl: newVpControl, vpHistory: newVpHistory_final } : {})
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
          const key = [existing.id, reinf.newActor.id].sort().join("||");
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
// Games are stored in per-game folders under ./games/<name>/
// Each folder has: terrain.json, state.json, autosave_t*.json, log.json
// Legacy saves in saves/games/ are still loadable for backwards compat.

/**
 * Create a named game folder and copy terrain data into it.
 * Returns the folder name to store in game.folder.
 */
export async function createGameFolder(name, terrainData) {
  const resp = await fetch("/api/game/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, terrainData })
  });
  if (!resp.ok) throw new Error(`Failed to create game folder: ${resp.statusText}`);
  const result = await resp.json();
  if (!result.ok) throw new Error(result.error || "Failed to create game folder");
  return result.folder;
}

/**
 * Save game state to server.
 * If game.folder is set, saves to games/<folder>/state.json.
 * Otherwise falls back to legacy saves/games/ flat file.
 */
export async function saveGameState(gameState) {
  const filename = `${gameState.game.id}.json`;
  const resp = await fetch("/api/game/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: gameState })
  });
  if (!resp.ok) throw new Error(`Failed to save game: ${resp.statusText}`);
  return resp.json();
}

/**
 * Migrate old save data to current format.
 * Backfills weaponRangeKm on units that predate the km-based weapon range system.
 */
function migrateGameState(gs) {
  if (!gs?.units) return gs;
  // Deep-clone so we don't mutate the caller's object (e.g. cached server responses)
  gs = JSON.parse(JSON.stringify(gs));
  if (!gs.game?.mode) {
    gs.game = { ...(gs.game || {}), mode: "turn" };
  }
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
 * Supports both folder-based (new) and flat-file (legacy) loading.
 * @param {string} fileOrFolder — folder name (new) or filename (legacy)
 * @param {Object} [opts] — { folder: true } to force folder-based loading
 */
export async function loadGameState(fileOrFolder, opts = {}) {
  const isFolder = opts.folder || false;
  const url = isFolder
    ? `/api/game/load?folder=${encodeURIComponent(fileOrFolder)}${opts.autosaveFile ? `&autosaveFile=${encodeURIComponent(opts.autosaveFile)}` : ""}`
    : `/api/game/load?file=${encodeURIComponent(fileOrFolder)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load game: ${resp.statusText}`);
  const gs = await resp.json();
  return migrateGameState(gs);
}

/**
 * Load terrain data from a game's folder.
 */
export async function loadGameTerrain(folder) {
  const resp = await fetch(`/api/game/load-terrain?folder=${encodeURIComponent(folder)}`);
  if (!resp.ok) throw new Error(`Terrain not found for game: ${folder}`);
  return resp.json();
}

/**
 * List saved games (both folder-based and legacy).
 */
export async function listSavedGames() {
  const resp = await fetch("/api/game/list");
  if (!resp.ok) throw new Error(`Failed to list games: ${resp.statusText}`);
  return resp.json();
}

/**
 * Delete a game autosave.
 * Supports folder-based (new) and flat-file (legacy).
 */
export async function deleteGameSave(fileOrFolder, opts = {}) {
  let url;
  if (opts.folder && opts.autosaveFile) {
    url = `/api/game/delete?folder=${encodeURIComponent(opts.folder)}&autosaveFile=${encodeURIComponent(opts.autosaveFile)}`;
  } else if (opts.folder && opts.autosaveTurn != null) {
    url = `/api/game/delete?folder=${encodeURIComponent(opts.folder)}&autosave=${opts.autosaveTurn}`;
  } else {
    url = `/api/game/delete?file=${encodeURIComponent(fileOrFolder)}`;
  }
  const resp = await fetch(url, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Failed to delete game save: ${resp.statusText}`);
  return resp.json();
}

/**
 * Autosave game state with rolling 5-turn window.
 * Uses game folder if available, otherwise legacy flat-file.
 */
export async function autosave(gameState) {
  const gameId = gameState.game.id;
  const turn = gameState.game.turn;
  const folder = gameState.game.folder;
  const mode = gameState.game.mode || "turn";

  // The filename signals autosave to the server; server routes to correct location
  const autosaveSeq = mode === "rts"
    ? String(gameState.game.autosaveSeq || 0).padStart(6, "0")
    : String(turn);
  const filename = mode === "rts"
    ? `autosave_rts_${autosaveSeq}.json`
    : `${gameId}_autosave_t${turn}.json`;
  await fetch("/api/game/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: gameState })
  });

  // Prune old autosaves beyond the 5-turn window
  try {
    const AUTOSAVE_WINDOW = mode === "rts" ? 10 : 5;
    const list = await listSavedGames();

    if (folder) {
      // Folder-based: find autosaves in this game's folder
      const autosaves = list
        .filter(g => g.folder === folder && g.isAutosave && (g.mode || "turn") === mode)
        .sort((a, b) => {
          const tA = parseInt(a.autosaveLabel || "0", 10);
          const tB = parseInt(b.autosaveLabel || "0", 10);
          return tB - tA;
        });
      for (const old of autosaves.slice(AUTOSAVE_WINDOW)) {
        if (mode === "rts") {
          const fileName = old.file.split("/").pop();
          await deleteGameSave(null, { folder, autosaveFile: fileName }).catch(() => {});
        } else {
          const oldTurn = parseInt(old.file.match(/autosave_t(\d+)/)?.[1] || "0");
          await deleteGameSave(null, { folder, autosaveTurn: oldTurn }).catch(() => {});
        }
      }
    } else {
      // Legacy flat-file pruning
      const prefix = mode === "rts" ? "autosave_rts_" : `${gameId}_autosave_t`;
      const autosaves = list
        .filter(g => g.file.startsWith(prefix) && (g.mode || "turn") === mode)
        .sort((a, b) => {
          const tA = parseInt(a.autosaveLabel || "0", 10);
          const tB = parseInt(b.autosaveLabel || "0", 10);
          return tB - tA;
        });
      for (const old of autosaves.slice(AUTOSAVE_WINDOW)) {
        await deleteGameSave(old.file).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("[autosave] prune failed:", e.message);
  }
}

/**
 * Fetch available LLM providers.
 */
export async function getProviders() {
  const resp = await fetch("/api/llm/providers");
  if (!resp.ok) throw new Error(`Failed to fetch providers: ${resp.statusText}`);
  return resp.json();
}
