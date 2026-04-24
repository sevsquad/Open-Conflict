import { useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { TL, ACTOR_COLORS } from "../terrainColors.js";
import MapView from "../mapRenderer/MapView.jsx";
import { getUnitFogTier, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { hexDistance } from "../mapRenderer/HexMath.js";

// SIM MAP - Thin wrapper around MapView for simulation mode
// Adds: cell tooltip, zoom indicator, measure toggle, placement mode indicator

const SimMap = forwardRef(function SimMap({
  terrainData, units, actors, style,
  interactionMode = "navigate",
  selectedUnitId = null,
  selectedUnitIds = null,
  ghostUnit = null,
  onCellClick = null,
  onContextCommand = null,
  onSelectionBox = null,
  onOverlayUnitClick = null,
  onCellHover = null,
  isSetupMode = false,
  fogOfWar = false,
  fowMode = null,
  targetingMode = null,
  movePath = null,
  proposedMoves = null,
  strategicGrid = null,
  strategicMode = false,
  airOverlayData = null,
  orderOverlayData = null,
  terrainModsData = null,
  vpOverlayData = null,
  activeFeatures = null,
  showElevBands = false,
  rtsDisplayState = null,
}, ref) {
  const mapViewRef = useRef(null);
  const [hovCell, setHovCell] = useState(null);
  const [measuring, setMeasuring] = useState(false);

  useImperativeHandle(ref, () => ({
    exportImage: () => mapViewRef.current?.exportImage?.() || null,
    clearMeasure: () => mapViewRef.current?.clearMeasure?.(),
    getMapView: () => mapViewRef.current,
  }));

  const D = terrainData;

  const actorColorMap = useMemo(() => {
    const map = {};
    (actors || []).forEach((actor, index) => {
      map[actor.id] = ACTOR_COLORS[index % ACTOR_COLORS.length];
    });
    return map;
  }, [actors]);

  const handleCellHover = useCallback((cell) => {
    setHovCell(cell);
    onCellHover?.(cell);
  }, [onCellHover]);

  const effectiveMode = (interactionMode === "target_hex" || interactionMode === "place_vp" || interactionMode === "place_cvp")
    ? "place_unit"
    : measuring && interactionMode === "navigate"
      ? "measure"
      : interactionMode;

  const handleToggleMeasure = useCallback(() => {
    if (measuring) {
      mapViewRef.current?.clearMeasure?.();
    }
    setMeasuring((value) => !value);
  }, [measuring]);

  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;
  const currentVp = mapViewRef.current?.getViewport();
  const currentCellPx = currentVp ? currentVp.cellPixels : 10;
  const cellKm = D?.cellSizeKm || null;

  const hoveredUnitRows = hovCell
    ? (units || []).flatMap((unit) => {
      if (!unit.position) return [];
      const pos = parseUnitPosition(unit.position);
      if (!pos || pos.c !== hovCell.c || pos.r !== hovCell.r) return [];
      const fogTier = getUnitFogTier(unit, fowMode);
      if (fogTier === "hidden") return [];
      if (fogTier === "contact") {
        return [{
          key: `contact_${unit.id}`,
          color: "#EF4444",
          label: "Unknown contact",
        }];
      }
      return [{
        key: unit.id,
        color: actorColorMap[unit.actor] || "#FFF",
        label: `${unit.name} (${unit.type}${unit.echelon ? ` · ${unit.echelon}` : ""}) - ${unit.strength}% str${unit.posture && unit.posture !== "ready" ? ` [${unit.posture}]` : ""}`,
      }];
    })
    : [];

  const hovDistInfo = (() => {
    if (!selectedUnitId || !hovCell || !units || !cellKm || effectiveMode === "measure") return null;
    const selUnit = units.find((unit) => unit.id === selectedUnitId);
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
        selectedUnitIds={selectedUnitIds}
        ghostUnit={ghostUnit}
        isSetupMode={isSetupMode}
        unitOverlayOptions={!isSetupMode ? { showFrontLines: true, fowMode: fowMode || undefined } : null}
        cellSizeKm={cellKm}
        onCellClick={onCellClick}
        onCellContextMenu={onContextCommand}
        onSelectionBox={onSelectionBox}
        onOverlayUnitClick={onOverlayUnitClick}
        onCellHover={handleCellHover}
        movePath={movePath}
        proposedMoves={proposedMoves}
        strategicGrid={strategicGrid}
        strategicMode={strategicMode}
        airOverlayData={airOverlayData}
        orderOverlayData={orderOverlayData}
        terrainModsData={terrainModsData}
        vpOverlayData={vpOverlayData}
        activeFeatures={activeFeatures}
        showElevBands={showElevBands}
        rtsDisplayState={rtsDisplayState}
      />

      {cellData && (
        <div style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          background: "rgba(0,0,0,0.85)",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 11,
          color: "#E5E7EB",
          maxWidth: 300,
          lineHeight: 1.5,
          border: "1px solid #1E293B",
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, color: "#F59E0B" }}>
            {String.fromCharCode(65 + (hovCell.c % 26))}
            {hovCell.r + 1}
            {" · "}
            {TL[cellData.terrain] || cellData.terrain}
          </div>
          {cellData.elevation !== undefined && <div>Elevation: {cellData.elevation}m</div>}
          {cellData.features?.length > 0 && <div>Features: {cellData.features.join(", ")}</div>}
          {cellData.infrastructure && <div>Infrastructure: {cellData.infrastructure}</div>}
          {cellData.attributes?.length > 0 && <div>Attributes: {cellData.attributes.join(", ")}</div>}
          {cellData.feature_names && Object.keys(cellData.feature_names).length > 0 && (
            <div>Names: {Object.entries(cellData.feature_names).map(([key, value]) => `${value} (${key})`).join(", ")}</div>
          )}
          {hoveredUnitRows.map((row) => (
            <div key={row.key} style={{ color: row.color, marginTop: 2 }}>
              {row.label}
            </div>
          ))}
          {hovDistInfo && (
            <div style={{ color: "#F59E0B", marginTop: 2, fontWeight: 600 }}>↔ {hovDistInfo}</div>
          )}
        </div>
      )}

      <div style={{
        position: "absolute",
        top: 4,
        right: 4,
        fontSize: 9,
        color: "#9CA3AF",
        fontFamily: "monospace",
        background: "rgba(0,0,0,0.5)",
        padding: "1px 4px",
        borderRadius: 3,
        pointerEvents: "none",
      }}>
        {currentCellPx.toFixed(1)}px/cell{cellKm ? ` · ${cellKm}km/hex` : ""}
      </div>

      <button
        onClick={handleToggleMeasure}
        title={measuring ? "Exit measure mode" : "Measure distance"}
        style={{
          position: "absolute",
          top: 4,
          right: cellKm ? 140 : 80,
          zIndex: 10,
          fontSize: 10,
          color: measuring ? "#F59E0B" : "#9CA3AF",
          fontFamily: "monospace",
          background: measuring ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.5)",
          padding: "1px 6px",
          borderRadius: 3,
          cursor: "pointer",
          border: measuring ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent",
        }}
      >
        {measuring ? "⊹ Measuring" : "⊹ Measure"}
      </button>

      {interactionMode === "place_unit" && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 10,
          color: "#F59E0B",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "2px 8px",
          borderRadius: 3,
          border: "1px solid rgba(245,158,11,0.3)",
          pointerEvents: "none",
        }}>
          Placing unit - click to place, Esc to cancel
        </div>
      )}

      {interactionMode === "edit_terrain" && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 10,
          color: "#22C55E",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "2px 8px",
          borderRadius: 3,
          border: "1px solid rgba(34,197,94,0.3)",
          pointerEvents: "none",
        }}>
          Edit terrain - click a hex to edit, Esc to exit
        </div>
      )}

      {measuring && interactionMode === "navigate" && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 10,
          color: "#F59E0B",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "2px 8px",
          borderRadius: 3,
          border: "1px solid rgba(245,158,11,0.3)",
          pointerEvents: "none",
        }}>
          Measure - click two hexes, Esc to exit
        </div>
      )}

      {interactionMode === "target_hex" && targetingMode && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 10,
          color: "#F59E0B",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.85)",
          padding: "4px 10px",
          borderRadius: 3,
          border: "1px solid rgba(245,158,11,0.5)",
          pointerEvents: "none",
          zIndex: 20,
        }}>
          Select target hex for {targetingMode.orderType} - click hex, Esc to cancel
        </div>
      )}

      {interactionMode === "place_cvp" && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 4,
          fontSize: 10,
          color: "#EF4444",
          fontFamily: "monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "2px 8px",
          borderRadius: 3,
          border: "1px solid rgba(239,68,68,0.3)",
          pointerEvents: "none",
        }}>
          Placing CVP hex - click to place, Esc to cancel
        </div>
      )}
    </div>
  );
});

export default SimMap;
