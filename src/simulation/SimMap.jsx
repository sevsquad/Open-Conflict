import { useRef, useEffect, useCallback, useState } from "react";
import { TC, TL, ACTOR_COLORS } from "../terrainColors.js";
import MapRenderer from "../mapRenderer/MapRenderer.js";
import { buildLinearNetworks } from "../mapRenderer/RoadNetwork.js";
import { buildNameGroups } from "../mapRenderer/overlays/LabelOverlay.js";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import {
  createViewport, screenToCell, zoomAtPoint, panViewport,
  clampCellPixels, ZOOM_FACTOR, getTier,
} from "../mapRenderer/ViewportState.js";

// ═══════════════════════════════════════════════════════════════
// SIM MAP — Multi-scale terrain renderer with unit overlay
// ═══════════════════════════════════════════════════════════════

const TIER_NAMES = ["Strategic", "Operational", "Tactical", "Close-up"];
const CLICK_THRESHOLD = 5; // pixels — distinguishes click from drag

export default function SimMap({
  terrainData, units, actors, style,
  // New optional props for setup interaction
  interactionMode = "navigate",
  selectedUnitId = null,
  ghostUnit = null,
  onCellClick = null,
  onCellHover = null,
  isSetupMode = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewportRef = useRef({ centerCol: 0, centerRow: 0, cellPixels: 10 });
  const dragRef = useRef(false);
  const mouseDownRef = useRef(null); // { x, y, cell }
  const rendererRef = useRef(new MapRenderer());
  const preprocessedRef = useRef({ roadNetworks: null, nameGroups: null });
  const containerSizeRef = useRef({ w: 600, h: 400 });
  const [hovCell, setHovCell] = useState(null);
  const [redrawTick, setRedrawTick] = useState(0);

  const D = terrainData;
  const cols = D?.cols || 0;
  const rows = D?.rows || 0;

  // Build actor color index
  const actorColorMap = {};
  (actors || []).forEach((a, i) => { actorColorMap[a.id] = ACTOR_COLORS[i % ACTOR_COLORS.length]; });

  // Resolve selected unit to cell for selection highlight
  const selCell = (() => {
    if (!selectedUnitId || !units) return null;
    const unit = units.find(u => u.id === selectedUnitId);
    if (!unit || !unit.position) return null;
    return parseUnitPosition(unit.position);
  })();

  // Build ghost unit with current hover cell
  const activeGhostUnit = (() => {
    if (!ghostUnit || !hovCell) return null;
    return { ...ghostUnit, cell: hovCell };
  })();

  // Preprocess on data change
  useEffect(() => {
    if (!D || !D.cells) return;
    preprocessedRef.current = {
      roadNetworks: buildLinearNetworks(D.cells, cols, rows),
      nameGroups: buildNameGroups(D.cells, cols, rows),
    };
    rendererRef.current.invalidateAll();
    setRedrawTick(t => t + 1);
  }, [D, cols, rows]);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        containerSizeRef.current = { w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) };
        setRedrawTick(t => t + 1);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit on load
  useEffect(() => {
    if (!cols || !rows || !containerSizeRef.current.w) return;
    const { w, h } = containerSizeRef.current;
    viewportRef.current = createViewport(cols, rows, w, h);
    setRedrawTick(t => t + 1);
  }, [cols, rows]);

  // Set up re-render callback for progressive tile loading
  useEffect(() => {
    rendererRef.current.onNeedsRerender = () => setRedrawTick(t => t + 1);
    return () => { rendererRef.current.onNeedsRerender = null; };
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !D) return;
    const { w, h } = containerSizeRef.current;
    if (w <= 0 || h <= 0) return;

    if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
    }
    const ctx = canvas.getContext("2d");
    const viewport = viewportRef.current;

    rendererRef.current.render(ctx, canvas.width, canvas.height, viewport, D, {
      roadNetworks: preprocessedRef.current.roadNetworks,
      nameGroups: preprocessedRef.current.nameGroups,
      hovCell: hovCell,
      selCell: selCell,
      units: units,
      actorColorMap: actorColorMap,
      setupOptions: isSetupMode ? {
        ghostUnit: activeGhostUnit,
        isSetupMode: true,
      } : null,
    });
  }, [D, units, hovCell, selCell, activeGhostUnit, redrawTick, cols, rows, actorColorMap, isSetupMode]);

  // Mouse handlers
  const getCellFromEvent = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    return screenToCell(mx, my, viewportRef.current, w, h, cols, rows);
  }, [cols, rows]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const cell = getCellFromEvent(e);
    mouseDownRef.current = { x: e.clientX, y: e.clientY, cell };
    // Don't start pan immediately — wait for movement threshold
  }, [getCellFromEvent]);

  const handleMouseMove = useCallback((e) => {
    const down = mouseDownRef.current;

    if (down && !dragRef.current) {
      // Check if we've exceeded the click threshold
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > CLICK_THRESHOLD) {
        // This is a drag — start panning
        dragRef.current = true;
      }
    }

    if (dragRef.current) {
      const dx = e.movementX;
      const dy = e.movementY;
      viewportRef.current = panViewport(viewportRef.current, dx, dy);
      setRedrawTick(t => t + 1);
    } else {
      const cell = getCellFromEvent(e);
      setHovCell(cell);
      onCellHover?.(cell);
    }
  }, [getCellFromEvent, onCellHover]);

  const handleMouseUp = useCallback((e) => {
    const down = mouseDownRef.current;
    mouseDownRef.current = null;

    if (dragRef.current) {
      // Was a pan drag — just clean up
      dragRef.current = false;
      return;
    }

    // This was a click (didn't exceed threshold)
    if (down && down.cell) {
      onCellClick?.(down.cell);
    }
  }, [onCellClick]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = false;
    mouseDownRef.current = null;
    setHovCell(null);
    onCellHover?.(null);
  }, [onCellHover]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    viewportRef.current = zoomAtPoint(viewportRef.current, mx, my, w, h, factor);
    setRedrawTick(t => t + 1);
  }, []);

  // Wheel event listener (passive: false for preventDefault)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e) => { e.preventDefault(); handleWheel(e); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [handleWheel]);

  // Determine cursor based on interaction state
  const getCursor = () => {
    if (dragRef.current) return "grabbing";
    if (interactionMode === "place_unit") return "copy";
    return "crosshair";
  };

  // Cell info
  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;
  const currentTier = getTier(viewportRef.current.cellPixels);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
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
      {/* Zoom/tier indicator */}
      <div style={{
        position: "absolute", top: 4, right: 4, fontSize: 9, color: "#9CA3AF",
        fontFamily: "monospace", background: "rgba(0,0,0,0.5)", padding: "1px 4px", borderRadius: 3,
        pointerEvents: "none",
      }}>
        {TIER_NAMES[currentTier]} · {viewportRef.current.cellPixels.toFixed(1)}px/cell
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
