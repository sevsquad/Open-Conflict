// ════════════════════════════════════════════════════════════════
// SelectionOverlay — hover/selection highlights (hex grid)
// ════════════════════════════════════════════════════════════════

import { gridToScreen } from "../ViewportState.js";
import { cellPixelsToHexSize, traceHexPath } from "../HexMath.js";

// Draw hover highlight as hex outline
export function drawHoverHighlight(ctx, viewport, canvasWidth, canvasHeight, hovCol, hovRow) {
  if (hovCol === null || hovCol === undefined) return;
  const size = cellPixelsToHexSize(viewport.cellPixels);
  const { x, y } = gridToScreen(hovCol, hovRow, viewport, canvasWidth, canvasHeight);
  ctx.strokeStyle = "rgba(79,195,247,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  traceHexPath(ctx, x, y, size * 0.92);
  ctx.stroke();
}

// Draw selection highlight as dashed hex outline
export function drawSelectionHighlight(ctx, viewport, canvasWidth, canvasHeight, selCol, selRow) {
  if (selCol === null || selCol === undefined) return;
  const size = cellPixelsToHexSize(viewport.cellPixels);
  const { x, y } = gridToScreen(selCol, selRow, viewport, canvasWidth, canvasHeight);
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  traceHexPath(ctx, x, y, size * 0.92);
  ctx.stroke();
  ctx.setLineDash([]);
}
