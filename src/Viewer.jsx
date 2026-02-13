import { useState, useRef, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const CELL_BASE = 28;

const TC = {
  deep_water:"#1A3A5C", coastal_water:"#2A5A7C", lake:"#2E6B8A", river:"#3478A0",
  wetland:"#3A6B55", open_ground:"#A8B060", light_veg:"#8AA050", farmland:"#B8C468",
  forest:"#2D6B1E", dense_forest:"#1A4A12", highland:"#8A9060", mountain_forest:"#4A6830",
  mountain:"#7A7A6A", peak:"#B0A890", desert:"#D4C090", ice:"#D0E0F0",
  light_urban:"#B0A890", dense_urban:"#8A8070",
};
const TL = {
  deep_water:"Deep Water", coastal_water:"Coastal", lake:"Lake", river:"River",
  wetland:"Wetland", open_ground:"Open Ground", light_veg:"Light Veg", farmland:"Farmland",
  forest:"Forest", dense_forest:"Dense Forest", highland:"Highland", mountain_forest:"Mtn Forest",
  mountain:"Mountain", peak:"Peak/Alpine", desert:"Desert", ice:"Ice/Glacier",
  light_urban:"Light Urban", dense_urban:"Dense Urban",
};
const FC = {
  highway:"#E6A817", major_road:"#D4D4D4", road:"#B0B0B0", minor_road:"#9A9A8A", footpath:"#6A6A5A", trail:"#8A8A6A",
  railway:"#E05050", light_rail:"#D07070",
  dam:"#5A8ABF", navigable_waterway:"#3AC4E0", tunnel:"#7070A0",
  port:"#4ABFBF", airfield:"#9090D0", helipad:"#70A070", pipeline:"#A070D0",
  power_plant:"#E0D040",
  military_base:"#BF5050",
  chokepoint:"#FF4040", landing_zone:"#40E080", beach:"#E0D0A0", town:"#E8A040",
  building:"#A08060", parking:"#6A6A7A", tower:"#C07050", wall:"#8A6A5A", fence:"#7A6050",
  cliffs:"#C48060", ridgeline:"#D4A860", treeline:"#88C060",
  slope_steep:"#D49040", slope_extreme:"#D45040",
  building_dense:"#C0A080", building_sparse:"#B0A090",
  hedgerow:"#6AA050", walled:"#8A6A5A", elevation_advantage:"#E0C060",
  bridge:"#C4956E", river_crossing:"#4A9ACF", stream_crossing:"#6ABADF", shoreline:"#6BB8D4",
};
const FL = {};
Object.keys(FC).forEach(k => { FL[k] = k.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()); });
FL.navigable_waterway = "Nav. Waterway";

const FG = {
  "Roads":["highway","major_road","road","minor_road","footpath","trail"],
  "Rail":["railway","light_rail"],
  "Water":["dam","navigable_waterway","tunnel"],
  "Transport":["port","airfield","helipad","pipeline"],
  "Energy":["power_plant"],
  "Military":["military_base"],
  "Strategic":["chokepoint","landing_zone","beach","town"],
  "Structures":["building","parking","tower","wall","fence"],
  "Terrain":["cliffs","ridgeline","treeline","slope_steep","slope_extreme","building_dense","building_sparse","hedgerow","walled","elevation_advantage"],
};

const DEFAULTS = ["highway","major_road","railway","military_base","airfield","port","dam","navigable_waterway","chokepoint","landing_zone","beach","power_plant","pipeline","town","hedgerow"];

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

export default function Viewer({ onBack, initialData }) {
  const [D, setD] = useState(null); // map data
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);
  const [af, setAf] = useState(new Set()); // active features
  const [fcts, setFcts] = useState({}); // feature counts
  const [redrawTick, setRedrawTick] = useState(0);
  const [savedFiles, setSavedFiles] = useState([]);

  const canvasRef = useRef(null);
  const mmRef = useRef(null);
  const vpRef = useRef(null);
  const tfRef = useRef({ x: 0, y: 0, s: 1 });
  const dragRef = useRef({ active: false, sx: 0, sy: 0 });

  // ── Load data ──
  const loadMapData = useCallback((mapData) => {
    const counts = {};
    for (const k in mapData.cells) {
      getFeats(mapData.cells[k]).forEach(f => { counts[f] = (counts[f] || 0) + 1; });
    }
    setFcts(counts);
    setAf(new Set(DEFAULTS.filter(f => counts[f])));
    setD(mapData);
    setSel(null);
    setHov(null);

    // Auto-fit
    const vp = vpRef.current;
    if (vp) {
      const W = mapData.cols * CELL_BASE, H = mapData.rows * CELL_BASE;
      const vw = vp.clientWidth, vh = vp.clientHeight;
      const s = Math.min(vw / W, vh / H) * 0.95;
      tfRef.current = { x: (vw - W * s) / 2, y: (vh - H * s) / 2, s };
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
  }, [D]); // Re-fetch when D changes (null = upload screen visible)

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

  // ── Drawing ──
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !D) return;
    const TF = tfRef.current;
    const W = D.cols * CELL_BASE, H = D.rows * CELL_BASE;
    cv.width = W; cv.height = H;
    cv.style.transform = `translate(${TF.x}px,${TF.y}px) scale(${TF.s})`;
    const ctx = cv.getContext("2d");

    // Terrain fill
    for (let r = 0; r < D.rows; r++) {
      for (let c = 0; c < D.cols; c++) {
        const cell = D.cells[`${c},${r}`];
        if (!cell) continue;
        ctx.fillStyle = TC[cell.terrain] || "#222";
        ctx.fillRect(c * CELL_BASE, r * CELL_BASE, CELL_BASE, CELL_BASE);
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect((c + 1) * CELL_BASE - 1, r * CELL_BASE, 1, CELL_BASE);
        ctx.fillRect(c * CELL_BASE, (r + 1) * CELL_BASE - 1, CELL_BASE, 1);
      }
    }

    // Feature overlays
    if (af.size > 0) {
      for (let r = 0; r < D.rows; r++) {
        for (let c = 0; c < D.cols; c++) {
          const cell = D.cells[`${c},${r}`];
          if (!cell) continue;
          const feats = getFeats(cell).filter(f => af.has(f));
          if (feats.length === 0) continue;
          const x = c * CELL_BASE, y = r * CELL_BASE;
          const margin = Math.max(2, CELL_BASE * 0.15);
          const inner = CELL_BASE - margin * 2;
          if (feats.length === 1) {
            ctx.fillStyle = FC[feats[0]] || "#999";
            ctx.globalAlpha = 0.7;
            ctx.beginPath(); ctx.roundRect(x + margin, y + margin, inner, inner, 3); ctx.fill();
            ctx.globalAlpha = 1;
          } else {
            const segH = inner / feats.length;
            feats.forEach((f, i) => {
              ctx.fillStyle = FC[f] || "#999"; ctx.globalAlpha = 0.7;
              ctx.fillRect(x + margin, y + margin + i * segH, inner, segH);
              ctx.globalAlpha = 1;
            });
          }
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 0.5;
    for (let c = 0; c <= D.cols; c++) { ctx.beginPath(); ctx.moveTo(c * CELL_BASE, 0); ctx.lineTo(c * CELL_BASE, H); ctx.stroke(); }
    for (let r = 0; r <= D.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL_BASE); ctx.lineTo(W, r * CELL_BASE); ctx.stroke(); }
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
    for (let c = 0; c <= D.cols; c += 10) { ctx.beginPath(); ctx.moveTo(c * CELL_BASE, 0); ctx.lineTo(c * CELL_BASE, H); ctx.stroke(); }
    for (let r = 0; r <= D.rows; r += 10) { ctx.beginPath(); ctx.moveTo(0, r * CELL_BASE); ctx.lineTo(W, r * CELL_BASE); ctx.stroke(); }

    // Coordinate labels
    if (TF.s >= 0.4) {
      ctx.font = `${Math.max(8, CELL_BASE * 0.22)}px monospace`;
      ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      const step = TF.s < 0.7 ? 10 : TF.s < 1.2 ? 5 : 1;
      for (let r = 0; r < D.rows; r += step) for (let c = 0; c < D.cols; c += step) ctx.fillText(cellCoord(c, r), c * CELL_BASE + 2, r * CELL_BASE + 2);
    }

    // Name labels
    if (TF.s >= 0.25) {
      const nameGroups = {};
      for (let r = 0; r < D.rows; r++) {
        for (let c = 0; c < D.cols; c++) {
          const cell = D.cells[`${c},${r}`];
          if (!cell || !cell.feature_names) continue;
          for (const [type, name] of Object.entries(cell.feature_names)) {
            const key = `${type}:${name}`;
            if (!nameGroups[key]) nameGroups[key] = { name, type, cells: [] };
            nameGroups[key].cells.push({ c, r });
          }
        }
      }
      const labels = [];
      for (const g of Object.values(nameGroups)) {
        const cx = g.cells.reduce((s, p) => s + p.c, 0) / g.cells.length;
        const cy = g.cells.reduce((s, p) => s + p.r, 0) / g.cells.length;
        let fontSize, minZoom, color, priority;
        if (g.type === "dense_urban") { fontSize = Math.max(12, CELL_BASE * 0.55); minZoom = 0.25; color = "#FFFFFF"; priority = 10; }
        else if (g.type === "light_urban") { fontSize = Math.max(10, CELL_BASE * 0.4); minZoom = 0.4; color = "#E0E0E0"; priority = 8; }
        else if (g.type === "town") { fontSize = Math.max(9, CELL_BASE * 0.35); minZoom = 0.5; color = "#E8A040"; priority = 6; }
        else if (g.type === "settlement") { fontSize = Math.max(9, CELL_BASE * 0.35); minZoom = 0.5; color = "#D0D0D0"; priority = 5; }
        else if (g.type === "navigable_waterway") { fontSize = Math.max(9, CELL_BASE * 0.30); minZoom = 0.35; color = "#60C8E8"; priority = 4; }
        else { fontSize = Math.max(8, CELL_BASE * 0.25); minZoom = 0.6; color = "#AAA"; priority = 2; }
        if (TF.s >= minZoom) labels.push({ name: g.name, x: (cx + 0.5) * CELL_BASE, y: (cy + 0.5) * CELL_BASE, fontSize, color, priority, type: g.type, spanCells: g.cells.length });
      }
      labels.sort((a, b) => b.priority - a.priority || b.spanCells - a.spanCells);
      const placed = [];
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const lb of labels) {
        ctx.font = lb.type === "navigable_waterway" ? `italic 600 ${lb.fontSize}px sans-serif` : `600 ${lb.fontSize}px sans-serif`;
        const tw = ctx.measureText(lb.name.toUpperCase()).width;
        const th = lb.fontSize;
        const box = { x: lb.x - tw / 2 - 4, y: lb.y - th / 2 - 4, w: tw + 8, h: th + 8 };
        let collides = false;
        for (const p of placed) { if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { collides = true; break; } }
        if (collides) continue;
        placed.push(box);
        ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
        ctx.strokeText(lb.name.toUpperCase(), lb.x, lb.y);
        ctx.fillStyle = lb.color;
        ctx.fillText(lb.name.toUpperCase(), lb.x, lb.y);
      }
    }

    // Hover highlight
    if (hov) {
      const [hc, hr] = hov.split(",").map(Number);
      ctx.strokeStyle = "rgba(79,195,247,0.8)"; ctx.lineWidth = 2;
      ctx.strokeRect(hc * CELL_BASE + 1, hr * CELL_BASE + 1, CELL_BASE - 2, CELL_BASE - 2);
    }

    // Selection highlight
    if (sel) {
      const [sc, sr] = sel.split(",").map(Number);
      ctx.strokeStyle = "#FFF"; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sc * CELL_BASE + 1, sr * CELL_BASE + 1, CELL_BASE - 2, CELL_BASE - 2);
      ctx.setLineDash([]);
    }

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
    mc.width = mw; mc.height = mh;
    const ctx = mc.getContext("2d");
    const cpw = mw / D.cols, cph = mh / D.rows;
    for (let r = 0; r < D.rows; r++) {
      for (let c = 0; c < D.cols; c++) {
        const cell = D.cells[`${c},${r}`];
        ctx.fillStyle = cell ? (TC[cell.terrain] || "#222") : "#111";
        ctx.fillRect(Math.floor(c * cpw), Math.floor(r * cph), Math.ceil(cpw), Math.ceil(cph));
      }
    }
    // Viewport rect
    const vp = vpRef.current;
    if (vp) {
      const TF = tfRef.current;
      const fullW = D.cols * CELL_BASE * TF.s, fullH = D.rows * CELL_BASE * TF.s;
      const vw = vp.clientWidth, vh = vp.clientHeight;
      const rx = (-TF.x / fullW) * mw, ry = (-TF.y / fullH) * mh;
      const rw = (vw / fullW) * mw, rh = (vh / fullH) * mh;
      ctx.strokeStyle = "rgba(79,195,247,0.8)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.max(0, rx), Math.max(0, ry), Math.min(rw, mw), Math.min(rh, mh));
    }
  }, [D]);

  useEffect(() => { draw(); }, [draw]);

  // ── Event handlers ──
  const pixelToCell = useCallback((e) => {
    const vp = vpRef.current;
    if (!vp || !D) return null;
    const rect = vp.getBoundingClientRect();
    const TF = tfRef.current;
    const mx = (e.clientX - rect.left - TF.x) / TF.s;
    const my = (e.clientY - rect.top - TF.y) / TF.s;
    const c = Math.floor(mx / CELL_BASE), r = Math.floor(my / CELL_BASE);
    if (c >= 0 && c < D.cols && r >= 0 && r < D.rows) return `${c},${r}`;
    return null;
  }, [D]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const vp = vpRef.current;
    if (!vp || !D) return;
    const TF = tfRef.current;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const ns = Math.max(0.05, Math.min(10, TF.s * factor));
    tfRef.current = { x: mx - (mx - TF.x) * (ns / TF.s), y: my - (my - TF.y) * (ns / TF.s), s: ns };
    setRedrawTick(t => t + 1);
  }, [D]);

  const handleMouseDown = useCallback((e) => {
    dragRef.current = { active: true, sx: e.clientX - tfRef.current.x, sy: e.clientY - tfRef.current.y };
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (dragRef.current.active) {
      tfRef.current = { ...tfRef.current, x: e.clientX - dragRef.current.sx, y: e.clientY - dragRef.current.sy };
      setRedrawTick(t => t + 1);
    } else {
      const k = pixelToCell(e);
      if (k !== hov) setHov(k);
    }
  }, [pixelToCell, hov]);

  const handleMouseUp = useCallback(() => { dragRef.current.active = false; }, []);

  const handleClick = useCallback((e) => {
    if (!D) return;
    const k = pixelToCell(e);
    if (k && D.cells[k]) setSel(prev => prev === k ? null : k);
  }, [D, pixelToCell]);

  // Zoom to viewport ref
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
    const cv = document.createElement("canvas");
    const W = D.cols * CELL_BASE, H = D.rows * CELL_BASE;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    for (let r = 0; r < D.rows; r++) for (let c = 0; c < D.cols; c++) {
      const cell = D.cells[`${c},${r}`]; if (!cell) continue;
      ctx.fillStyle = TC[cell.terrain] || "#222"; ctx.fillRect(c * CELL_BASE, r * CELL_BASE, CELL_BASE, CELL_BASE);
      ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect((c + 1) * CELL_BASE - 1, r * CELL_BASE, 1, CELL_BASE); ctx.fillRect(c * CELL_BASE, (r + 1) * CELL_BASE - 1, CELL_BASE, 1);
    }
    if (af.size > 0) for (let r = 0; r < D.rows; r++) for (let c = 0; c < D.cols; c++) {
      const cell = D.cells[`${c},${r}`]; if (!cell) continue;
      const feats = getFeats(cell).filter(f => af.has(f)); if (feats.length === 0) continue;
      const x = c * CELL_BASE, y = r * CELL_BASE, margin = Math.max(2, CELL_BASE * 0.15), inner = CELL_BASE - margin * 2;
      if (feats.length === 1) { ctx.fillStyle = FC[feats[0]] || "#999"; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.roundRect(x + margin, y + margin, inner, inner, 3); ctx.fill(); ctx.globalAlpha = 1; }
      else { const segH = inner / feats.length; feats.forEach((f, i) => { ctx.fillStyle = FC[f] || "#999"; ctx.globalAlpha = 0.7; ctx.fillRect(x + margin, y + margin + i * segH, inner, segH); ctx.globalAlpha = 1; }); }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 0.5;
    for (let c = 0; c <= D.cols; c++) { ctx.beginPath(); ctx.moveTo(c * CELL_BASE, 0); ctx.lineTo(c * CELL_BASE, H); ctx.stroke(); }
    for (let r = 0; r <= D.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL_BASE); ctx.lineTo(W, r * CELL_BASE); ctx.stroke(); }
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
    for (let c = 0; c <= D.cols; c += 10) { ctx.beginPath(); ctx.moveTo(c * CELL_BASE, 0); ctx.lineTo(c * CELL_BASE, H); ctx.stroke(); }
    for (let r = 0; r <= D.rows; r += 10) { ctx.beginPath(); ctx.moveTo(0, r * CELL_BASE); ctx.lineTo(W, r * CELL_BASE); ctx.stroke(); }
    ctx.font = `${Math.max(8, CELL_BASE * 0.22)}px monospace`; ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let r = 0; r < D.rows; r += 5) for (let c = 0; c < D.cols; c += 5) ctx.fillText(cellCoord(c, r), c * CELL_BASE + 2, r * CELL_BASE + 2);
    // Name labels
    const nameGroups = {};
    for (let r = 0; r < D.rows; r++) for (let c = 0; c < D.cols; c++) {
      const cell = D.cells[`${c},${r}`]; if (!cell || !cell.feature_names) continue;
      for (const [type, name] of Object.entries(cell.feature_names)) { const key = `${type}:${name}`; if (!nameGroups[key]) nameGroups[key] = { name, type, cells: [] }; nameGroups[key].cells.push({ c, r }); }
    }
    const labels = [];
    for (const g of Object.values(nameGroups)) {
      const cx = g.cells.reduce((s, p) => s + p.c, 0) / g.cells.length, cy = g.cells.reduce((s, p) => s + p.r, 0) / g.cells.length;
      let fontSize, color, priority;
      if (g.type === "dense_urban") { fontSize = Math.max(12, CELL_BASE * 0.55); color = "#FFFFFF"; priority = 10; }
      else if (g.type === "light_urban") { fontSize = Math.max(10, CELL_BASE * 0.4); color = "#E0E0E0"; priority = 8; }
      else if (g.type === "town") { fontSize = Math.max(9, CELL_BASE * 0.35); color = "#E8A040"; priority = 6; }
      else if (g.type === "settlement") { fontSize = Math.max(9, CELL_BASE * 0.35); color = "#D0D0D0"; priority = 5; }
      else if (g.type === "navigable_waterway") { fontSize = Math.max(9, CELL_BASE * 0.30); color = "#60C8E8"; priority = 4; }
      else { fontSize = Math.max(8, CELL_BASE * 0.25); color = "#AAA"; priority = 2; }
      labels.push({ name: g.name, x: (cx + 0.5) * CELL_BASE, y: (cy + 0.5) * CELL_BASE, fontSize, color, priority, type: g.type, spanCells: g.cells.length });
    }
    labels.sort((a, b) => b.priority - a.priority || b.spanCells - a.spanCells);
    const placed = [];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const lb of labels) {
      ctx.font = lb.type === "navigable_waterway" ? `italic 600 ${lb.fontSize}px sans-serif` : `600 ${lb.fontSize}px sans-serif`;
      const tw = ctx.measureText(lb.name.toUpperCase()).width, th = lb.fontSize;
      const box = { x: lb.x - tw / 2 - 4, y: lb.y - th / 2 - 4, w: tw + 8, h: th + 8 };
      let collides = false;
      for (const p of placed) { if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { collides = true; break; } }
      if (collides) continue;
      placed.push(box);
      ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      ctx.strokeText(lb.name.toUpperCase(), lb.x, lb.y); ctx.fillStyle = lb.color; ctx.fillText(lb.name.toUpperCase(), lb.x, lb.y);
    }
    const a = document.createElement("a"); a.download = `oc_map_${D.cols}x${D.rows}.png`; a.href = cv.toDataURL("image/png"); a.click();
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

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  const panelStyle = { position: "absolute", background: "rgba(15,23,42,0.92)", backdropFilter: "blur(16px)", borderRadius: 6, border: "1px solid #1E293B", fontSize: 10, color: "#D1D5DB", overflow: "hidden" };

  // Upload screen
  if (!D) {
    return (
      <div style={{ background: "#0F172A", minHeight: "100vh", color: "#E5E7EB", fontFamily: "Arial, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {onBack && <div onClick={onBack} style={{ position: "absolute", top: 16, left: 16, cursor: "pointer", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: "#1F2937", color: "#9CA3AF", border: "1px solid #374151" }}>{"\u2190"} Menu</div>}
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Map Viewer</div>
        <div style={{ fontSize: 11, color: "#64748B", marginBottom: 20 }}>Load a terrain JSON export or select a saved map.</div>
        <label style={{ padding: "10px 28px", borderRadius: 6, background: "#3B82F6", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 24 }}>
          Load JSON File
          <input type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
        </label>

        {savedFiles.length > 0 && (
          <div style={{ width: 420, maxHeight: 320, overflowY: "auto" }}>
            <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>SAVED MAPS</div>
            {savedFiles.map(f => {
              const sizeMB = (f.size / 1024 / 1024).toFixed(1);
              const date = new Date(f.modified);
              const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              // Parse filename for display: Name_scale_WxH_date.json
              const display = f.name.replace(/\.json$/, "").replace(/_/g, " ").replace(/ (\d{4}) (\d{2}) (\d{2})$/, "");
              return (
                <div key={f.name} onClick={() => loadSaved(f.name)}
                  style={{ padding: "8px 10px", borderRadius: 5, cursor: "pointer", background: "#111827", border: "1px solid #1E293B", marginBottom: 3, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F6"; e.currentTarget.style.background = "#0D1520"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E293B"; e.currentTarget.style.background = "#111827"; }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#D1D5DB", marginBottom: 2 }}>{display}</div>
                  <div style={{ fontSize: 9, color: "#4B5563" }}>{dateStr} · {sizeMB} MB</div>
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
    <div style={{ background: "#0F172A", width: "100vw", height: "100vh", overflow: "hidden", position: "relative", fontFamily: "Arial, sans-serif" }}>
      {/* Viewport */}
      <div ref={vpRef} style={{ width: "100%", height: "100%", cursor: dragRef.current.active ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        onClick={handleClick}>
        <canvas ref={canvasRef} style={{ transformOrigin: "0 0", imageRendering: "pixelated" }} />
      </div>

      {/* Top bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "6px 12px", background: "rgba(15,23,42,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1E293B" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onBack && <div onClick={onBack} style={{ cursor: "pointer", padding: "2px 8px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "#1F2937", color: "#9CA3AF", border: "1px solid #374151" }}>{"\u2190"} Menu</div>}
          <span style={{ fontSize: 12, fontWeight: 700 }}>Map Viewer</span>
          <span style={{ fontSize: 9, color: "#64748B" }}>{D.cols}{"\u00D7"}{D.rows} · {D.cellSizeKm}km/cell</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={exportPNG} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #374151", background: "#1F2937", color: "#D1D5DB", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>PNG</button>
          <button onClick={exportLLM} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #374151", background: "#1F2937", color: "#D1D5DB", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>LLM Export</button>
          <label style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #374151", background: "#1F2937", color: "#D1D5DB", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>
            Load
            <input type="file" accept=".json" onChange={handleFile} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* Info Panel */}
      <div style={{ ...panelStyle, top: 42, left: 12, width: 220, maxHeight: "50vh", overflowY: "auto", padding: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7280", marginBottom: 4, letterSpacing: 1 }}>CELL INFO</div>
        {cellData ? (() => {
          const [c, r] = (infoCell).split(",").map(Number);
          const feats = getFeats(cellData);
          const fn = cellData.feature_names || {};
          const tc = TC[cellData.terrain] || "#333";
          const terrainName = fn[cellData.terrain] || fn.settlement || "";
          return (<>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{cellCoord(c, r)}</div>
            <div style={{ fontSize: 9, color: "#6B7280", marginBottom: 6 }}>{cellData.elevation !== undefined ? cellData.elevation + "m" : ""} · [{c},{r}]</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: tc, border: "1px solid rgba(255,255,255,0.1)" }} />
              <span style={{ fontWeight: 600 }}>{TL[cellData.terrain] || cellData.terrain}</span>
              {terrainName && <span style={{ color: "#E8A040", fontWeight: 600 }}> — {terrainName}</span>}
            </div>
            {feats.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: "#6B7280", marginBottom: 3 }}>Features ({feats.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                  {feats.map(f => {
                    const col = FC[f] || "#666";
                    const nm = fn[f];
                    return <span key={f} style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: `${col}22`, color: col, border: `1px solid ${col}55` }}>{FL[f] || f}{nm ? ` (${nm})` : ""}</span>;
                  })}
                </div>
              </div>
            )}
          </>);
        })() : <div style={{ color: "#4B5563", fontSize: 9 }}>Hover over a cell</div>}
      </div>

      {/* Filter Panel */}
      <div style={{ ...panelStyle, top: 42, right: 12, width: 220, maxHeight: "80vh", overflowY: "auto", padding: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7280", marginBottom: 4, letterSpacing: 1 }}>FEATURES</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
          <div onClick={() => toggleAll(true)} style={{ padding: "2px 6px", borderRadius: 3, fontSize: 8, cursor: "pointer", background: "#1F2937", border: "1px solid #374151", color: "#9CA3AF" }}>ALL ON</div>
          <div onClick={() => toggleAll(false)} style={{ padding: "2px 6px", borderRadius: 3, fontSize: 8, cursor: "pointer", background: "#1F2937", border: "1px solid #374151", color: "#9CA3AF" }}>ALL OFF</div>
          {Object.keys(FG).map(g => <div key={g} onClick={() => toggleGroup(g)} style={{ padding: "2px 6px", borderRadius: 3, fontSize: 8, cursor: "pointer", background: "#1F2937", border: "1px solid #374151", color: "#9CA3AF" }}>{g}</div>)}
        </div>
        {Object.entries(FG).map(([group, items]) => {
          const present = items.filter(f => fcts[f]);
          if (present.length === 0) return null;
          return (
            <div key={group} style={{ marginBottom: 6 }}>
              <div onClick={() => toggleGroup(group)} style={{ fontSize: 8, fontWeight: 700, color: "#6B7280", cursor: "pointer", marginBottom: 2, letterSpacing: 0.5 }}>{group}</div>
              {present.map(f => {
                const on = af.has(f);
                const col = FC[f] || "#666";
                return (
                  <div key={f} onClick={() => toggleFeat(f)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0", cursor: "pointer", opacity: on ? 1 : 0.25 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: col, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 9 }}>{FL[f] || f}</span>
                    <span style={{ fontSize: 8, color: "#4B5563", fontFamily: "monospace" }}>{fcts[f]}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Minimap */}
      <div style={{ ...panelStyle, bottom: 12, right: 12, padding: 4 }}>
        <canvas ref={mmRef} style={{ display: "block" }} />
      </div>

      {/* Zoom indicator */}
      <div style={{ position: "absolute", bottom: 12, left: 12, fontSize: 9, color: "#4B5563", fontFamily: "monospace" }}>
        {Math.round(tfRef.current.s * 100)}%
      </div>
    </div>
  );
}
