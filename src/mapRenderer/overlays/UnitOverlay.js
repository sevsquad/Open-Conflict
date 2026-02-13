// ════════════════════════════════════════════════════════════════
// UnitOverlay — multi-scale unit markers for SimMap
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getTier } from "../ViewportState.js";

// Parse unit position string to {c, r} grid coords
function parseUnitPosition(posStr) {
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

// NATO-style unit type symbols (simple geometric approximations)
const TYPE_ICONS = {
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
};

// Draw units at strategic scale (Tier 0): colored dots
function drawUnitsStrategic(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  for (const unit of units) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const dotSize = Math.max(1, viewport.cellPixels * 0.6);
    ctx.fillStyle = color;
    ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
  }
}

// Draw units at operational scale (Tier 1): small circles
function drawUnitsOperational(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  for (const unit of units) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const radius = Math.max(2, viewport.cellPixels * 0.35);

    // Circle with strength as opacity
    const alpha = Math.max(0.3, (unit.strength || 100) / 100);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
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
function drawUnitsTactical(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  const cp = viewport.cellPixels;
  for (const unit of units) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";
    const radius = cp * 0.35;

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + "CC";
    ctx.fill();
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Strength arc
    if (unit.strength < 100) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * unit.strength / 100));
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
        iconFn(ctx, x, y, radius * 0.4);
      }
    }

    // Name label (at 16px+)
    if (cp >= 16) {
      ctx.font = `${Math.max(7, cp * 0.22)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFF";
      ctx.fillText(unit.name.slice(0, 12), x, y + radius + cp * 0.15);
    }
  }
}

// Draw units at close-up scale (Tier 3): NATO-style boxes
function drawUnitsCloseup(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  const cp = viewport.cellPixels;
  for (const unit of units) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) continue;
    const { x, y } = gridToScreen(pos.c + 0.5, pos.r + 0.5, viewport, canvasWidth, canvasHeight);
    const color = actorColorMap[unit.actor] || "#FFF";

    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

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

// Main dispatch: draw units at appropriate scale
export function drawUnits(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  if (!units || units.length === 0) return;
  const tier = getTier(viewport.cellPixels);
  switch (tier) {
    case 0: drawUnitsStrategic(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows); break;
    case 1: drawUnitsOperational(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows); break;
    case 2: drawUnitsTactical(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows); break;
    case 3: drawUnitsCloseup(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows); break;
  }
}
