import { useState, useRef, useEffect, useCallback } from "react";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Badge, Panel } from "./components/ui.jsx";
import { TC, TL, FC, FL, FG, DEFAULT_FEATURES } from "./terrainColors.js";
import MapRenderer from "./mapRenderer/MapRenderer.js";
import { buildLinearNetworks } from "./mapRenderer/RoadNetwork.js";
import { buildNameGroups } from "./mapRenderer/overlays/LabelOverlay.js";
import {
  createViewport, screenToCell, zoomAtPoint, panViewport,
  clampCellPixels, ZOOM_FACTOR, MIN_CELL_PIXELS, MAX_CELL_PIXELS, getTier,
} from "./mapRenderer/ViewportState.js";
import { cellPixelsToHexSize, SQRT3 } from "./mapRenderer/HexMath.js";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

function colLbl(c){let s="",n=c;do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
function cellCoord(c,r){return colLbl(c)+(r+1);}
function getFeats(cell){
  if(!cell) return [];
  if(cell.features && cell.features.length>0) return cell.features;
  if(cell.attributes && cell.attributes.length>0) return cell.attributes;
  return [];
}

const TIER_NAMES = ["Strategic", "Operational", "Tactical", "Close-up"];

// ═══════════════════════════════════════════════════════════════
// VIEWER COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Viewer({ onBack, initialData }) {
  const [D, setD] = useState(null); // map data
  const [sel, setSel] = useState(null); // "c,r"
  const [hov, setHov] = useState(null); // "c,r"
  const [af, setAf] = useState(new Set()); // active features
  const [fcts, setFcts] = useState({}); // feature counts
  const [redrawTick, setRedrawTick] = useState(0);
  const [savedFiles, setSavedFiles] = useState([]);

  const canvasRef = useRef(null);
  const mmRef = useRef(null);
  const vpRef = useRef(null); // viewport DOM container
  const viewportRef = useRef({ centerCol: 0, centerRow: 0, cellPixels: 16 }); // viewport state
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const rendererRef = useRef(new MapRenderer());
  const preprocessedRef = useRef({ roadNetworks: null, nameGroups: null });
  const containerSizeRef = useRef({ w: 800, h: 600 });

  // Zoom animation state
  const animRef = useRef({ active: false, from: 0, to: 0, pivotCol: 0, pivotRow: 0, startTime: 0, duration: 150 });

  // ── Load data ──
  const loadMapData = useCallback((mapData) => {
    const counts = {};
    for (const k in mapData.cells) {
      getFeats(mapData.cells[k]).forEach(f => { counts[f] = (counts[f] || 0) + 1; });
    }
    setFcts(counts);
    setAf(new Set(DEFAULT_FEATURES.filter(f => counts[f])));
    setD(mapData);
    setSel(null);
    setHov(null);

    // Preprocess road networks and name groups
    preprocessedRef.current = {
      roadNetworks: buildLinearNetworks(mapData.cells, mapData.cols, mapData.rows),
      nameGroups: buildNameGroups(mapData.cells, mapData.cols, mapData.rows),
    };

    // Invalidate tile cache
    rendererRef.current.invalidateAll();

    // Auto-fit viewport
    const vp = vpRef.current;
    if (vp) {
      const w = vp.clientWidth || 800;
      const h = vp.clientHeight || 600;
      containerSizeRef.current = { w, h };
      viewportRef.current = createViewport(mapData.cols, mapData.rows, w, h);
    }
    setRedrawTick(t => t + 1);
  }, []);

  // Load initialData on mount
  useEffect(() => {
    if (initialData) loadMapData(initialData);
  }, [initialData, loadMapData]);

  // Fetch saved files list
  useEffect(() => {
    fetch("/api/saves").then(r => r.json()).then(setSavedFiles).catch(() => {});
  }, [D]);

  const loadSaved = useCallback((filename) => {
    fetch(`/api/load?file=${encodeURIComponent(filename)}`)
      .then(r => r.json())
      .then(json => {
        const mapData = json.map || json;
        if (!mapData.cells || !mapData.cols) { alert("Invalid save file"); return; }
        loadMapData(mapData);
      })
      .catch(err => alert("Failed to load: " + err.message));
  }, [loadMapData]);

  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        const mapData = json.map || json;
        if (!mapData.cells || !mapData.cols) { alert("Invalid terrain JSON"); return; }
        loadMapData(mapData);
      } catch (err) { alert("Failed to parse JSON: " + err.message); }
    };
    reader.readAsText(file);
  }, [loadMapData]);

  // ── Observe container resize ──
  useEffect(() => {
    const el = vpRef.current;
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

  // ── Invalidate tiles when feature filters change ──
  useEffect(() => {
    rendererRef.current.invalidateAll();
  }, [af]);

  // ── Drawing ──
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !D) return;
    const { w, h } = containerSizeRef.current;
    if (w <= 0 || h <= 0) return;

    // Size canvas to container
    if (cv.width !== Math.round(w) || cv.height !== Math.round(h)) {
      cv.width = Math.round(w);
      cv.height = Math.round(h);
    }
    const ctx = cv.getContext("2d");
    const viewport = viewportRef.current;

    // Parse hover/selection to {c,r} objects
    const hovCell = hov ? (() => { const [c, r] = hov.split(",").map(Number); return { c, r }; })() : null;
    const selCell = sel ? (() => { const [c, r] = sel.split(",").map(Number); return { c, r }; })() : null;

    // Render via MapRenderer
    rendererRef.current.render(ctx, cv.width, cv.height, viewport, D, {
      activeFeatures: af,
      roadNetworks: preprocessedRef.current.roadNetworks,
      nameGroups: preprocessedRef.current.nameGroups,
      hovCell,
      selCell,
      skipLabels: animRef.current.active,
    });

    // Minimap
    drawMinimap();
  }, [D, af, hov, sel, redrawTick]);

  const drawMinimap = useCallback(() => {
    const mc = mmRef.current;
    if (!mc || !D) return;
    const maxDim = 150;
    const ratio = D.rows / D.cols;
    const mw = ratio > 1 ? Math.round(maxDim / ratio) : maxDim;
    const mh = ratio > 1 ? maxDim : Math.round(maxDim * ratio);
    if (mc.width !== mw || mc.height !== mh) {
      mc.width = mw; mc.height = mh;
    }
    const ctx = mc.getContext("2d");
    const { w, h } = containerSizeRef.current;
    rendererRef.current.renderMinimap(ctx, mw, mh, viewportRef.current, D, w, h);
  }, [D]);

  // Set up re-render callback for progressive tile loading
  useEffect(() => {
    rendererRef.current.onNeedsRerender = () => setRedrawTick(t => t + 1);
    return () => { rendererRef.current.onNeedsRerender = null; };
  }, []);

  useEffect(() => { draw(); }, [draw]);

  // ── Zoom animation loop (hex-aware) ──
  const animateZoom = useCallback(() => {
    const a = animRef.current;
    if (!a.active) return;
    const now = performance.now();
    const t = Math.min(1, (now - a.startTime) / a.duration);
    const eased = t * (2 - t); // ease-out quadratic

    const newCellPixels = clampCellPixels(a.from + (a.to - a.from) * eased);
    const { w, h } = containerSizeRef.current;

    // Keep the world pixel under the cursor at the same screen position.
    // a.wx, a.wy were computed at the OLD hex size; world pixels scale
    // linearly with size, so rescale them to the NEW size first.
    const newSize = cellPixelsToHexSize(newCellPixels);
    const oldSize = cellPixelsToHexSize(a.from);
    const scale = newSize / oldSize;
    const newCpx = a.wx * scale - (a.sx - w / 2);
    const newCpy = a.wy * scale - (a.sy - h / 2);
    const newCenterRow = newCpy / (newSize * 1.5);
    const parity = Math.round(newCenterRow) & 1;
    const newCenterCol = newCpx / (newSize * SQRT3) - 0.5 * parity;

    viewportRef.current = {
      centerCol: newCenterCol,
      centerRow: newCenterRow,
      cellPixels: newCellPixels,
    };

    setRedrawTick(tick => tick + 1);

    if (t < 1) {
      requestAnimationFrame(animateZoom);
    } else {
      a.active = false;
      setRedrawTick(tick => tick + 1); // final render with labels
    }
  }, []);

  // ── Event handlers ──
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!D) return;
    const vp = vpRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    const viewport = viewportRef.current;
    const targetCellPixels = clampCellPixels(viewport.cellPixels * factor);

    // Compute world pixel under cursor for pivot (hex-aware)
    const size = cellPixelsToHexSize(viewport.cellPixels);
    const cpx = size * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
    const cpy = size * 1.5 * viewport.centerRow;
    const wx = mx - w / 2 + cpx;
    const wy = my - h / 2 + cpy;

    // Start or update zoom animation
    const a = animRef.current;
    a.from = viewport.cellPixels;
    a.to = targetCellPixels;
    a.wx = wx;
    a.wy = wy;
    a.sx = mx;
    a.sy = my;
    a.startTime = performance.now();
    a.duration = 120;
    if (!a.active) {
      a.active = true;
      requestAnimationFrame(animateZoom);
    }
  }, [D, animateZoom]);

  const handleMouseDown = useCallback((e) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!D) return;
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      viewportRef.current = panViewport(viewportRef.current, dx, dy);
      setRedrawTick(t => t + 1);
    } else {
      const rect = vpRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { w, h } = containerSizeRef.current;
      const cell = screenToCell(mx, my, viewportRef.current, w, h, D.cols, D.rows);
      const k = cell ? `${cell.c},${cell.r}` : null;
      if (k !== hov) setHov(k);
    }
  }, [D, hov]);

  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  const handleClick = useCallback((e) => {
    if (!D) return;
    const rect = vpRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = containerSizeRef.current;
    const cell = screenToCell(mx, my, viewportRef.current, w, h, D.cols, D.rows);
    if (cell) {
      const k = `${cell.c},${cell.r}`;
      if (D.cells[k]) setSel(prev => prev === k ? null : k);
    }
  }, [D]);

  // Minimap click-to-navigate
  const handleMinimapClick = useCallback((e) => {
    if (!D) return;
    const mc = mmRef.current;
    if (!mc) return;
    const rect = mc.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const col = (mx / mc.width) * D.cols;
    const row = (my / mc.height) * D.rows;
    viewportRef.current = { ...viewportRef.current, centerCol: col, centerRow: row };
    setRedrawTick(t => t + 1);
  }, [D]);

  // Wheel event listener (passive: false for preventDefault)
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const handler = (e) => { e.preventDefault(); handleWheel(e); };
    vp.addEventListener("wheel", handler, { passive: false });
    return () => vp.removeEventListener("wheel", handler);
  }, [handleWheel]);

  // ── Filter helpers ──
  const toggleFeat = useCallback((f) => { setAf(prev => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; }); }, []);
  const toggleAll = useCallback((on) => { if (!on) setAf(new Set()); else setAf(new Set(Object.keys(fcts))); }, [fcts]);
  const toggleGroup = useCallback((group) => {
    const items = (FG[group] || []).filter(f => fcts[f]);
    setAf(prev => {
      const n = new Set(prev);
      const allOn = items.every(f => n.has(f));
      items.forEach(f => { if (allOn) n.delete(f); else n.add(f); });
      return n;
    });
  }, [fcts]);

  // ── Export PNG ──
  const exportPNG = useCallback(() => {
    if (!D) return;
    const renderer = rendererRef.current;
    const offscreen = renderer.renderExport(D, af, preprocessedRef.current.roadNetworks, preprocessedRef.current.nameGroups);
    // Convert OffscreenCanvas to downloadable PNG
    const cv = document.createElement("canvas");
    cv.width = offscreen.width;
    cv.height = offscreen.height;
    cv.getContext("2d").drawImage(offscreen, 0, 0);
    const a = document.createElement("a");
    a.download = `oc_map_${D.cols}x${D.rows}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  }, [D, af]);

  // ── Export LLM text ──
  const exportLLM = useCallback(() => {
    if (!D) return;
    const TK = { deep_water:"DW",coastal_water:"CW",lake:"LK",river:"RV",wetland:"WL",open_ground:"OG",light_veg:"LV",farmland:"FM",forest:"FR",dense_forest:"DF",highland:"HL",mountain_forest:"MF",mountain:"MT",peak:"PK",desert:"DS",ice:"IC",light_urban:"LU",dense_urban:"DU" };
    const lines = [];
    lines.push("# TERRAIN MAP");
    lines.push(`# ${D.cols}\u00D7${D.rows} cells, ${D.cellSizeKm}km/cell`);
    if (D.center) lines.push(`# Center: ${D.center.lat.toFixed(4)}, ${D.center.lng.toFixed(4)}`);
    if (D.bbox) lines.push(`# Bounds: S${D.bbox.south.toFixed(4)} N${D.bbox.north.toFixed(4)} W${D.bbox.west.toFixed(4)} E${D.bbox.east.toFixed(4)}`);
    lines.push("");
    lines.push("## TERRAIN CODES");
    Object.entries(TK).forEach(([k, v]) => { lines.push(`# ${v} = ${TL[k] || k}`); });
    lines.push("");
    lines.push("## TERRAIN GRID (row 1=north, left=west)");
    for (let r = 0; r < D.rows; r++) {
      const rowCodes = [];
      for (let c = 0; c < D.cols; c++) { const cell = D.cells[`${c},${r}`]; rowCodes.push(cell ? (TK[cell.terrain] || "??") : ".."); }
      lines.push(`${String(r + 1).padStart(3)}| ${rowCodes.join(" ")}`);
    }
    lines.push("");
    lines.push("## ELEVATION (meters, cells >50m only)");
    const elevEntries = [];
    for (let r = 0; r < D.rows; r++) for (let c = 0; c < D.cols; c++) { const cell = D.cells[`${c},${r}`]; if (cell && cell.elevation > 50) elevEntries.push(`${cellCoord(c, r)}:${cell.elevation}m`); }
    for (let i = 0; i < elevEntries.length; i += 12) lines.push(elevEntries.slice(i, i + 12).join("  "));
    lines.push("");
    lines.push("## FEATURES (per cell)");
    for (let r = 0; r < D.rows; r++) for (let c = 0; c < D.cols; c++) {
      const cell = D.cells[`${c},${r}`]; if (!cell) continue;
      const feats = getFeats(cell); const fn = cell.feature_names || {};
      if (feats.length === 0 && !cell.feature_names) continue;
      const parts = feats.map(f => { const nm = fn[f]; return nm ? `${f}(${nm})` : f; });
      if (fn[cell.terrain] && !feats.includes(cell.terrain)) parts.unshift(`[${cell.terrain}:${fn[cell.terrain]}]`);
      if (fn.settlement && !fn[cell.terrain]) parts.unshift(`[${fn.settlement}]`);
      if (parts.length > 0) lines.push(`${cellCoord(c, r)}: ${parts.join(", ")}`);
    }
    lines.push("");
    lines.push("## SUMMARY");
    const terrCt = {}; for (const k in D.cells) { const t = D.cells[k].terrain; terrCt[t] = (terrCt[t] || 0) + 1; }
    const total = Object.values(terrCt).reduce((s, v) => s + v, 0);
    Object.entries(terrCt).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => lines.push(`# ${(TL[t] || t).padEnd(16)} ${n} cells (${((n / total) * 100).toFixed(1)}%)`));
    lines.push(""); lines.push("## FEATURE COUNTS");
    Object.entries(fcts).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => lines.push(`# ${(FL[f] || f).padEnd(20)} ${n} cells`));
    // Named features summary
    const nameIdx = {};
    for (const k in D.cells) { const fn = D.cells[k].feature_names; if (!fn) continue; for (const [type, name] of Object.entries(fn)) { if (!nameIdx[type]) nameIdx[type] = {}; if (!nameIdx[type][name]) nameIdx[type][name] = []; nameIdx[type][name].push(k); } }
    if (Object.keys(nameIdx).length > 0) {
      lines.push(""); lines.push("## NAMED FEATURES");
      for (const [type, names] of Object.entries(nameIdx)) for (const [name, cells] of Object.entries(names).sort((a, b) => b[1].length - a[1].length)) {
        const coords = cells.map(k => { const [c, r] = k.split(",").map(Number); return cellCoord(c, r); });
        lines.push(`# ${type}: ${name} \u2014 ${coords.length} cells (${coords.slice(0, 8).join(", ")}${coords.length > 8 ? ", ..." : ""})`);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a"); a.download = `oc_map_${D.cols}x${D.rows}_llm.txt`; a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
  }, [D, fcts]);

  // ── Cell info ──
  const infoCell = sel || hov;
  const cellData = infoCell && D ? D.cells[infoCell] : null;

  // Current tier name for display
  const currentTier = D ? getTier(viewportRef.current.cellPixels) : 0;
  const zoomPercent = D ? Math.round(viewportRef.current.cellPixels / 28 * 100) : 100;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  // Upload screen
  if (!D) {
    return (
      <div style={{
        background: colors.bg.base,
        height: "100%",
        color: colors.text.primary,
        fontFamily: typography.fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "fadeIn 0.4s ease-out",
      }}>
        {/* Upload icon */}
        <div style={{ marginBottom: space[4], color: colors.accent.blue, opacity: 0.6 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </div>

        <div style={{ fontSize: typography.heading.lg, fontWeight: typography.weight.heavy, marginBottom: space[1] }}>Map Viewer</div>
        <div style={{ fontSize: typography.body.md, color: colors.text.muted, marginBottom: space[6] }}>Load a terrain JSON export or select a saved map</div>

        {/* Upload drop zone */}
        <label style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          width: 400, padding: `${space[6]}px ${space[8]}px`,
          borderRadius: radius.xl,
          border: `2px dashed ${colors.border.default}`,
          background: colors.bg.raised,
          cursor: "pointer",
          transition: `all ${animation.normal} ${animation.easeOut}`,
          marginBottom: space[6],
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue; e.currentTarget.style.background = colors.bg.surface; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.default; e.currentTarget.style.background = colors.bg.raised; }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.accent.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: space[2] }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: typography.body.md, fontWeight: typography.weight.semibold, color: colors.accent.blue }}>
            Load JSON File
          </span>
          <span style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1] }}>
            Click to browse or drag &amp; drop
          </span>
          <input type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
        </label>

        {/* Saved files */}
        {savedFiles.length > 0 && (
          <div style={{ width: 440, maxHeight: 320, overflowY: "auto", animation: "slideUp 0.4s ease-out 0.1s both" }}>
            <div style={{
              fontSize: typography.body.xs, color: colors.text.muted, fontWeight: typography.weight.bold,
              letterSpacing: typography.letterSpacing.wider, marginBottom: space[2], textTransform: "uppercase",
            }}>
              Saved Maps
            </div>
            {savedFiles.map((f, i) => {
              const sizeMB = (f.size / 1024 / 1024).toFixed(1);
              const date = new Date(f.modified);
              const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const display = f.name.replace(/\.json$/, "").replace(/_/g, " ").replace(/ (\d{4}) (\d{2}) (\d{2})$/, "");
              return (
                <div key={f.name} onClick={() => loadSaved(f.name)}
                  style={{
                    padding: `${space[2]}px ${space[3]}px`,
                    borderRadius: radius.md,
                    cursor: "pointer",
                    background: colors.bg.raised,
                    border: `1px solid ${colors.border.subtle}`,
                    marginBottom: space[1],
                    transition: `all ${animation.fast}`,
                    animation: `slideUp 0.3s ease-out ${0.05 * i}s both`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue + "60"; e.currentTarget.style.background = colors.bg.surface; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.subtle; e.currentTarget.style.background = colors.bg.raised; }}
                >
                  <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.semibold, color: colors.text.primary, marginBottom: 2 }}>{display}</div>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{dateStr} · {sizeMB} MB</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Map view
  return (
    <div style={{
      background: colors.bg.base,
      width: "100%",
      height: "100%",
      overflow: "hidden",
      position: "relative",
      fontFamily: typography.fontFamily,
      color: colors.text.primary,
    }}>
      {/* Viewport */}
      <div ref={vpRef} style={{ width: "100%", height: "100%", cursor: dragRef.current.active ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onClick={handleClick}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      </div>

      {/* Top bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        padding: `${space[1] + 2}px ${space[3]}px`,
        background: colors.bg.overlay,
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
          <span style={{ fontSize: typography.body.md, fontWeight: typography.weight.bold }}>Map Viewer</span>
          <Badge color={colors.accent.cyan}>{D.cols}&times;{D.rows}</Badge>
          <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{D.cellSizeKm}km/cell</span>
        </div>
        <div style={{ display: "flex", gap: space[1] + 2 }}>
          <Button variant="secondary" size="sm" onClick={exportPNG}>PNG</Button>
          <Button variant="secondary" size="sm" onClick={exportLLM}>LLM Export</Button>
          <label>
            <Button variant="secondary" size="sm" as="span" style={{ cursor: "pointer" }}
              onClick={() => {/* label handles click */}}>
              Load
            </Button>
            <input type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Info Panel */}
      <Panel style={{
        position: "absolute", top: 48, left: space[3], width: 230,
        maxHeight: "50vh", overflowY: "auto", padding: space[2] + 2,
        animation: "fadeIn 0.3s ease-out",
      }}>
        <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.text.muted, marginBottom: space[1], letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase" }}>
          Cell Info
        </div>
        {cellData ? (() => {
          const [c, r] = (infoCell).split(",").map(Number);
          const feats = getFeats(cellData);
          const fn = cellData.feature_names || {};
          const tc = TC[cellData.terrain] || "#333";
          const terrainName = fn[cellData.terrain] || fn.settlement || "";
          return (<>
            <div style={{ fontWeight: typography.weight.bold, fontSize: typography.heading.md, marginBottom: 2 }}>{cellCoord(c, r)}</div>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2] }}>
              {cellData.elevation !== undefined ? cellData.elevation + "m" : ""} · [{c},{r}]
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: space[2] }}>
              <div style={{ width: 12, height: 12, borderRadius: radius.sm, background: tc, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
              <span style={{ fontWeight: typography.weight.semibold, fontSize: typography.body.sm }}>{TL[cellData.terrain] || cellData.terrain}</span>
              {terrainName && <span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold, fontSize: typography.body.sm }}> — {terrainName}</span>}
            </div>
            {feats.length > 0 && (
              <div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1] }}>Features ({feats.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {feats.map(f => {
                    const col = FC[f] || "#666";
                    const nm = fn[f];
                    return (
                      <span key={f} style={{
                        fontSize: typography.body.xs, padding: "2px 5px", borderRadius: radius.sm,
                        background: `${col}18`, color: col, border: `1px solid ${col}40`,
                        lineHeight: 1, display: "inline-flex", alignItems: "center",
                      }}>
                        {FL[f] || f}{nm ? ` (${nm})` : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </>);
        })() : (
          <div style={{ color: colors.text.muted, fontSize: typography.body.sm, display: "flex", alignItems: "center", gap: space[1], padding: `${space[2]}px 0` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="22" y1="2" x2="2" y2="22" />
            </svg>
            Hover over a cell
          </div>
        )}
      </Panel>

      {/* Filter Panel */}
      <Panel style={{
        position: "absolute", top: 48, right: space[3], width: 230,
        maxHeight: "80vh", overflowY: "auto", padding: space[2] + 2,
        animation: "fadeIn 0.3s ease-out 0.1s both",
      }}>
        <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.text.muted, marginBottom: space[1], letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase" }}>
          Features
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: space[2] }}>
          <FilterChip label="All On" onClick={() => toggleAll(true)} />
          <FilterChip label="All Off" onClick={() => toggleAll(false)} />
          {Object.keys(FG).map(g => <FilterChip key={g} label={g} onClick={() => toggleGroup(g)} />)}
        </div>
        {Object.entries(FG).map(([group, items]) => {
          const present = items.filter(f => fcts[f]);
          if (present.length === 0) return null;
          return (
            <div key={group} style={{ marginBottom: space[2] }}>
              <div onClick={() => toggleGroup(group)} style={{
                fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.text.muted,
                cursor: "pointer", marginBottom: space[1], letterSpacing: typography.letterSpacing.wide,
                display: "flex", alignItems: "center", gap: space[1],
              }}>
                <div style={{ width: 2, height: 10, borderRadius: 1, background: colors.accent.blue, flexShrink: 0 }} />
                {group}
              </div>
              {present.map(f => {
                const on = af.has(f);
                const col = FC[f] || "#666";
                return (
                  <div key={f} onClick={() => toggleFeat(f)} style={{
                    display: "flex", alignItems: "center", gap: space[1],
                    padding: "2px 0", cursor: "pointer",
                    opacity: on ? 1 : 0.25,
                    transition: `opacity ${animation.fast}`,
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: radius.sm,
                      background: col, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0,
                      boxShadow: on ? `0 0 6px ${col}40` : "none",
                    }} />
                    <span style={{ flex: 1, fontSize: typography.body.xs }}>{FL[f] || f}</span>
                    <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>{fcts[f]}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Panel>

      {/* Minimap */}
      <Panel style={{ position: "absolute", bottom: space[3], right: space[3], padding: space[1], cursor: "pointer" }}>
        <div style={{ fontSize: 8, color: colors.text.muted, letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase", marginBottom: 2, textAlign: "center" }}>
          Minimap
        </div>
        <canvas ref={mmRef} style={{ display: "block" }} onClick={handleMinimapClick} />
      </Panel>

      {/* Zoom indicator + tier */}
      <div style={{
        position: "absolute", bottom: space[3], left: space[3],
        fontSize: typography.body.xs, color: colors.text.muted,
        fontFamily: typography.monoFamily,
        background: colors.bg.overlay,
        padding: "2px 6px", borderRadius: radius.sm,
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", gap: space[1],
      }}>
        <span>{zoomPercent}%</span>
        <span style={{ color: colors.accent.blue, fontSize: 9 }}>{TIER_NAMES[currentTier]}</span>
        <span style={{ color: colors.text.muted, fontSize: 9 }}>{viewportRef.current.cellPixels.toFixed(1)}px/cell</span>
      </div>
    </div>
  );
}

// ── Filter Chip (small toggle button for filter panel) ──
function FilterChip({ label, onClick }) {
  return (
    <div onClick={onClick} style={{
      padding: "2px 7px", borderRadius: radius.sm,
      fontSize: typography.body.xs, cursor: "pointer",
      background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`,
      color: colors.text.secondary,
      transition: `all ${animation.fast}`,
      lineHeight: 1.4,
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue + "60"; e.currentTarget.style.color = colors.text.primary; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.subtle; e.currentTarget.style.color = colors.text.secondary; }}
    >
      {label}
    </div>
  );
}
