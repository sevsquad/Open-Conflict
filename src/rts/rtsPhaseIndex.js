import { offsetToAxial } from "../mapRenderer/HexMath.js";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";

const DEFAULT_SPATIAL_BUCKET_SIZE = 4;

export function buildRtsPhaseIndex(state, options = {}) {
  const bucketSize = Math.max(1, Number.parseInt(String(options.bucketSize ?? DEFAULT_SPATIAL_BUCKET_SIZE), 10) || DEFAULT_SPATIAL_BUCKET_SIZE);
  const parsePositionCache = new Map();
  const zoneModel = state?.scenario?.zoneModel || null;
  const unitById = new Map();
  const orderIndexByUnitId = new Map();
  const liveUnits = [];
  const liveUnitsByActor = {};
  const enemyUnitsByActor = {};
  const hexByUnitId = new Map();
  const zoneIdByUnitId = new Map();
  const settledPositionByUnitId = new Map();
  const displayPositionByUnitId = new Map();
  const liveUnitsByZoneId = new Map();
  const spatialBuckets = new Map();
  const actorIds = (state?.scenario?.actors || []).map((actor) => actor.id);

  for (const actorId of actorIds) {
    liveUnitsByActor[actorId] = [];
    enemyUnitsByActor[actorId] = [];
  }

  for (let index = 0; index < (state?.units || []).length; index += 1) {
    const unit = state.units[index];
    unitById.set(unit.id, unit);
    orderIndexByUnitId.set(unit.id, index);

    const settledHex = unit?.modeState?.settledHex || unit?.position || null;
    if (settledHex) {
      hexByUnitId.set(unit.id, settledHex);
      const settledPosition = getCachedPosition(parsePositionCache, settledHex);
      if (settledPosition) {
        settledPositionByUnitId.set(unit.id, settledPosition);
      }
      const zoneId = zoneModel?.interiorHexZoneMap?.[settledHex] || zoneModel?.hexZoneMap?.[settledHex] || null;
      if (zoneId) {
        zoneIdByUnitId.set(unit.id, zoneId);
      }
    }

    const displayPosition = computeUnitDisplayPosition(unit, parsePositionCache);
    if (displayPosition) {
      displayPositionByUnitId.set(unit.id, displayPosition);
    }

    if (unit.status === "destroyed" || unit.embarkedIn) continue;
    liveUnits.push(unit);
    if (!liveUnitsByActor[unit.actor]) liveUnitsByActor[unit.actor] = [];
    liveUnitsByActor[unit.actor].push(unit);

    const zoneId = zoneIdByUnitId.get(unit.id) || null;
    if (zoneId) {
      if (!liveUnitsByZoneId.has(zoneId)) {
        liveUnitsByZoneId.set(zoneId, []);
      }
      liveUnitsByZoneId.get(zoneId).push(unit);
    }

    if (!displayPosition) continue;
    const bucketKey = getSpatialBucketKey(displayPosition, bucketSize);
    if (!spatialBuckets.has(bucketKey)) {
      spatialBuckets.set(bucketKey, []);
    }
    spatialBuckets.get(bucketKey).push(unit);
  }

  for (const unit of liveUnits) {
    for (const actorId of actorIds) {
      if (actorId === unit.actor) continue;
      enemyUnitsByActor[actorId].push(unit);
    }
  }

  return {
    bucketSize,
    parsePositionCache,
    unitById,
    orderIndexByUnitId,
    liveUnits,
    liveUnitsByActor,
    enemyUnitsByActor,
    hexByUnitId,
    zoneIdByUnitId,
    settledPositionByUnitId,
    displayPositionByUnitId,
    liveUnitsByZoneId,
    spatialBuckets,
  };
}

export function getIndexedUnit(unitOrId, phaseIndex) {
  if (!phaseIndex?.unitById) return null;
  const unitId = typeof unitOrId === "string" ? unitOrId : unitOrId?.id;
  return unitId ? phaseIndex.unitById.get(unitId) || null : null;
}

export function getIndexedDisplayPosition(unitOrId, phaseIndex) {
  if (!phaseIndex?.displayPositionByUnitId) return null;
  const unitId = typeof unitOrId === "string" ? unitOrId : unitOrId?.id;
  return unitId ? phaseIndex.displayPositionByUnitId.get(unitId) || null : null;
}

export function getIndexedSettledHex(unitOrId, phaseIndex) {
  if (!phaseIndex?.hexByUnitId) return null;
  const unitId = typeof unitOrId === "string" ? unitOrId : unitOrId?.id;
  return unitId ? phaseIndex.hexByUnitId.get(unitId) || null : null;
}

export function getIndexedZoneId(unitOrId, phaseIndex) {
  if (!phaseIndex?.zoneIdByUnitId) return null;
  const unitId = typeof unitOrId === "string" ? unitOrId : unitOrId?.id;
  return unitId ? phaseIndex.zoneIdByUnitId.get(unitId) || null : null;
}

export function sortUnitsByGlobalOrder(units, phaseIndex) {
  if (!Array.isArray(units) || units.length <= 1 || !phaseIndex?.orderIndexByUnitId) return units || [];
  return [...units].sort((left, right) => {
    const leftIndex = phaseIndex.orderIndexByUnitId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = phaseIndex.orderIndexByUnitId.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function collectSpatialCandidateUnits(phaseIndex, origin, radius, predicate = null) {
  if (!phaseIndex?.spatialBuckets || !origin || !Number.isFinite(radius)) return [];
  const minBucketCol = Math.floor((origin.c - radius) / phaseIndex.bucketSize);
  const maxBucketCol = Math.floor((origin.c + radius) / phaseIndex.bucketSize);
  const minBucketRow = Math.floor((origin.r - radius) / phaseIndex.bucketSize);
  const maxBucketRow = Math.floor((origin.r + radius) / phaseIndex.bucketSize);
  const seen = new Set();
  const candidates = [];

  for (let bucketCol = minBucketCol; bucketCol <= maxBucketCol; bucketCol += 1) {
    for (let bucketRow = minBucketRow; bucketRow <= maxBucketRow; bucketRow += 1) {
      const bucket = phaseIndex.spatialBuckets.get(`${bucketCol}:${bucketRow}`) || [];
      for (const unit of bucket) {
        if (seen.has(unit.id)) continue;
        seen.add(unit.id);
        if (predicate && !predicate(unit)) continue;
        candidates.push(unit);
      }
    }
  }

  return sortUnitsByGlobalOrder(candidates, phaseIndex);
}

export function computeUnitDisplayPosition(unit, parsePositionCache = new Map()) {
  const settled = getCachedPosition(parsePositionCache, unit?.modeState?.settledHex || unit?.position || null);
  const travel = unit?.modeState?.travelState;
  if (!settled || !travel || !travel.route || travel.routeIndex <= 0 || travel.routeIndex >= travel.route.length) {
    return settled;
  }
  const from = getCachedPosition(parsePositionCache, travel.route[travel.routeIndex - 1]);
  const to = getCachedPosition(parsePositionCache, travel.route[travel.routeIndex]);
  if (!from || !to) return settled;
  const progress = clamp((travel.progressMs || 0) / Math.max(travel.segmentMs || 1, 1), 0, 1);
  return interpolateOffsetHex(from, to, progress);
}

function getCachedPosition(parsePositionCache, hex) {
  if (!hex) return null;
  if (!parsePositionCache.has(hex)) {
    parsePositionCache.set(hex, parseUnitPosition(hex) || null);
  }
  return parsePositionCache.get(hex);
}

function getSpatialBucketKey(position, bucketSize) {
  return `${Math.floor((position.c ?? position.col) / bucketSize)}:${Math.floor((position.r ?? position.row) / bucketSize)}`;
}

function interpolateOffsetHex(from, to, progress) {
  const axialFrom = offsetToAxial(from.c ?? from.col, from.r ?? from.row);
  const axialTo = offsetToAxial(to.c ?? to.col, to.r ?? to.row);
  const q = axialFrom.q + (axialTo.q - axialFrom.q) * progress;
  const r = axialFrom.r + (axialTo.r - axialFrom.r) * progress;
  const col = q + (r - (Math.round(r) & 1)) / 2;
  return { c: col, r };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
