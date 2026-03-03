import { useState, useCallback, useRef, useEffect } from "react";
import SimMap from "./SimMap.jsx";
import { adjudicate, adjudicateRebuttal, applyStateUpdates, advanceTurn, pauseGame, resumeGame, endGame, saveGameState } from "./orchestrator.js";
import { createLogger } from "./logger.js";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge, Card, SectionHeader } from "../components/ui.jsx";
import { SCALE_TIERS, isSystemActive, DIPLOMATIC_STATUSES } from "./schemas.js";
import { buildActorBriefing, buildFullBriefing, downloadFile, downloadDataURL } from "./briefingExport.js";

// ═══════════════════════════════════════════════════════════════
// SIM GAME — Active simulation UI
// Turn cycle: Planning → Submission → Adjudication → Assessment
// ═══════════════════════════════════════════════════════════════

const ESCALATION_COLORS = {
  "de-escalating": colors.accent.green,
  "stable": colors.accent.amber,
  "escalating": colors.accent.red,
};

export default function SimGame({ onBack, gameState: initialGameState, terrainData, onUpdateGameState }) {
  const [gs, setGs] = useState(initialGameState);
  const [actions, setActions] = useState({});
  const [adjudicating, setAdjudicating] = useState(false);
  const [currentAdjudication, setCurrentAdjudication] = useState(null);
  const [fortuneRolls, setFortuneRolls] = useState(null);
  const [frictionEvents, setFrictionEvents] = useState(null);
  const [error, setError] = useState(null);

  // Rebuttal / challenge phase state
  // turnPhase: "planning" | "adjudicating" | "review_pending" | "rebuttal_input" | "re_adjudicating"
  const [turnPhase, setTurnPhase] = useState("planning");
  const [pendingAdjudication, setPendingAdjudication] = useState(null);
  const [pendingPlayerActions, setPendingPlayerActions] = useState(null);
  const [pendingResult, setPendingResult] = useState(null); // full result with fortuneRolls/frictionEvents
  const [rebuttals, setRebuttals] = useState({});
  const [challengeCount, setChallengeCount] = useState(0);
  const MAX_CHALLENGES = 1;
  const [expandedTurn, setExpandedTurn] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [moderatorNote, setModeratorNote] = useState("");
  const loggerRef = useRef(createLogger());
  const adjDisplayRef = useRef(null);
  const simMapRef = useRef(null);

  // Sync parent
  useEffect(() => {
    if (onUpdateGameState) onUpdateGameState(gs);
  }, [gs, onUpdateGameState]);

  // Initialize action fields for each actor
  useEffect(() => {
    const a = {};
    for (const actor of gs.scenario.actors) {
      a[actor.id] = actions[actor.id] || "";
    }
    setActions(a);
  }, [gs.scenario.actors]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPaused = gs.game.status === "paused";
  const isEnded = gs.game.status === "ended";
  const scaleKey = gs.game?.scale || "grand_tactical";
  const scaleTier = SCALE_TIERS[scaleKey]?.tier || 3;
  const maxTurns = gs.game.config?.maxTurns || 20;

  // Prompt viewer and re-adjudicate state
  const [showPrompt, setShowPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState("narrative"); // narrative | feasibility | escalation | changes | raw
  const [fogOfWar, setFogOfWar] = useState(false);

  // ── Submit actions → adjudicate → review_pending (state NOT applied yet) ──
  const handleSubmit = useCallback(async () => {
    const filledActions = Object.entries(actions).filter(([, v]) => v.trim());
    if (filledActions.length === 0) {
      setError("Enter at least one actor's actions before submitting.");
      return;
    }

    setTurnPhase("adjudicating");
    setAdjudicating(true);
    setError(null);
    setCurrentAdjudication(null);

    const playerActions = {};
    for (const [actorId, text] of filledActions) {
      playerActions[actorId] = text;
    }

    const result = await adjudicate(gs, playerActions, terrainData, loggerRef.current);

    // Store fortune/friction even if adjudication fails
    if (result.fortuneRolls) setFortuneRolls(result.fortuneRolls);
    if (result.frictionEvents) setFrictionEvents(result.frictionEvents);

    if (result.error && !result.adjudication) {
      setError(result.error);
      setAdjudicating(false);
      setTurnPhase("planning");
      return;
    }

    // Store pending — do NOT apply state updates yet
    setCurrentAdjudication(result.adjudication);
    setPendingAdjudication(result.adjudication);
    setPendingPlayerActions(playerActions);
    setPendingResult(result);
    setAdjudicating(false);
    setTurnPhase("review_pending");
    setChallengeCount(0);
    setRebuttals({});
    if (result.error) setError(result.error);

    setTimeout(() => {
      adjDisplayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [gs, actions, terrainData]);

  // ── Accept & Apply — finalize the pending adjudication ──
  const handleAccept = useCallback(() => {
    if (!pendingAdjudication || !pendingPlayerActions) return;

    let newGs = applyStateUpdates(gs, pendingAdjudication, pendingPlayerActions);

    if (pendingResult?.promptLog) {
      newGs = { ...newGs, promptLog: [...newGs.promptLog, pendingResult.promptLog] };
    }

    setGs(newGs);
    setTurnPhase("planning");
    setPendingAdjudication(null);
    setPendingPlayerActions(null);
    setPendingResult(null);
    loggerRef.current.flush(newGs.game.id).catch(() => {});
    saveGameState(newGs).catch(() => {});
  }, [gs, pendingAdjudication, pendingPlayerActions, pendingResult]);

  // ── Challenge — open rebuttal input ──
  const handleChallenge = useCallback(() => {
    const r = {};
    for (const actor of gs.scenario.actors) {
      r[actor.id] = "";
    }
    setRebuttals(r);
    setTurnPhase("rebuttal_input");
  }, [gs.scenario.actors]);

  // ── Submit rebuttals — re-adjudicate with same context ──
  const handleSubmitRebuttal = useCallback(async () => {
    const filledRebuttals = Object.entries(rebuttals).filter(([, v]) => v.trim());
    if (filledRebuttals.length === 0) {
      setError("Enter at least one rebuttal before submitting.");
      return;
    }

    setTurnPhase("re_adjudicating");
    setAdjudicating(true);
    setError(null);

    const result = await adjudicateRebuttal(
      gs, pendingPlayerActions, terrainData, pendingResult, rebuttals, loggerRef.current
    );

    if (result.error && !result.adjudication) {
      setError(result.error);
      setAdjudicating(false);
      setTurnPhase("review_pending"); // fall back to review
      return;
    }

    // Update pending adjudication with rebuttal result
    setCurrentAdjudication(result.adjudication);
    setPendingAdjudication(result.adjudication);
    // Merge prompt logs
    if (result.promptLog && pendingResult) {
      setPendingResult({
        ...pendingResult,
        promptLog: result.promptLog, // use latest
        adjudication: result.adjudication,
      });
    }
    setAdjudicating(false);
    setChallengeCount(c => c + 1);
    setTurnPhase("review_pending");
    if (result.error) setError(result.error);

    setTimeout(() => {
      adjDisplayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [gs, pendingPlayerActions, terrainData, pendingResult, rebuttals]);

  const handleNextTurn = useCallback(() => {
    // Must accept pending adjudication first if not yet applied
    if (pendingAdjudication && pendingPlayerActions) {
      handleAccept();
    }
    const newGs = advanceTurn(gs);
    setGs(newGs);
    setActions({});
    setCurrentAdjudication(null);
    setFortuneRolls(null);
    setFrictionEvents(null);
    setError(null);
    setModeratorNote("");
    setTurnPhase("planning");
    setPendingAdjudication(null);
    setPendingPlayerActions(null);
    setPendingResult(null);
    setChallengeCount(0);
    setRebuttals({});
    saveGameState(newGs).catch(() => {});
  }, [gs, pendingAdjudication, pendingPlayerActions, handleAccept]);

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
    loggerRef.current.flush(newGs.game.id).catch(() => {});
    saveGameState(newGs).catch(() => {});
  }, [gs]);

  const handleExportLog = useCallback(() => {
    loggerRef.current.exportLog(gs.game.name || gs.game.id);
  }, [gs]);

  // ── Export handlers ──
  const handleExportBriefing = useCallback((actorId) => {
    const md = actorId
      ? buildActorBriefing(gs, actorId, terrainData, { fortuneRolls, frictionEvents })
      : buildFullBriefing(gs, terrainData, { fortuneRolls, frictionEvents });
    const actorName = actorId
      ? (gs.scenario.actors.find(a => a.id === actorId)?.name || actorId).replace(/\s+/g, "_")
      : "full";
    downloadFile(md, `briefing_${actorName}_turn${gs.game.turn}.md`);
  }, [gs, terrainData, fortuneRolls, frictionEvents]);

  const handleExportMap = useCallback(() => {
    const dataURL = simMapRef.current?.exportImage?.();
    if (dataURL) {
      downloadDataURL(dataURL, `map_turn${gs.game.turn}.png`);
    } else {
      setError("Map export failed — could not capture image.");
    }
  }, [gs.game.turn]);

  const handleSave = useCallback(() => {
    saveGameState(gs).then(r => {
      if (r.ok) setError(null);
    }).catch(e => setError("Save failed: " + e.message));
  }, [gs]);

  // ── Render ──

  const adj = currentAdjudication?.adjudication;
  const deEsc = adj?.de_escalation_assessment;
  const hasAdjudication = !!adj;

  const feasibilityColor = (f) => f === "high" ? colors.accent.green : f === "infeasible" ? colors.accent.red : colors.accent.amber;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: colors.bg.base, color: colors.text.primary, fontFamily: typography.fontFamily, animation: "fadeIn 0.3s ease-out" }}>

      {/* Toolbar */}
      <div style={{ padding: `${space[2] + 2}px ${space[5]}px`, borderBottom: `1px solid ${colors.border.subtle}`, display: "flex", alignItems: "center", gap: space[3], flexShrink: 0 }}>
        <div style={{ fontWeight: typography.weight.bold, fontSize: typography.heading.sm }}>{gs.scenario.title || "Simulation"}</div>
        <Badge color={colors.accent.cyan} style={{ fontSize: 10 }}>{SCALE_TIERS[scaleKey]?.label || scaleKey}</Badge>
        <Badge color={colors.accent.amber} style={{ fontSize: 11, fontWeight: typography.weight.bold, animation: hasAdjudication ? "none" : "pulse 2s infinite" }}>Turn {gs.game.turn}/{maxTurns}</Badge>
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
        {/* Token usage counter */}
        {gs.promptLog.length > 0 && (
          <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
            {(() => {
              const totalTokens = gs.promptLog.reduce((sum, p) => sum + (p.tokenUsage?.total_tokens || 0), 0);
              return totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k tokens` : "";
            })()}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: space[1] + 2 }}>
          <Button variant="secondary" onClick={handleSave} size="sm">Save</Button>
          <Button variant="secondary" onClick={handleExportLog} size="sm">Export Log</Button>
          <Button variant="secondary" onClick={() => handleExportMap()} size="sm">Map PNG</Button>
          {/* Briefing export dropdown — per-actor + full */}
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
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Map */}
        <div style={{ flex: "0 0 45%", borderRight: `1px solid ${colors.border.subtle}`, position: "relative" }}>
          <SimMap ref={simMapRef} terrainData={terrainData} units={fogOfWar ? gs.units.filter(u => u.detected !== false) : gs.units} actors={gs.scenario.actors} style={{ width: "100%", height: "100%" }} fogOfWar={fogOfWar} />
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

            {/* Prompt Viewer */}
            {showPrompt && gs.promptLog.length > 0 && (
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
                        onChange={e => { const newUnits = gs.units.map((x, i) => i === ui ? { ...x, strength: parseInt(e.target.value) || 0 } : x); setGs({ ...gs, units: newUnits }); }}
                        style={{ width: 42, padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.monoFamily }} />
                      <label style={{ color: colors.text.muted }}>Spl:</label>
                      <input type="number" min="0" max="100" value={u.supply}
                        onChange={e => { const newUnits = gs.units.map((x, i) => i === ui ? { ...x, supply: parseInt(e.target.value) || 0 } : x); setGs({ ...gs, units: newUnits }); }}
                        style={{ width: 42, padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.monoFamily }} />
                      <select value={u.status}
                        onChange={e => { const newUnits = gs.units.map((x, i) => i === ui ? { ...x, status: e.target.value } : x); setGs({ ...gs, units: newUnits }); }}
                        style={{ padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.fontFamily }}>
                        {["ready", "engaged", "damaged", "retreating", "destroyed", "eliminated"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select value={u.posture || "ready"}
                        onChange={e => { const newUnits = gs.units.map((x, i) => i === ui ? { ...x, posture: e.target.value } : x); setGs({ ...gs, units: newUnits }); }}
                        style={{ padding: "2px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: 2, color: colors.text.primary, fontSize: 10, fontFamily: typography.fontFamily }}>
                        {["ready", "attacking", "defending", "moving", "dug_in", "retreating", "reserve", "routing"].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Input (Planning Phase) */}
            {!isEnded && !hasAdjudication && turnPhase === "planning" && (
              <div style={{ marginBottom: space[4] }}>
                <SectionHeader>Turn {gs.game.turn} — Enter Actions</SectionHeader>
                {gs.scenario.actors.map((actor, ai) => (
                  <div key={actor.id} style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>
                      <strong style={{ color: colors.text.primary }}>{actor.name}</strong> — {actor.objectives?.join("; ") || "No objectives"}
                    </div>
                    <textarea
                      value={actions[actor.id] || ""}
                      onChange={e => setActions(prev => ({ ...prev, [actor.id]: e.target.value }))}
                      placeholder={`Enter ${actor.name}'s orders for this turn...`}
                      disabled={isPaused}
                      style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, minHeight: 80, fontFamily: typography.fontFamily, resize: "vertical", boxSizing: "border-box", outline: "none" }}
                    />
                  </div>
                ))}
                <Button onClick={handleSubmit} disabled={adjudicating || isPaused} style={{ width: "100%" }}>
                  {adjudicating ? "Adjudicating..." : "Submit Actions"}
                </Button>
              </div>
            )}

            {/* Fortune Rolls Display */}
            {fortuneRolls && (
              <Card style={{ marginBottom: space[3], animation: "slideUp 0.3s ease-out" }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Fortune of War — Turn {gs.game.turn}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
                  {Object.entries(fortuneRolls.actorRolls).map(([actorId, roll]) => {
                    const actorName = gs.scenario.actors.find(a => a.id === actorId)?.name || actorId;
                    const rollColor = roll.roll <= 20 ? colors.accent.red : roll.roll >= 81 ? colors.accent.green : colors.text.secondary;
                    const glowBg = roll.roll <= 20 ? colors.glow.red : roll.roll >= 81 ? colors.glow.green : "transparent";
                    return (
                      <div key={actorId} style={{ padding: `${space[1]}px ${space[2]}px`, background: glowBg, border: `1px solid ${rollColor}30`, borderRadius: radius.sm, fontSize: typography.body.sm, display: "flex", alignItems: "center", gap: space[1] + 2 }}>
                        <span style={{ fontWeight: typography.weight.semibold, color: colors.text.primary }}>{actorName}</span>
                        <span style={{ fontFamily: typography.monoFamily, fontWeight: typography.weight.bold, color: rollColor, fontSize: typography.heading.sm }}>{roll.roll}</span>
                        <span style={{ color: rollColor, fontSize: typography.body.xs }}>{roll.descriptor}</span>
                      </div>
                    );
                  })}
                  {/* Wild card */}
                  {fortuneRolls.wildCard && (
                    <div style={{
                      padding: `${space[1]}px ${space[2]}px`,
                      background: fortuneRolls.wildCard.triggered ? colors.glow.amber : "transparent",
                      border: `1px solid ${fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.border.subtle}`,
                      borderRadius: radius.sm, fontSize: typography.body.sm, display: "flex", alignItems: "center", gap: space[1] + 2,
                    }}>
                      <span style={{ fontWeight: typography.weight.semibold, color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted }}>Wild Card</span>
                      <span style={{ fontFamily: typography.monoFamily, fontWeight: typography.weight.bold, color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted, fontSize: typography.heading.sm }}>{fortuneRolls.wildCard.roll}</span>
                      <span style={{ color: fortuneRolls.wildCard.triggered ? colors.accent.amber : colors.text.muted, fontSize: typography.body.xs }}>{fortuneRolls.wildCard.descriptor}</span>
                    </div>
                  )}
                </div>
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

            {/* Adjudication loading */}
            {adjudicating && (
              <div style={{ textAlign: "center", padding: space[8] }}>
                <div style={{ width: 32, height: 32, border: `3px solid ${colors.border.subtle}`, borderTop: `3px solid ${colors.accent.amber}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontSize: typography.heading.sm, color: colors.accent.amber, marginBottom: space[2], animation: "pulse 2s infinite" }}>Adjudicating Turn {gs.game.turn}...</div>
                <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>Sending to {gs.game.config.llm.provider} ({gs.game.config.llm.model})</div>
              </div>
            )}

            {/* Adjudication Results — Tabbed View */}
            {hasAdjudication && (
              <div ref={adjDisplayRef} style={{ animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>Turn {gs.game.turn} — Adjudication</SectionHeader>

                {/* Tab bar */}
                <div style={{ display: "flex", gap: 2, marginBottom: space[3], flexWrap: "wrap" }}>
                  {[
                    { key: "narrative", label: "Narrative" },
                    { key: "feasibility", label: "Feasibility" },
                    ...(deEsc ? [{ key: "escalation", label: "Escalation" }] : []),
                    { key: "changes", label: `Changes (${adj.state_updates?.length || 0})` },
                    { key: "raw", label: "Raw" },
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
                    {currentAdjudication?.meta && (
                      <div style={{ fontSize: typography.body.sm, color: colors.text.muted, marginTop: space[2] }}>
                        Confidence: {currentAdjudication.meta.confidence || "\u2014"}
                        {currentAdjudication.meta.ambiguities?.length > 0 && ` | Ambiguities: ${currentAdjudication.meta.ambiguities.join("; ")}`}
                        {currentAdjudication.meta.notes && ` | Notes: ${currentAdjudication.meta.notes}`}
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

                {/* Raw JSON tab */}
                {activeTab === "raw" && (
                  <pre style={{ background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, padding: space[2] + 2, fontSize: typography.body.xs, color: colors.text.secondary, overflow: "auto", maxHeight: 400, fontFamily: typography.monoFamily, marginBottom: space[3] }}>
                    {JSON.stringify(currentAdjudication, null, 2)}
                  </pre>
                )}

                {/* Action buttons — depends on turn phase */}
                {!isEnded && turnPhase === "review_pending" && (
                  <div style={{ marginBottom: space[2] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.accent.amber, marginBottom: space[2], display: "flex", alignItems: "center", gap: space[1] }}>
                      <Badge color={colors.accent.amber}>Pending</Badge>
                      <span>State changes have NOT been applied yet. Accept to apply, or challenge the assessment.</span>
                    </div>
                    <div style={{ display: "flex", gap: space[2] }}>
                      <Button onClick={handleAccept} style={{ flex: 1 }}>
                        Accept &amp; Apply
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleChallenge}
                        disabled={challengeCount >= MAX_CHALLENGES}
                        title={challengeCount >= MAX_CHALLENGES ? "Maximum challenges reached" : "Challenge the feasibility assessment"}
                        style={{ flex: "0 0 auto" }}
                      >
                        Challenge{challengeCount > 0 ? ` (${challengeCount}/${MAX_CHALLENGES})` : ""}
                      </Button>
                      <Button variant="secondary" onClick={() => {
                        setCurrentAdjudication(null);
                        setPendingAdjudication(null);
                        setPendingPlayerActions(null);
                        setPendingResult(null);
                        setFortuneRolls(null);
                        setFrictionEvents(null);
                        setTurnPhase("planning");
                        setChallengeCount(0);
                        setActiveTab("narrative");
                      }} style={{ flex: "0 0 auto" }}>
                        Start Over
                      </Button>
                    </div>
                  </div>
                )}
                {!isEnded && turnPhase === "planning" && hasAdjudication && (
                  <div style={{ display: "flex", gap: space[2] }}>
                    <Button onClick={handleNextTurn} disabled={isPaused} style={{ flex: 1 }}>
                      Next Turn &rarr;
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Rebuttal Input Phase */}
            {turnPhase === "rebuttal_input" && (
              <div style={{ marginBottom: space[4], animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>Challenge Assessment</SectionHeader>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
                  For each actor whose feasibility assessment you want to challenge, explain what specific factual error the adjudicator made or what data it overlooked.
                  Rhetorical arguments will likely be rejected.
                </div>
                {gs.scenario.actors.map(actor => {
                  const assessment = adj?.feasibility_analysis?.assessments?.find(a => a.actor === actor.id);
                  return (
                    <div key={actor.id} style={{ marginBottom: space[3] }}>
                      <div style={{ fontSize: typography.body.sm, marginBottom: space[1], display: "flex", alignItems: "center", gap: space[2] }}>
                        <strong style={{ color: colors.text.primary }}>{actor.name}</strong>
                        {assessment && <Badge color={feasibilityColor(assessment.feasibility)}>{assessment.feasibility}</Badge>}
                        {assessment?.reasoning && <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{assessment.reasoning.slice(0, 100)}...</span>}
                      </div>
                      <textarea
                        value={rebuttals[actor.id] || ""}
                        onChange={e => setRebuttals(prev => ({ ...prev, [actor.id]: e.target.value }))}
                        placeholder={`Challenge ${actor.name}'s assessment (leave blank to not challenge)...`}
                        style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, minHeight: 60, fontFamily: typography.fontFamily, resize: "vertical", boxSizing: "border-box", outline: "none" }}
                      />
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: space[2] }}>
                  <Button onClick={handleSubmitRebuttal} disabled={adjudicating}>
                    {adjudicating ? "Re-adjudicating..." : "Submit Rebuttals"}
                  </Button>
                  <Button variant="secondary" onClick={() => setTurnPhase("review_pending")}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Re-adjudicating spinner */}
            {turnPhase === "re_adjudicating" && (
              <div style={{ textAlign: "center", padding: space[8] }}>
                <div style={{ width: 32, height: 32, border: `3px solid ${colors.border.subtle}`, borderTop: `3px solid ${colors.accent.amber}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontSize: typography.heading.sm, color: colors.accent.amber, marginBottom: space[2], animation: "pulse 2s infinite" }}>Re-adjudicating with rebuttals...</div>
                <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>Same context + player challenges</div>
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
                          <td style={{ ...cellStyle, fontFamily: typography.monoFamily }}>{u.position}</td>
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
                  // Build hierarchy: HQ units at top, subordinates indented below
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
                    const [aId, bId] = pairKey.split("-");
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
                        {/* Moderator can edit diplomacy while paused */}
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
  // Skip time if midnight (likely date-only input)
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return `${day} ${mon} ${year}`;
  }
  return `${day} ${mon} ${year} ${hh}:${mm}`;
}

// Small dropdown for briefing export — per-actor or full
function BriefingDropdown({ actors, onExport }) {
  const [open, setOpen] = useState(false);
  return (
    <>
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
    </>
  );
}

function formatEnvironmentBrief(env) {
  if (!env) return "";
  const parts = [];
  if (env.weather && env.weather !== "clear") parts.push(env.weather);
  if (env.visibility && env.visibility !== "good" && env.visibility !== "unlimited") parts.push(`vis: ${env.visibility}`);
  if (env.groundCondition && env.groundCondition !== "dry") parts.push(env.groundCondition.replace(/_/g, " "));
  if (env.timeOfDay) parts.push(env.timeOfDay);
  return parts.length > 0 ? parts.join(" · ") : "";
}
