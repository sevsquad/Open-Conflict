import { useState, useCallback, useRef, useEffect } from "react";
import SimMap from "./SimMap.jsx";
import { adjudicate, applyStateUpdates, advanceTurn, pauseGame, resumeGame, endGame, saveGameState } from "./orchestrator.js";
import { createLogger } from "./logger.js";

// ═══════════════════════════════════════════════════════════════
// SIM GAME — Active simulation UI
// Turn cycle: Planning → Submission → Adjudication → Assessment
// ═══════════════════════════════════════════════════════════════

const S = {
  bg: "#0F172A", card: "#111827", border: "#1E293B",
  text: "#E5E7EB", muted: "#9CA3AF", dim: "#64748B",
  accent: "#F59E0B", accentBg: "#F59E0B15",
  green: "#22C55E", red: "#EF4444", blue: "#3B82F6",
  input: "#0D1520",
};

const ESCALATION_COLORS = {
  "de-escalating": S.green,
  "stable": S.accent,
  "escalating": S.red,
};

function Btn({ children, onClick, disabled, variant = "primary", style: extraStyle }) {
  const base = { padding: "8px 16px", borderRadius: 6, cursor: disabled ? "default" : "pointer", fontSize: 13, fontWeight: 600, border: "none", transition: "all 0.2s", opacity: disabled ? 0.5 : 1 };
  const variants = {
    primary: { background: S.accent, color: "#000" },
    secondary: { background: "transparent", color: S.muted, border: `1px solid ${S.border}` },
    danger: { background: S.red + "20", color: S.red, border: `1px solid ${S.red}40` },
    success: { background: S.green + "20", color: S.green, border: `1px solid ${S.green}40` },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...extraStyle }}>{children}</button>;
}

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
    // Validate at least one action entered
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

    // Store the raw adjudication for display
    setCurrentAdjudication(result.adjudication);

    // Apply state updates
    let newGs = applyStateUpdates(gs, result.adjudication);

    // Fill in the actions on the turn log entry
    if (newGs.turnLog.length > 0) {
      const lastEntry = { ...newGs.turnLog[newGs.turnLog.length - 1], actions: playerActions };
      newGs = { ...newGs, turnLog: [...newGs.turnLog.slice(0, -1), lastEntry] };
    }

    // Add prompt log
    if (result.promptLog) {
      newGs = { ...newGs, promptLog: [...newGs.promptLog, result.promptLog] };
    }

    setGs(newGs);
    setAdjudicating(false);

    // Flush logs
    loggerRef.current.flush(newGs.game.id).catch(() => {});

    // Auto-save
    saveGameState(newGs).catch(() => {});

    if (result.error) setError(result.error);

    // Scroll to adjudication display
    setTimeout(() => {
      adjDisplayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [gs, actions, terrainData]);

  // ── Next turn ──
  const handleNextTurn = useCallback(() => {
    const newGs = advanceTurn(gs);
    setGs(newGs);
    setActions({});
    setCurrentAdjudication(null);
    setError(null);
    setModeratorNote("");
    saveGameState(newGs).catch(() => {});
  }, [gs]);

  // ── Kill switch (F.6) ──
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: S.bg, color: S.text, fontFamily: "Arial, sans-serif" }}>

      {/* Header Bar */}
      <div style={{ padding: "10px 20px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: S.muted, cursor: "pointer", fontSize: 13 }}>&larr; Setup</button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{gs.scenario.title || "Simulation"}</div>
        <div style={{ fontSize: 12, color: S.accent, fontWeight: 600 }}>Turn {gs.game.turn}</div>
        {isPaused && <span style={{ fontSize: 11, color: S.red, fontWeight: 700, padding: "2px 8px", background: S.red + "15", borderRadius: 4 }}>PAUSED</span>}
        {isEnded && <span style={{ fontSize: 11, color: S.dim, fontWeight: 700, padding: "2px 8px", background: "#333", borderRadius: 4 }}>ENDED</span>}
        {deEsc?.escalation_direction && (
          <span style={{ fontSize: 11, color: ESCALATION_COLORS[deEsc.escalation_direction] || S.muted, padding: "2px 8px", border: `1px solid ${ESCALATION_COLORS[deEsc.escalation_direction] || S.border}40`, borderRadius: 4 }}>
            {deEsc.current_escalation_level || ""}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Btn variant="secondary" onClick={handleSave} style={{ padding: "4px 10px", fontSize: 11 }}>Save</Btn>
          <Btn variant="secondary" onClick={handleExportLog} style={{ padding: "4px 10px", fontSize: 11 }}>Export Log</Btn>
          {!isPaused && !isEnded && <Btn variant="danger" onClick={handlePause} style={{ padding: "4px 10px", fontSize: 11 }}>Pause</Btn>}
          {isPaused && <Btn variant="success" onClick={handleResume} style={{ padding: "4px 10px", fontSize: 11 }}>Resume</Btn>}
          <Btn variant="danger" onClick={handleEnd} style={{ padding: "4px 10px", fontSize: 11 }}>End</Btn>
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: Map */}
        <div style={{ flex: "0 0 45%", borderRight: `1px solid ${S.border}`, position: "relative" }}>
          <SimMap terrainData={terrainData} units={gs.units} actors={gs.scenario.actors} style={{ width: "100%", height: "100%" }} />
        </div>

        {/* Right: Turn panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

            {/* Error banner */}
            {error && (
              <div style={{ padding: "8px 12px", background: S.red + "15", border: `1px solid ${S.red}30`, borderRadius: 6, fontSize: 12, color: S.red, marginBottom: 12 }}>
                {error}
              </div>
            )}

            {/* Pause moderator note */}
            {isPaused && (
              <div style={{ padding: 12, background: S.red + "08", border: `1px solid ${S.red}30`, borderRadius: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: S.red, marginBottom: 8 }}>Simulation Paused (Kill Switch Active)</div>
                <div style={{ fontSize: 11, color: S.muted, marginBottom: 8 }}>You can edit unit values directly while paused. Add a moderator note before resuming.</div>
                <textarea value={moderatorNote} onChange={e => setModeratorNote(e.target.value)}
                  placeholder="Moderator notes (reason for pause, state corrections made...)"
                  style={{ width: "100%", padding: 8, background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12, minHeight: 50, boxSizing: "border-box" }} />
              </div>
            )}

            {/* Action Input (Planning Phase) */}
            {!isEnded && !hasAdjudication && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  Turn {gs.game.turn} — Enter Actions
                </div>
                {gs.scenario.actors.map(actor => (
                  <div key={actor.id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>
                      <strong style={{ color: S.text }}>{actor.name}</strong> — {actor.objectives?.join("; ") || "No objectives"}
                    </div>
                    <textarea
                      value={actions[actor.id] || ""}
                      onChange={e => setActions(prev => ({ ...prev, [actor.id]: e.target.value }))}
                      placeholder={`Enter ${actor.name}'s orders for this turn...`}
                      disabled={isPaused}
                      style={{ width: "100%", padding: "8px 10px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 6, color: S.text, fontSize: 13, minHeight: 80, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                ))}
                <Btn onClick={handleSubmit} disabled={adjudicating || isPaused} style={{ width: "100%" }}>
                  {adjudicating ? "Adjudicating..." : "Submit Actions"}
                </Btn>
              </div>
            )}

            {/* Adjudication loading */}
            {adjudicating && (
              <div style={{ textAlign: "center", padding: 30 }}>
                <div style={{ fontSize: 14, color: S.accent, marginBottom: 8 }}>Adjudicating Turn {gs.game.turn}...</div>
                <div style={{ fontSize: 11, color: S.dim }}>Sending to {gs.game.config.llm.provider} ({gs.game.config.llm.model})</div>
              </div>
            )}

            {/* Adjudication Results */}
            {hasAdjudication && (
              <div ref={adjDisplayRef}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: S.accent }}>
                  Turn {gs.game.turn} — Adjudication
                </div>

                {/* Narrative */}
                {adj.outcome_determination?.narrative && (
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>NARRATIVE</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {adj.outcome_determination.narrative}
                    </div>
                    {adj.outcome_determination.outcome_type && (
                      <div style={{ marginTop: 8, fontSize: 11, color: S.muted }}>
                        Outcome: <strong style={{ color: adj.outcome_determination.outcome_type === "success" ? S.green : adj.outcome_determination.outcome_type === "failure" ? S.red : S.accent }}>{adj.outcome_determination.outcome_type}</strong>
                        {adj.outcome_determination.probability_assessment && ` — ${adj.outcome_determination.probability_assessment}`}
                      </div>
                    )}
                  </div>
                )}

                {/* Feasibility Assessments */}
                {adj.feasibility_analysis?.assessments?.length > 0 && (
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>FEASIBILITY ASSESSMENTS</div>
                    {adj.feasibility_analysis.assessments.map((a, i) => (
                      <div key={i} style={{ marginBottom: i < adj.feasibility_analysis.assessments.length - 1 ? 10 : 0, paddingBottom: 10, borderBottom: i < adj.feasibility_analysis.assessments.length - 1 ? `1px solid ${S.border}` : "none" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                          {a.actor}
                          <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", borderRadius: 3, background: a.feasibility === "high" ? S.green + "20" : a.feasibility === "infeasible" ? S.red + "20" : S.accent + "20", color: a.feasibility === "high" ? S.green : a.feasibility === "infeasible" ? S.red : S.accent }}>{a.feasibility}</span>
                        </div>
                        {a.reasoning && <div style={{ fontSize: 12, color: S.muted, marginBottom: 4 }}>{a.reasoning}</div>}
                        {a.weaknesses_identified?.length > 0 && (
                          <div style={{ fontSize: 11, color: S.red }}>
                            Weaknesses: {a.weaknesses_identified.join("; ")}
                          </div>
                        )}
                        {a.citations?.length > 0 && (
                          <div style={{ fontSize: 10, color: S.dim, marginTop: 2 }}>
                            Citations: {a.citations.join(", ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* De-escalation Assessment */}
                {deEsc && (
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>DE-ESCALATION ASSESSMENT</div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      Level: <strong>{deEsc.current_escalation_level}</strong>
                      {deEsc.escalation_direction && (
                        <span style={{ marginLeft: 8, color: ESCALATION_COLORS[deEsc.escalation_direction] || S.muted }}>
                          ({deEsc.escalation_direction})
                        </span>
                      )}
                    </div>
                    {deEsc.de_escalation_options_available?.length > 0 && (
                      <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>
                        Options available: {deEsc.de_escalation_options_available.join("; ")}
                      </div>
                    )}
                    {deEsc.diplomatic_offramps_status && (
                      <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Off-ramps: {deEsc.diplomatic_offramps_status}</div>
                    )}
                    {deEsc.historical_base_rate && (
                      <div style={{ fontSize: 11, color: S.dim }}>Historical: {deEsc.historical_base_rate}</div>
                    )}
                  </div>
                )}

                {/* State Changes */}
                {adj.state_updates?.length > 0 && (
                  <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>STATE CHANGES</div>
                    {adj.state_updates.map((u, i) => (
                      <div key={i} style={{ fontSize: 12, marginBottom: 4, display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ color: S.accent, fontWeight: 600 }}>{u.entity}</span>
                        <span style={{ color: S.dim }}>.{u.attribute}:</span>
                        <span style={{ color: S.red, textDecoration: "line-through" }}>{JSON.stringify(u.old_value)}</span>
                        <span style={{ color: S.dim }}>&rarr;</span>
                        <span style={{ color: S.green }}>{JSON.stringify(u.new_value)}</span>
                        {u.justification && <span style={{ fontSize: 10, color: S.dim, fontStyle: "italic" }}>({u.justification})</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Meta */}
                {currentAdjudication?.meta && (
                  <div style={{ fontSize: 11, color: S.dim, marginBottom: 12 }}>
                    Confidence: {currentAdjudication.meta.confidence || "—"}
                    {currentAdjudication.meta.ambiguities?.length > 0 && ` | Ambiguities: ${currentAdjudication.meta.ambiguities.join("; ")}`}
                    {currentAdjudication.meta.notes && ` | Notes: ${currentAdjudication.meta.notes}`}
                  </div>
                )}

                {/* Raw JSON toggle */}
                <div style={{ marginBottom: 12 }}>
                  <button onClick={() => setShowRaw(!showRaw)} style={{ background: "none", border: "none", color: S.dim, cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>
                    {showRaw ? "Hide raw JSON" : "Show raw JSON"}
                  </button>
                  {showRaw && (
                    <pre style={{ background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, padding: 10, fontSize: 10, color: S.muted, overflow: "auto", maxHeight: 300, marginTop: 4 }}>
                      {JSON.stringify(currentAdjudication, null, 2)}
                    </pre>
                  )}
                </div>

                {/* Next Turn button */}
                {!isEnded && (
                  <Btn onClick={handleNextTurn} disabled={isPaused} style={{ width: "100%" }}>
                    Next Turn &rarr;
                  </Btn>
                )}
              </div>
            )}

            {/* Unit Roster */}
            {gs.units.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Unit Roster</div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: S.dim, textAlign: "left" }}>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Unit</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Actor</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Type</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Pos</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Str</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Spl</th>
                      <th style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gs.units.map(u => (
                      <tr key={u.id}>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, fontWeight: 600 }}>{u.name}</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, color: S.muted }}>{gs.scenario.actors.find(a => a.id === u.actor)?.name || u.actor}</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, color: S.muted }}>{u.type}</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}` }}>{u.position}</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, color: u.strength > 50 ? S.green : u.strength > 25 ? S.accent : S.red }}>{u.strength}%</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, color: u.supply > 50 ? S.green : u.supply > 25 ? S.accent : S.red }}>{u.supply}%</td>
                        <td style={{ padding: "4px 8px", borderBottom: `1px solid ${S.border}`, color: S.dim }}>{u.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Turn History */}
            {gs.turnLog.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Turn History</div>
                {[...gs.turnLog].reverse().map((entry, i) => (
                  <div key={entry.turn} style={{ border: `1px solid ${S.border}`, borderRadius: 6, marginBottom: 6, overflow: "hidden" }}>
                    <div
                      onClick={() => setExpandedTurn(expandedTurn === entry.turn ? null : entry.turn)}
                      style={{ padding: "8px 12px", background: S.card, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                    >
                      <span style={{ color: S.accent, fontWeight: 600 }}>Turn {entry.turn}</span>
                      <span style={{ color: S.muted, flex: 1 }}>
                        {entry.adjudication?.narrative?.slice(0, 80)}{entry.adjudication?.narrative?.length > 80 ? "..." : ""}
                      </span>
                      <span style={{ color: S.dim, fontSize: 10 }}>{expandedTurn === entry.turn ? "▼" : "▶"}</span>
                    </div>
                    {expandedTurn === entry.turn && (
                      <div style={{ padding: 12, fontSize: 12, lineHeight: 1.6 }}>
                        {entry.actions && Object.keys(entry.actions).length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: S.dim, marginBottom: 4 }}>ACTIONS:</div>
                            {Object.entries(entry.actions).map(([actorId, text]) => (
                              <div key={actorId} style={{ marginBottom: 4 }}>
                                <strong>{gs.scenario.actors.find(a => a.id === actorId)?.name || actorId}:</strong> {text}
                              </div>
                            ))}
                          </div>
                        )}
                        {entry.adjudication?.narrative && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: S.dim, marginBottom: 4 }}>OUTCOME:</div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{entry.adjudication.narrative}</div>
                          </div>
                        )}
                        {entry.adjudication?.stateUpdates?.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: S.dim, marginBottom: 4 }}>STATE CHANGES:</div>
                            {entry.adjudication.stateUpdates.map((u, j) => (
                              <div key={j} style={{ fontSize: 11, color: S.muted }}>
                                {u.entity}.{u.attribute}: {JSON.stringify(u.old_value)} → {JSON.stringify(u.new_value)}
                              </div>
                            ))}
                          </div>
                        )}
                        {entry.moderatorNotes && (
                          <div style={{ marginTop: 6, fontSize: 11, color: S.accent }}>
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
