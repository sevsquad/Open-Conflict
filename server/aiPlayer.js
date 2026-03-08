// ═══════════════════════════════════════════════════════════════
// AI PLAYER — LLM-as-opponent order generation.
// Uses the same FOW-filtered briefing a human player would see,
// sends it to an LLM, and gets back structured orders in the
// sealed orders format.
//
// The AI player's LLM API key comes from the player's ai_config_json
// (stored at game creation). This lets each player bring their own
// key, keeping costs on the player who wants the AI opponent.
//
// Order format (must match human player sealed orders exactly):
// {
//   unitOrders: {
//     "unit_id": {
//       movementOrder: { id: "MOVE"|"WITHDRAW", target: "col,row" } | null,
//       actionOrder:   { id: "ATTACK"|..., target: "col,row", subtype: ... } | null,
//       intent: "free text"
//     }
//   },
//   actorIntent: "commander's intent text"
// }
// ═══════════════════════════════════════════════════════════════

import { buildActorBriefing } from "../src/simulation/briefingExport.js";
import { callLLM, allowModel } from "./llmProxy.js";
import { ORDER_TYPES } from "../src/simulation/orderTypes.js";

/**
 * Generate orders for an AI player.
 *
 * @param {Object} gameState - current game state (full, server-side)
 * @param {string} actorId - which actor the AI controls
 * @param {Object} terrainData - full terrain grid
 * @param {Object} aiConfig - { provider, model, apiKey } from player record
 * @param {Object} options - { visibilityState, fortuneRolls, frictionEvents }
 * @returns {Object} sealed orders in the standard format, or { error }
 */
export async function generateAIOrders(gameState, actorId, terrainData, aiConfig, options = {}) {
  const { visibilityState, fortuneRolls, frictionEvents } = options;

  // Build the FOW-filtered briefing the AI will use as context
  const briefing = buildActorBriefing(gameState, actorId, terrainData, {
    fortuneRolls,
    frictionEvents,
    visibilityState,
  });

  // Get the AI's units for the order schema
  const actorUnits = gameState.units.filter(u => u.actor === actorId && u.status !== "destroyed" && u.status !== "eliminated");

  if (actorUnits.length === 0) {
    return { unitOrders: {}, actorIntent: "No operational units remaining." };
  }

  // Build the prompt that asks the LLM to generate orders
  const orderPrompt = buildOrderPrompt(briefing, actorUnits, gameState, terrainData);

  // If the AI has its own API key, temporarily allow their model
  if (aiConfig.model) {
    allowModel(aiConfig.provider || "anthropic", aiConfig.model);
  }

  // Override env API key if AI player brought their own
  const originalKey = process.env[`${(aiConfig.provider || "anthropic").toUpperCase()}_API_KEY`];
  if (aiConfig.apiKey) {
    process.env[`${(aiConfig.provider || "anthropic").toUpperCase()}_API_KEY`] = aiConfig.apiKey;
  }

  try {
    const result = await callLLM(
      aiConfig.provider || "anthropic",
      aiConfig.model || "claude-sonnet-4-20250514",
      [{ role: "user", content: orderPrompt }],
      { temperature: 0.6, maxTokens: 4096 }
    );

    if (!result.ok) {
      return { error: `AI order generation failed: ${result.error}` };
    }

    // Parse the LLM response as JSON orders
    let content = (result.content || "").trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(content);

    // Validate and normalize the order structure
    const validatedOrders = validateAIOrders(parsed, actorUnits, terrainData);

    return validatedOrders;
  } catch (e) {
    return { error: `AI order generation error: ${e.message}` };
  } finally {
    // Restore original API key
    if (aiConfig.apiKey && originalKey !== undefined) {
      process.env[`${(aiConfig.provider || "anthropic").toUpperCase()}_API_KEY`] = originalKey;
    }
  }
}


// ── Prompt Construction ──────────────────────────────────────

function buildOrderPrompt(briefing, actorUnits, gameState, terrainData) {
  const lines = [];

  lines.push("You are an AI military commander in a turn-based wargame simulation.");
  lines.push("Based on the briefing below, issue orders for each of your units.");
  lines.push("");
  lines.push("═══ SITUATION BRIEFING ═══");
  lines.push(briefing);
  lines.push("");
  lines.push("═══ YOUR UNITS ═══");

  for (const u of actorUnits) {
    lines.push(`- ${u.name} (ID: ${u.id}, Type: ${u.type}, Position: ${u.position}, Strength: ${u.strength}%, Morale: ${u.morale}%)`);
  }

  lines.push("");
  lines.push("═══ AVAILABLE ORDERS ═══");
  lines.push("Movement orders: MOVE (move toward target hex), WITHDRAW (retreat toward target hex)");
  lines.push("Action orders: ATTACK (engage target), DEFEND (hold position), SUPPORT_FIRE (fire support to target hex),");
  lines.push("  FIRE_MISSION (artillery, subtypes: HE or SMOKE), DIG_IN (improve entrenchment),");
  lines.push("  RECON (scout target area), RESUPPLY (resupply at current position),");
  lines.push("  ENGINEER (subtypes: BRIDGE, OBSTACLE, BREACH, FORTIFY, DEMOLISH),");
  lines.push("  SHORE_BOMBARDMENT (naval fire support), BLOCKADE (naval blockade)");
  lines.push("");
  lines.push("Target format: \"col,row\" (e.g., \"3,4\" or \"7,2\")");
  lines.push(`Map dimensions: ${terrainData?.cols || "?"} columns x ${terrainData?.rows || "?"} rows`);
  lines.push("");
  lines.push("═══ RESPONSE FORMAT ═══");
  lines.push("Respond with ONLY valid JSON in this exact format:");
  lines.push("{");
  lines.push('  "unitOrders": {');
  lines.push('    "<unit_id>": {');
  lines.push('      "movementOrder": { "id": "MOVE", "target": "col,row" } or null,');
  lines.push('      "actionOrder": { "id": "DEFEND", "target": "col,row", "subtype": null } or null,');
  lines.push('      "intent": "brief explanation of what this unit should do"');
  lines.push("    }");
  lines.push("  },");
  lines.push('  "actorIntent": "overall strategic intent for this turn"');
  lines.push("}");
  lines.push("");
  lines.push("Every unit must have an entry. Units with no orders should have null for both movementOrder and actionOrder.");
  lines.push("Think strategically: consider terrain, enemy positions (if known), supply lines, and overall objectives.");

  return lines.join("\n");
}


// ── Order Validation ─────────────────────────────────────────

/**
 * Validate and normalize AI-generated orders.
 * Ensures unit IDs match, order types are valid, and targets are in bounds.
 */
function validateAIOrders(parsed, actorUnits, terrainData) {
  const unitOrders = {};
  const validUnitIds = new Set(actorUnits.map(u => u.id));

  const validMovementIds = new Set(["MOVE", "WITHDRAW"]);
  const validActionIds = new Set([
    "ATTACK", "DEFEND", "SUPPORT_FIRE", "FIRE_MISSION", "DIG_IN",
    "RECON", "RESUPPLY", "ENGINEER", "SHORE_BOMBARDMENT", "BLOCKADE",
  ]);

  const rawOrders = parsed?.unitOrders || {};

  for (const unit of actorUnits) {
    const orders = rawOrders[unit.id] || {};

    // Validate movement order
    let movementOrder = null;
    if (orders.movementOrder && validMovementIds.has(orders.movementOrder.id)) {
      const target = normalizeTarget(orders.movementOrder.target, terrainData);
      if (target) {
        movementOrder = { id: orders.movementOrder.id, target };
      }
    }

    // Validate action order
    let actionOrder = null;
    if (orders.actionOrder && validActionIds.has(orders.actionOrder.id)) {
      const target = normalizeTarget(orders.actionOrder.target, terrainData);
      if (target) {
        actionOrder = {
          id: orders.actionOrder.id,
          target,
          subtype: orders.actionOrder.subtype || null,
        };
      }
    }

    unitOrders[unit.id] = {
      movementOrder,
      actionOrder,
      intent: typeof orders.intent === "string" ? orders.intent.slice(0, 500) : "",
    };
  }

  return {
    unitOrders,
    actorIntent: typeof parsed?.actorIntent === "string" ? parsed.actorIntent.slice(0, 1000) : "",
  };
}

/**
 * Normalize a target string to "col,row" format and clamp to map bounds.
 */
function normalizeTarget(target, terrainData) {
  if (!target || typeof target !== "string") return null;

  // Accept "col,row" format
  const match = target.match(/^(\d+)\s*,\s*(\d+)$/);
  if (!match) return null;

  let col = parseInt(match[1], 10);
  let row = parseInt(match[2], 10);

  // Clamp to map bounds
  if (terrainData) {
    col = Math.max(0, Math.min(col, (terrainData.cols || 12) - 1));
    row = Math.max(0, Math.min(row, (terrainData.rows || 15) - 1));
  }

  return `${col},${row}`;
}
