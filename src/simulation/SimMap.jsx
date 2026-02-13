import { useRef, useEffect, useCallback, useState } from "react";
import { TC, TL, ACTOR_COLORS } from "../terrainColors.js";
import MapRenderer from "../mapRenderer/MapRenderer.js";
import { buildLinearNetworks } from "../mapRenderer/RoadNetwork.js";
import { buildNameGroups } from "../mapRenderer/overlays/LabelOverlay.js";
import {
  createViewport, screenToCell, zoomAtPoint, panViewport,
  clampCellPixels, ZOOM_FACTOR, getTier,
} from "../mapRenderer/ViewportState.js";

// ═══════════════════════════════════════════════════════════════
// SIM MAP — Multi-scale terrain renderer with unit overlay
// ═══════════════════════════════════════════════════════════════

const TIER_NAMES = ["Strategic", "Operational", "Tactical", "Close-up"];

export default function SimMap({ terrainData, units, actors, style }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewportRef = useRef({ centerCol: 0, centerRow: 0, cellPixels: 10 });
  const dragRef = useRef(null);
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
        containerSizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
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
      units: units,
      actorColorMap: actorColorMap,
    });
  }, [D, units, hovCell, redrawTick, cols, rows, actorColorMap]);

  // Mouse handlers
  const getCellFromEvent = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    return screenToCell(mx, my, viewportRef.current, w, h, cols, rows);
  }, [cols, rows]);

  const handleMouseMove = useCallback((e) => {
    if (dragRef.current) {
      const dx = e.movementX;
      const dy = e.movementY;
      viewportRef.current = panViewport(viewportRef.current, dx, dy);
      setRedrawTick(t => t + 1);
    } else {
      setHovCell(getCellFromEvent(e));
    }
  }, [getCellFromEvent]);

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

  // Cell info
  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;
  const currentTier = getTier(viewportRef.current.cellPixels);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: dragRef.current ? "grabbing" : "crosshair" }}
        onMouseDown={() => { dragRef.current = true; }}
        onMouseUp={() => { dragRef.current = false; }}
        onMouseLeave={() => { dragRef.current = false; setHovCell(null); }}
        onMouseMove={handleMouseMove}
      />
      {/* Cell tooltip */}
      {cellData && (
        <div style={{
          position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.85)", padding: "8px 12px",
          borderRadius: 6, fontSize: 11, color: "#E5E7EB", maxWidth: 300, lineHeight: 1.5,
          border: "1px solid #1E293B"
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
            const commaMatch = u.position?.match(/^(\d+),(\d+)$/);
            const letterMatch = u.position?.match(/^([A-Z]+)(\d+)$/i);
            let uc, ur;
            if (commaMatch) { uc = parseInt(commaMatch[1]); ur = parseInt(commaMatch[2]); }
            else if (letterMatch) { uc = letterMatch[1].toUpperCase().split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1; ur = parseInt(letterMatch[2]) - 1; }
            return uc === hovCell.c && ur === hovCell.r;
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
      }}>
        {TIER_NAMES[currentTier]} · {viewportRef.current.cellPixels.toFixed(1)}px/cell
      </div>
    </div>
  );
}
