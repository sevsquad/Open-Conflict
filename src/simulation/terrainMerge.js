// ═══════════════════════════════════════════════════════════════
// TERRAIN MERGE — Applies terrain modifications overlay to base terrain
// The base terrainData is immutable. This module produces "effective"
// terrain by merging gameState.terrainMods onto base cells lazily.
// ═══════════════════════════════════════════════════════════════

/**
 * Get the effective cell at a position, merging base terrain with active mods.
 * Returns the original cell unchanged if no mods exist for this key.
 * Returns a shallow clone with mods applied if modifications are present.
 */
export function getEffectiveCell(key, terrainData, terrainMods) {
  const baseCell = terrainData.cells[key];
  if (!baseCell) return baseCell;

  const mods = terrainMods?.[key];
  if (!mods || Object.keys(mods).length === 0) return baseCell;

  // Clone the cell and its features array so we don't mutate the original
  const cell = { ...baseCell, features: [...(baseCell.features || [])] };

  // Bridge built — add "bridge" to features if not already present
  if (mods.bridge_built) {
    if (!cell.features.includes("bridge")) cell.features.push("bridge");
  }

  // Bridge destroyed — remove "bridge" from features
  if (mods.bridge_destroyed) {
    const idx = cell.features.indexOf("bridge");
    if (idx !== -1) cell.features.splice(idx, 1);
  }

  // Obstacle — add "obstacle" to features, attach metadata
  if (mods.obstacle) {
    if (!cell.features.includes("obstacle")) cell.features.push("obstacle");
    cell.obstacleMeta = { subtype: mods.obstacle.subtype || mods.obstacle.type || "general" };
  }

  // Obstacle cleared — remove "obstacle" from features
  if (mods.obstacle_cleared) {
    const idx = cell.features.indexOf("obstacle");
    if (idx !== -1) cell.features.splice(idx, 1);
    delete cell.obstacleMeta;
  }

  // Fortification — hex-level defense bonus (0-100)
  if (mods.fortification) {
    cell.hexFortification = mods.fortification.level || 0;
  }

  // Smoke — blocks LOS, temporary
  if (mods.smoke && mods.smoke.turnsRemaining > 0) {
    if (!cell.features.includes("smoke")) cell.features.push("smoke");
    cell.smokeActive = true;
  }

  // Terrain damaged — defense degradation (0-100)
  if (mods.terrain_damaged) {
    cell.terrainDamage = mods.terrain_damaged.level || 0;
  }

  return cell;
}

/**
 * Build an effective terrainData object by overlaying modifications.
 * Uses a Proxy on cells for lazy per-cell merging — only modified hexes
 * incur the cost of cloning. Unmodified hexes pass through unchanged.
 *
 * If terrainMods is empty or undefined, returns the original terrainData.
 */
export function buildEffectiveTerrain(terrainData, terrainMods) {
  if (!terrainData) return terrainData;
  if (!terrainMods || Object.keys(terrainMods).length === 0) return terrainData;

  // Cache merged cells so repeated access to the same key doesn't re-clone
  const cache = {};

  const mergedCells = new Proxy(terrainData.cells, {
    get(target, prop) {
      // Non-string props (Symbol.iterator, etc.) pass through
      if (typeof prop !== "string") return target[prop];
      // Only merge cells that have mods
      if (prop in terrainMods) {
        if (!(prop in cache)) {
          cache[prop] = getEffectiveCell(prop, terrainData, terrainMods);
        }
        return cache[prop];
      }
      return target[prop];
    },
    has(target, prop) {
      return prop in target;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc) return desc;
      // For mod-only keys that might not exist in base (shouldn't happen, but safe)
      if (prop in terrainMods && prop in target) {
        return { configurable: true, enumerable: true, value: this.get(target, prop) };
      }
      return undefined;
    }
  });

  return { ...terrainData, cells: mergedCells };
}
