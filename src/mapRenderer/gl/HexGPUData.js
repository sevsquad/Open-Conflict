// ════════════════════════════════════════════════════════════════
// HexGPUData — pack mapData.cells into typed arrays for GPU upload
// ════════════════════════════════════════════════════════════════

import { getNeighbors } from "../HexMath.js";
import { TC } from "../../terrainColors.js";
import { INSTANCE_FLOATS } from "./HexGeometry.js";

// Terrain type → index mapping (must match u_terrainColors order in shader)
const TERRAIN_TYPES = [
  "deep_water", "coastal_water", "lake", "river",
  "wetland", "open_ground", "light_veg", "grassland", "farmland",
  "forest", "dense_forest", "highland", "mountain_forest",
  "mountain", "peak", "desert", "ice",
  "light_urban", "dense_urban",
  "forested_hills",
  "jungle", "jungle_hills", "jungle_mountains",
  "boreal", "boreal_hills", "boreal_mountains",
  "tundra", "savanna", "savanna_hills", "mangrove",
  // Aggregated urban (indices 29-32)
  "suburban", "urban_commercial", "urban_industrial", "urban_dense_core",
  // Fine-grained: Buildings (indices 33-42)
  "bldg_light", "bldg_residential", "bldg_commercial", "bldg_highrise",
  "bldg_institutional", "bldg_religious", "bldg_industrial", "bldg_fortified",
  "bldg_ruins", "bldg_station",
  // Fine-grained: Roads & Rail (indices 43-49)
  "motorway", "arterial", "street", "alley",
  "road_footpath", "rail_track", "tram_track",
  // Fine-grained: Open Paved (indices 50-52)
  "plaza", "surface_parking", "rail_yard",
  // Fine-grained: Open Green (indices 53-57)
  "park", "sports_field", "cemetery", "urban_trees", "allotment",
  // Fine-grained: Urban Water (indices 58-59)
  "canal", "dock",
  // Fine-grained: Other (indices 60-64)
  "bare_ground", "bridge_deck", "ground_embankment", "underpass", "construction_site",
];

const TERRAIN_INDEX = {};
TERRAIN_TYPES.forEach((t, i) => { TERRAIN_INDEX[t] = i; });

// Feature type → bit index mapping (up to 32 features in a uint32 bitmask)
const FEATURE_TYPES = [
  "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail",
  "dam", "river", "tunnel",
  "port", "airfield", "helipad", "pipeline",
  "power_plant",
  "military_base",
  "beach", "town",
  "building", "parking", "tower", "wall", "fence",
  "cliffs", "ridgeline", "treeline",
  "slope_steep", "slope_extreme",
  "building_dense",
  "courtyard", "metro_entrance",  // indices 30-31 (maxes out uint32 bitmask)
];

const FEATURE_BIT = {};
FEATURE_TYPES.forEach((f, i) => { FEATURE_BIT[f] = 1 << i; });

// Infrastructure type → index (for line rendering)
const INFRA_TYPES = [
  "none", "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail",
];
const INFRA_INDEX = {};
INFRA_TYPES.forEach((t, i) => { INFRA_INDEX[t] = i; });

// Terrain colors as flat Float32Array [r,g,b, r,g,b, ...] normalized 0–1
export function buildTerrainColorArray() {
  const arr = new Float32Array(TERRAIN_TYPES.length * 3);
  for (let i = 0; i < TERRAIN_TYPES.length; i++) {
    const hex = TC[TERRAIN_TYPES[i]] || "#222222";
    const h = hex.replace("#", "");
    arr[i * 3 + 0] = parseInt(h.substring(0, 2), 16) / 255;
    arr[i * 3 + 1] = parseInt(h.substring(2, 4), 16) / 255;
    arr[i * 3 + 2] = parseInt(h.substring(4, 6), 16) / 255;
  }
  return arr;
}

function getFeats(cell) {
  if (!cell) return [];
  const f = cell.features;
  const a = cell.attributes;
  if (f && f.length > 0) return a && a.length > 0 ? [...f, ...a] : f;
  if (a && a.length > 0) return a;
  return [];
}

// Water terrain types — these get skipped during elevation smoothing
// so lakes/rivers keep their original elevation and don't bleed into land
const WATER_TERRAINS = new Set(["deep_water", "coastal_water", "lake", "river"]);

// Smooth elevation data with neighbor-weighted averaging (2 passes).
// Produces coherent elevation gradients so contour lines form clean bands
// instead of spaghetti from per-cell DEM noise.
// Returns a Map<key, smoothedElev> — does NOT mutate cells.
function smoothElevations(cells, cols, rows) {
  // Build initial elevation map
  let current = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      current.set(key, cell ? (cell.elevation || 0) : 0);
    }
  }

  // 2 passes of neighbor averaging: smoothed = 0.5 * self + 0.5 * mean(neighbors)
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${c},${r}`;
        const cell = cells[key];

        // Skip water cells — keep their original elevation
        if (cell && WATER_TERRAINS.has(cell.terrain)) {
          next.set(key, current.get(key));
          continue;
        }

        const selfElev = current.get(key);
        const neighbors = getNeighbors(c, r);
        let sum = 0, count = 0;
        for (const [nc, nr] of neighbors) {
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
            const nKey = `${nc},${nr}`;
            const nCell = cells[nKey];
            // Don't pull elevation from water neighbors into land cells
            if (nCell && WATER_TERRAINS.has(nCell.terrain)) continue;
            sum += current.get(nKey);
            count++;
          }
        }
        if (count > 0) {
          next.set(key, selfElev * 0.5 + (sum / count) * 0.5);
        } else {
          next.set(key, selfElev);
        }
      }
    }
    current = next;
  }

  return current;
}

// Tile size for viewport culling — hexes per tile edge.
// Each tile is a TILE_SIZE × TILE_SIZE rectangular block of hexes.
export const TILE_SIZE = 16;

// Pack instance data for a single hex into the Float32Array at the given offset.
// Reads neighbor data from the full grid (neighbors can be outside the tile).
function packHexInstance(data, offset, c, r, cells, cols, rows, smoothedElev) {
  const key = `${c},${r}`;
  const cell = cells[key];

  // col, row
  data[offset + 0] = c;
  data[offset + 1] = r;

  // terrainIndex
  data[offset + 2] = cell ? (TERRAIN_INDEX[cell.terrain] ?? -1) : -1;

  // elevation — use smoothed value for clean contour rendering
  data[offset + 3] = smoothedElev.get(key) ?? 0;

  // featureMask
  let mask = 0;
  if (cell) {
    for (const f of getFeats(cell)) {
      if (FEATURE_BIT[f] !== undefined) mask |= FEATURE_BIT[f];
    }
  }
  data[offset + 4] = mask;

  // infraIndex
  data[offset + 5] = cell ? (INFRA_INDEX[cell.infrastructure] || 0) : 0;

  // neighborTerrains[6] at offsets 6-11
  const neighbors = getNeighbors(c, r);
  for (let i = 0; i < 6; i++) {
    const [nc, nr] = neighbors[i];
    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
      const nCell = cells[`${nc},${nr}`];
      data[offset + 6 + i] = nCell ? (TERRAIN_INDEX[nCell.terrain] ?? -1) : -1;
    } else {
      data[offset + 6 + i] = -1;
    }
  }

  // neighborElevations[6] at offsets 12-17
  for (let i = 0; i < 6; i++) {
    const [nc, nr] = neighbors[i];
    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
      data[offset + 12 + i] = smoothedElev.get(`${nc},${nr}`) ?? -10000;
    } else {
      data[offset + 12 + i] = -10000;
    }
  }
}

// Build instance data for a rectangular tile of hexes.
// colMin/rowMin inclusive, colMax/rowMax exclusive.
// Neighbor lookups reference the full grid (cells, cols, rows).
export function buildTileInstanceData(cells, cols, rows, smoothedElev, colMin, colMax, rowMin, rowMax) {
  const tileCols = colMax - colMin;
  const tileRows = rowMax - rowMin;
  const cellCount = tileCols * tileRows;
  const data = new Float32Array(cellCount * INSTANCE_FLOATS);

  let offset = 0;
  for (let r = rowMin; r < rowMax; r++) {
    for (let c = colMin; c < colMax; c++) {
      packHexInstance(data, offset, c, r, cells, cols, rows, smoothedElev);
      offset += INSTANCE_FLOATS;
    }
  }

  return { instanceData: data, cellCount };
}

// Build the full instance Float32Array from mapData (legacy single-buffer path).
// Returns { instanceData: Float32Array, cellCount: number, smoothedElevMap: Map }
export function buildInstanceData(mapData) {
  const { cols, rows, cells } = mapData;
  const smoothedElev = smoothElevations(cells, cols, rows);
  const { instanceData, cellCount } = buildTileInstanceData(
    cells, cols, rows, smoothedElev, 0, cols, 0, rows
  );
  return { instanceData, cellCount, smoothedElevMap: smoothedElev };
}

// Build all tiles for the grid. Returns { tiles, smoothedElevMap }.
// Each tile: { instanceData, cellCount, colMin, colMax, rowMin, rowMax }
export function buildAllTiles(mapData) {
  const { cols, rows, cells } = mapData;
  const smoothedElev = smoothElevations(cells, cols, rows);
  const tiles = [];

  for (let tileRow = 0; tileRow * TILE_SIZE < rows; tileRow++) {
    for (let tileCol = 0; tileCol * TILE_SIZE < cols; tileCol++) {
      const colMin = tileCol * TILE_SIZE;
      const colMax = Math.min(colMin + TILE_SIZE, cols);
      const rowMin = tileRow * TILE_SIZE;
      const rowMax = Math.min(rowMin + TILE_SIZE, rows);

      const { instanceData, cellCount } = buildTileInstanceData(
        cells, cols, rows, smoothedElev, colMin, colMax, rowMin, rowMax
      );

      tiles.push({ instanceData, cellCount, colMin, colMax, rowMin, rowMax });
    }
  }

  return { tiles, smoothedElevMap: smoothedElev };
}

// Build a feature bitmask from a Set of active feature names
export function buildFeatureBitmask(activeFeatureSet) {
  let mask = 0;
  if (!activeFeatureSet) return 0xFFFFFFFF; // all features active
  for (const f of activeFeatureSet) {
    if (FEATURE_BIT[f] !== undefined) mask |= FEATURE_BIT[f];
  }
  return mask;
}

// Scan mapData cells for min/max elevation
export function computeElevationRange(mapData) {
  let min = Infinity, max = -Infinity;
  for (const key in mapData.cells) {
    const elev = mapData.cells[key]?.elevation;
    if (elev == null) continue;
    if (elev < min) min = elev;
    if (elev > max) max = elev;
  }
  if (min === Infinity) return { min: 0, max: 1000 };
  return { min, max };
}

// Build instance data for strategic hexes.
// Same 18-float layout as fine hexes, but:
//   - col/row are strategic grid coordinates
//   - terrainIndex is the dominant terrain (used for neighbor blending)
//   - elevation is the mean elevation
//   - infraIndex is REPURPOSED as the atlas tile index
//   - neighbor data comes from adjacent strategic hexes
// Returns { instanceData: Float32Array, cellCount: number }
export function buildStrategicInstanceData(strategicGrid, tileIndexMap) {
  const { cols, rows, cells } = strategicGrid;
  const cellCount = Object.keys(cells).length;
  const data = new Float32Array(cellCount * INSTANCE_FLOATS);

  let offset = 0;
  // Iterate in row-major order matching tileIndexMap ordering
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];
      if (!cell) continue;

      // col, row
      data[offset + 0] = c;
      data[offset + 1] = r;

      // terrainIndex — dominant terrain for neighbor blending
      data[offset + 2] = TERRAIN_INDEX[cell.terrain] ?? -1;

      // elevation — mean
      data[offset + 3] = cell.elevation || 0;

      // featureMask — aggregated features
      let mask = 0;
      if (cell.features) {
        for (const f of cell.features) {
          if (FEATURE_BIT[f] !== undefined) mask |= FEATURE_BIT[f];
        }
      }
      data[offset + 4] = mask;

      // infraIndex REPURPOSED as atlas tile index
      const tileIdx = tileIndexMap.get(key);
      data[offset + 5] = tileIdx !== undefined ? tileIdx : 0;

      // Neighbor terrains and elevations (from strategic grid neighbors)
      const neighbors = getNeighbors(c, r);
      for (let i = 0; i < 6; i++) {
        const [nc, nr] = neighbors[i];
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nCell = cells[`${nc},${nr}`];
          data[offset + 6 + i] = nCell ? (TERRAIN_INDEX[nCell.terrain] ?? -1) : -1;
        } else {
          data[offset + 6 + i] = -1;
        }
      }
      for (let i = 0; i < 6; i++) {
        const [nc, nr] = neighbors[i];
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nCell = cells[`${nc},${nr}`];
          data[offset + 12 + i] = nCell ? (nCell.elevation || 0) : -10000;
        } else {
          data[offset + 12 + i] = -10000;
        }
      }

      offset += INSTANCE_FLOATS;
    }
  }

  return { instanceData: new Float32Array(data.buffer, 0, offset), cellCount: offset / INSTANCE_FLOATS };
}

export { TERRAIN_TYPES, TERRAIN_INDEX, FEATURE_TYPES, FEATURE_BIT, INFRA_TYPES, INFRA_INDEX };
