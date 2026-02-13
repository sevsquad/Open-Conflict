import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Input, Select, CollapsibleSection } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";

// ═══════════════════════════════════════════════════════════════
// SETUP LEFT SIDEBAR — Scenario, Actors, LLM, Turn Settings
// ═══════════════════════════════════════════════════════════════

export default function SetupLeftSidebar({ state, dispatch, providers, open, onToggle }) {
  const {
    title, description, initialConditions, specialRules,
    actors, turnDuration, startDate,
    provider, model, temperature,
  } = state;

  const selectedProvider = providers.find(p => p.id === provider);

  return (
    <div style={{
      width: open ? 300 : 0, overflow: "hidden",
      transition: `width ${animation.normal} ${animation.easeOut}`,
      flexShrink: 0, display: "flex",
    }}>
      {/* Collapse toggle */}
      <div style={{
        position: "relative", width: open ? 300 : 0, overflow: "hidden",
        transition: `width ${animation.normal} ${animation.easeOut}`,
      }}>
        <div style={{
          width: 300, height: "100%", overflowY: "auto", overflowX: "hidden",
          padding: space[3], borderRight: `1px solid ${colors.border.subtle}`,
          background: colors.bg.raised, boxSizing: "border-box",
        }}>
          {/* Scenario */}
          <CollapsibleSection title="Scenario" accent={colors.accent.green}>
            <Input label="Title" value={title} onChange={v => dispatch({ type: "SET_FIELD", field: "title", value: v })} placeholder="e.g., Chosin Reservoir, December 1950" />
            <Input label="Description" value={description} onChange={v => dispatch({ type: "SET_FIELD", field: "description", value: v })} placeholder="Brief scenario description..." multiline />
            <Input label="Initial Conditions" value={initialConditions} onChange={v => dispatch({ type: "SET_FIELD", field: "initialConditions", value: v })} placeholder="Overall starting situation..." multiline />
            <Input label="Special Rules" value={specialRules} onChange={v => dispatch({ type: "SET_FIELD", field: "specialRules", value: v })} placeholder="Scenario-specific adjudication guidance..." multiline />
          </CollapsibleSection>

          {/* Actors */}
          <CollapsibleSection title="Actors" accent={colors.accent.blue}>
            {actors.map((actor, ai) => (
              <div key={ai} style={{
                border: `1px solid ${colors.border.subtle}`,
                borderLeft: `3px solid ${ACTOR_COLORS[ai % ACTOR_COLORS.length]}`,
                borderRadius: radius.md,
                padding: space[2],
                marginBottom: space[2],
                background: colors.bg.base,
              }}>
                <div style={{ display: "flex", gap: space[1], marginBottom: space[1] }}>
                  <input value={actor.name} onChange={e => dispatch({ type: "UPDATE_ACTOR", idx: ai, field: "name", value: e.target.value })}
                    placeholder="Name"
                    style={{ flex: 1, padding: "4px 6px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                  <input value={actor.id} onChange={e => dispatch({ type: "UPDATE_ACTOR", idx: ai, field: "id", value: e.target.value })}
                    placeholder="ID"
                    style={{ flex: 1, padding: "4px 6px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                  {actors.length > 2 && (
                    <button onClick={() => dispatch({ type: "REMOVE_ACTOR", idx: ai })} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 12 }}>&times;</button>
                  )}
                </div>

                {/* Objectives */}
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, marginTop: space[1] }}>Objectives</div>
                {actor.objectives.map((obj, oi) => (
                  <div key={oi} style={{ display: "flex", gap: 2, marginBottom: 2 }}>
                    <input value={obj} onChange={e => dispatch({ type: "UPDATE_ACTOR_LIST", idx: ai, field: "objectives", listIdx: oi, value: e.target.value })}
                      placeholder="Objective..."
                      style={{ flex: 1, padding: "3px 6px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.fontFamily, outline: "none" }} />
                    {actor.objectives.length > 1 && (
                      <button onClick={() => dispatch({ type: "REMOVE_ACTOR_LIST_ITEM", idx: ai, field: "objectives", listIdx: oi })} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 11 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => dispatch({ type: "ADD_ACTOR_LIST_ITEM", idx: ai, field: "objectives" })} style={{ background: "none", border: "none", color: colors.accent.amber, cursor: "pointer", fontSize: typography.body.xs, padding: "1px 0", fontFamily: typography.fontFamily }}>+ objective</button>

                {/* Constraints */}
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, marginTop: space[1] }}>Constraints</div>
                {actor.constraints.map((con, ci) => (
                  <div key={ci} style={{ display: "flex", gap: 2, marginBottom: 2 }}>
                    <input value={con} onChange={e => dispatch({ type: "UPDATE_ACTOR_LIST", idx: ai, field: "constraints", listIdx: ci, value: e.target.value })}
                      placeholder="Constraint..."
                      style={{ flex: 1, padding: "3px 6px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.xs, fontFamily: typography.fontFamily, outline: "none" }} />
                    {actor.constraints.length > 1 && (
                      <button onClick={() => dispatch({ type: "REMOVE_ACTOR_LIST_ITEM", idx: ai, field: "constraints", listIdx: ci })} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 11 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => dispatch({ type: "ADD_ACTOR_LIST_ITEM", idx: ai, field: "constraints" })} style={{ background: "none", border: "none", color: colors.accent.amber, cursor: "pointer", fontSize: typography.body.xs, padding: "1px 0", fontFamily: typography.fontFamily }}>+ constraint</button>
              </div>
            ))}
            <Button variant="ghost" onClick={() => dispatch({ type: "ADD_ACTOR" })} size="sm" style={{ width: "100%" }}>+ Add Actor</Button>
          </CollapsibleSection>

          {/* LLM Configuration */}
          <CollapsibleSection title="LLM Configuration" accent={colors.accent.cyan}>
            {providers.length === 0 ? (
              <div style={{ fontSize: typography.body.sm, color: colors.accent.red, lineHeight: 1.5, padding: space[2], background: colors.glow.red, borderRadius: radius.md }}>
                No LLM providers configured. Add API keys to your .env file.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Provider</div>
                  <select value={provider} onChange={e => {
                    dispatch({ type: "SET_FIELD", field: "provider", value: e.target.value });
                    const p = providers.find(p => p.id === e.target.value);
                    dispatch({ type: "SET_FIELD", field: "model", value: p?.models?.[0] || "" });
                  }}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Model</div>
                  <select value={model} onChange={e => dispatch({ type: "SET_FIELD", field: "model", value: e.target.value })}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}>
                    {selectedProvider?.models?.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                    <span>Temperature</span>
                    <span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold, fontFamily: typography.monoFamily }}>{temperature}</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => dispatch({ type: "SET_FIELD", field: "temperature", value: parseFloat(e.target.value) })}
                    style={{ width: "100%", accentColor: colors.accent.amber }} />
                </div>
              </>
            )}
          </CollapsibleSection>

          {/* Turn Settings */}
          <CollapsibleSection title="Turn Settings">
            <Input label="Turn Duration" value={turnDuration} onChange={v => dispatch({ type: "SET_FIELD", field: "turnDuration", value: v })} placeholder="e.g., 12 hours, 1 day" />
            <Input label="Start Date" value={startDate} onChange={v => dispatch({ type: "SET_FIELD", field: "startDate", value: v })} placeholder="e.g., 1950-12-01" />
          </CollapsibleSection>
        </div>
      </div>

      {/* Collapse toggle button */}
      <button
        onClick={onToggle}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          width: 20, flexShrink: 0, background: colors.bg.surface,
          border: "none", borderRight: `1px solid ${colors.border.subtle}`,
          color: colors.text.muted, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 10,
          padding: 0,
        }}
      >
        {open ? "\u25C0" : "\u25B6"}
      </button>
    </div>
  );
}
