// ════════════════════════════════════════════════════════════════
// MapView — unified React component for hex map rendering
// WebGL2 terrain + Canvas 2D overlay (labels, units, selection)
// Used by both Viewer and SimMap
// ════════════════════════════════════════════════════════════════

import { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import HexGLRenderer from "./gl/HexGLRenderer.js";
import LineRenderer from "./gl/LineRenderer.js";
import { buildLinearNetworks } from "./RoadNetwork.js";
import { buildNameGroups, drawNameLabels, drawCoordLabels } from "./overlays/LabelOverlay.js";
import { drawUnits, parseUnitPosition } from "./overlays/UnitOverlay.js";
import { drawHoverHighlight, drawSelectionHighlight } from "./overlays/SelectionOverlay.js";
import {
  createViewport, screenToCell, zoomAtPoint, panViewport,
  clampCellPixels, ZOOM_FACTOR, getVisibleRange,
} from "./ViewportState.js";
import { cellPixelsToHexSize, SQRT3 } from "./HexMath.js";

const CLICK_THRESHOLD = 5;
const BG_COLOR = "#1A2535";

const MapView = forwardRef(function MapView({
  mapData,
  activeFeatures = null,    // Set of active feature names (null = all)
  units = null,              // array of unit objects (SimMap mode)
  actorColorMap = {},        // { actorId: "#color" }
  onCellClick = null,
  onCellHover = null,
  interactionMode = "navigate",
  selectedUnitId = null,
  ghostUnit = null,
  isSetupMode = false,
  style = {},
}, ref) {
  const glCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const viewportRef = useRef({ centerCol: 0, centerRow: 0, cellPixels: 10 });
  const dragRef = useRef(false);
  const mouseDownRef = useRef(null);
  const rendererRef = useRef(null);
  const lineRendererRef = useRef(null);
  const preprocessedRef = useRef({ roadNetworks: null, nameGroups: null });
  const containerSizeRef = useRef({ w: 600, h: 400 });
  const [hovCell, setHovCell] = useState(null);
  const [redrawTick, setRedrawTick] = useState(0);
  const rafRef = useRef(null);

  const D = mapData;
  const cols = D?.cols || 0;
  const rows = D?.rows || 0;

  // Resolve selected unit to cell
  const selCell = (() => {
    if (!selectedUnitId || !units) return null;
    const unit = units.find(u => u.id === selectedUnitId);
    if (!unit || !unit.position) return null;
    return parseUnitPosition(unit.position);
  })();

  // Ghost unit with hover cell
  const activeGhostUnit = (() => {
    if (!ghostUnit || !hovCell) return null;
    return { ...ghostUnit, cell: hovCell };
  })();

  // ── Initialize WebGL on mount ──
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    const renderer = new HexGLRenderer();
    try {
      renderer.init(glCanvas);
    } catch (e) {
      console.error("WebGL2 init failed:", e);
      return;
    }
    rendererRef.current = renderer;

    const lineRenderer = new LineRenderer();
    lineRenderer.init(renderer.gl);
    lineRendererRef.current = lineRenderer;

    return () => {
      lineRenderer.destroy();
      renderer.destroy();
      rendererRef.current = null;
      lineRendererRef.current = null;
    };
  }, []);

  // ── Upload map data to GPU ──
  useEffect(() => {
    if (!D || !D.cells || !rendererRef.current) return;

    rendererRef.current.uploadMapData(D);

    // Preprocess roads and labels
    const roadNetworks = buildLinearNetworks(D.cells, cols, rows);
    const nameGroups = buildNameGroups(D.cells, cols, rows);
    preprocessedRef.current = { roadNetworks, nameGroups };

    // Upload road networks
    if (lineRendererRef.current) {
      lineRendererRef.current.uploadNetworks(roadNetworks, activeFeatures);
    }

    setRedrawTick(t => t + 1);
  }, [D, cols, rows]);

  // ── Re-upload line networks when active features change ──
  useEffect(() => {
    if (!lineRendererRef.current || !preprocessedRef.current.roadNetworks) return;
    lineRendererRef.current.uploadNetworks(preprocessedRef.current.roadNetworks, activeFeatures);
    setRedrawTick(t => t + 1);
  }, [activeFeatures]);

  // ── Observe container resize ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        containerSizeRef.current = {
          w: Math.round(entry.contentRect.width),
          h: Math.round(entry.contentRect.height),
        };
        setRedrawTick(t => t + 1);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Auto-fit viewport on data load ──
  useEffect(() => {
    if (!cols || !rows || !containerSizeRef.current.w) return;
    const { w, h } = containerSizeRef.current;
    viewportRef.current = createViewport(cols, rows, w, h);
    setRedrawTick(t => t + 1);
  }, [cols, rows]);

  // ── Render loop ──
  useEffect(() => {
    if (!D || !rendererRef.current) return;
    const { w, h } = containerSizeRef.current;
    if (w <= 0 || h <= 0) return;

    const viewport = viewportRef.current;

    // WebGL pass: terrain + lines
    rendererRef.current.render(viewport, w, h, activeFeatures);
    if (lineRendererRef.current) {
      lineRendererRef.current.render(viewport, w, h);
    }

    // Canvas 2D overlay: labels, units, selection
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
      }
      const ctx = overlay.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      // Name labels
      const cp = viewport.cellPixels;
      if (preprocessedRef.current.nameGroups && cp >= 3) {
        drawNameLabels(ctx, viewport, w, h, preprocessedRef.current.nameGroups, cols, rows);
      }
      // Coordinate labels
      if (cp >= 6) {
        drawCoordLabels(ctx, viewport, w, h, cols, rows);
      }
      // Units
      if (units || activeGhostUnit) {
        drawUnits(ctx, units, actorColorMap, viewport, w, h, cols, rows,
          isSetupMode ? { ghostUnit: activeGhostUnit, isSetupMode: true } : null);
      }
      // Hover highlight
      if (hovCell) {
        drawHoverHighlight(ctx, viewport, w, h, hovCell.c, hovCell.r);
      }
      // Selection highlight
      if (selCell) {
        drawSelectionHighlight(ctx, viewport, w, h, selCell.c, selCell.r);
      }
    }
  }, [D, units, hovCell, selCell, activeGhostUnit, redrawTick, cols, rows, actorColorMap, isSetupMode, activeFeatures]);

  // ── Mouse handlers ──
  const getCellFromEvent = useCallback((e) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    return screenToCell(mx, my, viewportRef.current, w, h, cols, rows);
  }, [cols, rows]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const cell = getCellFromEvent(e);
    mouseDownRef.current = { x: e.clientX, y: e.clientY, cell };
  }, [getCellFromEvent]);

  const handleMouseMove = useCallback((e) => {
    const down = mouseDownRef.current;

    if (down && !dragRef.current) {
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (dist > CLICK_THRESHOLD) {
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
      dragRef.current = false;
      return;
    }

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
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    viewportRef.current = zoomAtPoint(viewportRef.current, mx, my, w, h, factor);
    setRedrawTick(t => t + 1);
  }, []);

  // Wheel listener (passive: false)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => { e.preventDefault(); handleWheel(e); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [handleWheel]);

  // ── Expose imperative API ──
  useImperativeHandle(ref, () => ({
    getViewport: () => viewportRef.current,
    setViewport: (vp) => { viewportRef.current = vp; setRedrawTick(t => t + 1); },
    fitMap: () => {
      if (!cols || !rows) return;
      const { w, h } = containerSizeRef.current;
      viewportRef.current = createViewport(cols, rows, w, h);
      setRedrawTick(t => t + 1);
    },
    zoomIn: () => {
      const { w, h } = containerSizeRef.current;
      viewportRef.current = zoomAtPoint(viewportRef.current, w / 2, h / 2, w, h, ZOOM_FACTOR);
      setRedrawTick(t => t + 1);
    },
    zoomOut: () => {
      const { w, h } = containerSizeRef.current;
      viewportRef.current = zoomAtPoint(viewportRef.current, w / 2, h / 2, w, h, 1 / ZOOM_FACTOR);
      setRedrawTick(t => t + 1);
    },
    panTo: (col, row) => {
      viewportRef.current = { ...viewportRef.current, centerCol: col, centerRow: row };
      setRedrawTick(t => t + 1);
    },
    getGL: () => rendererRef.current?.gl || null,
    getHexRenderer: () => rendererRef.current,
    getContainerSize: () => containerSizeRef.current,
    // For minimap rendering
    renderMinimap: (minimapCtx, mw, mh) => {
      if (!D || !rendererRef.current) return;
      // Render a low-res version using WebGL, then copy to minimap canvas
      const renderer = rendererRef.current;
      const mmViewport = {
        centerCol: cols / 2,
        centerRow: rows / 2,
        // Fit the map into the minimap
        cellPixels: Math.min(mw / (cols + 0.5), mh / (rows * 1.5 / SQRT3 + 0.5 / SQRT3)) * 0.95,
      };
      renderer.render(mmViewport, mw, mh, activeFeatures);
      // Copy from WebGL canvas to minimap 2D canvas
      minimapCtx.drawImage(renderer.gl.canvas, 0, 0, mw, mh);
      // Restore main viewport render
      const { w, h } = containerSizeRef.current;
      renderer.render(viewportRef.current, w, h, activeFeatures);
      if (lineRendererRef.current) {
        lineRendererRef.current.render(viewportRef.current, w, h);
      }
    },
    // For PNG export
    renderExport: (exportWidth, exportHeight) => {
      if (!D || !rendererRef.current) return null;
      const renderer = rendererRef.current;
      const exportCellSize = 28;
      const exportViewport = {
        centerCol: cols / 2,
        centerRow: rows / 2,
        cellPixels: exportCellSize,
      };
      renderer.render(exportViewport, exportWidth, exportHeight, activeFeatures);
      if (lineRendererRef.current) {
        lineRendererRef.current.render(exportViewport, exportWidth, exportHeight);
      }
      return renderer.gl.canvas;
    },
    forceRedraw: () => setRedrawTick(t => t + 1),
  }), [D, cols, rows, activeFeatures]);

  // Cursor
  const getCursor = () => {
    if (dragRef.current) return "grabbing";
    if (interactionMode === "place_unit") return "copy";
    return "crosshair";
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      {/* WebGL canvas — terrain + lines */}
      <canvas
        ref={glCanvasRef}
        style={{
          display: "block",
          position: "absolute",
          top: 0, left: 0,
          width: "100%",
          height: "100%",
          cursor: getCursor(),
        }}
      />
      {/* Canvas 2D overlay — labels, units, selection */}
      <canvas
        ref={overlayCanvasRef}
        style={{
          display: "block",
          position: "absolute",
          top: 0, left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
});

export default MapView;
