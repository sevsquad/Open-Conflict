// ════════════════════════════════════════════════════════════════
// World Scan Store — IndexedDB storage with binary cell encoding
// Stores pre-scanned terrain patches for instant map generation.
// Uses compact binary format (~24 bytes/cell) to keep ~690M cells
// manageable (~16.5 GB for full planet at 0.5km).
// ════════════════════════════════════════════════════════════════

const DB_NAME = "open-conflict-world-scan";
const DB_VERSION = 1;

// ── Enum tables for binary encoding ──────────────────────────

// 18 terrain types → u8 index
const TERRAIN_TYPES = [
  "deep_water", "coastal_water", "lake", "river", "wetland",
  "open_ground", "light_veg", "farmland", "forest", "dense_forest",
  "highland", "mountain_forest", "mountain", "peak", "desert",
  "ice", "light_urban", "dense_urban",
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

// ── Binary cell format ───────────────────────────────────────
// 24 bytes per cell, little-endian:
//   0:  u8   terrain index (0-17)
//   1:  u8   infrastructure index (0-22)
//   2:  i16  elevation in meters
//   4:  u32  features_lo (bits 0-31)
//   8:  u32  features_hi (bits 32-63)
//  12:  f32  latitude
//  16:  f32  longitude
//  20:  u16  name_table_index (0xFFFF = no names)
//  22:  u8   confidence (0-255 → 0.0-1.0)
//  23:  u8   reserved
const CELL_BYTES = 24;
const NO_NAMES = 0xFFFF;

/**
 * Encode an array of cell objects into a binary ArrayBuffer.
 * Returns { buffer: ArrayBuffer, nameTable: string[] }
 *
 * Each cell: { terrain, elevation, features[], infrastructure, feature_names?, confidence? }
 */
export function encodePatch(cells) {
  const cellCount = cells.length;
  const buffer = new ArrayBuffer(cellCount * CELL_BYTES);
  const view = new DataView(buffer);
  const nameEntries = []; // [{cellIdx, names: {river: "Thames", ...}}]

  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    const off = i * CELL_BYTES;

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

    // Reserved
    view.setUint8(off + 23, 0);
  }

  return { buffer, nameTable: nameEntries };
}

/**
 * Decode a binary ArrayBuffer + nameTable back into cell objects.
 * Returns array of cell objects matching the standard schema.
 */
export function decodePatch(buffer, nameTable) {
  const view = new DataView(buffer);
  const cellCount = buffer.byteLength / CELL_BYTES;
  const cells = new Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const off = i * CELL_BYTES;

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
 * @param {string} resolution - "10km" or "0.5km"
 * @param {string} patchId - e.g., "N48E006"
 * @param {object[]} cells - array of cell objects with lat/lng
 */
export async function savePatch(resolution, patchId, cells) {
  const { buffer, nameTable } = encodePatch(cells);
  const key = `${resolution}/${patchId}`;
  // Store both the binary buffer and the name table together
  const value = { buffer, nameTable, cellCount: cells.length };
  const store = await txn("patches", "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load a scanned patch from IndexedDB.
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
  return {
    totalPatches: entries.length,
    completePatches: complete.length,
    failedPatches: entries.filter(e => e.status === "failed").length,
    totalCells,
    estimatedBytes: totalCells * CELL_BYTES,
  };
}

// ── Exports for consumers ────────────────────────────────────

export {
  TERRAIN_TYPES, TERRAIN_TO_IDX,
  INFRA_TYPES, INFRA_TO_IDX,
  FEATURE_FLAGS, FEATURE_TO_BIT,
  CELL_BYTES,
};
