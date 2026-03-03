import { useMemo } from "react";
import { colors, typography, radius, space } from "../theme.js";
import { CollapsibleSection } from "../components/ui.jsx";
import { TC, TL, FG, FL } from "../terrainColors.js";
import { cellToDisplayString } from "../mapRenderer/overlays/UnitOverlay.js";

// ═══════════════════════════════════════════════════════════════
// SETUP CELL EDITOR — Edit terrain, elevation, and features
// for a single hex cell in the simulation setup phase
// ═══════════════════════════════════════════════════════════════

// Group terrain types for the dropdown so 28 options aren't a flat list
const TERRAIN_GROUPS = {
  "Water": ["deep_water", "coastal_water", "lake", "river"],
  "Open": ["open_ground", "light_veg", "farmland", "wetland"],
  "Forest": ["forest", "dense_forest", "jungle", "jungle_hills", "jungle_mountains", "mangrove"],
  "Urban": ["light_urban", "dense_urban"],
  "Highland": ["highland", "forested_hills", "mountain_forest", "mountain", "peak"],
  "Cold": ["boreal", "boreal_hills", "boreal_mountains", "tundra", "ice"],
  "Arid": ["desert", "savanna", "savanna_hills"],
};

// Infrastructure options (road/rail types that can be the primary linear feature)
const INFRA_OPTIONS = [
  "", "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail",
];

const fieldLabel = { fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 };
const inputStyle = {
  width: "100%", padding: "6px 8px", background: colors.bg.input,
  border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm,
  color: colors.text.primary, fontSize: typography.body.sm,
  fontFamily: typography.fontFamily, outline: "none", boxSizing: "border-box",
};

export default function SetupCellEditor({ selectedCell, terrainData, onUpdateCell }) {
  const key = selectedCell ? `${selectedCell.c},${selectedCell.r}` : null;
  const cell = key ? terrainData.cells[key] : null;

  // Build sorted list of all terrain types for the dropdown
  const terrainOptions = useMemo(() => {
    const opts = [];
    for (const [group, types] of Object.entries(TERRAIN_GROUPS)) {
      for (const t of types) {
        if (TL[t]) opts.push({ value: t, label: TL[t], group });
      }
    }
    return opts;
  }, []);

  if (!selectedCell || !cell) {
    return (
      <div style={{ padding: space[3], fontSize: typography.body.sm, color: colors.text.muted, textAlign: "center" }}>
        Click a hex on the map to edit its terrain.
      </div>
    );
  }

  const displayCoord = cellToDisplayString(selectedCell.c, selectedCell.r);

  const handleTerrainChange = (e) => {
    onUpdateCell(selectedCell.c, selectedCell.r, "terrain", e.target.value);
  };

  const handleElevationChange = (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val >= 0) {
      onUpdateCell(selectedCell.c, selectedCell.r, "elevation", val);
    }
  };

  const handleFeatureToggle = (feature) => {
    const features = cell.features || [];
    const newFeatures = features.includes(feature)
      ? features.filter(f => f !== feature)
      : [...features, feature];
    onUpdateCell(selectedCell.c, selectedCell.r, "features", newFeatures);
  };

  const handleInfraChange = (e) => {
    onUpdateCell(selectedCell.c, selectedCell.r, "infrastructure", e.target.value || null);
  };

  return (
    <>
      {/* Cell header */}
      <CollapsibleSection
        title={`Cell ${displayCoord}`}
        accent={colors.accent.green}
      >
        <div style={{
          fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2],
          fontFamily: typography.monoFamily,
        }}>
          col={selectedCell.c} row={selectedCell.r}
        </div>

        {/* Terrain type */}
        <div style={{ marginBottom: space[3] }}>
          <div style={fieldLabel}>Terrain Type</div>
          <select
            value={cell.terrain || ""}
            onChange={handleTerrainChange}
            style={inputStyle}
          >
            {Object.entries(TERRAIN_GROUPS).map(([group, types]) => (
              <optgroup key={group} label={group}>
                {types.filter(t => TL[t]).map(t => (
                  <option key={t} value={t}>{TL[t]}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Color swatch */}
          <div style={{
            display: "inline-block", width: 12, height: 12, borderRadius: 2,
            background: TC[cell.terrain] || "#666", marginTop: 4, verticalAlign: "middle",
            border: "1px solid rgba(255,255,255,0.2)",
          }} />
          <span style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginLeft: space[1] }}>
            {TL[cell.terrain] || cell.terrain}
          </span>
        </div>

        {/* Elevation */}
        <div style={{ marginBottom: space[3] }}>
          <div style={fieldLabel}>Elevation (m)</div>
          <input
            type="number"
            value={cell.elevation ?? 0}
            onChange={handleElevationChange}
            min="0"
            step="10"
            style={inputStyle}
          />
        </div>

        {/* Infrastructure */}
        <div style={{ marginBottom: space[3] }}>
          <div style={fieldLabel}>Infrastructure</div>
          <select
            value={cell.infrastructure || ""}
            onChange={handleInfraChange}
            style={inputStyle}
          >
            <option value="">None</option>
            {INFRA_OPTIONS.filter(o => o).map(o => (
              <option key={o} value={o}>{FL[o] || o}</option>
            ))}
          </select>
        </div>
      </CollapsibleSection>

      {/* Features (grouped checkboxes) */}
      <CollapsibleSection title="Features" accent={colors.accent.cyan}>
        {Object.entries(FG).map(([groupName, features]) => (
          <div key={groupName} style={{ marginBottom: space[2] }}>
            <div style={{
              fontSize: typography.body.xs, color: colors.text.secondary,
              fontWeight: typography.weight.semibold, marginBottom: 2,
            }}>
              {groupName}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {features.map(f => {
                const isActive = (cell.features || []).includes(f);
                return (
                  <button
                    key={f}
                    onClick={() => handleFeatureToggle(f)}
                    title={FL[f] || f}
                    style={{
                      padding: "2px 6px", fontSize: 10,
                      background: isActive ? `${colors.accent.cyan}25` : colors.bg.input,
                      border: `1px solid ${isActive ? colors.accent.cyan : colors.border.subtle}`,
                      borderRadius: radius.sm,
                      color: isActive ? colors.accent.cyan : colors.text.secondary,
                      cursor: "pointer", fontFamily: typography.fontFamily,
                    }}
                  >
                    {FL[f] || f}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </CollapsibleSection>
    </>
  );
}
