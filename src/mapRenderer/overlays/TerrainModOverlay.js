// ════════════════════════════════════════════════════════════════
// TerrainModOverlay — Canvas 2D overlay for terrain modifications
// Renders smoke, fortifications, obstacles, bridge status, and
// terrain damage as visual indicators on top of the base map.
// ════════════════════════════════════════════════════════════════

import { gridToScreen, getVisibleRange } from "../ViewportState.js";
import { cellPixelsToHexSize } from "../HexMath.js";

/**
 * Draw all active terrain modifications as overlays on the map.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} terrainMods - gameState.terrainMods (sparse, keyed by "col,row")
 * @param {Object} viewport
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {number} cols - grid columns
 * @param {number} rows - grid rows
 */
export function drawTerrainMods(ctx, terrainMods, viewport, w, h, cols, rows) {
  if (!terrainMods || Object.keys(terrainMods).length === 0) return;
  const cp = viewport.cellPixels;
  if (cp < 4) return; // too zoomed out

  const visRange = getVisibleRange(viewport, w, h, cols, rows);

  ctx.save();
  for (const [posKey, mods] of Object.entries(terrainMods)) {
    const match = posKey.match(/^(\d+),(\d+)$/);
    if (!match) continue;
    const col = parseInt(match[1]);
    const row = parseInt(match[2]);
    if (col < visRange.colMin || col > visRange.colMax) continue;
    if (row < visRange.rowMin || row > visRange.rowMax) continue;

    const { x, y } = gridToScreen(col, row, viewport, w, h);
    const hexSize = cellPixelsToHexSize(cp);

    // Draw in back-to-front order: terrain damage, fortification, obstacle, smoke, bridge icons
    if (mods.terrain_damaged) drawTerrainDamage(ctx, x, y, hexSize, cp, mods.terrain_damaged);
    if (mods.fortification) drawFortification(ctx, x, y, hexSize, cp, mods.fortification);
    if (mods.obstacle) drawObstacle(ctx, x, y, hexSize, cp, mods.obstacle);
    if (mods.smoke) drawSmoke(ctx, x, y, hexSize, cp, mods.smoke);
    if (mods.bridge_built) drawBridgeBuilt(ctx, x, y, hexSize, cp);
    if (mods.bridge_destroyed) drawBridgeDestroyed(ctx, x, y, hexSize, cp);
  }
  ctx.restore();
}

// ── Smoke: semi-transparent white/gray fill ──────────────────

function drawSmoke(ctx, x, y, hexSize, cp, smoke) {
  ctx.save();
  // Pulsing opacity based on remaining turns
  const alpha = smoke.turnsRemaining > 1 ? 0.35 : 0.2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#C8C8C8";
  drawHexFill(ctx, x, y, hexSize * 0.85);
  ctx.globalAlpha = 1;

  // Label at higher zoom
  if (cp >= 20) {
    ctx.fillStyle = "rgba(60,60,60,0.8)";
    ctx.font = `bold ${Math.max(8, cp * 0.14)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SMOKE", x, y);
  }
  ctx.restore();
}

// ── Fortification: brown dashed hex outline ──────────────────

function drawFortification(ctx, x, y, hexSize, cp, fort) {
  ctx.save();
  const thickness = Math.max(1, (fort.level / 100) * 3);
  ctx.strokeStyle = "rgba(139,90,43,0.7)";
  ctx.lineWidth = thickness;
  ctx.setLineDash([4, 3]);
  drawHexOutline(ctx, x, y, hexSize * 0.8);
  ctx.setLineDash([]);

  // Label at higher zoom
  if (cp >= 25) {
    ctx.fillStyle = "rgba(139,90,43,0.85)";
    ctx.font = `bold ${Math.max(7, cp * 0.12)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`FORT ${fort.level}%`, x, y - hexSize * 0.35);
  }
  ctx.restore();
}

// ── Obstacle: red/orange X pattern ───────────────────────────

function drawObstacle(ctx, x, y, hexSize, cp, obstacle) {
  ctx.save();
  const s = hexSize * 0.35;
  ctx.strokeStyle = "rgba(220,60,20,0.7)";
  ctx.lineWidth = Math.max(1.5, cp * 0.04);

  // X pattern
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();

  // Label at higher zoom
  if (cp >= 25) {
    const label = (obstacle.subtype || "obstacle").toUpperCase();
    ctx.fillStyle = "rgba(220,60,20,0.85)";
    ctx.font = `bold ${Math.max(7, cp * 0.11)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, x, y + hexSize * 0.3);
  }
  ctx.restore();
}

// ── Bridge built: green bridge icon ──────────────────────────

function drawBridgeBuilt(ctx, x, y, hexSize, cp) {
  if (cp < 12) return;
  ctx.save();
  const s = hexSize * 0.25;

  // Two horizontal lines (bridge deck)
  ctx.strokeStyle = "rgba(34,139,34,0.9)";
  ctx.lineWidth = Math.max(1.5, cp * 0.04);
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.3);
  ctx.lineTo(x + s, y - s * 0.3);
  ctx.moveTo(x - s, y + s * 0.3);
  ctx.lineTo(x + s, y + s * 0.3);
  ctx.stroke();

  // Vertical supports
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y - s * 0.3);
  ctx.lineTo(x - s * 0.5, y + s * 0.3);
  ctx.moveTo(x + s * 0.5, y - s * 0.3);
  ctx.lineTo(x + s * 0.5, y + s * 0.3);
  ctx.stroke();

  // "+" label
  if (cp >= 25) {
    ctx.fillStyle = "rgba(34,139,34,0.9)";
    ctx.font = `bold ${Math.max(8, cp * 0.13)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("BRIDGE+", x, y + hexSize * 0.3);
  }
  ctx.restore();
}

// ── Bridge destroyed: red broken bridge icon ─────────────────

function drawBridgeDestroyed(ctx, x, y, hexSize, cp) {
  if (cp < 12) return;
  ctx.save();
  const s = hexSize * 0.25;

  // Broken bridge lines (gap in the middle)
  ctx.strokeStyle = "rgba(200,30,30,0.9)";
  ctx.lineWidth = Math.max(1.5, cp * 0.04);
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x - s * 0.2, y);
  ctx.moveTo(x + s * 0.2, y);
  ctx.lineTo(x + s, y);
  ctx.stroke();

  // Red X over the gap
  const g = s * 0.2;
  ctx.beginPath();
  ctx.moveTo(x - g, y - g);
  ctx.lineTo(x + g, y + g);
  ctx.moveTo(x + g, y - g);
  ctx.lineTo(x - g, y + g);
  ctx.stroke();

  if (cp >= 25) {
    ctx.fillStyle = "rgba(200,30,30,0.9)";
    ctx.font = `bold ${Math.max(8, cp * 0.13)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("BRIDGE\u2717", x, y + hexSize * 0.3);
  }
  ctx.restore();
}

// ── Terrain damage: dark scorch marks ────────────────────────

function drawTerrainDamage(ctx, x, y, hexSize, cp, damage) {
  ctx.save();
  const alpha = Math.min(0.3, (damage.level / 100) * 0.35);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#1a1a1a";
  drawHexFill(ctx, x, y, hexSize * 0.85);
  ctx.globalAlpha = 1;

  // Scatter some "crater" dots at higher zoom
  if (cp >= 15 && damage.level > 20) {
    ctx.fillStyle = "rgba(40,40,40,0.4)";
    const count = Math.min(5, Math.floor(damage.level / 20));
    const rng = simpleHash(x * 1000 + y); // deterministic pseudo-random from position
    for (let i = 0; i < count; i++) {
      const angle = ((rng + i * 137.5) % 360) * (Math.PI / 180);
      const dist = hexSize * 0.3 * (((rng + i * 73) % 100) / 100);
      const r = Math.max(1, cp * 0.03);
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ── Hex geometry helpers ─────────────────────────────────────

function drawHexFill(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // flat-top hex
    const px = cx + size * Math.cos(angle);
    const py = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHexOutline(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + size * Math.cos(angle);
    const py = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

// Deterministic hash for pseudo-random crater placement (no Math.random in render)
function simpleHash(n) {
  return Math.abs(((n * 2654435761) >>> 0) % 360);
}
