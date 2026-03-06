// ═══════════════════════════════════════════════════════════════
// TURN PHASES — Phase constants and transition logic for the
// sequential per-actor turn cycle.
// ═══════════════════════════════════════════════════════════════

export const PHASES = {
  PLANNING:                "planning",
  HANDOFF:                 "handoff",
  COMPUTING_DETECTION:     "computing_detection",      // Legacy alias
  MOVEMENT_AND_DETECTION:  "movement_and_detection",   // New: per-hex stepping + detection
  ADJUDICATING:            "adjudicating",
  REVIEW:                  "review",
  CHALLENGE_COLLECT:       "challenge_collect",
  REBUTTAL_COLLECT:        "rebuttal_collect",
  RE_ADJUDICATING:         "re_adjudicating",
  RESOLVING:               "resolving",
};

// Phases where the activeActorIndex matters (per-actor cycling)
export const ACTOR_CYCLING_PHASES = new Set([
  PHASES.PLANNING,
  PHASES.HANDOFF,
  PHASES.REVIEW,
  PHASES.CHALLENGE_COLLECT,
  PHASES.REBUTTAL_COLLECT,
]);

/**
 * Determine the next phase given the current phase and context.
 *
 * @param {string} currentPhase
 * @param {Object} context
 * @param {number} context.activeActorIndex - which actor just finished
 * @param {number} context.actorCount      - total number of actors
 * @param {Object} context.actorDecisions  - { actorId: "accept"|"challenge" } (review phase)
 * @param {boolean} context.hasRebuttals   - whether counter-rebuttals were collected
 * @returns {{ phase: string, nextActorIndex: number|null }}
 */
export function getNextPhase(currentPhase, context) {
  const { activeActorIndex = 0, actorCount = 2, actorDecisions = {} } = context;
  const isLastActor = activeActorIndex >= actorCount - 1;

  switch (currentPhase) {
    // ── PLANNING ──
    // Each actor submits orders sequentially. After the last actor,
    // proceed to detection computation.
    case PHASES.PLANNING:
      if (isLastActor) {
        return { phase: PHASES.MOVEMENT_AND_DETECTION, nextActorIndex: null };
      }
      return { phase: PHASES.HANDOFF, nextActorIndex: activeActorIndex + 1 };

    // ── HANDOFF ──
    // Interstitial screen between actors. Always transitions to the
    // next cycling phase (planning or review depending on context).
    // The caller specifies which phase to resume via context.resumePhase.
    case PHASES.HANDOFF:
      return { phase: context.resumePhase || PHASES.PLANNING, nextActorIndex: activeActorIndex };

    // ── COMPUTING_DETECTION ── (legacy alias, same behavior)
    case PHASES.COMPUTING_DETECTION:
      return { phase: PHASES.ADJUDICATING, nextActorIndex: null };

    // ── MOVEMENT_AND_DETECTION ──
    // Per-hex movement simulation + detection. Transitions to adjudication.
    case PHASES.MOVEMENT_AND_DETECTION:
      return { phase: PHASES.ADJUDICATING, nextActorIndex: null };

    // ── ADJUDICATING ──
    // LLM call complete. Start review with actor 0.
    case PHASES.ADJUDICATING:
      return { phase: PHASES.REVIEW, nextActorIndex: 0 };

    // ── REVIEW ──
    // Each actor reviews their adjudication. After the last actor,
    // check if anyone challenged.
    case PHASES.REVIEW:
      if (!isLastActor) {
        return { phase: PHASES.HANDOFF, nextActorIndex: activeActorIndex + 1 };
      }
      // All actors reviewed — check decisions
      const hasChallenges = Object.values(actorDecisions).some(d => d === "challenge");
      if (hasChallenges) {
        return { phase: PHASES.CHALLENGE_COLLECT, nextActorIndex: 0 };
      }
      return { phase: PHASES.RESOLVING, nextActorIndex: null };

    // ── CHALLENGE_COLLECT ──
    // Challengers write their challenge text. After all actors cycled,
    // move to rebuttal collection.
    case PHASES.CHALLENGE_COLLECT:
      if (!isLastActor) {
        return { phase: PHASES.CHALLENGE_COLLECT, nextActorIndex: activeActorIndex + 1 };
      }
      return { phase: PHASES.REBUTTAL_COLLECT, nextActorIndex: 0 };

    // ── REBUTTAL_COLLECT ──
    // Non-challengers write counter-rebuttals. After all actors cycled,
    // proceed to re-adjudication.
    case PHASES.REBUTTAL_COLLECT:
      if (!isLastActor) {
        return { phase: PHASES.REBUTTAL_COLLECT, nextActorIndex: activeActorIndex + 1 };
      }
      return { phase: PHASES.RE_ADJUDICATING, nextActorIndex: null };

    // ── RE_ADJUDICATING ──
    // LLM ruling after challenges is final — apply and advance.
    case PHASES.RE_ADJUDICATING:
      return { phase: PHASES.RESOLVING, nextActorIndex: null };

    // ── RESOLVING ──
    // State updates applied. Turn advances. Next planning phase starts.
    case PHASES.RESOLVING:
      return { phase: PHASES.PLANNING, nextActorIndex: 0 };

    default:
      return { phase: PHASES.PLANNING, nextActorIndex: 0 };
  }
}

/**
 * Check if the current phase is one where the game is "busy" (no user input).
 */
export function isBusyPhase(phase) {
  return phase === PHASES.COMPUTING_DETECTION
    || phase === PHASES.MOVEMENT_AND_DETECTION
    || phase === PHASES.ADJUDICATING
    || phase === PHASES.RE_ADJUDICATING
    || phase === PHASES.RESOLVING;
}

/**
 * Check if an actor needs to provide input during challenge/rebuttal collection.
 *
 * @param {string} phase - CHALLENGE_COLLECT or REBUTTAL_COLLECT
 * @param {string} actorId - the actor to check
 * @param {Object} actorDecisions - { actorId: "accept"|"challenge" }
 * @returns {boolean}
 */
export function actorNeedsInput(phase, actorId, actorDecisions) {
  if (phase === PHASES.CHALLENGE_COLLECT) {
    // Only challengers need to write challenge text
    return actorDecisions[actorId] === "challenge";
  }
  if (phase === PHASES.REBUTTAL_COLLECT) {
    // Every actor rebuts challenges from OTHER actors.
    // Skip only if no other actor challenged (nothing to rebut).
    return Object.entries(actorDecisions)
      .some(([id, d]) => id !== actorId && d === "challenge");
  }
  return false;
}
