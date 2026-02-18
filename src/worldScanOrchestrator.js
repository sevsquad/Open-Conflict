// ════════════════════════════════════════════════════════════════
// World Scan Orchestrator
// Manages the scan loop: enumerates patches, calls the pipeline,
// stores results, tracks progress, handles errors with retry.
// Runs on the main thread (async, yields to event loop between patches).
// ════════════════════════════════════════════════════════════════

import { scanSinglePatch, getQueryTier } from "./Parser.jsx";
import { savePatch, loadManifest, saveManifest, updatePatchManifest, hasPatch } from "./worldScanStore.js";

// ── Patch grid generation ────────────────────────────────────

/**
 * Generate the list of patches that cover the world at a given resolution.
 *
 * 10km strategic: 3°×3° patches aligned to WorldCover tile grid (~1,100 cells each)
 * 0.5km tactical: 1°×1° patches (~8,700 cells each)
 *
 * @param {number} cellKm - Cell size in km (10 or 0.5)
 * @param {object} options - { latMin, latMax, polarLatMin, polarLatMax }
 * @returns {Array<{id, bbox}>} Array of patch descriptors
 */
export function generatePatchGrid(cellKm, options = {}) {
  const {
    latMin = -72,
    latMax = 72,
    polarLatMin = -85,
    polarLatMax = 85,
  } = options;

  // Patch size in degrees: 3° for strategic, 1° for tactical
  const patchDeg = cellKm >= 8 ? 3 : 1;
  const patches = [];

  // Main scan zone (full pipeline)
  for (let lat = latMin; lat < latMax; lat += patchDeg) {
    for (let lng = -180; lng < 180; lng += patchDeg) {
      const id = formatPatchId(lat, lng, patchDeg);
      patches.push({
        id,
        bbox: {
          south: lat,
          north: Math.min(lat + patchDeg, latMax),
          west: lng,
          east: lng + patchDeg,
        },
        polar: false,
      });
    }
  }

  // Polar zones (WorldCover + elevation only, skip Overpass)
  for (let lat = latMax; lat < polarLatMax; lat += patchDeg) {
    for (let lng = -180; lng < 180; lng += patchDeg) {
      patches.push({
        id: formatPatchId(lat, lng, patchDeg),
        bbox: { south: lat, north: Math.min(lat + patchDeg, polarLatMax), west: lng, east: lng + patchDeg },
        polar: true,
      });
    }
  }
  for (let lat = polarLatMin; lat < latMin; lat += patchDeg) {
    for (let lng = -180; lng < 180; lng += patchDeg) {
      patches.push({
        id: formatPatchId(lat, lng, patchDeg),
        bbox: { south: Math.max(lat, polarLatMin), north: lat + patchDeg, west: lng, east: lng + patchDeg },
        polar: true,
      });
    }
  }

  return patches;
}

/**
 * Format a patch ID from its SW corner coordinates.
 * e.g., lat=48, lng=6, deg=3 → "N48E006_3d"
 */
function formatPatchId(lat, lng, patchDeg) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  const absLat = String(Math.abs(Math.floor(lat))).padStart(2, "0");
  const absLng = String(Math.abs(Math.floor(lng))).padStart(3, "0");
  return `${ns}${absLat}${ew}${absLng}_${patchDeg}d`;
}

// ── Scan orchestrator ────────────────────────────────────────

/**
 * Orchestrate a full world scan at the given resolution.
 *
 * @param {number} cellKm - Cell size (10 or 0.5)
 * @param {object} callbacks - { onPatchStart, onPatchComplete, onPatchError, onProgress, onStatus, onDone, shouldStop }
 * @returns {Promise<void>}
 */
export async function runWorldScan(cellKm, callbacks = {}) {
  const {
    onPatchStart = () => {},
    onPatchComplete = () => {},
    onPatchError = () => {},
    onProgress = () => {},
    onStatus = () => {},
    onDone = () => {},
    shouldStop = () => false,
  } = callbacks;

  const resolution = cellKm >= 8 ? "10km" : "0.5km";

  // Load or create manifest
  let manifest = await loadManifest(resolution);
  if (!manifest) {
    manifest = {
      patches: {},
      startedAt: new Date().toISOString(),
      config: { cellKm, resolution },
    };
  }

  // Generate full patch list
  const allPatches = generatePatchGrid(cellKm);
  onStatus(`Scan: ${allPatches.length} patches at ${resolution}`);

  // Initialize manifest entries for new patches
  for (const patch of allPatches) {
    if (!manifest.patches[patch.id]) {
      manifest.patches[patch.id] = {
        status: "pending",
        phases: {},
        cellCount: 0,
        timestamp: null,
        retries: 0,
        lastError: null,
      };
    }
  }
  await saveManifest(resolution, manifest);

  // Build scan queue: pending and failed patches first, skip completed
  const queue = allPatches.filter(p => {
    const entry = manifest.patches[p.id];
    return entry.status !== "complete";
  });

  // Sort: failed patches with fewer retries first, then pending
  queue.sort((a, b) => {
    const ea = manifest.patches[a.id], eb = manifest.patches[b.id];
    if (ea.status === "failed" && eb.status !== "failed") return -1;
    if (eb.status === "failed" && ea.status !== "failed") return 1;
    return (ea.retries || 0) - (eb.retries || 0);
  });

  const totalPatches = allPatches.length;
  const completedBefore = allPatches.length - queue.length;
  let completedCount = completedBefore;
  let failedCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 10;
  const MAX_RETRIES = 5;

  onProgress({
    completed: completedCount,
    failed: failedCount,
    total: totalPatches,
    currentPatch: null,
    phase: "scanning",
  });

  for (const patch of queue) {
    // Check stop signal
    if (shouldStop()) {
      onStatus("Scan paused by user");
      break;
    }

    const entry = manifest.patches[patch.id];

    // Skip patches that have exceeded retry limit
    if (entry.retries >= MAX_RETRIES) {
      failedCount++;
      continue;
    }

    // Back off after consecutive failures
    if (consecutiveFailures > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, consecutiveFailures), 30000);
      onStatus(`Backing off ${(backoffMs / 1000).toFixed(0)}s after ${consecutiveFailures} failures...`);
      await sleep(backoffMs);
    }

    // Bail if too many consecutive failures (API might be down)
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      onStatus(`Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive failures. API may be down.`);
      break;
    }

    onPatchStart(patch.id, completedCount, totalPatches);
    entry.status = "in_progress";
    await updatePatchManifest(resolution, patch.id, { status: "in_progress" });

    try {
      const result = await scanSinglePatch(patch.bbox, cellKm, {
        onStatus: (msg) => onStatus(`[${patch.id}] ${msg}`),
        onProgress: () => {},
      });

      // Store the scanned cells
      await savePatch(resolution, patch.id, result.cells);

      // Update manifest
      entry.status = "complete";
      entry.cellCount = result.cells.length;
      entry.timestamp = new Date().toISOString();
      entry.lastError = null;
      await updatePatchManifest(resolution, patch.id, entry);

      completedCount++;
      consecutiveFailures = 0;
      onPatchComplete(patch.id, result.cells.length);
      onProgress({
        completed: completedCount,
        failed: failedCount,
        total: totalPatches,
        currentPatch: patch.id,
        phase: "scanning",
      });
    } catch (err) {
      entry.status = "failed";
      entry.retries = (entry.retries || 0) + 1;
      entry.lastError = err.message;
      entry.timestamp = new Date().toISOString();
      await updatePatchManifest(resolution, patch.id, entry);

      failedCount++;
      consecutiveFailures++;
      onPatchError(patch.id, err.message, entry.retries);
    }

    // Yield to event loop between patches for UI responsiveness
    await sleep(50);
  }

  // Final manifest save
  manifest = await loadManifest(resolution);
  onDone({
    completed: completedCount,
    failed: failedCount,
    total: totalPatches,
    skipped: totalPatches - completedCount - failedCount,
  });
}

// ── Retry failed patches ─────────────────────────────────────

/**
 * Re-scan all failed patches for a resolution.
 */
export async function retryFailedPatches(cellKm, callbacks = {}) {
  const resolution = cellKm >= 8 ? "10km" : "0.5km";
  const manifest = await loadManifest(resolution);
  if (!manifest) return;

  // Reset failed patches to pending (with retry count preserved)
  for (const [id, entry] of Object.entries(manifest.patches)) {
    if (entry.status === "failed") {
      entry.status = "pending";
    }
  }
  await saveManifest(resolution, manifest);

  // Run the scan again — it will pick up pending patches
  return runWorldScan(cellKm, callbacks);
}

// ── Verification pass ────────────────────────────────────────

/**
 * Check all "complete" patches for data integrity.
 * Returns list of patch IDs that need re-scanning.
 */
export async function verifyCompletedPatches(cellKm, callbacks = {}) {
  const { onStatus = () => {}, onProgress = () => {} } = callbacks;
  const resolution = cellKm >= 8 ? "10km" : "0.5km";
  const manifest = await loadManifest(resolution);
  if (!manifest) return [];

  const completePatches = Object.entries(manifest.patches)
    .filter(([, e]) => e.status === "complete");

  const needsRescan = [];
  for (let i = 0; i < completePatches.length; i++) {
    const [id, entry] = completePatches[i];
    onProgress({ current: i + 1, total: completePatches.length });

    // Check if patch data exists in storage
    const exists = await hasPatch(resolution, id);
    if (!exists) {
      needsRescan.push(id);
      onStatus(`Missing data for ${id}`);
      continue;
    }

    // Check cell count matches
    if (!entry.cellCount || entry.cellCount === 0) {
      needsRescan.push(id);
      onStatus(`Zero cells for ${id}`);
    }
  }

  // Mark patches that need re-scanning as pending
  for (const id of needsRescan) {
    manifest.patches[id].status = "pending";
    manifest.patches[id].retries = 0;
  }
  if (needsRescan.length > 0) {
    await saveManifest(resolution, manifest);
  }

  return needsRescan;
}

// ── Scan statistics ──────────────────────────────────────────

export async function getWorldScanProgress(cellKm) {
  const resolution = cellKm >= 8 ? "10km" : "0.5km";
  const manifest = await loadManifest(resolution);
  if (!manifest) {
    return { total: 0, completed: 0, failed: 0, pending: 0, inProgress: 0, totalCells: 0 };
  }
  const entries = Object.values(manifest.patches);
  return {
    total: entries.length,
    completed: entries.filter(e => e.status === "complete").length,
    failed: entries.filter(e => e.status === "failed").length,
    pending: entries.filter(e => e.status === "pending").length,
    inProgress: entries.filter(e => e.status === "in_progress").length,
    totalCells: entries.filter(e => e.status === "complete").reduce((s, e) => s + (e.cellCount || 0), 0),
    startedAt: manifest.startedAt,
  };
}

// ── Utilities ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
