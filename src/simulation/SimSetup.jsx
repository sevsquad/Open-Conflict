import { useState, useEffect, useCallback, useRef } from "react";
import { loadGameState, createGame, getProviders } from "./orchestrator.js";
import { getQuickstartPreset } from "./presets.js";
import { getTestFixture } from "../testFixture.js";
import SimSetupMapSelect from "./SimSetupMapSelect.jsx";
import SimSetupConfigure from "./SimSetupConfigure.jsx";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Two-phase setup router
// Phase 1: Select map → Phase 2: Map-centric configuration
// ═══════════════════════════════════════════════════════════════

export default function SimSetup({ onBack, onStart, initialTerrainData, preset }) {
  const [setupPhase, setSetupPhase] = useState(initialTerrainData ? "configure" : "select-map"); // "select-map" | "configure"
  const [maps, setMaps] = useState([]);
  // Use _sourceName if available (e.g. from ?test=wales), otherwise default to "test-fixture"
  const [selectedMap, setSelectedMap] = useState(
    initialTerrainData ? (initialTerrainData._sourceName || "test-fixture") : null
  );
  const [terrainData, setTerrainData] = useState(initialTerrainData || null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState(null);

  // Auto-start with preset if requested (?preset=quickstart)
  const presetFired = useRef(false);
  useEffect(() => {
    if (preset !== "quickstart" || !initialTerrainData || presetFired.current) return;
    presetFired.current = true;

    // Fetch available LLM providers, then create the game immediately.
    // If no provider configured, use a placeholder — adjudication will
    // fail with a clear error, but the game UI still loads for inspection.
    getProviders().then(data => {
      const provs = data.providers || [];
      const provider = provs[0]?.id || "none";
      const model = provs[0]?.models?.[0] || "none";
      if (provs.length === 0) {
        console.warn("[preset] No LLM providers configured. Game will load but adjudication requires an API key in .env");
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
        llmConfig: { provider, model, temperature: 0.4 },
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
      setTerrainData(null); // Clear stale data on load failure
    }
    setLoadingMap(false);
  }, []);

  // Load the built-in test fixture directly (no API call)
  const handleLoadTestFixture = useCallback(() => {
    const fixture = getTestFixture();
    setTerrainData(fixture);
    setSelectedMap("test-fixture");
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

  // Quick-start: load a map by preset requirement, then auto-apply the preset in configure
  const handleLoadPreset = useCallback(async (presetId, requiredMap) => {
    setPendingPresetId(presetId);
    if (requiredMap === "test-fixture") {
      const fixture = getTestFixture();
      setTerrainData(fixture);
      setSelectedMap("test-fixture");
      setSetupPhase("configure");
    } else {
      // Find the matching saved map file
      const match = maps.find(m => m.name.includes(requiredMap));
      if (!match) {
        alert(`Preset requires map "${requiredMap}" which is not available. Save the map first.`);
        return;
      }
      setLoadingMap(true);
      try {
        const resp = await fetch(`/api/load?file=${encodeURIComponent(match.name)}`);
        const data = await resp.json();
        setTerrainData(data.map || data);
        setSelectedMap(match.name);
        setSetupPhase("configure");
      } catch (e) {
        console.error("Failed to load terrain for preset:", e);
      }
      setLoadingMap(false);
    }
  }, [maps]);

  // Transition to configure phase
  const handleContinue = () => {
    if (selectedMap && terrainData) {
      setPendingPresetId(null); // manual flow, no auto-preset
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
        initialPresetId={pendingPresetId}
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
      onLoadTestFixture={handleLoadTestFixture}
      onLoadPreset={handleLoadPreset}
    />
  );
}
