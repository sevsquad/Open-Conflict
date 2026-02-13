// ════════════════════════════════════════════════════════════════
// CloseupRenderer — Tier 3 (32–64 px/cell): terrain blending + textures
// Maximum detail view with smooth terrain transitions
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";
import { renderBlendedChunk, applyElevationShading } from "../TerrainBlend.js";

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Terrain micro-patterns: tiny repeating visual textures per terrain type
// Each returns a function(ctx, x, y, cellPixels) that draws the pattern
const MICRO_PATTERNS = {
  forest(ctx, x, y, cp) {
    ctx.fillStyle = "rgba(0,60,0,0.12)";
    const step = Math.max(4, cp / 6);
    for (let dy = step; dy < cp - step; dy += step) {
      for (let dx = step; dx < cp - step; dx += step) {
        const jx = dx + (Math.sin(dx * 7 + dy * 3) * step * 0.3);
        const jy = dy + (Math.cos(dx * 3 + dy * 7) * step * 0.3);
        ctx.beginPath();
        ctx.arc(x + jx, y + jy, Math.max(1, cp * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  dense_forest(ctx, x, y, cp) {
    ctx.fillStyle = "rgba(0,40,0,0.18)";
    const step = Math.max(3, cp / 8);
    for (let dy = step * 0.5; dy < cp - step; dy += step) {
      for (let dx = step * 0.5; dx < cp - step; dx += step) {
        const jx = dx + (Math.sin(dx * 5 + dy * 11) * step * 0.25);
        const jy = dy + (Math.cos(dx * 11 + dy * 5) * step * 0.25);
        ctx.beginPath();
        ctx.arc(x + jx, y + jy, Math.max(1, cp * 0.04), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  farmland(ctx, x, y, cp) {
    ctx.strokeStyle = "rgba(100,120,30,0.08)";
    ctx.lineWidth = 0.5;
    const step = Math.max(3, cp / 8);
    for (let dy = step; dy < cp; dy += step) {
      ctx.beginPath();
      ctx.moveTo(x + 2, y + dy);
      ctx.lineTo(x + cp - 2, y + dy);
      ctx.stroke();
    }
  },

  light_urban(ctx, x, y, cp) {
    ctx.strokeStyle = "rgba(80,70,60,0.10)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, cp / 5);
    for (let dy = step; dy < cp; dy += step) {
      for (let dx = step; dx < cp; dx += step) {
        const sz = Math.max(2, step * 0.4);
        ctx.strokeRect(x + dx - sz / 2, y + dy - sz / 2, sz, sz);
      }
    }
  },

  dense_urban(ctx, x, y, cp) {
    ctx.strokeStyle = "rgba(60,50,40,0.14)";
    ctx.lineWidth = 0.5;
    const step = Math.max(3, cp / 7);
    for (let dy = step; dy < cp; dy += step) {
      for (let dx = step; dx < cp; dx += step) {
        const sz = Math.max(2, step * 0.5);
        ctx.strokeRect(x + dx - sz / 2, y + dy - sz / 2, sz, sz);
      }
    }
  },

  mountain(ctx, x, y, cp) {
    ctx.strokeStyle = "rgba(100,100,80,0.10)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, cp / 5);
    for (let dy = step; dy < cp; dy += step) {
      const jx = Math.sin(dy * 3) * step * 0.3;
      ctx.beginPath();
      ctx.moveTo(x + jx + cp * 0.3, y + dy);
      ctx.lineTo(x + jx + cp * 0.5, y + dy - step * 0.3);
      ctx.lineTo(x + jx + cp * 0.7, y + dy);
      ctx.stroke();
    }
  },

  wetland(ctx, x, y, cp) {
    ctx.strokeStyle = "rgba(40,80,60,0.12)";
    ctx.lineWidth = 0.5;
    const step = Math.max(4, cp / 5);
    for (let dy = step; dy < cp; dy += step) {
      for (let dx = step; dx < cp - step; dx += step * 1.5) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.quadraticCurveTo(x + dx + step * 0.5, y + dy - step * 0.2, x + dx + step, y + dy);
        ctx.stroke();
      }
    }
  },
};

// Render a chunk at close-up scale with terrain blending
export function renderCloseupChunk(chunk, cellPixels, cells, activeFeatures) {
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;
  const width = Math.ceil(chunkCols * cellPixels);
  const height = Math.ceil(chunkRows * cellPixels);

  if (width <= 0 || height <= 0) return null;

  // Step 1: Render blended terrain base via ImageData
  const canvas = renderBlendedChunk(chunk, cellPixels, cells);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");

  // Step 2: Apply micro-patterns
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      if (!cell) continue;
      const patternFn = MICRO_PATTERNS[cell.terrain];
      if (patternFn) {
        patternFn(ctx, localCol * cellPixels, localRow * cellPixels, cellPixels);
      }
    }
  }

  // Step 3: Elevation shading
  if (cellPixels >= 48) {
    applyElevationShading(ctx, chunk, cellPixels, cells);
  }

  // Step 4: Feature overlays (detailed at this zoom)
  if (activeFeatures && activeFeatures.size > 0) {
    for (let localRow = 0; localRow < chunkRows; localRow++) {
      const row = chunk.rowStart + localRow;
      for (let localCol = 0; localCol < chunkCols; localCol++) {
        const col = chunk.colStart + localCol;
        const cell = cells[`${col},${row}`];
        if (!cell) continue;
        const feats = getFeats(cell).filter(f => activeFeatures.has(f));
        if (feats.length === 0) continue;

        const x = localCol * cellPixels;
        const y = localRow * cellPixels;
        const margin = Math.max(3, cellPixels * 0.12);
        const inner = cellPixels - margin * 2;
        const cornerRadius = Math.max(2, Math.min(5, cellPixels * 0.08));

        if (feats.length === 1) {
          ctx.fillStyle = FC[feats[0]] || "#999";
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          ctx.roundRect(x + margin, y + margin, inner, inner, cornerRadius);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          const segH = inner / feats.length;
          feats.forEach((f, i) => {
            ctx.fillStyle = FC[f] || "#999";
            ctx.globalAlpha = 0.65;
            ctx.fillRect(x + margin, y + margin + i * segH, inner, segH);
            ctx.globalAlpha = 1;
          });
        }
      }
    }
  }

  // Step 5: Grid
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 0.5;
  for (let localRow = 0; localRow <= chunkRows; localRow++) {
    const y = localRow * cellPixels;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  for (let localCol = 0; localCol <= chunkCols; localCol++) {
    const x = localCol * cellPixels;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  // Major grid
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (let localRow = 0; localRow <= chunkRows; localRow++) {
    if ((chunk.rowStart + localRow) % 10 !== 0) continue;
    const y = localRow * cellPixels;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  for (let localCol = 0; localCol <= chunkCols; localCol++) {
    if ((chunk.colStart + localCol) % 10 !== 0) continue;
    const x = localCol * cellPixels;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }

  return canvas;
}
