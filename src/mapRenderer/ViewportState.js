// ════════════════════════════════════════════════════════════════
// ViewportState — viewport math, visible range, pixel-to-cell
// ════════════════════════════════════════════════════════════════

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
  const cellPixels = Math.min(canvasWidth / cols, canvasHeight / rows) * 0.95;
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
  const halfW = (canvasWidth / 2) / viewport.cellPixels;
  const halfH = (canvasHeight / 2) / viewport.cellPixels;
  return {
    colMin: Math.max(0, Math.floor(viewport.centerCol - halfW)),
    colMax: Math.min(cols, Math.ceil(viewport.centerCol + halfW)),
    rowMin: Math.max(0, Math.floor(viewport.centerRow - halfH)),
    rowMax: Math.min(rows, Math.ceil(viewport.centerRow + halfH)),
  };
}

// Convert a screen pixel position to grid coordinates (floating point)
export function screenToGrid(screenX, screenY, viewport, canvasWidth, canvasHeight) {
  const col = viewport.centerCol + (screenX - canvasWidth / 2) / viewport.cellPixels;
  const row = viewport.centerRow + (screenY - canvasHeight / 2) / viewport.cellPixels;
  return { col, row };
}

// Convert a screen pixel position to integer cell coordinates, or null if out of bounds
export function screenToCell(screenX, screenY, viewport, canvasWidth, canvasHeight, cols, rows) {
  const { col, row } = screenToGrid(screenX, screenY, viewport, canvasWidth, canvasHeight);
  const c = Math.floor(col);
  const r = Math.floor(row);
  if (c >= 0 && c < cols && r >= 0 && r < rows) return { c, r };
  return null;
}

// Convert grid coordinates to screen pixel position
export function gridToScreen(col, row, viewport, canvasWidth, canvasHeight) {
  const x = (col - viewport.centerCol) * viewport.cellPixels + canvasWidth / 2;
  const y = (row - viewport.centerRow) * viewport.cellPixels + canvasHeight / 2;
  return { x, y };
}

// Compute the new viewport after a zoom operation centered on a screen point
export function zoomAtPoint(viewport, screenX, screenY, canvasWidth, canvasHeight, factor) {
  const newCellPixels = clampCellPixels(viewport.cellPixels * factor);
  // The grid point under the cursor should stay at the same screen position
  const gridPt = screenToGrid(screenX, screenY, viewport, canvasWidth, canvasHeight);
  return {
    centerCol: gridPt.col - (screenX - canvasWidth / 2) / newCellPixels,
    centerRow: gridPt.row - (screenY - canvasHeight / 2) / newCellPixels,
    cellPixels: newCellPixels,
  };
}

// Compute the new viewport after a pan (drag) operation
export function panViewport(viewport, deltaScreenX, deltaScreenY) {
  return {
    ...viewport,
    centerCol: viewport.centerCol - deltaScreenX / viewport.cellPixels,
    centerRow: viewport.centerRow - deltaScreenY / viewport.cellPixels,
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
    // Medium maps: slightly larger chunks at Tier 1-2 for fewer cache entries
    return [64, 24, 12, 4][tier] || 12;
  }
  // Large maps: larger chunks to limit total tile count
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
