// ═══════════════════════════════════════════════════════════════
// TERRAIN CODEC — Compact text encoding for LLM consumption
// RLE terrain grids, elevation banding, feature region grouping
// ═══════════════════════════════════════════════════════════════

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
};

// Human-readable labels for the legend
const TERRAIN_LABEL = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", forested_hills: "Forested Hills",
  mountain_forest: "Mtn Forest", mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert",
  ice: "Ice/Glacier", light_urban: "Light Urban", dense_urban: "Dense Urban",
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

// ── Feature Region Grouping ─────────────────────────────────

/**
 * Group features across cells into contiguous ranges.
 * Returns array of lines.
 */
export function buildFeatureRegions(terrainData) {
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
