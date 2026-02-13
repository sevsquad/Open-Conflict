// ════════════════════════════════════════════════════════════════
// StrategicRenderer — Tier 0 (1–3 px/cell): ImageData pixel-level
// Satellite-photo view: each cell is 1–3 pixels
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";

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
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;
  const cpx = Math.max(1, Math.round(cellPixels));
  const width = chunkCols * cpx;
  const height = chunkRows * cpx;

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const fallback = [34, 34, 34]; // #222

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

      // Fill the cell's pixel block
      const startPx = localCol * cpx;
      const startPy = localRow * cpx;
      for (let py = startPy; py < startPy + cpx && py < height; py++) {
        for (let px = startPx; px < startPx + cpx && px < width; px++) {
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
            const cx = startPx + Math.floor(cpx / 2);
            const cy = startPy + Math.floor(cpx / 2);
            if (cx < width && cy < height) {
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
  const ratio = rows / cols;
  const mw = ratio > 1 ? Math.round(maxDim / ratio) : maxDim;
  const mh = ratio > 1 ? maxDim : Math.round(maxDim * ratio);
  const canvas = new OffscreenCanvas(mw, mh);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(mw, mh);
  const data = imgData.data;
  const fallback = [34, 34, 34];

  const cpw = mw / cols;
  const cph = mh / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[`${c},${r}`];
      const rgb = cell ? (TC_RGB[cell.terrain] || fallback) : fallback;
      const x0 = Math.floor(c * cpw);
      const y0 = Math.floor(r * cph);
      const x1 = Math.floor((c + 1) * cpw);
      const y1 = Math.floor((r + 1) * cph);
      for (let py = y0; py < y1 && py < mh; py++) {
        for (let px = x0; px < x1 && px < mw; px++) {
          const idx = (py * mw + px) * 4;
          data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
