// ═══════════════════════════════════════════════════════════════
// TERRAIN CODEC — Compact text encoding for LLM consumption
// RLE terrain grids, elevation banding, feature region grouping
// ═══════════════════════════════════════════════════════════════

import { getNeighborKeys } from "../mapRenderer/HexMath.js";

// ── Feature Scale Relevance ──────────────────────────────────
// [minTier, maxTier] — feature is included in prompts only at these tiers.
// Tiers: 1=Sub-Tactical, 2=Tactical, 3=Grand Tactical, 4=Operational, 5=Strategic, 6=Theater

export const FEATURE_SCALE_RELEVANCE = {
  // Micro-terrain (Tiers 1-2 only)
  fence: [1, 2], wall: [1, 2], hedgerow: [1, 2], building_sparse: [1, 2],
  footpath: [1, 2], trail: [1, 2], minor_road: [1, 2], gate: [1, 2],
  ditch: [1, 2], embankment: [1, 2],
  // Tactical features (Tiers 1-3)
  treeline: [1, 3], building: [1, 3], building_dense: [1, 3],
  slope_steep: [1, 4], slope_extreme: [1, 4], cliffs: [1, 4],
  road: [1, 4], ford: [1, 4],
  // Key terrain (all or most tiers)
  bridge: [1, 4],
  ridgeline: [1, 5],
  river: [1, 6], major_road: [1, 6], highway: [1, 6],
  railway: [3, 6],
  town: [1, 6],
  // Strategic infrastructure (Tiers 3-6)
  airfield: [3, 6], military_base: [3, 6], port: [4, 6],
  power_plant: [5, 6], pipeline: [5, 6], dam: [4, 6],
  // Urban features (Tiers 1-2)
  courtyard: [1, 2], metro_entrance: [1, 2],
  // Urban features (Tiers 1-3)
  fortified_structure: [1, 3],
  // Always relevant
  river_crossing: [1, 6], fortification: [1, 6],
};

/** Check if a feature is relevant at a given scale tier */
export function isFeatureRelevant(feature, tierNumber) {
  const range = FEATURE_SCALE_RELEVANCE[feature];
  if (!range) return true; // Unknown features always included
  return tierNumber >= range[0] && tierNumber <= range[1];
}

// ── Terrain Type Collapsing ─────────────────────────────────
// At higher tiers, merge similar terrain types into broad categories.

// Fine-grained types collapse to aggregated urban at Tier 3 (grand tactical)
const TERRAIN_COLLAPSE_TIER3 = {
  // Buildings → aggregated urban types
  bldg_light: "suburban", bldg_residential: "dense_urban", bldg_commercial: "urban_commercial",
  bldg_highrise: "urban_commercial", bldg_institutional: "dense_urban", bldg_religious: "dense_urban",
  bldg_industrial: "urban_industrial", bldg_fortified: "dense_urban", bldg_ruins: "light_urban",
  bldg_station: "urban_commercial",
  // Roads → simplified
  motorway: "open_ground", arterial: "open_ground", street: "light_urban", alley: "dense_urban",
  road_footpath: "open_ground", rail_track: "open_ground", tram_track: "light_urban",
  // Open paved
  plaza: "light_urban", surface_parking: "light_urban", rail_yard: "urban_industrial",
  // Open green
  park: "light_veg", sports_field: "open_ground", cemetery: "light_veg", urban_trees: "forest", allotment: "farmland",
  // Water
  canal: "river", dock: "coastal_water",
  // Other
  bare_ground: "open_ground", bridge_deck: "open_ground", ground_embankment: "highland",
  underpass: "dense_urban", construction_site: "open_ground",
};

const TERRAIN_COLLAPSE_TIER4 = {
  ...TERRAIN_COLLAPSE_TIER3,
  forest: "forested", dense_forest: "forested", mountain_forest: "forested", forested_hills: "forested",
  light_urban: "urban", dense_urban: "urban",
  suburban: "urban", urban_commercial: "urban", urban_industrial: "urban", urban_dense_core: "urban",
  jungle: "jungle", jungle_hills: "jungle", jungle_mountains: "jungle",
  boreal: "boreal", boreal_hills: "boreal", boreal_mountains: "boreal",
  savanna: "savanna", savanna_hills: "savanna",
};

const TERRAIN_COLLAPSE_TIER6 = {
  ...TERRAIN_COLLAPSE_TIER4,
  farmland: "open", open_ground: "open", light_veg: "open",
  highland: "mountain", mountain: "mountain", peak: "mountain",
  wetland: "water", lake: "water", river: "water", mangrove: "water",
  deep_water: "water", coastal_water: "water",
  tundra: "arctic", ice: "arctic",
};

const COLLAPSED_LABELS = {
  forested: "Forested", urban: "Urban", jungle: "Jungle",
  boreal: "Boreal", savanna: "Savanna", open: "Open Terrain",
  mountain: "Mountain", water: "Water", arctic: "Arctic",
};

/** Get the display terrain type for a given tier, collapsing variants */
export function getTerrainForTier(terrainType, tierNumber) {
  if (tierNumber >= 6) return TERRAIN_COLLAPSE_TIER6[terrainType] || terrainType;
  if (tierNumber >= 4) return TERRAIN_COLLAPSE_TIER4[terrainType] || terrainType;
  if (tierNumber >= 3) return TERRAIN_COLLAPSE_TIER3[terrainType] || terrainType;
  return terrainType;
}

/** Get the label for a possibly-collapsed terrain type */
export function getTerrainLabelForTier(terrainType, tierNumber) {
  const collapsed = getTerrainForTier(terrainType, tierNumber);
  return COLLAPSED_LABELS[collapsed] || TERRAIN_LABEL[collapsed] || collapsed;
}

// ── Single-character terrain codes ──────────────────────────
// 28 terrain types mapped to unique single chars.
// Letters chosen for mnemonic value where possible.

export const TERRAIN_CHAR = {
  deep_water: "D", coastal_water: "C", lake: "K", river: "V",
  wetland: "W", open_ground: "O", light_veg: "L", farmland: "F",
  forest: "R", dense_forest: "E", highland: "H", forested_hills: "G",
  mountain_forest: "N", mountain: "M", peak: "P", desert: "S",
  ice: "I", light_urban: "U", dense_urban: "X",
  jungle: "J", jungle_hills: "j", jungle_mountains: "q",
  boreal: "B", boreal_hills: "b", boreal_mountains: "z",
  tundra: "T", savanna: "A", savanna_hills: "a", mangrove: "Y",
  // Aggregated urban
  suburban: "s", urban_commercial: "c", urban_industrial: "i", urban_dense_core: "d",
  // Fine-grained: Buildings
  bldg_light: "l", bldg_residential: "r", bldg_commercial: "o", bldg_highrise: "h",
  bldg_institutional: "n", bldg_religious: "e", bldg_industrial: "w", bldg_fortified: "f",
  bldg_ruins: "u", bldg_station: "t",
  // Fine-grained: Roads & Rail
  motorway: "m", arterial: "k", street: "g", alley: "y",
  road_footpath: "p", rail_track: "v", tram_track: "x",
  // Fine-grained: Open
  plaza: "Q", surface_parking: "Z", rail_yard: "#",
  park: "+", sports_field: "=", cemetery: "^", urban_trees: "~", allotment: "_",
  // Fine-grained: Water & Other
  canal: "@", dock: "&",
  bare_ground: "!", bridge_deck: "%", ground_embankment: "*", underpass: "-", construction_site: ";",
};

// Human-readable labels for the legend
const TERRAIN_LABEL = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", forested_hills: "Forested Hills",
  mountain_forest: "Mtn Forest", mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert",
  ice: "Ice/Glacier", light_urban: "Light Urban", dense_urban: "Dense Urban",
  suburban: "Suburban", urban_commercial: "Commercial", urban_industrial: "Industrial", urban_dense_core: "Dense Core",
  bldg_light: "Light Bldg", bldg_residential: "Residential", bldg_commercial: "Comm Bldg", bldg_highrise: "Highrise",
  bldg_institutional: "Institution", bldg_religious: "Religious", bldg_industrial: "Ind Bldg", bldg_fortified: "Fortified",
  bldg_ruins: "Ruins", bldg_station: "Station",
  motorway: "Motorway", arterial: "Arterial", street: "Street", alley: "Alley",
  road_footpath: "Footpath", rail_track: "Rail", tram_track: "Tram",
  plaza: "Plaza", surface_parking: "Parking", rail_yard: "Rail Yard",
  park: "Park", sports_field: "Sports", cemetery: "Cemetery", urban_trees: "Urb Trees", allotment: "Allotment",
  canal: "Canal", dock: "Dock",
  bare_ground: "Bare", bridge_deck: "Bridge", ground_embankment: "Embankment", underpass: "Underpass", construction_site: "Construction",
  jungle: "Jungle", jungle_hills: "Jungle Hills", jungle_mountains: "Jungle Mtns",
  boreal: "Boreal", boreal_hills: "Boreal Hills", boreal_mountains: "Boreal Mtns",
  tundra: "Tundra", savanna: "Savanna", savanna_hills: "Savanna Hills", mangrove: "Mangrove",
};

// ── Coordinate helpers ──────────────────────────────────────

// Excel-style column label: 0→A, 25→Z, 26→AA, etc.
export function colLbl(c) {
  let s = "", n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

export function cellCoord(c, r) { return colLbl(c) + (r + 1); }

// Reverse Excel-style label → {col, row} (0-indexed).
// "A1" → {col:0, row:0}, "AA27" → {col:26, row:26}
export function labelToColRow(label) {
  const match = label.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const letters = match[1].toUpperCase();
  const col = letters.split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = parseInt(match[2]) - 1;
  return { col, row };
}

// Format a single cell as readable text for LLM consumption.
// "H4: Forest, 280m, features:[river,bridge], infra:bridge, names:{river=Stonebrook}"
// Optional scaleTier filters features by relevance and collapses terrain types.
export function formatCellDetail(col, row, cell, scaleTier = null) {
  if (!cell) return `${cellCoord(col, row)}: [off-map]`;
  const parts = [cellCoord(col, row) + ":"];

  // Terrain type — collapse at higher tiers
  if (scaleTier && scaleTier >= 4) {
    parts.push(getTerrainLabelForTier(cell.terrain, scaleTier));
  } else {
    parts.push(TERRAIN_LABEL[cell.terrain] || cell.terrain);
  }

  if (cell.elevation !== undefined) parts.push(`${Math.round(cell.elevation)}m`);

  // Features — filter by scale relevance
  const feats = [];
  if (cell.features?.length) {
    for (const f of cell.features) {
      if (!scaleTier || isFeatureRelevant(f, scaleTier)) feats.push(f);
    }
  }
  if (cell.attributes?.length) {
    for (const a of cell.attributes) {
      if (!scaleTier || isFeatureRelevant(a, scaleTier)) feats.push(a);
    }
  }
  if (feats.length) parts.push(`features:[${feats.join(",")}]`);

  // Infrastructure — filter by scale
  if (cell.infrastructure && cell.infrastructure !== "none") {
    if (!scaleTier || isFeatureRelevant(cell.infrastructure, scaleTier)) {
      parts.push(`infra:${cell.infrastructure}`);
    }
  }

  if (cell.feature_names && Object.keys(cell.feature_names).length > 0) {
    const names = Object.entries(cell.feature_names).map(([k, v]) => `${k}=${v}`).join(",");
    parts.push(`names:{${names}}`);
  }

  // Urban composition (from Strategic Grid aggregation or fine-parse metadata)
  if (cell.urban && (!scaleTier || scaleTier <= 3)) {
    const u = cell.urban;
    const uParts = [`pattern:${u.pattern}`];
    if (u.buildingCoverage > 0) uParts.push(`bldg:${Math.round(u.buildingCoverage * 100)}%`);
    if (u.roadCoverage > 0) uParts.push(`road:${Math.round(u.roadCoverage * 100)}%`);
    if (u.avgHeight > 0) uParts.push(`avgH:${Math.round(u.avgHeight)}m`);
    parts.push(`urban:{${uParts.join(",")}}`);
  }

  // Building metadata (from fine-parse OSM extraction)
  if (cell.buildingFloors && (!scaleTier || scaleTier <= 2)) {
    const bParts = [`${cell.buildingFloors}fl`];
    if (cell.buildingHeight) bParts.push(`${Math.round(cell.buildingHeight)}m`);
    if (cell.buildingMaterial) bParts.push(cell.buildingMaterial);
    if (cell.protectedSite) bParts.push("PROTECTED");
    parts.push(`bldg:{${bParts.join(",")}}`);
  }

  return parts.join(" ");
}

// ── Order-Type Feature Relevance ──────────────────────────────
// Which features matter for which order types. Features not listed for an
// order type are omitted from that order's terrain context to save tokens.
// null = include all features (no filtering).

export const ORDER_FEATURE_RELEVANCE = {
  ATTACK:       new Set(["building", "building_dense", "wall", "fortification", "fortified_structure", "river", "bridge", "road", "highway", "slope_steep", "slope_extreme", "cliffs", "ridgeline", "treeline", "courtyard", "metro_entrance", "town", "fence"]),
  DEFEND:       new Set(["building", "building_dense", "wall", "fortification", "fortified_structure", "treeline", "slope_steep", "ridgeline", "river", "bridge", "road", "highway", "courtyard", "town", "fence", "hedgerow"]),
  FIRE_MISSION: new Set(["building", "building_dense", "ridgeline", "slope_steep", "town", "fortification", "fortified_structure"]),
  SHORE_BOMBARDMENT: new Set(["building", "building_dense", "fortification", "port", "town"]),
  RECON:        new Set(["road", "highway", "major_road", "trail", "ridgeline", "treeline", "building", "town", "airfield", "military_base"]),
  MOVE:         new Set(["road", "highway", "major_road", "trail", "bridge", "river", "ford", "river_crossing", "slope_steep", "slope_extreme"]),
  ENGINEER:     new Set(["bridge", "fortification", "river", "road", "highway", "dam", "wall", "fence"]),
};

/**
 * Filter features for a specific order type. Returns all features if
 * orderType is null/unknown, or the relevant subset for known types.
 */
export function filterFeaturesForOrder(features, orderType) {
  if (!orderType || !ORDER_FEATURE_RELEVANCE[orderType]) return features;
  const relevant = ORDER_FEATURE_RELEVANCE[orderType];
  return features.filter(f => relevant.has(f));
}

// ── Urban Narrative Builder ─────────────────────────────────
// Generates a cached prose summary of the map's urban character.
// Called once at simulation start, injected into every turn prompt.

const URBAN_TERRAINS = new Set([
  "light_urban", "dense_urban", "suburban", "urban_commercial",
  "urban_industrial", "urban_dense_core",
  "bldg_light", "bldg_residential", "bldg_commercial", "bldg_highrise",
  "bldg_institutional", "bldg_religious", "bldg_industrial", "bldg_fortified",
  "bldg_ruins", "bldg_station",
  "motorway", "arterial", "street", "alley", "road_footpath",
  "rail_track", "tram_track", "plaza", "surface_parking", "rail_yard",
  "park", "sports_field", "cemetery", "urban_trees", "allotment",
  "canal", "dock", "bare_ground", "bridge_deck", "ground_embankment",
  "underpass", "construction_site",
]);

const PATTERN_DESCRIPTIONS = {
  A: "dense irregular streets (<10m), infantry only, excellent defense",
  B: "orderly grid blocks (15-25m streets), moderate vehicle access",
  C: "dispersed residential, good vehicle access, moderate cover",
  D: "high-rise towers, wide streets, long sightlines",
  E: "industrial/transport, wide open spaces, full vehicle access",
};

/**
 * Build a prose summary of urban terrain across the map.
 * Groups urban cells into clusters, describes each cluster's character.
 * Returns an array of lines (empty if no significant urban presence).
 */
export function buildUrbanNarrative(terrainData) {
  if (!terrainData?.cells) return [];
  const D = terrainData;

  // Count urban cells and collect clusters by named settlement
  const urbanCells = [];
  const settlements = {}; // name → [keys]
  let totalCells = 0;

  for (const k in D.cells) {
    totalCells++;
    const cell = D.cells[k];
    if (!URBAN_TERRAINS.has(cell.terrain)) continue;
    urbanCells.push(k);

    // Group by settlement name if available
    const fn = cell.feature_names;
    const name = fn?.town || fn?.settlement || null;
    if (name) {
      if (!settlements[name]) settlements[name] = [];
      settlements[name].push(k);
    }
  }

  const urbanFrac = urbanCells.length / totalCells;
  if (urbanFrac < 0.05 || urbanCells.length < 3) return []; // Not enough urban to narrate

  const lines = ["URBAN CONTEXT:"];

  // Overall urban fraction
  lines.push(`  ${Math.round(urbanFrac * 100)}% of map is urban/built-up terrain (${urbanCells.length} cells).`);

  // Describe each named settlement
  for (const [name, keys] of Object.entries(settlements).sort((a, b) => b[1].length - a[1].length)) {
    if (keys.length < 2) continue;

    // Analyze composition of this settlement
    const comp = {};
    let hasUrbanObj = false;
    let pattern = null;
    let totalHeight = 0, heightCount = 0;

    for (const k of keys) {
      const cell = D.cells[k];
      const t = cell.terrain;
      comp[t] = (comp[t] || 0) + 1;
      if (cell.urban) {
        hasUrbanObj = true;
        if (!pattern) pattern = cell.urban.pattern;
        if (cell.urban.avgHeight > 0) { totalHeight += cell.urban.avgHeight; heightCount++; }
      }
      if (cell.buildingHeight > 0) { totalHeight += cell.buildingHeight; heightCount++; }
    }

    const avgH = heightCount > 0 ? Math.round(totalHeight / heightCount) : 0;

    // Build description
    const dominant = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
    const desc = [];
    desc.push(`${name} (${keys.length} cells)`);
    if (pattern && PATTERN_DESCRIPTIONS[pattern]) {
      desc.push(`Pattern ${pattern}: ${PATTERN_DESCRIPTIONS[pattern]}`);
    }
    if (avgH > 0) desc.push(`avg height ${avgH}m`);
    const dominantLabel = TERRAIN_LABEL[dominant[0]] || dominant[0];
    desc.push(`primarily ${dominantLabel}`);

    lines.push(`  ${desc.join(", ")}.`);
  }

  // Describe unnamed urban clusters if significant
  const unnamedCount = urbanCells.length - Object.values(settlements).reduce((s, v) => s + v.length, 0);
  if (unnamedCount > 5) {
    lines.push(`  ${unnamedCount} additional urban cells outside named settlements.`);
  }

  return lines;
}

// ── Run-Length Encoding ─────────────────────────────────────

/**
 * RLE-encode an array of single-char codes.
 * ["D","D","D","C","C","R"] → "3D2CR"
 * A run of 1 omits the count: "R" not "1R".
 */
function rleEncode(codes) {
  if (codes.length === 0) return "";
  let out = "";
  let cur = codes[0], count = 1;
  for (let i = 1; i < codes.length; i++) {
    if (codes[i] === cur) {
      count++;
    } else {
      out += (count > 1 ? count : "") + cur;
      cur = codes[i];
      count = 1;
    }
  }
  out += (count > 1 ? count : "") + cur;
  return out;
}

// ── Reading Instructions ────────────────────────────────────

/**
 * Preamble explaining the compact format so any LLM can decode it.
 * Kept short (~10 lines) to minimize token overhead.
 */
export function buildReadingInstructions() {
  return [
    "## HOW TO READ THIS DOCUMENT",
    "This is a hex-grid terrain map encoded for token efficiency.",
    "COORDINATES: Columns are labeled A-Z, AA-AZ, BA-BZ, etc. (left=west). Rows are numbered 1-N (row 1=north). Cell \"M12\" = column M, row 12.",
    "TERRAIN GRID: Each row is RLE-encoded using single-char codes from the LEGEND.",
    "  RLE format: a number followed by a letter means that letter repeats. 5D = 5 consecutive Deep Water cells. A bare letter means 1 cell.",
    "  Example: 3|5D2CR means row 3 has 5× D (Deep Water), 2× C (Coastal), 1× R (Forest).",
    "ELEVATION BANDS: Cells grouped by altitude range. r12[A-M] means row 12, columns A through M fall in that band.",
    "FEATURES: Same r[cols] notation for widespread features, or individual coords (e.g. E7) for sparse ones.",
    "  Feature names in parentheses: highway(Main Rd) means that feature is named \"Main Rd\".",
  ];
}

// ── Legend Builder ───────────────────────────────────────────

/**
 * Build a compact legend showing only terrain types present in this map.
 * Returns array of lines.
 */
export function buildLegend(terrainData) {
  // Collect which terrain types actually appear
  const present = new Set();
  for (const k in terrainData.cells) {
    present.add(terrainData.cells[k].terrain);
  }
  const lines = ["## LEGEND (single-char terrain codes, RLE: 5D = 5 consecutive D)"];
  const entries = [];
  for (const [terrain, ch] of Object.entries(TERRAIN_CHAR)) {
    if (present.has(terrain)) entries.push(`${ch}=${TERRAIN_LABEL[terrain] || terrain}`);
  }
  // Pack legend entries onto lines, ~80 chars wide
  let line = "#";
  for (const entry of entries) {
    if (line.length + entry.length + 2 > 80) {
      lines.push(line);
      line = "#";
    }
    line += " " + entry;
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

// ── Terrain Grid (RLE) ─────────────────────────────────────

/**
 * Build RLE-encoded terrain grid. One line per row.
 * Returns array of lines.
 */
export function buildTerrainGrid(terrainData) {
  const D = terrainData;
  const lines = ["## TERRAIN (row 1=north, left=west)"];
  const rowNumWidth = String(D.rows).length;
  for (let r = 0; r < D.rows; r++) {
    const codes = [];
    for (let c = 0; c < D.cols; c++) {
      const cell = D.cells[`${c},${r}`];
      codes.push(cell ? (TERRAIN_CHAR[cell.terrain] || "?") : ".");
    }
    const rle = rleEncode(codes);
    lines.push(`${String(r + 1).padStart(rowNumWidth)}|${rle}`);
  }
  return lines;
}

// ── Elevation Bands ─────────────────────────────────────────

const ELEV_BANDS = [
  { label: "50-200m", min: 50, max: 200 },
  { label: "200-500m", min: 200, max: 500 },
  { label: "500-1000m", min: 500, max: 1000 },
  { label: "1000-2000m", min: 1000, max: 2000 },
  { label: "2000m+", min: 2000, max: Infinity },
];

/**
 * Build compact elevation band summary.
 * Groups cells into bands, then summarizes each band with row-based ranges.
 * Returns array of lines.
 */
export function buildElevationBands(terrainData) {
  const D = terrainData;
  const lines = [];

  // Find actual elevation range
  let elevMin = Infinity, elevMax = -Infinity;
  for (const k in D.cells) {
    const e = D.cells[k].elevation;
    if (e !== undefined) {
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
    }
  }
  if (elevMin === Infinity) return lines;

  lines.push(`## ELEVATION: ${Math.round(elevMin)}m to ${Math.round(elevMax)}m`);

  // Collect cells per band
  for (const band of ELEV_BANDS) {
    // Skip bands outside this map's range
    if (elevMax < band.min || elevMin >= band.max) continue;

    // For each row, find column runs in this band
    const rowRanges = [];
    for (let r = 0; r < D.rows; r++) {
      const cols = [];
      for (let c = 0; c < D.cols; c++) {
        const cell = D.cells[`${c},${r}`];
        if (cell && cell.elevation >= band.min && cell.elevation < band.max) {
          cols.push(c);
        }
      }
      if (cols.length === 0) continue;

      // Compress column list into ranges
      const ranges = compressColRanges(cols);
      rowRanges.push(`r${r + 1}[${ranges}]`);
    }
    if (rowRanges.length > 0) {
      lines.push(`${band.label}: ${rowRanges.join(" ")}`);
    }
  }
  return lines;
}

/**
 * Compress a sorted array of column indices into ranges.
 * [0,1,2,3,5,6,10] → "A-D,F-G,K"
 */
function compressColRanges(cols) {
  if (cols.length === 0) return "";
  const ranges = [];
  let start = cols[0], end = cols[0];
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] === end + 1) {
      end = cols[i];
    } else {
      ranges.push(start === end ? colLbl(start) : `${colLbl(start)}-${colLbl(end)}`);
      start = end = cols[i];
    }
  }
  ranges.push(start === end ? colLbl(start) : `${colLbl(start)}-${colLbl(end)}`);
  return ranges.join(",");
}

// ── Elevation Narrative (Tier 4+) ────────────────────────────
// At operational+ scales, raw elevation bands are noise. This synthesizes
// geographic features (mountain ranges, valleys, transition lines) from
// the hex grid elevation data and presents them as a narrative summary.

const ELEV_CATEGORY_LABELS = {
  low: "lowlands", moderate: "foothills", high: "highlands/mountains", very_high: "mountain peaks",
};

/** Classify a single elevation value into a category string. */
function elevCategory(e, mergeHigh) {
  if (e >= 1000 && !mergeHigh) return "very_high";
  if (e >= 500) return "high";
  if (e >= 200) return "moderate";
  return "low";
}

/** BFS flood-fill to find contiguous regions of same elevation category. */
function floodFillElevRegions(terrainData, categoryMap, targetCategories) {
  const visited = new Set();
  const regions = [];
  const D = terrainData;

  for (let r = 0; r < D.rows; r++) {
    for (let c = 0; c < D.cols; c++) {
      const key = `${c},${r}`;
      if (visited.has(key) || !D.cells[key]) continue;
      const cat = categoryMap[key];
      if (!targetCategories.includes(cat)) continue;

      // BFS flood fill
      const region = { category: cat, cells: new Set(), minElev: Infinity, maxElev: -Infinity, elevSum: 0 };
      const queue = [key];
      visited.add(key);

      while (queue.length > 0) {
        const k = queue.shift();
        region.cells.add(k);
        const elev = D.cells[k].elevation || 0;
        if (elev < region.minElev) region.minElev = elev;
        if (elev > region.maxElev) region.maxElev = elev;
        region.elevSum += elev;

        const [kc, kr] = k.split(",").map(Number);
        for (const nk of getNeighborKeys(kc, kr)) {
          if (visited.has(nk) || !D.cells[nk]) continue;
          if (categoryMap[nk] === cat) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }

      region.avgElev = Math.round(region.elevSum / region.cells.size);
      regions.push(region);
    }
  }
  return regions;
}

/** Compute bounding box (row/col extent) for a region. */
function regionBounds(region) {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of region.cells) {
    const [c, r] = k.split(",").map(Number);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

/** Find row boundaries with large average elevation change — natural defensive lines. */
function findElevationTransitions(terrainData, threshold) {
  const D = terrainData;
  const transitions = [];
  for (let r = 0; r < D.rows - 1; r++) {
    let deltaSum = 0, count = 0;
    for (let c = 0; c < D.cols; c++) {
      const e1 = D.cells[`${c},${r}`]?.elevation;
      const e2 = D.cells[`${c},${r + 1}`]?.elevation;
      if (e1 !== undefined && e2 !== undefined) {
        deltaSum += Math.abs(e2 - e1);
        count++;
      }
    }
    if (count > 0 && (deltaSum / count) >= threshold) {
      transitions.push({ row: r, avgDelta: Math.round(deltaSum / count) });
    }
  }
  return transitions;
}

/** Check if a low-elevation region contains river features — marks it as a valley corridor. */
function isValleyCorridor(region, terrainData) {
  for (const k of region.cells) {
    const cell = terrainData.cells[k];
    if (cell?.features?.includes("river")) return true;
  }
  return false;
}

/**
 * Build scale-aware elevation narrative for Tier 4+ (operational/strategic/theater).
 * Replaces raw elevation bands with geographic feature descriptions.
 * Tier 4: keeps bands + appends geographic features.
 * Tier 5-6: geographic overview only (no raw bands).
 */
export function buildElevationNarrative(terrainData, scaleTier) {
  const D = terrainData;
  const lines = [];

  // Find elevation range
  let elevMin = Infinity, elevMax = -Infinity;
  for (const k in D.cells) {
    const e = D.cells[k].elevation;
    if (e !== undefined) {
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
    }
  }
  if (elevMin === Infinity) return lines;

  // Classify cells into elevation categories
  // At tier 5-6, merge high+very_high for coarser narrative
  const mergeHigh = scaleTier >= 5;
  const categoryMap = {};
  for (const k in D.cells) {
    const e = D.cells[k].elevation;
    if (e === undefined) continue;
    categoryMap[k] = elevCategory(e, mergeHigh);
  }

  // Flood fill all categories
  const targetCats = mergeHigh ? ["low", "moderate", "high"] : ["low", "moderate", "high", "very_high"];
  const allRegions = floodFillElevRegions(D, categoryMap, targetCats);

  // Filter to significant regions (3+ cells), sort largest first
  const significant = allRegions.filter(r => r.cells.size >= 3);
  significant.sort((a, b) => b.cells.size - a.cells.size);

  // Tier 4: keep raw bands alongside narrative
  if (scaleTier === 4) {
    lines.push(`## ELEVATION: ${Math.round(elevMin)}m to ${Math.round(elevMax)}m`);
    // Include raw bands (skip the duplicate header from buildElevationBands)
    for (const bl of buildElevationBands(D)) {
      if (!bl.startsWith("## ELEVATION")) lines.push(bl);
    }
    lines.push("");
    lines.push("GEOGRAPHIC FEATURES:");
  } else {
    // Tier 5-6: narrative only
    lines.push(`## GEOGRAPHIC OVERVIEW: ${Math.round(elevMin)}m to ${Math.round(elevMax)}m`);
  }

  // Describe significant regions (cap at 8)
  for (const region of significant.slice(0, 8)) {
    const bounds = regionBounds(region);
    const locStr = `rows ${bounds.minR + 1}-${bounds.maxR + 1}, cols ${colLbl(bounds.minC)}-${colLbl(bounds.maxC)}`;
    const label = ELEV_CATEGORY_LABELS[region.category] || region.category;

    if (region.category === "low" && isValleyCorridor(region, D)) {
      lines.push(`- Valley corridor (${locStr}, ${Math.round(region.minElev)}-${Math.round(region.maxElev)}m): low ground with river, potential movement axis`);
    } else {
      lines.push(`- ${label} (${locStr}, ${Math.round(region.minElev)}-${Math.round(region.maxElev)}m avg ${region.avgElev}m, ${region.cells.size} cells)`);
    }
  }

  // Elevation transitions — natural defensive lines
  const threshold = scaleTier >= 5 ? 300 : 200;
  const transitions = findElevationTransitions(D, threshold);
  for (const t of transitions) {
    lines.push(`- Elevation transition at row ${t.row + 1}/${t.row + 2} boundary (avg ${t.avgDelta}m change): natural defensive line`);
  }

  return lines;
}

// ── Feature Region Grouping ─────────────────────────────────

/**
 * Group features across cells into contiguous ranges.
 * Returns array of lines.
 */
export function buildFeatureRegions(terrainData, scaleTier = null) {
  const D = terrainData;
  const lines = [];

  // Collect all features and their cell locations
  const featCells = {}; // feature → [{c,r}, ...]
  const featNames = {}; // feature → Set of names

  for (const k in D.cells) {
    const cell = D.cells[k];
    const [c, r] = k.split(",").map(Number);
    const fn = cell.feature_names || {};

    // Gather all features for this cell
    const allFeats = [];
    if (cell.features) allFeats.push(...cell.features);
    if (cell.attributes) allFeats.push(...cell.attributes);
    if (cell.infrastructure && cell.infrastructure !== "none") allFeats.push(cell.infrastructure);

    for (const f of allFeats) {
      // Skip features irrelevant at this scale tier
      if (scaleTier && !isFeatureRelevant(f, scaleTier)) continue;
      if (!featCells[f]) featCells[f] = [];
      featCells[f].push({ c, r });
      if (fn[f]) {
        if (!featNames[f]) featNames[f] = new Set();
        featNames[f].add(fn[f]);
      }
    }

    // Also capture terrain-level names (settlements, etc.)
    if (fn.settlement) {
      const key = "__settlement";
      if (!featCells[key]) featCells[key] = [];
      featCells[key].push({ c, r, name: fn.settlement });
    }
  }

  // Sort features by frequency (most common first)
  const sortedFeats = Object.entries(featCells)
    .filter(([, cells]) => cells.length >= 1)
    .sort((a, b) => b[1].length - a[1].length);

  if (sortedFeats.length === 0) return lines;
  lines.push("## FEATURES");

  for (const [feat, cells] of sortedFeats) {
    if (feat === "__settlement") {
      // Handle named settlements specially
      const settlements = cells.map(c => `${c.name}(${cellCoord(c.c, c.r)})`);
      lines.push(`settlements: ${settlements.join(", ")}`);
      continue;
    }

    // Sort cells by row then col for range compression
    cells.sort((a, b) => a.r - b.r || a.c - b.c);

    // Build row-based ranges
    const names = featNames[feat] ? [...featNames[feat]] : [];
    const nameStr = names.length > 0 ? `(${names.join(", ")})` : "";

    if (cells.length <= 4) {
      // Few cells — just list coordinates
      const coords = cells.map(c => cellCoord(c.c, c.r));
      lines.push(`${feat}${nameStr}: ${coords.join(", ")}`);
    } else {
      // Many cells — compress into row-based ranges
      const rowMap = {};
      for (const { c, r } of cells) {
        if (!rowMap[r]) rowMap[r] = [];
        rowMap[r].push(c);
      }
      const rowRanges = [];
      for (const [r, cols] of Object.entries(rowMap)) {
        cols.sort((a, b) => a - b);
        const ranges = compressColRanges(cols);
        rowRanges.push(`r${Number(r) + 1}[${ranges}]`);
      }
      lines.push(`${feat}${nameStr} (${cells.length}): ${rowRanges.join(" ")}`);
    }
  }

  return lines;
}

// ── Named Features ──────────────────────────────────────────

/**
 * Build named features index (rivers, settlements, etc. with proper names).
 * Returns array of lines.
 */
export function buildNamedFeatures(terrainData) {
  const D = terrainData;
  const nameIdx = {};
  for (const k in D.cells) {
    const fn = D.cells[k].feature_names;
    if (!fn) continue;
    for (const [type, name] of Object.entries(fn)) {
      if (!nameIdx[type]) nameIdx[type] = {};
      if (!nameIdx[type][name]) nameIdx[type][name] = 0;
      nameIdx[type][name]++;
    }
  }
  if (Object.keys(nameIdx).length === 0) return [];

  const lines = ["## NAMED FEATURES"];
  for (const [type, names] of Object.entries(nameIdx)) {
    for (const [name, count] of Object.entries(names).sort((a, b) => b[1] - a[1])) {
      lines.push(`${type}: ${name} (${count} cells)`);
    }
  }
  return lines;
}

// ── Full Compact Export ─────────────────────────────────────

/**
 * Build the complete compact LLM export text.
 * Used by Viewer.jsx exportLLM button.
 */
export function buildCompactExport(terrainData) {
  const D = terrainData;
  const lines = [];

  // Header
  lines.push("# TERRAIN MAP");
  lines.push(`# ${D.cols}\u00D7${D.rows} cells, ${D.cellSizeKm}km/cell`);
  if (D.center) lines.push(`# Center: ${D.center.lat.toFixed(4)}, ${D.center.lng.toFixed(4)}`);
  if (D.bbox) lines.push(`# Bounds: S${D.bbox.south.toFixed(4)} N${D.bbox.north.toFixed(4)} W${D.bbox.west.toFixed(4)} E${D.bbox.east.toFixed(4)}`);
  lines.push("");

  // Reading instructions so any LLM knows how to decode the format
  lines.push(...buildReadingInstructions());
  lines.push("");

  // Legend
  lines.push(...buildLegend(D));
  lines.push("");

  // Terrain grid (RLE)
  lines.push(...buildTerrainGrid(D));
  lines.push("");

  // Elevation bands
  const elevLines = buildElevationBands(D);
  if (elevLines.length > 0) {
    lines.push(...elevLines);
    lines.push("");
  }

  // Features (grouped)
  const featLines = buildFeatureRegions(D);
  if (featLines.length > 0) {
    lines.push(...featLines);
    lines.push("");
  }

  // Terrain distribution summary
  lines.push("## SUMMARY");
  const terrCt = {};
  for (const k in D.cells) { const t = D.cells[k].terrain; terrCt[t] = (terrCt[t] || 0) + 1; }
  const total = Object.values(terrCt).reduce((s, v) => s + v, 0);
  Object.entries(terrCt).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    lines.push(`${(TERRAIN_LABEL[t] || t).padEnd(16)} ${n} cells (${((n / total) * 100).toFixed(1)}%)`);
  });
  lines.push("");

  // Named features
  const namedLines = buildNamedFeatures(D);
  if (namedLines.length > 0) {
    lines.push(...namedLines);
  }

  return lines.join("\n");
}
