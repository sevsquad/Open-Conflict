// ═══════════════════════════════════════════════════════════════
// PRESET MAP REGISTRY — Map generators for preset scenarios
// Each generator returns a full terrain map object (same format as Parser output).
// Maps are generated in-memory when needed, then cached to games/presets/.
// ═══════════════════════════════════════════════════════════════

import { generateSignalStationMap } from "./signalStation.js";
import { generateBocageMap } from "./bocage.js";
import { generateFuldaGapMap } from "./fuldaGap.js";
import { generateMosulCorridorMap } from "./mosulCorridor.js";
import { generateVolturnoMap } from "./volturno.js";
import { generateRiverCrossingMap } from "./riverCrossing.js";

/**
 * Registry of preset map generators.
 * Key = preset ID from PRESET_REGISTRY in presets.js
 * Value = { generate: () => mapData, cacheKey: string }
 */
const PRESET_MAP_GENERATORS = {
  signal_station: { generate: generateSignalStationMap, cacheKey: "signal_station" },
  bocage_breakout: { generate: generateBocageMap, cacheKey: "bocage_breakout" },
  fulda_gap: { generate: generateFuldaGapMap, cacheKey: "fulda_gap" },
  mosul_corridor: { generate: generateMosulCorridorMap, cacheKey: "mosul_corridor" },
  volturno_crossing: { generate: generateVolturnoMap, cacheKey: "volturno_crossing" },
  river_crossing_v2: { generate: generateRiverCrossingMap, cacheKey: "river_crossing_v2" },
};

/**
 * Get a preset map by preset ID.
 * First checks the server cache (games/presets/), then generates from code.
 * @param {string} presetId
 * @returns {Promise<Object|null>} terrain map data, or null if no generator exists
 */
export async function getPresetMap(presetId) {
  const entry = PRESET_MAP_GENERATORS[presetId];
  if (!entry) return null;

  // Try loading from server cache first
  try {
    const resp = await fetch(`/api/game/preset-terrain?preset=${encodeURIComponent(entry.cacheKey)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && !data.error) return data.map || data;
    }
  } catch { /* cache miss — generate below */ }

  // Generate from code
  const mapData = entry.generate();

  // Cache to server for next time (fire and forget)
  fetch("/api/game/save-preset-terrain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId: entry.cacheKey, terrainData: mapData }),
  }).catch(() => {});

  return mapData;
}

/**
 * Check if a preset has a built-in map generator.
 */
export function hasPresetMap(presetId) {
  return presetId in PRESET_MAP_GENERATORS;
}
