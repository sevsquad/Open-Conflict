import { useState, useEffect, useCallback } from "react";
import { loadGameState } from "./orchestrator.js";
import SimSetupMapSelect from "./SimSetupMapSelect.jsx";
import SimSetupConfigure from "./SimSetupConfigure.jsx";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Two-phase setup router
// Phase 1: Select map → Phase 2: Map-centric configuration
// ═══════════════════════════════════════════════════════════════

export default function SimSetup({ onBack, onStart }) {
  const [setupPhase, setSetupPhase] = useState("select-map"); // "select-map" | "configure"
  const [maps, setMaps] = useState([]);
  const [selectedMap, setSelectedMap] = useState(null);
  const [terrainData, setTerrainData] = useState(null);
  const [loadingMap, setLoadingMap] = useState(false);

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
