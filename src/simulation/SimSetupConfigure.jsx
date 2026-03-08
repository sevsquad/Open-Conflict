import { useReducer, useEffect, useCallback, useState, useRef, useMemo } from "react";
import { colors, typography, radius, animation, space, shadows } from "../theme.js";
import { Button, Badge } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { createGame, createGameFolder, getProviders } from "./orchestrator.js";
import { cellToPositionString, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { getPresetsForMap, getPresetById } from "./presets.js";
import { SCALE_TIERS, getDefaultEchelon, getEchelonsForScale, DEFAULT_ENVIRONMENT, getUnitFieldsForScale } from "./schemas.js";
import SimMap from "./SimMap.jsx";
import SetupLeftSidebar from "./SetupLeftSidebar.jsx";
import SetupRightSidebar from "./SetupRightSidebar.jsx";
import { buildStrategicGrid } from "../mapRenderer/StrategicGrid.js";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP CONFIGURE — Step 2: Map-centric sandbox setup
// Three-panel layout: left sidebar + map + right sidebar
// ═══════════════════════════════════════════════════════════════

// ── Reducer ──────────────────────────────────────────────────

function createInitialState(terrainData, selectedMap) {
  return {
    // Scale (determines what systems, unit types, and prompt sections are active)
    scale: "grand_tactical",

    // Scenario
    title: "",
    description: "",
    initialConditions: "",
    specialRules: "",
    turnDuration: "4 hours",
    startDate: "",

    // Actors
    actors: [
      { id: "actor_1", name: "Side A", controller: "player", objectives: [""], constraints: [""] },
      { id: "actor_2", name: "Side B", controller: "player", objectives: [""], constraints: [""] },
    ],

    // Units
    units: [],

    // Environment
    environment: { ...DEFAULT_ENVIRONMENT },

    // LLM
    provider: "",
    model: "",
    temperature: 0.4,

    // Era selections (per-actor dropdown state, keyed by actorId → eraId)
    eraSelections: {},

    // Interaction
    interactionMode: "navigate",
    placementPayload: null, // { actorId, unitType, template? }
    selectedUnitId: null,
    selectedCell: null, // { c, r } — cell being edited in terrain edit mode
    ghostCell: null,

    // Strategic overlay (optional multi-scale rendering)
    strategicEnabled: false,
    strategicHexSizeKm: 5, // default strategic hex size

    // UI
    leftSidebarOpen: true,
    rightSidebarOpen: true,
  };
}

let unitCounter = 0;

function setupReducer(state, action) {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };

    case "ADD_ACTOR": {
      const num = state.actors.length + 1;
      // Timestamp-based ID avoids collisions after add/remove cycles
      const newId = `actor_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      return {
        ...state,
        actors: [...state.actors, {
          id: newId,
          name: `Side ${String.fromCharCode(64 + num)}`,
          controller: "player",
          objectives: [""],
          constraints: [""],
        }],
      };
    }

    case "REMOVE_ACTOR": {
      if (state.actors.length <= 2) return state;
      const removedActorId = state.actors[action.idx]?.id;
      return {
        ...state,
        actors: state.actors.filter((_, i) => i !== action.idx),
        // Clean up orphaned units belonging to the removed actor
        units: removedActorId ? state.units.filter(u => u.actor !== removedActorId) : state.units,
      };
    }

    case "UPDATE_ACTOR":
      return {
        ...state,
        actors: state.actors.map((a, i) => i === action.idx ? { ...a, [action.field]: action.value } : a),
      };

    case "UPDATE_ACTOR_LIST":
      return {
        ...state,
        actors: state.actors.map((a, i) => {
          if (i !== action.idx) return a;
          const newList = [...a[action.field]];
          newList[action.listIdx] = action.value;
          return { ...a, [action.field]: newList };
        }),
      };

    case "ADD_ACTOR_LIST_ITEM":
      return {
        ...state,
        actors: state.actors.map((a, i) => i === action.idx ? { ...a, [action.field]: [...a[action.field], ""] } : a),
      };

    case "REMOVE_ACTOR_LIST_ITEM":
      return {
        ...state,
        actors: state.actors.map((a, i) => {
          if (i !== action.idx) return a;
          return { ...a, [action.field]: a[action.field].filter((_, li) => li !== action.listIdx) };
        }),
      };

    case "SET_ACTOR_ERA":
      return { ...state, eraSelections: { ...state.eraSelections, [action.actorId]: action.eraId } };

    case "ADD_UNIT": {
      const tierNum = SCALE_TIERS[state.scale]?.tier || 3;
      const scaleFields = getUnitFieldsForScale(tierNum);
      const tpl = action.template;
      const newUnit = {
        id: `unit_${Date.now()}_${++unitCounter}`,
        actor: action.actorId,
        name: tpl?.name || "",
        type: action.unitType || "infantry",
        templateId: tpl?.templateId || null,
        echelon: getDefaultEchelon(state.scale),
        posture: "ready",
        position: action.position || "",
        strength: 100,
        supply: 100,
        status: "ready",
        notes: "",
        ...scaleFields,
        ...(tpl?.defaults || {}),
      };
      return {
        ...state,
        units: [...state.units, newUnit],
        selectedUnitId: newUnit.id,
      };
    }

    case "REMOVE_UNIT": {
      const newUnits = state.units.filter(u => u.id !== action.unitId);
      return {
        ...state,
        units: newUnits,
        selectedUnitId: state.selectedUnitId === action.unitId ? null : state.selectedUnitId,
      };
    }

    case "UPDATE_UNIT":
      // Supports both idx (legacy) and unitId (preferred) for identification
      return {
        ...state,
        units: state.units.map((u, i) =>
          (action.unitId ? u.id === action.unitId : i === action.idx)
            ? { ...u, [action.field]: action.value } : u
        ),
      };

    case "VALIDATE_UNITS_FOR_SCALE": {
      // Auto-fix echelons that are invalid for the new scale
      const validEchelons = new Set(getEchelonsForScale(action.newScale));
      const defaultEch = getDefaultEchelon(action.newScale);
      return {
        ...state,
        units: state.units.map(u =>
          validEchelons.has(u.echelon) ? u : { ...u, echelon: defaultEch }
        ),
      };
    }

    case "DUPLICATE_UNIT": {
      const original = state.units.find(u => u.id === action.unitId);
      if (!original) return state;
      const dup = {
        ...original,
        id: `unit_${Date.now()}_${++unitCounter}`,
        name: original.name ? `${original.name} (copy)` : "",
      };
      return {
        ...state,
        units: [...state.units, dup],
        selectedUnitId: dup.id,
      };
    }

    case "ENTER_PLACEMENT_MODE":
      return {
        ...state,
        interactionMode: "place_unit",
        placementPayload: { actorId: action.actorId, unitType: action.unitType, template: action.template || null },
        selectedUnitId: null,
      };

    case "EXIT_PLACEMENT_MODE":
      return {
        ...state,
        interactionMode: "navigate",
        placementPayload: null,
      };

    case "SELECT_UNIT":
      return {
        ...state,
        selectedUnitId: action.unitId === state.selectedUnitId ? null : action.unitId,
        interactionMode: "navigate",
        placementPayload: null,
      };

    case "SET_GHOST_CELL":
      return { ...state, ghostCell: action.cell };

    case "TOGGLE_LEFT_SIDEBAR":
      return { ...state, leftSidebarOpen: !state.leftSidebarOpen };

    case "TOGGLE_RIGHT_SIDEBAR":
      return { ...state, rightSidebarOpen: !state.rightSidebarOpen };

    case "UPDATE_ENVIRONMENT":
      return {
        ...state,
        environment: { ...state.environment, [action.field]: action.value },
      };

    case "LOAD_PRESET": {
      const p = action.preset;
      const presetScale = p.scale || state.scale;
      const defaultEch = getDefaultEchelon(presetScale);
      // Normalize units: ensure echelon and posture exist (backward compat with old saves)
      const normalizedUnits = (p.units || []).map(u => ({
        ...u,
        echelon: u.echelon || defaultEch,
        posture: u.posture || "ready",
      }));
      return {
        ...state,
        scale: presetScale,
        title: p.title,
        description: p.description,
        initialConditions: p.initialConditions,
        specialRules: p.specialRules,
        turnDuration: p.turnDuration,
        startDate: p.startDate,
        actors: p.actors,
        units: normalizedUnits,
        environment: p.environment || { ...DEFAULT_ENVIRONMENT },
        selectedUnitId: null,
        interactionMode: "navigate",
        placementPayload: null,
      };
    }

    case "ENTER_EDIT_TERRAIN_MODE":
      return {
        ...state,
        interactionMode: "edit_terrain",
        selectedUnitId: null,
        placementPayload: null,
        selectedCell: null,
      };

    case "EXIT_EDIT_TERRAIN_MODE":
      return {
        ...state,
        interactionMode: "navigate",
        selectedCell: null,
      };

    case "SELECT_CELL_FOR_EDIT":
      return {
        ...state,
        selectedCell: action.cell, // { c, r }
      };

    default:
      return state;
  }
}

// ── Component ────────────────────────────────────────────────

export default function SimSetupConfigure({ terrainData, selectedMap, onBack, onStart, initialPresetId }) {
  const [state, dispatch] = useReducer(setupReducer, createInitialState(terrainData, selectedMap));
  const [providers, setProviders] = useState([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [gameName, setGameName] = useState("");
  const [creating, setCreating] = useState(false);

  // Auto-apply preset if launched from quick-start
  const presetApplied = useRef(false);
  useEffect(() => {
    if (initialPresetId && !presetApplied.current) {
      const preset = getPresetById(initialPresetId);
      if (preset) {
        dispatch({ type: "LOAD_PRESET", preset });
        presetApplied.current = true;
      }
    }
  }, [initialPresetId]);

  // Deep-clone terrain so edits don't mutate the parent's object
  const [editableTerrainData, setEditableTerrainData] = useState(() => ({
    ...terrainData,
    cells: Object.fromEntries(
      Object.entries(terrainData.cells).map(([k, v]) => [k, { ...v, features: [...(v.features || [])], attributes: [...(v.attributes || [])] }])
    ),
    linearPaths: terrainData.linearPaths ? [...terrainData.linearPaths] : [],
  }));

  // Update a single cell field immutably
  const updateCell = useCallback((c, r, field, value) => {
    setEditableTerrainData(prev => {
      const key = `${c},${r}`;
      const oldCell = prev.cells[key];
      if (!oldCell) return prev;
      const newCell = { ...oldCell };
      if (field === "features" || field === "attributes") {
        newCell[field] = [...value];
      } else {
        newCell[field] = value;
      }
      return {
        ...prev,
        cells: { ...prev.cells, [key]: newCell },
        linearPaths: [], // force BFS rebuild for road/rail networks
      };
    });
  }, []);

  // Load LLM providers
  useEffect(() => {
    getProviders().then(data => {
      const provs = data.providers || [];
      setProviders(provs);
      if (provs.length > 0) {
        dispatch({ type: "SET_FIELD", field: "provider", value: provs[0].id });
        const firstModel = provs[0].models?.[0];
        dispatch({ type: "SET_FIELD", field: "model", value: firstModel?.id || "" });
        dispatch({ type: "SET_FIELD", field: "temperature", value: firstModel?.temperature ?? 0.4 });
      }
    }).catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (state.interactionMode === "edit_terrain") {
          if (state.selectedCell) {
            dispatch({ type: "SELECT_CELL_FOR_EDIT", cell: null }); // deselect cell
          } else {
            dispatch({ type: "EXIT_EDIT_TERRAIN_MODE" });
          }
        } else if (state.interactionMode === "place_unit") {
          dispatch({ type: "EXIT_PLACEMENT_MODE" });
        } else if (state.selectedUnitId) {
          dispatch({ type: "SELECT_UNIT", unitId: state.selectedUnitId }); // deselect
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.interactionMode, state.selectedUnitId, state.selectedCell]);

  // Handle cell click from map
  const handleCellClick = useCallback((cell) => {
    if (state.interactionMode === "edit_terrain") {
      // Edit mode: select this cell for editing
      dispatch({ type: "SELECT_CELL_FOR_EDIT", cell: { c: cell.c, r: cell.r } });
    } else if (state.interactionMode === "place_unit" && state.placementPayload) {
      // Place a new unit at this cell
      const pos = cellToPositionString(cell.c, cell.r);
      dispatch({
        type: "ADD_UNIT",
        actorId: state.placementPayload.actorId,
        unitType: state.placementPayload.unitType,
        template: state.placementPayload.template,
        position: pos,
      });
    } else {
      // Navigate mode: check if there's a unit at this cell, select it
      const unitAtCell = findUnitAtCell(cell, state.units);
      if (unitAtCell) {
        dispatch({ type: "SELECT_UNIT", unitId: unitAtCell.id });
      } else {
        // Deselect
        if (state.selectedUnitId) {
          dispatch({ type: "SELECT_UNIT", unitId: state.selectedUnitId });
        }
      }
    }
  }, [state.interactionMode, state.placementPayload, state.units, state.selectedUnitId]);

  // Build ghost unit data for the map
  const ghostUnit = state.interactionMode === "place_unit" && state.placementPayload
    ? { type: state.placementPayload.unitType, actorId: state.placementPayload.actorId }
    : null;

  // Compute strategic grid when enabled (memoized — only recomputes when inputs change)
  const strategicGrid = useMemo(() => {
    if (!state.strategicEnabled || !editableTerrainData?.cellSizeKm) return null;
    try {
      return buildStrategicGrid(editableTerrainData, state.strategicHexSizeKm);
    } catch (e) {
      console.warn("Strategic grid error:", e.message);
      return null;
    }
  }, [state.strategicEnabled, state.strategicHexSizeKm, editableTerrainData]);

  // Validate before showing naming modal
  const handleStartClick = () => {
    if (!state.title.trim()) { alert("Please enter a scenario title."); return; }
    if (!state.provider || !state.model) { alert("No LLM provider configured. Check your .env file."); return; }

    // M12: Warn about unnamed units that will be excluded
    const unnamedCount = state.units.filter(u => !u.name.trim()).length;
    if (unnamedCount > 0) {
      if (!confirm(`${unnamedCount} unit(s) have no name and will be excluded. Continue?`)) return;
    }

    // M15: Warn if no units or no objectives
    const namedUnits = state.units.filter(u => u.name.trim());
    if (namedUnits.length === 0) {
      if (!confirm("No units have been placed. Start anyway?")) return;
    }
    const noObjectives = state.actors.every(a => a.objectives.filter(o => o.trim()).length === 0);
    if (noObjectives) {
      if (!confirm("No actor has objectives set. Start anyway?")) return;
    }

    // Show naming modal with scenario title as default
    setGameName(state.title.trim());
    setShowNameModal(true);
  };

  // Actually create the game folder and start simulation
  const handleConfirmStart = async () => {
    if (!gameName.trim()) return;
    setCreating(true);
    try {
      // Create game folder and copy terrain into it
      const folder = await createGameFolder(gameName.trim(), editableTerrainData);

      const namedUnits = state.units.filter(u => u.name.trim());
      const scenario = {
        scale: state.scale,
        title: state.title.trim(),
        description: state.description.trim(),
        turnDuration: state.turnDuration,
        startDate: state.startDate,
        actors: state.actors.map(a => ({
          ...a,
          id: a.id || a.name.toLowerCase().replace(/\s+/g, "_"),
          objectives: a.objectives.filter(o => o.trim()),
          constraints: a.constraints.filter(c => c.trim()),
        })),
        initialConditions: state.initialConditions,
        specialRules: state.specialRules,
        units: namedUnits,
        environment: state.environment,
        eraSelections: state.eraSelections,
      };

      const gameState = createGame({
        scenario,
        terrainRef: selectedMap,
        terrainData: editableTerrainData,
        llmConfig: { provider: state.provider, model: state.model, temperature: state.temperature },
        folder,
      });

      setShowNameModal(false);
      onStart(gameState, editableTerrainData);
    } catch (e) {
      alert("Failed to create game: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{
      background: colors.bg.base, height: "100%", color: colors.text.primary,
      fontFamily: typography.fontFamily, display: "flex", flexDirection: "column",
      animation: "fadeIn 0.2s ease-out",
    }}>
      {/* Toolbar */}
      <div style={{
        padding: `${space[2]}px ${space[4]}px`, borderBottom: `1px solid ${colors.border.subtle}`,
        display: "flex", alignItems: "center", gap: space[3], flexShrink: 0,
      }}>
        <Button variant="ghost" onClick={onBack} size="sm">
          <span style={{ marginRight: 4 }}>&larr;</span> Map Select
        </Button>
        <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>
          Setup: {selectedMap}
        </div>
        {editableTerrainData && (
          <Badge color={colors.accent.green}>
            {editableTerrainData.cols}&times;{editableTerrainData.rows}
          </Badge>
        )}
        <Badge color={colors.accent.cyan}>
          {SCALE_TIERS[state.scale]?.label || "Grand Tactical"}
        </Badge>
        <div style={{ flex: 1 }} />
        <select
          value=""
          onChange={e => {
            const preset = getPresetById(e.target.value);
            if (preset) dispatch({ type: "LOAD_PRESET", preset });
          }}
          style={{
            background: colors.bg.surface,
            color: colors.text.primary,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: radius.sm,
            padding: `${space[1]}px ${space[2]}px`,
            fontSize: typography.body.sm,
            fontFamily: typography.monoFamily,
            cursor: "pointer",
          }}
        >
          <option value="" disabled>Load Preset…</option>
          {getPresetsForMap(selectedMap).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={() => dispatch({
            type: state.interactionMode === "edit_terrain" ? "EXIT_EDIT_TERRAIN_MODE" : "ENTER_EDIT_TERRAIN_MODE"
          })}
          size="sm"
          style={state.interactionMode === "edit_terrain" ? {
            borderColor: colors.accent.green, color: colors.accent.green,
            background: `${colors.accent.green}15`,
          } : undefined}
        >
          {state.interactionMode === "edit_terrain" ? "Exit Edit Mode" : "Edit Terrain"}
        </Button>
        {state.units.length > 0 && (
          <Badge color={colors.accent.blue}>{state.units.length} units</Badge>
        )}
        <Button
          onClick={handleStartClick}
          disabled={!state.title.trim() || !state.provider}
          size="sm"
        >
          Start Simulation &rarr;
        </Button>
      </div>

      {/* Three-panel layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Sidebar */}
        <SetupLeftSidebar
          state={state}
          dispatch={dispatch}
          providers={providers}
          open={state.leftSidebarOpen}
          onToggle={() => dispatch({ type: "TOGGLE_LEFT_SIDEBAR" })}
          cellSizeKm={editableTerrainData?.cellSizeKm || null}
        />

        {/* Map (center) */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <SimMap
            terrainData={editableTerrainData}
            units={state.units}
            actors={state.actors}
            interactionMode={state.interactionMode}
            selectedUnitId={state.selectedUnitId}
            ghostUnit={ghostUnit}
            onCellClick={handleCellClick}
            isSetupMode={true}
            strategicGrid={strategicGrid}
            strategicMode={state.strategicEnabled && !!strategicGrid}
          />
        </div>

        {/* Right Sidebar */}
        <SetupRightSidebar
          state={state}
          dispatch={dispatch}
          terrainData={editableTerrainData}
          onUpdateCell={updateCell}
          open={state.rightSidebarOpen}
          onToggle={() => dispatch({ type: "TOGGLE_RIGHT_SIDEBAR" })}
        />
      </div>

      {/* Game Naming Modal */}
      {showNameModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: colors.bg.raised, borderRadius: radius.lg,
            padding: space[6], width: 420, maxWidth: "90%",
            border: `1px solid ${colors.border.subtle}`,
            boxShadow: shadows?.lg || "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            <div style={{
              fontSize: typography.heading.md, fontWeight: typography.weight.bold,
              marginBottom: space[4], color: colors.text.primary,
            }}>
              Name Your Game
            </div>
            <p style={{
              fontSize: typography.body.sm, color: colors.text.secondary,
              marginBottom: space[3], lineHeight: 1.5,
            }}>
              This creates a dedicated folder for your game with its own copy of the terrain map.
              Clearing your saved maps won't affect this game.
            </p>
            <input
              type="text"
              value={gameName}
              onChange={e => setGameName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && gameName.trim()) handleConfirmStart(); }}
              placeholder="e.g. Bastogne Campaign"
              autoFocus
              style={{
                width: "100%", padding: `${space[2]}px ${space[3]}px`,
                background: colors.bg.surface, color: colors.text.primary,
                border: `1px solid ${colors.border.subtle}`, borderRadius: radius.md,
                fontSize: typography.body.md, fontFamily: typography.fontFamily,
                outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{
              display: "flex", gap: space[2], justifyContent: "flex-end",
              marginTop: space[4],
            }}>
              <Button variant="ghost" size="sm" onClick={() => setShowNameModal(false)} disabled={creating}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirmStart} disabled={!gameName.trim() || creating}>
                {creating ? "Creating..." : "Create & Start"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function findUnitAtCell(cell, units) {
  if (!cell || !units) return null;
  for (const unit of units) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (pos && pos.c === cell.c && pos.r === cell.r) return unit;
  }
  return null;
}
