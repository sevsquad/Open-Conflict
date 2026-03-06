// ════════════════════════════════════════════════════════════════
// StrategicGrid — derive a coarser hex grid from fine hex data.
// Each strategic hex covers a region of fine hexes determined by
// center-point containment. The two grids are independent hex
// grids at different scales — they don't tile perfectly, but
// center-point containment gives a Voronoi-like partition that
// works for game purposes.
// ════════════════════════════════════════════════════════════════

import { offsetToPixel, pixelToOffset } from "./HexMath.js";

// Terrain categories for majority-vote aggregation.
// Water terrains are tracked separately — a strategic hex is "water"
// only if > 50% of its fine hexes are water.
const WATER_TERRAINS = new Set([
  "deep_water", "coastal_water", "lake", "river",
]);

/**
 * Build a strategic grid from fine hex map data.
 *
 * Algorithm:
 * 1. Compute fine and strategic hex sizes (outer radius) from their km scales.
 *    Both grids use pointy-top odd-r offset coordinates.
 * 2. For each fine hex, convert its center to pixel coords, then convert those
 *    pixels to strategic grid offset coords. This assigns each fine hex to
 *    exactly one strategic hex (center-point containment).
 * 3. Aggregate terrain, elevation, and features per strategic hex.
 *
 * @param {Object} mapData - { cols, rows, cells, cellSizeKm, ... }
 * @param {number} strategicCellSizeKm - desired km per strategic hex (e.g., 10)
 * @returns {Object} { cols, rows, cellSizeKm, fineToStrategic, strategicToFine, cells }
 */
export function buildStrategicGrid(mapData, strategicCellSizeKm, padding = null) {
  const { cols: fineCols, rows: fineRows, cells: fineCells, cellSizeKm: fineSizeKm } = mapData;

  if (!fineSizeKm || fineSizeKm <= 0) {
    throw new Error("mapData.cellSizeKm is required for strategic grid derivation");
  }
  if (strategicCellSizeKm <= fineSizeKm) {
    throw new Error(`Strategic hex size (${strategicCellSizeKm}km) must be larger than fine hex size (${fineSizeKm}km)`);
  }

  // Hex outer radius in arbitrary pixel units.
  // We use 1 unit = 1 km so the pixel coords map directly to km.
  const fineSize = fineSizeKm;
  const strategicSize = strategicCellSizeKm;

  // Map every fine hex to its containing strategic hex.
  // When padding is provided, only INNER (non-padding) fine hexes determine
  // the strategic grid bounds. Padding fine hexes still contribute data to
  // edge strategic hexes but don't expand the display grid dimensions.
  const fineToStrategic = new Map();   // "fineCol,fineRow" → "stratCol,stratRow"
  const strategicToFine = new Map();   // "stratCol,stratRow" → ["fineCol,fineRow", ...]

  let stratColMin = Infinity, stratColMax = -Infinity;
  let stratRowMin = Infinity, stratRowMax = -Infinity;

  // Inner (display area) fine hex range — padding excluded from bounds calc
  const innerC0 = padding ? padding.cols : 0;
  const innerR0 = padding ? padding.rows : 0;
  const innerC1 = padding ? fineCols - padding.cols : fineCols;
  const innerR1 = padding ? fineRows - padding.rows : fineRows;

  for (let r = 0; r < fineRows; r++) {
    for (let c = 0; c < fineCols; c++) {
      const fineKey = `${c},${r}`;
      if (!fineCells[fineKey]) continue;

      // Fine hex center in pixel/km space
      const { x, y } = offsetToPixel(c, r, fineSize);

      // Which strategic hex contains this point?
      const { col: sc, row: sr } = pixelToOffset(x, y, strategicSize);

      const stratKey = `${sc},${sr}`;
      fineToStrategic.set(fineKey, stratKey);

      if (!strategicToFine.has(stratKey)) {
        strategicToFine.set(stratKey, []);
      }
      strategicToFine.get(stratKey).push(fineKey);

      // Only inner fine hexes set the strategic grid bounds
      if (c >= innerC0 && c < innerC1 && r >= innerR0 && r < innerR1) {
        if (sc < stratColMin) stratColMin = sc;
        if (sc > stratColMax) stratColMax = sc;
        if (sr < stratRowMin) stratRowMin = sr;
        if (sr > stratRowMax) stratRowMax = sr;
      }
    }
  }

  // Normalize strategic coords to start at (0,0) so the grid is compact
  const colOffset = stratColMin;
  const rowOffset = stratRowMin;
  const stratCols = stratColMax - stratColMin + 1;
  const stratRows = stratRowMax - stratRowMin + 1;

  // Rebuild maps with normalized coords, clipping to display bounds.
  // Padding fine hexes that map to strategic hexes outside the display
  // bounds are excluded — they served only to fill edge hex data.
  const normalizedFineToStrategic = new Map();
  const normalizedStrategicToFine = new Map();

  for (const [fineKey, stratKey] of fineToStrategic) {
    const [sc, sr] = stratKey.split(",").map(Number);
    if (sc < stratColMin || sc > stratColMax || sr < stratRowMin || sr > stratRowMax) continue;
    const normKey = `${sc - colOffset},${sr - rowOffset}`;
    normalizedFineToStrategic.set(fineKey, normKey);

    if (!normalizedStrategicToFine.has(normKey)) {
      normalizedStrategicToFine.set(normKey, []);
    }
    normalizedStrategicToFine.get(normKey).push(fineKey);
  }

  // Build strategic cells with aggregated data
  const strategicCells = {};

  for (const [stratKey, fineKeys] of normalizedStrategicToFine) {
    strategicCells[stratKey] = aggregateStrategicCell(fineCells, fineKeys);
  }

  // Warn if the map is too small for meaningful strategic overlay
  const hexCount = Object.keys(strategicCells).length;
  if (hexCount < 4) {
    console.warn(
      `Strategic grid has only ${hexCount} hexes — map may be too small ` +
      `for meaningful strategic overlay at ${strategicCellSizeKm}km scale`
    );
  }

  return {
    cols: stratCols,
    rows: stratRows,
    cellSizeKm: strategicCellSizeKm,
    fineCellSizeKm: fineSizeKm,
    fineToStrategic: normalizedFineToStrategic,
    strategicToFine: normalizedStrategicToFine,
    cells: strategicCells,
    // Store the normalization offsets so we can convert back to pixel coords
    _colOffset: colOffset,
    _rowOffset: rowOffset,
  };
}

/**
 * Aggregate fine hex data into a single strategic cell.
 * Computes dominant terrain, composition percentages, elevation stats,
 * and aggregated features.
 */
// Terrain types that count as "building" for urban composition
const BUILDING_TERRAINS = new Set([
  "bldg_light", "bldg_residential", "bldg_commercial", "bldg_highrise",
  "bldg_institutional", "bldg_religious", "bldg_industrial", "bldg_fortified",
  "bldg_ruins", "bldg_station",
]);
// Terrain types that count as "road/paved" for urban composition
const ROAD_TERRAINS = new Set([
  "motorway", "arterial", "street", "alley", "road_footpath",
  "rail_track", "tram_track", "plaza", "surface_parking", "rail_yard",
]);
// Terrain types that count as "open green" for urban composition
const GREEN_TERRAINS = new Set([
  "park", "sports_field", "cemetery", "urban_trees", "allotment",
]);
// All fine-grained urban terrain types (for urban fraction calculation)
const URBAN_FINE_TERRAINS = new Set([
  ...BUILDING_TERRAINS, ...ROAD_TERRAINS, ...GREEN_TERRAINS,
  "canal", "dock", "bare_ground", "bridge_deck", "ground_embankment",
  "underpass", "construction_site",
  // Aggregated urban types also count
  "suburban", "urban_commercial", "urban_industrial", "urban_dense_core",
  "light_urban", "dense_urban",
]);

// Classify FM 90-10 urban pattern from composition ratios.
// Returns { pattern: "A"-"E", urbanTerrain: aggregated terrain type }
function classifyUrbanPattern(buildingCoverage, roadCoverage, narrowRoadFrac, avgHeight) {
  // Type A: Dense Random — high building coverage, narrow streets, low height
  // Type B: Closed-Orderly Block — moderate building + wide roads, medium height
  // Type C: Dispersed Residential — low building coverage, wide roads
  // Type D: High-Rise — moderate coverage but tall buildings
  // Type E: Industrial/Transport — low coverage, wide open spaces, rail/industrial

  if (avgHeight > 25 && buildingCoverage > 0.15) {
    return { pattern: "D", urbanTerrain: "urban_commercial" }; // tall towers
  }
  if (buildingCoverage > 0.55 && narrowRoadFrac > 0.5) {
    return { pattern: "A", urbanTerrain: "urban_dense_core" }; // dense + narrow
  }
  if (buildingCoverage > 0.30) {
    return { pattern: "B", urbanTerrain: "urban_commercial" }; // moderate density, orderly
  }
  if (buildingCoverage > 0.15) {
    return { pattern: "C", urbanTerrain: "suburban" }; // dispersed
  }
  // Low building coverage — industrial/transport if roads dominate
  if (roadCoverage > 0.3) {
    return { pattern: "E", urbanTerrain: "urban_industrial" };
  }
  return { pattern: "C", urbanTerrain: "suburban" };
}

function aggregateStrategicCell(fineCells, fineKeys) {
  const terrainCounts = {};
  let elevMin = Infinity, elevMax = -Infinity, elevSum = 0;
  const featureSet = new Set();
  const infraSet = new Set();
  let totalCells = 0;
  // Urban composition accumulators
  let buildingCount = 0, roadCount = 0, greenCount = 0, urbanCount = 0;
  let narrowRoadCount = 0; // alley + road_footpath (for FM 90-10 Type A detection)
  let heightSum = 0, heightCount = 0;

  for (const fineKey of fineKeys) {
    const cell = fineCells[fineKey];
    if (!cell) continue;
    totalCells++;

    // Terrain vote
    const t = cell.terrain || "open_ground";
    terrainCounts[t] = (terrainCounts[t] || 0) + 1;

    // Urban composition tracking
    if (BUILDING_TERRAINS.has(t)) buildingCount++;
    if (ROAD_TERRAINS.has(t)) roadCount++;
    if (GREEN_TERRAINS.has(t)) greenCount++;
    if (URBAN_FINE_TERRAINS.has(t)) urbanCount++;
    if (t === "alley" || t === "road_footpath") narrowRoadCount++;
    // Building height from cell metadata
    if (cell.buildingHeight) { heightSum += cell.buildingHeight; heightCount++; }

    // Elevation
    const elev = cell.elevation ?? 0;
    if (elev < elevMin) elevMin = elev;
    if (elev > elevMax) elevMax = elev;
    elevSum += elev;

    // Features and attributes
    if (cell.features) {
      for (const f of cell.features) featureSet.add(f);
    }
    if (cell.attributes) {
      for (const a of cell.attributes) featureSet.add(a);
    }
    if (cell.infrastructure) infraSet.add(cell.infrastructure);
  }

  if (totalCells === 0) {
    return {
      terrain: "open_ground",
      terrainComposition: {},
      elevation: 0,
      elevationRange: { min: 0, max: 0, mean: 0 },
      features: [],
      infrastructure: "",
      fineHexCount: 0,
    };
  }

  // Dominant terrain: simple majority vote
  let dominantTerrain = "open_ground";
  let maxCount = 0;
  for (const [terrain, count] of Object.entries(terrainCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantTerrain = terrain;
    }
  }

  // Terrain composition as fractions
  const terrainComposition = {};
  for (const [terrain, count] of Object.entries(terrainCounts)) {
    terrainComposition[terrain] = count / totalCells;
  }

  // Mean elevation
  const elevMean = elevSum / totalCells;

  // Keep significant features (roads, rivers, military, etc.)
  // Remove micro-features that don't make sense at strategic scale
  const significantFeatures = [...featureSet].filter(f =>
    !["beach", "parking", "fence", "wall"].includes(f)
  );

  // Pick the highest-tier infrastructure
  const infraPriority = ["highway", "major_road", "road", "minor_road", "railway", "light_rail", "footpath", "trail"];
  let bestInfra = "";
  for (const infra of infraPriority) {
    if (infraSet.has(infra)) { bestInfra = infra; break; }
  }

  const result = {
    terrain: dominantTerrain,
    terrainComposition,
    elevation: Math.round(elevMean),
    elevationRange: {
      min: elevMin === Infinity ? 0 : elevMin,
      max: elevMax === -Infinity ? 0 : elevMax,
      mean: Math.round(elevMean),
    },
    features: significantFeatures,
    infrastructure: bestInfra,
    fineHexCount: totalCells,
  };

  // Urban composition — only computed when >10% of fine hexes are urban-type
  const urbanFrac = urbanCount / totalCells;
  if (urbanFrac > 0.10) {
    const buildingCoverage = buildingCount / totalCells;
    const roadCoverage = roadCount / totalCells;
    const greenCoverage = greenCount / totalCells;
    const avgHeight = heightCount > 0 ? heightSum / heightCount : 0;
    const narrowRoadFrac = roadCount > 0 ? narrowRoadCount / roadCount : 0;

    const { pattern, urbanTerrain } = classifyUrbanPattern(
      buildingCoverage, roadCoverage, narrowRoadFrac, avgHeight
    );

    result.urban = {
      pattern,
      buildingCoverage: Math.round(buildingCoverage * 100) / 100,
      roadCoverage: Math.round(roadCoverage * 100) / 100,
      greenCoverage: Math.round(greenCoverage * 100) / 100,
      avgHeight: Math.round(avgHeight),
      urbanFraction: Math.round(urbanFrac * 100) / 100,
    };

    // Override terrain to aggregated urban type when urban content is significant.
    // 20% threshold: a 100m hex with 20% urban fine hexes is functionally urban,
    // not the open_ground/forest that WorldCover might assign to lawns/canopy.
    if (urbanFrac > 0.20) {
      result.terrain = urbanTerrain;
    }
  }

  return result;
}

/**
 * Get the fine hex keys contained within a strategic hex.
 *
 * @param {Object} strategicGrid - result of buildStrategicGrid()
 * @param {number} stratCol - strategic hex column
 * @param {number} stratRow - strategic hex row
 * @returns {string[]} array of fine hex keys ("col,row")
 */
export function getContainedFineHexes(strategicGrid, stratCol, stratRow) {
  return strategicGrid.strategicToFine.get(`${stratCol},${stratRow}`) || [];
}

/**
 * Get the strategic hex that contains a fine hex.
 *
 * @param {Object} strategicGrid - result of buildStrategicGrid()
 * @param {number} fineCol - fine hex column
 * @param {number} fineRow - fine hex row
 * @returns {string|null} strategic hex key ("col,row") or null
 */
export function getStrategicHexFor(strategicGrid, fineCol, fineRow) {
  return strategicGrid.fineToStrategic.get(`${fineCol},${fineRow}`) || null;
}

/**
 * Compute a 6-element directional terrain summary for a strategic hex.
 * Divides the strategic hex into 6 wedges (one per edge direction)
 * and computes dominant terrain per wedge.
 *
 * Wedge assignment: for each fine hex, compute the angle from the
 * strategic hex center to the fine hex center, and assign to the
 * nearest wedge (0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE — matching
 * the standard hex neighbor order).
 *
 * @param {Object} strategicGrid - result of buildStrategicGrid()
 * @param {string} stratKey - strategic hex key ("col,row")
 * @param {Object} fineCells - mapData.cells
 * @returns {string[]} array of 6 dominant terrain types, one per wedge
 */
export function computeWedgeTerrains(strategicGrid, stratKey, fineCells) {
  const fineKeys = strategicGrid.strategicToFine.get(stratKey);
  if (!fineKeys || fineKeys.length === 0) {
    return Array(6).fill("open_ground");
  }

  const [sc, sr] = stratKey.split(",").map(Number);
  // Strategic hex center in pixel/km space (using original unnormalized coords)
  const origSc = sc + strategicGrid._colOffset;
  const origSr = sr + strategicGrid._rowOffset;
  const stratCenter = offsetToPixel(origSc, origSr, strategicGrid.cellSizeKm);

  // Bin fine hexes into 6 wedges by angle from strategic center
  const wedgeCounts = Array.from({ length: 6 }, () => ({}));

  for (const fineKey of fineKeys) {
    const [fc, fr] = fineKey.split(",").map(Number);
    const fineCenter = offsetToPixel(fc, fr, strategicGrid.fineCellSizeKm);

    const dx = fineCenter.x - stratCenter.x;
    const dy = fineCenter.y - stratCenter.y;

    // Skip the center fine hex (if it's nearly at the strategic center)
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;

    // Angle in radians, 0 = east, CCW positive
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += 2 * Math.PI;

    // Wedge index: 0=E (centered at 0°), 1=NE (60°), etc.
    // Each wedge spans 60°, offset by 30° so wedge boundaries align with hex edges
    // Pointy-top hex edges are at 0°, 60°, 120°, 180°, 240°, 300°
    // Wedge centers are at 0°, 60°, 120°, 180°, 240°, 300°
    const wedge = Math.floor(((angle + Math.PI / 6) % (2 * Math.PI)) / (Math.PI / 3));

    const cell = fineCells[fineKey];
    const terrain = cell?.terrain || "open_ground";
    wedgeCounts[wedge][terrain] = (wedgeCounts[wedge][terrain] || 0) + 1;
  }

  // Dominant terrain per wedge
  return wedgeCounts.map(counts => {
    let best = "open_ground", bestCount = 0;
    for (const [terrain, count] of Object.entries(counts)) {
      if (count > bestCount) { best = terrain; bestCount = count; }
    }
    return best;
  });
}
