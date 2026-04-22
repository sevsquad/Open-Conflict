import { getNeighbors, hexDistance } from "../mapRenderer/HexMath.js";
import { parsePosition, positionToLabel } from "./prompts.js";
import { validateAndNormalizeOrders } from "./aiPromptHelpers.js";
import { computeTacticalAnalysis } from "./tacticalAnalysis.js";
import { buildEffectiveTerrain } from "./terrainMerge.js";
import { computeRange, computeForceRatio } from "./orderComputer.js";
import { getAiProfile, getThinkBudgetConfig } from "./aiProfiles.js";
import {
  buildThreatMap,
  findWeightedPath,
  truncatePathToBudget,
  compressPathToWaypoints,
  summarizeRouteRisk,
} from "./aiPathfinding.js";
import { isOrderValid, isAirUnit } from "./orderTypes.js";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsePos(pos) {
  if (!pos) return null;
  if (typeof pos === "string") return parsePosition(pos);
  if (typeof pos === "object" && Number.isFinite(pos.col) && Number.isFinite(pos.row)) {
    return { col: pos.col, row: pos.row };
  }
  return null;
}

function keyOf(pos) {
  return `${pos.col},${pos.row}`;
}

function safeLabel(pos) {
  if (!pos) return "?";
  const key = typeof pos === "string" ? pos : keyOf(pos);
  return positionToLabel(key);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function terrainPreference(profile, cell) {
  const category = terrainCategory(cell);
  return profile?.terrainPreferences?.[category] || 0;
}

function unitCombatPower(unit) {
  const base = unit.type === "armor" ? 2.2
    : unit.type === "artillery" ? 1.8
    : unit.type === "mechanized" || unit.type === "mechanized_infantry" || unit.type === "armored_infantry" ? 1.8
    : unit.type === "engineer" ? 0.9
    : unit.type === "recon" ? 0.8
    : unit.type === "headquarters" || unit.type === "logistics" ? 0.35
    : unit.type === "air_defense" ? 0.9
    : isAirUnit(unit) ? 1.8
    : 1.2;
  const strength = clamp((unit.strength ?? 100) / 100, 0, 1.2);
  const ammo = unit.ammo == null ? 1 : clamp(unit.ammo / 100, 0.3, 1);
  const morale = unit.morale == null ? 1 : clamp(unit.morale / 100, 0.3, 1.1);
  const supply = unit.supply == null ? 1 : clamp(unit.supply / 100, 0.35, 1.05);
  return base * strength * ammo * morale * supply;
}

function visibleEnemyIdsFor(actorId, gameState, visibilityState) {
  if (!visibilityState?.actorVisibility?.[actorId]) {
    return new Set(
      (gameState.units || [])
        .filter((unit) => unit.actor !== actorId && unit.status !== "destroyed" && unit.status !== "eliminated")
        .map((unit) => unit.id)
    );
  }
  const actorVisibility = visibilityState.actorVisibility[actorId];
  return new Set([
    ...(actorVisibility.detectedUnits || []),
    ...(actorVisibility.contactUnits || []),
  ]);
}

function centroidOfUnits(units) {
  if (!units.length) return null;
  let totalCol = 0;
  let totalRow = 0;
  let count = 0;
  for (const unit of units) {
    const pos = parsePos(unit.position);
    if (!pos) continue;
    totalCol += pos.col;
    totalRow += pos.row;
    count += 1;
  }
  if (!count) return null;
  return { col: totalCol / count, row: totalRow / count };
}

function detectFrontDirection(friendlyUnits, enemyUnits) {
  const friendly = centroidOfUnits(friendlyUnits);
  const enemy = centroidOfUnits(enemyUnits);
  if (!friendly || !enemy) return 1;
  return enemy.col >= friendly.col ? 1 : -1;
}

function roleForUnit(unit) {
  if (unit.type === "artillery") return "artillery";
  if (unit.type === "recon") return "recon";
  if (unit.type === "engineer") return "engineer";
  if (unit.type === "headquarters" || unit.type === "logistics") return "support";
  if (unit.type === "air_defense") return "screen";
  if (isAirUnit(unit)) return "air";
  return "maneuver";
}

function forceRatioAtHex(targetHex, friendlyUnits, enemyUnits, terrainData) {
  const defenders = enemyUnits.filter((unit) => unit.position === targetHex);
  if (!defenders.length) return { ratio: 1.25, label: "open" };
  const attackers = friendlyUnits.filter((unit) => {
    const pos = parsePos(unit.position);
    const targetPos = parsePos(targetHex);
    return pos && targetPos && hexDistance(pos.col, pos.row, targetPos.col, targetPos.row) <= 2;
  });
  if (!attackers.length) return { ratio: 0.55, label: "outmatched" };
  const cell = terrainData?.cells?.[targetHex] || { terrain: "open_ground", features: [] };
  const ratio = computeForceRatio(attackers, defenders, cell);
  const numeric = Number.isFinite(ratio?.ratio) ? ratio.ratio : 1;
  return {
    ratio: numeric,
    label: ratio?.label || "contested",
  };
}

function objectiveController(gameState, hexKey) {
  return gameState.game?.vpControl?.[hexKey] || null;
}

function objectiveScoreFor(actorId, objective, context, profile, operationalState) {
  const cooldown = operationalState?.objectiveCooldowns?.[objective.hex] || 0;
  const enemyPresence = context.enemyPresenceByHex[objective.hex] || 0;
  const forceRatio = context.forceRatioByObjective[objective.hex]?.ratio || 1;
  const distance = objective.closestFriendlyDistance ?? 6;
  const terrainFit = terrainPreference(profile, objective.cell);
  return (
    (objective.vp || 10) * profile.vpFocus
    + (objective.controller === actorId ? -14 : objective.controller ? 12 : 8)
    + (enemyPresence * 4)
    + (forceRatio >= profile.acceptableForceRatio ? 8 : -6)
    + (terrainFit * 12)
    - (distance * 1.7)
    - (cooldown * 10)
  );
}

function buildObjectives(actorId, gameState, terrainData, friendlyUnits, enemyUnits, profile, operationalState) {
  const objectives = [];
  const vc = gameState.scenario?.victoryConditions?.hexVP || [];
  const forceRatioByObjective = {};
  const enemyPresenceByHex = {};

  for (const enemy of enemyUnits) {
    const enemyPos = parsePos(enemy.position);
    if (!enemyPos) continue;
    const hexKey = keyOf(enemyPos);
    enemyPresenceByHex[hexKey] = (enemyPresenceByHex[hexKey] || 0) + unitCombatPower(enemy);
  }

  if (vc.length > 0) {
    for (const vp of vc) {
      const cell = terrainData?.cells?.[vp.hex] || null;
      const closestFriendlyDistance = friendlyUnits.reduce((min, unit) => {
        const pos = parsePos(unit.position);
        const target = parsePos(vp.hex);
        if (!pos || !target) return min;
        return Math.min(min, hexDistance(pos.col, pos.row, target.col, target.row));
      }, 99);
      const ratio = forceRatioAtHex(vp.hex, friendlyUnits, enemyUnits, terrainData);
      forceRatioByObjective[vp.hex] = ratio;
      objectives.push({
        hex: vp.hex,
        name: vp.name,
        vp: vp.vp,
        controller: objectiveController(gameState, vp.hex),
        cell,
        closestFriendlyDistance,
        forceRatio: ratio.ratio,
      });
    }
  }

  if (!objectives.length) {
    const enemyCenter = centroidOfUnits(enemyUnits);
    if (enemyCenter) {
      const fallbackHex = `${Math.round(enemyCenter.col)},${Math.round(enemyCenter.row)}`;
      objectives.push({
        hex: fallbackHex,
        name: "Enemy Center of Gravity",
        vp: 12,
        controller: null,
        cell: terrainData?.cells?.[fallbackHex] || null,
        closestFriendlyDistance: 4,
        forceRatio: forceRatioAtHex(fallbackHex, friendlyUnits, enemyUnits, terrainData).ratio,
      });
    }
  }

  const enriched = objectives.map((objective) => ({
    ...objective,
    score: objectiveScoreFor(actorId, objective, { forceRatioByObjective, enemyPresenceByHex }, profile, operationalState),
  })).sort((a, b) => b.score - a.score);

  return { objectives: enriched, forceRatioByObjective, enemyPresenceByHex };
}

function makeBreakdown(values) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return { ...values, total };
}

function nearbyFriendlyCount(hexKey, friendlyUnits, maxDistance = 2) {
  const origin = parsePos(hexKey);
  if (!origin) return 0;
  let count = 0;
  for (const unit of friendlyUnits) {
    const pos = parsePos(unit.position);
    if (!pos) continue;
    if (hexDistance(origin.col, origin.row, pos.col, pos.row) <= maxDistance) count += 1;
  }
  return count;
}

function candidateHexesNear(targetHex, terrainData, radius = 1) {
  const center = parsePos(targetHex);
  if (!center) return [];
  const cells = [];
  for (let row = Math.max(0, center.row - radius); row <= Math.min((terrainData?.rows || 1) - 1, center.row + radius); row += 1) {
    for (let col = Math.max(0, center.col - radius); col <= Math.min((terrainData?.cols || 1) - 1, center.col + radius); col += 1) {
      const distance = hexDistance(center.col, center.row, col, row);
      if (distance <= radius) {
        cells.push(`${col},${row}`);
      }
    }
  }
  return cells;
}

function chooseBestStagingHex(unit, objectiveHex, context, profile, radius = 1) {
  const candidates = candidateHexesNear(objectiveHex, context.terrainData, radius);
  if (!candidates.length) return objectiveHex;
  const unitPos = parsePos(unit.position);
  const objectivePos = parsePos(objectiveHex);
  let best = objectiveHex;
  let bestScore = -Infinity;

  for (const hex of candidates) {
    const pos = parsePos(hex);
    if (!pos || !unitPos || !objectivePos) continue;
    const cell = context.terrainData?.cells?.[hex];
    const threat = context.threatMap?.[hex] || 0;
    const terrainFit = terrainPreference(profile, cell);
    const support = nearbyFriendlyCount(hex, context.friendlyUnits, 2);
    const distToObjective = hexDistance(pos.col, pos.row, objectivePos.col, objectivePos.row);
    const distFromUnit = hexDistance(pos.col, pos.row, unitPos.col, unitPos.row);
    const occupiedByEnemy = context.enemyUnits.some((enemy) => enemy.position === hex);
    const score = (terrainFit * 12) + (support * 2.6) - (threat * 5.5) - (distToObjective * 1.8) - (distFromUnit * 0.8) - (occupiedByEnemy ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }

  return best;
}

function routePlanTo(unit, destinationHex, context, profile) {
  const fullPath = findWeightedPath(unit.position, destinationHex, context.terrainData, unit.movementType || "foot", profile, context.threatMap);
  if (!fullPath?.length) {
    return {
      destination: unit.position,
      path: [unit.position],
      waypoints: [],
      totalCost: 0,
      budget: 0,
      routeRisk: { totalThreat: 0, peakThreat: 0 },
      progressedHexes: 0,
    };
  }
  const truncated = truncatePathToBudget(fullPath, context.terrainData, unit, profile, context.threatMap);
  return {
    ...truncated,
    waypoints: compressPathToWaypoints(truncated.path),
    routeRisk: summarizeRouteRisk(truncated.path, context.threatMap),
    progressedHexes: Math.max(0, truncated.path.length - 1),
  };
}

function holdCandidate(unit, context, profile, hypothesis, reserveUnit) {
  const cell = context.terrainData?.cells?.[unit.position];
  const threat = context.threatMap?.[unit.position] || 0;
  const terrainFit = terrainPreference(profile, cell);
  const support = nearbyFriendlyCount(unit.position, context.friendlyUnits, 2);
  const actionId = isOrderValid("DIG_IN", unit.type) && (unit.entrenchment || 0) < 70 ? "DIG_IN" : "DEFEND";
  return {
    id: "hold",
    targetHex: unit.position,
    tags: ["hold", reserveUnit ? "reserve" : "line"],
    summary: `Hold ${safeLabel(unit.position)}${actionId === "DIG_IN" ? " and improve fieldworks" : ""}`,
    movementOrder: null,
    actionOrder: isOrderValid(actionId, unit.type) ? { id: actionId, target: null } : null,
    intent: reserveUnit
      ? "Stay in reserve to react to enemy movement."
      : "Hold current ground and maintain local cohesion.",
    scoreBreakdown: makeBreakdown({
      safety: (profile.defenseBias * 8) - (threat * 3),
      terrain: terrainFit * 10,
      support: support * 2.2,
      reserveDiscipline: reserveUnit ? 5 : 0,
      pressure: hypothesis.posture === "hold" ? 4 : 0,
    }),
  };
}

function withdrawCandidate(unit, context, profile, hypothesis, reserveUnit) {
  const unitPos = parsePos(unit.position);
  if (!unitPos) return null;
  let bestHex = unit.position;
  let bestScore = -Infinity;
  for (let row = Math.max(0, unitPos.row - 3); row <= Math.min((context.terrainData?.rows || 1) - 1, unitPos.row + 3); row += 1) {
    for (let col = Math.max(0, unitPos.col - 3); col <= Math.min((context.terrainData?.cols || 1) - 1, unitPos.col + 3); col += 1) {
      const distance = hexDistance(unitPos.col, unitPos.row, col, row);
      if (distance === 0 || distance > 3) continue;
      const hex = `${col},${row}`;
      const cell = context.terrainData?.cells?.[hex];
      const threat = context.threatMap?.[hex] || 0;
      const terrainFit = terrainPreference(profile, cell);
      const support = nearbyFriendlyCount(hex, context.friendlyUnits, 2);
      const score = (terrainFit * 12) + (support * 2.5) - (threat * 5.5) - (distance * 0.5);
      if (score > bestScore) {
        bestScore = score;
        bestHex = hex;
      }
    }
  }
  if (bestHex === unit.position) return null;
  const route = routePlanTo(unit, bestHex, context, profile);
  return {
    id: "withdraw",
    targetHex: bestHex,
    tags: ["withdraw"],
    summary: `Withdraw toward ${safeLabel(route.destination)} and re-form in cover`,
    movementOrder: route.destination !== unit.position
      ? { id: "WITHDRAW", target: route.destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
      : null,
    actionOrder: isOrderValid("DEFEND", unit.type) ? { id: "DEFEND", target: null } : null,
    intent: "Break contact, reduce exposure, and fall back onto friendlier ground.",
    route,
    scoreBreakdown: makeBreakdown({
      survival: 11 - ((context.threatMap?.[route.destination] || 0) * 4),
      terrain: terrainPreference(profile, context.terrainData?.cells?.[route.destination]) * 10,
      support: nearbyFriendlyCount(route.destination, context.friendlyUnits, 2) * 2.5,
      posture: hypothesis.posture === "hold" ? 5 : 0,
      reserveDiscipline: reserveUnit ? 2 : 0,
    }),
  };
}

function artilleryCandidate(unit, objective, context, profile, hypothesis) {
  if (!objective || !isOrderValid("FIRE_MISSION", unit.type)) return holdCandidate(unit, context, profile, hypothesis, false);
  const range = computeRange(unit.position, objective.hex, unit, context.terrainData?.cellSizeKm || 1);
  if (range.band === "OUT_OF_RANGE") {
    const stagingHex = chooseBestStagingHex(unit, objective.hex, context, profile, 2);
    const route = routePlanTo(unit, stagingHex, context, profile);
    return {
      id: "reposition-artillery",
      targetHex: stagingHex,
      tags: ["artillery", "reposition"],
      summary: `Shift artillery toward ${safeLabel(stagingHex)} to cover ${objective.name}`,
      movementOrder: route.destination !== unit.position
        ? { id: "MOVE", target: route.destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
        : null,
      actionOrder: null,
      intent: `Reposition to support fires against ${objective.name}.`,
      route,
      scoreBreakdown: makeBreakdown({
        objective: objective.vp * profile.vpFocus,
        range: 6 - (range.hexes * 0.6),
        terrain: terrainPreference(profile, context.terrainData?.cells?.[route.destination]) * 6,
        threat: -((context.threatMap?.[route.destination] || 0) * 2.5),
      }),
    };
  }

  const defenders = context.enemyUnits.filter((enemy) => enemy.position === objective.hex);
  const subtype = defenders.length === 0 && context.primaryObjectiveRequiresSmoke ? "SMOKE" : "HE";
  return {
    id: `fire-mission-${subtype.toLowerCase()}`,
    targetHex: objective.hex,
    tags: ["artillery", "fires"],
    summary: `${subtype === "SMOKE" ? "Lay smoke" : "Deliver fires"} on ${objective.name}`,
    movementOrder: null,
    actionOrder: { id: "FIRE_MISSION", target: objective.hex, subtype },
    intent: `${subtype === "SMOKE" ? "Screen the main effort" : "Disrupt defenders"} at ${objective.name}.`,
    scoreBreakdown: makeBreakdown({
      objective: (objective.vp * 1.2) * profile.vpFocus,
      support: defenders.length * 3.5,
      artilleryBias: profile.artilleryBias * 8,
      threat: -((context.threatMap?.[unit.position] || 0) * 1.8),
      persistence: hypothesis.priority === "primary" ? 4 : 0,
    }),
  };
}

function reconCandidate(unit, objective, context, profile) {
  const probeHex = objective ? chooseBestStagingHex(unit, objective.hex, context, profile, 2) : unit.position;
  const route = routePlanTo(unit, probeHex, context, profile);
  const actionTarget = objective?.hex || probeHex;
  return {
    id: "recon-probe",
    targetHex: probeHex,
    tags: ["recon", "probe"],
    summary: `Probe toward ${safeLabel(probeHex)} and scout ${safeLabel(actionTarget)}`,
    movementOrder: route.destination !== unit.position
      ? { id: "MOVE", target: route.destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
      : null,
    actionOrder: isOrderValid("RECON", unit.type) ? { id: "RECON", target: actionTarget } : null,
    intent: `Screen the approach to ${objective?.name || safeLabel(actionTarget)} and sharpen the picture.`,
    route,
    scoreBreakdown: makeBreakdown({
      reconBias: profile.reconBias * 9,
      objective: objective ? (objective.vp * 0.7) : 4,
      terrain: terrainPreference(profile, context.terrainData?.cells?.[route.destination]) * 9,
      threat: -((route.routeRisk?.peakThreat || 0) * 3.4),
      support: nearbyFriendlyCount(route.destination, context.friendlyUnits, 2) * 1.6,
    }),
  };
}

function engineerCandidate(unit, objective, context, profile, hypothesis) {
  const objectiveCell = objective ? context.terrainData?.cells?.[objective.hex] : null;
  const currentNeedsFortify = objectiveController(context.gameState, unit.position) === unit.actor;
  const objectiveNeedsBridge = !!(objectiveCell?.features || []).some((feature) => feature === "river" || feature === "river_crossing" || feature === "bridge" || feature === "dam");
  if (unit.position === objective?.hex && isOrderValid("ENGINEER", unit.type)) {
    return {
      id: objectiveNeedsBridge ? "engineer-bridge" : "engineer-fortify",
      targetHex: unit.position,
      tags: ["engineer"],
      summary: objectiveNeedsBridge ? `Work the crossing at ${objective.name}` : `Fortify ${objective.name}`,
      movementOrder: null,
      actionOrder: { id: "ENGINEER", target: unit.position, subtype: objectiveNeedsBridge ? "BRIDGE" : "FORTIFY" },
      intent: objectiveNeedsBridge ? "Enable the crossing for the main effort." : "Improve the position for sustained holding action.",
      scoreBreakdown: makeBreakdown({
        objective: objective ? (objective.vp * 0.9) : 5,
        terrain: terrainPreference(profile, objectiveCell) * 7,
        support: nearbyFriendlyCount(unit.position, context.friendlyUnits, 2) * 2.1,
        pressure: hypothesis.posture === "attack" && objectiveNeedsBridge ? 7 : 4,
      }),
    };
  }

  const destination = objective ? chooseBestStagingHex(unit, objective.hex, context, profile, 1) : unit.position;
  const route = routePlanTo(unit, destination, context, profile);
  const actionOrder = route.destination === unit.position && currentNeedsFortify && isOrderValid("ENGINEER", unit.type)
    ? { id: "ENGINEER", target: unit.position, subtype: "FORTIFY" }
    : null;

  return {
    id: "engineer-stage",
    targetHex: destination,
    tags: ["engineer", "stage"],
    summary: objective ? `Stage engineers for ${objective.name}` : "Keep engineers close to the line",
    movementOrder: route.destination !== unit.position
      ? { id: "MOVE", target: route.destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
      : null,
    actionOrder,
    intent: objective
      ? `Move into position to support operations around ${objective.name}.`
      : "Stay ready for mobility or fortification tasks.",
    route,
    scoreBreakdown: makeBreakdown({
      objective: objective ? (objective.vp * 0.8) : 4,
      terrain: terrainPreference(profile, context.terrainData?.cells?.[route.destination]) * 7,
      support: nearbyFriendlyCount(route.destination, context.friendlyUnits, 2) * 2,
      threat: -((context.threatMap?.[route.destination] || 0) * 2.6),
    }),
  };
}

function airCandidate(unit, objective, context, profile) {
  const targetHex = objective?.hex || unit.position;
  const preferredAltitude = profile.dangerTolerance > 0.6 ? "LOW" : "MEDIUM";
  const actionId = unit.type === "attack_helicopter" ? "CAS" : "AIR_RECON";
  const actionOrder = isOrderValid(actionId, unit.type)
    ? { id: actionId, target: targetHex, altitude: preferredAltitude }
    : null;
  return {
    id: "air-support",
    targetHex,
    tags: ["air"],
    summary: `${actionId === "CAS" ? "Strike" : "Reconnoiter"} ${objective?.name || safeLabel(targetHex)}`,
    movementOrder: isOrderValid("MOVE", unit.type) ? { id: "MOVE", target: targetHex } : null,
    actionOrder,
    intent: `${actionId === "CAS" ? "Support the main effort" : "Improve the air picture"} around ${objective?.name || safeLabel(targetHex)}.`,
    scoreBreakdown: makeBreakdown({
      objective: objective ? (objective.vp * profile.vpFocus) : 5,
      aggression: profile.aggression * 8,
      threat: -((context.threatMap?.[targetHex] || 0) * 2.2),
      support: nearbyFriendlyCount(targetHex, context.friendlyUnits, 2) * 1.5,
    }),
  };
}

function supportCandidate(unit, objective, context, profile, reserveUnit) {
  const desiredHex = objective ? chooseBestStagingHex(unit, objective.hex, context, profile, 3) : unit.position;
  const route = routePlanTo(unit, desiredHex, context, profile);
  return {
    id: "support-stage",
    targetHex: desiredHex,
    tags: ["support", reserveUnit ? "reserve" : "line"],
    summary: `Keep support node near ${objective?.name || safeLabel(desiredHex)}`,
    movementOrder: route.destination !== unit.position
      ? { id: reserveUnit ? "WITHDRAW" : "MOVE", target: route.destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
      : null,
    actionOrder: isOrderValid("DEFEND", unit.type) ? { id: "DEFEND", target: null } : null,
    intent: "Maintain command and support coverage for nearby maneuver elements.",
    route,
    scoreBreakdown: makeBreakdown({
      support: nearbyFriendlyCount(route.destination, context.friendlyUnits, 2) * 2.8,
      terrain: terrainPreference(profile, context.terrainData?.cells?.[route.destination]) * 8,
      threat: -((context.threatMap?.[route.destination] || 0) * 3.4),
      reserve: reserveUnit ? 2 : 0,
    }),
  };
}

function maneuverAttackCandidate(unit, objective, context, profile, hypothesis, reserveUnit, variant) {
  if (!objective) return holdCandidate(unit, context, profile, hypothesis, reserveUnit);
  const targetHex = objective.hex;
  const stagingHex = chooseBestStagingHex(unit, targetHex, context, profile, 1);
  const route = routePlanTo(unit, stagingHex, context, profile);
  const destination = route.destination || unit.position;
  const destinationCell = context.terrainData?.cells?.[destination];
  const range = computeRange(destination, targetHex, unit, context.terrainData?.cellSizeKm || 1);
  const defenders = context.enemyUnits.filter((enemy) => enemy.position === targetHex);
  const forceRatio = forceRatioAtHex(targetHex, context.friendlyUnits, context.enemyUnits, context.terrainData).ratio;
  const canAttack = range.band !== "OUT_OF_RANGE" && isOrderValid("ATTACK", unit.type);
  const actionId = canAttack && forceRatio >= (profile.acceptableForceRatio - 0.15)
    ? "ATTACK"
    : isOrderValid("SUPPORT_FIRE", unit.type)
      ? "SUPPORT_FIRE"
      : "DEFEND";
  const actionTarget = actionId === "DEFEND" ? null : targetHex;
  const objectiveControllerState = objectiveController(context.gameState, targetHex);
  const advancePressure = objectiveControllerState === unit.actor ? 2 : 8;
  const lowSupplyPenalty = ((unit.supply ?? 100) < 45 || (unit.ammo ?? 100) < 35) ? -8 : 0;
  const reservePenalty = reserveUnit && hypothesis.reservePolicy !== "commit" ? -7 : 0;
  const routeRiskPenalty = -(route.routeRisk?.peakThreat || 0) * (4.2 - (profile.dangerTolerance * 1.8) - (variant.routeRiskModifier || 0));
  return {
    id: `maneuver-${actionId.toLowerCase()}`,
    targetHex,
    destinationHex: destination,
    tags: ["maneuver", objectiveControllerState === unit.actor ? "hold-objective" : "main-effort", reserveUnit ? "reserve" : "line"],
    summary: `${actionId === "ATTACK" ? "Close on" : actionId === "SUPPORT_FIRE" ? "Support attack on" : "Hold near"} ${objective.name} from ${safeLabel(destination)}`,
    movementOrder: destination !== unit.position
      ? { id: "MOVE", target: destination, ...(route.waypoints.length > 0 ? { waypoints: route.waypoints } : {}) }
      : null,
    actionOrder: actionId === "DEFEND"
      ? (isOrderValid("DEFEND", unit.type) ? { id: "DEFEND", target: null } : null)
      : { id: actionId, target: actionTarget },
    intent: actionId === "ATTACK"
      ? `Join the main effort against ${objective.name}.`
      : actionId === "SUPPORT_FIRE"
        ? `Support the assault on ${objective.name} from covered terrain.`
        : `Hold ground covering ${objective.name}.`,
    route,
    scoreBreakdown: makeBreakdown({
      objective: (objective.vp * profile.vpFocus) + advancePressure,
      aggression: profile.aggression * 9,
      terrain: terrainPreference(profile, destinationCell) * 10,
      support: nearbyFriendlyCount(destination, context.friendlyUnits, 2) * 2.4,
      forceRatio: (forceRatio - profile.acceptableForceRatio) * 8.5,
      routeRisk: routeRiskPenalty,
      supply: lowSupplyPenalty,
      reserveDiscipline: reservePenalty,
      persistence: hypothesis.priority === "primary" ? 5 : 2,
      defenders: defenders.length * 1.8,
    }),
  };
}

function buildCandidatesForUnit(unit, context, hypothesis, profile, reserveUnit, variant) {
  const role = roleForUnit(unit);
  const primaryObjective = hypothesis.primaryObjective;
  const candidates = [];
  const hold = holdCandidate(unit, context, profile, hypothesis, reserveUnit);
  if (hold) candidates.push(hold);

  const weakOrExposed = (unit.strength ?? 100) <= 55
    || context.analysis?.vulnerabilities?.[unit.id]?.classification === "EXPOSED"
    || context.analysis?.vulnerabilities?.[unit.id]?.classification === "ISOLATED";
  if (weakOrExposed && isOrderValid("WITHDRAW", unit.type)) {
    const withdraw = withdrawCandidate(unit, context, profile, hypothesis, reserveUnit);
    if (withdraw) candidates.push(withdraw);
  }

  if (role === "artillery") {
    candidates.push(artilleryCandidate(unit, primaryObjective, context, profile, hypothesis));
  } else if (role === "recon") {
    candidates.push(reconCandidate(unit, primaryObjective, context, profile));
  } else if (role === "engineer") {
    candidates.push(engineerCandidate(unit, primaryObjective, context, profile, hypothesis));
  } else if (role === "support" || role === "screen") {
    candidates.push(supportCandidate(unit, primaryObjective, context, profile, reserveUnit));
  } else if (role === "air") {
    candidates.push(airCandidate(unit, primaryObjective, context, profile));
  } else {
    candidates.push(maneuverAttackCandidate(unit, primaryObjective, context, profile, hypothesis, reserveUnit, variant));
    if (hypothesis.secondaryObjective && hypothesis.secondaryObjective.hex !== primaryObjective?.hex) {
      const secondary = maneuverAttackCandidate(unit, hypothesis.secondaryObjective, context, profile, { ...hypothesis, priority: "secondary" }, reserveUnit, variant);
      secondary.id = `${secondary.id}-secondary`;
      secondary.summary = secondary.summary.replace("main-effort", "secondary effort");
      secondary.scoreBreakdown.objective -= 2;
      secondary.scoreBreakdown.total -= 2;
      candidates.push(secondary);
    }
  }

  return candidates
    .filter(Boolean)
    .map((candidate) => ({ ...candidate, role }))
    .sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total);
}

function buildHypotheses(context, profile, operationalState, budgetConfig) {
  const hypotheses = [];
  const objectives = context.objectives.slice(0, Math.max(2, budgetConfig.maxHypotheses));
  const leadingVp = (context.myVp || 0) > (context.enemyVp || 0);
  const threatenedFriendlyObjective = context.objectives.find((objective) => objective.controller === context.actorId && objective.forceRatio < 0.95);
  const mainObjective = objectives[0] || null;
  const alternateObjective = objectives[1] || mainObjective;

  if (mainObjective) {
    hypotheses.push({
      id: "main-effort",
      label: `Main effort on ${mainObjective.name}`,
      type: "attack",
      posture: threatenedFriendlyObjective && mainObjective.controller === context.actorId ? "hold" : "attack",
      priority: "primary",
      reservePolicy: profile.aggression > 0.7 ? "commit" : "screen",
      primaryObjective: mainObjective,
      secondaryObjective: alternateObjective,
      scoreSeed: mainObjective.score + (profile.aggression * 8),
      summary: mainObjective.controller === context.actorId
        ? `Reinforce and hold ${mainObjective.name} while preparing the next push.`
        : `Concentrate on ${mainObjective.name} as the decisive point this turn.`,
    });
  }

  if (alternateObjective && alternateObjective.hex !== mainObjective?.hex) {
    hypotheses.push({
      id: "alternate-axis",
      label: `Alternate axis via ${alternateObjective.name}`,
      type: "flank",
      posture: "attack",
      priority: "secondary",
      reservePolicy: "screen",
      primaryObjective: alternateObjective,
      secondaryObjective: mainObjective,
      scoreSeed: alternateObjective.score + (profile.roughTerrainBias * 6) + (profile.urbanBias * 6),
      summary: `Probe the less direct axis through ${alternateObjective.name} and draw defenders sideways.`,
    });
  }

  hypotheses.push({
    id: "set-conditions",
    label: "Set conditions and preserve combat power",
    type: "hold",
    posture: "hold",
    priority: "primary",
    reservePolicy: "hold",
    primaryObjective: threatenedFriendlyObjective || mainObjective,
    secondaryObjective: mainObjective,
    scoreSeed: (leadingVp ? 18 : 10) + (profile.defenseBias * 10),
    summary: threatenedFriendlyObjective
      ? `Stiffen the line around ${threatenedFriendlyObjective.name} and wait for a cleaner opening.`
      : "Hold key terrain, preserve reserves, and improve the next turn's odds.",
  });

  return hypotheses.slice(0, budgetConfig.maxHypotheses).sort((a, b) => b.scoreSeed - a.scoreSeed);
}

function buildPlanVariants(budgetConfig) {
  if (budgetConfig.planVariants <= 1) {
    return [{ id: "default", routeRiskModifier: 0, reserveCommitBonus: 0 }];
  }
  return [
    { id: "default", routeRiskModifier: 0, reserveCommitBonus: 0 },
    { id: "deliberate-commit", routeRiskModifier: 0.35, reserveCommitBonus: 0.12 },
  ];
}

function selectReserveUnits(context, profile) {
  const maneuverUnits = context.friendlyUnits.filter((unit) => roleForUnit(unit) === "maneuver")
    .sort((a, b) => {
      const mobilityA = a.movementType === "tracked" ? 3 : a.movementType === "wheeled" ? 2 : 1;
      const mobilityB = b.movementType === "tracked" ? 3 : b.movementType === "wheeled" ? 2 : 1;
      return ((unitCombatPower(b) * 2) + mobilityB) - ((unitCombatPower(a) * 2) + mobilityA);
    });
  const reservePowerTarget = maneuverUnits.reduce((sum, unit) => sum + unitCombatPower(unit), 0) * profile.reserveRatio;
  const reserveIds = new Set();
  let reservedPower = context.operationalState?.reserveCommitted ? reservePowerTarget * 0.45 : 0;

  for (const unit of maneuverUnits) {
    if (reservedPower >= reservePowerTarget) break;
    reserveIds.add(unit.id);
    reservedPower += unitCombatPower(unit);
  }
  return reserveIds;
}

function chooseCandidateList(context, hypothesis, profile, variant) {
  const reserveUnits = selectReserveUnits(context, profile);
  const byUnit = {};
  for (const unit of context.actorUnits) {
    const reserveUnit = reserveUnits.has(unit.id);
    byUnit[unit.id] = {
      unit,
      reserveUnit,
      alternatives: buildCandidatesForUnit(unit, context, hypothesis, profile, reserveUnit, variant),
    };
  }
  return { reserveUnits, byUnit };
}

function chooseTopCandidate(entry) {
  return entry.alternatives[0] || null;
}

function coordinationBonus(selectedCandidates, primaryHex, hypothesis, profile) {
  let bonus = 0;
  const mainEffortUnits = selectedCandidates.filter((candidate) => candidate?.targetHex === primaryHex);
  const fireSupport = selectedCandidates.filter((candidate) => candidate?.actionOrder?.id === "FIRE_MISSION" && candidate?.actionOrder?.target === primaryHex);
  if (mainEffortUnits.length >= 2) bonus += 8 + (mainEffortUnits.length - 2);
  if (fireSupport.length > 0 && mainEffortUnits.length > 0) bonus += 5;
  if (hypothesis.posture === "hold") {
    const defenders = selectedCandidates.filter((candidate) => candidate?.actionOrder?.id === "DEFEND" || candidate?.actionOrder?.id === "DIG_IN");
    bonus += defenders.length * 1.2;
  }
  bonus += profile.supportBias * 2.5;
  return bonus;
}

function congestionPenalty(selectedCandidates, context) {
  const counts = {};
  for (const candidate of selectedCandidates) {
    const moveTarget = candidate?.movementOrder?.target;
    if (!moveTarget) continue;
    counts[moveTarget] = (counts[moveTarget] || 0) + 1;
  }
  let penalty = 0;
  for (const [hex, count] of Object.entries(counts)) {
    const cell = context.terrainData?.cells?.[hex];
    const bridgeish = !!(cell?.features || []).some((feature) => feature === "bridge" || feature === "dam" || feature === "river_crossing");
    if (bridgeish && count > 2) penalty += (count - 2) * 5;
    else if (count > 3) penalty += (count - 3) * 2;
  }
  return penalty;
}

function applyCoordination(planSeed, context, hypothesis, profile, variant) {
  const selected = {};
  for (const [unitId, entry] of Object.entries(planSeed.byUnit)) {
    selected[unitId] = chooseTopCandidate(entry);
  }

  const primaryHex = hypothesis.primaryObjective?.hex || null;
  const maneuverEntries = Object.values(planSeed.byUnit).filter((entry) => entry.unit && roleForUnit(entry.unit) === "maneuver");
  const committedPrimary = Object.values(selected).filter((candidate) =>
    candidate?.targetHex === primaryHex
    && (candidate?.actionOrder?.id === "ATTACK" || candidate?.actionOrder?.id === "SUPPORT_FIRE")
  ).length;
  const minPrimaryUnits = hypothesis.posture === "hold"
    ? 0
    : Math.max(2, Math.ceil(maneuverEntries.length * (0.2 + (profile.aggression * 0.25) + (variant.reserveCommitBonus || 0))));

  if (primaryHex && committedPrimary < minPrimaryUnits) {
    const switchables = maneuverEntries.map((entry) => {
      const primaryAlt = entry.alternatives.find((candidate) =>
        candidate?.targetHex === primaryHex
        && (candidate?.actionOrder?.id === "ATTACK" || candidate?.actionOrder?.id === "SUPPORT_FIRE")
      );
      if (!primaryAlt) return null;
      const current = selected[entry.unit.id];
      return {
        entry,
        primaryAlt,
        delta: (primaryAlt.scoreBreakdown.total || 0) - (current?.scoreBreakdown?.total || 0),
      };
    }).filter(Boolean).sort((a, b) => b.delta - a.delta);

    let needed = minPrimaryUnits - committedPrimary;
    for (const item of switchables) {
      if (needed <= 0) break;
      selected[item.entry.unit.id] = item.primaryAlt;
      needed -= 1;
    }
  }

  if (hypothesis.reservePolicy === "hold") {
    for (const unitId of planSeed.reserveUnits) {
      const current = selected[unitId];
      const aggressive = current?.actionOrder?.id === "ATTACK" || current?.actionOrder?.id === "SUPPORT_FIRE";
      if (!aggressive) continue;
      const holdAlt = planSeed.byUnit[unitId]?.alternatives.find((candidate) => candidate.id === "hold");
      if (holdAlt && (current.scoreBreakdown.total - holdAlt.scoreBreakdown.total) < 6) {
        selected[unitId] = holdAlt;
      }
    }
  }

  const selectedList = Object.values(selected).filter(Boolean);
  const coordination = {
    mainEffortHex: primaryHex,
    mainEffortUnits: selectedList.filter((candidate) => candidate?.targetHex === primaryHex).map((candidate) => candidate.summary),
    reserveUnits: [...planSeed.reserveUnits],
    coordinationBonus: coordinationBonus(selectedList, primaryHex, hypothesis, profile),
    congestionPenalty: congestionPenalty(selectedList, context),
  };

  return { selected, coordination };
}

function followOnHeuristic(plan, context, hypothesis, budgetConfig) {
  if (budgetConfig.lookaheadDepth <= 0) return 0;
  const primaryHex = hypothesis.primaryObjective?.hex;
  if (!primaryHex) return 0;
  const primaryPos = parsePos(primaryHex);
  if (!primaryPos) return 0;
  let total = 0;
  for (const candidate of Object.values(plan.selected)) {
    const destination = parsePos(candidate?.movementOrder?.target || candidate?.targetHex || candidate?.destinationHex || candidate?.unit?.position);
    if (!destination) continue;
    const distance = hexDistance(destination.col, destination.row, primaryPos.col, primaryPos.row);
    total += Math.max(0, 4 - distance);
    total -= (context.threatMap?.[`${destination.col},${destination.row}`] || 0) * 1.6;
  }
  return total * 0.6;
}

function buildIntentString(hypothesis, coordination) {
  const mainObjective = hypothesis.primaryObjective;
  if (!mainObjective) return "Hold the line and preserve combat power.";
  if (hypothesis.posture === "hold") {
    return `Hold around ${mainObjective.name}, keep reserves intact, and punish exposed enemy moves.`;
  }
  return `Make ${mainObjective.name} the main effort, mass fires and maneuver on that axis, and keep ${coordination.reserveUnits.length} unit(s) in reserve unless the seam opens.`;
}

function buildCommanderThoughts(hypothesis, planScore, context) {
  const mainObjective = hypothesis.primaryObjective;
  const gapCount = context.analysis?.gapData?.gaps?.length || 0;
  return mainObjective
    ? `Main effort: ${mainObjective.name}. Plan score ${planScore.toFixed(1)}. ${gapCount > 0 ? `I see ${gapCount} exploitable gap(s).` : "No obvious seam; pressure the decisive ground."}`
    : "No decisive objective visible. Stabilize the line and improve next turn's options.";
}

function buildPlan(context, hypothesis, profile, variant, budgetConfig) {
  const seed = chooseCandidateList(context, hypothesis, profile, variant);
  const coordinated = applyCoordination(seed, context, hypothesis, profile, variant);
  const selectedEntries = Object.entries(coordinated.selected);
  const unitOrders = {};
  const unitDecisionSummaries = [];

  for (const [unitId, candidate] of selectedEntries) {
    if (!candidate) continue;
    unitOrders[unitId] = {
      movementOrder: candidate.movementOrder || null,
      actionOrder: candidate.actionOrder || null,
      intent: candidate.intent || "",
    };
    const alternatives = (seed.byUnit[unitId]?.alternatives || []).slice(0, budgetConfig.candidateBreadth).map((alternative) => ({
      id: alternative.id,
      summary: alternative.summary,
      score: alternative.scoreBreakdown.total,
      targetHex: alternative.targetHex || null,
      scoreBreakdown: alternative.scoreBreakdown,
    }));
    unitDecisionSummaries.push({
      unitId,
      unitName: seed.byUnit[unitId]?.unit?.name || unitId,
      role: roleForUnit(seed.byUnit[unitId]?.unit || {}),
      reserveUnit: seed.reserveUnits.has(unitId),
      selectedCandidateId: candidate.id,
      selectedSummary: candidate.summary,
      selectedScore: candidate.scoreBreakdown.total,
      targetHex: candidate.targetHex || null,
      destinationHex: candidate.movementOrder?.target || candidate.targetHex || null,
      scoreBreakdown: candidate.scoreBreakdown,
      subsequentOrders: unitOrders[unitId],
      alternatives,
    });
  }

  const baseScore = unitDecisionSummaries.reduce((sum, decision) => sum + (decision.selectedScore || 0), 0);
  const followOnScore = followOnHeuristic(coordinated, context, hypothesis, budgetConfig);
  const totalScore = baseScore + coordinated.coordination.coordinationBonus - coordinated.coordination.congestionPenalty + followOnScore;
  const actorIntent = buildIntentString(hypothesis, coordinated.coordination);
  const commanderThoughts = buildCommanderThoughts(hypothesis, totalScore, context);

  return {
    hypothesis,
    variant,
    profile,
    unitOrders,
    unitDecisionSummaries,
    actorIntent,
    commanderThoughts,
    coordination: coordinated.coordination,
    baseScore,
    followOnScore,
    totalScore,
  };
}

function buildReasoningJson(plan, context, hypotheses, profile, budgetConfig, warnings) {
  return {
    engine: "algorithmic",
    generatedAt: new Date().toISOString(),
    actorId: context.actorId,
    turn: context.gameState?.game?.turn,
    profile: cloneJson(profile),
    thinkBudget: budgetConfig.id,
    battlefield: {
      visibleEnemyCount: context.enemyUnits.length,
      visibleFriendlyCount: context.friendlyUnits.length,
      frontDirection: context.frontDirection > 0 ? "eastward" : "westward",
      myVp: context.myVp,
      enemyVp: context.enemyVp,
      primaryObjectiveRequiresSmoke: context.primaryObjectiveRequiresSmoke,
      operationalState: cloneJson(context.operationalState || {}),
      sectors: cloneJson(context.analysis?.sectors || []),
      gaps: cloneJson(context.analysis?.gapData?.gaps || []),
      vulnerabilities: cloneJson(context.analysis?.vulnerabilities || {}),
    },
    hypotheses: hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      label: hypothesis.label,
      type: hypothesis.type,
      posture: hypothesis.posture,
      reservePolicy: hypothesis.reservePolicy,
      primaryObjective: hypothesis.primaryObjective ? {
        hex: hypothesis.primaryObjective.hex,
        name: hypothesis.primaryObjective.name,
        controller: hypothesis.primaryObjective.controller,
        vp: hypothesis.primaryObjective.vp,
        score: hypothesis.primaryObjective.score,
      } : null,
      secondaryObjective: hypothesis.secondaryObjective ? {
        hex: hypothesis.secondaryObjective.hex,
        name: hypothesis.secondaryObjective.name,
        controller: hypothesis.secondaryObjective.controller,
        vp: hypothesis.secondaryObjective.vp,
        score: hypothesis.secondaryObjective.score,
      } : null,
      scoreSeed: hypothesis.scoreSeed,
      selected: hypothesis.id === plan.hypothesis.id,
      summary: hypothesis.summary,
    })),
    selectedHypothesis: {
      id: plan.hypothesis.id,
      label: plan.hypothesis.label,
      variant: plan.variant.id,
      totalScore: plan.totalScore,
      baseScore: plan.baseScore,
      followOnScore: plan.followOnScore,
      coordination: cloneJson(plan.coordination),
    },
    unitDecisions: cloneJson(plan.unitDecisionSummaries),
    orders: {
      actorIntent: plan.actorIntent,
      commanderThoughts: plan.commanderThoughts,
      unitOrders: cloneJson(plan.unitOrders),
    },
    warnings: warnings || [],
  };
}

export function generateAlgorithmicOrders(gameState, actorId, terrainData, aiConfig = {}, options = {}) {
  const effectiveTerrain = buildEffectiveTerrain(terrainData, gameState.terrainMods);
  const actorUnits = (gameState.units || []).filter((unit) =>
    unit.actor === actorId
    && unit.status !== "destroyed"
    && unit.status !== "eliminated"
  );

  if (actorUnits.length === 0) {
    return {
      unitOrders: {},
      actorIntent: "No operational units remaining.",
      commanderThoughts: "All units lost. Nothing to command.",
      reasoning: {
        engine: "algorithmic",
        actorId,
        turn: gameState?.game?.turn,
        note: "No operational units remained when orders were requested.",
      },
      usage: null,
      retryCount: 0,
    };
  }

  const profile = getAiProfile(aiConfig.profile);
  const budgetConfig = getThinkBudgetConfig(aiConfig.thinkBudget);
  const visibleEnemyIds = visibleEnemyIdsFor(actorId, gameState, options.visibilityState);
  const friendlyUnits = actorUnits.filter((unit) => !unit.embarkedIn);
  const enemyUnits = (gameState.units || []).filter((unit) =>
    unit.actor !== actorId
    && unit.status !== "destroyed"
    && unit.status !== "eliminated"
    && visibleEnemyIds.has(unit.id)
  );
  const frontDirection = detectFrontDirection(friendlyUnits, enemyUnits);
  const analysis = computeTacticalAnalysis(actorId, gameState, effectiveTerrain, options.visibilityState);
  const threatMap = buildThreatMap(actorId, gameState, effectiveTerrain, enemyUnits, profile);
  const objectiveData = buildObjectives(actorId, gameState, effectiveTerrain, friendlyUnits, enemyUnits, profile, options.operationalState);
  const context = {
    actorId,
    actorUnits,
    friendlyUnits,
    enemyUnits,
    terrainData: effectiveTerrain,
    threatMap,
    frontDirection,
    analysis,
    operationalState: options.operationalState || null,
    gameState,
    primaryObjectiveRequiresSmoke: !!(objectiveData.objectives[0]?.cell?.features || []).some((feature) => feature === "river" || feature === "river_crossing" || feature === "bridge" || feature === "dam"),
    objectives: objectiveData.objectives,
    myVp: gameState.game?.vpStatus?.vp?.[actorId] || 0,
    enemyVp: Math.max(
      0,
      ...Object.entries(gameState.game?.vpStatus?.vp || {})
        .filter(([id]) => id !== actorId)
        .map(([, vp]) => vp || 0)
    ),
    forceRatioByObjective: objectiveData.forceRatioByObjective,
    enemyPresenceByHex: objectiveData.enemyPresenceByHex,
  };

  const hypotheses = buildHypotheses(context, profile, options.operationalState, budgetConfig);
  const plans = [];
  for (const hypothesis of hypotheses) {
    for (const variant of buildPlanVariants(budgetConfig)) {
      plans.push(buildPlan(context, hypothesis, profile, variant, budgetConfig));
    }
  }

  plans.sort((a, b) => b.totalScore - a.totalScore);
  const selectedPlan = plans[0];
  const rawPayload = {
    unitOrders: selectedPlan.unitOrders,
    actorIntent: selectedPlan.actorIntent,
    commanderThoughts: selectedPlan.commanderThoughts,
  };
  const validated = validateAndNormalizeOrders(rawPayload, actorUnits, effectiveTerrain);
  const reasoning = buildReasoningJson(selectedPlan, context, hypotheses, profile, budgetConfig, validated.warnings);

  return {
    ...validated,
    reasoning,
    usage: null,
    retryCount: 0,
    rawPrompt: null,
    rawResponse: JSON.stringify(reasoning),
  };
}
