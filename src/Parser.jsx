import { useState, useRef, useCallback, useEffect } from "react";
import { fromUrl } from "geotiff";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Badge, Panel } from "./components/ui.jsx";
import { getNeighbors, hexLine, offsetToAxial, axialToOffset,
         offsetToPixel, pixelToOffset, traceHexPath, SQRT3, SQRT3_2 } from "./mapRenderer/HexMath.js";
import riverWhitelistData from "../river-whitelist.json";
import CitySearch from "./components/CitySearch.jsx";
import { buildStrategicGrid } from "./mapRenderer/StrategicGrid.js";

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
  { id: "forested_hills",  label: "Forested Hills",   color: "#4D7838" },
  { id: "mountain_forest", label: "Mtn Forest",      color: "#3D6B30" },
  { id: "mountain",        label: "Mountain",        color: "#8B7355" },
  { id: "peak",            label: "Peak/Alpine",     color: "#C8C0B0" },
  { id: "desert",          label: "Desert/Arid",     color: "#C9A84C" },
  { id: "ice",             label: "Ice/Glacier",     color: "#D4E5F7" },
  { id: "light_urban",     label: "Light Urban",     color: "#B0A890" },
  { id: "dense_urban",     label: "Dense Urban",     color: "#7A7D80" },
  { id: "jungle",           label: "Jungle",          color: "#1B6B20" },
  { id: "jungle_hills",     label: "Jungle Hills",    color: "#2A7A30" },
  { id: "jungle_mountains", label: "Jungle Mtns",     color: "#1A5A1A" },
  { id: "boreal",           label: "Boreal",           color: "#3A7A50" },
  { id: "boreal_hills",     label: "Boreal Hills",     color: "#2A6A40" },
  { id: "boreal_mountains", label: "Boreal Mtns",      color: "#1A5A30" },
  { id: "tundra",           label: "Tundra",           color: "#B8B090" },
  { id: "savanna",          label: "Savanna",          color: "#C0B050" },
  { id: "savanna_hills",    label: "Savanna Hills",    color: "#A09040" },
  { id: "mangrove",         label: "Mangrove",         color: "#3A7A5A" },
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

// Normalize longitude to [-180, 180] for external APIs and storage
function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

// Normalize longitude to [refWest, refWest+360) for internal continuous-range math.
// Ensures coordinates from external sources (OSM, cities) map into the bbox's range
// even when the bbox crosses the antimeridian (e.g., west=170, east=190).
function continuousLon(lon, refWest) {
  return refWest + ((lon - refWest) % 360 + 360) % 360;
}

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

  // Antimeridian detection: bbox crosses 180°/-180° boundary
  // Only apply continuousLon wrapping in geoRangeToGridRange when needed,
  // because buffer-expanded intersection coordinates legitimately extend
  // slightly past bbox.west and continuousLon would wrap them +360°.
  const crossesAntimeridian = east < west;

  return {
    cols, rows, lonPerUnit, latPerUnit, hxMin, hyMin, hxSpan, hySpan,

    // Geographic (lon, lat) → hex pixel coords (size = 1)
    geoToHexPixel(lon, lat) {
      const adjLon = correctedLon(continuousLon(lon, west), lat);
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
      const adjLon = correctedLon(continuousLon(lon, west), lat);
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
      // Only apply antimeridian wrapping when bbox actually crosses 180°.
      // Buffer-expanded intersection coords can be slightly < bbox.west,
      // and continuousLon would wrap them +360° producing huge column indices.
      const wNorm = crossesAntimeridian ? continuousLon(w, west) : w;
      const eNorm = crossesAntimeridian ? continuousLon(e, west) : e;
      const adjW = correctedLon(wNorm, (s + n) / 2);
      const adjE = correctedLon(eNorm, (s + n) / 2);
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

// Assemble multipolygon relation member ways into closed rings.
// OSM multipolygon relations store boundaries as separate ways (e.g., left bank,
// right bank of a river). These must be chained end-to-end to form closed polygons.
// Without assembly, each bankline way becomes a garbage polygon when PIP-tested.
function assembleRings(members, role) {
  const closed = [];
  const open = [];
  for (const m of members) {
    if (m.role !== role || !m.geometry || m.geometry.length < 3) continue;
    const g = m.geometry;
    const first = g[0], last = g[g.length - 1];
    // ~1m tolerance in degrees
    if (Math.abs(first.lat - last.lat) < 0.00001 && Math.abs(first.lon - last.lon) < 0.00001) {
      closed.push(g);
    } else {
      open.push(g);
    }
  }

  // Chain open ways by matching endpoints (with reversal)
  const remaining = open.map(g => [...g]);
  while (remaining.length > 0) {
    let chain = remaining.shift();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const way = remaining[i];
        const EPS = 0.00001;
        const cEnd = chain[chain.length - 1], cStart = chain[0];
        const wStart = way[0], wEnd = way[way.length - 1];

        if (Math.abs(cEnd.lat - wStart.lat) < EPS && Math.abs(cEnd.lon - wStart.lon) < EPS) {
          chain = chain.concat(way.slice(1));
        } else if (Math.abs(cEnd.lat - wEnd.lat) < EPS && Math.abs(cEnd.lon - wEnd.lon) < EPS) {
          chain = chain.concat([...way].reverse().slice(1));
        } else if (Math.abs(wEnd.lat - cStart.lat) < EPS && Math.abs(wEnd.lon - cStart.lon) < EPS) {
          chain = way.slice(0, -1).concat(chain);
        } else if (Math.abs(wStart.lat - cStart.lat) < EPS && Math.abs(wStart.lon - cStart.lon) < EPS) {
          chain = [...way].reverse().slice(0, -1).concat(chain);
        } else {
          continue;
        }
        remaining.splice(i, 1);
        changed = true;
        break;
      }
    }
    // Check if chain closed
    const cs = chain[0], ce = chain[chain.length - 1];
    if (Math.abs(cs.lat - ce.lat) < 0.00001 && Math.abs(cs.lon - ce.lon) < 0.00001) {
      closed.push(chain);
    }
    // Discard unclosed chains — incomplete data from bbox clipping
  }
  return closed;
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
    const c0 = Math.max(0, Math.floor((mnLo - bbox.west) / bW)), c1 = Math.min(bC - 1, Math.ceil((mxLo - bbox.west) / bW));
    const r0 = Math.max(0, Math.floor((mnLa - bbox.south) / bH)), r1 = Math.min(bR - 1, Math.ceil((mxLa - bbox.south) / bH));
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
  const c1 = Math.min(idx.bC - 1, Math.ceil((east - bbox.west) / idx.bW));
  const r0 = Math.max(0, Math.floor((south - bbox.south) / idx.bH));
  const r1 = Math.min(idx.bR - 1, Math.ceil((north - bbox.south) / idx.bH));
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
  95: "mangrove",     // Mangrove (WC class 95 — tidal forest, distinct from herbaceous wetland)
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
      const id = getWCTileId(lat, wrapLon(lng));
      tiles.set(id, { south: lat, north: lat + 3, west: lng, east: lng + 3 });
    }
  }
  return tiles;
}

async function fetchWorldCover(bbox, cols, rows, onS, onProg, log, tier, onPartial) {
  const proj = createHexProjection(bbox, cols, rows);

  // Latitude correction (uncorrectedLon) makes cells at latitudes closer to
  // the equator than midLat wider in real geographic coordinates. The east/west
  // edges of these cells extend past bbox.east/west, so sample points fall
  // outside all tile intersections → no WC data → open_ground → flood-fill
  // converts to ocean → false coastlines following a longitude-line curve.
  // Compute how far past the bbox cells can extend and expand tile coverage.
  const midLat = (bbox.south + bbox.north) / 2;
  const cosRef = Math.cos(midLat * Math.PI / 180);
  const latSpan = bbox.north - bbox.south;
  const needsCorrectionForTiles = latSpan > 5 || Math.abs(midLat) > 55;
  let lonBuffer = 0;
  if (needsCorrectionForTiles) {
    const halfLon = (bbox.east - bbox.west) / 2;
    for (const lat of [bbox.south, bbox.north]) {
      const cosLat = Math.cos(lat * Math.PI / 180);
      // When cosLat > cosRef (lat closer to equator), uncorrectedLon expands
      const ratio = cosLat / cosRef;
      if (ratio > 1) lonBuffer = Math.max(lonBuffer, halfLon * (ratio - 1));
    }
  }
  const expandedWest = bbox.west - lonBuffer;
  const expandedEast = bbox.east + lonBuffer;
  const tileBboxExpanded = lonBuffer > 0
    ? { ...bbox, west: expandedWest, east: expandedEast }
    : bbox;
  const tiles = getWCTilesForBbox(tileBboxExpanded);
  const wcGrid = {}, wcMix = {}, wcHasData = new Set(), wcGapFilled = new Set();
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

    let url = `${WC_BASE}/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tileId}_Map.tif`;

    // Antimeridian tile naming: 180° = -180°, so ESA may use E180 or W180.
    // If the primary name 404s, try the alternate before declaring ocean.
    let altUrl = null;
    if (tileId.includes("W180")) {
      const altId = tileId.replace("W180", "E180");
      altUrl = `${WC_BASE}/v200/2021/map/ESA_WorldCover_10m_2021_v200_${altId}_Map.tif`;
    } else if (tileId.includes("E180")) {
      const altId = tileId.replace("E180", "W180");
      altUrl = `${WC_BASE}/v200/2021/map/ESA_WorldCover_10m_2021_v200_${altId}_Map.tif`;
    }

    // Retry loop — geotiff fromUrl uses streaming Range requests that are
    // vulnerable to transient network failures. A single failed tile blanks
    // out all base terrain for that region, so retries are critical.
    let tileSuccess = false;
    for (let attempt = 0; attempt < 3 && !tileSuccess; attempt++) {
      if (attempt > 0) {
        onS(`WorldCover: tile ${tileId} retry ${attempt + 1}/3`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
      try {
        let tiff;
        try {
          tiff = await fromUrl(url);
        } catch (e0) {
          // If primary URL 404s and we have an antimeridian alternate, try it
          const is404 = e0.message && (e0.message.includes("404") || e0.message.includes("Not Found"));
          if (is404 && altUrl) {
            if (log) log.info(`Tile ${tileId}: trying alternate antimeridian name`);
            tiff = await fromUrl(altUrl);
            altUrl = null; // succeeded — don't retry alternate again
          } else {
            throw e0; // re-throw to outer catch
          }
        }
        const image = await tiff.getImage();
        const imgW = image.getWidth();
        const imgH = image.getHeight();

        // Intersection of tile with our bbox, expanded to capture edge hex sample points.
        // Hexes at the grid boundary extend past the bbox by ~1 cell. Without this buffer,
        // edge hexes lose sample points that fall outside the intersection → fewer votes
        // → wrong terrain at the map border.
        const cellLatBuffer = (bbox.north - bbox.south) / Math.max(1, rows);
        const cellLonBuffer = (bbox.east - bbox.west) / Math.max(1, cols);
        const isectS = Math.max(bbox.south - cellLatBuffer, tileBbox.south);
        const isectN = Math.min(bbox.north + cellLatBuffer, tileBbox.north);
        const isectW = Math.max(expandedWest - cellLonBuffer, tileBbox.west);
        const isectE = Math.min(expandedEast + cellLonBuffer, tileBbox.east);
        if (isectS >= isectN || isectW >= isectE) { tileSuccess = true; break; }

        // Pixel window in the tile (origin = top-left = NW corner)
        const px0 = Math.max(0, Math.floor((isectW - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
        const py0 = Math.max(0, Math.floor((tileBbox.north - isectN) / (tileBbox.north - tileBbox.south) * imgH));
        const px1 = Math.min(imgW, Math.ceil((isectE - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
        const py1 = Math.min(imgH, Math.ceil((tileBbox.north - isectS) / (tileBbox.north - tileBbox.south) * imgH));

        // Grid cells overlapping this intersection (hex-aware range)
        const { r0: gridR0, r1: gridR1, c0: gridC0, c1: gridC1 } = proj.geoRangeToGridRange(isectS, isectN, isectW, isectE);
        const cellsInRange = (gridC1 - gridC0 + 1) * (gridR1 - gridR0 + 1);
        if (cellsInRange <= 0) { tileSuccess = true; break; }

        // Determine output raster dimensions.
        // Sub-tactical maps cover small areas (≤8km), so the native raster is
        // small enough (≤800×800 px) to read without downsampling. This eliminates
        // nearest-neighbor aliasing that causes horizontal banding when multiple
        // hex rows' sample points map to the same downsampled raster row.
        // Larger tiers downsample with a minimum of SAMPLES_PER_CELL rows per
        // hex row to balance performance and accuracy.
        const nativeH = py1 - py0;
        const nativeW = px1 - px0;
        let outH, outW;
        if (isSubTac) {
          // Read at full native resolution — small area, no performance concern
          outH = nativeH;
          outW = nativeW;
        } else {
          const hexRows = gridR1 - gridR0 + 1;
          const hexCols = gridC1 - gridC0 + 1;
          const targetPixels = cellsInRange * SAMPLES_PER_CELL * SAMPLES_PER_CELL;
          const rasterAspect = nativeW / Math.max(1, nativeH);
          outH = Math.round(Math.sqrt(targetPixels / rasterAspect));
          outW = Math.round(outH * rasterAspect);
          // Enforce minimum rows per hex row to prevent banding at larger scales
          outH = Math.max(outH, SAMPLES_PER_CELL * hexRows);
          outW = Math.max(outW, SAMPLES_PER_CELL * hexCols);
          outH = Math.min(nativeH, outH);
          outW = Math.min(nativeW, outW);
        }

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
        tileSuccess = true;
      } catch (e) {
        // 404 = ocean tile (expected), other errors = retry then warn
        const isOcean = e.message && (e.message.includes("404") || e.message.includes("Not Found"));
        if (isOcean) {
          if (log) log.info(`Tile ${tileId}: no data (ocean)`);
          tileSuccess = true;
        } else if (attempt < 2) {
          if (log) log.warn(`Tile ${tileId}: attempt ${attempt + 1} failed — ${e.message}`);
        } else {
          if (log) log.warn(`Tile ${tileId}: failed after 3 attempts — ${e.message}`);
        }
      }
    }

    tilesDone++;
    if (onProg) onProg({ phase: "WorldCover", current: tilesDone, total: tiles.size });

    // Emit partial preview: resolve current wcAccum to raw class numbers
    if (onPartial) {
      const partial = {};
      for (const [k, acc] of Object.entries(wcAccum)) {
        let best = 0, bestN = 0;
        for (const [v, n] of Object.entries(acc.counts)) {
          if (n > bestN) { best = Number(v); bestN = n; }
        }
        partial[k] = best;
      }
      onPartial(partial);
    }
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

  // Gap-fill edge cells that got open_ground due to zero WC samples.
  // Hex stagger causes alternating edge cells' sample points to fall outside
  // tile intersection bounds. Copy terrain from nearest neighbor with real data.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (!wcHasData.has(k)) {
        for (const [nc, nr] of getNeighbors(c, r)) {
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const nk = `${nc},${nr}`;
          if (wcHasData.has(nk)) {
            wcGrid[k] = wcGrid[nk];
            wcHasData.add(k);  // prevents ocean detection from treating as empty
            wcGapFilled.add(k);  // track gap-filled cells for PIP threshold adjustment
            if (wcMix[nk]) wcMix[k] = { ...wcMix[nk] };
            break;
          }
        }
      }
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

  return { wcGrid, wcMix, wcHasData, wcGapFilled };
}

// ════════════════════════════════════════════════════════════════
// SCALE-ADAPTIVE OVERPASS QUERIES — v9 4-tier
// ════════════════════════════════════════════════════════════════
// Sub-tactical (<0.5km): squad-level — buildings, barriers, footpaths, ditches
// Tactical (0.5-2km): full OSM — refines WC with specific types
// Operational (2-8km): terrain + infrastructure
// Strategic (>=8km): infrastructure only — WC handles terrain

// Check Overpass API rate limit status. Returns seconds to wait (0 if a slot is free).
// Parses the plaintext status page for "available now" or "in X seconds".
async function checkOverpassStatus() {
  try {
    const resp = await fetch("https://overpass-api.de/api/status");
    if (!resp.ok) return 0; // can't check, proceed optimistically
    const text = await resp.text();
    if (text.includes("available now")) return 0;
    // Look for "in X seconds" to find cooldown time
    const match = text.match(/in\s+(\d+)\s+seconds/);
    if (match) return parseInt(match[1], 10);
    // Slots exist but none say "available now" — short wait
    if (text.includes("slots")) return 10;
    return 0;
  } catch {
    return 0; // network error checking status, proceed anyway
  }
}

// Client-side timeout wrapper for fetch — prevents indefinite hangs
// when the Overpass server stalls or the network drops silently.
// Default 300s matches Overpass [timeout:300] setting. Previous 120s default
// caused the client to abort before the server could finish large queries.
async function fetchWithTimeout(url, options, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Lightweight net traffic logger for debugging parse failures.
// Collects entries in memory, flushes to server at end of parse.
function createParserNetLog() {
  const sessionId = Math.random().toString(36).slice(2, 10);
  const entries = [];
  return {
    sessionId,
    log(entry) {
      entries.push({ ...entry, timestamp: new Date().toISOString() });
    },
    async flush() {
      if (entries.length === 0) return;
      try {
        await fetch("/api/parsernetlog/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, entries })
        });
      } catch { /* best-effort, never fail the parse */ }
    }
  };
}

// Fetch wrapper that logs every request to the parser netlog.
// meta carries context like { phase: "OSM", label: "OSM 3/25", attempt: 2 }
async function fetchAndLog(url, options, netLog, meta, timeoutMs = 300000) {
  const t0 = Date.now();
  try {
    const resp = await fetchWithTimeout(url, options, timeoutMs);
    if (netLog) netLog.log({
      ...meta,
      url: url.slice(0, 200),
      method: (options && options.method) || "GET",
      status: resp.status,
      durationMs: Date.now() - t0,
      ok: resp.ok,
    });
    return resp;
  } catch (e) {
    if (netLog) netLog.log({
      ...meta,
      url: url.slice(0, 200),
      method: (options && options.method) || "GET",
      status: 0,
      durationMs: Date.now() - t0,
      ok: false,
      error: e.name === "AbortError" ? "timeout" : e.message,
    });
    throw e;
  }
}

function getQueryTier(cellKm) {
  if (cellKm < 0.5) return "sub-tactical";
  if (cellKm < 2) return "tactical";
  if (cellKm < 8) return "operational";
  return "strategic";
}

function getChunkSize(tier) {
  if (tier === "sub-tactical") return 10;
  if (tier === "tactical") return 75;
  if (tier === "operational") return 150;
  return 200;
}

function buildQuery(bbox, tier) {
  const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;

  if (tier === "sub-tactical") {
    return `[out:json][timeout:300];(
way["natural"~"^(water|wood|scrub|grassland|heath|sand|wetland|glacier|cliff|tree_row|beach)$"]${b};
way["landuse"~"^(forest|residential|commercial|industrial|retail|farmland|meadow|military|quarry|cemetery|allotments|recreation_ground|construction|railway)$"]${b};
way["building"]${b};
way["place"="square"]${b};
way["barrier"~"^(wall|fence|hedge|city_wall|retaining_wall|ditch)$"]${b};
way["waterway"~"^(river|canal|stream|ditch|drain|riverbank|dam|weir)$"]${b};
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary|tertiary|residential|unclassified|service|track|footway|path|steps|pedestrian|cycleway)$"]${b};
way["railway"~"^(rail|light_rail|tram|subway)$"]${b};
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
node["place"~"^(city|town|village|suburb|neighbourhood)$"]["name"]${b};
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
node["place"~"^(city|town)$"]["name"]${b};
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

// Returns { status: 'ok'|'fallback'|'failed', elements: [] }
// 'ok' = full query succeeded, 'fallback' = terrain-only (missing roads/rail), 'failed' = nothing
async function fetchOSMChunk(bbox, tier, onS, label, log, netLog) {
  // Antimeridian handling: if bbox uses continuous range outside [-180, 180], wrap for Overpass.
  // wrapLon(180) = -180, so we gate on the raw values to avoid infinite recursion.
  if (bbox.east > 180 || bbox.west < -180) {
    const w = wrapLon(bbox.west), e = wrapLon(bbox.east);
    if (w > e) {
      // Crosses antimeridian: split into two valid sub-bboxes
      const eastResult = await fetchOSMChunk({ south: bbox.south, north: bbox.north, west: w, east: 180 }, tier, onS, `${label} E`, log, netLog);
      const westResult = await fetchOSMChunk({ south: bbox.south, north: bbox.north, west: -180, east: e }, tier, onS, `${label} W`, log, netLog);
      // worst status wins: failed > fallback > ok
      const worstStatus = [eastResult.status, westResult.status].includes("failed") ? "failed"
        : [eastResult.status, westResult.status].includes("fallback") ? "fallback" : "ok";
      return { status: worstStatus, elements: [...eastResult.elements, ...westResult.elements] };
    }
    // Entirely past the antimeridian (e.g., 182..186 → -178..-174): just wrap
    bbox = { south: bbox.south, north: bbox.north, west: w, east: e };
  }
  const q = buildQuery(bbox, tier);
  const qFallback = buildFallbackQuery(bbox);
  const t0 = Date.now();
  let retries = 0;
  const fetchOpts = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } };

  // Try main query with retries; 429 (rate limit) gets longer backoff than other errors
  for (let attempt = 0; attempt < 3; attempt++) {
    onS(label ? `${label} (attempt ${attempt + 1})` : "Querying OSM...");
    try {
      const resp = await fetchAndLog(
        "https://overpass-api.de/api/interpreter",
        { ...fetchOpts, body: `data=${encodeURIComponent(q)}` },
        netLog, { phase: "OSM", label, attempt: attempt + 1, queryType: "main" }
      );
      if (resp.ok) {
        let data;
        try {
          data = await resp.json();
        } catch (jsonErr) {
          if (log) log.warn(`${label}: HTTP 200 but malformed JSON — ${jsonErr.message}`);
          retries++;
          continue; // retry the whole request
        }
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        if (log) log.ok(`${label}: ${data.elements.length} features in ${dt}s${retries > 0 ? ` (${retries} retries)` : ""}`);
        return { status: "ok", elements: data.elements };
      }
      retries++;
      // 429 = genuine rate limit (Overpass quota exhausted), back off aggressively.
      // 504 = gateway timeout (server overloaded), just retry normally — no long wait needed.
      const isRateLimit = resp.status === 429;
      if (log) log.warn(`${label}: HTTP ${resp.status}${isRateLimit ? " (rate limited)" : ""}`);
      if (isRateLimit && attempt < 2) {
        const retryAfter = resp.headers.get("Retry-After");
        const wait = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 90000) : (attempt === 0 ? 30000 : 60000);
        onS(`${label || "Chunk"} rate limited, waiting ${Math.round(wait / 1000)}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    } catch (e) {
      retries++;
      const reason = e.name === "AbortError" ? `timeout (${Math.round(300000/1000)}s)` : `network error — ${e.message}`;
      if (log) log.warn(`${label}: ${reason}`);
    }
    if (attempt < 2) {
      const wait = attempt === 0 ? 8000 : 15000;
      onS(`${label || "Chunk"} failed, retry in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // Main query failed 3 times — try terrain-only fallback (2 attempts)
  for (let fbAttempt = 0; fbAttempt < 2; fbAttempt++) {
    onS(`${label || "Chunk"} trying terrain-only fallback${fbAttempt > 0 ? ` (attempt ${fbAttempt + 1})` : ""}...`);
    try {
      const resp = await fetchAndLog(
        "https://overpass-api.de/api/interpreter",
        { ...fetchOpts, body: `data=${encodeURIComponent(qFallback)}` },
        netLog, { phase: "OSM", label, attempt: fbAttempt + 1, queryType: "fallback" }
      );
      if (resp.ok) {
        let data;
        try {
          data = await resp.json();
        } catch (jsonErr) {
          if (log) log.warn(`${label}: fallback HTTP 200 but malformed JSON`);
          continue;
        }
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        if (log) log.warn(`${label}: FALLBACK ${data.elements.length} features in ${dt}s (terrain-only, no roads/rail)`);
        return { status: "fallback", elements: data.elements };
      }
    } catch (e) {
      const reason = e.name === "AbortError" ? `timeout (300s)` : e.message;
      if (log) log.warn(`${label}: fallback ${reason}`);
    }
    if (fbAttempt < 1) {
      onS(`${label || "Chunk"} fallback failed, retry in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (log) log.error(`${label}: FAILED completely after ${dt}s — 0 features (${retries} retries + 2 fallback attempts)`);
  return { status: "failed", elements: [] };
}

// Split a chunk bbox into 4 sub-bboxes (2x2) for retry with smaller queries
function subdivideChunk(chunk) {
  const { south, north, west, east } = chunk.bbox;
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return [
    { bbox: { south, north: midLat, west, east: midLng }, label: `${chunk.label}-SW`, reason: chunk.reason },
    { bbox: { south, north: midLat, west: midLng, east }, label: `${chunk.label}-SE`, reason: chunk.reason },
    { bbox: { south: midLat, north, west, east: midLng }, label: `${chunk.label}-NW`, reason: chunk.reason },
    { bbox: { south: midLat, north, west: midLng, east }, label: `${chunk.label}-NE`, reason: chunk.reason },
  ];
}

async function fetchOSM(bbox, onS, onProg, mapWKm, mapHKm, cellKm, elevations, cols, rows, log, netLog) {
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
    const result = await fetchOSMChunk(bbox, tier, onS, "OSM 1/1", log, netLog);
    onProg({ phase: "OSM", current: 1, total: 1 });
    onS(`Received ${result.elements.length} features${result.status !== "ok" ? ` (${result.status})` : ""}`);
    return result.elements;
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
  let consecutiveFailures = 0;
  const retryChunks = []; // chunks that failed or fell back to terrain-only
  const osmT0 = Date.now();

  // For large batch runs, check Overpass status before starting
  if (landChunks >= 10) {
    const waitSec = await checkOverpassStatus();
    if (waitSec > 0) {
      onS(`Overpass rate limit: waiting ${waitSec}s for available slot...`);
      if (log) log.warn(`Overpass status: ${waitSec}s cooldown before starting`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }

  if (log) log.info(`Querying ${landChunks} land chunks...`);

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      if (oceanChunks.has(`${cx},${cy}`)) {
        onProg({ phase: "OSM", current: completed, total: landChunks, skipped: oceanChunks.size });
        continue;
      }

      // If we've had consecutive failures, check Overpass status before continuing
      if (consecutiveFailures >= 2) {
        onS("Multiple failures — checking Overpass status...");
        if (log) log.warn(`${consecutiveFailures} consecutive failures, checking Overpass status`);
        const waitSec = await checkOverpassStatus();
        const cooldown = Math.max(15, waitSec);
        onS(`Cooling down ${cooldown}s after consecutive failures...`);
        await new Promise(r => setTimeout(r, cooldown * 1000));
        consecutiveFailures = 0;
      }

      const chunkBbox = {
        south: bbox.south + cy * latStep,
        north: bbox.south + (cy + 1) * latStep,
        west: bbox.west + cx * lngStep,
        east: bbox.west + (cx + 1) * lngStep,
      };
      const label = `OSM ${completed + 1}/${landChunks}`;
      const result = await fetchOSMChunk(chunkBbox, tier, onS, label, log, netLog);

      // Collect whatever elements we got (even fallback terrain-only data)
      for (const el of result.elements) {
        const key = `${el.type}:${el.id}`;
        if (!seen.has(key)) { seen.add(key); allElements.push(el); }
      }

      if (result.status === "ok") {
        consecutiveFailures = 0;
      } else {
        // Both 'fallback' (terrain-only, missing roads/rail) and 'failed' (nothing) need retry
        consecutiveFailures++;
        retryChunks.push({ bbox: chunkBbox, label: `retry ${cx},${cy}`, reason: result.status });
      }

      completed++;
      onProg({ phase: "OSM", current: completed, total: landChunks, skipped: oceanChunks.size });

      // Delay scales with chunk count to avoid rate limiting
      if (completed < landChunks) {
        const delay = landChunks > 80 ? 5000 : landChunks > 30 ? 3000 : landChunks > 10 ? 2000 : 1000;
        await new Promise(r => setTimeout(r, delay));
      }

      // Periodic status check every 20 chunks to adapt to rate limit changes
      if (landChunks >= 20 && completed % 20 === 0 && completed < landChunks) {
        const waitSec = await checkOverpassStatus();
        if (waitSec > 0) {
          onS(`Overpass cooldown: ${waitSec}s...`);
          if (log) log.info(`Periodic status check: ${waitSec}s cooldown`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
        }
      }
    }
  }

  // ── Retry waves: come back for failed/fallback chunks with smaller sub-chunks ──
  // Each wave subdivides remaining chunks into 4 (2x2) so queries are lighter
  // and less likely to timeout or get rate-limited.
  const MAX_WAVES = 3;
  const WAVE_DELAYS = [30000, 60000, 120000]; // 30s, 60s, 2min before each wave

  if (retryChunks.length > 0 && log) {
    log.warn(`${retryChunks.length} chunks need retry (${retryChunks.filter(c => c.reason === "failed").length} failed, ${retryChunks.filter(c => c.reason === "fallback").length} fallback)`);
  }

  let pendingRetry = retryChunks;
  for (let wave = 0; wave < MAX_WAVES && pendingRetry.length > 0; wave++) {
    // Subdivide each failed chunk into 4 smaller sub-chunks
    const subChunks = [];
    for (const chunk of pendingRetry) {
      subChunks.push(...subdivideChunk(chunk));
    }

    const waveDelay = WAVE_DELAYS[wave];
    onS(`OSM Retry wave ${wave + 1}/${MAX_WAVES}: ${subChunks.length} sub-chunks, waiting ${waveDelay / 1000}s...`);
    if (log) log.section(`OSM RETRY WAVE ${wave + 1}`);
    if (log) log.info(`${subChunks.length} sub-chunks from ${pendingRetry.length} failed chunks, ${waveDelay / 1000}s cooldown`);

    // Check Overpass status and wait
    const statusWait = await checkOverpassStatus();
    const totalWait = Math.max(waveDelay / 1000, statusWait);
    await new Promise(r => setTimeout(r, totalWait * 1000));

    const stillFailing = [];
    for (let i = 0; i < subChunks.length; i++) {
      const sc = subChunks[i];
      const retryLabel = `Retry W${wave + 1} ${i + 1}/${subChunks.length}`;
      onProg({ phase: "OSM Retry", current: i, total: subChunks.length });

      const result = await fetchOSMChunk(sc.bbox, tier, onS, retryLabel, log, netLog);
      for (const el of result.elements) {
        const key = `${el.type}:${el.id}`;
        if (!seen.has(key)) { seen.add(key); allElements.push(el); }
      }

      if (result.status !== "ok") {
        stillFailing.push({ bbox: sc.bbox, label: sc.label, reason: result.status });
      }

      // 5s delay between retry chunks
      if (i < subChunks.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    onProg({ phase: "OSM Retry", current: subChunks.length, total: subChunks.length });
    if (log) log.info(`Wave ${wave + 1} complete: ${subChunks.length - stillFailing.length}/${subChunks.length} sub-chunks recovered`);
    pendingRetry = stillFailing;

    if (pendingRetry.length === 0) {
      if (log) log.ok("All chunks recovered!");
      break;
    }
  }

  if (pendingRetry.length > 0 && log) {
    log.error(`${pendingRetry.length} sub-chunks still incomplete after ${MAX_WAVES} retry waves`);
  }

  const osmDt = ((Date.now() - osmT0) / 1000).toFixed(1);
  const retryNote = retryChunks.length > 0
    ? `, ${retryChunks.length} retried${pendingRetry.length > 0 ? `, ${pendingRetry.length} still incomplete` : ", all recovered"}`
    : "";
  onS(`Received ${allElements.length} features from ${landChunks} land chunks (${oceanChunks.size} ocean skipped${retryNote})`);
  if (log) {
    log.ok(`OSM complete: ${allElements.length} unique features in ${osmDt}s`);
    log.detail(`${landChunks} land chunks queried, ${oceanChunks.size} ocean skipped${retryNote}`);
  }
  return allElements;
}

// ════════════════════════════════════════════════════════════════
// ELEVATION — dual provider, Open Topo Data primary (via proxy)
// ════════════════════════════════════════════════════════════════

async function fetchElev(pts, onS, onProg, log, onPartial) {
  const BATCH = 100;
  const el = new Array(pts.length).fill(null);
  const batches = Math.ceil(pts.length / BATCH);
  let successCount = 0, failCount = 0;
  let providerSwitches = 0;

  const providers = [
    {
      name: "OpenTopoData",
      url: (sl) => `/api/topo/v1/srtm30m?locations=${sl.map(p => `${p.lat.toFixed(4)},${wrapLon(p.lng).toFixed(4)}`).join("|")}`,
      parse: (d) => d.results ? d.results.map(r => r.elevation) : null,
      delay: 1100,
    },
    {
      name: "Open-Meteo",
      url: (sl) => `https://api.open-meteo.com/v1/elevation?latitude=${sl.map(p => p.lat.toFixed(4)).join(",")}&longitude=${sl.map(p => wrapLon(p.lng).toFixed(4)).join(",")}`,
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
            if (onPartial) onPartial([...el]);
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
// COPERNICUS DEM 30m RASTER ELEVATION
// ════════════════════════════════════════════════════════════════

// Build URL for a Copernicus DEM 30m tile given its SW corner lat/lon.
// Tiles are 1×1 degree, named by SW corner.
// Example: lat=13, lon=107 → Copernicus_DSM_COG_10_N13_00_E107_00_DEM.tif
function getCopernicusTileUrl(latSW, lonSW) {
  const ns = latSW >= 0 ? "N" : "S";
  const ew = lonSW >= 0 ? "E" : "W";
  const latStr = `${ns}${String(Math.abs(latSW)).padStart(2, "0")}_00`;
  const lonStr = `${ew}${String(Math.abs(lonSW)).padStart(3, "0")}_00`;
  const name = `Copernicus_DSM_COG_10_${latStr}_${lonStr}_DEM`;
  return `/api/srtm/${name}/${name}.tif`;
}

// Compute which 1×1 degree tiles overlap a bbox. Returns Map of tileId → { south, north, west, east, url }.
function getCopernicusTilesForBbox(bbox) {
  const tiles = new Map();
  const latStart = Math.floor(bbox.south);
  const latEnd = Math.ceil(bbox.north);
  const lonStart = Math.floor(bbox.west);
  const lonEnd = Math.ceil(bbox.east);
  for (let lat = latStart; lat < latEnd; lat++) {
    for (let lon = lonStart; lon < lonEnd; lon++) {
      const wLon = wrapLon(lon);
      const key = `${lat >= 0 ? "N" : "S"}${Math.abs(lat)}_${wLon >= 0 ? "E" : "W"}${Math.abs(wLon)}`;
      tiles.set(key, {
        south: lat, north: lat + 1, west: lon, east: lon + 1,
        url: getCopernicusTileUrl(lat, wLon),
      });
    }
  }
  return tiles;
}

// Load elevation from Copernicus DEM 30m GeoTIFF tiles — same pattern as WorldCover tile loading.
// Returns per-cell statistics computed from ~100 raster samples per hex cell.
async function fetchElevFromDEM(bbox, cols, rows, onS, onProg, log, onPartial) {
  const proj = createHexProjection(bbox, cols, rows);
  const totalCells = cols * rows;
  const tiles = getCopernicusTilesForBbox(bbox);
  const ELEV_SAMPLES = 10; // 10×10 = 100 sample points per hex cell

  // Per-cell accumulators — collect all valid elevation samples before computing stats.
  // At 100 samples × 50k cells × 4 bytes = ~20MB — acceptable.
  const cellSamples = new Array(totalCells);
  for (let i = 0; i < totalCells; i++) cellSamples[i] = [];

  if (log) {
    log.section("DEM ELEVATION (Copernicus 30m)");
    log.table([
      ["Tiles needed", `${tiles.size}`],
      ["Sampling", `${ELEV_SAMPLES}×${ELEV_SAMPLES} per cell`],
    ]);
  }

  let tilesDone = 0;

  for (const [tileId, tileBbox] of tiles) {
    onS(`DEM Elevation: tile ${tileId} (${tilesDone + 1}/${tiles.size})`);
    if (onProg) onProg({ phase: "DEM Elevation", current: tilesDone, total: tiles.size });

    let tileSuccess = false;
    for (let attempt = 0; attempt < 3 && !tileSuccess; attempt++) {
      if (attempt > 0) {
        onS(`DEM: tile ${tileId} retry ${attempt + 1}/3`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
      try {
        const tiff = await fromUrl(tileBbox.url);
        const image = await tiff.getImage();
        const imgW = image.getWidth();
        const imgH = image.getHeight();

        // Intersection of tile with our bbox (same pattern as WorldCover, line 472)
        const isectS = Math.max(bbox.south, tileBbox.south);
        const isectN = Math.min(bbox.north, tileBbox.north);
        const isectW = Math.max(bbox.west, tileBbox.west);
        const isectE = Math.min(bbox.east, tileBbox.east);
        if (isectS >= isectN || isectW >= isectE) { tileSuccess = true; break; }

        // Pixel window in the tile (origin = top-left = NW corner)
        const px0 = Math.max(0, Math.floor((isectW - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
        const py0 = Math.max(0, Math.floor((tileBbox.north - isectN) / (tileBbox.north - tileBbox.south) * imgH));
        const px1 = Math.min(imgW, Math.ceil((isectE - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
        const py1 = Math.min(imgH, Math.ceil((tileBbox.north - isectS) / (tileBbox.north - tileBbox.south) * imgH));

        // Grid cells overlapping this intersection
        const { r0: gridR0, r1: gridR1, c0: gridC0, c1: gridC1 } = proj.geoRangeToGridRange(isectS, isectN, isectW, isectE);
        const cellsInRange = (gridC1 - gridC0 + 1) * (gridR1 - gridR0 + 1);
        if (cellsInRange <= 0) { tileSuccess = true; break; }

        // Read raster at native resolution within the window
        const rasters = await image.readRasters({ window: [px0, py0, px1, py1] });
        const data = rasters[0];
        const outW = px1 - px0;
        const outH = py1 - py0;
        const isectLonSpan = isectE - isectW;
        const isectLatSpan = isectN - isectS;

        // Sample DEM pixels within each hex cell
        for (let r = gridR0; r <= gridR1; r++) {
          for (let c = gridC0; c <= gridC1; c++) {
            const cellIdx = r * cols + c;
            if (cellIdx < 0 || cellIdx >= totalCells) continue;
            const samplePts = proj.cellSamplePoints(c, r, ELEV_SAMPLES);
            for (const pt of samplePts) {
              if (pt.lon < isectW || pt.lon > isectE || pt.lat < isectS || pt.lat > isectN) continue;
              const rx = Math.floor((pt.lon - isectW) / isectLonSpan * outW);
              const ry = Math.floor((isectN - pt.lat) / isectLatSpan * outH);
              if (rx < 0 || rx >= outW || ry < 0 || ry >= outH) continue;
              const val = data[ry * outW + rx];
              // Filter void/nodata: Copernicus uses NaN, raw SRTM uses -32768
              if (val !== undefined && val > -1000 && !isNaN(val)) {
                cellSamples[cellIdx].push(val);
              }
            }
          }
        }

        if (log) log.ok(`Tile ${tileId}: ${cellsInRange} cells (${outW}×${outH} px window)`);
        tileSuccess = true;
      } catch (e) {
        // 404 = ocean tile (no DEM data), same as WorldCover behavior
        const isOcean = e.message && (e.message.includes("404") || e.message.includes("Not Found") || e.message.includes("403"));
        if (isOcean) {
          if (log) log.info(`DEM tile ${tileId}: no data (ocean/void)`);
          tileSuccess = true;
        } else if (attempt < 2) {
          if (log) log.warn(`DEM tile ${tileId}: attempt ${attempt + 1} failed — ${e.message}`);
        } else {
          if (log) log.warn(`DEM tile ${tileId}: failed after 3 attempts — ${e.message}`);
        }
      }
    }

    tilesDone++;
    if (onProg) onProg({ phase: "DEM Elevation", current: tilesDone, total: tiles.size });

    // Emit partial preview after each tile
    if (onPartial) {
      const preview = new Array(totalCells).fill(null);
      for (let i = 0; i < totalCells; i++) {
        if (cellSamples[i].length > 0) {
          let sum = 0;
          for (const v of cellSamples[i]) sum += v;
          preview[i] = sum / cellSamples[i].length;
        }
      }
      onPartial(preview);
    }
  }

  // Compute per-cell statistics from accumulated samples
  const elevations = new Array(totalCells);
  const elevMin = new Array(totalCells);
  const elevMax = new Array(totalCells);
  const elevRange = new Array(totalCells);
  const elevStddev = new Array(totalCells);
  let validCells = 0;

  for (let i = 0; i < totalCells; i++) {
    const samples = cellSamples[i];
    if (samples.length === 0) {
      elevations[i] = 0;
      elevMin[i] = 0;
      elevMax[i] = 0;
      elevRange[i] = 0;
      elevStddev[i] = 0;
      continue;
    }
    validCells++;
    let sum = 0, min = Infinity, max = -Infinity;
    for (const v of samples) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / samples.length;
    elevations[i] = mean;
    elevMin[i] = min;
    elevMax[i] = max;
    elevRange[i] = max - min;

    let sumSqDiff = 0;
    for (const v of samples) {
      const d = v - mean;
      sumSqDiff += d * d;
    }
    elevStddev[i] = Math.sqrt(sumSqDiff / samples.length);
  }

  // Gap-fill edge cells with zero elevation samples from neighbors.
  // Same hex-stagger overhang issue as WorldCover — alternating edge cells'
  // sample points fall outside the DEM intersection bounds.
  for (let i = 0; i < totalCells; i++) {
    if (cellSamples[i].length === 0) {
      const c = i % cols, r = Math.floor(i / cols);
      for (const [nc, nr] of getNeighbors(c, r)) {
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (ni >= 0 && ni < totalCells && cellSamples[ni].length > 0) {
          elevations[i] = elevations[ni];
          elevMin[i] = elevMin[ni];
          elevMax[i] = elevMax[ni];
          elevRange[i] = elevRange[ni];
          elevStddev[i] = elevStddev[ni];
          break;
        }
      }
    }
  }

  const coverage = validCells / totalCells;
  if (log) {
    log.ok(`DEM complete: ${validCells}/${totalCells} cells (${(coverage * 100).toFixed(0)}% coverage)`);
    const avgStddev = elevStddev.reduce((a, b) => a + b, 0) / Math.max(1, validCells);
    const maxR = Math.max(...elevRange);
    log.detail(`Avg internal stddev: ${avgStddev.toFixed(1)}m, max range: ${maxR.toFixed(0)}m`);
  }

  return { elevations, elevMin, elevMax, elevRange, elevStddev, coverage };
}

// ════════════════════════════════════════════════════════════════
// ELEVATION SAMPLING + INTERPOLATION
// ════════════════════════════════════════════════════════════════

async function fetchElevSmart(bbox, cols, rows, onS, onProg, log, onPartial, cellKm) {
  const proj = createHexProjection(bbox, cols, rows);
  const totalCells = cols * rows;
  const SAMPLE_THRESHOLD = 10000;

  // At fine scales (≤2km cells), use Copernicus DEM 30m raster for ~100 samples/cell.
  // Falls back to 3-point API sampling if DEM fails or has low coverage.
  const useRasterDEM = cellKm != null && cellKm <= 10;

  if (log) {
    log.section("ELEVATION");
    log.table([
      ["Grid cells", `${cols}×${rows} = ${totalCells}`],
      ["Sampling", useRasterDEM ? "DEM raster (Copernicus 30m, API fallback)" :
        (totalCells <= SAMPLE_THRESHOLD ? "full (every cell)" : `interpolated (threshold: ${SAMPLE_THRESHOLD})`)],
    ]);
  }

  if (useRasterDEM) {
    // Try Copernicus DEM raster first — vastly more samples per cell, no rate limiting
    try {
      const demResult = await fetchElevFromDEM(bbox, cols, rows, onS, onProg, log, onPartial);
      if (demResult.coverage >= 0.5) {
        if (onPartial) onPartial([...demResult.elevations]);
        return demResult;
      }
      if (log) log.warn(`DEM coverage only ${(demResult.coverage * 100).toFixed(0)}%, falling back to API`);
    } catch (e) {
      if (log) log.warn(`DEM failed: ${e.message}, falling back to API`);
    }

    // API fallback: 3-point multi-sample per cell (center + N/S offsets)
    const PTS_PER_CELL = 3;
    const pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const { lon, lat } = proj.cellCenter(c, r);
      pts.push({ lat, lng: lon });
      const { x: px, y: py } = offsetToPixel(c, r, 1);
      const geoN = proj.hexPixelToGeo(px, py - 0.5);
      const geoS = proj.hexPixelToGeo(px, py + 0.5);
      pts.push({ lat: geoN.lat, lng: geoN.lon });
      pts.push({ lat: geoS.lat, lng: geoS.lon });
    }

    const wrappedPartial = onPartial ? (raw) => {
      const preview = new Array(totalCells).fill(null);
      for (let i = 0; i < totalCells; i++) preview[i] = raw[i * PTS_PER_CELL];
      onPartial(preview);
    } : undefined;

    onS(`Elevation fallback: multi-sampling ${totalCells} cells × ${PTS_PER_CELL} pts...`);
    const result = await fetchElev(pts, onS, onProg, log, wrappedPartial);

    const elevations = new Array(totalCells);
    const elevRange = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const e0 = result.elevations[i * 3];
      const e1 = result.elevations[i * 3 + 1];
      const e2 = result.elevations[i * 3 + 2];
      elevations[i] = (e0 + e1 + e2) / 3;
      elevRange[i] = Math.max(e0, e1, e2) - Math.min(e0, e1, e2);
    }

    if (onPartial) onPartial(elevations);
    if (log) {
      const avgRange = elevRange.reduce((a, b) => a + b, 0) / totalCells;
      const maxRange = Math.max(...elevRange);
      log.ok(`API fallback complete: avg range ${avgRange.toFixed(1)}m, max range ${maxRange.toFixed(0)}m`);
    }

    return { elevations, elevRange, coverage: result.coverage };
  }

  if (totalCells <= SAMPLE_THRESHOLD) {
    const pts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const { lon, lat } = proj.cellCenter(c, r);
      pts.push({ lat, lng: lon });
    }
    const result = await fetchElev(pts, onS, onProg, log, onPartial);
    return { ...result, elevRange: null };
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

  // Emit sparse samples mapped to full grid so preview shows sample points
  if (onPartial) {
    const sparseElev = new Array(totalCells).fill(null);
    for (const r of sampleR) for (const c of sampleC) {
      sparseElev[r * cols + c] = sparse[`${c},${r}`];
    }
    onPartial(sparseElev);
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

  if (onPartial) onPartial(fullElev);

  return { elevations: fullElev, elevRange: null, coverage: sampledElev.coverage };
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
    const lons = points.map(p => wrapLon(p.lon).toFixed(4)).join(",");
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

// Normalize OSM element coordinates to the bbox's continuous longitude range.
// Overpass returns lon in [-180, 180]; when the bbox crosses the antimeridian
// (e.g., west=170, east=190), coordinates like -179 must become 181 so that
// downstream spatial indexing, PIP tests, and grid mapping work correctly.
function normalizeOSMCoords(elements, bboxWest) {
  for (const el of elements) {
    if (el.lon !== undefined) el.lon = continuousLon(el.lon, bboxWest);
    if (el.lat !== undefined && el.geometry) {
      for (const nd of el.geometry) {
        if (nd.lon !== undefined) nd.lon = continuousLon(nd.lon, bboxWest);
      }
    } else if (el.geometry) {
      for (const nd of el.geometry) {
        if (nd.lon !== undefined) nd.lon = continuousLon(nd.lon, bboxWest);
      }
    }
    // Relations have members with geometry arrays
    if (el.members) {
      for (const m of el.members) {
        if (m.geometry) {
          for (const nd of m.geometry) {
            if (nd.lon !== undefined) nd.lon = continuousLon(nd.lon, bboxWest);
          }
        }
      }
    }
  }
}

function parseFeatures(elements, tier, urbanDetail = false) {
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
      // Place nodes — named settlements and neighborhoods
      if (tags.place && tags.name) {
        const rank = tags.place === "city" ? 3 : tags.place === "town" ? 2 : tags.place === "village" ? 1
          : (tags.place === "suburb" || tags.place === "neighbourhood") ? 0.5 : 0;
        if (rank > 0) placeNodes.push({ lat: el.lat, lon: el.lon, name: tags.name, place: tags.place, rank, population: parseInt(tags.population) || 0 });
      }
    }

    // ── Ways ──
    if (el.type === "way" && el.geometry) {
      const ring = el.geometry;
      const closed = ring.length > 2 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon;

      // Terrain areas — only closed ways form valid polygons for PIP testing.
      // Unclosed ways tagged natural=water, landuse, etc. must NOT be used as
      // polygons: pip() implicitly closes them by connecting first→last point,
      // creating massive garbage polygons (e.g., a river bankline spanning the
      // full map width becomes a horizontal band of "lake"). Relations handle
      // unclosed members via assembleRings() which chains and discards properly.
      if (closed) {
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
        if (tags.landuse === "residential") {
          if (tier === "operational" || tier === "strategic") { tt = "light_urban"; tp = 18; }
          // Sub-tactical: only override WC when urbanDetail is on. Priority 6 = beats WC fallback
          // but loses to park (8), forest (10), cemetery (8), allotment (7), sports_field (8), plaza (9)
          else if (tier === "sub-tactical" && urbanDetail) { tt = "light_urban"; tp = 6; }
        }
        if (tags.landuse === "commercial" || tags.landuse === "retail") { tt = "light_urban"; tp = 18; }
        if (tags.landuse === "industrial") { tt = "light_urban"; tp = 18; }
        if (tags.landuse === "quarry") { tt = "open_ground"; tp = 5; }
        // Sub-tactical specific terrain — fine-grained urban types
        if (tier === "sub-tactical") {
          if (tags.landuse === "cemetery") { tt = "cemetery"; tp = 8; }
          if (tags.landuse === "allotments") { tt = "allotment"; tp = 7; }
          if (tags.landuse === "recreation_ground") { tt = "light_veg"; tp = 5; }
          if (tags.leisure === "park" || tags.leisure === "garden") { tt = "park"; tp = 8; }
          if (tags.leisure === "pitch" || tags.leisure === "playground") { tt = "sports_field"; tp = 8; }
          if (tags.amenity === "parking" && closed) infraAreas.push({ type: "parking", pri: 15, ring });
          // Construction sites
          if (tags.landuse === "construction") { tt = "construction_site"; tp = 7; }
          // Rail yards — multiple parallel tracks
          if (tags.landuse === "railway") { tt = "rail_yard"; tp = 12; }
          // Pedestrian plazas
          if (tags.highway === "pedestrian" && closed) { tt = "plaza"; tp = 9; }
          if (tags.place === "square") { tt = "plaza"; tp = 9; }
          // Waterway areas — canals and docks
          if (tags.waterway === "canal" && closed) { tt = "canal"; tp = 15; }
          if (tags.waterway === "dock" || tags.harbour === "yes" || tags.leisure === "marina") {
            if (closed) { tt = "dock"; tp = 15; }
          }
        } else {
          // Non-sub-tactical: use original generic types
          if (tags.landuse === "cemetery") { tt = "open_ground"; tp = 5; }
          if (tags.landuse === "allotments" || tags.landuse === "recreation_ground") { tt = "light_veg"; tp = 5; }
          if (tags.leisure === "park" || tags.leisure === "garden") { tt = "light_veg"; tp = 6; }
          if (tags.leisure === "pitch" || tags.leisure === "playground") { tt = "open_ground"; tp = 5; }
          if (tags.amenity === "parking" && closed) infraAreas.push({ type: "parking", pri: 15, ring });
        }
        if (tt) terrAreas.push({ type: tt, pri: tp, ring, name: tags.name || null });
      }

      // Infra areas
      if (tags.landuse === "military" && closed) infraAreas.push({ type: "military_base", pri: 25, ring, hasName: !!tags.name, name: tags.name || null, isMilitary: !!tags.military, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
      if (tags.aeroway && closed) infraAreas.push({ type: (tags.aeroway === "helipad" && tier === "sub-tactical") ? "helipad" : "airfield", pri: 26, ring, hasName: !!tags.name, name: tags.name || null, isMilitary: !!tags.military, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
      if ((tags.landuse === "port" || tags.industrial === "port" || tags.harbour === "yes") && closed) infraAreas.push({ type: "port", pri: 24, ring, hasName: !!tags.name, name: tags.name || null, isMilitary: false, isAbandoned: tags.disused === "yes" || tags.abandoned === "yes" });
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

      // Buildings (sub-tactical only) — extract metadata for urban classification
      if (tier === "sub-tactical" && tags.building && closed) {
        const bldgType = tags.building === "yes" ? null : tags.building; // null = untyped
        const levels = parseInt(tags["building:levels"]) || null;
        const height = parseFloat(tags.height) || (levels ? levels * 3 : null); // estimate 3m/floor
        const material = tags["building:material"] || null;
        // Functional use from amenity/building type
        const amenity = tags.amenity || null;
        const name = tags.name || null;
        // IHL protected sites: hospitals, schools, religious buildings
        const protectedSite = !!(amenity && /hospital|clinic|school|kindergarten|university/i.test(amenity))
          || /church|cathedral|chapel|mosque|synagogue|temple|monastery/i.test(bldgType || "");
        buildingAreas.push({ ring, bldgType, levels, height, material, amenity, name, protectedSite });
      }

      // Barriers (sub-tactical only)
      if (tier === "sub-tactical" && tags.barrier) {
        const bt = tags.barrier;
        if (["wall", "city_wall", "retaining_wall"].includes(bt)) barrierLines.push({ type: "wall", nodes: ring });
        else if (bt === "fence") barrierLines.push({ type: "fence", nodes: ring });
        else if (bt === "hedge") barrierLines.push({ type: "hedge", nodes: ring });
      }

      // Hedge lines for density analysis (all tiers that query hedges)
      if (tags.barrier === "hedge") hedgeLines.push({ nodes: ring });

      // Roads — tier-filtered, with optional width/surface metadata
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
        if (lt) {
          const entry = { type: lt, isBridge: br, isTunnel: tn, nodes: ring };
          // Capture width and surface at sub-tactical for urban road classification
          if (tier === "sub-tactical") {
            const w = parseFloat(tags.width) || null;
            if (w) entry.width = w;
            if (tags.surface) entry.surface = tags.surface;
            // Keep original highway tag for fine-grained terrain classification
            entry.hwTag = hw;
          }
          infraLines.push(entry);
        }
      }

      // Railways — tier-filtered
      // Subway lines are always underground; surface rail/tram may enter tunnels.
      // Underground rail keeps the feature (LLM knows rail exists) but skips
      // terrain assignment (rail_track) since it's not visible on the surface.
      if (tags.railway === "rail") {
        const underground = !!(tags.tunnel && tags.tunnel !== "no") || parseInt(tags.layer) < 0;
        infraLines.push({ type: "railway", isBridge: !!(tags.bridge && tags.bridge !== "no"), isTunnel: underground, isUnderground: underground, nodes: ring });
      }
      if (tags.railway === "subway") {
        infraLines.push({ type: "railway", isBridge: false, isTunnel: true, isUnderground: true, nodes: ring });
      }
      if (tier === "sub-tactical" && (tags.railway === "light_rail" || tags.railway === "tram")) {
        const underground = !!(tags.tunnel && tags.tunnel !== "no") || parseInt(tags.layer) < 0;
        infraLines.push({ type: "light_rail", isBridge: false, isTunnel: underground, isUnderground: underground, nodes: ring });
      }

      // Waterways — tier-filtered
      if (tags.waterway && !closed) {
        if (["river", "canal"].includes(tags.waterway)) {
          waterLines.push({ type: "river", nodes: ring, name: tags.name || null });
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
      if (tags.landuse === "residential") {
        if (tier === "operational" || tier === "strategic") { tt = "light_urban"; tp = 18; }
        else if (tier === "sub-tactical" && urbanDetail) { tt = "light_urban"; tp = 6; }
      }
      if (tags.landuse === "commercial" || tags.landuse === "industrial") { tt = "light_urban"; tp = 18; }
      // Assemble relation member ways into closed rings (fixes multipolygon inflation)
      // Individual bankline segments aren't closed polygons — pip() implicitly closes them,
      // creating massive garbage polygons. assembleRings() chains them properly.
      if (tt) {
        const outerRings = assembleRings(el.members, "outer");
        const innerRings = assembleRings(el.members, "inner");
        for (const ring of outerRings) {
          terrAreas.push({ type: tt, pri: tp, ring, innerRings: innerRings.length > 0 ? innerRings : null, name: tags.name || null });
        }
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
              waterLines.push({ type: "river", nodes: geom, name: relName });
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
  // Theater (≥15km cells): scalerank 0-4 (continental rivers only)
  // Strategic: scalerank 0-5 (major crossing obstacles, ≥100m wide)
  // Operational: scalerank 0-7 (all included rivers)
  const maxScalerank = cellKm >= 15 ? 4 : tier === "strategic" ? 5 : 7;
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
  const w = wrapLon(bbox.west - expand), e = wrapLon(bbox.east + expand);

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

function classifyGrid(bbox, cols, rows, feat, elevData, onS, wcData, tier, cellKm, wikidataRivers, aridityGrid, metroCities, urbanDetail = false) {
  const { south, north, west, east } = bbox;
  const proj = createHexProjection(bbox, cols, rows);
  const elev = elevData.elevations;
  const elevRange = elevData.elevRange; // per-cell elevation range, null at coarse scales
  const wcGrid = wcData ? wcData.wcGrid : null;
  const wcMix = wcData ? wcData.wcMix : null;
  const wcGapFilled = wcData ? wcData.wcGapFilled : null;

  // Filter out thin terrain polygons that create horizontal banding.
  // These are linear features (boulevards, canal banks) mistagged as areas —
  // very wide E-W but only ~10m tall N-S. They pass PIP for one row of hex
  // cells but not the next, creating map-wide horizontal stripes.
  if (tier === "sub-tactical") {
    const minNS = cellKm * 3 / 111.32; // 3 cell heights in degrees
    feat.terrAreas = feat.terrAreas.filter(a => {
      let mnLa = Infinity, mxLa = -Infinity, mnLo = Infinity, mxLo = -Infinity;
      for (const p of a.ring) {
        if (p.lat < mnLa) mnLa = p.lat; if (p.lat > mxLa) mxLa = p.lat;
        if (p.lon < mnLo) mnLo = p.lon; if (p.lon > mxLo) mxLo = p.lon;
      }
      const ns = mxLa - mnLa;
      const ew = (mxLo - mnLo) * Math.cos(((mnLa + mxLa) / 2) * Math.PI / 180);
      // Reject if N-S span < 3 cells AND aspect ratio > 10:1
      if (ns < minNS && ew > ns * 10) return false;
      return true;
    });
  }

  onS("Spatial indexing...");
  // At sub-tactical (10m hexes), use fine bucket grid so bucket boundaries
  // don't create visible row-aligned terrain oscillation. 25 buckets = ~80m
  // per bucket = ~8 hex rows between boundaries. 100 buckets = ~20m = ~2 rows.
  const idxBuckets = tier === "sub-tactical" ? 100 : 25;
  const tIdx = buildIdx(feat.terrAreas, bbox, idxBuckets, idxBuckets);
  const iaIdx = feat.infraAreas.length > 0 ? buildIdx(feat.infraAreas, bbox, idxBuckets, idxBuckets) : null;

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
  // Preserve ordered cell paths from rasterizeWay() for rendering.
  // BFS reconstruction loses way order and creates random branching.
  const linearPaths = [];
  for (const line of feat.infraLines) {
    const pathCells = rasterizeWay(line.nodes);
    if (pathCells.length >= 2) linearPaths.push({ type: line.type, cells: pathCells });
    const seen = new Set();
    for (const [c, r] of pathCells) {
      const k = `${c},${r}`;
      if (seen.has(k)) continue; seen.add(k);
      if (["highway", "major_road", "road", "minor_road"].includes(line.type)) {
        cellRoadCount[k] = (cellRoadCount[k] || 0) + 1;
      }
      // Best-of for backwards compat (urban clustering)
      const rk = { highway: 5, major_road: 4, road: 3, minor_road: 2.8, railway: 2.5, light_rail: 2.3, trail: 2, footpath: 1.5 };
      const ex = cellInfra[k], nr = rk[line.type] || 0, er = ex ? (rk[ex.type] || 0) : 0;
      if (!ex || nr > er) cellInfra[k] = { type: line.type, isBridge: line.isBridge, isTunnel: line.isTunnel, isUnderground: !!line.isUnderground };
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

  // River lines — at strategic/operational, only whitelist-matched rivers get visual lines.
  // This mirrors the navigable filtering: without this, every OSM waterway=river draws
  // a cyan line even when the whitelist correctly excludes it from hex features.
  const cellRiver = new Set();
  const filterVisualRivers = wikidataRivers && (tier === "strategic" || tier === "operational");
  const riverNameMatches = (osmName) => {
    if (!osmName) return false;
    const lower = osmName.toLowerCase();
    for (const wdName of wikidataRivers) {
      if (wdName.length <= 3) {
        const re = new RegExp(`\\b${wdName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(lower)) return true;
      } else {
        if (lower.includes(wdName)) return true;
      }
      if (lower.length >= 4 && (wdName === lower || wdName.endsWith(" " + lower))) return true;
    }
    return false;
  };
  for (const wl of feat.waterLines) {
    if (filterVisualRivers && !riverNameMatches(wl.name)) continue;
    const pathCells = rasterizeWay(wl.nodes);
    if (pathCells.length >= 2) linearPaths.push({ type: "river", cells: pathCells });
    for (const [c, r] of pathCells) cellRiver.add(`${c},${r}`);
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

  // Building areas (sub-tactical) — compute per-cell coverage and building metadata
  const cellBuildingPct = {};
  // Per-cell building metadata accumulators for fine-grained urban classification
  const cellBuildingMeta = {};  // k -> { heights:[], types:[], materials:[], amenities:[], names:[], protectedCount:0, totalArea:number }
  if (tier === "sub-tactical" && feat.buildingAreas && feat.buildingAreas.length > 0) {
    const cellBuildingArea = {};
    const hexArea = (SQRT3 / 2) * cellKm * cellKm; // hex area in km²

    // Helper: assign a building to a single hex cell
    const assignBldgToCell = (k, area, bldg) => {
      cellBuildingArea[k] = (cellBuildingArea[k] || 0) + area;
      if (!cellBuildingMeta[k]) cellBuildingMeta[k] = { heights: [], types: [], materials: [], amenities: [], names: [], protectedCount: 0, totalArea: 0 };
      const meta = cellBuildingMeta[k];
      meta.totalArea += area;
      if (bldg.height) meta.heights.push(bldg.height);
      if (bldg.bldgType) meta.types.push(bldg.bldgType);
      if (bldg.material) meta.materials.push(bldg.material);
      if (bldg.amenity) meta.amenities.push(bldg.amenity);
      if (bldg.name) meta.names.push(bldg.name);
      if (bldg.protectedSite) meta.protectedCount++;
    };

    for (const bldg of feat.buildingAreas) {
      if (!bldg.ring || bldg.ring.length < 3) continue;
      const area = polyAreaKm2(bldg.ring);

      // Flood fill from centroid through connected urban hexes.
      // Spreads building coverage outward from its center, stopping at
      // non-urban WC terrain (water, parks, forest). Coverage area is
      // limited to the building's actual footprint size in hex count.
      let sumLat = 0, sumLon = 0;
      for (const nd of bldg.ring) { sumLat += nd.lat; sumLon += nd.lon; }
      const centroid = geoToCell(sumLon / bldg.ring.length, sumLat / bldg.ring.length);
      if (!centroid) continue;

      // How many hexes this building should cover based on its area
      const targetCount = Math.max(1, Math.min(500, Math.ceil(area / hexArea)));

      const hits = [];
      const visited = new Set();
      const startK = `${centroid[0]},${centroid[1]}`;
      const queue = [startK];
      visited.add(startK);

      while (queue.length > 0 && hits.length < targetCount) {
        const k = queue.shift();
        // Stop expanding at non-urban terrain or road infrastructure.
        // Roads are physical boundaries — a building doesn't span across a street.
        const wc = wcGrid ? wcGrid[k] : null;
        if (wc && wc !== "light_urban" && wc !== "dense_urban") continue;
        if (k !== startK && cellRoadCount[k]) continue; // roads block flood fill
        hits.push(k);

        // Expand to hex neighbors (odd-r offset coords, pointy-top)
        const [cc, rr] = k.split(",").map(Number);
        const odd = rr & 1;
        const nbrs = odd
          ? [[cc,rr-1],[cc+1,rr-1],[cc-1,rr],[cc+1,rr],[cc,rr+1],[cc+1,rr+1]]
          : [[cc-1,rr-1],[cc,rr-1],[cc-1,rr],[cc+1,rr],[cc-1,rr+1],[cc,rr+1]];
        for (const [nc, nr] of nbrs) {
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const nk = `${nc},${nr}`;
          if (visited.has(nk)) continue;
          visited.add(nk);
          queue.push(nk);
        }
      }

      // Each hex gets the full building area — it genuinely has building on it
      for (const k of hits) {
        assignBldgToCell(k, area, bldg);
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
          // Reverse: OSM name matches the tail of a compound whitelist name.
          // "Ouse" matches "Great Ouse", "Nile" matches "Blue Nile".
          // "North" does NOT match "North Saskatchewan" — qualifier, not river name.
          if (lower.length >= 4 && (wdName === lower || wdName.endsWith(" " + lower))) {
            return true;
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
            } else if ((tier === "strategic" || tier === "operational") && wayCells.size < 2) {
              // Short tributary sharing a major river's name — skip at large scales
              // A 1-cell river at 10km is likely a small branch, not the real river
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
        const pathCells = rasterizeWay(pl.nodes);
        if (pathCells.length >= 2) linearPaths.push({ type: "pipeline", cells: pathCells });
        for (const [c, r] of pathCells) cellPipeline.add(`${c},${r}`);
      }
    } else {
      // Index per-way, then flood-fill connected components
      const pipeCandidates = new Set();
      const pipePathsByCell = new Map(); // track which paths contribute to each cell
      for (const pl of feat.pipelineLines) {
        const pathCells = rasterizeWay(pl.nodes);
        const pathIdx = linearPaths.length;
        if (pathCells.length >= 2) linearPaths.push({ type: "pipeline", cells: pathCells, _pending: true });
        for (const [c, r] of pathCells) {
          const k = `${c},${r}`;
          pipeCandidates.add(k);
          if (!pipePathsByCell.has(k)) pipePathsByCell.set(k, new Set());
          pipePathsByCell.get(k).add(pathIdx);
        }
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
        if (component.length >= pipeMinSpan) {
          component.forEach(k => cellPipeline.add(k));
        } else {
          // Mark paths for cells in rejected components as rejected
          component.forEach(k => {
            const idxs = pipePathsByCell.get(k);
            if (idxs) idxs.forEach(i => { if (linearPaths[i]) linearPaths[i]._rejected = true; });
          });
        }
      }
      // Remove rejected pipeline paths
      for (let i = linearPaths.length - 1; i >= 0; i--) {
        if (linearPaths[i]._rejected) linearPaths.splice(i, 1);
        else if (linearPaths[i]._pending) delete linearPaths[i]._pending;
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
          cellSettlement.set(k, { name: pn.name, place: pn.place, rank: pn.rank, population: pn.population });
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
      const cityLng = continuousLon(city.lng, west);
      if (cityLng < west - marginLon || cityLng > east + marginLon) continue;

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
  // Maps store cell key → name (or true if unnamed) for LLM place name passthrough
  const cellAirfield = new Map(), cellPort = new Map(), cellMilitaryBase = new Map();
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
        if (ia.type === "airfield") cellAirfield.set(gk, ia.name || null);
        else if (ia.type === "port") cellPort.set(gk, ia.name || null);
        else if (ia.type === "military_base") cellMilitaryBase.set(gk, ia.name || null);
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
  const cellTerrainName = {}; // per-cell: name of the OSM terrain area that won PIP (park, forest, etc.)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const { lon: lng, lat } = proj.cellCenter(c, r);
      const e = elev[r * cols + c] || 0;
      elevG[k] = Math.round(e);

      // ── TERRAIN CLASSIFICATION — multi-point PIP + WorldCover mix ──
      // At strategic/operational: test 5×5 grid of points per cell against OSM terrain polygons
      // This catches features that don't cover the cell center (coastal cities, small polygons)
      // urbanDetail: 3×3 = 9 sample points at sub-tactical to catch residential polygons
      const PTS = (tier === "sub-tactical") ? (urbanDetail ? 3 : 1) : 5;
      const { cellN, cellS, cellW: cellWest, cellE: cellEast } = proj.cellBbox(c, r);
      const tCandidates = qIdxRect(tIdx, bbox, cellS, cellN, cellWest, cellEast);

      // Count OSM terrain type hits across sample points (hex-filtered)
      const osmVotes = {}, osmNames = {};
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
          let best = null, bestPri = -1, bestName = null;
          for (const ai of tCandidates) {
            const a = feat.terrAreas[ai];
            if (a.pri > bestPri && pip(tLat, tLng, a.ring)) {
              // Exclude inner rings (multipolygon holes like islands in rivers)
              let excluded = false;
              if (a.innerRings) {
                for (const inner of a.innerRings) {
                  if (pip(tLat, tLng, inner)) { excluded = true; break; }
                }
              }
              if (!excluded) { best = a.type; bestPri = a.pri; bestName = a.name || null; }
            }
          }
          if (best) {
            osmVotes[best] = (osmVotes[best] || 0) + 1; osmTotal++;
            if (bestName) osmNames[best] = bestName; // last-wins, same name for same type
          }
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
      // When WC says urban but OSM wants non-urban, require stronger consensus.
      // Broad OSM landuse polygons (parks, plazas, residential districts) span
      // entire neighborhoods. At polygon boundaries, 2-3 of 9 PIP samples hit,
      // which passes the 20% threshold but creates horizontal bands because all
      // cells in a row share the same latitude. Requiring 50% for urban→non-urban
      // overrides prevents this while still allowing real features (parks that
      // fully contain a cell get 6+ of 9 hits). WC vegetation→OSM park is fine
      // (both agree it's green), so standard threshold applies there.
      const wcIsUrban = wcBase === "light_urban" || wcBase === "dense_urban";
      const osmIsNonUrban = osmBest && !["light_urban", "dense_urban"].includes(osmBest);
      const threshold = (wcIsUrban && osmIsNonUrban) ? 0.5 : 0.2;
      if (osmBestCnt >= PTS * PTS * threshold) {
        tt = osmBest;
        if (osmNames[tt]) cellTerrainName[k] = osmNames[tt];
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
      // Exception: sub-tactical + urbanDetail keeps WC built-up terrain because
      // (a) the cluster phase is skipped at sub-tactical, and (b) at 10m resolution
      // WC class 50 is the ground truth for urban land surface. OSM fine-grained
      // types (bldg_*, plaza, park, etc.) override where they have specific data.
      if (["light_urban", "dense_urban"].includes(tt) && !(tier === "sub-tactical" && urbanDetail)) {
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

      // Sub-tactical without urbanDetail: WC built-up is too uniform — let OSM provide detail
      // With urbanDetail: keep light_urban as base for generic urban surface (courtyards, etc.)
      if (tier === "sub-tactical" && tt === "light_urban" && !urbanDetail) tt = "open_ground";

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

      // ── Biome refinement — latitude + precipitation split forest/light_veg into climate zones ──
      // Runs AFTER desert check, BEFORE elevation modifiers.
      // Mangrove is handled directly by WC_CLASSES[95].
      {
        const absLat = Math.abs(lat);
        const precip = aridityGrid ? aridityGrid[k] : null;

        // Forest → jungle (tropical wet) or boreal (high-latitude)
        if (tt === "forest" || tt === "dense_forest") {
          if (absLat < 23.5 && precip !== null && precip > 1500) tt = "jungle";
          else if (absLat > 55) tt = "boreal"; // reliable by latitude alone
        }

        // Light veg → savanna (tropical grassland) or tundra (arctic)
        if (tt === "light_veg") {
          if (absLat < 30 && precip !== null && precip >= 500 && precip <= 1500) tt = "savanna";
          else if (absLat > 60 && (precip === null || precip < 500)) tt = "tundra";
        }

        // Open ground → tundra (arctic barren)
        if (tt === "open_ground" && absLat > 60 && (precip === null || precip < 500)) {
          tt = "tundra";
        }
      }

      // Elevation modifiers — dual criteria: absolute elevation AND local prominence
      // Prevents flat high-altitude plateaus (Tibet, Altiplano, Iranian plateau) from being peaks.
      // A plateau at 4500m with prominence ~0 stays highland; a 2500m peak rising 500m above surroundings is a peak.
      const isW = ["lake", "river", "deep_water", "coastal_water"].includes(tt);
      const isU = ["light_urban", "dense_urban"].includes(tt);
      // Urban green spaces (parks, plazas, cemeteries, gardens) shouldn't become
      // highland/mountain just because the city is at elevation. A park at 650m in
      // Madrid is still a park, not rolling highlands.
      const isUrbanGreen = ["park", "plaza", "cemetery", "garden"].includes(tt)
        && wcBase && (wcBase === "light_urban" || wcBase === "dense_urban" || wcBase === "forest");
      const isArid = tt === "desert" || tt === "open_ground";
      const prom = prominence[r * cols + c] || 0;
      if (!isW && !isU && !isUrbanGreen) {
        if (isArid) {
          // Arid terrain: require both absolute height AND prominence for mountain/peak
          if (e > 2500 && prom > 500) tt = "peak";
          else if (e > 1500 && prom > 300) tt = "mountain";
          else if (e > 800 || prom > 150) tt = "highland";
          // Low elevation or low prominence: stays desert/open_ground
        } else {
          // Vegetated/other terrain: dual criteria with prominence
          if (e > 1800 && prom > 500 && tt !== "ice") tt = "peak";
          else if (e > 1000 && prom > 300 && tt !== "ice" && tt !== "farmland") {
            if (tt === "forest" || tt === "dense_forest") tt = "mountain_forest";
            else if (tt === "jungle") tt = "jungle_mountains";
            else if (tt === "boreal") tt = "boreal_mountains";
            else tt = "mountain";
          }
          else if ((e > 800 || prom > 150) && tt !== "ice" && tt !== "farmland") {
            if (tt === "forest" || tt === "dense_forest") tt = "mountain_forest";
            else if (tt === "jungle") tt = "jungle_mountains";
            else if (tt === "boreal") tt = "boreal_mountains";
            else if (!["wetland", "desert", "ice", "farmland", "savanna", "tundra", "mangrove"].includes(tt)) tt = (e > 800 && prom > 300) ? "mountain" : "highland";
          } else if (e > 500 && tt !== "ice" && tt !== "farmland") {
            // Require some local relief — flat plateau tops (prom ≤ 50) stay as-is
            if ((tt === "forest" || tt === "dense_forest") && prom > 50) tt = "forested_hills";
            else if (tt === "jungle" && prom > 50) tt = "jungle_hills";
            else if (tt === "boreal" && prom > 50) tt = "boreal_hills";
            else if (tt === "savanna" && prom > 50) tt = "savanna_hills";
            else if (!["forest", "dense_forest", "wetland", "desert", "ice", "farmland", "jungle", "boreal", "savanna", "tundra", "mangrove"].includes(tt)) tt = "highland";
          }
        }
      }

      // Range-based forested hills reclassification (fine scales only).
      // A forest cell with 30m+ internal elevation range is hilly regardless of absolute elevation.
      // This catches moderate hills (200-500m) that the absolute thresholds above miss.
      if (elevRange) {
        const range = elevRange[r * cols + c] || 0;
        const isMtn = ["mountain", "mountain_forest", "peak", "highland", "jungle_mountains", "boreal_mountains"].includes(tt);
        if (range > 30 && !isMtn) {
          if (tt === "forest" || tt === "dense_forest") tt = "forested_hills";
          else if (tt === "jungle") tt = "jungle_hills";
          else if (tt === "boreal") tt = "boreal_hills";
        }
      }

      terrain[k] = tt;

      // DEBUG: track open_ground sources
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
      // WC-urban enforcement: if satellite says urban but OSM overrode to
      // non-urban (park, plaza, etc.) and confidence is very low, trust the
      // satellite. Real parks have WC=forest (green in preview), not
      // WC=light_urban (red). So WC=urban + OSM=non-urban + low confidence
      // means a broad OSM landuse polygon is falsely overriding satellite data.
      if (conf <= 0.55 && wcIsUrban
          && !["light_urban", "dense_urban", "deep_water", "coastal_water", "lake"].includes(tt)) {
        tt = wcBase;
        terrain[k] = tt;
        conf = wcMixCell ? (wcMixCell[tt] || 0.5) : 1.0;
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
        // Underground rail: keep feature (LLM knows rail exists) but don't
        // assign rail_track terrain — the surface is whatever WC/OSM says.
        else if (li.isUnderground && (li.type === "railway" || li.type === "light_rail")) {
          // no terrain override — rail is below ground
        }
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
          const elevTerrain = ["mountain", "mountain_forest", "forested_hills", "highland", "peak"];
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
      // Named terrain areas (parks, forests, cemeteries, etc.)
      if (cellTerrainName[k]) fn[terrain[k]] = cellTerrainName[k];
      // Named infrastructure areas (military bases, airfields, ports)
      if (cellMilitaryBase.has(k) && cellMilitaryBase.get(k)) fn.military_base = cellMilitaryBase.get(k);
      if (cellAirfield.has(k) && cellAirfield.get(k)) fn.airfield = cellAirfield.get(k);
      if (cellPort.has(k) && cellPort.get(k)) fn.port = cellPort.get(k);
      const sett = cellSettlement.get(k);
      if (sett) {
        // Store as generic settlement; urban/town names are fixed up in cluster phase
        fn.settlement = sett.name;
      }
      if (Object.keys(fn).length > 0) featureNames[k] = fn;
    }
  }

  // ── Row-anomaly smoother — fix horizontal banding from thin OSM polygons ──
  // At sub-tactical, thin horizontal polygons (boulevards, canal banks, park
  // boundaries) that span the full E-W extent but are only 1-2 cells tall can
  // override WorldCover for an entire row, creating visible horizontal bands.
  // Detection: if a non-water terrain type covers >25% of a row but <10% of
  // BOTH adjacent rows, it's an artifact — revert those cells to WorldCover.
  if (tier === "sub-tactical") {
    // Build per-row terrain counts
    const rowCounts = [];
    for (let r = 0; r < rows; r++) {
      const counts = {};
      let total = 0;
      for (let c = 0; c < cols; c++) {
        const k = `${c},${r}`;
        if (!terrain[k]) continue;
        counts[terrain[k]] = (counts[terrain[k]] || 0) + 1;
        total++;
      }
      rowCounts.push({ counts, total });
    }

    for (let r = 1; r < rows - 1; r++) {
      const { counts, total } = rowCounts[r];
      if (total === 0) continue;
      const prev = rowCounts[r - 1];
      const next = rowCounts[r + 1];

      for (const [type, cnt] of Object.entries(counts)) {
        // Skip types that legitimately span full rows (water, urban)
        if (["deep_water", "coastal_water", "lake", "light_urban", "dense_urban"].includes(type)) continue;
        const pct = cnt / total;
        if (pct < 0.25) continue;
        const prevPct = (prev.counts[type] || 0) / (prev.total || 1);
        const nextPct = (next.counts[type] || 0) / (next.total || 1);

        if (prevPct < 0.10 && nextPct < 0.10) {
          // Band artifact — revert affected cells to WorldCover base
          for (let c = 0; c < cols; c++) {
            const k = `${c},${r}`;
            if (terrain[k] === type) {
              terrain[k] = wcGrid ? (wcGrid[k] || "open_ground") : "open_ground";
            }
          }
        }
      }
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
    const TOWN_SCORE = tier === "strategic" ? 0.20 : 0.08; // strategic needs stronger signal

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

    // Force light_urban for settlements above population threshold that
    // weren't caught by cluster detection (WorldCover pixel dilution at large scale)
    if (tier === "strategic") {
      const POP_URBAN_THRESHOLD = 40000;
      for (const [k, sett] of cellSettlement.entries()) {
        if (sett.population >= POP_URBAN_THRESHOLD && !["light_urban", "dense_urban"].includes(terrain[k])) {
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

  return { terrain, infra, attrs, features, featureNames, elevG, elevCoverage: elevData.coverage, cellRoadCount, cellBuildingPct, cellBuildingMeta, cellStream, cellBarrier, cellConfidence, urbanScore, cellSettlement, linearPaths };
}

// ════════════════════════════════════════════════════════════════
// POST-PROCESSING
// ════════════════════════════════════════════════════════════════

function postProc(terrain, infra, attrs, features, featureNames, cols, rows, elevG, cellKm, elevCoverage, cellRoadCount, cellBuildingPct, cellBuildingMeta, tier, wcGrid, wcHasData, wcMix, urbanScore, elevRange, elevStddev, urbanDetail = false) {
  let tG = { ...terrain }, iG = { ...infra }, aG = {};
  for (const k in attrs) aG[k] = [...attrs[k]];
  // Features: deep copy
  const fG = {};
  for (const k in features) fG[k] = [...(features[k] || [])];
  // Feature names: deep copy
  const fnG = {};
  for (const k in featureNames) fnG[k] = { ...featureNames[k] };

  const isW = t => ["deep_water", "coastal_water", "lake", "river"].includes(t);
  const isForest = t => ["forest", "dense_forest", "forested_hills", "mountain_forest", "jungle", "jungle_hills", "jungle_mountains", "boreal", "boreal_hills", "boreal_mountains", "mangrove"].includes(t);
  const isOpen = t => ["open_ground", "light_veg", "highland", "desert", "farmland", "tundra", "savanna", "savanna_hills"].includes(t);

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
    const WC_DEFINITE_LAND = new Set(["farmland", "forest", "dense_forest", "forested_hills", "light_veg", "wetland", "light_urban", "dense_urban", "ice", "jungle", "jungle_hills", "jungle_mountains", "boreal", "boreal_hills", "boreal_mountains", "tundra", "savanna", "savanna_hills", "mangrove"]);
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

  // ── SADDLE (mountain pass / military crest) ──
  // Cell lower than 2 opposite hex neighbors AND higher than 2 other opposite neighbors.
  // Hex grid has 3 opposite pairs: (E,W), (NE,SW), (NW,SE).
  // getNeighbors returns [E, NE, NW, W, SW, SE] → pairs: (0,3), (1,4), (2,5).
  if (tier !== "strategic") {
    const SADDLE_MIN_DIFF = 10; // minimum 10m difference to count
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (isW(tG[k])) continue;
      const e = elevG[k] || 0;
      if (e < 50) continue; // saddles only matter at significant elevation

      const nbrs = getNeighbors(c, r);
      if (nbrs.length < 6) continue;
      const nElev = nbrs.map(([nc, nr]) => {
        const nk = `${nc},${nr}`;
        return elevG[nk] !== undefined ? (elevG[nk] || 0) : null;
      });
      if (nElev.some(v => v === null)) continue; // need all 6 neighbors

      let higherPairs = 0, lowerPairs = 0;
      for (const [a, b] of [[0, 3], [1, 4], [2, 5]]) {
        if (nElev[a] - e > SADDLE_MIN_DIFF && nElev[b] - e > SADDLE_MIN_DIFF) higherPairs++;
        if (e - nElev[a] > SADDLE_MIN_DIFF && e - nElev[b] > SADDLE_MIN_DIFF) lowerPairs++;
      }

      if (higherPairs >= 1 && lowerPairs >= 1) {
        if (!aG[k]) aG[k] = [];
        aG[k].push("saddle");
      }
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

  // ── ELEVATION SMOOTHING (sub-tactical only) ──
  // SRTM is 30m resolution sampled at 10m cells. Adjacent cells may land on
  // different SRTM pixels, creating ±2-5m jitter that registers as steep/extreme
  // slope at 10m scale. Average each cell with its neighbors to dampen noise
  // while preserving real terrain features (cliffs, river banks).
  if (tier === "sub-tactical") {
    const smoothed = {};
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const e = elevG[k] || 0;
      let sum = e, cnt = 1;
      for (const [nc, nr] of getNeighbors(c, r)) {
        const nk = `${nc},${nr}`;
        if (elevG[nk] !== undefined) { sum += elevG[nk]; cnt++; }
      }
      smoothed[k] = Math.round(sum / cnt);
    }
    for (const k in smoothed) elevG[k] = smoothed[k];
  }

  // ── SLOPE (all tiers — angle stored for game use; feature flags at sub-tactical/tactical only) ──
  const slopeGrid = {};
  {
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
      slopeGrid[k] = slopeDeg;
      // Feature flags only at fine tiers (visual markers on map)
      if (tier === "sub-tactical" || tier === "tactical") {
        if (!aG[k]) aG[k] = [];
        if (tier === "sub-tactical" && slopeDeg > 30) aG[k].push("slope_extreme");
        else if (slopeDeg > 15) aG[k].push("slope_steep");
      }
    }
  }

  // ── SLOPE-BASED FOREST RECLASSIFICATION ──
  // Steep forested slopes become forested_hills regardless of absolute elevation.
  // Catches ravine walls and river valley sides that are tactically difficult terrain.
  // At fine scales (≤2km/cell), use 10° threshold to catch moderate slopes that restrict
  // vehicle movement and affect LOS — militarily significant terrain.
  const slopeReclassThresh = cellKm <= 2 ? 10 : 15;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = `${c},${r}`;
    const t = tG[k];
    if (slopeGrid[k] > slopeReclassThresh) {
      if (t === "forest" || t === "dense_forest") tG[k] = "forested_hills";
      else if (t === "jungle") tG[k] = "jungle_hills";
      else if (t === "boreal") tG[k] = "boreal_hills";
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

  // ── FINE-GRAINED URBAN TERRAIN RECLASSIFICATION (sub-tactical) ──
  // At sub-tactical scale, reclassify cells in urban areas from generic
  // light_urban/dense_urban to specific bldg_*, road, or open types
  // based on building metadata and infrastructure. This gives the LLM
  // granular tactical terrain for urban combat adjudication.
  if (tier === "sub-tactical" && cellBuildingMeta) {
    // Map OSM building=* values to our 10 bldg_* terrain types
    const osmToBldgTerrain = (bldgType, levels, amenity) => {
      // Height-based override: 10+ floors → highrise regardless of type
      if (levels && levels >= 10) return "bldg_highrise";
      // Amenity-based classification
      if (amenity) {
        if (/hospital|clinic|school|kindergarten|university|library|museum|fire_station|police|government|public/i.test(amenity)) return "bldg_institutional";
      }
      if (!bldgType) return "bldg_residential"; // most common default
      // Type-based classification
      const bt = bldgType.toLowerCase();
      if (/church|cathedral|chapel|mosque|synagogue|temple|monastery|shrine/i.test(bt)) return "bldg_religious";
      if (/bunker|military|barracks|fortification/i.test(bt)) return "bldg_fortified";
      if (/ruins|collapsed/i.test(bt)) return "bldg_ruins";
      if (/train_station|transportation|station/i.test(bt)) return "bldg_station";
      if (/warehouse|industrial|factory|hangar|garages/i.test(bt)) return "bldg_industrial";
      if (/commercial|office|retail|supermarket|shop/i.test(bt)) return "bldg_commercial";
      if (/apartments|terrace|dormitory|hotel/i.test(bt)) return "bldg_residential";
      if (/house|detached|shed|barn|cabin|bungalow|hut|farm/i.test(bt)) return "bldg_light";
      if (/hospital|school|government|public|civic/i.test(bt)) return "bldg_institutional";
      // Default based on height: short = light, tall = residential
      if (levels && levels <= 2) return "bldg_light";
      return "bldg_residential";
    };

    // Map infrastructure type to road terrain type
    const infraToRoadTerrain = (infraType, hwTag) => {
      if (infraType === "highway") return "motorway";
      if (infraType === "major_road") return "arterial";
      if (infraType === "road") return "street";
      if (infraType === "minor_road") return "alley";
      if (infraType === "footpath") return "road_footpath";
      if (infraType === "railway") return "rail_track";
      if (infraType === "light_rail") return "tram_track";
      return null;
    };

    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const currentTerrain = tG[k];
      // Only reclassify urban cells or cells with significant building coverage
      const isUrban = currentTerrain === "light_urban" || currentTerrain === "dense_urban";
      // urbanDetail: 5% threshold catches single houses on residential lots (not forest)
      const hasBuildingData = cellBuildingPct[k] && cellBuildingPct[k] > (urbanDetail ? 0.05 : 0.15);
      if (!isUrban && !hasBuildingData) continue;

      const bm = cellBuildingMeta[k];
      const bPct = cellBuildingPct[k] || 0;

      // Priority 1: High building coverage → bldg_* terrain type
      if (bPct > 0.30 && bm) {
        // Find dominant building type from metadata
        const dominantType = bm.types.length > 0
          ? (() => { const tc = {}; for (const t of bm.types) tc[t] = (tc[t] || 0) + 1; return Object.entries(tc).sort((a, b) => b[1] - a[1])[0][0]; })()
          : null;
        const avgLevels = bm.heights.length > 0
          ? Math.round(bm.heights.reduce((a, b) => a + b, 0) / bm.heights.length / 3)
          : null;
        const dominantAmenity = bm.amenities.length > 0 ? bm.amenities[0] : null;
        tG[k] = osmToBldgTerrain(dominantType, avgLevels, dominantAmenity);
        continue;
      }

      // Priority 2: Road-dominated cell (urban context, low building coverage)
      if (isUrban && bPct < 0.15) {
        const infra = iG[k];
        const roadTerrain = infraToRoadTerrain(infra);
        if (roadTerrain) {
          tG[k] = roadTerrain;
          continue;
        }
        // No building or road data — keep WC-derived light_urban as-is.
        // At fine resolution (10m) many urban cells have no OSM building
        // centroid; overriding to bare_ground loses the satellite signal.
      }
    }
  }

  // ── TOPOGRAPHIC POSITION INDEX (multi-ring) ──
  // Cell elevation minus mean within radius-3 neighborhood. Positive = hilltop/ridge,
  // negative = valley/depression. Uses prefix sums for O(1) per-cell computation
  // (same approach as prominence in classifyGrid).
  const TPI_RADIUS = 3;
  const tpiGrid = {};
  if (tier === "sub-tactical" || tier === "tactical") {
    const prefixSum = new Float64Array((cols + 1) * (rows + 1));
    const prefixCnt = new Uint32Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = elevG[`${c},${r}`] || 0;
        const i = (r + 1) * (cols + 1) + (c + 1);
        prefixSum[i] = e + prefixSum[i - 1] + prefixSum[i - (cols + 1)] - prefixSum[i - (cols + 1) - 1];
        prefixCnt[i] = 1 + prefixCnt[i - 1] + prefixCnt[i - (cols + 1)] - prefixCnt[i - (cols + 1) - 1];
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const r0 = Math.max(0, r - TPI_RADIUS), r1 = Math.min(rows - 1, r + TPI_RADIUS);
        const c0 = Math.max(0, c - TPI_RADIUS), c1 = Math.min(cols - 1, c + TPI_RADIUS);
        const br = (r1 + 1) * (cols + 1) + (c1 + 1);
        const tl = r0 * (cols + 1) + c0;
        const tr = r0 * (cols + 1) + (c1 + 1);
        const bl = (r1 + 1) * (cols + 1) + c0;
        const sum = prefixSum[br] - prefixSum[tr] - prefixSum[bl] + prefixSum[tl];
        const cnt = prefixCnt[br] - prefixCnt[tr] - prefixCnt[bl] + prefixCnt[tl];
        const mean = cnt > 0 ? sum / cnt : 0;
        tpiGrid[`${c},${r}`] = (elevG[`${c},${r}`] || 0) - mean;
      }
    }
  }

  // ── ELEVATION ADVANTAGE (sub-tactical + tactical, TPI-based) ──
  // Uses multi-ring TPI instead of just immediate neighbors — catches broad hills
  // where all neighbors are also elevated (which the old 1-ring approach missed).
  if (tier === "sub-tactical" || tier === "tactical") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      if (isW(tG[k])) continue;
      if ((tpiGrid[k] || 0) >= 30) {
        if (!aG[k]) aG[k] = [];
        aG[k].push("elevation_advantage");
      }
    }
  }

  // ── ROUGH TERRAIN (fine scales — DEM stddev or API range fallback) ──
  // Flags non-forested, non-water cells with significant internal elevation variation.
  // Covers hilly open ground that doesn't change terrain type but is militarily significant.
  if (cellKm <= 2) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = `${c},${r}`;
      const t = tG[k];
      if (isW(t) || t === "light_urban" || t === "dense_urban") continue;
      if (isForest(t)) continue; // handled by forested_hills reclassification

      let isRough = false;
      if (elevStddev) {
        // Stddev > 15m means significant undulation within the cell (hills, gullies).
        // Much more robust than 3-point range — uses ~100 DEM samples.
        isRough = (elevStddev[r * cols + c] || 0) > 15;
      } else if (elevRange) {
        // API fallback: 3-point range (less accurate, existing behavior)
        isRough = (elevRange[r * cols + c] || 0) > 40;
      }

      if (isRough) {
        if (!aG[k]) aG[k] = [];
        aG[k].push("rough_terrain");
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

  return { terrain: tG, infra: iG, attrs: aG, features: fG, featureNames: fnG, slopeGrid, cellBuildingMeta };
}

// ════════════════════════════════════════════════════════════════
// BATCH SCAN — pipeline entry point for world scanner
// Runs the full terrain pipeline for a single geographic patch.
// Returns cell array suitable for binary encoding and storage.
// ════════════════════════════════════════════════════════════════

// Map annual precipitation (mm) to climate zone for binary storage
function precipToClimateZone(mm) {
  if (mm == null) return "unknown";
  if (mm < 250) return "arid";
  if (mm < 500) return "semi_arid";
  if (mm < 800) return "dry_subhumid";
  if (mm < 1500) return "humid";
  return "wet";
}

export async function scanSinglePatch(bbox, cellKm, callbacks = {}) {
  const { onStatus = () => {}, onProgress = () => {}, log = null, onPhaseComplete = () => {} } = callbacks;
  const tier = getQueryTier(cellKm);
  const cols = Math.max(1, Math.round((bbox.east - bbox.west) * 111.32 * Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180) / cellKm));
  const rows = Math.max(1, Math.round((bbox.north - bbox.south) * 111.32 / (cellKm * SQRT3_2)));

  if (cols * rows > 50000) throw new Error(`Patch too large: ${cols}×${rows} = ${cols * rows} cells`);

  const proj = createHexProjection(bbox, cols, rows);

  // Phase 1: Elevation
  onStatus("Elevation...");
  const elevData = await fetchElevSmart(bbox, cols, rows, onStatus, onProgress, log, null, cellKm);
  onPhaseComplete("elevation");

  // Phase 2: WorldCover
  onStatus("WorldCover...");
  let wcData = null;
  try {
    wcData = await fetchWorldCover(bbox, cols, rows, onStatus, onProgress, log, tier);
  } catch (e) {
    if (log) log.warn(`WorldCover failed: ${e.message}`);
  }
  onPhaseComplete("worldcover");

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

  const patchNetLog = createParserNetLog();
  const els = await fetchOSM(bbox, onStatus, onProgress, mapWKm, mapHKm, cellKm, elevData.elevations, cols, rows, log, patchNetLog);
  normalizeOSMCoords(els, bbox.west);
  const feat = parseFeatures(els, tier);

  const wikidataNames = await wikidataPromise;
  const whitelistNames = (tier === "strategic" || tier === "operational")
    ? getRiverWhitelistNames(tier, cellKm) : null;
  // Whitelist-only at strategic/operational (matches go() behavior).
  // Merging whitelist + Wikidata added too many secondary rivers.
  const wikidataRivers = whitelistNames || wikidataNames;
  const aridityGrid = await aridityPromise;
  const metroCities = await metroCitiesPromise;

  onPhaseComplete("osm");

  // Phase 4: Classify
  onStatus("Classifying...");
  const res = classifyGrid(bbox, cols, rows, feat, elevData, onStatus, wcData, tier, cellKm, wikidataRivers, aridityGrid, metroCities);

  // Phase 5: Post-process
  onStatus("Post-processing...");
  const pp = postProc(res.terrain, res.infra, res.attrs, res.features, res.featureNames,
    cols, rows, res.elevG, cellKm, res.elevCoverage, res.cellRoadCount, res.cellBuildingPct,
    res.cellBuildingMeta,
    tier, wcData ? wcData.wcGrid : null, wcData ? wcData.wcHasData : null,
    wcData ? wcData.wcMix : null, res.urbanScore || {}, elevData.elevRange, elevData.elevStddev);

  onPhaseComplete("classified");

  // Build cell array with lat/lng for binary encoding (v1 format)
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
        lng: wrapLon(lon),
        // v1 fields: slope, climate, population
        slope_angle: pp.slopeGrid[k] || 0,
        climate_zone: precipToClimateZone(aridityGrid ? aridityGrid[k] : null),
        population: res.cellSettlement?.get(k)?.population || 0,
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

  // Flush net traffic log (fire-and-forget)
  patchNetLog.flush();

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

// ── Live preview color schemes ──

// Elevation heatmap: 5-stop gradient blue → cyan → green → yellow → red
const ELEV_STOPS = [
  [0.0,  30, 60, 160],   // deep blue (lowest)
  [0.25, 40, 160, 180],  // cyan
  [0.5,  80, 180, 80],   // green
  [0.75, 220, 200, 60],  // yellow
  [1.0,  200, 60, 40],   // red (highest)
];

function elevColor(t) {
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    if (t <= ELEV_STOPS[i][0]) {
      const [t0, r0, g0, b0] = ELEV_STOPS[i - 1];
      const [t1, r1, g1, b1] = ELEV_STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return [Math.round(r0 + (r1 - r0) * f), Math.round(g0 + (g1 - g0) * f), Math.round(b0 + (b1 - b0) * f)];
    }
  }
  return [200, 60, 40]; // clamp to red
}

// ESA WorldCover raw class → RGB (follows ESA official palette approximately)
const WC_COLORS = {
  10:  [0, 100, 0],      // Tree cover — dark green
  20:  [180, 150, 50],    // Shrubland — olive
  30:  [160, 200, 80],    // Grassland — light green
  40:  [220, 210, 100],   // Cropland — yellow-green
  50:  [200, 50, 50],     // Built-up — red
  60:  [180, 170, 140],   // Bare/sparse — tan
  70:  [220, 235, 250],   // Snow/ice — light blue-white
  80:  [30, 80, 180],     // Water — blue
  90:  [70, 140, 120],    // Wetland — teal
  95:  [50, 120, 90],     // Mangroves — dark teal
  100: [140, 180, 120],   // Moss/lichen — muted green
};

// ── Live preview: shows map building in real time during generation ──
function LivePreview({ previewData, cols, rows }) {
  const canvasRef = useRef(null);
  const [userMode, setUserMode] = useState(null); // null = auto-select
  const prevCountRef = useRef(0);

  // Determine available modes based on what data has arrived
  const available = [];
  if (previewData.elevations) available.push("elevation");
  if (previewData.wcGrid) available.push("worldcover");
  if (previewData.terrain || previewData.terrainFinal) available.push("terrain");

  // Auto-select the latest mode, unless user manually picked one
  const activeMode = userMode && available.includes(userMode)
    ? userMode : available[available.length - 1] || null;

  // Reset to auto-select when a new mode becomes available
  useEffect(() => {
    if (available.length > prevCountRef.current) setUserMode(null);
    prevCountRef.current = available.length;
  }, [available.length]);

  // Canvas sizing: fit grid into ~400px width
  const CANVAS_W = Math.min(400, Math.max(200, cols * 3));
  const hexSize = CANVAS_W / (SQRT3 * (cols + 0.5));
  const CANVAS_H = Math.max(1, Math.round((1.5 * rows + 0.5) * hexSize));
  const padX = SQRT3_2 * hexSize;
  const padY = hexSize;

  // Redraw canvas when data or mode changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeMode) return;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imgData.data;

    for (let py = 0; py < CANVAS_H; py++) {
      for (let px = 0; px < CANVAS_W; px++) {
        const { col, row } = pixelToOffset(px - padX, py - padY, hexSize);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        const idx = (py * CANVAS_W + px) * 4;
        let rgb;

        if (activeMode === "elevation") {
          const e = previewData.elevations[row * cols + col];
          if (e === null) continue; // not yet fetched — leave dark
          const range = previewData.elevMax - previewData.elevMin;
          const t = range > 0 ? (e - previewData.elevMin) / range : 0.5;
          rgb = elevColor(Math.max(0, Math.min(1, t)));
        } else if (activeMode === "worldcover") {
          const cls = previewData.wcGrid[`${col},${row}`];
          if (!cls) continue;
          rgb = WC_COLORS[cls] || [40, 40, 40];
        } else if (activeMode === "terrain") {
          const src = previewData.terrainFinal || previewData.terrain;
          const val = src[`${col},${row}`];
          if (!val) continue;
          rgb = TERR_LUT[val] || [18, 24, 42];
        }

        if (rgb) {
          data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [activeMode, previewData, cols, rows, CANVAS_W, CANVAS_H, hexSize, padX, padY]);

  if (!activeMode) return <div style={{ padding: space[4], color: colors.text.muted, fontSize: typography.body.sm, textAlign: "center" }}>Waiting for data...</div>;

  const MODES = [
    { id: "elevation", label: "Elevation", color: colors.accent.purple },
    { id: "worldcover", label: "WorldCover", color: colors.accent.amber },
    { id: "terrain", label: "Terrain", color: colors.accent.green },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[1] }}>
        <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.bold, color: colors.text.primary }}>Live Preview</div>
        <div style={{ display: "flex", gap: 2 }}>
          {MODES.map(m => {
            const avail = available.includes(m.id);
            const active = activeMode === m.id;
            return (
              <div key={m.id} onClick={() => avail && setUserMode(m.id)} style={{
                padding: "2px 8px", borderRadius: radius.sm, fontSize: typography.body.xs,
                cursor: avail ? "pointer" : "default",
                background: active ? `${m.color}20` : colors.bg.raised,
                color: active ? m.color : avail ? colors.text.secondary : colors.text.disabled,
                border: `1px solid ${active ? m.color + "50" : colors.border.subtle}`,
                opacity: avail ? 1 : 0.3, transition: `all ${animation.fast}`,
              }}>
                {m.label}
              </div>
            );
          })}
        </div>
      </div>
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{
        width: "100%", borderRadius: radius.md,
        border: `1px solid ${colors.border.default}`,
        background: colors.bg.base, imageRendering: "pixelated",
      }} />
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[1], fontFamily: typography.monoFamily }}>
        {cols}{"\u00D7"}{rows} {"\u2022"} {activeMode}
        {activeMode === "elevation" && previewData.elevMin !== undefined && ` \u2022 ${Math.round(previewData.elevMin)}m\u2013${Math.round(previewData.elevMax)}m`}
      </div>
    </div>
  );
}

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
  const [tG, setTG] = useState(null), [iG, setIG] = useState(null), [aG, setAG] = useState(null), [fG, setFG] = useState(null), [fnG, setFnG] = useState(null), [lpG, setLPG] = useState(null);
  const [eG, setEG] = useState(null), [bmG, setBmG] = useState(null); // bmG = cellBuildingMeta
  const [gC, setGC] = useState(0), [gR, setGR] = useState(0);
  const [fineMapDataState, setFineMapDataState] = useState(null); // dual-res fine grid for viewer
  const [stratGridState, setStratGridState] = useState(null); // strategic grid mapping
  const [urbanDetail, setUrbanDetail] = useState(false); // high-detail urban parsing toggle
  const [status, setStatus] = useState(""), [error, setError] = useState(null), [gen, setGen] = useState(false);
  const [pt, setPt] = useState(null), [op, setOp] = useState(90);
  const [activeFeatures, setActiveFeatures] = useState(new Set(["highway","major_road","railway","military_base","airfield","port","dam","river","beach","power_plant","pipeline","town"]));
  const [elevInfo, setElevInfo] = useState("");
  const [progress, setProgress] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [genLog, setGenLog] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewDims, setPreviewDims] = useState(null);

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
    // Per-chunk time includes query + inter-query delay (scaled by chunk count)
    const perChunkBase = tier === "sub-tactical" ? 5 : tier === "tactical" ? 4 : tier === "operational" ? 3 : 1.5;
    const delayPerChunk = chunks > 80 ? 5 : chunks > 30 ? 3 : chunks > 10 ? 2 : 1;
    const osmSec = chunks * perChunkBase + chunks * delayPerChunk;
    return { chunks, tier, totalSec: Math.round(elevSec + wcSec + osmSec), cols, rows, wcTiles };
  }, [mapW, mapH, cellKm, lat, lng]);

  const go = useCallback(async () => {
    setGen(true); setError(null); setStatus("Starting..."); setProgress(null);
    const t0 = Date.now();
    setStartTime(t0);
    const log = new GenLog();
    const netLog = createParserNetLog();

    try {
      const displayCols = Math.max(1, Math.floor(mapW / cellKm)), displayRows = Math.max(1, Math.floor(mapH / (cellKm * SQRT3_2)));
      if (displayCols * displayRows > 60000) { setError(`Too many cells: ${(displayCols * displayRows).toLocaleString()}`); setGen(false); return; }
      const bbox = getBBox(lat, lng, mapW, mapH);

      // ── Adaptive fine resolution (dual-resolution pipeline) ──
      // When urbanDetail is on, compute the finest resolution that fits the 100k hex budget.
      // Parse at fine resolution, then aggregate to display resolution via Strategic Grid.
      let fineCellKm = null; // null = single-resolution mode
      let cols = displayCols, rows = displayRows;
      if (urbanDetail) {
        const mapAreaKm2 = mapW * mapH;
        const rRaw = Math.sqrt(mapAreaKm2 / (100000 * 0.866)); // finest possible hex size
        const rFloor = Math.max(rRaw, 0.01); // floor at 10m (WC native resolution)

        // Only use dual-resolution if fine cells are meaningfully smaller than display cells
        if (rFloor < cellKm * 0.75) {
          // Snap to clean divisor of cellKm for even aggregation
          let bestFine = rFloor;
          for (let n = Math.ceil(cellKm / rFloor); n >= 2; n--) {
            const candidate = cellKm / n;
            if (candidate <= rFloor) { bestFine = candidate; break; }
          }
          const fineCols = Math.max(1, Math.floor(mapW / bestFine));
          const fineRows = Math.max(1, Math.floor(mapH / (bestFine * SQRT3_2)));
          if (fineCols * fineRows <= 100000 && bestFine < cellKm) {
            fineCellKm = bestFine;
            // Pad fine grid by one strategic hex width on each side so edge
            // display hexes get full real data coverage instead of fabricated
            // neighbor copies. The expanded fine grid is parsed with real
            // satellite + OSM data from a slightly larger bbox.
            const padKm = cellKm * 1.5;
            cols = Math.max(1, Math.floor((mapW + 2 * padKm) / bestFine));
            rows = Math.max(1, Math.floor((mapH + 2 * padKm) / (bestFine * SQRT3_2)));
          }
        }
      }

      // When dual-res padding is active, expand the parse bbox so data
      // fetching covers the perimeter fine hexes with real data.
      const finePadKm = fineCellKm ? cellKm * 1.5 : 0;
      const parseBbox = fineCellKm
        ? getBBox(lat, lng, mapW + 2 * finePadKm, mapH + 2 * finePadKm)
        : bbox;
      const parseMapW = mapW + 2 * finePadKm;
      const parseMapH = mapH + 2 * finePadKm;

      log.section("CONFIGURATION");
      log.table([
        ["Center", `${lat.toFixed(4)}, ${lng.toFixed(4)}`],
        ["Map size", `${mapW}×${mapH} km`],
        ["Cell size", `${cellKm} km`],
        ["Grid", `${displayCols}×${displayRows} = ${(displayCols * displayRows).toLocaleString()} cells`],
        ["Query tier", getQueryTier(cellKm)],
        ["Chunk size", `${getChunkSize(getQueryTier(cellKm))} km`],
        ["Bbox", `${bbox.south.toFixed(3)},${bbox.west.toFixed(3)} → ${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`],
        ["Urban detail", urbanDetail ? "ON" : "off"],
        ...(fineCellKm ? [["Fine resolution", `${fineCellKm.toFixed(3)} km → ${cols}×${rows} = ${(cols * rows).toLocaleString()} fine hexes`]] : []),
        ["Version", "v9.2 (4-tier WorldCover + OSM + Features)"],
        ["Timestamp", new Date().toISOString()],
      ]);

      // When urbanDetail is enabled, upgrade tactical to sub-tactical
      // to fetch building footprints + metadata for fine-grained classification
      const baseTier = getQueryTier(cellKm);
      const tier = (urbanDetail && baseTier === "tactical") ? "sub-tactical" : baseTier;

      // ── Live preview callbacks ──
      setPreviewData(null);
      setPreviewDims({ cols: displayCols, rows: displayRows });
      const onElevPartial = (elArr) => {
        let min = Infinity, max = -Infinity;
        for (const v of elArr) { if (v !== null) { if (v < min) min = v; if (v > max) max = v; } }
        if (min === Infinity) return;
        setPreviewData(prev => ({ ...prev, elevations: elArr, elevMin: min, elevMax: max }));
      };
      const onWcPartial = (partial) => {
        setPreviewData(prev => ({ ...prev, wcGrid: partial }));
      };

      // ── PHASE 1: ELEVATION (fast, enables ocean skipping) ──
      const parseCellKm = fineCellKm || cellKm; // actual cell size for pipeline
      setStatus(fineCellKm ? `Phase 1: Fetching elevation (${cols}×${rows} fine hexes)...` : "Phase 1: Fetching elevation data...");
      const elevData = await fetchElevSmart(parseBbox, cols, rows, setStatus, setProgress, log, onElevPartial, parseCellKm);
      const maxElev = Math.max(...elevData.elevations), minElev = Math.min(...elevData.elevations);
      setElevInfo(`Coverage: ${(elevData.coverage * 100).toFixed(0)}% | Max: ${maxElev}m | Min: ${minElev}m`);
      log.info(`Range: ${minElev}m to ${maxElev}m`);

      // ── PHASE 2: WORLDCOVER (satellite land cover — base terrain) ──
      setStatus("Phase 2: Fetching satellite land cover...");
      let wcData = null;
      try {
        wcData = await fetchWorldCover(parseBbox, cols, rows, setStatus, setProgress, log, tier, onWcPartial);
      } catch (e) {
        log.warn(`WorldCover failed: ${e.message} — falling back to OSM-only terrain`);
      }

      // ── PHASE 3: OSM (infrastructure + terrain refinement) ──
      setStatus("Phase 3: Fetching map features...");
      // Start Wikidata river lookup and aridity data in parallel with OSM
      // Strategic/operational: whitelist (primary) + Wikidata (fallback for multi-language names)
      // Tactical/sub-tactical: no river name filtering (null → span-based fallback)
      const wikidataPromise = (tier === "strategic" || tier === "operational")
        ? fetchWikidataRivers(parseBbox, tier, log, cellKm).catch(() => null)
        : Promise.resolve(null);
      const aridityPromise = fetchAridityData(parseBbox, cols, rows, setStatus, log);
      // Metro whitelist: load bundled cities dataset for urban boost at large scales
      const metroCitiesPromise = (tier === "operational" || tier === "strategic")
        ? import("./data/cities.json").then(m => m.default || m)
        : Promise.resolve(null);

      const els = await fetchOSM(parseBbox, setStatus, setProgress, parseMapW, parseMapH, parseCellKm, elevData.elevations, cols, rows, log, netLog);
      normalizeOSMCoords(els, parseBbox.west);
      const feat = parseFeatures(els, tier, urbanDetail);

      // Await Wikidata and aridity results (should be done by now, they're fast)
      const wikidataNames = await wikidataPromise;
      // Strategic/operational/theater: use curated whitelist only.
      // Wikidata added too many secondary rivers (e.g. 20+ in France alone at ≥100km).
      // Tactical/sub-tactical: use Wikidata for broader coverage at smaller scales.
      const whitelistNames = (tier === "strategic" || tier === "operational")
        ? getRiverWhitelistNames(tier, cellKm) : null;
      const wikidataRivers = whitelistNames || wikidataNames;
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
      setProgress({ phase: "Processing", current: 1, total: fineCellKm ? 3 : 2 });
      setStatus(fineCellKm ? `Classifying ${(cols * rows).toLocaleString()} fine hexes...` : "Classifying...");
      await new Promise(r => setTimeout(r, 20));

      const res = classifyGrid(parseBbox, cols, rows, feat, elevData, setStatus, wcData, tier, parseCellKm, wikidataRivers, aridityGrid, metroCities, urbanDetail);
      setPreviewData(prev => ({ ...prev, terrain: res.terrain }));

      setProgress({ phase: "Processing", current: 2, total: fineCellKm ? 3 : 2 });
      setStatus("Post-processing..."); await new Promise(r => setTimeout(r, 20));
      const pp = postProc(res.terrain, res.infra, res.attrs, res.features, res.featureNames, cols, rows, res.elevG, parseCellKm, res.elevCoverage, res.cellRoadCount, res.cellBuildingPct, res.cellBuildingMeta, tier, wcData ? wcData.wcGrid : null, wcData ? wcData.wcHasData : null, wcData ? wcData.wcMix : null, res.urbanScore || {}, elevData.elevRange, elevData.elevStddev, urbanDetail);
      setPreviewData(prev => ({ ...prev, terrainFinal: pp.terrain }));

      // ── PHASE 4b: Strategic Grid aggregation (dual-resolution only) ──
      // When parsing at fine resolution, aggregate fine hexes → display hexes.
      // The fine data stays intact for atlas painting; display cells come from aggregation.
      let stratGrid = null;
      let fineMapDataForViewer = null;
      let displayTerrain = pp.terrain, displayInfra = pp.infra, displayAttrs = pp.attrs;
      let displayFeatures = pp.features, displayFeatureNames = pp.featureNames;
      let displayElevG = res.elevG;
      let displayBuildingMeta = pp.cellBuildingMeta;
      let displayLinearPaths = res.linearPaths;
      let displayConfidence = res.cellConfidence;
      let outCols = cols, outRows = rows;

      if (fineCellKm) {
        setProgress({ phase: "Processing", current: 3, total: 3 });
        setStatus(`Aggregating to ${displayCols}×${displayRows} display hexes...`);
        await new Promise(r => setTimeout(r, 20));

        // Build fine cell objects for Strategic Grid (it expects { terrain, elevation, features, ... })
        const fineCells = {};
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const k = `${c},${r}`;
          const cell = {
            terrain: pp.terrain[k] || "open_ground",
            elevation: res.elevG[k] || 0,
            features: pp.features[k] || [],
            infrastructure: pp.infra[k] || "none",
            attributes: pp.attrs[k] || [],
          };
          if (pp.featureNames && pp.featureNames[k]) cell.feature_names = pp.featureNames[k];
          // Attach building metadata for urban composition aggregation
          if (pp.cellBuildingMeta && pp.cellBuildingMeta[k]) {
            const bm = pp.cellBuildingMeta[k];
            if (bm.heights.length > 0) cell.buildingHeight = Math.round(bm.heights.reduce((a, b) => a + b, 0) / bm.heights.length);
          }
          fineCells[k] = cell;
        }

        const fineMapData = { cols, rows, cellSizeKm: fineCellKm, cells: fineCells };
        // Compute padding offset so buildStrategicGrid clips to display bounds.
        // The fine grid has extra cols/rows of padding on each side; only the
        // inner (unpadded) hexes should determine the strategic grid dimensions.
        const unpadCols = Math.max(1, Math.floor(mapW / fineCellKm));
        const unpadRows = Math.max(1, Math.floor(mapH / (fineCellKm * SQRT3_2)));
        const finePadding = (cols > unpadCols || rows > unpadRows)
          ? { cols: Math.floor((cols - unpadCols) / 2), rows: Math.floor((rows - unpadRows) / 2) }
          : null;
        stratGrid = buildStrategicGrid(fineMapData, cellKm, finePadding);

        // Extract display-resolution grids from strategic cells
        outCols = stratGrid.cols;
        outRows = stratGrid.rows;
        displayTerrain = {};
        displayInfra = {};
        displayAttrs = {};
        displayFeatures = {};
        displayFeatureNames = {};
        displayElevG = {};
        displayBuildingMeta = null; // building meta lives in urban composition now
        displayConfidence = null;
        displayLinearPaths = res.linearPaths || [];

        for (const [k, cell] of Object.entries(stratGrid.cells)) {
          displayTerrain[k] = cell.terrain;
          displayInfra[k] = cell.infrastructure || "none";
          displayAttrs[k] = [];
          displayFeatures[k] = cell.features || [];
          displayElevG[k] = cell.elevation || 0;
        }

        // Store fine map data for viewer atlas painting
        fineMapDataForViewer = fineMapData;

        log.section("STRATEGIC GRID AGGREGATION");
        log.table([
          ["Fine hexes", `${cols}×${rows} = ${(cols * rows).toLocaleString()} at ${fineCellKm.toFixed(3)}km`],
          ["Display hexes", `${outCols}×${outRows} = ${(outCols * outRows).toLocaleString()} at ${cellKm}km`],
          ["Ratio", `~${Math.round(cols * rows / (outCols * outRows))} fine per display hex`],
        ]);
      }

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
        ["Forest (all)", `${(((tCounts.forest || 0) + (tCounts.dense_forest || 0) + (tCounts.forested_hills || 0) + (tCounts.mountain_forest || 0)) / total * 100).toFixed(1)}%`],
        ["Urban (all)", `${(((tCounts.light_urban || 0) + (tCounts.dense_urban || 0)) / total * 100).toFixed(1)}%`],
        ["Elevation coverage", `${(elevData.coverage * 100).toFixed(0)}%`],
      ]);

      // Set display-resolution state (used by preview, View in Map, export)
      setTG(displayTerrain); setIG(displayInfra); setAG(displayAttrs); setFG(displayFeatures); setFnG(displayFeatureNames); setEG(displayElevG); setGC(outCols); setGR(outRows); setLPG(displayLinearPaths); setBmG(displayBuildingMeta || null);
      setFineMapDataState(fineMapDataForViewer); setStratGridState(stratGrid);
      setStatus(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
      setProgress(null);
      setGenLog(log.toString());
      setStep("result");

      // ── AUTO-SAVE ──
      try {
        // Build display-resolution save cells
        const saveCells = {};
        for (let r = 0; r < outRows; r++) for (let c = 0; c < outCols; c++) {
          const k = `${c},${r}`;
          const cell = { terrain: displayTerrain[k] || "open_ground", elevation: displayElevG[k] || 0, features: displayFeatures[k] || [], infrastructure: displayInfra[k] || "none", attributes: displayAttrs[k] || [] };
          if (displayConfidence && displayConfidence[k] !== undefined) cell.confidence = displayConfidence[k];
          if (displayFeatureNames && displayFeatureNames[k]) cell.feature_names = displayFeatureNames[k];
          // Building metadata — only in single-resolution mode (dual-res has urban composition instead)
          if (!fineCellKm && pp.cellBuildingMeta && pp.cellBuildingMeta[k]) {
            const bm = pp.cellBuildingMeta[k];
            if (bm.heights.length > 0) cell.buildingHeight = Math.round(bm.heights.reduce((a, b) => a + b, 0) / bm.heights.length);
            if (bm.heights.length > 0) cell.buildingFloors = Math.round(cell.buildingHeight / 3);
            if (bm.materials.length > 0) {
              const matCount = {};
              for (const m of bm.materials) matCount[m] = (matCount[m] || 0) + 1;
              cell.buildingMaterial = Object.entries(matCount).sort((a, b) => b[1] - a[1])[0][0];
            }
            if (bm.types.length > 0) {
              const typeCount = {};
              for (const t of bm.types) typeCount[t] = (typeCount[t] || 0) + 1;
              cell.buildingType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0][0];
            }
            if (bm.protectedCount > 0) cell.protectedSite = true;
            if (bm.names.length > 0) cell.buildingName = bm.names[0];
          }
          // Attach urban composition from strategic grid aggregation
          if (stratGrid && stratGrid.cells[k] && stratGrid.cells[k].urban) {
            cell.urban = stratGrid.cells[k].urban;
          }
          if (stratGrid && stratGrid.cells[k] && stratGrid.cells[k].terrainComposition) {
            cell.terrainComposition = stratGrid.cells[k].terrainComposition;
          }
          saveCells[k] = cell;
        }
        const saveObj = { map: { cols: outCols, rows: outRows, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells: saveCells, labels: {}, linearPaths: displayLinearPaths }, _meta: { generated: new Date().toISOString(), source: "WorldCover+OSM+SRTM", version: "v0.10", tier } };
        // Attach fine grid for dual-resolution atlas painting
        if (fineMapDataForViewer) {
          saveObj.fineGrid = {
            cols: fineMapDataForViewer.cols,
            rows: fineMapDataForViewer.rows,
            cellSizeKm: fineMapDataForViewer.cellSizeKm,
            cells: fineMapDataForViewer.cells,
          };
        }

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
        const filename = `${safeName}_${scaleName}_${outCols}x${outRows}_${datePart}.json`;

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
    // Flush parser net traffic log (fire-and-forget, runs on success or error)
    netLog.flush();
    setGen(false);
  }, [lat, lng, mapW, mapH, cellKm, urbanDetail]);

  // Helper: attach summarized building metadata to a cell object
  const attachBuildingMeta = (cell, k) => {
    if (!bmG || !bmG[k]) return;
    const bm = bmG[k];
    if (bm.heights.length > 0) { cell.buildingHeight = Math.round(bm.heights.reduce((a, b) => a + b, 0) / bm.heights.length); cell.buildingFloors = Math.round(cell.buildingHeight / 3); }
    if (bm.materials.length > 0) { const mc = {}; for (const m of bm.materials) mc[m] = (mc[m] || 0) + 1; cell.buildingMaterial = Object.entries(mc).sort((a, b) => b[1] - a[1])[0][0]; }
    if (bm.types.length > 0) { const tc = {}; for (const t of bm.types) tc[t] = (tc[t] || 0) + 1; cell.buildingType = Object.entries(tc).sort((a, b) => b[1] - a[1])[0][0]; }
    if (bm.protectedCount > 0) cell.protectedSite = true;
    if (bm.names.length > 0) cell.buildingName = bm.names[0];
  };

  const exp = useCallback(() => {
    const cells = {};
    for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
      const k = `${c},${r}`;
      const cell = { terrain: tG[k], elevation: eG[k], features: fG[k] || [], infrastructure: iG[k], attributes: aG[k] || [] };
      if (fnG && fnG[k]) cell.feature_names = fnG[k];
      attachBuildingMeta(cell, k);
      cells[k] = cell;
    }
    const obj = { map: { cols: gC, rows: gR, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells, labels: {}, linearPaths: lpG || [] }, _meta: { generated: new Date().toISOString(), source: "WorldCover+OSM+SRTM", version: "v0.10", tier: getQueryTier(cellKm) } };
    // Include fine grid for dual-resolution saves
    if (fineMapDataState) {
      obj.fineGrid = { cols: fineMapDataState.cols, rows: fineMapDataState.rows, cellSizeKm: fineMapDataState.cellSizeKm, cells: fineMapDataState.cells };
    }
    const b = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = "open_conflict_terrain.json"; a.click(); URL.revokeObjectURL(u);
  }, [tG, iG, aG, fG, fnG, eG, bmG, gC, gR, cellKm, mapW, mapH, lat, lng, lpG, fineMapDataState]);

  const viewInMap = useCallback(() => {
    if (!tG || !onViewMap) return;
    const cells = {};
    for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
      const k = `${c},${r}`;
      const cell = { terrain: tG[k], elevation: eG[k], features: fG[k] || [], infrastructure: iG[k], attributes: aG[k] || [] };
      if (fnG && fnG[k]) cell.feature_names = fnG[k];
      attachBuildingMeta(cell, k);
      cells[k] = cell;
    }
    const mapData = { cols: gC, rows: gR, cellSizeKm: cellKm, widthKm: mapW, heightKm: mapH, gridType: "hex", center: { lat, lng }, bbox: getBBox(lat, lng, mapW, mapH), cells, labels: {}, linearPaths: lpG || [] };
    onViewMap(mapData, fineMapDataState, stratGridState);
  }, [tG, iG, aG, fG, fnG, eG, bmG, gC, gR, cellKm, mapW, mapH, lat, lng, onViewMap, lpG, fineMapDataState, stratGridState]);

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

              {/* High-detail urban parsing toggle — only show at sub-tactical/tactical */}
              {getQueryTier(cellKm) !== "strategic" && (
                <label style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: space[2], padding: `${space[1]}px ${space[2]}px`, background: urbanDetail ? `${colors.accent.purple}10` : colors.bg.raised, border: `1px solid ${urbanDetail ? colors.accent.purple + "40" : colors.border.subtle}`, borderRadius: radius.md, cursor: "pointer", fontSize: typography.body.xs + 1, color: colors.text.secondary, transition: `all ${animation.fast}` }}>
                  <input type="checkbox" checked={urbanDetail} onChange={e => setUrbanDetail(e.target.checked)} style={{ accentColor: colors.accent.purple }} />
                  <div>
                    <div style={{ fontWeight: typography.weight.bold, color: urbanDetail ? colors.text.primary : colors.text.secondary }}>High-detail urban parsing</div>
                    <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>Fine-grained building/road classification for city maps</div>
                  </div>
                </label>
              )}

              <Button variant={gen ? "secondary" : "success"} onClick={go} disabled={gen} style={{ width: "100%", padding: "10px", fontSize: typography.body.md, fontWeight: typography.weight.bold, cursor: gen ? "wait" : "pointer" }}>{gen ? "Generating..." : "Generate"}</Button>
              {error && <div style={{ marginTop: space[2], padding: space[2], background: colors.glow.red, border: `1px solid ${colors.accent.red}30`, borderRadius: radius.md, fontSize: typography.body.xs + 1, color: "#FCA5A5", fontFamily: typography.fontFamily }}>{error}{genLog && <span onClick={expLog} style={{ marginLeft: space[2], color: colors.accent.purple, cursor: "pointer", textDecoration: "underline" }}>Download generation log</span>}</div>}

              {/* Progress bar during generation */}
              {gen && <ProgressBar progress={progress} status={status} startTime={startTime} />}
            </div>
            <div style={{ flex: 1, maxWidth: 420 }}>
              {previewData && previewDims ? (
                <LivePreview previewData={previewData} cols={previewDims.cols} rows={previewDims.rows} />
              ) : (
                <>
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
                </>
              )}
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
