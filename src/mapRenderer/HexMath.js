// ════════════════════════════════════════════════════════════════
// HexMath — hex grid coordinate conversions, neighbors, distance,
//           line drawing, and rendering geometry (pointy-top, odd-r)
// ════════════════════════════════════════════════════════════════

const SQRT3 = Math.sqrt(3);
const SQRT3_2 = SQRT3 / 2;   // ≈ 0.866

// ── Coordinate conversions (odd-r offset ↔ axial) ───────────

export function offsetToAxial(col, row) {
  const q = col - (row - (row & 1)) / 2;
  return { q, r: row };
}

export function axialToOffset(q, r) {
  const col = q + (r - (r & 1)) / 2;
  return { col, row: r };
}

// ── Rounding fractional axial coords to nearest hex ─────────

export function roundHex(q, r) {
  let s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// ── Hex ↔ pixel (pointy-top, axial) ─────────────────────────
// "size" = distance from hex center to any vertex (outer radius)

export function hexToPixel(q, r, size) {
  const x = size * (SQRT3 * q + SQRT3_2 * r);
  const y = size * (1.5 * r);
  return { x, y };
}

export function pixelToHex(px, py, size) {
  const q = (SQRT3 / 3 * px - py / 3) / size;
  const r = (2 / 3 * py) / size;
  return roundHex(q, r);
}

// ── Hex ↔ pixel (pointy-top, offset coords) ─────────────────
// Convenience: offset (col, row) → pixel center, using hex size

export function offsetToPixel(col, row, size) {
  const x = size * SQRT3 * (col + 0.5 * (row & 1));
  const y = size * 1.5 * row;
  return { x, y };
}

export function pixelToOffset(px, py, size) {
  // Go through axial
  const ax = pixelToHex(px, py, size);
  return axialToOffset(ax.q, ax.r);
}

// ── Neighbors (6-connected) ─────────────────────────────────

// Axial neighbor directions
export const HEX_DIRS_AXIAL = [
  { q: 1, r: 0 },   // E
  { q: 1, r: -1 },  // NE
  { q: 0, r: -1 },  // NW
  { q: -1, r: 0 },  // W
  { q: -1, r: 1 },  // SW
  { q: 0, r: 1 },   // SE
];

export function getNeighborsAxial(q, r) {
  return HEX_DIRS_AXIAL.map(d => ({ q: q + d.q, r: r + d.r }));
}

// Offset neighbor deltas (odd-r): differ by row parity
const ODD_R_EVEN = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const ODD_R_ODD  = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

export function getNeighbors(col, row) {
  const dirs = (row & 1) ? ODD_R_ODD : ODD_R_EVEN;
  return dirs.map(([dc, dr]) => [col + dc, row + dr]);
}

export function getNeighborKeys(col, row) {
  const dirs = (row & 1) ? ODD_R_ODD : ODD_R_EVEN;
  return dirs.map(([dc, dr]) => `${col + dc},${row + dr}`);
}

// ── Distance ─────────────────────────────────────────────────

export function hexDistanceAxial(q1, r1, q2, r2) {
  const dq = q1 - q2, dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function hexDistance(col1, row1, col2, row2) {
  const a = offsetToAxial(col1, row1);
  const b = offsetToAxial(col2, row2);
  return hexDistanceAxial(a.q, a.r, b.q, b.r);
}

// ── Line drawing (hex lerp) ─────────────────────────────────

export function hexLineAxial(q1, r1, q2, r2) {
  const dist = hexDistanceAxial(q1, r1, q2, r2);
  if (dist === 0) return [{ q: q1, r: r1 }];
  const results = [];
  for (let i = 0; i <= dist; i++) {
    const t = i / dist;
    // Nudge by 1e-6 to avoid ambiguous rounding on exact boundaries
    results.push(roundHex(
      q1 + (q2 - q1) * t + 1e-6,
      r1 + (r2 - r1) * t + 1e-6
    ));
  }
  return results;
}

export function hexLine(col1, row1, col2, row2) {
  const a = offsetToAxial(col1, row1);
  const b = offsetToAxial(col2, row2);
  return hexLineAxial(a.q, a.r, b.q, b.r).map(h => axialToOffset(h.q, h.r));
}

// ── Range queries ────────────────────────────────────────────

export function hexRangeAxial(cq, cr, radius) {
  const results = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      results.push({ q: cq + q, r: cr + r });
    }
  }
  return results;
}

export function hexRange(col, row, radius) {
  const a = offsetToAxial(col, row);
  return hexRangeAxial(a.q, a.r, radius).map(h => axialToOffset(h.q, h.r));
}

// ── Rendering geometry ──────────────────────────────────────

// 6 vertices of a pointy-top hex centered at (cx, cy) with given size
export function hexVertices(cx, cy, size) {
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30); // pointy-top: first vertex at -30°
    verts.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return verts;
}

// Draw a hex path on a canvas context (does not stroke/fill — caller does that)
export function traceHexPath(ctx, cx, cy, size) {
  const verts = hexVertices(cx, cy, size);
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
}

// Create a reusable Path2D for a hex at (cx, cy)
export function hexPath2D(cx, cy, size) {
  const p = new Path2D();
  const verts = hexVertices(cx, cy, size);
  p.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 6; i++) p.lineTo(verts[i].x, verts[i].y);
  p.closePath();
  return p;
}

// Hex inner radius (apothem) = distance from center to edge midpoint
export function hexInnerRadius(size) {
  return size * SQRT3_2;
}

// ── Viewport integration helpers ────────────────────────────

// Hex size (outer radius) that makes the hex occupy ~cellPixels width
// For pointy-top: width = sqrt(3) * size, so size = cellPixels / sqrt(3)
export function cellPixelsToHexSize(cellPixels) {
  return cellPixels / SQRT3;
}

// Convert offset cell → screen pixel position (center of hex)
export function hexToScreen(col, row, viewport, canvasWidth, canvasHeight) {
  const size = cellPixelsToHexSize(viewport.cellPixels);
  // Pixel position of this hex relative to origin
  const px = size * SQRT3 * (col + 0.5 * (row & 1));
  const py = size * 1.5 * row;
  // Same for the viewport center cell
  const cpx = size * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
  const cpy = size * 1.5 * viewport.centerRow;
  return {
    x: px - cpx + canvasWidth / 2,
    y: py - cpy + canvasHeight / 2,
  };
}

// Convert screen pixel → offset cell (integer), or null if out of bounds
export function screenToHex(screenX, screenY, viewport, canvasWidth, canvasHeight, cols, rows) {
  const size = cellPixelsToHexSize(viewport.cellPixels);
  // Pixel position of the viewport center cell
  const cpx = size * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
  const cpy = size * 1.5 * viewport.centerRow;
  // World pixel
  const wx = screenX - canvasWidth / 2 + cpx;
  const wy = screenY - canvasHeight / 2 + cpy;
  // Convert to offset
  const { col, row } = pixelToOffset(wx, wy, size);
  if (col >= 0 && col < cols && row >= 0 && row < rows) return { c: col, r: row };
  return null;
}

// Convert screen pixel → floating-point grid position (for panning math)
export function screenToGridHex(screenX, screenY, viewport, canvasWidth, canvasHeight) {
  const size = cellPixelsToHexSize(viewport.cellPixels);
  const cpx = size * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
  const cpy = size * 1.5 * viewport.centerRow;
  const wx = screenX - canvasWidth / 2 + cpx;
  const wy = screenY - canvasHeight / 2 + cpy;
  // Return fractional offset coords
  const q = (SQRT3 / 3 * wx - wy / 3) / size;
  const r = (2 / 3 * wy) / size;
  const ax = roundHex(q, r);
  const off = axialToOffset(ax.q, ax.r);
  return { col: off.col, row: off.row };
}

// ── Hex grid spacing constants ──────────────────────────────

// Vertical distance between row centers (pointy-top)
export function hexRowSpacing(size) {
  return size * 1.5;
}

// Horizontal distance between column centers (pointy-top)
export function hexColSpacing(size) {
  return size * SQRT3;
}

// Pointy-top hex: height = 2 * size, width = sqrt(3) * size
export const HEX_HEIGHT_FACTOR = 2;
export const HEX_WIDTH_FACTOR = SQRT3;

// ── Chunk layout helpers (for tile-based renderers) ──────────

// Compute layout metrics for a rectangular chunk of hex cells.
// Returns { width, height, size, padX, padY, refX, refY } where:
//   width/height — canvas dimensions in pixels
//   size — hex outer radius
//   padX/padY — pixel offset of chunk origin cell's center within canvas
//   refX/refY — world pixel position of chunk origin cell's center
export function hexChunkLayout(chunk, cellPixels) {
  const size = cellPixelsToHexSize(cellPixels);
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  // World pixel position of the chunk's first cell center
  const refX = size * SQRT3 * (chunk.colStart + 0.5 * (chunk.rowStart & 1));
  const refY = size * 1.5 * chunk.rowStart;

  // Padding = size so edge hexes don't clip
  const padX = size;
  const padY = size;

  // Canvas size must fit all hex centers plus size-radius overshoot on all sides
  const colSpacing = size * SQRT3;
  const rowSpacing = size * 1.5;
  const maxStagger = 0.5 * colSpacing; // odd rows shift right by half
  const width = Math.ceil(
    (chunkCols > 1 ? (chunkCols - 1) * colSpacing : 0) + maxStagger + 2 * padX
  ) + 1;
  const height = Math.ceil(
    (chunkRows > 1 ? (chunkRows - 1) * rowSpacing : 0) + 2 * padY
  ) + 1;

  return { width: Math.max(1, width), height: Math.max(1, height), size, padX, padY, refX, refY };
}

// Get the local pixel center of a hex within a chunk canvas
export function chunkHexCenter(col, row, layout) {
  const { size, padX, padY, refX, refY } = layout;
  const wx = size * SQRT3 * (col + 0.5 * (row & 1));
  const wy = size * 1.5 * row;
  return { x: wx - refX + padX, y: wy - refY + padY };
}

// Export constants for external use
export { SQRT3, SQRT3_2 };
