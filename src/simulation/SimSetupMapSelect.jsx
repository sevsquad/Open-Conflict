import { useState, useEffect, useCallback } from "react";
import { colors, typography, radius, animation, space, shadows } from "../theme.js";
import { Button, Select, Card, Badge, SectionHeader } from "../components/ui.jsx";
import { listSavedGames, loadGameState } from "./orchestrator.js";
import { getAllPresets } from "./presets.js";

// ═══════════════════════════════════════════════════════════════
// SIM SETUP — Step 1: Map Selection
// Focused screen to pick a terrain map before entering the sandbox
// ═══════════════════════════════════════════════════════════════

export default function SimSetupMapSelect({ maps, loadingMap, selectedMap, terrainData, onSelectMap, onContinue, onBack, onLoadGame, onLoadTestFixture, onLoadPreset }) {
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
              <Button key={g.file} variant="secondary" onClick={() => onLoadGame(g.file, g.folder)} size="sm"
                style={{ display: "flex", alignItems: "center", gap: space[1] }}
              >
                {g.isAutosave && (
                  <Badge color={colors.accent.cyan} style={{ fontSize: 9, padding: "1px 4px" }}>AUTO</Badge>
                )}
                <span>{g.name}</span>
                {g.turn != null && (
                  <Badge color={colors.accent.amber} style={{ fontSize: 9, padding: "1px 4px" }}>T{g.turn}</Badge>
                )}
                {g.actorCount > 0 && (
                  <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
                    {g.actorCount} sides, {g.unitCount} units
                  </span>
                )}
                <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>
                  {new Date(g.modified).toLocaleDateString()}
                </span>
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

          {/* Quick-start scenarios — scrollable list with descriptions */}
          <div style={{ marginTop: space[3], borderTop: `1px solid ${colors.border.subtle}`, paddingTop: space[3] }}>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2], textTransform: "uppercase", letterSpacing: 1 }}>
              Quick Start Scenarios
            </div>
            <div style={{
              maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: space[1],
              paddingRight: space[1],
            }}>
              {getAllPresets().map(p => (
                <button
                  key={p.id}
                  onClick={() => onLoadPreset(p.id, p.requiredMap, p.mapType)}
                  style={{
                    background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
                    borderRadius: radius.md, padding: `${space[2]}px ${space[3]}px`,
                    cursor: "pointer", textAlign: "left", color: colors.text.primary,
                    fontFamily: typography.fontFamily, transition: "border-color 0.15s",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = colors.accent.amber}
                  onMouseLeave={e => e.currentTarget.style.borderColor = colors.border.subtle}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                    <span style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold }}>{p.name}</span>
                    {p.era && (
                      <Badge color={
                        p.era === "ww2" ? colors.accent.amber :
                        p.era === "cold_war" ? colors.accent.cyan :
                        p.era === "modern" ? colors.accent.green :
                        colors.accent.blue
                      } style={{ fontSize: 9, padding: "1px 5px" }}>
                        {p.era.toUpperCase().replace("_", " ")}
                      </Badge>
                    )}
                    {p.scale && (
                      <Badge color={colors.accent.blue} style={{ fontSize: 9, padding: "1px 5px" }}>
                        {p.scale.replace("_", " ").toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted, lineHeight: 1.4 }}>
                      {p.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

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
