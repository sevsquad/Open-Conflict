// ════════════════════════════════════════════════════════════════
// RoadNetwork — BFS road preprocessing for line drawing (hex grid)
// ════════════════════════════════════════════════════════════════

import { getNeighbors } from "./HexMath.js";

const ROAD_TYPES = ["highway", "major_road", "road", "minor_road", "footpath", "trail"];
const RAIL_TYPES = ["railway", "light_rail"];
const WATER_TYPES = ["river"];
const PIPE_TYPES = ["pipeline"];

const LINEAR_TYPES = [...ROAD_TYPES, ...RAIL_TYPES, ...WATER_TYPES, ...PIPE_TYPES];

// Drawing config per type and tier
export const LINE_CONFIG = {
  highway:      { color: "#E6A817", width: [1.5, 2, 3, 4],   minTier: 0, dash: null },
  major_road:   { color: "#D4D4D4", width: [0, 1.5, 2, 3],    minTier: 1, dash: null },
  road:         { color: "#B0B0B0", width: [0, 0.5, 1.5, 2],  minTier: 1, dash: null },
  minor_road:   { color: "#9A9A8A", width: [0, 0, 1, 1],      minTier: 2, dash: [4, 3] },
  footpath:     { color: "#6A6A5A", width: [0, 0, 0, 0.5],    minTier: 3, dash: [2, 2] },
  trail:        { color: "#8A8A6A", width: [0, 0, 0, 0.5],    minTier: 3, dash: [2, 2] },
  railway:      { color: "#E05050", width: [1.0, 1.5, 1.5, 2], minTier: 0, dash: [6, 3] },
  light_rail:   { color: "#D07070", width: [0, 0.5, 1, 1.5],  minTier: 1, dash: [4, 3] },
  river: { color: "#3AC4E0", width: [1.0, 1.5, 2, 3], minTier: 0, dash: null },
  pipeline:  { color: "#A070D0", width: [0, 0.5, 1, 1.5], minTier: 1, dash: [4, 2] },
};

function getFeats(cell) {
  if (!cell) return [];
  if (cell.features && cell.features.length > 0) return cell.features;
  if (cell.attributes && cell.attributes.length > 0) return cell.attributes;
  return [];
}

// Build road/rail/waterway network segments by BFS (6-connected hex neighbors)
export function buildLinearNetworks(cells, cols, rows) {
  const networks = {}; // type → array of segments [{from: {c,r}, to: {c,r}}]

  for (const type of LINEAR_TYPES) {
    const segments = [];
    const visited = new Set();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[`${c},${r}`];
        if (!cell) continue;
        const feats = getFeats(cell);
        if (!feats.includes(type)) continue;
        const key = `${c},${r}`;
        if (visited.has(key)) continue;

        // BFS to find connected cells of this type
        const queue = [{ c, r }];
        visited.add(key);
        while (queue.length > 0) {
          const cur = queue.shift();
          // Check 6-connected hex neighbors
          for (const [nc, nr] of getNeighbors(cur.c, cur.r)) {
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            const nk = `${nc},${nr}`;
            if (visited.has(nk)) continue;
            const nCell = cells[nk];
            if (!nCell) continue;
            if (!getFeats(nCell).includes(type)) continue;
            visited.add(nk);
            segments.push({ from: { c: cur.c, r: cur.r }, to: { c: nc, r: nr } });
            queue.push({ c: nc, r: nr });
          }
        }
      }
    }
    if (segments.length > 0) {
      networks[type] = segments;
    }
  }
  return networks;
}

// Get all linear feature types
export function getLinearTypes() {
  return LINEAR_TYPES;
}
