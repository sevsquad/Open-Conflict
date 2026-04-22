import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import SimMap from "./SimMap.jsx";
import { adjudicate, adjudicateRebuttal, applyStateUpdates, advanceTurn, pauseGame, resumeGame, endGame, saveGameState, autosave, getProviders } from "./orchestrator.js";
import { createLogger } from "./logger.js";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge, Card, SectionHeader, Panel } from "../components/ui.jsx";
import { SCALE_TIERS, DIPLOMATIC_STATUSES } from "./schemas.js";
import { buildActorBriefing, buildFullBriefing, downloadFile, downloadDataURL } from "./briefingExport.js";
import UnitOrderCard from "./components/UnitOrderCard.jsx";
import OrderRoster from "./components/OrderRoster.jsx";
import { ORDER_TYPES, canEmbark, isAirUnit } from "./orderTypes.js";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { buildOrderOverlayData } from "../mapRenderer/overlays/OrderOverlay.js";
import { positionToLabel } from "./prompts.js";
import { hexLine, hexLineThrough } from "../mapRenderer/HexMath.js";
import { computeMovePath, computeRange } from "./orderComputer.js";
import { PHASES, getNextPhase, isBusyPhase, actorNeedsInput } from "./turnPhases.js";
import { computeDetection, serializeVisibility, deserializeVisibility } from "./detectionEngine.js";
import { simulateMovement } from "./movementSimulator.js";
import { filterAdjudicationForActor, extractProposedMoves } from "./adjudicationFilter.js";
import { auditAllNarratives } from "./narrativeAuditor.js";
import HandoffScreen from "./components/HandoffScreen.jsx";
import ReinforcementPanel from "./components/ReinforcementPanel.jsx";
import { ACTOR_COLORS, FC, FL, FG, DEFAULT_FEATURES } from "../terrainColors.js";
import { generateAIOrdersClient, captureMapForAI, isVisionModel } from "./aiOrderClient.js";
import { computeElevationRange } from "../mapRenderer/gl/HexGPUData.js";
import { buildEffectiveTerrain } from "./terrainMerge.js";

// ═══════════════════════════════════════════════════════════════
// SIM GAME — Active simulation UI
// Turn cycle: per-actor Planning → Detection → Adjudication → per-actor Review
// Supports hotseat privacy (sealed orders, handoff screens, FOW)
// ═══════════════════════════════════════════════════════════════

// Set to true to skip handoff screens for automated testing
const SKIP_HANDOFF = false;

/** Defensive check for AI-controlled actors. Handles undefined/missing controller field from old saves. */
function isAiActor(actor) { return actor?.controller === "ai"; }

const ESCALATION_COLORS = {
  "de-escalating": colors.accent.green,
  "stable": colors.accent.amber,
  "escalating": colors.accent.red,
};

// M11: Combat order types that require range checking
const COMBAT_ORDER_IDS = new Set(["ATTACK", "SUPPORT_FIRE", "FIRE_MISSION", "SHORE_BOMBARDMENT"]);

/**
 * Build human-readable playerActions text from sealed orders.
 * Shared by adjudicate, applyStateUpdates, and adjudicateRebuttal call sites.
 */
function buildPlayerActions(actors, sealedOrders, units) {
  const playerActions = {};
  for (const actor of actors) {
    const sealed = sealedOrders[actor.id];
    if (!sealed) { playerActions[actor.id] = "HOLD"; continue; }
    const lines = [];
    if (sealed.actorIntent) lines.push(`Commander's Intent: ${sealed.actorIntent}`);
    const actorUnits = units.filter(u => u.actor === actor.id);
    for (const unit of actorUnits) {
      const orders = sealed.unitOrders?.[unit.id];
      if (!orders || (!orders.movementOrder && !orders.actionOrder)) {
        lines.push(`${unit.name}: HOLD`);
        continue;
      }
      const parts = [];
      if (orders.movementOrder) {
        const tgt = orders.movementOrder.target ? positionToLabel(orders.movementOrder.target) : "";
        const wps = orders.movementOrder.waypoints?.length > 0
          ? " via " + orders.movementOrder.waypoints.map(w => positionToLabel(w)).join("→")
          : "";
        parts.push(`${orders.movementOrder.id}${tgt ? " to " + tgt : ""}${wps}`);
      }
      if (orders.actionOrder) {
        const tgt = orders.actionOrder.target ? positionToLabel(orders.actionOrder.target) : "";
        const sub = orders.actionOrder.subtype ? ` (${orders.actionOrder.subtype})` : "";
        parts.push(`${orders.actionOrder.id}${tgt ? " at " + tgt : ""}${sub}`);
      }
      lines.push(`${unit.name}: ${parts.join(" then ")}`);
      if (orders.intent) lines.push(`  Intent: ${orders.intent}`);
    }
    playerActions[actor.id] = lines.join("\n");
  }
  return playerActions;
}

// Human-readable labels for each phase
const PHASE_LABELS = {
  [PHASES.PLANNING]: "Planning",
  [PHASES.HANDOFF]: "Handoff",
  [PHASES.COMPUTING_DETECTION]: "Computing Detection",
  [PHASES.MOVEMENT_AND_DETECTION]: "Simulating Movement & Detection",
  [PHASES.ADJUDICATING]: "Adjudicating",
  [PHASES.REVIEW]: "Review",
  [PHASES.CHALLENGE_COLLECT]: "Challenge",
  [PHASES.REBUTTAL_COLLECT]: "Counter-Rebuttal",
  [PHASES.RE_ADJUDICATING]: "Re-Adjudicating",
  [PHASES.RESOLVING]: "Resolving",
};

// Format AI order generation results as readable markdown for audit logs.
function formatAITranscript({ actorId, actorName, turn, timestamp, provider, model, personality, usage, success, error, retryCount, unitOrders, actorIntent, commanderThoughts, actorUnits, idleUnits, rawPrompt, rawResponse }) {
  const lines = [];
  lines.push(`# AI Orders — ${actorName} — Turn ${turn}`);
  lines.push("");
  lines.push(`**Generated:** ${timestamp}  `);
  lines.push(`**Model:** ${model} (${provider})  `);
  if (usage) {
    lines.push(`**Tokens:** ${(usage.input || 0).toLocaleString()} in / ${(usage.output || 0).toLocaleString()} out` + (usage.cache_read ? ` (${usage.cache_read.toLocaleString()} cached)` : "") + "  ");
  }
  lines.push(`**Result:** ${success ? "Success" : "FAILED"} · Retries: ${retryCount}` + (error ? ` · Error: ${error}` : ""));
  lines.push("");

  // Commander personality
  if (personality) {
    lines.push("## Commander Profile");
    lines.push("");
    lines.push(personality);
    lines.push("");
  }

  // Strategic intent
  if (actorIntent) {
    lines.push("## Strategic Intent");
    lines.push("");
    lines.push(actorIntent);
    lines.push("");
  }

  // Commander thoughts (inner monologue)
  if (commanderThoughts) {
    lines.push("## Commander Thoughts");
    lines.push("");
    lines.push(`> ${commanderThoughts.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }

  // Unit orders table
  if (unitOrders && Object.keys(unitOrders).length > 0) {
    lines.push("## Unit Orders");
    lines.push("");
    for (const [uid, o] of Object.entries(unitOrders)) {
      const unit = actorUnits?.find(u => u.id === uid);
      const name = unit?.name || uid;
      const pos = unit?.position || "?";
      lines.push(`### ${name}`);
      lines.push(`Position: ${pos} · Type: ${unit?.type || "?"} · Strength: ${unit?.strength ?? "?"}%`);
      lines.push("");
      if (o.movementOrder) {
        lines.push(`- **Movement:** ${o.movementOrder.id} → ${o.movementOrder.target}`);
      } else {
        lines.push("- **Movement:** Hold");
      }
      if (o.actionOrder) {
        const sub = o.actionOrder.subtype ? ` (${o.actionOrder.subtype})` : "";
        const tgt = o.actionOrder.target ? ` → ${o.actionOrder.target}` : "";
        lines.push(`- **Action:** ${o.actionOrder.id}${sub}${tgt}`);
      } else {
        lines.push("- **Action:** None");
      }
      if (o.intent) {
        lines.push(`- **Intent:** ${o.intent}`);
      }
      lines.push("");
    }
  }

  // Idle units warned
  if (idleUnits?.length > 0) {
    lines.push("## Idle Units Warned");
    lines.push("");
    for (const u of idleUnits) {
      lines.push(`- ${u.name} (idle ${u.idleTurns} turns at ${u.position})`);
    }
    lines.push("");
  }

  // Full prompt and response as collapsed sections
  lines.push("---");
  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>Full Prompt (${(rawPrompt || "").length.toLocaleString()} chars)</summary>`);
  lines.push("");
  lines.push("```");
  lines.push(rawPrompt || "(no prompt captured)");
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>Raw Response (${(rawResponse || "").length.toLocaleString()} chars)</summary>`);
  lines.push("");
  lines.push("```json");
  lines.push(rawResponse || "(no response captured)");
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

// Find next actor who needs input during challenge/rebuttal collection.
// Skips actors that don't need input for this phase (e.g., non-challengers skip CHALLENGE_COLLECT).
// Returns -1 if no actor needs input.
function findNextInputActor(phase, startIndex, actors, actorDecisions) {
  for (let i = startIndex; i < actors.length; i++) {
    if (actorNeedsInput(phase, actors[i].id, actorDecisions, actors)) return i;
  }
  return -1;
}

export default function SimGame({ onBack, gameState: initialGameState, terrainData, onUpdateGameState }) {
  // Strip pendingOrders from gs so it doesn't linger in memory or reach the LLM.
  // _pendingRef captures the initial value once — useState initializers run only on mount.
  const _pendingRef = useRef(initialGameState.pendingOrders || {});
  const [gs, setGs] = useState(() => {
    const { pendingOrders, ...cleanGs } = initialGameState;
    // Initialize aiState for old saves that don't have it
    if (!cleanGs.aiState) {
      cleanGs.aiState = { unitOrderHistory: {}, callLog: [] };
    }
    return cleanGs;
  });
  const [providers, setProviders] = useState([]);
  const [adjudicatingLLM, setAdjudicatingLLM] = useState(false);
  const [adjPhaseLabel, setAdjPhaseLabel] = useState(null); // override loading spinner text
  const [adjSubStatus, setAdjSubStatus] = useState(null); // live status from orchestrator (e.g. "Sending...", "Response received")
  const [currentAdjudication, setCurrentAdjudication] = useState(null);
  const [fortuneRolls, setFortuneRolls] = useState(null);
  const [frictionEvents, setFrictionEvents] = useState(null);
  const [error, setError] = useState(null);

  // ── Turn phase state machine ──
  const [turnPhase, setTurnPhase] = useState(PHASES.PLANNING);
  const [activeActorIndex, setActiveActorIndex] = useState(() => _pendingRef.current.activeActorIndex || 0);
  const [handoffResumePhase, setHandoffResumePhase] = useState(null); // phase to go to after handoff

  // ── Sealed orders: per-actor orders locked after submission, invisible to subsequent actors ──
  const [sealedOrders, setSealedOrders] = useState(() => _pendingRef.current.sealedOrders || {}); // { actorId: { unitOrders, actorIntent } }

  // ── Detection & per-actor adjudication ──
  const [visibilityState, setVisibilityState] = useState(null);
  const [masterAdjudication, setMasterAdjudication] = useState(null);
  const [perActorAdjudication, setPerActorAdjudication] = useState({}); // { actorId: filtered adj }
  const [pendingResult, setPendingResult] = useState(null); // full result with fortuneRolls/frictionEvents/promptLog
  const [contactEvents, setContactEvents] = useState([]);   // contact events from movement simulation
  const [actorMovePaths, setActorMovePaths] = useState(null); // per-actor movement path hex keys

  // ── Challenge/rebuttal state ──
  const [actorDecisions, setActorDecisions] = useState({}); // { actorId: "accept"|"challenge" }
  const [challenges, setChallenges] = useState({}); // { actorId: "challenge text" }
  const [counterRebuttals, setCounterRebuttals] = useState({}); // { actorId: "rebuttal text" }
  const [challengeCount, setChallengeCount] = useState(0);
  const MAX_CHALLENGES = 1;

  // ── UI state ──
  const [expandedTurn, setExpandedTurn] = useState(null);
  const [moderatorNote, setModeratorNote] = useState("");
  const [orderWarnings, setOrderWarnings] = useState(null);
  const [rangeWarning, setRangeWarning] = useState(null); // M11: { unit, order, range, targetStr } when target is out of range
  const [pendingRuling, setPendingRuling] = useState(null); // re-adjudication result shown at start of next turn
  const loggerRef = useRef(createLogger());
  const adjDisplayRef = useRef(null);
  const simMapRef = useRef(null);
  const adjAbortRef = useRef(null);
  const mountedRef = useRef(true);

  // Abort any in-flight LLM call and mark unmounted
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      adjAbortRef.current?.abort();
    };
  }, []);

  // Structured order state (per-unit orders replace free-text textareas)
  // Restored from pendingOrders on load so confirmed orders survive save/reload
  const [unitOrders, setUnitOrders] = useState(() => _pendingRef.current.unitOrders || {});          // { actorId: { unitId: { movementOrder, actionOrder, intent } } }
  const [actorIntents, setActorIntents] = useState(() => _pendingRef.current.actorIntents || {});       // { actorId: "intent text" }
  const [selectedUnitId, setSelectedUnitId] = useState(null);  // unit ID or null
  // Derive full unit from current gs.units so it's never stale after state updates
  const selectedUnit = selectedUnitId ? gs.units.find(u => u.id === selectedUnitId) || null : null;
  const [targetingMode, setTargetingMode] = useState(null);   // { orderType, unitId } or null
  const [hoveredCell, setHoveredCell] = useState(null);        // cell under cursor during targeting
  const [waypointBuffer, setWaypointBuffer] = useState([]);    // accumulated waypoints during MOVE targeting

  // Reinforcement placement state
  const [placingReinforcement, setPlacingReinforcement] = useState(false); // map-click mode for reinforcement position
  const [reinforcementPosition, setReinforcementPosition] = useState(null); // "col,row" selected on map

  // Prompt viewer
  const [showPrompt, setShowPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState("narrative");
  const [fogOfWar, setFogOfWar] = useState(true);

  // ── AI player state ──
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState(null);
  const aiAbortRef = useRef(null);
  const aiSealPendingRef = useRef(false); // declared early so the setTimeout in AI planning can set it
  const [aiCostDismissed, setAiCostDismissed] = useState(() => localStorage.getItem("oc_ai_cost_dismissed") === "1");
  // Temporary FOW override for AI screenshot capture in all-AI games.
  // When set, fowMode uses this actor's visibility instead of spectator god-view.
  const [aiFowOverride, setAiFowOverride] = useState(null);
  // Commander thought bubbles — AI inner monologue for spectator/debug display
  // { actorId: "latest thought text" } — persists across turns, updated when new thoughts arrive
  const [commanderThoughts, setCommanderThoughts] = useState(() => gs.aiState?.commanderThoughts || {});
  const [showThoughts, setShowThoughts] = useState(false); // toggled by toolbar; auto-true for allAi
  const [thoughtChannels, setThoughtChannels] = useState([null, null]); // [leftActorId, rightActorId]
  // All-AI simulation mode (allAi computed after actors is defined below)
  const [simMode, setSimMode] = useState("step"); // "step" | "auto"
  const [simStopTurn, setSimStopTurn] = useState("");
  const [simLoop, setSimLoop] = useState(false);
  const [simPaused, setSimPaused] = useState(false);
  const [simTurnLog, setSimTurnLog] = useState([]); // rolling log of turn summaries for spectator view
  // Controls whether AI planning fires in all-AI mode. Step mode: only true after "Next Turn" click.
  // Auto mode: true unless paused or stop condition reached. Mixed (not allAi): always true.
  const simAutoAdvanceRef = useRef(true);
  // Bumped by "Next Turn" / "Resume" to force AI planning useEffect to re-fire (refs alone don't trigger re-render)
  const [simKick, setSimKick] = useState(0);
  const prevTurnRef = useRef(null); // track turn number to detect turn advancement

  // Build effective terrain with modifications (bridges, smoke, obstacles, etc.) applied.
  // Base terrainData stays immutable — this is a lazy overlay for computation.
  const effectiveTerrain = useMemo(
    () => buildEffectiveTerrain(terrainData, gs.terrainMods),
    [terrainData, gs.terrainMods]
  );

  // ── Map view toggles (feature filter + elevation) ──
  const [showElevBands, setShowElevBands] = useState(false);
  const [showFeaturePanel, setShowFeaturePanel] = useState(false);
  const featureCounts = useMemo(() => {
    const counts = {};
    if (terrainData?.cells) {
      for (const k in terrainData.cells) {
        const cell = terrainData.cells[k];
        const feats = cell.features?.length > 0 ? cell.features : cell.attributes?.length > 0 ? cell.attributes : [];
        feats.forEach(f => { counts[f] = (counts[f] || 0) + 1; });
      }
    }
    return counts;
  }, [terrainData]);
  const [activeFeatures, setActiveFeatures] = useState(() => {
    const counts = {};
    if (terrainData?.cells) {
      for (const k in terrainData.cells) {
        const cell = terrainData.cells[k];
        const feats = cell.features?.length > 0 ? cell.features : cell.attributes?.length > 0 ? cell.attributes : [];
        feats.forEach(f => { counts[f] = (counts[f] || 0) + 1; });
      }
    }
    return new Set(DEFAULT_FEATURES.filter(f => counts[f]));
  });

  const toggleFeat = useCallback((f) => {
    setActiveFeatures(prev => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  }, []);
  const toggleAllFeatures = useCallback((on) => {
    if (!on) setActiveFeatures(new Set());
    else setActiveFeatures(new Set(Object.keys(featureCounts)));
  }, [featureCounts]);
  const toggleFeatureGroup = useCallback((group) => {
    const items = (FG[group] || []).filter(f => featureCounts[f]);
    setActiveFeatures(prev => {
      const allOn = items.every(f => prev.has(f));
      const n = new Set(prev);
      items.forEach(f => allOn ? n.delete(f) : n.add(f));
      return n;
    });
  }, [featureCounts]);

  // ── Derived values ──
  const actors = gs.scenario.actors;
  // L1: Guard against empty actor list (shouldn't happen but prevents crash)
  if (actors.length === 0) {
    return <div style={{ padding: space[4], color: colors.text.primary }}>No actors configured. Return to setup.</div>;
  }
  const activeActor = actors[activeActorIndex] || actors[0];
  const actorColor = ACTOR_COLORS[activeActorIndex % ACTOR_COLORS.length];

  const allAi = actors.length > 0 && actors.every(a => isAiActor(a));
  const aiActors = actors.filter(a => isAiActor(a));
  const isPaused = gs.game.status === "paused";
  const isEnded = gs.game.status === "ended";
  const scaleKey = gs.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const maxTurns = gs.game.config?.maxTurns || 20;

  // ── FOW mode for map: what the active actor can see ──
  // All-AI spectator mode: FOW off (spectator sees everything),
  // UNLESS aiFowOverride is set (temporary override during AI screenshot capture)
  const fowMode = useMemo(() => {
    // Temporary override for AI screenshot — show only this actor's view
    if (aiFowOverride && visibilityState) {
      const av = visibilityState.actorVisibility?.[aiFowOverride];
      if (av) return {
        activeActorId: aiFowOverride,
        detectedUnits: av.detectedUnits instanceof Set ? av.detectedUnits : new Set(av.detectedUnits || []),
        contactUnits: av.contactUnits instanceof Set ? av.contactUnits : new Set(av.contactUnits || []),
        visibleCells: av.visibleCells instanceof Set ? av.visibleCells : new Set(av.visibleCells || []),
        lastKnown: av.lastKnown || {},
      };
    }
    if (allAi) return null; // spectator sees everything
    if (!fogOfWar || !visibilityState) return null;
    const av = visibilityState.actorVisibility?.[activeActor.id];
    if (!av) return null;
    return {
      activeActorId: activeActor.id,
      detectedUnits: av.detectedUnits instanceof Set ? av.detectedUnits : new Set(av.detectedUnits || []),
      contactUnits: av.contactUnits instanceof Set ? av.contactUnits : new Set(av.contactUnits || []),
      visibleCells: av.visibleCells instanceof Set ? av.visibleCells : new Set(av.visibleCells || []),
      lastKnown: av.lastKnown || {},
    };
  }, [allAi, fogOfWar, visibilityState, activeActor.id, aiFowOverride]);

  // ── Per-actor adjudication for the active actor during REVIEW ──
  const activeActorAdj = perActorAdjudication[activeActor.id] || null;

  // ── Display adjudication: per-actor during review, master otherwise ──
  const displayAdj = useMemo(() => {
    if (turnPhase === PHASES.REVIEW && activeActorAdj) return activeActorAdj;
    if (masterAdjudication) return masterAdjudication;
    return currentAdjudication;
  }, [turnPhase, activeActorAdj, masterAdjudication, currentAdjudication]);

  // ── Proposed moves from per-actor adjudication for review phase arrows ──
  const proposedMoves = useMemo(() => {
    if (turnPhase !== PHASES.REVIEW || !activeActorAdj) return null;
    const moves = extractProposedMoves(activeActorAdj, gs);
    if (!moves || moves.length === 0) return null;
    // Map actorId → color for MapView's drawProposedMoves
    return moves.map(m => {
      const idx = actors.findIndex(a => a.id === m.actorId);
      return {
        from: m.from,
        to: m.to,
        color: ACTOR_COLORS[idx >= 0 ? idx % ACTOR_COLORS.length : 0],
        unitName: m.unitName,
      };
    });
  }, [turnPhase, activeActorAdj, gs, actors]);

  // ── Map units: filtered by FOW during planning/review ──
  const mapUnits = useMemo(() => {
    // Hide embarked units from map — they're inside a transport
    let units = gs.units.filter(u => !u.embarkedIn);

    // FOW filtering
    if (fogOfWar && fowMode) {
      const own = new Set(units.filter(u => u.actor === activeActor.id).map(u => u.id));
      units = units.filter(u => own.has(u.id) || fowMode.detectedUnits.has(u.id));
    }

    // During REVIEW, show units at proposed destinations so the map
    // reflects the adjudicator's narrative before accept/challenge.
    if (turnPhase === PHASES.REVIEW && activeActorAdj) {
      const moves = extractProposedMoves(activeActorAdj, gs);
      if (moves.length > 0) {
        const posOverrides = new Map(moves.map(m => [m.unitId, m.to]));
        units = units.map(u =>
          posOverrides.has(u.id) ? { ...u, position: posOverrides.get(u.id) } : u
        );
      }
    }

    return units;
  }, [gs.units, fogOfWar, fowMode, activeActor.id, turnPhase, activeActorAdj]);

  // Compute movement path for visualization during targeting mode.
  // Chains through accumulated waypoints so the user sees the full route.
  const movePath = useMemo(() => {
    if (!targetingMode || !selectedUnit || !hoveredCell) return null;
    const orderDef = ORDER_TYPES[targetingMode.orderType];
    if (!orderDef || orderDef.slot !== "movement") return null;
    const unitPos = parseUnitPosition(selectedUnit.position);
    if (!unitPos) return null;
    // Build chain: unitPos → waypoints → hoveredCell
    const chain = [
      { col: unitPos.c, row: unitPos.r },
      ...waypointBuffer.map(wp => ({ col: wp.c, row: wp.r })),
      { col: hoveredCell.c, row: hoveredCell.r },
    ];
    return hexLineThrough(chain);
  }, [targetingMode, selectedUnit, hoveredCell, waypointBuffer]);

  // Air overlay data — AD coverage zones, flight paths, CAS sector highlights
  const airOverlayData = useMemo(() => {
    if (scaleTier < 3) return null;

    // Collect AD units for coverage overlay
    const adUnits = gs.units.filter(u => {
      if (u.status === "destroyed" || u.status === "eliminated") return false;
      const caps = u.specialCapabilities || [];
      return caps.includes("gun_ad") || caps.includes("ir_missile_ad") || caps.includes("radar_missile_ad");
    });

    // Collect flight paths from current air unit orders
    const flightPaths = [];
    const casSectors = [];

    for (const [actorId, actorOrders] of Object.entries(unitOrders)) {
      for (const [unitId, orders] of Object.entries(actorOrders || {})) {
        if (!orders?.actionOrder?.id) continue;
        const unit = gs.units.find(u => u.id === unitId);
        if (!unit || !isAirUnit(unit)) continue;

        const basePosStr = unit.baseHex || unit.position;
        if (!basePosStr) continue;
        const basePos = parseUnitPosition(basePosStr);
        const targetPos = orders.actionOrder.target
          ? parseUnitPosition(orders.actionOrder.target) : null;

        if (basePos && targetPos) {
          // Determine actor color for this flight path
          const actorIdx = actors.findIndex(a => a.id === actorId);
          const actorColor = ACTOR_COLORS[actorIdx % ACTOR_COLORS.length] || "#06B6D4";

          flightPaths.push({
            from: basePos,
            to: targetPos,
            color: `${actorColor}99`,  // semi-transparent actor color
            altitude: orders.actionOrder.altitude || null,
            unitName: unit.name,
          });

          // CAS sector highlight
          if (orders.actionOrder.id === "CAS") {
            casSectors.push({
              center: targetPos,
              color: "rgba(34, 197, 94, 0.10)",
              border: "rgba(34, 197, 94, 0.30)",
            });
          }
        }
      }
    }

    // Only return if we have something to draw
    if (adUnits.length === 0 && flightPaths.length === 0 && casSectors.length === 0) return null;

    return {
      adUnits: adUnits.length > 0 ? adUnits : null,
      flightPaths: flightPaths.length > 0 ? flightPaths : null,
      casSectors: casSectors.length > 0 ? casSectors : null,
    };
  }, [gs.units, unitOrders, scaleTier, actors]);

  // Build VP + CVP overlay data
  const vpOverlayData = useMemo(() => {
    const vc = gs.scenario?.victoryConditions;
    const actors = gs.scenario?.actors || [];
    const hasVP = vc?.hexVP?.length > 0;
    // Collect per-actor CVP hexes: [{ hex, actorId }]
    const cvpHexes = actors.flatMap(a =>
      (a.cvpHexes || []).map(hex => ({ hex, actorId: a.id }))
    );
    const hasCVP = cvpHexes.length > 0;
    if (!hasVP && !hasCVP) return null;
    return {
      hexVP: hasVP ? vc.hexVP : [],
      vpControl: gs.game?.vpControl || null,
      cvpHexes: hasCVP ? cvpHexes : null,
    };
  }, [gs.scenario?.victoryConditions, gs.scenario?.actors, gs.game?.vpControl]);

  // Build confirmed-order overlay data (movement ghosts + hex target rings)
  // Only shown during planning phase so the player sees their order picture
  const orderOverlayData = useMemo(() => {
    if (turnPhase !== PHASES.PLANNING) return null;
    return buildOrderOverlayData(unitOrders, gs.units);
  }, [unitOrders, gs.units, turnPhase]);

  // Fetch available LLM providers on mount (for mid-game model switching)
  useEffect(() => {
    getProviders().then(data => setProviders(data.providers || [])).catch(() => {});
  }, []);

  // Keyboard shortcuts for map view toggles
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setShowElevBands(v => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sync parent
  useEffect(() => {
    if (onUpdateGameState) onUpdateGameState(gs);
  }, [gs, onUpdateGameState]);

  // Restore visibility state from saved game on mount
  useEffect(() => {
    if (gs.visibilityState && !visibilityState) {
      setVisibilityState(deserializeVisibility(gs.visibilityState));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute initial detection when FOW is turned on but no visibility exists yet.
  // L3: Only run during PLANNING to avoid recomputing mid-turn
  useEffect(() => {
    if (turnPhase !== PHASES.PLANNING) return;
    if (fogOfWar && !visibilityState && gs.units.length > 0 && effectiveTerrain) {
      const vis = computeDetection(gs, effectiveTerrain, null, null);
      setVisibilityState(vis);
    }
  }, [fogOfWar, turnPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── AI PLANNING: auto-generate orders for AI-controlled actors ──
  useEffect(() => {
    if (turnPhase !== PHASES.PLANNING) return;
    if (!isAiActor(activeActor)) return;
    if (aiGenerating) return; // prevent re-entry
    // All-AI mode: respect step/pause gate
    if (allAi && !simAutoAdvanceRef.current) return;
    // Skip if orders were already loaded from save (prevents wasted LLM call on load)
    if (unitOrders[activeActor.id] && Object.keys(unitOrders[activeActor.id]).length > 0) return;

    let cancelled = false;
    const abortController = new AbortController();
    aiAbortRef.current = abortController;

    setAiGenerating(true);
    setAiError(null);

    // Compute idle units for this actor
    const aiState = gs.aiState || {};
    const history = aiState.unitOrderHistory || {};
    const currentTurn = gs.game.turn;
    const actorUnits = gs.units.filter(u => u.actor === activeActor.id && u.status !== "destroyed" && u.status !== "eliminated");
    const idleUnits = actorUnits
      .filter(u => currentTurn - (history[u.id] || 0) >= 2 && currentTurn > 1)
      .map(u => ({ ...u, idleTurns: currentTurn - (history[u.id] || 0) }));

    // Build previous turn context from turnLog (rolling 3-5 turn window for AI memory)
    let previousTurnContext = null;
    if (gs.turnLog && gs.turnLog.length > 0) {
      const recentTurns = gs.turnLog.slice(-5);
      const lastLog = recentTurns[recentTurns.length - 1];
      previousTurnContext = {
        // Most recent turn gets full detail
        narrative: lastLog?.actorNarratives?.[activeActor.id] || lastLog?.adjudication?.narrative || null,
        intent: lastLog?.actorIntents?.[activeActor.id] || null,
        // Feed back the AI's own previous inner monologue for continuity
        commanderThoughts: aiState.commanderThoughts?.[activeActor.id] || null,
        // Older turns as compressed history (oldest first)
        history: recentTurns.slice(0, -1).map(entry => ({
          turn: entry.turn,
          intent: entry.actorIntents?.[activeActor.id] || null,
          narrative: entry.actorNarratives?.[activeActor.id] || entry.adjudication?.narrative || null,
        })),
      };
    }

    (async () => {
      try {
        // Capture map screenshot for vision-capable models.
        // In all-AI games the spectator sees god-view, so temporarily apply FOW
        // for this actor so the screenshot only shows what they'd actually see.
        const aiModel = activeActor.aiConfig?.model || gs.game.config.llm.model;
        let mapImageBase64 = null;
        if (isVisionModel(aiModel)) {
          if (allAi && visibilityState) {
            setAiFowOverride(activeActor.id);
            // Wait two frames: one for React to commit the state, one for canvas repaint
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
          mapImageBase64 = captureMapForAI(simMapRef);
          if (allAi) setAiFowOverride(null); // restore spectator view
        }

        // Merge AI config with adjudication config as fallback for empty provider/model
        const adjProvider = gs.game.config.llm.provider;
        const adjModel = gs.game.config.llm.model;
        const effectiveAiConfig = {
          engine: activeActor.aiConfig?.engine || "llm",
          provider: activeActor.aiConfig?.provider || adjProvider,
          model: activeActor.aiConfig?.model || adjModel,
          personality: activeActor.aiConfig?.personality || "",
          profile: activeActor.aiConfig?.profile || "balanced",
          thinkBudget: activeActor.aiConfig?.thinkBudget || "standard",
        };

        const result = await generateAIOrdersClient(
          gs, activeActor.id, effectiveTerrain, effectiveAiConfig,
          { idleUnits, previousTurnContext, visibilityState, fortuneRolls, frictionEvents, abortSignal: abortController.signal, mapImageBase64 }
        );
        if (cancelled) return;

        // Log AI call
        const logEntry = {
          actorId: activeActor.id,
          turn: currentTurn,
          timestamp: new Date().toISOString(),
          prompt: (result.rawPrompt || "").slice(0, 2000),
          response: (result.rawResponse || "").slice(0, 2000),
          fullPromptLength: result.rawPrompt?.length || 0,
          fullResponseLength: result.rawResponse?.length || 0,
          usage: result.usage || null,
          success: !result.error,
          error: result.error || null,
          retryCount: result.retryCount || 0,
        };

        // Update aiState with call log (rolling 5 entries)
        setGs(prev => {
          const prevAiState = prev.aiState || { unitOrderHistory: {}, callLog: [], commanderThoughts: {} };
          const newCallLog = [...prevAiState.callLog, logEntry].slice(-5);
          return { ...prev, aiState: { ...prevAiState, callLog: newCallLog } };
        });

        // Save readable AI transcript to game folder as markdown
        try {
          const gameFolder = gs.game?.folder;
          if (gameFolder) {
            const md = formatAITranscript({
              actorId: activeActor.id,
              actorName: activeActor.name,
              turn: currentTurn,
              timestamp: logEntry.timestamp,
              provider: effectiveAiConfig.provider,
              model: effectiveAiConfig.model,
              personality: effectiveAiConfig.personality,
              usage: result.usage,
              success: !result.error,
              error: result.error,
              retryCount: result.retryCount || 0,
              unitOrders: result.unitOrders,
              actorIntent: result.actorIntent,
              commanderThoughts: result.commanderThoughts,
              actorUnits,
              idleUnits,
              rawPrompt: result.rawPrompt,
              rawResponse: result.rawResponse,
            });
            await fetch("/api/game/save-artifact", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                folder: gameFolder,
                filename: `ai_transcript_t${currentTurn}_${activeActor.id}.md`,
                data: md,
              }),
            }).catch(() => {}); // non-fatal
            if (result.reasoning) {
              await fetch("/api/game/save-artifact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  folder: gameFolder,
                  filename: `ai_reasoning_t${currentTurn}_${activeActor.id}.json`,
                  data: JSON.stringify(result.reasoning, null, 2),
                }),
              }).catch(() => {});
            }
          }
        } catch { /* non-fatal */ }

        if (result.error) {
          setAiError(result.error);
          setAiGenerating(false);
          return;
        }

        // Populate orders and seal
        setUnitOrders(prev => ({ ...prev, [activeActor.id]: result.unitOrders }));
        setActorIntents(prev => ({ ...prev, [activeActor.id]: result.actorIntent }));

        // Store commander thoughts for thought bubble display
        if (result.commanderThoughts) {
          setCommanderThoughts(prev => ({ ...prev, [activeActor.id]: result.commanderThoughts }));
        }

        // Update idle unit tracking + persist commander thoughts
        setGs(prev => {
          const prevAiState = prev.aiState || { unitOrderHistory: {}, callLog: [], commanderThoughts: {} };
          const newHistory = { ...prevAiState.unitOrderHistory };
          for (const uid in result.unitOrders) {
            const o = result.unitOrders[uid];
            if (o.movementOrder || o.actionOrder) {
              newHistory[uid] = currentTurn;
            }
          }
          const newThoughts = { ...(prevAiState.commanderThoughts || {}), [activeActor.id]: result.commanderThoughts || "" };
          return { ...prev, aiState: { ...prevAiState, unitOrderHistory: newHistory, commanderThoughts: newThoughts } };
        });

        // Brief delay so state settles, then seal and advance
        // Use a timeout to ensure React processes the setUnitOrders/setActorIntents above
        setTimeout(() => {
          if (!cancelled) {
            setAiGenerating(false);
            // Trigger seal — sealAndAdvance reads from unitOrders/actorIntents state
            // We need to call it via a ref callback pattern since state updates are async
            aiSealPendingRef.current = true;
          }
        }, 100);
      } catch (e) {
        if (!cancelled) {
          setAiError(e.message || "Unknown error");
          setAiGenerating(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [turnPhase, activeActorIndex, simKick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ref-based seal trigger: after AI populates orders and state settles, call sealAndAdvance
  useEffect(() => {
    if (aiSealPendingRef.current && !aiGenerating && turnPhase === PHASES.PLANNING && isAiActor(activeActor)) {
      aiSealPendingRef.current = false;
      sealAndAdvance();
    }
  }); // intentionally no deps — runs every render to catch the flag

  // ── AI auto-accept during review/challenge/rebuttal phases ──
  useEffect(() => {
    if (!isAiActor(activeActor)) return;
    if (turnPhase === PHASES.REVIEW) {
      const timer = setTimeout(() => handleActorAccept(), 300);
      return () => clearTimeout(timer);
    }
    if (turnPhase === PHASES.CHALLENGE_COLLECT) {
      // AI never challenges — auto-advance
      const timer = setTimeout(() => handleActorAccept(), 300);
      return () => clearTimeout(timer);
    }
    if (turnPhase === PHASES.REBUTTAL_COLLECT) {
      // AI auto-submits empty rebuttal, then use findNextInputActor to skip other AI actors
      const timer = setTimeout(() => {
        setCounterRebuttals(prev => ({ ...prev, [activeActor.id]: "" }));
        handleSubmitCounterRebuttal();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [turnPhase, activeActorIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── MOVEMENT_AND_DETECTION phase: per-hex stepping + detection ──
  // Deferred via setTimeout(0) so the loading spinner can paint before the
  // synchronous simulateMovement computation blocks the main thread.
  useEffect(() => {
    if (turnPhase !== PHASES.MOVEMENT_AND_DETECTION && turnPhase !== PHASES.COMPUTING_DETECTION) return;
    const timerId = setTimeout(() => {
      const previousVis = visibilityState;
      const simResult = simulateMovement(gs, effectiveTerrain, sealedOrders, previousVis);

      setVisibilityState(simResult.finalVisibility);
      setContactEvents(simResult.contactEvents || []);
      setActorMovePaths(simResult.actorMovePaths || null);

      setTurnPhase(PHASES.ADJUDICATING);
    }, 0);
    return () => clearTimeout(timerId);
  }, [turnPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ADJUDICATING phase: call LLM with sealed orders + detection context ──
  useEffect(() => {
    if (turnPhase !== PHASES.ADJUDICATING) return;
    let cancelled = false;
    const abortController = new AbortController();
    adjAbortRef.current = abortController;

    (async () => {
      setAdjudicatingLLM(true);
      setError(null);

      const playerActions = buildPlayerActions(actors, sealedOrders, gs.units);

      // Build structured orders from sealed orders
      const allUnitOrders = {};
      const allActorIntents = {};
      for (const actor of actors) {
        const sealed = sealedOrders[actor.id];
        if (sealed) {
          allUnitOrders[actor.id] = sealed.unitOrders || {};
          allActorIntents[actor.id] = sealed.actorIntent || "";
        }
      }
      const structuredOrders = { unitOrders: allUnitOrders, actorIntents: allActorIntents };

      // Build detection context for prompt injection.
      // Now includes visibleCells (accumulated across movement) and movePaths
      // so the LLM terrain builder can send appropriate detail for each cell.
      const detectionContext = visibilityState ? {
        actorVisibility: Object.fromEntries(
          Object.entries(visibilityState.actorVisibility || {}).map(([actorId, av]) => [
            actorId, {
              visibleCells: [...(av.visibleCells instanceof Set ? av.visibleCells : new Set(av.visibleCells || []))],
              detectedUnits: [...(av.detectedUnits instanceof Set ? av.detectedUnits : new Set(av.detectedUnits || []))],
              contactUnits: [...(av.contactUnits instanceof Set ? av.contactUnits : new Set(av.contactUnits || []))],
              detectionDetails: av.detectionDetails || {},
              lastKnown: av.lastKnown || {},
              movePaths: actorMovePaths?.[actorId] ? [...actorMovePaths[actorId]] : [],
            },
          ])
        ),
        contactEvents: contactEvents || [],
      } : null;

      setAdjSubStatus(null);
      const result = await adjudicate(gs, playerActions, effectiveTerrain, loggerRef.current, structuredOrders, detectionContext, abortController.signal, (status) => setAdjSubStatus(status));

      if (cancelled) return;

      if (result.fortuneRolls) setFortuneRolls(result.fortuneRolls);
      if (result.frictionEvents) setFrictionEvents(result.frictionEvents);

      if (result.error && !result.adjudication) {
        setError(result.error);
        setAdjudicatingLLM(false);
        setAdjSubStatus(null);
        setTurnPhase(PHASES.PLANNING);
        setActiveActorIndex(0);
        return;
      }

      // Store master adjudication (full truth — never shown to players directly)
      setMasterAdjudication(result.adjudication);
      setCurrentAdjudication(result.adjudication);
      setPendingResult(result);

      // FOW narrative audit: send each actor's narrative to a fast model
      // to check for leaks about undetected enemy units
      if (fogOfWar && visibilityState && result.adjudication?.adjudication?.actor_perspectives) {
        setAdjPhaseLabel("Verifying narrative...");
        const auditResults = await auditAllNarratives(
          result.adjudication, visibilityState, gs, gs.game.config.llm, abortController.signal
        );
        if (auditResults.length > 0 && loggerRef.current) {
          loggerRef.current.log(gs.game.turn, "narrative_audit", auditResults);
        }
        setAdjPhaseLabel(null);
      }

      // Build per-actor filtered views
      const perActor = {};
      for (const actor of actors) {
        perActor[actor.id] = filterAdjudicationForActor(result.adjudication, actor.id, visibilityState, gs);
      }
      setPerActorAdjudication(perActor);

      setAdjudicatingLLM(false);
      setAdjSubStatus(null);
      setChallengeCount(0);
      setActorDecisions({});
      setChallenges({});
      setCounterRebuttals({});

      if (result.error) setError(result.error);

      // Transition to REVIEW with first actor
      setActiveActorIndex(0);
      // Show handoff screen before first actor reviews (skip in all-AI — no human to hand off to)
      if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF && !allAi) {
        setHandoffResumePhase(PHASES.REVIEW);
        setTurnPhase(PHASES.HANDOFF);
      } else {
        setTurnPhase(PHASES.REVIEW);
      }

      setTimeout(() => {
        adjDisplayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      adjAbortRef.current = null;
    };
  }, [turnPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Structured order handlers ──
  const handleUnitClick = useCallback((unit) => {
    setSelectedUnitId(unit.id);
  }, []);

  const handleOrderConfirm = useCallback((orders) => {
    if (!selectedUnit) return;
    setUnitOrders(prev => ({
      ...prev,
      [selectedUnit.actor]: {
        ...(prev[selectedUnit.actor] || {}),
        [selectedUnit.id]: orders,
      },
    }));
    setSelectedUnitId(null);
    setTargetingMode(null);
  }, [selectedUnit]);

  // Persist the card's full order pair to parent on every click so applyTarget
  // always has both slots when it merges a target into currentOrders.
  // Without this, selecting MOVE then ATTACK loses MOVE when ATTACK's target
  // is applied — because applyTarget only knew about what was already saved.
  const handleOrderPreview = useCallback((orders) => {
    if (!selectedUnit) return;
    setUnitOrders(prev => ({
      ...prev,
      [selectedUnit.actor]: {
        ...(prev[selectedUnit.actor] || {}),
        [selectedUnit.id]: orders,
      },
    }));
  }, [selectedUnit]);

  // ── Embark: instant planning-phase action (not adjudicated) ──
  const handleEmbark = useCallback((unitId, transportId) => {
    const unit = gs.units.find(u => u.id === unitId);
    const transport = gs.units.find(u => u.id === transportId);
    if (!unit || !transport) return;
    const check = canEmbark(unit, transport);
    if (!check.allowed) return;

    setGs(prev => ({
      ...prev,
      units: prev.units.map(u => {
        if (u.id === unitId) return { ...u, embarkedIn: transportId };
        if (u.id === transportId) return { ...u, cargo: [...(u.cargo || []), unitId] };
        return u;
      }),
    }));
    // Clear any orders the embarking unit had — they're now cargo
    setUnitOrders(prev => {
      const actorOrders = { ...(prev[unit.actor] || {}) };
      delete actorOrders[unitId];
      return { ...prev, [unit.actor]: actorOrders };
    });
    setSelectedUnitId(null);
  }, [gs.units]);

  const handleStartTargeting = useCallback((orderType) => {
    if (!selectedUnit) return;
    setWaypointBuffer([]);
    setTargetingMode({ orderType, unitId: selectedUnit.id });
  }, [selectedUnit]);

  const handleCancelTargeting = useCallback(() => {
    setTargetingMode(null);
    setWaypointBuffer([]);
  }, []);

  // Click a hex on the map outside targeting mode — open unit card if a unit is there
  const handleMapCellClick = useCallback((cell) => {
    if (turnPhase !== PHASES.PLANNING) return;
    // Reinforcement placement mode — set the position
    if (placingReinforcement) {
      setReinforcementPosition(`${cell.c},${cell.r}`);
      setPlacingReinforcement(false);
      return;
    }
    const unit = gs.units.find(u => {
      if (u.status === "destroyed" || u.status === "eliminated") return false;
      if (fogOfWar && u.actor !== activeActor.id) return false; // can't click hidden enemies
      const pos = parseUnitPosition(u.position);
      return pos && pos.c === cell.c && pos.r === cell.r;
    });
    if (unit) setSelectedUnitId(unit.id);
  }, [gs.units, turnPhase, fogOfWar, activeActor.id, placingReinforcement]);

  // Helper: actually store the target in unit orders
  const applyTarget = useCallback((unit, orderType, targetStr, outOfRange = false, waypoints = null) => {
    const orderDef = ORDER_TYPES[orderType];
    if (!orderDef) return;

    setUnitOrders(prev => {
      const actorOrders = prev[unit.actor] || {};
      const currentOrders = actorOrders[unit.id] || {};
      const isMovement = orderDef.slot === "movement";
      const updated = { ...currentOrders };

      if (isMovement) {
        updated.movementOrder = { id: orderType, target: targetStr };
        // Attach waypoints if any were accumulated during multi-click targeting
        if (waypoints?.length > 0) {
          updated.movementOrder.waypoints = waypoints;
        }
      } else {
        updated.actionOrder = {
          id: orderType, target: targetStr, subtype: currentOrders.actionOrder?.subtype,
          ...(outOfRange && { _outOfRange: true }),
        };
      }

      return {
        ...prev,
        [unit.actor]: { ...actorOrders, [unit.id]: updated },
      };
    });
  }, []);

  // Map click during targeting mode — set the target on the current order

  const handleTargetSelect = useCallback((cell, mouseEvent) => {
    if (!targetingMode || !selectedUnit) return;
    const targetStr = `${cell.c},${cell.r}`;
    const orderDef = ORDER_TYPES[targetingMode.orderType];
    if (!orderDef) return;

    // ── Movement orders: Shift+click = add waypoint, plain click = set destination ──
    if (orderDef.slot === "movement") {
      if (mouseEvent?.shiftKey) {
        // Shift+click: add waypoint, stay in targeting mode
        setWaypointBuffer(prev => [...prev, { c: cell.c, r: cell.r }]);
        return;
      }
      // Plain click: finalize destination
      const wpStrings = waypointBuffer.map(wp => `${wp.c},${wp.r}`);
      applyTarget(selectedUnit, targetingMode.orderType, targetStr, false, wpStrings);
      setTargetingMode(null);
      setWaypointBuffer([]);
      return;
    }

    // ── Non-movement (action) orders: single-click = done ──

    // M11: Range check for combat orders
    if (orderDef.slot === "action" && COMBAT_ORDER_IDS.has(targetingMode.orderType)) {
      // Effective position = where the unit will be after any ordered movement
      const currentOrders = (unitOrders[selectedUnit.actor] || {})[selectedUnit.id] || {};
      const effectivePos = currentOrders.movementOrder?.target || selectedUnit.position;
      const range = computeRange(effectivePos, targetStr, selectedUnit, terrainData?.cellSizeKm || 1);

      if (range.band === "OUT_OF_RANGE") {
        // Show warning dialog, don't store order yet
        setRangeWarning({
          unit: selectedUnit,
          orderType: targetingMode.orderType,
          targetStr,
          range,
          effectivePos,
        });
        return; // stay in targeting mode until user confirms or cancels
      }
    }

    applyTarget(selectedUnit, targetingMode.orderType, targetStr);
    setTargetingMode(null);
  }, [targetingMode, selectedUnit, unitOrders, terrainData, applyTarget, waypointBuffer]);

  const handleActorIntentChange = useCallback((actorId, text) => {
    setActorIntents(prev => ({ ...prev, [actorId]: text }));
  }, []);

  // ── Validate orders for the active actor before sealing ──
  const validateActiveActorOrders = useCallback(() => {
    const warnings = [];
    const actorOrders = unitOrders[activeActor.id] || {};
    const actorUnits = gs.units.filter(u => u.actor === activeActor.id);
    for (const unit of actorUnits) {
      const orders = actorOrders[unit.id];
      if (!orders?.movementOrder?.target) continue;
      const moveId = orders.movementOrder.id;
      if (moveId !== "MOVE" && moveId !== "WITHDRAW") continue;

      const result = computeMovePath(
        unit.position,
        orders.movementOrder.target,
        effectiveTerrain,
        unit.movementType || "foot",
        orders.movementOrder.waypoints
      );
      if (!result || result.feasibility === "FEASIBLE" || result.feasibility === "MARGINAL") continue;

      warnings.push({
        unitName: unit.name,
        actor: activeActor.name || activeActor.id,
        from: positionToLabel(unit.position),
        to: positionToLabel(orders.movementOrder.target),
        distanceHexes: result.distanceHexes,
        budget: result.budget ?? 3,
        totalCost: result.totalCost,
        feasibility: result.feasibility,
        movementType: unit.movementType || "foot",
      });
    }
    return warnings;
  }, [gs, unitOrders, terrainData, activeActor]);

  // ── Seal active actor's orders and advance to next actor or detection ──
  const sealAndAdvance = useCallback(() => {
    // Seal this actor's orders
    const sealed = {
      unitOrders: unitOrders[activeActor.id] || {},
      actorIntent: actorIntents[activeActor.id] || "",
    };
    const newSealed = { ...sealedOrders, [activeActor.id]: sealed };
    setSealedOrders(newSealed);

    // Clear working order state for privacy (next actor can't see them)
    setUnitOrders(prev => {
      const copy = { ...prev };
      delete copy[activeActor.id];
      return copy;
    });
    setActorIntents(prev => {
      const copy = { ...prev };
      delete copy[activeActor.id];
      return copy;
    });
    setSelectedUnitId(null);
    setTargetingMode(null);

    // Determine next phase
    const context = { activeActorIndex, actorCount: actors.length, sealedOrders: newSealed, actorDecisions };
    const next = getNextPhase(PHASES.PLANNING, context);

    if (next.nextActorIndex !== null) {
      // More actors to collect orders from
      setActiveActorIndex(next.nextActorIndex);
      const nextActor = actors[next.nextActorIndex];
      // Skip handoff screen for AI actors — they don't need a "ready" screen
      if (fogOfWar && !isAiActor(nextActor)) {
        setHandoffResumePhase(PHASES.PLANNING);
        setTurnPhase(PHASES.HANDOFF);
      } else {
        setTurnPhase(PHASES.PLANNING);
      }
    } else {
      // All actors sealed — move to detection/adjudication
      if (fogOfWar) {
        setTurnPhase(PHASES.COMPUTING_DETECTION);
      } else {
        setTurnPhase(PHASES.ADJUDICATING);
      }
    }
  }, [unitOrders, actorIntents, activeActor, sealedOrders, activeActorIndex, actors, actorDecisions, fogOfWar]);

  // L2: Guard against double-click on seal orders
  const sealingRef = useRef(false);

  // ── Submit orders: validate → seal ──
  const handleSealOrders = useCallback(() => {
    if (sealingRef.current) return;
    sealingRef.current = true;
    const warnings = validateActiveActorOrders();
    if (warnings.length > 0) {
      setOrderWarnings(warnings);
      sealingRef.current = false;
      return;
    }
    sealAndAdvance();
    // Brief debounce: prevent double-seal from rapid clicks while React state settles
    const SEAL_DEBOUNCE_MS = 300;
    setTimeout(() => { sealingRef.current = false; }, SEAL_DEBOUNCE_MS);
  }, [validateActiveActorOrders, sealAndAdvance]);

  // ── Force submit — user saw warnings and chose to proceed anyway ──
  const handleForceSubmit = useCallback(() => {
    setOrderWarnings(null);
    sealAndAdvance();
  }, [sealAndAdvance]);

  // ── Review phase: active actor accepts ──
  const handleActorAccept = useCallback(() => {
    const newDecisions = { ...actorDecisions, [activeActor.id]: "accept" };
    setActorDecisions(newDecisions);

    // Check if all actors have reviewed
    const nextIdx = activeActorIndex + 1;
    if (nextIdx >= actors.length) {
      // All actors reviewed — check for challenges
      const anyChallenged = Object.values(newDecisions).some(d => d === "challenge");
      if (anyChallenged) {
        // Go to challenge collection
        const firstChallenger = findNextInputActor(PHASES.CHALLENGE_COLLECT, 0, actors, newDecisions);
        if (firstChallenger >= 0) {
          setActiveActorIndex(firstChallenger);
          if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF) {
            setHandoffResumePhase(PHASES.CHALLENGE_COLLECT);
            setTurnPhase(PHASES.HANDOFF);
          } else {
            setTurnPhase(PHASES.CHALLENGE_COLLECT);
          }
        } else {
          // No one actually needs to input? Apply.
          setTurnPhase(PHASES.RESOLVING);
        }
      } else {
        // All accepted — apply
        setTurnPhase(PHASES.RESOLVING);
      }
    } else {
      // More actors to review
      setActiveActorIndex(nextIdx);
      if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF && !isAiActor(actors[nextIdx])) {
        setHandoffResumePhase(PHASES.REVIEW);
        setTurnPhase(PHASES.HANDOFF);
      } else {
        // L5: Non-FOW multi-actor review: no handoff screen needed, just advance activeActorIndex.
        // The UI re-renders with the next actor's perspective automatically.
      }
    }
  }, [actorDecisions, activeActor, activeActorIndex, actors, fogOfWar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Review phase: active actor challenges ──
  const handleActorChallenge = useCallback(() => {
    const newDecisions = { ...actorDecisions, [activeActor.id]: "challenge" };
    setActorDecisions(newDecisions);

    // Continue review for remaining actors
    const nextIdx = activeActorIndex + 1;
    if (nextIdx >= actors.length) {
      // All reviewed — go to challenge collection
      const firstChallenger = findNextInputActor(PHASES.CHALLENGE_COLLECT, 0, actors, newDecisions);
      if (firstChallenger >= 0) {
        setActiveActorIndex(firstChallenger);
        if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF) {
          setHandoffResumePhase(PHASES.CHALLENGE_COLLECT);
          setTurnPhase(PHASES.HANDOFF);
        } else {
          setTurnPhase(PHASES.CHALLENGE_COLLECT);
        }
      } else {
        // M3: No challengers found despite someone marking "challenge" — advance to resolve
        setTurnPhase(PHASES.RESOLVING);
      }
    } else {
      setActiveActorIndex(nextIdx);
      if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF && !isAiActor(actors[nextIdx])) {
        setHandoffResumePhase(PHASES.REVIEW);
        setTurnPhase(PHASES.HANDOFF);
      }
    }
  }, [actorDecisions, activeActor, activeActorIndex, actors, fogOfWar]);

  // ── Apply master adjudication to game state ──
  const applyMasterAdjudication = useCallback(() => {
    if (!masterAdjudication) return;

    const playerActions = buildPlayerActions(actors, sealedOrders, gs.units);

    let newGs = applyStateUpdates(gs, masterAdjudication, playerActions);

    // Store actorIntents in turnLog entry so AI has multi-turn memory of its strategy
    const lastTurnEntry = newGs.turnLog[newGs.turnLog.length - 1];
    if (lastTurnEntry) {
      lastTurnEntry.actorIntents = { ...actorIntents };
    }

    // Save visibility state into game state for persistence
    if (visibilityState) {
      newGs = { ...newGs, visibilityState: serializeVisibility(visibilityState) };
    }

    if (pendingResult?.promptLog) {
      const trimmedLog = newGs.promptLog.map(({ rawResponse, ...rest }) => rest);
      newGs = { ...newGs, promptLog: [...trimmedLog, pendingResult.promptLog] };
    }

    // Persist adjudicator accuracy score for feedback loop next turn
    if (pendingResult?.adjudicatorScore) {
      const prev = newGs.game.adjudicatorScore;
      const prevCumulative = prev?.cumulative || { corrections: 0, turns: 0, totalAccuracy: 0 };
      const last = pendingResult.adjudicatorScore.lastTurn;
      newGs = {
        ...newGs,
        game: {
          ...newGs.game,
          adjudicatorScore: {
            lastTurn: last,
            cumulative: {
              corrections: prevCumulative.corrections + last.positionCorrections + last.rangeViolations,
              turns: prevCumulative.turns + 1,
              avgAccuracy: Math.round(
                (prevCumulative.totalAccuracy + last.accuracy) / (prevCumulative.turns + 1)
              ),
              totalAccuracy: prevCumulative.totalAccuracy + last.accuracy
            }
          }
        }
      };
    }

    // Track forgotten units across turns for escalating LLM reminders.
    // Reset to null when the LLM covers all units; increment on failure.
    if (pendingResult?.forgottenUnits) {
      newGs = {
        ...newGs,
        game: { ...newGs.game, forgottenUnits: pendingResult.forgottenUnits }
      };
    } else {
      // LLM covered all units — clear the streak
      const { forgottenUnits: _discard, ...cleanGame } = newGs.game;
      newGs = { ...newGs, game: cleanGame };
    }

    // Advance turn
    newGs = advanceTurn(newGs);

    setGs(newGs);
    setTurnPhase(PHASES.PLANNING);
    setActiveActorIndex(0);
    setMasterAdjudication(null);
    setPerActorAdjudication({});
    setCurrentAdjudication(null);
    setPendingResult(null);
    setSealedOrders({});
    setActorDecisions({});
    setChallenges({});
    setCounterRebuttals({});
    setChallengeCount(0);
    setFortuneRolls(null);
    setFrictionEvents(null);
    setUnitOrders({});
    setActorIntents({});
    setSelectedUnitId(null);
    setTargetingMode(null);
    setError(null);
    setModeratorNote("");
    setActiveTab("narrative");

    loggerRef.current.flush(newGs.game.id, newGs.game.folder).catch(() => {});
    // Autosave at turn boundary — rolling window of last 5 turns
    autosave(newGs).catch(() => {});
  }, [gs, masterAdjudication, sealedOrders, actors, visibilityState, pendingResult]);

  // ── RESOLVING phase: apply adjudication + advance turn ──
  // M18: try/catch so a crash during state application doesn't freeze the UI
  // NOTE: must be defined after applyMasterAdjudication useCallback to avoid TDZ
  useEffect(() => {
    if (turnPhase !== PHASES.RESOLVING) return;
    try {
      applyMasterAdjudication();
    } catch (e) {
      console.error("[SimGame] Error applying adjudication:", e);
      setError(`Failed to apply adjudication: ${e.message}`);
      setTurnPhase(PHASES.REVIEW);
      setActiveActorIndex(0);
    }
  }, [turnPhase, applyMasterAdjudication]);

  // ── Commander thought bubbles: initialize channels and auto-show for all-AI ──
  useEffect(() => {
    if (aiActors.length === 0) return;
    // Initialize thought channels to first two AI actors
    setThoughtChannels(prev => {
      if (prev[0] !== null) return prev; // already initialized
      return [aiActors[0]?.id || null, aiActors[1]?.id || null];
    });
    // Auto-show for all-AI games
    if (allAi) setShowThoughts(true);
  }, [allAi, aiActors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── All-AI simulation control: manage auto-advance after turn resolution ──
  useEffect(() => {
    if (!allAi) return;
    const currentTurn = gs.game.turn;
    const prevTurn = prevTurnRef.current;
    prevTurnRef.current = currentTurn;

    // Only act on turn advancement (prevTurn null = initial mount, skip)
    if (prevTurn === null || currentTurn <= prevTurn) return;

    // Add turn summary to log (from the turn that just completed)
    const lastLog = gs.turnLog?.[gs.turnLog.length - 1];
    if (lastLog) {
      const summary = lastLog.narrative
        ? lastLog.narrative.slice(0, 120) + (lastLog.narrative.length > 120 ? "..." : "")
        : "Turn resolved.";
      setSimTurnLog(prev => [...prev.slice(-49), { turn: currentTurn - 1, summary }]); // keep last 50
    }

    // Check stop conditions
    const stopTurn = simStopTurn ? parseInt(simStopTurn, 10) : 0;
    if (stopTurn > 0 && currentTurn > stopTurn) {
      if (simLoop) {
        // Loop: would need to reset game state — for now just pause (full reset is Phase 3+)
        simAutoAdvanceRef.current = false;
        setSimPaused(true);
        return;
      }
      // Stop: switch to step mode and pause
      simAutoAdvanceRef.current = false;
      setSimMode("step");
      return;
    }

    // Check game ended
    if (gs.game.status === "ended") {
      simAutoAdvanceRef.current = false;
      return;
    }

    // Set auto-advance based on mode
    if (simMode === "auto" && !simPaused) {
      simAutoAdvanceRef.current = true;
    } else {
      // Step mode: block until "Next Turn" clicked
      simAutoAdvanceRef.current = false;
    }
  }, [gs.game.turn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-adjudicate with challenges + counter-rebuttals ──
  const handleCancelAdjudication = useCallback(() => {
    if (adjAbortRef.current) {
      adjAbortRef.current.abort();
      adjAbortRef.current = null;
    }
    setAdjudicatingLLM(false);
    setAdjSubStatus(null);
    setError("Adjudication cancelled");

    if (turnPhase === PHASES.RE_ADJUDICATING) {
      // Cancel re-adjudication → return to review with original adjudication intact
      setTurnPhase(PHASES.REVIEW);
      setActiveActorIndex(0);
    } else {
      // H5: Cancel initial adjudication → restore orders from sealed state, then back to planning
      // Without this, the user's orders are lost because sealAndAdvance clears them for privacy
      const restoredOrders = {};
      const restoredIntents = {};
      for (const [actorId, sealed] of Object.entries(sealedOrders)) {
        restoredOrders[actorId] = sealed.unitOrders || {};
        restoredIntents[actorId] = sealed.actorIntent || "";
      }
      setUnitOrders(restoredOrders);
      setActorIntents(restoredIntents);
      setSealedOrders({});
      setTurnPhase(PHASES.PLANNING);
      setActiveActorIndex(0);
    }
  }, [turnPhase, sealedOrders]);

  const triggerReAdjudication = useCallback(async () => {
    setTurnPhase(PHASES.RE_ADJUDICATING);
    setAdjudicatingLLM(true);
    setError(null);
    const abortController = new AbortController();
    adjAbortRef.current = abortController;

    try {
      const playerActions = buildPlayerActions(actors, sealedOrders, gs.units);

      // M6: Pass structuredOrders and detectionContext so the rebuttal LLM sees the same pre-computed data
      const structuredOrdersForRebuttal = {
        unitOrders: Object.fromEntries(
          Object.entries(sealedOrders).map(([actorId, sealed]) => [actorId, sealed.unitOrders || {}])
        ),
        actorIntents: Object.fromEntries(
          Object.entries(sealedOrders).map(([actorId, sealed]) => [actorId, sealed.actorIntent || ""])
        ),
      };
      const detectionContextForRebuttal = visibilityState ? { actorVisibility: visibilityState.actorVisibility } : null;

      setAdjSubStatus(null);
      const result = await adjudicateRebuttal(
        gs, playerActions, effectiveTerrain, pendingResult, challenges, loggerRef.current, counterRebuttals, abortController.signal,
        structuredOrdersForRebuttal, detectionContextForRebuttal, (status) => setAdjSubStatus(status)
      );

      if (abortController.signal.aborted) return;

      if (result.error && !result.adjudication) {
        setError(result.error);
        // Fall back to review
        setActiveActorIndex(0);
        setTurnPhase(PHASES.REVIEW);
        return;
      }

      // Update adjudication
      setMasterAdjudication(result.adjudication);
      setCurrentAdjudication(result.adjudication);
      if (result.promptLog && pendingResult) {
        setPendingResult({ ...pendingResult, promptLog: result.promptLog, adjudication: result.adjudication });
      }

      // FOW narrative audit for re-adjudication
      if (fogOfWar && visibilityState && result.adjudication?.adjudication?.actor_perspectives) {
        setAdjPhaseLabel("Verifying narrative...");
        const auditResults = await auditAllNarratives(
          result.adjudication, visibilityState, gs, gs.game.config.llm, abortController.signal
        );
        if (abortController.signal.aborted) return;
        if (auditResults.length > 0 && loggerRef.current) {
          loggerRef.current.log(gs.game.turn, "narrative_audit_rebuttal", auditResults);
        }
        setAdjPhaseLabel(null);
      }

      // Rebuild per-actor views
      const perActor = {};
      for (const actor of actors) {
        perActor[actor.id] = filterAdjudicationForActor(result.adjudication, actor.id, visibilityState, gs);
      }
      setPerActorAdjudication(perActor);

      setChallengeCount(c => c + 1);
      setActorDecisions({});

      if (result.error) setError(result.error);

      // Store ruling so it shows as popup at the start of the next turn
      setPendingRuling(result.adjudication);

      // LLM ruling after challenges is final — apply and advance
      setTurnPhase(PHASES.RESOLVING);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[SimGame] triggerReAdjudication failed:", err);
      setError(err.message || "Re-adjudication failed");
      setActiveActorIndex(0);
      setTurnPhase(PHASES.REVIEW);
    } finally {
      adjAbortRef.current = null;
      setAdjudicatingLLM(false);
      setAdjPhaseLabel(null);
      setAdjSubStatus(null);
    }
  }, [gs, actors, sealedOrders, terrainData, pendingResult, challenges, counterRebuttals, visibilityState, fogOfWar]);

  // ── Challenge text collection ──
  // NOTE: defined after triggerReAdjudication to avoid TDZ
  const handleSubmitChallenge = useCallback(() => {
    const text = challenges[activeActor.id] || "";
    if (!text.trim()) {
      setError("Enter your challenge text before submitting.");
      return;
    }
    setError(null);

    // Find next challenger
    const nextChallenger = findNextInputActor(PHASES.CHALLENGE_COLLECT, activeActorIndex + 1, actors, actorDecisions);
    if (nextChallenger >= 0) {
      setActiveActorIndex(nextChallenger);
      if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF) {
        setHandoffResumePhase(PHASES.CHALLENGE_COLLECT);
        setTurnPhase(PHASES.HANDOFF);
      }
    } else {
      // All challenges collected — go to counter-rebuttal collection
      const firstRebutter = findNextInputActor(PHASES.REBUTTAL_COLLECT, 0, actors, actorDecisions);
      if (firstRebutter >= 0) {
        setActiveActorIndex(firstRebutter);
        if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF) {
          setHandoffResumePhase(PHASES.REBUTTAL_COLLECT);
          setTurnPhase(PHASES.HANDOFF);
        } else {
          setTurnPhase(PHASES.REBUTTAL_COLLECT);
        }
      } else {
        // No rebuttals needed — trigger re-adjudication
        triggerReAdjudication();
      }
    }
  }, [challenges, activeActor, activeActorIndex, actors, actorDecisions, fogOfWar, triggerReAdjudication]);

  // ── Counter-rebuttal collection ──
  // NOTE: defined after triggerReAdjudication to avoid TDZ
  const handleSubmitCounterRebuttal = useCallback(() => {
    setError(null);
    const nextRebutter = findNextInputActor(PHASES.REBUTTAL_COLLECT, activeActorIndex + 1, actors, actorDecisions);
    if (nextRebutter >= 0) {
      setActiveActorIndex(nextRebutter);
      if (actors.length > 1 && fogOfWar && !SKIP_HANDOFF) {
        setHandoffResumePhase(PHASES.REBUTTAL_COLLECT);
        setTurnPhase(PHASES.HANDOFF);
      }
    } else {
      // All rebuttals collected — re-adjudicate
      triggerReAdjudication();
    }
  }, [activeActorIndex, actors, actorDecisions, fogOfWar, triggerReAdjudication]);

  // ── Handoff: advance to the resumed phase ──
  const handleHandoffReady = useCallback(() => {
    if (handoffResumePhase) {
      setTurnPhase(handoffResumePhase);
      setHandoffResumePhase(null);
    }
  }, [handoffResumePhase]);

  // ── Start over: discard adjudication, go back to planning ──
  const handleStartOver = useCallback(() => {
    setCurrentAdjudication(null);
    setMasterAdjudication(null);
    setPerActorAdjudication({});
    setPendingResult(null);
    setSealedOrders({});
    setActorDecisions({});
    setChallenges({});
    setCounterRebuttals({});
    setFortuneRolls(null);
    setFrictionEvents(null);
    setChallengeCount(0);
    setActiveActorIndex(0);
    setTurnPhase(PHASES.PLANNING);
    setActiveTab("narrative");
    // M2/L4: Reset state that was previously leaked across start-overs
    setContactEvents([]);
    setActorMovePaths(null);
    setVisibilityState(null);
    setError(null);
    setPendingRuling(null);
  }, []);

  // ── Pause / Resume / End ──
  const handlePause = useCallback(() => {
    const newGs = pauseGame(gs);
    setGs(newGs);
    loggerRef.current.log(gs.game.turn, "moderator_action", { type: "pause" });
    saveGameState(newGs).catch(() => {});
  }, [gs]);

  const handleResume = useCallback(() => {
    const newGs = resumeGame(gs);
    setGs(newGs);
    loggerRef.current.log(gs.game.turn, "moderator_action", { type: "resume", note: moderatorNote });
    saveGameState(newGs).catch(() => {});
  }, [gs, moderatorNote]);

  const handleEnd = useCallback(() => {
    if (!confirm("End the simulation?")) return;
    const newGs = endGame(gs);
    setGs(newGs);
    loggerRef.current.log(gs.game.turn, "moderator_action", { type: "end" });
    loggerRef.current.flush(newGs.game.id, newGs.game.folder).catch(() => {});
    saveGameState(newGs).catch(() => {});
  }, [gs]);

  const handleExportLog = useCallback(() => {
    loggerRef.current.exportLog(gs.game.name || gs.game.id);
  }, [gs]);

  const handleExportBriefing = useCallback((actorId) => {
    const md = actorId
      ? buildActorBriefing(gs, actorId, effectiveTerrain, { fortuneRolls, frictionEvents, visibilityState })
      : buildFullBriefing(gs, effectiveTerrain, { fortuneRolls, frictionEvents });
    const actorName = actorId
      ? (gs.scenario.actors.find(a => a.id === actorId)?.name || actorId).replace(/\s+/g, "_")
      : "full";
    downloadFile(md, `briefing_${actorName}_turn${gs.game.turn}.md`);
  }, [gs, terrainData, fortuneRolls, frictionEvents, visibilityState]);

  // ── Reinforcement handlers ──

  const handleAddReinforcementUnit = useCallback((unit) => {
    // Add unit immediately to the game state
    setGs(prev => ({ ...prev, units: [...prev.units, unit] }));
    setReinforcementPosition(null);
  }, []);

  const handleScheduleReinforcementUnit = useCallback((entry) => {
    // Add to reinforcement queue for future arrival
    setGs(prev => ({
      ...prev,
      reinforcementQueue: [...(prev.reinforcementQueue || []), entry],
    }));
    setReinforcementPosition(null);
  }, []);

  const handleAddActor = useCallback((actor, diplomacyPairs) => {
    setGs(prev => {
      const newActors = [...prev.scenario.actors, actor];
      const scaleTier = SCALE_TIERS[prev.game?.scale]?.tier || 3;

      // Initialize diplomacy for new actor (tier 4+)
      let newDiplomacy = { ...(prev.diplomacy || {}) };
      if (scaleTier >= 4 && diplomacyPairs) {
        for (const [existingId, status] of Object.entries(diplomacyPairs)) {
          const key = [existingId, actor.id].sort().join("||");
          newDiplomacy[key] = { status, channels: ["none"], agreements: [] };
        }
      }

      // Initialize supply network for new actor (tier 3+)
      let newSupply = { ...(prev.supplyNetwork || {}) };
      if (scaleTier >= 3) {
        newSupply[actor.id] = { depots: [], resupplyRate: 50 };
      }

      return {
        ...prev,
        scenario: { ...prev.scenario, actors: newActors },
        diplomacy: newDiplomacy,
        supplyNetwork: newSupply,
      };
    });
  }, []);

  const handleRemoveQueuedReinforcement = useCallback((reinfId) => {
    setGs(prev => ({
      ...prev,
      reinforcementQueue: (prev.reinforcementQueue || []).filter(r => r.id !== reinfId),
    }));
  }, []);

  const handleExportMap = useCallback(() => {
    const dataURL = simMapRef.current?.exportImage?.();
    if (dataURL) {
      downloadDataURL(dataURL, `map_turn${gs.game.turn}.png`);
    } else {
      setError("Map export failed — could not capture image.");
    }
  }, [gs.game.turn]);

  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved" | "error"
  const handleSave = useCallback(() => {
    setSaveStatus("saving");
    // Bundle planning-phase state so confirmed orders survive save/reload
    const toSave = {
      ...gs,
      pendingOrders: { unitOrders, actorIntents, sealedOrders, activeActorIndex },
    };
    saveGameState(toSave).then(r => {
      if (!mountedRef.current) return;
      if (r.ok) {
        setSaveStatus("saved");
        setError(null);
        setTimeout(() => { if (mountedRef.current) setSaveStatus(null); }, 2000);
      } else {
        setSaveStatus("error");
      }
    }).catch(e => {
      if (!mountedRef.current) return;
      setSaveStatus("error");
      setError("Save failed: " + e.message);
    });
  }, [gs, unitOrders, actorIntents, sealedOrders, activeActorIndex]);

  // ── Render ──

  const adj = displayAdj?.adjudication || displayAdj;
  const deEsc = adj?.de_escalation_assessment;
  const hasAdjudication = !!adj;
  const actorViewExtras = displayAdj?._actor_view || adj?._actor_view || null;

  const feasibilityColor = (f) => f === "high" ? colors.accent.green : f === "infeasible" ? colors.accent.red : colors.accent.amber;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: colors.bg.base, color: colors.text.primary, fontFamily: typography.fontFamily, animation: "fadeIn 0.3s ease-out" }}>

      {/* Handoff screen overlay — blocks all game content between actors */}
      {turnPhase === PHASES.HANDOFF && (
        <HandoffScreen
          actorName={activeActor.name || activeActor.id}
          actorColor={actorColor}
          phaseName={PHASE_LABELS[handoffResumePhase] || "Next Phase"}
          turnNumber={gs.game.turn}
          onReady={handleHandoffReady}
        />
      )}

      {/* Toolbar */}
      <div style={{ padding: `${space[2] + 2}px ${space[5]}px`, borderBottom: `1px solid ${colors.border.subtle}`, display: "flex", alignItems: "center", gap: space[3], flexShrink: 0 }}>
        <div style={{ fontWeight: typography.weight.bold, fontSize: typography.heading.sm }}>{gs.scenario.title || "Simulation"}</div>
        <Badge color={colors.accent.cyan} style={{ fontSize: 10 }}>{SCALE_TIERS[scaleKey]?.label || scaleKey}</Badge>
        <Badge color={colors.accent.amber} style={{ fontSize: 11, fontWeight: typography.weight.bold, animation: hasAdjudication ? "none" : "pulse 2s infinite" }}>Turn {gs.game.turn}/{maxTurns}</Badge>
        {/* Active actor + phase indicator */}
        <Badge color={actorColor} style={{ fontSize: 10 }}>
          {activeActor.name || activeActor.id} — {PHASE_LABELS[turnPhase] || turnPhase}
        </Badge>
        {gs.game.currentDate && (
          <Badge color={colors.accent.cyan} style={{ fontSize: 10, fontFamily: typography.monoFamily }}>
            {formatSimDate(gs.game.currentDate)}
          </Badge>
        )}
        {gs.environment && (
          <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
            {formatEnvironmentBrief(gs.environment)}
          </span>
        )}
        {isPaused && <Badge color={colors.accent.red} style={{ fontWeight: typography.weight.bold }}>PAUSED</Badge>}
        {isEnded && <Badge color={colors.text.muted} style={{ fontWeight: typography.weight.bold }}>ENDED</Badge>}
        {deEsc?.escalation_direction && (
          <Badge color={ESCALATION_COLORS[deEsc.escalation_direction] || colors.text.muted}>
            {deEsc.current_escalation_level || ""} ({deEsc.escalation_direction})
          </Badge>
        )}
        {gs.promptLog.length > 0 && (() => {
          const totalTokens = gs.promptLog.reduce((sum, p) => sum + (p.tokenUsage?.total_tokens || 0), 0);
          return totalTokens > 0 ? (
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
              {(totalTokens / 1000).toFixed(1)}k tokens
            </span>
          ) : null;
        })()}
        <div style={{ marginLeft: "auto", display: "flex", gap: space[1] + 2, alignItems: "center" }}>
          {/* Mid-game model switching */}
          {providers.length > 0 && (
            <>
              <select
                value={gs.game.config.llm.provider}
                onChange={e => {
                  const newProvider = e.target.value;
                  const prov = providers.find(p => p.id === newProvider);
                  const firstModel = prov?.models?.[0];
                  const newLlm = { ...gs.game.config.llm, provider: newProvider, model: firstModel?.id || "" };
                  newLlm.temperature = firstModel?.temperature ?? 0.4;
                  setGs(prev => ({ ...prev, game: { ...prev.game, config: { ...prev.game.config, llm: newLlm } } }));
                }}
                style={{ padding: "2px 4px", fontSize: typography.body.xs, background: colors.bg.surface, color: colors.text.primary, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, height: 26 }}
              >
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                value={gs.game.config.llm.model}
                onChange={e => {
                  const prov = providers.find(p => p.id === gs.game.config.llm.provider);
                  const modelObj = prov?.models?.find(m => m.id === e.target.value);
                  const newLlm = { ...gs.game.config.llm, model: e.target.value };
                  newLlm.temperature = modelObj?.temperature ?? 0.4;
                  setGs(prev => ({ ...prev, game: { ...prev.game, config: { ...prev.game.config, llm: newLlm } } }));
                }}
                style={{ padding: "2px 4px", fontSize: typography.body.xs, background: colors.bg.surface, color: colors.text.primary, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, height: 26 }}
              >
                {(providers.find(p => p.id === gs.game.config.llm.provider)?.models || []).map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
            </>
          )}
          <Button variant="secondary" onClick={handleSave} size="sm" disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save"}
          </Button>
          {/* Debug/moderator tools — tree-shaken from production builds */}
          {__DEV_TOOLS__ && <>
            <Button variant="secondary" onClick={handleExportLog} size="sm">Export Log</Button>
            <Button variant="secondary" onClick={() => handleExportMap()} size="sm">Map PNG</Button>
            <div style={{ position: "relative", display: "inline-block" }}>
              <BriefingDropdown actors={gs.scenario.actors} onExport={handleExportBriefing} />
            </div>
            {gs.promptLog.length > 0 && (
              <Button variant="secondary" onClick={() => setShowPrompt(!showPrompt)} size="sm">
                {showPrompt ? "Hide Prompt" : "View Prompt"}
              </Button>
            )}
            <Button variant={fogOfWar ? "primary" : "secondary"} onClick={() => setFogOfWar(!fogOfWar)} size="sm">
              {fogOfWar ? "FoW: ON" : "FoW: Off"}
            </Button>
            {!isPaused && !isEnded && <Button variant="danger" onClick={handlePause} size="sm">Pause</Button>}
            {isPaused && <Button variant="success" onClick={handleResume} size="sm">Resume</Button>}
            <Button variant="danger" onClick={handleEnd} size="sm">End</Button>
          </>}
          {aiActors.length > 0 && (
            <Button variant={showThoughts ? "primary" : "secondary"} onClick={() => setShowThoughts(v => !v)} size="sm" title="Toggle AI commander thoughts">
              💭 {showThoughts ? "Thoughts: ON" : "Thoughts: Off"}
            </Button>
          )}
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Map + thought bubbles */}
        <div style={{ flex: "0 0 45%", borderRight: `1px solid ${colors.border.subtle}`, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <SimMap
            ref={simMapRef}
            terrainData={terrainData}
            units={mapUnits}
            actors={gs.scenario.actors}
            style={{ width: "100%", height: "100%" }}
            fogOfWar={fogOfWar}
            fowMode={fowMode}
            interactionMode={targetingMode ? "target_hex" : "navigate"}
            targetingMode={targetingMode}
            selectedUnitId={selectedUnitId}
            onCellClick={(cell, e) => targetingMode ? handleTargetSelect(cell, e) : handleMapCellClick(cell)}
            onCellHover={targetingMode ? setHoveredCell : undefined}
            movePath={movePath}
            proposedMoves={proposedMoves}
            airOverlayData={airOverlayData}
            orderOverlayData={orderOverlayData}
            terrainModsData={gs.terrainMods}
            vpOverlayData={vpOverlayData}
            activeFeatures={activeFeatures}
            showElevBands={showElevBands}
          />

          {/* ── Map view controls — bottom-right (avoids cell tooltip at bottom-left) ── */}
          <div style={{
            position: "absolute", bottom: 8, right: 8,
            display: "flex", gap: 4, zIndex: 10,
          }}>
            <button
              onClick={() => setShowElevBands(v => !v)}
              title="Toggle elevation view (E)"
              style={{
                fontSize: 10, color: showElevBands ? "#F59E0B" : "#9CA3AF",
                fontFamily: "monospace",
                background: showElevBands ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.5)",
                padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                border: showElevBands ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent",
              }}
            >
              Elev
            </button>
            <button
              onClick={() => setShowFeaturePanel(v => !v)}
              title="Toggle feature layers"
              style={{
                fontSize: 10, color: showFeaturePanel ? "#3B82F6" : "#9CA3AF",
                fontFamily: "monospace",
                background: showFeaturePanel ? "rgba(59,130,246,0.15)" : "rgba(0,0,0,0.5)",
                padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                border: showFeaturePanel ? "1px solid rgba(59,130,246,0.4)" : "1px solid transparent",
              }}
            >
              Layers
            </button>
          </div>

          {/* ── Feature filter panel ── */}
          {showFeaturePanel && (
            <Panel style={{
              position: "absolute", bottom: 38, right: 8, width: 200,
              maxHeight: "60vh", overflowY: "auto", padding: "8px 10px",
              zIndex: 20, fontSize: 11,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: colors.text.muted,
                marginBottom: 4, letterSpacing: 1, textTransform: "uppercase",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                Layers
                <span onClick={() => setShowFeaturePanel(false)} style={{ cursor: "pointer", opacity: 0.6, fontSize: 12 }}>✕</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>
                {[["All", () => toggleAllFeatures(true)], ["None", () => toggleAllFeatures(false)]].map(([label, fn]) => (
                  <span key={label} onClick={fn} style={{
                    padding: "1px 5px", borderRadius: 2, fontSize: 9, cursor: "pointer",
                    background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
                    color: colors.text.secondary,
                  }}>{label}</span>
                ))}
                {Object.keys(FG).map(g => (
                  <span key={g} onClick={() => toggleFeatureGroup(g)} style={{
                    padding: "1px 5px", borderRadius: 2, fontSize: 9, cursor: "pointer",
                    background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
                    color: colors.text.secondary,
                  }}>{g}</span>
                ))}
              </div>
              {Object.entries(FG).map(([group, items]) => {
                const present = items.filter(f => featureCounts[f]);
                if (present.length === 0) return null;
                return (
                  <div key={group} style={{ marginBottom: 4 }}>
                    <div onClick={() => toggleFeatureGroup(group)} style={{
                      fontSize: 9, fontWeight: 700, color: colors.text.muted,
                      cursor: "pointer", marginBottom: 2, display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <div style={{ width: 2, height: 8, borderRadius: 1, background: colors.accent.blue }} />
                      {group}
                    </div>
                    {present.map(f => {
                      const on = activeFeatures.has(f);
                      return (
                        <div key={f} onClick={() => toggleFeat(f)} style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: "1px 0", cursor: "pointer", opacity: on ? 1 : 0.25,
                        }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: 2,
                            background: FC[f] || "#666", flexShrink: 0,
                          }} />
                          <span style={{ flex: 1, fontSize: 10 }}>{FL[f] || f}</span>
                          <span style={{ fontSize: 9, color: colors.text.muted, fontFamily: "monospace" }}>{featureCounts[f]}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </Panel>
          )}

          {/* ── Elevation legend ── */}
          {showElevBands && terrainData && (() => {
            const { min, max } = computeElevationRange(terrainData);
            const range = max - min;
            if (range <= 0) return null;
            const rawInterval = range / 10;
            const contourInterval = rawInterval > 200 ? Math.round(rawInterval / 100) * 100
              : rawInterval > 50 ? Math.round(rawInterval / 50) * 50
              : rawInterval > 10 ? Math.round(rawInterval / 10) * 10
              : Math.max(5, Math.round(rawInterval));
            const stops = [
              "rgb(51,115,71)", "rgb(89,140,77)", "rgb(140,158,82)", "rgb(179,166,87)",
              "rgb(184,143,97)", "rgb(158,122,102)", "rgb(148,143,138)", "rgb(224,219,209)",
            ];
            const gradient = stops.map((c, i) => `${c} ${(i / 7 * 100).toFixed(1)}%`).join(", ");
            const ticks = [];
            const firstTick = Math.ceil(min / contourInterval) * contourInterval;
            for (let e = firstTick; e <= max; e += contourInterval) {
              const pct = (e - min) / range;
              if (pct > 0.05 && pct < 0.95) ticks.push({ elev: e, pct });
            }
            const stride = Math.max(1, Math.ceil(ticks.length / 4));
            const shownTicks = ticks.filter((_, i) => i % stride === 0);
            const barH = 120;
            return (
              <Panel style={{
                position: "absolute", bottom: 38, right: showFeaturePanel ? 220 : 8,
                padding: "6px 8px", width: 70, zIndex: 15,
              }}>
                <div style={{ fontSize: 8, color: colors.text.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4, textAlign: "center" }}>
                  Elevation
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <div style={{ width: 10, height: barH, borderRadius: 2, background: `linear-gradient(to top, ${gradient})`, border: `1px solid ${colors.border.subtle}`, flexShrink: 0 }} />
                  <div style={{ position: "relative", height: barH, flex: 1 }}>
                    <span style={{ position: "absolute", top: -3, fontSize: 9, fontWeight: 600, color: colors.text.secondary, fontFamily: "monospace", whiteSpace: "nowrap" }}>{max}m</span>
                    {shownTicks.map(t => (
                      <span key={t.elev} style={{ position: "absolute", bottom: `${t.pct * 100}%`, transform: "translateY(50%)", fontSize: 8, color: colors.text.muted, fontFamily: "monospace", whiteSpace: "nowrap" }}>{t.elev}</span>
                    ))}
                    <span style={{ position: "absolute", bottom: -3, fontSize: 9, fontWeight: 600, color: colors.text.secondary, fontFamily: "monospace", whiteSpace: "nowrap" }}>{min}m</span>
                  </div>
                </div>
              </Panel>
            );
          })()}
        </div>

        {/* Commander Thought Bubbles — AI inner monologue display */}
        {showThoughts && aiActors.length > 0 && (
          <div style={{
            display: "flex", gap: 12, padding: "8px 12px",
            borderTop: `1px solid ${colors.border.subtle}`,
            background: colors.bg.surface, flexShrink: 0,
          }}>
            {(aiActors.length === 1 ? [0] : [0, 1]).map(i => {
              const actorId = thoughtChannels[i];
              const actor = actors.find(a => a.id === actorId);
              const actorIdx = actors.indexOf(actor);
              const color = actorIdx >= 0 ? ACTOR_COLORS[actorIdx % ACTOR_COLORS.length] : "#888";
              const text = commanderThoughts[actorId] || "";
              return (
                <div key={i} style={{
                  flex: 1, border: `2px solid ${color}`, borderRadius: radius.md,
                  background: colors.bg.input, display: "flex", flexDirection: "column",
                  maxHeight: 160, minHeight: 80,
                }}>
                  {/* Header: actor name or dropdown for 3+ actors */}
                  <div style={{
                    padding: "4px 8px", background: color + "22",
                    borderBottom: `1px solid ${color}40`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexShrink: 0,
                  }}>
                    {aiActors.length <= 2 ? (
                      <span style={{ fontWeight: typography.weight.semibold, color, fontSize: typography.body.sm }}>{actor?.name || "—"}</span>
                    ) : (
                      <select value={actorId || ""} onChange={e => {
                        setThoughtChannels(prev => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        });
                      }} style={{
                        background: "transparent", border: "none", color,
                        fontWeight: typography.weight.semibold, fontSize: typography.body.sm,
                        fontFamily: typography.fontFamily, cursor: "pointer",
                      }}>
                        {aiActors.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    )}
                    <span style={{ fontSize: 11, opacity: 0.6 }}>💭</span>
                  </div>
                  {/* Scrollable thought text */}
                  <div style={{
                    padding: "6px 10px", flex: 1, overflowY: "auto",
                    fontSize: typography.body.sm, lineHeight: 1.4, whiteSpace: "pre-wrap",
                    fontStyle: text ? "normal" : "italic",
                    opacity: text ? 1 : 0.5, color: colors.text.secondary,
                  }}>
                    {text || "Awaiting commander thoughts..."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* Right: Turn panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: space[4] }}>

            {/* Error banner */}
            {error && (
              <div style={{ padding: `${space[2]}px ${space[3]}px`, background: colors.glow.red, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, fontSize: typography.body.sm, color: colors.accent.red, marginBottom: space[3] }}>
                {error}
              </div>
            )}

            {/* Prompt Viewer — dev only */}
            {__DEV_TOOLS__ && showPrompt && gs.promptLog.length > 0 && (
              <Card style={{ marginBottom: space[3], maxHeight: 400, overflow: "auto" }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Last LLM Prompt (Turn {gs.promptLog[gs.promptLog.length - 1]?.turn})</div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: space[1] }}>
                  Model: {gs.promptLog[gs.promptLog.length - 1]?.model} | Temp: {gs.promptLog[gs.promptLog.length - 1]?.temperature} | Attempts: {gs.promptLog[gs.promptLog.length - 1]?.attempts}
                  {gs.promptLog[gs.promptLog.length - 1]?.tokenUsage && ` | Tokens: ${JSON.stringify(gs.promptLog[gs.promptLog.length - 1].tokenUsage)}`}
                </div>
                <pre style={{ background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, padding: space[2], fontSize: typography.body.xs, color: colors.text.secondary, overflow: "auto", maxHeight: 300, fontFamily: typography.monoFamily, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {gs.promptLog[gs.promptLog.length - 1]?.rawResponse || "(no raw response stored)"}
                </pre>
              </Card>
            )}

            {/* Pause moderator panel with unit override */}
            {isPaused && (
              <div style={{ padding: space[3], background: `${colors.accent.red}08`, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, marginBottom: space[3] }}>
                <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, color: colors.accent.red, marginBottom: space[2] }}>Simulation Paused (Kill Switch Active)</div>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>Edit unit attributes below, then add a moderator note before resuming.</div>
                <textarea value={moderatorNote} onChange={e => setModeratorNote(e.target.value)}
                  placeholder="Moderator notes (reason for pause, state corrections made...)"
                  style={{ width: "100%", padding: space[2], background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, minHeight: 50, boxSizing: "border-box", fontFamily: typography.fontFamily, outline: "none", marginBottom: space[2] }} />

                {/* Inline unit editor */}
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Unit Overrides</div>
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {gs.units.map((u, ui) => (
                    <div key={u.id} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3, fontSize: typography.body.xs }}>
                      <span style={{ width: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colors.text.secondary }}>{u.name}</span>
                      <label style={{ color: colors.text.muted }}>Str:</label>
                      <input type="number" min="0" max="100" value={u.strength}
                        onChange={e => { const val = parseInt(e.target.value) || 0; setGs(prev => ({ ...prev, units: prev.units.map((x, i) => i === ui ? { ...x, strength: val } : x) })); }}
                        style={{ width: 42, padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.monoFamily }} />
                      <label style={{ color: colors.text.muted }}>Spl:</label>
                      <input type="number" min="0" max="100" value={u.supply}
                        onChange={e => { const val = parseInt(e.target.value) || 0; setGs(prev => ({ ...prev, units: prev.units.map((x, i) => i === ui ? { ...x, supply: val } : x) })); }}
                        style={{ width: 42, padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.monoFamily }} />
                      <select value={u.status}
                        onChange={e => { const val = e.target.value; setGs(prev => ({ ...prev, units: prev.units.map((x, i) => i === ui ? { ...x, status: val } : x) })); }}
                        style={{ padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.fontFamily }}>
                        {["ready", "engaged", "damaged", "retreating", "destroyed", "eliminated"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select value={u.posture || "ready"}
                        onChange={e => { const val = e.target.value; setGs(prev => ({ ...prev, units: prev.units.map((x, i) => i === ui ? { ...x, posture: val } : x) })); }}
                        style={{ padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.fontFamily }}>
                        {["ready", "attacking", "defending", "moving", "dug_in", "retreating", "reserve", "routing"].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Cost Notice — one-time per session, shown before first AI generation */}
            {!isEnded && turnPhase === PHASES.PLANNING && isAiActor(activeActor) && aiGenerating && !aiCostDismissed && (
              <Card style={{ marginBottom: space[3], padding: space[3], border: `1px solid ${colors.accent.amber}40`, background: `${colors.accent.amber}08` }}>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>
                  AI players make LLM API calls each turn using your configured provider/model.
                  Estimated ~5,000-10,000 tokens per AI actor per turn.
                </div>
                <Button variant="secondary" size="sm" onClick={() => { localStorage.setItem("oc_ai_cost_dismissed", "1"); setAiCostDismissed(true); }}>
                  Got it
                </Button>
              </Card>
            )}

            {/* AI Splash Screen — shown during AI order generation (non-spectator mode) */}
            {!isEnded && turnPhase === PHASES.PLANNING && isAiActor(activeActor) && !allAi && (
              <div style={{ textAlign: "center", padding: space[6], animation: "fadeIn 0.3s ease-out" }}>
                <div style={{ width: 40, height: 40, border: `3px solid ${colors.border.subtle}`, borderTop: `3px solid ${colors.accent.purple}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                <div style={{ fontSize: typography.heading.md, color: colors.accent.purple, marginBottom: space[2], animation: "pulse 2s infinite" }}>
                  Getting orders from {activeActor.name || activeActor.id}...
                </div>
                {activeActor.aiConfig?.personality && (
                  <div style={{ fontSize: typography.body.sm, color: colors.text.muted, marginBottom: space[3], fontStyle: "italic", maxWidth: 400, margin: "0 auto" }}>
                    "{activeActor.aiConfig.personality.slice(0, 120)}{activeActor.aiConfig.personality.length > 120 ? "..." : ""}"
                  </div>
                )}
                {/* Token usage from last call */}
                {(() => {
                  const lastCall = (gs.aiState?.callLog || []).filter(c => c.actorId === activeActor.id).slice(-1)[0];
                  return lastCall?.usage ? (
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[3] }}>
                      Last call: {lastCall.usage.input_tokens?.toLocaleString() || "?"} tokens in / {lastCall.usage.output_tokens?.toLocaleString() || "?"} tokens out
                    </div>
                  ) : null;
                })()}
                {aiError && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.sm, color: colors.accent.red, marginBottom: space[2], padding: space[2], background: colors.glow.red, borderRadius: radius.md }}>
                      {aiError}
                    </div>
                    <div style={{ display: "flex", gap: space[2], justifyContent: "center" }}>
                      <Button variant="secondary" onClick={() => { setAiError(null); setAiGenerating(false); setSimKick(k => k + 1); }}>
                        Retry
                      </Button>
                      <Button variant="ghost" onClick={() => {
                        // Skip — HOLD all units
                        const fallbackOrders = {};
                        gs.units.filter(u => u.actor === activeActor.id && u.status !== "destroyed" && u.status !== "eliminated")
                          .forEach(u => { fallbackOrders[u.id] = { movementOrder: null, actionOrder: null, intent: "" }; });
                        setUnitOrders(prev => ({ ...prev, [activeActor.id]: fallbackOrders }));
                        setActorIntents(prev => ({ ...prev, [activeActor.id]: "AI skipped — HOLD all units" }));
                        setAiError(null);
                        setAiGenerating(false);
                        setTimeout(() => { aiSealPendingRef.current = true; }, 50);
                      }}>
                        Skip (HOLD All)
                      </Button>
                    </div>
                  </div>
                )}
                {!aiError && (
                  <Button variant="ghost" size="sm" onClick={() => {
                    if (aiAbortRef.current) aiAbortRef.current.abort();
                    const fallbackOrders = {};
                    gs.units.filter(u => u.actor === activeActor.id && u.status !== "destroyed" && u.status !== "eliminated")
                      .forEach(u => { fallbackOrders[u.id] = { movementOrder: null, actionOrder: null, intent: "" }; });
                    setUnitOrders(prev => ({ ...prev, [activeActor.id]: fallbackOrders }));
                    setActorIntents(prev => ({ ...prev, [activeActor.id]: "AI cancelled — HOLD all units" }));
                    setAiGenerating(false);
                    setTimeout(() => { aiSealPendingRef.current = true; }, 50);
                  }}>
                    Cancel
                  </Button>
                )}
              </div>
            )}

            {/* All-AI Spectator Status Bar — shown instead of splash when all actors are AI */}
            {!isEnded && allAi && (aiGenerating || adjudicatingLLM) && (
              <div style={{ padding: `${space[2]}px ${space[3]}px`, background: `${colors.accent.purple}10`, border: `1px solid ${colors.accent.purple}30`, borderRadius: radius.md, marginBottom: space[3], display: "flex", alignItems: "center", gap: space[2] }}>
                <div style={{ width: 16, height: 16, border: `2px solid ${colors.border.subtle}`, borderTop: `2px solid ${colors.accent.purple}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <div style={{ fontSize: typography.body.sm, color: colors.accent.purple }}>
                  {aiGenerating ? `Getting orders from ${activeActor.name}...` : `Adjudicating Turn ${gs.game.turn}...`}
                </div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginLeft: "auto" }}>
                  Turn {gs.game.turn}{simStopTurn ? ` / ${simStopTurn}` : ""}
                </div>
              </div>
            )}

            {/* All-AI Simulation Controls */}
            {!isEnded && allAi && (
              <Card style={{ marginBottom: space[3], padding: space[2] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Simulation Controls</div>
                <div style={{ display: "flex", gap: space[2], alignItems: "center", marginBottom: space[2], flexWrap: "wrap" }}>
                  <select value={simMode} onChange={e => setSimMode(e.target.value)}
                    style={{ padding: "4px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.fontFamily }}>
                    <option value="step">Step-by-Step</option>
                    <option value="auto">Auto-Play</option>
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <label style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Stop at:</label>
                    <input type="number" min="1" value={simStopTurn} onChange={e => setSimStopTurn(e.target.value)}
                      placeholder="—"
                      style={{ width: 48, padding: "3px 6px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.monoFamily }} />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: typography.body.xs, color: colors.text.secondary, cursor: "pointer" }}>
                    <input type="checkbox" checked={simLoop} onChange={e => setSimLoop(e.target.checked)} style={{ accentColor: colors.accent.purple }} />
                    Loop
                  </label>
                </div>
                <div style={{ display: "flex", gap: space[2] }}>
                  {simMode === "step" ? (
                    <Button variant="secondary" size="sm" onClick={() => { simAutoAdvanceRef.current = true; setSimPaused(false); setSimKick(k => k + 1); }}
                      disabled={aiGenerating || adjudicatingLLM}>
                      Next Turn
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => {
                      const next = !simPaused;
                      setSimPaused(next);
                      if (!next) { simAutoAdvanceRef.current = true; setSimKick(k => k + 1); } // resume
                      else { simAutoAdvanceRef.current = false; } // pause
                    }}>
                      {simPaused ? "Resume" : "Pause"}
                    </Button>
                  )}
                </div>
                {/* All-AI error display */}
                {aiError && (
                  <div style={{ padding: `${space[2]}px`, background: `${colors.accent.red}10`, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.sm, marginTop: space[2], fontSize: typography.body.xs, color: colors.accent.red }}>
                    <div style={{ marginBottom: space[1] }}>AI Error: {aiError}</div>
                    <div style={{ display: "flex", gap: space[2] }}>
                      <Button variant="secondary" size="sm" onClick={() => { setAiError(null); setAiGenerating(false); setSimKick(k => k + 1); }}>Retry</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setAiError(null); setAiGenerating(false); setTimeout(() => { aiSealPendingRef.current = true; }, 50); }}>Skip (HOLD All)</Button>
                    </div>
                  </div>
                )}
                {/* Turn summary log */}
                {simTurnLog.length > 0 && (
                  <div style={{ marginTop: space[2], maxHeight: 150, overflowY: "auto", fontSize: typography.body.xs, color: colors.text.muted }}>
                    {simTurnLog.map((entry, i) => (
                      <div key={i} style={{ padding: "2px 0", borderBottom: `1px solid ${colors.border.subtle}` }}>
                        <span style={{ color: colors.text.secondary, fontFamily: typography.monoFamily }}>T{entry.turn}</span> {entry.summary}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Structured Order Input (Planning Phase) — filtered to active actor, hidden for AI actors */}
            {!isEnded && turnPhase === PHASES.PLANNING && !isAiActor(activeActor) && (
              <OrderRoster
                units={gs.units.filter(u => u.status !== "destroyed" && u.status !== "eliminated")}
                actors={gs.scenario.actors}
                unitOrders={unitOrders}
                actorIntents={actorIntents}
                onUnitClick={handleUnitClick}
                onActorIntentChange={handleActorIntentChange}
                onSubmit={handleSealOrders}
                submitting={adjudicatingLLM}
                disabled={isPaused}
                turnNumber={gs.game.turn}
                activeActorId={fogOfWar ? activeActor.id : null}
                submitLabel={fogOfWar ? `Seal ${activeActor.name || activeActor.id}'s Orders` : "Submit All Orders"}
              />
            )}

            {/* Reinforcement Panel (Planning Phase) — hidden for AI actors */}
            {!isEnded && turnPhase === PHASES.PLANNING && !isAiActor(activeActor) && (
              <ReinforcementPanel
                gameState={gs}
                terrainData={terrainData}
                onAddUnit={handleAddReinforcementUnit}
                onScheduleUnit={handleScheduleReinforcementUnit}
                onAddActor={handleAddActor}
                onRemoveQueued={handleRemoveQueuedReinforcement}
                placingPosition={reinforcementPosition}
                onStartPlacing={() => { setPlacingReinforcement(true); setTargetingMode(null); setSelectedUnitId(null); }}
                onCancelPlacing={() => { setPlacingReinforcement(false); setReinforcementPosition(null); }}
              />
            )}

            {/* Fortune Rolls Display */}
            {fortuneRolls && (
              <Card style={{ marginBottom: space[3], animation: "slideUp 0.3s ease-out" }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Fortune of War — Turn {gs.game.turn}</div>
                {fortuneRolls.unitRolls ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                    {/* FOW: only show own actor + detected enemy units during review */}
                    {gs.scenario.actors
                      .filter(actor => {
                        if (!fogOfWar || !visibilityState) return true; // no FOW — show all
                        return actor.id === activeActor.id; // only own forces
                      })
                      .map(actor => {
                      const actorUnits = gs.units.filter(u => u.actor === actor.id);
                      return (
                        <div key={actor.id}>
                          <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.semibold, color: colors.text.secondary, marginBottom: space[1] }}>{actor.name}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: space[1] }}>
                            {actorUnits.map(u => {
                              const roll = fortuneRolls.unitRolls[u.id];
                              if (!roll) {
                                return (
                                  <div key={u.id} style={{ padding: `${space[1]}px ${space[2]}px`, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, fontSize: typography.body.xs, display: "flex", alignItems: "center", gap: space[1] }}>
                                    <span style={{ color: colors.text.muted }}>{u.name}</span>
                                    <span style={{ color: colors.text.muted, fontStyle: "italic" }}>HOLD</span>
                                  </div>
                                );
                              }
                              const rollColor = roll.roll <= 8 ? colors.accent.red : roll.roll >= 93 ? colors.accent.green : colors.text.secondary;
                              const glowBg = roll.roll <= 8 ? colors.glow.red : roll.roll >= 93 ? colors.glow.green : "transparent";
                              return (
                                <div key={u.id} style={{ padding: `${space[1]}px ${space[2]}px`, background: glowBg, border: `1px solid ${rollColor}30`, borderRadius: radius.sm, fontSize: typography.body.xs, display: "flex", alignItems: "center", gap: space[1] }}>
                                  <span style={{ fontWeight: typography.weight.semibold, color: colors.text.primary }}>{u.name}</span>
                                  <span style={{ fontFamily: typography.monoFamily, fontWeight: typography.weight.bold, color: rollColor }}>{roll.roll}</span>
                                  <span style={{ color: rollColor }}>{roll.descriptor}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : fortuneRolls.actorRolls ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
                    {Object.entries(fortuneRolls.actorRolls)
                      .filter(([actorId]) => {
                        if (!fogOfWar || !visibilityState) return true;
                        return actorId === activeActor.id;
                      })
                      .map(([actorId, roll]) => {
                      const actorName = gs.scenario.actors.find(a => a.id === actorId)?.name || actorId;
                      const rollColor = roll.roll <= 8 ? colors.accent.red : roll.roll >= 93 ? colors.accent.green : colors.text.secondary;
                      const glowBg = roll.roll <= 8 ? colors.glow.red : roll.roll >= 93 ? colors.glow.green : "transparent";
                      return (
                        <div key={actorId} style={{ padding: `${space[1]}px ${space[2]}px`, background: glowBg, border: `1px solid ${rollColor}30`, borderRadius: radius.sm, fontSize: typography.body.sm, display: "flex", alignItems: "center", gap: space[1] + 2 }}>
                          <span style={{ fontWeight: typography.weight.semibold, color: colors.text.primary }}>{actorName}</span>
                          <span style={{ fontFamily: typography.monoFamily, fontWeight: typography.weight.bold, color: rollColor, fontSize: typography.heading.sm }}>{roll.roll}</span>
                          <span style={{ color: rollColor, fontSize: typography.body.xs }}>{roll.descriptor}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {fortuneRolls.wildCard && (
                  <div style={{
                    marginTop: space[2],
                    padding: `${space[1]}px ${space[2]}px`,
                    background: fortuneRolls.wildCard.triggered ? colors.glow.amber : "transparent",
                    border: `1px solid ${fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.border.subtle}`,
                    borderRadius: radius.sm, fontSize: typography.body.sm, display: "inline-flex", alignItems: "center", gap: space[1] + 2,
                  }}>
                    <span style={{ fontWeight: typography.weight.semibold, color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted }}>Wild Card</span>
                    <span style={{ fontFamily: typography.monoFamily, fontWeight: typography.weight.bold, color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted, fontSize: typography.heading.sm }}>{fortuneRolls.wildCard.roll}</span>
                    <span style={{ color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted, fontSize: typography.body.xs }}>{fortuneRolls.wildCard.descriptor}</span>
                  </div>
                )}
              </Card>
            )}

            {/* Friction Events Display */}
            {frictionEvents?.events?.length > 0 && (
              <Card style={{ marginBottom: space[3], animation: "slideUp 0.3s ease-out" }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Friction Events — Turn {gs.game.turn}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: space[1] + 2 }}>
                  {frictionEvents.events.map((evt, i) => {
                    const severityColor = evt.severity === "major" ? colors.accent.red : evt.severity === "moderate" ? colors.accent.amber : colors.accent.cyan;
                    const borderColor = evt.positive ? colors.accent.green : severityColor;
                    return (
                      <div key={evt.id || i} style={{
                        padding: `${space[1] + 2}px ${space[2]}px`,
                        background: evt.positive ? `${colors.accent.green}08` : `${severityColor}08`,
                        border: `1px solid ${borderColor}30`,
                        borderLeft: `3px solid ${borderColor}`,
                        borderRadius: radius.sm, fontSize: typography.body.sm,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: space[1] + 2, marginBottom: 2 }}>
                          <Badge color={severityColor} style={{ fontSize: 9 }}>{evt.severity}</Badge>
                          <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{evt.category}</span>
                          {evt.positive && <Badge color={colors.accent.green} style={{ fontSize: 9 }}>beneficial</Badge>}
                        </div>
                        <div style={{ color: colors.text.secondary, lineHeight: 1.5 }}>{evt.text}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Loading spinner for busy phases */}
            {(adjudicatingLLM || isBusyPhase(turnPhase)) && (
              <div style={{ textAlign: "center", padding: space[8] }}>
                <div style={{ width: 32, height: 32, border: `3px solid ${colors.border.subtle}`, borderTop: `3px solid ${colors.accent.amber}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontSize: typography.heading.sm, color: colors.accent.amber, marginBottom: space[2], animation: "pulse 2s infinite" }}>
                  {adjPhaseLabel ? adjPhaseLabel :
                   turnPhase === PHASES.COMPUTING_DETECTION ? "Computing detection..." :
                   turnPhase === PHASES.RE_ADJUDICATING ? "Re-adjudicating with challenges..." :
                   `Adjudicating Turn ${gs.game.turn}...`}
                </div>
                <div style={{ fontSize: typography.body.sm, color: adjSubStatus?.startsWith("Error") || adjSubStatus?.startsWith("API error") ? colors.accent.red : colors.text.muted, transition: "color 0.3s" }}>
                  {adjPhaseLabel ? "Checking for fog-of-war leaks in narrative" :
                   turnPhase === PHASES.COMPUTING_DETECTION
                    ? "Calculating line of sight and detection probabilities"
                    : adjSubStatus || `Sending to ${gs.game.config.llm.provider} (${gs.game.config.llm.model})`}
                </div>
                {adjudicatingLLM && (
                  <Button
                    variant="ghost"
                    onClick={handleCancelAdjudication}
                    style={{ marginTop: space[4], color: colors.text.muted, fontSize: typography.body.sm }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}

            {/* Adjudication Results — Tabbed View (shown during REVIEW and after) */}
            {hasAdjudication && (turnPhase === PHASES.REVIEW || turnPhase === PHASES.CHALLENGE_COLLECT || turnPhase === PHASES.REBUTTAL_COLLECT) && (
              <div ref={adjDisplayRef} style={{ animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>
                  Turn {gs.game.turn} — {turnPhase === PHASES.REVIEW ? `${activeActor.name || activeActor.id}'s Assessment` : "Adjudication"}
                </SectionHeader>

                {/* Tab bar */}
                <div style={{ display: "flex", gap: 2, marginBottom: space[3], flexWrap: "wrap" }}>
                  {[
                    { key: "narrative", label: "Narrative" },
                    { key: "feasibility", label: "Feasibility" },
                    ...(deEsc ? [{ key: "escalation", label: "Escalation" }] : []),
                    { key: "changes", label: `Changes (${adj.state_updates?.length || 0})` },
                    ...(actorViewExtras ? [{ key: "intel", label: "Intel" }] : []),
                    ...(__DEV_TOOLS__ ? [{ key: "raw", label: "Raw" }] : []),
                  ].map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                      style={{
                        padding: `${space[1]}px ${space[2] + 2}px`, fontSize: typography.body.sm,
                        background: activeTab === tab.key ? colors.accent.amber + "20" : colors.bg.input,
                        border: `1px solid ${activeTab === tab.key ? colors.accent.amber : colors.border.subtle}`,
                        borderRadius: radius.sm, color: activeTab === tab.key ? colors.accent.amber : colors.text.secondary,
                        cursor: "pointer", fontFamily: typography.fontFamily, transition: `all ${animation.fast}`,
                      }}
                    >{tab.label}</button>
                  ))}
                </div>

                {/* Narrative tab */}
                {activeTab === "narrative" && adj.outcome_determination?.narrative && (
                  <Card style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.lg, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                      {adj.outcome_determination.narrative}
                    </div>
                    {adj.outcome_determination.outcome_type && (
                      <div style={{ marginTop: space[2], display: "flex", alignItems: "center", gap: space[2] }}>
                        <Badge color={adj.outcome_determination.outcome_type === "success" ? colors.accent.green : adj.outcome_determination.outcome_type === "failure" ? colors.accent.red : colors.accent.amber}>
                          {adj.outcome_determination.outcome_type}
                        </Badge>
                        {adj.outcome_determination.probability_assessment && <span style={{ fontSize: typography.body.sm, color: colors.text.muted }}>{adj.outcome_determination.probability_assessment}</span>}
                      </div>
                    )}
                  </Card>
                )}

                {/* Feasibility tab */}
                {activeTab === "feasibility" && adj.feasibility_analysis?.assessments?.length > 0 && (
                  <div style={{ marginBottom: space[3] }}>
                    {adj.feasibility_analysis.assessments.map((a, i) => (
                      <Card key={i} style={{ marginBottom: space[2], borderLeft: `3px solid ${feasibilityColor(a.feasibility)}`, borderTop: "none" }}>
                        <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.semibold, marginBottom: space[1], display: "flex", alignItems: "center", gap: space[2] }}>
                          {a.actor}
                          <Badge color={feasibilityColor(a.feasibility)}>{a.feasibility}</Badge>
                        </div>
                        {a.reasoning && <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>{a.reasoning}</div>}
                        {a.weaknesses_identified?.length > 0 && (
                          <div style={{ fontSize: typography.body.sm, color: colors.accent.red }}>
                            Weaknesses: {a.weaknesses_identified.join("; ")}
                          </div>
                        )}
                        {a.citations?.length > 0 && (
                          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1] }}>
                            Citations: {a.citations.join(", ")}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}

                {/* Escalation tab */}
                {activeTab === "escalation" && deEsc && (
                  <Card style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.sm, marginBottom: space[1], display: "flex", alignItems: "center", gap: space[2] }}>
                      Level: <strong>{deEsc.current_escalation_level}</strong>
                      {deEsc.escalation_direction && (
                        <Badge color={ESCALATION_COLORS[deEsc.escalation_direction] || colors.text.muted}>{deEsc.escalation_direction}</Badge>
                      )}
                    </div>
                    {deEsc.de_escalation_options_available?.length > 0 && (
                      <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>
                        Options available: {deEsc.de_escalation_options_available.join("; ")}
                      </div>
                    )}
                    {deEsc.diplomatic_offramps_status && (
                      <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>Off-ramps: {deEsc.diplomatic_offramps_status}</div>
                    )}
                    {deEsc.historical_base_rate && (
                      <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>Historical: {deEsc.historical_base_rate}</div>
                    )}
                  </Card>
                )}

                {/* State Changes tab */}
                {activeTab === "changes" && adj.state_updates?.length > 0 && (
                  <Card style={{ marginBottom: space[3] }}>
                    {adj.state_updates.map((u, i) => (
                      <div key={i} style={{ fontSize: typography.body.sm, marginBottom: space[1], display: "flex", gap: space[2], alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold }}>{u.entity}</span>
                        <span style={{ color: colors.text.muted }}>.{u.attribute}:</span>
                        <span style={{ color: colors.accent.red, textDecoration: "line-through", background: colors.glow.red, padding: "0 4px", borderRadius: 2 }}>{JSON.stringify(u.old_value)}</span>
                        <span style={{ color: colors.text.muted }}>&rarr;</span>
                        <span style={{ color: colors.accent.green, background: colors.glow.green, padding: "0 4px", borderRadius: 2 }}>{JSON.stringify(u.new_value)}</span>
                        {u.justification && <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontStyle: "italic" }}>({u.justification})</span>}
                      </div>
                    ))}
                  </Card>
                )}

                {/* Intel tab — per-actor detection/visibility info */}
                {activeTab === "intel" && actorViewExtras && (
                  <Card style={{ marginBottom: space[3] }}>
                    {actorViewExtras.known_enemy_actions && (
                      <div style={{ marginBottom: space[2] }}>
                        <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Known Enemy Activity</div>
                        <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, whiteSpace: "pre-wrap" }}>{actorViewExtras.known_enemy_actions}</div>
                      </div>
                    )}
                    {actorViewExtras.intel_assessment && (
                      <div style={{ marginBottom: space[2] }}>
                        <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Intelligence Assessment</div>
                        <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, whiteSpace: "pre-wrap" }}>{actorViewExtras.intel_assessment}</div>
                      </div>
                    )}
                    {actorViewExtras.detection_resolutions?.length > 0 && (
                      <div>
                        <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Detection Results</div>
                        {actorViewExtras.detection_resolutions.map((dr, i) => (
                          <div key={i} style={{ fontSize: typography.body.sm, color: dr.detected ? colors.accent.green : colors.text.muted, marginBottom: 2 }}>
                            {dr.detected ? "✓" : "?"} {dr.unitId}: {dr.description || (dr.detected ? "Detected" : "Unconfirmed")}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {/* Raw JSON tab — dev only */}
                {__DEV_TOOLS__ && activeTab === "raw" && (
                  <pre style={{ background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, padding: space[2] + 2, fontSize: typography.body.xs, color: colors.text.secondary, overflow: "auto", maxHeight: 400, fontFamily: typography.monoFamily, marginBottom: space[3] }}>
                    {JSON.stringify(displayAdj, null, 2)}
                  </pre>
                )}

                {/* Review action buttons — per-actor */}
                {!isEnded && turnPhase === PHASES.REVIEW && (
                  <div style={{ marginBottom: space[2] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.accent.amber, marginBottom: space[2], display: "flex", alignItems: "center", gap: space[1] }}>
                      <Badge color={actorColor}>{activeActor.name || activeActor.id}</Badge>
                      <span>Review the assessment. Accept to continue, or challenge for re-evaluation.</span>
                    </div>
                    <div style={{ display: "flex", gap: space[2] }}>
                      <Button onClick={handleActorAccept} style={{ flex: 1 }}>
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleActorChallenge}
                        disabled={challengeCount >= MAX_CHALLENGES}
                        title={challengeCount >= MAX_CHALLENGES ? "Maximum challenges reached" : "Challenge the assessment"}
                        style={{ flex: "0 0 auto" }}
                      >
                        Challenge{challengeCount > 0 ? ` (${challengeCount}/${MAX_CHALLENGES})` : ""}
                      </Button>
                      <Button variant="secondary" onClick={handleStartOver} style={{ flex: "0 0 auto" }}>
                        Start Over
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Challenge Collection Phase */}
            {turnPhase === PHASES.CHALLENGE_COLLECT && (
              <div style={{ marginBottom: space[4], animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>Challenge — {activeActor.name || activeActor.id}</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
                  Explain what specific factual error the adjudicator made or what data it overlooked.
                  Rhetorical arguments will likely be rejected.
                </div>
                <textarea
                  value={challenges[activeActor.id] || ""}
                  onChange={e => setChallenges(prev => ({ ...prev, [activeActor.id]: e.target.value }))}
                  placeholder={`${activeActor.name || activeActor.id}'s challenge...`}
                  style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, minHeight: 80, fontFamily: typography.fontFamily, resize: "vertical", boxSizing: "border-box", outline: "none", marginBottom: space[2] }}
                />
                <div style={{ display: "flex", gap: space[2] }}>
                  <Button onClick={handleSubmitChallenge}>Submit Challenge</Button>
                  <Button variant="secondary" onClick={handleStartOver}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Counter-Rebuttal Collection Phase */}
            {turnPhase === PHASES.REBUTTAL_COLLECT && (
              <div style={{ marginBottom: space[4], animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>Counter-Rebuttal — {activeActor.name || activeActor.id}</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
                  Another player has challenged the assessment. You may defend the original ruling or add your own perspective.
                </div>
                <textarea
                  value={counterRebuttals[activeActor.id] || ""}
                  onChange={e => setCounterRebuttals(prev => ({ ...prev, [activeActor.id]: e.target.value }))}
                  placeholder={`${activeActor.name || activeActor.id}'s counter-rebuttal (optional)...`}
                  style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, minHeight: 80, fontFamily: typography.fontFamily, resize: "vertical", boxSizing: "border-box", outline: "none", marginBottom: space[2] }}
                />
                <div style={{ display: "flex", gap: space[2] }}>
                  <Button onClick={handleSubmitCounterRebuttal}>Submit Rebuttal</Button>
                  <Button variant="secondary" onClick={handleSubmitCounterRebuttal}>Skip</Button>
                </div>
              </div>
            )}

            {/* Unit Roster */}
            {gs.units.length > 0 && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Unit Roster</SectionHeader>
                <table style={{ width: "100%", fontSize: typography.body.sm, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: colors.text.muted, textAlign: "left" }}>
                      {["Unit", "Actor", "Branch", "Echelon", "Posture", "Pos", "Str", "Spl", "Status"].map(h => (
                        <th key={h} style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, fontWeight: typography.weight.medium, fontSize: typography.body.xs, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gs.units.map((u, i) => {
                      const cellStyle = { padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}` };
                      return (
                        <tr key={u.id} style={{ background: i % 2 === 0 ? "transparent" : `${colors.bg.raised}80` }}>
                          <td style={{ ...cellStyle, fontWeight: typography.weight.semibold }}>{u.name}</td>
                          <td style={{ ...cellStyle, color: colors.text.secondary }}>{gs.scenario.actors.find(a => a.id === u.actor)?.name || u.actor}</td>
                          <td style={{ ...cellStyle, color: colors.text.secondary }}>{u.type}</td>
                          <td style={{ ...cellStyle, color: colors.text.secondary, fontSize: typography.body.xs }}>{u.echelon || "—"}</td>
                          <td style={{ ...cellStyle, color: u.posture === "attacking" ? colors.accent.red : u.posture === "retreating" || u.posture === "routing" ? colors.accent.amber : colors.text.secondary, fontSize: typography.body.xs }}>{u.posture || "—"}</td>
                          <td style={{ ...cellStyle, fontFamily: typography.monoFamily }}>{positionToLabel(u.position)}</td>
                          <td style={{ ...cellStyle, color: u.strength > 50 ? colors.accent.green : u.strength > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{u.strength}%</td>
                          <td style={{ ...cellStyle, color: u.supply > 50 ? colors.accent.green : u.supply > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{u.supply}%</td>
                          <td style={cellStyle}><Badge color={u.status === "ready" ? colors.accent.green : u.status === "destroyed" ? colors.accent.red : colors.text.muted}>{u.status}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Command Hierarchy (Tier 3+ only) */}
            {scaleTier >= 3 && gs.units.some(u => u.parentHQ) && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Command Hierarchy</SectionHeader>
                {(() => {
                  const hqUnits = gs.units.filter(u => u.type === "headquarters");
                  const unattached = gs.units.filter(u => u.type !== "headquarters" && !u.parentHQ);
                  const nodeStyle = (depth) => ({
                    paddingLeft: depth * 16 + space[2], paddingTop: 2, paddingBottom: 2,
                    fontSize: typography.body.sm, display: "flex", alignItems: "center", gap: space[2],
                    borderLeft: depth > 0 ? `2px solid ${colors.border.subtle}` : "none",
                  });
                  const renderUnit = (u, depth) => (
                    <div key={u.id} style={nodeStyle(depth)}>
                      <span style={{ color: depth === 0 ? colors.accent.amber : colors.text.secondary, fontWeight: depth === 0 ? typography.weight.semibold : typography.weight.regular }}>
                        {depth > 0 ? "\u2514 " : ""}{u.name}
                      </span>
                      <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{u.type} / {u.echelon || "—"}</span>
                      <Badge color={u.strength > 50 ? colors.accent.green : u.strength > 25 ? colors.accent.amber : colors.accent.red} style={{ fontSize: 9 }}>{u.strength}%</Badge>
                    </div>
                  );
                  return (
                    <div style={{ background: colors.bg.raised, borderRadius: radius.md, padding: space[2], maxHeight: 300, overflowY: "auto" }}>
                      {hqUnits.map(hq => (
                        <div key={hq.id}>
                          {renderUnit(hq, 0)}
                          {gs.units.filter(u => u.parentHQ === hq.id).map(sub => renderUnit(sub, 1))}
                        </div>
                      ))}
                      {unattached.length > 0 && (
                        <div>
                          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, padding: `${space[1]}px ${space[2]}px`, marginTop: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Unattached</div>
                          {unattached.map(u => renderUnit(u, 0))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Supply Network (Tier 3+ only) */}
            {scaleTier >= 3 && gs.supplyNetwork && Object.keys(gs.supplyNetwork).length > 0 && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Supply Network</SectionHeader>
                {Object.entries(gs.supplyNetwork).map(([actorId, net]) => {
                  const actorName = gs.scenario.actors.find(a => a.id === actorId)?.name || actorId;
                  return (
                    <div key={actorId} style={{ marginBottom: space[2] }}>
                      <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.semibold, color: colors.text.primary, marginBottom: space[1] }}>{actorName}</div>
                      {net.depots?.map(d => {
                        const pct = d.capacity > 0 ? Math.round((d.current / d.capacity) * 100) : 0;
                        const barColor = pct > 50 ? colors.accent.green : pct > 25 ? colors.accent.amber : colors.accent.red;
                        return (
                          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: 3, fontSize: typography.body.xs }}>
                            <span style={{ color: colors.text.secondary, minWidth: 120 }}>{d.name}</span>
                            <div style={{ flex: 1, height: 8, background: colors.bg.input, borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width 0.3s" }} />
                            </div>
                            <span style={{ fontFamily: typography.monoFamily, color: colors.text.muted, minWidth: 60, textAlign: "right" }}>{d.current}/{d.capacity}</span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Resupply rate: {net.resupplyRate} pts/turn</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Diplomacy Panel (Tier 4+ only) */}
            {scaleTier >= 4 && gs.diplomacy && Object.keys(gs.diplomacy).length > 0 && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Diplomacy</SectionHeader>
                <div style={{ display: "flex", flexDirection: "column", gap: space[1] }}>
                  {Object.entries(gs.diplomacy).map(([pairKey, rel]) => {
                    const [aId, bId] = pairKey.split("||");
                    const aName = gs.scenario.actors.find(a => a.id === aId)?.name || aId;
                    const bName = gs.scenario.actors.find(a => a.id === bId)?.name || bId;
                    const statusColor = rel.status === "allied" || rel.status === "friendly" ? colors.accent.green
                      : rel.status === "hostile" || rel.status === "at_war" ? colors.accent.red
                      : rel.status === "tense" ? colors.accent.amber : colors.text.muted;
                    return (
                      <div key={pairKey} style={{ display: "flex", alignItems: "center", gap: space[2], padding: `${space[1]}px ${space[2]}px`, background: colors.bg.raised, borderRadius: radius.sm, fontSize: typography.body.sm }}>
                        <span style={{ fontWeight: typography.weight.semibold }}>{aName}</span>
                        <span style={{ color: colors.text.muted }}>&harr;</span>
                        <span style={{ fontWeight: typography.weight.semibold }}>{bName}</span>
                        <Badge color={statusColor}>{rel.status}</Badge>
                        {rel.channels && rel.channels[0] !== "none" && (
                          <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>via {rel.channels.join(", ")}</span>
                        )}
                        {rel.agreements?.length > 0 && (
                          <span style={{ fontSize: typography.body.xs, color: colors.accent.cyan }}>{rel.agreements.length} agreement(s)</span>
                        )}
                        {isPaused && (
                          <select value={rel.status} onChange={e => {
                            const newDip = { ...gs.diplomacy, [pairKey]: { ...rel, status: e.target.value } };
                            setGs({ ...gs, diplomacy: newDip });
                          }} style={{ marginLeft: "auto", padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.fontFamily }}>
                            {DIPLOMATIC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Turn History */}
            {gs.turnLog.length > 0 && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Turn History</SectionHeader>
                {[...gs.turnLog].reverse().map((entry) => (
                  <div key={entry.turn} style={{ border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, marginBottom: space[1] + 2, overflow: "hidden" }}>
                    <div
                      onClick={() => setExpandedTurn(expandedTurn === entry.turn ? null : entry.turn)}
                      style={{ padding: `${space[2]}px ${space[3]}px`, background: colors.bg.raised, cursor: "pointer", display: "flex", alignItems: "center", gap: space[2], fontSize: typography.body.sm, transition: `background ${animation.fast}` }}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.bg.surface; }}
                      onMouseLeave={e => { e.currentTarget.style.background = colors.bg.raised; }}
                    >
                      <Badge color={colors.accent.amber} style={{ fontWeight: typography.weight.semibold }}>Turn {entry.turn}</Badge>
                      <span style={{ color: colors.text.secondary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.adjudication?.narrative?.slice(0, 80)}{entry.adjudication?.narrative?.length > 80 ? "..." : ""}
                      </span>
                      <span style={{ color: colors.text.muted, fontSize: typography.body.xs }}>{expandedTurn === entry.turn ? "\u25BC" : "\u25B6"}</span>
                    </div>
                    {expandedTurn === entry.turn && (
                      <div style={{ padding: space[3], fontSize: typography.body.sm, lineHeight: 1.6, animation: "slideDown 0.2s ease-out" }}>
                        {entry.actions && Object.keys(entry.actions).length > 0 && (
                          <div style={{ marginBottom: space[2] }}>
                            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Actions:</div>
                            {Object.entries(entry.actions).map(([actorId, text]) => (
                              <div key={actorId} style={{ marginBottom: space[1] }}>
                                <strong>{gs.scenario.actors.find(a => a.id === actorId)?.name || actorId}:</strong> {text}
                              </div>
                            ))}
                          </div>
                        )}
                        {entry.adjudication?.narrative && (
                          <div style={{ marginBottom: space[2] }}>
                            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>Outcome:</div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{entry.adjudication.narrative}</div>
                          </div>
                        )}
                        {entry.adjudication?.stateUpdates?.length > 0 && (
                          <div>
                            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase" }}>State Changes:</div>
                            {entry.adjudication.stateUpdates.map((u, j) => (
                              <div key={j} style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
                                {u.entity}.{u.attribute}: {JSON.stringify(u.old_value)} &rarr; {JSON.stringify(u.new_value)}
                              </div>
                            ))}
                          </div>
                        )}
                        {entry.moderatorNotes && (
                          <div style={{ marginTop: space[1] + 2, fontSize: typography.body.sm, color: colors.accent.amber }}>
                            Moderator: {entry.moderatorNotes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* UnitOrderCard modal — renders over everything when a unit is selected */}
      {selectedUnit && turnPhase === PHASES.PLANNING && (
        <UnitOrderCard
          unit={selectedUnit}
          terrainData={terrainData}
          allUnits={gs.units}
          actors={gs.scenario.actors}
          existingOrders={unitOrders[selectedUnit.actor]?.[selectedUnit.id] || null}
          targetingMode={targetingMode}
          onStartTargeting={handleStartTargeting}
          onCancelTargeting={handleCancelTargeting}
          onConfirm={handleOrderConfirm}
          onOrderPreview={handleOrderPreview}
          onClose={() => { setSelectedUnitId(null); setTargetingMode(null); }}
          onEmbark={handleEmbark}
          scaleTier={scaleTier}
          waypointCount={waypointBuffer.length}
          onClearWaypoints={() => setWaypointBuffer([])}
        />
      )}

      {/* Challenge ruling popup — shown at start of next turn after re-adjudication */}
      {pendingRuling && turnPhase === PHASES.PLANNING && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPendingRuling(null); }}
        >
          <div style={{
            width: 600, maxHeight: "80vh", overflow: "auto", padding: space[6],
            background: colors.bg.raised, borderRadius: radius.xl,
            border: `1px solid ${colors.border.default}`,
          }}>
            <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, marginBottom: space[3], color: colors.accent.cyan }}>
              Challenge Ruling
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[4], lineHeight: 1.5 }}>
              The adjudicator has issued a revised ruling in response to the challenge.
            </div>

            {pendingRuling.adjudication?.outcome_determination?.narrative && (
              <div style={{
                padding: space[4], marginBottom: space[4], borderRadius: radius.md,
                background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
                fontSize: typography.body.sm, lineHeight: 1.7, whiteSpace: "pre-wrap",
                maxHeight: 300, overflow: "auto",
              }}>
                {pendingRuling.adjudication.outcome_determination.narrative}
              </div>
            )}

            {/* Summary of state changes from the ruling */}
            {pendingRuling.adjudication?.state_updates?.length > 0 && (
              <div style={{ marginBottom: space[4] }}>
                <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, marginBottom: space[2], color: colors.text.secondary }}>
                  Key Changes
                </div>
                {pendingRuling.adjudication.state_updates.slice(0, 8).map((su, i) => (
                  <div key={i} style={{
                    fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.5,
                    padding: `${space[1]}px 0`, borderBottom: `1px solid ${colors.border.subtle}`,
                  }}>
                    <span style={{ fontWeight: typography.weight.medium, color: colors.text.primary }}>{su.entity}</span>
                    {su.position && <span> → {su.position}</span>}
                    {su.strength != null && <span> STR:{su.strength}</span>}
                    {su.morale != null && <span> MOR:{su.morale}</span>}
                    {su.justification && (
                      <div style={{ color: colors.text.muted, fontStyle: "italic", marginTop: 2 }}>
                        {su.justification.slice(0, 120)}{su.justification.length > 120 ? "..." : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={() => setPendingRuling(null)}>Continue</Button>
            </div>
          </div>
        </div>
      )}

      {/* Order validation warning modal */}
      {orderWarnings && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOrderWarnings(null); }}
        >
          <div style={{
            width: 520, maxHeight: "80vh", overflow: "auto", padding: space[6],
            background: colors.bg.raised, borderRadius: radius.xl,
            border: `1px solid ${colors.border.default}`,
          }}>
            <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, marginBottom: space[3], color: colors.accent.amber }}>
              Movement Warnings
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[4], lineHeight: 1.6 }}>
              The following orders exceed unit movement capabilities. Units will attempt to move as far as possible but likely won't reach their destinations.
            </div>

            {orderWarnings.map((w, i) => (
              <div key={i} style={{
                padding: space[3], marginBottom: space[2], borderRadius: radius.md,
                background: `${colors.accent.amber}10`,
                border: `1px solid ${colors.accent.amber}30`,
                fontSize: typography.body.sm, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: typography.weight.bold, color: colors.text.primary }}>
                  {w.unitName}
                </div>
                <div style={{ color: colors.text.secondary }}>
                  {w.from} → {w.to} — {w.distanceHexes} hexes, budget {w.budget} ({w.movementType})
                </div>
                <div style={{ color: colors.accent.amber, fontWeight: typography.weight.medium }}>
                  {w.feasibility === "INFEASIBLE" ? "Impossible" : "Unlikely"} — cost {w.totalCost.toFixed(1)} vs budget {w.budget}
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end", marginTop: space[4] }}>
              <Button variant="secondary" onClick={() => setOrderWarnings(null)}>Revise Orders</Button>
              <Button variant="primary" onClick={handleForceSubmit}>Submit Anyway</Button>
            </div>
          </div>
        </div>
      )}

      {/* M11: Out-of-range warning modal */}
      {rangeWarning && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRangeWarning(null);
              // Stay in targeting mode so user can pick a different hex
            }
          }}
        >
          <div style={{
            width: 440, padding: space[6],
            background: colors.bg.raised, borderRadius: radius.xl,
            border: `1px solid ${colors.border.default}`,
          }}>
            <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, marginBottom: space[3], color: colors.accent.red }}>
              Target Out of Range
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3], lineHeight: 1.6 }}>
              <strong>{rangeWarning.unit.name}</strong> cannot reach{" "}
              <strong>{positionToLabel(rangeWarning.targetStr)}</strong> with {rangeWarning.orderType}.
            </div>
            <div style={{
              padding: space[3], marginBottom: space[3], borderRadius: radius.md,
              background: `${colors.accent.red}10`, border: `1px solid ${colors.accent.red}30`,
              fontSize: typography.body.sm, lineHeight: 1.6,
            }}>
              <div>Distance: {rangeWarning.range.hexes} hexes ({rangeWarning.range.km.toFixed(1)} km)</div>
              <div>Max range: {rangeWarning.range.rangeKm?.max?.toFixed(1) || "?"} km</div>
              <div>Firing from: {positionToLabel(rangeWarning.effectivePos)}</div>
            </div>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[4] }}>
              Submitting an out-of-range order will flag it as highly improbable for the adjudicator.
            </div>
            <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => {
                setRangeWarning(null);
                // Stay in targeting mode to pick a different hex
              }}>Pick Different Target</Button>
              <Button variant="primary" onClick={() => {
                applyTarget(rangeWarning.unit, rangeWarning.orderType, rangeWarning.targetStr, true);
                setRangeWarning(null);
                setTargetingMode(null);
              }}>Issue Anyway</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatSimDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = d.getUTCDate();
  const mon = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return `${day} ${mon} ${year}`;
  }
  return `${day} ${mon} ${year} ${hh}:${mm}`;
}

// Small dropdown for briefing export — per-actor or full
function BriefingDropdown({ actors, onExport }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
        Briefing {open ? "▲" : "▼"}
      </Button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 2, zIndex: 100,
          background: colors.bg.raised, border: `1px solid ${colors.border.subtle}`,
          borderRadius: radius.md, padding: space[1], minWidth: 140,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          {actors.map(a => (
            <div key={a.id}
              onClick={() => { onExport(a.id); setOpen(false); }}
              style={{
                padding: `${space[1]}px ${space[2]}px`, fontSize: typography.body.sm,
                color: colors.text.secondary, cursor: "pointer", borderRadius: radius.sm,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colors.bg.surface; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              {a.name}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${colors.border.subtle}`, margin: `${space[1]}px 0` }} />
          <div
            onClick={() => { onExport(null); setOpen(false); }}
            style={{
              padding: `${space[1]}px ${space[2]}px`, fontSize: typography.body.sm,
              color: colors.accent.amber, cursor: "pointer", borderRadius: radius.sm, fontWeight: typography.weight.semibold,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = colors.bg.surface; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            Full Brief
          </div>
        </div>
      )}
    </div>
  );
}

function formatEnvironmentBrief(env) {
  if (!env) return "";
  const parts = [];
  if (env.climate && env.climate !== "temperate") parts.push(env.climate);
  if (env.weather && env.weather !== "clear") parts.push(env.weather);
  if (env.visibility && env.visibility !== "good" && env.visibility !== "unlimited") parts.push(`vis: ${env.visibility}`);
  if (env.groundCondition && env.groundCondition !== "dry") parts.push(env.groundCondition.replace(/_/g, " "));
  if (env.timeOfDay) parts.push(env.timeOfDay);
  return parts.length > 0 ? parts.join(" · ") : "";
}
