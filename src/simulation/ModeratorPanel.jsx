import { useState, useCallback, useEffect } from "react";
import { colors, typography, radius, space } from "../theme.js";
import { Button, Badge, Card, SectionHeader, Input } from "../components/ui.jsx";

// ═══════════════════════════════════════════════════════════════
// MODERATOR PANEL — God-view admin UI for Human Moderator mode.
// Uses the moderator token (not player session token) to access
// full game state, trigger turn processing, and finalize turns.
//
// Features:
//   - Full game state view (all actors, all units)
//   - Order status (who submitted, who hasn't)
//   - Manual turn processing trigger
//   - Review adjudication results before finalizing
//   - Pause / resume / end game controls
//   - Game log viewer
// ═══════════════════════════════════════════════════════════════

const API_BASE = "/api";

async function modFetch(path, moderatorToken, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (moderatorToken) headers.Authorization = `Bearer ${moderatorToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function ModeratorPanel({ gameId, moderatorToken, onBack }) {
  const [gameState, setGameState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [ordersStatus, setOrdersStatus] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [actionResult, setActionResult] = useState(null);

  const basePath = `/admin/games/${gameId}`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, playerList, orders, logData] = await Promise.all([
        modFetch(`${basePath}/state`, moderatorToken),
        modFetch(`${basePath}/players`, moderatorToken),
        modFetch(`${basePath}/orders-status`, moderatorToken),
        modFetch(`${basePath}/log?limit=30`, moderatorToken),
      ]);
      setGameState(state);
      setPlayers(playerList);
      setOrdersStatus(orders);
      setLog(logData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [basePath, moderatorToken]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Actions ────────────────────────────────────────────────

  const handleProcessTurn = useCallback(async () => {
    setProcessing(true);
    setError(null);
    setActionResult(null);
    try {
      const result = await modFetch(`${basePath}/process-turn`, moderatorToken, { method: "POST" });
      setActionResult(`Turn ${result.turn} processed successfully.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }, [basePath, moderatorToken, refresh]);

  const handleFinalize = useCallback(async () => {
    setFinalizing(true);
    setError(null);
    setActionResult(null);
    try {
      const result = await modFetch(`${basePath}/finalize-turn`, moderatorToken, { method: "POST" });
      setActionResult(`Turn finalized. New turn: ${result.newTurn}.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setFinalizing(false);
    }
  }, [basePath, moderatorToken, refresh]);

  const handlePause = useCallback(async () => {
    try {
      await modFetch(`${basePath}/pause`, moderatorToken, { method: "POST" });
      await refresh();
    } catch (err) { setError(err.message); }
  }, [basePath, moderatorToken, refresh]);

  const handleResume = useCallback(async () => {
    try {
      await modFetch(`${basePath}/resume`, moderatorToken, { method: "POST" });
      await refresh();
    } catch (err) { setError(err.message); }
  }, [basePath, moderatorToken, refresh]);

  const handleEnd = useCallback(async () => {
    try {
      await modFetch(`${basePath}/end`, moderatorToken, { method: "POST" });
      await refresh();
    } catch (err) { setError(err.message); }
  }, [basePath, moderatorToken, refresh]);

  // ── Loading ────────────────────────────────────────────────

  if (loading && !gameState) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: colors.bg.base, color: colors.text.muted, fontFamily: typography.fontFamily }}>
        Loading moderator panel...
      </div>
    );
  }

  const gs = gameState?.game || {};
  const turn = gs.turn || 1;
  const phase = gs.phase || "planning";
  const status = gs.status || "active";

  return (
    <div style={{ height: "100%", overflow: "auto", background: colors.bg.base, color: colors.text.primary, fontFamily: typography.fontFamily, display: "flex", justifyContent: "center", padding: `${space[6]}px ${space[4]}px` }}>
      <div style={{ width: "100%", maxWidth: 800 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: space[3], marginBottom: space[6] }}>
          <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: typography.heading.lg, fontWeight: typography.weight.bold }}>
              Moderator Panel
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>
              {gameState?.scenario?.name || gameId} — Turn {turn} — {phase}
            </div>
          </div>
          <Badge color={status === "active" ? colors.accent.green : status === "paused" ? colors.accent.amber : colors.text.muted}>
            {status.toUpperCase()}
          </Badge>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>Refresh</Button>
        </div>

        {/* Errors and Results */}
        {error && (
          <div style={{ padding: space[3], marginBottom: space[4], background: colors.glow.red, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, fontSize: typography.body.sm, color: colors.accent.red }}>
            {error}
          </div>
        )}
        {actionResult && (
          <div style={{ padding: space[3], marginBottom: space[4], background: `${colors.accent.green}10`, border: `1px solid ${colors.accent.green}30`, borderRadius: radius.md, fontSize: typography.body.sm, color: colors.accent.green }}>
            {actionResult}
          </div>
        )}

        {/* Game Controls */}
        <Card accent={colors.accent.red} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.red}>Game Controls</SectionHeader>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <Button variant="primary" onClick={handleProcessTurn} disabled={processing || !ordersStatus?.ready}>
              {processing ? "Processing..." : "Process Turn"}
            </Button>
            <Button variant="primary" onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? "Finalizing..." : "Finalize Turn"}
            </Button>
            {status === "active" && <Button variant="secondary" onClick={handlePause}>Pause Game</Button>}
            {status === "paused" && <Button variant="secondary" onClick={handleResume}>Resume Game</Button>}
            <Button variant="danger" size="sm" onClick={handleEnd}>End Game</Button>
          </div>
          {!ordersStatus?.ready && (
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[2] }}>
              Cannot process: {ordersStatus?.missing?.length || "?"} player(s) haven't submitted orders.
            </div>
          )}
        </Card>

        {/* Order Status */}
        <Card accent={colors.accent.blue} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.blue}>Order Status — Turn {turn}</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[2] }}>
            {players.map(p => {
              const submitted = ordersStatus?.submitted?.includes(p.actorId);
              return (
                <div key={p.actorId} style={{ display: "flex", alignItems: "center", gap: space[2], padding: space[2], background: colors.bg.surface, borderRadius: radius.sm, border: `1px solid ${colors.border.subtle}` }}>
                  <Badge color={submitted ? colors.accent.green : colors.accent.amber}>
                    {submitted ? "Submitted" : "Pending"}
                  </Badge>
                  <div>
                    <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.semibold }}>{p.actorName}</div>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
                      {p.isAi ? "AI" : p.joined ? "Joined" : "Not joined"}
                      {p.email && ` — ${p.email}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* All Units (god view) */}
        {gameState?.units && (
          <Card accent={colors.accent.green} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.green}>All Units ({gameState.units.length})</SectionHeader>
            <div style={{ maxHeight: 300, overflow: "auto" }}>
              {gameState.units.map(unit => {
                const actor = gameState.scenario?.actors?.find(a => a.id === unit.actor);
                return (
                  <div key={unit.id} style={{ display: "flex", alignItems: "center", gap: space[2], padding: `${space[1]}px 0`, borderBottom: `1px solid ${colors.border.subtle}`, fontSize: typography.body.sm }}>
                    <Badge color={unit.actor === "actor_1" ? colors.accent.blue : colors.accent.red} style={{ fontSize: 9, minWidth: 60 }}>
                      {actor?.name || unit.actor}
                    </Badge>
                    <span style={{ fontWeight: typography.weight.medium, flex: 1 }}>{unit.name}</span>
                    <Badge color={colors.text.muted}>{unit.type}</Badge>
                    <span style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs, color: colors.text.muted }}>{unit.position}</span>
                    {unit.strength != null && (
                      <span style={{ fontSize: typography.body.xs, color: unit.strength > 70 ? colors.accent.green : unit.strength > 30 ? colors.accent.amber : colors.accent.red }}>
                        {unit.strength}%
                      </span>
                    )}
                    <Badge color={unit.status === "destroyed" ? colors.accent.red : colors.accent.green} style={{ fontSize: 9 }}>
                      {unit.status || "active"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Game Log */}
        <Card style={{ marginBottom: space[4] }}>
          <SectionHeader>Game Log (Recent)</SectionHeader>
          <div style={{ maxHeight: 250, overflow: "auto" }}>
            {log.length === 0 ? (
              <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>No log entries yet.</div>
            ) : (
              log.map(entry => (
                <div key={entry.id} style={{ display: "flex", gap: space[2], padding: `${space[1]}px 0`, borderBottom: `1px solid ${colors.border.subtle}`, fontSize: typography.body.xs }}>
                  <span style={{ color: colors.text.muted, fontFamily: typography.monoFamily, flexShrink: 0 }}>
                    {entry.created_at?.slice(11, 19) || "??:??:??"}
                  </span>
                  {entry.turn && <Badge color={colors.accent.amber} style={{ fontSize: 9 }}>T{entry.turn}</Badge>}
                  <span style={{ color: colors.accent.cyan, fontFamily: typography.monoFamily }}>{entry.type}</span>
                  <span style={{ color: colors.text.secondary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.data_json ? entry.data_json.slice(0, 100) : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
