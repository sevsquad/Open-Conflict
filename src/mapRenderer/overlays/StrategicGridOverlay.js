// ════════════════════════════════════════════════════════════════
// StrategicGridOverlay — draws game hex grid outlines on top of
// the fine terrain grid when viewing sub-tactical maps.
//
// At sub-tactical scale (5-10:1 ratio), the fine 10m hexes render
// as the base visual and these thick outlines show the LLM's game
// hex boundaries. This replaces the atlas approach which produces
// visual noise at low ratios.
// ════════════════════════════════════════════════════════════════

import { traceHexPath, cellPixelsToHexSize, offsetToPixel } from "../HexMath.js";

const SQRT3 = Math.sqrt(3);

/**
 * Draw strategic hex outlines on a Canvas 2D context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} strategicGrid - from buildStrategicGrid()
 * @param {Object} viewport - { centerCol, centerRow, cellPixels } in FINE grid coords
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {number} fineCellSizeKm - fine grid cell size in km
 */
export function drawStrategicGridOverlay(ctx, strategicGrid, viewport, w, h, fineCellSizeKm) {
  if (!strategicGrid?.cells) return;

  const stratSize = strategicGrid.cellSizeKm;
  const fineSize = fineCellSizeKm || strategicGrid.fineCellSizeKm;
  if (!fineSize || fineSize <= 0) return;

  // Screen pixel size of one fine hex
  const fineHexSize = cellPixelsToHexSize(viewport.cellPixels);
  // Strategic hex outer radius in screen pixels = same ratio as km sizes
  const stratHexScreenSize = fineHexSize * (stratSize / fineSize);

  // Viewport center in km-space (fine grid coords → km)
  const vcx = fineSize * SQRT3 * (viewport.centerCol + 0.5 * (Math.round(viewport.centerRow) & 1));
  const vcy = fineSize * 1.5 * viewport.centerRow;

  // Pixel-per-km conversion factor
  // One fine hex width = sqrt3 * fineHexSize screen pixels = sqrt3 * fineSize km
  // So 1 km = fineHexSize / fineSize screen pixels... but actually:
  // fineSize * SQRT3 * col → km space, and fineHexSize * SQRT3 * col → screen space
  // So screen = km * (fineHexSize / fineSize)
  const kmToScreen = fineHexSize / fineSize;

  // Determine visible range (skip strategic hexes entirely off-screen)
  const marginKm = stratSize * 2;
  const halfWKm = (w / 2) / kmToScreen + marginKm;
  const halfHKm = (h / 2) / kmToScreen + marginKm;

  // Line width scales with zoom — thick enough to be clearly visible,
  // but not so thick it obscures the fine grid underneath
  const lineWidth = Math.max(1.5, Math.min(5, viewport.cellPixels / 8));

  ctx.save();
  ctx.strokeStyle = "rgba(40, 40, 40, 0.55)";
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.beginPath();

  for (const stratKey in strategicGrid.cells) {
    const [nc, nr] = stratKey.split(",").map(Number);
    // Un-normalize strategic coords
    const sc = nc + (strategicGrid._colOffset || 0);
    const sr = nr + (strategicGrid._rowOffset || 0);

    // Strategic hex center in km-space
    const hx = stratSize * SQRT3 * (sc + 0.5 * (sr & 1));
    const hy = stratSize * 1.5 * sr;

    // Quick frustum cull
    if (Math.abs(hx - vcx) > halfWKm || Math.abs(hy - vcy) > halfHKm) continue;

    // Convert to screen pixels
    const sx = (hx - vcx) * kmToScreen + w / 2;
    const sy = (hy - vcy) * kmToScreen + h / 2;

    traceHexPath(ctx, sx, sy, stratHexScreenSize);
  }

  ctx.stroke();
  ctx.restore();
}
