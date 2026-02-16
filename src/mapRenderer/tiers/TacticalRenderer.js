// ════════════════════════════════════════════════════════════════
// TacticalRenderer — Tier 2 (12–32 px/cell): full detail
// Port of current Viewer.jsx draw logic, adapted for hex tile rendering
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";
import {
  hexChunkLayout, chunkHexCenter, traceHexPath,
  hexVertices, getNeighbors,
} from "../HexMath.js";

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Subtle terrain edge embossing along hex edges at terrain boundaries
function drawTerrainEdges(ctx, chunk, layout, cells) {
  if (layout.size < 7) return; // only at ~16+ px cellPixels
  const { size } = layout;
  const chunkRows = chunk.rowEnd - chunk.rowStart;
  const chunkCols = chunk.colEnd - chunk.colStart;

  ctx.lineWidth = 1;
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      if (!cell) continue;

      const center = chunkHexCenter(col, row, layout);
      const verts = hexVertices(center.x, center.y, size);
      const neighbors = getNeighbors(col, row);

      // Check each of the 6 hex edges for terrain change
      for (let i = 0; i < 6; i++) {
        const [nc, nr] = neighbors[i];
        const nCell = cells[`${nc},${nr}`];
        if (!nCell || nCell.terrain === cell.terrain) continue;

        // Draw a dark line along this hex edge
        const v0 = verts[i];
        const v1 = verts[(i + 1) % 6];
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.beginPath();
        ctx.moveTo(v0.x, v0.y);
        ctx.lineTo(v1.x, v1.y);
        ctx.stroke();
      }
    }
  }
}

// Render a chunk at tactical scale
// Returns an OffscreenCanvas
export function renderTacticalChunk(chunk, cellPixels, cells, activeFeatures) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { width, height, size } = layout;
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Terrain fill as hex shapes
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      const center = chunkHexCenter(col, row, layout);

      // Terrain base color
      ctx.fillStyle = cell ? (TC[cell.terrain] || "#222") : "#111";
      ctx.beginPath();
      traceHexPath(ctx, center.x, center.y, size);
      ctx.fill();
    }
  }

  // Terrain edge embossing
  drawTerrainEdges(ctx, chunk, layout, cells);

  // Feature overlays (colored hex insets)
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
        const insetSize = size * 0.7; // smaller hex inset

        if (feats.length === 1) {
          ctx.fillStyle = FC[feats[0]] || "#999";
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          traceHexPath(ctx, center.x, center.y, insetSize);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          // Multiple features: draw as stacked horizontal bands clipped to hex
          const bandH = (size * 2) / feats.length;
          const topY = center.y - size;
          ctx.save();
          ctx.beginPath();
          traceHexPath(ctx, center.x, center.y, insetSize);
          ctx.clip();
          feats.forEach((f, i) => {
            ctx.fillStyle = FC[f] || "#999";
            ctx.globalAlpha = 0.7;
            ctx.fillRect(center.x - size, topY + i * bandH, size * 2, bandH);
          });
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }
    }
  }

  // Hex grid outlines
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
