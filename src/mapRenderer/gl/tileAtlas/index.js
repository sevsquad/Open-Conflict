// ════════════════════════════════════════════════════════════════
// TileAtlas — generate illustrated hex tile atlas from map data
//
// Flow:
//   1. Compute per-hex edge connectivity from linearPaths
//   2. Compute tile signatures (terrain + feature edges)
//   3. For each unique signature, draw the tile (terrain + features)
//   4. Pack into atlas canvas
//   5. Return { canvas, tileIndexMap, atlasInfo }
// ════════════════════════════════════════════════════════════════

import { TILE_PX, CX, CY, hexPath, clipToHex, dirToEdge, findNeighborDir } from "./hexUtils.js";
import { TERRAIN_DRAWERS } from "./terrainDrawers.js";
import { drawAllFeatures, extractStaticFeatures, drawStaticFeatures } from "./featureDrawers.js";

// Terrain types that count as open ocean (delta fans toward these)
const OCEAN_TERRAIN = new Set(["deep_water", "coastal_water"]);

// Wetland-like terrains where river deltas form when adjacent to ocean
const DELTA_TERRAIN = new Set(["wetland", "mangrove"]);

// Odd-r offset neighbor coordinates by direction index (0=E,1=NE,2=NW,3=W,4=SW,5=SE)
// Must match findNeighborDir's corrected table selection (even→ODD_R_ODD, odd→ODD_R_EVEN)
const NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const NB_ODD  = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
function neighborCoord(c, r, dir) {
  const nb = (r & 1) === 0 ? NB_EVEN : NB_ODD;
  return [c + nb[dir][0], r + nb[dir][1]];
}

// Padding around each tile to prevent texture bleeding
const PAD = 1;
const STRIDE = TILE_PX + PAD * 2;

// Classify linearPath types into drawing categories
const FEATURE_CATEGORY = {
  highway: "highway",
  major_road: "major_road",
  road: "road",
  minor_road: "minor_road",
  footpath: "footpath",
  trail: "trail",
  railway: "rail",
  light_rail: "light_rail",
  river: "river",
};

// ── Step 1: Compute per-hex edge connectivity ──
// Walks linearPaths to determine which geometry edges each hex
// connects for each feature type.
// Returns Map<hexKey, { river: Set<geoEdge>, highway: Set<geoEdge>, ... }>
function computeEdgeConnectivity(mapData) {
  const connectivity = new Map();
  const paths = mapData.linearPaths;
  if (!paths || paths.length === 0) return connectivity;

  for (const path of paths) {
    const category = FEATURE_CATEGORY[path.type];
    if (!category) continue;

    const cells = path.cells;
    if (!cells || cells.length < 2) continue;

    for (let i = 0; i < cells.length - 1; i++) {
      const [c1, r1] = cells[i];
      const [c2, r2] = cells[i + 1];
      if (c1 === c2 && r1 === r2) continue;

      // Find neighbor direction from hex 1 to hex 2
      const dir1to2 = findNeighborDir(c1, r1, c2, r2);
      const dir2to1 = findNeighborDir(c2, r2, c1, r1);

      if (dir1to2 !== -1) {
        const key = `${c1},${r1}`;
        if (!connectivity.has(key)) connectivity.set(key, {});
        const conn = connectivity.get(key);
        if (!conn[category]) conn[category] = new Set();
        conn[category].add(dirToEdge(dir1to2));
      }

      if (dir2to1 !== -1) {
        const key = `${c2},${r2}`;
        if (!connectivity.has(key)) connectivity.set(key, {});
        const conn = connectivity.get(key);
        if (!conn[category]) conn[category] = new Set();
        conn[category].add(dirToEdge(dir2to1));
      }
    }
  }

  return connectivity;
}

// ── Step 2: Compute tile signature ──
// Two hexes with the same signature look identical and can share a tile.
// staticFeatures: sorted array of feature names (or null).
function tileSignature(terrain, featureEdges, staticFeatures) {
  let sig = terrain || "open_ground";
  if (featureEdges) {
    // Sort categories for deterministic signatures
    const cats = Object.keys(featureEdges).sort();
    for (const cat of cats) {
      const edges = featureEdges[cat];
      if (edges && edges.size > 0) {
        // Convert edge set to sorted bitmask
        let mask = 0;
        for (const e of edges) mask |= (1 << e);
        sig += `|${cat}:${mask}`;
      }
    }
  }
  // Append static feature names (already sorted by extractStaticFeatures)
  if (staticFeatures) {
    sig += `|sf:${staticFeatures.join(",")}`;
  }
  return sig;
}

// ── Step 3: Draw a single tile ──
function drawTile(canvas, ctx, terrain, featureEdges, staticFeatures) {
  // Clear tile
  ctx.clearRect(0, 0, TILE_PX, TILE_PX);

  ctx.save();
  clipToHex(ctx);

  // Draw terrain base
  const drawer = TERRAIN_DRAWERS[terrain];
  if (drawer) {
    drawer(ctx);
  } else {
    // Fallback: solid color
    ctx.fillStyle = "#555555";
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  }

  // Draw linear feature overlays (rivers, roads, rails, bridges)
  drawAllFeatures(ctx, featureEdges);

  // Draw static feature overlays (icons, terrain modifiers)
  drawStaticFeatures(ctx, staticFeatures, featureEdges);

  ctx.restore();
}

// ── Main: Generate tile atlas ──
// Returns { canvas, tileIndexMap, atlasInfo } or null if no mapData.
export function generateTileAtlas(mapData) {
  if (!mapData || !mapData.cells) return null;

  const { cols, rows, cells } = mapData;

  // Step 1: edge connectivity
  const connectivity = computeEdgeConnectivity(mapData);

  // Step 2: compute signatures and group hexes
  const sigToTileIdx = new Map();  // signature → tile index in atlas
  const tileSpecs = [];            // { terrain, featureEdges, staticFeatures } per unique tile
  const hexToTileIdx = new Map();  // hexKey → tile index

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      const terrain = cell ? cell.terrain : null;
      const featureEdges = connectivity.get(key) || null;
      let staticFeatures = cell ? extractStaticFeatures(cell.features) : null;

      // Detect river delta: wetland-like tile with a river that borders ocean.
      // Find all neighbor edges facing ocean tiles and fan small channels to them.
      if (DELTA_TERRAIN.has(terrain) && featureEdges && featureEdges.river) {
        const oceanEdges = [];
        // Check all 6 neighbors for ocean terrain
        for (let dir = 0; dir < 6; dir++) {
          const [nc, nr] = neighborCoord(c, r, dir);
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const nCell = cells[`${nc},${nr}`];
          if (nCell && OCEAN_TERRAIN.has(nCell.terrain)) {
            oceanEdges.push(dirToEdge(dir));
          }
        }
        if (oceanEdges.length > 0) {
          const tag = `river_delta:${oceanEdges.join(",")}`;
          staticFeatures = staticFeatures ? [...staticFeatures, tag] : [tag];
        }
      }

      const sig = tileSignature(terrain, featureEdges, staticFeatures);

      if (!sigToTileIdx.has(sig)) {
        const idx = tileSpecs.length;
        sigToTileIdx.set(sig, idx);
        tileSpecs.push({ terrain: terrain || "open_ground", featureEdges, staticFeatures });
      }

      hexToTileIdx.set(key, sigToTileIdx.get(sig));
    }
  }

  const tileCount = tileSpecs.length;
  console.log(`[TileAtlas] ${tileCount} unique tiles for ${cols}x${rows} map`);

  // Step 3: allocate atlas
  const atlasGridCols = Math.ceil(Math.sqrt(tileCount));
  const atlasGridRows = Math.ceil(tileCount / atlasGridCols);
  const atlasW = atlasGridCols * STRIDE;
  const atlasH = atlasGridRows * STRIDE;

  if (atlasW > 4096 || atlasH > 4096) {
    console.warn(`[TileAtlas] Atlas ${atlasW}x${atlasH} exceeds 4096 limit. Some tiles may be missing.`);
  }

  // Create atlas canvas
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = atlasW;
  atlasCanvas.height = atlasH;
  const atlasCtx = atlasCanvas.getContext("2d");
  atlasCtx.clearRect(0, 0, atlasW, atlasH);

  // Create per-tile scratch canvas (reused for each tile)
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = TILE_PX;
  tileCanvas.height = TILE_PX;
  const tileCtx = tileCanvas.getContext("2d");

  // Step 4: draw each unique tile and place in atlas
  for (let i = 0; i < tileCount; i++) {
    const { terrain, featureEdges, staticFeatures } = tileSpecs[i];

    // Draw tile to scratch canvas
    drawTile(tileCanvas, tileCtx, terrain, featureEdges, staticFeatures);

    // Position in atlas
    const col = i % atlasGridCols;
    const row = Math.floor(i / atlasGridCols);
    const tileX = col * STRIDE + PAD;
    const tileY = row * STRIDE + PAD;

    // Copy to atlas
    atlasCtx.drawImage(tileCanvas, tileX, tileY);

    // Edge extrusion (prevents texture bleeding at tile boundaries)
    // Top edge
    atlasCtx.drawImage(atlasCanvas, tileX, tileY, TILE_PX, 1, tileX, tileY - PAD, TILE_PX, PAD);
    // Bottom edge
    atlasCtx.drawImage(atlasCanvas, tileX, tileY + TILE_PX - 1, TILE_PX, 1, tileX, tileY + TILE_PX, TILE_PX, PAD);
    // Left edge
    atlasCtx.drawImage(atlasCanvas, tileX, tileY - PAD, 1, TILE_PX + PAD * 2, tileX - PAD, tileY - PAD, PAD, TILE_PX + PAD * 2);
    // Right edge
    atlasCtx.drawImage(atlasCanvas, tileX + TILE_PX - 1, tileY - PAD, 1, TILE_PX + PAD * 2, tileX + TILE_PX, tileY - PAD, PAD, TILE_PX + PAD * 2);
  }

  return {
    canvas: atlasCanvas,
    tileIndexMap: hexToTileIdx,
    atlasInfo: {
      atlasGridCols,
      atlasSize: { w: atlasW, h: atlasH },
      tileSize: TILE_PX,
      tileStride: STRIDE,
    },
  };
}
