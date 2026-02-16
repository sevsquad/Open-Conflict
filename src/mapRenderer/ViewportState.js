// ════════════════════════════════════════════════════════════════
// ViewportState — viewport math, visible range, pixel-to-cell
// Hex grid (pointy-top, odd-r offset coordinates)
// ════════════════════════════════════════════════════════════════

import {
  cellPixelsToHexSize, hexToScreen, screenToHex,
  screenToGridHex, offsetToPixel, pixelToOffset, SQRT3,
} from "./HexMath.js";

export const MIN_CELL_PIXELS = 1.0;
export const MAX_CELL_PIXELS = 64.0;
export const ZOOM_FACTOR = 1.15;

// LOD tier boundaries (cellPixels thresholds)
export const TIER_BOUNDARIES = [3, 12, 32]; // Tier 0→1 at 3, 1→2 at 12, 2→3 at 32

export function getTier(cellPixels) {
  if (cellPixels < TIER_BOUNDARIES[0]) return 0;
  if (cellPixels < TIER_BOUNDARIES[1]) return 1;
  if (cellPixels < TIER_BOUNDARIES[2]) return 2;
  return 3;
}

export function createViewport(cols, rows, canvasWidth, canvasHeight) {
  // For pointy-top hex: width = sqrt(3) * size, row spacing = 1.5 * size
  // cellPixels = hex width = sqrt(3) * size, so size = cellPixels / sqrt(3)
  // Total map width ≈ cols * cellPixels (+ 0.5 for odd-row stagger)
  // Total map height ≈ rows * 1.5 * size + 0.5 * size = rows * cellPixels * 1.5/sqrt(3) + ...
  // Simplified: fit both axes
  const fitW = canvasWidth / (cols + 0.5);  // account for odd-row stagger
  const fitH = canvasHeight / (rows * 1.5 / SQRT3 + 0.5 / SQRT3);
  // Ensure we start at least in Tier 1 (Operational) where hex shapes are visible.
  // For large maps this means the user won't see the whole map, but the minimap handles orientation.
  const cellPixels = Math.max(Math.min(fitW, fitH) * 0.95, 6);
  return {
    centerCol: cols / 2,
    centerRow: rows / 2,
    cellPixels: clampCellPixels(cellPixels),
  };
}

export function clampCellPixels(cp) {
  return Math.max(MIN_CELL_PIXELS, Math.min(MAX_CELL_PIXELS, cp));
}

export function getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows) {
  // Compute a conservative rectangular bounding box of visible cells
  const size = cellPixelsToHexSize(viewport.cellPixels);
  const colSpacing = size * SQRT3;
  const rowSpacing = size * 1.5;
  const halfW = (canvasWidth / 2) / colSpacing + 1;
  const halfH = (canvasHeight / 2) / rowSpacing + 1;
  return {
    colMin: Math.max(0, Math.floor(viewport.centerCol - halfW)),
    colMax: Math.min(cols, Math.ceil(viewport.centerCol + halfW)),
    rowMin: Math.max(0, Math.floor(viewport.centerRow - halfH)),
    rowMax: Math.min(rows, Math.ceil(viewport.centerRow + halfH)),
  };
}

// Convert a screen pixel position to grid coordinates (floating point)
export function screenToGrid(screenX, screenY, viewport, canvasWidth, canvasHeight) {
  return screenToGridHex(screenX, screenY, viewport, canvasWidth, canvasHeight);
}

// Convert a screen pixel position to integer cell coordinates, or null if out of bounds
export function screenToCell(screenX, screenY, viewport, canvasWidth, canvasHeight, cols, rows) {
  return screenToHex(screenX, screenY, viewport, canvasWidth, canvasHeight, cols, rows);
}

// Convert grid coordinates to screen pixel position (cell center)
export function gridToScreen(col, row, viewport, canvasWidth, canvasHeight) {
  return hexToScreen(col, row, viewport, canvasWidth, canvasHeight);
}

// Compute the new viewport after a zoom operation centered on a screen point
export function zoomAtPoint(viewport, screenX, screenY, canvasWidth, canvasHeight, factor) {
  const newCellPixels = clampCellPixels(viewport.cellPixels * factor);
  // The grid point under the cursor should stay at the same screen position
  // Get the world pixel of the cursor
  const size = cellPixelsToHexSize(viewport.cellPixels);
  const cpx = size * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
  const cpy = size * 1.5 * viewport.centerRow;
  const wx = screenX - canvasWidth / 2 + cpx;
  const wy = screenY - canvasHeight / 2 + cpy;
  // Now compute what centerCol/centerRow should be so (wx, wy) maps to (screenX, screenY) at new zoom.
  // wx, wy were computed at the old hex size; world pixels scale linearly
  // with size, so rescale them to the new size first.
  const newSize = cellPixelsToHexSize(newCellPixels);
  const scale = newSize / size;
  const newCpx = wx * scale - (screenX - canvasWidth / 2);
  const newCpy = wy * scale - (screenY - canvasHeight / 2);
  // Reverse: cpx = newSize * sqrt3 * (centerCol + 0.5*(round(centerRow)&1))
  //          cpy = newSize * 1.5 * centerRow
  const newCenterRow = newCpy / (newSize * 1.5);
  const parity = Math.round(newCenterRow) & 1;
  const newCenterCol = newCpx / (newSize * SQRT3) - 0.5 * parity;
  return {
    centerCol: newCenterCol,
    centerRow: newCenterRow,
    cellPixels: newCellPixels,
  };
}

// Compute the new viewport after a pan (drag) operation
export function panViewport(viewport, deltaScreenX, deltaScreenY) {
  const size = cellPixelsToHexSize(viewport.cellPixels);
  return {
    ...viewport,
    centerCol: viewport.centerCol - deltaScreenX / (size * SQRT3),
    centerRow: viewport.centerRow - deltaScreenY / (size * 1.5),
  };
}

// Chunk math — given tier, determine chunk size in cells and get chunk key for a cell
const CHUNK_SIZES = [64, 16, 8, 4]; // cells per chunk per tier

export function getChunkSize(tier) {
  return CHUNK_SIZES[tier] || 8;
}

// Adaptive chunk sizes based on map dimensions
export function getAdaptiveChunkSize(tier, cols, rows) {
  const maxDim = Math.max(cols, rows);
  if (maxDim <= 100) return CHUNK_SIZES[tier];
  if (maxDim <= 300) {
    return [64, 24, 12, 4][tier] || 12;
  }
  return [128, 32, 16, 8][tier] || 16;
}

export function cellToChunk(col, row, chunkSize) {
  return {
    chunkCol: Math.floor(col / chunkSize),
    chunkRow: Math.floor(row / chunkSize),
  };
}

export function getVisibleChunks(viewport, canvasWidth, canvasHeight, cols, rows, tier) {
  const chunkSize = getAdaptiveChunkSize(tier, cols, rows);
  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
  const chunks = [];
  const cMin = Math.floor(range.colMin / chunkSize);
  const cMax = Math.ceil(range.colMax / chunkSize);
  const rMin = Math.floor(range.rowMin / chunkSize);
  const rMax = Math.ceil(range.rowMax / chunkSize);
  for (let cr = rMin; cr < rMax; cr++) {
    for (let cc = cMin; cc < cMax; cc++) {
      chunks.push({
        chunkCol: cc,
        chunkRow: cr,
        colStart: cc * chunkSize,
        rowStart: cr * chunkSize,
        colEnd: Math.min((cc + 1) * chunkSize, cols),
        rowEnd: Math.min((cr + 1) * chunkSize, rows),
        chunkSize,
      });
    }
  }
  return chunks;
}
