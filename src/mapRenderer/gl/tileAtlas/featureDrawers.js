// ════════════════════════════════════════════════════════════════
// Feature overlay drawing — rivers, roads, rails, bridges
// Uses separated CARVE / FILL / DETAIL phases:
//   Phase 1: All carves in one destination-out pass
//   Phase 2: All fills in z-order (prevents later carves destroying earlier fills)
//   Phase 3: All details in z-order
// All edge indices are GEOMETRY edges (0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE).
// ════════════════════════════════════════════════════════════════

import {
  TILE_PX, CX, CY, HR,
  hexVertex, edgeMidpoint, extendedEdgeMidpoint, drawFeatureRoute, hexPath,
  pairEdges, computeControlPoint, sampleBezier, drawJunctionFill,
  drawEdgeToEdgePath, drawEdgeToCenterPath,
} from "./hexUtils.js";

// ══════════════════════════════════════════════════════
// Internal helpers (per-pair versions)
// ══════════════════════════════════════════════════════

// Draw a bezier offset laterally from the center path between two edges.
// offset: positive = right of path direction, negative = left.
function _drawOffsetRoute(ctx, edgeA, edgeB, offset, color, lineWidth) {
  const from = extendedEdgeMidpoint(edgeA);
  const to = extendedEdgeMidpoint(edgeB);
  const cp = computeControlPoint(edgeA, edgeB);

  // Perpendicular offset at start, control point, and end
  const d1x = cp.x - from.x, d1y = cp.y - from.y;
  const l1 = Math.sqrt(d1x * d1x + d1y * d1y);
  const n1x = l1 > 0.01 ? -d1y / l1 * offset : 0;
  const n1y = l1 > 0.01 ? d1x / l1 * offset : 0;

  const d2x = to.x - cp.x, d2y = to.y - cp.y;
  const l2 = Math.sqrt(d2x * d2x + d2y * d2y);
  const n2x = l2 > 0.01 ? -d2y / l2 * offset : 0;
  const n2y = l2 > 0.01 ? d2x / l2 * offset : 0;

  // Average normal at control point
  const ncx = (n1x + n2x) / 2;
  const ncy = (n1y + n2y) / 2;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x + n1x, from.y + n1y);
  ctx.quadraticCurveTo(cp.x + ncx, cp.y + ncy, to.x + n2x, to.y + n2y);
  ctx.stroke();
}

// Draw cross-ties perpendicular to the bezier between two edges.
function _drawCrossTies(ctx, edgeA, edgeB, color, tieWidth, spacing, tieHalfLen) {
  const from = extendedEdgeMidpoint(edgeA);
  const to = extendedEdgeMidpoint(edgeB);
  const pathLen = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  const count = Math.max(2, Math.floor(pathLen / spacing));
  const points = sampleBezier(edgeA, edgeB, count);

  ctx.strokeStyle = color;
  ctx.lineWidth = tieWidth;
  ctx.lineCap = "butt";

  // Skip first and last points (at hex edge boundary)
  for (let i = 1; i < points.length - 1; i++) {
    const { x, y, nx, ny } = points[i];
    ctx.beginPath();
    ctx.moveTo(x + nx * tieHalfLen, y + ny * tieHalfLen);
    ctx.lineTo(x - nx * tieHalfLen, y - ny * tieHalfLen);
    ctx.stroke();
  }
}

// Draw a dashed bezier between two edges (for center line markings).
function _drawDashedBezier(ctx, edgeA, edgeB, color, lineWidth, dashPattern) {
  const from = extendedEdgeMidpoint(edgeA);
  const to = extendedEdgeMidpoint(edgeB);
  const cp = computeControlPoint(edgeA, edgeB);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.setLineDash(dashPattern);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(cp.x, cp.y, to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Apply a function to each paired route and each single dead-end.
function _forEachPair(edges, pairFn, singleFn) {
  if (edges.length === 0) return;
  if (edges.length === 1) {
    if (singleFn) singleFn(edges[0]);
    return;
  }
  const { pairs, singles } = pairEdges(edges);
  for (const [a, b] of pairs) pairFn(a, b);
  for (const s of singles) { if (singleFn) singleFn(s); }
}

// Set to true to show old-style colored feature markers (debug aid).
// When false, highway yellow edge lines and railway feature markers are hidden.
const SHOW_FEATURE_MARKERS = false;


// ══════════════════════════════════════════════════════
// Per-feature CARVE / FILL / DETAIL triplets
// Compact widths (~30% smaller than v1 to allow side-by-side)
// ══════════════════════════════════════════════════════

// ── River ──
function _carveRiver(ctx, edges) {
  drawFeatureRoute(ctx, edges, 8, "rgba(0,0,0,1)");
}
function _fillRiver(ctx, edges) {
  drawFeatureRoute(ctx, edges, 10, "#5A7A50");  // Banks
  drawFeatureRoute(ctx, edges, 7, "#3AC4E0");   // Water
  drawFeatureRoute(ctx, edges, 2, "#60D8F0");   // Center highlight
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 4, "#3AC4E0");
  // Dead-end pool
  if (edges.length === 1) {
    ctx.fillStyle = "#3AC4E0";
    ctx.beginPath();
    ctx.arc(CX, CY, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
function _detailRiver(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    const pts = sampleBezier(a, b, 8);
    ctx.strokeStyle = "rgba(96,216,240,0.35)";
    ctx.lineWidth = 0.8;
    for (let i = 2; i < pts.length - 2; i += 2) {
      const { x, y, nx, ny } = pts[i];
      ctx.beginPath();
      ctx.moveTo(x + nx * 2.5, y + ny * 2.5);
      ctx.quadraticCurveTo(x, y - 1, x - nx * 2.5, y - ny * 2.5);
      ctx.stroke();
    }
  }, null);
}

// ── Highway ──
function _carveHighway(ctx, edges) {
  drawFeatureRoute(ctx, edges, 9, "rgba(0,0,0,1)");
}
function _fillHighway(ctx, edges) {
  drawFeatureRoute(ctx, edges, 9, "#505050");   // Shoulder
  drawFeatureRoute(ctx, edges, 7, "#808080");   // Asphalt base
  drawFeatureRoute(ctx, edges, 6, "#909090");   // Surface
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 4, "#909090");
}
function _detailHighway(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    if (SHOW_FEATURE_MARKERS) {
      _drawOffsetRoute(ctx, a, b, 3.0, "#D0A020", 1);   // Yellow edge lines
      _drawOffsetRoute(ctx, a, b, -3.0, "#D0A020", 1);
    }
    _drawDashedBezier(ctx, a, b, "#E0E0E0", 1, [3, 3]); // White center dash
  }, null);
}

// ── Major road (new — between road and highway) ──
function _carveMajorRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 7, "rgba(0,0,0,1)");
}
function _fillMajorRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 7, "#606060");   // Shoulder
  drawFeatureRoute(ctx, edges, 5, "#A0A0A0");   // Surface
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 3, "#A0A0A0");
}
function _detailMajorRoad(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    _drawDashedBezier(ctx, a, b, "#D0D0D0", 1, [4, 3]);  // White center dash
    _drawOffsetRoute(ctx, a, b, 2.5, "#505050", 0.5);     // Subtle edge lines
    _drawOffsetRoute(ctx, a, b, -2.5, "#505050", 0.5);
  }, null);
}

// ── Road ──
function _carveRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 6, "rgba(0,0,0,1)");
}
function _fillRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 6, "#707070");   // Edge/shoulder
  drawFeatureRoute(ctx, edges, 4, "#B0B0B0");   // Surface
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 3, "#B0B0B0");
}
function _detailRoad(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    _drawOffsetRoute(ctx, a, b, 2.0, "#606060", 0.5);
    _drawOffsetRoute(ctx, a, b, -2.0, "#606060", 0.5);
  }, null);
}

// ── Minor road ──
function _carveMinorRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 4, "rgba(0,0,0,1)");
}
function _fillMinorRoad(ctx, edges) {
  drawFeatureRoute(ctx, edges, 4, "#908870");   // Edge
  drawFeatureRoute(ctx, edges, 3, "#B0A890");   // Surface
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 2, "#B0A890");
}
function _detailMinorRoad() {} // No detail for minor roads

// ── Footpath (no carve) ──
function _fillFootpath(ctx, edges) {
  ctx.save();
  ctx.setLineDash([3, 3]);
  drawFeatureRoute(ctx, edges, 1.5, "#A09878");
  ctx.setLineDash([]);
  ctx.restore();
}
function _detailFootpath() {}

// ── Trail (no carve) ──
function _fillTrail(ctx, edges) {
  ctx.save();
  ctx.setLineDash([2, 4]);
  drawFeatureRoute(ctx, edges, 1, "#908868");
  ctx.setLineDash([]);
  ctx.restore();
}
function _detailTrail() {}

// ── Railway ──
function _carveRailway(ctx, edges) {
  drawFeatureRoute(ctx, edges, 7, "rgba(0,0,0,1)");
}
function _fillRailway(ctx, edges) {
  drawFeatureRoute(ctx, edges, 7, "#A09888");   // Gravel bed
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 3, "#A09888");
}
function _detailRailway(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    _drawOffsetRoute(ctx, a, b, 2.0, "#606060", 1.0);   // Parallel rails
    _drawOffsetRoute(ctx, a, b, -2.0, "#606060", 1.0);
    if (SHOW_FEATURE_MARKERS) {
      _drawCrossTies(ctx, a, b, "#6A5A40", 1.5, 5, 3);  // Cross-ties (debug marker)
    } else {
      _drawCrossTies(ctx, a, b, "#808080", 1.0, 6, 2);  // Subtle gray ties
    }
  }, (s) => {
    ctx.strokeStyle = "#606060";
    ctx.lineWidth = 1;
    const m = extendedEdgeMidpoint(s);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(CX, CY);
    ctx.stroke();
  });
}

// ── Light rail ──
function _carveLightRail(ctx, edges) {
  drawFeatureRoute(ctx, edges, 5, "rgba(0,0,0,1)");
}
function _fillLightRail(ctx, edges) {
  drawFeatureRoute(ctx, edges, 5, "#989888");   // Bed
  if (edges.length >= 3) drawJunctionFill(ctx, edges, 2.5, "#989888");
}
function _detailLightRail(ctx, edges) {
  _forEachPair(edges, (a, b) => {
    _drawOffsetRoute(ctx, a, b, 1.5, "#707070", 0.8);
    _drawOffsetRoute(ctx, a, b, -1.5, "#707070", 0.8);
    if (SHOW_FEATURE_MARKERS) {
      _drawCrossTies(ctx, a, b, "#7A6A50", 1.2, 7, 2.5);
    } else {
      _drawCrossTies(ctx, a, b, "#808080", 0.8, 8, 1.8);
    }
  }, null);
}

// ── Bridge interaction ──
// Draws a bridge where a road/rail crosses over a river.
// Bridge is positioned at the intersection of road and river paths,
// oriented perpendicular to the river so it straddles the water.
function drawBridgeInteraction(ctx, roadEdges, riverEdges, roadType) {
  if (roadEdges.length < 2 || riverEdges.length < 2) return;

  const { pairs: riverPairs } = pairEdges(riverEdges);
  const { pairs: roadPairs } = pairEdges(roadEdges);
  if (riverPairs.length === 0 || roadPairs.length === 0) return;

  const [rA, rB] = riverPairs[0];
  const rMid0 = edgeMidpoint(rA);
  const rMid1 = edgeMidpoint(rB);
  const riverAngle = Math.atan2(rMid1.y - rMid0.y, rMid1.x - rMid0.x);

  // Find intersection of road path and river path (approximate via sampling)
  const [rdA, rdB] = roadPairs[0];
  const roadPts = sampleBezier(rdA, rdB, 12);
  const riverPts = sampleBezier(rA, rB, 12);

  // Find closest approach between the two sampled paths
  let bestDist = Infinity, crossX = CX, crossY = CY;
  for (const rp of roadPts) {
    for (const rv of riverPts) {
      const d = (rp.x - rv.x) ** 2 + (rp.y - rv.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        crossX = (rp.x + rv.x) / 2;
        crossY = (rp.y + rv.y) / 2;
      }
    }
  }

  const railingColor = roadType === "highway" ? "#808080" : "#907860";
  const railingW = roadType === "highway" ? 10 : 7;

  ctx.save();
  ctx.translate(crossX, crossY);
  ctx.rotate(riverAngle);

  // Bridge deck (perpendicular to river)
  ctx.fillStyle = roadType === "highway" ? "#909090" : "#B0A890";
  ctx.fillRect(-railingW / 2, -6, railingW, 12);

  // Railings
  ctx.fillStyle = railingColor;
  ctx.fillRect(-railingW / 2, -7, railingW, 1.5);
  ctx.fillRect(-railingW / 2, 5.5, railingW, 1.5);

  ctx.restore();
}

// ══════════════════════════════════════════════════════
// Static feature overlays — icons and patterns drawn
// on top of terrain for point/area features.
// ══════════════════════════════════════════════════════

// Features that are handled by edge connectivity (linear paths)
// and should NOT be drawn as static overlays
const LINEAR_FEATURES = new Set([
  "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail", "river",
]);

// Features that produce a static overlay drawing
const STATIC_DRAWERS = {};

// ── Road corridor detection for building placement ──
// Priority order: widest/most important feature first
const ROAD_PRIORITY = ["highway", "major_road", "road", "rail", "light_rail", "minor_road", "river"];
const ROAD_HALF_WIDTHS = {
  highway: 5, major_road: 4, road: 3, rail: 4,
  light_rail: 3, minor_road: 2, river: 5,
};

// Compute ALL linear feature corridors for building avoidance.
// Returns array of { angle, perpAngle, halfWidth, centerPts } for each
// feature with 2+ edges, plus a simplified corridor for 1-edge dead-ends.
function _computeRoadCorridor(featureEdges) {
  if (!featureEdges) return null;
  const corridors = [];

  for (const cat of ROAD_PRIORITY) {
    const edges = featureEdges[cat];
    if (!edges || edges.size === 0) continue;
    const edgeArr = [...edges];
    const halfWidth = ROAD_HALF_WIDTHS[cat] || 3;

    if (edgeArr.length >= 2) {
      const { pairs } = pairEdges(edgeArr);
      for (const [eA, eB] of pairs) {
        const mA = edgeMidpoint(eA);
        const mB = edgeMidpoint(eB);
        const angle = Math.atan2(mB.y - mA.y, mB.x - mA.x);
        const perpAngle = angle + Math.PI / 2;
        // Sample center path for proximity checking
        const pts = sampleBezier(eA, eB, 6);
        corridors.push({ angle, perpAngle, halfWidth, centerPts: pts });
      }
    } else {
      // Dead-end: corridor from edge to center
      const m = edgeMidpoint(edgeArr[0]);
      const angle = Math.atan2(CY - m.y, CX - m.x);
      const perpAngle = angle + Math.PI / 2;
      corridors.push({ angle, perpAngle, halfWidth, centerPts: [{ x: m.x, y: m.y }, { x: CX, y: CY }] });
    }
  }

  return corridors.length > 0 ? corridors : null;
}

// Shift a building position away from ALL feature corridors.
// Uses local tangent at nearest sample point for accurate perpendicular push.
// Building half-size (~5px) added to clearance so edges don't overlap the road.
function _adjustBuildingPos(bx, by, corridors) {
  if (!corridors) return [bx, by];

  let ax = bx, ay = by;
  for (const corr of corridors) {
    const pts = corr.centerPts;
    // Find nearest sample point on this corridor
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.sqrt((ax - pts[i].x) ** 2 + (ay - pts[i].y) ** 2);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    // halfWidth + building half-size margin
    const clearance = corr.halfWidth + 7;
    if (minDist < clearance) {
      // Compute local tangent from neighboring samples for accurate perpendicular
      const prev = pts[Math.max(0, nearestIdx - 1)];
      const next = pts[Math.min(pts.length - 1, nearestIdx + 1)];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      // Perpendicular to local tangent (rotate 90 degrees)
      const perpX = -ty / tLen;
      const perpY = tx / tLen;

      const dx = ax - pts[nearestIdx].x;
      const dy = ay - pts[nearestIdx].y;
      const projection = dx * perpX + dy * perpY;
      const sign = projection >= 0 ? 1 : -1;
      // Push the full clearance distance from the path center
      ax = pts[nearestIdx].x + perpX * clearance * sign;
      ay = pts[nearestIdx].y + perpY * clearance * sign;
    }
  }
  return [ax, ay];
}

// Draw a single building (wall + roof) at adjusted position
function _drawHouse(ctx, hx, hy, hw, hh, roadInfo) {
  const [ax, ay] = _adjustBuildingPos(hx, hy, roadInfo);
  ctx.fillStyle = "#C0B098";
  ctx.fillRect(ax, ay, hw, hh);
  ctx.fillStyle = "#905040";
  ctx.beginPath();
  ctx.moveTo(ax - 1, ay);
  ctx.lineTo(ax + hw / 2, ay - 4);
  ctx.lineTo(ax + hw + 1, ay);
  ctx.closePath();
  ctx.fill();
}

// ── Military base: dark green pentagon with star ──
STATIC_DRAWERS.military_base = (ctx) => {
  ctx.fillStyle = "rgba(40,60,30,0.5)";
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  _drawStar(ctx, CX, CY, 10, 5, 5, "#C8A000");
  ctx.strokeStyle = "#8A7A30";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(CX, CY, 14, 0, Math.PI * 2);
  ctx.stroke();
};

// ── Airfield: runway cross ──
STATIC_DRAWERS.airfield = (ctx) => {
  ctx.fillStyle = "#707070";
  ctx.fillRect(CX - 20, CY - 3, 40, 6);
  ctx.fillRect(CX - 2, CY - 14, 4, 28);
  ctx.fillStyle = "#E0E0E0";
  for (let i = -16; i <= 16; i += 8) {
    ctx.fillRect(CX + i - 1, CY - 0.5, 2, 1);
  }
  ctx.fillStyle = "#D04020";
  ctx.fillRect(CX + 18, CY - 10, 2, 6);
  ctx.beginPath();
  ctx.moveTo(CX + 20, CY - 10);
  ctx.lineTo(CX + 26, CY - 8);
  ctx.lineTo(CX + 20, CY - 6);
  ctx.closePath();
  ctx.fill();
};

// ── Port: anchor icon ──
STATIC_DRAWERS.port = (ctx) => {
  const x = CX, y = CY;
  ctx.strokeStyle = "#304060";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y - 6); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y + 4, 8, 0, Math.PI, false); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - 12, 3, 0, Math.PI * 2); ctx.stroke();
};

// ── Power plant: lightning bolt ──
STATIC_DRAWERS.power_plant = (ctx) => {
  ctx.fillStyle = "#D0A020";
  ctx.beginPath();
  ctx.moveTo(CX + 2, CY - 14); ctx.lineTo(CX - 5, CY + 2);
  ctx.lineTo(CX, CY); ctx.lineTo(CX - 3, CY + 14);
  ctx.lineTo(CX + 5, CY - 2); ctx.lineTo(CX, CY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(208,160,32,0.2)";
  ctx.beginPath(); ctx.arc(CX, CY, 14, 0, Math.PI * 2); ctx.fill();
};

// ── Dam: thick horizontal wall ──
STATIC_DRAWERS.dam = (ctx) => {
  ctx.fillStyle = "#808070";
  ctx.fillRect(CX - 18, CY - 4, 36, 8);
  ctx.strokeStyle = "#909080";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(CX - 18, CY - 1); ctx.lineTo(CX + 18, CY - 1);
  ctx.moveTo(CX - 18, CY + 2); ctx.lineTo(CX + 18, CY + 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(58,196,224,0.4)";
  ctx.fillRect(CX - 10, CY + 4, 20, 10);
};

// ── Beach: sandy gradient ──
STATIC_DRAWERS.beach = (ctx) => {
  const grad = ctx.createLinearGradient(0, CY, 0, TILE_PX);
  grad.addColorStop(0, "rgba(210,190,140,0)");
  grad.addColorStop(0.3, "rgba(210,190,140,0.4)");
  grad.addColorStop(1, "rgba(210,190,140,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, CY, TILE_PX, TILE_PX);
  ctx.fillStyle = "rgba(180,160,110,0.5)";
  const dots = [[10,48],[24,52],[38,46],[50,54],[16,56],[44,50]];
  for (const [dx, dy] of dots) ctx.fillRect(dx, dy, 2, 2);
};

// ── Cliffs: jagged dark line ──
STATIC_DRAWERS.cliffs = (ctx) => {
  ctx.strokeStyle = "#503020";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(6, CY + 4);
  const points = [[14, CY - 6], [20, CY + 2], [28, CY - 8], [36, CY + 3], [44, CY - 5], [52, CY + 1], [58, CY - 3]];
  for (const [px, py] of points) ctx.lineTo(px, py);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(6, CY + 7);
  for (const [px, py] of points) ctx.lineTo(px, py + 3);
  ctx.stroke();
};

// ── Ridgeline ──
STATIC_DRAWERS.ridgeline = (ctx) => {
  ctx.strokeStyle = "#705840";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(8, CY); ctx.lineTo(56, CY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#705840";
  for (let x = 14; x < 52; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, CY - 4); ctx.lineTo(x + 3, CY); ctx.lineTo(x - 3, CY);
    ctx.closePath(); ctx.fill();
  }
};

// ── Saddle ──
STATIC_DRAWERS.saddle = (ctx) => {
  ctx.strokeStyle = "#806850";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(CX - 8, CY + 8, 12, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX + 8, CY + 8, 12, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
};

// ── Steep slope ──
STATIC_DRAWERS.slope_steep = (ctx) => {
  ctx.strokeStyle = "rgba(80,50,20,0.4)";
  ctx.lineWidth = 1.5;
  for (let x = 8; x < TILE_PX; x += 8) {
    ctx.beginPath(); ctx.moveTo(x, CY - 6); ctx.lineTo(x - 4, CY + 6); ctx.stroke();
  }
};

// ── Extreme slope ──
STATIC_DRAWERS.slope_extreme = (ctx) => {
  ctx.strokeStyle = "rgba(100,40,20,0.5)";
  ctx.lineWidth = 2;
  for (let x = 6; x < TILE_PX; x += 5) {
    ctx.beginPath(); ctx.moveTo(x, CY - 10); ctx.lineTo(x - 6, CY + 10); ctx.stroke();
  }
};

// ── Rough terrain ──
STATIC_DRAWERS.rough_terrain = (ctx) => {
  ctx.strokeStyle = "rgba(80,60,30,0.4)";
  ctx.lineWidth = 1;
  const positions = [[16,20],[36,18],[48,28],[12,40],[30,44],[52,42],[24,32]];
  for (const [px, py] of positions) {
    ctx.beginPath();
    ctx.moveTo(px - 2, py - 2); ctx.lineTo(px + 2, py + 2);
    ctx.moveTo(px + 2, py - 2); ctx.lineTo(px - 2, py + 2);
    ctx.stroke();
  }
};

// ── Elevation advantage ──
STATIC_DRAWERS.elevation_advantage = (ctx) => {
  ctx.fillStyle = "rgba(120,100,60,0.5)";
  ctx.beginPath();
  ctx.moveTo(CX, CY - 12); ctx.lineTo(CX + 8, CY); ctx.lineTo(CX + 3, CY);
  ctx.lineTo(CX + 3, CY + 10); ctx.lineTo(CX - 3, CY + 10); ctx.lineTo(CX - 3, CY);
  ctx.lineTo(CX - 8, CY);
  ctx.closePath(); ctx.fill();
};

// ── Shoreline ──
STATIC_DRAWERS.shoreline = (ctx) => {
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= TILE_PX; x += 2) {
    const y = TILE_PX - 8 + Math.sin(x / 5) * 2;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
};

// ── Town: cluster of small houses (building-flanking aware) ──
STATIC_DRAWERS.town = (ctx, roadInfo) => {
  const houses = [[CX-10,CY-6,8,6],[CX+4,CY-8,7,7],[CX-4,CY+4,9,6],[CX+8,CY+2,6,5]];
  for (const [hx, hy, hw, hh] of houses) {
    _drawHouse(ctx, hx, hy, hw, hh, roadInfo);
  }
};

// ── Building (single, building-flanking aware) ──
STATIC_DRAWERS.building = (ctx, roadInfo) => {
  const [ax, ay] = _adjustBuildingPos(CX - 5, CY - 4, roadInfo);
  ctx.fillStyle = "#A09880";
  ctx.fillRect(ax, ay, 10, 8);
  ctx.fillStyle = "#806850";
  ctx.beginPath();
  ctx.moveTo(ax - 1, ay);
  ctx.lineTo(ax + 5, ay - 5);
  ctx.lineTo(ax + 11, ay);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#504030";
  ctx.fillRect(ax + 4, ay + 4, 3, 4);
};

// ── Building dense (building-flanking aware) ──
STATIC_DRAWERS.building_dense = (ctx, roadInfo) => {
  ctx.fillStyle = "rgba(80,70,60,0.35)";
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  const buildings = [[10,14,8,10],[24,10,10,8],[40,12,9,9],[14,30,7,8],[30,28,11,10],[48,26,8,7],[20,46,9,7],[38,44,8,9]];
  for (const [bx,by,bw,bh] of buildings) {
    const [ax, ay] = _adjustBuildingPos(bx, by, roadInfo);
    ctx.fillStyle = "#908878";
    ctx.fillRect(ax, ay, bw, bh);
    ctx.strokeStyle = "#706858";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ax, ay, bw, bh);
  }
};

// ── Building sparse (building-flanking aware) ──
STATIC_DRAWERS.building_sparse = (ctx, roadInfo) => {
  const buildings = [[16,22,5,5],[40,18,5,4],[28,38,6,5],[50,40,4,5]];
  for (const [bx,by,bw,bh] of buildings) {
    const [ax, ay] = _adjustBuildingPos(bx, by, roadInfo);
    ctx.fillStyle = "#B0A890";
    ctx.fillRect(ax, ay, bw, bh);
    ctx.fillStyle = "#907860";
    ctx.fillRect(ax, ay - 2, bw, 2);
  }
};

// ── Courtyard ──
STATIC_DRAWERS.courtyard = (ctx) => {
  ctx.strokeStyle = "#908070";
  ctx.lineWidth = 2;
  ctx.strokeRect(CX - 10, CY - 8, 20, 16);
  ctx.fillStyle = "rgba(200,190,170,0.3)";
  ctx.fillRect(CX - 10, CY - 8, 20, 16);
};

// ── Metro entrance ──
STATIC_DRAWERS.metro_entrance = (ctx) => {
  ctx.fillStyle = "#3050A0";
  ctx.beginPath(); ctx.arc(CX, CY, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M", CX, CY + 1);
};

// ── Wall ──
STATIC_DRAWERS.wall = (ctx) => {
  ctx.strokeStyle = "#605040";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(8, TILE_PX - 10); ctx.lineTo(TILE_PX - 8, TILE_PX - 10); ctx.stroke();
  ctx.fillStyle = "#605040";
  for (let x = 12; x < TILE_PX - 8; x += 6) ctx.fillRect(x - 1, TILE_PX - 14, 2, 4);
};

// ── Fence ──
STATIC_DRAWERS.fence = (ctx) => {
  ctx.strokeStyle = "#807060";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 2]);
  ctx.beginPath(); ctx.moveTo(8, TILE_PX - 10); ctx.lineTo(TILE_PX - 8, TILE_PX - 10); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#807060";
  for (let x = 10; x < TILE_PX - 8; x += 8) ctx.fillRect(x - 0.5, TILE_PX - 14, 1, 6);
};

// ── Hedgerow ──
STATIC_DRAWERS.hedgerow = (ctx) => {
  ctx.fillStyle = "#3A6830";
  const y = TILE_PX - 12;
  for (let x = 10; x < TILE_PX - 6; x += 5) {
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#2A5020";
  for (let x = 12; x < TILE_PX - 6; x += 10) {
    ctx.beginPath(); ctx.arc(x, y - 1, 2, 0, Math.PI * 2); ctx.fill();
  }
};

// ── Treeline ──
STATIC_DRAWERS.treeline = (ctx) => {
  const y = TILE_PX - 14;
  ctx.fillStyle = "#2A5020";
  for (let x = 10; x < TILE_PX - 4; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, y - 6); ctx.lineTo(x + 4, y + 4); ctx.lineTo(x - 4, y + 4);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = "#4A3820";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(10, y + 4); ctx.lineTo(TILE_PX - 8, y + 4); ctx.stroke();
};

// ── Bridge (static icon — disabled, bridges now drawn dynamically in drawBridgeInteraction) ──
// STATIC_DRAWERS.bridge = (ctx) => {
//   ctx.strokeStyle = "#706050";
//   ctx.lineWidth = 2;
//   ctx.beginPath(); ctx.arc(CX, CY + 4, 10, Math.PI, 0); ctx.stroke();
//   ctx.fillStyle = "#706050";
//   ctx.fillRect(CX - 10, CY - 2, 3, 10);
//   ctx.fillRect(CX + 7, CY - 2, 3, 10);
//   ctx.fillRect(CX - 12, CY - 4, 24, 3);
// };

// ── River crossing ──
STATIC_DRAWERS.river_crossing = (ctx) => {
  ctx.strokeStyle = "rgba(58,196,224,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = CX - 12; x <= CX + 12; x += 6) {
    ctx.moveTo(x, CY - 2);
    ctx.quadraticCurveTo(x + 3, CY - 5, x + 6, CY - 2);
  }
  ctx.stroke();
  ctx.fillStyle = "#908878";
  const stones = [CX - 8, CX - 2, CX + 4, CX + 10];
  for (const sx of stones) {
    ctx.beginPath(); ctx.ellipse(sx, CY + 2, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
  }
};

// ── Stream crossing ──
STATIC_DRAWERS.stream_crossing = (ctx) => {
  ctx.strokeStyle = "rgba(58,196,224,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX - 8, CY);
  ctx.quadraticCurveTo(CX, CY - 4, CX + 8, CY);
  ctx.stroke();
  ctx.fillStyle = "#A09888";
  ctx.beginPath();
  ctx.arc(CX - 3, CY + 1, 2, 0, Math.PI * 2);
  ctx.arc(CX + 3, CY + 1, 2, 0, Math.PI * 2);
  ctx.fill();
};

// ── River delta ──
// Drawn on wetland tiles adjacent to ocean. oceanEdges = array of geometry
// edge indices facing ocean tiles. Channels fan from hex center to points
// spread across the full length of each ocean-facing edge.
function _drawRiverDelta(ctx, oceanEdges) {
  if (!oceanEdges || oceanEdges.length === 0) return;

  // Deterministic pseudo-random from edge index (consistent per tile signature)
  const seed = oceanEdges.reduce((s, e) => s * 7 + e, 13);
  const rand = (i) => {
    const x = Math.sin(seed * 9301 + i * 49297 + 233280) * 49297;
    return x - Math.floor(x); // 0..1
  };

  // Build channels: 5-7 per ocean edge, endpoints spread across the full edge
  const allChannels = [];
  let ri = 0; // running random index
  for (const edgeIdx of oceanEdges) {
    const v0 = hexVertex(edgeIdx);
    const v1 = hexVertex((edgeIdx + 1) % 6);

    // Number of channels: 5-7 depending on pseudo-random
    const count = 5 + Math.floor(rand(ri++) * 3);

    for (let j = 0; j < count; j++) {
      // Spread endpoints across the full edge with slight randomization
      // Base position evenly spaced, then jittered ±8% of edge length
      const baseT = (j + 0.5) / count;
      const jitter = (rand(ri++) - 0.5) * 0.16;
      const t = Math.max(0.05, Math.min(0.95, baseT + jitter));

      const ex = v0.x + (v1.x - v0.x) * t;
      const ey = v0.y + (v1.y - v0.y) * t;

      // Width: thicker in the middle, thinner at edges
      const centerDist = Math.abs(t - 0.5) * 2; // 0 at center, 1 at edges
      const w = 1.0 + (1 - centerDist) * 1.2 + rand(ri++) * 0.5;

      // Control point: midway between center and endpoint, randomly offset
      // perpendicular to the center→endpoint vector for organic curves
      const mx = (CX + ex) / 2;
      const my = (CY + ey) / 2;
      const dx = ex - CX;
      const dy = ey - CY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny =  dx / len;
      const cpOff = (rand(ri++) - 0.5) * 8; // ±4px perpendicular wobble
      const cpX = mx + nx * cpOff;
      const cpY = my + ny * cpOff;

      allChannels.push({ ex, ey, w, cpX, cpY });
    }
  }

  // Pass 1: bank edges (wider, subtle muddy green)
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(60,90,50,0.3)";
  for (const ch of allChannels) {
    ctx.lineWidth = ch.w + 1.5;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.quadraticCurveTo(ch.cpX, ch.cpY, ch.ex, ch.ey);
    ctx.stroke();
  }

  // Pass 2: water channels on top
  ctx.strokeStyle = "#3AC4E0";
  for (const ch of allChannels) {
    ctx.lineWidth = ch.w;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.quadraticCurveTo(ch.cpX, ch.cpY, ch.ex, ch.ey);
    ctx.stroke();
  }
}

// ── Helper: draw 5-pointed star ──
function _drawStar(ctx, cx, cy, outerR, innerR, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 2) * -1 + (Math.PI / points) * i;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// Extract static features from a cell's features array.
// Filters out linear features that are handled by edge connectivity.
export function extractStaticFeatures(cellFeatures) {
  if (!cellFeatures || cellFeatures.length === 0) return null;
  const statics = [];
  for (const f of cellFeatures) {
    if (!LINEAR_FEATURES.has(f) && STATIC_DRAWERS[f]) {
      statics.push(f);
    }
  }
  if (statics.length === 0) return null;
  statics.sort();
  return statics;
}

// Draw all static feature overlays for a cell.
// featureEdges: passed through so building drawers can avoid road corridors.
export function drawStaticFeatures(ctx, staticFeatures, featureEdges) {
  if (!staticFeatures) return;
  const roadInfo = _computeRoadCorridor(featureEdges);
  for (const f of staticFeatures) {
    // Handle parameterized features like "river_delta:1,2,3" (edges facing ocean)
    if (f.startsWith("river_delta:")) {
      const edges = f.split(":")[1].split(",").map(Number).filter(n => !isNaN(n));
      if (edges.length > 0) {
        ctx.save();
        _drawRiverDelta(ctx, edges);
        ctx.restore();
      }
      continue;
    }
    const drawer = STATIC_DRAWERS[f];
    if (drawer) {
      ctx.save();
      drawer(ctx, roadInfo);
      ctx.restore();
    }
  }
}

// ══════════════════════════════════════════════════════
// Dispatcher: draw all features for a tile
// Three-phase approach prevents later carves from
// destroying earlier fills.
// ══════════════════════════════════════════════════════

export function drawAllFeatures(ctx, featureEdges) {
  if (!featureEdges) return;

  const riverE  = featureEdges.river       ? [...featureEdges.river]      : [];
  const hwE     = featureEdges.highway     ? [...featureEdges.highway]    : [];
  const majorE  = featureEdges.major_road  ? [...featureEdges.major_road] : [];
  const roadE   = featureEdges.road        ? [...featureEdges.road]       : [];
  const minorE  = featureEdges.minor_road  ? [...featureEdges.minor_road] : [];
  const footE   = featureEdges.footpath    ? [...featureEdges.footpath]   : [];
  const trailE  = featureEdges.trail       ? [...featureEdges.trail]      : [];
  const railE   = featureEdges.rail        ? [...featureEdges.rail]       : [];
  const lrailE  = featureEdges.light_rail  ? [...featureEdges.light_rail] : [];

  // Count features with 2+ edges (through-traffic). When a hex is busy,
  // scale down all features so they don't overlap as much.
  const throughCount = [riverE, hwE, majorE, roadE, minorE, railE, lrailE]
    .filter(e => e.length >= 2).length;
  // Scale factor: 1.0 for 1-2 features, shrinks for 3+ (0.8 at 3, 0.65 at 4+)
  const busy = throughCount >= 3;
  const scale = throughCount <= 2 ? 1.0 : Math.max(0.6, 1.0 - (throughCount - 2) * 0.15);

  // Helper: wrap draw call with scale transform for busy junctions
  const scaled = (fn, edges) => {
    if (!busy) { fn(ctx, edges); return; }
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(scale, scale);
    ctx.translate(-CX, -CY);
    fn(ctx, edges);
    ctx.restore();
  };

  // ── PHASE 1: ALL carves in one destination-out pass ──
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  if (riverE.length)  scaled(_carveRiver, riverE);
  if (minorE.length)  scaled(_carveMinorRoad, minorE);
  if (roadE.length)   scaled(_carveRoad, roadE);
  if (majorE.length)  scaled(_carveMajorRoad, majorE);
  if (hwE.length)     scaled(_carveHighway, hwE);
  if (lrailE.length)  scaled(_carveLightRail, lrailE);
  if (railE.length)   scaled(_carveRailway, railE);
  ctx.restore();

  // ── PHASE 2: ALL fills in z-order (lowest first) ──
  if (riverE.length)  scaled(_fillRiver, riverE);
  if (trailE.length)  _fillTrail(ctx, trailE);  // trails/footpaths don't need scaling
  if (footE.length)   _fillFootpath(ctx, footE);
  if (minorE.length)  scaled(_fillMinorRoad, minorE);
  if (roadE.length)   scaled(_fillRoad, roadE);
  if (majorE.length)  scaled(_fillMajorRoad, majorE);
  if (hwE.length)     scaled(_fillHighway, hwE);
  if (lrailE.length)  scaled(_fillLightRail, lrailE);
  if (railE.length)   scaled(_fillRailway, railE);

  // ── PHASE 3: ALL details in z-order ──
  if (riverE.length)  scaled(_detailRiver, riverE);
  if (trailE.length)  _detailTrail();
  if (footE.length)   _detailFootpath();
  if (minorE.length)  _detailMinorRoad();
  if (roadE.length)   scaled(_detailRoad, roadE);
  if (majorE.length)  scaled(_detailMajorRoad, majorE);
  if (hwE.length)     scaled(_detailHighway, hwE);
  if (lrailE.length)  scaled(_detailLightRail, lrailE);
  if (railE.length)   scaled(_detailRailway, railE);

  // Bridge interactions (road/rail over river, drawn on top of everything)
  if (riverE.length >= 2) {
    if (hwE.length >= 2) drawBridgeInteraction(ctx, hwE, riverE, "highway");
    else if (majorE.length >= 2) drawBridgeInteraction(ctx, majorE, riverE, "major_road");
    else if (roadE.length >= 2) drawBridgeInteraction(ctx, roadE, riverE, "road");
    else if (minorE.length >= 2) drawBridgeInteraction(ctx, minorE, riverE, "minor");
    if (railE.length >= 2) drawBridgeInteraction(ctx, railE, riverE, "rail");
  }
}
