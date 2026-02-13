// ════════════════════════════════════════════════════════════════
// SelectionOverlay — hover/selection highlights
// ════════════════════════════════════════════════════════════════

import { gridToScreen } from "../ViewportState.js";

// Draw hover highlight
export function drawHoverHighlight(ctx, viewport, canvasWidth, canvasHeight, hovCol, hovRow) {
  if (hovCol === null || hovCol === undefined) return;
  const cp = viewport.cellPixels;
  const { x, y } = gridToScreen(hovCol, hovRow, viewport, canvasWidth, canvasHeight);
  ctx.strokeStyle = "rgba(79,195,247,0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, cp - 2, cp - 2);
}

// Draw selection highlight
export function drawSelectionHighlight(ctx, viewport, canvasWidth, canvasHeight, selCol, selRow) {
  if (selCol === null || selCol === undefined) return;
  const cp = viewport.cellPixels;
  const { x, y } = gridToScreen(selCol, selRow, viewport, canvasWidth, canvasHeight);
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 1, y + 1, cp - 2, cp - 2);
  ctx.setLineDash([]);
}
