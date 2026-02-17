// ════════════════════════════════════════════════════════════════
// LabelOverlay — priority-based labels with collision detection
// Drawn as screen-space overlay on every frame (not baked into tiles)
// ════════════════════════════════════════════════════════════════

import { getVisibleRange, gridToScreen } from "../ViewportState.js";

// Label config per feature type
const LABEL_CONFIG = {
  dense_urban:        { priority: 10, minCellPx: 3,  fontScale: 0.55, color: "#FFFFFF", minSpan: 1 },
  light_urban:        { priority: 8,  minCellPx: 8,  fontScale: 0.40, color: "#E0E0E0", minSpan: 3 },
  town:               { priority: 6,  minCellPx: 16, fontScale: 0.35, color: "#E8A040", minSpan: 2 },
  settlement:         { priority: 5,  minCellPx: 24, fontScale: 0.35, color: "#D0D0D0", minSpan: 3 },
  river: { priority: 4,  minCellPx: 14, fontScale: 0.30, color: "#60C8E8", italic: true, minSpan: 4 },
  military_base:      { priority: 7,  minCellPx: 10, fontScale: 0.30, color: "#EF4444", minSpan: 1 },
  airfield:           { priority: 5,  minCellPx: 24, fontScale: 0.28, color: "#9090D0", minSpan: 2 },
};
const DEFAULT_CONFIG = { priority: 2, minCellPx: 32, fontScale: 0.25, color: "#AAA", minSpan: 5 };
const MAX_LABELS = 40;

function colLbl(c) {
  let s = "", n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// Precompute name groups from map data (call once on data load)
export function buildNameGroups(cells, cols, rows) {
  const nameGroups = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[`${c},${r}`];
      if (!cell || !cell.feature_names) continue;
      for (const [type, name] of Object.entries(cell.feature_names)) {
        const key = `${type}:${name}`;
        if (!nameGroups[key]) nameGroups[key] = { name, type, cells: [] };
        nameGroups[key].cells.push({ c, r });
      }
    }
  }
  // Pre-compute centroid for each group
  const groups = Object.values(nameGroups);
  for (const g of groups) {
    g.centerCol = g.cells.reduce((s, p) => s + p.c, 0) / g.cells.length;
    g.centerRow = g.cells.reduce((s, p) => s + p.r, 0) / g.cells.length;
    const config = LABEL_CONFIG[g.type] || DEFAULT_CONFIG;
    g.priority = config.priority;
    g.minCellPx = config.minCellPx;
    g.fontScale = config.fontScale;
    g.color = config.color;
    g.italic = config.italic || false;
    g.minSpan = config.minSpan || 1;
    g.spanCells = g.cells.length;
  }
  // Sort by priority descending, then span descending
  groups.sort((a, b) => b.priority - a.priority || b.spanCells - a.spanCells);
  return groups;
}

// Draw feature name labels
export function drawNameLabels(ctx, viewport, canvasWidth, canvasHeight, nameGroups, cols, rows, options = {}) {
  const { centerFade = true } = options;
  const cp = viewport.cellPixels;
  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
  const placed = []; // bounding boxes of placed labels

  // Center-fade geometry (precomputed once per frame)
  let cx, cy, innerR, outerR;
  if (centerFade) {
    cx = canvasWidth / 2;
    cy = canvasHeight / 2;
    const refDim = Math.min(canvasWidth, canvasHeight) / 2;
    innerR = refDim * 0.30;
    outerR = refDim * 0.75;
  }

  // Dynamic collision padding — more spacing at lower zoom
  const pad = Math.max(4, Math.min(12, 40 / cp));

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const g of nameGroups) {
    if (cp < g.minCellPx) continue;

    // Minimum span filter — skip tiny features
    if (g.spanCells < g.minSpan) continue;

    // Skip if centroid is outside visible range (with margin)
    if (g.centerCol < range.colMin - 2 || g.centerCol > range.colMax + 2) continue;
    if (g.centerRow < range.rowMin - 2 || g.centerRow > range.rowMax + 2) continue;

    const { x, y } = gridToScreen(g.centerCol, g.centerRow, viewport, canvasWidth, canvasHeight);

    // Center-fade alpha
    let alpha = 1.0;
    if (centerFade) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= outerR) continue; // Fully outside spotlight — skip entirely
      if (dist > innerR) {
        alpha = 1.0 - (dist - innerR) / (outerR - innerR);
      }
    }

    // Per-priority font size cap for visual hierarchy
    const maxFont = g.priority >= 8 ? 24 : g.priority >= 6 ? 18 : 14;
    const fontSize = Math.max(7, Math.min(maxFont, cp * g.fontScale));

    ctx.font = g.italic
      ? `italic 600 ${fontSize}px sans-serif`
      : `600 ${fontSize}px sans-serif`;

    const text = g.name.toUpperCase();
    const tw = ctx.measureText(text).width;
    const th = fontSize;
    const box = { x: x - tw / 2 - pad, y: y - th / 2 - pad, w: tw + 2 * pad, h: th + 2 * pad };

    // Collision detection
    let collides = false;
    for (const p of placed) {
      if (box.x < p.x + p.w && box.x + box.w > p.x &&
          box.y < p.y + p.h && box.y + box.h > p.y) {
        collides = true;
        break;
      }
    }
    if (collides) continue;
    placed.push(box);

    // Draw with outline for legibility
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = g.color;
    ctx.fillText(text, x, y);

    // Max labels cap — highest priority labels always win
    if (placed.length >= MAX_LABELS) break;
  }

  ctx.globalAlpha = 1; // Restore once after loop
}

// Draw coordinate labels
export function drawCoordLabels(ctx, viewport, canvasWidth, canvasHeight, cols, rows) {
  const cp = viewport.cellPixels;
  if (cp < 6) return; // Too small for coords

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);

  // Determine step based on zoom
  let step;
  if (cp < 12) step = 10;
  else if (cp < 24) step = 5;
  else step = 1;

  const fontSize = Math.max(7, Math.min(12, cp * 0.22));
  ctx.font = `${fontSize}px monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const startCol = Math.ceil(range.colMin / step) * step;
  const startRow = Math.ceil(range.rowMin / step) * step;

  for (let r = startRow; r < range.rowMax; r += step) {
    for (let c = startCol; c < range.colMax; c += step) {
      const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);
      ctx.fillText(colLbl(c) + (r + 1), x + 2, y + 2);
    }
  }
}
