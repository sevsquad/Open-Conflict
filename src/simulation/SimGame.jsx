import { useState, useCallback, useRef, useEffect } from "react";
import SimMap from "./SimMap.jsx";
import { adjudicate, applyStateUpdates, advanceTurn, pauseGame, resumeGame, endGame, saveGameState } from "./orchestrator.js";
import { createLogger } from "./logger.js";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge, Card, SectionHeader } from "../components/ui.jsx";

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
  const [error, setError] = useState(null);
  const [expandedTurn, setExpandedTurn] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [moderatorNote, setModeratorNote] = useState("");
  const loggerRef = useRef(createLogger());
  const adjDisplayRef = useRef(null);

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

  // ── Submit actions ──
  const handleSubmit = useCallback(async () => {
    const filledActions = Object.entries(actions).filter(([, v]) => v.trim());
    if (filledActions.length === 0) {
      setError("Enter at least one actor's actions before submitting.");
      return;
    }

    setAdjudicating(true);
    setError(null);
    setCurrentAdjudication(null);

    const playerActions = {};
    for (const [actorId, text] of filledActions) {
      playerActions[actorId] = text;
    }

    const result = await adjudicate(gs, playerActions, terrainData, loggerRef.current);

    if (result.error && !result.adjudication) {
      setError(result.error);
      setAdjudicating(false);
      return;
    }

    setCurrentAdjudication(result.adjudication);

    let newGs = applyStateUpdates(gs, result.adjudication);

    if (newGs.turnLog.length > 0) {
      const lastEntry = { ...newGs.turnLog[newGs.turnLog.length - 1], actions: playerActions };
      newGs = { ...newGs, turnLog: [...newGs.turnLog.slice(0, -1), lastEntry] };
    }

    if (result.promptLog) {
      newGs = { ...newGs, promptLog: [...newGs.promptLog, result.promptLog] };
    }

    setGs(newGs);
    setAdjudicating(false);
    loggerRef.current.flush(newGs.game.id).catch(() => {});
    saveGameState(newGs).catch(() => {});
    if (result.error) setError(result.error);

    setTimeout(() => {
      adjDisplayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [gs, actions, terrainData]);

  const handleNextTurn = useCallback(() => {
    const newGs = advanceTurn(gs);
    setGs(newGs);
    setActions({});
    setCurrentAdjudication(null);
    setError(null);
    setModeratorNote("");
    saveGameState(newGs).catch(() => {});
  }, [gs]);

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
        <Badge color={colors.accent.amber} style={{ fontSize: 11, fontWeight: typography.weight.bold, animation: hasAdjudication ? "none" : "pulse 2s infinite" }}>Turn {gs.game.turn}</Badge>
        {isPaused && <Badge color={colors.accent.red} style={{ fontWeight: typography.weight.bold }}>PAUSED</Badge>}
        {isEnded && <Badge color={colors.text.muted} style={{ fontWeight: typography.weight.bold }}>ENDED</Badge>}
        {deEsc?.escalation_direction && (
          <Badge color={ESCALATION_COLORS[deEsc.escalation_direction] || colors.text.muted}>
            {deEsc.current_escalation_level || ""} ({deEsc.escalation_direction})
          </Badge>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: space[1] + 2 }}>
          <Button variant="secondary" onClick={handleSave} size="sm">Save</Button>
          <Button variant="secondary" onClick={handleExportLog} size="sm">Export Log</Button>
          {!isPaused && !isEnded && <Button variant="danger" onClick={handlePause} size="sm">Pause</Button>}
          {isPaused && <Button variant="success" onClick={handleResume} size="sm">Resume</Button>}
          <Button variant="danger" onClick={handleEnd} size="sm">End</Button>
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Map */}
        <div style={{ flex: "0 0 45%", borderRight: `1px solid ${colors.border.subtle}`, position: "relative" }}>
          <SimMap terrainData={terrainData} units={gs.units} actors={gs.scenario.actors} style={{ width: "100%", height: "100%" }} />
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

            {/* Pause moderator note */}
            {isPaused && (
              <div style={{ padding: space[3], background: `${colors.accent.red}08`, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, marginBottom: space[3] }}>
                <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, color: colors.accent.red, marginBottom: space[2] }}>Simulation Paused (Kill Switch Active)</div>
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>You can edit unit values directly while paused. Add a moderator note before resuming.</div>
                <textarea value={moderatorNote} onChange={e => setModeratorNote(e.target.value)}
                  placeholder="Moderator notes (reason for pause, state corrections made...)"
                  style={{ width: "100%", padding: space[2], background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, minHeight: 50, boxSizing: "border-box", fontFamily: typography.fontFamily, outline: "none" }} />
              </div>
            )}

            {/* Action Input (Planning Phase) */}
            {!isEnded && !hasAdjudication && (
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

            {/* Adjudication loading */}
            {adjudicating && (
              <div style={{ textAlign: "center", padding: space[8] }}>
                <div style={{ width: 32, height: 32, border: `3px solid ${colors.border.subtle}`, borderTop: `3px solid ${colors.accent.amber}`, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontSize: typography.heading.sm, color: colors.accent.amber, marginBottom: space[2], animation: "pulse 2s infinite" }}>Adjudicating Turn {gs.game.turn}...</div>
                <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>Sending to {gs.game.config.llm.provider} ({gs.game.config.llm.model})</div>
              </div>
            )}

            {/* Adjudication Results */}
            {hasAdjudication && (
              <div ref={adjDisplayRef} style={{ animation: "slideUp 0.3s ease-out" }}>
                <SectionHeader accent={colors.accent.amber}>Turn {gs.game.turn} — Adjudication</SectionHeader>

                {/* Narrative */}
                {adj.outcome_determination?.narrative && (
                  <Card style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Narrative</div>
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

                {/* Feasibility Assessments */}
                {adj.feasibility_analysis?.assessments?.length > 0 && (
                  <div style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>Feasibility Assessments</div>
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

                {/* De-escalation Assessment */}
                {deEsc && (
                  <Card style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>De-escalation Assessment</div>
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

                {/* State Changes */}
                {adj.state_updates?.length > 0 && (
                  <Card style={{ marginBottom: space[3] }}>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], letterSpacing: 1, textTransform: "uppercase", fontWeight: typography.weight.semibold }}>State Changes</div>
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

                {/* Meta */}
                {currentAdjudication?.meta && (
                  <div style={{ fontSize: typography.body.sm, color: colors.text.muted, marginBottom: space[3] }}>
                    Confidence: {currentAdjudication.meta.confidence || "\u2014"}
                    {currentAdjudication.meta.ambiguities?.length > 0 && ` | Ambiguities: ${currentAdjudication.meta.ambiguities.join("; ")}`}
                    {currentAdjudication.meta.notes && ` | Notes: ${currentAdjudication.meta.notes}`}
                  </div>
                )}

                {/* Raw JSON toggle */}
                <div style={{ marginBottom: space[3] }}>
                  <button onClick={() => setShowRaw(!showRaw)} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: typography.body.sm, textDecoration: "underline", fontFamily: typography.fontFamily }}>
                    {showRaw ? "Hide raw JSON" : "Show raw JSON"}
                  </button>
                  {showRaw && (
                    <pre style={{ background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, padding: space[2] + 2, fontSize: typography.body.xs, color: colors.text.secondary, overflow: "auto", maxHeight: 300, marginTop: space[1], fontFamily: typography.monoFamily }}>
                      {JSON.stringify(currentAdjudication, null, 2)}
                    </pre>
                  )}
                </div>

                {/* Next Turn button */}
                {!isEnded && (
                  <Button onClick={handleNextTurn} disabled={isPaused} style={{ width: "100%" }}>
                    Next Turn &rarr;
                  </Button>
                )}
              </div>
            )}

            {/* Unit Roster */}
            {gs.units.length > 0 && (
              <div style={{ marginTop: space[4] }}>
                <SectionHeader>Unit Roster</SectionHeader>
                <table style={{ width: "100%", fontSize: typography.body.sm, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: colors.text.muted, textAlign: "left" }}>
                      {["Unit", "Actor", "Type", "Pos", "Str", "Spl", "Status"].map(h => (
                        <th key={h} style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, fontWeight: typography.weight.medium, fontSize: typography.body.xs, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gs.units.map((u, i) => (
                      <tr key={u.id} style={{ background: i % 2 === 0 ? "transparent" : `${colors.bg.raised}80` }}>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, fontWeight: typography.weight.semibold }}>{u.name}</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, color: colors.text.secondary }}>{gs.scenario.actors.find(a => a.id === u.actor)?.name || u.actor}</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, color: colors.text.secondary }}>{u.type}</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, fontFamily: typography.monoFamily }}>{u.position}</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, color: u.strength > 50 ? colors.accent.green : u.strength > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{u.strength}%</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}`, color: u.supply > 50 ? colors.accent.green : u.supply > 25 ? colors.accent.amber : colors.accent.red, fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold }}>{u.supply}%</td>
                        <td style={{ padding: `${space[1]}px ${space[2]}px`, borderBottom: `1px solid ${colors.border.subtle}` }}><Badge color={u.status === "ready" ? colors.accent.green : u.status === "destroyed" ? colors.accent.red : colors.text.muted}>{u.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
