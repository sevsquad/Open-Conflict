import { useRef, useState, useCallback } from "react";
import { TL, ACTOR_COLORS } from "../terrainColors.js";
import MapView from "../mapRenderer/MapView.jsx";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";

// ═══════════════════════════════════════════════════════════════
// SIM MAP — Thin wrapper around MapView for simulation mode
// Adds: cell tooltip, zoom indicator, placement mode indicator
// ═══════════════════════════════════════════════════════════════

export default function SimMap({
  terrainData, units, actors, style,
  interactionMode = "navigate",
  selectedUnitId = null,
  ghostUnit = null,
  onCellClick = null,
  onCellHover = null,
  isSetupMode = false,
}) {
  const mapViewRef = useRef(null);
  const [hovCell, setHovCell] = useState(null);

  const D = terrainData;

  // Build actor color index
  const actorColorMap = {};
  (actors || []).forEach((a, i) => { actorColorMap[a.id] = ACTOR_COLORS[i % ACTOR_COLORS.length]; });

  // Handle hover — track locally for tooltip + forward to parent
  const handleCellHover = useCallback((cell) => {
    setHovCell(cell);
    onCellHover?.(cell);
  }, [onCellHover]);

  // Cell info for tooltip
  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;
  const currentVp = mapViewRef.current?.getViewport();
  const currentCellPx = currentVp ? currentVp.cellPixels : 10;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <MapView
        ref={mapViewRef}
        mapData={D}
        units={units}
        actorColorMap={actorColorMap}
        interactionMode={interactionMode}
        selectedUnitId={selectedUnitId}
        ghostUnit={ghostUnit}
        isSetupMode={isSetupMode}
        onCellClick={onCellClick}
        onCellHover={handleCellHover}
      />
      {/* Cell tooltip */}
      {cellData && (
        <div style={{
          position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.85)", padding: "8px 12px",
          borderRadius: 6, fontSize: 11, color: "#E5E7EB", maxWidth: 300, lineHeight: 1.5,
          border: "1px solid #1E293B", pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, color: "#F59E0B" }}>
            {String.fromCharCode(65 + (hovCell.c % 26))}{hovCell.r + 1} &middot; {TL[cellData.terrain] || cellData.terrain}
          </div>
          {cellData.elevation !== undefined && <div>Elevation: {cellData.elevation}m</div>}
          {cellData.features?.length > 0 && <div>Features: {cellData.features.join(", ")}</div>}
          {cellData.infrastructure && <div>Infrastructure: {cellData.infrastructure}</div>}
          {cellData.attributes?.length > 0 && <div>Attributes: {cellData.attributes.join(", ")}</div>}
          {cellData.feature_names && Object.keys(cellData.feature_names).length > 0 && (
            <div>Names: {Object.entries(cellData.feature_names).map(([k, v]) => `${v} (${k})`).join(", ")}</div>
          )}
          {/* Show units at this cell */}
          {units?.filter(u => {
            if (!u.position) return false;
            const pos = parseUnitPosition(u.position);
            return pos && pos.c === hovCell.c && pos.r === hovCell.r;
          }).map(u => (
            <div key={u.id} style={{ color: actorColorMap[u.actor] || "#FFF", marginTop: 2 }}>
              {u.name} ({u.type}) — {u.strength}% str
            </div>
          ))}
        </div>
      )}
      {/* Zoom/scale indicator */}
      <div style={{
        position: "absolute", top: 4, right: 4, fontSize: 9, color: "#9CA3AF",
        fontFamily: "monospace", background: "rgba(0,0,0,0.5)", padding: "1px 4px", borderRadius: 3,
        pointerEvents: "none",
      }}>
        {currentCellPx.toFixed(1)}px/cell
      </div>
      {/* Placement mode indicator */}
      {interactionMode === "place_unit" && (
        <div style={{
          position: "absolute", top: 4, left: 4, fontSize: 10, color: "#F59E0B",
          fontFamily: "monospace", background: "rgba(0,0,0,0.7)", padding: "2px 8px", borderRadius: 3,
          border: "1px solid rgba(245,158,11,0.3)", pointerEvents: "none",
        }}>
          Placing unit — click to place, Esc to cancel
        </div>
      )}
    </div>
  );
}
