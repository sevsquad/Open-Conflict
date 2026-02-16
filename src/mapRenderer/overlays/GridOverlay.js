// ════════════════════════════════════════════════════════════════
// GridOverlay — zoom-adaptive hex grid (drawn as screen-space overlay)
// This provides additional major grid emphasis beyond what's baked into tiles
// ════════════════════════════════════════════════════════════════

import { getVisibleRange, gridToScreen } from "../ViewportState.js";
import { cellPixelsToHexSize, traceHexPath } from "../HexMath.js";

export function drawGridOverlay(ctx, viewport, canvasWidth, canvasHeight, cols, rows, tier) {
  // Tier 0: no grid (too small)
  if (tier === 0) return;

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
  const cp = viewport.cellPixels;
  const size = cellPixelsToHexSize(cp);

  // At Tier 1 with cellPixels < 5, skip grid entirely
  if (cp < 5) return;

  // Determine grid step (don't draw every hex at low zoom — too dense)
  let step = 1;
  if (cp < 8) step = 10;       // Only major grid
  else if (cp < 12) step = 5;

  // Draw hex outlines for visible cells at the determined step
  ctx.lineWidth = 0.5;

  for (let r = range.rowMin; r < range.rowMax; r += step) {
    for (let c = range.colMin; c < range.colMax; c += step) {
      const isMajor = (c % 10 === 0 || r % 10 === 0);
      ctx.strokeStyle = isMajor ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.10)";
      ctx.lineWidth = isMajor ? 1 : 0.5;
      const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);
      ctx.beginPath();
      traceHexPath(ctx, x, y, size);
      ctx.stroke();
    }
  }
}
