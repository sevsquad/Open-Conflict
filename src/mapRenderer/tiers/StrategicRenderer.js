// ════════════════════════════════════════════════════════════════
// StrategicRenderer — Tier 0 (1–3 px/cell): ImageData pixel-level
// Satellite-photo view: each cell is 1–3 pixels (hex grid)
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";
import { hexChunkLayout, chunkHexCenter, cellPixelsToHexSize, SQRT3 } from "../HexMath.js";

// Pre-parse terrain colors to RGB arrays for fast pixel ops
const TC_RGB = {};
for (const [k, hex] of Object.entries(TC)) {
  const h = hex.replace("#", "");
  TC_RGB[k] = [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

const FC_RGB = {};
for (const [k, hex] of Object.entries(FC)) {
  const h = hex.replace("#", "");
  FC_RGB[k] = [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

// Feature priority (highest = shown when cell is only 1 dot)
const FEAT_PRIORITY = {
  military_base: 10, airfield: 9, port: 8, power_plant: 7, chokepoint: 6,
  highway: 5, major_road: 4, railway: 4, town: 3, dam: 3,
  navigable_waterway: 2, road: 1,
};

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

function topFeature(cell) {
  const feats = getFeats(cell);
  if (feats.length === 0) return null;
  let best = null, bestP = -1;
  for (const f of feats) {
    const p = FEAT_PRIORITY[f] || 0;
    if (p > bestP) { bestP = p; best = f; }
  }
  return best;
}

// Render a chunk at strategic scale using ImageData direct pixel manipulation
// Returns an OffscreenCanvas
export function renderStrategicChunk(chunk, cellPixels, cells, activeFeatures) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { width, height, size } = layout;
  const cpx = Math.max(1, Math.round(cellPixels));

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const fallback = [34, 34, 34]; // #222
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];

      // Base terrain color
      const rgb = cell ? (TC_RGB[cell.terrain] || fallback) : fallback;

      // Feature tinting: modify pixel color based on top feature
      let fr = rgb[0], fg = rgb[1], fb = rgb[2];
      if (cell && cpx <= 2 && activeFeatures) {
        const feat = topFeature(cell);
        if (feat && activeFeatures.has(feat)) {
          const frgb = FC_RGB[feat];
          if (frgb) {
            // Subtle tint: blend 20% of feature color into terrain
            fr = Math.round(fr * 0.8 + frgb[0] * 0.2);
            fg = Math.round(fg * 0.8 + frgb[1] * 0.2);
            fb = Math.round(fb * 0.8 + frgb[2] * 0.2);
          }
        }
      }

      // Fill hex-shaped pixel region (pointy-top) instead of square
      const center = chunkHexCenter(col, row, layout);
      const cx = center.x, cy = center.y;
      const hh = Math.ceil(size) + 1; // half-height scan range

      for (let dy = -hh; dy <= hh; dy++) {
        const py = Math.round(cy) + dy;
        if (py < 0 || py >= height) continue;
        const ady = Math.abs(py - cy);
        if (ady > size + 0.5) continue;
        // Pointy-top hex half-width at this y offset:
        //   middle band (|dy| ≤ s/2): hw = √3/2 * s
        //   taper zone (|dy| > s/2):  hw = √3 * (s - |dy|)
        const rowHW = ady <= size * 0.5
          ? SQRT3 * 0.5 * size
          : SQRT3 * (size - ady);
        if (rowHW < 0) continue;
        const x0 = Math.max(0, Math.ceil(cx - rowHW - 0.49));
        const x1 = Math.min(width - 1, Math.floor(cx + rowHW + 0.49));
        for (let px = x0; px <= x1; px++) {
          const idx = (py * width + px) * 4;
          data[idx] = fr;
          data[idx + 1] = fg;
          data[idx + 2] = fb;
          data[idx + 3] = 255;
        }
      }

      // At 2-3px: draw feature dot at center
      if (cpx >= 2 && cell && activeFeatures) {
        const feat = topFeature(cell);
        if (feat && activeFeatures.has(feat)) {
          const frgb = FC_RGB[feat];
          if (frgb) {
            const cx = Math.round(center.x);
            const cy = Math.round(center.y);
            if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
              const idx = (cy * width + cx) * 4;
              data[idx] = frgb[0];
              data[idx + 1] = frgb[1];
              data[idx + 2] = frgb[2];
              data[idx + 3] = 255;
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Render the full map at strategic scale (for minimap use)
export function renderStrategicFullMap(cols, rows, cells, maxDim = 150) {
  // Compute pixel dimensions based on hex layout
  const ratio = rows / cols;
  const mw = ratio > 1 ? Math.round(maxDim / ratio) : maxDim;
  const mh = ratio > 1 ? maxDim : Math.round(maxDim * ratio);
  const canvas = new OffscreenCanvas(mw, mh);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(mw, mh);
  const data = imgData.data;
  const fallback = [34, 34, 34];

  // Compute a hex size that makes the map fit in the minimap
  // Map width in hex-pixels ≈ (cols + 0.5) * sqrt(3) * size
  // Map height in hex-pixels ≈ (rows - 1) * 1.5 * size + 2 * size
  // Solve for size:
  const sizeW = mw / (SQRT3 * (cols + 0.5));
  const sizeH = mh / (1.5 * (rows - 1) + 2);
  const size = Math.min(sizeW, sizeH);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[`${c},${r}`];
      const rgb = cell ? (TC_RGB[cell.terrain] || fallback) : fallback;
      // Hex center position in minimap pixels
      const px = size * SQRT3 * (c + 0.5 * (r & 1));
      const py = size * 1.5 * r + size; // +size offset so row 0 isn't clipped
      // Fill hex-shaped region (pointy-top) instead of rectangular block
      const mmHH = Math.ceil(size) + 1;
      for (let dy = -mmHH; dy <= mmHH; dy++) {
        const iy = Math.round(py) + dy;
        if (iy < 0 || iy >= mh) continue;
        const ady = Math.abs(iy - py);
        if (ady > size + 0.5) continue;
        const rowHW = ady <= size * 0.5
          ? SQRT3 * 0.5 * size
          : SQRT3 * (size - ady);
        if (rowHW < 0) continue;
        const ix0 = Math.max(0, Math.ceil(px - rowHW - 0.49));
        const ix1 = Math.min(mw - 1, Math.floor(px + rowHW + 0.49));
        for (let ix = ix0; ix <= ix1; ix++) {
          const idx = (iy * mw + ix) * 4;
          data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
