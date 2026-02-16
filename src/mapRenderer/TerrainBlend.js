// ════════════════════════════════════════════════════════════════
// TerrainBlend — terrain edge blending for Tier 3 (hex grid)
// Per-pixel blending across hex edges with 6-neighbor interpolation
// ════════════════════════════════════════════════════════════════

import { TC } from "../terrainColors.js";
import {
  hexChunkLayout, chunkHexCenter, getNeighbors,
  hexVertices, cellPixelsToHexSize, SQRT3,
} from "./HexMath.js";

// Parse hex color to {r, g, b}
function parseColor(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// Terrain color cache (avoids repeated parsing)
const COLOR_CACHE = {};
function getTerrainRGB(terrain) {
  if (!COLOR_CACHE[terrain]) {
    COLOR_CACHE[terrain] = parseColor(TC[terrain] || "#222222");
  }
  return COLOR_CACHE[terrain];
}

// Category-based blend margins — terrain types grouped by visual transition behavior
const WATER_TYPES = new Set(["deep_water", "coastal_water", "lake", "river"]);
const FOREST_TYPES = new Set(["forest", "dense_forest", "mountain_forest"]);
const URBAN_TYPES = new Set(["light_urban", "dense_urban"]);
const ELEVATION_TYPES = new Set(["highland", "mountain", "peak"]);
const OPEN_TYPES = new Set(["open_ground", "farmland", "light_veg", "desert", "wetland", "ice"]);

function getBaseBlendMargin(terrainA, terrainB) {
  if (terrainA === terrainB) return 0;
  const aWater = WATER_TYPES.has(terrainA), bWater = WATER_TYPES.has(terrainB);
  const aForest = FOREST_TYPES.has(terrainA), bForest = FOREST_TYPES.has(terrainB);
  const aUrban = URBAN_TYPES.has(terrainA), bUrban = URBAN_TYPES.has(terrainB);
  const aElev = ELEVATION_TYPES.has(terrainA), bElev = ELEVATION_TYPES.has(terrainB);

  // Water-land boundary: sharp edge
  if (aWater !== bWater) return 0.10;
  // Same category: very gradual
  if (aForest && bForest) return 0.25;
  if (aUrban && bUrban) return 0.20;
  if (aElev && bElev) return 0.25;
  // Forest-open transition: gradual
  if ((aForest && !bWater && !bUrban) || (bForest && !aWater && !aUrban)) return 0.22;
  // Elevation-natural: gradual
  if ((aElev && !bWater && !bUrban) || (bElev && !aWater && !aUrban)) return 0.20;
  // Urban-natural: moderate
  if (aUrban || bUrban) return 0.14;
  // Open-open (farmland↔open_ground, etc): gradual
  return 0.18;
}

function getBlendMargin(terrainA, terrainB, cellPixels, confA, confB) {
  let margin = getBaseBlendMargin(terrainA, terrainB);
  if (margin === 0) return 0;

  // Scale adjustment: small cells = sharper real-world transitions, large cells = more mixing
  if (cellPixels !== undefined) {
    if (cellPixels >= 32) margin *= 0.7;       // sub-tactical: sharper
    else if (cellPixels < 3) margin *= 1.2;    // strategic: wider
  }

  // Confidence adjustment: widen blend for uncertain classifications
  if (confA !== undefined && confB !== undefined) {
    const minConf = Math.min(confA, confB);
    margin *= (2.0 - minConf); // low confidence → wider blend (up to 2x)
  }

  return Math.min(0.30, margin); // cap at 30% of hex
}

// Smoothstep for smooth interpolation
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Signed distance from point (px, py) to a line segment (v0 → v1).
// Returns positive if the point is on the interior side of the edge.
// For a convex hex with vertices in order, interior is to the right of each edge.
function edgeDistance(px, py, v0, v1) {
  const ex = v1.x - v0.x;
  const ey = v1.y - v0.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len === 0) return 0;
  // Normal pointing inward (right of edge direction for CW vertex order)
  // Pointy-top hexVertices go CW, so right normal = inward
  return ((px - v0.x) * (-ey) + (py - v0.y) * ex) / len;
}

// Render a blended terrain chunk to an OffscreenCanvas using hex geometry
export function renderBlendedChunk(chunk, cellPixels, cells) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { width, height, size } = layout;
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  // Precompute hex centers and vertices for all cells in chunk
  const centerCache = {};
  const vertCache = {};
  for (let lr = 0; lr < chunkRows; lr++) {
    const row = chunk.rowStart + lr;
    for (let lc = 0; lc < chunkCols; lc++) {
      const col = chunk.colStart + lc;
      const key = `${col},${row}`;
      const c = chunkHexCenter(col, row, layout);
      centerCache[key] = c;
      vertCache[key] = hexVertices(c.x, c.y, size);
    }
  }

  // The apothem (inner radius) = distance from center to edge midpoint
  const apothem = size * SQRT3 / 2;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Find which cell this pixel belongs to by checking nearest hex center
      // Approximate: compute rough cell from pixel position, then check neighbors
      let bestKey = null;
      let bestDistSq = Infinity;

      // Estimate cell from pixel position (reverse of chunkHexCenter)
      const estRow = Math.round((py - layout.padY) / (size * 1.5)) + chunk.rowStart;
      const stagger = (estRow & 1) ? 0.5 : 0;
      const startStagger = (chunk.rowStart & 1) ? 0.5 : 0;
      const estCol = Math.round((px - layout.padX) / (size * SQRT3) - stagger + startStagger) + chunk.colStart;

      // Check estimated cell and its immediate neighbors
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const tr = estRow + dr;
          const tc = estCol + dc;
          const key = `${tc},${tr}`;
          const c = centerCache[key];
          if (!c) continue;
          const dx = px - c.x;
          const dy = py - c.y;
          const d = dx * dx + dy * dy;
          if (d < bestDistSq) {
            bestDistSq = d;
            bestKey = key;
          }
        }
      }

      if (!bestKey) {
        // Pixel outside all cells — transparent
        const idx = (py * width + px) * 4;
        data[idx + 3] = 0;
        continue;
      }

      const cell = cells[bestKey];
      if (!cell) {
        const idx = (py * width + px) * 4;
        data[idx] = 17; data[idx + 1] = 17; data[idx + 2] = 17; data[idx + 3] = 255;
        continue;
      }

      const baseRGB = getTerrainRGB(cell.terrain);
      let r = baseRGB.r, g = baseRGB.g, b = baseRGB.b;

      // Get this cell's vertices and neighbors for edge blending
      const verts = vertCache[bestKey];
      const center = centerCache[bestKey];
      const parts = bestKey.split(",");
      const col = parseInt(parts[0]);
      const row = parseInt(parts[1]);
      const neighborCoords = getNeighbors(col, row);

      // Distance from pixel to hex center (normalized by apothem)
      const dxC = px - center.x;
      const dyC = py - center.y;
      const distFromCenter = Math.sqrt(dxC * dxC + dyC * dyC) / apothem;

      // Blend with each of the 6 neighbors at their shared edge
      if (verts) {
        for (let i = 0; i < 6; i++) {
          const [nc, nr] = neighborCoords[i];
          const nCell = cells[`${nc},${nr}`];
          if (!nCell || nCell.terrain === cell.terrain) continue;

          const margin = getBlendMargin(cell.terrain, nCell.terrain, cellPixels, cell.confidence, nCell.confidence);
          if (margin <= 0) continue;

          // Distance from pixel to this hex edge (signed, positive = inside)
          const v0 = verts[i];
          const v1 = verts[(i + 1) % 6];
          const dist = edgeDistance(px, py, v0, v1);
          // Normalize by apothem so margin is relative to hex size
          const normDist = dist / apothem;

          if (normDist >= margin) continue;
          if (normDist < 0) continue; // outside hex on this edge

          const blendFactor = (1 - smoothstep(0, margin, normDist)) * 0.5;
          const nRGB = getTerrainRGB(nCell.terrain);
          r += (nRGB.r - r) * blendFactor;
          g += (nRGB.g - g) * blendFactor;
          b += (nRGB.b - b) * blendFactor;
        }
      }

      const idx = (py * width + px) * 4;
      data[idx] = Math.round(r);
      data[idx + 1] = Math.round(g);
      data[idx + 2] = Math.round(b);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Render elevation shading overlay (pseudo-3D relief) for hex grid
export function applyElevationShading(ctx, chunk, cellPixels, cells) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { size } = layout;

  for (let row = chunk.rowStart; row < chunk.rowEnd; row++) {
    for (let col = chunk.colStart; col < chunk.colEnd; col++) {
      const cell = cells[`${col},${row}`];
      if (!cell || cell.elevation === undefined) continue;

      const center = chunkHexCenter(col, row, layout);
      const neighbors = getNeighbors(col, row);

      // Check NW and NE neighbors (indices 2, 1 in hex dirs) for northern highlight
      // Check SW and SE neighbors (indices 4, 5) for southern shadow
      const northIdxs = [1, 2]; // NE, NW
      const southIdxs = [4, 5]; // SW, SE

      let northDiff = 0;
      let northCount = 0;
      for (const ni of northIdxs) {
        const [nc, nr] = neighbors[ni];
        const nCell = cells[`${nc},${nr}`];
        if (nCell && nCell.elevation !== undefined) {
          northDiff += cell.elevation - nCell.elevation;
          northCount++;
        }
      }

      let southDiff = 0;
      let southCount = 0;
      for (const si of southIdxs) {
        const [nc, nr] = neighbors[si];
        const nCell = cells[`${nc},${nr}`];
        if (nCell && nCell.elevation !== undefined) {
          southDiff += cell.elevation - nCell.elevation;
          southCount++;
        }
      }

      if (northCount > 0) {
        const diff = northDiff / northCount;
        if (diff > 10) {
          const intensity = Math.min(0.15, diff / 500);
          ctx.fillStyle = `rgba(255,255,220,${intensity})`;
          // Highlight top portion of hex
          ctx.save();
          ctx.beginPath();
          ctx.rect(center.x - size, center.y - size, size * 2, size * 0.5);
          ctx.clip();
          ctx.beginPath();
          ctx.arc(center.x, center.y, size * 0.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (southCount > 0) {
        const diff = southDiff / southCount;
        if (diff > 10) {
          const intensity = Math.min(0.15, diff / 500);
          ctx.fillStyle = `rgba(0,0,0,${intensity})`;
          // Shadow bottom portion of hex
          ctx.save();
          ctx.beginPath();
          ctx.rect(center.x - size, center.y + size * 0.5, size * 2, size * 0.5);
          ctx.clip();
          ctx.beginPath();
          ctx.arc(center.x, center.y, size * 0.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
}
