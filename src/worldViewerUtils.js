// ════════════════════════════════════════════════════════════════
// World Viewer Utilities — global coordinate mapping
// Maps lat/lng to a global hex grid (equirectangular projection)
// so cells from all patches share one coordinate space.
// The existing vertex shader works unchanged with these global coords.
// ════════════════════════════════════════════════════════════════

import { TERRAIN_INDEX, FEATURE_BIT, INFRA_INDEX } from "./mapRenderer/gl/HexGPUData.js";
import { INSTANCE_FLOATS } from "./mapRenderer/gl/HexGeometry.js";

const SQRT3 = Math.sqrt(3);
const SQRT3_2 = SQRT3 / 2;
const KM_PER_DEG = 111.32;

/**
 * Convert lat/lng to global hex grid coordinates.
 * Integer-rounded so cells snap to a regular grid and the shader's
 * stagger logic (mod(row, 2)) works correctly.
 */
export function latLngToGlobalGrid(lat, lng, cellKm) {
  const degsPerCol = cellKm / KM_PER_DEG;
  const degsPerRow = (cellKm * SQRT3_2) / KM_PER_DEG;
  return {
    col: Math.round((lng + 180) / degsPerCol),
    row: Math.round((90 - lat) / degsPerRow),
  };
}

/**
 * Convert global grid coordinates back to lat/lng.
 */
export function globalGridToLatLng(col, row, cellKm) {
  const degsPerCol = cellKm / KM_PER_DEG;
  const degsPerRow = (cellKm * SQRT3_2) / KM_PER_DEG;
  return {
    lat: 90 - row * degsPerRow,
    lng: col * degsPerCol - 180,
  };
}

/**
 * Get global grid extent for a resolution.
 * Returns the total number of columns/rows that cover 360° lon × 180° lat.
 */
export function getGlobalGridExtent(cellKm) {
  const degsPerCol = cellKm / KM_PER_DEG;
  const degsPerRow = (cellKm * SQRT3_2) / KM_PER_DEG;
  return {
    maxCol: Math.ceil(360 / degsPerCol),
    maxRow: Math.ceil(180 / degsPerRow),
    degsPerCol,
    degsPerRow,
  };
}

/**
 * Build GPU instance data for world-scale rendering from decoded cells.
 * Each cell must have { terrain, elevation, features, infrastructure, lat, lng }.
 *
 * Uses globalCol/globalRow from lat/lng instead of local col/row.
 * Neighbor terrains are set to -1 (unknown across patch boundaries —
 * invisible at world zoom where cells are sub-pixel).
 *
 * Returns { instanceData: Float32Array, cellCount: number }
 */
export function buildWorldInstanceData(cells, cellKm) {
  const data = new Float32Array(cells.length * INSTANCE_FLOATS);
  const degsPerCol = cellKm / KM_PER_DEG;
  const degsPerRow = (cellKm * SQRT3_2) / KM_PER_DEG;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const off = i * INSTANCE_FLOATS;

    // Global col/row from lat/lng
    data[off + 0] = Math.round((c.lng + 180) / degsPerCol);
    data[off + 1] = Math.round((90 - c.lat) / degsPerRow);

    // Terrain index
    data[off + 2] = TERRAIN_INDEX[c.terrain] ?? -1;

    // Elevation
    data[off + 3] = c.elevation || 0;

    // Feature bitmask (combine features + legacy attributes)
    let mask = 0;
    const feats = c.features || [];
    const attrs = c.attributes || [];
    for (const f of feats) {
      if (FEATURE_BIT[f] !== undefined) mask |= FEATURE_BIT[f];
    }
    for (const a of attrs) {
      if (FEATURE_BIT[a] !== undefined) mask |= FEATURE_BIT[a];
    }
    data[off + 4] = mask;

    // Infrastructure index
    data[off + 5] = INFRA_INDEX[c.infrastructure] || 0;

    // Neighbor terrains: -1 (unknown across patches)
    data[off + 6] = -1;
    data[off + 7] = -1;
    data[off + 8] = -1;
    data[off + 9] = -1;
    data[off + 10] = -1;
    data[off + 11] = -1;
  }

  return { instanceData: data, cellCount: cells.length };
}
