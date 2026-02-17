// ════════════════════════════════════════════════════════════════
// HexGPUData — pack mapData.cells into typed arrays for GPU upload
// ════════════════════════════════════════════════════════════════

import { getNeighbors } from "../HexMath.js";
import { TC } from "../../terrainColors.js";
import { INSTANCE_FLOATS } from "./HexGeometry.js";

// Terrain type → index mapping (must match u_terrainColors order in shader)
const TERRAIN_TYPES = [
  "deep_water", "coastal_water", "lake", "river",
  "wetland", "open_ground", "light_veg", "farmland",
  "forest", "dense_forest", "highland", "mountain_forest",
  "mountain", "peak", "desert", "ice",
  "light_urban", "dense_urban",
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
  "chokepoint", "landing_zone", "beach", "town",
  "building", "parking", "tower", "wall", "fence",
  "cliffs", "ridgeline", "treeline",
  "slope_steep", "slope_extreme",
  "building_dense",
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

// Build the instance Float32Array from mapData
// Returns { instanceData: Float32Array, cellCount: number }
export function buildInstanceData(mapData) {
  const { cols, rows, cells } = mapData;
  const cellCount = cols * rows;
  const data = new Float32Array(cellCount * INSTANCE_FLOATS);

  let offset = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      const cell = cells[key];

      // col, row
      data[offset + 0] = c;
      data[offset + 1] = r;

      // terrainIndex
      const terrainIdx = cell ? (TERRAIN_INDEX[cell.terrain] ?? -1) : -1;
      data[offset + 2] = terrainIdx;

      // elevation
      data[offset + 3] = cell ? (cell.elevation || 0) : 0;

      // featureMask
      let mask = 0;
      if (cell) {
        for (const f of getFeats(cell)) {
          if (FEATURE_BIT[f] !== undefined) mask |= FEATURE_BIT[f];
        }
      }
      // Store as float (safe for up to 2^24 integer precision in float32)
      data[offset + 4] = mask;

      // infraIndex
      const infra = cell ? (INFRA_INDEX[cell.infrastructure] || 0) : 0;
      data[offset + 5] = infra;

      // neighborTerrains[6]
      const neighbors = getNeighbors(c, r);
      for (let i = 0; i < 6; i++) {
        const [nc, nr] = neighbors[i];
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nCell = cells[`${nc},${nr}`];
          data[offset + 6 + i] = nCell ? (TERRAIN_INDEX[nCell.terrain] ?? -1) : -1;
        } else {
          data[offset + 6 + i] = -1; // out of bounds
        }
      }

      offset += INSTANCE_FLOATS;
    }
  }

  return { instanceData: data, cellCount };
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

export { TERRAIN_TYPES, TERRAIN_INDEX, FEATURE_TYPES, FEATURE_BIT, INFRA_TYPES, INFRA_INDEX };
