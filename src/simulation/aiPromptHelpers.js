// ═══════════════════════════════════════════════════════════════
// AI PROMPT HELPERS — Shared prompt-building and validation for
// both client-side (aiOrderClient.js) and server-side (aiPlayer.js).
// Single source of truth for order reference, validation, and
// fallback logic — eliminates drift between the two files.
// ═══════════════════════════════════════════════════════════════

import {
  ORDER_TYPES, ORDER_SLOT, ORDER_VALIDITY, COMPATIBILITY,
  getValidOrders, isOrderValid, isCompatible,
} from "./orderTypes.js";

// ── Derive valid IDs dynamically from ORDER_TYPES ───────────
// Instead of hardcoded sets that can drift, we build them from
// the source of truth. DISEMBARK is included automatically.

const ALL_MOVEMENT_IDS = new Set(
  Object.values(ORDER_TYPES)
    .filter(o => o.slot === ORDER_SLOT.MOVEMENT)
    .map(o => o.id)
);

const ALL_ACTION_IDS = new Set(
  Object.values(ORDER_TYPES)
    .filter(o => o.slot === ORDER_SLOT.ACTION)
    .map(o => o.id)
);

// HOLD has slot: null — it's the absence of orders, always valid
const HOLD_ID = "HOLD";

// Orders that don't require a target hex
const NO_TARGET_ACTIONS = new Set(["DIG_IN", "DEFEND", "RESUPPLY", "CAP", "BLOCKADE"]);

// ── Order Reference Builder ─────────────────────────────────
// Generates the "available orders" section filtered by the actor's
// actual unit types, with descriptions and compatibility info.

/**
 * Build a prompt-ready order reference filtered by the actor's unit types.
 * @param {Array} actorUnits - array of unit objects (each has .type)
 * @returns {string} multi-line text block for the prompt
 */
export function buildOrderReference(actorUnits) {
  const lines = [];

  // Collect unique unit types
  const unitTypes = [...new Set(actorUnits.map(u => u.type))];

  // Gather all valid orders across these unit types, tracking which types can use each
  const orderMap = new Map(); // orderId → { order, types: [{ type, capability }] }
  for (const unitType of unitTypes) {
    const validOrders = getValidOrders(unitType);
    for (const { orderId, capability } of validOrders) {
      if (orderId === HOLD_ID) continue; // HOLD listed separately
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, { order: ORDER_TYPES[orderId], types: [] });
      }
      orderMap.get(orderId).types.push({ type: unitType, capability });
    }
  }

  // Split into movement and action orders
  const movementOrders = [];
  const actionOrders = [];
  for (const [orderId, info] of orderMap) {
    if (info.order.slot === ORDER_SLOT.MOVEMENT) {
      movementOrders.push({ orderId, ...info });
    } else if (info.order.slot === ORDER_SLOT.ACTION) {
      actionOrders.push({ orderId, ...info });
    }
  }

  // Movement orders
  lines.push("MOVEMENT ORDERS (one per unit per turn):");
  for (const { orderId, order, types } of movementOrders) {
    const typeList = types.map(t => t.type).join(", ");
    lines.push(`  ${orderId}: ${order.description} [${typeList}]`);
  }
  lines.push("");

  // Action orders
  lines.push("ACTION ORDERS (one per unit per turn):");
  for (const { orderId, order, types } of actionOrders) {
    const typeList = types.map(t => t.type).join(", ");
    let desc = `  ${orderId}: ${order.description} [${typeList}]`;
    // Add subtypes if they exist
    if (order.subtypes) {
      desc += ` — subtypes: ${order.subtypes.join(", ")}`;
    }
    lines.push(desc);
  }
  lines.push("");

  // HOLD as a deliberate tactical choice
  lines.push("HOLD (default — no movement or action order):");
  lines.push("  A unit with no orders holds position and maintains current posture.");
  lines.push("  Use HOLD deliberately when a unit should conserve supply, avoid detection,");
  lines.push("  or maintain a blocking position. HOLD is a valid tactical choice, not inaction.");
  lines.push("");

  // Compatibility summary — which movement+action pairs work together
  lines.push("MOVEMENT + ACTION COMPATIBILITY:");
  lines.push("  Each unit can have one movement AND one action order per turn.");
  lines.push("  Not all combinations are valid. Key rules:");
  const compatNotes = [];
  for (const [actionId, compat] of Object.entries(COMPATIBILITY)) {
    if (!orderMap.has(actionId)) continue; // skip orders the actor can't use
    const pairs = [];
    if (compat.MOVE) pairs.push("MOVE");
    if (compat.WITHDRAW) pairs.push("WITHDRAW");
    if (compat.DISEMBARK) pairs.push("DISEMBARK");
    if (compat.NONE) pairs.push("no movement");
    if (pairs.length > 0 && pairs.length < 4) {
      // Only show if there are restrictions (not all compatible)
      compatNotes.push(`  ${actionId}: pairs with ${pairs.join(", ")}`);
    }
  }
  // Show the restricted ones — where not everything is compatible
  const restrictedActions = [];
  for (const [actionId, compat] of Object.entries(COMPATIBILITY)) {
    if (!orderMap.has(actionId)) continue;
    const blocked = [];
    if (!compat.MOVE) blocked.push("MOVE");
    if (!compat.WITHDRAW) blocked.push("WITHDRAW");
    if (blocked.length > 0) {
      restrictedActions.push(`  ${actionId} cannot pair with: ${blocked.join(", ")}`);
    }
  }
  if (restrictedActions.length > 0) {
    for (const note of restrictedActions) {
      lines.push(note);
    }
  } else {
    lines.push("  All available action orders are compatible with all movement orders.");
  }

  return lines.join("\n");
}


// ── System Message Builder ──────────────────────────────────
// Static content that doesn't change between turns. Benefits from
// Anthropic prompt caching (cache_control: ephemeral).

/**
 * Build the system message for AI order generation.
 * Contains role, personality, order reference, and response format.
 * @param {Array} actorUnits - units for this actor (needed for order filtering)
 * @param {Object} terrainData - terrain grid (for coordinate bounds)
 * @param {Object} aiConfig - { personality } from actor config
 * @returns {string} system message content
 */
export function buildSystemMessage(actorUnits, terrainData, aiConfig) {
  const lines = [];

  // Role framing
  lines.push("You are an AI military commander in a turn-based wargame simulation.");
  lines.push("You must issue orders for each of your units based on the briefing provided.");
  lines.push("");

  // Commander personality
  const personality = aiConfig?.personality?.trim();
  if (personality) {
    lines.push("═══ COMMANDER PROFILE ═══");
    const sanitized = personality
      .replace(/`/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[\s\S]*?\}/g, "")
      .slice(0, 2000);
    lines.push(sanitized);
    lines.push("");
    lines.push("Interpret this profile to calibrate your command decisions:");
    lines.push("- Risk tolerance: How aggressively do you pursue objectives vs. preserving forces?");
    lines.push("- Offensive/defensive bias: Do you favor attack or consolidation?");
    lines.push("- Retreat threshold: When do you withdraw vs. fight to the last?");
    lines.push("- Supply discipline: How cautiously do you manage logistics?");
    lines.push("- Contact reaction: How do you respond to unexpected enemy contact?");
    lines.push("");
  } else {
    lines.push("You are a competent professional military commander. Balance risk and reward, prioritize mission objectives while preserving combat power.");
    lines.push("");
  }

  // Tactical doctrine — tells the AI HOW to think tactically
  lines.push("═══ TACTICAL DOCTRINE ═══");
  lines.push("Apply these principles when issuing orders. Your commander personality determines HOW aggressively or cautiously you apply them — the principles themselves are universal.");
  lines.push("");
  lines.push("MANEUVER: Approach objectives from multiple directions. Straight-line advances into prepared positions are costly. Use terrain folds, tree lines, and dead ground to advance under cover. If attacking, pin the enemy frontally and strike the flank.");
  lines.push("COMBINED ARMS: Coordinate infantry and armor attacks on the same hex — they are far more effective together than alone. Use artillery to suppress defenders before infantry assaults. Use recon to reveal enemy positions before committing main forces.");
  lines.push("ECONOMY OF FORCE: Not every unit needs to attack. Use minimum force to hold secondary sectors so you can concentrate overwhelming force at the decisive point (Schwerpunkt). A 3:1 local advantage at one point beats 1:1 everywhere.");
  lines.push("TERRAIN: Attack from covered/concealed positions. Defend on high ground and behind obstacles. Use forests and urban areas as defensive strongpoints. Avoid exposing units in open ground under enemy observation.");
  lines.push("RESERVE: Keep 15-25% of combat power uncommitted to exploit breakthroughs or respond to unexpected threats. Do not commit everything on turn 1.");
  lines.push("TEMPO: Once attacking, maintain pressure. Do not stop moving units forward after initial contact unless you need to consolidate. Momentum matters — a stalled advance lets the enemy regroup.");
  lines.push("");

  // Behavioral targets — converts personality into concrete planning constraints
  lines.push("═══ BEHAVIORAL TARGETS ═══");
  lines.push("Your commander profile maps to concrete planning constraints:");
  lines.push("");
  if (personality) {
    lines.push("Based on your commander profile:");
    lines.push("- HOLD LIMIT: An aggressive commander should have no more than 30% of maneuver units on HOLD. A cautious commander can have up to 50%, but NEVER more than 60%. If you are holding more units than this, you are being too passive — issue movement or action orders.");
    lines.push("- MOVEMENT EXPECTATION: Move at least 40% of your maneuver units each turn during offensive operations, 25% during defensive operations. Units sitting idle without orders are wasted combat power.");
    lines.push("- ATTACK TEMPO: An aggressive commander commits to attacks early and accepts risk. A cautious commander sets conditions first (recon, suppression, flanking positions) then attacks with overwhelming local force.");
    lines.push("- Your personality determines your STYLE, not your passivity level. Even a cautious commander actively maneuvers — they just do it more methodically.");
  } else {
    lines.push("- HOLD LIMIT: No more than 40% of maneuver units on HOLD at any time.");
    lines.push("- MOVEMENT EXPECTATION: Move at least 30% of maneuver units each turn.");
    lines.push("- You are a balanced, professional commander. Avoid both recklessness and passivity.");
  }
  lines.push("");

  // Air assault guidance — only shown when actor has transport units
  const hasTransports = actorUnits.some(u => u.type === "transport" || u.specialCapabilities?.includes("air_transport"));
  if (hasTransports) {
    lines.push("═══ AIR ASSAULT OPERATIONS ═══");
    lines.push("To deploy air assault forces: give the transport helicopter MOVE to the LZ hex. Give embarked infantry DISEMBARK + an action order (ATTACK for air assault, DEFEND to secure the LZ).");
    lines.push("Transport helicopters with embarked troops that sit idle are WASTED combat power. If you have loaded transports, USE them — fly to the objective.");
    lines.push("Do NOT leave transport helicopters with cargo sitting at their start position turn after turn.");
    lines.push("");
  }

  // Order reference (filtered by unit types)
  lines.push("═══ AVAILABLE ORDERS ═══");
  lines.push(buildOrderReference(actorUnits));

  // Coordinate format
  lines.push("═══ COORDINATE FORMAT ═══");
  lines.push('Target format: "col,row" using NUMBERS (e.g., "3,4" or "7,2").');
  lines.push(`Map dimensions: ${terrainData?.cols || "?"} columns (0-${(terrainData?.cols || 1) - 1}) x ${terrainData?.rows || "?"} rows (0-${(terrainData?.rows || 1) - 1})`);
  lines.push("The briefing shows positions as letter+number (e.g., A1, H4). Convert: A=0, B=1, C=2, ... Row numbers in briefing are 1-indexed, subtract 1 for the target.");
  lines.push('Example: briefing shows "H4" → column H=7, row 4-1=3 → target "7,3"');
  lines.push("");

  // Response format
  lines.push("═══ RESPONSE FORMAT ═══");
  lines.push("Respond with ONLY valid JSON in this exact format (no markdown, no explanation, just the JSON):");
  lines.push("{");
  lines.push('  "unitOrders": {');
  lines.push('    "<unit_id>": {');
  lines.push('      "movementOrder": { "id": "MOVE", "target": "col,row" } or null,');
  lines.push('      "actionOrder": { "id": "DEFEND", "target": "col,row", "subtype": null } or null,');
  lines.push('      "intent": "brief explanation of what this unit should do"');
  lines.push("    }");
  lines.push("  },");
  lines.push('  "actorIntent": "overall strategic intent for this turn",');
  lines.push('  "commanderThoughts": "A paragraph (3-6 sentences) of your internal monologue as commander. What are you most concerned about? What opportunities do you see? What is your read on the enemy\'s intentions? Write in first person, in character."');
  lines.push("}");
  lines.push("");
  lines.push("Every unit MUST have an entry. Units holding position should have null for both movementOrder and actionOrder.");
  lines.push("Apply the tactical doctrine and behavioral targets above. Think about WHERE to concentrate force, HOW to approach from multiple angles, and WHICH units should be moving vs. holding. Do not default to HOLD for units that should be maneuvering.");

  return lines.join("\n");
}


// ── User Message Builder ────────────────────────────────────
// Turn-specific content: briefing, unit status, campaign memory.

/**
 * Build the user message for AI order generation.
 * Contains briefing, unit list, idle warnings, and campaign memory.
 * @param {string} briefing - FOW-filtered briefing text
 * @param {Array} actorUnits - actor's operational units
 * @param {Object} options - { idleUnits, previousTurnContext }
 * @returns {string} user message content
 */
export function buildUserMessage(briefing, actorUnits, options = {}) {
  const { idleUnits, previousTurnContext, vpContext, tacticalAnalysis } = options;
  const lines = [];

  // Campaign memory (multi-turn context) — cap lengths to prevent bloat
  if (previousTurnContext) {
    lines.push("═══ CAMPAIGN MEMORY ═══");

    // Older turns: compressed summaries (oldest first, ~200-300 chars each)
    if (previousTurnContext.history && previousTurnContext.history.length > 0) {
      lines.push("Prior turns (summary):");
      for (const h of previousTurnContext.history) {
        const parts = [`Turn ${h.turn}:`];
        if (h.intent) parts.push(`Intent: "${String(h.intent).slice(0, 200)}"`);
        if (h.narrative) parts.push(`Result: ${String(h.narrative).slice(0, 300)}`);
        lines.push(`  ${parts.join(" | ")}`);
      }
      lines.push("");
    }

    // Most recent turn: full detail
    lines.push("Last turn:");
    if (previousTurnContext.narrative) {
      lines.push(`Result: ${String(previousTurnContext.narrative).slice(0, 2000)}`);
    }
    if (previousTurnContext.intent) {
      lines.push(`Your stated intent was: "${String(previousTurnContext.intent).slice(0, 1000)}"`);
    }
    if (previousTurnContext.commanderThoughts) {
      lines.push(`Your previous thoughts: "${String(previousTurnContext.commanderThoughts).slice(0, 1000)}"`);
    }
    lines.push("Consider whether your multi-turn strategy is working and adjust as needed.");
    lines.push("");
  }

  // VP status + operational clock (when scenario defines victory conditions)
  if (vpContext) {
    lines.push("═══ OPERATIONAL CLOCK ═══");
    lines.push(`Turn ${vpContext.currentTurn} of ${vpContext.maxTurns} (${vpContext.turnsRemaining} remaining, ${vpContext.percentRemaining}% of game left)`);
    lines.push(`VP: You ${vpContext.myVP} / Opponent ${vpContext.opponentVP} (${vpContext.vpDelta >= 0 ? "+" : ""}${vpContext.vpDelta})`);
    // Urgent CVP warnings — only when CVP are actually being lost
    if (vpContext.myCvpTotal > 0 && vpContext.myCvpLost > 0) {
      if (vpContext.myCvpLost === vpContext.myCvpTotal) {
        lines.push(`⚠ CRITICAL FAIL: ALL ${vpContext.myCvpTotal} critical hexes LOST — instant defeat imminent. Retake at least one immediately.`);
      } else {
        lines.push(`⚠ Critical hex lost: ${vpContext.myCvpLostNames.join(", ")} (${vpContext.myCvpLost}/${vpContext.myCvpTotal}). Losing ALL triggers instant defeat.`);
      }
    }
    if (vpContext.vpRate !== null) {
      lines.push(`VP Rate: ${vpContext.vpRate}/turn (need ${vpContext.vpRateNeeded}/turn to win)`);
    }
    lines.push(`ASSESSMENT: ${vpContext.assessment}`);

    // VP hex status — the primary victory mechanism
    if (vpContext.hexStatus?.length > 0) {
      lines.push("");
      lines.push("VP Objectives (highest VP at turn limit wins — this is how you WIN):");
      for (const h of vpContext.hexStatus) {
        const controlTag = h.controller === vpContext.actorId ? "YOURS"
          : h.controller === "contested" ? "CONTESTED"
          : h.controller ? "ENEMY-HELD"
          : "UNCLAIMED";
        lines.push(`  ${h.name} (${h.position}, ${h.vp}VP): ${controlTag}`);
      }
    }

    // Your CVP hex status — listed with positions so the AI knows where they are
    if (vpContext.cvpHexStatus?.length > 0) {
      lines.push("");
      lines.push("Your Critical Hexes (losing ALL triggers instant defeat — defend at all costs, but they can't secure victory):");
      for (const c of vpContext.cvpHexStatus) {
        const tag = c.held ? "HELD ✓" : c.contested ? "CONTESTED ⚠" : "ENEMY-HELD ✗";
        lines.push(`  ${c.name} (${c.position}): ${tag}`);
      }
    }

    // Opponent CVP hex status — so the AI knows where to apply pressure
    if (vpContext.opponentCvpHexStatus?.length > 0) {
      lines.push("");
      lines.push(`Enemy Critical Hexes (if you capture ALL ${vpContext.opponentCvpTotal}, the enemy loses instantly):`);
      for (const c of vpContext.opponentCvpHexStatus) {
        const tag = c.weControl ? "YOU HOLD ✓" : c.contested ? "CONTESTED ⚠" : "ENEMY-HELD";
        lines.push(`  ${c.name} (${c.position}): ${tag}`);
      }
      if (vpContext.opponentCvpLost > 0) {
        lines.push(`You hold ${vpContext.opponentCvpLost}/${vpContext.opponentCvpTotal} — capturing the rest forces instant enemy defeat.`);
      }
    }

    // Standing guidance — only when CVP exist
    if (vpContext.myCvpTotal > 0 || vpContext.opponentCvpTotal > 0) {
      lines.push("Focus on capturing VP to WIN. Only divert forces to critical hexes if you are at risk of losing ALL of them.");
    }
    lines.push("");
  }

  // Tactical situation (computed by tacticalAnalysis.js)
  if (tacticalAnalysis?.textSection) {
    lines.push(tacticalAnalysis.textSection);
  }

  // Situation briefing
  lines.push("═══ SITUATION BRIEFING ═══");
  lines.push(briefing);
  lines.push("");

  // Unit list with IDs (the briefing uses names, but orders need IDs)
  // Includes vulnerability tags from tactical analysis
  const vulnTagger = tacticalAnalysis?.formatVulnerabilityTag;
  const vulnData = tacticalAnalysis?.vulnerabilities;
  lines.push("═══ YOUR UNITS (use these exact IDs in orders) ═══");
  for (const u of actorUnits) {
    const parts = [`${u.name} (ID: ${u.id}, Type: ${u.type}, Position: ${u.position}, Strength: ${u.strength}%`];
    if (u.morale != null) parts.push(`, Morale: ${u.morale}%`);
    if (u.supply != null) parts.push(`, Supply: ${u.supply}%`);
    if (u.embarkedIn) parts.push(`, Embarked in: ${u.embarkedIn}`);
    parts.push(")");
    // Append vulnerability tag if available
    const tag = (vulnTagger && vulnData?.[u.id]) ? vulnTagger(vulnData[u.id]) : "";
    lines.push(`- ${parts.join("")}${tag}`);
  }
  lines.push("");

  // Idle unit warnings
  if (idleUnits && idleUnits.length > 0) {
    lines.push("═══ WARNING: IDLE UNITS ═══");
    lines.push("The following units have NOT received orders for multiple turns.");
    lines.push("You MUST issue orders for these units or explicitly explain why they should hold position:");
    for (const u of idleUnits) {
      lines.push(`- ${u.name} (ID: ${u.id}) — idle for ${u.idleTurns} turns at position ${u.position}`);
    }
    lines.push("");
  }

  lines.push("Issue your orders now.");

  return lines.join("\n");
}


// ── VP Context Builder ─────────────────────────────────────
// Builds the operational clock + VP status context for the AI prompt.
// Shared between client-side (aiOrderClient.js) and server-side (aiPlayer.js).

/**
 * Build VP context for the AI prompt — operational clock + hex status.
 * Returns null if the scenario has no VP-based victory conditions.
 */
export function buildVPContext(gameState, actorId) {
  const vc = gameState.scenario?.victoryConditions;
  if (!vc?.hexVP?.length) return null;

  const currentTurn = gameState.game.turn;
  const maxTurns = gameState.game.config?.maxTurns || 20;
  const turnsRemaining = Math.max(0, maxTurns - currentTurn);
  const percentRemaining = Math.round((turnsRemaining / maxTurns) * 100);

  const vpStatus = gameState.game?.vpStatus?.vp || {};
  const vpControl = gameState.game?.vpControl || {};
  const vpHistory = gameState.game?.vpHistory || [];

  const myVP = vpStatus[actorId] || 0;
  const actors = gameState.scenario.actors || [];
  const opponent = actors.find(a => a.id !== actorId);
  const opponentVP = opponent ? (vpStatus[opponent.id] || 0) : 0;
  const vpDelta = myVP - opponentVP;

  // CVP status — per-actor must-hold hexes from scenario actors
  const myActor = actors.find(a => a.id === actorId);
  const myCvpHexes = myActor?.cvpHexes || [];
  const myCvpTotal = myCvpHexes.length;
  let myCvpLost = 0;
  const myCvpLostNames = [];
  for (const hex of myCvpHexes) {
    const ctrl = vpControl[hex];
    if (ctrl && ctrl !== actorId && ctrl !== "contested") {
      myCvpLost++;
      const vpEntry = vc.hexVP.find(h => h.hex === hex);
      myCvpLostNames.push(vpEntry?.name || hex);
    }
  }

  // Opponent CVP status — so AI knows which enemy hexes to target
  const opponentCvpHexes = opponent?.cvpHexes || [];
  let opponentCvpLost = 0;
  for (const hex of opponentCvpHexes) {
    const ctrl = vpControl[hex];
    // Opponent lost it if we or someone else controls it
    if (ctrl && ctrl !== opponent.id && ctrl !== "contested") opponentCvpLost++;
  }

  // VP rate: average gain per turn over last 3 turns
  let vpRate = null;
  let vpRateNeeded = "N/A";
  const vpGoal = vc.vpGoal || null;
  if (vpHistory.length >= 2) {
    const recent = vpHistory.slice(-3);
    const oldestVP = recent[0].vp[actorId] || 0;
    const newestVP = recent[recent.length - 1].vp[actorId] || 0;
    const turnSpan = recent[recent.length - 1].turn - recent[0].turn;
    vpRate = turnSpan > 0 ? Math.round(((newestVP - oldestVP) / turnSpan) * 10) / 10 : 0;

    if (vpGoal && turnsRemaining > 0) {
      const deficit = vpGoal - myVP;
      vpRateNeeded = deficit > 0 ? (Math.round((deficit / turnsRemaining) * 10) / 10) : 0;
    }
  }

  // Assessment
  let assessment;
  if (vpGoal) {
    if (myVP >= vpGoal) {
      assessment = "ON TRACK — you have met the VP goal. Maintain control.";
    } else if (vpRate !== null && vpRate >= vpRateNeeded) {
      assessment = "ON TRACK — current VP rate is sufficient to win.";
    } else if (turnsRemaining <= 2) {
      assessment = `CRITICAL — ${turnsRemaining} turns left, deficit of ${vpGoal - myVP}VP. Immediate action required.`;
    } else {
      const keyVP = vc.hexVP.filter(h => vpControl[h.hex] !== actorId).sort((a, b) => b.vp - a.vp);
      const targetHint = keyVP.length > 0 ? ` Must capture ${keyVP[0].name} (${keyVP[0].vp}VP).` : "";
      assessment = `At current pace, you LOSE.${targetHint} Increase tempo.`;
    }
  } else {
    if (vpDelta > 10) assessment = "WINNING — maintain pressure and protect VP hexes.";
    else if (vpDelta > 0) assessment = "LEADING — but margin is slim. Press the advantage.";
    else if (vpDelta === 0) assessment = "TIED — need to capture contested VP objectives.";
    else if (vpDelta > -10) assessment = "TRAILING — must capture VP hexes to close the gap.";
    else assessment = "LOSING — significant VP deficit. Must take decisive offensive action.";
  }

  // Helper: "col,row" → Excel-style label like "D5"
  function hexToLabel(hex) {
    const p = hex.split(",");
    const c = parseInt(p[0]), r = parseInt(p[1]);
    let l = "";
    let n = c;
    do { l = String.fromCharCode(65 + (n % 26)) + l; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return l + (r + 1);
  }

  // Hex status for the AI
  const hexStatus = vc.hexVP.map(h => {
    const position = hexToLabel(h.hex);
    return { name: h.name, hex: h.hex, position, vp: h.vp, controller: vpControl[h.hex] || null };
  });

  // CVP hex status for the AI — per-hex with position label and control info
  const cvpHexStatus = myCvpHexes.map(hex => {
    const position = hexToLabel(hex);
    const ctrl = vpControl[hex];
    // Try to find a name from VP hex entries (if this hex is also a VP objective)
    const vpEntry = vc.hexVP.find(h => h.hex === hex);
    const name = vpEntry?.name || position;
    const held = !ctrl || ctrl === actorId;
    const contested = ctrl === "contested";
    return { hex, position, name, held, contested };
  });

  // Opponent CVP hex status — so the AI can target them
  const opponentCvpHexStatus = opponentCvpHexes.map(hex => {
    const position = hexToLabel(hex);
    const ctrl = vpControl[hex];
    const vpEntry = vc.hexVP.find(h => h.hex === hex);
    const name = vpEntry?.name || position;
    const weControl = ctrl === actorId;
    const contested = ctrl === "contested";
    return { hex, position, name, weControl, contested };
  });

  return {
    currentTurn, maxTurns, turnsRemaining, percentRemaining,
    myVP, opponentVP, vpDelta,
    myCvpTotal, myCvpLost, myCvpLostNames, cvpHexStatus,
    opponentCvpTotal: opponentCvpHexes.length, opponentCvpLost, opponentCvpHexStatus,
    vpRate, vpRateNeeded,
    assessment, hexStatus, actorId,
  };
}


// ── Order Validation ────────────────────────────────────────
// Shared validation with unit-type checking via ORDER_VALIDITY.

/**
 * Validate and normalize AI-generated orders.
 * Checks order IDs are valid, targets are in bounds, and orders are
 * appropriate for each unit's type (using ORDER_VALIDITY from orderTypes.js).
 *
 * Invalid orders are replaced with HOLD (null movement/action) + warning,
 * rather than failing the entire response.
 *
 * @param {Object} parsed - parsed JSON response from LLM
 * @param {Array} actorUnits - actor's unit objects
 * @param {Object} terrainData - terrain grid (for bounds checking)
 * @returns {{ unitOrders, actorIntent, commanderThoughts, warnings }}
 */
export function validateAndNormalizeOrders(parsed, actorUnits, terrainData) {
  const unitOrders = {};
  const warnings = [];
  const rawOrders = parsed?.unitOrders || {};

  for (const unit of actorUnits) {
    const orders = rawOrders[unit.id] || {};

    // Validate movement order
    let movementOrder = null;
    if (orders.movementOrder && ALL_MOVEMENT_IDS.has(orders.movementOrder.id)) {
      // Check if this movement order is valid for this unit type
      if (isOrderValid(orders.movementOrder.id, unit.type)) {
        const target = normalizeTarget(orders.movementOrder.target, terrainData);
        // DISEMBARK doesn't need a target
        const needsTarget = orders.movementOrder.id !== "DISEMBARK";
        if (target || !needsTarget) {
          movementOrder = {
            id: orders.movementOrder.id,
            target: target || null,
            ...(Array.isArray(orders.movementOrder.waypoints)
              ? { waypoints: orders.movementOrder.waypoints.map(w => normalizeTarget(w, terrainData)).filter(Boolean) }
              : {}),
          };
        }
      } else {
        warnings.push(`${unit.name}: ${orders.movementOrder.id} is not valid for ${unit.type}, defaulting to HOLD`);
      }
    }

    // Validate action order
    let actionOrder = null;
    if (orders.actionOrder && ALL_ACTION_IDS.has(orders.actionOrder.id)) {
      // Check if this action order is valid for this unit type
      if (isOrderValid(orders.actionOrder.id, unit.type)) {
        const needsTarget = !NO_TARGET_ACTIONS.has(orders.actionOrder.id);
        const target = normalizeTarget(orders.actionOrder.target, terrainData);
        if (target || !needsTarget) {
          actionOrder = {
            id: orders.actionOrder.id,
            target: target || null,
            subtype: orders.actionOrder.subtype || null,
            ...(orders.actionOrder.altitude ? { altitude: orders.actionOrder.altitude } : {}),
          };
        }
      } else {
        warnings.push(`${unit.name}: ${orders.actionOrder.id} is not valid for ${unit.type}, defaulting to DEFEND`);
      }
    }

    // Check movement+action compatibility (warn but allow — adjudicator will handle)
    if (movementOrder && actionOrder) {
      if (!isCompatible(movementOrder.id, actionOrder.id)) {
        warnings.push(`${unit.name}: ${movementOrder.id} + ${actionOrder.id} is an incompatible pair — adjudicator may override`);
      }
    }

    unitOrders[unit.id] = {
      movementOrder,
      actionOrder,
      intent: typeof orders.intent === "string" ? orders.intent.slice(0, 500) : "",
    };
  }

  // Extract and sanitize actor intent
  const actorIntent = typeof parsed?.actorIntent === "string"
    ? parsed.actorIntent.slice(0, 1000)
    : "";

  // Extract and sanitize commander thoughts (inner monologue for spectator display)
  let commanderThoughts = "";
  if (typeof parsed?.commanderThoughts === "string" && parsed.commanderThoughts.trim()) {
    commanderThoughts = parsed.commanderThoughts
      .replace(/`/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[\s\S]*?\}/g, "")
      .slice(0, 2000)
      .trim();
  }
  if (!commanderThoughts) commanderThoughts = "(No thoughts provided)";

  // Log warnings to console for debugging
  if (warnings.length > 0) {
    console.warn("[AI] Order validation warnings:", warnings);
  }

  return { unitOrders, actorIntent, commanderThoughts, warnings };
}


// ── Target Normalization ────────────────────────────────────
// Accepts both "col,row" (e.g. "3,4") and letter-based (e.g. "H4", "AA12").

/**
 * Normalize a target string to "col,row" format and clamp to map bounds.
 */
export function normalizeTarget(target, terrainData) {
  if (!target || typeof target !== "string") return null;
  const t = target.trim();

  // Try "col,row" numeric format first
  const numMatch = t.match(/^(\d+)\s*,\s*(\d+)$/);
  if (numMatch) {
    let col = parseInt(numMatch[1], 10);
    let row = parseInt(numMatch[2], 10);
    if (terrainData) {
      col = Math.max(0, Math.min(col, (terrainData.cols || 12) - 1));
      row = Math.max(0, Math.min(row, (terrainData.rows || 15) - 1));
    }
    return `${col},${row}`;
  }

  // Try letter-based format: "H4", "AA12", etc.
  const letterMatch = t.match(/^([A-Za-z]+)\s*(\d+)$/);
  if (letterMatch) {
    const letters = letterMatch[1].toUpperCase();
    let col = 0;
    for (let i = 0; i < letters.length; i++) {
      col = col * 26 + (letters.charCodeAt(i) - 64);
    }
    col -= 1; // 1-indexed to 0-indexed
    let row = parseInt(letterMatch[2], 10) - 1;

    if (terrainData) {
      col = Math.max(0, Math.min(col, (terrainData.cols || 12) - 1));
      row = Math.max(0, Math.min(row, (terrainData.rows || 15) - 1));
    }
    return `${col},${row}`;
  }

  return null;
}


// ── Fallback Orders ─────────────────────────────────────────

/**
 * Build HOLD-all fallback orders when AI generation fails.
 * @param {Array} actorUnits - actor's unit objects
 * @param {string} errorMessage - why fallback was triggered
 * @param {*} usage - LLM usage stats (if any)
 * @param {string} rawPrompt - the prompt that was sent
 * @param {string} rawResponse - what came back (if anything)
 * @param {number} retryCount - how many retries were attempted
 * @param {string} [detailedError] - detailed error for logging (server only)
 * @returns {Object} complete result object with HOLD orders for all units
 */
export function buildFallbackOrders(actorUnits, errorMessage, usage, rawPrompt, rawResponse, retryCount, detailedError) {
  const unitOrders = {};
  for (const u of actorUnits) {
    unitOrders[u.id] = { movementOrder: null, actionOrder: null, intent: "" };
  }
  return {
    unitOrders,
    actorIntent: errorMessage,
    commanderThoughts: "AI order generation failed. No tactical assessment available.",
    usage,
    rawPrompt,
    rawResponse,
    retryCount,
    error: detailedError || errorMessage,
  };
}
