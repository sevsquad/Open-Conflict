// ════════════════════════════════════════════════════════════════
// UnitOverlay — multi-scale unit markers for SimMap
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getTier } from "../ViewportState.js";

// Parse unit position string to {c, r} grid coords
export function parseUnitPosition(posStr) {
  const commaMatch = posStr.match(/^(\d+),(\d+)$/);
  if (commaMatch) return { c: parseInt(commaMatch[1]), r: parseInt(commaMatch[2]) };
  const letterMatch = posStr.match(/^([A-Z]+)(\d+)$/i);
  if (letterMatch) {
    const c = letterMatch[1].toUpperCase().split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r = parseInt(letterMatch[2]) - 1;
    return { c, r };
  }
  return null;
}

// Convert {c, r} grid coords to position string (comma format)
export function cellToPositionString(c, r) {
  return `${c},${r}`;
}

// Convert {c, r} grid coords to display-friendly letter+number format
export function cellToDisplayString(c, r) {
  let letters = "";
  let col = c;
  do {
    letters = String.fromCharCode(65 + (col % 26)) + letters;
    col = Math.floor(col / 26) - 1;
  } while (col >= 0);
  return `${letters}${r + 1}`;
}

// NATO-style unit type symbols (simple geometric approximations)
export const TYPE_ICONS = {
  infantry: (ctx, cx, cy, s) => {
    // Two diagonal crossed lines
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  },
  armor: (ctx, cx, cy, s) => {
    // Diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
    ctx.closePath(); ctx.stroke();
  },
  artillery: (ctx, cx, cy, s) => {
    // Filled circle
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  },
  recon: (ctx, cx, cy, s) => {
    // Diagonal line
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s);
    ctx.stroke();
  },
  mechanized: (ctx, cx, cy, s) => {
    // X with a circle (infantry + armor)
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.8, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  },
  air: (ctx, cx, cy, s) => {
    // Upward chevron
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.5);
    ctx.lineTo(cx, cy - s * 0.5);
    ctx.lineTo(cx + s, cy + s * 0.5);
    ctx.stroke();
  },
  naval: (ctx, cx, cy, s) => {
    // Wave shape
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.quadraticCurveTo(cx - s * 0.5, cy - s * 0.6, cx, cy);
    ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.6, cx + s, cy);
    ctx.stroke();
  },
  special_forces: (ctx, cx, cy, s) => {
    // Arrow pointing right
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.4, cy - s * 0.6); ctx.lineTo(cx + s, cy); ctx.lineTo(cx + s * 0.4, cy + s * 0.6);
    ctx.stroke();
  },
  logistics: (ctx, cx, cy, s) => {
    // Horizontal line with dots
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - s * 0.5, cy, s * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s * 0.5, cy, s * 0.2, 0, Math.PI * 2); ctx.fill();
  },
  headquarters: (ctx, cx, cy, s) => {
    // Flag shape
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy + s); ctx.lineTo(cx - s * 0.6, cy - s);
    ctx.lineTo(cx + s, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.6, cy + s * 0.3);
    ctx.stroke();
  },
};

// Draw background disc for contrast against any terrain
function drawBackgroundDisc(ctx, x, y, size) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

// Draw units at strategic scale (Tier 0): colored dots with background
function drawUnitsStrategic(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOpts) {
  for (const unit of units) {
    if (!unit.position) continue;
    if (setupOpts?.draggedUnitId === unit.id) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const dotSize = Math.max(2, viewport.cellPixels * 0.6);

    // Background disc
    drawBackgroundDisc(ctx, x, y, dotSize + 1);

    ctx.fillStyle = color;
    ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);

    // White outline
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
  }
}

// Draw units at operational scale (Tier 1): small circles with background
function drawUnitsOperational(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOpts) {
  for (const unit of units) {
    if (!unit.position) continue;
    if (setupOpts?.draggedUnitId === unit.id) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const r = Math.max(2, viewport.cellPixels * 0.35);

    // Background disc
    drawBackgroundDisc(ctx, x, y, r + 2);

    // Circle with strength as opacity
    const alpha = Math.max(0.3, (unit.strength || 100) / 100);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Draw units at tactical scale (Tier 2): circles with strength arc + labels
function drawUnitsTactical(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOpts) {
  const cp = viewport.cellPixels;
  for (const unit of units) {
    if (!unit.position) continue;
    if (setupOpts?.draggedUnitId === unit.id) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const r = cp * 0.35;

    // Background disc
    drawBackgroundDisc(ctx, x, y, r + 3);

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color + "CC";
    ctx.fill();
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Strength arc
    if (unit.strength < 100) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * unit.strength / 100));
      ctx.strokeStyle = unit.strength > 50 ? "#22C55E" : unit.strength > 25 ? "#F59E0B" : "#EF4444";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Unit type icon (at 24px+)
    if (cp >= 24) {
      const iconFn = TYPE_ICONS[unit.type];
      if (iconFn) {
        ctx.strokeStyle = "#FFF";
        ctx.fillStyle = "#FFF";
        ctx.lineWidth = 1;
        iconFn(ctx, x, y, r * 0.4);
      }
    }

    // Name label (at 16px+)
    if (cp >= 16) {
      ctx.font = `${Math.max(7, cp * 0.22)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFF";
      ctx.fillText(unit.name.slice(0, 12), x, y + r + cp * 0.15);
    }
  }
}

// Draw units at close-up scale (Tier 3): NATO-style boxes
function drawUnitsCloseup(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOpts) {
  const cp = viewport.cellPixels;
  for (const unit of units) {
    if (!unit.position) continue;
    if (setupOpts?.draggedUnitId === unit.id) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";

    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(bx + 2, by + 2, boxW, boxH);

    // NATO box
    ctx.fillStyle = color + "DD";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, boxW, boxH);

    // Type icon inside box
    const iconFn = TYPE_ICONS[unit.type];
    if (iconFn) {
      ctx.strokeStyle = "#FFF";
      ctx.fillStyle = "#FFF";
      ctx.lineWidth = 1.5;
      iconFn(ctx, x, y, boxH * 0.3);
    }

    // Name below
    ctx.font = `bold ${Math.max(8, cp * 0.18)}px Arial`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFF";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeText(unit.name, x, y + boxH / 2 + cp * 0.12);
    ctx.fillText(unit.name, x, y + boxH / 2 + cp * 0.12);

    // Strength bar below name
    const barW = boxW * 0.8;
    const barH = Math.max(2, cp * 0.04);
    const barX = x - barW / 2;
    const barY = y + boxH / 2 + cp * 0.2;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(barX, barY, barW, barH);
    const str = (unit.strength || 100) / 100;
    ctx.fillStyle = str > 0.5 ? "#22C55E" : str > 0.25 ? "#F59E0B" : "#EF4444";
    ctx.fillRect(barX, barY, barW * str, barH);
  }
}

// Draw ghost unit preview during placement
function drawGhostUnit(ctx, ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight) {
  if (!ghostUnit || !ghostUnit.cell) return;
  const { c, r } = ghostUnit.cell;
  const { x, y } = gridToScreen(c + 0.5, r + 0.5, viewport, canvasWidth, canvasHeight);
  const color = actorColorMap[ghostUnit.actorId] || "#FFF";
  const tier = getTier(viewport.cellPixels);
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = 0.5;

  if (tier <= 1) {
    const sz = tier === 0 ? Math.max(2, cp * 0.6) : Math.max(3, cp * 0.35);
    drawBackgroundDisc(ctx, x, y, sz + 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (tier === 2) {
    const rad = cp * 0.35;
    drawBackgroundDisc(ctx, x, y, rad + 3);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = color + "CC";
    ctx.fill();
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Icon
    if (cp >= 24) {
      const iconFn = TYPE_ICONS[ghostUnit.type];
      if (iconFn) {
        ctx.strokeStyle = "#FFF";
        ctx.fillStyle = "#FFF";
        ctx.lineWidth = 1;
        iconFn(ctx, x, y, rad * 0.4);
      }
    }
  } else {
    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;
    ctx.fillStyle = color + "DD";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.setLineDash([]);
    const iconFn = TYPE_ICONS[ghostUnit.type];
    if (iconFn) {
      ctx.strokeStyle = "#FFF";
      ctx.fillStyle = "#FFF";
      ctx.lineWidth = 1.5;
      iconFn(ctx, x, y, boxH * 0.3);
    }
  }

  ctx.restore();
}

// Main dispatch: draw units at appropriate scale
export function drawUnits(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions = null) {
  if (!units || units.length === 0) {
    // Still draw ghost even with no units
    if (setupOptions?.ghostUnit) {
      drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
    }
    return;
  }
  const tier = getTier(viewport.cellPixels);
  switch (tier) {
    case 0: drawUnitsStrategic(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions); break;
    case 1: drawUnitsOperational(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions); break;
    case 2: drawUnitsTactical(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions); break;
    case 3: drawUnitsCloseup(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions); break;
  }

  // Draw ghost preview on top
  if (setupOptions?.ghostUnit) {
    drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
  }
}
