// ════════════════════════════════════════════════════════════════
// StrategicAtlas — generate a texture atlas for strategic hex
// rendering. Each strategic hex gets a small tile showing the
// fine terrain pattern within it. The atlas is a single 2D
// texture sampled by the fragment shader.
// ════════════════════════════════════════════════════════════════

import { offsetToPixel } from "../HexMath.js";
import { TC } from "../../terrainColors.js";

// Tile size in pixels (each strategic hex gets this many pixels)
const TILE_PX = 64;
// Padding pixels around each tile (prevents texture bleeding)
const PAD = 1;
// Total stride per tile (tile + padding on both sides)
const STRIDE = TILE_PX + PAD * 2;

/**
 * Generate a texture atlas for strategic hex rendering.
 *
 * Each strategic hex gets a TILE_PX × TILE_PX tile in the atlas.
 * Within each tile, fine hexes are painted at their relative positions,
 * showing the actual terrain distribution within the strategic hex.
 *
 * @param {Object} mapData - fine hex map data { cols, rows, cells, cellSizeKm }
 * @param {Object} strategicGrid - from buildStrategicGrid()
 * @returns {{ canvas: HTMLCanvasElement, atlasGridCols: number, atlasSize: {w,h} }}
 */
export function generateStrategicAtlas(mapData, strategicGrid) {
  const { cells: fineCells, cellSizeKm: fineSizeKm } = mapData;
  const stratCellSizeKm = strategicGrid.cellSizeKm;

  // Number of strategic hexes
  const stratKeys = Object.keys(strategicGrid.cells);
  const hexCount = stratKeys.length;

  // Atlas grid layout: arrange tiles in a roughly square grid
  const atlasGridCols = Math.ceil(Math.sqrt(hexCount));
  const atlasGridRows = Math.ceil(hexCount / atlasGridCols);
  const atlasW = atlasGridCols * STRIDE;
  const atlasH = atlasGridRows * STRIDE;

  // Check WebGL texture size limit (4096 is safe on all WebGL2 devices)
  if (atlasW > 4096 || atlasH > 4096) {
    console.warn(
      `Strategic atlas size ${atlasW}×${atlasH} exceeds safe limit. ` +
      `Consider fewer strategic hexes or smaller tile size.`
    );
  }

  // Create offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext("2d");

  // Clear to transparent
  ctx.clearRect(0, 0, atlasW, atlasH);

  // Scale factor: map strategic hex bounding box to tile pixels.
  // Pointy-top hex: height = 2*size, width = √3*size.
  // Height is the larger dimension, so scale to fit height in TILE_PX.
  const scale = TILE_PX / (2 * stratCellSizeKm);

  // Fine hex outer radius in tile pixels
  const fineHexRadiusPx = fineSizeKm * scale;

  // Build a tile index map: stratKey → tile index (for shader lookup)
  const tileIndexMap = new Map();

  // Sort keys for deterministic ordering (row-major)
  stratKeys.sort((a, b) => {
    const [ac, ar] = a.split(",").map(Number);
    const [bc, br] = b.split(",").map(Number);
    return ar !== br ? ar - br : ac - bc;
  });

  for (let i = 0; i < stratKeys.length; i++) {
    const stratKey = stratKeys[i];
    tileIndexMap.set(stratKey, i);

    const tileCol = i % atlasGridCols;
    const tileRow = Math.floor(i / atlasGridCols);

    // Tile origin in atlas (top-left of content area, inside padding)
    const tileX = tileCol * STRIDE + PAD;
    const tileY = tileRow * STRIDE + PAD;

    // Strategic hex center in km space (unnormalized coords)
    const [sc, sr] = stratKey.split(",").map(Number);
    const origSc = sc + strategicGrid._colOffset;
    const origSr = sr + strategicGrid._rowOffset;
    const stratCenter = offsetToPixel(origSc, origSr, stratCellSizeKm);

    // Dominant terrain color for background fill
    const stratCell = strategicGrid.cells[stratKey];
    const bgColor = TC[stratCell?.terrain] || TC.open_ground || "#555";

    // Fill entire tile with background color (covers hex corners)
    ctx.fillStyle = bgColor;
    ctx.fillRect(tileX, tileY, TILE_PX, TILE_PX);

    // Paint fine hexes within this strategic hex
    const fineKeys = strategicGrid.strategicToFine.get(stratKey) || [];
    for (const fineKey of fineKeys) {
      const cell = fineCells[fineKey];
      if (!cell) continue;

      const [fc, fr] = fineKey.split(",").map(Number);
      const fineCenter = offsetToPixel(fc, fr, fineSizeKm);

      // Position relative to strategic hex center, scaled to tile pixels
      const dx = (fineCenter.x - stratCenter.x) * scale;
      const dy = (fineCenter.y - stratCenter.y) * scale;

      // Tile-local pixel position (center of tile = TILE_PX/2)
      const px = tileX + TILE_PX / 2 + dx;
      const py = tileY + TILE_PX / 2 + dy;

      // Draw a pointy-top hex at this position
      const color = TC[cell.terrain] || TC.open_ground || "#555";
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let v = 0; v < 6; v++) {
        const angle = Math.PI / 180 * (60 * v - 30);
        const vx = px + fineHexRadiusPx * Math.cos(angle);
        const vy = py + fineHexRadiusPx * Math.sin(angle);
        if (v === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Edge extrusion: duplicate 1px border outward to prevent bleeding
    // Top edge
    ctx.drawImage(canvas, tileX, tileY, TILE_PX, 1, tileX, tileY - PAD, TILE_PX, PAD);
    // Bottom edge
    ctx.drawImage(canvas, tileX, tileY + TILE_PX - 1, TILE_PX, 1, tileX, tileY + TILE_PX, TILE_PX, PAD);
    // Left edge
    ctx.drawImage(canvas, tileX, tileY - PAD, 1, TILE_PX + PAD * 2, tileX - PAD, tileY - PAD, PAD, TILE_PX + PAD * 2);
    // Right edge
    ctx.drawImage(canvas, tileX + TILE_PX - 1, tileY - PAD, 1, TILE_PX + PAD * 2, tileX + TILE_PX, tileY - PAD, PAD, TILE_PX + PAD * 2);
  }

  return {
    canvas,
    tileIndexMap,
    atlasGridCols,
    atlasSize: { w: atlasW, h: atlasH },
    tileSize: TILE_PX,
    tilePad: PAD,
    tileStride: STRIDE,
  };
}

/**
 * Upload the atlas canvas as a WebGL2 texture.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {HTMLCanvasElement} atlasCanvas
 * @returns {WebGLTexture}
 */
export function uploadAtlasTexture(gl, atlasCanvas) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // No mipmaps — we sample at 1:1 scale, and mipmaps cause bleeding
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
}
