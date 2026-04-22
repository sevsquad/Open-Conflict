// ═══════════════════════════════════════════════════════════════
// AI ORDER CLIENT — Client-side AI order generation for hotseat.
// Calls the LLM proxy to generate orders for an AI-controlled actor.
// Uses the same FOW-filtered briefing a human player would see.
//
// Prompt construction, validation, and fallback logic live in
// aiPromptHelpers.js (shared with server-side aiPlayer.js).
// ═══════════════════════════════════════════════════════════════

import { buildActorBriefing } from "./briefingExport.js";
import {
  buildSystemMessage, buildUserMessage, buildVPContext,
  validateAndNormalizeOrders, buildFallbackOrders,
} from "./aiPromptHelpers.js";
import { computeTacticalAnalysis } from "./tacticalAnalysis.js";
import { generateAlgorithmicOrders } from "./algorithmicAi.js";
import { getTurnBudgetKey } from "./llmBudget.js";

// 30-minute timeout — Sonnet can take 10+ minutes on complex prompts
const AI_ORDER_TIMEOUT_MS = 1_800_000;
const MAX_RETRIES = 3;

// Models that support image/vision input (checked by prefix for version tolerance)
const VISION_MODEL_PREFIXES = [
  "claude-sonnet-4", "claude-opus-4", "claude-3-5-sonnet", "claude-3-opus",
  "gpt-4o", "gpt-4-turbo", "gpt-5",
];

/** Check if a model name supports vision (image input). */
export function isVisionModel(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  return VISION_MODEL_PREFIXES.some(prefix => m.startsWith(prefix));
}

// Max dimension for AI map captures — keeps image under ~200KB JPEG, well within
// the 10MB body limit and avoids excessive vision token cost
const AI_MAP_MAX_DIM = 1024;

/**
 * Capture the current map as a base64 JPEG for AI context.
 * Uses the SimMap ref's exportImage() method which composites WebGL terrain + Canvas2D overlays.
 * Downscales to AI_MAP_MAX_DIM on the longest edge to control payload size.
 * Returns null if capture fails (graceful degradation — AI gets text-only briefing).
 */
export function captureMapForAI(simMapRef) {
  try {
    if (!simMapRef?.current?.exportImage) return null;
    const dataUrl = simMapRef.current.exportImage();
    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return null;

    // Load the full-res PNG into an Image, then draw downscaled to a small canvas
    // This is synchronous because we use an offscreen canvas with the raw data
    const img = new Image();
    img.src = dataUrl;

    // If image isn't loaded synchronously (shouldn't happen with data URLs but just in case)
    if (!img.complete || !img.naturalWidth) {
      // Fallback: just return the raw PNG base64 without downscaling
      return dataUrl.replace("data:image/png;base64,", "");
    }

    // Calculate downscaled dimensions
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > AI_MAP_MAX_DIM || h > AI_MAP_MAX_DIM) {
      const scale = AI_MAP_MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    // JPEG at 0.8 quality — much smaller than PNG, fine for LLM map reading
    const jpegUrl = canvas.toDataURL("image/jpeg", 0.8);
    return jpegUrl.replace("data:image/jpeg;base64,", "");
  } catch (e) {
    console.warn("[AI] Map capture failed, continuing with text-only:", e.message);
    return null;
  }
}

/**
 * Generate orders for an AI actor (client-side, for hotseat mode).
 *
 * @param {Object} gameState - current game state
 * @param {string} actorId - which actor the AI controls
 * @param {Object} terrainData - full terrain grid
 * @param {Object} aiConfig - { provider, model, personality } from actor config
 * @param {Object} options - { idleUnits, previousTurnContext, visibilityState, fortuneRolls, frictionEvents, abortSignal, mapImageBase64 }
 * @returns {Object} { unitOrders, actorIntent, usage, error? }
 */
export async function generateAIOrdersClient(gameState, actorId, terrainData, aiConfig, options = {}) {
  const { idleUnits, previousTurnContext, visibilityState, fortuneRolls, frictionEvents, abortSignal, mapImageBase64 } = options;

  if ((aiConfig?.engine || "llm") === "algorithmic") {
    return generateAlgorithmicOrders(gameState, actorId, terrainData, aiConfig, {
      idleUnits,
      previousTurnContext,
      visibilityState,
      fortuneRolls,
      frictionEvents,
    });
  }

  // Get actor's operational units
  const actorUnits = gameState.units.filter(u => u.actor === actorId && u.status !== "destroyed" && u.status !== "eliminated");

  if (actorUnits.length === 0) {
    return { unitOrders: {}, actorIntent: "No operational units remaining.", commanderThoughts: "All units lost. Nothing to command.", usage: null };
  }

  // Build FOW-filtered briefing (same context a human player would see)
  // Skip history and orders section — handled by CAMPAIGN MEMORY and JSON format spec
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

  // Compute tactical analysis (heatmap, sectors, gaps, vulnerability, recon confidence)
  // visibilityState uses same shape as detectionContext ({ actorVisibility })
  const tacticalAnalysis = computeTacticalAnalysis(actorId, gameState, terrainData, visibilityState);

  // Build user message (changes every turn)
  const userMsg = buildUserMessage(briefing, actorUnits, {
    idleUnits,
    previousTurnContext,
    vpContext,
    tacticalAnalysis,
  });

  // Retry loop: up to MAX_RETRIES attempts
  let lastError = null;
  let retryCount = 0;
  let lastRawResponse = "";
  let usage = null;
  const budgetKey = getTurnBudgetKey(gameState);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Build the user content — on retry, include error feedback
      let userContent = userMsg;
      if (attempt > 0 && lastError) {
        userContent += `\n\n═══ RETRY — PREVIOUS ATTEMPT FAILED ═══\n`;
        userContent += `Error: ${lastError}\n`;
        if (lastRawResponse) {
          userContent += `Your previous response (which failed to parse):\n${lastRawResponse.slice(0, 500)}\n`;
        }
        userContent += `Please respond with ONLY valid JSON. No markdown, no explanation, just the JSON object.`;
      }

      const provider = aiConfig?.provider || gameState.game.config.llm.provider;
      const model = aiConfig?.model || gameState.game.config.llm.model;

      // Build message content — multimodal if vision model + map image available.
      // Only include image on first attempt — retries are for JSON parse failures,
      // the LLM already saw the map. Saves ~1000+ vision tokens per retry.
      let messageContent;
      const useVision = mapImageBase64 && isVisionModel(model) && attempt === 0;
      if (useVision) {
        // Multimodal: image + text
        const imageBlock = provider === "openai"
          ? { type: "image_url", image_url: { url: `data:image/jpeg;base64,${mapImageBase64}` } }
          : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: mapImageBase64 } };
        messageContent = [
          imageBlock,
          { type: "text", text: "Above is the current map showing terrain and unit positions.\n\n" + userContent },
        ];
      } else {
        messageContent = userContent;
      }

      // Use AbortController for both user cancel and timeout
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), AI_ORDER_TIMEOUT_MS);

      // If external abort signal provided, link it
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => timeoutController.abort(), { once: true });
      }

      try {
        const resp = await fetch("/api/llm/adjudicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            model,
            temperature: 0.4,
            max_tokens: 8192,
            budget_key: budgetKey,
            messages: [
              { role: "system", content: systemMsg },
              { role: "user", content: messageContent },
            ],
          }),
          signal: timeoutController.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          lastError = `LLM proxy returned ${resp.status}: ${errText}`;
          retryCount = attempt + 1;
          if (resp.status !== 429) break;
          continue;
        }

        const result = await resp.json();

        if (!result.ok) {
          lastError = result.error || "LLM call failed";
          retryCount = attempt + 1;
          if (result.retryable !== true) break;
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
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      if (e.name === "AbortError") {
        return buildFallbackOrders(actorUnits, "AI order generation was cancelled.", null, userMsg, "", 0);
      }
      lastError = e.message;
      lastRawResponse = lastRawResponse || "";
      retryCount = attempt + 1;
    }
  }

  // All retries exhausted — fall back to HOLD for all units
  return buildFallbackOrders(actorUnits, `AI ORDER GENERATION FAILED after ${MAX_RETRIES} attempts: ${lastError}`, usage, userMsg, lastRawResponse, retryCount);
}
