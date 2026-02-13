// ════════════════════════════════════════════════════════════════
// GridOverlay — zoom-adaptive grid lines (drawn as screen-space overlay)
// This is only used for Tier 0–1 where grid is not baked into tiles
// Tier 2–3 bake grid into tiles; this provides additional major grid emphasis
// ════════════════════════════════════════════════════════════════

import { getVisibleRange, gridToScreen } from "../ViewportState.js";

export function drawGridOverlay(ctx, viewport, canvasWidth, canvasHeight, cols, rows, tier) {
  // Tier 0: no grid (too small)
  if (tier === 0) return;

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
  const cp = viewport.cellPixels;

  // At Tier 1 with cellPixels < 5, skip grid entirely
  if (cp < 5) return;

  // Determine grid step (don't draw every line at low zoom — too dense)
  let minorStep = 1;
  let majorStep = 10;
  if (cp < 8) { minorStep = 10; majorStep = 10; } // Only major grid
  else if (cp < 12) { minorStep = 5; majorStep = 10; }

  // Minor grid
  if (minorStep < majorStep) {
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.lineWidth = 0.5;

    // Vertical lines
    const colStart = Math.ceil(range.colMin / minorStep) * minorStep;
    for (let c = colStart; c <= range.colMax; c += minorStep) {
      if (c % majorStep === 0) continue; // Skip major grid positions
      const { x } = gridToScreen(c, 0, viewport, canvasWidth, canvasHeight);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); ctx.stroke();
    }

    // Horizontal lines
    const rowStart = Math.ceil(range.rowMin / minorStep) * minorStep;
    for (let r = rowStart; r <= range.rowMax; r += minorStep) {
      if (r % majorStep === 0) continue;
      const { y } = gridToScreen(0, r, viewport, canvasWidth, canvasHeight);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
    }
  }

  // Major grid (every majorStep cells)
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 1;

  const majorColStart = Math.ceil(range.colMin / majorStep) * majorStep;
  for (let c = majorColStart; c <= range.colMax; c += majorStep) {
    const { x } = gridToScreen(c, 0, viewport, canvasWidth, canvasHeight);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); ctx.stroke();
  }

  const majorRowStart = Math.ceil(range.rowMin / majorStep) * majorStep;
  for (let r = majorRowStart; r <= range.rowMax; r += majorStep) {
    const { y } = gridToScreen(0, r, viewport, canvasWidth, canvasHeight);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
  }
}
