import { useState, useEffect, useCallback, useRef } from "react";
import { loadGameState, createGame, getProviders } from "./orchestrator.js";
import { getQuickstartPreset } from "./presets.js";
import SimSetupMapSelect from "./SimSetupMapSelect.jsx";
import SimSetupConfigure from "./SimSetupConfigure.jsx";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Two-phase setup router
// Phase 1: Select map → Phase 2: Map-centric configuration
// ═══════════════════════════════════════════════════════════════

export default function SimSetup({ onBack, onStart, initialTerrainData, preset }) {
  const [setupPhase, setSetupPhase] = useState(initialTerrainData ? "configure" : "select-map"); // "select-map" | "configure"
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(initialTerrainData ? "test-fixture" : null);
  const [terrainData, setTerrainData] = useState(initialTerrainData || null);
  const [loadingMap, setLoadingMap] = useState(false);

  // Auto-start with preset if requested (?preset=quickstart)
  const presetFired = useRef(false);
  useEffect(() => {
    if (preset !== "quickstart" || !initialTerrainData || presetFired.current) return;
    presetFired.current = true;

    // Fetch the first available LLM provider, then create the game immediately
    getProviders().then(data => {
      const provs = data.providers || [];
      if (provs.length === 0) {
        console.error("[preset] No LLM providers configured. Add an API key to .env");
        return;
      }
      const presetData = getQuickstartPreset();
      const scenario = {
        title: presetData.title,
        description: presetData.description,
        turnDuration: presetData.turnDuration,
        startDate: presetData.startDate,
        actors: presetData.actors,
        initialConditions: presetData.initialConditions,
        specialRules: presetData.specialRules,
        units: presetData.units,
      };
      const gs = createGame({
        scenario,
        terrainRef: "test-fixture",
        terrainData: initialTerrainData,
        llmConfig: { provider: provs[0].id, model: provs[0].models?.[0] || "", temperature: 0.4 },
      });
      onStart(gs, initialTerrainData);
    }).catch(err => console.error("[preset] Failed to load providers:", err));
  }, [preset, initialTerrainData, onStart]);

  // Load available maps on mount
  useEffect(() => {
    fetch("/api/saves").then(r => r.json()).then(setMaps).catch(() => {});
  }, []);

  // Load terrain data when a map is selected
  const handleSelectMap = useCallback(async (mapName) => {
    setSelectedMap(mapName);
    setLoadingMap(true);
    try {
      const resp = await fetch(`/api/load?file=${encodeURIComponent(mapName)}`);
      const data = await resp.json();
      setTerrainData(data.map || data);
    } catch (e) {
      console.error("Failed to load terrain:", e);
    }
    setLoadingMap(false);
  }, []);

  // Load a saved game directly
  const handleLoadGame = useCallback(async (file) => {
    try {
      const gs = await loadGameState(file);
      onStart(gs, null);
    } catch (e) {
      alert("Failed to load game: " + e.message);
    }
  }, [onStart]);

  // Transition to configure phase
  const handleContinue = () => {
    if (selectedMap && terrainData) {
      setSetupPhase("configure");
    }
  };

  // Go back from configure to map select
  const handleBackToSelect = () => {
    setSetupPhase("select-map");
  };

  if (setupPhase === "configure" && terrainData) {
    return (
      <SimSetupConfigure
        terrainData={terrainData}
        selectedMap={selectedMap}
        onBack={handleBackToSelect}
        onStart={onStart}
      />
    );
  }

  return (
    <SimSetupMapSelect
      maps={maps}
      loadingMap={loadingMap}
      selectedMap={selectedMap}
      terrainData={terrainData}
      onSelectMap={handleSelectMap}
      onContinue={handleContinue}
      onBack={onBack}
      onLoadGame={handleLoadGame}
    />
  );
}
