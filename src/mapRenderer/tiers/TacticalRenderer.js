// ════════════════════════════════════════════════════════════════
// TacticalRenderer — Tier 2 (12–32 px/cell): full detail
// Port of current Viewer.jsx draw logic, adapted for tile-based rendering
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Subtle terrain edge embossing — adds shadow/highlight at terrain boundaries
function drawTerrainEdges(ctx, chunk, cellPixels, cells) {
  if (cellPixels < 16) return; // only at 16px+

  for (let localRow = 0; localRow < chunk.rowEnd - chunk.rowStart; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunk.colEnd - chunk.colStart; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      if (!cell) continue;

      const x = localCol * cellPixels;
      const y = localRow * cellPixels;

      // Check if neighbors have different terrain
      const east = cells[`${col + 1},${row}`];
      const south = cells[`${col},${row + 1}`];

      if (east && east.terrain !== cell.terrain) {
        // Vertical edge at right side
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(x + cellPixels - 1, y, 1, cellPixels);
      }
      if (south && south.terrain !== cell.terrain) {
        // Horizontal edge at bottom
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(x, y + cellPixels - 1, cellPixels, 1);
      }
    }
  }
}

// Render a chunk at tactical scale
// Returns an OffscreenCanvas
export function renderTacticalChunk(chunk, cellPixels, cells, activeFeatures) {
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;
  const width = Math.ceil(chunkCols * cellPixels);
  const height = Math.ceil(chunkRows * cellPixels);

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Terrain fill + grid borders
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      const x = localCol * cellPixels;
      const y = localRow * cellPixels;

      // Terrain base color
      ctx.fillStyle = cell ? (TC[cell.terrain] || "#222") : "#111";
      ctx.fillRect(x, y, cellPixels, cellPixels);

      // Cell border (subtle)
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x + cellPixels - 0.5, y, 0.5, cellPixels); // right
      ctx.fillRect(x, y + cellPixels - 0.5, cellPixels, 0.5); // bottom
    }
  }

  // Terrain edge embossing
  drawTerrainEdges(ctx, chunk, cellPixels, cells);

  // Feature overlays (colored rounded rects)
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
        const margin = Math.max(2, cellPixels * 0.15);
        const inner = cellPixels - margin * 2;
        const cornerRadius = Math.max(1, Math.min(3, cellPixels * 0.1));

        if (feats.length === 1) {
          ctx.fillStyle = FC[feats[0]] || "#999";
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.roundRect(x + margin, y + margin, inner, inner, cornerRadius);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          const segH = inner / feats.length;
          feats.forEach((f, i) => {
            ctx.fillStyle = FC[f] || "#999";
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x + margin, y + margin + i * segH, inner, segH);
            ctx.globalAlpha = 1;
          });
        }
      }
    }
  }

  // Grid lines
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

  // Major grid (every 10 cells)
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (let localRow = 0; localRow <= chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    if (row % 10 !== 0) continue;
    const y = localRow * cellPixels;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  for (let localCol = 0; localCol <= chunkCols; localCol++) {
    const col = chunk.colStart + localCol;
    if (col % 10 !== 0) continue;
    const x = localCol * cellPixels;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }

  return canvas;
}
