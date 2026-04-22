import { useState, useCallback, useEffect, useRef } from "react";
import SimSetup from "./SimSetup.jsx";
import SimGame from "./SimGame.jsx";
import { getTestFixture } from "../testFixture.js";
import { colors, typography, space } from "../theme.js";
import { Button } from "../components/ui.jsx";

// ═══════════════════════════════════════════════════════════════
// SIMULATION — Mode router between setup and active game
// ═══════════════════════════════════════════════════════════════

export default function Simulation({ onBack, initialData, preset }) {
  const [phase, setPhase] = useState("setup"); // "setup" | "game" | "airtest"
  const [gameState, setGameState] = useState(null);
  const [terrainData, setTerrainData] = useState(null);
  const [terrainError, setTerrainError] = useState(null);
  const [airTestLog, setAirTestLog] = useState([]);
  const [airTestRunning, setAirTestRunning] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Auto-detect ?airtest=true URL parameter and run the test suite
  // Module-level guard prevents React strict mode double-fire
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const airtestParam = params.get("airtest");
    if (!airtestParam || window.__airTestFired) return;
    window.__airTestFired = true;
    setPhase("airtest");

    (async () => {
      setAirTestRunning(true);
      const td = getTestFixture();
      try {
        const { runAirTests, AIR_TEST_SCENARIOS } = await import("./airTestRunner.js");
        // Support ?airtest=true (all), ?airtest=last (last only), ?airtest=<number> (specific index)
        let only;
        if (airtestParam === "last") {
          only = [AIR_TEST_SCENARIOS.length - 1];
        } else if (airtestParam !== "true" && !isNaN(Number(airtestParam))) {
          only = [Number(airtestParam)];
        }
        const results = await runAirTests(td, {
          only,
          onProgress: (idx, total, meta) => {
            setAirTestLog(prev => [...prev, `Running ${idx + 1}/${total}: ${meta.name}...`]);
          },
        });

        // Build final log entries
        const finalLog = [];
        for (const r of results) {
          finalLog.push(`═══ ${r.meta.name} ═══`);
          finalLog.push(`Testing: ${r.meta.testing}`);
          if (r.status === "error") {
            finalLog.push(`ADJUDICATION: ERROR — ${r.error}`);
            finalLog.push(`ASSESSMENT: Could not evaluate.`);
          } else {
            for (const o of (r.outcomes || [])) {
              const delta = o.delta != null ? ` (${o.delta >= 0 ? "+" : ""}${o.delta})` : "";
              const air = o.readiness != null ? ` R:${o.readiness}% M:${o.munitions}%` : "";
              finalLog.push(`  ${o.name}: ${o.strengthBefore}→${o.strengthAfter}${delta}${air} [${o.status}]`);
            }
          }
          finalLog.push("");
        }
        setAirTestLog(prev => [...prev, "─── COMPLETE ───", ...finalLog]);
      } catch (err) {
        setAirTestLog(prev => [...prev, `FATAL ERROR: ${err.message}`]);
        console.error(err);
      }
      setAirTestRunning(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback((gs, terrain) => {
    setGameState(gs);
    setTerrainError(null);
    if (terrain) {
      setTerrainData(terrain);
      setPhase("game");
    } else if (gs.terrain?._ref === "test-fixture") {
      setTerrainData(getTestFixture());
      setPhase("game");
    } else if (gs.game?.folder) {
      // Load terrain from game's own folder (new folder-based storage)
      fetch(`/api/game/load-terrain?folder=${encodeURIComponent(gs.game.folder)}`)
        .then(r => {
          if (!r.ok) throw new Error(`Terrain not found in game folder: ${gs.game.folder}`);
          return r.json();
        })
        .then(data => {
          if (!mountedRef.current) return;
          setTerrainData(data.map || data);
          setPhase("game");
        })
        .catch(err => {
          if (!mountedRef.current) return;
          // Fallback: try loading from saves/ (terrain._ref) for compatibility
          if (gs.terrain?._ref) {
            fetch(`/api/load?file=${encodeURIComponent(gs.terrain._ref)}`)
              .then(r => r.ok ? r.json() : Promise.reject(new Error("Not in saves either")))
              .then(data => { if (!mountedRef.current) return; setTerrainData(data.map || data); setPhase("game"); })
              .catch(err2 => { if (!mountedRef.current) return; setTerrainError(err2.message); setPhase("game"); });
          } else {
            setTerrainError(err.message);
            setPhase("game");
          }
        });
    } else if (gs.terrain?._ref) {
      // Legacy: load terrain from saves/ by filename reference
      fetch(`/api/load?file=${encodeURIComponent(gs.terrain._ref)}`)
        .then(r => {
          if (!r.ok) throw new Error(`Terrain file not found: ${gs.terrain._ref}`);
          return r.json();
        })
        .then(data => {
          if (!mountedRef.current) return;
          setTerrainData(data.map || data);
          setPhase("game");
        })
        .catch(err => {
          if (!mountedRef.current) return;
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

  // Air test runner UI
  if (phase === "airtest") {
    return (
      <div style={{
        padding: space[6], fontFamily: typography.fontFamily, color: colors.text.primary,
        background: colors.bg.primary, minHeight: "100vh", overflow: "auto",
      }}>
        <h2 style={{ fontSize: typography.heading.md, margin: `0 0 ${space[4]}px`, color: colors.accent.amber }}>
          Air System Test Suite
        </h2>
        {airTestRunning && (
          <div style={{ color: colors.accent.green, marginBottom: space[3], fontSize: typography.body.sm }}>
            Running... (check browser console for detailed output)
          </div>
        )}
        <pre style={{
          fontFamily: "monospace", fontSize: "12px", lineHeight: "1.5",
          background: colors.bg.secondary, padding: space[4], borderRadius: "8px",
          whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "80vh", overflow: "auto",
        }}>
          {airTestLog.length > 0 ? airTestLog.join("\n") : "Initializing..."}
        </pre>
        {!airTestRunning && airTestLog.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onBack} style={{ marginTop: space[3] }}>
            Back to Menu
          </Button>
        )}
      </div>
    );
  }

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
