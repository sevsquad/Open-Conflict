import { useState, useEffect, useCallback } from "react";
import { createGame, getProviders, listSavedGames, loadGameState } from "./orchestrator.js";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Scenario configuration, terrain selection, LLM config
// ═══════════════════════════════════════════════════════════════

const S = {
  bg: "#0F172A", card: "#111827", border: "#1E293B", borderHover: "#F59E0B",
  text: "#E5E7EB", muted: "#9CA3AF", dim: "#64748B",
  accent: "#F59E0B", accentBg: "#F59E0B15", accentBorder: "#F59E0B30",
  danger: "#EF4444", input: "#0D1520",
};

function Input({ label, value, onChange, placeholder, multiline, ...rest }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>{label}</div>}
      <Tag
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "8px 10px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 6, color: S.text, fontSize: 13, fontFamily: "inherit", resize: multiline ? "vertical" : undefined, minHeight: multiline ? 60 : undefined, boxSizing: "border-box" }}
        {...rest}
      />
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "primary", style: extraStyle }) {
  const base = { padding: "8px 16px", borderRadius: 6, cursor: disabled ? "default" : "pointer", fontSize: 13, fontWeight: 600, border: "none", transition: "all 0.2s", opacity: disabled ? 0.5 : 1 };
  const variants = {
    primary: { background: S.accent, color: "#000" },
    secondary: { background: "transparent", color: S.muted, border: `1px solid ${S.border}` },
    danger: { background: S.danger + "20", color: S.danger, border: `1px solid ${S.danger}40` },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...extraStyle }}>{children}</button>;
}

export default function SimSetup({ onBack, onStart }) {
  // ── Terrain maps ──
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [terrainData, setTerrainData] = useState(null);
  const [loadingMap, setLoadingMap] = useState(false);

  // ── LLM providers ──
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.4);

  // ── Saved games ──
  const [savedGames, setSavedGames] = useState([]);
  const [showLoadGame, setShowLoadGame] = useState(false);

  // ── Scenario config ──
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [turnDuration, setTurnDuration] = useState("1 day");
  const [startDate, setStartDate] = useState("");
  const [initialConditions, setInitialConditions] = useState("");
  const [specialRules, setSpecialRules] = useState("");

  // ── Actors ──
  const [actors, setActors] = useState([
    { id: "actor_1", name: "Side A", controller: "player", objectives: [""], constraints: [""] },
    { id: "actor_2", name: "Side B", controller: "player", objectives: [""], constraints: [""] },
  ]);

  // ── Units ──
  const [units, setUnits] = useState([]);

  // Load available terrain maps and LLM providers on mount
  useEffect(() => {
    fetch("/api/saves").then(r => r.json()).then(setMaps).catch(() => {});
    getProviders().then(data => {
      setProviders(data.providers || []);
      if (data.providers?.length > 0) {
        setProvider(data.providers[0].id);
        setModel(data.providers[0].models?.[0] || "");
      }
    }).catch(() => {});
    listSavedGames().then(setSavedGames).catch(() => {});
  }, []);

  // Load terrain data when a map is selected
  const handleSelectMap = useCallback(async (mapName) => {
    setSelectedMap(mapName);
    setLoadingMap(true);
    try {
      const resp = await fetch(`/api/load?file=${encodeURIComponent(mapName)}`);
      const data = await resp.json();
      setTerrainData(data);
    } catch (e) {
      console.error("Failed to load terrain:", e);
    }
    setLoadingMap(false);
  }, []);

  // Load a saved game
  const handleLoadGame = useCallback(async (file) => {
    try {
      const gs = await loadGameState(file);
      onStart(gs, null); // terrainData loaded separately if needed
    } catch (e) {
      alert("Failed to load game: " + e.message);
    }
  }, [onStart]);

  // Update actor field
  const updateActor = (idx, field, value) => {
    setActors(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  // Update actor list field (objectives, constraints)
  const updateActorList = (idx, field, listIdx, value) => {
    setActors(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      const newList = [...a[field]];
      newList[listIdx] = value;
      return { ...a, [field]: newList };
    }));
  };

  const addActorListItem = (idx, field) => {
    setActors(prev => prev.map((a, i) => i === idx ? { ...a, [field]: [...a[field], ""] } : a));
  };

  const removeActorListItem = (idx, field, listIdx) => {
    setActors(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      return { ...a, [field]: a[field].filter((_, li) => li !== listIdx) };
    }));
  };

  const addActor = () => {
    const num = actors.length + 1;
    setActors([...actors, { id: `actor_${num}`, name: `Side ${String.fromCharCode(64 + num)}`, controller: "player", objectives: [""], constraints: [""] }]);
  };

  const removeActor = (idx) => {
    if (actors.length <= 2) return;
    setActors(actors.filter((_, i) => i !== idx));
  };

  // Add/remove units
  const addUnit = (actorId) => {
    setUnits([...units, {
      id: `unit_${Date.now()}`,
      actor: actorId,
      name: "",
      type: "infantry",
      position: "",
      strength: 100,
      supply: 100,
      status: "ready",
      notes: ""
    }]);
  };

  const updateUnit = (idx, field, value) => {
    setUnits(prev => prev.map((u, i) => i === idx ? { ...u, [field]: value } : u));
  };

  const removeUnit = (idx) => {
    setUnits(units.filter((_, i) => i !== idx));
  };

  // Start simulation
  const handleStart = () => {
    if (!selectedMap || !terrainData) { alert("Please select a terrain map."); return; }
    if (!title.trim()) { alert("Please enter a scenario title."); return; }
    if (!provider || !model) { alert("No LLM provider configured. Check your .env file."); return; }

    const scenario = {
      title: title.trim(),
      description: description.trim(),
      turnDuration,
      startDate,
      actors: actors.map(a => ({
        ...a,
        id: a.id || a.name.toLowerCase().replace(/\s+/g, "_"),
        objectives: a.objectives.filter(o => o.trim()),
        constraints: a.constraints.filter(c => c.trim()),
      })),
      initialConditions,
      specialRules,
      units: units.filter(u => u.name.trim()),
    };

    const gameState = createGame({
      scenario,
      terrainRef: selectedMap,
      terrainData,
      llmConfig: { provider, model, temperature }
    });

    onStart(gameState, terrainData);
  };

  const selectedProvider = providers.find(p => p.id === provider);

  // ── Render ──

  return (
    <div style={{ background: S.bg, minHeight: "100vh", color: S.text, fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: S.muted, cursor: "pointer", fontSize: 13 }}>&larr; Back</button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Simulation Setup</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={() => setShowLoadGame(!showLoadGame)}>Load Saved Game</Btn>
          <Btn onClick={handleStart} disabled={!selectedMap || !terrainData || !title.trim() || !provider}>Start Simulation</Btn>
        </div>
      </div>

      {/* Load saved game panel */}
      {showLoadGame && savedGames.length > 0 && (
        <div style={{ padding: "12px 24px", background: S.card, borderBottom: `1px solid ${S.border}` }}>
          <div style={{ fontSize: 12, color: S.muted, marginBottom: 8 }}>Saved Games:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {savedGames.map(g => (
              <Btn key={g.file} variant="secondary" onClick={() => handleLoadGame(g.file)}>
                {g.name} ({new Date(g.modified).toLocaleDateString()})
              </Btn>
            ))}
          </div>
        </div>
      )}

      {/* Main content — two columns */}
      <div style={{ display: "flex", gap: 20, padding: 24, maxWidth: 1400, margin: "0 auto" }}>

        {/* Left Column: Terrain + LLM Config */}
        <div style={{ flex: "0 0 380px" }}>

          {/* Terrain Selection */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Terrain Map</div>
            <select
              value={selectedMap || ""}
              onChange={e => handleSelectMap(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 6, color: S.text, fontSize: 13 }}
            >
              <option value="">Select a terrain map...</option>
              {maps.map(m => (
                <option key={m.name} value={m.name}>{m.name} ({(m.size / 1024).toFixed(0)}KB)</option>
              ))}
            </select>
            {loadingMap && <div style={{ fontSize: 11, color: S.dim, marginTop: 8 }}>Loading...</div>}
            {terrainData && !loadingMap && (
              <div style={{ fontSize: 11, color: S.muted, marginTop: 8, lineHeight: 1.5 }}>
                {terrainData.cols}&times;{terrainData.rows} cells, {terrainData.cellSizeKm}km/cell
                {terrainData.center && <> &middot; {terrainData.center.lat.toFixed(2)}, {terrainData.center.lng.toFixed(2)}</>}
                {terrainData.widthKm && <> &middot; {terrainData.widthKm}&times;{terrainData.heightKm}km</>}
              </div>
            )}
          </div>

          {/* LLM Configuration */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>LLM Configuration</div>
            {providers.length === 0 ? (
              <div style={{ fontSize: 12, color: S.danger, lineHeight: 1.5 }}>
                No LLM providers configured. Add API keys to your .env file (see .env.example).
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Provider</div>
                  <select value={provider} onChange={e => { setProvider(e.target.value); const p = providers.find(p => p.id === e.target.value); setModel(p?.models?.[0] || ""); }}
                    style={{ width: "100%", padding: "8px 10px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 6, color: S.text, fontSize: 13 }}>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Model</div>
                  <select value={model} onChange={e => setModel(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 6, color: S.text, fontSize: 13 }}>
                    {selectedProvider?.models?.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Temperature: {temperature}</div>
                  <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))}
                    style={{ width: "100%" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: S.dim }}>
                    <span>Deterministic (0.0)</span><span>Creative (1.0)</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Turn settings */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Turn Settings</div>
            <Input label="Turn Duration" value={turnDuration} onChange={setTurnDuration} placeholder="e.g., 12 hours, 1 day, 1 week" />
            <Input label="In-Game Start Date" value={startDate} onChange={setStartDate} placeholder="e.g., 1950-12-01" />
          </div>
        </div>

        {/* Right Column: Scenario + Actors + Units */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Scenario */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Scenario</div>
            <Input label="Title" value={title} onChange={setTitle} placeholder="e.g., Chosin Reservoir, December 1950" />
            <Input label="Description" value={description} onChange={setDescription} placeholder="Brief scenario description..." multiline />
            <Input label="Initial Conditions" value={initialConditions} onChange={setInitialConditions} placeholder="Overall starting situation..." multiline />
            <Input label="Special Rules" value={specialRules} onChange={setSpecialRules} placeholder="Scenario-specific adjudication guidance..." multiline />
          </div>

          {/* Actors */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Actors</div>
              <Btn variant="secondary" onClick={addActor} style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}>+ Add Actor</Btn>
            </div>

            {actors.map((actor, ai) => (
              <div key={ai} style={{ border: `1px solid ${S.border}`, borderRadius: 6, padding: 12, marginBottom: 12, background: S.bg }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Input label="Name" value={actor.name} onChange={v => updateActor(ai, "name", v)} placeholder="Actor name" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Input label="ID" value={actor.id} onChange={v => updateActor(ai, "id", v)} placeholder="snake_case_id" />
                  </div>
                  {actors.length > 2 && (
                    <Btn variant="danger" onClick={() => removeActor(ai)} style={{ alignSelf: "flex-end", marginBottom: 12, padding: "4px 8px", fontSize: 11 }}>Remove</Btn>
                  )}
                </div>

                {/* Objectives */}
                <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Objectives</div>
                {actor.objectives.map((obj, oi) => (
                  <div key={oi} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    <input value={obj} onChange={e => updateActorList(ai, "objectives", oi, e.target.value)}
                      placeholder="Objective..."
                      style={{ flex: 1, padding: "6px 8px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12 }} />
                    {actor.objectives.length > 1 && (
                      <button onClick={() => removeActorListItem(ai, "objectives", oi)} style={{ background: "none", border: "none", color: S.dim, cursor: "pointer", fontSize: 14 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addActorListItem(ai, "objectives")} style={{ background: "none", border: "none", color: S.accent, cursor: "pointer", fontSize: 11, padding: "2px 0", marginBottom: 8 }}>+ objective</button>

                {/* Constraints */}
                <div style={{ fontSize: 11, color: S.muted, marginBottom: 4 }}>Constraints</div>
                {actor.constraints.map((con, ci) => (
                  <div key={ci} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    <input value={con} onChange={e => updateActorList(ai, "constraints", ci, e.target.value)}
                      placeholder="Constraint..."
                      style={{ flex: 1, padding: "6px 8px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12 }} />
                    {actor.constraints.length > 1 && (
                      <button onClick={() => removeActorListItem(ai, "constraints", ci)} style={{ background: "none", border: "none", color: S.dim, cursor: "pointer", fontSize: 14 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addActorListItem(ai, "constraints")} style={{ background: "none", border: "none", color: S.accent, cursor: "pointer", fontSize: 11, padding: "2px 0" }}>+ constraint</button>
              </div>
            ))}
          </div>

          {/* Units */}
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Units</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {actors.map(a => (
                  <Btn key={a.id} variant="secondary" onClick={() => addUnit(a.id)} style={{ padding: "4px 10px", fontSize: 11 }}>
                    + {a.name} Unit
                  </Btn>
                ))}
              </div>
            </div>

            {units.length === 0 && (
              <div style={{ fontSize: 12, color: S.dim, textAlign: "center", padding: 20 }}>
                No units added. Units are optional for Phase 1 — the LLM can adjudicate based on scenario descriptions alone.
              </div>
            )}

            {units.map((unit, ui) => {
              const ownerActor = actors.find(a => a.id === unit.actor);
              return (
                <div key={ui} style={{ border: `1px solid ${S.border}`, borderRadius: 6, padding: 10, marginBottom: 8, background: S.bg }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: S.accent }}>{ownerActor?.name || unit.actor}</span>
                    <button onClick={() => removeUnit(ui)} style={{ marginLeft: "auto", background: "none", border: "none", color: S.dim, cursor: "pointer", fontSize: 12 }}>&times; remove</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={unit.name} onChange={e => updateUnit(ui, "name", e.target.value)} placeholder="Unit name"
                      style={{ flex: "1 1 150px", padding: "6px 8px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12 }} />
                    <select value={unit.type} onChange={e => updateUnit(ui, "type", e.target.value)}
                      style={{ flex: "0 0 120px", padding: "6px 8px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12 }}>
                      {["infantry", "mechanized", "armor", "artillery", "air", "naval", "special_forces", "logistics", "headquarters", "other"].map(t =>
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      )}
                    </select>
                    <input value={unit.position} onChange={e => updateUnit(ui, "position", e.target.value)} placeholder="Position (e.g., C5)"
                      style={{ flex: "0 0 100px", padding: "6px 8px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12 }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: S.dim }}>Str</span>
                      <input type="number" value={unit.strength} onChange={e => updateUnit(ui, "strength", parseInt(e.target.value) || 0)} min="0" max="100"
                        style={{ width: 50, padding: "6px 4px", background: S.input, border: `1px solid ${S.border}`, borderRadius: 4, color: S.text, fontSize: 12, textAlign: "center" }} />
                      <span style={{ fontSize: 10, color: S.dim }}>%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
