// ════════════════════════════════════════════════════════════════
// UnitOverlay — continuous-scale unit markers for SimMap
// Replaces the old 4-tier discrete system with smooth scaling
// ════════════════════════════════════════════════════════════════

import { gridToScreen } from "../ViewportState.js";

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

// NATO-style unit type symbols
export const TYPE_ICONS = {
  infantry: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  },
  armor: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
    ctx.closePath(); ctx.stroke();
  },
  artillery: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  },
  recon: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx + s, cy - s);
    ctx.stroke();
  },
  mechanized: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.8, s * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  },
  air: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.5);
    ctx.lineTo(cx, cy - s * 0.5);
    ctx.lineTo(cx + s, cy + s * 0.5);
    ctx.stroke();
  },
  naval: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.quadraticCurveTo(cx - s * 0.5, cy - s * 0.6, cx, cy);
    ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.6, cx + s, cy);
    ctx.stroke();
  },
  special_forces: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.4, cy - s * 0.6); ctx.lineTo(cx + s, cy); ctx.lineTo(cx + s * 0.4, cy + s * 0.6);
    ctx.stroke();
  },
  logistics: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - s * 0.5, cy, s * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + s * 0.5, cy, s * 0.2, 0, Math.PI * 2); ctx.fill();
  },
  headquarters: (ctx, cx, cy, s) => {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy + s); ctx.lineTo(cx - s * 0.6, cy - s);
    ctx.lineTo(cx + s, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.6, cy + s * 0.3);
    ctx.stroke();
  },
};

// Background disc for contrast
function drawBackgroundDisc(ctx, x, y, size) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

// Smoothstep for transition blending
function smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

// Draw a single unit with continuous scaling based on cellPixels
function drawUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  if (!unit.position) return;
  const pos = parseUnitPosition(unit.position);
  if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) return;
  const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
  const color = actorColorMap[unit.actor] || "#FFF";
  const cp = viewport.cellPixels;

  // Base marker size scales continuously
  const markerSize = Math.max(2, cp * 0.35);

  // Blend factor: 0 = dot mode (tiny), 1 = full NATO box
  const boxBlend = smoothstep(24, 40, cp);   // NATO box appears at 24-40px
  const detailBlend = smoothstep(8, 20, cp);  // details (icons, labels) appear at 8-20px

  if (boxBlend > 0.5) {
    // NATO box mode (cp > ~32)
    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(bx + 2, by + 2, boxW, boxH);

    // Box
    ctx.fillStyle = color + "DD";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, boxW, boxH);

    // Type icon
    const iconFn = TYPE_ICONS[unit.type];
    if (iconFn) {
      ctx.strokeStyle = "#FFF";
      ctx.fillStyle = "#FFF";
      ctx.lineWidth = 1.5;
      iconFn(ctx, x, y, boxH * 0.3);
    }

    // Name below
    const fontSize = Math.max(8, cp * 0.18);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeText(unit.name, x, y + boxH / 2 + cp * 0.12);
    ctx.fillStyle = "#FFF";
    ctx.fillText(unit.name, x, y + boxH / 2 + cp * 0.12);

    // Strength bar
    const barW = boxW * 0.8;
    const barH = Math.max(2, cp * 0.04);
    const barX = x - barW / 2;
    const barY = y + boxH / 2 + cp * 0.2;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(barX, barY, barW, barH);
    const str = (unit.strength || 100) / 100;
    ctx.fillStyle = str > 0.5 ? "#22C55E" : str > 0.25 ? "#F59E0B" : "#EF4444";
    ctx.fillRect(barX, barY, barW * str, barH);
  } else {
    // Circle mode (cp < ~32)
    drawBackgroundDisc(ctx, x, y, markerSize + 2);

    // Filled circle with strength-based alpha
    const alpha = Math.max(0.4, (unit.strength || 100) / 100);
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Strength arc (visible when cp >= 8)
    if (detailBlend > 0.1 && (unit.strength || 100) < 100) {
      ctx.globalAlpha = detailBlend;
      ctx.beginPath();
      ctx.arc(x, y, markerSize + 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (unit.strength || 100) / 100));
      ctx.strokeStyle = unit.strength > 50 ? "#22C55E" : unit.strength > 25 ? "#F59E0B" : "#EF4444";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Type icon (visible when cp >= 16)
    if (cp >= 16) {
      const iconFn = TYPE_ICONS[unit.type];
      if (iconFn) {
        ctx.globalAlpha = detailBlend;
        ctx.strokeStyle = "#FFF";
        ctx.fillStyle = "#FFF";
        ctx.lineWidth = 1;
        iconFn(ctx, x, y, markerSize * 0.4);
        ctx.globalAlpha = 1;
      }
    }

    // Name label (visible when cp >= 12)
    if (cp >= 12) {
      const fontSize = Math.max(7, cp * 0.22);
      ctx.globalAlpha = smoothstep(12, 20, cp);
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText(unit.name.slice(0, 12), x, y + markerSize + fontSize * 0.8);
      ctx.fillStyle = "#FFF";
      ctx.fillText(unit.name.slice(0, 12), x, y + markerSize + fontSize * 0.8);
      ctx.globalAlpha = 1;
    }
  }
}

// Draw ghost unit preview during placement
function drawGhostUnit(ctx, ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight) {
  if (!ghostUnit || !ghostUnit.cell) return;
  const { c, r } = ghostUnit.cell;
  const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);
  const color = actorColorMap[ghostUnit.actorId] || "#FFF";
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = 0.5;

  const markerSize = Math.max(2, cp * 0.35);

  if (cp >= 32) {
    // NATO box ghost
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
  } else {
    // Circle ghost
    drawBackgroundDisc(ctx, x, y, markerSize + 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (cp >= 16) {
      const iconFn = TYPE_ICONS[ghostUnit.type];
      if (iconFn) {
        ctx.strokeStyle = "#FFF";
        ctx.fillStyle = "#FFF";
        ctx.lineWidth = 1;
        iconFn(ctx, x, y, markerSize * 0.4);
      }
    }
  }

  ctx.restore();
}

// Main entry point: draw all units with continuous scaling
export function drawUnits(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions = null) {
  if (!units || units.length === 0) {
    if (setupOptions?.ghostUnit) {
      drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
    }
    return;
  }

  for (const unit of units) {
    if (setupOptions?.draggedUnitId === unit.id) continue;
    drawUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows);
  }

  if (setupOptions?.ghostUnit) {
    drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
  }
}
