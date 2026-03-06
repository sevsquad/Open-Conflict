import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Input, Select, CollapsibleSection } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { SCALE_TIERS, SCALE_KEYS, WEATHER_OPTIONS, VISIBILITY_OPTIONS, GROUND_OPTIONS, TIME_OF_DAY_OPTIONS, CLIMATE_OPTIONS, STABILITY_OPTIONS, SEVERITY_OPTIONS } from "./schemas.js";

// ═══════════════════════════════════════════════════════════════
// SETUP LEFT SIDEBAR — Scale, Scenario, Actors, LLM, Turn Settings
// ═══════════════════════════════════════════════════════════════

export default function SetupLeftSidebar({ state, dispatch, providers, open, onToggle, cellSizeKm }) {
  const {
    scale, title, description, initialConditions, specialRules,
    actors, turnDuration, startDate, environment,
    provider, model, temperature,
    strategicEnabled, strategicHexSizeKm,
  } = state;

  const selectedProvider = providers.find(p => p.id === provider);
  const currentScale = SCALE_TIERS[scale] || SCALE_TIERS.grand_tactical;

  const handleScaleChange = (newScale) => {
    dispatch({ type: "SET_FIELD", field: "scale", value: newScale });
    // Update turn duration to the default for this scale
    const tier = SCALE_TIERS[newScale];
    if (tier) {
      dispatch({ type: "SET_FIELD", field: "turnDuration", value: tier.defaultTurn });
    }
  };

  return (
    <div style={{
      display: "flex", flexShrink: 0,
      width: open ? 320 : 20,
      transition: `width ${animation.normal} ${animation.easeOut}`,
    }}>
      {/* Content */}
      <div style={{
        width: open ? 300 : 0, overflow: "hidden",
        transition: `width ${animation.normal} ${animation.easeOut}`,
      }}>
        <div style={{
          width: 300, height: "100%", overflowY: "auto", overflowX: "hidden",
          padding: space[3], borderRight: `1px solid ${colors.border.subtle}`,
          background: colors.bg.raised, boxSizing: "border-box",
        }}>
          {/* Scale Selector — determines everything else */}
          <CollapsibleSection title="Scale" accent={colors.accent.cyan}>
            <div style={{ marginBottom: space[1] }}>
              <select
                value={scale}
                onChange={e => handleScaleChange(e.target.value)}
                style={{
                  width: "100%", padding: "6px 8px", background: colors.bg.input,
                  border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md,
                  color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily,
                }}
              >
                {SCALE_KEYS.map(key => {
                  const t = SCALE_TIERS[key];
                  return <option key={key} value={key}>{t.label} ({t.hexRange}/hex)</option>;
                })}
              </select>
            </div>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, lineHeight: 1.5 }}>
              <div>Hex size: <span style={{ color: colors.accent.cyan }}>{currentScale.hexRange}</span></div>
              <div>Turn length: <span style={{ color: colors.accent.cyan }}>{currentScale.turnRange}</span></div>
              <div>Unit echelons: <span style={{ color: colors.accent.cyan }}>{currentScale.echelons.join(", ")}</span></div>
            </div>
          </CollapsibleSection>

          {/* Strategic Overlay — optional multi-scale hex rendering */}
          {cellSizeKm && (
            <CollapsibleSection title="Strategic Overlay" accent={colors.accent.amber}>
              <label style={{
                display: "flex", alignItems: "center", gap: space[2],
                fontSize: typography.body.sm, color: colors.text.primary,
                cursor: "pointer", marginBottom: space[2],
              }}>
                <input
                  type="checkbox"
                  checked={strategicEnabled}
                  onChange={e => dispatch({ type: "SET_FIELD", field: "strategicEnabled", value: e.target.checked })}
                  style={{ accentColor: colors.accent.amber }}
                />
                Enable Strategic Grid
              </label>
              {strategicEnabled && (
                <>
                  <div style={{ marginBottom: space[2] }}>
                    <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 2 }}>
                      Strategic Hex Size: {strategicHexSizeKm} km
                    </label>
                    <input
                      type="range"
                      min={Math.ceil(cellSizeKm * 3)}
                      max={Math.min(Math.ceil(cellSizeKm * 20), 100)}
                      step={1}
                      value={strategicHexSizeKm}
                      onChange={e => dispatch({ type: "SET_FIELD", field: "strategicHexSizeKm", value: Number(e.target.value) })}
                      style={{ width: "100%", accentColor: colors.accent.amber }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: colors.text.muted }}>
                      <span>{Math.ceil(cellSizeKm * 3)} km</span>
                      <span>{Math.min(Math.ceil(cellSizeKm * 20), 100)} km</span>
                    </div>
                  </div>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, lineHeight: 1.5 }}>
                    Base hex: <span style={{ color: colors.accent.amber }}>{cellSizeKm} km</span>
                    {" · "}Ratio: <span style={{ color: colors.accent.amber }}>{(strategicHexSizeKm / cellSizeKm).toFixed(1)}×</span>
                  </div>
                </>
              )}
            </CollapsibleSection>
          )}

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
                    const firstModel = p?.models?.[0];
                    dispatch({ type: "SET_FIELD", field: "model", value: firstModel?.id || "" });
                    dispatch({ type: "SET_FIELD", field: "temperature", value: firstModel?.temperature ?? 0.4 });
                  }}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: space[2] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>Model</div>
                  <select value={model} onChange={e => {
                    dispatch({ type: "SET_FIELD", field: "model", value: e.target.value });
                    const modelObj = selectedProvider?.models?.find(m => m.id === e.target.value);
                    dispatch({ type: "SET_FIELD", field: "temperature", value: modelObj?.temperature ?? 0.4 });
                  }}
                    style={{ width: "100%", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}>
                    {selectedProvider?.models?.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                </div>
                <div>
                  {(() => {
                    const selectedModel = selectedProvider?.models?.find(m => m.id === model);
                    const tempLocked = selectedModel?.temperature != null;
                    return (<>
                      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
                        <span>Temperature{tempLocked ? " (locked)" : ""}</span>
                        <span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold, fontFamily: typography.monoFamily }}>{temperature}</span>
                      </div>
                      <input type="range" min="0" max="1" step="0.1" value={temperature} disabled={tempLocked} onChange={e => dispatch({ type: "SET_FIELD", field: "temperature", value: parseFloat(e.target.value) })}
                    style={{ width: "100%", accentColor: colors.accent.amber, opacity: tempLocked ? 0.5 : 1 }} />
                    </>);
                  })()}
                </div>
              </>
            )}
          </CollapsibleSection>

          {/* Turn Settings */}
          <CollapsibleSection title="Turn Settings">
            <Input label="Turn Duration" value={turnDuration} onChange={v => dispatch({ type: "SET_FIELD", field: "turnDuration", value: v })} placeholder="e.g., 12 hours, 1 day" />
            <Input label="Start Date" value={startDate} onChange={v => dispatch({ type: "SET_FIELD", field: "startDate", value: v })} placeholder="e.g., 1950-12-01" />
          </CollapsibleSection>

          {/* Environment Conditions */}
          <CollapsibleSection title="Environment" accent={colors.accent.green}>
            <EnvSelect label="Climate" value={environment?.climate || "temperate"} options={CLIMATE_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "climate", value: v })} />
            <EnvSelect label="Weather" value={environment?.weather || "clear"} options={WEATHER_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "weather", value: v })} />
            <EnvSelect label="Visibility" value={environment?.visibility || "good"} options={VISIBILITY_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "visibility", value: v })} />
            <EnvSelect label="Ground" value={environment?.groundCondition || "dry"} options={GROUND_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "groundCondition", value: v })} />
            <EnvSelect label="Time of Day" value={environment?.timeOfDay || "morning"} options={TIME_OF_DAY_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "timeOfDay", value: v })} />
            <EnvSelect label="Stability" value={environment?.stability || "medium"} options={STABILITY_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "stability", value: v })} />
            <EnvSelect label="Severity" value={environment?.severity || "moderate"} options={SEVERITY_OPTIONS}
              onChange={v => dispatch({ type: "UPDATE_ENVIRONMENT", field: "severity", value: v })} />
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

// ── Helpers ──────────────────────────────────────────────────

// Capitalize and prettify option values: "snow_covered" → "Snow Covered"
function formatOption(val) {
  return val.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function EnvSelect({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: space[2] }}>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "5px 8px", background: colors.bg.input,
          border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md,
          color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily,
        }}
      >
        {options.map(opt => <option key={opt} value={opt}>{formatOption(opt)}</option>)}
      </select>
    </div>
  );
}
