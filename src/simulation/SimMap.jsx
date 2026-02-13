import { useRef, useEffect, useCallback, useState } from "react";

// ═══════════════════════════════════════════════════════════════
// SIM MAP — Simplified terrain renderer with unit overlay
// Reuses color maps from Viewer.jsx
// ═══════════════════════════════════════════════════════════════

// Terrain colors (from Viewer.jsx:9-15)
const TC = {
  deep_water: "#1A3A5C", coastal_water: "#2A5A7C", lake: "#2E6B8A", river: "#3478A0",
  wetland: "#3A6B55", open_ground: "#A8B060", light_veg: "#8AA050", farmland: "#B8C468",
  forest: "#2D6B1E", dense_forest: "#1A4A12", highland: "#8A9060", mountain_forest: "#4A6830",
  mountain: "#7A7A6A", peak: "#B0A890", desert: "#D4C090", ice: "#D0E0F0",
  light_urban: "#B0A890", dense_urban: "#8A8070",
};

const TL = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", mountain_forest: "Mtn Forest",
  mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert", ice: "Ice/Glacier",
  light_urban: "Light Urban", dense_urban: "Dense Urban",
};

// Actor colors for unit markers
const ACTOR_COLORS = ["#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#A855F7", "#EC4899"];

const CELL_BASE = 10;

export default function SimMap({ terrainData, units, actors, style }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hovCell, setHovCell] = useState(null);
  const [containerSize, setContainerSize] = useState({ w: 600, h: 400 });
  const dragRef = useRef(null);

  const D = terrainData;
  const cols = D?.cols || 0;
  const rows = D?.rows || 0;
  const cellSize = CELL_BASE;

  // Build actor color index
  const actorColorMap = {};
  (actors || []).forEach((a, i) => { actorColorMap[a.id] = ACTOR_COLORS[i % ACTOR_COLORS.length]; });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit on load
  useEffect(() => {
    if (!cols || !rows || !containerSize.w) return;
    const mapW = cols * cellSize;
    const mapH = rows * cellSize;
    const scale = Math.min(containerSize.w / mapW, containerSize.h / mapH, 3) * 0.95;
    setTransform({
      x: (containerSize.w - mapW * scale) / 2,
      y: (containerSize.h - mapH * scale) / 2,
      scale
    });
  }, [cols, rows, containerSize.w, containerSize.h, cellSize]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !D) return;
    canvas.width = containerSize.w;
    canvas.height = containerSize.h;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0A0F1A";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // Draw terrain
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = D.cells[`${c},${r}`];
        ctx.fillStyle = cell ? (TC[cell.terrain] || "#333") : "#111";
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }

    // Draw grid lines (only if zoomed in enough)
    if (transform.scale > 1.5) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 0.5 / transform.scale;
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(cols * cellSize, r * cellSize); ctx.stroke();
      }
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, rows * cellSize); ctx.stroke();
      }
    }

    // Draw unit markers
    if (units && units.length > 0) {
      for (const unit of units) {
        if (!unit.position) continue;
        // Parse position like "C5" → col=2, row=4 or "12,15" → col=12, row=15
        let uc, ur;
        const commaMatch = unit.position.match(/^(\d+),(\d+)$/);
        const letterMatch = unit.position.match(/^([A-Z]+)(\d+)$/i);
        if (commaMatch) {
          uc = parseInt(commaMatch[1]);
          ur = parseInt(commaMatch[2]);
        } else if (letterMatch) {
          uc = letterMatch[1].toUpperCase().split("").reduce((s, c) => s * 26 + c.charCodeAt(0) - 64, 0) - 1;
          ur = parseInt(letterMatch[2]) - 1;
        } else continue;

        if (uc < 0 || uc >= cols || ur < 0 || ur >= rows) continue;

        const cx = (uc + 0.5) * cellSize;
        const cy = (ur + 0.5) * cellSize;
        const radius = cellSize * 0.4;
        const color = actorColorMap[unit.actor] || "#FFF";

        // Circle marker
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = color + "CC";
        ctx.fill();
        ctx.strokeStyle = "#FFF";
        ctx.lineWidth = 1 / transform.scale;
        ctx.stroke();

        // Strength indicator (border arc)
        if (unit.strength < 100) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius + 1.5 / transform.scale, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * unit.strength / 100));
          ctx.strokeStyle = unit.strength > 50 ? "#22C55E" : unit.strength > 25 ? "#F59E0B" : "#EF4444";
          ctx.lineWidth = 2 / transform.scale;
          ctx.stroke();
        }

        // Label (when zoomed in)
        if (transform.scale > 1.2) {
          ctx.font = `${Math.max(3, 7 / transform.scale)}px Arial`;
          ctx.textAlign = "center";
          ctx.fillStyle = "#FFF";
          ctx.fillText(unit.name.slice(0, 10), cx, cy + radius + 6 / transform.scale);
        }
      }
    }

    // Highlight hovered cell
    if (hovCell) {
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 2 / transform.scale;
      ctx.strokeRect(hovCell.c * cellSize, hovCell.r * cellSize, cellSize, cellSize);
    }

    ctx.restore();
  }, [D, transform, units, hovCell, containerSize, cols, rows, cellSize, actorColorMap]);

  // Mouse handlers
  const getCellFromEvent = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const c = Math.floor((mx - transform.x) / (cellSize * transform.scale));
    const r = Math.floor((my - transform.y) / (cellSize * transform.scale));
    if (c >= 0 && c < cols && r >= 0 && r < rows) return { c, r };
    return null;
  }, [transform, cellSize, cols, rows]);

  const handleMouseMove = useCallback((e) => {
    if (dragRef.current) {
      setTransform(prev => ({
        ...prev,
        x: prev.x + e.movementX,
        y: prev.y + e.movementY
      }));
    } else {
      setHovCell(getCellFromEvent(e));
    }
  }, [getCellFromEvent]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setTransform(prev => {
      const newScale = Math.max(0.2, Math.min(20, prev.scale * factor));
      return {
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
        scale: newScale
      };
    });
  }, []);

  // Cell info
  const cellData = hovCell && D ? D.cells[`${hovCell.c},${hovCell.r}`] : null;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}>
      <canvas
        ref={canvasRef}
        style={{ cursor: dragRef.current ? "grabbing" : "crosshair" }}
        onMouseDown={() => { dragRef.current = true; }}
        onMouseUp={() => { dragRef.current = false; }}
        onMouseLeave={() => { dragRef.current = false; setHovCell(null); }}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
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
    </div>
  );
}
