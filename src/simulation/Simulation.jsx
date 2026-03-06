import { useState, useCallback } from "react";
import SimSetup from "./SimSetup.jsx";
import SimGame from "./SimGame.jsx";
import { getTestFixture } from "../testFixture.js";
import { colors, typography, space } from "../theme.js";
import { Button } from "../components/ui.jsx";

// ═══════════════════════════════════════════════════════════════
// SIMULATION — Mode router between setup and active game
// ═══════════════════════════════════════════════════════════════

export default function Simulation({ onBack, initialData, preset }) {
  const [phase, setPhase] = useState("setup"); // "setup" | "game"
  const [gameState, setGameState] = useState(null);
  const [terrainData, setTerrainData] = useState(null);
  const [terrainError, setTerrainError] = useState(null);

  const handleStart = useCallback((gs, terrain) => {
    setGameState(gs);
    setTerrainError(null);
    if (terrain) {
      setTerrainData(terrain);
      setPhase("game");
    } else if (gs.terrain?._ref === "test-fixture") {
      setTerrainData(getTestFixture());
      setPhase("game");
    } else if (gs.terrain?._ref) {
      // Load terrain from saved reference
      fetch(`/api/load?file=${encodeURIComponent(gs.terrain._ref)}`)
        .then(r => {
          if (!r.ok) throw new Error(`Terrain file not found: ${gs.terrain._ref}`);
          return r.json();
        })
        .then(data => {
          setTerrainData(data.map || data);
          setPhase("game");
        })
        .catch(err => {
          setTerrainError(err.message);
          setPhase("game"); // still enter game — terrain summary available for LLM
        });
    } else {
      setPhase("game");
    }
  }, []);

  const handleBackToSetup = useCallback(() => {
    setPhase("setup");
    setTerrainError(null);
  }, []);

  if (phase === "game" && gameState) {
    // Show terrain error banner but still allow play (LLM has terrain summary)
    return (
      <>
        {terrainError && (
          <div style={{
            padding: `${space[2]}px ${space[4]}px`, background: colors.accent.amber + "22",
            borderBottom: `1px solid ${colors.accent.amber}`, display: "flex", alignItems: "center", gap: space[3],
            fontFamily: typography.fontFamily, fontSize: typography.body.sm, color: colors.accent.amber,
          }}>
            <span>Terrain map not found ({terrainError}). Map rendering disabled — simulation can still run using terrain summary.</span>
            <Button variant="ghost" size="sm" onClick={handleBackToSetup}>Back to Setup</Button>
          </div>
        )}
        <SimGame
          onBack={handleBackToSetup}
          gameState={gameState}
          terrainData={terrainData}
          onUpdateGameState={setGameState}
        />
      </>
    );
  }

  return <SimSetup onBack={onBack} onStart={handleStart} initialTerrainData={initialData} preset={preset} />;
}
