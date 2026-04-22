import { getNeighbors, hexDistance } from "../mapRenderer/HexMath.js";
import {
  TERRAIN_COSTS,
  NAVAL_TERRAIN_COSTS,
  AMPHIBIOUS_TERRAIN_COSTS,
  MOVEMENT_BUDGETS,
} from "./orderTypes.js";
import { parsePosition } from "./prompts.js";

function keyOf(pos) {
  return `${pos.col},${pos.row}`;
}

function parsePos(pos) {
  if (!pos) return null;
  if (typeof pos === "string") return parsePosition(pos);
  if (typeof pos === "object" && Number.isFinite(pos.col) && Number.isFinite(pos.row)) {
    return { col: pos.col, row: pos.row };
  }
  return null;
}

function terrainCategory(cell) {
  const terrain = cell?.terrain || "open_ground";
  if (terrain.includes("urban") || terrain.startsWith("bldg_") || terrain === "suburban") return "urban";
  if (terrain.includes("forest") || terrain.includes("jungle") || terrain === "dense_forest") return "forest";
  if (terrain.includes("mountain") || terrain === "peak" || terrain === "highland" || terrain === "forested_hills") return "rough";
  if (terrain.includes("wet") || terrain === "wetland" || terrain === "mangrove") return "wet";
  if (terrain.includes("water") || terrain === "lake" || terrain === "canal" || terrain === "dock") return "water";
  return "open";
}

function getTerrainCostForMovement(terrain, movementType) {
  if (movementType === "naval") {
    return NAVAL_TERRAIN_COSTS[terrain] ?? 999;
  }
  if (movementType === "amphibious") {
    if (terrain in NAVAL_TERRAIN_COSTS) {
      return AMPHIBIOUS_TERRAIN_COSTS[terrain] ?? (NAVAL_TERRAIN_COSTS[terrain] * 1.5);
    }
    return (TERRAIN_COSTS[terrain] ?? 1.0) * 1.5;
  }
  return TERRAIN_COSTS[terrain] ?? 1.0;
}

function roadDiscountFor(movementType) {
  if (movementType === "wheeled") return 0.5;
  if (movementType === "tracked") return 0.7;
  return 0.8;
}

function computeStepCost(fromPos, toPos, terrainData, movementType, profile, threatMap) {
  const cell = terrainData?.cells?.[keyOf(toPos)];
  const terrain = cell?.terrain || "open_ground";
  const features = cell?.features || [];
  let cost = getTerrainCostForMovement(terrain, movementType);
  if (cost >= 999) return Infinity;

  const hasRoad = features.some((feature) => feature === "highway" || feature === "major_road" || feature === "road");
  if (hasRoad) {
    cost = Math.min(cost, roadDiscountFor(movementType));
  }

  const riverish = features.includes("river") || features.includes("river_crossing");
  if (riverish && !features.includes("bridge")) {
    cost += 1.75;
  }
  if (features.includes("bridge")) {
    cost -= 0.2;
  }
  if (features.includes("obstacle")) {
    cost += 1.5;
  }
  if (features.includes("dam")) {
    cost += 0.5;
  }

  const category = terrainCategory(cell);
  const terrainBias = profile?.terrainPreferences?.[category] || 0;
  cost *= Math.max(0.35, 1 - terrainBias);

  const threat = threatMap?.[keyOf(toPos)] || 0;
  cost += threat * (profile?.threatPenalty || 1);

  const elevationFrom = terrainData?.cells?.[keyOf(fromPos)]?.elevation ?? 0;
  const elevationTo = cell?.elevation ?? 0;
  if (elevationTo > elevationFrom + 100) {
    cost += 0.3;
  }

  return Math.max(0.15, cost);
}

function movementBudgetFor(unit) {
  return MOVEMENT_BUDGETS[unit?.movementType || "foot"] ?? 3;
}

export function buildThreatMap(actorId, gameState, terrainData, enemyUnits, profile) {
  const threatMap = {};
  const cols = terrainData?.cols || 0;
  const rows = terrainData?.rows || 0;

  for (const enemy of enemyUnits) {
    const pos = parsePos(enemy.position);
    if (!pos) continue;
    const combatPower = Math.max(0.2, (enemy.strength ?? 100) / 100) * (
      enemy.type === "armor" ? 2.1
        : enemy.type === "artillery" ? 1.8
        : enemy.type === "air_defense" ? 1.2
        : enemy.type === "recon" ? 0.8
        : 1.0
    );
    const radius = enemy.type === "artillery" ? 7 : enemy.type === "armor" ? 4 : 3;
    for (let row = Math.max(0, pos.row - radius); row <= Math.min(rows - 1, pos.row + radius); row += 1) {
      for (let col = Math.max(0, pos.col - radius); col <= Math.min(cols - 1, pos.col + radius); col += 1) {
        const distance = hexDistance(pos.col, pos.row, col, row);
        if (distance > radius) continue;
        const attenuation = 1 / (distance + 1);
        const key = `${col},${row}`;
        threatMap[key] = (threatMap[key] || 0) + (combatPower * attenuation * (profile?.dangerTolerance ? (1 - (profile.dangerTolerance * 0.4)) : 1));
      }
    }
  }

  return threatMap;
}

export function findWeightedPath(fromPos, toPos, terrainData, movementType, profile, threatMap) {
  const start = parsePos(fromPos);
  const goal = parsePos(toPos);
  if (!start || !goal) return null;
  if (start.col === goal.col && start.row === goal.row) return [start];

  const open = new Map([[keyOf(start), { pos: start, g: 0, f: 0 }]]);
  const cameFrom = new Map();
  const gScore = new Map([[keyOf(start), 0]]);
  const closed = new Set();

  while (open.size > 0) {
    let current = null;
    for (const candidate of open.values()) {
      if (!current || candidate.f < current.f) current = candidate;
    }
    if (!current) break;

    const currentKey = keyOf(current.pos);
    if (current.pos.col === goal.col && current.pos.row === goal.row) {
      const path = [current.pos];
      let traceKey = currentKey;
      while (cameFrom.has(traceKey)) {
        const prev = cameFrom.get(traceKey);
        path.unshift(prev);
        traceKey = keyOf(prev);
      }
      return path;
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const [nextCol, nextRow] of getNeighbors(current.pos.col, current.pos.row)) {
      if (nextCol < 0 || nextCol >= (terrainData?.cols || 0) || nextRow < 0 || nextRow >= (terrainData?.rows || 0)) continue;
      const nextPos = { col: nextCol, row: nextRow };
      const nextKey = keyOf(nextPos);
      if (closed.has(nextKey)) continue;

      const stepCost = computeStepCost(current.pos, nextPos, terrainData, movementType, profile, threatMap);
      if (!Number.isFinite(stepCost)) continue;

      const tentativeG = (gScore.get(currentKey) || 0) + stepCost;
      if (tentativeG >= (gScore.get(nextKey) ?? Infinity)) continue;

      cameFrom.set(nextKey, current.pos);
      gScore.set(nextKey, tentativeG);
      const heuristic = hexDistance(nextCol, nextRow, goal.col, goal.row) * 0.9;
      open.set(nextKey, {
        pos: nextPos,
        g: tentativeG,
        f: tentativeG + heuristic,
      });
    }
  }

  return null;
}

export function truncatePathToBudget(path, terrainData, unit, profile, threatMap) {
  if (!Array.isArray(path) || path.length === 0) {
    return { destination: unit.position, path: [], totalCost: 0, budget: movementBudgetFor(unit) };
  }
  const movementType = unit?.movementType || "foot";
  const budget = movementBudgetFor(unit);
  let totalCost = 0;
  const traversed = [path[0]];

  for (let index = 1; index < path.length; index += 1) {
    const stepCost = computeStepCost(path[index - 1], path[index], terrainData, movementType, profile, threatMap);
    if (!Number.isFinite(stepCost) || (totalCost + stepCost) > budget) break;
    totalCost += stepCost;
    traversed.push(path[index]);
  }

  const destination = traversed[traversed.length - 1];
  return {
    destination: destination ? `${destination.col},${destination.row}` : unit.position,
    path: traversed.map((step) => `${step.col},${step.row}`),
    totalCost,
    budget,
  };
}

export function compressPathToWaypoints(pathKeys) {
  if (!Array.isArray(pathKeys) || pathKeys.length <= 2) return [];
  const points = pathKeys.map((key) => parsePos(key)).filter(Boolean);
  const waypoints = [];
  let lastDirection = null;

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const inDir = `${current.col - prev.col},${current.row - prev.row}`;
    const outDir = `${next.col - current.col},${next.row - current.row}`;
    const isTurn = inDir !== outDir;
    if (isTurn || (lastDirection && outDir !== lastDirection)) {
      waypoints.push(`${current.col},${current.row}`);
    }
    lastDirection = outDir;
  }

  return waypoints;
}

export function summarizeRouteRisk(pathKeys, threatMap) {
  if (!Array.isArray(pathKeys) || pathKeys.length === 0) return { totalThreat: 0, peakThreat: 0 };
  let totalThreat = 0;
  let peakThreat = 0;
  for (const key of pathKeys) {
    const threat = threatMap?.[key] || 0;
    totalThreat += threat;
    peakThreat = Math.max(peakThreat, threat);
  }
  return { totalThreat, peakThreat };
}
