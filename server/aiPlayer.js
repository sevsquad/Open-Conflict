// ═══════════════════════════════════════════════════════════════
// AI PLAYER — Server-side LLM order generation for PBEM AI actors.
// Uses the same FOW-filtered briefing a human player would see,
// sends it to an LLM, and gets back structured orders in the
// sealed orders format.
//
// Prompt construction, validation, and fallback logic live in
// aiPromptHelpers.js (shared with client-side aiOrderClient.js).
// ═══════════════════════════════════════════════════════════════

import { buildActorBriefing } from "../src/simulation/briefingExport.js";
import {
  buildSystemMessage, buildUserMessage, buildVPContext,
  validateAndNormalizeOrders, buildFallbackOrders,
} from "../src/simulation/aiPromptHelpers.js";
import { computeTacticalAnalysis } from "../src/simulation/tacticalAnalysis.js";
import { generateAlgorithmicOrders } from "../src/simulation/algorithmicAi.js";
import { getTurnBudgetKey } from "../src/simulation/llmBudget.js";
import { callLLM } from "./llmProxy.js";

const MAX_RETRIES = 3;

/**
 * Generate orders for an AI player (server-side, for PBEM mode).
 *
 * @param {Object} gameState - current game state (full, server-side)
 * @param {string} actorId - which actor the AI controls
 * @param {Object} terrainData - full terrain grid
 * @param {Object} aiConfig - { provider, model, apiKey, personality } from player record
 * @param {Object} options - { visibilityState, fortuneRolls, frictionEvents, idleUnits, previousTurnContext }
 * @returns {Object} { unitOrders, actorIntent, usage, error?, retryCount }
 */
export async function generateAIOrders(gameState, actorId, terrainData, aiConfig, options = {}) {
  const { visibilityState, fortuneRolls, frictionEvents, idleUnits, previousTurnContext, operationalState } = options;

  if ((aiConfig?.engine || "llm") === "algorithmic") {
    return generateAlgorithmicOrders(gameState, actorId, terrainData, aiConfig, {
      visibilityState,
      fortuneRolls,
      frictionEvents,
      idleUnits,
      previousTurnContext,
      operationalState,
    });
  }

  const actorUnits = gameState.units.filter(u => u.actor === actorId && u.status !== "destroyed" && u.status !== "eliminated");

  if (actorUnits.length === 0) {
    return { unitOrders: {}, actorIntent: "No operational units remaining.", commanderThoughts: "All units lost. Nothing to command.", usage: null };
  }

  // Build FOW-filtered briefing — skip history and orders section for AI
  const briefing = buildActorBriefing(gameState, actorId, terrainData, {
    fortuneRolls,
    frictionEvents,
    visibilityState,
    skipHistory: true,
    skipOrdersSection: true,
  });

  // Build system message (static per game — benefits from prompt caching)
  const systemMsg = buildSystemMessage(actorUnits, terrainData, aiConfig);

  // Build VP context if scenario defines victory conditions
  const vpContext = buildVPContext(gameState, actorId);

  // Compute tactical analysis
  const tacticalAnalysis = computeTacticalAnalysis(actorId, gameState, terrainData, visibilityState);

  // Build user message (changes every turn)
  const userMsg = buildUserMessage(briefing, actorUnits, {
    idleUnits,
    previousTurnContext,
    vpContext,
    tacticalAnalysis,
  });

  const provider = aiConfig?.provider || "anthropic";
  const model = aiConfig?.model || "claude-sonnet-4-20250514";
  const budgetKey = getTurnBudgetKey(gameState);

  // Build per-call API key overrides (no process.env mutation)
  const apiKeys = {};
  if (aiConfig?.apiKey) {
    if (provider === "anthropic") apiKeys.anthropicKey = aiConfig.apiKey;
    else if (provider === "openai") apiKeys.openaiKey = aiConfig.apiKey;
  }

  // Retry loop: up to MAX_RETRIES attempts
  let lastError = null;
  let lastRawResponse = "";
  let usage = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // On retry, include error feedback in the user message
      let userContent = userMsg;
      if (attempt > 0 && lastError) {
        userContent += `\n\n═══ RETRY — PREVIOUS ATTEMPT FAILED ═══\n`;
        userContent += `Error: ${lastError}\n`;
        if (lastRawResponse) {
          userContent += `Your previous response (which failed to parse):\n${lastRawResponse.slice(0, 500)}\n`;
        }
        userContent += `Please respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.`;
      }

      const result = await callLLM(provider, model, [
        { role: "system", content: systemMsg },
        { role: "user", content: userContent },
      ], {
        temperature: 0.4,
        maxTokens: 8192,
        apiKeys: Object.keys(apiKeys).length > 0 ? apiKeys : undefined,
        budgetKey,
      });

      if (!result.ok) {
        lastError = `LLM call failed: ${result.error}`;
        continue;
      }

      usage = result.usage || null;

      // Parse JSON response
      let content = (result.content || "").trim();
      lastRawResponse = content;

      // Strip markdown code fences if present
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }

      const parsed = JSON.parse(content);
      const validated = validateAndNormalizeOrders(parsed, actorUnits, terrainData);

      return {
        ...validated,
        usage,
        rawPrompt: userMsg,
        rawResponse: lastRawResponse,
        retryCount: attempt,
      };
    } catch (e) {
      lastError = e.message;
      lastRawResponse = lastRawResponse || "";
    }
  }

  // All retries exhausted — fall back to HOLD for all units
  const safeIntent = "AI order generation failed — holding all positions.";
  return buildFallbackOrders(actorUnits, safeIntent, usage, userMsg, lastRawResponse, MAX_RETRIES, lastError);
}
