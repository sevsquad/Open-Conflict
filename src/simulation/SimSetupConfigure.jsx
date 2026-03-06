import { useReducer, useEffect, useCallback, useState, useRef, useMemo } from "react";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { createGame, getProviders } from "./orchestrator.js";
import { cellToPositionString, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { getPresetsForMap, getPresetById } from "./presets.js";
import { SCALE_TIERS, getDefaultEchelon, DEFAULT_ENVIRONMENT, getUnitFieldsForScale } from "./schemas.js";
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
      return {
        ...state,
        actors: [...state.actors, {
          id: `actor_${num}`,
          name: `Side ${String.fromCharCode(64 + num)}`,
          controller: "player",
          objectives: [""],
          constraints: [""],
        }],
      };
    }

    case "REMOVE_ACTOR":
      if (state.actors.length <= 2) return state;
      return { ...state, actors: state.actors.filter((_, i) => i !== action.idx) };

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
      return {
        ...state,
        units: state.units.map((u, i) => i === action.idx ? { ...u, [action.field]: action.value } : u),
      };

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

  // Start simulation
  const handleStart = () => {
    if (!state.title.trim()) { alert("Please enter a scenario title."); return; }
    if (!state.provider || !state.model) { alert("No LLM provider configured. Check your .env file."); return; }

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
      units: state.units.filter(u => u.name.trim()),
      environment: state.environment,
      eraSelections: state.eraSelections,
    };

    const gameState = createGame({
      scenario,
      terrainRef: selectedMap,
      terrainData: editableTerrainData,
      llmConfig: { provider: state.provider, model: state.model, temperature: state.temperature },
    });

    onStart(gameState, editableTerrainData);
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
            background: colors.bg.secondary,
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
          onClick={handleStart}
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
