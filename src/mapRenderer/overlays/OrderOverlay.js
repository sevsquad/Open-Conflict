// ════════════════════════════════════════════════════════════════
// OrderOverlay — persistent visualization of confirmed orders
// during the planning phase. Two main features:
//   1. Movement ghosts: semi-transparent unit at destination + route
//   2. Hex target rings: colored concentric inner-strokes on targeted hexes
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getVisibleRange } from "../ViewportState.js";
import { cellPixelsToHexSize } from "../HexMath.js";
import { TYPE_ICONS } from "./UnitOverlay.js";

// ── Color mapping for action order target rings ──────────────
// Each order type that targets a hex gets a distinct ring color.
// Colors chosen for maximum distinguishability when stacked.
export const ORDER_RING_COLORS = {
  ATTACK:             "#FF3333",  // red — assault
  SUPPORT_FIRE:       "#FF8C00",  // orange — direct fire
  FIRE_MISSION:       "#FFD700",  // gold — artillery HE
  FIRE_MISSION_SMOKE: "#AAAAAA",  // gray — smoke screen
  RECON:              "#4488FF",  // blue — intelligence
  AIR_RECON:          "#00CCDD",  // cyan — aerial intel
  ENGINEER:           "#33BB44",  // green — construction/earthwork
  CAS:                "#FF44FF",  // magenta — close air support
  INTERDICTION:       "#8855CC",  // purple — supply disruption
  SEAD:               "#FF1493",  // hot pink — air defense suppression
  SHORE_BOMBARDMENT:  "#3355AA",  // navy — naval fire
  STRATEGIC_STRIKE:   "#CC0033",  // crimson — strategic bombing
  AIR_SUPERIORITY:    "#00AAAA",  // teal — air control
};

// Short labels for ring tooltip/identification at high zoom
const ORDER_RING_LABELS = {
  ATTACK: "ATK", SUPPORT_FIRE: "SF", FIRE_MISSION: "FM",
  FIRE_MISSION_SMOKE: "SMK", RECON: "RCN", AIR_RECON: "AR",
  ENGINEER: "ENG", CAS: "CAS", INTERDICTION: "INT",
  SEAD: "SEAD", SHORE_BOMBARDMENT: "SB", STRATEGIC_STRIKE: "SS",
  AIR_SUPERIORITY: "AS",
};

/**
 * Resolve the ring color key for an action order.
 * FIRE_MISSION with subtype SMOKE gets a distinct color.
 */
function ringColorKey(actionOrder) {
  if (actionOrder.id === "FIRE_MISSION" && actionOrder.subtype === "SMOKE") {
    return "FIRE_MISSION_SMOKE";
  }
  return actionOrder.id;
}

// ── Main draw function ───────────────────────────────────────

/**
 * Draw confirmed-order overlays on the Canvas 2D layer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} overlayData - pre-processed from SimGame:
 *   {
 *     ghosts: [{ destCol, destRow, route: [{col,row}], type, actor, name, strength, echelon, isWithdraw }],
 *     rings:  { "col,row": [{ key, color, label }] }
 *   }
 * @param {Object} actorColorMap - { actorId: "#color" }
 * @param {Object} viewport
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {number} cols
 * @param {number} rows
 */
export function drawOrderOverlay(ctx, overlayData, actorColorMap, viewport, w, h, cols, rows) {
  if (!overlayData) return;
  const cp = viewport.cellPixels;

  // Draw target rings first (under ghosts and routes)
  if (overlayData.rings) {
    drawTargetRings(ctx, overlayData.rings, viewport, w, h, cols, rows);
  }

  // Draw movement routes and destination ghosts
  if (overlayData.ghosts && overlayData.ghosts.length > 0) {
    for (const ghost of overlayData.ghosts) {
      drawMovementRoute(ctx, ghost, actorColorMap, viewport, w, h);
      drawDestinationGhost(ctx, ghost, actorColorMap, viewport, w, h);
    }
  }
}

// ── Movement route (dashed line from current pos through waypoints) ──

function drawMovementRoute(ctx, ghost, actorColorMap, viewport, w, h) {
  if (!ghost.route || ghost.route.length < 2) return;
  const color = actorColorMap[ghost.actor] || "#FFF";
  const cp = viewport.cellPixels;

  // Convert route to screen coords
  const points = ghost.route.map(p =>
    gridToScreen(p.col, p.row, viewport, w, h)
  );

  ctx.save();

  // Dashed line in actor color, semi-transparent
  ctx.strokeStyle = color + "88"; // ~53% opacity
  ctx.lineWidth = Math.max(1.5, cp * 0.03);
  ctx.setLineDash(ghost.isWithdraw ? [3, 5] : [6, 4]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].x, points[i].y);
    else ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Waypoint dots (intermediate points, not start or end)
  if (ghost.route.length > 2 && cp >= 12) {
    ctx.fillStyle = color + "66";
    for (let i = 1; i < points.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, Math.max(2, cp * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Arrowhead at destination end
  if (points.length >= 2) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const arrowSize = Math.max(4, cp * 0.1);

    ctx.fillStyle = color + "88";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(
      last.x - arrowSize * Math.cos(angle - Math.PI / 6),
      last.y - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      last.x - arrowSize * Math.cos(angle + Math.PI / 6),
      last.y - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ── Destination ghost (semi-transparent unit at planned position) ──

function drawDestinationGhost(ctx, ghost, actorColorMap, viewport, w, h) {
  const { x, y } = gridToScreen(ghost.destCol, ghost.destRow, viewport, w, h);
  const color = actorColorMap[ghost.actor] || "#FFF";
  const cp = viewport.cellPixels;

  ctx.save();
  ctx.globalAlpha = 0.35;

  const markerSize = Math.max(2, cp * 0.35);

  if (cp >= 32) {
    // NATO box ghost — dashed border, semi-transparent fill
    const boxW = cp * 0.7;
    const boxH = cp * 0.5;
    const bx = x - boxW / 2;
    const by = y - boxH / 2;

    ctx.fillStyle = color + "77";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.setLineDash([]);

    // Type icon inside
    const iconFn = TYPE_ICONS[ghost.type];
    if (iconFn) {
      ctx.strokeStyle = "#FFF";
      ctx.fillStyle = "#FFF";
      ctx.lineWidth = 1.5;
      iconFn(ctx, x, y, boxH * 0.3);
    }

    // Name label below at higher zoom
    if (cp >= 40) {
      ctx.globalAlpha = 0.3;
      const fontSize = Math.max(7, cp * 0.14);
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeText(ghost.name, x, y + boxH / 2 + fontSize);
      ctx.fillStyle = "#FFF";
      ctx.fillText(ghost.name, x, y + boxH / 2 + fontSize);
    }
  } else if (cp >= 6) {
    // Circle ghost at lower zoom
    ctx.fillStyle = color + "66";
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#FFF";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Type icon inside at medium zoom
    if (cp >= 16) {
      const iconFn = TYPE_ICONS[ghost.type];
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

// ── Hex target rings (concentric colored inner-strokes) ──────

/**
 * Draw concentric colored ring strokes inside targeted hexes.
 * Each order targeting a hex adds one ring. Rings stack inward.
 */
function drawTargetRings(ctx, ringsMap, viewport, w, h, cols, rows) {
  const cp = viewport.cellPixels;
  if (cp < 6) return; // too small to see rings

  const hexSize = cellPixelsToHexSize(cp);

  // Ring geometry: thickness and gap scale with hex size
  const ringThickness = Math.max(1.5, cp * 0.035);
  const ringGap = Math.max(2, cp * 0.05);

  // Only draw hexes in visible range
  const visRange = getVisibleRange(viewport, w, h, cols, rows);

  ctx.save();

  for (const [posKey, orders] of Object.entries(ringsMap)) {
    // Parse position
    const match = posKey.match(/^(\d+),(\d+)$/);
    if (!match) continue;
    const col = parseInt(match[1]);
    const row = parseInt(match[2]);

    // Cull off-screen hexes
    if (col < visRange.colMin || col > visRange.colMax) continue;
    if (row < visRange.rowMin || row > visRange.rowMax) continue;

    const { x, y } = gridToScreen(col, row, viewport, w, h);

    // Draw each ring inset from the hex edge
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      // Inset distance: first ring is close to edge, each subsequent ring further in
      const inset = ringGap * (i + 1) + ringThickness * i;
      const ringSize = hexSize - inset;
      if (ringSize < hexSize * 0.2) break; // don't draw if too small

      ctx.strokeStyle = order.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = ringThickness;

      // Draw hex-shaped ring (pointy-top)
      ctx.beginPath();
      for (let v = 0; v < 6; v++) {
        const angle = Math.PI / 180 * (60 * v - 30);
        const vx = x + ringSize * Math.cos(angle);
        const vy = y + ringSize * Math.sin(angle);
        if (v === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Draw small order-type labels at high zoom
    if (cp >= 45 && orders.length > 0) {
      ctx.globalAlpha = 0.7;
      const labelSize = Math.max(7, cp * 0.1);
      ctx.font = `bold ${labelSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // Stack labels below the hex center
      const labelY = y + hexSize * 0.55;
      const totalWidth = orders.reduce((sum, o) => {
        ctx.font = `bold ${labelSize}px Arial`;
        return sum + ctx.measureText(o.label).width + 4;
      }, -4); // subtract trailing gap

      let lx = x - totalWidth / 2;
      for (const order of orders) {
        const tw = ctx.measureText(order.label).width;
        // Background pill
        ctx.fillStyle = order.color + "33";
        ctx.beginPath();
        ctx.roundRect(lx - 2, labelY - 1, tw + 4, labelSize + 3, 2);
        ctx.fill();
        ctx.strokeStyle = order.color + "88";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        // Text
        ctx.fillStyle = order.color;
        ctx.fillText(order.label, lx + tw / 2 + 2, labelY);
        lx += tw + 6;
      }
    }
  }

  ctx.restore();
}

// ── Data builder (call from SimGame useMemo) ──────────────────

/**
 * Build the overlay data structure from unitOrders and units.
 * Called in SimGame's useMemo to avoid recomputing on every render.
 *
 * @param {Object} unitOrders - { actorId: { unitId: { movementOrder, actionOrder } } }
 * @param {Array} units - full unit array from game state
 * @returns {{ ghosts: Array, rings: Object }} or null if nothing to draw
 */
export function buildOrderOverlayData(unitOrders, units) {
  if (!unitOrders || !units) return null;

  const ghosts = [];
  const rings = {};

  // Build a unit lookup for fast access
  const unitMap = {};
  for (const u of units) {
    unitMap[u.id] = u;
  }

  for (const [actorId, actorOrders] of Object.entries(unitOrders)) {
    if (!actorOrders) continue;

    for (const [unitId, orders] of Object.entries(actorOrders)) {
      if (!orders) continue;
      const unit = unitMap[unitId];
      if (!unit || !unit.position) continue;

      const posMatch = unit.position.match(/^(\d+),(\d+)$/);
      if (!posMatch) continue;
      const unitCol = parseInt(posMatch[1]);
      const unitRow = parseInt(posMatch[2]);

      // Movement ghost: MOVE or WITHDRAW with a target hex
      const mo = orders.movementOrder;
      if (mo && (mo.id === "MOVE" || mo.id === "WITHDRAW") && mo.target) {
        const tgtMatch = mo.target.match(/^(\d+),(\d+)$/);
        if (tgtMatch) {
          const destCol = parseInt(tgtMatch[1]);
          const destRow = parseInt(tgtMatch[2]);

          // Build route: [current, ...waypoints, destination]
          const route = [{ col: unitCol, row: unitRow }];
          if (mo.waypoints && mo.waypoints.length > 0) {
            for (const wp of mo.waypoints) {
              const wpMatch = wp.match(/^(\d+),(\d+)$/);
              if (wpMatch) route.push({ col: parseInt(wpMatch[1]), row: parseInt(wpMatch[2]) });
            }
          }
          route.push({ col: destCol, row: destRow });

          ghosts.push({
            destCol, destRow, route,
            type: unit.type,
            actor: actorId,
            name: unit.name,
            strength: unit.strength || 100,
            echelon: unit.echelon,
            isWithdraw: mo.id === "WITHDRAW",
          });
        }
      }

      // Action order target rings
      const ao = orders.actionOrder;
      if (ao && ao.target) {
        const colorKey = ringColorKey(ao);
        const color = ORDER_RING_COLORS[colorKey];
        if (color) {
          const targetKey = ao.target; // already "col,row" format
          if (!rings[targetKey]) rings[targetKey] = [];
          // Avoid duplicate order types on same hex from same logic
          // (shouldn't happen normally, but guard against it)
          if (!rings[targetKey].some(r => r.key === colorKey && r.unitId === unitId)) {
            rings[targetKey].push({
              key: colorKey,
              color,
              label: ORDER_RING_LABELS[colorKey] || ao.id,
              unitId,
            });
          }
        }
      }
    }
  }

  if (ghosts.length === 0 && Object.keys(rings).length === 0) return null;

  return { ghosts, rings };
}
