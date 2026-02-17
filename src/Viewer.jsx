import { useState, useRef, useEffect, useCallback } from "react";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Badge, Panel } from "./components/ui.jsx";
import { TC, TL, FC, FL, FG, DEFAULT_FEATURES } from "./terrainColors.js";
import MapView from "./mapRenderer/MapView.jsx";
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

// ═══════════════════════════════════════════════════════════════
// VIEWER COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function Viewer({ onBack, onParser, initialData }) {
  const [D, setD] = useState(null); // map data
  const [sel, setSel] = useState(null); // "c,r"
  const [hov, setHov] = useState(null); // "c,r"
  const [af, setAf] = useState(new Set()); // active features
  const [fcts, setFcts] = useState({}); // feature counts
  const [savedFiles, setSavedFiles] = useState([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  const mapViewRef = useRef(null);
  const mmRef = useRef(null);

  // ── Load data ──
  const loadMapData = useCallback((mapData) => {
    // Migrate old "navigable_waterway" feature key → "river"
    for (const k in mapData.cells) {
      const cell = mapData.cells[k];
      if (cell.features) { const i = cell.features.indexOf("navigable_waterway"); if (i !== -1) cell.features[i] = "river"; }
      if (cell.attributes) { const i = cell.attributes.indexOf("navigable_waterway"); if (i !== -1) cell.attributes[i] = "river"; }
      if (cell.feature_names?.navigable_waterway) { cell.feature_names.river = cell.feature_names.navigable_waterway; delete cell.feature_names.navigable_waterway; }
    }
    const counts = {};
    for (const k in mapData.cells) {
      getFeats(mapData.cells[k]).forEach(f => { counts[f] = (counts[f] || 0) + 1; });
    }
    setFcts(counts);
    setAf(new Set(DEFAULT_FEATURES.filter(f => counts[f])));
    setD(mapData);
    setSel(null);
    setHov(null);
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

  // ── Cell interaction handlers ──
  const handleCellClick = useCallback((cell) => {
    if (!D) return;
    const k = `${cell.c},${cell.r}`;
    if (D.cells[k]) setSel(prev => prev === k ? null : k);
  }, [D]);

  const handleCellHover = useCallback((cell) => {
    const k = cell ? `${cell.c},${cell.r}` : null;
    setHov(k);
  }, []);

  // ── Zoom button helpers (delegate to MapView) ──
  const zoomIn = useCallback(() => { mapViewRef.current?.zoomIn(); }, []);
  const zoomOut = useCallback(() => { mapViewRef.current?.zoomOut(); }, []);
  const fitMap = useCallback(() => { mapViewRef.current?.fitMap(); }, []);

  // ── Keyboard navigation ──
  useEffect(() => {
    if (!D) return;
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const PAN_AMOUNT = 50;
      const mv = mapViewRef.current;
      if (!mv) return;
      switch (e.key) {
        case "+": case "=":
          e.preventDefault(); mv.zoomIn(); break;
        case "-": case "_":
          e.preventDefault(); mv.zoomOut(); break;
        case "f": case "F":
          e.preventDefault(); mv.fitMap(); break;
        case "Escape":
          setSel(null); break;
        case "ArrowUp": {
          e.preventDefault();
          const vp = mv.getViewport();
          mv.setViewport({ ...vp, centerRow: vp.centerRow - PAN_AMOUNT / (cellPixelsToHexSize(vp.cellPixels) * 1.5) });
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const vp = mv.getViewport();
          mv.setViewport({ ...vp, centerRow: vp.centerRow + PAN_AMOUNT / (cellPixelsToHexSize(vp.cellPixels) * 1.5) });
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const vp = mv.getViewport();
          mv.setViewport({ ...vp, centerCol: vp.centerCol - PAN_AMOUNT / (cellPixelsToHexSize(vp.cellPixels) * SQRT3) });
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const vp = mv.getViewport();
          mv.setViewport({ ...vp, centerCol: vp.centerCol + PAN_AMOUNT / (cellPixelsToHexSize(vp.cellPixels) * SQRT3) });
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [D]);

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
    if (!D || !mapViewRef.current) return;
    const exportCellSize = 28;
    const exportW = Math.ceil((D.cols + 0.5) * exportCellSize);
    const exportH = Math.ceil(D.rows * exportCellSize * 1.5 / SQRT3 + exportCellSize);
    const glCanvas = mapViewRef.current.renderExport(exportW, exportH);
    if (!glCanvas) return;

    // Composite to downloadable canvas
    const cv = document.createElement("canvas");
    cv.width = exportW;
    cv.height = exportH;
    cv.getContext("2d").drawImage(glCanvas, 0, 0);
    const a = document.createElement("a");
    a.download = `oc_map_${D.cols}x${D.rows}.png`;
    a.href = cv.toDataURL("image/png");
    a.click();
  }, [D]);

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

  // ── Minimap drawing ──
  const drawMinimap = useCallback(() => {
    const mc = mmRef.current;
    if (!mc || !D || !mapViewRef.current) return;
    const maxDim = 220;
    const ratio = D.rows / D.cols;
    const mw = ratio > 1 ? Math.round(maxDim / ratio) : maxDim;
    const mh = ratio > 1 ? maxDim : Math.round(maxDim * ratio);
    if (mc.width !== mw || mc.height !== mh) {
      mc.width = mw; mc.height = mh;
    }
    const ctx = mc.getContext("2d");
    mapViewRef.current.renderMinimap(ctx, mw, mh);
  }, [D]);

  // Redraw minimap when data or viewport changes
  useEffect(() => { drawMinimap(); });

  // Minimap click-to-navigate
  const handleMinimapClick = useCallback((e) => {
    if (!D || !mapViewRef.current) return;
    const mc = mmRef.current;
    if (!mc) return;
    const rect = mc.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const col = (mx / mc.width) * D.cols;
    const row = (my / mc.height) * D.rows;
    mapViewRef.current.panTo(col, row);
  }, [D]);

  // ── Cell info ──
  const infoCell = sel || hov;
  const cellData = infoCell && D ? D.cells[infoCell] : null;

  // Current viewport info for display
  const currentVp = mapViewRef.current?.getViewport();
  const zoomPercent = D && currentVp ? Math.round(currentVp.cellPixels / 28 * 100) : 100;

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
      {/* Map rendering — WebGL terrain + Canvas 2D overlays */}
      <MapView
        ref={mapViewRef}
        mapData={D}
        activeFeatures={af}
        onCellClick={handleCellClick}
        onCellHover={handleCellHover}
      />

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
          {onParser && <Button variant="secondary" size="sm" onClick={onParser}>Parser</Button>}
        </div>
      </div>

      {/* Info Panel — auto-shows when a cell is hovered or selected */}
      {cellData && (
        <Panel style={{
          position: "absolute", top: 48, left: space[3], width: 230,
          maxHeight: "50vh", overflowY: "auto", padding: space[2] + 2,
          animation: "fadeIn 0.2s ease-out",
        }}>
          {(() => {
            const selData = sel ? D.cells[sel] : null;
            const hovData = hov && hov !== sel ? D.cells[hov] : null;
            const sections = [];
            if (selData) sections.push({ key: sel, data: selData, label: "Selected" });
            if (hovData) sections.push({ key: hov, data: hovData, label: "Hover" });
            if (sections.length === 0 && cellData) {
              sections.push({ key: infoCell, data: cellData, label: null });
            }
            return sections.map((sec, idx) => {
              const [c, r] = sec.key.split(",").map(Number);
              const feats = getFeats(sec.data);
              const fn = sec.data.feature_names || {};
              const tc = TC[sec.data.terrain] || "#333";
              const terrainName = fn[sec.data.terrain] || fn.settlement || "";
              return (
                <div key={sec.key + idx} style={{ marginBottom: idx < sections.length - 1 ? space[2] : 0 }}>
                  {sec.label && (
                    <div style={{
                      fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: sec.label === "Selected" ? colors.accent.amber : colors.text.muted,
                      marginBottom: space[1], letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      {sec.label}
                      {sec.label === "Selected" && (
                        <span onClick={(e) => { e.stopPropagation(); setSel(null); }} style={{ cursor: "pointer", opacity: 0.6, fontSize: 10 }}>✕</span>
                      )}
                    </div>
                  )}
                  <div style={{ fontWeight: typography.weight.bold, fontSize: typography.heading.md, marginBottom: 2 }}>{cellCoord(c, r)}</div>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2] }}>
                    {sec.data.elevation !== undefined ? sec.data.elevation + "m" : ""} · [{c},{r}]
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: space[1], marginBottom: space[2] }}>
                    <div style={{ width: 12, height: 12, borderRadius: radius.sm, background: tc, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
                    <span style={{ fontWeight: typography.weight.semibold, fontSize: typography.body.sm }}>{TL[sec.data.terrain] || sec.data.terrain}</span>
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
                  {idx < sections.length - 1 && <div style={{ borderTop: `1px solid ${colors.border.subtle}`, marginTop: space[2] }} />}
                </div>
              );
            });
          })()}
        </Panel>
      )}

      {/* Filter toggle button (always visible) */}
      {!rightPanelOpen && (
        <div onClick={() => setRightPanelOpen(true)} style={{
          position: "absolute", top: 48 + space[1], right: space[3],
          width: 32, height: 32, borderRadius: radius.md,
          background: colors.bg.overlay, backdropFilter: "blur(8px)",
          border: `1px solid ${colors.border.subtle}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: `all ${animation.fast}`,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue + "60"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          title="Feature Filters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.text.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </div>
      )}

      {/* Filter Panel — overlays map when open */}
      {rightPanelOpen && (
        <Panel style={{
          position: "absolute", top: 48, right: space[3], width: 230,
          maxHeight: "80vh", overflowY: "auto", padding: space[2] + 2,
          zIndex: 10,
          animation: "fadeIn 0.2s ease-out",
        }}>
          <div style={{
            fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.text.muted,
            marginBottom: space[1], letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            Features
            <span onClick={() => setRightPanelOpen(false)} style={{ cursor: "pointer", opacity: 0.6, fontSize: 12, lineHeight: 1 }}>✕</span>
          </div>
          {/* Quick filter input */}
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Filter..."
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "3px 6px", marginBottom: space[2],
              fontSize: typography.body.xs, fontFamily: typography.fontFamily,
              background: colors.bg.surface, color: colors.text.primary,
              border: `1px solid ${colors.border.subtle}`, borderRadius: radius.sm,
              outline: "none",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = colors.accent.blue + "80"; }}
            onBlur={e => { e.currentTarget.style.borderColor = colors.border.subtle; }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: space[2] }}>
            <FilterChip label="All On" onClick={() => toggleAll(true)} />
            <FilterChip label="All Off" onClick={() => toggleAll(false)} />
            {Object.keys(FG).map(g => <FilterChip key={g} label={g} onClick={() => toggleGroup(g)} />)}
          </div>
          {Object.entries(FG).map(([group, items]) => {
            const present = items.filter(f => fcts[f]);
            if (present.length === 0) return null;
            const filteredPresent = filterText
              ? present.filter(f => (FL[f] || f).toLowerCase().includes(filterText.toLowerCase()))
              : present;
            if (filteredPresent.length === 0) return null;
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
                {filteredPresent.map(f => {
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
      )}

      {/* Minimap */}
      <Panel style={{ position: "absolute", bottom: space[3], right: space[3], padding: space[1], cursor: "pointer" }}>
        <div style={{ fontSize: 8, color: colors.text.muted, letterSpacing: typography.letterSpacing.wider, textTransform: "uppercase", marginBottom: 2, textAlign: "center" }}>
          Minimap
        </div>
        <canvas ref={mmRef} style={{ display: "block" }} onClick={handleMinimapClick} />
      </Panel>

      {/* Zoom controls */}
      <div style={{
        position: "absolute", bottom: space[3], left: space[3],
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      }}>
        <div style={{
          display: "flex", gap: 2, marginBottom: 2,
        }}>
          <ZoomBtn label="+" onClick={zoomIn} title="Zoom in (+)" />
          <ZoomBtn label="-" onClick={zoomOut} title="Zoom out (-)" />
          <ZoomBtn label="Fit" onClick={fitMap} title="Fit to map (F)" wide />
        </div>
        <div style={{
          fontSize: typography.body.xs, color: colors.text.muted,
          fontFamily: typography.monoFamily,
          background: colors.bg.overlay, backdropFilter: "blur(8px)",
          padding: "2px 6px", borderRadius: radius.sm,
          display: "flex", alignItems: "center", gap: space[1],
        }}>
          <span>{zoomPercent}%</span>
          <span style={{ color: colors.text.muted, fontSize: 9 }}>{currentVp ? currentVp.cellPixels.toFixed(1) : "—"}px/cell</span>
        </div>
      </div>
    </div>
  );
}

// ── Zoom Button ──
function ZoomBtn({ label, onClick, title, wide }) {
  return (
    <div onClick={onClick} title={title} style={{
      width: wide ? 40 : 28, height: 28, borderRadius: radius.md,
      background: colors.bg.overlay, backdropFilter: "blur(8px)",
      border: `1px solid ${colors.border.subtle}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", fontSize: wide ? typography.body.xs : typography.body.md,
      fontWeight: typography.weight.bold, color: colors.text.secondary,
      transition: `all ${animation.fast}`, userSelect: "none",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = colors.accent.blue + "60"; e.currentTarget.style.color = colors.text.primary; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border.subtle; e.currentTarget.style.color = colors.text.secondary; }}
    >
      {label}
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
