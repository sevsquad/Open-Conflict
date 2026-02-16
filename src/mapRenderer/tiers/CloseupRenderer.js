// ════════════════════════════════════════════════════════════════
// CloseupRenderer — Tier 3 (32–64 px/cell): terrain blending + textures
// Maximum detail view with smooth terrain transitions (hex grid)
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";
import { renderBlendedChunk, applyElevationShading } from "../TerrainBlend.js";
import {
  hexChunkLayout, chunkHexCenter, traceHexPath, hexVertices,
} from "../HexMath.js";

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Terrain micro-patterns: tiny repeating visual textures per terrain type
// Each draws within the hex area around (cx, cy) with radius ~size
const MICRO_PATTERNS = {
  forest(ctx, cx, cy, size) {
    ctx.fillStyle = "rgba(0,60,0,0.12)";
    const step = Math.max(4, size / 3);
    for (let dy = -size * 0.7; dy < size * 0.7; dy += step) {
      for (let dx = -size * 0.7; dx < size * 0.7; dx += step) {
        const jx = dx + (Math.sin(dx * 7 + dy * 3) * step * 0.3);
        const jy = dy + (Math.cos(dx * 3 + dy * 7) * step * 0.3);
        if (jx * jx + jy * jy > size * size * 0.6) continue;
        ctx.beginPath();
        ctx.arc(cx + jx, cy + jy, Math.max(1, size * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  dense_forest(ctx, cx, cy, size) {
    ctx.fillStyle = "rgba(0,40,0,0.18)";
    const step = Math.max(3, size / 4);
    for (let dy = -size * 0.7; dy < size * 0.7; dy += step) {
      for (let dx = -size * 0.7; dx < size * 0.7; dx += step) {
        const jx = dx + (Math.sin(dx * 5 + dy * 11) * step * 0.25);
        const jy = dy + (Math.cos(dx * 11 + dy * 5) * step * 0.25);
        if (jx * jx + jy * jy > size * size * 0.6) continue;
        ctx.beginPath();
        ctx.arc(cx + jx, cy + jy, Math.max(1, size * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  farmland(ctx, cx, cy, size) {
    ctx.strokeStyle = "rgba(100,120,30,0.08)";
    ctx.lineWidth = 0.5;
    const step = Math.max(3, size / 4);
    for (let dy = -size * 0.6; dy < size * 0.6; dy += step) {
      const halfW = Math.sqrt(Math.max(0, size * size * 0.5 - dy * dy));
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cy + dy);
      ctx.lineTo(cx + halfW, cy + dy);
      ctx.stroke();
    }
  },

  light_urban(ctx, cx, cy, size) {
    ctx.strokeStyle = "rgba(80,70,60,0.10)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, size / 3);
    for (let dy = -size * 0.5; dy < size * 0.5; dy += step) {
      for (let dx = -size * 0.5; dx < size * 0.5; dx += step) {
        if (dx * dx + dy * dy > size * size * 0.4) continue;
        const sz = Math.max(2, step * 0.4);
        ctx.strokeRect(cx + dx - sz / 2, cy + dy - sz / 2, sz, sz);
      }
    }
  },

  dense_urban(ctx, cx, cy, size) {
    ctx.strokeStyle = "rgba(60,50,40,0.14)";
    ctx.lineWidth = 0.5;
    const step = Math.max(3, size / 4);
    for (let dy = -size * 0.6; dy < size * 0.6; dy += step) {
      for (let dx = -size * 0.6; dx < size * 0.6; dx += step) {
        if (dx * dx + dy * dy > size * size * 0.5) continue;
        const sz = Math.max(2, step * 0.5);
        ctx.strokeRect(cx + dx - sz / 2, cy + dy - sz / 2, sz, sz);
      }
    }
  },

  mountain(ctx, cx, cy, size) {
    ctx.strokeStyle = "rgba(100,100,80,0.10)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, size / 3);
    for (let dy = -size * 0.5; dy < size * 0.5; dy += step) {
      const jx = Math.sin(dy * 3) * step * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx + jx - step * 0.3, cy + dy);
      ctx.lineTo(cx + jx, cy + dy - step * 0.3);
      ctx.lineTo(cx + jx + step * 0.3, cy + dy);
      ctx.stroke();
    }
  },

  wetland(ctx, cx, cy, size) {
    ctx.strokeStyle = "rgba(40,80,60,0.12)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, size / 3);
    for (let dy = -size * 0.5; dy < size * 0.5; dy += step) {
      for (let dx = -size * 0.6; dx < size * 0.4; dx += step * 1.5) {
        if (dx * dx + dy * dy > size * size * 0.5) continue;
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy + dy);
        ctx.quadraticCurveTo(cx + dx + step * 0.5, cy + dy - step * 0.2, cx + dx + step, cy + dy);
        ctx.stroke();
      }
    }
  },
};

// Render a chunk at close-up scale with terrain blending
export function renderCloseupChunk(chunk, cellPixels, cells, activeFeatures) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { width, height, size } = layout;
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  if (width <= 0 || height <= 0) return null;

  // Step 1: Render blended terrain base via ImageData
  const canvas = renderBlendedChunk(chunk, cellPixels, cells);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");

  // Step 2: Apply micro-patterns (clipped to hex)
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      if (!cell) continue;
      const patternFn = MICRO_PATTERNS[cell.terrain];
      if (patternFn) {
        const center = chunkHexCenter(col, row, layout);
        ctx.save();
        ctx.beginPath();
        traceHexPath(ctx, center.x, center.y, size);
        ctx.clip();
        patternFn(ctx, center.x, center.y, size);
        ctx.restore();
      }
    }
  }

  // Step 3: Elevation shading
  if (cellPixels >= 48) {
    applyElevationShading(ctx, chunk, cellPixels, cells);
  }

  // Step 4: Feature overlays (detailed at this zoom, hex-shaped)
  if (activeFeatures && activeFeatures.size > 0) {
    for (let localRow = 0; localRow < chunkRows; localRow++) {
      const row = chunk.rowStart + localRow;
      for (let localCol = 0; localCol < chunkCols; localCol++) {
        const col = chunk.colStart + localCol;
        const cell = cells[`${col},${row}`];
        if (!cell) continue;
        const feats = getFeats(cell).filter(f => activeFeatures.has(f));
        if (feats.length === 0) continue;

        const center = chunkHexCenter(col, row, layout);
        const insetSize = size * 0.75;

        if (feats.length === 1) {
          ctx.fillStyle = FC[feats[0]] || "#999";
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          traceHexPath(ctx, center.x, center.y, insetSize);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          const bandH = (size * 2) / feats.length;
          const topY = center.y - size;
          ctx.save();
          ctx.beginPath();
          traceHexPath(ctx, center.x, center.y, insetSize);
          ctx.clip();
          feats.forEach((f, i) => {
            ctx.fillStyle = FC[f] || "#999";
            ctx.globalAlpha = 0.65;
            ctx.fillRect(center.x - size, topY + i * bandH, size * 2, bandH);
          });
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }
    }
  }

  // Step 5: Hex grid outlines
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 0.5;
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const isMajor = (col % 10 === 0 || row % 10 === 0);
      if (isMajor) {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 0.5;
      }
      const center = chunkHexCenter(col, row, layout);
      ctx.beginPath();
      traceHexPath(ctx, center.x, center.y, size);
      ctx.stroke();
    }
  }

  return canvas;
}
