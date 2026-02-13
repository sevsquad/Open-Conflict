// ════════════════════════════════════════════════════════════════
// TerrainBlend — terrain edge blending for Tier 3
// ════════════════════════════════════════════════════════════════

import { TC } from "../terrainColors.js";

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

// Blend margin rules — how far into the cell the blend extends (0.0–0.25)
// Hard natural boundaries get narrow blends, gradual transitions get wide
const BLEND_PAIRS = {
  "deep_water|open_ground": 0.10,
  "deep_water|farmland": 0.10,
  "deep_water|light_veg": 0.10,
  "coastal_water|open_ground": 0.10,
  "coastal_water|farmland": 0.10,
  "lake|open_ground": 0.08,
  "lake|farmland": 0.08,
  "river|open_ground": 0.12,

  "open_ground|farmland": 0.25,
  "open_ground|light_veg": 0.25,
  "light_veg|forest": 0.25,
  "forest|dense_forest": 0.25,
  "highland|mountain": 0.25,
  "farmland|light_veg": 0.25,
  "highland|open_ground": 0.20,
  "mountain|peak": 0.20,
  "mountain_forest|forest": 0.25,
  "mountain_forest|mountain": 0.20,

  "light_urban|open_ground": 0.15,
  "light_urban|dense_urban": 0.20,
  "light_urban|farmland": 0.15,
  "dense_urban|open_ground": 0.12,
};

function getBlendMargin(terrainA, terrainB) {
  if (terrainA === terrainB) return 0;
  const k1 = `${terrainA}|${terrainB}`;
  const k2 = `${terrainB}|${terrainA}`;
  return BLEND_PAIRS[k1] || BLEND_PAIRS[k2] || 0.15;
}

// Smoothstep for smooth interpolation
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Render a blended terrain chunk to an ImageData buffer
// chunk: { colStart, rowStart, colEnd, rowEnd }
// cellPixels: size of each cell in the output
// cells: the map cells object
export function renderBlendedChunk(chunk, cellPixels, cells) {
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;
  const width = Math.ceil(chunkCols * cellPixels);
  const height = Math.ceil(chunkRows * cellPixels);

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Which cell is this pixel in?
      const localCol = px / cellPixels;
      const localRow = py / cellPixels;
      const col = chunk.colStart + Math.floor(localCol);
      const row = chunk.rowStart + Math.floor(localRow);

      // Fractional position within the cell (0..1)
      const u = localCol - Math.floor(localCol);
      const v = localRow - Math.floor(localRow);

      const cell = cells[`${col},${row}`];
      if (!cell) {
        const idx = (py * width + px) * 4;
        data[idx] = 17; data[idx + 1] = 17; data[idx + 2] = 17; data[idx + 3] = 255;
        continue;
      }

      const baseRGB = getTerrainRGB(cell.terrain);
      let r = baseRGB.r, g = baseRGB.g, b = baseRGB.b;

      // Blend with neighbors at edges
      const neighbors = [
        { du: 0, dv: -1, dc: 0, dr: -1 },  // North
        { du: 0, dv: 1, dc: 0, dr: 1 },     // South
        { du: -1, dv: 0, dc: -1, dr: 0 },   // West
        { du: 1, dv: 0, dc: 1, dr: 0 },     // East
      ];

      for (const n of neighbors) {
        const nc = col + n.dc;
        const nr = row + n.dr;
        const nCell = cells[`${nc},${nr}`];
        if (!nCell || nCell.terrain === cell.terrain) continue;

        const margin = getBlendMargin(cell.terrain, nCell.terrain);
        if (margin <= 0) continue;

        // Distance to this edge (0 at edge, 1 at center)
        let dist;
        if (n.dc === 0 && n.dr === -1) dist = v;          // North: distance = v (0 at top)
        else if (n.dc === 0 && n.dr === 1) dist = 1 - v;   // South: distance = 1-v (0 at bottom)
        else if (n.dc === -1 && n.dr === 0) dist = u;       // West: distance = u (0 at left)
        else dist = 1 - u;                                   // East: distance = 1-u (0 at right)

        if (dist >= margin) continue;

        const blendFactor = (1 - smoothstep(0, margin, dist)) * 0.5;
        const nRGB = getTerrainRGB(nCell.terrain);
        r += (nRGB.r - r) * blendFactor;
        g += (nRGB.g - g) * blendFactor;
        b += (nRGB.b - b) * blendFactor;
      }

      // Diagonal neighbor blending (corners, weaker)
      const diagonals = [
        { dc: -1, dr: -1, checkU: u, checkV: v },           // NW
        { dc: 1, dr: -1, checkU: 1 - u, checkV: v },        // NE
        { dc: -1, dr: 1, checkU: u, checkV: 1 - v },        // SW
        { dc: 1, dr: 1, checkU: 1 - u, checkV: 1 - v },     // SE
      ];

      for (const d of diagonals) {
        const nc = col + d.dc;
        const nr = row + d.dr;
        const nCell = cells[`${nc},${nr}`];
        if (!nCell || nCell.terrain === cell.terrain) continue;

        const margin = getBlendMargin(cell.terrain, nCell.terrain) * 0.7;
        if (margin <= 0) continue;

        const cornerDist = Math.sqrt(d.checkU * d.checkU + d.checkV * d.checkV) / Math.SQRT2;
        if (cornerDist >= margin) continue;

        const blendFactor = (1 - smoothstep(0, margin, cornerDist)) * 0.25;
        const nRGB = getTerrainRGB(nCell.terrain);
        r += (nRGB.r - r) * blendFactor;
        g += (nRGB.g - g) * blendFactor;
        b += (nRGB.b - b) * blendFactor;
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

// Render elevation shading overlay (pseudo-3D relief)
export function applyElevationShading(ctx, chunk, cellPixels, cells) {
  for (let row = chunk.rowStart; row < chunk.rowEnd; row++) {
    for (let col = chunk.colStart; col < chunk.colEnd; col++) {
      const cell = cells[`${col},${row}`];
      if (!cell || cell.elevation === undefined) continue;

      const northCell = cells[`${col},${row - 1}`];
      const southCell = cells[`${col},${row + 1}`];

      const lx = (col - chunk.colStart) * cellPixels;
      const ly = (row - chunk.rowStart) * cellPixels;

      // Northern highlight (cell is higher than north neighbor)
      if (northCell && northCell.elevation !== undefined) {
        const diff = cell.elevation - northCell.elevation;
        if (diff > 10) {
          const intensity = Math.min(0.15, diff / 500);
          ctx.fillStyle = `rgba(255,255,220,${intensity})`;
          ctx.fillRect(lx, ly, cellPixels, cellPixels * 0.15);
        }
      }

      // Southern shadow (cell is higher than south neighbor)
      if (southCell && southCell.elevation !== undefined) {
        const diff = cell.elevation - southCell.elevation;
        if (diff > 10) {
          const intensity = Math.min(0.15, diff / 500);
          ctx.fillStyle = `rgba(0,0,0,${intensity})`;
          ctx.fillRect(lx, ly + cellPixels * 0.85, cellPixels, cellPixels * 0.15);
        }
      }
    }
  }
}
