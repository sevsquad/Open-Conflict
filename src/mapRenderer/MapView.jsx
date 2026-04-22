// ════════════════════════════════════════════════════════════════
// MapView — unified React component for hex map rendering
// WebGL2 terrain + Canvas 2D overlay (labels, units, selection)
// Used by both Viewer and SimMap
// ════════════════════════════════════════════════════════════════

import { useRef, useEffect, useLayoutEffect, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import HexGLRenderer from "./gl/HexGLRenderer.js";
import LineRenderer from "./gl/LineRenderer.js";
import { buildLinearNetworks } from "./RoadNetwork.js";
import { buildNameGroups, drawNameLabels, drawCoordLabels } from "./overlays/LabelOverlay.js";
import { drawUnits, drawFowOverlay, parseUnitPosition } from "./overlays/UnitOverlay.js";
import { drawHoverHighlight, drawSelectionHighlight } from "./overlays/SelectionOverlay.js";
import {
  createViewport, screenToCell, zoomAtPoint, panViewport,
  clampCellPixels, ZOOM_FACTOR, getVisibleRange,
} from "./ViewportState.js";
import { cellPixelsToHexSize, hexDistance, hexToScreen, SQRT3 } from "./HexMath.js";
import { computeElevationRange } from "./gl/HexGPUData.js";
import { buildContourLabelData, drawContourLabels } from "./overlays/ContourLabels.js";
import { generateStrategicAtlas } from "./gl/StrategicAtlas.js";
import { generateTileAtlas } from "./gl/tileAtlas/index.js";
import { drawStrategicGridOverlay } from "./overlays/StrategicGridOverlay.js";
import { drawADCoverage, drawFlightPaths, drawCASSectors } from "./overlays/AirOverlay.js";
import { drawOrderOverlay } from "./overlays/OrderOverlay.js";
import { drawTerrainMods } from "./overlays/TerrainModOverlay.js";
import { drawVPHexes } from "./overlays/VPOverlay.js";

const CLICK_THRESHOLD = 5;
// Sub-tactical overlay threshold: if fine-to-strategic ratio is below this,
// render fine grid as base visual + strategic hex outlines on Canvas 2D.
// Above this ratio, use the atlas-based strategic renderer.
const SUB_TACTICAL_RATIO_LIMIT = 20;
const BG_COLOR = "#1A2535";

const MapView = forwardRef(function MapView({
  mapData,
  activeFeatures = null,    // Set of active feature names (null = all)
  showElevBands = false,    // toggle topographic elevation visualization
  units = null,              // array of unit objects (SimMap mode)
  actorColorMap = {},        // { actorId: "#color" }
  onCellClick = null,
  onCellHover = null,
  interactionMode = "navigate",
  selectedUnitId = null,
  ghostUnit = null,
  isSetupMode = false,
  unitOverlayOptions = null,    // { showFrontLines: bool, fowMode: {...} } passed to drawUnits
  cellSizeKm = null,            // km per hex — enables scale bar and distance labels
  movePath = null,               // array of {col, row} for route visualization during targeting
  proposedMoves = null,          // array of { from: "col,row", to: "col,row", color, unitName } for review phase
  fineMapData = null,            // fine-resolution hex data for atlas painting (dual-res mode)
  strategicGrid = null,          // from buildStrategicGrid() — enables strategic mode
  strategicMode = false,         // true = render strategic hexes, false = render fine hexes
  // Air overlays — optional, only passed from SimMap when air units are present
  airOverlayData = null,         // { adUnits, flightPaths, casSectors } for air viz
  // Confirmed-order overlays — ghosts + target rings during planning phase
  orderOverlayData = null,       // { ghosts: [...], rings: { "col,row": [...] } }
  // Terrain modifications overlay — smoke, fortifications, obstacles, bridge status
  terrainModsData = null,
  // Victory Point hex markers
  vpOverlayData = null,        // { hexVP: [...], vpControl: {...} }
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
  const elevRangeRef = useRef(null);
  const smoothedElevRef = useRef(null);
  const contourLabelRef = useRef(null);
  const elevBandsRef = useRef(null);
  const strategicReadyRef = useRef(false); // true when strategic data is uploaded to GPU
  const [hovCell, setHovCell] = useState(null);
  const [redrawTick, setRedrawTick] = useState(0);
  const rafRef = useRef(null);

  // Ruler measurement state (interactionMode === "measure")
  const [measureStart, setMeasureStart] = useState(null);
  const [measureEnd, setMeasureEnd] = useState(null);

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
      // Release large data structures held in refs
      preprocessedRef.current = { roadNetworks: null, nameGroups: null };
      elevRangeRef.current = null;
      smoothedElevRef.current = null;
      contourLabelRef.current = null;
      elevBandsRef.current = null;
    };
  }, []);

  // ── Upload map data to GPU ──
  useEffect(() => {
    if (!D || !D.cells || !rendererRef.current) return;

    // Generate illustrated tile atlas and upload map data with tile indices
    const atlasResult = generateTileAtlas(D);
    if (atlasResult) {
      rendererRef.current.uploadTileAtlas(atlasResult);
    }
    const uploadResult = rendererRef.current.uploadMapData(D, atlasResult?.tileIndexMap);

    // Compute elevation range for topo visualization
    elevRangeRef.current = computeElevationRange(D);

    // Capture smoothed elevation map for contour labels
    smoothedElevRef.current = uploadResult?.smoothedElevMap || null;

    // Preprocess roads and labels
    const roadNetworks = buildLinearNetworks(D.cells, cols, rows, D.linearPaths);
    const nameGroups = buildNameGroups(D.cells, cols, rows);
    preprocessedRef.current = { roadNetworks, nameGroups };

    // Upload road networks
    if (lineRendererRef.current) {
      lineRendererRef.current.uploadNetworks(roadNetworks, activeFeatures);
    }

    setRedrawTick(t => t + 1);
  }, [D, cols, rows]);

  // ── Upload strategic grid data + atlas when strategicGrid changes ──
  // fineMapData is used as the atlas source when available (dual-resolution mode),
  // otherwise falls back to D (display-resolution data, for single-resolution strategic)
  useEffect(() => {
    if (!strategicGrid || !D || !rendererRef.current) {
      strategicReadyRef.current = false;
      return;
    }

    const sourceData = fineMapData || D;
    const atlasResult = generateStrategicAtlas(sourceData, strategicGrid);
    rendererRef.current.uploadStrategicData(strategicGrid, atlasResult);
    strategicReadyRef.current = true;
    setRedrawTick(t => t + 1);
  }, [strategicGrid, D, fineMapData]);

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
  // useLayoutEffect fires synchronously after DOM mutations, so getBoundingClientRect()
  // returns the real container size rather than the initial containerSizeRef value (600x400).
  useLayoutEffect(() => {
    if (!cols || !rows) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    containerSizeRef.current = { w, h };
    viewportRef.current = createViewport(cols, rows, w, h);
    setRedrawTick(t => t + 1);
  }, [cols, rows]);

  // ── WebGL render — terrain + lines (does NOT depend on hovCell) ──
  useEffect(() => {
    if (!D || !rendererRef.current) return;
    const { w, h } = containerSizeRef.current;
    if (w <= 0 || h <= 0) return;

    const viewport = viewportRef.current;

    // Build elevation bands param if topo mode is on
    let elevBands = null;
    if (showElevBands && elevRangeRef.current) {
      const { min, max } = elevRangeRef.current;
      const range = max - min;
      const rawInterval = range / 10;
      const contourInterval = rawInterval > 200 ? Math.round(rawInterval / 100) * 100
        : rawInterval > 50 ? Math.round(rawInterval / 50) * 50
        : rawInterval > 10 ? Math.round(rawInterval / 10) * 10
        : Math.max(5, Math.round(rawInterval));
      elevBands = { min, max, contourInterval };

      // Build contour label data (cached — only rebuild when interval changes)
      if (smoothedElevRef.current && D?.cells &&
          (!contourLabelRef.current || contourLabelRef.current._interval !== contourInterval)) {
        contourLabelRef.current = buildContourLabelData(
          smoothedElevRef.current, D.cells, cols, rows, contourInterval
        );
        contourLabelRef.current._interval = contourInterval;
      }
    }
    elevBandsRef.current = elevBands;

    // Dispatch: strategic mode or fine (tactical) mode
    // Sub-tactical maps (low fine:strategic ratio) render the fine grid as
    // base visual and draw strategic hex outlines on Canvas 2D instead of
    // using the atlas approach which produces visual noise at small ratios.
    const fineSize = D.cellSizeKm || 1;
    const stratSize = strategicGrid?.cellSizeKm || fineSize;
    const sizeRatio = stratSize / fineSize;
    const useSubTacticalOverlay = strategicMode && strategicGrid && sizeRatio < SUB_TACTICAL_RATIO_LIMIT;

    if (strategicMode && strategicReadyRef.current && strategicGrid && !useSubTacticalOverlay) {
      let stratViewport;
      if (Math.abs(fineSize - stratSize) < 0.001) {
        // Dual-resolution mode: D IS already the strategic/display grid.
        // Viewport is in D's coords = strategic coords. No transform needed.
        stratViewport = viewport;
      } else {
        // Legacy mode: D is fine data, viewport is in fine grid coords.
        // Convert fine viewport → strategic grid viewport via pixel space.
        const fpx = fineSize * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
        const fpy = fineSize * 1.5 * viewport.centerRow;
        const stratRow = fpy / (stratSize * 1.5);
        const stratParity = Math.round(stratRow) & 1;
        const stratCol = fpx / (stratSize * SQRT3) - 0.5 * stratParity;
        stratViewport = {
          centerCol: stratCol - strategicGrid._colOffset,
          centerRow: stratRow - strategicGrid._rowOffset,
          cellPixels: viewport.cellPixels * (stratSize / fineSize),
        };
      }
      rendererRef.current.renderStrategic(stratViewport, w, h, activeFeatures, elevBands);
    } else {
      // Fine grid rendering (normal or sub-tactical overlay base)
      const visRange = getVisibleRange(viewport, w, h, cols, rows);
      rendererRef.current.render(viewport, w, h, activeFeatures, elevBands, visRange);
      if (lineRendererRef.current) {
        lineRendererRef.current.render(viewport, w, h);
      }
    }
  }, [D, redrawTick, cols, rows, activeFeatures, showElevBands, strategicMode, strategicGrid]);

  // ── Canvas 2D overlay — labels, units, selection, hover ──
  useEffect(() => {
    if (!D) return;
    const { w, h } = containerSizeRef.current;
    if (w <= 0 || h <= 0) return;
    const viewport = viewportRef.current;

    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
    }
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const cp = viewport.cellPixels;

    // Name labels
    if (preprocessedRef.current.nameGroups && cp >= 3) {
      drawNameLabels(ctx, viewport, w, h, preprocessedRef.current.nameGroups, cols, rows);
    }
    // Coordinate labels
    if (cp >= 6) {
      drawCoordLabels(ctx, viewport, w, h, cols, rows);
    }
    // Contour elevation labels (when topo mode is on)
    if (showElevBands && contourLabelRef.current && cp >= 6) {
      drawContourLabels(ctx, viewport, w, h, cols, rows, contourLabelRef.current);
    }
    // FOW overlay (semi-transparent tint on non-visible hexes)
    if (unitOverlayOptions?.fowMode?.visibleCells) {
      drawFowOverlay(ctx, unitOverlayOptions.fowMode, viewport, w, h, cols, rows);
    }
    // Strategic grid overlay (sub-tactical: thick game hex outlines over fine grid)
    if (strategicMode && strategicGrid) {
      const fSize = D.cellSizeKm || 1;
      const sSize = strategicGrid.cellSizeKm;
      if (sSize / fSize < SUB_TACTICAL_RATIO_LIMIT) {
        drawStrategicGridOverlay(ctx, strategicGrid, viewport, w, h, fSize);
      }
    }
    // Terrain modifications overlay (smoke, fortifications, obstacles, bridges)
    if (terrainModsData) {
      drawTerrainMods(ctx, terrainModsData, viewport, w, h, cols, rows);
    }
    // Victory Point + Critical VP hex markers
    if (vpOverlayData) {
      drawVPHexes(ctx, vpOverlayData.hexVP, vpOverlayData.vpControl, actorColorMap, viewport, w, h, cols, rows, vpOverlayData.cvpHexes);
    }

    // Air overlays (AD coverage, flight paths, CAS sectors) — drawn under units
    if (airOverlayData) {
      if (airOverlayData.adUnits) {
        drawADCoverage(ctx, airOverlayData.adUnits, actorColorMap, viewport, w, h, cols, rows);
      }
      if (airOverlayData.casSectors) {
        drawCASSectors(ctx, airOverlayData.casSectors, viewport, w, h, cols, rows);
      }
      if (airOverlayData.flightPaths) {
        drawFlightPaths(ctx, airOverlayData.flightPaths, viewport, w, h);
      }
    }

    // Confirmed-order overlays (movement ghosts + hex target rings)
    if (orderOverlayData) {
      drawOrderOverlay(ctx, orderOverlayData, actorColorMap, viewport, w, h, cols, rows);
    }

    // Units
    if (units || activeGhostUnit) {
      const drawOpts = isSetupMode
        ? { ghostUnit: activeGhostUnit, isSetupMode: true }
        : unitOverlayOptions || null;
      drawUnits(ctx, units, actorColorMap, viewport, w, h, cols, rows, drawOpts);
    }
    // Hover highlight
    if (hovCell) {
      drawHoverHighlight(ctx, viewport, w, h, hovCell.c, hovCell.r);
    }
    // Selection highlight
    if (selCell) {
      drawSelectionHighlight(ctx, viewport, w, h, selCell.c, selCell.r);
    }

    // Movement path visualization (during order targeting)
    if (movePath && movePath.length > 1) {
      drawMovePath(ctx, viewport, w, h, movePath);
    }

    // Proposed movement arrows (during adjudication review phase)
    if (proposedMoves && proposedMoves.length > 0) {
      drawProposedMoves(ctx, viewport, w, h, proposedMoves);
    }

    // ── Measurement overlays ──
    if (cellSizeKm) {
      drawScaleBar(ctx, cp, cellSizeKm, w, h);
    }
    if (measureStart && measureEnd && cellSizeKm) {
      const dist = hexDistance(measureStart.c, measureStart.r, measureEnd.c, measureEnd.r);
      const km = (dist * cellSizeKm).toFixed(1);
      drawMeasureLine(ctx, viewport, w, h, measureStart, measureEnd, `${dist} hex · ${km} km`);
    } else if (measureStart && hovCell && interactionMode === "measure" && cellSizeKm) {
      const dist = hexDistance(measureStart.c, measureStart.r, hovCell.c, hovCell.r);
      const km = (dist * cellSizeKm).toFixed(1);
      drawMeasureLine(ctx, viewport, w, h, measureStart, hovCell, `${dist} hex · ${km} km`);
    }
    if (selCell && hovCell && cellSizeKm && interactionMode !== "measure") {
      const dist = hexDistance(selCell.c, selCell.r, hovCell.c, hovCell.r);
      if (dist > 0) {
        const km = (dist * cellSizeKm).toFixed(1);
        drawHoverDistance(ctx, viewport, w, h, selCell, hovCell, `${dist} hex · ${km} km`);
      }
    }
  }, [D, units, hovCell, selCell, activeGhostUnit, redrawTick, cols, rows, actorColorMap, isSetupMode, activeFeatures, showElevBands, cellSizeKm, measureStart, measureEnd, interactionMode, unitOverlayOptions, movePath, proposedMoves, airOverlayData, orderOverlayData, terrainModsData, vpOverlayData]);

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
      // Measure mode: first click sets start, second sets end, third resets
      if (interactionMode === "measure") {
        if (!measureStart) {
          setMeasureStart(down.cell);
          setMeasureEnd(null);
        } else if (!measureEnd) {
          setMeasureEnd(down.cell);
        } else {
          // Third click: reset and start new measurement
          setMeasureStart(down.cell);
          setMeasureEnd(null);
        }
        return;
      }
      onCellClick?.(down.cell, e);
    }
  }, [onCellClick, interactionMode, measureStart, measureEnd]);

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
      const renderer = rendererRef.current;
      const mmViewport = {
        centerCol: cols / 2,
        centerRow: rows / 2,
        cellPixels: Math.min(mw / (cols + 0.5), mh / (rows * 1.5 / SQRT3 + 0.5 / SQRT3)) * 0.95,
      };
      // Minimap: use strategic render if active, otherwise normal
      if (strategicMode && strategicReadyRef.current && strategicGrid) {
        renderer.renderStrategic(mmViewport, mw, mh, activeFeatures);
      } else {
        renderer.render(mmViewport, mw, mh, activeFeatures);
      }
      minimapCtx.drawImage(renderer.gl.canvas, 0, 0, mw, mh);
      // Restore main viewport — must use the same render path as the main effect
      const { w, h } = containerSizeRef.current;
      if (strategicMode && strategicReadyRef.current && strategicGrid) {
        const vp = viewportRef.current;
        const fineSize = D.cellSizeKm || 1;
        const stratSize = strategicGrid.cellSizeKm;
        let stratVP;
        if (Math.abs(fineSize - stratSize) < 0.001) {
          stratVP = vp;
        } else {
          const fpx = fineSize * SQRT3 * (vp.centerCol + 0.5 * (Math.round(vp.centerRow) & 1));
          const fpy = fineSize * 1.5 * vp.centerRow;
          const sRow = fpy / (stratSize * 1.5);
          const sCol = fpx / (stratSize * SQRT3) - 0.5 * (Math.round(sRow) & 1);
          stratVP = {
            centerCol: sCol - strategicGrid._colOffset,
            centerRow: sRow - strategicGrid._rowOffset,
            cellPixels: vp.cellPixels * (stratSize / fineSize),
          };
        }
        renderer.renderStrategic(stratVP, w, h, activeFeatures, elevBandsRef.current);
      } else {
        renderer.render(viewportRef.current, w, h, activeFeatures, elevBandsRef.current);
        if (lineRendererRef.current) {
          lineRendererRef.current.render(viewportRef.current, w, h);
        }
      }
    },
    // For PNG export — passes elevBands so topo mode exports correctly
    renderExport: (exportWidth, exportHeight) => {
      if (!D || !rendererRef.current) return null;
      const renderer = rendererRef.current;
      const exportCellSize = 28;
      const exportViewport = {
        centerCol: cols / 2,
        centerRow: rows / 2,
        cellPixels: exportCellSize,
      };
      renderer.render(exportViewport, exportWidth, exportHeight, activeFeatures, elevBandsRef.current);
      if (lineRendererRef.current) {
        lineRendererRef.current.render(exportViewport, exportWidth, exportHeight);
      }
      return renderer.gl.canvas;
    },
    // Export with elevation always on (regardless of current showElevBands toggle)
    renderExportElev: (exportWidth, exportHeight) => {
      if (!D || !rendererRef.current || !elevRangeRef.current) return null;
      const renderer = rendererRef.current;
      const exportCellSize = 28;
      const exportViewport = {
        centerCol: cols / 2,
        centerRow: rows / 2,
        cellPixels: exportCellSize,
      };
      // Force elevation bands on for this render
      const { min, max } = elevRangeRef.current;
      const range = max - min;
      const rawInterval = range / 10;
      const contourInterval = rawInterval > 200 ? Math.round(rawInterval / 100) * 100
        : rawInterval > 50 ? Math.round(rawInterval / 50) * 50
        : rawInterval > 10 ? Math.round(rawInterval / 10) * 10
        : Math.max(5, Math.round(rawInterval));
      const forceElevBands = { min, max, contourInterval };
      renderer.render(exportViewport, exportWidth, exportHeight, activeFeatures, forceElevBands);
      if (lineRendererRef.current) {
        lineRendererRef.current.render(exportViewport, exportWidth, exportHeight);
      }
      return renderer.gl.canvas;
    },
    forceRedraw: () => setRedrawTick(t => t + 1),
    clearMeasure: () => { setMeasureStart(null); setMeasureEnd(null); },
    // Composite WebGL + overlay into a single PNG data URL
    exportImage: () => {
      const gl = glCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!gl || !overlay) return null;
      const composite = document.createElement("canvas");
      composite.width = gl.width;
      composite.height = gl.height;
      const cctx = composite.getContext("2d");
      cctx.drawImage(gl, 0, 0);
      cctx.drawImage(overlay, 0, 0);
      const dataUrl = composite.toDataURL("image/png");
      // Release GPU-backed bitmap immediately instead of waiting for GC
      composite.width = 0;
      composite.height = 0;
      return dataUrl;
    },
  }), [D, cols, rows, activeFeatures, showElevBands, strategicMode, strategicGrid]);

  // Cursor
  const getCursor = () => {
    if (dragRef.current) return "grabbing";
    if (interactionMode === "place_unit") return "copy";
    if (interactionMode === "measure") return "crosshair";
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

// ── Measurement drawing helpers ──────────────────────────────

/**
 * Draw a movement path as an amber dashed line through hex centers.
 * Shows intermediate waypoints as dots and a larger dot at the destination.
 */
function drawMovePath(ctx, viewport, w, h, path) {
  ctx.save();

  // Convert hex coords to screen positions
  const points = path.map(p => hexToScreen(p.col, p.row, viewport, w, h));

  // Dashed connecting line
  ctx.strokeStyle = "rgba(245, 158, 11, 0.7)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Intermediate waypoint dots
  ctx.fillStyle = "rgba(245, 158, 11, 0.5)";
  for (let i = 1; i < points.length - 1; i++) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Destination marker (larger, brighter)
  if (points.length >= 2) {
    const dest = points[points.length - 1];
    ctx.fillStyle = "rgba(245, 158, 11, 0.85)";
    ctx.beginPath();
    ctx.arc(dest.x, dest.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 158, 11, 1)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw proposed movement arrows during adjudication review phase.
 * Each proposed move is rendered as a dashed arrow from current position to proposed position.
 *
 * @param {Array} moves - [{ from: "col,row", to: "col,row", color: "#hex", unitName: "..." }]
 */
function drawProposedMoves(ctx, viewport, w, h, moves) {
  ctx.save();

  for (const move of moves) {
    // Parse positions
    const fromMatch = move.from?.match(/^(\d+),(\d+)$/);
    const toMatch = move.to?.match(/^(\d+),(\d+)$/);
    if (!fromMatch || !toMatch) continue;

    const fromPt = hexToScreen(parseInt(fromMatch[1]), parseInt(fromMatch[2]), viewport, w, h);
    const toPt = hexToScreen(parseInt(toMatch[1]), parseInt(toMatch[2]), viewport, w, h);

    const color = move.color || "rgba(245, 158, 11, 0.7)";

    // Dashed line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(fromPt.x, fromPt.y);
    ctx.lineTo(toPt.x, toPt.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead at destination
    const angle = Math.atan2(toPt.y - fromPt.y, toPt.x - fromPt.x);
    const arrowSize = Math.max(6, viewport.cellPixels * 0.15);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toPt.x, toPt.y);
    ctx.lineTo(
      toPt.x - arrowSize * Math.cos(angle - Math.PI / 6),
      toPt.y - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toPt.x - arrowSize * Math.cos(angle + Math.PI / 6),
      toPt.y - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    // Unit name label near the midpoint (if zoomed in enough)
    if (move.unitName && viewport.cellPixels >= 30) {
      const mx = (fromPt.x + toPt.x) / 2;
      const my = (fromPt.y + toPt.y) / 2 - 8;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = `${Math.max(8, viewport.cellPixels * 0.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      // Background for readability
      const textW = ctx.measureText(move.unitName).width;
      ctx.fillRect(mx - textW / 2 - 2, my - 10, textW + 4, 12);
      ctx.fillStyle = "#FFF";
      ctx.fillText(move.unitName, mx, my);
    }
  }

  ctx.restore();
}


/**
 * Draw a scale bar in the bottom-left corner of the overlay canvas.
 * Picks the largest round km distance that fits in ~120-200px.
 */
function drawScaleBar(ctx, cellPixels, cellSizeKm, w, h) {
  // Hex width in pixels = cellPixels (by definition — cellPixels is the flat-to-flat width)
  // One hex = cellSizeKm km, so 1km = cellPixels / cellSizeKm pixels
  const pxPerKm = cellPixels / cellSizeKm;

  // Pick a nice round distance that fits in 80-200px
  const niceValues = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let barKm = niceValues[0];
  for (const v of niceValues) {
    const px = v * pxPerKm;
    if (px >= 60 && px <= 200) { barKm = v; break; }
    if (px < 60) barKm = v; // keep advancing until we overshoot
  }

  const barPx = barKm * pxPerKm;
  if (barPx < 10 || barPx > w * 0.5) return; // don't draw if too small or too large

  const x0 = 16;
  const y0 = h - 20;
  const tickH = 6;

  // Bar background for contrast
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x0 - 4, y0 - tickH - 14, barPx + 8, tickH + 22);

  // Bar line
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + barPx, y0);
  // End ticks
  ctx.moveTo(x0, y0 - tickH);
  ctx.lineTo(x0, y0 + tickH);
  ctx.moveTo(x0 + barPx, y0 - tickH);
  ctx.lineTo(x0 + barPx, y0 + tickH);
  ctx.stroke();

  // Label
  const label = barKm >= 1 ? `${barKm} km` : `${barKm * 1000} m`;
  ctx.font = "bold 10px monospace";
  ctx.fillStyle = "#E5E7EB";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x0 + barPx / 2, y0 - tickH - 2);
}

/**
 * Draw a dashed line between two hex cells with a distance label.
 */
function drawMeasureLine(ctx, viewport, w, h, from, to, label) {
  const p1 = hexToScreen(from.c, from.r, viewport, w, h);
  const p2 = hexToScreen(to.c, to.r, viewport, w, h);

  // Dashed line
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label at midpoint
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  ctx.font = "bold 11px monospace";
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(mx - textW / 2 - 4, my - 18, textW + 8, 20);
  ctx.fillStyle = "#F59E0B";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, mx, my - 8);

  // Start/end markers
  ctx.fillStyle = "#F59E0B";
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
  ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a faint dashed line from selected unit to hovered cell with distance label.
 */
function drawHoverDistance(ctx, viewport, w, h, from, to, label) {
  const p1 = hexToScreen(from.c, from.r, viewport, w, h);
  const p2 = hexToScreen(to.c, to.r, viewport, w, h);

  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Small label near the hovered cell
  ctx.font = "10px monospace";
  const textW = ctx.measureText(label).width;
  const lx = p2.x + 10;
  const ly = p2.y - 10;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(lx - 2, ly - 10, textW + 4, 14);
  ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, lx, ly - 3);
  ctx.restore();
}

export default MapView;
