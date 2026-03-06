// ═══════════════════════════════════════════════════════════════
// FORTUNE ROLLS — Per-actor chaos dice + wild card
// Generates pre-adjudication randomness the LLM must interpret.
// Rolls are scale-agnostic; the LLM contextualizes them.
// ═══════════════════════════════════════════════════════════════

// Bands compressed for per-unit rolls: with ~10 active units per turn,
// P(≥1 catastrophe) ≈ 18%, P(any bad-or-worse) ≈ 55%.
// 40% neutral band keeps most rolls unremarkable.
const FORTUNE_BANDS = [
  { min: 1,  max: 2,   descriptor: "Catastrophic misfortune" },
  { min: 3,  max: 8,   descriptor: "Bad luck" },
  { min: 9,  max: 30,  descriptor: "Unfavorable conditions" },
  { min: 31, max: 70,  descriptor: "Neutral fortune" },
  { min: 71, max: 92,  descriptor: "Favorable conditions" },
  { min: 93, max: 98,  descriptor: "Good fortune" },
  { min: 99, max: 100, descriptor: "Exceptional luck" },
];

const WILDCARD_BANDS = [
  { min: 1,  max: 85,  descriptor: "No wild card event", triggered: false },
  { min: 86, max: 95,  descriptor: "Minor unexpected event", triggered: true },
  { min: 96, max: 100, descriptor: "Major unexpected event", triggered: true },
];

// Crypto-grade RNG — OS-level entropy via CSPRNG, eliminates
// sequential correlation issues inherent in Math.random()'s xorshift128+.
function roll100() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 100) + 1;
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
 * Generate per-unit fortune rolls for all units with active orders.
 * Units on HOLD (no orders) get no fortune roll — nothing is happening
 * where luck matters.
 *
 * @param {Array} units - Unit objects (need .id, .actor)
 * @param {Object} allOrders - { actorId: { unitId: { movementOrder, actionOrder } } }
 * @returns {{ unitRolls: Object, wildCard: Object }}
 *   unitRolls: { unitId: { roll, descriptor } }
 */
export function generateUnitFortuneRolls(units, allOrders = {}) {
  const unitRolls = {};
  for (const unit of units) {
    const actorOrders = allOrders[unit.actor];
    const unitOrders = actorOrders?.[unit.id];
    const hasOrders = unitOrders?.movementOrder || unitOrders?.actionOrder;

    if (hasOrders) {
      const r = roll100();
      const band = lookupBand(r, FORTUNE_BANDS);
      unitRolls[unit.id] = { roll: r, descriptor: band.descriptor };
    }
    // Units on HOLD get no roll
  }

  const wcRoll = roll100();
  const wcBand = lookupBand(wcRoll, WILDCARD_BANDS);
  const wildCard = {
    roll: wcRoll,
    descriptor: wcBand.descriptor,
    triggered: wcBand.triggered,
  };

  return { unitRolls, wildCard };
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
