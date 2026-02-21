// ════════════════════════════════════════════════════════════════
// World Scan Store — IndexedDB storage with binary cell encoding
// Stores pre-scanned terrain patches for instant map generation.
// Binary format v0: 24 bytes/cell (legacy), v1: 28 bytes/cell.
// v1 adds slope, climate zone, and population per cell.
// ════════════════════════════════════════════════════════════════

const DB_NAME = "open-conflict-world-scan";
const DB_VERSION = 1;

// ── CRC32 (data integrity check per patch) ───────────────────
// Standard table-based CRC32 with polynomial 0xEDB88320.
// Computed on encodePatch output, stored alongside buffer, verified on load.
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c;
}

function crc32(buffer) {
  const bytes = new Uint8Array(buffer);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Enum tables for binary encoding ──────────────────────────

// 18 terrain types → u8 index
const TERRAIN_TYPES = [
  "deep_water", "coastal_water", "lake", "river", "wetland",
  "open_ground", "light_veg", "farmland", "forest", "dense_forest",
  "highland", "mountain_forest", "mountain", "peak", "desert",
  "ice", "light_urban", "dense_urban",
  "forested_hills",
];
const TERRAIN_TO_IDX = Object.fromEntries(TERRAIN_TYPES.map((t, i) => [t, i]));

// ~23 infrastructure types → u8 index
const INFRA_TYPES = [
  "none", "highway", "major_road", "road", "minor_road",
  "railway", "light_rail", "trail", "footpath", "bridge",
  "military_base", "airfield", "port", "helipad", "parking",
  "building", "tower", "wall", "fence", "hedge",
  "dam", "power_plant", "pipeline",
];
const INFRA_TO_IDX = Object.fromEntries(INFRA_TYPES.map((t, i) => [t, i]));

// ~38 feature flags → bit index in a u64 (stored as two u32s)
const FEATURE_FLAGS = [
  "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail",
  "dam", "river", "tunnel",
  "port", "airfield", "helipad", "pipeline",
  "power_plant", "military_base",
  "beach", "town",
  "building", "parking", "tower", "wall", "fence",
  "cliffs", "ridgeline", "treeline",
  "slope_steep", "slope_extreme",
  "building_dense", "building_sparse",
  "hedgerow", "walled", "elevation_advantage",
  "bridge", "river_crossing", "stream_crossing", "shoreline",
];
const FEATURE_TO_BIT = Object.fromEntries(FEATURE_FLAGS.map((f, i) => [f, i]));

// ── Climate zone enum (mapped from annual precipitation mm) ──
const CLIMATE_ZONES = [
  "unknown",       // 0 — no data available
  "arid",          // 1 — <250mm
  "semi_arid",     // 2 — 250-500mm
  "dry_subhumid",  // 3 — 500-800mm
  "humid",         // 4 — 800-1500mm
  "wet",           // 5 — >1500mm
];
const CLIMATE_TO_IDX = Object.fromEntries(CLIMATE_ZONES.map((z, i) => [z, i]));

// ── Binary cell format ───────────────────────────────────────
// v0 (legacy): 24 bytes per cell, little-endian
// v1 (current): 28 bytes per cell, adds slope/climate/population
//
//   0:  u8   terrain index (0-17)
//   1:  u8   infrastructure index (0-22)
//   2:  i16  elevation in meters
//   4:  u32  features_lo (bits 0-31)
//   8:  u32  features_hi (bits 32-63)
//  12:  f32  latitude
//  16:  f32  longitude
//  20:  u16  name_table_index (0xFFFF = no names)
//  22:  u8   confidence (0-255 → 0.0-1.0)
//  23:  u8   format_version (0 = v0 legacy, 1 = v1)
// ── v1 fields (bytes 24-27) ──
//  24:  u8   slope_angle (0-90 degrees, clamped)
//  25:  u8   climate_zone (enum index 0-5)
//  26:  u16  population (thousands, 0-65535 → 0 to 65.5M)
const CELL_BYTES = 24;       // v0 legacy size
const CELL_BYTES_V1 = 28;   // v1 size
const FORMAT_VERSION = 1;
const NO_NAMES = 0xFFFF;

/**
 * Encode an array of cell objects into a v1 binary ArrayBuffer (28 bytes/cell).
 * Returns { buffer: ArrayBuffer, nameTable: object[] }
 *
 * Each cell: { terrain, elevation, features[], infrastructure, feature_names?,
 *              confidence?, slope_angle?, climate_zone?, population? }
 */
export function encodePatch(cells) {
  const cellCount = cells.length;
  const buffer = new ArrayBuffer(cellCount * CELL_BYTES_V1);
  const view = new DataView(buffer);
  const nameEntries = [];

  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    const off = i * CELL_BYTES_V1;

    // Terrain
    const terrainIdx = TERRAIN_TO_IDX[c.terrain] ?? 0;
    view.setUint8(off, terrainIdx);

    // Infrastructure
    const infraIdx = INFRA_TO_IDX[c.infrastructure] ?? 0;
    view.setUint8(off + 1, infraIdx);

    // Elevation (clamp to i16 range)
    const elev = Math.max(-32768, Math.min(32767, Math.round(c.elevation ?? 0)));
    view.setInt16(off + 2, elev, true);

    // Features bitmask (two u32s)
    let lo = 0, hi = 0;
    if (c.features) {
      for (const f of c.features) {
        const bit = FEATURE_TO_BIT[f];
        if (bit !== undefined) {
          if (bit < 32) lo |= (1 << bit);
          else hi |= (1 << (bit - 32));
        }
      }
    }
    view.setUint32(off + 4, lo, true);
    view.setUint32(off + 8, hi, true);

    // Lat/lng
    view.setFloat32(off + 12, c.lat ?? 0, true);
    view.setFloat32(off + 16, c.lng ?? 0, true);

    // Name table reference
    if (c.feature_names && Object.keys(c.feature_names).length > 0) {
      view.setUint16(off + 20, nameEntries.length, true);
      nameEntries.push(c.feature_names);
    } else {
      view.setUint16(off + 20, NO_NAMES, true);
    }

    // Confidence (scale 0.0-1.0 → 0-255)
    const conf = Math.round((c.confidence ?? 1) * 255);
    view.setUint8(off + 22, conf);

    // Format version — v0 legacy wrote 0 here (reserved byte), v1 writes 1
    view.setUint8(off + 23, FORMAT_VERSION);

    // v1 fields
    // Slope angle (0-90 degrees, clamped)
    const slope = Math.max(0, Math.min(90, Math.round(c.slope_angle ?? 0)));
    view.setUint8(off + 24, slope);

    // Climate zone (enum index)
    const climate = CLIMATE_TO_IDX[c.climate_zone] ?? 0;
    view.setUint8(off + 25, climate);

    // Population in thousands (0-65535 → 0 to 65.5M)
    const pop = Math.max(0, Math.min(65535, Math.round((c.population ?? 0) / 1000)));
    view.setUint16(off + 26, pop, true);
  }

  return { buffer, nameTable: nameEntries };
}

/**
 * Decode a binary ArrayBuffer + nameTable back into cell objects.
 * Auto-detects format version: byte 23 = 0 → v0 (24 bytes), byte 23 = 1 → v1 (28 bytes).
 * Options:
 *   validate: if true, attach _validationErrors[] to cells with out-of-bounds values
 * Returns array of cell objects matching the standard schema.
 */
export function decodePatch(buffer, nameTable, options = {}) {
  const { validate = false } = options;
  const view = new DataView(buffer);

  // Detect format version from byte 23 of the first cell
  // v0: byte 23 is always 0 (was reserved), v1: byte 23 is 1
  let version = 0;
  let bytesPerCell = CELL_BYTES;
  if (buffer.byteLength >= CELL_BYTES) {
    const versionByte = view.getUint8(23);
    if (versionByte === 1 && buffer.byteLength % CELL_BYTES_V1 === 0) {
      version = 1;
      bytesPerCell = CELL_BYTES_V1;
    }
  }

  const cellCount = buffer.byteLength / bytesPerCell;
  const cells = new Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const off = i * bytesPerCell;

    const terrainIdx = view.getUint8(off);
    const infraIdx = view.getUint8(off + 1);
    const elevation = view.getInt16(off + 2, true);
    const featLo = view.getUint32(off + 4, true);
    const featHi = view.getUint32(off + 8, true);
    const lat = view.getFloat32(off + 12, true);
    const lng = view.getFloat32(off + 16, true);
    const nameIdx = view.getUint16(off + 20, true);
    const confRaw = view.getUint8(off + 22);

    // Decode features from bitmask
    const features = [];
    for (let b = 0; b < 32; b++) {
      if (featLo & (1 << b)) features.push(FEATURE_FLAGS[b]);
    }
    for (let b = 0; b < FEATURE_FLAGS.length - 32; b++) {
      if (featHi & (1 << b)) features.push(FEATURE_FLAGS[32 + b]);
    }

    const cell = {
      terrain: TERRAIN_TYPES[terrainIdx] || "open_ground",
      infrastructure: INFRA_TYPES[infraIdx] || "none",
      elevation,
      features,
      attributes: [], // Legacy field, kept for compatibility
      lat,
      lng,
    };

    if (confRaw < 255) cell.confidence = confRaw / 255;
    if (nameIdx !== NO_NAMES && nameTable && nameTable[nameIdx]) {
      cell.feature_names = nameTable[nameIdx];
    }

    // v1 fields — default to 0/unknown for v0 patches
    if (version >= 1) {
      cell.slope_angle = view.getUint8(off + 24);
      const climateIdx = view.getUint8(off + 25);
      cell.climate_zone = CLIMATE_ZONES[climateIdx] || "unknown";
      cell.population = view.getUint16(off + 26, true) * 1000;
    } else {
      cell.slope_angle = 0;
      cell.climate_zone = "unknown";
      cell.population = 0;
    }

    // Optional validation — checks bounds on all encoded fields
    if (validate) {
      const errors = [];
      if (terrainIdx >= TERRAIN_TYPES.length) errors.push(`terrain index ${terrainIdx} out of range`);
      if (infraIdx >= INFRA_TYPES.length) errors.push(`infra index ${infraIdx} out of range`);
      if (elevation < -500 || elevation > 9000) errors.push(`elevation ${elevation}m out of expected range`);
      if (lat < -90 || lat > 90) errors.push(`latitude ${lat} out of range`);
      if (lng < -180 || lng > 180) errors.push(`longitude ${lng} out of range`);
      if (nameIdx !== NO_NAMES && (!nameTable || nameIdx >= nameTable.length)) {
        errors.push(`name table index ${nameIdx} exceeds table length ${nameTable ? nameTable.length : 0}`);
      }
      if (errors.length > 0) cell._validationErrors = errors;
    }

    cells[i] = cell;
  }
  return cells;
}

// ── IndexedDB wrapper ────────────────────────────────────────

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Patch data store: key = "resolution/patchId" (e.g., "10km/N48E006")
      if (!db.objectStoreNames.contains("patches")) {
        db.createObjectStore("patches");
      }
      // Manifest store: key = resolution (e.g., "10km", "0.5km")
      if (!db.objectStoreNames.contains("manifest")) {
        db.createObjectStore("manifest");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txn(storeName, mode) {
  return openDB().then((db) => {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

/**
 * Save a scanned patch to IndexedDB.
 * Encodes cells as v1 binary (28 bytes/cell) with CRC32 integrity check.
 * @param {string} resolution - "10km" or "0.5km"
 * @param {string} patchId - e.g., "N48E006"
 * @param {object[]} cells - array of cell objects with lat/lng
 */
export async function savePatch(resolution, patchId, cells) {
  const { buffer, nameTable } = encodePatch(cells);
  const key = `${resolution}/${patchId}`;
  const value = {
    buffer, nameTable, cellCount: cells.length,
    crc32: crc32(buffer),
    formatVersion: FORMAT_VERSION,
  };
  const store = await txn("patches", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load a scanned patch from IndexedDB.
 * Verifies CRC32 if stored (v1 patches). Logs warning on mismatch but still returns data.
 * Returns array of cell objects, or null if not found.
 */
export async function loadPatch(resolution, patchId) {
  const key = `${resolution}/${patchId}`;
  const store = await txn("patches", "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      if (!req.result) { resolve(null); return; }
      const { buffer, nameTable } = req.result;
      // Verify CRC32 integrity if present (v1+ patches)
      if (req.result.crc32 !== undefined) {
        const computed = crc32(buffer);
        if (computed !== req.result.crc32) {
          console.warn(`[WorldScanStore] CRC32 mismatch for ${key}: stored=${req.result.crc32}, computed=${computed}`);
        }
      }
      resolve(decodePatch(buffer, nameTable));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Check if a patch exists in storage.
 */
export async function hasPatch(resolution, patchId) {
  const key = `${resolution}/${patchId}`;
  const store = await txn("patches", "readonly");
  return new Promise((resolve, reject) => {
    const req = store.count(IDBKeyRange.only(key));
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a specific patch from storage.
 */
export async function deletePatch(resolution, patchId) {
  const key = `${resolution}/${patchId}`;
  const store = await txn("patches", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete all patches for a resolution.
 */
export async function clearResolution(resolution) {
  const store = await txn("patches", "readwrite");
  const prefix = `${resolution}/`;
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const req = store.delete(range);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Manifest (scan progress tracking) ────────────────────────

/**
 * Manifest schema per resolution:
 * {
 *   patches: {
 *     "N48E006": {
 *       status: "complete" | "in_progress" | "failed" | "pending",
 *       phases: { worldcover: true, elevation: true, osm: false, classified: false },
 *       cellCount: 1089,
 *       timestamp: "2026-02-18T...",
 *       retries: 0,
 *       lastError: null
 *     }
 *   },
 *   startedAt: "2026-02-18T...",
 *   config: { latMin: -72, latMax: 72, ... }
 * }
 */

export async function loadManifest(resolution) {
  const store = await txn("manifest", "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(resolution);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveManifest(resolution, manifest) {
  const store = await txn("manifest", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(manifest, resolution);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update a single patch's manifest entry without rewriting the whole manifest.
 * Loads current manifest, patches the entry, saves back.
 */
export async function updatePatchManifest(resolution, patchId, update) {
  const manifest = await loadManifest(resolution) || { patches: {} };
  manifest.patches[patchId] = { ...manifest.patches[patchId], ...update };
  await saveManifest(resolution, manifest);
}

// ── Storage quota ────────────────────────────────────────────

/**
 * Check available storage quota.
 * Returns { usage, quota, available, percentUsed } in bytes.
 */
export async function checkStorageQuota() {
  if (!navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0, available: 0, percentUsed: 0 };
  }
  const { usage, quota } = await navigator.storage.estimate();
  return {
    usage,
    quota,
    available: quota - usage,
    percentUsed: quota > 0 ? (usage / quota) * 100 : 0,
  };
}

/**
 * Request persistent storage so the browser won't evict our scan data.
 * Returns true if granted.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  return navigator.storage.persist();
}

// ── Stats ────────────────────────────────────────────────────

/**
 * Get scan statistics for a resolution.
 * Returns { totalPatches, completePatches, failedPatches, totalCells, estimatedBytes }
 */
export async function getScanStats(resolution) {
  const manifest = await loadManifest(resolution);
  if (!manifest || !manifest.patches) {
    return { totalPatches: 0, completePatches: 0, failedPatches: 0, totalCells: 0, estimatedBytes: 0 };
  }
  const entries = Object.values(manifest.patches);
  const complete = entries.filter(e => e.status === "complete");
  const totalCells = complete.reduce((sum, e) => sum + (e.cellCount || 0), 0);
  // Use v1 size for estimate — new patches are 28 bytes, old are 24; this overestimates
  // slightly for mixed datasets but is accurate for new scans
  return {
    totalPatches: entries.length,
    completePatches: complete.length,
    failedPatches: entries.filter(e => e.status === "failed").length,
    totalCells,
    estimatedBytes: totalCells * CELL_BYTES_V1,
  };
}

// ── Scan integrity verification ──────────────────────────────

/**
 * Verify integrity of all completed patches for a resolution.
 * Spot-checks CRC32, cell-level validation, phase completeness,
 * stale in-progress entries, and spatial coverage gaps.
 *
 * @param {string} resolution - "10km" or "0.5km"
 * @returns {{ ok, totalPatches, checkedPatches, crcMismatches[], missingPatches[],
 *             cellCountMismatches[], cellErrors[], staleInProgress[],
 *             incompletePhases[], coverageGaps[] }}
 */
export async function verifyScan(resolution) {
  const manifest = await loadManifest(resolution);
  if (!manifest || !manifest.patches) {
    return { ok: false, error: "No manifest found", totalPatches: 0, checkedPatches: 0,
      crcMismatches: [], missingPatches: [], cellCountMismatches: [],
      cellErrors: [], staleInProgress: [], incompletePhases: [], coverageGaps: [] };
  }

  const report = {
    totalPatches: 0, checkedPatches: 0,
    crcMismatches: [],       // patch IDs with CRC32 mismatch
    missingPatches: [],      // marked complete but no data in store
    cellCountMismatches: [], // manifest cellCount vs actual buffer size
    cellErrors: [],          // { patchId, cellIndex, errors[] }
    staleInProgress: [],     // in_progress > 1 hour old
    incompletePhases: [],    // non-polar patches missing required phases
    coverageGaps: [],        // 10° lat/lng zones with no patches
  };

  const entries = Object.entries(manifest.patches);
  report.totalPatches = entries.length;
  const now = Date.now();

  // Track which 10° zones have patches for coverage gap detection
  const coveredZones = new Set();

  for (const [id, entry] of entries) {
    // Parse lat/lng zone from patch ID for coverage tracking
    const zoneMatch = id.match(/^([NS])(\d+)([EW])(\d+)/);
    if (zoneMatch) {
      const lat = parseInt(zoneMatch[2]) * (zoneMatch[1] === "S" ? -1 : 1);
      const lng = parseInt(zoneMatch[4]) * (zoneMatch[3] === "W" ? -1 : 1);
      coveredZones.add(`${Math.floor(lat / 10) * 10},${Math.floor(lng / 10) * 10}`);
    }

    // Stale in_progress detection (>1 hour)
    if (entry.status === "in_progress" && entry.timestamp) {
      const age = now - new Date(entry.timestamp).getTime();
      if (age > 3600000) report.staleInProgress.push(id);
    }

    // Phase completeness — non-polar patches should have all 4 phases
    if (entry.status === "complete" && entry.phases) {
      const isPolar = id.includes("_polar") || (zoneMatch && parseInt(zoneMatch[2]) >= 72);
      const required = isPolar ? ["worldcover", "elevation"] : ["worldcover", "elevation", "osm", "classified"];
      const missing = required.filter(p => !entry.phases[p]);
      if (missing.length > 0) report.incompletePhases.push({ id, missing });
    }

    // Only spot-check completed patches
    if (entry.status !== "complete") continue;
    report.checkedPatches++;

    // Load raw data from IndexedDB (bypass decodePatch for CRC check)
    const key = `${resolution}/${id}`;
    let raw;
    try {
      const store = await txn("patches", "readonly");
      raw = await new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch { continue; }

    if (!raw) { report.missingPatches.push(id); continue; }

    // CRC32 check (only for patches that have a stored checksum)
    if (raw.crc32 !== undefined) {
      const computed = crc32(raw.buffer);
      if (computed !== raw.crc32) report.crcMismatches.push(id);
    }

    // Cell count check: manifest vs actual buffer
    const vByte = raw.buffer.byteLength >= 24 ? new DataView(raw.buffer).getUint8(23) : 0;
    const bpc = vByte === 1 ? CELL_BYTES_V1 : CELL_BYTES;
    const actualCells = raw.buffer.byteLength / bpc;
    if (entry.cellCount && actualCells !== entry.cellCount) {
      report.cellCountMismatches.push({ id, expected: entry.cellCount, actual: actualCells });
    }

    // Cell validation — sample first 10 cells for speed
    const cells = decodePatch(raw.buffer, raw.nameTable, { validate: true });
    const sampleSize = Math.min(10, cells.length);
    for (let i = 0; i < sampleSize; i++) {
      if (cells[i]._validationErrors) {
        report.cellErrors.push({ patchId: id, cellIndex: i, errors: cells[i]._validationErrors });
      }
    }
  }

  // Coverage gap detection: which 10° lat/lng zones should have patches?
  // Scan range: -72 to +72 lat, -180 to +180 lng
  for (let lat = -70; lat < 70; lat += 10) {
    for (let lng = -180; lng < 180; lng += 10) {
      const zone = `${lat},${lng}`;
      if (!coveredZones.has(zone)) report.coverageGaps.push(zone);
    }
  }

  report.ok = report.crcMismatches.length === 0 &&
    report.missingPatches.length === 0 &&
    report.cellCountMismatches.length === 0 &&
    report.cellErrors.length === 0;

  return report;
}

// ── Exports for consumers ────────────────────────────────────

export {
  TERRAIN_TYPES, TERRAIN_TO_IDX,
  INFRA_TYPES, INFRA_TO_IDX,
  FEATURE_FLAGS, FEATURE_TO_BIT,
  CELL_BYTES, CELL_BYTES_V1,
  CLIMATE_ZONES, CLIMATE_TO_IDX,
  FORMAT_VERSION,
};
