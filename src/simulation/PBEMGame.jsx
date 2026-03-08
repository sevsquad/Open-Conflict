import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import SimMap from "./SimMap.jsx";
import UnitOrderCard from "./components/UnitOrderCard.jsx";
import OrderRoster from "./components/OrderRoster.jsx";
import { ORDER_TYPES } from "./orderTypes.js";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { positionToLabel } from "./prompts.js";
import { hexLine } from "../mapRenderer/HexMath.js";
import { computeMovePath, computeRange } from "./orderComputer.js";
import { extractProposedMoves } from "./adjudicationFilter.js";
import { SCALE_TIERS } from "./schemas.js";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge, Card, SectionHeader } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";

// ═══════════════════════════════════════════════════════════════
// PBEM GAME — Async multiplayer game client.
// Loads state from server API, shares map/order components with
// SimGame but drives all state through the PBEM server.
//
// Phases (server-driven):
//   planning → confirming → waiting → reviewing → challenging → rebutting → waiting
//
// No handoff screens (privacy enforced by server).
// No local adjudication (server runs LLM).
// Draft orders auto-saved Google Docs style (debounced).
// ═══════════════════════════════════════════════════════════════

const API_BASE = "/api";
const DRAFT_SAVE_DEBOUNCE_MS = 1500;
const POLL_INTERVAL_MS = 15000;

// Combat order types for range checking
const COMBAT_ORDER_IDS = new Set(["ATTACK", "SUPPORT_FIRE", "FIRE_MISSION", "SHORE_BOMBARDMENT"]);

async function apiFetch(path, token, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function PBEMGame({ sessionToken, gameId, actorId, actorName, onBack }) {
  // ── Server state ──
  const [gameState, setGameState] = useState(null);     // from GET /state
  const [terrainData, setTerrainData] = useState(null);  // from GET /terrain
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Client phase (drives UI) ──
  // planning | confirming | waiting | reviewing | challenging | rebutting | ended
  const [phase, setPhase] = useState("planning");

  // ── Order state (mirrors SimGame pattern) ──
  const [unitOrders, setUnitOrders] = useState({});       // { unitId: { movementOrder, actionOrder, intent } }
  const [actorIntent, setActorIntent] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [targetingMode, setTargetingMode] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [rangeWarning, setRangeWarning] = useState(null);
  const [orderWarnings, setOrderWarnings] = useState(null);

  // ── Review/Challenge state ──
  const [turnResults, setTurnResults] = useState(null);   // from GET /results/:turn
  const [challenges, setChallenges] = useState([]);       // from GET /challenges
  const [challengeText, setChallengeText] = useState("");
  const [challengedUnitIds, setChallengedUnitIds] = useState(new Set());
  const [rebuttalText, setRebuttalText] = useState("");
  const [decision, setDecision] = useState(null);         // "accept" | "challenge"

  // ── Status polling ──
  const [gameStatus, setGameStatus] = useState(null);     // from GET /status
  const pollRef = useRef(null);

  // ── Draft auto-save ──
  const draftTimerRef = useRef(null);
  const lastDraftRef = useRef(null);

  // ── Map ref ──
  const simMapRef = useRef(null);

  // ── Derived ──
  const myUnits = gameState?.myUnits || [];
  const knownEnemyUnits = gameState?.knownEnemyUnits || [];
  const allVisibleUnits = useMemo(() => [...myUnits, ...knownEnemyUnits], [myUnits, knownEnemyUnits]);
  const actors = gameState?.scenario?.actors || [];
  const myActorIndex = actors.findIndex(a => a.id === actorId);
  const actorColor = ACTOR_COLORS[myActorIndex >= 0 ? myActorIndex % ACTOR_COLORS.length : 0];
  const selectedUnit = selectedUnitId ? myUnits.find(u => u.id === selectedUnitId) || null : null;

  // ── Build actor color map for SimMap ──
  const actorColorMap = useMemo(() => {
    const map = {};
    actors.forEach((a, i) => { map[a.id] = ACTOR_COLORS[i % ACTOR_COLORS.length]; });
    return map;
  }, [actors]);

  // Movement path preview during targeting
  const movePath = useMemo(() => {
    if (!targetingMode || !selectedUnit || !hoveredCell) return null;
    const orderDef = ORDER_TYPES[targetingMode.orderType];
    if (!orderDef || orderDef.slot !== "movement") return null;
    const unitPos = parseUnitPosition(selectedUnit.position);
    if (!unitPos) return null;
    return hexLine(unitPos.c, unitPos.r, hoveredCell.c, hoveredCell.r);
  }, [targetingMode, selectedUnit, hoveredCell]);

  // Proposed moves from turn results for review arrows
  const proposedMoves = useMemo(() => {
    if (phase !== "reviewing" || !turnResults?.adjudication) return null;
    // Build a minimal gameState-like object for extractProposedMoves
    const fakeGs = { units: allVisibleUnits };
    const moves = extractProposedMoves(turnResults.adjudication, fakeGs);
    if (!moves || moves.length === 0) return null;
    return moves.map(m => {
      const idx = actors.findIndex(a => a.id === m.actorId);
      return { from: m.from, to: m.to, color: ACTOR_COLORS[idx >= 0 ? idx % ACTOR_COLORS.length : 0], unitName: m.unitName };
    });
  }, [phase, turnResults, allVisibleUnits, actors]);

  // ── Load initial state + terrain ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [state, terrain] = await Promise.all([
          apiFetch("/game/state", sessionToken),
          apiFetch("/game/terrain", sessionToken).catch(() => null),
        ]);
        if (cancelled) return;
        setGameState(state);
        setTerrainData(terrain);

        // Determine initial phase from server state
        if (state.game.status === "ended") {
          setPhase("ended");
        } else if (state.ordersSubmitted) {
          setPhase("waiting");
        } else {
          setPhase("planning");
          // Load draft orders if any
          try {
            const draft = await apiFetch("/game/draft-orders", sessionToken);
            if (!cancelled && draft.draft) {
              setUnitOrders(draft.draft.unitOrders || {});
              setActorIntent(draft.draft.actorIntent || "");
            }
          } catch { /* no drafts */ }
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  // ── Status polling (when waiting for others or processing) ──
  useEffect(() => {
    if (phase !== "waiting") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const poll = async () => {
      try {
        const status = await apiFetch("/game/status", sessionToken);
        setGameStatus(status);

        // Check if turn results are ready
        if (status.allReady) {
          // Refresh game state — results may be available
          const state = await apiFetch("/game/state", sessionToken);
          setGameState(state);

          // Try to fetch results for current turn
          try {
            const results = await apiFetch(`/game/results/${status.turn}`, sessionToken);
            if (results.adjudication) {
              setTurnResults(results);
              setPhase("reviewing");
              return;
            }
          } catch { /* results not ready yet — moderator hasn't processed */ }
        }
      } catch { /* polling error — ignore, retry next interval */ }
    };
    poll(); // immediate first poll
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase, sessionToken]);

  // ── Draft auto-save (Google Docs style debounced) ──
  const saveDraft = useCallback(() => {
    const draftData = JSON.stringify({ unitOrders, actorIntent });
    // Skip if nothing changed
    if (draftData === lastDraftRef.current) return;
    lastDraftRef.current = draftData;

    apiFetch("/game/draft-orders", sessionToken, {
      method: "POST",
      body: JSON.stringify({ unitOrders, actorIntent }),
    }).catch(() => {}); // fire-and-forget
  }, [unitOrders, actorIntent, sessionToken]);

  // Debounced trigger: save draft when orders or intent change
  useEffect(() => {
    if (phase !== "planning") return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(saveDraft, DRAFT_SAVE_DEBOUNCE_MS);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [unitOrders, actorIntent, phase, saveDraft]);

  // ── Order handlers (same pattern as SimGame) ──

  const handleUnitClick = useCallback((unit) => {
    if (unit.actor !== actorId) return; // can't order enemy units
    setSelectedUnitId(unit.id);
  }, [actorId]);

  const handleOrderConfirm = useCallback((orders) => {
    if (!selectedUnit) return;
    setUnitOrders(prev => ({ ...prev, [selectedUnit.id]: orders }));
    setSelectedUnitId(null);
    setTargetingMode(null);
  }, [selectedUnit]);

  const handleStartTargeting = useCallback((orderType) => {
    if (!selectedUnit) return;
    setTargetingMode({ orderType, unitId: selectedUnit.id });
  }, [selectedUnit]);

  const handleCancelTargeting = useCallback(() => {
    setTargetingMode(null);
  }, []);

  const handleMapCellClick = useCallback((cell) => {
    if (phase !== "planning") return;
    const unit = myUnits.find(u => {
      if (u.status === "destroyed" || u.status === "eliminated") return false;
      const pos = parseUnitPosition(u.position);
      return pos && pos.c === cell.c && pos.r === cell.r;
    });
    if (unit) setSelectedUnitId(unit.id);
  }, [myUnits, phase]);

  const applyTarget = useCallback((unit, orderType, targetStr, outOfRange = false) => {
    const orderDef = ORDER_TYPES[orderType];
    if (!orderDef) return;
    setUnitOrders(prev => {
      const currentOrders = prev[unit.id] || {};
      const updated = { ...currentOrders };
      if (orderDef.slot === "movement") {
        updated.movementOrder = { id: orderType, target: targetStr };
      } else {
        updated.actionOrder = {
          id: orderType, target: targetStr, subtype: currentOrders.actionOrder?.subtype,
          ...(outOfRange && { _outOfRange: true }),
        };
      }
      return { ...prev, [unit.id]: updated };
    });
  }, []);

  const handleTargetSelect = useCallback((cell) => {
    if (!targetingMode || !selectedUnit) return;
    const targetStr = `${cell.c},${cell.r}`;
    const orderDef = ORDER_TYPES[targetingMode.orderType];
    if (!orderDef) return;

    // Range check for combat orders
    if (orderDef.slot === "action" && COMBAT_ORDER_IDS.has(targetingMode.orderType)) {
      const currentOrders = unitOrders[selectedUnit.id] || {};
      const effectivePos = currentOrders.movementOrder?.target || selectedUnit.position;
      const range = computeRange(effectivePos, targetStr, selectedUnit, terrainData?.cellSizeKm || 1);
      if (range.band === "OUT_OF_RANGE") {
        setRangeWarning({ unit: selectedUnit, orderType: targetingMode.orderType, targetStr, range, effectivePos });
        return;
      }
    }

    applyTarget(selectedUnit, targetingMode.orderType, targetStr);
    setTargetingMode(null);
  }, [targetingMode, selectedUnit, unitOrders, terrainData, applyTarget]);

  // ── Validate orders before submission ──
  const validateOrders = useCallback(() => {
    const warnings = [];
    for (const unit of myUnits) {
      const orders = unitOrders[unit.id];
      if (!orders?.movementOrder?.target) continue;
      const moveId = orders.movementOrder.id;
      if (moveId !== "MOVE" && moveId !== "WITHDRAW") continue;

      const result = computeMovePath(
        unit.position, orders.movementOrder.target,
        terrainData, unit.movementType || "foot"
      );
      if (!result || result.feasibility === "FEASIBLE" || result.feasibility === "MARGINAL") continue;
      warnings.push({
        unitName: unit.name, from: positionToLabel(unit.position),
        to: positionToLabel(orders.movementOrder.target),
        distanceHexes: result.distanceHexes, budget: result.budget ?? 3,
        totalCost: result.totalCost, feasibility: result.feasibility,
      });
    }
    return warnings;
  }, [myUnits, unitOrders, terrainData]);

  // ── Submit orders → confirmation step ──
  const handleReviewOrders = useCallback(() => {
    const warnings = validateOrders();
    if (warnings.length > 0) {
      setOrderWarnings(warnings);
      return;
    }
    setPhase("confirming");
  }, [validateOrders]);

  const handleForceSubmit = useCallback(() => {
    setOrderWarnings(null);
    setPhase("confirming");
  }, []);

  // ── Confirm & seal orders (POST to server) ──
  const [submitting, setSubmitting] = useState(false);

  const handleConfirmAndSeal = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch("/game/orders", sessionToken, {
        method: "POST",
        body: JSON.stringify({ unitOrders, actorIntent }),
      });
      // Orders sealed — transition to waiting
      setPhase("waiting");
      setGameStatus(prev => prev ? { ...prev, iSubmitted: true } : null);
    } catch (err) {
      setError(err.message);
      setPhase("planning"); // go back to planning on error
    } finally {
      setSubmitting(false);
    }
  }, [unitOrders, actorIntent, sessionToken]);

  const handleBackToPlanning = useCallback(() => {
    setPhase("planning");
  }, []);

  // ── Review: accept or challenge ──
  const handleAccept = useCallback(async () => {
    setError(null);
    try {
      await apiFetch("/game/decision", sessionToken, {
        method: "POST",
        body: JSON.stringify({ decision: "accept" }),
      });
      setDecision("accept");
      setPhase("waiting"); // wait for all to decide / turn to finalize
    } catch (err) {
      setError(err.message);
    }
  }, [sessionToken]);

  const handleStartChallenge = useCallback(() => {
    setChallengeText("");
    setChallengedUnitIds(new Set());
    setPhase("challenging");
  }, []);

  // Toggle a unit for FOW-aware challenge routing
  const toggleChallengedUnit = useCallback((unitId) => {
    setChallengedUnitIds(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);

  const handleSubmitChallenge = useCallback(async () => {
    if (!challengeText.trim()) {
      setError("Enter your challenge text.");
      return;
    }
    if (challengedUnitIds.size === 0) {
      setError("Select at least one unit this challenge concerns.");
      return;
    }
    setError(null);
    try {
      await apiFetch("/game/decision", sessionToken, {
        method: "POST",
        body: JSON.stringify({
          decision: "challenge",
          challengeText,
          challengedUnitIds: [...challengedUnitIds],
        }),
      });
      setDecision("challenge");
      setPhase("waiting"); // wait for rebuttal phase
    } catch (err) {
      setError(err.message);
    }
  }, [challengeText, challengedUnitIds, sessionToken]);

  // ── Rebuttal: load challenges filtered by FOW, write rebuttal ──
  const handleLoadChallenges = useCallback(async () => {
    try {
      const data = await apiFetch("/game/challenges", sessionToken);
      setChallenges(data.challenges || []);
      setPhase("rebutting");
    } catch (err) {
      setError(err.message);
    }
  }, [sessionToken]);

  const handleSubmitRebuttal = useCallback(async () => {
    setError(null);
    try {
      await apiFetch("/game/decision", sessionToken, {
        method: "POST",
        body: JSON.stringify({
          decision: "accept", // rebuttal is a response, not a challenge
          rebuttalText,
        }),
      });
      setPhase("waiting");
    } catch (err) {
      setError(err.message);
    }
  }, [rebuttalText, sessionToken]);

  // ── Refresh state (manual) ──
  const handleRefresh = useCallback(async () => {
    try {
      const state = await apiFetch("/game/state", sessionToken);
      setGameState(state);

      if (state.game.status === "ended") {
        setPhase("ended");
        return;
      }

      // Check for new turn results
      const status = await apiFetch("/game/status", sessionToken);
      setGameStatus(status);

      if (!state.ordersSubmitted && phase === "waiting") {
        // New turn started — back to planning
        setPhase("planning");
        setUnitOrders({});
        setActorIntent("");
        setTurnResults(null);
        setDecision(null);
        setChallenges([]);
        // Load drafts for new turn
        try {
          const draft = await apiFetch("/game/draft-orders", sessionToken);
          if (draft.draft) {
            setUnitOrders(draft.draft.unitOrders || {});
            setActorIntent(draft.draft.actorIntent || "");
          }
        } catch {}
      }
    } catch (err) {
      setError(err.message);
    }
  }, [sessionToken, phase]);

  // ── Loading screen ──
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: colors.bg.base, color: colors.text.muted, fontFamily: typography.fontFamily }}>
        Loading game...
      </div>
    );
  }

  if (!gameState) {
    return (
      <div style={{ padding: space[4], background: colors.bg.base, color: colors.text.primary, fontFamily: typography.fontFamily }}>
        <div style={{ color: colors.accent.red, marginBottom: space[3] }}>{error || "Failed to load game"}</div>
        <Button onClick={onBack}>Back to Dashboard</Button>
      </div>
    );
  }

  // ── Build units for map display ──
  const mapUnits = useMemo(() => {
    let units = [...allVisibleUnits];
    // During review, show units at proposed positions
    if (phase === "reviewing" && turnResults?.adjudication) {
      const fakeGs = { units };
      const moves = extractProposedMoves(turnResults.adjudication, fakeGs);
      if (moves.length > 0) {
        const posOverrides = new Map(moves.map(m => [m.unitId, m.to]));
        units = units.map(u => posOverrides.has(u.id) ? { ...u, position: posOverrides.get(u.id) } : u);
      }
    }
    return units;
  }, [allVisibleUnits, phase, turnResults]);

  // ── Adjudication display data ──
  const adj = turnResults?.adjudication?.adjudication || turnResults?.adjudication;
  const actorViewExtras = adj?._actor_view || null;

  // ── Check which enemy units are detected (for challenge FOW warning) ──
  const detectedEnemyIds = useMemo(() => {
    return new Set(knownEnemyUnits.filter(u => u.detectionTier === "identified").map(u => u.id));
  }, [knownEnemyUnits]);

  // ── Render ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: colors.bg.base, color: colors.text.primary, fontFamily: typography.fontFamily }}>

      {/* Toolbar */}
      <div style={{ padding: `${space[2] + 2}px ${space[5]}px`, borderBottom: `1px solid ${colors.border.subtle}`, display: "flex", alignItems: "center", gap: space[3], flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div style={{ fontWeight: typography.weight.bold, fontSize: typography.heading.sm }}>{gameState.game.name || "Game"}</div>
        <Badge color={actorColor}>{actorName || actorId}</Badge>
        <Badge color={colors.accent.amber} style={{ fontWeight: typography.weight.bold }}>
          Turn {gameState.game.turn}
        </Badge>
        <Badge color={phaseColor(phase)}>{phaseLabel(phase)}</Badge>
        {gameState.game.currentDate && (
          <Badge color={colors.accent.cyan} style={{ fontSize: 10, fontFamily: typography.monoFamily }}>
            {gameState.game.currentDate}
          </Badge>
        )}
        {gameState.game.status === "ended" && <Badge color={colors.text.muted} style={{ fontWeight: typography.weight.bold }}>ENDED</Badge>}
        <div style={{ marginLeft: "auto", display: "flex", gap: space[2], alignItems: "center" }}>
          {gameStatus && (
            <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
              {gameStatus.submittedCount}/{gameStatus.totalPlayers} submitted
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={handleRefresh}>Refresh</Button>
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Map */}
        <div style={{ flex: "0 0 45%", borderRight: `1px solid ${colors.border.subtle}`, position: "relative" }}>
          <SimMap
            ref={simMapRef}
            terrainData={terrainData}
            units={mapUnits}
            actors={actors}
            style={{ width: "100%", height: "100%" }}
            fogOfWar={true}
            interactionMode={targetingMode ? "target_hex" : "navigate"}
            targetingMode={targetingMode}
            selectedUnitId={selectedUnitId}
            onCellClick={(cell) => targetingMode ? handleTargetSelect(cell) : handleMapCellClick(cell)}
            onCellHover={targetingMode ? setHoveredCell : undefined}
            movePath={movePath}
            proposedMoves={proposedMoves}
          />
        </div>

        {/* Right: Phase-specific panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: space[4] }}>

            {/* Error banner */}
            {error && (
              <div style={{ padding: `${space[2]}px ${space[3]}px`, background: colors.glow.red, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, fontSize: typography.body.sm, color: colors.accent.red, marginBottom: space[3] }}>
                {error}
                <button onClick={() => setError(null)} style={{ marginLeft: space[2], background: "none", border: "none", color: colors.accent.red, cursor: "pointer", fontSize: typography.body.xs }}>✕</button>
              </div>
            )}

            {/* ── PLANNING PHASE ── */}
            {phase === "planning" && (
              <>
                <OrderRoster
                  units={myUnits.filter(u => u.status !== "destroyed" && u.status !== "eliminated")}
                  actors={actors}
                  unitOrders={{ [actorId]: unitOrders }}
                  actorIntents={{ [actorId]: actorIntent }}
                  onUnitClick={handleUnitClick}
                  onActorIntentChange={(_, text) => setActorIntent(text)}
                  onSubmit={handleReviewOrders}
                  submitting={false}
                  disabled={false}
                  turnNumber={gameState.game.turn}
                  activeActorId={actorId}
                  submitLabel="Review & Confirm Orders"
                />
                {/* Order warnings modal */}
                {orderWarnings && (
                  <Card style={{ marginTop: space[3], border: `1px solid ${colors.accent.amber}40` }}>
                    <SectionHeader>Movement Warnings</SectionHeader>
                    {orderWarnings.map((w, i) => (
                      <div key={i} style={{ fontSize: typography.body.sm, color: colors.accent.amber, marginBottom: space[1] }}>
                        {w.unitName}: {w.from} → {w.to} — {w.feasibility} ({w.totalCost} cost / {w.budget} budget)
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: space[2], marginTop: space[2] }}>
                      <Button variant="primary" size="sm" onClick={handleForceSubmit}>Submit Anyway</Button>
                      <Button variant="secondary" size="sm" onClick={() => setOrderWarnings(null)}>Go Back</Button>
                    </div>
                  </Card>
                )}
              </>
            )}

            {/* ── CONFIRMING PHASE (order summary before seal) ── */}
            {phase === "confirming" && (
              <Card>
                <SectionHeader>Confirm Orders — Turn {gameState.game.turn}</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
                  Review your orders below. Once sealed, they cannot be changed.
                </div>
                {actorIntent && (
                  <div style={{ marginBottom: space[3], padding: space[2], background: colors.bg.input, borderRadius: radius.sm, fontSize: typography.body.sm }}>
                    <span style={{ color: colors.text.muted, fontSize: typography.body.xs, textTransform: "uppercase", letterSpacing: 1 }}>Commander's Intent</span>
                    <div style={{ color: colors.text.primary, marginTop: space[1] }}>{actorIntent}</div>
                  </div>
                )}
                {myUnits.filter(u => u.status !== "destroyed" && u.status !== "eliminated").map(unit => {
                  const orders = unitOrders[unit.id];
                  return (
                    <div key={unit.id} style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, fontSize: typography.body.sm }}>
                      <span style={{ fontWeight: typography.weight.semibold }}>{unit.name}</span>
                      <span style={{ color: colors.text.muted, marginLeft: space[2] }}>
                        {orderSummary(orders)}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: space[2], marginTop: space[3] }}>
                  <Button variant="primary" onClick={handleConfirmAndSeal} disabled={submitting}>
                    {submitting ? "Sealing..." : "Confirm & Seal Orders"}
                  </Button>
                  <Button variant="secondary" onClick={handleBackToPlanning}>Edit Orders</Button>
                </div>
              </Card>
            )}

            {/* ── WAITING PHASE ── */}
            {phase === "waiting" && (
              <Card>
                <SectionHeader>Waiting</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
                  {gameStatus?.iSubmitted
                    ? `Your orders are sealed. Waiting for other players (${gameStatus.submittedCount}/${gameStatus.totalPlayers} submitted).`
                    : decision
                      ? `Your decision (${decision}) has been recorded. Waiting for other players and turn processing.`
                      : "Waiting for turn processing..."
                  }
                </div>
                <div style={{ marginTop: space[3], fontSize: typography.body.xs, color: colors.text.muted }}>
                  Auto-refreshing every {POLL_INTERVAL_MS / 1000}s. <Button variant="ghost" size="sm" onClick={handleRefresh}>Refresh Now</Button>
                </div>
              </Card>
            )}

            {/* ── REVIEWING PHASE (turn results) ── */}
            {phase === "reviewing" && adj && (
              <Card>
                <SectionHeader>Turn {turnResults?.turn || gameState.game.turn} Results</SectionHeader>

                {/* Narrative */}
                {adj.outcome_determination?.narrative && (
                  <div style={{ marginBottom: space[3], padding: space[3], background: colors.bg.input, borderRadius: radius.md, fontSize: typography.body.sm, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {adj.outcome_determination.narrative}
                  </div>
                )}

                {/* Known enemy actions (from per-actor filter) */}
                {actorViewExtras?.known_enemy_actions && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1] }}>Enemy Activity</div>
                    <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, whiteSpace: "pre-wrap" }}>{actorViewExtras.known_enemy_actions}</div>
                  </div>
                )}

                {/* Intel assessment */}
                {actorViewExtras?.intel_assessment && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1] }}>Intelligence Assessment</div>
                    <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, whiteSpace: "pre-wrap" }}>{actorViewExtras.intel_assessment}</div>
                  </div>
                )}

                {/* State updates */}
                {adj.state_updates?.length > 0 && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1] }}>State Changes</div>
                    {adj.state_updates.map((u, i) => (
                      <div key={i} style={{ fontSize: typography.body.xs, color: colors.text.secondary, fontFamily: typography.monoFamily, padding: `2px ${space[1]}px` }}>
                        {u.entity}: {u.attribute} {u.old_value} → {u.new_value} {u.reason ? `(${u.reason})` : ""}
                      </div>
                    ))}
                  </div>
                )}

                {/* Feasibility */}
                {adj.feasibility_analysis?.assessments?.length > 0 && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1] }}>Feasibility</div>
                    {adj.feasibility_analysis.assessments.map((a, i) => (
                      <div key={i} style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
                        <Badge color={a.feasibility === "high" ? colors.accent.green : a.feasibility === "infeasible" ? colors.accent.red : colors.accent.amber} style={{ fontSize: 9, marginRight: space[1] }}>
                          {a.feasibility}
                        </Badge>
                        {a.unit || a.action || ""} {a.reasoning ? `— ${a.reasoning}` : ""}
                      </div>
                    ))}
                  </div>
                )}

                {/* Accept / Challenge buttons */}
                <div style={{ display: "flex", gap: space[2], marginTop: space[3], borderTop: `1px solid ${colors.border.subtle}`, paddingTop: space[3] }}>
                  <Button variant="primary" onClick={handleAccept}>Accept Results</Button>
                  <Button variant="danger" onClick={handleStartChallenge}>Challenge</Button>
                </div>
              </Card>
            )}

            {/* ── CHALLENGING PHASE (unit selection + challenge text) ── */}
            {phase === "challenging" && (
              <Card>
                <SectionHeader>Challenge — Select Units</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
                  Select the unit(s) this challenge concerns, then explain why the ruling should be reconsidered.
                </div>

                {/* Unit selection */}
                <div style={{ marginBottom: space[3] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1] }}>Your Units</div>
                  {myUnits.map(u => (
                    <UnitCheckbox key={u.id} unit={u} checked={challengedUnitIds.has(u.id)} onChange={() => toggleChallengedUnit(u.id)} warning={null} />
                  ))}
                  {knownEnemyUnits.length > 0 && (
                    <>
                      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: space[1], marginTop: space[2] }}>Known Enemy Units</div>
                      {knownEnemyUnits.map(u => (
                        <UnitCheckbox
                          key={u.id} unit={u}
                          checked={challengedUnitIds.has(u.id)}
                          onChange={() => toggleChallengedUnit(u.id)}
                          warning={detectedEnemyIds.has(u.id) ? "⚠ Unit is spotted — other players will see your full challenge text and can rebut directly." : null}
                        />
                      ))}
                    </>
                  )}
                </div>

                {/* Challenge text */}
                <textarea
                  value={challengeText}
                  onChange={e => setChallengeText(e.target.value)}
                  placeholder="Explain why this ruling should be reconsidered..."
                  style={{ width: "100%", padding: space[2], background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, minHeight: 100, boxSizing: "border-box", fontFamily: typography.fontFamily, outline: "none", resize: "vertical" }}
                />

                <div style={{ display: "flex", gap: space[2], marginTop: space[2] }}>
                  <Button variant="danger" onClick={handleSubmitChallenge}>Submit Challenge</Button>
                  <Button variant="secondary" onClick={() => setPhase("reviewing")}>Cancel</Button>
                </div>
              </Card>
            )}

            {/* ── REBUTTING PHASE ── */}
            {phase === "rebutting" && (
              <Card>
                <SectionHeader>Challenges & Rebuttals</SectionHeader>
                {challenges.length === 0 ? (
                  <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>No challenges to review.</div>
                ) : (
                  challenges.map((c, i) => (
                    <div key={i} style={{ marginBottom: space[3], padding: space[2], background: colors.bg.input, borderRadius: radius.sm, border: `1px solid ${colors.border.subtle}` }}>
                      <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.accent.red, marginBottom: space[1] }}>
                        Challenge from {c.actorName}
                      </div>
                      {c.visible ? (
                        <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, whiteSpace: "pre-wrap" }}>{c.challengeText}</div>
                      ) : (
                        <div style={{ fontSize: typography.body.sm, color: colors.text.muted, fontStyle: "italic" }}>{c.blindMessage}</div>
                      )}
                    </div>
                  ))
                )}

                <div style={{ marginTop: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1] }}>
                    Your rebuttal (optional — explain why you believe the ruling was fair):
                  </div>
                  <textarea
                    value={rebuttalText}
                    onChange={e => setRebuttalText(e.target.value)}
                    placeholder="Write your rebuttal..."
                    style={{ width: "100%", padding: space[2], background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, minHeight: 80, boxSizing: "border-box", fontFamily: typography.fontFamily, outline: "none", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", gap: space[2], marginTop: space[2] }}>
                  <Button variant="primary" onClick={handleSubmitRebuttal}>
                    {rebuttalText.trim() ? "Submit Rebuttal" : "Skip (No Rebuttal)"}
                  </Button>
                </div>
              </Card>
            )}

            {/* ── ENDED PHASE ── */}
            {phase === "ended" && (
              <Card>
                <SectionHeader>Game Over</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
                  This game has ended. Final state: Turn {gameState.game.turn}.
                </div>
                <Button variant="secondary" onClick={onBack} style={{ marginTop: space[3] }}>Back to Dashboard</Button>
              </Card>
            )}

          </div>
        </div>
      </div>

      {/* Unit Order Card modal */}
      {selectedUnit && phase === "planning" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ maxWidth: 500, width: "90%", maxHeight: "80vh", overflowY: "auto" }}>
            <UnitOrderCard
              unit={selectedUnit}
              terrainData={terrainData}
              allUnits={allVisibleUnits}
              actors={actors}
              existingOrders={unitOrders[selectedUnit.id] || null}
              targetingMode={targetingMode}
              onStartTargeting={handleStartTargeting}
              onCancelTargeting={handleCancelTargeting}
              onConfirm={handleOrderConfirm}
              onClose={() => { setSelectedUnitId(null); setTargetingMode(null); }}
            />
          </div>
        </div>
      )}

      {/* Range warning modal */}
      {rangeWarning && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 101 }}>
          <Card style={{ maxWidth: 400, width: "90%" }}>
            <SectionHeader>Out of Range</SectionHeader>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>
              {rangeWarning.unit.name}'s {rangeWarning.orderType} target is out of effective range ({rangeWarning.range.distanceKm?.toFixed(1)}km).
            </div>
            <div style={{ display: "flex", gap: space[2] }}>
              <Button variant="primary" size="sm" onClick={() => {
                applyTarget(rangeWarning.unit, rangeWarning.orderType, rangeWarning.targetStr, true);
                setTargetingMode(null);
                setRangeWarning(null);
              }}>Accept Anyway</Button>
              <Button variant="secondary" size="sm" onClick={() => setRangeWarning(null)}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────

function UnitCheckbox({ unit, checked, onChange, warning }) {
  return (
    <div style={{ marginBottom: space[1] }}>
      <label style={{ display: "flex", alignItems: "center", gap: space[2], cursor: "pointer", fontSize: typography.body.sm, padding: `${space[1]}px ${space[2]}px`, borderRadius: radius.sm, background: checked ? `${colors.accent.red}10` : "transparent", border: `1px solid ${checked ? colors.accent.red + "40" : "transparent"}` }}>
        <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: colors.accent.red }} />
        <span style={{ fontWeight: checked ? typography.weight.semibold : typography.weight.normal }}>{unit.name}</span>
        <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{unit.type} — {positionToLabel(unit.position)}</span>
      </label>
      {checked && warning && (
        <div style={{ fontSize: typography.body.xs, color: colors.accent.amber, marginLeft: space[6], marginTop: 2 }}>{warning}</div>
      )}
    </div>
  );
}

// ── Utility Functions ──────────────────────────────────────────

function orderSummary(orders) {
  if (!orders) return "HOLD";
  const parts = [];
  if (orders.movementOrder) {
    const target = orders.movementOrder.target ? ` ${positionToLabel(orders.movementOrder.target)}` : "";
    parts.push(orders.movementOrder.id + target);
  }
  if (orders.actionOrder) {
    const target = orders.actionOrder.target ? ` ${positionToLabel(orders.actionOrder.target)}` : "";
    const subtype = orders.actionOrder.subtype ? ` (${orders.actionOrder.subtype})` : "";
    parts.push(orders.actionOrder.id + target + subtype);
  }
  return parts.length > 0 ? parts.join(" + ") : "HOLD";
}

function phaseLabel(phase) {
  switch (phase) {
    case "planning": return "Planning";
    case "confirming": return "Confirming";
    case "waiting": return "Waiting";
    case "reviewing": return "Reviewing Results";
    case "challenging": return "Challenge";
    case "rebutting": return "Rebuttal";
    case "ended": return "Ended";
    default: return phase;
  }
}

function phaseColor(phase) {
  switch (phase) {
    case "planning": return colors.accent.green;
    case "confirming": return colors.accent.amber;
    case "waiting": return colors.accent.cyan;
    case "reviewing": return colors.accent.blue;
    case "challenging": return colors.accent.red;
    case "rebutting": return colors.accent.purple;
    case "ended": return colors.text.muted;
    default: return colors.text.muted;
  }
}
