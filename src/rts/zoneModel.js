import { getNeighbors, hexDistance } from "../mapRenderer/HexMath.js";
import { cellToPositionString, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { AMPHIBIOUS_TERRAIN_COSTS, NAVAL_TERRAIN_COSTS, TERRAIN_COSTS } from "../simulation/orderTypes.js";

const TERRAIN_DEFENSE_SCORES = {
  dense_urban: 0.82,
  urban_dense_core: 0.82,
  light_urban: 0.68,
  suburban: 0.6,
  bldg_light: 0.62,
  bldg_residential: 0.7,
  bldg_commercial: 0.74,
  bldg_highrise: 0.82,
  bldg_institutional: 0.72,
  bldg_industrial: 0.68,
  bldg_fortified: 0.92,
  forest: 0.64,
  dense_forest: 0.8,
  jungle: 0.82,
  jungle_hills: 0.82,
  jungle_mountains: 0.84,
  boreal: 0.62,
  boreal_hills: 0.68,
  mountain: 0.74,
  peak: 0.8,
  mountain_forest: 0.82,
  forested_hills: 0.68,
  trench: 0.84,
};

const REAR_EDGE_DEPTH = 0.25;
const MAX_LANES_PER_EDGE = 3;

export const ZONE_CONTROL_THRESHOLD = 0.65;
export const ZONE_SOURCE_MERGE_RANGE = 4;

export function buildZoneModel(scenarioDraft, terrainData) {
  const objectives = (scenarioDraft?.victoryConditions?.hexVP || scenarioDraft?.objectives?.hexVP || [])
    .filter((objective) => parseUnitPosition(objective?.hex));
  if (!terrainData?.cells || objectives.length === 0) {
    return {
      zones: [],
      zoneGraph: {},
      zoneEdges: [],
      lanes: {},
      zoneMergeMetadata: [],
      objectiveZoneMap: {},
      hexZoneMap: {},
      interiorHexZoneMap: {},
      boundaryHexIds: [],
      boundaryClaims: {},
      actorAnchors: {},
    };
  }

  const { activeSources, mergeMetadata } = mergeObjectiveSources(objectives);
  const zoneSeeds = activeSources.map((source, index) => ({
    zoneId: `zone_${index + 1}`,
    sourceVp: source.sourceVp,
    totalVp: source.totalVp,
    sourceVpIds: [source.sourceObjectiveId],
    memberVpIds: [...source.memberObjectiveIds],
    sourceHex: source.sourceHex,
    sourceName: source.sourceName,
  }));
  const seedByObjectiveId = new Map();
  for (const seed of zoneSeeds) {
    for (const objectiveId of seed.memberVpIds) {
      seedByObjectiveId.set(objectiveId, seed.zoneId);
    }
  }

  const assignment = assignCellsToZones(zoneSeeds, terrainData);
  const zoneById = new Map(zoneSeeds.map((zone) => [zone.zoneId, {
    ...zone,
    hexIds: [],
    coreHexIds: [],
    borderHexIds: [],
    adjacentZoneIds: [],
    crossings: [],
      terrainEnvelope: null,
  }]));

  for (const [hex, zoneId] of Object.entries(assignment.interiorHexZoneMap)) {
    const zone = zoneById.get(zoneId);
    if (zone) {
      zone.hexIds.push(hex);
    }
  }

  const zoneHexSets = new Map([...zoneById.entries()].map(([zoneId, zone]) => [zoneId, new Set(zone.hexIds)]));
  const edgeAccumulator = new Map();
  const ensureEdgeAccumulator = (zoneIdA, zoneIdB) => {
    const edgeId = makeEdgeId(zoneIdA, zoneIdB);
    if (!edgeAccumulator.has(edgeId)) {
      edgeAccumulator.set(edgeId, {
        edgeId,
        zoneA: [zoneIdA, zoneIdB].sort()[0],
        zoneB: [zoneIdA, zoneIdB].sort()[1],
        pairs: [],
        pairKeys: new Set(),
        edgeHexSet: new Set(),
        crossingHexSet: new Set(),
      });
    }
    return edgeAccumulator.get(edgeId);
  };
  const addEdgePair = (zoneIdA, zoneIdB, zoneAHex, zoneBHex, boundaryHex = null) => {
    if (!zoneIdA || !zoneIdB || zoneIdA === zoneIdB || !zoneAHex || !zoneBHex) return;
    const edge = ensureEdgeAccumulator(zoneIdA, zoneIdB);
    const key = `${zoneAHex}|${boundaryHex || "-"}|${zoneBHex}`;
    if (edge.pairKeys.has(key)) return;
    edge.pairKeys.add(key);
    edge.pairs.push({
      zoneAHex,
      zoneBHex,
      boundaryHexes: boundaryHex ? [boundaryHex] : [],
    });
    edge.edgeHexSet.add(zoneAHex);
    edge.edgeHexSet.add(zoneBHex);
    if (boundaryHex) {
      edge.edgeHexSet.add(boundaryHex);
    }
    if (
      isCrossingCell(terrainData?.cells?.[zoneAHex])
      || isCrossingCell(terrainData?.cells?.[zoneBHex])
      || isCrossingCell(terrainData?.cells?.[boundaryHex])
    ) {
      edge.crossingHexSet.add(zoneAHex);
      edge.crossingHexSet.add(zoneBHex);
      if (boundaryHex) {
        edge.crossingHexSet.add(boundaryHex);
      }
    }
  };

  for (const zone of zoneById.values()) {
    const adjacency = new Set();
    const borders = new Set();
    for (const hex of zone.hexIds) {
      const pos = parseUnitPosition(hex);
      if (!pos) continue;
      let touchesBoundary = false;
      for (const [neighborCol, neighborRow] of getNeighbors(pos.c, pos.r)) {
        const neighborHex = cellToPositionString(neighborCol, neighborRow);
        const neighborZoneId = assignment.interiorHexZoneMap[neighborHex];
        const boundaryClaimants = assignment.boundaryClaims?.[neighborHex] || [];
        if (!neighborZoneId || neighborZoneId !== zone.zoneId) {
          touchesBoundary = true;
        }
        if (neighborZoneId && neighborZoneId !== zone.zoneId) {
          adjacency.add(neighborZoneId);
          addEdgePair(zone.zoneId, neighborZoneId, zone.zoneId === [zone.zoneId, neighborZoneId].sort()[0] ? hex : neighborHex, zone.zoneId === [zone.zoneId, neighborZoneId].sort()[0] ? neighborHex : hex);
        }
        if (boundaryClaimants.includes(zone.zoneId)) {
          for (const claimant of boundaryClaimants) {
            if (claimant && claimant !== zone.zoneId) {
              adjacency.add(claimant);
            }
          }
        }
      }
      if (touchesBoundary) {
        borders.add(hex);
      }
    }
    zone.borderHexIds = [...borders].sort();
    zone.adjacentZoneIds = [...adjacency].sort();
    zone.coreHexIds = computeCoreHexes(zone, terrainData);
    zone.crossings = zone.borderHexIds.filter((hex) => isCrossingCell(terrainData?.cells?.[hex]));
    zone.terrainEnvelope = computeTerrainEnvelope(zone.hexIds, terrainData);
  }

  for (const boundaryHex of assignment.boundaryHexIds || []) {
    const claims = [...(assignment.boundaryClaims?.[boundaryHex] || [])].sort();
    if (claims.length < 2) continue;
    const pos = parseUnitPosition(boundaryHex);
    if (!pos) continue;
    const neighborsByZone = {};
    for (const [neighborCol, neighborRow] of getNeighbors(pos.c, pos.r)) {
      const neighborHex = cellToPositionString(neighborCol, neighborRow);
      const neighborZoneId = assignment.interiorHexZoneMap?.[neighborHex];
      if (!neighborZoneId || !claims.includes(neighborZoneId)) continue;
      if (!neighborsByZone[neighborZoneId]) {
        neighborsByZone[neighborZoneId] = new Set();
      }
      neighborsByZone[neighborZoneId].add(neighborHex);
    }
    for (let index = 0; index < claims.length; index += 1) {
      for (let inner = index + 1; inner < claims.length; inner += 1) {
        const leftZoneId = claims[index];
        const rightZoneId = claims[inner];
        const leftHexes = [...(neighborsByZone[leftZoneId] || [])];
        const rightHexes = [...(neighborsByZone[rightZoneId] || [])];
        for (const leftHex of leftHexes) {
          for (const rightHex of rightHexes) {
            addEdgePair(leftZoneId, rightZoneId, leftHex, rightHex, boundaryHex);
          }
        }
      }
    }
  }

  const lanes = {};
  const zoneEdges = [...edgeAccumulator.values()]
    .map((edge) => {
      const laneDefs = buildEdgeLanes(edge, zoneById, zoneHexSets, terrainData);
      for (const lane of laneDefs) {
        lanes[lane.laneId] = lane;
      }
      const edgeHexIds = [...edge.edgeHexSet].sort();
      const crossingHexIds = [...edge.crossingHexSet].sort();
      const terrainEnvelope = computeTerrainEnvelope(edgeHexIds, terrainData);
      const frontageWidthScore = clamp(edgeHexIds.length / 8, 0.18, 1);
      const congestionSensitivity = clamp(1 - frontageWidthScore + (crossingHexIds.length > 0 ? 0.18 : 0), 0.2, 1.4);
      const supportValue = computeEdgeSupportValue(terrainEnvelope, zoneById.get(edge.zoneA), zoneById.get(edge.zoneB));
      return {
        edgeId: edge.edgeId,
        zoneA: edge.zoneA,
        zoneB: edge.zoneB,
        edgeHexIds,
        crossingHexIds,
        laneIds: laneDefs.map((lane) => lane.laneId),
        terrainEnvelope,
        frontageWidthScore,
        congestionSensitivity,
        supportValue,
      };
    })
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));

  const objectiveZoneMap = Object.fromEntries(objectives.map((objective) => [
    objective.hex,
    seedByObjectiveId.get(objective.hex) || null,
  ]));

  const zones = [...zoneById.values()]
    .map((zone) => ({
      ...zone,
      centroidHex: computeZoneCentroidHex(zone.hexIds),
    }))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));

  const zoneGraph = Object.fromEntries(zones.map((zone) => [
    zone.zoneId,
    zone.adjacentZoneIds.map((neighborId) => {
      const edgeId = makeEdgeId(zone.zoneId, neighborId);
      return {
        zoneId: neighborId,
        edgeId,
        laneIds: zoneEdges.find((edge) => edge.edgeId === edgeId)?.laneIds || [],
      };
    }),
  ]));

  const actorAnchors = buildActorAnchors(scenarioDraft?.actors || [], scenarioDraft?.units || [], zones, assignment.hexZoneMap, terrainData);
  const vpZoneOutlines = buildVpZoneOutlinesFromZones(zones);

  return {
    zones,
    zoneGraph,
    zoneEdges,
    lanes,
    zoneMergeMetadata: mergeMetadata,
    objectiveZoneMap,
    hexZoneMap: assignment.hexZoneMap,
    interiorHexZoneMap: assignment.interiorHexZoneMap,
    boundaryHexIds: assignment.boundaryHexIds,
    boundaryClaims: assignment.boundaryClaims,
    actorAnchors,
    vpZoneOutlines,
  };
}

export function getZoneById(zoneModel, zoneId) {
  return (zoneModel?.zones || []).find((zone) => zone.zoneId === zoneId) || null;
}

export function getEdgeById(zoneModel, edgeId) {
  return (zoneModel?.zoneEdges || []).find((edge) => edge.edgeId === edgeId) || null;
}

export function getLaneById(zoneModel, laneId) {
  return zoneModel?.lanes?.[laneId] || null;
}

export function resolveLaneTraversal(zoneModel, laneId, fromZoneId, toZoneId) {
  const lane = getLaneById(zoneModel, laneId);
  if (!lane) return null;
  const endpoints = lane.endpointHexesByZone || {};
  const resolvedFromZoneId = fromZoneId && endpoints[fromZoneId] ? fromZoneId : lane.zoneIds?.find((zoneId) => endpoints[zoneId]) || null;
  const resolvedToZoneId = toZoneId && endpoints[toZoneId]
    ? toZoneId
    : lane.zoneIds?.find((zoneId) => zoneId !== resolvedFromZoneId && endpoints[zoneId]) || null;
  return {
    ...lane,
    fromZoneId: resolvedFromZoneId,
    toZoneId: resolvedToZoneId,
    ingressHex: resolvedFromZoneId ? endpoints[resolvedFromZoneId] || null : null,
    egressHex: resolvedToZoneId ? endpoints[resolvedToZoneId] || null : null,
    isDirectionalValid: Boolean(resolvedFromZoneId && resolvedToZoneId && endpoints[resolvedFromZoneId] && endpoints[resolvedToZoneId]),
  };
}

export function getZoneIdForHex(zoneModel, hex) {
  return zoneModel?.hexZoneMap?.[hex] || null;
}

export function getObjectiveZoneId(zoneModel, objectiveHex) {
  return zoneModel?.objectiveZoneMap?.[objectiveHex] || null;
}

export function getZonesForActorAnchors(zoneModel, actorId) {
  return zoneModel?.actorAnchors?.[actorId]?.startZoneIds || [];
}

export function buildVpZoneOutlines(zoneModel) {
  if (Array.isArray(zoneModel?.vpZoneOutlines) && zoneModel.vpZoneOutlines.length > 0) {
    return zoneModel.vpZoneOutlines;
  }
  return buildVpZoneOutlinesFromZones(zoneModel?.zones || []);
}

export function terrainCategoryForCell(cell) {
  const terrain = cell?.terrain || "open_ground";
  if (terrain.includes("urban") || terrain.startsWith("bldg_") || terrain === "suburban") return "urban";
  if (terrain.includes("forest") || terrain.includes("jungle") || terrain === "dense_forest" || terrain.includes("boreal")) return "forest";
  if (terrain.includes("mountain") || terrain === "peak" || terrain === "highland" || terrain === "forested_hills" || terrain.includes("hills")) return "rough";
  if (terrain.includes("wet") || terrain === "wetland" || terrain === "mangrove" || terrain === "canal") return "wet";
  if (terrain.includes("water") || terrain === "lake" || terrain === "dock") return "water";
  return "open";
}

export function mobilityScoreForCell(cell, movementType) {
  if (!cell) return 0.5;
  const terrain = cell.terrain || "open_ground";
  let cost = TERRAIN_COSTS[terrain] ?? 1;
  if (movementType === "naval") {
    cost = NAVAL_TERRAIN_COSTS[terrain] ?? 999;
  } else if (movementType === "amphibious") {
    cost = AMPHIBIOUS_TERRAIN_COSTS[terrain] ?? (TERRAIN_COSTS[terrain] ?? 1.5);
  } else if (movementType === "helicopter") {
    return 0.92;
  }
  const features = cell.features || [];
  if (features.some((feature) => feature === "highway" || feature === "major_road" || feature === "road")) {
    cost *= movementType === "wheeled" ? 0.55 : movementType === "tracked" ? 0.72 : 0.84;
  }
  if (features.includes("river") && !features.includes("bridge") && !features.includes("river_crossing")) {
    cost += 1.4;
  }
  return clamp(1 / Math.max(cost, 0.25), 0.05, 1);
}

function mergeObjectiveSources(objectives) {
  const active = new Map(objectives.map((objective) => [objective.hex, {
    sourceObjectiveId: objective.hex,
    sourceHex: objective.hex,
    sourceName: objective.name || objective.hex,
    sourceVp: objective.vp || 10,
    totalVp: objective.vp || 10,
    memberObjectiveIds: [objective.hex],
  }]));
  const mergeMetadata = [];
  let changed = true;
  while (changed) {
    changed = false;
    const activeSources = [...active.values()];
    const pairs = [];
    for (let index = 0; index < activeSources.length; index += 1) {
      for (let inner = index + 1; inner < activeSources.length; inner += 1) {
        const left = parseUnitPosition(activeSources[index].sourceHex);
        const right = parseUnitPosition(activeSources[inner].sourceHex);
        if (!left || !right) continue;
        const distance = hexDistance(left.c, left.r, right.c, right.r);
        if (distance > ZONE_SOURCE_MERGE_RANGE) continue;
        if (isOccludedMergePair(activeSources[index], activeSources[inner], activeSources, distance)) continue;
        pairs.push({
          distance,
          left: activeSources[index],
          right: activeSources[inner],
        });
      }
    }
    pairs.sort((left, right) => (
      left.distance - right.distance
      || right.left.sourceVp - left.left.sourceVp
      || right.right.sourceVp - left.right.sourceVp
      || left.left.sourceObjectiveId.localeCompare(right.left.sourceObjectiveId)
      || left.right.sourceObjectiveId.localeCompare(right.right.sourceObjectiveId)
    ));
    for (const pair of pairs) {
      const left = active.get(pair.left.sourceObjectiveId);
      const right = active.get(pair.right.sourceObjectiveId);
      if (!left || !right) continue;
      if (left.sourceVp === right.sourceVp) continue;
      const aggressor = left.sourceVp > right.sourceVp ? left : right;
      const defender = aggressor === left ? right : left;
      if (aggressor.sourceVp <= defender.totalVp) continue;
      aggressor.totalVp += defender.totalVp;
      aggressor.memberObjectiveIds = [...new Set([...aggressor.memberObjectiveIds, ...defender.memberObjectiveIds])];
      active.delete(defender.sourceObjectiveId);
      mergeMetadata.push({
        distance: pair.distance,
        aggressorSourceId: aggressor.sourceObjectiveId,
        defenderSourceId: defender.sourceObjectiveId,
        aggressorSourceVp: aggressor.sourceVp,
        defenderTotalVp: defender.totalVp,
        resultingZoneTotalVp: aggressor.totalVp,
      });
      changed = true;
      break;
    }
  }
  return {
    activeSources: [...active.values()],
    mergeMetadata,
  };
}

function assignCellsToZones(zoneSeeds, terrainData) {
  const hexZoneMap = {};
  const interiorHexZoneMap = {};
  const boundaryClaims = {};
  const boundaryHexIds = [];
  for (const hex of Object.keys(terrainData?.cells || {})) {
    const pos = parseUnitPosition(hex);
    if (!pos) continue;
    let bestDistance = Infinity;
    const contenders = [];
    for (const zone of zoneSeeds) {
      const sourcePos = parseUnitPosition(zone.sourceHex);
      if (!sourcePos) continue;
      const distance = hexDistance(pos.c, pos.r, sourcePos.c, sourcePos.r);
      if (distance < bestDistance) {
        bestDistance = distance;
        contenders.length = 0;
        contenders.push(zone.zoneId);
      } else if (distance === bestDistance) {
        contenders.push(zone.zoneId);
      }
    }
    if (contenders.length === 0) continue;
    const sortedContenders = [...new Set(contenders)].sort();
    hexZoneMap[hex] = sortedContenders[0];
    if (sortedContenders.length === 1) {
      interiorHexZoneMap[hex] = sortedContenders[0];
    } else {
      boundaryClaims[hex] = sortedContenders;
      boundaryHexIds.push(hex);
    }
  }
  boundaryHexIds.sort();
  return { hexZoneMap, interiorHexZoneMap, boundaryHexIds, boundaryClaims };
}

function isOccludedMergePair(leftSource, rightSource, activeSources, pairDistance) {
  const left = parseUnitPosition(leftSource?.sourceHex);
  const right = parseUnitPosition(rightSource?.sourceHex);
  if (!left || !right) return false;
  return (activeSources || []).some((candidate) => {
    if (!candidate) {
      return false;
    }
    return (candidate.memberObjectiveIds || [candidate.sourceObjectiveId]).some((memberHex) => {
      if (!memberHex || memberHex === leftSource.sourceObjectiveId || memberHex === rightSource.sourceObjectiveId) {
        return false;
      }
      const middle = parseUnitPosition(memberHex);
      if (!middle) return false;
      const leftDistance = hexDistance(left.c, left.r, middle.c, middle.r);
      const rightDistance = hexDistance(right.c, right.r, middle.c, middle.r);
      return leftDistance < pairDistance
        && rightDistance < pairDistance
        && (leftDistance + rightDistance) === pairDistance;
    });
  });
}

function buildEdgeLanes(edge, zoneById, zoneHexSets, terrainData) {
  const groupedPairs = [];
  const sortedPairs = [...edge.pairs].sort((left, right) => left.zoneAHex.localeCompare(right.zoneAHex) || left.zoneBHex.localeCompare(right.zoneBHex));
  for (const pair of sortedPairs) {
    const zoneAPos = parseUnitPosition(pair.zoneAHex);
    const zoneBPos = parseUnitPosition(pair.zoneBHex);
    if (!zoneAPos || !zoneBPos) continue;
    let bucket = groupedPairs.find((cluster) => {
      const pivotA = parseUnitPosition(cluster.pairs[0]?.zoneAHex);
      const pivotB = parseUnitPosition(cluster.pairs[0]?.zoneBHex);
      return pivotA && pivotB
        && hexDistance(zoneAPos.c, zoneAPos.r, pivotA.c, pivotA.r) <= 2
        && hexDistance(zoneBPos.c, zoneBPos.r, pivotB.c, pivotB.r) <= 2;
    });
    if (!bucket) {
      bucket = { pairs: [] };
      groupedPairs.push(bucket);
    }
    bucket.pairs.push(pair);
  }

  const zoneA = zoneById.get(edge.zoneA);
  const zoneB = zoneById.get(edge.zoneB);
  const zoneASet = zoneHexSets?.get(edge.zoneA) || new Set();
  const zoneBSet = zoneHexSets?.get(edge.zoneB) || new Set();
  return groupedPairs
    .sort((left, right) => right.pairs.length - left.pairs.length)
    .slice(0, MAX_LANES_PER_EDGE)
    .map((cluster, index) => {
      const laneHexes = Array.from(new Set(cluster.pairs.flatMap((pair) => [pair.zoneAHex, ...(pair.boundaryHexes || []), pair.zoneBHex]))).sort();
      const endpointHexesByZone = {
        [edge.zoneA]: repairLaneEndpoint(cluster.pairs.map((pair) => pair.zoneAHex), zoneA, zoneASet, laneHexes),
        [edge.zoneB]: repairLaneEndpoint(cluster.pairs.map((pair) => pair.zoneBHex), zoneB, zoneBSet, laneHexes),
      };
      const midpointHex = selectLaneMidpointHex(cluster.pairs, endpointHexesByZone[edge.zoneA], endpointHexesByZone[edge.zoneB]);
      const terrainEnvelope = computeTerrainEnvelope(laneHexes, terrainData);
      const throughputScore = clamp((cluster.pairs.length / 4) + terrainEnvelope.roadAccess * 0.35 + terrainEnvelope.mobilityScoreByMovementType.wheeled * 0.2 - terrainEnvelope.crossingRisk * 0.4, 0.1, 1);
      return {
        laneId: `${edge.edgeId}_lane_${index + 1}`,
        edgeId: edge.edgeId,
        zoneIds: [edge.zoneA, edge.zoneB],
        endpointHexesByZone,
        midpointHex,
        laneHexIds: laneHexes,
        throughputScore,
        terrainEnvelope,
        crossingRisk: terrainEnvelope.crossingRisk,
      };
    });
}

function repairLaneEndpoint(candidates, zone, zoneHexSet, laneHexes) {
  const uniqueCandidates = Array.from(new Set((candidates || []).filter((hex) => zoneHexSet.has(hex))));
  if (uniqueCandidates.length > 0) {
    return uniqueCandidates[Math.floor(uniqueCandidates.length / 2)];
  }
  const lanePositions = (laneHexes || []).map((hex) => parseUnitPosition(hex)).filter(Boolean);
  const searchPool = [...(zone?.borderHexIds || []), ...(zone?.coreHexIds || []), ...(zone?.hexIds || [])];
  let bestHex = zone?.centroidHex || zone?.sourceHex || null;
  let bestDistance = Infinity;
  for (const hex of searchPool) {
    const pos = parseUnitPosition(hex);
    if (!pos) continue;
    const distance = lanePositions.length > 0
      ? Math.min(...lanePositions.map((lanePos) => hexDistance(pos.c, pos.r, lanePos.c, lanePos.r)))
      : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHex = hex;
    }
  }
  return bestHex;
}

function selectLaneMidpointHex(pairs, fallbackA, fallbackB) {
  const boundaryHexes = Array.from(new Set((pairs || []).flatMap((pair) => pair.boundaryHexes || []))).sort();
  if (boundaryHexes.length > 0) {
    return boundaryHexes[Math.floor(boundaryHexes.length / 2)];
  }
  return fallbackA || fallbackB || null;
}

function computeCoreHexes(zone, terrainData) {
  const sourcePos = parseUnitPosition(zone.sourceHex);
  if (!sourcePos) return [];
  return zone.hexIds.filter((hex) => {
    const pos = parseUnitPosition(hex);
    if (!pos) return false;
    return hexDistance(pos.c, pos.r, sourcePos.c, sourcePos.r) <= 2;
  }).sort();
}

function computeTerrainEnvelope(hexIds, terrainData) {
  const cells = (hexIds || [])
    .map((hex) => terrainData?.cells?.[hex])
    .filter(Boolean);
  if (cells.length === 0) {
    return {
      coverScore: 0.5,
      concealmentScore: 0.5,
      mobilityScoreByMovementType: {
        foot: 0.5,
        wheeled: 0.5,
        tracked: 0.5,
        helicopter: 0.92,
      },
      elevationAdvantage: 0.5,
      openFireLaneScore: 0.5,
      crossingRisk: 0,
      urbanity: 0,
      forestDensity: 0,
      roadAccess: 0,
      artillerySafety: 0.5,
      heloLandingSuitability: 0.5,
    };
  }

  const elevations = cells.map((cell) => Number(cell.elevation) || 0);
  const minElevation = Math.min(...elevations);
  const maxElevation = Math.max(...elevations);
  const elevationSpread = Math.max(1, maxElevation - minElevation);
  let coverScore = 0;
  let concealmentScore = 0;
  let urbanity = 0;
  let forestDensity = 0;
  let openScore = 0;
  let roadAccess = 0;
  let crossingCount = 0;
  let artillerySafety = 0;
  let heloLanding = 0;
  const mobility = {
    foot: 0,
    wheeled: 0,
    tracked: 0,
    helicopter: 0,
  };

  for (const cell of cells) {
    const terrain = cell.terrain || "open_ground";
    const category = terrainCategoryForCell(cell);
    const features = cell.features || [];
    coverScore += TERRAIN_DEFENSE_SCORES[terrain] ?? (category === "urban" ? 0.62 : category === "forest" ? 0.58 : category === "rough" ? 0.52 : 0.32);
    concealmentScore += category === "forest" ? 0.82 : category === "urban" ? 0.64 : category === "rough" ? 0.46 : 0.28;
    urbanity += category === "urban" ? 1 : 0;
    forestDensity += category === "forest" ? 1 : 0;
    openScore += category === "open" ? 1 : 0;
    roadAccess += features.some((feature) => feature === "highway" || feature === "major_road" || feature === "road" || feature === "railway") ? 1 : 0;
    crossingCount += isCrossingCell(cell) ? 1 : 0;
    mobility.foot += mobilityScoreForCell(cell, "foot");
    mobility.wheeled += mobilityScoreForCell(cell, "wheeled");
    mobility.tracked += mobilityScoreForCell(cell, "tracked");
    mobility.helicopter += mobilityScoreForCell(cell, "helicopter");
    artillerySafety += clamp((TERRAIN_DEFENSE_SCORES[terrain] ?? 0.3) + (category === "forest" ? 0.18 : 0) + (category === "urban" ? 0.15 : 0) - (category === "open" ? 0.12 : 0), 0.05, 1);
    heloLanding += clamp(
      (category === "open" ? 0.82 : category === "urban" ? 0.3 : category === "forest" ? 0.28 : 0.54)
      + (features.includes("airfield") ? 0.2 : 0)
      - (features.includes("power_plant") || features.includes("building_dense") ? 0.18 : 0),
      0.05,
      1
    );
  }

  return {
    coverScore: roundMetric(coverScore / cells.length),
    concealmentScore: roundMetric(concealmentScore / cells.length),
    mobilityScoreByMovementType: {
      foot: roundMetric(mobility.foot / cells.length),
      wheeled: roundMetric(mobility.wheeled / cells.length),
      tracked: roundMetric(mobility.tracked / cells.length),
      helicopter: roundMetric(mobility.helicopter / cells.length),
    },
    elevationAdvantage: roundMetric(clamp((maxElevation - minElevation) / Math.max(elevationSpread + 200, 200), 0.1, 1)),
    openFireLaneScore: roundMetric(clamp((openScore / cells.length) + (roadAccess / cells.length) * 0.15, 0.05, 1)),
    crossingRisk: roundMetric(clamp(crossingCount / Math.max(cells.length, 1), 0, 1)),
    urbanity: roundMetric(urbanity / cells.length),
    forestDensity: roundMetric(forestDensity / cells.length),
    roadAccess: roundMetric(roadAccess / cells.length),
    artillerySafety: roundMetric(artillerySafety / cells.length),
    heloLandingSuitability: roundMetric(heloLanding / cells.length),
  };
}

function computeEdgeSupportValue(terrainEnvelope, zoneA, zoneB) {
  const zoneVp = Math.max(zoneA?.totalVp || 0, zoneB?.totalVp || 0);
  const postureValue = (terrainEnvelope.elevationAdvantage * 0.3)
    + (terrainEnvelope.openFireLaneScore * 0.28)
    + (terrainEnvelope.coverScore * 0.18)
    + (terrainEnvelope.concealmentScore * 0.14)
    + (terrainEnvelope.roadAccess * 0.1);
  return roundMetric(postureValue * Math.max(1, zoneVp / 20));
}

function buildActorAnchors(actors, units, zones, hexZoneMap, terrainData) {
  const zoneIdsByActor = {};
  for (const actor of actors || []) {
    const actorUnits = (units || []).filter((unit) => unit.actor === actor.id);
    const homeEdge = inferHomeEdge(actorUnits, terrainData);
    const preferredUnits = actorUnits.filter((unit) => unit.type === "headquarters" || unit.type === "logistics");
    const seedUnits = preferredUnits.length > 0 ? preferredUnits : actorUnits;
    const startZoneIds = Array.from(new Set(seedUnits
      .map((unit) => hexZoneMap[unit.position || ""])
      .filter(Boolean)));
    zoneIdsByActor[actor.id] = {
      homeEdge,
      startZoneIds: startZoneIds.length > 0 ? startZoneIds : inferRearZonesForEdge(homeEdge, zones, terrainData),
    };
  }
  return zoneIdsByActor;
}

function buildVpZoneOutlinesFromZones(zones) {
  return (zones || [])
    .filter((zone) => (zone?.memberVpIds?.length || zone?.sourceVpIds?.length || 0) > 0)
    .map((zone) => ({
      zoneId: zone.zoneId,
      objectiveHexes: Array.from(new Set([...(zone.memberVpIds || []), ...(zone.sourceVpIds || [])])).filter(Boolean),
      centroidHex: zone.centroidHex || zone.sourceHex || null,
      segments: computeZonePerimeterSegments(zone),
    }));
}

function computeZonePerimeterSegments(zone) {
  const hexSet = new Set(zone?.hexIds || []);
  const segments = [];
  for (const hex of hexSet) {
    const pos = parseUnitPosition(hex);
    if (!pos) continue;
    const neighbors = getNeighbors(pos.c, pos.r);
    for (let edge = 0; edge < neighbors.length; edge += 1) {
      const [neighborCol, neighborRow] = neighbors[edge];
      const neighborHex = cellToPositionString(neighborCol, neighborRow);
      if (hexSet.has(neighborHex)) continue;
      segments.push({ hex, edge });
    }
  }
  return segments;
}

function inferHomeEdge(actorUnits, terrainData) {
  if (!Array.isArray(actorUnits) || actorUnits.length === 0) return "west";
  const positions = actorUnits
    .map((unit) => parseUnitPosition(unit.position || ""))
    .filter(Boolean);
  if (positions.length === 0) return "west";
  const avgCol = positions.reduce((sum, pos) => sum + pos.c, 0) / positions.length;
  const avgRow = positions.reduce((sum, pos) => sum + pos.r, 0) / positions.length;
  const cols = Math.max(1, terrainData?.cols || 1);
  const rows = Math.max(1, terrainData?.rows || 1);
  const horizontalBias = Math.abs((avgCol / cols) - 0.5);
  const verticalBias = Math.abs((avgRow / rows) - 0.5);
  if (horizontalBias >= verticalBias) {
    return avgCol <= cols / 2 ? "west" : "east";
  }
  return avgRow <= rows / 2 ? "north" : "south";
}

function inferRearZonesForEdge(homeEdge, zones, terrainData) {
  const cols = Math.max(1, terrainData?.cols || 1);
  const rows = Math.max(1, terrainData?.rows || 1);
  const cutoffCol = Math.round(cols * REAR_EDGE_DEPTH);
  const cutoffRow = Math.round(rows * REAR_EDGE_DEPTH);
  return (zones || [])
    .filter((zone) => {
      const centroid = parseUnitPosition(zone.centroidHex || zone.sourceHex);
      if (!centroid) return false;
      switch (homeEdge) {
        case "east":
          return centroid.c >= (cols - cutoffCol);
        case "north":
          return centroid.r <= cutoffRow;
        case "south":
          return centroid.r >= (rows - cutoffRow);
        case "west":
        default:
          return centroid.c <= cutoffCol;
      }
    })
    .map((zone) => zone.zoneId);
}

function computeZoneCentroidHex(hexIds) {
  const positions = (hexIds || []).map((hex) => parseUnitPosition(hex)).filter(Boolean);
  if (positions.length === 0) return null;
  const avgCol = positions.reduce((sum, pos) => sum + pos.c, 0) / positions.length;
  const avgRow = positions.reduce((sum, pos) => sum + pos.r, 0) / positions.length;
  return cellToPositionString(Math.round(avgCol), Math.round(avgRow));
}

function isCrossingCell(cell) {
  const features = cell?.features || [];
  return features.includes("bridge")
    || features.includes("river_crossing")
    || features.includes("stream_crossing")
    || (features.includes("river") && features.includes("dam"));
}

function makeEdgeId(zoneA, zoneB) {
  return [zoneA, zoneB].sort().join("__");
}

function roundMetric(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
