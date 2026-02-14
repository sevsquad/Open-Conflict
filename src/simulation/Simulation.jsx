import { useState, useCallback } from "react";
import SimSetup from "./SimSetup.jsx";
import SimGame from "./SimGame.jsx";

// ═══════════════════════════════════════════════════════════════
// SIMULATION — Mode router between setup and active game
// ═══════════════════════════════════════════════════════════════

export default function Simulation({ onBack }) {
  const [phase, setPhase] = useState("setup"); // "setup" | "game"
  const [gameState, setGameState] = useState(null);
  const [terrainData, setTerrainData] = useState(null);

  const handleStart = useCallback((gs, terrain) => {
    setGameState(gs);
    // If terrain wasn't passed (e.g., loading a saved game), try to load it
    if (terrain) {
      setTerrainData(terrain);
    } else if (gs.terrain?._ref) {
      // Load terrain from saved reference
      fetch(`/api/load?file=${encodeURIComponent(gs.terrain._ref)}`)
        .then(r => r.json())
        .then(data => setTerrainData(data.map || data))
        .catch(() => {});
    }
    setPhase("game");
  }, []);

  const handleBackToSetup = useCallback(() => {
    setPhase("setup");
  }, []);

  if (phase === "game" && gameState) {
    return (
      <SimGame
        onBack={handleBackToSetup}
        gameState={gameState}
        terrainData={terrainData}
        onUpdateGameState={setGameState}
      />
    );
  }

  return <SimSetup onBack={onBack} onStart={handleStart} />;
}
