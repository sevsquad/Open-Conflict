// ════════════════════════════════════════════════════════════════
// UnitOverlay — continuous-scale unit markers for SimMap
// Replaces the old 4-tier discrete system with smooth scaling
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getVisibleRange } from "../ViewportState.js";

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

export function getUnitFogTier(unit, fowMode) {
  if (!unit) return "hidden";
  if (!fowMode) return "visible";
  if (unit.actor === fowMode.activeActorId) return "own";
  if (fowMode.detectedUnits?.has(unit.id)) return "detected";
  if (fowMode.contactUnits?.has(unit.id)) return "contact";
  return "hidden";
}

export function getUnitFogHitPayload(unit, fowMode) {
  const fogTier = getUnitFogTier(unit, fowMode);
  if (fogTier === "hidden") return null;
  if (fogTier === "contact") {
    return {
      id: unit.id,
      actor: unit.actor,
      position: unit.position,
      __fogTier: fogTier,
    };
  }
  return { ...unit, __fogTier: fogTier };
}

// NATO echelon marks drawn above the unit box
const ECHELON_MARKS = {
  fireteam: "dot1", squad: "dot2", weapons_team: "dot1", sniper_team: "dot1",
  platoon: "bar1", company: "bar1", mortar_section: "dot2",
  anti_tank_team: "dot1", forward_observer: "dot1",
  battalion: "bar2", battle_group: "bar2", brigade: "bar3",
  artillery_battery: "bar2", engineer_company: "bar1",
  division: "xx", corps_asset: "xxx", aviation_brigade: "bar3",
  corps: "xxx", army: "xxxx", air_force_wing: "xxx", naval_task_force: "xxx",
  army_group: "xxxxx", national_forces: "xxxxxx", coalition_command: "xxxxxx",
};

function drawEchelonMark(ctx, echelon, cx, topY, boxW) {
  const mark = ECHELON_MARKS[echelon];
  if (!mark) return;
  ctx.fillStyle = "#FFF";
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 1.5;
  const markY = topY - 4;
  if (mark === "dot1") {
    ctx.beginPath(); ctx.arc(cx, markY, 2, 0, Math.PI * 2); ctx.fill();
  } else if (mark === "dot2") {
    ctx.beginPath(); ctx.arc(cx - 4, markY, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4, markY, 2, 0, Math.PI * 2); ctx.fill();
  } else if (mark.startsWith("bar")) {
    const count = parseInt(mark[3]) || 1;
    const barW = Math.min(boxW * 0.15, 6);
    const gap = barW + 2;
    const totalW = count * barW + (count - 1) * 2;
    const startX = cx - totalW / 2;
    for (let i = 0; i < count; i++) {
      ctx.fillRect(startX + i * gap, markY - 4, barW, 8);
    }
  } else if (mark.startsWith("x")) {
    const count = mark.length;
    const xSize = 3;
    const gap = xSize * 2 + 1;
    const totalW = count * gap;
    const startX = cx - totalW / 2 + gap / 2;
    for (let i = 0; i < count; i++) {
      const xx = startX + i * gap;
      ctx.beginPath();
      ctx.moveTo(xx - xSize, markY - xSize); ctx.lineTo(xx + xSize, markY + xSize);
      ctx.moveTo(xx + xSize, markY - xSize); ctx.lineTo(xx - xSize, markY + xSize);
      ctx.stroke();
    }
  }
}

// Short labels for unit type identification at a glance
const TYPE_LABELS = {
  infantry: "INF", armor: "ARM", artillery: "ART", recon: "RCN",
  mechanized: "MECH", air: "AIR", naval: "NAV", special_forces: "SF",
  logistics: "LOG", headquarters: "HQ", engineer: "ENG", air_defense: "ADA",
  parachute_infantry: "PARA", glider_infantry: "GLDR",
  tank_destroyer: "TD", armored_infantry: "AINF",
  other: "OTH",
};

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
  engineer: (ctx, cx, cy, s) => {
    // Castle/fortification symbol
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.5);
    ctx.lineTo(cx - s, cy - s * 0.5);
    ctx.lineTo(cx - s * 0.3, cy - s * 0.5);
    ctx.lineTo(cx - s * 0.3, cy);
    ctx.lineTo(cx + s * 0.3, cy);
    ctx.lineTo(cx + s * 0.3, cy - s * 0.5);
    ctx.lineTo(cx + s, cy - s * 0.5);
    ctx.lineTo(cx + s, cy + s * 0.5);
    ctx.stroke();
  },
  air_defense: (ctx, cx, cy, s) => {
    // Arc over dot
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.3, s * 0.7, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.3, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  },
  other: (ctx, cx, cy, s) => {
    // Circle with dot — generic/unknown unit
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  },
  parachute_infantry: (ctx, cx, cy, s) => {
    // Infantry X + parachute arc above
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.3); ctx.lineTo(cx + s, cy + s * 0.7);
    ctx.moveTo(cx + s, cy - s * 0.3); ctx.lineTo(cx - s, cy + s * 0.7);
    ctx.stroke();
    // Parachute canopy arc
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0);
    ctx.stroke();
  },
  glider_infantry: (ctx, cx, cy, s) => {
    // Infantry X + glider wing chevron above
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.2); ctx.lineTo(cx + s, cy + s * 0.8);
    ctx.moveTo(cx + s, cy - s * 0.2); ctx.lineTo(cx - s, cy + s * 0.8);
    ctx.stroke();
    // Glider wing — shallow inverted V
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s * 0.5);
    ctx.lineTo(cx, cy - s * 0.9);
    ctx.lineTo(cx + s, cy - s * 0.5);
    ctx.stroke();
  },
  tank_destroyer: (ctx, cx, cy, s) => {
    // Armor diamond + vertical bar through center
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
    ctx.stroke();
  },
  armored_infantry: (ctx, cx, cy, s) => {
    // Infantry X + wheel below (same concept as mechanized)
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.8, s * 0.3, 0, Math.PI * 2);
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
function getRenderablePosition(unit, options = null) {
  if (options?.rtsDisplayState?.unitPositions?.[unit.id]) {
    return options.rtsDisplayState.unitPositions[unit.id];
  }
  if (!unit.position) return null;
  return parseUnitPosition(unit.position);
}

function drawUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, options = null) {
  const pos = getRenderablePosition(unit, options);
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

    // Echelon mark above box
    if (unit.echelon && cp >= 40) {
      drawEchelonMark(ctx, unit.echelon, x, by, boxW);
    }

    // Type icon (shifted up slightly to make room for label)
    const iconFn = TYPE_ICONS[unit.type];
    if (iconFn) {
      ctx.strokeStyle = "#FFF";
      ctx.fillStyle = "#FFF";
      ctx.lineWidth = 1.5;
      iconFn(ctx, x, y - boxH * 0.08, boxH * 0.3);
    }

    // Type label inside box, below icon
    const typeLabel = TYPE_LABELS[unit.type];
    if (typeLabel) {
      const labelSize = Math.max(6, boxH * 0.28);
      ctx.font = `bold ${labelSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(typeLabel, x, by + boxH - 1);
      ctx.textBaseline = "alphabetic";
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

    // Posture indicator (small icon at box edge)
    if (cp >= 40) {
      drawPostureIndicator(ctx, unit, x, y, boxW, boxH, cp);
    }

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

    // Type label tag above circle (visible when cp >= 16)
    if (cp >= 16) {
      const typeLabel = TYPE_LABELS[unit.type];
      if (typeLabel) {
        const tagSize = Math.max(6, cp * 0.16);
        ctx.globalAlpha = detailBlend;
        ctx.font = `bold ${tagSize}px Arial`;
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 2;
        ctx.strokeText(typeLabel, x, y - markerSize - 2);
        ctx.fillStyle = "#FFF";
        ctx.fillText(typeLabel, x, y - markerSize - 2);
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

// Posture indicator — small icon drawn at bottom-right of unit
const POSTURE_INDICATORS = {
  attacking: { symbol: "\u25B6", color: "#EF4444" },    // Red right-arrow
  defending: { symbol: "\u25A0", color: "#3B82F6" },    // Blue square
  moving: { symbol: "\u25B6", color: "#22C55E" },       // Green right-arrow
  dug_in: { symbol: "\u25BC", color: "#6B7280" },       // Grey down-arrow (dug in)
  retreating: { symbol: "\u25C0", color: "#F59E0B" },   // Amber left-arrow
  reserve: { symbol: "\u25CB", color: "#8B5CF6" },      // Purple circle
  routing: { symbol: "\u25C0\u25C0", color: "#EF4444" }, // Double red left-arrow
};

function drawPostureIndicator(ctx, unit, x, y, boxW, boxH, cp) {
  const pi = POSTURE_INDICATORS[unit.posture];
  if (!pi || unit.posture === "ready") return;
  const size = Math.max(6, cp * 0.12);
  const ix = x + boxW / 2 + 2;
  const iy = y - boxH / 2 + size;
  ctx.font = `${size}px Arial`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = pi.color;
  ctx.fillText(pi.symbol, ix, iy);
}

// Combat engagement indicator — red flash between engaged units at same position
function drawCombatIndicators(ctx, units, viewport, canvasWidth, canvasHeight) {
  // Group units by position
  const byPos = {};
  for (const u of units) {
    if (!u.position) continue;
    const key = u.position;
    if (!byPos[key]) byPos[key] = [];
    byPos[key].push(u);
  }
  // Draw clash icon where different actors share a hex
  for (const [posStr, posUnits] of Object.entries(byPos)) {
    const actors = new Set(posUnits.map(u => u.actor));
    if (actors.size < 2) continue;
    const pos = parseUnitPosition(posStr);
    if (!pos) continue;
    const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
    const cp = viewport.cellPixels;
    // Draw a small explosion/clash icon
    const r = Math.max(3, cp * 0.12);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#EF4444";
    // Star burst
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y - cp * 0.35);
      ctx.lineTo(x + Math.cos(angle) * r * 2, y - cp * 0.35 + Math.sin(angle) * r * 2);
      ctx.lineTo(x + Math.cos(angle + 0.3) * r, y - cp * 0.35 + Math.sin(angle + 0.3) * r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
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

// Front line (FEBA) rendering — connects frontmost units of each actor
// Only draws when showFrontLines is true and there are at least 2 actors with 2+ units
function drawFrontLines(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight) {
  // Group units by actor
  const byActor = {};
  for (const u of units) {
    if (!u.position || u.status === "destroyed" || u.status === "eliminated") continue;
    if (!byActor[u.actor]) byActor[u.actor] = [];
    const pos = parseUnitPosition(u.position);
    if (pos) byActor[u.actor].push({ ...u, _pos: pos });
  }

  for (const [actorId, actorUnits] of Object.entries(byActor)) {
    if (actorUnits.length < 2) continue;
    const color = actorColorMap[actorId] || "#FFF";

    // Sort by row then col to create a connected line
    const sorted = actorUnits.sort((a, b) => a._pos.r - b._pos.r || a._pos.c - b._pos.c);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < sorted.length; i++) {
      const { x, y } = gridToScreen(sorted[i]._pos.c, sorted[i]._pos.r, viewport, canvasWidth, canvasHeight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawSelectedUnits(ctx, units, selectedUnitIds, viewport, canvasWidth, canvasHeight, options = null) {
  const selected = new Set(selectedUnitIds || []);
  if (selected.size === 0) return;
  ctx.save();
  ctx.strokeStyle = "#60A5FA";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  for (const unit of units) {
    if (!selected.has(unit.id)) continue;
    const pos = getRenderablePosition(unit, options);
    if (!pos) continue;
    const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
    const radius = Math.max(6, viewport.cellPixels * 0.42);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUnderFireMarkers(ctx, units, underFireUnitIds, viewport, canvasWidth, canvasHeight, options = null) {
  ctx.save();
  ctx.fillStyle = "#EF4444";
  for (const unit of units) {
    if (!underFireUnitIds.has(unit.id)) continue;
    const fogTier = getUnitFogTier(unit, options?.fowMode);
    if (options?.fowMode && !["own", "detected", "visible"].includes(fogTier)) continue;
    const pos = getRenderablePosition(unit, options);
    if (!pos) continue;
    const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
    const radius = Math.max(3, viewport.cellPixels * 0.12);
    ctx.beginPath();
    ctx.arc(x + radius * 2, y - radius * 2, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Main entry point: draw all units with continuous scaling
// fowMode: { activeActorId, detectedUnits: Set, lastKnown: { unitId: { position, turn, type, strength, stale } } }
export function drawUnits(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions = null) {
  if (!units || units.length === 0) {
    if (setupOptions?.ghostUnit) {
      drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
    }
    return;
  }

  const fowMode = setupOptions?.fowMode;

  for (const unit of units) {
    if (setupOptions?.draggedUnitId === unit.id) continue;

    // FOW filtering: decide how to render each unit based on detection tier
    if (fowMode) {
      const fogTier = getUnitFogTier(unit, fowMode);
      const isOwnUnit = fogTier === "own";
      const isIdentified = fogTier === "detected";
      const isContact = fogTier === "contact";

      if (!isOwnUnit && !isIdentified && !isContact) {
        // Undetected — skip drawing (invisible to active actor)
        continue;
      }

      if (!isOwnUnit && isIdentified) {
        // Identified enemy — draw with full details but distinct styling
        drawDetectedEnemyUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions);
        continue;
      }

      if (!isOwnUnit && isContact) {
        // Contact-tier — draw generic "?" token, no unit details
        drawContactMarker(ctx, unit, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions);
        continue;
      }
    }

    // Normal rendering: own units or FOW disabled
    drawUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions);
  }

  // Draw last-known ghost markers for enemies that went dark
  if (fowMode?.lastKnown) {
    for (const [unitId, info] of Object.entries(fowMode.lastKnown)) {
      // Don't draw ghosts for units currently detected or in contact
      if (fowMode.detectedUnits?.has(unitId)) continue;
      if (fowMode.contactUnits?.has(unitId)) continue;
      drawLastKnownGhost(ctx, unitId, info, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows);
    }
  }

  // Combat indicators where opposing forces share a hex
  if (viewport.cellPixels >= 20) {
    const visibleUnits = fowMode
      ? units.filter(u => u.actor === fowMode.activeActorId || fowMode.detectedUnits?.has(u.id))
      : units;
    drawCombatIndicators(ctx, visibleUnits, viewport, canvasWidth, canvasHeight);
  }

  // Front lines (FEBA) — dashed lines connecting each actor's unit positions
  if (setupOptions?.showFrontLines && viewport.cellPixels >= 8) {
    const visibleUnits = fowMode
      ? units.filter(u => u.actor === fowMode.activeActorId || fowMode.detectedUnits?.has(u.id))
      : units;
    drawFrontLines(ctx, visibleUnits, actorColorMap, viewport, canvasWidth, canvasHeight);
  }

  if (setupOptions?.selectedUnitIds?.length) {
    drawSelectedUnits(ctx, units, setupOptions.selectedUnitIds, viewport, canvasWidth, canvasHeight, setupOptions);
  }

  if (setupOptions?.rtsDisplayState?.underFireUnitIds?.size) {
    drawUnderFireMarkers(ctx, units, setupOptions.rtsDisplayState.underFireUnitIds, viewport, canvasWidth, canvasHeight, setupOptions);
  }

  if (setupOptions?.ghostUnit) {
    drawGhostUnit(ctx, setupOptions.ghostUnit, actorColorMap, viewport, canvasWidth, canvasHeight);
  }
}


// ── FOW Rendering Helpers ────────────────────────────────────

/**
 * Draw a detected enemy unit with dashed border and reduced opacity.
 * Visually distinct from own units — the player knows this info is
 * from spotting, not perfect intel.
 */
function drawDetectedEnemyUnit(ctx, unit, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, options = null) {
  const pos = getRenderablePosition(unit, options);
  if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) return;
  const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
  const color = actorColorMap[unit.actor] || "#FFF";
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = 0.7; // slightly transparent

  const markerSize = Math.max(2, cp * 0.35);
  const boxBlend = smoothstep(24, 40, cp);

  if (boxBlend > 0.5) {
    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

    // Box fill
    ctx.fillStyle = color + "99";
    ctx.fillRect(bx, by, boxW, boxH);

    // Dashed border instead of solid
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.setLineDash([]);

    // "?" icon indicating uncertain intel
    if (cp >= 30) {
      ctx.fillStyle = "#FFF";
      ctx.font = `bold ${Math.round(boxH * 0.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x, y);
    }

    // Type label below box if zoomed in enough
    if (cp >= 40) {
      ctx.fillStyle = "#FFF";
      ctx.font = `${Math.max(8, cp * 0.12)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(unit.type, x, by + boxH + 2);
    }
  } else {
    // Small dot with dashed circle at lower zoom
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fillStyle = color + "99";
    ctx.fill();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}


/**
 * Draw a ghost marker for a last-known enemy position.
 * Faded, dashed, with a "?" and turn number.
 */
function drawLastKnownGhost(ctx, unitId, info, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows) {
  if (!info.position) return;
  const pos = parseUnitPosition(info.position);
  if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) return;
  const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = info.stale ? 0.2 : 0.35;

  const markerSize = Math.max(2, cp * 0.3);
  const boxBlend = smoothstep(24, 40, cp);

  // Use a neutral gray color for ghosts
  const ghostColor = "#888";

  if (boxBlend > 0.5) {
    const boxW = cp * 0.6;
    const boxH = cp * 0.4;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

    // Dashed box
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = ghostColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.setLineDash([]);

    // "?" icon
    ctx.fillStyle = ghostColor;
    ctx.font = `bold ${Math.round(boxH * 0.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y);

    // "Turn N" label below
    if (cp >= 35 && info.turn) {
      ctx.globalAlpha = Math.min(ctx.globalAlpha + 0.2, 0.6);
      ctx.font = `${Math.max(7, cp * 0.1)}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(`T${info.turn}`, x, by + boxH + 2);
    }
  } else {
    // Small dashed circle
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = ghostColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}


/**
 * Draw a contact-tier marker — generic "?" diamond token indicating
 * "something is here but we don't know what".
 * No unit type, name, or strength shown.
 */
function drawContactMarker(ctx, unit, viewport, canvasWidth, canvasHeight, cols, rows, options = null) {
  const pos = getRenderablePosition(unit, options);
  if (!pos || pos.c < 0 || pos.c >= cols || pos.r < 0 || pos.r >= rows) return;
  const { x, y } = gridToScreen(pos.c, pos.r, viewport, canvasWidth, canvasHeight);
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = 0.6;

  // Amber/yellow color for unidentified contacts
  const contactColor = "#E8A020";
  const markerSize = Math.max(3, cp * 0.3);
  const boxBlend = smoothstep(24, 40, cp);

  if (boxBlend > 0.5) {
    // Diamond shape with "?" — visually distinct from square NATO boxes
    const diamondSize = cp * 0.35;

    ctx.beginPath();
    ctx.moveTo(x, y - diamondSize);
    ctx.lineTo(x + diamondSize, y);
    ctx.lineTo(x, y + diamondSize);
    ctx.lineTo(x - diamondSize, y);
    ctx.closePath();

    ctx.fillStyle = contactColor + "44";
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = contactColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // "?" in the center
    ctx.fillStyle = contactColor;
    ctx.font = `bold ${Math.round(diamondSize * 1.2)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y);

    // "CONTACT" label below if zoomed in enough
    if (cp >= 50) {
      ctx.globalAlpha = 0.5;
      ctx.font = `${Math.max(8, cp * 0.1)}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText("CONTACT", x, y + diamondSize + 3);
    }
  } else {
    // Small diamond at lower zoom
    const sz = markerSize * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y - sz);
    ctx.lineTo(x + sz, y);
    ctx.lineTo(x, y + sz);
    ctx.lineTo(x - sz, y);
    ctx.closePath();
    ctx.fillStyle = contactColor + "66";
    ctx.fill();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = contactColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}


/**
 * Draw FOW overlay: semi-transparent dark tint on hexes the active actor
 * cannot currently observe. Terrain is still visible underneath.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} fowMode - { visibleCells: Set, activeActorId }
 * @param {Object} viewport
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} cols
 * @param {number} rows
 */
export function drawFowOverlay(ctx, fowMode, viewport, canvasWidth, canvasHeight, cols, rows) {
  if (!fowMode?.visibleCells || fowMode.visibleCells.size === 0) return;

  const cp = viewport.cellPixels;
  // Hex geometry: pointy-top outer radius
  const hexSize = cp / Math.sqrt(3);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#0A0A14"; // very dark blue-black tint

  // Use shared visible range calculation (matches WebGL tile culling)
  const visRange = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
  const startCol = visRange.colMin;
  const endCol = Math.min(visRange.colMax, cols - 1);
  const startRow = visRange.rowMin;
  const endRow = Math.min(visRange.rowMax, rows - 1);

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const key = `${c},${r}`;
      if (fowMode.visibleCells.has(key)) continue; // visible — no tint

      const { x, y } = gridToScreen(c, r, viewport, canvasWidth, canvasHeight);

      // Draw hex-shaped tint (pointy-top)
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const vx = x + hexSize * Math.cos(angle);
        const vy = y + hexSize * Math.sin(angle);
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}
