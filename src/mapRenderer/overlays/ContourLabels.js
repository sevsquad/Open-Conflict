// ════════════════════════════════════════════════════════════════
// ContourLabels — draw elevation values along contour boundaries
// Uses smoothed elevation data to place labels where bands change
// ════════════════════════════════════════════════════════════════

import { getVisibleRange, gridToScreen } from "../ViewportState.js";
import { getNeighbors } from "../HexMath.js";

const LABEL_COLOR = "#3D2A14";       // dark brown, matching contour lines
const OUTLINE_COLOR = "rgba(255,255,255,0.85)";
const MIN_CELL_PX = 6;              // don't show labels when zoomed out past this
const MIN_SPACING_PX = 120;         // minimum pixel distance between labels of the same elevation

// Precompute contour label positions from smoothed elevation map.
// Returns a flat array of {c, r, elev} — fixed label positions anchored to hex cells.
// Spatial thinning is done here in map-space (~8 cells apart) so labels don't jump on pan.
// Call once when map data or contour interval changes.
export function buildContourLabelData(smoothedElevMap, cells, cols, rows, contourInterval) {
  if (!smoothedElevMap || contourInterval < 1) return [];

  // Step 1: find all cells that sit on a contour boundary
  const candidates = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      if (!cell) continue;

      const t = cell.terrain;
      if (t === "deep_water" || t === "coastal_water" || t === "lake" || t === "river") continue;

      const elev = smoothedElevMap.get(key);
      if (elev == null) continue;

      const neighbors = getNeighbors(c, r);
      for (const [nc, nr] of neighbors) {
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nKey = `${nc},${nr}`;
        const nElev = smoothedElevMap.get(nKey);
        if (nElev == null) continue;

        const lo = Math.min(elev, nElev);
        const hi = Math.max(elev, nElev);
        const firstContour = Math.ceil(lo / contourInterval) * contourInterval;
        if (firstContour > hi) continue;

        candidates.push({ c, r, elev: firstContour });
        break; // one candidate per cell
      }
    }
  }

  // Step 2: thin in map-space using a grid of slots (~8 cells apart)
  // This produces fixed positions that don't change with viewport
  const SLOT_SIZE = 8; // cells between labels
  const slotsC = Math.max(1, Math.ceil(cols / SLOT_SIZE));
  const slotsR = Math.max(1, Math.ceil(rows / SLOT_SIZE));
  const chosen = [];

  for (let sr = 0; sr < slotsR; sr++) {
    for (let sc = 0; sc < slotsC; sc++) {
      const centerC = (sc + 0.5) * SLOT_SIZE;
      const centerR = (sr + 0.5) * SLOT_SIZE;

      // Find nearest candidate to this slot center
      let best = null, bestDist = Infinity;
      for (const cand of candidates) {
        const dc = cand.c - centerC, dr = cand.r - centerR;
        const d = dc * dc + dr * dr;
        if (d < bestDist) { bestDist = d; best = cand; }
      }

      if (!best || bestDist > SLOT_SIZE * SLOT_SIZE) continue;

      // Check against already-chosen labels (map-space minimum spacing)
      let tooClose = false;
      for (const p of chosen) {
        const dc = best.c - p.c, dr = best.r - p.r;
        if (dc * dc + dr * dr < (SLOT_SIZE * 0.6) * (SLOT_SIZE * 0.6)) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;

      chosen.push(best);
    }
  }

  return chosen;
}

// Draw contour elevation labels on the Canvas 2D overlay.
// Labels are pre-positioned in map-space by buildContourLabelData —
// just filter to visible, enforce screen-space minimum spacing, and draw.
export function drawContourLabels(ctx, viewport, canvasWidth, canvasHeight, cols, rows, contourLabelData) {
  if (!contourLabelData || contourLabelData.length === 0) return;
  const cp = viewport.cellPixels;
  if (cp < MIN_CELL_PX) return;

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);

  const fontSize = Math.max(8, Math.min(13, cp * 0.28));
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const placed = [];

  for (const { c, r, elev } of contourLabelData) {
    if (c < range.colMin - 1 || c > range.colMax + 1) continue;
    if (r < range.rowMin - 1 || r > range.rowMax + 1) continue;

    const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);
    if (x < -20 || x > canvasWidth + 20 || y < -20 || y > canvasHeight + 20) continue;

    // Screen-space minimum spacing to prevent overlaps at certain zoom levels
    let tooClose = false;
    for (const p of placed) {
      const dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < MIN_SPACING_PX * MIN_SPACING_PX) {
        tooClose = true; break;
      }
    }
    if (tooClose) continue;

    const text = `${Math.round(elev)}m`;
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(text, x, y);
    placed.push({ x, y });

    if (placed.length >= 60) return;
  }
}
