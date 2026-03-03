import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { TL, ACTOR_COLORS } from "../terrainColors.js";
import MapView from "../mapRenderer/MapView.jsx";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { hexDistance } from "../mapRenderer/HexMath.js";

// ═══════════════════════════════════════════════════════════════
// SIM MAP — Thin wrapper around MapView for simulation mode
// Adds: cell tooltip, zoom indicator, measure toggle, placement mode indicator
// ═══════════════════════════════════════════════════════════════

const SimMap = forwardRef(function SimMap({
  terrainData, units, actors, style,
  interactionMode = "navigate",
  selectedUnitId = null,
  ghostUnit = null,
  onCellClick = null,
  onCellHover = null,
  isSetupMode = false,
  fogOfWar = false,
}, ref) {
  const mapViewRef = useRef(null);
  const [hovCell, setHovCell] = useState(null);
  const [measuring, setMeasuring] = useState(false);

  // Forward imperative methods (exportImage, clearMeasure) to parent
  useImperativeHandle(ref, () => ({
    exportImage: () => mapViewRef.current?.exportImage?.() || null,
    clearMeasure: () => mapViewRef.current?.clearMeasure?.(),
    getMapView: () => mapViewRef.current,
  }));

  const D = terrainData;

  // Build actor color index
  const actorColorMap = {};
  (actors || []).forEach((a, i) => { actorColorMap[a.id] = ACTOR_COLORS[i % ACTOR_COLORS.length]; });

  // Handle hover — track locally for tooltip + forward to parent
  const handleCellHover = useCallback((cell) => {
    setHovCell(cell);
    onCellHover?.(cell);
  }, [onCellHover]);

  // Measure mode: local toggle overrides default "navigate" but not external modes like "place_unit"
  const effectiveMode = measuring && interactionMode === "navigate" ? "measure" : interactionMode;

  // When switching away from measure mode, clear measurement points
  const handleToggleMeasure = useCallback(() => {
    if (measuring) {
      mapViewRef.current?.clearMeasure?.();
    }
    setMeasuring(m => !m);
  }, [measuring]);

  // Cell info for tooltip
  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;
  const currentVp = mapViewRef.current?.getViewport();
  const currentCellPx = currentVp ? currentVp.cellPixels : 10;
  const cellKm = D?.cellSizeKm || null;

  // Hover distance from selected unit (for tooltip)
  const hovDistInfo = (() => {
    if (!selectedUnitId || !hovCell || !units || !cellKm || effectiveMode === "measure") return null;
    const selUnit = units.find(u => u.id === selectedUnitId);
    if (!selUnit?.position) return null;
    const pos = parseUnitPosition(selUnit.position);
    if (!pos) return null;
    const dist = hexDistance(pos.c, pos.r, hovCell.c, hovCell.r);
    if (dist === 0) return null;
    return `${dist} hex · ${(dist * cellKm).toFixed(1)} km`;
  })();

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <MapView
        ref={mapViewRef}
        mapData={D}
        units={units}
        actorColorMap={actorColorMap}
        interactionMode={effectiveMode}
        selectedUnitId={selectedUnitId}
        ghostUnit={ghostUnit}
        isSetupMode={isSetupMode}
        unitOverlayOptions={!isSetupMode ? { showFrontLines: true } : null}
        cellSizeKm={cellKm}
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
              {u.name} ({u.type}{u.echelon ? ` · ${u.echelon}` : ""}) — {u.strength}% str{u.posture && u.posture !== "ready" ? ` [${u.posture}]` : ""}
            </div>
          ))}
          {/* Distance from selected unit */}
          {hovDistInfo && (
            <div style={{ color: "#F59E0B", marginTop: 2, fontWeight: 600 }}>↔ {hovDistInfo}</div>
          )}
        </div>
      )}
      {/* Zoom/scale indicator */}
      <div style={{
        position: "absolute", top: 4, right: 4, fontSize: 9, color: "#9CA3AF",
        fontFamily: "monospace", background: "rgba(0,0,0,0.5)", padding: "1px 4px", borderRadius: 3,
        pointerEvents: "none",
      }}>
        {currentCellPx.toFixed(1)}px/cell{cellKm ? ` · ${cellKm}km/hex` : ""}
      </div>
      {/* Measure toggle button */}
      <button
        onClick={handleToggleMeasure}
        title={measuring ? "Exit measure mode" : "Measure distance"}
        style={{
          position: "absolute", top: 4, right: cellKm ? 140 : 80, zIndex: 10,
          fontSize: 10, color: measuring ? "#F59E0B" : "#9CA3AF",
          fontFamily: "monospace", background: measuring ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.5)",
          padding: "1px 6px", borderRadius: 3, cursor: "pointer",
          border: measuring ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent",
        }}
      >
        {measuring ? "⊹ Measuring" : "⊹ Measure"}
      </button>
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
      {/* Edit terrain mode indicator */}
      {interactionMode === "edit_terrain" && (
        <div style={{
          position: "absolute", top: 4, left: 4, fontSize: 10, color: "#22C55E",
          fontFamily: "monospace", background: "rgba(0,0,0,0.7)", padding: "2px 8px", borderRadius: 3,
          border: "1px solid rgba(34,197,94,0.3)", pointerEvents: "none",
        }}>
          Edit terrain — click a hex to edit, Esc to exit
        </div>
      )}
      {/* Measure mode indicator */}
      {measuring && interactionMode === "navigate" && (
        <div style={{
          position: "absolute", top: 4, left: 4, fontSize: 10, color: "#F59E0B",
          fontFamily: "monospace", background: "rgba(0,0,0,0.7)", padding: "2px 8px", borderRadius: 3,
          border: "1px solid rgba(245,158,11,0.3)", pointerEvents: "none",
        }}>
          Measure — click two hexes, Esc to exit
        </div>
      )}
    </div>
  );
});

export default SimMap;
