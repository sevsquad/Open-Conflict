// ═══════════════════════════════════════════════════════════════
// MOVEMENT SIMULATOR — Per-hex stepping with detection at each step.
// All units move simultaneously one hex at a time. Detection checks
// run at each step, generating contact events when units encounter
// each other during movement.
//
// Contact event types:
//   - transit_sighting: observer briefly sees target during movement
//   - contact_ahead:    moving unit spots enemy on or near its path
//   - surprise_contact: unit enters hex with/adjacent to undetected enemy
//   - mutual_surprise:  both units unaware, stumble into each other
// ═══════════════════════════════════════════════════════════════

import { hexDistance, hexLine } from "../mapRenderer/HexMath.js";
import { parsePosition, positionToLabel } from "./prompts.js";
import { computeDetection } from "./detectionEngine.js";
import { SURPRISE_MODIFIERS } from "./detectionRanges.js";


// ── Contact Event Constructors ───────────────────────────────

function makeContactEvent(type, observer, target, step, extra = {}) {
  return {
    type,
    step,
    observerUnitId: observer.id,
    observerName: observer.name,
    observerActor: observer.actor,
    targetUnitId: target.id,
    targetName: target.name,
    targetActor: target.actor,
    observerPos: observer._simPos || observer.position,
    targetPos: target._simPos || target.position,
    ...extra,
  };
}


/**
 * Simulate movement for all units simultaneously with detection at each step.
 *
 * @param {Object} gameState - current game state
 * @param {Object} terrainData - hex grid
 * @param {Object} sealedOrders - { actorId: { unitOrders: { unitId: { movementOrder } } } }
 * @param {Object} previousVisibility - from previous turn
 * @returns {{ finalVisibility, contactEvents, unitPaths }}
 *   finalVisibility: visibilityState after all movement completes
 *   contactEvents: array of contact events generated during movement
 *   unitPaths: { unitId: [positions traversed] } for visualization
 */
export function simulateMovement(gameState, terrainData, sealedOrders, previousVisibility = null) {
  const allUnits = gameState.units.filter(u => u.status !== "destroyed" && u.status !== "eliminated");

  // Build movement paths for all units from their sealed orders
  const movePaths = {};   // unitId → array of {col, row} positions
  const unitPaths = {};   // unitId → array of position strings for logging
  const movingUnits = new Set();

  for (const unit of allUnits) {
    const actorOrders = sealedOrders?.[unit.actor]?.unitOrders?.[unit.id];
    const moveOrder = actorOrders?.movementOrder;

    if (moveOrder?.target) {
      const from = parsePosition(unit.position);
      const to = parsePosition(moveOrder.target);
      if (from && to) {
        // Bounds check: skip movement to off-map targets
        const cols = terrainData?.cols ?? Infinity;
        const rows = terrainData?.rows ?? Infinity;
        if (to.col < 0 || to.col >= cols || to.row < 0 || to.row >= rows) {
          movePaths[unit.id] = [];
          unitPaths[unit.id] = [`${from.col},${from.row}`];
          continue;
        }
        const path = hexLine(from.col, from.row, to.col, to.row);
        // Filter out any intermediate hexes that go off-map
        const inBounds = path.filter(p => p.col >= 0 && p.col < cols && p.row >= 0 && p.row < rows);
        // Convert to {col, row} objects and skip the starting position
        movePaths[unit.id] = inBounds.slice(1);
        unitPaths[unit.id] = inBounds.map(p => `${p.col},${p.row}`);
        movingUnits.add(unit.id);
      }
    }

    if (!movePaths[unit.id]) {
      const pos = parsePosition(unit.position);
      if (pos) {
        movePaths[unit.id] = [];  // stationary
        unitPaths[unit.id] = [`${pos.col},${pos.row}`];
      }
    }
  }

  // Determine the maximum number of steps any unit takes
  const maxSteps = Math.max(1, ...Object.values(movePaths).map(p => p.length));

  const contactEvents = [];
  const transitSightings = new Map(); // "observerActor→targetId" → event (dedup)

  // Create simulated unit copies with mutable positions
  const simUnits = allUnits.map(u => ({
    ...u,
    _simPos: u.position,
    _startPos: u.position,
  }));

  // Step 0: Initial detection at starting positions
  const startVis = computeDetection(gameState, terrainData, sealedOrders, previousVisibility);

  // Accumulate all cells each actor sees across every movement step.
  // The LLM gets terrain context for every cell any friendly unit could
  // observe at any point during the turn, not just the final snapshot.
  const accumulatedVisible = {};  // actorId → Set of hex keys
  for (const [actorId, av] of Object.entries(startVis.actorVisibility)) {
    accumulatedVisible[actorId] = new Set(av.visibleCells || []);
  }

  // Track what each actor knew at the start (for surprise determination)
  const initialDetected = {};  // actorId → Set of detected unit IDs
  for (const [actorId, av] of Object.entries(startVis.actorVisibility)) {
    initialDetected[actorId] = new Set([
      ...(av.detectedUnits || []),
      ...(av.contactUnits || []),
    ]);
  }

  // Step through movement one hex at a time
  for (let step = 1; step <= maxSteps; step++) {
    // Move all units one hex forward along their paths
    for (const unit of simUnits) {
      const path = movePaths[unit.id];
      if (path && path.length >= step) {
        const nextHex = path[step - 1];
        unit._simPos = `${nextHex.col},${nextHex.row}`;
      }
    }

    // Build a temporary game state with updated positions for detection
    const stepGameState = {
      ...gameState,
      units: simUnits.map(u => ({
        ...u,
        position: u._simPos,
      })),
    };

    // Run detection at this step
    const stepVis = computeDetection(stepGameState, terrainData, sealedOrders, startVis);

    // Accumulate visible cells from this step into per-actor running total
    for (const [actorId, av] of Object.entries(stepVis.actorVisibility)) {
      if (!accumulatedVisible[actorId]) accumulatedVisible[actorId] = new Set();
      for (const cell of (av.visibleCells || [])) accumulatedVisible[actorId].add(cell);
    }

    // Check for contact events at this step
    for (const actor of gameState.scenario.actors) {
      const av = stepVis.actorVisibility[actor.id];
      if (!av) continue;

      const myMovingUnits = simUnits.filter(u => u.actor === actor.id && movingUnits.has(u.id));

      // Check newly detected/contacted enemies
      const allDetected = new Set([...(av.detectedUnits || []), ...(av.contactUnits || [])]);

      for (const targetId of allDetected) {
        const wasKnown = initialDetected[actor.id]?.has(targetId);
        if (wasKnown) continue; // Already knew about this unit

        const target = simUnits.find(u => u.id === targetId);
        if (!target) continue;

        // Determine which observer made the detection
        const observer = myMovingUnits.find(u => {
          const obsPos = parsePosition(u._simPos);
          const tgtPos = parsePosition(target._simPos);
          if (!obsPos || !tgtPos) return false;
          return hexDistance(obsPos.col, obsPos.row, tgtPos.col, tgtPos.row) <= 6;
        }) || simUnits.find(u => u.actor === actor.id);

        if (!observer) continue;

        const observerIsMoving = movingUnits.has(observer.id);
        const targetIsMoving = movingUnits.has(target.id);

        // Classify the contact event
        const targetKnowsUs = initialDetected[target.actor]?.has(observer.id);

        // Check proximity — adjacent or same hex = surprise potential
        const obsPos = parsePosition(observer._simPos);
        const tgtPos = parsePosition(target._simPos);
        const dist = (obsPos && tgtPos) ? hexDistance(obsPos.col, obsPos.row, tgtPos.col, tgtPos.row) : 99;

        let eventType, surpriseState;

        if (dist <= 1 && !wasKnown && !targetKnowsUs) {
          // Both sides unaware at close range
          eventType = "mutual_surprise";
          surpriseState = "mutual_surprise";
        } else if (dist <= 1 && observerIsMoving && !wasKnown) {
          // Moving unit walked into hidden enemy
          eventType = "surprise_contact";
          surpriseState = "attacker_surprised";  // The mover is "attacking" and gets surprised
        } else if (observerIsMoving) {
          eventType = "contact_ahead";
          surpriseState = targetKnowsUs ? "no_surprise" : "defender_surprised";
        } else {
          eventType = "transit_sighting";
          surpriseState = "no_surprise";
        }

        // Dedup transit sightings (same observer-actor seeing same target in multiple steps)
        const dedupKey = `${actor.id}→${targetId}`;
        if (eventType === "transit_sighting" && transitSightings.has(dedupKey)) {
          continue;
        }

        const event = makeContactEvent(eventType, observer, target, step, {
          surpriseState,
          surpriseMod: SURPRISE_MODIFIERS[surpriseState] || SURPRISE_MODIFIERS.no_surprise,
          detectionTier: av.detectedUnits.has(targetId) ? "IDENTIFIED" : "CONTACT",
        });

        contactEvents.push(event);
        if (eventType === "transit_sighting") {
          transitSightings.set(dedupKey, event);
        }

        // Update initial detected so we don't re-fire for same unit
        if (!initialDetected[actor.id]) initialDetected[actor.id] = new Set();
        initialDetected[actor.id].add(targetId);
      }
    }
  }

  // Final detection pass at end positions
  const finalGameState = {
    ...gameState,
    units: simUnits.map(u => ({
      ...u,
      position: u._simPos,
    })),
  };
  const finalVisibility = computeDetection(finalGameState, terrainData, sealedOrders, startVis);

  // Merge accumulated visible cells into final visibility.
  // Final detection only has cells visible from end positions — the LLM needs
  // everything the actor could see during the entire turn (start + each step + end).
  for (const [actorId, av] of Object.entries(finalVisibility.actorVisibility)) {
    const accumulated = accumulatedVisible[actorId];
    if (accumulated) {
      for (const cell of accumulated) av.visibleCells.add(cell);
    }
    // Guarantee: every unit's own cell is always visible to its actor
    const myUnits = simUnits.filter(u => u.actor === actorId);
    for (const u of myUnits) {
      const pos = parsePosition(u._simPos);
      if (pos) av.visibleCells.add(`${pos.col},${pos.row}`);
    }
  }

  // Build movement paths as hex key arrays per actor (for LLM full-detail tier)
  const actorMovePaths = {};  // actorId → Set of hex keys traversed
  for (const unit of simUnits) {
    if (!actorMovePaths[unit.actor]) actorMovePaths[unit.actor] = new Set();
    const path = unitPaths[unit.id];
    if (path) {
      for (const hexKey of path) actorMovePaths[unit.actor].add(hexKey);
    }
  }

  return {
    finalVisibility,
    contactEvents,
    unitPaths,
    actorMovePaths,
    // The final positions for each unit (so SimGame can update before adjudication)
    finalPositions: Object.fromEntries(
      simUnits.map(u => [u.id, u._simPos])
    ),
  };
}
