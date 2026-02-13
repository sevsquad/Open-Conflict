import { useState, useEffect, useCallback } from "react";
import { colors, typography, radius, animation, space, shadows } from "../theme.js";
import { Button, Select, Card, Badge, SectionHeader } from "../components/ui.jsx";
import { listSavedGames, loadGameState } from "./orchestrator.js";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Step 1: Map Selection
// Focused screen to pick a terrain map before entering the sandbox
// ═══════════════════════════════════════════════════════════════

export default function SimSetupMapSelect({ maps, loadingMap, selectedMap, terrainData, onSelectMap, onContinue, onBack, onLoadGame }) {
  const [savedGames, setSavedGames] = useState([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    listSavedGames().then(setSavedGames).catch(() => {});
  }, []);

  return (
    <div style={{
      background: colors.bg.base, height: "100%", color: colors.text.primary,
      fontFamily: typography.fontFamily, display: "flex", flexDirection: "column",
      animation: "fadeIn 0.3s ease-out",
    }}>
      {/* Toolbar */}
      <div style={{
        padding: `${space[3]}px ${space[6]}px`, borderBottom: `1px solid ${colors.border.subtle}`,
        display: "flex", alignItems: "center", gap: space[4],
      }}>
        <Button variant="ghost" onClick={onBack} size="sm">
          <span style={{ marginRight: 4 }}>&larr;</span> Back
        </Button>
        <div style={{ fontSize: typography.heading.md, fontWeight: typography.weight.bold }}>New Simulation</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: space[2] }}>
          {savedGames.length > 0 && (
            <Button variant="secondary" onClick={() => setShowSaved(!showSaved)} size="sm">Load Saved Game</Button>
          )}
        </div>
      </div>

      {/* Saved games dropdown */}
      {showSaved && savedGames.length > 0 && (
        <div style={{
          padding: `${space[3]}px ${space[6]}px`, background: colors.bg.raised,
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[2] }}>Saved Games:</div>
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            {savedGames.map(g => (
              <Button key={g.file} variant="secondary" onClick={() => onLoadGame(g.file)} size="sm">
                {g.name} ({new Date(g.modified).toLocaleDateString()})
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Centered content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: space[6] }}>
        <Card accent={colors.accent.amber} style={{ width: 480, maxWidth: "100%" }}>
          <SectionHeader accent={colors.accent.amber}>Select Terrain Map</SectionHeader>
          <p style={{ fontSize: typography.body.md, color: colors.text.secondary, marginBottom: space[4], lineHeight: 1.6 }}>
            Choose a terrain map to build your scenario on. You'll be able to place units and configure the simulation on the map.
          </p>

          <Select
            value={selectedMap || ""}
            onChange={v => onSelectMap(v)}
            options={maps.map(m => ({ value: m.name, label: `${m.name} (${(m.size / 1024).toFixed(0)}KB)` }))}
            placeholder="Select a terrain map..."
          />

          {loadingMap && (
            <div style={{
              fontSize: typography.body.sm, color: colors.text.muted, marginTop: space[2],
              animation: "pulse 1.5s infinite",
            }}>
              Loading terrain data...
            </div>
          )}

          {terrainData && !loadingMap && (
            <div style={{
              fontSize: typography.body.sm, color: colors.text.secondary, marginTop: space[2],
              lineHeight: 1.5, padding: space[2], background: colors.bg.surface, borderRadius: radius.md,
            }}>
              <Badge color={colors.accent.green} style={{ marginRight: space[1] }}>
                {terrainData.cols}&times;{terrainData.rows}
              </Badge>
              {terrainData.cellSizeKm}km/cell
              {terrainData.center && <> &middot; {terrainData.center.lat.toFixed(2)}, {terrainData.center.lng.toFixed(2)}</>}
              {terrainData.widthKm && <> &middot; {terrainData.widthKm}&times;{terrainData.heightKm}km</>}
            </div>
          )}

          <div style={{ marginTop: space[5], display: "flex", justifyContent: "flex-end" }}>
            <Button
              onClick={onContinue}
              disabled={!selectedMap || !terrainData || loadingMap}
              size="md"
            >
              Continue to Setup &rarr;
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
