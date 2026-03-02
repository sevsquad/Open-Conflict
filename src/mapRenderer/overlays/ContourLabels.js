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

// Precompute contour crossing data from smoothed elevation map.
// Returns a Map<elevValue, Array<{c, r}>> — cells that sit on a contour boundary.
// Call once when map data or contour interval changes.
export function buildContourLabelData(smoothedElevMap, cells, cols, rows, contourInterval) {
  if (!smoothedElevMap || contourInterval < 1) return new Map();

  // For each cell, check if a contour boundary sits between it and any neighbor.
  // If so, record the cell for that contour elevation value.
  const contourCells = new Map(); // elevation → [{c, r}]

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      if (!cell) continue;

      // Skip water
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

        // Check if a contour crosses between these two cells
        const lo = Math.min(elev, nElev);
        const hi = Math.max(elev, nElev);
        const firstContour = Math.ceil(lo / contourInterval) * contourInterval;
        if (firstContour > hi) continue;

        // This cell is on a contour boundary — record it
        const contourElev = firstContour;
        if (!contourCells.has(contourElev)) contourCells.set(contourElev, []);
        contourCells.get(contourElev).push({ c, r });
        break; // one label candidate per cell is enough
      }
    }
  }

  return contourCells;
}

// Draw contour elevation labels on the Canvas 2D overlay.
// contourLabelData: output of buildContourLabelData
export function drawContourLabels(ctx, viewport, canvasWidth, canvasHeight, cols, rows, contourLabelData) {
  if (!contourLabelData || contourLabelData.size === 0) return;
  const cp = viewport.cellPixels;
  if (cp < MIN_CELL_PX) return;

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);

  // Font size scales with zoom, clamped for readability
  const fontSize = Math.max(8, Math.min(13, cp * 0.28));
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Track placed label positions to enforce minimum spacing
  const placed = [];

  // Sort contour elevations so labels appear in order
  const elevations = [...contourLabelData.keys()].sort((a, b) => a - b);

  for (const elev of elevations) {
    const candidates = contourLabelData.get(elev);

    // Pick spaced-out candidates from the list
    for (const { c, r } of candidates) {
      // Skip cells outside visible range
      if (c < range.colMin - 1 || c > range.colMax + 1) continue;
      if (r < range.rowMin - 1 || r > range.rowMax + 1) continue;

      const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);

      // Check distance to all placed labels (not just same-elevation)
      let tooClose = false;
      for (const p of placed) {
        const dx = x - p.x, dy = y - p.y;
        if (dx * dx + dy * dy < MIN_SPACING_PX * MIN_SPACING_PX) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Format: "500m"
      const text = `${Math.round(elev)}m`;

      // Draw with outline for legibility over any background
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(text, x, y);

      placed.push({ x, y });

      // Cap total labels to avoid clutter
      if (placed.length >= 60) return;
    }
  }
}
