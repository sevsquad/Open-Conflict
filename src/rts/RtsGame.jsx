import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button, Badge, Card } from "../components/ui.jsx";
import { colors, radius, shadows, space, typography } from "../theme.js";
import SimMap from "../simulation/SimMap.jsx";
import { autosave, saveGameState } from "../simulation/orchestrator.js";
import { cellToDisplayString, cellToPositionString, getUnitFogTier, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { computeRtsDisplayState, createRtsCommand, reduceRtsCommand, tickRtsMatch } from "./rtsEngine.js";

const AI_LOG_MODE_STANDARD = "standard";
const AI_LOG_MODE_SUMMARY = "llm_summary";
const AI_LOG_MODE_FULL_DIARY = "full_diary";
const DIARY_PREVIEW_LIMIT = 40;

function cloneRtsState(state) {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

function serializeAiSummaryState(summaryState) {
  if (!summaryState) return { current: null, history: [] };
  return {
    current: summaryState.current ? omitSummarySignature(summaryState.current) : null,
    history: Array.isArray(summaryState.history)
      ? summaryState.history.map(omitSummarySignature)
      : [],
  };
}

function omitSummarySignature(summary) {
  if (!summary) return summary;
  const { signature, ...rest } = summary;
  return rest;
}

async function saveRtsArtifacts(state) {
  const folder = state?.game?.folder;
  if (!folder) return;
  const aiLogMode = state?.scenario?.rtsOptions?.aiLogMode || AI_LOG_MODE_STANDARD;
  const artifacts = [
    ["rts_replay_latest.json", state.replay || {}],
    ["rts_telemetry_latest.json", state.telemetry || {}],
    ["rts_ai_trace_latest.json", state.ai?.decisionLog || []],
    ["rts_perception_latest.json", state.perceptionState || {}],
    ["rts_ai_summary_latest.json", {
      mode: aiLogMode,
      actors: Object.fromEntries(
        Object.entries(state.ai?.summaries || {}).map(([actorId, summaryState]) => [actorId, serializeAiSummaryState(summaryState)])
      ),
    }],
    ["rts_ai_diary_latest.json", {
      mode: aiLogMode,
      entryCount: state.ai?.diary?.length || 0,
      entries: state.ai?.diary || [],
    }],
  ];
  await Promise.all(artifacts.map(async ([filename, data]) => {
    const response = await fetch("/api/game/save-artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, filename, data }),
    });
    if (!response.ok) {
      throw new Error(`Failed to save artifact ${filename}: ${response.statusText}`);
    }
  }));
}

function rtsReducer(state, action) {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "tick":
      return tickRtsMatch(state, action.terrainData);
    case "step":
      {
        const stepped = tickRtsMatch(
          { ...state, game: { ...state.game, paused: false } },
          action.terrainData
        );
        return { ...stepped, game: { ...stepped.game, paused: true } };
      }
    case "command":
      {
        const next = reduceRtsCommand(state, action.terrainData, action.command, action.source || "player");
        return {
          ...next,
          game: {
            ...next.game,
            commandSeq: Math.max(next.game?.commandSeq || 0, action.sequence || 0),
          },
        };
      }
    case "setPaused":
      return { ...state, game: { ...state.game, paused: action.paused } };
    case "setSpeed":
      return { ...state, game: { ...state.game, speed: action.speed } };
    case "ackAutosave":
      return { ...state, game: { ...state.game, autosaveSeq: action.seq } };
    default:
      return state;
  }
}

export default function RtsGame({ onBack, gameState, terrainData, terrainError, onUpdateGameState }) {
  const [matchState, dispatch] = useReducer(rtsReducer, gameState);
  const [selectedUnitIds, setSelectedUnitIds] = useState([]);
  const [focusedUnitId, setFocusedUnitId] = useState(null);
  const [hoverCell, setHoverCell] = useState(null);
  const [commandMode, setCommandMode] = useState(null);
  const [replayCursor, setReplayCursor] = useState(-1);
  const mapRef = useRef(null);
  const matchRef = useRef(matchState);
  const autosaveClockRef = useRef(Date.now());
  const pauseRef = useRef(matchState.game?.paused ?? true);
  const winnerRef = useRef(matchState.game?.winner ?? null);
  const commandSeqRef = useRef(matchState.game?.commandSeq || 0);

  const actors = matchState.scenario?.actors || [];
  const aiActors = actors.filter((actor) => actor.controller === "ai");
  const aiLogMode = matchState.scenario?.rtsOptions?.aiLogMode || AI_LOG_MODE_STANDARD;
  const summaryModeEnabled = aiLogMode === AI_LOG_MODE_SUMMARY || aiLogMode === AI_LOG_MODE_FULL_DIARY;
  const diaryModeEnabled = aiLogMode === AI_LOG_MODE_FULL_DIARY;
  const playerActorId = actors.find((actor) => actor.controller === "player")?.id || null;
  const [viewActorId, setViewActorId] = useState(playerActorId || actors[0]?.id || null);
  const [debugVisibility, setDebugVisibility] = useState(matchState.scenario?.rtsOptions?.debugVisibility || (playerActorId ? "player" : "spectator"));
  const [showThoughts, setShowThoughts] = useState(aiActors.length > 0);

  useEffect(() => {
    dispatch({ type: "hydrate", state: gameState });
  }, [gameState?.game?.id]);

  useEffect(() => {
    matchRef.current = matchState;
    commandSeqRef.current = matchState.game?.commandSeq || commandSeqRef.current || 0;
    onUpdateGameState?.(matchState);
  }, [matchState, onUpdateGameState]);

  useEffect(() => {
    const liveActors = new Set(actors.map((actor) => actor.id));
    if (!liveActors.has(viewActorId)) {
      setViewActorId(playerActorId || actors[0]?.id || null);
    }
  }, [actors, playerActorId, viewActorId]);

  useEffect(() => {
    if (aiActors.length === 0) {
      setShowThoughts(false);
    }
  }, [aiActors.length]);

  useEffect(() => {
    setSelectedUnitIds((current) => current.filter((unitId) => {
      const unit = matchState.units.find((candidate) => candidate.id === unitId);
      return unit && unit.status !== "destroyed";
    }));
  }, [matchState.units]);

  const activeViewActorId = debugVisibility === "spectator" ? viewActorId : (playerActorId || viewActorId);
  const displayState = useMemo(
    () => computeRtsDisplayState(matchState, activeViewActorId, debugVisibility),
    [activeViewActorId, debugVisibility, matchState]
  );

  const selectedUnits = useMemo(
    () => matchState.units.filter((unit) => selectedUnitIds.includes(unit.id)),
    [matchState.units, selectedUnitIds]
  );
  const focusedUnit = matchState.units.find((unit) => unit.id === focusedUnitId) || selectedUnits[0] || null;
  const vpControl = Object.fromEntries(
    Object.entries(matchState.truthState?.objectives || {}).map(([hex, control]) => [hex, control.controller])
  );
  const holdMsRequired = (matchState.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
  const vpZoneOutlines = useMemo(
    () => matchState.scenario?.zoneModel?.vpZoneOutlines || [],
    [matchState.scenario?.zoneModel]
  );
  const vpHoldProgress = useMemo(() => {
    if (holdMsRequired <= 0) return null;
    const out = {};
    for (const [hex, record] of Object.entries(matchState.truthState?.objectives || {})) {
      const candidateActive = record?.candidateController && (!record?.controller || record.candidateController !== record.controller);
      const held = candidateActive ? (record?.candidateHeldMs || 0) : (record?.heldMs || 0);
      if (held <= 0) continue;
      out[hex] = {
        progress: Math.max(0, Math.min(1, held / holdMsRequired)),
        controller: candidateActive ? record?.candidateController : (record?.controller || null),
        heldMs: held,
        requiredMs: holdMsRequired,
      };
    }
    return out;
  }, [matchState.truthState?.objectives, holdMsRequired]);
  const actorScores = useMemo(() => {
    const scores = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
    for (const objective of matchState.scenario?.objectives?.hexVP || []) {
      const controller = matchState.truthState?.objectives?.[objective.hex]?.controller;
      if (controller) scores[controller] = (scores[controller] || 0) + (objective.vp || 10);
    }
    return scores;
  }, [actors, matchState.scenario?.objectives?.hexVP, matchState.truthState?.objectives]);
  const unitsById = useMemo(
    () => Object.fromEntries((matchState.units || []).map((unit) => [unit.id, unit])),
    [matchState.units]
  );
  const activePerception = useMemo(
    () => matchState.perceptionState?.[activeViewActorId] || { detectedUnits: [], contactUnits: [], lastKnown: {} },
    [activeViewActorId, matchState.perceptionState]
  );
  const focusedFogTier = focusedUnit ? getUnitFogTier(focusedUnit, displayState.fowMode) : null;
  const focusedMemory = focusedUnit ? activePerception.lastKnown?.[focusedUnit.id] || null : null;
  const focusedAssignment = focusedUnit
    ? matchState.ai?.subordinates?.[focusedUnit.actor]?.assignments?.[focusedUnit.id] || null
    : null;
  const visibleRecentEvents = useMemo(() => {
    const events = matchState.truthState?.eventLog || [];
    if (!displayState.fowMode) {
      return events.slice(-10).reverse();
    }
    const knownEnemyIds = new Set([
      ...(activePerception.detectedUnits || []),
      ...(activePerception.contactUnits || []),
      ...Object.keys(activePerception.lastKnown || {}),
    ]);
    return events
      .filter((entry) => {
        const details = entry.details || {};
        const unitIds = [details.unitId, details.attackerId, details.targetId].filter(Boolean);
        if (details.actorId === activeViewActorId) return true;
        if (unitIds.length === 0) return false;
        return unitIds.some((unitId) => {
          const actorId = unitsById[unitId]?.actor;
          return actorId === activeViewActorId || knownEnemyIds.has(unitId);
        });
      })
      .map((entry) => sanitizeEventForView(entry, activeViewActorId, displayState.fowMode, unitsById))
      .slice(-10)
      .reverse();
  }, [activePerception, activeViewActorId, displayState.fowMode, matchState.truthState?.eventLog, unitsById]);
  const visibleAiTrace = useMemo(() => {
    const trace = matchState.ai?.decisionLog || [];
    if (debugVisibility === "spectator") {
      return trace.slice(-8).reverse();
    }
    return trace.filter((entry) => entry.actorId === activeViewActorId).slice(-8).reverse();
  }, [activeViewActorId, debugVisibility, matchState.ai?.decisionLog]);
  const visibleAiSummaries = useMemo(() => {
    const summaries = Object.values(matchState.ai?.summaries || {})
      .map((summaryState) => summaryState?.current || null)
      .filter(Boolean);
    if (debugVisibility === "spectator") {
      return summaries.sort((left, right) => left.actorName.localeCompare(right.actorName));
    }
    return summaries.filter((entry) => entry.actorId === activeViewActorId);
  }, [activeViewActorId, debugVisibility, matchState.ai?.summaries]);
  const visibleAiDiary = useMemo(() => {
    const diary = matchState.ai?.diary || [];
    const filtered = debugVisibility === "spectator"
      ? diary
      : diary.filter((entry) => !entry.actorId || entry.actorId === activeViewActorId);
    return filtered.slice(-DIARY_PREVIEW_LIMIT).reverse();
  }, [activeViewActorId, debugVisibility, matchState.ai?.diary]);
  const aiStateRows = useMemo(() => {
    return actors
      .filter((actor) => actor.controller === "ai")
      .map((actor) => {
        const directorState = matchState.ai?.directors?.[actor.id] || {};
        const packet = directorState.packet || null;
        const commanderState = matchState.ai?.commanders?.[actor.id] || {};
        const subordinateState = matchState.ai?.subordinates?.[actor.id] || {};
        const executorState = matchState.ai?.executors?.[actor.id] || {};
        const assignments = Object.values(subordinateState.assignments || {});
        const reserveHeld = matchState.units.filter((unit) => unit.actor === actor.id && unit.modeState?.reserveState === "held").length;
        const perception = matchState.perceptionState?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
        return {
          actorId: actor.id,
          actorName: actor.name,
          primaryZones: (packet?.suggestedAxes || []).map((entry) => entry.zoneId || entry).filter(Boolean),
          secondaryZones: packet?.secondaryZones || [],
          supportingZones: (packet?.supportingAxes || packet?.supportingZones || []).map((entry) => entry.zoneId || entry).filter(Boolean),
          campaignObjectives: (packet?.campaignObjectives || []).map((entry) => entry.zoneId || entry).filter(Boolean),
          frontageIntent: packet?.frontageIntent || "balanced",
          pressure: packet?.pressureAssessment || packet?.pressure || "none",
          packages: packet?.activePackages || [],
          packageWeights: packet?.packageWeights || {},
          replanReasons: commanderState.lastReplanReasons || [],
          ownerCount: Object.keys(subordinateState.owners || {}).length,
          taskCount: Object.values(subordinateState.taskQueues || {}).reduce((sum, queue) => sum + (queue?.length || 0), 0),
          zoneTaskCount: Object.values(commanderState.ownerZoneTasks || {}).filter(Boolean).length,
          parentAssignments: assignments.filter((assignment) => assignment.source === "parentHQ").length,
          sectorAssignments: assignments.filter((assignment) => assignment.source === "sector").length,
          reserveHeld,
          detected: perception.detectedUnits?.length || 0,
          contacts: perception.contactUnits?.length || 0,
          memories: Object.keys(perception.lastKnown || {}).length,
          executorReactions: executorState.reactions?.length || 0,
          hypotheses: commanderState.hypotheses || null,
        };
      });
  }, [actors, matchState.ai?.commanders, matchState.ai?.directors, matchState.ai?.executors, matchState.ai?.subordinates, matchState.perceptionState, matchState.units]);
  const aiThoughtRows = useMemo(() => {
    return aiActors.map((actor) => {
      const thoughtState = matchState.ai?.thoughts?.[actor.id] || {};
      const commander = thoughtState.commander || null;
      const director = thoughtState.director || null;
      return {
        actorId: actor.id,
        actorName: actor.name,
        commander,
        director,
        updatedAtMs: Math.max(commander?.atMs || 0, director?.atMs || 0),
      };
    });
  }, [aiActors, matchState.ai?.thoughts]);
  const subordinateOwnershipRows = useMemo(() => {
    return actors
      .filter((actor) => actor.controller === "ai")
      .flatMap((actor) => {
        const subordinateState = matchState.ai?.subordinates?.[actor.id] || {};
        return Object.values(subordinateState.reports || {}).map((report) => ({
          ...report,
          actorId: actor.id,
          actorName: actor.name,
          groupPlan: subordinateState.groupPlans?.[report.owner] || null,
        }));
      });
  }, [actors, matchState.ai?.subordinates]);
  const replaySnapshots = matchState.replay?.snapshots || [];
  useEffect(() => {
    if (replaySnapshots.length === 0) {
      setReplayCursor(-1);
      return;
    }
    setReplayCursor((current) => (
      current < 0 || current >= replaySnapshots.length
        ? replaySnapshots.length - 1
        : current
    ));
  }, [replaySnapshots.length]);
  const activeReplaySnapshot = replaySnapshots[replayCursor >= 0 ? replayCursor : replaySnapshots.length - 1] || null;
  const replayReview = useMemo(() => {
    if (!activeReplaySnapshot) return null;
    const perceptionSnapshot = findNearestTelemetrySnapshot(matchState.telemetry?.perceptionSnapshots || [], activeReplaySnapshot.atMs);
    const directorPackets = findDirectorPacketsForSnapshot(matchState.telemetry?.directorPackets || [], activeReplaySnapshot.atMs);
    const decisionWindow = (matchState.ai?.decisionLog || [])
      .filter((entry) => Math.abs((entry.atMs || 0) - activeReplaySnapshot.atMs) <= 2000)
      .slice(-8)
      .reverse();
    const eventWindow = (matchState.replay?.events || [])
      .filter((entry) => Math.abs((entry.atMs || 0) - activeReplaySnapshot.atMs) <= 2000)
      .slice(-6)
      .reverse();
    return {
      snapshot: activeReplaySnapshot,
      perceptionSnapshot,
      directorPackets,
      decisionWindow,
      eventWindow,
    };
  }, [activeReplaySnapshot, matchState.ai?.decisionLog, matchState.replay?.events, matchState.telemetry?.directorPackets, matchState.telemetry?.perceptionSnapshots]);

  useEffect(() => {
    if (terrainError) return;
    if (matchState.game?.paused || matchState.game?.winner || !terrainData) return;
    let rafId = 0;
    let last = performance.now();
    let accumulator = 0;

    const frame = (now) => {
      const delta = now - last;
      last = now;
      accumulator += delta * (matchRef.current.game?.speed || 1);
      const tickMs = matchRef.current.game?.tickMs || 250;
      while (accumulator >= tickMs) {
        dispatch({ type: "tick", terrainData });
        accumulator -= tickMs;
      }
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [matchState.game?.paused, matchState.game?.speed, matchState.game?.tickMs, matchState.game?.winner, terrainData, terrainError]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const snapshotBase = matchRef.current;
      if (!snapshotBase || snapshotBase.game?.paused || snapshotBase.game?.winner) return;
      const now = Date.now();
      if (now - autosaveClockRef.current < 30000) return;
      const snapshot = cloneRtsState(snapshotBase);
      snapshot.game.autosaveSeq = (snapshot.game.autosaveSeq || 0) + 1;
      dispatch({ type: "ackAutosave", seq: snapshot.game.autosaveSeq });
      Promise.all([
        autosave(snapshot),
        saveRtsArtifacts(snapshot),
      ]).catch((error) => console.error("[rts] autosave failed:", error));
      autosaveClockRef.current = now;
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pauseRef.current && matchState.game?.paused) {
      const snapshot = cloneRtsState(matchState);
      Promise.all([
        saveGameState(snapshot),
        saveRtsArtifacts(snapshot),
      ]).catch((error) => console.error("[rts] save-on-pause failed:", error));
    }
    pauseRef.current = matchState.game?.paused;
  }, [matchState]);

  useEffect(() => {
    if (!winnerRef.current && matchState.game?.winner) {
      const snapshot = cloneRtsState(matchState);
      Promise.all([
        saveGameState(snapshot),
        saveRtsArtifacts(snapshot),
      ]).catch((error) => console.error("[rts] save-on-end failed:", error));
    }
    winnerRef.current = matchState.game?.winner;
  }, [matchState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === " ") {
        event.preventDefault();
        dispatch({ type: "setPaused", paused: !matchRef.current.game.paused });
      } else if (event.key === "." && matchRef.current.game.paused && terrainData) {
        event.preventDefault();
        dispatch({ type: "step", terrainData });
      } else if (event.key === "1") {
        dispatch({ type: "setSpeed", speed: 1 });
      } else if (event.key === "2") {
        dispatch({ type: "setSpeed", speed: 2 });
      } else if (event.key === "4") {
        dispatch({ type: "setSpeed", speed: 4 });
      } else if (event.key === "Escape") {
        setCommandMode(null);
      } else if (event.key.toLowerCase() === "c" && selectedUnitIds.length > 0) {
        centerOnSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedUnitIds]);

  const centerOnSelection = useCallback(() => {
    const targetId = selectedUnitIds[0];
    if (!targetId) return;
    const pos = displayState.unitPositions?.[targetId];
    if (!pos) return;
    mapRef.current?.getMapView?.()?.panTo?.(pos.c, pos.r);
  }, [displayState.unitPositions, selectedUnitIds]);

  const issueCommand = useCallback((kind, options = {}) => {
    if (selectedUnitIds.length === 0 || !terrainData) return;
    const nextSequence = (commandSeqRef.current || 0) + 1;
    commandSeqRef.current = nextSequence;
    const queueSlot = Number(options.queueSlot) === 1 ? 1 : 0;
    const command = createRtsCommand({
      unitIds: selectedUnitIds,
      kind,
      targetHex: options.targetHex || null,
      targetUnitId: options.targetUnitId || null,
      queueSlot,
    }, `${matchRef.current.game?.elapsedMs || 0}_${String(nextSequence).padStart(6, "0")}`);
    dispatch({ type: "command", terrainData, command, source: "player", sequence: nextSequence });
    if (!queueSlot) {
      setCommandMode(null);
    }
  }, [selectedUnitIds, terrainData]);

  const handleOverlayUnitClick = useCallback((unit, event) => {
    setFocusedUnitId(unit.id);
    if (unit?.__fogTier === "contact") return;
    if (playerActorId && unit.actor === playerActorId) {
      setSelectedUnitIds((current) => {
        if (event.shiftKey) {
          return current.includes(unit.id)
            ? current.filter((id) => id !== unit.id)
            : [...current, unit.id];
        }
        return [unit.id];
      });
    }
  }, [playerActorId]);

  const handleCellClick = useCallback((cell, event) => {
    if (!cell) return;
    if (!event.shiftKey) {
      setFocusedUnitId(null);
    }
  }, []);

  const handleSelectionBox = useCallback(({ startCell, endCell, append }) => {
    if (!playerActorId || !startCell || !endCell) return;
    const minCol = Math.min(startCell.c, endCell.c);
    const maxCol = Math.max(startCell.c, endCell.c);
    const minRow = Math.min(startCell.r, endCell.r);
    const maxRow = Math.max(startCell.r, endCell.r);
    const ids = matchState.units
      .filter((unit) => unit.actor === playerActorId && unit.status !== "destroyed")
      .filter((unit) => {
        const pos = displayState.unitPositions?.[unit.id];
        if (!pos) return false;
        return pos.c >= minCol && pos.c <= maxCol && pos.r >= minRow && pos.r <= maxRow;
      })
      .map((unit) => unit.id);
    setSelectedUnitIds((current) => append ? Array.from(new Set([...current, ...ids])) : ids);
    if (ids[0]) setFocusedUnitId(ids[0]);
  }, [displayState.unitPositions, matchState.units, playerActorId]);

  const handleContextCommand = useCallback((cell, event, hitUnit) => {
    if (!cell) return;
    if (playerActorId && hitUnit?.actor === playerActorId && selectedUnitIds.length === 0) {
      setSelectedUnitIds([hitUnit.id]);
      setFocusedUnitId(hitUnit.id);
      return;
    }
    if (!playerActorId || selectedUnitIds.length === 0) return;

    if (commandMode === "embark_helo" && hitUnit?.actor === playerActorId) {
      issueCommand("embark_helo", { targetUnitId: hitUnit.id, targetHex: cellToPositionString(cell.c, cell.r) });
      return;
    }

    if (commandMode === "disembark_helo") {
      issueCommand("disembark_helo", { targetHex: cellToPositionString(cell.c, cell.r) });
      return;
    }

    const targetHex = cellToPositionString(cell.c, cell.r);
    const queueSlot = event.shiftKey ? 1 : 0;
    if (hitUnit?.__fogTier === "contact") {
      issueCommand(commandMode || "attack_move", { targetHex, queueSlot });
      return;
    }
    if (hitUnit && hitUnit.actor !== playerActorId) {
      issueCommand(commandMode || "attack_move", { targetHex, targetUnitId: hitUnit.id, queueSlot });
      return;
    }

    issueCommand(commandMode || "move", { targetHex, queueSlot });
  }, [commandMode, issueCommand, playerActorId, selectedUnitIds.length]);

  const handleManualSave = useCallback(async () => {
    try {
      const snapshot = cloneRtsState(matchRef.current);
      await Promise.all([
        saveGameState(snapshot),
        saveRtsArtifacts(snapshot),
      ]);
    } catch (error) {
      alert(`Save failed: ${error.message}`);
    }
  }, []);

  const handleBack = useCallback(async () => {
    try {
      const snapshot = cloneRtsState(matchRef.current);
      await Promise.all([
        saveGameState(snapshot),
        saveRtsArtifacts(snapshot),
      ]);
    } catch (error) {
      console.error("[rts] save-on-exit failed:", error);
    }
    onBack?.();
  }, [onBack]);

  const livingCounts = Object.fromEntries(actors.map((actor) => [
    actor.id,
    matchState.units.filter((unit) => unit.actor === actor.id && unit.status !== "destroyed").length,
  ]));

  if (!terrainData) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bg.base,
        color: colors.text.primary,
        fontFamily: typography.fontFamily,
        padding: space[6],
      }}>
        <Card accent={colors.accent.red} style={{ maxWidth: 640 }}>
          <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold, marginBottom: space[2] }}>
            RTS Terrain Unavailable
          </div>
          <div style={{ color: colors.text.secondary, lineHeight: 1.6, marginBottom: space[4] }}>
            {terrainError || "This RTS save loaded without terrain data, so the match can’t render."}
          </div>
          <Button onClick={handleBack}>Back to Setup</Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: colors.bg.base,
      color: colors.text.primary,
      fontFamily: typography.fontFamily,
    }}>
      <div style={{
        padding: `${space[2]}px ${space[4]}px`,
        borderBottom: `1px solid ${colors.border.subtle}`,
        display: "flex",
        alignItems: "center",
        gap: space[2],
        flexWrap: "wrap",
      }}>
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <span style={{ marginRight: 4 }}>&larr;</span> Back
        </Button>
	        <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>
	          {matchState.game?.name || "RTS Match"}
	        </div>
        <Badge color={colors.accent.red}>RTS Alpha</Badge>
        <Badge color={matchState.game?.paused ? colors.accent.blue : colors.accent.green}>
          {matchState.game?.paused ? "Paused" : "Live"}
        </Badge>
        <Badge color={colors.accent.amber}>{formatClock(matchState.game?.elapsedMs || 0)}</Badge>
        <Badge color={colors.accent.cyan}>{formatAiLogModeLabel(aiLogMode)}</Badge>
        {matchState.game?.winner && (
          <Badge color={colors.accent.green}>Winner: {actorLabel(actors, matchState.game.winner)}</Badge>
        )}
        <div style={{ flex: 1 }} />
        <select
          value={viewActorId || ""}
          onChange={(event) => setViewActorId(event.target.value)}
          style={toolbarSelectStyle()}
        >
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>{actor.name}</option>
          ))}
        </select>
        <select
          value={debugVisibility}
          onChange={(event) => setDebugVisibility(event.target.value)}
          style={toolbarSelectStyle()}
        >
          <option value="player">Player FOW</option>
          <option value="spectator">Spectator</option>
        </select>
	        <Button size="sm" variant={matchState.game?.paused ? "secondary" : "primary"} onClick={() => dispatch({ type: "setPaused", paused: !matchState.game.paused })}>
	          {matchState.game?.paused ? "Resume" : "Pause"}
	        </Button>
	        <Button size="sm" variant="ghost" disabled={!matchState.game?.paused || !terrainData} onClick={() => dispatch({ type: "step", terrainData })}>
	          Step
	        </Button>
	        {[1, 2, 4].map((speed) => (
          <Button
            key={speed}
            size="sm"
            variant={matchState.game?.speed === speed ? "secondary" : "ghost"}
            onClick={() => dispatch({ type: "setSpeed", speed })}
          >
            {speed}×
          </Button>
        ))}
        {aiActors.length > 0 && (
          <Button size="sm" variant={showThoughts ? "secondary" : "ghost"} onClick={() => setShowThoughts((current) => !current)}>
            Thoughts
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={handleManualSave}>Save</Button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
	        <div style={sidePanelStyle()}>
	          <Panel title="Situation">
	            {actors.map((actor) => (
	              <div key={actor.id} style={rowStyle()}>
	                <span>{actor.name}</span>
	                <span style={{ color: colors.text.secondary }}>
	                  {describeActorSituation(actor.id, {
	                    activeActorId: activeViewActorId,
	                    actorScores,
	                    activePerception,
	                    debugVisibility,
	                    livingCounts,
	                    unitsById,
	                  })}
	                </span>
	              </div>
	            ))}
          </Panel>

          <Panel title="Commands">
            <CommandRow
              active={commandMode}
              onSelect={setCommandMode}
              disabled={!playerActorId || selectedUnitIds.length === 0}
            />
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", marginTop: space[2] }}>
              <Button size="sm" variant="secondary" onClick={() => issueCommand("hold")} disabled={!playerActorId || selectedUnitIds.length === 0}>Hold</Button>
              <Button size="sm" variant="secondary" onClick={() => issueCommand("halt")} disabled={!playerActorId || selectedUnitIds.length === 0}>Halt</Button>
              <Button size="sm" variant="ghost" onClick={centerOnSelection} disabled={selectedUnitIds.length === 0}>Center</Button>
            </div>
	            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[2], lineHeight: 1.5 }}>
	              Left-click friendly units to select. Shift-drag selects multiple units. Right-click issues the active command, and Shift+right-click queues one follow-on order. `Space` pauses; `.` steps one tick; `1`, `2`, and `4` change speed.
	            </div>
	          </Panel>

          <Panel title="Objectives">
            {(matchState.scenario?.objectives?.hexVP || []).length === 0 ? (
              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>No VP hexes configured.</div>
            ) : (
              (matchState.scenario?.objectives?.hexVP || []).map((objective) => {
                const holdEntry = vpHoldProgress?.[objective.hex];
                const holdActive = holdMsRequired > 0 && holdEntry && holdEntry.progress > 0.001;
                const holdPct = holdActive ? Math.round(holdEntry.progress * 100) : 0;
                const holdColor = holdActive
                  ? (actors.find(a => a.id === holdEntry.controller)?.color || colors.text.muted)
                  : colors.text.muted;
                const heldSec = holdActive ? (holdEntry.heldMs / 1000).toFixed(1) : "0";
                const reqSec = holdMsRequired / 1000;
                return (
                  <div key={objective.hex} style={{ ...rowStyle(), alignItems: "flex-start", flexDirection: "column", gap: space[1] }}>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                      <div>
                        <div style={{ fontWeight: typography.weight.semibold }}>{objective.name || objective.hex}</div>
                        <div style={{ color: colors.text.muted, fontSize: typography.body.xs }}>{objective.hex}</div>
                      </div>
                      <div style={{ textAlign: "right", color: colors.text.secondary, fontSize: typography.body.xs }}>
                        <div>{objective.vp || 10} VP</div>
                        <div>{describeObjectiveControl(objective.hex, vpControl[objective.hex], activeViewActorId, displayState.fowMode, actors)}</div>
                      </div>
                    </div>
                    {holdMsRequired > 0 && (
                      <div style={{ width: "100%" }}>
                        <div style={{
                          height: 4,
                          background: "rgba(255,255,255,0.08)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${holdPct}%`,
                            height: "100%",
                            background: holdColor,
                            transition: "width 200ms linear",
                          }} />
                        </div>
                        <div style={{ color: colors.text.muted, fontSize: typography.body.xs, marginTop: 2 }}>
                          {holdActive ? `${heldSec}s / ${reqSec}s held` : `hold ${reqSec}s to capture`}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Panel>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <SimMap
              ref={mapRef}
              terrainData={terrainData}
              units={matchState.units}
              actors={actors}
              interactionMode="navigate"
              selectedUnitId={selectedUnitIds[0] || null}
              selectedUnitIds={selectedUnitIds}
              onCellClick={handleCellClick}
              onCellHover={setHoverCell}
              onContextCommand={handleContextCommand}
              onSelectionBox={handleSelectionBox}
              onOverlayUnitClick={handleOverlayUnitClick}
              fowMode={displayState.fowMode}
              rtsDisplayState={displayState}
              vpOverlayData={{
                hexVP: matchState.scenario?.objectives?.hexVP || [],
                vpControl: vpControl,
                holdProgress: vpHoldProgress,
                vpZoneOutlines,
              }}
            />
            {terrainError && (
              <div style={{
                position: "absolute",
                right: space[3],
                bottom: space[3],
                padding: `${space[2]}px ${space[3]}px`,
                background: colors.glow.red,
                border: `1px solid ${colors.accent.red}55`,
                borderRadius: radius.md,
                color: colors.text.primary,
                maxWidth: 360,
              }}>
                Terrain warning: {terrainError}
              </div>
            )}
            {commandMode && (
              <div style={{
                position: "absolute",
                left: space[3],
                top: space[3],
                padding: `${space[1]}px ${space[2]}px`,
                background: "rgba(0,0,0,0.78)",
                border: `1px solid ${colors.accent.red}55`,
                borderRadius: radius.sm,
                color: colors.text.primary,
                fontSize: typography.body.sm,
              }}>
                Right-click to issue: {commandMode.replace(/_/g, " ")}
              </div>
            )}
          </div>
          {showThoughts && aiThoughtRows.length > 0 && (
            <div style={{
              display: "flex",
              gap: space[3],
              padding: space[3],
              borderTop: `1px solid ${colors.border.subtle}`,
              background: colors.bg.surface,
              overflowX: "auto",
            }}>
              {aiThoughtRows.map((row, index) => (
                <ThoughtCard
                  key={row.actorId}
                  row={row}
                  elapsedMs={matchState.game?.elapsedMs || 0}
                  accent={THOUGHT_ACCENTS[index % THOUGHT_ACCENTS.length]}
                />
              ))}
            </div>
          )}
        </div>

	        <div style={sidePanelStyle()}>
	          <Panel title={selectedUnits.length > 1 ? `Selection (${selectedUnits.length})` : "Unit Card"}>
	            {focusedUnit ? (
	              <UnitCard
	                unit={focusedUnit}
	                actor={actors.find((actor) => actor.id === focusedUnit.actor)}
	                fogTier={focusedFogTier}
	                memory={focusedMemory}
	                assignment={focusedAssignment}
	                elapsedMs={matchState.game?.elapsedMs || 0}
	                activeActorId={activeViewActorId}
	                debugVisibility={debugVisibility}
	              />
	            ) : (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                Select a unit to inspect its readiness, morale, supply, and current command.
              </div>
            )}
          </Panel>

          <Panel title="Selection">
            {selectedUnits.length === 0 ? (
              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>No units selected.</div>
            ) : (
              selectedUnits.map((unit) => (
                <div key={unit.id} style={{ ...rowStyle(), alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: typography.weight.semibold }}>{unit.name}</div>
                    <div style={{ color: colors.text.muted, fontSize: typography.body.xs }}>{unit.type} / {unit.modeState?.moraleState || unit.posture}</div>
                  </div>
                  <div style={{ textAlign: "right", color: colors.text.secondary, fontSize: typography.body.xs }}>
                    <div>{unit.position || "-"}</div>
                    <div>{unit.modeState?.currentCommand?.kind || "idle"}</div>
                  </div>
                </div>
              ))
            )}
          </Panel>

	          <Panel title="Recent Events">
	            {visibleRecentEvents.map((entry, index) => (
	              <div key={`${entry.atMs}_${index}`} style={{ marginBottom: space[2], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                <span style={{ color: colors.accent.amber, fontFamily: typography.monoFamily }}>{formatClock(entry.atMs)}</span>{" "}
	                {entry.message}
	              </div>
	            ))}
	          </Panel>

	          <Panel title="AI State">
	            {debugVisibility !== "spectator" ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                Spectator mode reveals the commander, subordinate, reserve, and perception panels without feeding that data back into gameplay.
	              </div>
	            ) : (
	              aiStateRows.map((row) => (
	                <div key={row.actorId} style={{ marginBottom: space[2], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>{row.actorName}</div>
	                  <div>Director assessment: {row.pressure} {row.primaryZones.length > 0 ? `with suggested axis ${formatZoneList(matchState, row.primaryZones)}` : "across the current front"}</div>
	                  <div>Campaign objective: {row.campaignObjectives.length > 0 ? formatZoneList(matchState, row.campaignObjectives) : "none"}</div>
	                  <div>Support axes: {row.supportingZones.length > 0 ? formatZoneList(matchState, row.supportingZones) : row.secondaryZones.length > 0 ? formatZoneList(matchState, row.secondaryZones) : "none"}</div>
	                  <div>Frontage intent: {row.frontageIntent}</div>
	                  <div>Packages: {row.packages.length > 0 ? row.packages.join(", ") : "baseline"}</div>
	                  <div>Assignments: {row.parentAssignments} HQ-linked / {row.sectorAssignments} sector / {row.ownerCount} owners</div>
	                  <div>Commander tasks: {row.taskCount} / replan triggers: {row.replanReasons.join(", ") || "steady-state"}</div>
	                  <div>Reserve held: {row.reserveHeld}</div>
	                  <div>Zone-role plans: {row.zoneTaskCount}</div>
	                  <div>Executor reactions: {row.executorReactions}</div>
	                  <div>Perception: {row.detected} detected / {row.contacts} contacts / {row.memories} last-known</div>
	                  {row.hypotheses && (
	                    <div style={{ marginTop: 4 }}>
	                      Hypothesis: {row.hypotheses.uncontrolledObjectives?.length || 0} uncontrolled objectives / reserve {row.hypotheses.reserveRelease ? "released" : "held"} / currentOperation {row.hypotheses.currentOperation?.goalZoneId ? formatZoneList(matchState, [row.hypotheses.currentOperation.goalZoneId]) : "none"} / suggested {row.hypotheses.directorSuggestedAxes?.length ? formatZoneList(matchState, row.hypotheses.directorSuggestedAxes) : "none"} / support {row.hypotheses.directorSupportingAxes?.length ? formatZoneList(matchState, row.hypotheses.directorSupportingAxes) : "none"} / planned {row.hypotheses.plannedZones?.length ? formatZoneList(matchState, row.hypotheses.plannedZones) : "none"}
	                    </div>
	                  )}
	                </div>
	              ))
	            )}
	          </Panel>

	          <Panel title="Subordinate Ownership">
	            {debugVisibility !== "spectator" ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                Spectator mode unlocks subordinate ownership, local task state, and group reports.
	              </div>
	            ) : subordinateOwnershipRows.length === 0 ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                No subordinate reports recorded yet.
	              </div>
	            ) : (
	              subordinateOwnershipRows.map((row) => (
	                <div key={`${row.actorId}_${row.owner}`} style={{ marginBottom: space[2], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>{row.actorName} / {row.owner}</div>
	                  <div>{row.source} owner / {row.unitCount} units / {row.readyUnits} idle</div>
	                  <div>{row.activeTaskKind ? `Task: ${row.activeTaskKind} in ${formatZone(matchState, row.zoneId)}` : "Task: idle"}</div>
	                  <div>{row.edgeId ? `Edge: ${formatEdge(matchState, row.edgeId)}` : "Edge: local"} / {row.laneId ? `Lane: ${row.laneId}` : row.edgeId ? "Lane: pending" : "Lane: local"}</div>
	                  {row.groupPlan && (
	                    <div>
	                      Plan: stage {formatHex(row.groupPlan.stagingHex)} / assault {formatHex(row.groupPlan.assaultHex)} / fallback {formatHex(row.groupPlan.fallbackHex)} / route {formatRoutePreview(row.groupPlan.route)}
	                    </div>
	                  )}
	                  {row.groupPlan?.terrainIntent && (
	                    <div>
	                      Terrain intent: {row.groupPlan.terrainIntent.preferred} ({row.groupPlan.terrainIntent.ownerType}, {row.groupPlan.terrainIntent.anchorTerrain})
	                    </div>
	                  )}
	                  <div>Status: {row.status} / visible enemies {row.visibleEnemies} / reserve held {row.reserveHeld}</div>
	                  <div>{row.summary}</div>
	                </div>
	              ))
	            )}
	          </Panel>

          {summaryModeEnabled && (
	            <Panel title="AI Summary">
	              {debugVisibility !== "spectator" ? (
	                <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                  Spectator mode unlocks the prompt-ready AI summaries for every computer-controlled force.
	                </div>
	              ) : visibleAiSummaries.length === 0 ? (
	                <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                  No AI summaries recorded yet.
	                </div>
	              ) : (
	                visibleAiSummaries.map((entry) => (
	                  <div key={`${entry.actorId}_${entry.atMs}`} style={{ marginBottom: space[3], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.5 }}>
	                    <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>
	                      {entry.actorName} / {entry.profile} / {formatClock(entry.atMs)}
	                    </div>
	                    <div style={{ whiteSpace: "pre-wrap" }}>{entry.text}</div>
	                  </div>
	                ))
	              )}
	            </Panel>
          )}

	          <Panel title="AI Trace">
	            {visibleAiTrace.length === 0 ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                {debugVisibility === "spectator" ? "No AI decisions recorded yet." : "Switch to spectator mode to inspect full AI reasoning without leaking it into player view."}
	              </div>
	            ) : (
	              visibleAiTrace.map((entry, index) => (
	                <div key={`${entry.atMs}_${index}`} style={{ marginBottom: space[2], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <span style={{ color: colors.accent.cyan }}>{entry.provenance}</span>{" "}
	                  {entry.summary}
	                </div>
	              ))
	            )}
	          </Panel>

          {diaryModeEnabled && (
	            <Panel title="AI Diary">
	              {debugVisibility !== "spectator" ? (
	                <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                  Spectator mode unlocks the full AI diary without leaking extra battlefield knowledge into player view.
	                </div>
	              ) : visibleAiDiary.length === 0 ? (
	                <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                  No AI diary entries recorded yet.
	                </div>
	              ) : (
	                visibleAiDiary.map((entry, index) => (
	                  <div key={`${entry.atMs}_${entry.kind}_${index}`} style={{ marginBottom: space[2], fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                    <span style={{ color: colors.accent.amber, fontFamily: typography.monoFamily }}>{formatClock(entry.atMs)}</span>{" "}
	                    <span style={{ color: colors.accent.cyan }}>{formatDiaryKind(entry.kind)}</span>{" "}
	                    <span style={{ color: colors.text.primary }}>
	                      {entry.actorId ? `${actorLabel(actors, entry.actorId)}:` : "Global:"}
	                    </span>{" "}
	                    {entry.summary}
	                  </div>
	                ))
	              )}
	            </Panel>
          )}

	          <Panel title="Replay Review">
	            {debugVisibility !== "spectator" ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                Pause and step the match for player-safe inspection. Spectator mode unlocks the saved replay snapshot feed.
	              </div>
	            ) : !replayReview ? (
	              <div style={{ color: colors.text.muted, fontSize: typography.body.sm }}>
	                No replay snapshots recorded yet.
	              </div>
	            ) : (
	              <div style={{ display: "grid", gap: space[2] }}>
	                <div style={{ display: "flex", gap: space[2], alignItems: "center" }}>
	                  <Button size="sm" variant="ghost" disabled={replayCursor <= 0} onClick={() => setReplayCursor((current) => Math.max(0, current - 1))}>Prev</Button>
	                  <Button size="sm" variant="ghost" disabled={replayCursor >= replaySnapshots.length - 1} onClick={() => setReplayCursor((current) => Math.min(replaySnapshots.length - 1, current + 1))}>Next</Button>
	                  <span style={{ color: colors.text.secondary, fontSize: typography.body.xs }}>
	                    Snapshot {replayCursor + 1}/{replaySnapshots.length}
	                  </span>
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>{formatClock(replayReview.snapshot.atMs)}</div>
	                  <div>{replayReview.snapshot.units.filter((unit) => unit.status !== "destroyed").length} living units / {replayReview.snapshot.winner ? `Winner: ${replayReview.snapshot.winner}` : "Battle ongoing"}</div>
	                  <div>Objectives: {Object.entries(replayReview.snapshot.objectiveControl || {}).map(([hex, controller]) => `${formatHex(hex)}=${controller || "contested"}`).join(" / ") || "none"}</div>
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>Perception Snapshot</div>
	                  {Object.entries(replayReview.perceptionSnapshot?.actors || {}).map(([actorId, actorView]) => (
	                    <div key={actorId}>
	                      {actorLabel(actors, actorId)}: {actorView.detectedUnits} detected / {actorView.contactUnits} contacts / {actorView.lastKnownUnits} last-known
	                    </div>
	                  ))}
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>Director Packets</div>
	                  {replayReview.directorPackets.length === 0 ? (
	                    <div>No director packet captured near this snapshot.</div>
	                  ) : replayReview.directorPackets.map((packet) => (
	                    <div key={`${packet.actorId}_${packet.atMs}`}>
	                      {actorLabel(actors, packet.actorId)}: {packet.pressureAssessment || packet.pressure} / suggested {(packet.suggestedAxes || []).length ? formatZoneList(matchState, (packet.suggestedAxes || []).map((entry) => entry.zoneId || entry)) : "none"} / support {(packet.supportingAxes || []).length ? formatZoneList(matchState, (packet.supportingAxes || []).map((entry) => entry.zoneId || entry)) : packet.secondaryZones?.length ? formatZoneList(matchState, packet.secondaryZones) : "none"} / {packet.activePackages?.join(", ") || "baseline"}
	                    </div>
	                  ))}
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>Subordinate Plans</div>
	                  {Object.keys(replayReview.snapshot.subordinatePlans || {}).length === 0 ? (
	                    <div>No subordinate plans captured here.</div>
	                  ) : Object.entries(replayReview.snapshot.subordinatePlans || {}).map(([actorId, plans]) => (
	                    <div key={actorId} style={{ marginBottom: 6 }}>
	                      <div style={{ color: colors.text.primary }}>{actorLabel(actors, actorId)}</div>
	                      {Object.entries(plans || {}).length === 0 ? (
	                        <div>No local plan persisted for this actor.</div>
	                      ) : Object.entries(plans || {}).slice(0, 4).map(([ownerId, plan]) => (
	                        <div key={ownerId}>
	                          {ownerId}: {plan.role || "idle"} / {plan.zoneId ? formatZone(matchState, plan.zoneId) : "local"} / {plan.edgeId ? formatEdge(matchState, plan.edgeId) : "local"} / {plan.laneId || "local"} / route {formatRoutePreview(plan.route)}
	                        </div>
	                      ))}
	                    </div>
	                  ))}
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>AI Thoughts</div>
	                  {Object.keys(replayReview.snapshot.thoughts || {}).length === 0 ? (
	                    <div>No thought snapshot captured here.</div>
	                  ) : Object.entries(replayReview.snapshot.thoughts || {}).map(([actorId, thought]) => (
	                    <div key={actorId} style={{ marginBottom: 6 }}>
	                      <div style={{ color: colors.text.primary }}>{actorLabel(actors, actorId)}</div>
	                      <div>Commander: {thought.commander || "-"}</div>
	                      <div>Director: {thought.director || "-"}</div>
	                    </div>
	                  ))}
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>AI Decisions</div>
	                  {replayReview.decisionWindow.length === 0 ? (
	                    <div>No AI decisions near this snapshot.</div>
	                  ) : replayReview.decisionWindow.map((entry, index) => (
	                    <div key={`${entry.atMs}_${index}`}>
	                      <span style={{ color: colors.accent.cyan }}>{entry.source}</span>{" "}
	                      <span style={{ color: colors.accent.amber }}>{entry.provenance}</span>{" "}
	                      {entry.summary}
	                    </div>
	                  ))}
	                </div>
	                <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
	                  <div style={{ color: colors.text.primary, fontWeight: typography.weight.semibold }}>Nearby Events</div>
	                  {replayReview.eventWindow.length === 0 ? (
	                    <div>No events near this snapshot.</div>
	                  ) : replayReview.eventWindow.map((entry, index) => (
	                    <div key={`${entry.atMs}_${index}`}>
	                      <span style={{ color: colors.accent.amber, fontFamily: typography.monoFamily }}>{formatClock(entry.atMs)}</span>{" "}
	                      {entry.message}
	                    </div>
	                  ))}
	                </div>
	              </div>
	            )}
	          </Panel>
	        </div>
	      </div>
    </div>
  );
}

const THOUGHT_ACCENTS = [
  colors.accent.cyan,
  colors.accent.amber,
  colors.accent.green,
];

function Panel({ title, children }) {
  return (
    <div style={{
      background: colors.bg.raised,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: radius.lg,
      padding: space[3],
      boxShadow: shadows?.sm || "none",
    }}>
      <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, marginBottom: space[2] }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ThoughtCard({ row, elapsedMs, accent }) {
  return (
    <div style={{
      flex: "1 1 0",
      minWidth: 280,
      border: `1px solid ${accent}55`,
      borderRadius: radius.lg,
      background: colors.bg.raised,
      overflow: "hidden",
      boxShadow: shadows?.sm || "none",
    }}>
      <div style={{
        padding: `${space[2]}px ${space[3]}px`,
        background: `${accent}22`,
        borderBottom: `1px solid ${accent}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space[2],
      }}>
        <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold }}>
          {row.actorName}
        </div>
        <div style={{ fontSize: typography.body.xs, color: colors.text.secondary }}>
          {formatThoughtUpdated(elapsedMs, row.updatedAtMs)}
        </div>
      </div>
      <div style={{ display: "grid", gap: space[2], padding: space[3] }}>
        <ThoughtSection label="Commander" text={row.commander?.text} />
        <ThoughtSection label="Director" text={row.director?.text} />
      </div>
    </div>
  );
}

function ThoughtSection({ label, text }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{
        fontSize: typography.body.sm,
        color: colors.text.secondary,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        minHeight: 42,
      }}>
        {text || "Awaiting the next AI planning cycle."}
      </div>
    </div>
  );
}

function CommandRow({ active, onSelect, disabled }) {
  const options = [
    ["move", "Move"],
    ["attack_move", "Attack"],
    ["screen", "Screen"],
    ["withdraw", "Withdraw"],
    ["assault", "Assault"],
    ["embark_helo", "Embark"],
    ["disembark_helo", "Disembark"],
  ];
  return (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
      {options.map(([id, label]) => (
        <Button
          key={id}
          size="sm"
          variant={active === id ? "secondary" : "ghost"}
          disabled={disabled}
          onClick={() => onSelect(active === id ? null : id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function UnitCard({ unit, actor, fogTier, memory, assignment, elapsedMs, activeActorId, debugVisibility }) {
  const isRestrictedEnemy = debugVisibility !== "spectator" && unit.actor !== activeActorId && fogTier !== "own" && fogTier !== "visible";
  if (fogTier === "contact") {
    return (
      <div style={{ display: "grid", gap: space[2] }}>
        <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>
          Unidentified Contact
        </div>
        <div style={{ color: colors.text.secondary, fontSize: typography.body.sm, lineHeight: 1.5 }}>
          Enemy presence confirmed, but no verified unit details are available yet.
        </div>
        <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
          Last reported hex: {formatHex(memory?.position || unit.position)}
        </div>
      </div>
    );
  }
  if (isRestrictedEnemy) {
    return (
      <div style={{ display: "grid", gap: space[2] }}>
        <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>
          Detected {formatType(unit.type || memory?.type || "unit")}
        </div>
        <div style={{ color: colors.text.secondary, fontSize: typography.body.sm, lineHeight: 1.5 }}>
          Enemy details are limited to current or last confirmed spotting.
        </div>
        <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.5 }}>
          Last seen: {formatHex(memory?.position || unit.position)}<br />
          Strength: {memory?.strength == null ? "Unknown" : approximateStrength(memory.strength)}<br />
          Intel age: {formatIntelAge(elapsedMs, memory?.seenAtMs)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: space[2] }}>
      <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>
        {unit.name}
      </div>
      <div style={{ color: colors.text.secondary, fontSize: typography.body.sm }}>
        {actor?.name || unit.actor} • {unit.type} • {formatHex(unit.position)}
      </div>
      <StatBar label="Strength" value={unit.strength ?? 0} color={colors.accent.green} />
      <StatBar label="Morale" value={unit.morale ?? 0} color={colors.accent.amber} />
      <StatBar label="Readiness" value={unit.readiness ?? 0} color={colors.accent.cyan} />
      <StatBar label="Supply" value={unit.supply ?? 0} color={colors.accent.blue} />
      <StatBar label="Ammo" value={unit.ammo ?? 0} color={colors.accent.red} />
      <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.45 }}>
        Posture: {unit.posture || "ready"}<br />
        Morale state: {unit.modeState?.moraleState || "ready"}<br />
        Suppression: {Math.round((unit.modeState?.suppression || 0) * 100)}%<br />
        Fatigue: {Math.round(unit.modeState?.fatigue ?? unit.fatigue ?? 0)}%<br />
        Fuel: {Math.round(unit.fuel ?? 0)}%<br />
        Munitions: {Math.round(unit.munitions ?? 0)}%<br />
        Task owner: {assignment?.owner || unit.parentHQ || "direct"}{assignment?.source ? ` (${assignment.source})` : ""}<br />
        Task source: {unit.modeState?.currentTaskSource || "direct"}<br />
        Current command: {unit.modeState?.currentCommand?.kind || "idle"}<br />
        Queue: {unit.modeState?.commandQueue?.map((command) => command.kind).join(", ") || "empty"}<br />
        Detection: {unit.visibleTo?.length ? `visible to ${unit.visibleTo.join(", ")}` : "not spotted"}<br />
        Reserve: {unit.modeState?.reserveState || "none"}<br />
        Release: {formatReleaseState(unit, elapsedMs)}<br />
        Route: {formatRouteProvenance(unit.modeState?.routeProvenance)}<br />
        Last AI: {formatLastDecision(unit.modeState?.lastDecision)}
      </div>
    </div>
  );
}

function StatBar({ label, value, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color }}>{Math.round(value)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: colors.bg.surface, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function actorLabel(actors, actorId) {
  return actors.find((actor) => actor.id === actorId)?.name || actorId || null;
}

function describeActorSituation(actorId, { activeActorId, actorScores, activePerception, debugVisibility, livingCounts, unitsById }) {
  if (debugVisibility === "spectator" || actorId === activeActorId) {
    return `${livingCounts[actorId] || 0} units • ${actorScores[actorId] || 0} VP`;
  }
  const detected = countKnownUnitsForActor(activePerception.detectedUnits || [], actorId, unitsById);
  const contacts = countKnownUnitsForActor(activePerception.contactUnits || [], actorId, unitsById);
  const lastKnown = countKnownMemoriesForActor(activePerception.lastKnown || {}, actorId, unitsById);
  return `${detected} detected • ${contacts} contacts • ${lastKnown} last-known`;
}

function countKnownUnitsForActor(unitIds, actorId, unitsById) {
  return Array.from(new Set(unitIds || [])).filter((unitId) => unitsById[unitId]?.actor === actorId).length;
}

function countKnownMemoriesForActor(lastKnown, actorId, unitsById) {
  return Object.keys(lastKnown || {}).filter((unitId) => unitsById[unitId]?.actor === actorId).length;
}

function describeObjectiveControl(hex, controller, activeActorId, fowMode, actors) {
  if (!controller) return "Contested";
  if (!fowMode || controller === activeActorId || fowMode.visibleCells?.has(hex)) {
    return actorLabel(actors, controller);
  }
  return "Unknown";
}

function sanitizeEventForView(entry, activeActorId, fowMode, unitsById) {
  if (!fowMode) return entry;
  const details = entry.details || {};
  const referencedIds = [details.unitId, details.attackerId, details.targetId].filter(Boolean);
  const restrictedEnemy = referencedIds.find((unitId) => {
    const unit = unitsById[unitId];
    if (!unit || unit.actor === activeActorId) return false;
    const tier = getUnitFogTier(unit, fowMode);
    return tier !== "visible" && tier !== "own";
  });
  if (!restrictedEnemy) return entry;
  const fallbackHex = details.targetHex || details.impact?.targetHex || unitsById[restrictedEnemy]?.lastKnownBy?.[activeActorId]?.position || unitsById[restrictedEnemy]?.position || null;
  return {
    ...entry,
    message: summarizeRestrictedEvent(entry.kind, fallbackHex),
  };
}

function summarizeRestrictedEvent(kind, targetHex) {
  const location = targetHex ? ` near ${formatHex(targetHex)}` : "";
  if (kind === "combat") return `Combat report received${location}.`;
  if (kind === "movement") return `Enemy movement reported${location}.`;
  if (kind === "command") return `Enemy command activity detected${location}.`;
  if (kind === "objective") return `Objective status changed${location}.`;
  return `Enemy activity reported${location}.`;
}

function approximateStrength(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 75) return "High";
  if (numeric >= 40) return "Moderate";
  if (numeric > 0) return "Low";
  return "Broken";
}

function formatIntelAge(nowMs, seenAtMs) {
  if (!seenAtMs) return "unknown";
  const deltaSeconds = Math.max(0, Math.round((nowMs - seenAtMs) / 1000));
  return `${deltaSeconds}s ago`;
}

function formatHex(position) {
  const parsed = parseUnitPosition(position || "");
  if (!parsed) return position || "—";
  return cellToDisplayString(parsed.c, parsed.r);
}

function formatZone(matchState, zoneId) {
  if (!zoneId) return "local area";
  const zone = (matchState?.scenario?.zoneModel?.zones || []).find((candidate) => candidate.zoneId === zoneId);
  return zone?.sourceName || zone?.zoneId || zoneId;
}

function formatZoneList(matchState, zoneIds) {
  const names = Array.from(new Set((zoneIds || []).map((zoneId) => formatZone(matchState, zoneId)).filter(Boolean)));
  if (names.length === 0) return "none";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function formatEdge(matchState, edgeId) {
  if (!edgeId) return "local frontage";
  const edge = (matchState?.scenario?.zoneModel?.zoneEdges || []).find((candidate) => candidate.edgeId === edgeId);
  if (!edge) return edgeId;
  return `${formatZone(matchState, edge.zoneA)} -> ${formatZone(matchState, edge.zoneB)}`;
}

function formatRoutePreview(route) {
  if (!Array.isArray(route) || route.length === 0) return "-";
  if (route.length <= 3) {
    return route.map((hex) => formatHex(hex)).join(" -> ");
  }
  return `${formatHex(route[0])} -> ${formatHex(route[1])} -> ... -> ${formatHex(route[route.length - 1])}`;
}

function formatType(value) {
  return String(value || "unit").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRouteProvenance(routeProvenance) {
  if (!routeProvenance) return "none";
  const planner = routeProvenance.planner === "straight_line" ? "fallback line" : routeProvenance.planner || "weighted";
  return `${planner}${routeProvenance.threatAware ? " • AD-aware" : ""}`;
}

function formatLastDecision(lastDecision) {
  if (!lastDecision) return "none";
  return `${lastDecision.source}/${lastDecision.provenance}`;
}

function formatReleaseState(unit, elapsedMs) {
  const releaseAtMs = unit?.modeState?.releaseAtMs || 0;
  if (releaseAtMs <= elapsedMs) return "released";
  return `in ${Math.ceil((releaseAtMs - elapsedMs) / 1000)}s`;
}

function findNearestTelemetrySnapshot(snapshots, atMs) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  return [...snapshots].sort((left, right) => Math.abs((left.atMs || 0) - atMs) - Math.abs((right.atMs || 0) - atMs))[0];
}

function findDirectorPacketsForSnapshot(packets, atMs) {
  const latestByActor = new Map();
  for (const packet of packets || []) {
    if ((packet.atMs || 0) > atMs) continue;
    latestByActor.set(packet.actorId, packet);
  }
  return Array.from(latestByActor.values()).sort((left, right) => String(left.actorId).localeCompare(String(right.actorId)));
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAiLogModeLabel(mode) {
  if (mode === AI_LOG_MODE_SUMMARY) return "AI Log: LLM Summary";
  if (mode === AI_LOG_MODE_FULL_DIARY) return "AI Log: Full Diary";
  return "AI Log: Standard";
}

function formatDiaryKind(kind) {
  return String(kind || "note")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatThoughtUpdated(elapsedMs, updatedAtMs) {
  if (!updatedAtMs) return "Awaiting update";
  const ageSeconds = Math.max(0, Math.floor((elapsedMs - updatedAtMs) / 1000));
  if (ageSeconds <= 1) return "Updated just now";
  return `Updated ${ageSeconds}s ago`;
}

function sidePanelStyle() {
  return {
    width: 320,
    minWidth: 320,
    padding: space[3],
    display: "flex",
    flexDirection: "column",
    gap: space[3],
    overflowY: "auto",
    borderLeft: `1px solid ${colors.border.subtle}`,
    background: colors.bg.base,
  };
}

function rowStyle() {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[2],
    padding: `${space[1]}px 0`,
    borderBottom: `1px solid ${colors.border.subtle}`,
  };
}

function toolbarSelectStyle() {
  return {
    background: colors.bg.surface,
    color: colors.text.primary,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: radius.sm,
    padding: `${space[1]}px ${space[2]}px`,
    fontSize: typography.body.sm,
    fontFamily: typography.fontFamily,
  };
}
