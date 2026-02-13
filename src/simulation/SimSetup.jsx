import { useState, useEffect, useCallback } from "react";
import { createGame, getProviders, listSavedGames, loadGameState } from "./orchestrator.js";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Input, Select, Card, Badge, SectionHeader } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Scenario configuration, terrain selection, LLM config
// ═══════════════════════════════════════════════════════════════

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
      onStart(gs, null);
    } catch (e) {
      alert("Failed to load game: " + e.message);
    }
  }, [onStart]);

  // Update actor field
  const updateActor = (idx, field, value) => {
    setActors(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

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
    <div style={{ background: colors.bg.base, height: "100%", overflow: "auto", color: colors.text.primary, fontFamily: typography.fontFamily, animation: "fadeIn 0.3s ease-out" }}>
      {/* Toolbar */}
      <div style={{ padding: `${space[3]}px ${space[6]}px`, borderBottom: `1px solid ${colors.border.subtle}`, display: "flex", alignItems: "center", gap: space[4] }}>
        <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold }}>Setup</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: space[2] }}>
          <Button variant="secondary" onClick={() => setShowLoadGame(!showLoadGame)} size="sm">Load Saved Game</Button>
          <Button onClick={handleStart} disabled={!selectedMap || !terrainData || !title.trim() || !provider} size="sm">Start Simulation</Button>
        </div>
      </div>

      {/* Load saved game panel */}
      {showLoadGame && savedGames.length > 0 && (
        <div style={{ padding: `${space[3]}px ${space[6]}px`, background: colors.bg.raised, borderBottom: `1px solid ${colors.border.subtle}` }}>
          <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>Saved Games:</div>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            {savedGames.map(g => (
              <Button key={g.file} variant="secondary" onClick={() => handleLoadGame(g.file)} size="sm">
                {g.name} ({new Date(g.modified).toLocaleDateString()})
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Main content — two columns */}
      <div style={{ display: "flex", gap: space[5], padding: space[6], maxWidth: 1400, margin: "0 auto" }}>

        {/* Left Column: Terrain + LLM Config */}
        <div style={{ flex: "0 0 380px" }}>

          {/* Terrain Selection */}
          <Card accent={colors.accent.amber} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.amber}>Terrain Map</SectionHeader>
            <Select
              value={selectedMap || ""}
              onChange={v => handleSelectMap(v)}
              options={maps.map(m => ({ value: m.name, label: `${m.name} (${(m.size / 1024).toFixed(0)}KB)` }))}
              placeholder="Select a terrain map..."
            />
            {loadingMap && <div style={{ fontSize: typography.body.sm, color: colors.text.muted, marginTop: space[2], animation: "pulse 1.5s infinite" }}>Loading terrain data...</div>}
            {terrainData && !loadingMap && (
              <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginTop: space[2], lineHeight: 1.5 }}>
                <Badge color={colors.accent.green} style={{ marginRight: space[1] }}>{terrainData.cols}&times;{terrainData.rows}</Badge>
                {terrainData.cellSizeKm}km/cell
                {terrainData.center && <> &middot; {terrainData.center.lat.toFixed(2)}, {terrainData.center.lng.toFixed(2)}</>}
                {terrainData.widthKm && <> &middot; {terrainData.widthKm}&times;{terrainData.heightKm}km</>}
              </div>
            )}
          </Card>

          {/* LLM Configuration */}
          <Card accent={colors.accent.blue} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.blue}>LLM Configuration</SectionHeader>
            {providers.length === 0 ? (
              <div style={{ fontSize: typography.body.sm, color: colors.accent.red, lineHeight: 1.5, padding: space[2], background: colors.glow.red, borderRadius: radius.md }}>
                No LLM providers configured. Add API keys to your .env file (see .env.example).
              </div>
            ) : (
              <>
                <div style={{ marginBottom: space[3] }}>
                  <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>Provider</div>
                  <select value={provider} onChange={e => { setProvider(e.target.value); const p = providers.find(p => p.id === e.target.value); setModel(p?.models?.[0] || ""); }}
                    style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, fontFamily: typography.fontFamily }}>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: space[3] }}>
                  <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1] }}>Model</div>
                  <select value={model} onChange={e => setModel(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md, color: colors.text.primary, fontSize: typography.body.md, fontFamily: typography.fontFamily }}>
                    {selectedProvider?.models?.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1], display: "flex", justifyContent: "space-between" }}>
                    <span>Temperature</span>
                    <span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold, fontFamily: typography.monoFamily }}>{temperature}</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: colors.accent.amber }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: typography.body.xs, color: colors.text.muted }}>
                    <span>Deterministic (0.0)</span><span>Creative (1.0)</span>
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* Turn settings */}
          <Card style={{ marginBottom: space[4] }}>
            <SectionHeader>Turn Settings</SectionHeader>
            <Input label="Turn Duration" value={turnDuration} onChange={setTurnDuration} placeholder="e.g., 12 hours, 1 day, 1 week" />
            <Input label="In-Game Start Date" value={startDate} onChange={setStartDate} placeholder="e.g., 1950-12-01" />
          </Card>
        </div>

        {/* Right Column: Scenario + Actors + Units */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Scenario */}
          <Card style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.green}>Scenario</SectionHeader>
            <Input label="Title" value={title} onChange={setTitle} placeholder="e.g., Chosin Reservoir, December 1950" />
            <Input label="Description" value={description} onChange={setDescription} placeholder="Brief scenario description..." multiline />
            <Input label="Initial Conditions" value={initialConditions} onChange={setInitialConditions} placeholder="Overall starting situation..." multiline />
            <Input label="Special Rules" value={specialRules} onChange={setSpecialRules} placeholder="Scenario-specific adjudication guidance..." multiline />
          </Card>

          {/* Actors */}
          <Card style={{ marginBottom: space[4] }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: space[3] }}>
              <SectionHeader style={{ marginBottom: 0 }}>Actors</SectionHeader>
              <Button variant="ghost" onClick={addActor} size="sm" style={{ marginLeft: "auto" }}>+ Add Actor</Button>
            </div>

            {actors.map((actor, ai) => (
              <div key={ai} style={{
                border: `1px solid ${colors.border.subtle}`,
                borderLeft: `3px solid ${ACTOR_COLORS[ai % ACTOR_COLORS.length]}`,
                borderRadius: radius.md,
                padding: space[3],
                marginBottom: space[3],
                background: colors.bg.base,
                animation: "fadeIn 0.2s ease-out",
              }}>
                <div style={{ display: "flex", gap: space[2], marginBottom: space[2] }}>
                  <div style={{ flex: 1 }}>
                    <Input label="Name" value={actor.name} onChange={v => updateActor(ai, "name", v)} placeholder="Actor name" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Input label="ID" value={actor.id} onChange={v => updateActor(ai, "id", v)} placeholder="snake_case_id" />
                  </div>
                  {actors.length > 2 && (
                    <Button variant="danger" onClick={() => removeActor(ai)} size="sm" style={{ alignSelf: "flex-end", marginBottom: space[3] }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                    </Button>
                  )}
                </div>

                {/* Objectives */}
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1], fontWeight: typography.weight.medium }}>Objectives</div>
                {actor.objectives.map((obj, oi) => (
                  <div key={oi} style={{ display: "flex", gap: space[1], marginBottom: space[1] }}>
                    <input value={obj} onChange={e => updateActorList(ai, "objectives", oi, e.target.value)}
                      placeholder="Objective..."
                      style={{ flex: 1, padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                    {actor.objectives.length > 1 && (
                      <button onClick={() => removeActorListItem(ai, "objectives", oi)} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 14 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addActorListItem(ai, "objectives")} style={{ background: "none", border: "none", color: colors.accent.amber, cursor: "pointer", fontSize: typography.body.sm, padding: "2px 0", marginBottom: space[2], fontFamily: typography.fontFamily }}>+ objective</button>

                {/* Constraints */}
                <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[1], fontWeight: typography.weight.medium }}>Constraints</div>
                {actor.constraints.map((con, ci) => (
                  <div key={ci} style={{ display: "flex", gap: space[1], marginBottom: space[1] }}>
                    <input value={con} onChange={e => updateActorList(ai, "constraints", ci, e.target.value)}
                      placeholder="Constraint..."
                      style={{ flex: 1, padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                    {actor.constraints.length > 1 && (
                      <button onClick={() => removeActorListItem(ai, "constraints", ci)} style={{ background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 14 }}>&times;</button>
                    )}
                  </div>
                ))}
                <button onClick={() => addActorListItem(ai, "constraints")} style={{ background: "none", border: "none", color: colors.accent.amber, cursor: "pointer", fontSize: typography.body.sm, padding: "2px 0", fontFamily: typography.fontFamily }}>+ constraint</button>
              </div>
            ))}
          </Card>

          {/* Units */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", marginBottom: space[3] }}>
              <SectionHeader style={{ marginBottom: 0 }}>Units</SectionHeader>
              <div style={{ marginLeft: "auto", display: "flex", gap: space[1] }}>
                {actors.map(a => (
                  <Button key={a.id} variant="ghost" onClick={() => addUnit(a.id)} size="sm">
                    + {a.name} Unit
                  </Button>
                ))}
              </div>
            </div>

            {units.length === 0 && (
              <div style={{ fontSize: typography.body.sm, color: colors.text.muted, textAlign: "center", padding: space[5] }}>
                No units added. Units are optional for Phase 1 — the LLM can adjudicate based on scenario descriptions alone.
              </div>
            )}

            {units.map((unit, ui) => {
              const ownerActor = actors.find(a => a.id === unit.actor);
              const actorIdx = actors.findIndex(a => a.id === unit.actor);
              return (
                <div key={ui} style={{
                  border: `1px solid ${colors.border.subtle}`,
                  borderLeft: `3px solid ${ACTOR_COLORS[actorIdx % ACTOR_COLORS.length] || colors.text.muted}`,
                  borderRadius: radius.md,
                  padding: space[2] + 2,
                  marginBottom: space[2],
                  background: colors.bg.base,
                  animation: "fadeIn 0.2s ease-out",
                }}>
                  <div style={{ display: "flex", gap: space[2], alignItems: "center", marginBottom: space[1] }}>
                    <Badge color={ACTOR_COLORS[actorIdx % ACTOR_COLORS.length]}>{ownerActor?.name || unit.actor}</Badge>
                    <button onClick={() => removeUnit(ui)} style={{ marginLeft: "auto", background: "none", border: "none", color: colors.text.muted, cursor: "pointer", fontSize: 12, fontFamily: typography.fontFamily }}>&times; remove</button>
                  </div>
                  <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                    <input value={unit.name} onChange={e => updateUnit(ui, "name", e.target.value)} placeholder="Unit name"
                      style={{ flex: "1 1 150px", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                    <select value={unit.type} onChange={e => updateUnit(ui, "type", e.target.value)}
                      style={{ flex: "0 0 120px", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily }}>
                      {["infantry", "mechanized", "armor", "artillery", "air", "naval", "special_forces", "logistics", "headquarters", "other"].map(t =>
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      )}
                    </select>
                    <input value={unit.position} onChange={e => updateUnit(ui, "position", e.target.value)} placeholder="Position (e.g., C5)"
                      style={{ flex: "0 0 100px", padding: "6px 8px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: colors.text.primary, fontSize: typography.body.sm, fontFamily: typography.fontFamily, outline: "none" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: space[1] }}>
                      <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Str</span>
                      <input type="number" value={unit.strength} onChange={e => updateUnit(ui, "strength", parseInt(e.target.value) || 0)} min="0" max="100"
                        style={{ width: 50, padding: "6px 4px", background: colors.bg.input, border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm, color: unit.strength > 70 ? colors.accent.green : unit.strength > 30 ? colors.accent.amber : colors.accent.red, fontSize: typography.body.sm, textAlign: "center", fontFamily: typography.monoFamily, fontWeight: typography.weight.semibold, outline: "none" }} />
                      <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
