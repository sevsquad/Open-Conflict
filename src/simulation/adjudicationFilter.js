// ═══════════════════════════════════════════════════════════════
// ADJUDICATION FILTER — Builds per-actor views from the master
// adjudication. Each actor only sees information about their own
// units plus detected enemy units.
// ═══════════════════════════════════════════════════════════════


/**
 * Filter the master adjudication to produce an actor-specific view.
 * The actor sees:
 *   - Their own units' state updates (always)
 *   - Detected enemy unit state updates (position, posture, observable attributes)
 *   - Their actor_perspective narrative (from the LLM)
 *   - Their own feasibility assessments
 *   - Detection resolution results relevant to them
 *
 * @param {Object} masterAdjudication - full adjudication from LLM
 * @param {string} actorId - which actor we're filtering for
 * @param {Object} visibilityState - from computeDetection()
 * @param {Object} gameState - current game state (to look up unit ownership)
 * @returns {Object} filtered adjudication safe to show this actor
 */
export function filterAdjudicationForActor(masterAdjudication, actorId, visibilityState, gameState) {
  const adj = masterAdjudication?.adjudication;
  if (!adj) return masterAdjudication;

  const actorVis = visibilityState?.actorVisibility?.[actorId];

  // Build a set of unit IDs this actor can observe
  const visibleUnitIds = new Set();

  // Own units are always visible
  for (const unit of (gameState.units || [])) {
    if (unit.actor === actorId) visibleUnitIds.add(unit.id);
  }

  // Detected enemy units (Identified tier — full details)
  if (actorVis?.detectedUnits) {
    for (const unitId of actorVis.detectedUnits) {
      visibleUnitIds.add(unitId);
    }
  }

  // Contact-tier enemy units (position known, limited details)
  if (actorVis?.contactUnits) {
    for (const unitId of actorVis.contactUnits) {
      visibleUnitIds.add(unitId);
    }
  }

  // Units resolved as detected by the LLM (from ambiguous contacts)
  const perspective = adj.actor_perspectives?.[actorId];
  if (perspective?.detection_resolutions) {
    for (const res of perspective.detection_resolutions) {
      if (res.detected) visibleUnitIds.add(res.unitId);
    }
  }

  // Filter state_updates to only visible entities
  const filteredUpdates = (adj.state_updates || []).filter(update => {
    // Diplomacy updates are visible to everyone
    if (update.entity === "diplomacy") return true;

    // Check if the entity is a visible unit
    if (visibleUnitIds.has(update.entity)) return true;

    // Check if entity matches an actor ID (for actor-level updates)
    if (update.entity === actorId) return true;

    return false;
  });

  // Build per-actor narrative: use actor_perspectives if available,
  // otherwise fall back to the master narrative
  const actorNarrative = perspective?.narrative || adj.outcome_determination?.narrative || "";
  const knownEnemyActions = perspective?.known_enemy_actions || "";
  const intelAssessment = perspective?.intel_assessment || "";

  // Filter feasibility assessments to only this actor's units
  const filteredFeasibility = {
    ...adj.feasibility_analysis,
    assessments: (adj.feasibility_analysis?.assessments || []).filter(a => {
      return a.actor === actorId;
    }),
  };

  // Security: strip god-view fields that could leak enemy intel.
  // situation_assessment contains full strategic analysis of all actors.
  // de_escalation_assessment may reference hidden actors/units.
  // meta may contain debug/internal info.
  // Only pass through the actor's own perspective narrative.

  return {
    adjudication: {
      // Omit situation_assessment — it contains god-view strategic analysis
      action_interpretation: {
        actions_received: (adj.action_interpretation?.actions_received || []).filter(a => {
          // Show own actions only — enemy actions visible via known_enemy_actions
          return a.actor === actorId;
        }),
      },
      feasibility_analysis: filteredFeasibility,
      // Omit de_escalation_assessment — may reference hidden actors
      outcome_determination: {
        // Only pass safe fields, not the full god-view outcome
        narrative: actorNarrative,
        outcome_type: adj.outcome_determination?.outcome_type || "",
        // Use auditor-cleaned probability_assessment if available (strips enemy unit names)
        ...(perspective?._clean_probability_assessment
          ? { probability_assessment: perspective._clean_probability_assessment }
          : {}),
      },
      state_updates: filteredUpdates,

      // Per-actor extras (not in the standard schema but useful for UI)
      _actor_view: {
        actorId,
        known_enemy_actions: knownEnemyActions,
        intel_assessment: intelAssessment,
        detection_resolutions: perspective?.detection_resolutions || [],
        visible_state_updates: perspective?.visible_state_updates || filteredUpdates,
      },
    },
    // Omit meta — may contain debug/internal info
  };
}


/**
 * Extract proposed position changes from a filtered adjudication.
 * Used for visualizing movement arrows during the review phase.
 *
 * @param {Object} filteredAdjudication - from filterAdjudicationForActor
 * @param {Object} gameState - to look up current positions
 * @returns {Array<{unitId, unitName, from, to, actorId}>}
 */
export function extractProposedMoves(filteredAdjudication, gameState) {
  const updates = filteredAdjudication?.adjudication?.state_updates || [];
  const moves = [];

  for (const update of updates) {
    if (update.attribute !== "position") continue;
    if (!update.old_value || !update.new_value) continue;
    if (update.old_value === update.new_value) continue;

    const unit = gameState.units.find(u => u.id === update.entity);
    if (!unit) continue;

    moves.push({
      unitId: update.entity,
      unitName: unit.name,
      from: update.old_value,
      to: update.new_value,
      actorId: unit.actor,
    });
  }

  return moves;
}
