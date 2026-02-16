// ════════════════════════════════════════════════════════════════
// OperationalRenderer — Tier 1 (3–12 px/cell): small cells + line features
// The campaign map: hex cells visible, features as shapes and lines
// ════════════════════════════════════════════════════════════════

import { TC, FC } from "../../terrainColors.js";
import {
  hexChunkLayout, chunkHexCenter, traceHexPath, hexVertices,
} from "../HexMath.js";

// Point feature icon shapes
const ICON_SHAPES = {
  military_base: "diamond",
  airfield: "cross",
  port: "triangle",
  helipad: "triangle",
  power_plant: "bolt",
  chokepoint: "x",
  town: "square",
  dam: "square",
  landing_zone: "triangle",
  beach: "square",
  pipeline: "circle",
  building: "square",
  building_dense: "square",
  building_sparse: "square",
  tower: "diamond",
};

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Draw an icon shape centered at (cx, cy) with given size
function drawIcon(ctx, shape, cx, cy, size, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, size * 0.15);
  const hs = size / 2;

  switch (shape) {
    case "diamond":
      ctx.beginPath();
      ctx.moveTo(cx, cy - hs); ctx.lineTo(cx + hs, cy);
      ctx.lineTo(cx, cy + hs); ctx.lineTo(cx - hs, cy);
      ctx.closePath(); ctx.fill();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(cx, cy - hs);
      ctx.lineTo(cx + hs, cy + hs);
      ctx.lineTo(cx - hs, cy + hs);
      ctx.closePath(); ctx.fill();
      break;
    case "cross":
      ctx.beginPath();
      ctx.moveTo(cx - hs, cy); ctx.lineTo(cx + hs, cy);
      ctx.moveTo(cx, cy - hs); ctx.lineTo(cx, cy + hs);
      ctx.stroke();
      break;
    case "x":
      ctx.beginPath();
      ctx.moveTo(cx - hs, cy - hs); ctx.lineTo(cx + hs, cy + hs);
      ctx.moveTo(cx + hs, cy - hs); ctx.lineTo(cx - hs, cy + hs);
      ctx.stroke();
      break;
    case "bolt":
      ctx.beginPath();
      ctx.moveTo(cx - hs * 0.3, cy - hs); ctx.lineTo(cx - hs * 0.5, cy);
      ctx.lineTo(cx + hs * 0.3, cy); ctx.lineTo(cx + hs * 0.5, cy + hs);
      ctx.stroke();
      break;
    case "square":
      ctx.fillRect(cx - hs * 0.6, cy - hs * 0.6, size * 0.6, size * 0.6);
      break;
    case "circle":
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, hs * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

// Render a chunk at operational scale
// Returns an OffscreenCanvas
export function renderOperationalChunk(chunk, cellPixels, cells, activeFeatures) {
  const layout = hexChunkLayout(chunk, cellPixels);
  const { width, height, size } = layout;
  const chunkCols = chunk.colEnd - chunk.colStart;
  const chunkRows = chunk.rowEnd - chunk.rowStart;

  if (width <= 0 || height <= 0) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Draw terrain cells as hex shapes
  for (let localRow = 0; localRow < chunkRows; localRow++) {
    const row = chunk.rowStart + localRow;
    for (let localCol = 0; localCol < chunkCols; localCol++) {
      const col = chunk.colStart + localCol;
      const cell = cells[`${col},${row}`];
      const center = chunkHexCenter(col, row, layout);

      // Terrain fill as hex
      ctx.fillStyle = cell ? (TC[cell.terrain] || "#222") : "#111";
      ctx.beginPath();
      traceHexPath(ctx, center.x, center.y, size);
      ctx.fill();

      // Point feature icons (not linear features — those are drawn as lines by RoadNetwork)
      if (cell && activeFeatures) {
        const feats = getFeats(cell);
        const pointFeats = feats.filter(f => activeFeatures.has(f) && ICON_SHAPES[f]);
        if (pointFeats.length > 0) {
          // Draw top-priority icon
          const feat = pointFeats[0];
          const shape = ICON_SHAPES[feat];
          const color = FC[feat] || "#999";
          const iconSize = Math.max(2, cellPixels * 0.5);
          ctx.globalAlpha = 0.85;
          drawIcon(ctx, shape, center.x, center.y, iconSize, color);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // Hex grid edges at 5+ px/cell
  if (cellPixels >= 5) {
    ctx.lineWidth = 0.5;
    for (let localRow = 0; localRow < chunkRows; localRow++) {
      const row = chunk.rowStart + localRow;
      for (let localCol = 0; localCol < chunkCols; localCol++) {
        const col = chunk.colStart + localCol;
        const isMajor = (col % 10 === 0 || row % 10 === 0);
        ctx.strokeStyle = isMajor ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)";
        ctx.lineWidth = isMajor ? 1 : 0.5;
        const center = chunkHexCenter(col, row, layout);
        ctx.beginPath();
        traceHexPath(ctx, center.x, center.y, size);
        ctx.stroke();
      }
    }
  }

  return canvas;
}
