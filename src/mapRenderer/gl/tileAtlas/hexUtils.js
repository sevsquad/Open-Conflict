// ════════════════════════════════════════════════════════════════
// Hex tile drawing utilities — geometry, clipping, edge positions
// Used by terrain and feature drawers to render into 64px hex tiles.
// ════════════════════════════════════════════════════════════════

export const TILE_PX = 64;
export const CX = TILE_PX / 2;  // 32 — hex center x
export const CY = TILE_PX / 2;  // 32 — hex center y
export const HR = TILE_PX / 2;  // 32 — hex outer radius (center to vertex)

const DEG_TO_RAD = Math.PI / 180;

// Pointy-top hex vertex position (matches HexGeometry.js: first vertex at -30 deg)
export function hexVertex(i) {
  const angle = DEG_TO_RAD * (60 * i - 30);
  return { x: CX + HR * Math.cos(angle), y: CY + HR * Math.sin(angle) };
}

// Draw hex path on ctx (for clipping or stroking)
export function hexPath(ctx) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const { x, y } = hexVertex(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Clip context to hex shape
export function clipToHex(ctx) {
  hexPath(ctx);
  ctx.clip();
}

// Geometry edge midpoint (edge i = vertex[i] → vertex[(i+1)%6])
// Edge order: 0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE
export function edgeMidpoint(edgeIdx) {
  const v0 = hexVertex(edgeIdx);
  const v1 = hexVertex((edgeIdx + 1) % 6);
  return { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
}

// Neighbor direction indices: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE
// Geometry edge indices:      0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE
// This maps neighbor direction → geometry edge (they share that edge)
const DIR_TO_EDGE = [0, 5, 4, 3, 2, 1];
export function dirToEdge(dirIdx) { return DIR_TO_EDGE[dirIdx]; }

// Get edge midpoint for a neighbor direction
export function dirMidpoint(dirIdx) {
  return edgeMidpoint(DIR_TO_EDGE[dirIdx]);
}

// Find neighbor direction from hex (c1,r1) to adjacent hex (c2,r2)
// Returns 0-5 or -1 if not adjacent. Uses odd-r offset coordinates.
const ODD_R_EVEN = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const ODD_R_ODD  = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

export function findNeighborDir(c1, r1, c2, r2) {
  const dc = c2 - c1;
  const dr = r2 - r1;
  // Tables were mislabeled: ODD_R_EVEN has odd-row offsets and vice versa.
  // Swap selection so even rows get even-row offsets (ODD_R_ODD).
  const dirs = (r1 & 1) === 0 ? ODD_R_ODD : ODD_R_EVEN;
  for (let i = 0; i < 6; i++) {
    if (dirs[i][0] === dc && dirs[i][1] === dr) return i;
  }
  return -1;
}

// ── Extended edge midpoint ──
// Pushes the midpoint outward past the hex boundary to prevent sub-pixel
// gaps at tile seams. Used for stroke endpoints, NOT for control point math.
export function extendedEdgeMidpoint(edgeIdx, extension = 2) {
  const m = edgeMidpoint(edgeIdx);
  const dx = m.x - CX;
  const dy = m.y - CY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return m;
  return {
    x: m.x + (dx / len) * extension,
    y: m.y + (dy / len) * extension,
  };
}

// ── Smart bezier control point ──
// Varies based on angular separation between two edges.
// Opposite edges (180°) → control at center → straight line.
// 120° bend → push OUTWARD from center → curve bows toward neighbors.
// 60° bend → pull toward center → tight curve staying inside hex.
export function computeControlPoint(edgeA, edgeB) {
  const m1 = edgeMidpoint(edgeA);
  const m2 = edgeMidpoint(edgeB);
  const sep = Math.min(Math.abs(edgeB - edgeA), 6 - Math.abs(edgeB - edgeA));
  const midX = (m1.x + m2.x) / 2;
  const midY = (m1.y + m2.y) / 2;
  // sep=3 → opposite (straight through center)
  // sep=2 → 120° bend, pull toward center so curves create smooth S-bends
  //          at hex boundaries (compensates for hex grid zigzag)
  // sep=1 → 60° bend, pull toward center to stay inside hex
  const pullFactor = sep === 3 ? 1.0 : sep === 2 ? 0.35 : 0.75;
  return {
    x: midX + (CX - midX) * pullFactor,
    y: midY + (CY - midY) * pullFactor,
  };
}

// ── Edge pairing for junctions ──
// Greedy pairing by maximum angular separation (opposite edges paired first).
// Returns { pairs: [[a,b],...], singles: [c,...] }.
// Replaces the crude star pattern for 3+ edge junctions.
export function pairEdges(edges) {
  if (edges.length <= 1) return { pairs: [], singles: [...edges] };
  if (edges.length === 2) return { pairs: [[edges[0], edges[1]]], singles: [] };

  const remaining = [...edges];
  const pairs = [];
  while (remaining.length >= 2) {
    let bestI = 0, bestJ = 1, bestSep = 0;
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const sep = Math.min(
          Math.abs(remaining[j] - remaining[i]),
          6 - Math.abs(remaining[j] - remaining[i])
        );
        if (sep > bestSep) { bestI = i; bestJ = j; bestSep = sep; }
      }
    }
    pairs.push([remaining[bestI], remaining[bestJ]]);
    remaining.splice(bestJ, 1);
    remaining.splice(bestI, 1);
  }
  return { pairs, singles: remaining };
}

// ── Bezier sampling with normals ──
// Returns array of {x, y, nx, ny} evenly spaced along the smart bezier.
// nx,ny = unit normal (perpendicular to tangent). Used for cross-ties, lane markings.
export function sampleBezier(edgeA, edgeB, count) {
  const from = extendedEdgeMidpoint(edgeA);
  const to = extendedEdgeMidpoint(edgeB);
  const cp = computeControlPoint(edgeA, edgeB);
  const points = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    const x = u * u * from.x + 2 * u * t * cp.x + t * t * to.x;
    const y = u * u * from.y + 2 * u * t * cp.y + t * t * to.y;
    // Tangent: B'(t) = 2(1-t)(cp-from) + 2t(to-cp)
    const tx = 2 * u * (cp.x - from.x) + 2 * t * (to.x - cp.x);
    const ty = 2 * u * (cp.y - from.y) + 2 * t * (to.y - cp.y);
    const tLen = Math.sqrt(tx * tx + ty * ty);
    const nx = tLen > 0.01 ? -ty / tLen : 0;
    const ny = tLen > 0.01 ? tx / tLen : 0;
    points.push({ x, y, nx, ny });
  }
  return points;
}

// ── Junction fill ──
// For 3+ edges, draws a filled circle at center connecting all arm overlaps.
export function drawJunctionFill(ctx, edges, radius, color) {
  if (edges.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(CX, CY, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a smooth path from one edge to another using smart control point.
export function drawEdgeToEdgePath(ctx, entryEdge, exitEdge, lineWidth) {
  const from = extendedEdgeMidpoint(entryEdge);
  const to = extendedEdgeMidpoint(exitEdge);
  const cp = computeControlPoint(entryEdge, exitEdge);

  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(cp.x, cp.y, to.x, to.y);
  ctx.stroke();
}

// Draw a dead-end path from edge to center
export function drawEdgeToCenterPath(ctx, edgeIdx, lineWidth) {
  const from = extendedEdgeMidpoint(edgeIdx);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(CX, CY);
  ctx.stroke();
}

// Draw connected edge routes using smart pairing.
// For 2 edges: single smart curve. For 3+: paired curves + singles to center.
export function drawFeatureRoute(ctx, edges, lineWidth, strokeStyle) {
  if (edges.length === 0) return;
  ctx.strokeStyle = strokeStyle;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (edges.length === 1) {
    drawEdgeToCenterPath(ctx, edges[0], lineWidth);
    return;
  }

  const { pairs, singles } = pairEdges(edges);
  for (const [a, b] of pairs) {
    drawEdgeToEdgePath(ctx, a, b, lineWidth);
  }
  for (const s of singles) {
    drawEdgeToCenterPath(ctx, s, lineWidth);
  }
}

// Fill a hex-shaped area with a solid color (fills entire tile, use after clipToHex)
export function fillHex(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
}
