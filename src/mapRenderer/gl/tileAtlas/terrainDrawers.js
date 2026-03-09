// ════════════════════════════════════════════════════════════════
// Terrain tile drawing functions — Advance Wars inspired pixel art
// Each function draws the terrain pattern onto a 64px hex tile.
// ctx is already clipped to hex shape before these are called.
// ════════════════════════════════════════════════════════════════

import { TILE_PX, CX, CY, fillHex } from "./hexUtils.js";

// ── Helper: draw a simple sine-wave line across the tile ──
function waveLine(ctx, y, amplitude, period, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let x = 0; x <= TILE_PX; x += 2) {
    const wy = y + Math.sin(x / period * Math.PI * 2) * amplitude;
    if (x === 0) ctx.moveTo(x, wy);
    else ctx.lineTo(x, wy);
  }
  ctx.stroke();
}

// ── Helper: draw a round-canopy deciduous tree ──
function drawTree(ctx, x, y, canopyR, trunkH, canopyColor, trunkColor) {
  // Trunk
  ctx.fillStyle = trunkColor;
  ctx.fillRect(x - 1, y, 2, trunkH);
  // Canopy
  ctx.fillStyle = canopyColor;
  ctx.beginPath();
  ctx.arc(x, y, canopyR, 0, Math.PI * 2);
  ctx.fill();
  // Canopy highlight (top-left light)
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.arc(x - canopyR * 0.3, y - canopyR * 0.3, canopyR * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ── Helper: draw a conifer/spruce triangle tree ──
function drawConifer(ctx, x, y, w, h, color, trunkColor) {
  // Trunk
  ctx.fillStyle = trunkColor;
  ctx.fillRect(x - 1, y + h * 0.7, 2, h * 0.3);
  // Triangle canopy
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - h * 0.3);
  ctx.lineTo(x + w / 2, y + h * 0.7);
  ctx.lineTo(x - w / 2, y + h * 0.7);
  ctx.closePath();
  ctx.fill();
}

// ── Helper: draw a mountain peak triangle ──
function drawPeak(ctx, x, y, w, h, bodyColor, shadowColor, snowColor) {
  // Shadow side (right half, darker)
  ctx.fillStyle = shadowColor;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  // Light side (left half)
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - w / 2, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  // Snow cap
  if (snowColor) {
    ctx.fillStyle = snowColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.15, y + h * 0.25);
    ctx.lineTo(x - w * 0.15, y + h * 0.25);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Helper: draw a small building rectangle ──
function drawBuilding(ctx, x, y, w, h, wallColor, roofColor) {
  ctx.fillStyle = wallColor;
  ctx.fillRect(x, y, w, h);
  // Roof line (darker top edge)
  ctx.fillStyle = roofColor;
  ctx.fillRect(x, y, w, 2);
}

// ═══════════════════════════════════════════════════
// TERRAIN DRAWING FUNCTIONS
// ═══════════════════════════════════════════════════

// ── WATER FAMILY ──

function deep_water(ctx) {
  fillHex(ctx, "#1A4570");
  waveLine(ctx, 16, 2.0, 10, "#2A6090", 1.5);
  waveLine(ctx, 26, 1.5, 12, "#2A6090", 1.0);
  waveLine(ctx, 36, 2.0, 8, "#2A6090", 1.5);
  waveLine(ctx, 46, 1.5, 11, "#2A6090", 1.0);
}

function coastal_water(ctx) {
  fillHex(ctx, "#307090");
  waveLine(ctx, 20, 1.5, 12, "#4090B0", 1.0);
  waveLine(ctx, 32, 1.5, 10, "#4090B0", 1.0);
  waveLine(ctx, 44, 1.0, 14, "#4090B0", 1.0);
}

function lake(ctx) {
  fillHex(ctx, "#3580A8");
  // Concentric ripples from center
  ctx.strokeStyle = "#4598C0";
  ctx.lineWidth = 0.8;
  for (let r = 6; r <= 18; r += 6) {
    ctx.beginPath();
    ctx.ellipse(CX, CY, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function river_terrain(ctx) {
  fillHex(ctx, "#3478A0");
  // Flow chevrons indicating current direction (downward)
  ctx.strokeStyle = "#50A0C8";
  ctx.lineWidth = 1.2;
  const chevronX = [24, 36, 30];
  const chevronY = [18, 28, 42];
  for (let i = 0; i < 3; i++) {
    const cx = chevronX[i], cy = chevronY[i];
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 3);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 5, cy - 3);
    ctx.stroke();
  }
}

function canal(ctx) {
  fillHex(ctx, "#5A9AB8");
  // Stone banks — tan strips on sides
  ctx.fillStyle = "#B0A080";
  ctx.fillRect(8, 0, 8, TILE_PX);
  ctx.fillRect(48, 0, 8, TILE_PX);
  // Water center
  ctx.fillStyle = "#4888B0";
  ctx.fillRect(16, 0, 32, TILE_PX);
  // Subtle wave in center
  waveLine(ctx, 32, 1, 10, "#5AA0C8", 0.8);
}

function dock(ctx) {
  // Water in lower portion
  fillHex(ctx, "#3870A0");
  waveLine(ctx, 40, 1.0, 10, "#4888B8", 0.8);
  waveLine(ctx, 50, 1.0, 12, "#4888B8", 0.8);
  // Wooden pier structure in upper portion
  ctx.fillStyle = "#8B6B3A";
  ctx.fillRect(14, 10, 36, 24);
  // Pier planks
  ctx.strokeStyle = "#7A5A30";
  ctx.lineWidth = 0.8;
  for (let y = 14; y < 32; y += 4) {
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(50, y);
    ctx.stroke();
  }
  // Bollards
  ctx.fillStyle = "#404040";
  ctx.fillRect(18, 30, 3, 4);
  ctx.fillRect(42, 30, 3, 4);
}

// ── WETLAND ──

function wetland(ctx) {
  fillHex(ctx, "#4A7A5A");
  // Blue puddle spots
  ctx.fillStyle = "#4090A0";
  ctx.beginPath(); ctx.ellipse(20, 24, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(42, 38, 4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
  // Reed tufts (thin vertical lines with oval tops)
  const reedsX = [16, 28, 36, 46, 24];
  const reedsY = [16, 34, 18, 28, 46];
  ctx.strokeStyle = "#2A5A30";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < reedsX.length; i++) {
    const rx = reedsX[i], ry = reedsY[i];
    ctx.beginPath();
    ctx.moveTo(rx, ry + 8);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.fillStyle = "#3A6A40";
    ctx.beginPath();
    ctx.ellipse(rx, ry - 1, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── OPEN TERRAIN ──

function open_ground(ctx) {
  fillHex(ctx, "#A0A858");
  // Sparse dirt dots
  ctx.fillStyle = "#908848";
  const dots = [[22, 20], [40, 30], [28, 44], [36, 18]];
  for (const [dx, dy] of dots) {
    ctx.fillRect(dx, dy, 2, 2);
  }
}

function bare_ground(ctx) {
  fillHex(ctx, "#B8A878");
  // Cracked earth pattern
  ctx.strokeStyle = "#9A8A60";
  ctx.lineWidth = 0.8;
  // Irregular crack lines
  ctx.beginPath();
  ctx.moveTo(15, 12); ctx.lineTo(28, 24); ctx.lineTo(20, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(38, 14); ctx.lineTo(34, 30); ctx.lineTo(48, 44);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(28, 24); ctx.lineTo(46, 28);
  ctx.stroke();
}

function light_veg(ctx) {
  fillHex(ctx, "#88A048");
  // Small scattered shrub dots
  ctx.fillStyle = "#6A8838";
  const dots = [[18, 16], [36, 14], [44, 26], [14, 32], [30, 30], [40, 42], [22, 46]];
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function grassland(ctx) {
  fillHex(ctx, "#88B040");
  // Grass tuft V-marks
  ctx.strokeStyle = "#68903A";
  ctx.lineWidth = 1.0;
  const tufts = [[18, 16], [34, 14], [46, 24], [14, 28], [28, 28],
                 [40, 36], [20, 40], [36, 46], [26, 18], [42, 44]];
  for (const [tx, ty] of tufts) {
    ctx.beginPath();
    ctx.moveTo(tx - 2, ty - 3);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + 2, ty - 3);
    ctx.stroke();
  }
}

function highland(ctx) {
  fillHex(ctx, "#90985C");
  // Rolling contour lines
  ctx.strokeStyle = "#808850";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(8, 24);
  ctx.quadraticCurveTo(32, 18, 56, 24);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(8, 40);
  ctx.quadraticCurveTo(32, 34, 56, 40);
  ctx.stroke();
  // Heather dots
  ctx.fillStyle = "#7A8048";
  const dots = [[20, 30], [40, 22], [30, 46], [16, 42]];
  for (const [dx, dy] of dots) {
    ctx.fillRect(dx, dy, 2, 2);
  }
}

// ── AGRICULTURE ──

function farmland(ctx) {
  fillHex(ctx, "#A8B860");
  // Diagonal crop row lines
  ctx.strokeStyle = "#90A048";
  ctx.lineWidth = 1.0;
  for (let i = -TILE_PX; i < TILE_PX * 2; i += 6) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + TILE_PX * 0.5, TILE_PX);
    ctx.stroke();
  }
}

function allotment(ctx) {
  fillHex(ctx, "#88A048");
  // Small garden plot rectangles
  const plots = [
    [14, 14, 10, 8, "#70903A"], [28, 14, 10, 8, "#90A850"],
    [14, 28, 10, 8, "#80984A"], [28, 28, 10, 8, "#70903A"],
    [14, 42, 10, 8, "#90A850"], [28, 42, 10, 8, "#80984A"],
  ];
  for (const [px, py, pw, ph, color] of plots) {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, pw, ph);
    // Plot border
    ctx.strokeStyle = "#607830";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(px, py, pw, ph);
  }
}

// ── TEMPERATE FOREST ──

function forest(ctx) {
  fillHex(ctx, "#358028");
  drawTree(ctx, 22, 22, 7, 5, "#3D8530", "#5A4020");
  drawTree(ctx, 40, 28, 6, 5, "#45902A", "#5A4020");
  drawTree(ctx, 30, 40, 7, 5, "#3A7A28", "#5A4020");
}

function dense_forest(ctx) {
  fillHex(ctx, "#2A5A1A");
  // Packed overlapping canopies — back to front for depth
  drawTree(ctx, 18, 18, 8, 4, "#2D6620", "#4A3018");
  drawTree(ctx, 38, 16, 7, 4, "#286018", "#4A3018");
  drawTree(ctx, 48, 28, 7, 4, "#2D6620", "#4A3018");
  drawTree(ctx, 14, 34, 7, 4, "#286018", "#4A3018");
  drawTree(ctx, 30, 30, 8, 4, "#327024", "#4A3018");
  drawTree(ctx, 40, 42, 7, 4, "#2D6620", "#4A3018");
}

function mountain_forest(ctx) {
  fillHex(ctx, "#4A7038");
  // Slope line underneath
  ctx.strokeStyle = "#8A7A50";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, 44);
  ctx.quadraticCurveTo(32, 36, 56, 44);
  ctx.stroke();
  // Trees on top
  drawTree(ctx, 22, 20, 6, 4, "#5A8040", "#5A4020");
  drawTree(ctx, 38, 18, 6, 4, "#508838", "#5A4020");
  drawTree(ctx, 30, 32, 6, 4, "#4A7838", "#5A4020");
}

function forested_hills(ctx) {
  fillHex(ctx, "#407030");
  // Subtle rolling contour
  ctx.strokeStyle = "#356028";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(8, 36);
  ctx.quadraticCurveTo(32, 28, 56, 36);
  ctx.stroke();
  // Trees
  drawTree(ctx, 20, 18, 6, 4, "#4D7838", "#4A3018");
  drawTree(ctx, 38, 22, 7, 4, "#458030", "#4A3018");
  drawTree(ctx, 28, 38, 6, 4, "#407030", "#4A3018");
}

function urban_trees(ctx) {
  fillHex(ctx, "#509030");
  // Walking path (tan)
  ctx.strokeStyle = "#C0A870";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(12, 20);
  ctx.quadraticCurveTo(32, 34, 52, 20);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(20, 48);
  ctx.quadraticCurveTo(32, 34, 44, 48);
  ctx.stroke();
  // Park trees
  drawTree(ctx, 20, 18, 6, 3, "#60A838", "#5A4020");
  drawTree(ctx, 42, 24, 5, 3, "#58A030", "#5A4020");
  drawTree(ctx, 28, 42, 6, 3, "#60A838", "#5A4020");
}

// ── JUNGLE/TROPICAL ──

function jungle(ctx) {
  fillHex(ctx, "#185A18");
  // Dense broadleaf / palm frond shapes (not round like temperate)
  const fronds = [[18, 20], [36, 16], [28, 32], [44, 34], [20, 44]];
  for (const [fx, fy] of fronds) {
    // Star-shaped broadleaf
    ctx.fillStyle = "#1B6B20";
    ctx.beginPath();
    for (let a = 0; a < 5; a++) {
      const angle = (a / 5) * Math.PI * 2 - Math.PI / 2;
      const ox = fx + Math.cos(angle) * 7;
      const oy = fy + Math.sin(angle) * 5;
      if (a === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox, oy);
      const midAngle = angle + Math.PI / 5;
      ctx.lineTo(fx + Math.cos(midAngle) * 3, fy + Math.sin(midAngle) * 3);
    }
    ctx.closePath();
    ctx.fill();
  }
  // Hanging vine lines
  ctx.strokeStyle = "#10500E";
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(26, 10); ctx.lineTo(24, 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(40, 12); ctx.lineTo(42, 24); ctx.stroke();
}

function jungle_hills(ctx) {
  fillHex(ctx, "#226A20");
  // Slope contour
  ctx.strokeStyle = "#8A7A50";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 44);
  ctx.quadraticCurveTo(32, 36, 56, 44);
  ctx.stroke();
  // Simplified jungle fronds on top
  const fronds = [[22, 20], [38, 18], [30, 34]];
  for (const [fx, fy] of fronds) {
    ctx.fillStyle = "#2A7A30";
    ctx.beginPath();
    ctx.ellipse(fx, fy, 8, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1A6020";
    ctx.beginPath();
    ctx.ellipse(fx + 2, fy - 1, 5, 3, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function jungle_mountains(ctx) {
  fillHex(ctx, "#145A14");
  // Rocky peak visible through canopy
  drawPeak(ctx, 32, 14, 28, 22, "#6A6A58", "#585848", null);
  // Sparse jungle canopy in front
  ctx.fillStyle = "#1A5A1A";
  ctx.beginPath(); ctx.ellipse(20, 36, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#186018";
  ctx.beginPath(); ctx.ellipse(42, 38, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1A5A1A";
  ctx.beginPath(); ctx.ellipse(32, 46, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
}

function mangrove(ctx) {
  // Bottom third: water
  fillHex(ctx, "#3A7A5A");
  ctx.fillStyle = "#3880A0";
  ctx.fillRect(0, 40, TILE_PX, 24);
  // Tangled root lines going into water
  ctx.strokeStyle = "#5A4A30";
  ctx.lineWidth = 1.2;
  const rootX = [18, 28, 38, 46];
  for (const rx of rootX) {
    ctx.beginPath();
    ctx.moveTo(rx, 30);
    ctx.bezierCurveTo(rx - 3, 38, rx + 2, 44, rx - 1, 52);
    ctx.stroke();
  }
  // Canopy on top
  ctx.fillStyle = "#2A6A3A";
  ctx.beginPath(); ctx.ellipse(22, 24, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#307040";
  ctx.beginPath(); ctx.ellipse(40, 22, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
}

// ── BOREAL/COLD ──

function boreal(ctx) {
  fillHex(ctx, "#305A3A");
  drawConifer(ctx, 20, 22, 10, 16, "#3A7A50", "#5A4020");
  drawConifer(ctx, 36, 18, 10, 16, "#3A7A50", "#5A4020");
  drawConifer(ctx, 28, 36, 10, 16, "#327248", "#5A4020");
  drawConifer(ctx, 44, 34, 8, 14, "#3A7A50", "#5A4020");
}

function boreal_hills(ctx) {
  fillHex(ctx, "#285A38");
  // Hill contour
  ctx.strokeStyle = "#1E4A2A";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 40);
  ctx.quadraticCurveTo(32, 32, 56, 40);
  ctx.stroke();
  drawConifer(ctx, 22, 18, 9, 14, "#2A6A40", "#4A3018");
  drawConifer(ctx, 38, 20, 9, 14, "#2A6A40", "#4A3018");
  drawConifer(ctx, 30, 36, 8, 12, "#2A6A40", "#4A3018");
}

function boreal_mountains(ctx) {
  fillHex(ctx, "#1E4A2A");
  // Rocky slope
  drawPeak(ctx, 32, 10, 30, 26, "#6A6A58", "#585848", "#D8D8D0");
  // Sparse conifers in front
  drawConifer(ctx, 18, 36, 8, 12, "#1A5A30", "#4A3018");
  drawConifer(ctx, 42, 38, 7, 10, "#1A5A30", "#4A3018");
}

function tundra(ctx) {
  fillHex(ctx, "#B0A880");
  // Sparse lichen patches (small irregular blobs)
  ctx.fillStyle = "#989068";
  const patches = [[20, 20, 4, 3], [38, 16, 3, 3], [14, 36, 4, 2],
                   [44, 32, 3, 3], [28, 44, 4, 2], [32, 26, 3, 2]];
  for (const [px, py, pw, ph] of patches) {
    ctx.beginPath();
    ctx.ellipse(px, py, pw, ph, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function ice(ctx) {
  fillHex(ctx, "#C8D8E8");
  // Ice crack lines
  ctx.strokeStyle = "#90B0D0";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(18, 10); ctx.lineTo(28, 26); ctx.lineTo(22, 42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(40, 14); ctx.lineTo(36, 28); ctx.lineTo(48, 40);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(28, 26); ctx.lineTo(36, 28);
  ctx.stroke();
  // Subtle glint highlight
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(30, 18, 3, 2);
  ctx.fillRect(20, 34, 2, 2);
}

// ── ARID ──

function desert(ctx) {
  fillHex(ctx, "#D0B880");
  // Gentle dune shadow curves
  ctx.strokeStyle = "#BCA868";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(10, 22);
  ctx.quadraticCurveTo(30, 16, 50, 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(14, 38);
  ctx.quadraticCurveTo(34, 32, 54, 38);
  ctx.stroke();
  // Tiny shadow dots
  ctx.fillStyle = "#BCA060";
  ctx.fillRect(24, 28, 2, 1);
  ctx.fillRect(38, 44, 2, 1);
}

function savanna(ctx) {
  fillHex(ctx, "#B8A848");
  // Dry grass tufts
  ctx.strokeStyle = "#A09040";
  ctx.lineWidth = 0.8;
  const tufts = [[14, 22], [42, 18], [18, 44], [46, 40]];
  for (const [tx, ty] of tufts) {
    ctx.beginPath();
    ctx.moveTo(tx - 2, ty);
    ctx.lineTo(tx, ty - 3);
    ctx.lineTo(tx + 2, ty);
    ctx.stroke();
  }
  // Flat-topped acacia tree (umbrella shape)
  ctx.fillStyle = "#5A4020";
  ctx.fillRect(31, 28, 2, 10); // trunk
  ctx.fillStyle = "#7A9838";
  ctx.beginPath();
  ctx.ellipse(32, 26, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function savanna_hills(ctx) {
  fillHex(ctx, "#A09040");
  // Contour
  ctx.strokeStyle = "#908038";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 38);
  ctx.quadraticCurveTo(32, 30, 56, 38);
  ctx.stroke();
  // Acacia
  ctx.fillStyle = "#5A4020";
  ctx.fillRect(31, 24, 2, 8);
  ctx.fillStyle = "#708838";
  ctx.beginPath();
  ctx.ellipse(32, 22, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── MOUNTAIN ──

function mountain(ctx) {
  fillHex(ctx, "#70705C");
  drawPeak(ctx, 24, 16, 24, 20, "#8A8A70", "#606050", null);
  drawPeak(ctx, 40, 22, 20, 18, "#7A7A64", "#585848", null);
  // Rock scatter
  ctx.fillStyle = "#606050";
  ctx.fillRect(16, 44, 3, 2);
  ctx.fillRect(44, 46, 3, 2);
}

function peak(ctx) {
  fillHex(ctx, "#908870");
  // Single large snow-capped summit
  drawPeak(ctx, 32, 10, 34, 30, "#9A9A80", "#707060", "#E8E4D8");
  // Additional snow patches
  ctx.fillStyle = "#D8D4C8";
  ctx.fillRect(28, 18, 8, 3);
}

// ── URBAN LIGHT ──

function light_urban(ctx) {
  fillHex(ctx, "#B8B090");
  // Green yard patches
  ctx.fillStyle = "#90A060";
  ctx.fillRect(24, 14, 8, 6);
  ctx.fillRect(12, 30, 6, 6);
  ctx.fillRect(38, 38, 8, 6);
  // Scattered buildings
  drawBuilding(ctx, 16, 16, 6, 5, "#A8987A", "#8A7A5A");
  drawBuilding(ctx, 36, 14, 7, 5, "#A8987A", "#8A7A5A");
  drawBuilding(ctx, 44, 28, 6, 6, "#B0A080", "#8A7A5A");
  drawBuilding(ctx, 22, 36, 7, 5, "#A8987A", "#8A7A5A");
  drawBuilding(ctx, 38, 44, 6, 5, "#B0A080", "#8A7A5A");
}

function dense_urban(ctx) {
  fillHex(ctx, "#787068");
  // Packed building rectangles covering most of hex
  const bldgs = [
    [10, 10, 10, 8], [22, 10, 8, 10], [32, 10, 10, 8],
    [44, 12, 8, 10], [10, 22, 8, 10], [20, 24, 10, 8],
    [32, 22, 8, 10], [42, 26, 10, 8], [12, 36, 10, 8],
    [24, 36, 8, 10], [34, 36, 10, 8], [46, 38, 6, 8],
    [16, 48, 8, 6], [28, 48, 10, 6], [40, 48, 8, 6],
  ];
  for (const [bx, by, bw, bh] of bldgs) {
    drawBuilding(ctx, bx, by, bw, bh, "#8A8070", "#706860");
  }
}

function suburban(ctx) {
  fillHex(ctx, "#C8C0A0");
  // Green yards between houses
  ctx.fillStyle = "#90A860";
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  // Semi-regular house grid
  const houses = [
    [14, 12, 8, 6], [28, 12, 8, 6], [42, 14, 7, 5],
    [10, 26, 7, 6], [24, 26, 8, 6], [38, 28, 8, 5],
    [16, 40, 8, 6], [32, 40, 7, 6], [44, 42, 7, 5],
  ];
  for (const [hx, hy, hw, hh] of houses) {
    ctx.fillStyle = "#C8B898";
    ctx.fillRect(hx, hy, hw, hh);
    ctx.fillStyle = "#A89878";
    ctx.fillRect(hx, hy, hw, 2); // roof
  }
}

// ── FINE-GRAINED BUILDINGS ──

function bldg_light(ctx) {
  fillHex(ctx, "#D0C098");
  drawBuilding(ctx, 18, 20, 8, 6, "#C0A878", "#A08858");
  drawBuilding(ctx, 36, 30, 7, 6, "#C0A878", "#A08858");
}

function bldg_residential(ctx) {
  fillHex(ctx, "#B8A880");
  const houses = [
    [14, 16, 7, 5], [26, 14, 7, 5], [38, 18, 7, 5],
    [18, 30, 7, 5], [32, 28, 7, 5], [24, 42, 7, 5],
  ];
  for (const [hx, hy, hw, hh] of houses) {
    drawBuilding(ctx, hx, hy, hw, hh, "#C4A880", "#A48868");
  }
}

function bldg_commercial(ctx) {
  fillHex(ctx, "#9898A8");
  // Medium flat-roofed buildings with slightly taller one
  drawBuilding(ctx, 14, 18, 10, 8, "#A0A0B0", "#8080A0");
  drawBuilding(ctx, 30, 14, 10, 12, "#9898B0", "#7878A0"); // taller
  drawBuilding(ctx, 24, 34, 12, 8, "#A0A0B0", "#8080A0");
}

function bldg_highrise(ctx) {
  fillHex(ctx, "#808898");
  // Short buildings
  drawBuilding(ctx, 14, 24, 8, 8, "#9090A0", "#707088");
  drawBuilding(ctx, 38, 28, 9, 7, "#9090A0", "#707088");
  // Prominent tall tower
  drawBuilding(ctx, 26, 10, 10, 22, "#8888A8", "#6868A0");
  // Window dots on tower
  ctx.fillStyle = "#A8A8C0";
  for (let wy = 14; wy < 30; wy += 4) {
    ctx.fillRect(29, wy, 2, 2);
    ctx.fillRect(33, wy, 2, 2);
  }
}

function bldg_institutional(ctx) {
  fillHex(ctx, "#A89888");
  // Large building with grounds
  ctx.fillStyle = "#80A060"; // grounds
  ctx.fillRect(10, 10, 44, 44);
  drawBuilding(ctx, 18, 18, 28, 16, "#B0A098", "#907868");
  // Courtyard
  ctx.fillStyle = "#C0B098";
  ctx.fillRect(24, 24, 16, 8);
}

function bldg_religious(ctx) {
  fillHex(ctx, "#C0B098");
  // Building body
  drawBuilding(ctx, 20, 24, 24, 14, "#C8B8A0", "#A89880");
  // Steeple/spire
  ctx.fillStyle = "#A89880";
  ctx.fillRect(30, 12, 4, 12);
  // Cross on top
  ctx.fillStyle = "#807060";
  ctx.fillRect(31, 8, 2, 6);
  ctx.fillRect(29, 11, 6, 2);
}

function bldg_station(ctx) {
  fillHex(ctx, "#B0A090");
  // Main building
  drawBuilding(ctx, 16, 18, 20, 12, "#B8A8A0", "#988878");
  // Platform canopy extending to side
  ctx.fillStyle = "#989088";
  ctx.fillRect(36, 20, 14, 8);
  // Platform supports
  ctx.fillStyle = "#787070";
  ctx.fillRect(38, 28, 2, 4);
  ctx.fillRect(46, 28, 2, 4);
}

// ── URBAN HEAVY ──

function urban_commercial(ctx) {
  fillHex(ctx, "#A89880");
  const bldgs = [
    [12, 12, 12, 10], [28, 10, 10, 14], [40, 14, 10, 10],
    [10, 28, 10, 10], [24, 30, 12, 8], [38, 28, 10, 12],
    [14, 42, 12, 8], [30, 42, 10, 8], [42, 44, 8, 8],
  ];
  for (const [bx, by, bw, bh] of bldgs) {
    drawBuilding(ctx, bx, by, bw, bh, "#B0A890", "#908870");
  }
}

function urban_industrial(ctx) {
  fillHex(ctx, "#888070");
  // Factory buildings with smokestacks
  drawBuilding(ctx, 12, 20, 16, 14, "#9A9080", "#787068");
  drawBuilding(ctx, 32, 18, 18, 16, "#909080", "#787068");
  // Smokestacks
  ctx.fillStyle = "#686058";
  ctx.fillRect(16, 10, 4, 10);
  ctx.fillRect(40, 8, 4, 10);
  // Smoke puff
  ctx.fillStyle = "rgba(150,150,150,0.4)";
  ctx.beginPath(); ctx.arc(18, 8, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(42, 6, 3, 0, Math.PI * 2); ctx.fill();
}

function urban_dense_core(ctx) {
  fillHex(ctx, "#605850");
  // Tall narrow skyscraper silhouettes
  drawBuilding(ctx, 12, 14, 8, 26, "#706860", "#504840");
  drawBuilding(ctx, 24, 8, 10, 32, "#686060", "#504840");
  drawBuilding(ctx, 38, 12, 8, 28, "#706860", "#504840");
  // Window highlights
  ctx.fillStyle = "#888078";
  for (let col = 0; col < 3; col++) {
    const bx = [14, 27, 40][col];
    for (let wy = [18, 12, 16][col]; wy < 40; wy += 5) {
      ctx.fillRect(bx, wy, 2, 2);
      ctx.fillRect(bx + 4, wy, 2, 2);
    }
  }
}

function bldg_industrial(ctx) {
  fillHex(ctx, "#9A9080");
  // Single factory with chimney
  drawBuilding(ctx, 16, 22, 28, 18, "#A0988A", "#807868");
  ctx.fillStyle = "#706858";
  ctx.fillRect(22, 10, 4, 12);
  // Smokestack puff
  ctx.fillStyle = "rgba(150,150,150,0.3)";
  ctx.beginPath(); ctx.arc(24, 8, 3, 0, Math.PI * 2); ctx.fill();
}

function bldg_fortified(ctx) {
  fillHex(ctx, "#606850");
  // Thick-walled compound
  ctx.fillStyle = "#585848";
  ctx.fillRect(14, 14, 36, 32);
  // Inner yard
  ctx.fillStyle = "#707060";
  ctx.fillRect(18, 18, 28, 24);
  // Wall thickness visible
  ctx.strokeStyle = "#484838";
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, 36, 32);
}

function bldg_ruins(ctx) {
  fillHex(ctx, "#908878");
  // Broken wall fragments
  ctx.fillStyle = "#787068";
  // Jagged broken walls
  ctx.beginPath();
  ctx.moveTo(16, 20); ctx.lineTo(16, 32); ctx.lineTo(20, 30);
  ctx.lineTo(18, 26); ctx.lineTo(22, 20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(32, 16); ctx.lineTo(44, 16); ctx.lineTo(42, 24);
  ctx.lineTo(38, 20); ctx.lineTo(34, 26); ctx.lineTo(30, 22);
  ctx.closePath();
  ctx.fill();
  // Rubble dots
  ctx.fillStyle = "#686058";
  const rubble = [[24, 36], [36, 34], [28, 44], [40, 42], [20, 42]];
  for (const [rx, ry] of rubble) {
    ctx.fillRect(rx, ry, 3, 2);
  }
}

// ── ROAD SURFACES (hex IS road) ──

function motorway(ctx) {
  fillHex(ctx, "#C0C0C0");
  // Lane markings
  ctx.strokeStyle = "#F0F0F0";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(32, 64); ctx.stroke();
  ctx.setLineDash([]);
  // Yellow edge lines
  ctx.strokeStyle = "#D0A820";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(18, 64); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(46, 64); ctx.stroke();
}

function arterial(ctx) {
  fillHex(ctx, "#B0B0B0");
  // Center dashed line
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(32, 0); ctx.lineTo(32, 64); ctx.stroke();
  ctx.setLineDash([]);
  // Curb edges
  ctx.strokeStyle = "#888888";
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(20, 64); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(44, 64); ctx.stroke();
}

function street(ctx) {
  fillHex(ctx, "#A8A898");
  // Sidewalk strips
  ctx.fillStyle = "#C0B8A8";
  ctx.fillRect(12, 0, 6, TILE_PX);
  ctx.fillRect(46, 0, 6, TILE_PX);
}

function alley(ctx) {
  fillHex(ctx, "#908880");
  // Narrow path between implied walls
  ctx.fillStyle = "#787068";
  ctx.fillRect(8, 0, 10, TILE_PX);
  ctx.fillRect(46, 0, 10, TILE_PX);
}

function road_footpath(ctx) {
  fillHex(ctx, "#A0A088");
  // Thin paved path
  ctx.fillStyle = "#B0A890";
  ctx.fillRect(24, 0, 16, TILE_PX);
}

function rail_track(ctx) {
  fillHex(ctx, "#787068");
  // Gravel bed
  ctx.fillStyle = "#989088";
  ctx.fillRect(20, 0, 24, TILE_PX);
  // Rails
  ctx.strokeStyle = "#606060";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(26, 64); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(38, 0); ctx.lineTo(38, 64); ctx.stroke();
  // Cross-ties
  ctx.strokeStyle = "#6A5A40";
  ctx.lineWidth = 2;
  for (let y = 4; y < TILE_PX; y += 6) {
    ctx.beginPath(); ctx.moveTo(22, y); ctx.lineTo(42, y); ctx.stroke();
  }
}

function tram_track(ctx) {
  fillHex(ctx, "#909080");
  // Embedded in street
  ctx.strokeStyle = "#707068";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(28, 64); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(36, 0); ctx.lineTo(36, 64); ctx.stroke();
}

// ── OPEN PAVED ──

function plaza(ctx) {
  fillHex(ctx, "#D0C8B0");
  // Paving grid pattern
  ctx.strokeStyle = "#C0B8A0";
  ctx.lineWidth = 0.5;
  for (let x = 8; x < TILE_PX; x += 8) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke();
  }
  for (let y = 8; y < TILE_PX; y += 8) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke();
  }
  // Central fountain circle
  ctx.strokeStyle = "#90A8C0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(CX, CY, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#A0B8D0";
  ctx.beginPath();
  ctx.arc(CX, CY, 3, 0, Math.PI * 2);
  ctx.fill();
}

function surface_parking(ctx) {
  fillHex(ctx, "#B0B0B8");
  // Parking space lines
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 0.8;
  for (let x = 12; x < 52; x += 8) {
    ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, 30); ctx.stroke();
  }
  for (let x = 12; x < 52; x += 8) {
    ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, 54); ctx.stroke();
  }
  // Row dividers
  ctx.strokeStyle = "#D0D0D0";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(8, 32); ctx.lineTo(56, 32); ctx.stroke();
  // A couple tiny car shapes
  ctx.fillStyle = "#7080A0";
  ctx.fillRect(14, 14, 6, 4);
  ctx.fillStyle = "#906060";
  ctx.fillRect(30, 38, 6, 4);
}

function rail_yard(ctx) {
  fillHex(ctx, "#807068");
  // Multiple parallel tracks
  ctx.strokeStyle = "#606060";
  ctx.lineWidth = 1;
  for (let x = 14; x <= 50; x += 9) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 4, 0); ctx.lineTo(x + 4, 64); ctx.stroke();
  }
  // Cross-ties
  ctx.strokeStyle = "#6A5A40";
  ctx.lineWidth = 1.5;
  for (let y = 4; y < TILE_PX; y += 8) {
    ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(54, y); ctx.stroke();
  }
}

// ── OPEN GREEN ──

function park(ctx) {
  fillHex(ctx, "#88B058");
  // A couple trees
  drawTree(ctx, 22, 22, 5, 3, "#60A838", "#5A4020");
  drawTree(ctx, 44, 36, 5, 3, "#58A030", "#5A4020");
  // Walking path
  ctx.strokeStyle = "#C0A870";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 38);
  ctx.quadraticCurveTo(32, 30, 52, 38);
  ctx.stroke();
}

function sports_field(ctx) {
  fillHex(ctx, "#78B848");
  // White line markings — field outline + center line
  ctx.strokeStyle = "#E0E0E0";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(14, 14, 36, 36);
  // Center line
  ctx.beginPath(); ctx.moveTo(14, 32); ctx.lineTo(50, 32); ctx.stroke();
  // Center circle
  ctx.beginPath(); ctx.arc(32, 32, 6, 0, Math.PI * 2); ctx.stroke();
}

function cemetery(ctx) {
  fillHex(ctx, "#688840");
  // Headstone rows
  ctx.fillStyle = "#A0A090";
  const rows = [[16, 14], [16, 24], [16, 34], [16, 44]];
  for (const [startX, gy] of rows) {
    for (let gx = startX; gx < 48; gx += 8) {
      // Small headstone
      ctx.fillRect(gx, gy, 4, 5);
      ctx.fillRect(gx - 1, gy, 6, 1); // cap
    }
  }
}

// ── ENGINEERING/SPECIAL ──

function bridge_deck(ctx) {
  fillHex(ctx, "#B0A890");
  // Railing lines
  ctx.strokeStyle = "#808070";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(8, 18); ctx.lineTo(56, 18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 46); ctx.lineTo(56, 46); ctx.stroke();
  // Road surface
  ctx.fillStyle = "#C0B8A0";
  ctx.fillRect(8, 20, 48, 24);
  // Water visible at edges
  ctx.fillStyle = "#4090B0";
  ctx.fillRect(0, 0, TILE_PX, 16);
  ctx.fillRect(0, 48, TILE_PX, 16);
}

function ground_embankment(ctx) {
  fillHex(ctx, "#A09870");
  // Raised earth with hatching on slopes
  ctx.strokeStyle = "#887860";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 8; i++) {
    const x = 10 + i * 6;
    ctx.beginPath();
    ctx.moveTo(x, 14);
    ctx.lineTo(x + 3, 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x + 3, 50);
    ctx.stroke();
  }
  // Flat top
  ctx.fillStyle = "#A8A078";
  ctx.fillRect(8, 24, 48, 16);
}

function underpass(ctx) {
  fillHex(ctx, "#706868");
  // Road surface
  ctx.fillStyle = "#888080";
  ctx.fillRect(8, 20, 48, 24);
  // Tunnel arches at edges
  ctx.fillStyle = "#404040";
  ctx.beginPath();
  ctx.arc(8, 32, 14, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(56, 32, 14, Math.PI / 2, -Math.PI / 2);
  ctx.fill();
  // Road visible in middle
  ctx.fillStyle = "#787070";
  ctx.fillRect(14, 22, 36, 20);
}

function construction_site(ctx) {
  fillHex(ctx, "#B0A068");
  // Hazard stripes (diagonal)
  ctx.strokeStyle = "#D09020";
  ctx.lineWidth = 3;
  for (let i = -TILE_PX; i < TILE_PX * 2; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, TILE_PX);
    ctx.stroke();
  }
  // Crane arm
  ctx.strokeStyle = "#606060";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, 48);
  ctx.lineTo(24, 16);
  ctx.lineTo(48, 16);
  ctx.stroke();
  // Hook
  ctx.strokeStyle = "#505050";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 16);
  ctx.lineTo(40, 24);
  ctx.stroke();
}

// ═══════════════════════════════════════════════════
// EXPORT: terrain key → drawing function
// ═══════════════════════════════════════════════════

export const TERRAIN_DRAWERS = {
  // Water
  deep_water, coastal_water, lake,
  river: river_terrain,
  canal, dock,
  // Wetland
  wetland,
  // Open terrain
  open_ground, bare_ground, light_veg, grassland, highland,
  // Agriculture
  farmland, allotment,
  // Temperate forest
  forest, dense_forest, mountain_forest, forested_hills, urban_trees,
  // Jungle/tropical
  jungle, jungle_hills, jungle_mountains, mangrove,
  // Boreal/cold
  boreal, boreal_hills, boreal_mountains, tundra, ice,
  // Arid
  desert, savanna, savanna_hills,
  // Mountain
  mountain, peak,
  // Urban light
  light_urban, dense_urban, suburban,
  bldg_light, bldg_residential, bldg_commercial, bldg_highrise,
  bldg_institutional, bldg_religious, bldg_station,
  // Urban heavy
  urban_commercial, urban_industrial, urban_dense_core,
  bldg_industrial, bldg_fortified, bldg_ruins,
  // Road surfaces
  motorway, arterial, street, alley, road_footpath, rail_track, tram_track,
  // Open paved
  plaza, surface_parking, rail_yard,
  // Open green
  park, sports_field, cemetery,
  // Engineering
  bridge_deck, ground_embankment, underpass, construction_site,
};
