// ═══════════════════════════════════════════════════════════════
// AIR OVERLAY — Flight paths, AD coverage zones, CAS sectors
// Canvas 2D overlays for air operations visualization.
// ═══════════════════════════════════════════════════════════════

import { hexToScreen, cellPixelsToHexSize, traceHexPath, hexRange } from "../HexMath.js";
import { parseUnitPosition } from "./UnitOverlay.js";

// AD type → engagement range in hexes and display color
const AD_DISPLAY = {
  gun_ad:          { range: 1, color: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.35)" },   // red
  ir_missile_ad:   { range: 2, color: "rgba(245, 158, 11, 0.10)", border: "rgba(245, 158, 11, 0.30)" }, // amber
  radar_missile_ad:{ range: 4, color: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.25)" }, // purple
};

/**
 * Draw AD coverage zones — semi-transparent hex fills around AD units.
 * Each AD type gets a different color and range.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} adUnits - units with AD capabilities [{position, specialCapabilities, actor}]
 * @param {Object} actorColorMap - { actorId: "#hex" }
 * @param {Object} viewport - MapView viewport
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {number} cols - grid columns
 * @param {number} rows - grid rows
 */
export function drawADCoverage(ctx, adUnits, actorColorMap, viewport, w, h, cols, rows) {
  if (!adUnits || adUnits.length === 0) return;

  const size = cellPixelsToHexSize(viewport.cellPixels);
  // Skip drawing if zoomed way out — hexes too small to see zones
  if (size < 4) return;

  ctx.save();

  for (const unit of adUnits) {
    if (!unit.position) continue;
    const pos = parseUnitPosition(unit.position);
    if (!pos) continue;

    const caps = unit.specialCapabilities || [];

    // Draw coverage for each AD type the unit has
    for (const [adType, display] of Object.entries(AD_DISPLAY)) {
      if (!caps.includes(adType)) continue;

      // Get all hexes within range
      const coveredHexes = hexRange(pos.c, pos.r, display.range);

      // Draw filled hexes for coverage zone
      ctx.fillStyle = display.color;
      ctx.strokeStyle = display.border;
      ctx.lineWidth = 1;

      for (const { col: hc, row: hr } of coveredHexes) {
        // Skip hexes outside grid bounds
        if (hc < 0 || hc >= cols || hr < 0 || hr >= rows) continue;

        const screen = hexToScreen(hc, hr, viewport, w, h);
        ctx.beginPath();
        traceHexPath(ctx, screen.x, screen.y, size);
        ctx.fill();
      }

      // Draw border ring only (outermost ring of hexes)
      for (const { col: hc, row: hr } of coveredHexes) {
        if (hc < 0 || hc >= cols || hr < 0 || hr >= rows) continue;
        const screen = hexToScreen(hc, hr, viewport, w, h);
        ctx.beginPath();
        traceHexPath(ctx, screen.x, screen.y, size);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

/**
 * Draw flight paths for air units with assigned orders.
 * Shows dashed line from baseHex → target → baseHex.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} flightPaths - [{ from: {c,r}, to: {c,r}, color, unitName, altitude }]
 * @param {Object} viewport
 * @param {number} w
 * @param {number} h
 */
export function drawFlightPaths(ctx, flightPaths, viewport, w, h) {
  if (!flightPaths || flightPaths.length === 0) return;

  ctx.save();

  for (const path of flightPaths) {
    const fromScreen = hexToScreen(path.from.c, path.from.r, viewport, w, h);
    const toScreen = hexToScreen(path.to.c, path.to.r, viewport, w, h);

    const color = path.color || "rgba(6, 182, 212, 0.6)"; // cyan default

    // Outbound leg (solid → dashed)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(fromScreen.x, fromScreen.y);
    ctx.lineTo(toScreen.x, toScreen.y);
    ctx.stroke();

    // Arrowhead at target
    const angle = Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
    const arrowLen = 8;
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toScreen.x, toScreen.y);
    ctx.lineTo(
      toScreen.x - arrowLen * Math.cos(angle - 0.4),
      toScreen.y - arrowLen * Math.sin(angle - 0.4)
    );
    ctx.lineTo(
      toScreen.x - arrowLen * Math.cos(angle + 0.4),
      toScreen.y - arrowLen * Math.sin(angle + 0.4)
    );
    ctx.closePath();
    ctx.fill();

    // Base marker (small circle at origin)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(fromScreen.x, fromScreen.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Altitude label at midpoint (if zoomed in enough)
    if (path.altitude && viewport.cellPixels >= 20) {
      const mx = (fromScreen.x + toScreen.x) / 2;
      const my = (fromScreen.y + toScreen.y) / 2;
      ctx.font = "9px monospace";
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(path.altitude, mx, my - 6);
    }
  }

  ctx.restore();
}

/**
 * Draw CAS sector highlight — hexes around a CAS target.
 * Shows 2-hex radius area where CAS will be applied.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} casSectors - [{ center: {c,r}, color }]
 * @param {Object} viewport
 * @param {number} w
 * @param {number} h
 * @param {number} cols
 * @param {number} rows
 */
export function drawCASSectors(ctx, casSectors, viewport, w, h, cols, rows) {
  if (!casSectors || casSectors.length === 0) return;

  const size = cellPixelsToHexSize(viewport.cellPixels);
  if (size < 4) return;

  ctx.save();

  for (const sector of casSectors) {
    const sectorHexes = hexRange(sector.center.c, sector.center.r, 2);
    const color = sector.color || "rgba(34, 197, 94, 0.12)";       // green
    const borderColor = sector.border || "rgba(34, 197, 94, 0.35)";

    ctx.fillStyle = color;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);

    for (const { col: hc, row: hr } of sectorHexes) {
      if (hc < 0 || hc >= cols || hr < 0 || hr >= rows) continue;
      const screen = hexToScreen(hc, hr, viewport, w, h);
      ctx.beginPath();
      traceHexPath(ctx, screen.x, screen.y, size);
      ctx.fill();
      ctx.stroke();
    }

    ctx.setLineDash([]);

    // "CAS" label at center
    if (viewport.cellPixels >= 16) {
      const centerScreen = hexToScreen(sector.center.c, sector.center.r, viewport, w, h);
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = borderColor;
      ctx.textAlign = "center";
      ctx.fillText("CAS", centerScreen.x, centerScreen.y - size * 0.6);
    }
  }

  ctx.restore();
}
