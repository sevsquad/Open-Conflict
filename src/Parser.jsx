import { useState, useRef, useCallback, useEffect } from "react";
import { fromUrl } from "geotiff";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Badge, Panel } from "./components/ui.jsx";
import { getNeighbors, hexLine, offsetToAxial, axialToOffset,
         offsetToPixel, pixelToOffset, traceHexPath, SQRT3, SQRT3_2 } from "./mapRenderer/HexMath.js";
import riverWhitelistData from "../river-whitelist.json";
import CitySearch from "./components/CitySearch.jsx";

// ════════════════════════════════════════════════════════════════
// TERRAIN — physical character (movement, cover, LOS)
// ════════════════════════════════════════════════════════════════

const TERRAIN_TYPES = [
  { id: "deep_water",      label: "Deep Water",      color: "#14304D" },
  { id: "coastal_water",   label: "Coastal Water",   color: "#2872A4" },
  { id: "lake",            label: "Lake",            color: "#3B8EBF" },
  { id: "river",           label: "River",           color: "#4A9ACF" },
  { id: "wetland",         label: "Wetland",         color: "#5A8B5E" },
  { id: "open_ground",     label: "Open Ground",     color: "#C8C4A0" },
  { id: "light_veg",       label: "Light Vegetation", color: "#A8BF6B" },
  { id: "farmland",        label: "Farmland",        color: "#D4C86A" },
  { id: "forest",          label: "Forest",          color: "#2D6B1E" },
  { id: "dense_forest",    label: "Dense Forest",    color: "#1A4D10" },
  { id: "highland",        label: "Highland",        color: "#A89570" },
  { id: "mountain_forest", label: "Mtn Forest",      color: "#3D6B30" },
  { id: "mountain",        label: "Mountain",        color: "#8B7355" },
  { id: "peak",            label: "Peak/Alpine",     color: "#C8C0B0" },
  { id: "desert",          label: "Desert/Arid",     color: "#C9A84C" },
  { id: "ice",             label: "Ice/Glacier",     color: "#D4E5F7" },
  { id: "light_urban",     label: "Light Urban",     color: "#B0A890" },
  { id: "dense_urban",     label: "Dense Urban",     color: "#7A7D80" },
];
const TT = {}; TERRAIN_TYPES.forEach(t => { TT[t.id] = t; });

// ════════════════════════════════════════════════════════════════
// INFRASTRUCTURE
// ════════════════════════════════════════════════════════════════

const INFRA_TYPES = [
  { id: "none",          label: "None",          color: "#12182a" },
  { id: "footpath",      label: "Footpath",      color: "#6A6A5A" },
  { id: "trail",         label: "Trail/Track",   color: "#8A8A6A" },
  { id: "minor_road",    label: "Minor Road",    color: "#9A9A8A" },
  { id: "road",          label: "Road",          color: "#B0B0B0" },
  { id: "major_road",    label: "Major Road",    color: "#D4D4D4" },
  { id: "highway",       label: "Highway",       color: "#E6A817" },
  { id: "bridge",        label: "Bridge",        color: "#C4956E" },
  { id: "railway",       label: "Railway",       color: "#5C5C5C" },
  { id: "light_rail",    label: "Light Rail",    color: "#7A7A6C" },
  { id: "tunnel",        label: "Tunnel",        color: "#4A4A5A" },
  { id: "port",          label: "Port",          color: "#4A7A8A" },
  { id: "airfield",      label: "Airfield",      color: "#8A8A9A" },
  { id: "helipad",       label: "Helipad",       color: "#7A8A7A" },
  { id: "military_base", label: "Military Base", color: "#6A4A4A" },
  { id: "dam",           label: "Dam",           color: "#5A6A7A" },
  { id: "building",      label: "Building",      color: "#8A7A6A" },
  { id: "parking",       label: "Parking",       color: "#6A6A7A" },
  { id: "tower",         label: "Tower",         color: "#9A6A6A" },
  { id: "wall",          label: "Wall",          color: "#7A5A4A" },
  { id: "fence",         label: "Fence",         color: "#6A5A4A" },
];
const IT = {}; INFRA_TYPES.forEach(t => { IT[t.id] = t; });

const ATTR_DISPLAY = {
  cliffs:              { label: "Cliffs",            color: "#C48060" },
  ridgeline:           { label: "Ridgeline",         color: "#D4A860" },
  treeline:            { label: "Treeline",          color: "#88C060" },
  slope_steep:         { label: "Steep Slope",       color: "#D49040" },
  slope_extreme:       { label: "Extreme Slope",     color: "#D45040" },
  building_dense:      { label: "Dense Buildings",   color: "#A09080" },
  building_sparse:     { label: "Sparse Buildings",  color: "#B0A090" },
  hedgerow:            { label: "Hedgerow",          color: "#6AA050" },
  walled:              { label: "Walled",            color: "#8A6A5A" },
  elevation_advantage: { label: "Elev Advantage",    color: "#E0C060" },
};

// Unified feature catalog — every non-terrain thing that can appear in a cell
const FEATURE_TYPES = {
  // Roads
  highway:       { label: "Highway",       color: "#E6A817", group: "Roads" },
  major_road:    { label: "Major Road",    color: "#D4D4D4", group: "Roads" },
  road:          { label: "Road",          color: "#B0B0B0", group: "Roads" },
  minor_road:    { label: "Minor Road",    color: "#9A9A8A", group: "Roads" },
  footpath:      { label: "Footpath",      color: "#6A6A5A", group: "Roads" },
  trail:         { label: "Trail/Track",   color: "#8A8A6A", group: "Roads" },
  // Rail
  railway:       { label: "Railway",       color: "#E05050", group: "Rail" },
  light_rail:    { label: "Light Rail",    color: "#D07070", group: "Rail" },
  // Water
  dam:           { label: "Dam",           color: "#5A8ABF", group: "Water" },
  river:{ label: "River", color: "#3AC4E0", group: "Water" },
  tunnel:        { label: "Tunnel",        color: "#7070A0", group: "Water" },
  // Transport
  port:          { label: "Port",          color: "#4ABFBF", group: "Transport" },
  airfield:      { label: "Airfield",      color: "#9090D0", group: "Transport" },
  helipad:       { label: "Helipad",       color: "#70A070", group: "Transport" },
  pipeline:      { label: "Pipeline",      color: "#A070D0", group: "Transport" },
  // Energy
  power_plant:   { label: "Power Plant",   color: "#E0D040", group: "Energy" },
  // Military
  military_base: { label: "Military Base", color: "#BF5050", group: "Military" },
  // Strategic
  beach:         { label: "Beach",         color: "#E0D0A0", group: "Strategic" },
  town:          { label: "Town",          color: "#E8A040", group: "Strategic" },
  // Structures
  building:      { label: "Building",      color: "#A08060", group: "Structures" },
  parking:       { label: "Parking",       color: "#6A6A7A", group: "Structures" },
  tower:         { label: "Tower",         color: "#C07050", group: "Structures" },
  wall:          { label: "Wall",          color: "#8A6A5A", group: "Structures" },
  fence:         { label: "Fence",         color: "#7A6050", group: "Structures" },
  // Terrain attrs
  cliffs:        { label: "Cliffs",        color: "#C48060", group: "Terrain" },
  ridgeline:     { label: "Ridgeline",     color: "#D4A860", group: "Terrain" },
  treeline:      { label: "Treeline",      color: "#88C060", group: "Terrain" },
  slope_steep:   { label: "Steep Slope",   color: "#D49040", group: "Terrain" },
  slope_extreme: { label: "Extreme Slope", color: "#D45040", group: "Terrain" },
  building_dense:{ label: "Dense Bldg",    color: "#C0A080", group: "Terrain" },
  building_sparse:{label: "Sparse Bldg",   color: "#B0A090", group: "Terrain" },
  hedgerow:      { label: "Hedgerow",      color: "#6AA050", group: "Terrain" },
  walled:        { label: "Walled",        color: "#8A6A5A", group: "Terrain" },
  elevation_advantage:{label:"Elev Advantage",color:"#E0C060",group:"Terrain"},
};

const FEATURE_GROUPS = ["Roads","Rail","Water","Transport","Energy","Military","Strategic","Structures","Terrain"];

function getFeatureInfo(id) { return FEATURE_TYPES[id] || { label: id, color: "#999", group: "Other" }; }

// ════════════════════════════════════════════════════════════════
// GEO + SPATIAL INDEX
// ════════════════════════════════════════════════════════════════

function getBBox(lat, lng, wKm, hKm) {
  const dLat = (hKm / 2) / 111.32, dLng = (wKm / 2) / (111.32 * Math.cos(lat * Math.PI / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

// ════════════════════════════════════════════════════════════════
// HEX GRID GEOGRAPHIC PROJECTION
// Maps hex grid (col,row) ↔ geographic (lon,lat) using the same
// pointy-top odd-r geometry as the viewer (HexMath.js, size = 1).
// ════════════════════════════════════════════════════════════════

function createHexProjection(bbox, cols, rows) {
  const { south, north, west, east } = bbox;

  // Hex pixel-space extents (size = 1, pointy-top, odd-r offset)
  const hxMin = -SQRT3_2;
  const hyMin = -1.0;
  const hxSpan = SQRT3 * (cols + 0.5);   // total width in hex units
  const hySpan = 1.5 * rows + 0.5;       // total height in hex units

  // Latitude-corrected projection: compensate for longitude degree width varying with latitude.
  // At high latitudes or for tall maps, a constant lonPerUnit causes hexes at different latitudes
  // to cover different physical areas. We correct by normalizing longitude to the center latitude.
  const midLat = (south + north) / 2;
  const cosRef = Math.cos(midLat * Math.PI / 180);
  // Latitude span in "equalized degrees" (lat degrees stay the same)
  const latPerUnit = (north - south) / hySpan;
  // Longitude span normalized by cos(lat): maps to equal physical width
  const lonPerUnit = (east - west) / hxSpan;

  // For maps < 5 degrees tall or near equator, the linear approximation is sufficient.
  // For larger/higher-latitude maps, we apply per-cell latitude correction.
  const latSpan = north - south;
  const needsCorrection = latSpan > 5 || Math.abs(midLat) > 55;

  // Helper: corrected longitude for a given latitude
  // Adjusts longitude displacement to maintain equal physical width across latitudes
  function correctedLon(lon, lat) {
    if (!needsCorrection) return lon;
    const cosLat = Math.cos(lat * Math.PI / 180);
    // Scale longitude displacement from center by ratio of cosines
    const midLon = (west + east) / 2;
    return midLon + (lon - midLon) * cosRef / cosLat;
  }

  function uncorrectedLon(corrLon, lat) {
    if (!needsCorrection) return corrLon;
    const cosLat = Math.cos(lat * Math.PI / 180);
    const midLon = (west + east) / 2;
    return midLon + (corrLon - midLon) * cosLat / cosRef;
  }

  return {
    cols, rows, lonPerUnit, latPerUnit, hxMin, hyMin, hxSpan, hySpan,

    // Geographic (lon, lat) → hex pixel coords (size = 1)
    geoToHexPixel(lon, lat) {
      const adjLon = correctedLon(lon, lat);
      return {
        hx: (adjLon - west) / lonPerUnit + hxMin,
        hy: (north - lat) / latPerUnit + hyMin,
      };
    },

    // Hex pixel coords → geographic
    hexPixelToGeo(hx, hy) {
      const lat = north - (hy - hyMin) * latPerUnit;
      const corrLon = west + (hx - hxMin) * lonPerUnit;
      return {
        lon: uncorrectedLon(corrLon, lat),
        lat,
      };
    },

    // Geographic → offset cell [col, row] or null if out of bounds
    geoToCell(lon, lat) {
      const adjLon = correctedLon(lon, lat);
      const hx = (adjLon - west) / lonPerUnit + hxMin;
      const hy = (north - lat) / latPerUnit + hyMin;
      const { col, row } = pixelToOffset(hx, hy, 1);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
      return [col, row];
    },

    // Offset cell → geographic center {lon, lat}
    cellCenter(col, row) {
      const { x, y } = offsetToPixel(col, row, 1);
      const lat = north - (y - hyMin) * latPerUnit;
      const corrLon = west + (x - hxMin) * lonPerUnit;
      return {
        lon: uncorrectedLon(corrLon, lat),
        lat,
      };
    },

    // Offset cell → geographic axis-aligned bounding box of the hex
    cellBbox(col, row) {
      const { x: cx, y: cy } = offsetToPixel(col, row, 1);
      const cellN = north - (cy - 1 - hyMin) * latPerUnit;
      const cellS = north - (cy + 1 - hyMin) * latPerUnit;
      const cellLat = (cellN + cellS) / 2;
      const corrW = west + (cx - SQRT3_2 - hxMin) * lonPerUnit;
      const corrE = west + (cx + SQRT3_2 - hxMin) * lonPerUnit;
      return {
        cellN,
        cellS,
        cellW: uncorrectedLon(corrW, cellLat),
        cellE: uncorrectedLon(corrE, cellLat),
      };
    },

    // N×N sample points within the hex cell (filtered to hex interior)
    cellSamplePoints(col, row, N) {
      const { cellN, cellS, cellW, cellE } = this.cellBbox(col, row);
      const { x: cx, y: cy } = offsetToPixel(col, row, 1);
      const dLat = cellN - cellS, dLon = cellE - cellW;
      const pts = [];
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const lat = cellN - (sy + 0.5) / N * dLat;
          const lon = cellW + (sx + 0.5) / N * dLon;
          // Point-in-hex test: convert to hex pixel space and check against
          // pointy-top hex boundary (size=1). The bbox corners extend beyond
          // the hex; sampling those would pull terrain from neighboring cells.
          const { hx, hy } = this.geoToHexPixel(lon, lat);
          const dx = Math.abs(hx - cx);
          const dy = Math.abs(hy - cy);
          // Pointy-top hex (size=1): dx ≤ √3/2 and dy ≤ 1 - dx/√3
          // Inset by 2% to avoid sampling neighboring cells at hex edges
          if (dy > 0.98 - dx / SQRT3) continue;
          pts.push({ lat, lon });
        }
      }
      return pts;
    },

    // Geographic rect → conservative grid cell range {r0, r1, c0, c1}
    geoRangeToGridRange(s, n, w, e) {
      const adjW = correctedLon(w, (s + n) / 2);
      const adjE = correctedLon(e, (s + n) / 2);
      const nwHx = (adjW - west) / lonPerUnit + hxMin;
      const nwHy = (north - n) / latPerUnit + hyMin;
      const seHx = (adjE - west) / lonPerUnit + hxMin;
      const seHy = (north - s) / latPerUnit + hyMin;
      return {
        r0: Math.max(0, Math.floor((nwHy - 1) / 1.5)),
        r1: Math.min(rows - 1, Math.ceil((seHy + 1) / 1.5)),
        c0: Math.max(0, Math.floor((nwHx - SQRT3_2) / SQRT3 - 0.5)),
        c1: Math.min(cols - 1, Math.ceil((seHx + SQRT3_2) / SQRT3 + 0.5)),
      };
    },
  };
}

function pip(lat, lng, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lon, yj = ring[j].lat, xj = ring[j].lon;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}

// Approximate polygon area in km² using shoelace formula on lat/lon
function polyAreaKm2(ring) {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].lon * ring[i].lat - ring[i].lon * ring[j].lat);
  }
  a = Math.abs(a) / 2;
  // Convert degree² to km² — approximate using mean latitude
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const latKm = 111.32; // km per degree latitude
  const lonKm = 111.32 * Math.cos(meanLat * Math.PI / 180); // km per degree longitude
  return a * latKm * lonKm;
}

function segLenKm(a, b) {
  // Fast equirectangular approximation — good enough for short segments
  const dLat = (b.lat - a.lat) * 111.32;
  const dLon = (b.lon - a.lon) * 111.32 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function buildIdx(areas, bbox, bC = 25, bR = 25) {
  const bW = (bbox.east - bbox.west) / bC, bH = (bbox.north - bbox.south) / bR;
  const bk = Array.from({ length: bR }, () => Array.from({ length: bC }, () => []));
  for (let ai = 0; ai < areas.length; ai++) {
    let mnLa = Infinity, mxLa = -Infinity, mnLo = Infinity, mxLo = -Infinity;
    for (const p of areas[ai].ring) { if (p.lat < mnLa) mnLa = p.lat; if (p.lat > mxLa) mxLa = p.lat; if (p.lon < mnLo) mnLo = p.lon; if (p.lon > mxLo) mxLo = p.lon; }
    const c0 = Math.max(0, Math.floor((mnLo - bbox.west) / bW)), c1 = Math.min(bC - 1, Math.floor((mxLo - bbox.west) / bW));
    const r0 = Math.max(0, Math.floor((mnLa - bbox.south) / bH)), r1 = Math.min(bR - 1, Math.floor((mxLa - bbox.south) / bH));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) bk[r][c].push(ai);
  }
  return { bk, bC, bR, bW, bH };
}

function qIdx(idx, bbox, lat, lng) {
  const c = Math.floor((lng - bbox.west) / idx.bW), r = Math.floor((lat - bbox.south) / idx.bH);
  if (r < 0 || r >= idx.bR || c < 0 || c >= idx.bC) return [];
  return idx.bk[r][c];
}

// Query spatial index for all polygons whose bbox overlaps a geographic rectangle
function qIdxRect(idx, bbox, south, north, west, east) {
  const c0 = Math.max(0, Math.floor((west - bbox.west) / idx.bW));
  const c1 = Math.min(idx.bC - 1, Math.floor((east - bbox.west) / idx.bW));
  const r0 = Math.max(0, Math.floor((south - bbox.south) / idx.bH));
  const r1 = Math.min(idx.bR - 1, Math.floor((north - bbox.south) / idx.bH));
  const seen = new Set();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    for (const ai of idx.bk[r][c]) seen.add(ai);
  }
  return [...seen];
}

// ════════════════════════════════════════════════════════════════
// GENERATION LOG
// ════════════════════════════════════════════════════════════════

class GenLog {
  constructor() {
    this.lines = [];
    this.t0 = Date.now();
  }
  _ts() { return `[${((Date.now() - this.t0) / 1000).toFixed(1)}s]`; }
  section(title) { this.lines.push("", `═══ ${title} ═══`); }
  info(msg) { this.lines.push(`${this._ts()} ${msg}`); }
  warn(msg) { this.lines.push(`${this._ts()} ⚠ ${msg}`); }
  error(msg) { this.lines.push(`${this._ts()} ✗ ${msg}`); }
  ok(msg) { this.lines.push(`${this._ts()} ✓ ${msg}`); }
  detail(msg) { this.lines.push(`       ${msg}`); }
  table(rows) {
    // rows: [[label, value], ...]
    const maxL = Math.max(...rows.map(r => r[0].length));
    rows.forEach(r => this.lines.push(`  ${r[0].padEnd(maxL + 2)}${r[1]}`));
  }
  toString() { return this.lines.join("\n"); }
}

// ════════════════════════════════════════════════════════════════
// ESA WORLDCOVER — satellite-derived land cover (10m, 11 classes)
// Primary terrain source. OSM refines with more specific types.
// ════════════════════════════════════════════════════════════════

const WC_CLASSES = {
  10: "forest",       // Tree cover
  20: "light_veg",    // Shrubland
  30: "light_veg",    // Grassland
  40: "farmland",      // Cropland
  50: "light_urban",  // Built-up
  60: "open_ground",  // Bare / sparse vegetation
  70: "ice",          // Snow and ice
  80: "lake",         // Permanent water bodies (refined by OSM + ocean detection)
  90: "wetland",      // Herbaceous wetland
  95: "wetland",      // Mangrove
  100: "open_ground", // Moss and lichen
};

function getWCTileId(lat, lng) {
  // Tiles are 3×3 degrees, named by SW corner
  const latBase = Math.floor(lat / 3) * 3;
  const lngBase = Math.floor(lng / 3) * 3;
  const ns = latBase >= 0 ? "N" : "S";
  const ew = lngBase >= 0 ? "E" : "W";
  return `${ns}${String(Math.abs(latBase)).padStart(2, "0")}${ew}${String(Math.abs(lngBase)).padStart(3, "0")}`;
}

function getWCTilesForBbox(bbox) {
  const tiles = new Map();
  const latStart = Math.floor(bbox.south / 3) * 3;
  const lngStart = Math.floor(bbox.west / 3) * 3;
  for (let lat = latStart; lat < bbox.north; lat += 3) {
    for (let lng = lngStart; lng < bbox.east; lng += 3) {
      const id = getWCTileId(lat, lng);
      tiles.set(id, { south: lat, north: lat + 3, west: lng, east: lng + 3 });
    }
  }
  return tiles;
}

async function fetchWorldCover(bbox, cols, rows, onS, onProg, log, tier) {
  const proj = createHexProjection(bbox, cols, rows);
  const tiles = getWCTilesForBbox(bbox);
  const wcGrid = {}, wcMix = {}, wcHasData = new Set();
  const isSubTac = tier === "sub-tactical";
  const SAMPLES_PER_CELL = isSubTac ? 5 : 20; // 5×5=25 at sub-tactical, 20×20=400 at other tiers

  if (log) {
    log.section("WORLDCOVER");
    log.table([
      ["Tiles needed", `${tiles.size}`],
      ["Tile IDs", [...tiles.keys()].join(", ")],
      ["Sampling", `${SAMPLES_PER_CELL}×${SAMPLES_PER_CELL} per cell (majority vote${isSubTac ? ", sub-tactical" : ", full accuracy"})`],
    ]);
  }

  // Accumulate WC raster sample counts across ALL tiles before resolving.
  // Previous approach resolved per-tile, so tile 2 would overwrite tile 1's
  // correct classification for boundary cells with a partial-coverage vote.
  const wcAccum = {}; // key → { counts: {wcClassValue: hitCount}, total: number }

  let tilesDone = 0;
  const WC_BASE = "/api/wc";

  for (const [tileId, tileBbox] of tiles) {
    onS(`WorldCover: tile ${tileId} (${tilesDone + 1}/${tiles.size})`);
    if (onProg) onProg({ phase: "WorldCover", current: tilesDone, total: tiles.size });

    const url = `${WC_BASE}/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tileId}_Map.tif`;

    try {
      const tiff = await fromUrl(url);
      const image = await tiff.getImage();
      const imgW = image.getWidth();
      const imgH = image.getHeight();

      // Intersection of tile with our bbox
      const isectS = Math.max(bbox.south, tileBbox.south);
      const isectN = Math.min(bbox.north, tileBbox.north);
      const isectW = Math.max(bbox.west, tileBbox.west);
      const isectE = Math.min(bbox.east, tileBbox.east);
      if (isectS >= isectN || isectW >= isectE) { tilesDone++; continue; }

      // Pixel window in the tile (origin = top-left = NW corner)
      const px0 = Math.max(0, Math.floor((isectW - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
      const py0 = Math.max(0, Math.floor((tileBbox.north - isectN) / (tileBbox.north - tileBbox.south) * imgH));
      const px1 = Math.min(imgW, Math.ceil((isectE - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
      const py1 = Math.min(imgH, Math.ceil((tileBbox.north - isectS) / (tileBbox.north - tileBbox.south) * imgH));

      // Grid cells overlapping this intersection (hex-aware range)
      const { r0: gridR0, r1: gridR1, c0: gridC0, c1: gridC1 } = proj.geoRangeToGridRange(isectS, isectN, isectW, isectE);
      const cellsInRange = (gridC1 - gridC0 + 1) * (gridR1 - gridR0 + 1);

      if (cellsInRange <= 0) { tilesDone++; continue; }

      // Read raster at reduced resolution — sized for SAMPLES_PER_CELL per cell
      const targetPixels = cellsInRange * SAMPLES_PER_CELL * SAMPLES_PER_CELL;
      const rasterAspect = (px1 - px0) / Math.max(1, py1 - py0);
      const outH = Math.max(1, Math.min(py1 - py0, Math.round(Math.sqrt(targetPixels / rasterAspect))));
      const outW = Math.max(1, Math.min(px1 - px0, Math.round(outH * rasterAspect)));

      const rasters = await image.readRasters({
        window: [px0, py0, px1, py1],
        width: outW,
        height: outH,
        resampleMethod: "nearest",
      });
      const data = rasters[0];

      // Inverse scale: geographic → raster pixel
      const isectLonSpan = isectE - isectW, isectLatSpan = isectN - isectS;

      // Accumulate raster sample counts per cell (merged across tiles later)
      let cellsClassified = 0;
      for (let r = gridR0; r <= gridR1; r++) {
        for (let c = gridC0; c <= gridC1; c++) {
          const k = `${c},${r}`;
          if (!wcAccum[k]) wcAccum[k] = { counts: {}, total: 0 };
          const acc = wcAccum[k];
          const samplePts = proj.cellSamplePoints(c, r, SAMPLES_PER_CELL);
          for (const pt of samplePts) {
            if (pt.lon < isectW || pt.lon > isectE || pt.lat < isectS || pt.lat > isectN) continue;
            const rx = Math.floor((pt.lon - isectW) / isectLonSpan * outW);
            const ry = Math.floor((isectN - pt.lat) / isectLatSpan * outH);
            if (rx < 0 || rx >= outW || ry < 0 || ry >= outH) continue;
            const val = data[ry * outW + rx];
            if (val !== undefined && val !== 0) {
              acc.counts[val] = (acc.counts[val] || 0) + 1;
              acc.total++;
            }
          }
          cellsClassified++;
        }
      }

      if (log) log.ok(`Tile ${tileId}: ${cellsClassified} cells (${outW}×${outH} samples read)`);
    } catch (e) {
      // 404 = ocean tile (expected), other errors = log warning
      const isOcean = e.message && (e.message.includes("404") || e.message.includes("Not Found"));
      if (isOcean) {
        if (log) log.info(`Tile ${tileId}: no data (ocean)`);
      } else {
        if (log) log.warn(`Tile ${tileId}: failed — ${e.message}`);
      }
    }

    tilesDone++;
    if (onProg) onProg({ phase: "WorldCover", current: tilesDone, total: tiles.size });
  }

  // Resolve majority vote from accumulated cross-tile counts
  for (const [k, acc] of Object.entries(wcAccum)) {
    let maxVal = 60, maxCnt = 0;
    for (const [v, cnt] of Object.entries(acc.counts)) {
      if (cnt > maxCnt) { maxVal = Number(v); maxCnt = cnt; }
    }
    wcGrid[k] = WC_CLASSES[maxVal] || "open_ground";
    if (acc.total > 0) wcHasData.add(k);
    if (acc.total > 0) {
      const mix = {};
      for (const [v, cnt] of Object.entries(acc.counts)) {
        const cls = WC_CLASSES[Number(v)] || "open_ground";
        mix[cls] = (mix[cls] || 0) + cnt / acc.total;
      }
      wcMix[k] = mix;
    }
  }

  // Fill any unset cells (ocean, failed tiles)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (!wcGrid[k]) wcGrid[k] = "open_ground"; // will be reclassified as ocean by post-processing
    }
  }

  if (log) {
    const counts = {};
    Object.values(wcGrid).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const total = cols * rows;
    log.ok(`WorldCover complete: ${Object.keys(wcGrid).length} cells`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
      log.detail(`${t.padEnd(16)} ${String(c).padStart(6)} (${((c / total) * 100).toFixed(1)}%)`);
    });
  }

  return { wcGrid, wcMix, wcHasData };
}

// ════════════════════════════════════════════════════════════════
// SCALE-ADAPTIVE OVERPASS QUERIES — v9 4-tier
// ════════════════════════════════════════════════════════════════
// Sub-tactical (<0.5km): squad-level — buildings, barriers, footpaths, ditches
// Tactical (0.5-2km): full OSM — refines WC with specific types
// Operational (2-8km): terrain + infrastructure
// Strategic (>=8km): infrastructure only — WC handles terrain

function getQueryTier(cellKm) {
  if (cellKm < 0.5) return "sub-tactical";
  if (cellKm < 2) return "tactical";
  if (cellKm < 8) return "operational";
  return "strategic";
}

function getChunkSize(tier) {
  if (tier === "sub-tactical") return 5;
  if (tier === "tactical") return 75;
  if (tier === "operational") return 150;
  return 200;
}

function buildQuery(bbox, tier) {
  const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;

  if (tier === "sub-tactical") {
    return `[out:json][timeout:300];(
way["natural"~"^(water|wood|scrub|grassland|heath|sand|wetland|glacier|cliff|tree_row|beach)$"]${b};
way["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow|military|quarry|cemetery|allotments|recreation_ground)$"]${b};
way["building"]${b};
way["barrier"~"^(wall|fence|hedge|city_wall|retaining_wall|ditch)$"]${b};
way["waterway"~"^(river|canal|stream|ditch|drain|riverbank|dam|weir)$"]${b};
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary|tertiary|residential|unclassified|service|track|footway|path|steps|pedestrian|cycleway)$"]${b};
way["railway"~"^(rail|light_rail|tram)$"]${b};
way["aeroway"~"^(aerodrome|runway|helipad)$"]${b};
way["leisure"~"^(park|garden|pitch|playground|marina)$"]${b};
way["amenity"="parking"]${b};
way["man_made"~"^(tower|water_tower|chimney|pier|pipeline)$"]${b};
way["power"~"^(tower|plant)$"]${b};
way["water"]${b};
node["man_made"~"^(dam|tower|water_tower|mast)$"]${b};
node["power"="tower"]${b};
relation["natural"~"^(water|wood)$"]${b};
relation["landuse"~"^(forest|residential|commercial|industrial)$"]${b};
relation["water"]${b};
node["place"~"^(city|town|village)$"]["name"]${b};
);out geom;`;
  }

  if (tier === "tactical") {
    return `[out:json][timeout:300];(
way["natural"~"^(water|wood|scrub|grassland|heath|sand|wetland|glacier|beach)$"]${b};
way["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow|military|quarry)$"]${b};
way["waterway"~"^(river|canal|stream|riverbank|dam)$"]${b};
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary|tertiary|track)$"]${b};
way["railway"="rail"]${b};
way["aeroway"~"^(aerodrome|runway)$"]${b};
way["landuse"="port"]${b};
way["harbour"="yes"]${b};
way["leisure"="marina"]${b};
way["power"="plant"]${b};
way["man_made"="pipeline"]${b};
way["barrier"="hedge"]${b};
way["water"]${b};
relation["natural"~"^(water|wood)$"]${b};
relation["landuse"~"^(forest|residential|commercial|industrial)$"]${b};
relation["water"]${b};
relation["waterway"="river"]["name"]${b};
node["place"~"^(city|town|village)$"]["name"]${b};
);out geom;`;
  }

  if (tier === "operational") {
    return `[out:json][timeout:300];(
way["natural"~"^(water|wetland|glacier|beach)$"]${b};
way["landuse"~"^(residential|commercial|industrial|retail|military|quarry)$"]${b};
way["waterway"~"^(river|canal|riverbank|dam)$"]${b};
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary)$"]${b};
way["railway"="rail"]${b};
way["aeroway"~"^(aerodrome|runway)$"]${b};
way["landuse"="port"]${b};
way["harbour"="yes"]${b};
way["power"="plant"]${b};
way["man_made"="pipeline"]${b};
way["barrier"="hedge"]${b};
way["water"]${b};
relation["natural"="water"]${b};
relation["landuse"~"^(residential|commercial|industrial)$"]${b};
relation["water"]${b};
relation["waterway"="river"]["name"]${b};
node["place"~"^(city|town|village)$"]["name"]${b};
);out geom;`;
  }

  // Strategic: infrastructure only — WorldCover handles all terrain
  return `[out:json][timeout:300];(
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary)$"]${b};
way["railway"="rail"]${b};
way["waterway"~"^(river|canal|dam)$"]${b};
way["aeroway"~"^(aerodrome|runway)$"]${b};
way["landuse"="military"]${b};
way["landuse"="port"]${b};
way["harbour"="yes"]${b};
node["man_made"="dam"]${b};
node["place"~"^(city|town|village)$"]["name"]${b};
relation["waterway"="river"]["name"]${b};
);out geom;`;
}

function buildFallbackQuery(bbox) {
  // Terrain-only: no roads/railways. Used when full query fails.
  const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  return `[out:json][timeout:300];(
way["natural"~"^(water|wood|scrub|grassland|heath|sand|wetland|glacier)$"]${b};
way["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow|military|quarry)$"]${b};
way["waterway"~"^(river|canal|riverbank|dam)$"]${b};
way["water"]${b};
relation["natural"~"^(water|wood)$"]${b};
relation["landuse"~"^(forest|residential|commercial|industrial)$"]${b};
relation["water"]${b};
);out geom;`;
}

async function fetchOSMChunk(bbox, tier, onS, label, log) {
  const q = buildQuery(bbox, tier);
  const qFallback = buildFallbackQuery(bbox);
  const t0 = Date.now();
  let retries = 0, status = "unknown";

  // Try main query with retries, escalating backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    onS(label ? `${label} (attempt ${attempt + 1})` : "Querying OSM...");
    try {
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST", body: `data=${encodeURIComponent(q)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      if (resp.ok) {
        const data = await resp.json();
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        if (log) log.ok(`${label}: ${data.elements.length} features in ${dt}s${retries > 0 ? ` (${retries} retries)` : ""}`);
        return data.elements;
      }
      retries++;
      if (log) log.warn(`${label}: HTTP ${resp.status}`);
    } catch (e) {
      retries++;
      if (log) log.warn(`${label}: network error — ${e.message}`);
    }
    if (attempt < 2) {
      const wait = attempt === 0 ? 8000 : 15000;
      onS(`${label || "Chunk"} failed, retry in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // Main query failed 3 times — try terrain-only fallback
  onS(`${label || "Chunk"} trying terrain-only fallback...`);
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: `data=${encodeURIComponent(qFallback)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    if (resp.ok) {
      const data = await resp.json();
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      if (log) log.warn(`${label}: FALLBACK ${data.elements.length} features in ${dt}s (terrain-only, no roads/rail)`);
      return data.elements;
    }
  } catch (e) {
    // fallback also failed
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (log) log.error(`${label}: FAILED completely after ${dt}s — 0 features (${retries} retries + fallback)`);
  return [];
}

async function fetchOSM(bbox, onS, onProg, mapWKm, mapHKm, cellKm, elevations, cols, rows, log) {
  const tier = getQueryTier(cellKm);
  const chunkKm = getChunkSize(tier);

  const chunksX = Math.max(1, Math.ceil(mapWKm / chunkKm));
  const chunksY = Math.max(1, Math.ceil(mapHKm / chunkKm));
  const totalChunks = chunksX * chunksY;

  if (log) {
    log.section("OSM QUERY");
    log.table([
      ["Query tier", tier],
      ["Chunk size", `${chunkKm}km`],
      ["Grid", `${chunksX}×${chunksY} = ${totalChunks} chunks`],
      ["Bbox", `${bbox.south.toFixed(3)},${bbox.west.toFixed(3)} → ${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`],
    ]);
  }

  // For single-chunk maps, skip all the chunking logic
  if (totalChunks === 1) {
    onS("Querying OpenStreetMap...");
    onProg({ phase: "OSM", current: 0, total: 1 });
    const els = await fetchOSMChunk(bbox, tier, onS, "OSM 1/1", log);
    onProg({ phase: "OSM", current: 1, total: 1 });
    onS(`Received ${els.length} features`);
    return els;
  }

  onS(`OSM [${tier}]: ${totalChunks} chunks (${chunksX}×${chunksY} @ ${chunkKm}km)...`);
  const latStep = (bbox.north - bbox.south) / chunksY;
  const lngStep = (bbox.east - bbox.west) / chunksX;

  // Pre-compute which chunks are ocean (all elevation points ≤ 1m)
  const oceanChunks = new Set();
  if (elevations && elevations.length > 0) {
    const osmProj = createHexProjection(bbox, cols, rows);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkS = bbox.south + cy * latStep, chunkN = bbox.south + (cy + 1) * latStep;
        const chunkW = bbox.west + cx * lngStep, chunkE = bbox.west + (cx + 1) * lngStep;
        // Find grid cells within this chunk (hex-aware range)
        const { r0, r1, c0, c1 } = osmProj.geoRangeToGridRange(chunkS, chunkN, chunkW, chunkE);
        let allOcean = true, count = 0;
        for (let r = r0; r <= r1; r += Math.max(1, Math.floor((r1 - r0) / 4))) {
          for (let c = c0; c <= c1; c += Math.max(1, Math.floor((c1 - c0) / 4))) {
            count++;
            if (elevations[r * cols + c] > 1) { allOcean = false; break; }
          }
          if (!allOcean) break;
        }
        if (allOcean && count >= 4) oceanChunks.add(`${cx},${cy}`);
      }
    }
    if (oceanChunks.size > 0) {
      onS(`Skipping ${oceanChunks.size}/${totalChunks} ocean chunks`);
      if (log) log.ok(`Ocean detection: ${oceanChunks.size}/${totalChunks} chunks are ocean — skipping`);
    } else if (log) {
      log.info("Ocean detection: no ocean chunks found");
    }
  }

  const landChunks = totalChunks - oceanChunks.size;
  const seen = new Set();
  const allElements = [];
  let completed = 0;
  const osmT0 = Date.now();

  if (log) log.info(`Querying ${landChunks} land chunks...`);

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const chunkIdx = cy * chunksX + cx + 1;

      if (oceanChunks.has(`${cx},${cy}`)) {
        onProg({ phase: "OSM", current: completed, total: landChunks, skipped: oceanChunks.size });
        continue;
      }

      const chunkBbox = {
        south: bbox.south + cy * latStep,
        north: bbox.south + (cy + 1) * latStep,
        west: bbox.west + cx * lngStep,
        east: bbox.west + (cx + 1) * lngStep,
      };
      const label = `OSM ${completed + 1}/${landChunks}`;
      try {
        const els = await fetchOSMChunk(chunkBbox, tier, onS, label, log);
        for (const el of els) {
          const key = `${el.type}:${el.id}`;
          if (!seen.has(key)) { seen.add(key); allElements.push(el); }
        }
      } catch (e) {
        if (log) log.error(`Chunk ${chunkIdx} exception: ${e.message}`);
      }
      completed++;
      onProg({ phase: "OSM", current: completed, total: landChunks, skipped: oceanChunks.size });

      // Delay scales with chunk count to avoid rate limiting
      if (completed < landChunks) {
        const delay = landChunks > 50 ? 2000 : landChunks > 20 ? 1500 : 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const osmDt = ((Date.now() - osmT0) / 1000).toFixed(1);
  onS(`Received ${allElements.length} features from ${landChunks} land chunks (${oceanChunks.size} ocean skipped)`);
  if (log) {
    log.ok(`OSM complete: ${allElements.length} unique features in ${osmDt}s`);
    log.detail(`${landChunks} land chunks queried, ${oceanChunks.size} ocean skipped`);
  }
  return allElements;
}

// ════════════════════════════════════════════════════════════════
// ELEVATION — dual provider, Open Topo Data primary (via proxy)
// ════════════════════════════════════════════════════════════════

async function fetchElev(pts, onS, onProg, log) {
  const BATCH = 100;
  const el = new Array(pts.length).fill(null);
  const batches = Math.ceil(pts.length / BATCH);
  let successCount = 0, failCount = 0;
  let providerSwitches = 0;

  const providers = [
    {
      name: "OpenTopoData",
      url: (sl) => `/api/topo/v1/srtm30m?locations=${sl.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|")}`,
      parse: (d) => d.results ? d.results.map(r => r.elevation) : null,
      delay: 1100,
    },
    {
      name: "Open-Meteo",
      url: (sl) => `https://api.open-meteo.com/v1/elevation?latitude=${sl.map(p => p.lat.toFixed(4)).join(",")}&longitude=${sl.map(p => p.lng.toFixed(4)).join(",")}`,
      parse: (d) => d.elevation || null,
      delay: 250,
    },
  ];

  let activeProvider = 0;

  for (let b = 0; b < batches; b++) {
    const s = b * BATCH, sl = pts.slice(s, s + BATCH);
    const prov = providers[activeProvider];
    onS(`Elevation [${prov.name}]: ${b + 1}/${batches}`);
    if (onProg) onProg({ phase: "Elevation", current: b + 1, total: batches });

    let success = false;
    for (let provIdx = activeProvider; provIdx < providers.length; provIdx++) {
      const p = providers[provIdx];
      try {
        const url = p.url(sl);
        let r, retries = 0;
        while (retries < 2) {
          r = await fetch(url);
          if (r.status === 429) {
            retries++;
            if (retries >= 2) break;
            onS(`Elevation [${p.name}]: rate limited, waiting 60s...`);
            await new Promise(res => setTimeout(res, 60000));
            continue;
          }
          break;
        }
        if (r && r.ok) {
          const d = await r.json();
          const elevs = p.parse(d);
          if (elevs && elevs.length === sl.length) {
            for (let i = 0; i < elevs.length; i++) el[s + i] = elevs[i] ?? null;
            successCount += sl.length;
            if (provIdx !== activeProvider && log) {
              log.warn(`Elevation: switched to ${p.name} at batch ${b + 1}`);
            }
            activeProvider = provIdx;
            success = true;
            break;
          }
        } else if (r) {
          if (log) log.warn(`Elev [${p.name}] batch ${b + 1}: HTTP ${r.status}`);
          continue;
        }
      } catch (e) {
        if (log) log.warn(`Elev [${p.name}] batch ${b + 1}: ${e.message}`);
        continue;
      }
    }

    if (!success) {
      failCount += sl.length;
      if (log) log.error(`Elevation batch ${b + 1}/${batches}: all providers failed`);
    }
    const delay = providers[activeProvider].delay;
    if (b < batches - 1) await new Promise(r => setTimeout(r, delay));
  }

  onS(`Elevation done: ${successCount} ok, ${failCount} failed of ${pts.length}`);
  const coverage = el.filter(v => v !== null).length / el.length;
  if (log) {
    log.ok(`Elevation complete: ${successCount}/${pts.length} points (${(coverage * 100).toFixed(0)}% coverage)`);
    if (failCount > 0) log.warn(`${failCount} points failed`);
    log.detail(`Provider: ${providers[activeProvider].name}, ${batches} batches`);
  }
  return { elevations: el.map(v => v ?? 0), coverage };
}

// ════════════════════════════════════════════════════════════════
// ELEVATION SAMPLING + INTERPOLATION
// ════════════════════════════════════════════════════════════════

async function fetchElevSmart(bbox, cols, rows, onS, onProg, log) {
  const proj = createHexProjection(bbox, cols, rows);
  const totalCells = cols * rows;
  const SAMPLE_THRESHOLD = 5000;

  if (log) {
    log.section("ELEVATION");
    log.table([
      ["Grid cells", `${cols}×${rows} = ${totalCells}`],
      ["Sampling", totalCells <= SAMPLE_THRESHOLD ? "full (every cell)" : `interpolated (threshold: ${SAMPLE_THRESHOLD})`],
    ]);
  }

  if (totalCells <= SAMPLE_THRESHOLD) {
    const pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const { lon, lat } = proj.cellCenter(c, r);
      pts.push({ lat, lng: lon });
    }
    return await fetchElev(pts, onS, onProg, log);
  }

  // Sample on coarser grid
  const step = Math.max(2, Math.ceil(Math.sqrt(totalCells / SAMPLE_THRESHOLD)));
  const sampleR = [], sampleC = [];
  for (let r = 0; r < rows; r += step) sampleR.push(r);
  if (sampleR[sampleR.length - 1] !== rows - 1) sampleR.push(rows - 1);
  for (let c = 0; c < cols; c += step) sampleC.push(c);
  if (sampleC[sampleC.length - 1] !== cols - 1) sampleC.push(cols - 1);

  onS(`Elevation: sampling ${sampleR.length}×${sampleC.length} = ${sampleR.length * sampleC.length} points (${step}x reduction)...`);
  if (log) log.info(`Sampling ${sampleR.length}×${sampleC.length} = ${sampleR.length * sampleC.length} points (${step}x reduction, bicubic interpolation)`);

  const pts = [];
  for (const r of sampleR) for (const c of sampleC) {
    const { lon, lat } = proj.cellCenter(c, r);
    pts.push({ lat, lng: lon });
  }
  const sampledElev = await fetchElev(pts, onS, onProg, log);

  // Build sparse grid
  const sparse = {};
  let idx = 0;
  for (const r of sampleR) for (const c of sampleC) {
    sparse[`${c},${r}`] = sampledElev.elevations[idx++];
  }

  // Bicubic (Catmull-Rom) interpolation — preserves peaks and ridgelines better than bilinear
  onS("Interpolating elevation (bicubic)...");

  // Catmull-Rom 1D spline: interpolates between p1 and p2, using p0 and p3 as tangent guides
  function catmullRom(t, p0, p1, p2, p3) {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  // Helper: find the bracketing index i such that arr[i] <= val <= arr[i+1]
  function findBracket(arr, val) {
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] <= val && arr[i + 1] >= val) return i;
    }
    return arr.length - 2; // clamp to last bracket
  }

  // Helper: get sparse sample value with boundary clamping
  function sGet(ci, ri) {
    const cc = sampleC[Math.max(0, Math.min(ci, sampleC.length - 1))];
    const rr = sampleR[Math.max(0, Math.min(ri, sampleR.length - 1))];
    return sparse[`${cc},${rr}`] || 0;
  }

  const fullElev = new Array(totalCells).fill(0);
  for (let r = 0; r < rows; r++) {
    const ri = findBracket(sampleR, r);
    const tr = sampleR[ri] === sampleR[ri + 1] ? 0 : (r - sampleR[ri]) / (sampleR[ri + 1] - sampleR[ri]);
    const targetParity = r & 1; // hex row parity for offset adjustment

    for (let c = 0; c < cols; c++) {
      const ci = findBracket(sampleC, c);

      // Bicubic separable: interpolate 4 rows along columns, then interpolate the 4 results along rows.
      // Hex correction: in odd-r offset coords, odd rows are shifted right by half a cell width.
      // When interpolating across rows with different parities, adjust the column parameter
      // to account for this shift, preventing rectangular banding in elevation data.
      const rowVals = [];
      for (let dr = -1; dr <= 2; dr++) {
        const rIdx = ri + dr;
        const sRow = sampleR[Math.max(0, Math.min(rIdx, sampleR.length - 1))];
        const hexShift = 0.5 * (targetParity - (sRow & 1));
        const cAdj = c + hexShift;
        const tcAdj = sampleC[ci] === sampleC[ci + 1] ? 0 :
          Math.max(0, Math.min(1, (cAdj - sampleC[ci]) / (sampleC[ci + 1] - sampleC[ci])));
        rowVals.push(catmullRom(tcAdj, sGet(ci - 1, rIdx), sGet(ci, rIdx), sGet(ci + 1, rIdx), sGet(ci + 2, rIdx)));
      }
      const val = catmullRom(tr, rowVals[0], rowVals[1], rowVals[2], rowVals[3]);

      // Clamp to prevent Catmull-Rom overshoot beyond local min/max
      const localMin = Math.min(sGet(ci, ri), sGet(ci + 1, ri), sGet(ci, ri + 1), sGet(ci + 1, ri + 1));
      const localMax = Math.max(sGet(ci, ri), sGet(ci + 1, ri), sGet(ci, ri + 1), sGet(ci + 1, ri + 1));
      const margin = (localMax - localMin) * 0.25; // allow 25% overshoot for natural curvature
      fullElev[r * cols + c] = Math.max(localMin - margin, Math.min(localMax + margin, val));
    }
  }

  return { elevations: fullElev, coverage: sampledElev.coverage };
}

// ════════════════════════════════════════════════════════════════
// ARIDITY DATA (precipitation-based desert classification)
// ════════════════════════════════════════════════════════════════

async function fetchAridityData(bbox, cols, rows, onS, log) {
  // Sample precipitation at a coarse grid (~5x5 = 25 points) across the map
  // Uses Open-Meteo Archive API for mean annual precipitation
  const ARIDITY_SAMPLES = 5;
  const latStep = (bbox.north - bbox.south) / (ARIDITY_SAMPLES - 1);
  const lonStep = (bbox.east - bbox.west) / (ARIDITY_SAMPLES - 1);
  const points = [];
  for (let ri = 0; ri < ARIDITY_SAMPLES; ri++) {
    for (let ci = 0; ci < ARIDITY_SAMPLES; ci++) {
      points.push({
        lat: bbox.south + ri * latStep,
        lon: bbox.west + ci * lonStep,
      });
    }
  }

  try {
    const lats = points.map(p => p.lat.toFixed(4)).join(",");
    const lons = points.map(p => p.lon.toFixed(4)).join(",");
    // Fetch daily precipitation sum for a full recent year
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&start_date=2023-01-01&end_date=2023-12-31&daily=precipitation_sum&timezone=UTC`;
    const resp = await fetch(url);
    if (!resp.ok) {
      if (log) log.warn(`Aridity fetch: HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();

    // Parse response: array of locations, each with daily precipitation arrays
    // Sum daily values to get annual total per sample point
    const annualPrecip = [];
    if (Array.isArray(data)) {
      // Multi-location response: array of objects
      for (const loc of data) {
        const daily = loc.daily?.precipitation_sum;
        if (daily && Array.isArray(daily)) {
          const total = daily.reduce((s, v) => s + (v || 0), 0);
          annualPrecip.push(total);
        } else {
          annualPrecip.push(null);
        }
      }
    } else if (data.daily?.precipitation_sum) {
      // Single-location response
      const total = data.daily.precipitation_sum.reduce((s, v) => s + (v || 0), 0);
      annualPrecip.push(total);
    }

    if (annualPrecip.length === 0 || annualPrecip.every(v => v === null)) {
      if (log) log.warn("Aridity fetch: no precipitation data in response");
      return null;
    }

    // Bilinear interpolation across the full grid
    const precipGrid = {};
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Map cell position to sample grid
        const fracR = (r / Math.max(1, rows - 1)) * (ARIDITY_SAMPLES - 1);
        const fracC = (c / Math.max(1, cols - 1)) * (ARIDITY_SAMPLES - 1);
        const r0 = Math.min(Math.floor(fracR), ARIDITY_SAMPLES - 2);
        const r1 = r0 + 1;
        const c0 = Math.min(Math.floor(fracC), ARIDITY_SAMPLES - 2);
        const c1 = c0 + 1;
        const tr = fracR - r0, tc = fracC - c0;
        const v00 = annualPrecip[r0 * ARIDITY_SAMPLES + c0] || 0;
        const v10 = annualPrecip[r0 * ARIDITY_SAMPLES + c1] || 0;
        const v01 = annualPrecip[r1 * ARIDITY_SAMPLES + c0] || 0;
        const v11 = annualPrecip[r1 * ARIDITY_SAMPLES + c1] || 0;
        precipGrid[`${c},${r}`] = v00 * (1 - tc) * (1 - tr) + v10 * tc * (1 - tr) + v01 * (1 - tc) * tr + v11 * tc * tr;
      }
    }

    if (log) log.ok(`Aridity: ${annualPrecip.filter(v => v !== null).length}/${points.length} sample points, interpolated to ${cols}×${rows} grid`);
    return precipGrid;
  } catch (err) {
    if (log) log.warn(`Aridity fetch failed: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// PARSE FEATURES
// ════════════════════════════════════════════════════════════════

function parseFeatures(elements, tier) {
  const terrAreas = [], infraAreas = [], infraLines = [], waterLines = [];
  const streamLines = [], damNodes = [], buildingAreas = [], barrierLines = [], towerNodes = [];
  const beachAreas = [], pipelineLines = [], powerPlantAreas = [], navigableLines = [];
  const placeNodes = []; // Settlement names
  const hedgeLines = []; // barrier=hedge at all tiers for density analysis

  for (const el of elements) {
    const tags = el.tags || {};

    // ── Nodes ──
    if (el.type === "node") {
      if (tags.man_made === "dam" || tags.waterway === "dam") damNodes.push({ lat: el.lat, lon: el.lon, onRiver: !!(tags.waterway) });
      if (tier === "sub-tactical" && (tags.man_made === "tower" || tags.man_made === "water_tower" || tags.man_made === "mast" || tags.power === "tower"))
        towerNodes.push({ lat: el.lat, lon: el.lon });
      // Place nodes — named settlements
      if (tags.place && tags.name) {
        const rank = tags.place === "city" ? 3 : tags.place === "town" ? 2 : tags.place === "village" ? 1 : 0;
        if (rank > 0) placeNodes.push({ lat: el.lat, lon: el.lon, name: tags.name, place: tags.place, rank, population: parseInt(tags.population) || 0 });
      }
    }

    // ── Ways ──
    if (el.type === "way" && el.geometry) {
      const ring = el.geometry;
      const closed = ring.length > 2 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon;

      // Terrain areas
      if (closed || tags.natural === "water" || tags.water || tags.landuse) {
        let tt = null, tp = 0;
        if (tags.natural === "water" || tags.water) {
          const wt = tags.water || "";
          if (wt === "river" || tags.waterway === "riverbank") {
            // At operational/strategic, river areas are just water bodies — use "lake"
            if (tier === "operational" || tier === "strategic") { tt = "lake"; tp = 15; }
            else { tt = "river"; tp = 15; }
          }
          else { tt = "lake"; tp = 15; }
        }
        if (tags.natural === "wood" || tags.landuse === "forest") { tt = "forest"; tp = 10; }
        if (tags.natural === "scrub" || tags.natural === "heath" || tags.natural === "grassland") { tt = "light_veg"; tp = 7; }
        if (tags.landuse === "farmland" || tags.landuse === "meadow") { tt = "farmland"; tp = 6; }
        if (tags.natural === "wetland") { tt = "wetland"; tp = 12; }
        if (tags.natural === "sand") { tt = "desert"; tp = 9; }
        if (tags.natural === "glacier") { tt = "ice"; tp = 14; }
        if (tags.landuse === "residential") { if (tier === "operational" || tier === "strategic") { tt = "light_urban"; tp = 18; } }
        if (tags.landuse === "commercial" || tags.landuse === "retail") { tt = "light_urban"; tp = 18; }
        if (tags.landuse === "industrial") { tt = "light_urban"; tp = 18; }
        if (tags.landuse === "quarry") { tt = "open_ground"; tp = 5; }
        // Sub-tactical specific terrain
        if (tier === "sub-tactical") {
          if (tags.landuse === "cemetery") { tt = "open_ground"; tp = 5; }
          if (tags.landuse === "allotments" || tags.landuse === "recreation_ground") { tt = "light_veg"; tp = 5; }
          if (tags.leisure === "park" || tags.leisure === "garden") { tt = "light_veg"; tp = 6; }
          if (tags.leisure === "pitch" || tags.leisure === "playground") { tt = "open_ground"; tp = 5; }
          if (tags.amenity === "parking" && closed) infraAreas.push({ type: "parking", pri: 15, ring });
        }
        if (tt) terrAreas.push({ type: tt, pri: tp, ring });
      }

      // Infra areas
      if (tags.landuse === "military" && closed) infraAreas.push({ type: "military_base", pri: 25, ring, hasName: !!tags.name, isMilitary: !!tags.military, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
      if (tags.aeroway && closed) infraAreas.push({ type: (tags.aeroway === "helipad" && tier === "sub-tactical") ? "helipad" : "airfield", pri: 26, ring, hasName: !!tags.name, isMilitary: !!tags.military, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
      if ((tags.landuse === "port" || tags.industrial === "port" || tags.harbour === "yes") && closed) infraAreas.push({ type: "port", pri: 24, ring, hasName: !!tags.name, isMilitary: false, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
      if (tags.leisure === "marina" && closed && (tier === "sub-tactical" || tier === "tactical")) infraAreas.push({ type: "port", pri: 23, ring });

      // Beach areas
      if (tags.natural === "beach") beachAreas.push({ ring });

      // Power plants — filter by source type
      if (tags.power === "plant" && closed) {
        const src = (tags["plant:source"] || tags["generator:source"] || "").toLowerCase();
        // Strategic sources: nuclear, fossil fuel, hydro
        const isStrategic = /nuclear|coal|gas|oil|hydro|fossil/.test(src);
        if (isStrategic) {
          powerPlantAreas.push({ ring, source: src });
        } else if (!src && (tier === "sub-tactical" || tier === "tactical")) {
          // Unknown source — show at small scales only
          powerPlantAreas.push({ ring, source: "unknown" });
        }
        // Solar, wind, biomass, geothermal — dropped
      }

      // Pipelines (linear features)
      if (tags.man_made === "pipeline" && !closed) pipelineLines.push({ nodes: ring });

      // Buildings (sub-tactical only)
      if (tier === "sub-tactical" && tags.building && closed) buildingAreas.push({ ring });

      // Barriers (sub-tactical only)
      if (tier === "sub-tactical" && tags.barrier) {
        const bt = tags.barrier;
        if (["wall", "city_wall", "retaining_wall"].includes(bt)) barrierLines.push({ type: "wall", nodes: ring });
        else if (bt === "fence") barrierLines.push({ type: "fence", nodes: ring });
        else if (bt === "hedge") barrierLines.push({ type: "hedge", nodes: ring });
      }

      // Hedge lines for density analysis (all tiers that query hedges)
      if (tags.barrier === "hedge") hedgeLines.push({ nodes: ring });

      // Roads — tier-filtered
      if (tags.highway) {
        const hw = tags.highway, br = !!(tags.bridge && tags.bridge !== "no"), tn = !!(tags.tunnel && tags.tunnel !== "no");
        let lt = null;
        if (hw === "motorway" || hw === "motorway_link" || hw === "trunk" || hw === "trunk_link") lt = "highway";
        else if (hw === "primary" || hw === "secondary") lt = "major_road";
        else if (hw === "tertiary") { lt = (tier === "sub-tactical" || tier === "tactical") ? "road" : null; }
        else if (hw === "residential" || hw === "unclassified") { lt = tier === "sub-tactical" ? "road" : null; }
        else if (hw === "service") { lt = tier === "sub-tactical" ? "minor_road" : null; }
        else if (hw === "track") { lt = (tier === "sub-tactical" || tier === "tactical") ? "trail" : null; }
        else if (["footway", "path", "steps", "pedestrian", "cycleway"].includes(hw)) { lt = tier === "sub-tactical" ? "footpath" : null; }
        if (lt) infraLines.push({ type: lt, isBridge: br, isTunnel: tn, nodes: ring });
      }

      // Railways — tier-filtered
      if (tags.railway === "rail") infraLines.push({ type: "railway", isBridge: !!(tags.bridge && tags.bridge !== "no"), isTunnel: !!(tags.tunnel && tags.tunnel !== "no"), nodes: ring });
      if (tier === "sub-tactical" && (tags.railway === "light_rail" || tags.railway === "tram")) infraLines.push({ type: "light_rail", isBridge: false, isTunnel: false, nodes: ring });

      // Waterways — tier-filtered
      if (tags.waterway && !closed) {
        if (["river", "canal"].includes(tags.waterway)) {
          waterLines.push({ type: "river", nodes: ring });
          // Navigable tracking: name tag is primary signal at strategic/operational
          const isCanal = tags.waterway === "canal";
          const hasShip = tags.ship === "yes";
          const hasBoat = tags.boat === "yes" || tags.motorboat === "yes";
          const hasName = !!tags.name;
          const actualName = tags.name || "";
          if (hasShip) {
            navigableLines.push({ nodes: ring, tagged: true, named: hasName, actualName, isCanal });
          } else if ((isCanal || hasBoat) && (tier === "sub-tactical" || tier === "tactical")) {
            // Canals and boat-tagged ways auto-navigable at small scales only
            navigableLines.push({ nodes: ring, tagged: true, named: hasName, actualName, isCanal });
          } else if (tags.waterway === "river") {
            navigableLines.push({ nodes: ring, tagged: false, named: hasName, actualName, isCanal: false });
          } else if (isCanal) {
            // Canals at operational/strategic/theater: need whitelist name match
            navigableLines.push({ nodes: ring, tagged: false, named: hasName, actualName, isCanal: true });
          }
        }
        if (tags.waterway === "stream" && (tier === "sub-tactical" || tier === "tactical")) streamLines.push({ nodes: ring });
        if (tags.waterway === "dam") damNodes.push({ lat: ring[0].lat, lon: ring[0].lon, isWay: true, onRiver: true });
        if (tags.waterway === "weir" && tier === "sub-tactical") damNodes.push({ lat: ring[0].lat, lon: ring[0].lon, isWay: true, onRiver: false });
        if (tier === "sub-tactical" && ["ditch", "drain"].includes(tags.waterway)) streamLines.push({ nodes: ring, isDitch: true });
      }
    }

    // ── Relations ──
    if (el.type === "relation" && el.members) {
      let tt = null, tp = 0;
      if (tags.natural === "water" || tags.water) {
        if (tags.water === "river" && (tier === "sub-tactical" || tier === "tactical")) tt = "river";
        else tt = "lake";
        tp = 15;
      }
      if (tags.natural === "wood" || tags.landuse === "forest") { tt = "forest"; tp = 10; }
      if (tags.landuse === "residential") { if (tier === "operational" || tier === "strategic") { tt = "light_urban"; tp = 18; } }
      if (tags.landuse === "commercial" || tags.landuse === "industrial") { tt = "light_urban"; tp = 18; }
      for (const m of el.members) {
        if (m.role === "outer" && m.geometry) { if (tt) terrAreas.push({ type: tt, pri: tp, ring: m.geometry }); }
      }

      // Waterway relations — named river systems
      // All member ways of a named waterway relation are navigable
      if (tags.waterway && tags.name) {
        const relName = tags.name;
        for (const m of el.members) {
          if (m.geometry && m.geometry.length > 1) {
            // Only linear members (main_stream, side_stream, etc), not area members
            const geom = m.geometry;
            const isClosed = geom.length > 2 && geom[0].lat === geom[geom.length - 1].lat && geom[0].lon === geom[geom.length - 1].lon;
            if (!isClosed) {
              waterLines.push({ type: "river", nodes: geom });
              navigableLines.push({ nodes: geom, tagged: false, named: true, fromRelation: true, actualName: relName });
            }
          }
        }
      }
    }
  }

  terrAreas.sort((a, b) => a.pri - b.pri);
  return { terrAreas, infraAreas, infraLines, waterLines, streamLines, damNodes, buildingAreas, barrierLines, towerNodes, beachAreas, pipelineLines, powerPlantAreas, navigableLines, placeNodes, hedgeLines };
}

// ════════════════════════════════════════════════════════════════
// CLASSIFY
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// MAJOR CANALS — canals with strategic/military significance.
// At operational/strategic/theater, ALL canals are filtered out except these.
// Canals still render as water features (blue lines); only navigability is suppressed.
// ════════════════════════════════════════════════════════════════
const MAJOR_CANALS = new Set([
  // The world's most strategically significant canals
  "suez", "panama", "kiel", "grand canal", "corinth",
  "volga-don", "volga–don",
  "white sea-baltic", "white sea–baltic", "belomorkanal",
  // Common OSM alternate names / translations
  "canal de suez", "suezkanal", "canale di suez",
  "canal de panamá", "panamakanal",
  "nord-ostsee-kanal", "kaiser-wilhelm-kanal",
  "canal de corinthe",
  "beijing-hangzhou grand canal", "jing-hang grand canal",
  "京杭大运河", "大运河",
]);

// ════════════════════════════════════════════════════════════════
// RIVER WHITELIST — curated list of significant rivers for strategic/operational
// Returns a Set of lowercase river names (same shape as fetchWikidataRivers).
// ════════════════════════════════════════════════════════════════
function getRiverWhitelistNames(tier, cellKm) {
  const names = new Set();
  // Theater (≥15km cells): scalerank 0-5 (continental rivers + significant crossings)
  // Strategic: scalerank 0-6 (adds medium-scale rivers)
  // Operational: scalerank 0-7 (all included rivers)
  const maxScalerank = cellKm >= 15 ? 5 : tier === "strategic" ? 6 : 7;
  for (const r of riverWhitelistData.rivers) {
    if (!r.include) continue;
    if (r.scalerank > maxScalerank) continue;
    if (r.name) names.add(r.name.toLowerCase());
    if (r.name_alt) names.add(r.name_alt.toLowerCase());
  }
  return names;
}

// ════════════════════════════════════════════════════════════════
// WIKIDATA RIVER LOOKUP
// Queries Wikidata for major rivers (by length) in/near the bbox.
// Returns a Set of normalized river names for matching against OSM.
// ════════════════════════════════════════════════════════════════
async function fetchWikidataRivers(bbox, tier, log, cellKm) {
  // Length thresholds by tier (km)
  // Theater (≥15km cells): 100km — matches strategic (scalerank ≤5 aligns with ≥100km rivers)
  const minLength = cellKm >= 15 ? 100 : tier === "strategic" ? 100 : tier === "operational" ? 40 : 15;

  // Expand bbox by 5° to catch rivers whose coordinate is outside but path goes through
  const expand = 5;
  const s = bbox.south - expand, n = bbox.north + expand;
  const w = bbox.west - expand, e = bbox.east + expand;

  // SPARQL query: rivers + canals with length > threshold, coordinate within expanded bbox
  // Uses wikibase:box for geographic filtering (reliable on Wikidata)
  // Gets labels in Western European languages + key regional languages for OSM name matching
  const langs = '"en","fr","de","it","es","pt","nl","ca","oc","ru","ar","fa","tr","pl","cs","ro","hu","uk"';
  const sparql = `
SELECT ?river ?length ?name WHERE {
  VALUES ?type { wd:Q4022 wd:Q12284 }
  ?river wdt:P31 ?type ;
         wdt:P2043 ?length .
  ?river rdfs:label ?name .
  FILTER(?length >= ${minLength})
  FILTER(LANG(?name) IN (${langs}))
  SERVICE wikibase:box {
    ?river wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
}
LIMIT 10000`.trim();

  const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(sparql);

  try {
    if (log) log.section("WIKIDATA RIVERS");
    if (log) log.info(`Querying rivers ≥ ${minLength}km in expanded bbox (${s.toFixed(1)}–${n.toFixed(1)}°N, ${w.toFixed(1)}–${e.toFixed(1)}°E)`);

    const resp = await fetch(url, {
      // TSV format is far more robust than JSON for Wikidata — no nested structure to break
      // from unescaped quotes/control chars in multi-language labels
      headers: { "Accept": "text/tab-separated-values", "User-Agent": "TerrainParser/1.0" }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rawText = await resp.text();
    if (log) log.detail(`Wikidata response: ${rawText.length} chars (TSV)`);

    // Parse TSV: header line then data lines
    // Format: ?river\t?length\t?name
    // Values: <http://www.wikidata.org/entity/Q584>\t"812"^^<...>\t"Rhône"@fr
    const lines = rawText.split("\n");
    const riverMap = new Map(); // wikidataId → { label, length, names: Set }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;

      // Extract river ID from URI: <http://www.wikidata.org/entity/Q584> → Q584
      const idMatch = parts[0].match(/Q\d+/);
      if (!idMatch) continue;
      const id = idMatch[0];

      // Extract length: "812"^^<...> or just 812
      const lengthMatch = parts[1].match(/[\d.]+/);
      if (!lengthMatch) continue;
      const length = parseFloat(lengthMatch[0]);

      // Extract name: "Rhône"@fr → Rhône
      const nameMatch = parts[2].match(/^"(.+)"(@\w+)?/);
      const name = nameMatch ? nameMatch[1] : parts[2].replace(/"/g, "");

      if (!riverMap.has(id)) {
        riverMap.set(id, { label: name, length, names: new Set() });
      }
      if (name && name.length >= 1) {
        riverMap.get(id).names.add(name.toLowerCase());
      }
    }

    // ── GARBAGE LENGTH FILTER ──
    // Wikidata has data quality issues: small canals/streams with length in meters entered as km
    // (e.g. "Canal de Bellús" at 7158 km, "Weißbach" at 1500 km, "Torrent de Boteric" at 1481 km).
    // Fix: any river claiming >500km must match a whitelist of the world's ~315 known major rivers.
    // Rivers ≤500km pass without checking (m→km errors on those would be <0.5km, below query threshold).
    const KNOWN_RIVERS = new Set([
      // ── AFRICA ──
      "nile", "nil", "nilo", "congo", "zaïre", "zaire", "niger", "zambezi", "orange",
      "limpopo", "senegal", "volta", "blue nile", "white nile", "kasai", "ubangi",
      "benue", "jubba", "shabelle", "atbara", "sobat", "chari", "logone",
      "okavango", "cuando", "cunene", "rufiji", "ruvuma", "rovuma", "tana",
      "omo", "awash", "draa", "moulouya", "cheliff", "bandama", "sassandra",
      "cavally", "gambia", "sanaga", "ogooué", "ogoue", "kwango", "lomami",
      "lualaba", "kafue", "luangwa", "vaal", "tugela", "fish",
      // ── AMERICAS (North) ──
      "amazon", "amazonas", "amazzoni", "mississippi", "missouri", "yukon",
      "rio grande", "arkansas", "colorado", "red", "columbia", "snake", "ohio",
      "nelson", "saskatchewan", "mackenzie", "fraser", "churchill",
      "pecos", "brazos", "cimarron", "platte", "yellowstone", "bighorn",
      "powder", "tongue", "james", "white", "ouachita", "sabine",
      "trinity", "neches", "nueces", "gila", "verde",
      "republican", "smoky hill", "niobrara", "loup",
      "cheyenne", "minnesota", "des moines", "cedar",
      "illinois", "wabash", "cumberland", "green", "tennessee", "canadian",
      "san juan", "willamette", "klamath", "sacramento", "san joaquin",
      "athabasca", "peace", "liard", "slave", "hay",
      "winnipeg", "assiniboine", "souris", "albany", "severn", "moose",
      // ── AMERICAS (South) ──
      "paraná", "parana", "paraguay", "uruguay", "tocantins",
      "são francisco", "sao francisco", "orinoco", "madeira", "purus",
      "japurá", "japura", "rio negro", "negro", "pilcomayo", "bermejo",
      "xingu", "tapajós", "tapajos", "araguaia", "juruá", "jurua",
      "içá", "ica", "guaporé", "guapore", "beni", "mamoré", "mamore",
      "ucayali", "huallaga", "marañón", "maranon",
      "cauca", "magdalena", "apure", "caroní", "caroni",
      "salado", "deseado", "chubut", "bío-bío", "biobio",
      // ── EUROPE ──
      "volga", "волга", "danube", "donau", "danubio", "dunaj", "dunav", "dunărea", "tuna",
      "ural", "dnieper", "dnepr", "dnipro", "дніпро", "don",
      "pechora", "dniester", "rhine", "rhin", "reno", "rin", "rijn",
      "elbe", "labe", "vistula", "wisła", "wisla", "weichsel",
      "loire", "tagus", "tajo", "tejo", "ebro", "oder", "odra",
      "rhône", "rhone", "seine", "po", "guadalquivir", "meuse", "maas",
      "douro", "duero", "garonne", "dvina", "daugava", "kama",
      "tisza", "tisa", "sava", "drava", "drau", "morava",
      "mures", "maros", "olt", "prut", "siret", "bug",
      "desna", "oka", "belaya", "vyatka", "warta",
      "neris", "viliya", "neman", "nemunas", "niemen",
      "mezen", "kemijoki", "tornio", "torne", "dalälven", "glomma",
      "saône", "saone", "adige", "arno", "tiber", "tevere",
      "durance", "isère", "isere", "allier", "cher", "marne",
      "moselle", "mosel", "main", "neckar", "inn", "isar", "lech",
      "weser", "ems", "havel", "spree", "saale", "werra",
      "guadiana", "júcar", "jucar", "segura",
      "minho", "miño", "schelde", "scheldt",
      "northern dvina", "western dvina", "sukhona", "chusovaya",
      // ── ASIA ──
      "yangtze", "chang jiang", "yellow river", "huang he",
      "mekong", "lena", "irtysh", "brahmaputra", "ob", "yenisei", "yenisey",
      "amur", "indus", "ganges", "ganga", "salween", "euphrates", "tigris",
      "syr darya", "amu darya", "kolyma", "ishim", "tobol",
      "songhua", "helmand", "tarim", "godavari", "krishna", "narmada",
      "xi", "pearl", "zhu", // Pearl River
      "ili", "chu", "naryn", "zeravshan", "vakhsh", "panj",
      "hari", "karun", "kura", "araxes", "aras",
      "sutlej", "chenab", "jhelum", "ravi", "beas",
      "yamuna", "chambal", "betwa", "son", "gandak", "kosi",
      "mahanadi", "kaveri", "cauvery", "tungabhadra", "tapi",
      "irrawaddy", "chindwin", "sittang",
      "red river", "black river", // Vietnam
      "han", "min", "gan", "xiang", "yuan", "wei", "fen",
      "huai", "hai", "liao", "yalu", "tumen",
      "ussuri", "argun", "shilka", "selenga", "orkhon", "kerulen",
      "angara", "aldan", "vilyuy", "olenyok", "indigirka", "yana",
      "anadyr", "amgun", "chulym", "tom", "katun",
      "taz", "nadym", "vasyugan",
      "orontes", "asi", // Syria/Turkey
      // ── AUSTRALIA ──
      "murray", "darling", "murrumbidgee", "lachlan", "cooper",
      "flinders", "fitzroy", "burdekin", "mitchell", "diamantina",
      "thomson", "barcoo", "gascoyne", "ashburton", "fortescue",
      "ord", "victoria", "daly",
      // ── MAJOR CANALS (strategic chokepoints) ──
      "suez", "panama", "kiel", "grand canal", "corinth",
      "volga-don", "white sea-baltic", "belomorkanal",
      "nord-ostsee-kanal",
    ]);

    let filtered = 0;
    for (const [id, entry] of riverMap) {
      if (entry.length > 500) {
        // Check if ANY name variant matches the whitelist
        let isKnown = false;
        for (const name of entry.names) {
          for (const mega of KNOWN_RIVERS) {
            if (name.includes(mega) || mega.includes(name)) { isKnown = true; break; }
          }
          if (isKnown) break;
        }
        if (!isKnown) {
          riverMap.delete(id);
          filtered++;
        }
      }
    }

    // Build flat Set of all name variants for fast matching
    const riverNames = new Set();
    const riverList = [];
    for (const [id, entry] of riverMap) {
      for (const name of entry.names) {
        // Skip single-char names to avoid false matches
        if (name.length >= 2) riverNames.add(name);
      }
      riverList.push({ label: entry.label, length: entry.length, variants: entry.names.size });
    }

    // Sort by length for logging
    riverList.sort((a, b) => b.length - a.length);

    if (log) {
      log.ok(`Found ${riverMap.size} rivers (${riverNames.size} name variants)${filtered ? `, filtered ${filtered} with suspect lengths` : ""}`);
      const top = riverList.slice(0, 15);
      for (const r of top) {
        log.detail(`  ${r.label} (${Math.round(r.length)} km, ${r.variants} name variants)`);
      }
      if (riverList.length > 15) log.detail(`  ... and ${riverList.length - 15} more`);
    }

    return riverNames;
  } catch (err) {
    // Try a simpler fallback query — just English labels, no multi-language
    if (log) log.warn(`Wikidata primary query failed: ${err.message} — trying simplified query`);
    try {
      const simpleSparql = `
SELECT ?river ?length ?riverLabel WHERE {
  VALUES ?type { wd:Q4022 wd:Q12284 }
  ?river wdt:P31 ?type ;
         wdt:P2043 ?length .
  FILTER(?length >= ${minLength})
  SERVICE wikibase:box {
    ?river wdt:P625 ?loc .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,it,es,pt,nl,ar,fa,ru" . }
}
LIMIT 2000`.trim();
      const url2 = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(simpleSparql);
      const resp2 = await fetch(url2, {
        headers: { "Accept": "text/tab-separated-values", "User-Agent": "TerrainParser/1.0" }
      });
      if (!resp2.ok) throw new Error(`HTTP ${resp2.status}`);
      const rawText2 = await resp2.text();
      if (log) log.detail(`Wikidata fallback response: ${rawText2.length} chars (TSV)`);

      const riverNames = new Set();
      const seen = new Set();
      const lines2 = rawText2.split("\n");
      for (let i = 1; i < lines2.length; i++) {
        const line = lines2[i].trim();
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const idMatch = parts[0].match(/Q\d+/);
        if (!idMatch) continue;
        const id = idMatch[0];
        const nameMatch = parts[2].match(/^"(.+)"(@\w+)?/);
        const label = nameMatch ? nameMatch[1] : parts[2].replace(/"/g, "");
        if (label && label.length >= 2) riverNames.add(label.toLowerCase());
        if (!seen.has(id)) seen.add(id);
      }

      if (log) {
        log.ok(`Fallback found ${seen.size} rivers (${riverNames.size} names)`);
      }
      return riverNames.size > 0 ? riverNames : null;
    } catch (err2) {
      if (log) log.warn(`Wikidata fallback also failed: ${err2.message} — no river filtering`);
      return null;
    }
  }
}

function classifyGrid(bbox, cols, rows, feat, elevData, onS, wcData, tier, cellKm, wikidataRivers, aridityGrid, metroCities) {
  const { south, north, west, east } = bbox;
  const proj = createHexProjection(bbox, cols, rows);
  const elev = elevData.elevations;
  const wcGrid = wcData ? wcData.wcGrid : null;
  const wcMix = wcData ? wcData.wcMix : null;

  onS("Spatial indexing...");
  const tIdx = buildIdx(feat.terrAreas, bbox);
  const iaIdx = feat.infraAreas.length > 0 ? buildIdx(feat.infraAreas, bbox) : null;

  // ── Hex grid projection helpers ─────────────────────────────────
  // Convert lat/lon to hex grid cell (offset coords, odd-r pointy-top)
  function geoToCell(lon, lat) {
    return proj.geoToCell(lon, lat);
  }

  // Rasterize an OSM way into hex grid cells using hex line interpolation.
  // Returns array of [c, r] pairs for all cells the way passes through.
  function rasterizeWay(nodes) {
    const result = [];
    let prevC = -1, prevR = -1;
    for (const nd of nodes) {
      const cell = geoToCell(nd.lon, nd.lat);
      if (!cell) { prevC = -1; continue; }
      const [c, r] = cell;
      if (prevC >= 0 && (prevC !== c || prevR !== r)) {
        const seg = hexLine(prevC, prevR, c, r);
        for (let i = 1; i < seg.length; i++) {
          const { col, row } = seg[i];
          if (col >= 0 && col < cols && row >= 0 && row < rows) result.push([col, row]);
        }
      } else if (prevC < 0) {
        result.push([c, r]);
      }
      prevC = c; prevR = r;
    }
    return result;
  }

  onS("Indexing lines...");
  const cellInfra = {};
  const cellInfraAll = {}; // ALL infra types per cell (no winner-take-all)
  const cellRoadCount = {};
  for (const line of feat.infraLines) {
    const seen = new Set();
    for (const [c, r] of rasterizeWay(line.nodes)) {
      const k = `${c},${r}`;
      if (seen.has(k)) continue; seen.add(k);
      if (["highway", "major_road", "road", "minor_road"].includes(line.type)) {
        cellRoadCount[k] = (cellRoadCount[k] || 0) + 1;
      }
      // Best-of for backwards compat (urban clustering)
      const rk = { highway: 5, major_road: 4, road: 3, minor_road: 2.8, railway: 2.5, light_rail: 2.3, trail: 2, footpath: 1.5 };
      const ex = cellInfra[k], nr = rk[line.type] || 0, er = ex ? (rk[ex.type] || 0) : 0;
      if (!ex || nr > er) cellInfra[k] = { type: line.type, isBridge: line.isBridge, isTunnel: line.isTunnel };
      else {
        if (line.isBridge && !ex.isBridge) cellInfra[k] = { ...ex, isBridge: true };
        if (line.isTunnel && !ex.isTunnel) cellInfra[k] = { ...ex, isTunnel: true };
      }
      // Accumulate ALL types — nothing lost
      if (!cellInfraAll[k]) cellInfraAll[k] = new Set();
      cellInfraAll[k].add(line.type);
      if (line.isBridge) cellInfraAll[k].add("bridge");
      if (line.isTunnel) cellInfraAll[k].add("tunnel");
    }
  }

  // River lines
  const cellRiver = new Set();
  for (const wl of feat.waterLines) {
    for (const [c, r] of rasterizeWay(wl.nodes)) cellRiver.add(`${c},${r}`);
  }

  // Stream lines (sub-tactical + tactical)
  const cellStream = new Set();
  const cellDitch = new Set();
  if (feat.streamLines) {
    for (const sl of feat.streamLines) {
      for (const [c, r] of rasterizeWay(sl.nodes)) {
        if (sl.isDitch) cellDitch.add(`${c},${r}`);
        else cellStream.add(`${c},${r}`);
      }
    }
  }

  // Dam nodes — tier-aware filtering
  const cellDam = new Set();
  // First pass: collect candidate dam cells
  const damCandidates = [];
  for (const d of feat.damNodes) {
    const lat = d.lat, lon = d.lon || (d.nodes ? d.nodes[0].lon : 0);
    const dc = geoToCell(lon, lat);
    if (dc) {
      const [c, r] = dc;
      const k = `${c},${r}`;
      if (tier === "strategic") {
        // Strategic: defer — will check adjacency to lake after terrain classification
        damCandidates.push(k);
      } else if (tier === "operational") {
        if (d.onRiver || cellRiver.has(k)) cellDam.add(k);
      } else {
        cellDam.add(k);
      }
    }
  }

  // Building areas (sub-tactical) — compute per-cell coverage using actual footprint area
  const cellBuildingPct = {};
  if (tier === "sub-tactical" && feat.buildingAreas && feat.buildingAreas.length > 0) {
    const cellBuildingArea = {};
    const hexArea = (SQRT3 / 2) * cellKm * cellKm; // hex area in km²
    for (const bldg of feat.buildingAreas) {
      if (!bldg.ring || bldg.ring.length < 3) continue;
      const area = polyAreaKm2(bldg.ring);
      // Use centroid to assign building to cell
      let sumLat = 0, sumLon = 0;
      for (const nd of bldg.ring) { sumLat += nd.lat; sumLon += nd.lon; }
      const bc = geoToCell(sumLon / bldg.ring.length, sumLat / bldg.ring.length);
      if (bc) {
        const k = `${bc[0]},${bc[1]}`;
        cellBuildingArea[k] = (cellBuildingArea[k] || 0) + area;
      }
    }
    for (const [k, area] of Object.entries(cellBuildingArea)) {
      cellBuildingPct[k] = Math.min(1.0, area / hexArea);
    }
  }

  // Barrier lines (sub-tactical)
  const cellBarrier = {};
  if (tier === "sub-tactical" && feat.barrierLines) {
    for (const bl of feat.barrierLines) {
      for (const [c, r] of rasterizeWay(bl.nodes)) {
        const k = `${c},${r}`;
        if (!cellBarrier[k]) cellBarrier[k] = bl.type;
      }
    }
  }

  // Hedge density — total hedge length (km) per cell for hedgerow attribute
  const cellHedgeLen = {};
  if (feat.hedgeLines && feat.hedgeLines.length > 0) {
    for (const hl of feat.hedgeLines) {
      for (let i = 0; i < hl.nodes.length - 1; i++) {
        const a = hl.nodes[i], b = hl.nodes[i + 1];
        const midLat = (a.lat + b.lat) / 2, midLon = (a.lon + b.lon) / 2;
        const hc = geoToCell(midLon, midLat);
        if (hc) {
          const k = `${hc[0]},${hc[1]}`;
          cellHedgeLen[k] = (cellHedgeLen[k] || 0) + segLenKm(a, b);
        }
      }
    }
  }

  // Tower nodes (sub-tactical)
  const cellTower = new Set();
  if (tier === "sub-tactical" && feat.towerNodes) {
    for (const t of feat.towerNodes) {
      const tc = geoToCell(t.lon, t.lat);
      if (tc) cellTower.add(`${tc[0]},${tc[1]}`);
    }
  }

  // Navigable waterways — Wikidata-driven at strategic/operational
  // If Wikidata lookup succeeded: only rivers matching a known major river name pass
  // If Wikidata failed: fall back to name + span filtering
  const cellNavigable = new Set();
  const cellNavTagged = new Set(); // ship=yes — bypasses desert filter
  const cellNavName = new Map(); // cell → river name
  {
    if (feat.navigableLines) {
      // Helper: check if an OSM way name matches any whitelist/Wikidata river.
      // Forward direction (OSM contains whitelist name) is always safe.
      // Reverse direction (whitelist contains OSM name) requires word boundary
      // to prevent false positives like "Ina" matching "Magdalena".
      const matchesWikidata = (osmName) => {
        if (!wikidataRivers || !osmName) return false;
        const lower = osmName.toLowerCase();
        for (const wdName of wikidataRivers) {
          // Short whitelist names (≤3 chars like "Po"): word boundary in OSM name
          if (wdName.length <= 3) {
            const re = new RegExp(`\\b${wdName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (re.test(lower)) return true;
          } else {
            // OSM name contains whitelist name (e.g. "Mississippi River" contains "Mississippi")
            if (lower.includes(wdName)) return true;
          }
          // Reverse: whitelist name contains OSM name — require word boundary + min 4 chars
          // Catches "Ouse" matching "Great Ouse" but blocks "Ina" matching "Magdalena"
          if (lower.length >= 4) {
            const re = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (re.test(wdName)) return true;
          }
        }
        return false;
      };

      for (const nl of feat.navigableLines) {
        // Canal filter: at operational/strategic/theater, only major strategic canals pass.
        // All other canals are suppressed — they still render as water, just not as navigable.
        if (nl.isCanal && (tier === "strategic" || tier === "operational")) {
          if (!nl.actualName) continue; // unnamed canals always filtered at these tiers
          const canalLower = nl.actualName.toLowerCase();
          let isMajor = false;
          for (const mc of MAJOR_CANALS) {
            if (canalLower.includes(mc) || mc.includes(canalLower)) { isMajor = true; break; }
          }
          if (!isMajor) continue;
        }

        const wayCells = new Set();
        for (const [c, r] of rasterizeWay(nl.nodes)) wayCells.add(`${c},${r}`);
        const wName = nl.actualName || null;
        const markNav = (k) => { cellNavigable.add(k); if (wName && !cellNavName.has(k)) cellNavName.set(k, wName); };

        if (nl.tagged) {
          // Ship/boat tagged — always navigable at tactical/sub-tactical.
          // At strategic/operational, ship=yes tagging varies in OSM quality,
          // so require whitelist match OR substantial map span.
          // Theater (≥15km cells): 5 cells (100km) — only major waterways
          // Strategic/operational: 3 cells (30km / 15km)
          if (tier === "strategic" || tier === "operational") {
            const passesWhitelist = wikidataRivers && matchesWikidata(nl.actualName);
            const minTaggedCells = cellKm >= 15 ? 5 : 3;
            if (passesWhitelist || wayCells.size >= minTaggedCells) {
              wayCells.forEach(k => { markNav(k); cellNavTagged.add(k); });
            }
          } else {
            wayCells.forEach(k => { markNav(k); cellNavTagged.add(k); });
          }
        } else if (wikidataRivers) {
          // Wikidata available — name matching is primary filter
          if (matchesWikidata(nl.actualName)) {
            // Cross-validate: canals without ship tags need substantial map span
            // to filter Wikidata entries with erroneous lengths (meter/km confusion)
            // Theater: 100km min span, strategic/operational: 50km
            const spanKm = wayCells.size * cellKm;
            const canalMinSpanKm = cellKm >= 15 ? 100 : 50;
            if (nl.isCanal && !nl.tagged && spanKm < canalMinSpanKm && (tier === "strategic" || tier === "operational")) {
              // Canal is too short on map to be confidently navigable at this scale — skip
            } else {
              wayCells.forEach(k => markNav(k));
            }
          }
          // Unnamed or non-matching ways are dropped at strategic/operational
        } else {
          // Wikidata failed — use span-based filtering as fallback
          if (tier === "strategic") {
            if (nl.fromRelation && wayCells.size >= 3) wayCells.forEach(k => markNav(k));
            else if (nl.named && wayCells.size >= 5) wayCells.forEach(k => markNav(k));
          } else if (tier === "operational") {
            if (nl.fromRelation && wayCells.size >= 2) wayCells.forEach(k => markNav(k));
            else if (nl.named && wayCells.size >= 3) wayCells.forEach(k => markNav(k));
          } else {
            const minSpan = tier === "tactical" ? 2 : 1;
            if (wayCells.size >= minSpan) wayCells.forEach(k => markNav(k));
          }
        }
      }
    }
  }

  // Beach areas — use centroid
  const cellBeach = new Set();
  if (feat.beachAreas) {
    for (const ba of feat.beachAreas) {
      let sumLat = 0, sumLon = 0;
      for (const nd of ba.ring) { sumLat += nd.lat; sumLon += nd.lon; }
      const cLat = sumLat / ba.ring.length, cLon = sumLon / ba.ring.length;
      const bc = geoToCell(cLon, cLat);
      if (bc) cellBeach.add(`${bc[0]},${bc[1]}`);
    }
  }

  // Pipeline lines — with span filtering at operational/strategic
  const cellPipeline = new Set();
  if (feat.pipelineLines) {
    // At strategic/operational, only show pipelines that span many cells (trunk lines)
    const pipeMinSpan = tier === "strategic" ? 10 : tier === "operational" ? 6 : 1;
    if (pipeMinSpan <= 1) {
      for (const pl of feat.pipelineLines) {
        for (const [c, r] of rasterizeWay(pl.nodes)) cellPipeline.add(`${c},${r}`);
      }
    } else {
      // Index per-way, then flood-fill connected components
      const pipeCandidates = new Set();
      for (const pl of feat.pipelineLines) {
        for (const [c, r] of rasterizeWay(pl.nodes)) pipeCandidates.add(`${c},${r}`);
      }
      const visited = new Set();
      for (const seed of pipeCandidates) {
        if (visited.has(seed)) continue;
        const component = [], queue = [seed];
        visited.add(seed);
        while (queue.length > 0) {
          const cur = queue.shift();
          component.push(cur);
          const [cc, cr] = cur.split(",").map(Number);
          for (const [nc, nr] of getNeighbors(cc, cr)) {
            const nk = `${nc},${nr}`;
            if (pipeCandidates.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(nk); }
          }
        }
        if (component.length >= pipeMinSpan) component.forEach(k => cellPipeline.add(k));
      }
    }
  }

  // Power plant areas — use centroid, not ring nodes
  const cellPowerPlant = new Set();
  if (feat.powerPlantAreas) {
    for (const pp of feat.powerPlantAreas) {
      // Compute centroid of polygon
      let sumLat = 0, sumLon = 0;
      for (const nd of pp.ring) { sumLat += nd.lat; sumLon += nd.lon; }
      const cLat = sumLat / pp.ring.length, cLon = sumLon / pp.ring.length;
      const pc = geoToCell(cLon, cLat);
      if (pc) cellPowerPlant.add(`${pc[0]},${pc[1]}`);
    }
  }

  // Settlement names — assign place nodes to cells, highest rank wins
  const cellSettlement = new Map(); // cell → { name, place, rank, population }
  if (feat.placeNodes) {
    for (const pn of feat.placeNodes) {
      const pc = geoToCell(pn.lon, pn.lat);
      if (pc) {
        const k = `${pc[0]},${pc[1]}`;
        const existing = cellSettlement.get(k);
        if (!existing || pn.rank > existing.rank || (pn.rank === existing.rank && pn.population > existing.population)) {
          cellSettlement.set(k, { name: pn.name, place: pn.place, rank: pn.rank });
        }
      }
    }
  }

  // ── Settlement influence field — BFS decay from place nodes ──
  // Each settlement radiates an influence score that decays linearly with distance.
  // Used as one factor in the composite urban score to anchor urban classification
  // to known human settlements and prevent false positives from highway interchanges.
  const settlementInfluence = {};
  if (feat.placeNodes && tier !== "sub-tactical") {
    // Fixed ground-distance targets (km) — prevents quadratic blowup at strategic scale
    // where old formula (cellKm²/1.5) gave city=160km at 8km cells
    const INFLUENCE_KM = { city: 30, town: 15, village: 5 };
    const influenceScale = Math.max(1, Math.round(cellKm / 1.5)); // reused for MIN_CLUSTER
    for (const pn of feat.placeNodes) {
      const pc = geoToCell(pn.lon, pn.lat);
      if (!pc) continue;
      const maxDist = Math.max(1, Math.round((INFLUENCE_KM[pn.place] || 5) / cellKm));
      const seedK = `${pc[0]},${pc[1]}`;
      const queue = [seedK];
      const visited = new Set([seedK]);
      const dist = { [seedK]: 0 };
      let qi = 0;
      while (qi < queue.length) {
        const ck = queue[qi++];
        const d = dist[ck];
        const influence = 1.0 - (d / (maxDist + 1));
        settlementInfluence[ck] = Math.max(settlementInfluence[ck] || 0, influence);
        if (d < maxDist) {
          const [cc, cr] = ck.split(",").map(Number);
          for (const [nc, nr] of getNeighbors(cc, cr)) {
            const nk = `${nc},${nr}`;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited.has(nk)) {
              visited.add(nk); queue.push(nk); dist[nk] = d + 1;
            }
          }
        }
      }
    }
  }

  // ── Metro area boost — population-scaled urban boost for large-scale maps ──
  // At operational/strategic scale, WorldCover pixel dilution causes cities to
  // vanish because urban pixels are a minority in large hex cells. This uses the
  // bundled metro dataset to inject a population-proportional boost with gaussian
  // decay from each city center outward. The boost is additive to the composite
  // urban score computed later — it doesn't replace any existing signal.
  const metroBoost = {};
  if (metroCities && (tier === "operational" || tier === "strategic")) {
    const METRO_K = 0.0025;        // power-law coefficient for area estimation
    const METRO_BETA = 0.78;       // power-law exponent (sub-linear: bigger cities are denser)
    const METRO_EXPANSION = 1.5;   // BFS extends to 1.5x estimated radius for suburban fringe
    const MIN_POP = tier === "strategic" ? 300000 : 100000;

    // Quick bbox filter with generous margin for decay radius
    const marginKm = 50;
    const marginLat = marginKm / 111.32;
    const midLat = (bbox.south + bbox.north) / 2;
    const marginLon = marginKm / (111.32 * Math.cos(midLat * Math.PI / 180));

    let metroCount = 0;
    for (const city of metroCities) {
      if (city.p < MIN_POP) continue;
      if (city.lat < south - marginLat || city.lat > north + marginLat) continue;
      if (city.lng < west - marginLon || city.lng > east + marginLon) continue;

      // Estimate built-up footprint from population (empirical urban scaling law)
      // Calibrated: Delhi (33M) → ~1800 km², London (9.5M) → ~700 km², 1M city → ~120 km²
      const builtUpKm2 = METRO_K * Math.pow(city.p, METRO_BETA);
      const radiusKm = Math.sqrt(builtUpKm2 / Math.PI);
      const radiusHex = Math.max(1, Math.round(radiusKm / cellKm));
      // Gaussian sigma: half the radius gives natural dense-core → suburban → rural gradient
      const sigma = Math.max(1, radiusHex / 2);
      const maxBFS = Math.ceil(radiusHex * METRO_EXPANSION);

      const centerCell = geoToCell(city.lng, city.lat);
      if (!centerCell) continue;
      metroCount++;

      const seedK = `${centerCell[0]},${centerCell[1]}`;
      const queue = [seedK];
      const visited = new Set([seedK]);
      const dist = { [seedK]: 0 };
      let qi = 0;

      while (qi < queue.length) {
        const ck = queue[qi++];
        const d = dist[ck];
        // Gaussian decay: 1.0 at center, ~0.13 at radiusHex, ~0.01 at 1.5x radiusHex
        const boost = Math.exp(-((d * d) / (sigma * sigma)));
        metroBoost[ck] = Math.max(metroBoost[ck] || 0, boost);

        if (d < maxBFS) {
          const [cc, cr] = ck.split(",").map(Number);
          for (const [nc, nr] of getNeighbors(cc, cr)) {
            const nk = `${nc},${nr}`;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited.has(nk)) {
              visited.add(nk); queue.push(nk); dist[nk] = d + 1;
            }
          }
        }
      }
    }
    if (onS && metroCount > 0) {
      onS(`Metro boost: ${metroCount} cities, ${Object.keys(metroBoost).length} cells boosted`);
    }
  }

  // Airfield, port, military_base — centroid flagging with area filter at strategic
  const cellAirfield = new Set(), cellPort = new Set(), cellMilitaryBase = new Set();
  if (feat.infraAreas) {
    // Importance-based filtering: composite score from area, type, name, military status
    // Preserves small but strategically important features (military airfields, FOBs)
    const minImportance = tier === "strategic" ? 0.5 : tier === "operational" ? 0.15 : 0;

    for (const ia of feat.infraAreas) {
      if (!["airfield", "port", "military_base", "helipad"].includes(ia.type)) continue;

      // Compute importance score: area * multipliers
      if (minImportance > 0) {
        const area = polyAreaKm2(ia.ring);
        let importance = area;
        if (ia.type === "military_base") importance *= 3;
        if (ia.isMilitary) importance *= 2;
        if (ia.hasName) importance *= 1.5;
        if (ia.isAbandoned) importance *= 0.3;
        if (importance < minImportance) continue;
      }

      let sumLat = 0, sumLon = 0;
      for (const nd of ia.ring) { sumLat += nd.lat; sumLon += nd.lon; }
      const cLat = sumLat / ia.ring.length, cLon = sumLon / ia.ring.length;
      const gc = geoToCell(cLon, cLat);
      if (gc) {
        const gk = `${gc[0]},${gc[1]}`;
        if (ia.type === "airfield") cellAirfield.add(gk);
        else if (ia.type === "port") cellPort.add(gk);
        else if (ia.type === "military_base") cellMilitaryBase.add(gk);
      }
    }
  }

  // ── Compute local prominence for elevation-based terrain classification ──
  // Prominence = cell elevation minus regional mean elevation within a neighborhood.
  // This prevents flat high-altitude plateaus (Tibet, Altiplano) from being classified as peaks.
  const regionRadius = Math.max(3, Math.floor(Math.min(cols, rows) / 20));
  const prominence = new Float32Array(cols * rows);
  {
    // Compute regional mean using a box average for efficiency
    // Use prefix sums for O(1) per-cell average instead of O(radius^2)
    const prefixSum = new Float64Array((cols + 1) * (rows + 1));
    const prefixCnt = new Uint32Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = elev[r * cols + c] || 0;
        const i = (r + 1) * (cols + 1) + (c + 1);
        prefixSum[i] = e + prefixSum[i - 1] + prefixSum[i - (cols + 1)] - prefixSum[i - (cols + 1) - 1];
        prefixCnt[i] = (e !== 0 || elev[r * cols + c] === 0 ? 1 : 0) + prefixCnt[i - 1] + prefixCnt[i - (cols + 1)] - prefixCnt[i - (cols + 1) - 1];
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const r0 = Math.max(0, r - regionRadius), r1 = Math.min(rows - 1, r + regionRadius);
        const c0 = Math.max(0, c - regionRadius), c1 = Math.min(cols - 1, c + regionRadius);
        const br = (r1 + 1) * (cols + 1) + (c1 + 1);
        const tl = r0 * (cols + 1) + c0;
        const tr = r0 * (cols + 1) + (c1 + 1);
        const bl = (r1 + 1) * (cols + 1) + c0;
        const sum = prefixSum[br] - prefixSum[tr] - prefixSum[bl] + prefixSum[tl];
        const cnt = prefixCnt[br] - prefixCnt[tr] - prefixCnt[bl] + prefixCnt[tl];
        const mean = cnt > 0 ? sum / cnt : 0;
        prominence[r * cols + c] = (elev[r * cols + c] || 0) - mean;
      }
    }
  }

  onS("Classifying cells...");
  const terrain = {}, infra = {}, attrs = {}, elevG = {}, features = {}, featureNames = {}, cellConfidence = {};
  const urbanScore = {}; // per-cell composite urbanization score (0..1), used in cluster phase

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const { lon: lng, lat } = proj.cellCenter(c, r);
      const e = elev[r * cols + c] || 0;
      elevG[k] = Math.round(e);

      // ── TERRAIN CLASSIFICATION — multi-point PIP + WorldCover mix ──
      // At strategic/operational: test 5×5 grid of points per cell against OSM terrain polygons
      // This catches features that don't cover the cell center (coastal cities, small polygons)
      const PTS = (tier === "sub-tactical") ? 1 : 5; // 5×5 = 25 sample points
      const { cellN, cellS, cellW: cellWest, cellE: cellEast } = proj.cellBbox(c, r);
      const tCandidates = qIdxRect(tIdx, bbox, cellS, cellN, cellWest, cellEast);

      // Count OSM terrain type hits across sample points (hex-filtered)
      const osmVotes = {};
      let osmTotal = 0;
      const cellDLat = cellN - cellS, cellDLon = cellEast - cellWest;
      const { x: hcx, y: hcy } = offsetToPixel(c, r, 1);
      for (let sy = 0; sy < PTS; sy++) {
        for (let sx = 0; sx < PTS; sx++) {
          const tLat = cellN - (sy + 0.5) / PTS * cellDLat;
          const tLng = cellWest + (sx + 0.5) / PTS * cellDLon;
          // Skip samples in bbox corners that fall outside the hex
          const { hx: shx, hy: shy } = proj.geoToHexPixel(tLng, tLat);
          const sdx = Math.abs(shx - hcx), sdy = Math.abs(shy - hcy);
          if (sdy > 0.98 - sdx / SQRT3) continue;
          let best = null, bestPri = -1;
          for (const ai of tCandidates) {
            const a = feat.terrAreas[ai];
            if (a.pri > bestPri && pip(tLat, tLng, a.ring)) {
              best = a.type; bestPri = a.pri;
            }
          }
          if (best) { osmVotes[best] = (osmVotes[best] || 0) + 1; osmTotal++; }
        }
      }

      // Find dominant OSM terrain type
      let osmBest = null, osmBestCnt = 0;
      for (const [type, cnt] of Object.entries(osmVotes)) {
        if (cnt > osmBestCnt) { osmBest = type; osmBestCnt = cnt; }
      }

      // WorldCover base
      const wcBase = wcGrid ? (wcGrid[k] || "open_ground") : "open_ground";
      const wcMixCell = wcMix ? wcMix[k] : null;

      // ── Composite urban score ──
      // Instead of binary thresholds, compute a weighted urbanization score from
      // four signals. Terrain assignment is deferred to the cluster phase after
      // this loop — only spatially coherent groups of high-score cells become urban.
      let tt;
      if (osmBestCnt >= PTS * PTS * 0.2) {
        tt = osmBest;
      } else {
        tt = wcBase;
      }

      // Compute per-cell urban score (0..1) — stored for cluster phase
      const wcBU_raw = wcMixCell ? (wcMixCell["light_urban"] || 0) : 0;
      // Below 20% built-up, halve contribution — scattered farmhouses/infrastructure
      // should not drive urban classification
      const wcBU = wcBU_raw >= 0.20 ? wcBU_raw : wcBU_raw * 0.5;
      const osmUrbanPts = (osmVotes["light_urban"] || 0) + (osmVotes["dense_urban"] || 0);
      const osmUrbanFrac = (PTS * PTS) > 0 ? osmUrbanPts / (PTS * PTS) : 0;
      const roadCeiling = tier === "strategic" ? 60 : tier === "operational" ? 30 : 15;
      const roadFrac = Math.min(1.0, (cellRoadCount[k] || 0) / roadCeiling);
      const settBoost = settlementInfluence[k] || 0;
      urbanScore[k] = Math.min(1.0, 0.50 * wcBU + 0.20 * osmUrbanFrac + 0.15 * roadFrac + 0.15 * settBoost);

      // Metro whitelist boost — additive, only nonzero at operational/strategic
      // where WorldCover dilution makes cities invisible
      if (metroBoost[k]) {
        urbanScore[k] = Math.min(1.0, urbanScore[k] + metroBoost[k]);
      }

      // Force non-urban terrain during this loop so elevation modifiers apply.
      // Urban terrain is assigned in the cluster phase after the main loop.
      if (["light_urban", "dense_urban"].includes(tt)) {
        if (wcMixCell) {
          let bestNat = "open_ground", bestNatPct = 0;
          for (const [cls, pct] of Object.entries(wcMixCell)) {
            if (cls !== "light_urban" && cls !== "dense_urban" && pct > bestNatPct) {
              bestNat = cls; bestNatPct = pct;
            }
          }
          tt = bestNat;
        } else {
          tt = "open_ground";
        }
      }

      // Sub-tactical: WC built-up is too uniform — let OSM landuse/buildings provide urban detail
      if (tier === "sub-tactical" && tt === "light_urban") tt = "open_ground";

      // Water cells from WorldCover get refined by OSM waterways (tactical/sub-tactical only)
      if (wcGrid && tt === "lake" && cellRiver.has(k) && (tier === "sub-tactical" || tier === "tactical")) tt = "river";

      // Desert classification: use precipitation data when available, fall back to latitude heuristic
      if (tt === "open_ground") {
        const wcRaw = wcGrid ? wcGrid[k] : null;
        if (wcRaw === "open_ground") { // WC class 60 (bare/sparse vegetation)
          if (aridityGrid && aridityGrid[k] !== undefined) {
            // Precipitation-based: <250mm/year = desert, 250-500mm = semi-arid (stays open_ground)
            if (aridityGrid[k] < 250) tt = "desert";
          } else {
            // Fallback: latitude-based heuristic when precipitation data unavailable
            if (Math.abs(lat) < 35) tt = "desert";
          }
        }
      }

      // Elevation modifiers — dual criteria: absolute elevation AND local prominence
      // Prevents flat high-altitude plateaus (Tibet, Altiplano, Iranian plateau) from being peaks.
      // A plateau at 4500m with prominence ~0 stays highland; a 2500m peak rising 500m above surroundings is a peak.
      const isW = ["lake", "river", "deep_water", "coastal_water"].includes(tt);
      const isU = ["light_urban", "dense_urban"].includes(tt);
      const isArid = tt === "desert" || tt === "open_ground";
      const prom = prominence[r * cols + c] || 0;
      if (!isW && !isU) {
        if (isArid) {
          // Arid terrain: require both absolute height AND prominence for mountain/peak
          if (e > 2500 && prom > 500) tt = "peak";
          else if (e > 1500 && prom > 300) tt = "mountain";
          else if (e > 800 || prom > 150) tt = "highland";
          // Low elevation or low prominence: stays desert/open_ground
        } else {
          // Vegetated/other terrain: dual criteria with prominence
          if (e > 1800 && prom > 500 && tt !== "ice") tt = "peak";
          else if (e > 1000 && prom > 300 && tt !== "ice" && tt !== "farmland") tt = (tt === "forest" || tt === "dense_forest") ? "mountain_forest" : "mountain";
          else if ((e > 800 || prom > 150) && tt !== "ice" && tt !== "farmland") {
            if (tt === "forest" || tt === "dense_forest") tt = "mountain_forest";
            else if (!["wetland", "desert", "ice", "farmland"].includes(tt)) tt = (e > 800 && prom > 300) ? "mountain" : "highland";
          } else if (e > 500 && tt !== "ice" && tt !== "farmland") {
            if (tt === "forest" || tt === "dense_forest") tt = "mountain_forest";
            else if (!["wetland", "desert", "ice", "farmland"].includes(tt)) tt = "highland";
          }
        }
      }
      terrain[k] = tt;

      // Per-cell confidence: how certain is this terrain classification?
      // Based on WorldCover dominance ratio and OSM/WC agreement
      let conf = 1.0;
      if (wcMixCell) {
        conf = wcMixCell[tt] || 0.5; // how much of the cell matches the assigned type
      }
      // Reduce confidence when OSM and WC disagree
      if (osmBest && osmBest !== tt && osmBestCnt >= PTS * PTS * 0.1) {
        conf *= 0.7;
      }
      cellConfidence[k] = conf;

      // Attributes (legacy — kept for backwards compat but mostly empty now)
      const at = [];
      // Hedgerow — dense hedge network characteristic of bocage terrain
      // Threshold: 10 km of hedge per km² — conservative to avoid false positives
      if (cellHedgeLen[k]) {
        const cellArea = (SQRT3 / 2) * cellKm * cellKm; // hex area in km²
        const densityKmPerKm2 = cellHedgeLen[k] / cellArea; // already in km
        if (densityKmPerKm2 >= 10) at.push("hedgerow");
      }
      attrs[k] = at;

      // Infrastructure (best-of with centroid-based detection for small features)
      let it = "none";
      // Centroid-flagged features always win at their priority
      if (cellMilitaryBase.has(k)) it = "military_base";
      else if (cellAirfield.has(k)) it = "airfield";
      else if (cellPort.has(k)) it = "port";

      // Multi-point PIP for infra areas — skip military/airfield/port (centroid handles those)
      if (iaIdx && it === "none") {
        let iap = -1;
        const iaCandidates = qIdxRect(iaIdx, bbox, cellS, cellN, cellWest, cellEast);
        for (let sy = 0; sy < PTS; sy++) for (let sx = 0; sx < PTS; sx++) {
          const tLat = cellN - (sy + 0.5) / PTS * cellDLat;
          const tLng = cellWest + (sx + 0.5) / PTS * cellDLon;
          // Skip samples in bbox corners that fall outside the hex
          const { hx: ihx, hy: ihy } = proj.geoToHexPixel(tLng, tLat);
          const idx2 = Math.abs(ihx - hcx), idy2 = Math.abs(ihy - hcy);
          if (idy2 > 0.98 - idx2 / SQRT3) continue;
          for (const ai of iaCandidates) {
            const a = feat.infraAreas[ai];
            if (["military_base", "airfield", "port"].includes(a.type)) continue;
            if (a.pri > iap && pip(tLat, tLng, a.ring)) { it = a.type; iap = a.pri; }
          }
        }
      }

      const li = cellInfra[k];
      if (li) {
        if (li.isBridge && isW) { it = "bridge"; }
        // Tunnel: road type persists, tunnel captured as feature via cellInfraAll
        else {
          const lr = { highway: 50, major_road: 40, road: 30, minor_road: 28, railway: 25, light_rail: 23, trail: 15, footpath: 10 };
          const ar = { military_base: 55, airfield: 52, helipad: 51, port: 48, dam: 45, parking: 14, building: 12, tower: 11, wall: 8, fence: 7, none: 0 };
          if ((lr[li.type] || 0) > (ar[it] || 0)) it = li.type;
        }
      }

      // Sub-tactical exclusive infra
      if (tier === "sub-tactical") {
        if (cellBuildingPct[k] && cellBuildingPct[k] > 0.05 && it === "none") it = "building";
        if (cellTower.has(k) && it === "none") it = "tower";
        if (cellBarrier[k] && it === "none") it = cellBarrier[k]; // wall or fence
      }

      // Dam participates in priority, NOT unconditional override
      if (cellDam.has(k) && it === "none") it = "dam";
      infra[k] = it;

      // ── FEATURES — accumulate ALL features present in this cell ──
      const ft = new Set();
      // Centroid-flagged area features
      if (cellAirfield.has(k)) ft.add("airfield");
      if (cellPort.has(k)) ft.add("port");
      if (cellMilitaryBase.has(k)) ft.add("military_base");
      // Multi-point PIP for other infra areas (skip military/airfield/port — centroid handles those)
      if (iaIdx) {
        const iaCandidates = qIdxRect(iaIdx, bbox, cellS, cellN, cellWest, cellEast);
        for (let sy = 0; sy < PTS; sy++) for (let sx = 0; sx < PTS; sx++) {
          const tLat = cellN - (sy + 0.5) / PTS * cellDLat;
          const tLng = cellWest + (sx + 0.5) / PTS * cellDLon;
          // Skip samples in bbox corners that fall outside the hex
          const { hx: fhx, hy: fhy } = proj.geoToHexPixel(tLng, tLat);
          const fdx = Math.abs(fhx - hcx), fdy = Math.abs(fhy - hcy);
          if (fdy > 0.98 - fdx / SQRT3) continue;
          for (const ai of iaCandidates) {
            const a = feat.infraAreas[ai];
            if (["military_base", "airfield", "port"].includes(a.type)) continue;
            if (pip(tLat, tLng, a.ring)) ft.add(a.type);
          }
        }
      }
      // All infra line types — context-filtered
      if (cellInfraAll[k]) cellInfraAll[k].forEach(t => {
        if (t === "bridge") return; // removed as feature type
        if (t === "tunnel") {
          // Only significant tunnels: through mountains/hills or underwater
          const elevTerrain = ["mountain", "mountain_forest", "highland", "peak"];
          const waterTerrain = ["deep_water", "coastal_water", "lake", "river"];
          if (elevTerrain.includes(terrain[k]) || waterTerrain.includes(terrain[k])) ft.add(t);
          return;
        }
        ft.add(t);
      });
      // Dam (tier-filtered)
      if (cellDam.has(k)) ft.add("dam");
      // River — skip on water terrain (redundant), desert (wadis), high-mountain at strategic/operational (Alpine gorges)
      if (cellNavigable.has(k)) {
        const isWaterTerrain = ["deep_water", "coastal_water", "lake"].includes(terrain[k]);
        const isDesert = ["desert", "open_ground"].includes(terrain[k]);
        const isHighMountain = ["peak", "mountain", "ice"].includes(terrain[k]);
        const isStrategicOp = tier === "strategic" || tier === "operational";
        if (isWaterTerrain) {
          // lake/ocean: skip — cell terrain is already water, river feature is redundant
        } else if (cellNavTagged.has(k)) {
          ft.add("river"); // ship=yes always passes
        } else if (isDesert) {
          // desert: skip (wadis)
        } else if (isHighMountain && isStrategicOp) {
          // peak/mountain/ice at strategic/operational: skip (Alpine gorges)
        } else {
          ft.add("river");
        }
      }
      // Beach
      if (cellBeach.has(k)) ft.add("beach");
      // Pipeline
      if (cellPipeline.has(k)) ft.add("pipeline");
      // Power plant
      if (cellPowerPlant.has(k)) ft.add("power_plant");
      // Town feature — deferred to post-cluster phase (needs to know which cells are urban)
      // Sub-tactical extras
      if (tier === "sub-tactical") {
        if (cellBuildingPct[k] && cellBuildingPct[k] > 0.05) ft.add("building");
        if (cellTower.has(k)) ft.add("tower");
        if (cellBarrier[k]) ft.add(cellBarrier[k]);
      }
      features[k] = [...ft];
      // Build feature_names: feature → name for named features
      const fn = {};
      if (cellNavName.has(k) && ft.has("river")) fn.river = cellNavName.get(k);
      const sett = cellSettlement.get(k);
      if (sett) {
        // Store as generic settlement; urban/town names are fixed up in cluster phase
        fn.settlement = sett.name;
      }
      if (Object.keys(fn).length > 0) featureNames[k] = fn;
    }
  }

  // ── Urban cluster detection — connected-component analysis of urbanScore ──
  // Cells only become urban terrain if they belong to a spatially coherent cluster.
  // This prevents isolated false positives (highway interchanges, scattered rural buildings)
  // from appearing as urban on the map.
  if (tier !== "sub-tactical") {
    // Strategic cells cover 64km² — require stronger urban signal to qualify
    const SEED_THRESHOLD = tier === "strategic" ? 0.35 : 0.25;
    const EXPAND_THRESHOLD = tier === "strategic" ? 0.20 : 0.15;
    const DENSE_SCORE = 0.55;      // within-cluster threshold for dense_urban
    const influenceScale = Math.max(1, Math.round(cellKm / 1.5));
    const MIN_CLUSTER = Math.max(2, Math.round(1.5 * influenceScale));
    const MIN_CLUSTER_DENSE = Math.max(5, Math.round(3 * influenceScale));
    const TOWN_SCORE = 0.08;       // minimum score for town feature

    const clusterOf = {};  // k -> clusterId
    const clusters = [];   // [{cells: Set, maxScore, hasSettlement}]
    const clusterVisited = new Set();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = `${c},${r}`;
        if (clusterVisited.has(k) || (urbanScore[k] || 0) < SEED_THRESHOLD) continue;

        // BFS expansion from this seed cell
        const cid = clusters.length;
        const clusterCells = new Set();
        const cQueue = [k];
        clusterVisited.add(k);
        let qi = 0, maxScore = 0, hasSettlement = false;

        while (qi < cQueue.length) {
          const ck = cQueue[qi++];
          clusterCells.add(ck);
          clusterOf[ck] = cid;
          const sc = urbanScore[ck] || 0;
          if (sc > maxScore) maxScore = sc;
          if (cellSettlement.has(ck)) hasSettlement = true;

          const [cc, cr] = ck.split(",").map(Number);
          for (const [nc, nr] of getNeighbors(cc, cr)) {
            const nk = `${nc},${nr}`;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows
                && !clusterVisited.has(nk) && (urbanScore[nk] || 0) >= EXPAND_THRESHOLD) {
              clusterVisited.add(nk);
              cQueue.push(nk);
            }
          }
        }

        clusters.push({ cells: clusterCells, maxScore, hasSettlement });
      }
    }

    // Assign urban terrain based on cluster membership and score
    for (const cluster of clusters) {
      const size = cluster.cells.size;
      // Small clusters without a settlement node stay non-urban
      if (size < MIN_CLUSTER && !cluster.hasSettlement) continue;

      for (const k of cluster.cells) {
        // Don't urbanize water cells (metro boost can push coastal cells over threshold)
        if (["deep_water", "coastal_water", "lake"].includes(terrain[k])) continue;
        const score = urbanScore[k] || 0;
        if (score >= DENSE_SCORE && size >= MIN_CLUSTER_DENSE) {
          terrain[k] = "dense_urban";
        } else if (score >= SEED_THRESHOLD) {
          terrain[k] = "light_urban";
        }
      }
    }

    // Town feature + settlement name fixup — now that urban terrain is assigned
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = `${c},${r}`;
        const isUrban = ["light_urban", "dense_urban"].includes(terrain[k]);

        // Town: cells with meaningful urban score that aren't urban terrain,
        // but are adjacent to an urban cluster or have a settlement node.
        if (!isUrban && (urbanScore[k] || 0) >= TOWN_SCORE) {
          let nearUrban = false;
          for (const [nc, nr] of getNeighbors(c, r)) {
            const nk = `${nc},${nr}`;
            if (["light_urban", "dense_urban"].includes(terrain[nk])) { nearUrban = true; break; }
          }
          if (nearUrban || cellSettlement.has(k)) {
            if (!features[k]) features[k] = [];
            if (!features[k].includes("town")) features[k].push("town");
          }
        }

        // Reassign settlement names to match final terrain/feature
        const sett = cellSettlement.get(k);
        if (sett) {
          if (!featureNames[k]) featureNames[k] = {};
          // Remove the generic settlement key if we can be more specific
          const fn = featureNames[k];
          if (features[k] && features[k].includes("town")) {
            delete fn.settlement; fn.town = sett.name;
          } else if (terrain[k] === "dense_urban") {
            delete fn.settlement; fn.dense_urban = sett.name;
          } else if (terrain[k] === "light_urban") {
            delete fn.settlement; fn.light_urban = sett.name;
          }
          // else: keep fn.settlement as-is
        }
      }
    }
  }

  // Strategic dam resolution — only dams adjacent to lake terrain (actual reservoirs)
  if (tier === "strategic" && damCandidates.length > 0) {
    const isLake = t => ["lake", "deep_water", "coastal_water"].includes(t);
    for (const k of damCandidates) {
      const [c, r] = k.split(",").map(Number);
      let adjLake = false;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (terrain[nk] && isLake(terrain[nk])) { adjLake = true; break; }
      }
      if (adjLake) {
        cellDam.add(k);
        // Patch features and infra for this cell
        if (!features[k]) features[k] = [];
        if (!features[k].includes("dam")) features[k].push("dam");
        if (infra[k] === "none") infra[k] = "dam";
      }
    }
  }

  return { terrain, infra, attrs, features, featureNames, elevG, elevCoverage: elevData.coverage, cellRoadCount, cellBuildingPct, cellStream, cellBarrier, cellConfidence, urbanScore };
}

// ════════════════════════════════════════════════════════════════
// POST-PROCESSING
// ════════════════════════════════════════════════════════════════

function postProc(terrain, infra, attrs, features, featureNames, cols, rows, elevG, cellKm, elevCoverage, cellRoadCount, cellBuildingPct, tier, wcGrid, wcHasData, wcMix, urbanScore) {
  let tG = { ...terrain }, iG = { ...infra }, aG = {};
  for (const k in attrs) aG[k] = [...attrs[k]];
  // Features: deep copy
  const fG = {};
  for (const k in features) fG[k] = [...(features[k] || [])];
  // Feature names: deep copy
  const fnG = {};
  for (const k in featureNames) fnG[k] = { ...featureNames[k] };

  const isW = t => ["deep_water", "coastal_water", "lake", "river"].includes(t);
  const isForest = t => ["forest", "dense_forest", "mountain_forest"].includes(t);
  const isOpen = t => ["open_ground", "light_veg", "highland", "desert", "farmland"].includes(t);

  // ── OCEAN ──
  // Flood-fill from map edges to identify ocean cells.
  // Requires WorldCover water signal or missing WC data (ocean tiles return 404).
  // Desert terrain is never ocean — prevents flooding Dead Sea, Caspian Depression, etc.
  const doOcean = elevCoverage > 0.5;
  if (doOcean) {
    // Ocean candidate: low elevation cells that aren't clearly land.
    // Key exclusions to prevent flooding real land:
    //  - desert terrain (Dead Sea, Caspian Depression)
    //  - cells with real WC data showing specific land types (farmland, forest, urban, wetland)
    //    These are genuinely land even if at sea level (e.g. Netherlands polders)
    //  - only open_ground/lake terrain types can become ocean
    const WC_DEFINITE_LAND = new Set(["farmland", "forest", "dense_forest", "light_veg", "wetland", "light_urban", "dense_urban", "ice"]);
    const isCand = k => {
      const t = tG[k], e = elevG[k] || 0;
      if (t === "desert") return false;
      if (!(t === "open_ground" || t === "lake")) return false;
      if (e > 1) return false;
      // If WC has real data showing definite land cover, this is not ocean
      if (wcHasData && wcHasData.has(k) && wcGrid) {
        const wcVal = wcGrid[k];
        if (WC_DEFINITE_LAND.has(wcVal)) return false;
      }
      return true;
    };

    // Seed BFS from map edges
    const vis = new Set(), bQ = [];
    for (let c = 0; c < cols; c++) { for (const r of [0, rows - 1]) { const k = `${c},${r}`; if (isCand(k)) { vis.add(k); bQ.push(k); } } }
    for (let r = 0; r < rows; r++) { for (const cc of [0, cols - 1]) { const k = `${cc},${r}`; if (!vis.has(k) && isCand(k)) { vis.add(k); bQ.push(k); } } }

    // BFS flood-fill to find connected ocean components
    const cellComponent = {}; // k -> component id
    let componentId = 0;
    const componentSizes = {};
    const processed = new Set();

    for (let si = 0; si < bQ.length; si++) {
      if (processed.has(bQ[si])) continue;
      const cid = componentId++;
      const compQ = [bQ[si]];
      let cqi = 0;
      processed.add(bQ[si]);
      while (cqi < compQ.length) {
        const ck = compQ[cqi++];
        cellComponent[ck] = cid;
        const [cc, cr] = ck.split(",").map(Number);
        for (const [nc, nr] of getNeighbors(cc, cr)) {
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
            const nk = `${nc},${nr}`;
            if (!processed.has(nk) && isCand(nk)) {
              processed.add(nk);
              compQ.push(nk);
              if (!vis.has(nk)) { vis.add(nk); bQ.push(nk); }
            }
          }
        }
      }
      componentSizes[cid] = compQ.length;
    }

    // Only keep components with >= 5 cells (filter small inland depressions)
    const minOceanCluster = 5;
    const ocean = new Set();
    for (const [k, cid] of Object.entries(cellComponent)) {
      if (componentSizes[cid] >= minOceanCluster) ocean.add(k);
    }

    // Compute land distance for deep vs coastal classification
    const ld = {}, ldQ = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (!isW(tG[k]) && !ocean.has(k)) { ld[k] = 0; ldQ.push(k); }
    }
    let qi = 0;
    while (qi < ldQ.length) {
      const [cc, cr] = ldQ[qi].split(",").map(Number);
      for (const [nc, nr] of getNeighbors(cc, cr)) {
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          const nk = `${nc},${nr}`;
          if (ld[nk] === undefined) { ld[nk] = (ld[ldQ[qi]] || 0) + 1; ldQ.push(nk); }
        }
      }
      qi++;
    }
    for (const k of ocean) tG[k] = (ld[k] || 0) > 3 ? "deep_water" : "coastal_water";
  }

  // ── URBAN MORPHOLOGICAL CLEANUP ──
  // Erosion: remove urban cells with too few urban neighbors (catches remaining speckle
  // from the cluster phase — e.g. cluster edge cells that barely qualified).
  // Dilation: fill non-urban gaps surrounded by urban (parks/plazas inside cities).
  if (tier !== "sub-tactical") {
    const EROSION_MIN = tier === "strategic" ? 4 : 2; // strategic: 4 of 6 neighbors must be urban
    const DILATION_MIN = 4; // minimum urban neighbors to fill a gap

    // Erosion pass — revert isolated urban cells to their natural WC class
    const toErode = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = `${c},${r}`;
        if (!["light_urban", "dense_urban"].includes(tG[k])) continue;
        let urbanNeighbors = 0;
        for (const [nc, nr] of getNeighbors(c, r)) {
          const nk = `${nc},${nr}`;
          if (tG[nk] && ["light_urban", "dense_urban"].includes(tG[nk])) urbanNeighbors++;
        }
        if (urbanNeighbors < EROSION_MIN) toErode.push(k);
      }
    }
    for (const k of toErode) {
      if (wcMix && wcMix[k]) {
        let bestNat = "open_ground", bestPct = 0;
        for (const [cls, pct] of Object.entries(wcMix[k])) {
          if (cls !== "light_urban" && cls !== "dense_urban" && pct > bestPct) {
            bestNat = cls; bestPct = pct;
          }
        }
        tG[k] = bestNat;
      } else {
        tG[k] = "open_ground";
      }
      // Eroded cell with town-level signal becomes a town feature
      if ((urbanScore[k] || 0) >= 0.08) {
        if (!fG[k]) fG[k] = [];
        if (!fG[k].includes("town")) fG[k].push("town");
      }
    }

    // Dilation pass — fill single-cell holes inside urban clusters
    const toDilate = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = `${c},${r}`;
        if (["light_urban", "dense_urban"].includes(tG[k])) continue;
        if (isW(tG[k])) continue; // don't fill water cells
        let urbanNeighbors = 0;
        for (const [nc, nr] of getNeighbors(c, r)) {
          const nk = `${nc},${nr}`;
          if (tG[nk] && ["light_urban", "dense_urban"].includes(tG[nk])) urbanNeighbors++;
        }
        if (urbanNeighbors >= DILATION_MIN) toDilate.push(k);
      }
    }
    for (const k of toDilate) {
      tG[k] = "light_urban";
      // Remove town feature — cell is now urban terrain
      if (fG[k]) {
        const idx = fG[k].indexOf("town");
        if (idx !== -1) fG[k].splice(idx, 1);
      }
    }
  }

  // ── BEACH — only from OSM natural=beach (already in fG from classifyGrid) ──
  // Algorithmic detection removed — too aggressive at strategic scale

  // ── CLIFFS — 250m/km ──
  const cliffThresh = cellKm * 250;
  if (tier !== "strategic") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const e = elevG[k] || 0;
      let maxD = 0;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (elevG[nk] !== undefined) { const d = Math.abs(e - (elevG[nk] || 0)); if (d > maxD) maxD = d; }
      }
      if (maxD >= cliffThresh) { if (!aG[k]) aG[k] = []; aG[k].push("cliffs"); }
    }
  }

  // ── RIDGELINE ──
  if (tier !== "strategic") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (isW(tG[k])) continue;
      const e = elevG[k] || 0;
      if (e < 50) continue;
      let isR = true, nb = 0;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (elevG[nk] !== undefined) { nb++; if (e - (elevG[nk] || 0) < 30) { isR = false; break; } }
      }
      if (isR && nb >= 4) { if (!aG[k]) aG[k] = []; aG[k].push("ridgeline"); }
    }
  }

  // ── TREELINE (tactical/sub-tactical only — at strategic every forest edge is treeline = noise) ──
  if (tier === "sub-tactical" || tier === "tactical") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (!isForest(tG[k])) continue;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (tG[nk] && isOpen(tG[nk])) { if (!aG[k]) aG[k] = []; aG[k].push("treeline"); break; }
      }
    }
  }

  // ── SLOPE (sub-tactical + tactical) ──
  if (tier === "sub-tactical" || tier === "tactical") {
    const slopeKm = cellKm > 0 ? cellKm : 0.01;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const e = elevG[k] || 0;
      let maxD = 0;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (elevG[nk] !== undefined) { const d = Math.abs(e - (elevG[nk] || 0)); if (d > maxD) maxD = d; }
      }
      const slopeDeg = Math.atan(maxD / (slopeKm * 1000)) * (180 / Math.PI);
      if (!aG[k]) aG[k] = [];
      if (tier === "sub-tactical" && slopeDeg > 30) aG[k].push("slope_extreme");
      else if (slopeDeg > 15) aG[k].push("slope_steep");
    }
  }

  // ── BUILDING DENSITY (sub-tactical) ──
  if (tier === "sub-tactical" && cellBuildingPct) {
    for (const [k, pct] of Object.entries(cellBuildingPct)) {
      if (!aG[k]) aG[k] = [];
      if (pct > 0.5) aG[k].push("building_dense");
      else if (pct > 0.1) aG[k].push("building_sparse");
    }
  }

  // ── ELEVATION ADVANTAGE (sub-tactical + tactical) ──
  if (tier === "sub-tactical" || tier === "tactical") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (isW(tG[k])) continue;
      const e = elevG[k] || 0;
      let nb = 0, totalNeighE = 0;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (elevG[nk] !== undefined) { nb++; totalNeighE += (elevG[nk] || 0); }
      }
      if (nb >= 2 && e - (totalNeighE / nb) >= 50) {
        if (!aG[k]) aG[k] = [];
        aG[k].push("elevation_advantage");
      }
    }
  }

  // ── PORT ──
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = `${c},${r}`;
    if (!["dense_urban", "light_urban"].includes(tG[k])) continue;
    if (iG[k] !== "none") continue;
    let isPort = false;
    for (const [nc, nr] of getNeighbors(c, r)) {
      const nk = `${nc},${nr}`;
      if (tG[nk] && isW(tG[nk])) { isPort = true; break; }
    }
    if (isPort) {
      iG[k] = "port";
      if (!fG[k]) fG[k] = [];
      fG[k].push("port");
    }
  }

  // ── MERGE postProc attributes into features ──
  for (const k in aG) {
    if (!fG[k]) fG[k] = [];
    for (const a of aG[k]) {
      if (!fG[k].includes(a)) fG[k].push(a);
    }
  }

  return { terrain: tG, infra: iG, attrs: aG, features: fG, featureNames: fnG };
}

// ════════════════════════════════════════════════════════════════
// BATCH SCAN — pipeline entry point for world scanner
// Runs the full terrain pipeline for a single geographic patch.
// Returns cell array suitable for binary encoding and storage.
// ════════════════════════════════════════════════════════════════

export async function scanSinglePatch(bbox, cellKm, callbacks = {}) {
  const { onStatus = () => {}, onProgress = () => {}, log = null } = callbacks;
  const tier = getQueryTier(cellKm);
  const cols = Math.max(1, Math.round((bbox.east - bbox.west) * 111.32 * Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180) / cellKm));
  const rows = Math.max(1, Math.round((bbox.north - bbox.south) * 111.32 / (cellKm * SQRT3_2)));

  if (cols * rows > 50000) throw new Error(`Patch too large: ${cols}×${rows} = ${cols * rows} cells`);

  const proj = createHexProjection(bbox, cols, rows);

  // Phase 1: Elevation
  onStatus("Elevation...");
  const elevData = await fetchElevSmart(bbox, cols, rows, onStatus, onProgress, log);

  // Phase 2: WorldCover
  onStatus("WorldCover...");
  let wcData = null;
  try {
    wcData = await fetchWorldCover(bbox, cols, rows, onStatus, onProgress, log, tier);
  } catch (e) {
    if (log) log.warn(`WorldCover failed: ${e.message}`);
  }

  // Phase 3: OSM + parallel data
  onStatus("OSM features...");
  const mapWKm = (bbox.east - bbox.west) * 111.32 * Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180);
  const mapHKm = (bbox.north - bbox.south) * 111.32;

  const wikidataPromise = (tier === "strategic" || tier === "operational")
    ? fetchWikidataRivers(bbox, tier, log, cellKm).catch(() => null)
    : Promise.resolve(null);
  const aridityPromise = fetchAridityData(bbox, cols, rows, onStatus, log);
  const metroCitiesPromise = (tier === "operational" || tier === "strategic")
    ? import("./data/cities.json").then(m => m.default || m).catch(() => null)
    : Promise.resolve(null);

  const els = await fetchOSM(bbox, onStatus, onProgress, mapWKm, mapHKm, cellKm, elevData.elevations, cols, rows, log);
  const feat = parseFeatures(els, tier);

  const wikidataNames = await wikidataPromise;
  const whitelistNames = (tier === "strategic" || tier === "operational")
    ? getRiverWhitelistNames(tier, cellKm) : null;
  const wikidataRivers = whitelistNames
    ? new Set([...whitelistNames, ...(wikidataNames || [])])
    : wikidataNames;
  const aridityGrid = await aridityPromise;
  const metroCities = await metroCitiesPromise;

  // Phase 4: Classify
  onStatus("Classifying...");
  const res = classifyGrid(bbox, cols, rows, feat, elevData, onStatus, wcData, tier, cellKm, wikidataRivers, aridityGrid, metroCities);

  // Phase 5: Post-process
  onStatus("Post-processing...");
  const pp = postProc(res.terrain, res.infra, res.attrs, res.features, res.featureNames,
    cols, rows, res.elevG, cellKm, res.elevCoverage, res.cellRoadCount, res.cellBuildingPct,
    tier, wcData ? wcData.wcGrid : null, wcData ? wcData.wcHasData : null,
    wcData ? wcData.wcMix : null, res.urbanScore || {});

  // Build cell array with lat/lng for binary encoding
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const { lon, lat } = proj.cellCenter(c, r);
      const cell = {
        terrain: pp.terrain[k] || "open_ground",
        infrastructure: pp.infra[k] || "none",
        elevation: res.elevG[k] || 0,
        features: pp.features[k] || [],
        attributes: pp.attrs[k] || [],
        lat,
        lng: lon,
      };
      if (res.cellConfidence && res.cellConfidence[k] !== undefined) {
        cell.confidence = res.cellConfidence[k];
      }
      if (pp.featureNames && pp.featureNames[k]) {
        cell.feature_names = pp.featureNames[k];
      }
      cells.push(cell);
    }
  }

  return { cells, cols, rows, tier, bbox };
}

// Also export key utility functions for the world scanner
export { getBBox, getWCTilesForBbox, getQueryTier, getChunkSize };

// ════════════════════════════════════════════════════════════════
// CANVAS MAP
// ════════════════════════════════════════════════════════════════

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function buildColorLUT(types) {
  const lut = {};
  types.forEach(t => { lut[t.id] = hexToRgb(t.color); });
  return lut;
}

const TERR_LUT = buildColorLUT(TERRAIN_TYPES);
const INFRA_LUT = buildColorLUT(INFRA_TYPES);

function CanvasMap({ grid, colorLUT, gC, gR, elevG, features, featureNames: fnG, activeFeatures, opacity, paintType, onPaint }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [tf, setTf] = useState({ x: 0, y: 0, s: 1 });
  const [drag, setDrag] = useState(false);
  const dsRef = useRef({ x: 0, y: 0 });
  const [hov, setHov] = useState(null);

  // Hex layout: compute hex size from canvas width
  const CANVAS_W = Math.min(700, Math.max(400, gC * 3));
  const hexSize = CANVAS_W / (SQRT3 * (gC + 0.5));
  const CANVAS_H = Math.max(1, Math.round((1.5 * gR + 0.5) * hexSize));
  // Padding so cell (0,0) hex doesn't clip at edges
  const padX = SQRT3_2 * hexSize;
  const padY = hexSize;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imgData.data;
    const alpha = Math.round((opacity / 100) * 255);

    // Per-pixel terrain fill: for each pixel, determine which hex it belongs to
    for (let py = 0; py < CANVAS_H; py++) {
      for (let px = 0; px < CANVAS_W; px++) {
        const { col, row } = pixelToOffset(px - padX, py - padY, hexSize);
        if (col < 0 || col >= gC || row < 0 || row >= gR) continue;
        const k = `${col},${row}`;
        const val = grid[k];
        const rgb = colorLUT[val] || [18, 24, 42];
        const idx = (py * CANVAS_W + px) * 4;
        data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = alpha;
      }
    }

    // Feature overlay: tint hex pixels at each cell center
    for (let r = 0; r < gR; r++) {
      for (let c = 0; c < gC; c++) {
        const k = `${c},${r}`;
        const cellFeats = features?.[k] || [];
        const active = cellFeats.filter(f => activeFeatures?.has(f));
        if (active.length === 0) continue;

        const { x: hcx, y: hcy } = offsetToPixel(c, r, hexSize);
        const cx = hcx + padX, cy = hcy + padY;
        const dotR = hexSize * 0.45; // radius of feature dot

        if (active.includes("town")) {
          // Town: tint a ring of pixels around the hex center
          const trgb = [232, 160, 64]; // #E8A040
          const ringOuter = hexSize * 0.85, ringInner = hexSize * 0.65;
          const lo = Math.max(0, Math.floor(cx - ringOuter)), hi = Math.min(CANVAS_W, Math.ceil(cx + ringOuter));
          const to = Math.max(0, Math.floor(cy - ringOuter)), bo = Math.min(CANVAS_H, Math.ceil(cy + ringOuter));
          for (let py2 = to; py2 < bo; py2++) for (let px2 = lo; px2 < hi; px2++) {
            const dx = px2 - cx, dy = py2 - cy, dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= ringInner && dist <= ringOuter) {
              const idx = (py2 * CANVAS_W + px2) * 4;
              data[idx] = trgb[0]; data[idx + 1] = trgb[1]; data[idx + 2] = trgb[2]; data[idx + 3] = 255;
            }
          }
        }

        const nonTown = active.filter(f => f !== "town");
        if (nonTown.length > 0) {
          const fi = getFeatureInfo(nonTown[0]);
          const frgb = hexToRgb(fi.color);
          const lo = Math.max(0, Math.floor(cx - dotR)), hi = Math.min(CANVAS_W, Math.ceil(cx + dotR));
          const to = Math.max(0, Math.floor(cy - dotR)), bo = Math.min(CANVAS_H, Math.ceil(cy + dotR));
          for (let py2 = to; py2 < bo; py2++) for (let px2 = lo; px2 < hi; px2++) {
            const dx = px2 - cx, dy = py2 - cy;
            if (dx * dx + dy * dy <= dotR * dotR) {
              const idx = (py2 * CANVAS_W + px2) * 4;
              data[idx] = Math.round(data[idx] * 0.35 + frgb[0] * 0.65);
              data[idx + 1] = Math.round(data[idx + 1] * 0.35 + frgb[1] * 0.65);
              data[idx + 2] = Math.round(data[idx + 2] * 0.35 + frgb[2] * 0.65);
              data[idx + 3] = 255;
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Hex grid outlines at zoom
    if (tf.s * hexSize > 6) {
      ctx.lineWidth = 0.5;
      for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
        const { x: hcx, y: hcy } = offsetToPixel(c, r, hexSize);
        const isMajor = (c % 10 === 0 || r % 10 === 0);
        ctx.strokeStyle = isMajor ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)";
        ctx.lineWidth = isMajor ? 1 : 0.5;
        ctx.beginPath();
        traceHexPath(ctx, hcx + padX, hcy + padY, hexSize);
        ctx.stroke();
      }
    }

    // Hover highlight as hex outline
    if (hov) {
      const [hc, hr] = hov.split(",").map(Number);
      const { x: hcx, y: hcy } = offsetToPixel(hc, hr, hexSize);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath();
      traceHexPath(ctx, hcx + padX, hcy + padY, hexSize);
      ctx.stroke();
    }
  }, [grid, colorLUT, gC, gR, CANVAS_W, CANVAS_H, hexSize, padX, padY, opacity, features, activeFeatures, tf.s, hov]);

  useEffect(() => { draw(); }, [draw]);

  const mouseToCell = useCallback((e) => {
    const wrap = wrapRef.current; if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const mx = (e.clientX - rect.left - tf.x) / tf.s, my = (e.clientY - rect.top - tf.y) / tf.s;
    const { col, row } = pixelToOffset(mx - padX, my - padY, hexSize);
    if (col >= 0 && col < gC && row >= 0 && row < gR) return `${col},${row}`;
    return null;
  }, [tf, hexSize, padX, padY, gC, gR]);

  const onWh = useCallback(e => {
    e.preventDefault();
    const wrap = wrapRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setTf(p => { const d = e.deltaY > 0 ? 0.85 : 1.18; const ns = Math.max(0.5, Math.min(20, p.s * d)); const sc = ns / p.s; return { x: mx - (mx - p.x) * sc, y: my - (my - p.y) * sc, s: ns }; });
  }, []);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    el.addEventListener("wheel", onWh, { passive: false });
    return () => el.removeEventListener("wheel", onWh);
  }, [onWh]);

  const hovData = hov ? { val: grid[hov], elev: elevG?.[hov], feats: features?.[hov] || [], fnames: fnG?.[hov] || {} } : null;

  return (
    <div>
      <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, color: colors.text.primary, marginBottom: space[1] }}>Terrain {"\u2014"} Physical Surface</div>
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 4, right: 4, zIndex: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={() => setTf(p => ({ ...p, s: Math.min(20, p.s * 1.5) }))} style={zbtnS}>+</button>
          <button onClick={() => setTf(p => ({ ...p, s: Math.max(0.5, p.s / 1.5) }))} style={zbtnS}>{"\u2013"}</button>
          <button onClick={() => setTf({ x: 0, y: 0, s: 1 })} style={{ ...zbtnS, fontSize: 7 }}>Fit</button>
        </div>
        <div style={{ position: "absolute", bottom: 4, left: 4, zIndex: 10, fontSize: typography.body.xs, color: colors.text.muted, background: colors.bg.overlay, padding: "1px 5px", borderRadius: radius.sm, fontFamily: typography.monoFamily, backdropFilter: "blur(8px)" }}>{(tf.s * 100).toFixed(0)}%</div>
        <div ref={wrapRef}
          onMouseDown={e => { if (paintType) { const cell = mouseToCell(e); if (cell) { const [c, r] = cell.split(",").map(Number); onPaint(c, r); } } else { setDrag(true); dsRef.current = { x: e.clientX - tf.x, y: e.clientY - tf.y }; } }}
          onMouseMove={e => { if (drag) { setTf(p => ({ ...p, x: e.clientX - dsRef.current.x, y: e.clientY - dsRef.current.y })); } else { const cell = mouseToCell(e); if (cell !== hov) setHov(cell); } }}
          onMouseUp={() => setDrag(false)} onMouseLeave={() => { setDrag(false); setHov(null); }}
          style={{ width: CANVAS_W, height: CANVAS_H, overflow: "hidden", borderRadius: radius.md, border: `1px solid ${colors.border.default}`, background: colors.bg.base, position: "relative", cursor: drag ? "grabbing" : paintType ? "crosshair" : "grab" }}
        >
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ position: "absolute", transform: `translate(${tf.x}px,${tf.y}px) scale(${tf.s})`, transformOrigin: "0 0", imageRendering: "pixelated" }} />
        </div>
      </div>
      {hovData && (
        <div style={{ marginTop: space[1], padding: space[1] + 2, background: colors.bg.raised, borderRadius: radius.md, fontSize: typography.body.xs, display: "flex", alignItems: "center", gap: space[1] + 1, flexWrap: "wrap", border: `1px solid ${colors.border.subtle}` }}>
          <div style={{ width: 10, height: 10, borderRadius: radius.sm, background: `rgb(${(colorLUT[hovData.val] || [51, 51, 51]).join(",")})`, border: "1px solid rgba(255,255,255,0.15)" }} />
          <span style={{ fontWeight: typography.weight.bold, color: `rgb(${(colorLUT[hovData.val] || [150, 150, 150]).join(",")})` }}>{(TT[hovData.val] || { label: hovData.val }).label}{hovData.fnames[hovData.val] ? ` — ${hovData.fnames[hovData.val]}` : ""}{hovData.fnames.settlement ? ` — ${hovData.fnames.settlement}` : ""}</span>
          <span style={{ color: colors.text.muted, fontFamily: typography.monoFamily }}>[{hov}] {hovData.elev !== undefined ? `${hovData.elev}m` : ""}</span>
          {hovData.feats.map(f => { const fi = getFeatureInfo(f); const nm = hovData.fnames[f]; return (<span key={f} style={{ fontSize: typography.body.xs, padding: "1px 4px", borderRadius: radius.sm, background: `${fi.color}20`, color: fi.color, border: `1px solid ${fi.color}40` }}>{fi.label}{nm ? ` (${nm})` : ""}</span>); })}
        </div>
      )}
    </div>
  );
}

const zbtnS = { width: 24, height: 24, borderRadius: radius.sm, border: `1px solid ${colors.border.default}`, background: colors.bg.raised, color: colors.text.primary, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: typography.fontFamily };

// ════════════════════════════════════════════════════════════════
// PROGRESS BAR
// ════════════════════════════════════════════════════════════════

function ProgressBar({ progress, status, startTime }) {
  if (!progress) return null;
  const { phase, current, total, skipped } = progress;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
  const rate = elapsed > 0 && current > 0 ? current / elapsed : 0;
  const remaining = rate > 0 ? Math.round((total - current) / rate) : 0;

  const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  return (
    <div style={{ marginTop: space[2], padding: space[2], background: colors.bg.raised, borderRadius: radius.lg, border: `1px solid ${colors.border.subtle}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[1] }}>
        <span style={{ fontSize: typography.body.xs + 1, fontWeight: typography.weight.bold, color: colors.text.primary, fontFamily: typography.fontFamily }}>{phase}</span>
        <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
          {current}/{total}{skipped ? ` (+${skipped} ocean skipped)` : ""} {"\u2022"} {fmtTime(elapsed)} elapsed
          {remaining > 0 && current < total ? ` \u2022 ~${fmtTime(remaining)} remaining` : ""}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: radius.full, background: colors.bg.input, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: radius.full, background: phase === "Elevation" ? colors.accent.purple : phase === "WorldCover" ? colors.accent.amber : colors.accent.green, width: `${pct}%`, transition: `width ${animation.normal}`, backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }} />
      </div>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1], fontFamily: typography.fontFamily }}>{status}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SCALE PRESETS
// ════════════════════════════════════════════════════════════════

const SCALE_PRESETS = [
  { id: "close", label: "Close", cell: 0.1, w: 8, h: 8, desc: "Individual positions & key buildings. Platoon-to-company engagement areas, every path and structure visible.", units: "Plt–Coy", color: "#E879F9" },
  { id: "tactical", label: "Tactical", cell: 0.5, w: 40, h: 40, desc: "Company battle positions and engagement areas. Key terrain shaping platoon/company maneuver.", units: "Coy–Bn", color: "#22C55E" },
  { id: "grand-tactical", label: "Grand Tactical", cell: 2, w: 150, h: 150, desc: "Multiple division frontages. How terrain channels corps-level maneuver — gaps, phase lines, obstacles.", units: "Bn–Bde", color: "#3B82F6" },
  { id: "operational", label: "Operational", cell: 5, w: 350, h: 350, desc: "Full corps deep operations. FLOT to strategic rear — all LOCs, river crossings, and urban centers.", units: "Bde–Div", color: "#F59E0B" },
  { id: "strategic", label: "Strategic", cell: 10, w: 1000, h: 1000, desc: "Full theater geometry. Mountain ranges, river systems, and urban belts defining axes of advance.", units: "Div–Corps", color: "#EF4444" },
  { id: "theater", label: "Theater", cell: 20, w: 2000, h: 2000, desc: "Continental-scale campaign planning. Where natural theaters divide, strategic chokepoints and LOCs.", units: "Corps+", color: "#DC2626" },
];

const LOCATION_PRESETS = {
  "close": [
    { label: "Fallujah", lat: 33.35, lng: 43.78, note: "2004 — definitive modern urban battle" },
    { label: "Hue City", lat: 16.47, lng: 107.58, note: "1968 Tet — block-by-block clearing" },
    { label: "Mogadishu", lat: 2.05, lng: 45.32, note: "1993 — Black Hawk Down" },
    { label: "Bakhmut", lat: 48.59, lng: 38.00, note: "2023 — grinding urban attrition" },
    { label: "Azovstal", lat: 47.10, lng: 37.56, note: "2022 — industrial fortress siege" },
    { label: "Sadr City", lat: 33.40, lng: 44.42, note: "2004–08 — urban counterinsurgency" },
    { label: "Ortona", lat: 42.35, lng: 14.40, note: "1943 — Italian Stalingrad" },
    { label: "Normandy Bocage", lat: 49.10, lng: -1.05, note: "1944 — hedgerow country at squad level" },
  ],
  "tactical": [
    { label: "73 Easting", lat: 26.31, lng: 47.38, note: "1991 — textbook armored meeting engagement" },
    { label: "Ia Drang Valley", lat: 13.58, lng: 107.85, note: "1965 — first major US-NVA contact" },
    { label: "Goose Green", lat: -51.82, lng: -59.98, note: "1982 — 2 Para across open ground" },
    { label: "Chosin Reservoir", lat: 40.45, lng: 127.10, note: "1950 — fighting withdrawal through mountains" },
    { label: "Arnhem Bridge", lat: 51.98, lng: 5.91, note: "1944 — a bridge too far" },
    { label: "Bastogne", lat: 50.00, lng: 5.72, note: "1944 — the hold that broke the Bulge" },
    { label: "Normandy Bocage", lat: 49.10, lng: -1.05, note: "1944 — hedgerow hell, the original bocage" },
    { label: "Longewala", lat: 25.46, lng: 70.20, note: "1971 — company holding against a brigade" },
  ],
  "grand-tactical": [
    { label: "Normandy Beaches", lat: 49.35, lng: -0.85, note: "1944 — D-Day landings and bocage" },
    { label: "Golan Heights", lat: 33.00, lng: 35.80, note: "1973 — 177 tanks vs 1,400" },
    { label: "Kursk", lat: 51.75, lng: 36.20, note: "1943 — largest armor engagement in history" },
    { label: "Inchon", lat: 37.45, lng: 126.65, note: "1950 — amphibious masterstroke" },
    { label: "Tora Bora", lat: 34.08, lng: 70.56, note: "2001 — mountain pursuit" },
    { label: "Kherson", lat: 46.63, lng: 32.62, note: "2022 — river crossing and counteroffensive" },
  ],
  "operational": [
    { label: "Desert Storm", lat: 29.50, lng: 47.00, note: "1991 — the left hook through Kuwait" },
    { label: "Sinai Peninsula", lat: 29.50, lng: 33.80, note: "1967/73 — same terrain, opposite outcomes" },
    { label: "Market Garden", lat: 51.45, lng: 5.47, note: "1944 — 100km airborne corridor" },
    { label: "Manchuria", lat: 45.00, lng: 125.00, note: "1945 — Soviet deep operation masterpiece" },
    { label: "Northern Ukraine", lat: 50.80, lng: 30.50, note: "2022 — failed multi-axis advance" },
  ],
  "strategic": [
    { label: "Western Front WWI", lat: 49.50, lng: 3.00, note: "1914–18 — Channel to Switzerland" },
    { label: "NATO Central Front", lat: 50.50, lng: 9.50, note: "Cold War — Fulda Gap to NORTHAG" },
    { label: "Korean Peninsula", lat: 37.50, lng: 127.00, note: "Busan to the Yalu" },
    { label: "Eastern Front 1941", lat: 52.00, lng: 30.00, note: "Barbarossa — three army group axes" },
    { label: "Baltic States", lat: 56.50, lng: 24.00, note: "The Suwalki corridor problem" },
  ],
  "theater": [
    { label: "European Theater", lat: 50.00, lng: 15.00, note: "Atlantic to the Urals" },
    { label: "Indo-Pacific", lat: 20.00, lng: 130.00, note: "First and Second Island Chain" },
    { label: "CENTCOM AOR", lat: 28.00, lng: 52.00, note: "Eastern Med through the Gulf" },
    { label: "Pacific Theater WWII", lat: 15.00, lng: 145.00, note: "Island-hopping geometry" },
    { label: "Eastern Front Full", lat: 52.00, lng: 38.00, note: "1941–45 — Leningrad to Stalingrad" },
  ],
  "custom": [
    { label: "Korean DMZ", lat: 37.95, lng: 126.95 },
    { label: "Suwalki Gap", lat: 54.10, lng: 23.00 },
    { label: "Taiwan Strait", lat: 24.50, lng: 119.50 },
    { label: "Strait of Hormuz", lat: 26.50, lng: 56.30 },
    { label: "Fulda Gap", lat: 50.55, lng: 9.68 },
    { label: "Suez Canal", lat: 30.50, lng: 32.35 },
    { label: "Golan Heights", lat: 33.00, lng: 35.80 },
    { label: "Kaliningrad", lat: 54.70, lng: 20.50 },
  ],
};

// ════════════════════════════════════════════════════════════════
// DISTRIBUTION
// ════════════════════════════════════════════════════════════════

function Dist({ grid, types }) {
  const ct = {}; Object.values(grid).forEach(t => { ct[t] = (ct[t] || 0) + 1; });
  const tot = Object.values(ct).reduce((s, c) => s + c, 0);
  return types.filter(t => ct[t.id]).sort((a, b) => (ct[b.id] || 0) - (ct[a.id] || 0)).map(t => {
    const p = ((ct[t.id] / tot) * 100).toFixed(1);
    return (<div key={t.id} style={{ marginBottom: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: typography.body.xs + 1, color: colors.text.primary, fontFamily: typography.fontFamily }}>
        <div style={{ display: "flex", alignItems: "center", gap: space[1] }}><div style={{ width: 7, height: 7, borderRadius: 2, background: t.color, flexShrink: 0 }} />{t.label}</div>
        <span style={{ fontFamily: typography.monoFamily, color: colors.text.secondary }}>{ct[t.id]} ({p}%)</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: colors.bg.input, marginTop: 2 }}><div style={{ height: 4, borderRadius: 2, background: t.color, width: `${p}%`, opacity: 0.8, transition: `width ${animation.normal}` }} /></div>
    </div>);
  });
}

function FeatureFilterPanel({ features, activeFeatures, onToggle, onToggleGroup, onToggleAll, total }) {
  // Count features
  const ct = {};
  if (features) Object.values(features).forEach(f => { if (f) f.forEach(x => { ct[x] = (ct[x] || 0) + 1; }); });
  if (Object.keys(ct).length === 0) return <div style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.fontFamily }}>No features found</div>;

  // Group by category
  const groups = {};
  for (const [id, count] of Object.entries(ct)) {
    const fi = getFeatureInfo(id);
    if (!groups[fi.group]) groups[fi.group] = [];
    groups[fi.group].push({ id, count, ...fi });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 3, marginBottom: space[2], flexWrap: "wrap" }}>
        <div onClick={() => onToggleAll(true)} style={{ padding: "2px 7px", borderRadius: radius.sm, fontSize: typography.body.xs, cursor: "pointer", background: colors.bg.surface, color: colors.text.secondary, border: `1px solid ${colors.border.subtle}`, transition: `all ${animation.fast}` }}>All On</div>
        <div onClick={() => onToggleAll(false)} style={{ padding: "2px 7px", borderRadius: radius.sm, fontSize: typography.body.xs, cursor: "pointer", background: colors.bg.surface, color: colors.text.secondary, border: `1px solid ${colors.border.subtle}`, transition: `all ${animation.fast}` }}>All Off</div>
        {FEATURE_GROUPS.filter(g => groups[g]).map(g => (
          <div key={g} onClick={() => onToggleGroup(g, groups[g])} style={{ padding: "2px 7px", borderRadius: radius.sm, fontSize: typography.body.xs, cursor: "pointer", background: colors.bg.surface, border: `1px solid ${colors.border.subtle}`, color: colors.text.secondary, transition: `all ${animation.fast}` }}>{g}</div>
        ))}
      </div>
      {FEATURE_GROUPS.filter(g => groups[g]).map(g => (
        <div key={g} style={{ marginBottom: space[2] }}>
          <div onClick={() => onToggleGroup(g, groups[g])} style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.text.muted, textTransform: "uppercase", letterSpacing: typography.letterSpacing.wide, marginBottom: space[1], cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: space[1] }}>
            <div style={{ width: 2, height: 10, borderRadius: 1, background: colors.accent.amber, flexShrink: 0 }} />
            {g}
          </div>
          {groups[g].sort((a, b) => b.count - a.count).map(f => {
            const isOn = activeFeatures.has(f.id);
            return (
              <div key={f.id} onClick={() => onToggle(f.id)} style={{ display: "flex", alignItems: "center", gap: space[1], padding: "2px 0", cursor: "pointer", fontSize: typography.body.xs, opacity: isOn ? 1 : 0.25, transition: `opacity ${animation.fast}` }}>
                <div style={{ width: 9, height: 9, borderRadius: radius.sm, background: f.color, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0, boxShadow: isOn ? `0 0 6px ${f.color}40` : "none" }} />
                <span style={{ fontFamily: typography.fontFamily }}>{f.label}</span>
                <span style={{ marginLeft: "auto", color: colors.text.muted, fontSize: typography.body.xs, fontFamily: typography.monoFamily }}>{f.count} ({((f.count / total) * 100).toFixed(1)}%)</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════

export default function Parser({ onBack, onViewMap }) {
  const [step, setStep] = useState("input");
  const [lat, setLat] = useState(40.45), [lng, setLng] = useState(127.10);
  const [mapW, setMapW] = useState(40), [mapH, setMapH] = useState(40);
  const [cellKm, setCellKm] = useState(0.5);
  const [activeScale, setActiveScale] = useState("tactical");
  const [tG, setTG] = useState(null), [iG, setIG] = useState(null), [aG, setAG] = useState(null), [fG, setFG] = useState(null), [fnG, setFnG] = useState(null);
  const [eG, setEG] = useState(null);
  const [gC, setGC] = useState(0), [gR, setGR] = useState(0);
  const [status, setStatus] = useState(""), [error, setError] = useState(null), [gen, setGen] = useState(false);
  const [pt, setPt] = useState(null), [op, setOp] = useState(90);
  const [activeFeatures, setActiveFeatures] = useState(new Set(["highway","major_road","railway","military_base","airfield","port","dam","river","beach","power_plant","pipeline","town"]));
  const [elevInfo, setElevInfo] = useState("");
  const [progress, setProgress] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [genLog, setGenLog] = useState(null);

  // Estimate generation time for user messaging
  const estimateTime = useCallback(() => {
    const cols = Math.max(1, Math.floor(mapW / cellKm)), rows = Math.max(1, Math.floor(mapH / (cellKm * SQRT3_2)));
    const tier = getQueryTier(cellKm);
    const chunkKm = getChunkSize(tier);
    const chunks = Math.ceil(mapW / chunkKm) * Math.ceil(mapH / chunkKm);
    const elevBatches = Math.min(Math.ceil((cols * rows) / 100), 50);
    const elevSec = elevBatches * 1.1;
    const bbox = getBBox(lat, lng, mapW, mapH);
    const wcTiles = getWCTilesForBbox(bbox).size;
    const wcSec = wcTiles * 3; // ~3s per WorldCover tile
    const osmSec = chunks * (tier === "sub-tactical" ? 5 : tier === "tactical" ? 4 : tier === "operational" ? 3 : 1.5);
    return { chunks, tier, totalSec: Math.round(elevSec + wcSec + osmSec), cols, rows, wcTiles };
  }, [mapW, mapH, cellKm, lat, lng]);

  const go = useCallback(async () => {
    setGen(true); setError(null); setStatus("Starting..."); setProgress(null);
    const t0 = Date.now();
    setStartTime(t0);
    const log = new GenLog();

    try {
      const cols = Math.max(1, Math.floor(mapW / cellKm)), rows = Math.max(1, Math.floor(mapH / (cellKm * SQRT3_2)));
      if (cols * rows > 50000) { setError(`Too many cells: ${(cols * rows).toLocaleString()}`); setGen(false); return; }
      const bbox = getBBox(lat, lng, mapW, mapH);

      log.section("CONFIGURATION");
      log.table([
        ["Center", `${lat.toFixed(4)}, ${lng.toFixed(4)}`],
        ["Map size", `${mapW}×${mapH} km`],
        ["Cell size", `${cellKm} km`],
        ["Grid", `${cols}×${rows} = ${(cols * rows).toLocaleString()} cells`],
        ["Query tier", getQueryTier(cellKm)],
        ["Chunk size", `${getChunkSize(getQueryTier(cellKm))} km`],
        ["Bbox", `${bbox.south.toFixed(3)},${bbox.west.toFixed(3)} → ${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`],
        ["Version", "v9.2 (4-tier WorldCover + OSM + Features)"],
        ["Timestamp", new Date().toISOString()],
      ]);

      const tier = getQueryTier(cellKm);

      // ── PHASE 1: ELEVATION (fast, enables ocean skipping) ──
      setStatus("Phase 1: Fetching elevation data...");
      const elevData = await fetchElevSmart(bbox, cols, rows, setStatus, setProgress, log);
      const maxElev = Math.max(...elevData.elevations), minElev = Math.min(...elevData.elevations);
      setElevInfo(`Coverage: ${(elevData.coverage * 100).toFixed(0)}% | Max: ${maxElev}m | Min: ${minElev}m`);
      log.info(`Range: ${minElev}m to ${maxElev}m`);

      // ── PHASE 2: WORLDCOVER (satellite land cover — base terrain) ──
      setStatus("Phase 2: Fetching satellite land cover...");
      let wcData = null;
      try {
        wcData = await fetchWorldCover(bbox, cols, rows, setStatus, setProgress, log, tier);
      } catch (e) {
        log.warn(`WorldCover failed: ${e.message} — falling back to OSM-only terrain`);
      }

      // ── PHASE 3: OSM (infrastructure + terrain refinement) ──
      setStatus("Phase 3: Fetching map features...");
      // Start Wikidata river lookup and aridity data in parallel with OSM
      // Strategic/operational: whitelist (primary) + Wikidata (fallback for multi-language names)
      // Tactical/sub-tactical: no river name filtering (null → span-based fallback)
      const wikidataPromise = (tier === "strategic" || tier === "operational")
        ? fetchWikidataRivers(bbox, tier, log, cellKm).catch(() => null)
        : Promise.resolve(null);
      const aridityPromise = fetchAridityData(bbox, cols, rows, setStatus, log);
      // Metro whitelist: load bundled cities dataset for urban boost at large scales
      const metroCitiesPromise = (tier === "operational" || tier === "strategic")
        ? import("./data/cities.json").then(m => m.default || m)
        : Promise.resolve(null);

      const els = await fetchOSM(bbox, setStatus, setProgress, mapW, mapH, cellKm, elevData.elevations, cols, rows, log);
      const feat = parseFeatures(els, tier);

      // Await Wikidata and aridity results (should be done by now, they're fast)
      const wikidataNames = await wikidataPromise;
      // Whitelist is guaranteed (bundled); Wikidata adds multi-language name variants
      const whitelistNames = (tier === "strategic" || tier === "operational")
        ? getRiverWhitelistNames(tier, cellKm) : null;
      const wikidataRivers = whitelistNames
        ? new Set([...whitelistNames, ...(wikidataNames || [])])
        : wikidataNames;
      const aridityGrid = await aridityPromise;
      const metroCities = await metroCitiesPromise;
      log.section("PARSED FEATURES");
      const navNamed = feat.navigableLines.filter(nl => nl.named).length;
      const navTagged = feat.navigableLines.filter(nl => nl.tagged).length;
      const navRelation = feat.navigableLines.filter(nl => nl.fromRelation).length;
      log.table([
        ["Terrain areas", `${feat.terrAreas.length}`],
        ["Infra areas", `${feat.infraAreas.length}`],
        ["Infra lines", `${feat.infraLines.length}`],
        ["Water lines", `${feat.waterLines.length}`],
        ["River lines", `${feat.navigableLines.length} (${navNamed} named, ${navTagged} ship/boat-tagged, ${navRelation} from relations)`],
        ["Stream lines", `${feat.streamLines.length}`],
        ["Dam nodes", `${feat.damNodes.length}`],
        ["Building areas", `${feat.buildingAreas.length}`],
        ["Barrier lines", `${feat.barrierLines.length}`],
        ["Tower nodes", `${feat.towerNodes.length}`],
        ["Total raw elements", `${els.length}`],
      ]);
      setStatus(`${feat.terrAreas.length} terrain, ${feat.infraAreas.length} installs, ${feat.infraLines.length} lines`);

      if (metroCities) {
        const minPop = tier === "strategic" ? 300000 : 100000;
        const eligible = metroCities.filter(c => c.p >= minPop).length;
        log.info(`Metro whitelist: ${metroCities.length} cities loaded, ${eligible} eligible (pop ≥ ${(minPop/1000).toFixed(0)}k for ${tier})`);
      }

      // ── PHASE 4: CLASSIFY (WorldCover base + OSM overrides + elevation) ──
      setProgress({ phase: "Processing", current: 1, total: 2 });
      setStatus("Classifying..."); await new Promise(r => setTimeout(r, 20));
      const res = classifyGrid(bbox, cols, rows, feat, elevData, setStatus, wcData, tier, cellKm, wikidataRivers, aridityGrid, metroCities);

      setProgress({ phase: "Processing", current: 2, total: 2 });
      setStatus("Post-processing..."); await new Promise(r => setTimeout(r, 20));
      const pp = postProc(res.terrain, res.infra, res.attrs, res.features, res.featureNames, cols, rows, res.elevG, cellKm, res.elevCoverage, res.cellRoadCount, res.cellBuildingPct, tier, wcData ? wcData.wcGrid : null, wcData ? wcData.wcHasData : null, wcData ? wcData.wcMix : null, res.urbanScore || {});

      // ── LOG TERRAIN DISTRIBUTION ──
      log.section("TERRAIN DISTRIBUTION");
      const tCounts = {};
      Object.values(pp.terrain).forEach(t => { tCounts[t] = (tCounts[t] || 0) + 1; });
      const total = Object.values(tCounts).reduce((s, c) => s + c, 0);
      Object.entries(tCounts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
        log.detail(`${t.padEnd(16)} ${String(c).padStart(6)} (${((c / total) * 100).toFixed(1)}%)`);
      });

      log.section("INFRASTRUCTURE DISTRIBUTION");
      const iCounts = {};
      Object.values(pp.infra).forEach(t => { iCounts[t] = (iCounts[t] || 0) + 1; });
      Object.entries(iCounts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
        log.detail(`${t.padEnd(16)} ${String(c).padStart(6)} (${((c / total) * 100).toFixed(1)}%)`);
      });

      log.section("ATTRIBUTES");
      const aCounts = {};
      Object.values(pp.attrs).forEach(a => { if (a) a.forEach(x => { aCounts[x] = (aCounts[x] || 0) + 1; }); });
      Object.entries(aCounts).sort((a, b) => b[1] - a[1]).forEach(([a, c]) => {
        log.detail(`${a.padEnd(16)} ${String(c).padStart(6)} (${((c / total) * 100).toFixed(1)}%)`);
      });

      log.section("FEATURES (all per cell)");
      const fCounts = {};
      Object.values(pp.features).forEach(f => { if (f) f.forEach(x => { fCounts[x] = (fCounts[x] || 0) + 1; }); });
      Object.entries(fCounts).sort((a, b) => b[1] - a[1]).forEach(([f, c]) => {
        log.detail(`${f.padEnd(16)} ${String(c).padStart(6)} (${((c / total) * 100).toFixed(1)}%)`);
      });

      // Named features summary
      const fnEntries = Object.entries(pp.featureNames || {});
      if (fnEntries.length > 0) {
        log.section("NAMED FEATURES");
        const namesByType = {};
        for (const [, fn] of fnEntries) {
          for (const [type, name] of Object.entries(fn)) {
            if (!namesByType[type]) namesByType[type] = new Map();
            const m = namesByType[type];
            m.set(name, (m.get(name) || 0) + 1);
          }
        }
        for (const [type, names] of Object.entries(namesByType)) {
          const sorted = [...names.entries()].sort((a, b) => b[1] - a[1]);
          const top = sorted.slice(0, 8).map(([n, c]) => `${n} (${c})`).join(", ");
          log.detail(`${type}: ${sorted.length} unique — ${top}${sorted.length > 8 ? `, +${sorted.length - 8} more` : ""}`);
        }
        log.ok(`${fnEntries.length} cells with named features`);
      }

      const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
      log.section("SUMMARY");
      log.table([
        ["Total time", `${totalTime}s`],
        ["Total cells", `${total}`],
        ["Open ground", `${((tCounts.open_ground || 0) / total * 100).toFixed(1)}%`],
        ["Water (all)", `${(((tCounts.deep_water || 0) + (tCounts.coastal_water || 0) + (tCounts.lake || 0) + (tCounts.river || 0)) / total * 100).toFixed(1)}%`],
        ["Forest (all)", `${(((tCounts.forest || 0) + (tCounts.dense_forest || 0) + (tCounts.mountain_forest || 0)) / total * 100).toFixed(1)}%`],
        ["Urban (all)", `${(((tCounts.light_urban || 0) + (tCounts.dense_urban || 0)) / total * 100).toFixed(1)}%`],
        ["Elevation coverage", `${(elevData.coverage * 100).toFixed(0)}%`],
      ]);

      setTG(pp.terrain); setIG(pp.infra); setAG(pp.attrs); setFG(pp.features); setFnG(pp.featureNames); setEG(res.elevG); setGC(cols); setGR(rows);
      setStatus(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
      setProgress(null);
      setGenLog(log.toString());
      setStep("result");

      // ── AUTO-SAVE ──
      try {
        // Build save data from local vars (state not settled yet)
        const saveCells = {};
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const k = `${c},${r}`;
          const cell = { terrain: pp.terrain[k], elevation: res.elevG[k], features: pp.features[k] || [], infrastructure: pp.infra[k], attributes: pp.attrs[k] || [] };
          if (res.cellConfidence && res.cellConfidence[k] !== undefined) cell.confidence = res.cellConfidence[k];
          if (pp.featureNames && pp.featureNames[k]) cell.feature_names = pp.featureNames[k];
          saveCells[k] = cell;
        }
        const saveObj = { map: { cols, rows, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells: saveCells, labels: {} }, _meta: { generated: new Date().toISOString(), source: "WorldCover+OSM+SRTM", version: "v0.10", tier } };

        // Derive best name from feature_names — find highest-rank settlement near center
        let bestName = null;
        const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
        let bestDist = Infinity, bestRank = -1;
        if (pp.featureNames) {
          for (const [k, fn] of Object.entries(pp.featureNames)) {
            const [c, r] = k.split(",").map(Number);
            const dist = Math.abs(c - cx) + Math.abs(r - cy);
            // Settlement names from dense_urban, light_urban, town, settlement keys
            for (const type of ["dense_urban", "light_urban", "town", "settlement"]) {
              if (fn[type]) {
                const rank = type === "dense_urban" ? 4 : type === "light_urban" ? 3 : type === "town" ? 2 : 1;
                if (rank > bestRank || (rank === bestRank && dist < bestDist)) {
                  bestName = fn[type]; bestRank = rank; bestDist = dist;
                }
              }
            }
          }
          // Fallback to first named river near center
          if (!bestName) {
            for (const [k, fn] of Object.entries(pp.featureNames)) {
              if (fn.river) {
                const [c, r] = k.split(",").map(Number);
                const dist = Math.abs(c - cx) + Math.abs(r - cy);
                if (dist < bestDist) { bestName = fn.river; bestDist = dist; }
              }
            }
          }
        }
        // Fallback to coordinates
        if (!bestName) bestName = `${lat.toFixed(2)}_${lng.toFixed(2)}`;

        const scaleName = activeScale !== "custom" ? activeScale : `${cellKm}km`;
        const datePart = new Date().toISOString().slice(0, 10);
        const safeName = bestName.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
        const filename = `${safeName}_${scaleName}_${cols}x${rows}_${datePart}.json`;

        fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, data: saveObj }),
        }).then(r => r.json()).then(resp => {
          if (resp.ok) log.ok(`Auto-saved: ${resp.path}`);
        }).catch(() => { /* Silent fail — save is convenience, not critical */ });
      } catch (saveErr) { /* Silent */ }
    } catch (e) {
      log.error(`FATAL: ${e.message}`);
      setGenLog(log.toString());
      setError(e.message);
      console.error(e);
    }
    setGen(false);
  }, [lat, lng, mapW, mapH, cellKm]);

  const exp = useCallback(() => {
    const cells = {};
    for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
      const k = `${c},${r}`;
      const cell = { terrain: tG[k], elevation: eG[k], features: fG[k] || [], infrastructure: iG[k], attributes: aG[k] || [] };
      if (fnG && fnG[k]) cell.feature_names = fnG[k];
      cells[k] = cell;
    }
    const obj = { map: { cols: gC, rows: gR, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells, labels: {} }, _meta: { generated: new Date().toISOString(), source: "WorldCover+OSM+SRTM", version: "v0.10", tier: getQueryTier(cellKm) } };
    const b = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = "open_conflict_terrain.json"; a.click(); URL.revokeObjectURL(u);
  }, [tG, iG, aG, fG, fnG, eG, gC, gR, cellKm, mapW, mapH, lat, lng]);

  const viewInMap = useCallback(() => {
    if (!tG || !onViewMap) return;
    const cells = {};
    for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
      const k = `${c},${r}`;
      const cell = { terrain: tG[k], elevation: eG[k], features: fG[k] || [], infrastructure: iG[k], attributes: aG[k] || [] };
      if (fnG && fnG[k]) cell.feature_names = fnG[k];
      cells[k] = cell;
    }
    const mapData = { cols: gC, rows: gR, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells, labels: {} };
    onViewMap(mapData);
  }, [tG, iG, aG, fG, fnG, eG, gC, gR, cellKm, mapW, mapH, lat, lng, onViewMap]);

  const expLog = useCallback(() => {
    if (!genLog) return;
    const b = new Blob([genLog], { type: "text/plain" }), u = URL.createObjectURL(b), a = document.createElement("a");
    a.href = u; a.download = `oc_log_${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.txt`; a.click(); URL.revokeObjectURL(u);
  }, [genLog]);

  const [showLog, setShowLog] = useState(false);

  const iS = { width: "100%", padding: "5px 8px", borderRadius: radius.md, border: `1px solid ${colors.border.default}`, background: colors.bg.raised, color: colors.text.primary, fontSize: typography.body.md, fontFamily: typography.fontFamily, outline: "none", transition: `border-color ${animation.fast}`, boxSizing: "border-box" };

  const totalCells = gC * gR;
  const toggleFeature = useCallback(id => {
    setActiveFeatures(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const toggleGroup = useCallback((group, items) => {
    setActiveFeatures(p => {
      const n = new Set(p);
      const allOn = items.every(f => n.has(f.id));
      items.forEach(f => { if (allOn) n.delete(f.id); else n.add(f.id); });
      return n;
    });
  }, []);
  const toggleAllFeatures = useCallback(on => {
    if (!fG) return;
    if (!on) { setActiveFeatures(new Set()); return; }
    const all = new Set();
    Object.values(fG).forEach(f => { if (f) f.forEach(x => all.add(x)); });
    setActiveFeatures(all);
  }, [fG]);

  const est = estimateTime();
  const isLarge = est.chunks > 4;

  return (
    <div style={{ background: colors.bg.base, height: "100%", color: colors.text.primary, fontFamily: typography.fontFamily, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: `${space[2]}px ${space[4]}px`, borderBottom: `1px solid ${colors.border.subtle}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
          <div>
            <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold }}>Terrain Parser</div>
            <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>WorldCover + OSM + SRTM {"\u2022"} Close to Theater {"\u2022"} Named features</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: space[1] }}>{["input", "result"].map((s, i) => (
          <div key={s} onClick={() => { if (s === "input" || tG) setStep(s); }} style={{ padding: `${space[1]}px ${space[3]}px`, borderRadius: radius.md, fontSize: typography.body.xs + 1, fontWeight: typography.weight.semibold, cursor: s === "result" && !tG ? "default" : "pointer", background: step === s ? colors.accent.blue : colors.bg.raised, color: step === s ? "white" : colors.text.muted, border: `1px solid ${step === s ? colors.accent.blue : colors.border.subtle}`, transition: `all ${animation.fast}`, opacity: s === "result" && !tG ? 0.4 : 1 }}>{i + 1}. {s[0].toUpperCase() + s.slice(1)}</div>
        ))}</div>
      </div>

      <div style={{ padding: `${space[3]}px ${space[4]}px ${space[4]}px`, flex: 1, overflowY: "auto" }}>
        {step === "input" && (
          <div style={{ display: "flex", gap: space[5], animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ flex: 1, maxWidth: 400 }}>
              <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold, marginBottom: space[2] }}>Scale</div>
              <div style={{ display: "flex", flexDirection: "column", gap: space[1], marginBottom: space[3] }}>
                {SCALE_PRESETS.map(p => {
                  const active = activeScale === p.id;
                  const cells = Math.floor(p.w / p.cell) * Math.floor(p.h / (p.cell * SQRT3_2));
                  return (
                    <div key={p.id} onClick={() => { setActiveScale(p.id); setCellKm(p.cell); setMapW(p.w); setMapH(p.h); const locs = LOCATION_PRESETS[p.id]; if (locs && locs[0]) { setLat(locs[0].lat); setLng(locs[0].lng); } }}
                      style={{ padding: `${space[2]}px ${space[2]}px`, borderRadius: radius.md, cursor: "pointer", background: active ? `${p.color}12` : colors.bg.raised, border: `1px solid ${active ? p.color + "60" : colors.border.subtle}`, transition: `all ${animation.fast}`, borderLeft: active ? `3px solid ${p.color}` : `3px solid transparent` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <span style={{ fontSize: typography.body.sm + 1, fontWeight: typography.weight.bold, color: active ? p.color : colors.text.primary }}>{p.label}</span>
                          <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>{p.cell >= 1 ? p.cell + "km" : (p.cell * 1000) + "m"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
                          <Badge color={p.color} style={{ fontSize: 8 }}>{p.units}</Badge>
                          <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>{p.w}&times;{p.h}km · {cells.toLocaleString()}</span>
                        </div>
                      </div>
                      {active && <div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginTop: space[1], lineHeight: 1.5, animation: "fadeIn 0.2s ease-out" }}>{p.desc}</div>}
                    </div>
                  );
                })}
                <div onClick={() => setActiveScale("custom")}
                  style={{ padding: `${space[2]}px ${space[2]}px`, borderRadius: radius.md, cursor: "pointer", background: activeScale === "custom" ? colors.bg.surface : colors.bg.raised, border: `1px solid ${activeScale === "custom" ? colors.border.focus : colors.border.subtle}`, transition: `all ${animation.fast}` }}>
                  <span style={{ fontSize: typography.body.sm + 1, fontWeight: typography.weight.bold, color: activeScale === "custom" ? colors.text.primary : colors.text.muted }}>Custom</span>
                  <span style={{ fontSize: typography.body.xs, color: colors.text.muted, marginLeft: space[2] }}>Set your own cell size & dimensions</span>
                </div>
              </div>

              <div style={{ fontSize: typography.heading.sm, fontWeight: typography.weight.bold, marginBottom: space[2] }}>Location</div>
              <CitySearch inputStyle={iS} onSelect={(lat, lng) => { setLat(lat); setLng(lng); }} />
              <div style={{ marginBottom: space[2] }}>
                <div style={{ display: "flex", gap: space[1], flexWrap: "wrap", marginBottom: space[2] }}>
                  {(LOCATION_PRESETS[activeScale] || LOCATION_PRESETS.custom).map(p => {
                    const isActive = Math.abs(lat - p.lat) < 0.1 && Math.abs(lng - p.lng) < 0.1;
                    return (
                      <div key={p.label} onClick={() => { setLat(p.lat); setLng(p.lng); }}
                        title={p.note || ""}
                        style={{ padding: "3px 8px", borderRadius: radius.sm, fontSize: typography.body.xs, cursor: "pointer", background: isActive ? `${colors.accent.blue}18` : colors.bg.raised, border: `1px solid ${isActive ? colors.accent.blue + "60" : colors.border.subtle}`, color: isActive ? colors.accent.blue : colors.text.primary, transition: `all ${animation.fast}`, fontFamily: typography.fontFamily }}>
                        {p.label}
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const locs = LOCATION_PRESETS[activeScale] || LOCATION_PRESETS.custom;
                  const active = locs.find(p => Math.abs(lat - p.lat) < 0.1 && Math.abs(lng - p.lng) < 0.1);
                  return active && active.note ? <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[1], fontStyle: "italic", paddingLeft: space[1], borderLeft: `2px solid ${colors.accent.blue}30` }}>{active.note}</div> : null;
                })()}
              </div>
              <div style={{ display: "flex", gap: space[2], marginBottom: space[2] }}>
                <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Latitude</div><input type="number" step="0.01" value={lat} onChange={e => setLat(Number(e.target.value))} style={iS} /></label>
                <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Longitude</div><input type="number" step="0.01" value={lng} onChange={e => setLng(Number(e.target.value))} style={iS} /></label>
              </div>

              {activeScale === "custom" && (
                <>
                  <div style={{ display: "flex", gap: space[2], marginBottom: space[2] }}>
                    <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Width (km)</div><input type="number" value={mapW} onChange={e => setMapW(Number(e.target.value))} style={iS} /></label>
                    <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Height (km)</div><input type="number" value={mapH} onChange={e => setMapH(Number(e.target.value))} style={iS} /></label>
                  </div>
                  <label style={{ display: "block", marginBottom: space[3] }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Cell size (km)</div><input type="number" step="0.01" value={cellKm} onChange={e => setCellKm(Math.max(0.01, Number(e.target.value)))} style={iS} /></label>
                </>
              )}

              {activeScale !== "custom" && (
                <div style={{ display: "flex", gap: space[2], marginBottom: space[2] }}>
                  <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Width (km)</div><input type="number" value={mapW} onChange={e => { setMapW(Number(e.target.value)); setActiveScale("custom"); }} style={iS} /></label>
                  <label style={{ flex: 1 }}><div style={{ fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: 2 }}>Height (km)</div><input type="number" value={mapH} onChange={e => { setMapH(Number(e.target.value)); setActiveScale("custom"); }} style={iS} /></label>
                </div>
              )}
              <div style={{ padding: space[2], background: colors.bg.raised, borderRadius: radius.md, fontSize: typography.body.sm, marginBottom: space[2], display: "flex", justifyContent: "space-between", border: `1px solid ${colors.border.subtle}` }}>
                <span style={{ fontWeight: typography.weight.bold }}>{est.cols} {"\u00D7"} {est.rows}</span>
                <span style={{ color: colors.text.muted, fontSize: typography.body.xs, fontFamily: typography.monoFamily }}>{(est.cols * est.rows).toLocaleString()} cells</span>
              </div>

              {/* Generation time estimate + warning for large maps */}
              <div style={{ padding: space[2], background: colors.bg.raised, borderRadius: radius.md, fontSize: typography.body.xs + 1, marginBottom: space[3], color: colors.text.secondary, border: `1px solid ${colors.border.subtle}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2, fontFamily: typography.fontFamily }}>
                  <span>Scale: <span style={{ color: est.tier === "sub-tactical" ? colors.accent.purple : est.tier === "tactical" ? colors.accent.green : est.tier === "operational" ? colors.accent.amber : colors.accent.red, fontWeight: typography.weight.semibold }}>{activeScale !== "custom" ? (SCALE_PRESETS.find(p => p.id === activeScale)?.label || est.tier) : est.tier}</span></span>
                  <span style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }}>{est.wcTiles} WC {est.wcTiles === 1 ? "tile" : "tiles"}, {est.chunks} OSM {est.chunks === 1 ? "query" : "chunks"}</span>
                </div>
                {isLarge && (
                  <div style={{ marginTop: space[1], padding: space[1] + 2, background: `${colors.accent.amber}10`, borderRadius: radius.sm, fontSize: typography.body.xs, color: colors.accent.amber, lineHeight: 1.5, border: `1px solid ${colors.accent.amber}25` }}>
                    {"\u26A0"} Large map — estimated ~{est.totalSec > 60 ? `${Math.round(est.totalSec / 60)} minutes` : `${est.totalSec}s`}.
                    {est.chunks > 20 && " Strategic-scale maps query many regions and may take several minutes. Ocean areas are auto-skipped to save time."}
                    {" "}Generation runs in the background — you can leave this tab open.
                  </div>
                )}
              </div>

              <Button variant={gen ? "secondary" : "success"} onClick={go} disabled={gen} style={{ width: "100%", padding: "10px", fontSize: typography.body.md, fontWeight: typography.weight.bold, cursor: gen ? "wait" : "pointer" }}>{gen ? "Generating..." : "Generate"}</Button>
              {error && <div style={{ marginTop: space[2], padding: space[2], background: colors.glow.red, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, fontSize: typography.body.xs + 1, color: "#FCA5A5", fontFamily: typography.fontFamily }}>{error}{genLog && <span onClick={expLog} style={{ marginLeft: space[2], color: colors.accent.purple, cursor: "pointer", textDecoration: "underline" }}>Download generation log</span>}</div>}

              {/* Progress bar during generation */}
              {gen && <ProgressBar progress={progress} status={status} startTime={startTime} />}
            </div>
            <div style={{ flex: 1, maxWidth: 420 }}>
              <div style={{ padding: space[3], background: colors.bg.raised, borderRadius: radius.lg, fontSize: typography.body.xs + 1, color: colors.text.secondary, lineHeight: 1.6, border: `1px solid ${colors.border.subtle}` }}>
                <div style={{ fontWeight: typography.weight.bold, color: colors.text.primary, fontSize: typography.body.sm + 1, marginBottom: space[2] }}>Per-Cell Data Model</div>
                <div style={{ display: "flex", gap: space[3], marginBottom: space[2] }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.accent.green, marginBottom: space[1] }}>Terrain (18)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 6px" }}>
                      {TERRAIN_TYPES.map(t => <span key={t.id} style={{ fontSize: 8, display: "flex", alignItems: "center", gap: 3, fontFamily: typography.fontFamily }}><span style={{ width: 6, height: 6, borderRadius: 2, background: t.color, display: "inline-block", flexShrink: 0 }} />{t.label}</span>)}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: typography.body.xs, fontWeight: typography.weight.bold, color: colors.accent.amber, marginBottom: space[1] }}>Features (per cell, multi-select)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 6px" }}>
                      {Object.entries(FEATURE_TYPES).map(([k, v]) => <span key={k} style={{ fontSize: 8, display: "flex", alignItems: "center", gap: 3, fontFamily: typography.fontFamily }}><span style={{ width: 6, height: 6, borderRadius: 2, background: v.color, display: "inline-block", flexShrink: 0 }} />{v.label}</span>)}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>+ Elevation (m) per cell. Features accumulate — a cell can have highway + railway + bridge + military_base simultaneously.</div>
              </div>

              {/* Scale tier explanation */}
              <div style={{ marginTop: space[2], padding: space[2] + 2, background: colors.bg.raised, borderRadius: radius.lg, fontSize: typography.body.xs, color: colors.text.secondary, lineHeight: 1.6, border: `1px solid ${colors.border.subtle}` }}>
                <div style={{ fontWeight: typography.weight.bold, color: colors.text.primary, fontSize: typography.body.xs + 1, marginBottom: space[1] }}>4-Tier Scale-Adaptive Pipeline</div>
                <div style={{ marginBottom: space[1], color: colors.accent.purple }}>ESA WorldCover (satellite) provides base terrain globally. OSM adds infrastructure and refinement, scaled to cell size.</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: colors.accent.purple, fontWeight: typography.weight.semibold }}>Sub-tactical</span> (&lt;0.5km cells): Buildings, barriers, footpaths, ditches, slope. Squad-level detail.</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: colors.accent.green, fontWeight: typography.weight.semibold }}>Tactical</span> (0.5–2km cells): Full OSM refines WorldCover — urban types, water types, all roads</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: colors.accent.amber, fontWeight: typography.weight.semibold }}>Operational</span> (2–8km): OSM adds urban, water detail, major roads. WorldCover handles vegetation.</div>
                <div><span style={{ color: colors.accent.red, fontWeight: typography.weight.semibold }}>Strategic</span> (&gt;8km): OSM infra only (highways, rail, military). Dam/river crossing filtered by significance.</div>
              </div>
            </div>
          </div>
        )}

        {step === "result" && tG && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ display: "flex", gap: space[1], marginBottom: space[2], alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: typography.body.xs, color: colors.text.muted, fontWeight: typography.weight.medium }}>Paint:</span>
              <div onClick={() => setPt(null)} style={{ padding: "2px 7px", borderRadius: radius.sm, fontSize: typography.body.xs, cursor: "pointer", background: !pt ? colors.accent.blue : colors.bg.raised, color: !pt ? "white" : colors.text.muted, border: `1px solid ${!pt ? colors.accent.blue : colors.border.subtle}`, transition: `all ${animation.fast}` }}>Off</div>
              {TERRAIN_TYPES.map(t => (
                <div key={t.id} onClick={() => setPt(t.id)} style={{ padding: "2px 6px", borderRadius: radius.sm, fontSize: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 2, background: pt === t.id ? `${t.color}25` : colors.bg.raised, border: `1px solid ${pt === t.id ? t.color + "60" : "transparent"}`, color: pt === t.id ? t.color : colors.text.secondary, transition: `all ${animation.fast}`, fontFamily: typography.fontFamily }}>
                  <div style={{ width: 5, height: 5, borderRadius: 2, background: t.color }} />{t.label}
                </div>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: space[1] }}>
                <span style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Opacity:</span>
                <input type="range" min={20} max={100} value={op} onChange={e => setOp(Number(e.target.value))} style={{ width: 50, accentColor: colors.accent.blue }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: space[3] }}>
              <div style={{ flex: "0 0 auto" }}>
                <CanvasMap grid={tG} colorLUT={TERR_LUT} gC={gC} gR={gR} elevG={eG} features={fG} featureNames={fnG} activeFeatures={activeFeatures}
                  opacity={op} paintType={pt}
                  onPaint={(c, r) => { const k = `${c},${r}`; setTG(p => ({ ...p, [k]: pt })); }} />
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1], fontFamily: typography.monoFamily }}>{gC}{"\u00D7"}{gR} {"\u2022"} {cellKm}km/cell {"\u2022"} {activeFeatures.size} feature filters active</div>
              </div>
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 0 }}>
                {/* ── PINNED ACTION BAR ── */}
                <div style={{ display: "flex", gap: space[1] + 2, marginBottom: space[2], flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
                  <Button variant="primary" size="sm" onClick={exp} style={{ background: colors.accent.blue, color: "white" }}>Export JSON</Button>
                  {onViewMap && <Button variant="success" size="sm" onClick={viewInMap}>{"\u279C"} View in Map</Button>}
                  <Button variant="ghost" size="sm" onClick={expLog} disabled={!genLog}>Log</Button>
                  <Button variant={showLog ? "secondary" : "ghost"} size="sm" onClick={() => setShowLog(p => !p)} disabled={!genLog} style={showLog ? { borderColor: colors.accent.purple + "60", color: colors.accent.purple } : {}}>{showLog ? "Hide" : "View"} Log</Button>
                  <Button variant="ghost" size="sm" onClick={() => setStep("input")}>{"\u25C0"} New Map</Button>
                  <div style={{ marginLeft: "auto", fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
                    {activeFeatures.size} filters {"\u2022"} {lat.toFixed(2)}, {lng.toFixed(2)}
                  </div>
                </div>

                {showLog && genLog && (
                  <div style={{ maxHeight: 200, overflow: "auto", background: colors.bg.input, borderRadius: radius.md, border: `1px solid ${colors.border.subtle}`, padding: space[2], marginBottom: space[2], flexShrink: 0 }}>
                    <pre style={{ fontSize: 8, fontFamily: typography.monoFamily, color: colors.text.secondary, whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>{genLog}</pre>
                  </div>
                )}

                {/* ── SCROLLABLE STATS ── */}
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                  <div style={{ marginBottom: space[2] }}>
                    <div style={{ fontSize: typography.body.sm + 1, fontWeight: typography.weight.bold, marginBottom: space[1], color: colors.accent.green, display: "flex", alignItems: "center", gap: space[1] }}>
                      <div style={{ width: 3, height: 12, borderRadius: 2, background: colors.accent.green }} />
                      Terrain
                    </div>
                    <Dist grid={tG} types={TERRAIN_TYPES} />
                  </div>
                  <div style={{ borderTop: `1px solid ${colors.border.subtle}`, paddingTop: space[2], marginBottom: space[2] }}>
                    <div style={{ fontSize: typography.body.sm + 1, fontWeight: typography.weight.bold, marginBottom: space[1], color: colors.accent.amber, display: "flex", alignItems: "center", gap: space[1] }}>
                      <div style={{ width: 3, height: 12, borderRadius: 2, background: colors.accent.amber }} />
                      Features <span style={{ fontSize: typography.body.xs, fontWeight: typography.weight.normal, color: colors.text.muted }}>(toggle to overlay on map)</span>
                    </div>
                    <FeatureFilterPanel features={fG} activeFeatures={activeFeatures} total={totalCells}
                      onToggle={toggleFeature} onToggleGroup={toggleGroup} onToggleAll={toggleAllFeatures} />
                  </div>
                  <div style={{ padding: space[2], background: colors.bg.raised, borderRadius: radius.md, fontSize: typography.body.xs, color: colors.text.secondary, marginBottom: space[1], border: `1px solid ${colors.border.subtle}` }}>
                    <div style={{ fontWeight: typography.weight.bold, color: colors.text.primary, marginBottom: space[1] }}>Data Sources</div>
                    <div style={{ color: colors.accent.green }}>{"\u2713"} ESA WorldCover (terrain)</div>
                    <div style={{ color: colors.accent.green }}>{"\u2713"} OpenStreetMap (features)</div>
                    <div style={{ color: colors.accent.green }}>{"\u2713"} SRTM elevation + slope</div>
                    {elevInfo && <div style={{ color: colors.accent.purple, marginTop: space[1] }}>{elevInfo}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
