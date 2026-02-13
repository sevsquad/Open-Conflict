import { useReducer, useEffect, useCallback, useState } from "react";
import { colors, typography, radius, animation, space } from "../theme.js";
import { Button, Badge } from "../components/ui.jsx";
import { ACTOR_COLORS } from "../terrainColors.js";
import { createGame, getProviders } from "./orchestrator.js";
import { cellToPositionString, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import SimMap from "./SimMap.jsx";
import SetupLeftSidebar from "./SetupLeftSidebar.jsx";
import SetupRightSidebar from "./SetupRightSidebar.jsx";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP CONFIGURE — Step 2: Map-centric sandbox setup
// Three-panel layout: left sidebar + map + right sidebar
// ═══════════════════════════════════════════════════════════════

// ── Reducer ──────────────────────────────────────────────────

function createInitialState(terrainData, selectedMap) {
  return {
    // Scenario
    title: "",
    description: "",
    initialConditions: "",
    specialRules: "",
    turnDuration: "1 day",
    startDate: "",

    // Actors
    actors: [
      { id: "actor_1", name: "Side A", controller: "player", objectives: [""], constraints: [""] },
      { id: "actor_2", name: "Side B", controller: "player", objectives: [""], constraints: [""] },
    ],

    // Units
    units: [],

    // LLM
    provider: "",
    model: "",
    temperature: 0.4,

    // Interaction
    interactionMode: "navigate",
    placementPayload: null, // { actorId, unitType }
    selectedUnitId: null,
    ghostCell: null,

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

    case "ADD_UNIT": {
      const newUnit = {
        id: `unit_${Date.now()}_${++unitCounter}`,
        actor: action.actorId,
        name: "",
        type: action.unitType || "infantry",
        position: action.position || "",
        strength: 100,
        supply: 100,
        status: "ready",
        notes: "",
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
        placementPayload: { actorId: action.actorId, unitType: action.unitType },
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

    default:
      return state;
  }
}

// ── Component ────────────────────────────────────────────────

export default function SimSetupConfigure({ terrainData, selectedMap, onBack, onStart }) {
  const [state, dispatch] = useReducer(setupReducer, createInitialState(terrainData, selectedMap));
  const [providers, setProviders] = useState([]);

  // Load LLM providers
  useEffect(() => {
    getProviders().then(data => {
      const provs = data.providers || [];
      setProviders(provs);
      if (provs.length > 0) {
        dispatch({ type: "SET_FIELD", field: "provider", value: provs[0].id });
        dispatch({ type: "SET_FIELD", field: "model", value: provs[0].models?.[0] || "" });
      }
    }).catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (state.interactionMode === "place_unit") {
          dispatch({ type: "EXIT_PLACEMENT_MODE" });
        } else if (state.selectedUnitId) {
          dispatch({ type: "SELECT_UNIT", unitId: state.selectedUnitId }); // deselect
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.interactionMode, state.selectedUnitId]);

  // Handle cell click from map
  const handleCellClick = useCallback((cell) => {
    if (state.interactionMode === "place_unit" && state.placementPayload) {
      // Place a new unit at this cell
      const pos = cellToPositionString(cell.c, cell.r);
      dispatch({
        type: "ADD_UNIT",
        actorId: state.placementPayload.actorId,
        unitType: state.placementPayload.unitType,
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

  // Start simulation
  const handleStart = () => {
    if (!state.title.trim()) { alert("Please enter a scenario title."); return; }
    if (!state.provider || !state.model) { alert("No LLM provider configured. Check your .env file."); return; }

    const scenario = {
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
    };

    const gameState = createGame({
      scenario,
      terrainRef: selectedMap,
      terrainData,
      llmConfig: { provider: state.provider, model: state.model, temperature: state.temperature },
    });

    onStart(gameState, terrainData);
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
        {terrainData && (
          <Badge color={colors.accent.green}>
            {terrainData.cols}&times;{terrainData.rows}
          </Badge>
        )}
        <div style={{ flex: 1 }} />
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
        />

        {/* Map (center) */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <SimMap
            terrainData={terrainData}
            units={state.units}
            actors={state.actors}
            interactionMode={state.interactionMode}
            selectedUnitId={state.selectedUnitId}
            ghostUnit={ghostUnit}
            onCellClick={handleCellClick}
            isSetupMode={true}
          />
        </div>

        {/* Right Sidebar */}
        <SetupRightSidebar
          state={state}
          dispatch={dispatch}
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
