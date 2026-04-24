// ════════════════════════════════════════════════════════════════
// VPOverlay — Canvas 2D overlay for VP + CVP hex markers
//
// VP hexes: shared objectives, gold border (or controller-colored).
// CVP hexes: per-actor must-hold hexes, drawn in actor color.
// A hex can be both VP and CVP — labels stack vertically.
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getVisibleRange } from "../ViewportState.js";
import { cellPixelsToHexSize } from "../HexMath.js";

const VP_NEUTRAL = "#F59E0B";
const VP_CONTESTED = "#9CA3AF";
const VP_ZONE_OUTLINE = "rgba(12, 16, 24, 0.95)";

/**
 * Draw VP and CVP hex markers on the map.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} hexVP - [{ hex, name, vp }] — shared VP objectives
 * @param {Object|null} vpControl - { "col,row": actorId } or null (setup mode)
 * @param {Object} actorColorMap - { actorId: "#color" }
 * @param {Object} viewport
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {number} cols - grid columns
 * @param {number} rows - grid rows
 * @param {Array|null} cvpHexes - [{ hex, actorId }] — per-actor critical hexes
 * @param {Object|null} holdProgress - { "col,row": { progress, controller, heldMs, requiredMs } } for RTS hold-to-capture
 * @param {Array|null} vpZoneOutlines - [{ zoneId, objectiveHexes, centroidHex, segments: [{ hex, edge }] }]
 */
export function drawVPHexes(ctx, hexVP, vpControl, actorColorMap, viewport, w, h, cols, rows, cvpHexes, holdProgress, vpZoneOutlines = null) {
  const cp = viewport.cellPixels;
  if (cp < 4) return;
  const hasVP = hexVP && hexVP.length > 0;
  const hasCVP = cvpHexes && cvpHexes.length > 0;
  if (!hasVP && !hasCVP) return;

  const visRange = getVisibleRange(viewport, w, h, cols, rows);
  const hexSize = cellPixelsToHexSize(cp);

  // Build a lookup of CVP entries per hex: { "col,row": [actorId, ...] }
  const cvpByHex = {};
  if (hasCVP) {
    for (const entry of cvpHexes) {
      if (!cvpByHex[entry.hex]) cvpByHex[entry.hex] = [];
      cvpByHex[entry.hex].push(entry.actorId);
    }
  }

  // Collect all unique hex keys that need rendering (VP + CVP)
  const allHexes = new Set();
  if (hasVP) hexVP.forEach(v => allHexes.add(v.hex));
  if (hasCVP) cvpHexes.forEach(c => allHexes.add(c.hex));

  // Build VP lookup for label data
  const vpByHex = {};
  if (hasVP) hexVP.forEach(v => { vpByHex[v.hex] = v; });

  ctx.save();
  if (Array.isArray(vpZoneOutlines) && vpZoneOutlines.length > 0) {
    drawZoneOutlines(ctx, vpZoneOutlines, viewport, w, h, cols, rows, cp, hexSize, visRange);
  }

  for (const hexKey of allHexes) {
    const parts = hexKey.split(",");
    const col = parseInt(parts[0]);
    const row = parseInt(parts[1]);
    if (isNaN(col) || isNaN(row)) continue;

    if (col < visRange.colMin || col > visRange.colMax) continue;
    if (row < visRange.rowMin || row > visRange.rowMax) continue;

    const { x, y } = gridToScreen(col, row, viewport, w, h);
    const vp = vpByHex[hexKey] || null;
    const cvpActors = cvpByHex[hexKey] || [];

    // Determine border color
    let borderColor;
    if (vp) {
      const controller = vpControl?.[hexKey];
      if (!controller || !vpControl) borderColor = VP_NEUTRAL;
      else if (controller === "contested") borderColor = VP_CONTESTED;
      else borderColor = actorColorMap?.[controller] || VP_NEUTRAL;
    } else {
      // CVP-only hex — use first actor's color
      borderColor = actorColorMap?.[cvpActors[0]] || VP_NEUTRAL;
    }

    // Draw hex border
    drawHexBorder(ctx, x, y, hexSize, cp, borderColor, !!vp);

    // Hold-to-capture progress arc (RTS mode only — holdProgress is null otherwise).
    // Rendered OUTSIDE the border so it remains visible regardless of label density.
    const holdEntry = holdProgress?.[hexKey];
    if (holdEntry && holdEntry.progress > 0.001) {
      const arcColor = holdEntry.controller
        ? (actorColorMap?.[holdEntry.controller] || VP_NEUTRAL)
        : VP_NEUTRAL;
      drawHoldProgressArc(ctx, x, y, hexSize, cp, holdEntry.progress, arcColor);
    }

    // Labels at moderate zoom
    if (cp >= 15) {
      drawLabels(ctx, x, y, hexSize, cp, vp, cvpActors, borderColor, actorColorMap);
    }
  }

  ctx.restore();
}


// ── Drawing Helpers ──────────────────────────────────────────

function drawZoneOutlines(ctx, vpZoneOutlines, viewport, w, h, cols, rows, cp, hexSize, visRange) {
  ctx.save();
  ctx.strokeStyle = VP_ZONE_OUTLINE;
  ctx.lineWidth = Math.max(2, cp * 0.05);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = cp >= 12 ? 0.88 : 0.72;
  for (const outline of vpZoneOutlines) {
    if (!Array.isArray(outline?.segments) || outline.segments.length === 0) continue;
    ctx.beginPath();
    let drewSegment = false;
    for (const segment of outline.segments) {
      const [colRaw, rowRaw] = String(segment.hex || "").split(",");
      const col = Number(colRaw);
      const row = Number(rowRaw);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      if (col < visRange.colMin - 1 || col > visRange.colMax + 1) continue;
      if (row < visRange.rowMin - 1 || row > visRange.rowMax + 1) continue;
      const { x, y } = gridToScreen(col, row, viewport, w, h);
      const { from, to } = getHexEdgePoints(x, y, hexSize * 1.02, segment.edge);
      if (!from || !to) continue;
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      drewSegment = true;
    }
    if (drewSegment) ctx.stroke();
  }
  ctx.restore();
}

function drawHexBorder(ctx, x, y, hexSize, cp, color, isVP) {
  const inset = hexSize * 0.88;
  ctx.beginPath();
  for (let v = 0; v < 6; v++) {
    const angle = (Math.PI / 3) * v - Math.PI / 6;
    const px = x + inset * Math.cos(angle);
    const py = y + inset * Math.sin(angle);
    if (v === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, cp * 0.04);
  ctx.globalAlpha = 0.75;
  // VP hexes get dashed border, CVP-only get solid
  if (isVP) {
    ctx.setLineDash([cp * 0.08, cp * 0.05]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.06;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function getHexEdgePoints(x, y, radius, edgeIndex) {
  const vertices = [];
  for (let v = 0; v < 6; v += 1) {
    const angle = (Math.PI / 3) * v - Math.PI / 6;
    vertices.push({
      x: x + radius * Math.cos(angle),
      y: y + radius * Math.sin(angle),
    });
  }
  const edgeVertexMap = [
    [0, 1],
    [5, 0],
    [4, 5],
    [3, 4],
    [2, 3],
    [1, 2],
  ];
  const pair = edgeVertexMap[edgeIndex];
  if (!pair) return { from: null, to: null };
  return {
    from: vertices[pair[0]],
    to: vertices[pair[1]],
  };
}


/**
 * Draw a progress arc around the VP hex indicating hold-to-capture accumulation.
 * The arc grows clockwise from the top (12 o'clock) and is color-matched to the
 * current controller. Near completion (>= 90%) it pulses faintly for emphasis.
 */
function drawHoldProgressArc(ctx, x, y, hexSize, cp, progress, color) {
  const p = Math.max(0, Math.min(1, progress));
  // Radius sits just outside the dashed VP border (border inset is 0.88).
  const radius = hexSize * 0.95;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + p * Math.PI * 2;

  ctx.save();

  // Background track — thin, faint ring showing the full "path" to capture.
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = Math.max(1.5, cp * 0.035);
  ctx.stroke();

  // Progress arc — bright, thicker.
  ctx.beginPath();
  ctx.arc(x, y, radius, startAngle, endAngle);
  ctx.strokeStyle = color;
  ctx.globalAlpha = p >= 0.9 ? 0.95 : 0.8;
  ctx.lineWidth = Math.max(2.5, cp * 0.06);
  ctx.lineCap = "round";
  ctx.stroke();

  // Near-complete indicator: inner pulse dot at 12 o'clock.
  if (p >= 0.9) {
    ctx.beginPath();
    ctx.arc(x, y - radius, Math.max(1.5, cp * 0.05), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
  ctx.restore();
}


function drawLabels(ctx, x, y, hexSize, cp, vp, cvpActors, borderColor, actorColorMap) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const showName = cp >= 25 && vp?.name;
  const hasCVP = cvpActors.length > 0 && cp >= 18;
  const lineHeight = Math.max(10, cp * 0.16);

  // Count lines: name + VP value + CVP line
  let lines = 0;
  if (showName) lines++;
  if (vp) lines++; // VP value
  if (hasCVP) lines++;
  if (lines === 0) return;

  const totalHeight = lines * lineHeight;
  let topY = y - totalHeight / 2 + lineHeight / 2;

  // Name
  if (showName) {
    const nameFontSize = Math.max(7, Math.min(cp * 0.1, 13));
    ctx.font = `${nameFontSize}px sans-serif`;
    ctx.fillStyle = borderColor;
    ctx.globalAlpha = 0.7;
    ctx.fillText(vp.name, x, topY);
    topY += lineHeight;
  }

  // VP value
  if (vp) {
    const valueFontSize = Math.max(8, Math.min(cp * 0.14, 18));
    ctx.font = `bold ${valueFontSize}px monospace`;
    ctx.fillStyle = borderColor;
    ctx.globalAlpha = 0.9;
    ctx.fillText(`${vp.vp}VP`, x, topY);
    topY += lineHeight;
  }

  // Per-actor CVP markers — show "CVP" in each actor's color
  if (hasCVP) {
    const cvpFontSize = Math.max(7, Math.min(cp * 0.11, 14));
    ctx.font = `bold ${cvpFontSize}px monospace`;

    const label = "CVP";
    const gap = cp * 0.06;
    const labelWidth = ctx.measureText(label).width;
    const totalWidth = labelWidth * cvpActors.length + gap * (cvpActors.length - 1);
    let drawX = x - totalWidth / 2;

    for (const actorId of cvpActors) {
      ctx.fillStyle = actorColorMap?.[actorId] || VP_NEUTRAL;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = "left";
      ctx.fillText(label, drawX, topY);
      drawX += labelWidth + gap;
    }
    ctx.textAlign = "center";
  }

  ctx.globalAlpha = 1;
}
