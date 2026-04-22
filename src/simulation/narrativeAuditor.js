// ═══════════════════════════════════════════════════════════════
// NARRATIVE AUDITOR — Post-adjudication fog-of-war enforcement
//
// After the main LLM produces actor_perspectives, this module sends
// each actor's narrative to a cheap/fast model to check for leaks
// about UNDETECTED enemy units. If leaks are found, the auditor
// returns corrected text that gets slotted back in before filtering.
//
// Design: one LLM call per actor, run in parallel. Each call is
// isolated — the auditor for Actor A never sees Actor B's narrative.
// The response is either "CLEAN" or a JSON object with corrected fields.
// ═══════════════════════════════════════════════════════════════

import { positionToLabel } from "./prompts.js";
import { fetchWithTimeout } from "./orchestrator.js";
import { getTurnBudgetKey } from "./llmBudget.js";

// Rolling log of the last 6 audit exchanges, saved to server for debugging.
// Fire-and-forget — never blocks adjudication.
function saveAuditLog(entry) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `audit_${entry.actorId}_t${entry.turn || 0}_${ts}.json`;
  fetch("/api/auditlog/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data: entry }),
  }).catch(() => {});
}


/**
 * Pick a cheap/fast model for auditing. The audit task is simple
 * reading comprehension so we don't need the main adjudication model.
 */
function getAuditModel(provider) {
  if (provider === "anthropic") return "claude-haiku-4-5-20251001";
  if (provider === "openai") return "gpt-4o-mini";
  return null; // caller falls back to main model
}


// Escape special regex characters in a string
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic keyword scrub fallback — used when the LLM audit fails.
 * Replaces hard keyword matches and forbidden hex labels with "[REDACTED]".
 * This is cruder than the LLM rewrite but guarantees no hard leaks pass through.
 *
 * Returns corrections object (same shape as LLM output), or null if no flags.
 */
function deterministicScrub(fields, fieldFlags, hardKeywords, forbiddenUnits) {
  const corrections = {};
  let hasCorrections = false;

  for (const { key, text } of fields) {
    const flags = fieldFlags[key] || [];
    // Only scrub if there are hard flags or hex flags (soft flags are likely innocent)
    const dangerousFlags = flags.filter(f => f.tier === "hard" || f.tier === "hex");
    if (dangerousFlags.length === 0 || !text) {
      corrections[key] = null;
      continue;
    }

    let scrubbed = text;
    for (const f of dangerousFlags) {
      const regex = new RegExp(`\\b${escapeRegex(f.word)}(?:'?s)?\\b`, "gi");
      scrubbed = scrubbed.replace(regex, "[REDACTED]");
    }

    if (scrubbed !== text) {
      corrections[key] = scrubbed;
      hasCorrections = true;
    } else {
      corrections[key] = null;
    }
  }

  return hasCorrections ? corrections : null;
}

/**
 * Pre-scan a text field for flagged keywords and forbidden hex positions.
 * Returns array of { word, tier: 'hard'|'soft'|'hex', count, unit? }
 *
 * This is the deterministic detection layer — 100% reliable for keyword
 * matches. The LLM then only needs to judge context and rewrite, not search.
 */
function preScanField(text, hardKeywords, softKeywords, forbiddenUnits) {
  if (!text) return [];
  const flags = [];

  for (const kw of hardKeywords) {
    const regex = new RegExp(`\\b${escapeRegex(kw)}(?:'?s)?\\b`, "gi");
    const matches = text.match(regex);
    if (matches) flags.push({ word: kw, tier: "hard", count: matches.length });
  }

  for (const kw of softKeywords) {
    const regex = new RegExp(`\\b${escapeRegex(kw)}(?:'?s)?\\b`, "gi");
    const matches = text.match(regex);
    if (matches) flags.push({ word: kw, tier: "soft", count: matches.length });
  }

  for (const u of forbiddenUnits) {
    const hexLabel = positionToLabel(u.position);
    if (hexLabel == null) continue;
    const regex = new RegExp(`\\b${escapeRegex(hexLabel)}\\b`, "gi");
    if (regex.test(text)) {
      flags.push({ word: hexLabel, tier: "hex", count: 1, unit: u.name });
    }
  }

  return flags;
}


/**
 * Audit one actor's narrative fields for fog-of-war leaks.
 *
 * Checks narrative, known_enemy_actions, and intel_assessment for
 * references to units the actor cannot see. Returns corrected text
 * fields or null if clean.
 *
 * Fails closed — if the LLM audit call errors or parsing fails, falls back
 * to deterministic keyword scrubbing using pre-scan results. This ensures
 * hard keyword leaks and forbidden hex positions are always removed.
 */
export async function auditActorNarrative(masterAdjudication, actorId, visibilityState, gameState, llmConfig, abortSignal = null) {
  const perspectives = masterAdjudication?.adjudication?.actor_perspectives;
  if (!perspectives?.[actorId]) return null;

  const perspective = perspectives[actorId];
  const narrative = perspective.narrative || "";
  const knownEnemyActions = perspective.known_enemy_actions || "";
  const intelAssessment = perspective.intel_assessment || "";
  // probability_assessment is in outcome_determination (shared across actors),
  // but it's god-view text that often names specific units from both sides
  const probabilityAssessment = masterAdjudication.adjudication.outcome_determination?.probability_assessment || "";

  // Nothing to audit if all fields are empty
  if (!narrative && !knownEnemyActions && !intelAssessment && !probabilityAssessment) return null;

  const actorVis = visibilityState?.actorVisibility?.[actorId];

  // Build set of enemy unit IDs this actor CAN see (IDENTIFIED + CONTACT)
  const visibleEnemyIds = new Set([
    ...(actorVis?.detectedUnits || []),
    ...(actorVis?.contactUnits || []),
  ]);

  // Own units, visible enemies, forbidden enemies
  const ownUnits = gameState.units.filter(u => u.actor === actorId);
  const allEnemyUnits = gameState.units.filter(u => u.actor !== actorId);
  const visibleEnemies = allEnemyUnits.filter(u => visibleEnemyIds.has(u.id));
  const forbiddenUnits = allEnemyUnits.filter(u => !visibleEnemyIds.has(u.id));

  // If no forbidden units exist, there's nothing to leak
  if (forbiddenUnits.length === 0) return null;

  // ── Keyword extraction ──
  // Extract distinctive words from unit names, ignoring generic military terms
  const GENERIC_WORDS = new Set([
    "the", "a", "an", "of", "at", "in", "on", "to", "and", "or", "co", "hq",
    "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
    "team", "group", "section", "platoon", "company", "battalion", "brigade",
    "regiment", "division", "corps", "force", "unit", "element", "detachment",
  ]);
  const extractKeywords = (name) =>
    name.replace(/["']/g, "").split(/\s+/)
      .map(w => w.toLowerCase())
      .filter(w => w.length > 2 && !GENERIC_WORDS.has(w));

  // Words from own units + visible enemies = "known" context
  const knownKeywords = new Set([
    ...ownUnits.flatMap(u => extractKeywords(u.name)),
    ...visibleEnemies.flatMap(u => extractKeywords(u.name)),
  ]);

  // All keywords from forbidden unit names
  const allForbiddenKw = new Set(forbiddenUnits.flatMap(u => extractKeywords(u.name)));

  // Hard = only in forbidden names, never in own/known. Soft = shared.
  const hardKeywords = [...allForbiddenKw].filter(kw => !knownKeywords.has(kw));
  const softKeywords = [...allForbiddenKw].filter(kw => knownKeywords.has(kw));

  // Unit types that exist ONLY among forbidden enemies
  const knownEnemyTypes = new Set(visibleEnemies.map(u => u.type));
  const bannedTypes = [...new Set(forbiddenUnits.map(u => u.type))]
    .filter(t => !knownEnemyTypes.has(t));

  // ── Pre-scan each field for flagged words/hexes ──
  const fieldFlags = {
    narrative: preScanField(narrative, hardKeywords, softKeywords, forbiddenUnits),
    known_enemy_actions: preScanField(knownEnemyActions, hardKeywords, softKeywords, forbiddenUnits),
    intel_assessment: preScanField(intelAssessment, hardKeywords, softKeywords, forbiddenUnits),
    probability_assessment: preScanField(probabilityAssessment, hardKeywords, softKeywords, forbiddenUnits),
  };

  // Field list for deterministic scrub fallback
  const scrubFields = [
    { key: "narrative", text: narrative },
    { key: "known_enemy_actions", text: knownEnemyActions },
    { key: "intel_assessment", text: intelAssessment },
    { key: "probability_assessment", text: probabilityAssessment },
  ];

  // Build known enemy descriptions for the prompt (with detection tier)
  const knownEnemyDescriptions = visibleEnemies.map(u => {
    const idSet = actorVis?.detectedUnits;
    const isId = Array.isArray(idSet) ? idSet.includes(u.id) : idSet?.has?.(u.id);
    if (isId) return `${u.name} (IDENTIFIED)`;
    return `Contact at ${positionToLabel(u.position)} (CONTACT)`;
  });

  const actorName = gameState.scenario.actors.find(a => a.id === actorId)?.name || actorId;
  const prompt = buildAuditPrompt(
    actorName, ownUnits, knownEnemyDescriptions, forbiddenUnits,
    hardKeywords, softKeywords, bannedTypes,
    narrative, knownEnemyActions, intelAssessment, probabilityAssessment,
    fieldFlags
  );

  const auditModel = getAuditModel(llmConfig.provider) || llmConfig.model;
  const budgetKey = getTurnBudgetKey(gameState);

  // Audit calls use fast/small models (haiku-class) — 90s is generous
  const AUDIT_TIMEOUT_MS = 90_000;

  try {
    const resp = await fetchWithTimeout("/api/llm/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: llmConfig.provider,
        model: auditModel,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        budget_key: budgetKey,
      }),
    }, AUDIT_TIMEOUT_MS, abortSignal);

    const data = await resp.json();

    // Build log entry with everything the auditor saw and returned
    const logEntry = {
      actorId,
      actorName,
      turn: gameState.game?.turn,
      timestamp: new Date().toISOString(),
      model: auditModel,
      bannedTypes,
      hardKeywords,
      softKeywords,
      fieldFlags,
      forbiddenUnitNames: forbiddenUnits.map(u => u.name),
      knownEnemyNames: visibleEnemies.map(u => u.name),
      ownUnitNames: ownUnits.map(u => u.name),
      inputFields: {
        narrative: narrative.slice(0, 2000),
        known_enemy_actions: knownEnemyActions.slice(0, 1000),
        intel_assessment: intelAssessment.slice(0, 1000),
        probability_assessment: probabilityAssessment.slice(0, 1000),
      },
      rawResponse: (data.content || "").slice(0, 3000),
      apiOk: data.ok,
      apiError: data.error || null,
      result: null, // filled below
    };

    if (!data.ok) {
      logEntry.result = "API_ERROR_SCRUBBED";
      saveAuditLog(logEntry);
      console.warn(`[NarrativeAuditor] Audit failed for ${actorId}, falling back to deterministic scrub:`, data.error);
      return deterministicScrub(scrubFields, fieldFlags, hardKeywords, forbiddenUnits);
    }

    const content = (data.content || "").trim();

    // Clean result — no leaks found
    if (content === "CLEAN") {
      logEntry.result = "CLEAN";
      saveAuditLog(logEntry);
      return null;
    }

    // Parse corrections JSON
    try {
      let jsonStr = content;
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      const corrections = JSON.parse(jsonStr);

      // At least one field must be non-null to count as a correction
      if (!corrections.narrative && !corrections.known_enemy_actions && !corrections.intel_assessment && !corrections.probability_assessment) {
        logEntry.result = "PARSED_BUT_NO_CHANGES";
        saveAuditLog(logEntry);
        return null;
      }
      logEntry.result = "CORRECTED";
      logEntry.corrections = {
        narrative: corrections.narrative ? corrections.narrative.slice(0, 2000) : null,
        known_enemy_actions: corrections.known_enemy_actions ? corrections.known_enemy_actions.slice(0, 1000) : null,
        intel_assessment: corrections.intel_assessment ? corrections.intel_assessment.slice(0, 1000) : null,
        probability_assessment: corrections.probability_assessment ? corrections.probability_assessment.slice(0, 1000) : null,
      };
      saveAuditLog(logEntry);
      return corrections;
    } catch (e) {
      logEntry.result = "PARSE_ERROR_SCRUBBED";
      logEntry.parseError = e.message;
      saveAuditLog(logEntry);
      console.warn(`[NarrativeAuditor] Failed to parse audit response for ${actorId}, falling back to deterministic scrub:`, e.message);
      return deterministicScrub(scrubFields, fieldFlags, hardKeywords, forbiddenUnits);
    }
  } catch (e) {
    if (e.name === "AbortError") return null;
    console.warn(`[NarrativeAuditor] Network error auditing ${actorId}, falling back to deterministic scrub:`, e.message);
    return deterministicScrub(scrubFields, fieldFlags, hardKeywords, forbiddenUnits);
  }
}


/**
 * Apply audit corrections to the master adjudication in-place.
 * Only overwrites fields where the auditor returned a non-null correction.
 *
 * probability_assessment lives in outcome_determination (shared), not
 * actor_perspectives. When the auditor flags it, we store a per-actor
 * cleaned version in perspective._clean_probability_assessment so the
 * filter can use it instead of the raw god-view text.
 */
export function applyAuditCorrections(masterAdjudication, actorId, corrections) {
  if (!corrections) return;
  const perspective = masterAdjudication?.adjudication?.actor_perspectives?.[actorId];
  if (!perspective) return;

  if (corrections.narrative != null) perspective.narrative = corrections.narrative;
  if (corrections.known_enemy_actions != null) perspective.known_enemy_actions = corrections.known_enemy_actions;
  if (corrections.intel_assessment != null) perspective.intel_assessment = corrections.intel_assessment;
  if (corrections.probability_assessment != null) {
    perspective._clean_probability_assessment = corrections.probability_assessment;
  }
}


/**
 * Audit all actors' narratives in parallel.
 *
 * Mutates masterAdjudication.actor_perspectives in-place where leaks
 * are found. Returns a summary array of which actors had corrections
 * (empty array if all clean).
 */
export async function auditAllNarratives(masterAdjudication, visibilityState, gameState, llmConfig, abortSignal = null) {
  const actors = gameState.scenario.actors;
  const corrections = [];

  // M8: Sequential loop instead of Promise.all — typically only 2-4 actors,
  // and parallel calls hit rate limits on cheap audit models
  for (const actor of actors) {
    if (abortSignal?.aborted) break;
    const corr = await auditActorNarrative(masterAdjudication, actor.id, visibilityState, gameState, llmConfig, abortSignal);
    if (corr) {
      applyAuditCorrections(masterAdjudication, actor.id, corr);
      corrections.push({
        actorId: actor.id,
        fieldsModified: Object.keys(corr).filter(k => corr[k] != null),
      });
    }
  }

  return corrections;
}


// ── Audit Prompt ────────────────────────────────────────────

function buildAuditPrompt(
  actorName, ownUnits, knownEnemyDescriptions, forbiddenUnits,
  hardKeywords, softKeywords, bannedTypes,
  narrative, knownEnemyActions, intelAssessment, probabilityAssessment,
  fieldFlags
) {
  const lines = [];

  lines.push("You are a fog-of-war text editor for a military simulation.");
  lines.push("A pre-scan has flagged suspicious words and hex locations in each field.");
  lines.push("Review each flag and rewrite only where it reveals a forbidden enemy.");
  lines.push("");

  lines.push(`ACTOR: ${actorName}`);
  lines.push("");

  // Actor's own units
  lines.push(`${actorName.toUpperCase()}'S OWN UNITS (references to these are always allowed):`);
  for (const u of ownUnits) lines.push(`  - ${u.name}`);
  lines.push("");

  // Known enemies
  if (knownEnemyDescriptions.length > 0) {
    lines.push("KNOWN ENEMIES (references to these are allowed):");
    for (const desc of knownEnemyDescriptions) lines.push(`  - ${desc}`);
  } else {
    lines.push("KNOWN ENEMIES: None — this actor has no detected enemies.");
  }
  lines.push("");

  // Forbidden enemies with hex positions
  lines.push("FORBIDDEN ENEMIES (the actor does NOT know these exist):");
  for (const u of forbiddenUnits) {
    const hexLabel = positionToLabel(u.position);
    lines.push(`  - ${u.name} | type: ${u.type} | hex ${hexLabel}`);
  }
  lines.push("");

  // ── Flag definitions ──
  lines.push("═══ FLAG DEFINITIONS ═══");
  lines.push("");

  if (hardKeywords.length > 0) {
    lines.push("HARD flags: Words that appear ONLY in forbidden unit names, never in");
    lines.push(`${actorName}'s own units or known enemies. Very likely leaks. Remove or`);
    lines.push("rephrase unless the context clearly has nothing to do with enemy forces.");
    lines.push(`  Hard words: ${hardKeywords.join(", ")}`);
    lines.push("");
  }

  if (softKeywords.length > 0) {
    lines.push("SOFT flags: Words shared with the actor's own units or known enemies.");
    lines.push("Usually innocent. Only remove if the context specifically describes a");
    lines.push("forbidden enemy.");
    lines.push(`  Soft words: ${softKeywords.join(", ")}`);
    lines.push("");
  }

  if (bannedTypes.length > 0) {
    lines.push("BANNED UNIT TYPES: No visible enemies have these types. Any reference");
    lines.push("to enemy forces of these types is likely a leak.");
    lines.push(`  Types: ${bannedTypes.join(", ")}`);
    lines.push("");
  }

  lines.push("HEX flags: Text mentions a hex where a forbidden enemy is located. If the");
  lines.push("reference describes enemy activity at that hex, it likely reveals a forbidden");
  lines.push(`unit's position. If it describes ${actorName}'s own movement there, it is fine.`);
  lines.push("");

  // ── Text fields with per-field flags ──
  lines.push("═══ TEXT TO AUDIT ═══");
  lines.push("");

  const fields = [
    { key: "narrative", label: "NARRATIVE", text: narrative },
    { key: "known_enemy_actions", label: "KNOWN_ENEMY_ACTIONS", text: knownEnemyActions },
    { key: "intel_assessment", label: "INTEL_ASSESSMENT", text: intelAssessment },
    { key: "probability_assessment", label: "PROBABILITY_ASSESSMENT", text: probabilityAssessment },
  ];

  for (const { key, label, text } of fields) {
    const flags = fieldFlags[key] || [];
    lines.push(`FIELD: ${label}`);
    if (flags.length > 0) {
      const flagStrs = flags.map(f => {
        if (f.tier === "hex") return `hex ${f.word} (${f.unit})`;
        const countStr = f.count > 1 ? ` ×${f.count}` : "";
        return `"${f.word}" (${f.tier})${countStr}`;
      });
      lines.push(`FLAGS: ${flagStrs.join(", ")}`);
    } else {
      lines.push("FLAGS: None — check for semantic leaks only");
    }
    lines.push("TEXT:");
    lines.push(text || "(empty)");
    lines.push("");
  }

  // ── Instructions ──
  lines.push("═══ INSTRUCTIONS ═══");
  lines.push("");
  lines.push("For each field, review every flag:");
  lines.push("- HARD flags: Very likely a leak. Remove or rephrase unless the word clearly");
  lines.push("  has nothing to do with enemy forces.");
  lines.push("- SOFT flags: Usually innocent. Only remove if the context specifically");
  lines.push("  describes a forbidden enemy.");
  lines.push("- HEX flags: Remove if it describes enemy activity at that hex. Leave if it");
  lines.push(`  describes ${actorName}'s own movement.`);
  lines.push("- Also check for semantic leaks the scan may have missed — descriptions of");
  lines.push("  enemy forces that reveal forbidden unit information without using flagged words.");
  lines.push("");
  lines.push(`Never remove or alter the names of ${actorName}'s own units from the text.`);
  lines.push(`If a flagged word is being used to describe ${actorName}'s own forces`);
  lines.push("(e.g., \"Baker's rifle company\"), that usage is not a leak — leave it.");
  lines.push(`When rewriting, preserve mentions of ${actorName}'s own units. If a sentence`);
  lines.push("describes a friendly unit encountering a forbidden reference, rewrite to keep");
  lines.push("the friendly unit's action while removing the leak — do not delete the");
  lines.push("sentence entirely.");
  lines.push("");
  lines.push("When rewriting:");
  lines.push("- Keep text as close to the original as possible.");
  lines.push("- Only remove or rephrase the sentence or clause containing the leak.");
  lines.push('- Replace forbidden references with vague alternatives ("enemy forces",');
  lines.push('  "unidentified contact", "the target at [hex]") or remove entirely.');
  lines.push("- Do NOT add new information or alter clean sentences.");
  lines.push("");

  // ── Response format ──
  lines.push("═══ RESPONSE ═══");
  lines.push("");
  lines.push("If ALL fields are clean: respond with exactly CLEAN");
  lines.push("");
  lines.push("If ANY field has a leak, respond with JSON:");
  lines.push("{");
  lines.push('  "narrative": "<corrected text or null if clean>",');
  lines.push('  "known_enemy_actions": "<corrected text or null if clean>",');
  lines.push('  "intel_assessment": "<corrected text or null if clean>",');
  lines.push('  "probability_assessment": "<corrected text or null if clean>"');
  lines.push("}");
  lines.push("");
  lines.push('Output ONLY "CLEAN" or the JSON object. No preamble, no explanation.');

  return lines.join("\n");
}
