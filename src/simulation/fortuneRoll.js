// ═══════════════════════════════════════════════════════════════
// FORTUNE ROLLS — Per-actor chaos dice + wild card
// Generates pre-adjudication randomness the LLM must interpret.
// Rolls are scale-agnostic; the LLM contextualizes them.
// ═══════════════════════════════════════════════════════════════

const FORTUNE_BANDS = [
  { min: 1,  max: 5,   descriptor: "Catastrophic misfortune" },
  { min: 6,  max: 20,  descriptor: "Bad luck" },
  { min: 21, max: 40,  descriptor: "Unfavorable conditions" },
  { min: 41, max: 60,  descriptor: "Neutral fortune" },
  { min: 61, max: 80,  descriptor: "Favorable conditions" },
  { min: 81, max: 95,  descriptor: "Good fortune" },
  { min: 96, max: 100, descriptor: "Exceptional luck" },
];

const WILDCARD_BANDS = [
  { min: 1,  max: 85,  descriptor: "No wild card event", triggered: false },
  { min: 86, max: 95,  descriptor: "Minor unexpected event", triggered: true },
  { min: 96, max: 100, descriptor: "Major unexpected event", triggered: true },
];

function roll100() {
  return Math.floor(Math.random() * 100) + 1;
}

function lookupBand(roll, bands) {
  for (const band of bands) {
    if (roll >= band.min && roll <= band.max) return band;
  }
  return bands[bands.length - 1];
}

/**
 * Generate per-actor fortune rolls and a wild card roll.
 * @param {Array} actors - Scenario actor objects (need .id)
 * @returns {{ actorRolls: Object, wildCard: Object }}
 */
export function generateFortuneRolls(actors) {
  const actorRolls = {};
  for (const actor of actors) {
    const r = roll100();
    const band = lookupBand(r, FORTUNE_BANDS);
    actorRolls[actor.id] = { roll: r, descriptor: band.descriptor };
  }

  const wcRoll = roll100();
  const wcBand = lookupBand(wcRoll, WILDCARD_BANDS);
  const wildCard = {
    roll: wcRoll,
    descriptor: wcBand.descriptor,
    triggered: wcBand.triggered,
  };

  return { actorRolls, wildCard };
}

/**
 * Format fortune rolls for prompt injection.
 * @param {{ actorRolls, wildCard }} fortuneRolls
 * @param {Array} actors - Full actor objects (need .id, .name)
 * @returns {string}
 */
export function formatFortuneForPrompt(fortuneRolls, actors) {
  if (!fortuneRolls) return "";
  const lines = [];
  lines.push("Per-actor fortune rolls:");
  for (const actor of actors) {
    const r = fortuneRolls.actorRolls[actor.id];
    if (r) {
      lines.push(`  ${actor.name} (${actor.id}): ${r.roll} — ${r.descriptor}`);
    }
  }
  lines.push("");
  if (fortuneRolls.wildCard.triggered) {
    lines.push(`Wild card: ${fortuneRolls.wildCard.roll} — TRIGGERED: ${fortuneRolls.wildCard.descriptor}`);
  } else {
    lines.push(`Wild card: ${fortuneRolls.wildCard.roll} — Not triggered`);
  }
  return lines.join("\n");
}
