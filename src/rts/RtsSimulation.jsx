import { useCallback, useEffect, useRef, useState } from "react";
import SimSetup from "../simulation/SimSetup.jsx";
import RtsGame from "./RtsGame.jsx";
import { getTestFixture } from "../testFixture.js";

export default function RtsSimulation({ onBack, initialData, preset }) {
  const [phase, setPhase] = useState("setup");
  const [gameState, setGameState] = useState(null);
  const [terrainData, setTerrainData] = useState(initialData || null);
  const [terrainError, setTerrainError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleStart = useCallback((gs, terrain) => {
    setGameState(gs);
    setTerrainError(null);
    if (terrain) {
      setTerrainData(terrain);
      setPhase("game");
      return;
    }
    if (gs.terrain?._ref === "test-fixture") {
      setTerrainData(getTestFixture());
      setPhase("game");
      return;
    }
    if (gs.game?.folder) {
      setTerrainData(null);
      fetch(`/api/game/load-terrain?folder=${encodeURIComponent(gs.game.folder)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Terrain not found in game folder: ${gs.game.folder}`);
          return r.json();
        })
        .then((data) => {
          if (!mountedRef.current) return;
          setTerrainData(data.map || data);
          setPhase("game");
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setTerrainData(null);
          setTerrainError(err.message);
          setPhase("game");
        });
      return;
    }
    setTerrainData(null);
    setTerrainError("This RTS save is missing terrain data.");
    setPhase("game");
  }, []);

  if (phase === "game" && gameState) {
    return (
      <RtsGame
        onBack={() => setPhase("setup")}
        gameState={gameState}
        terrainData={terrainData}
        terrainError={terrainError}
        onUpdateGameState={setGameState}
      />
    );
  }

  return (
    <SimSetup
      onBack={onBack}
      onStart={handleStart}
      initialTerrainData={initialData}
      preset={preset}
      modeVariant="rts"
    />
  );
}
