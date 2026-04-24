#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { hexDistance, hexLine } from "../src/mapRenderer/HexMath.js";
import { parseUnitPosition } from "../src/mapRenderer/overlays/UnitOverlay.js";
import { getTestFixture } from "../src/testFixture.js";
import { buildRtsMatch } from "../src/rts/rtsStart.js";
import { createRtsCommand, reduceRtsCommand, tickRtsMatch } from "../src/rts/rtsEngine.js";
import { buildVpZoneOutlines, buildZoneModel, getObjectiveZoneId } from "../src/rts/zoneModel.js";
import { getHeloInsertionPreset, getPresetById, getServerAiDuelPreset } from "../src/simulation/presets.js";
import {
  buildScenario,
  buildTickStats,
  ensureDir,
  makeRunId,
  projectRoot,
  renderChecks,
  renderOutcome,
  reportRoot,
  runMatch,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const runId = makeRunId("rts-ai");
const runDir = path.join(reportRoot, "runs", runId);
const latestSummaryPath = path.join(reportRoot, "latest-ai-summary.json");
const latestReportPath = path.join(reportRoot, "latest-ai-report.md");
const ALLOWED_PROVENANCE = new Set(["visible", "contact", "lastKnown", "doctrine", "directorHint"]);

ensureDir(runDir);

function collectCommanderPlanSnapshots(run) {
  return (run.state.replay?.snapshots || []).flatMap((snapshot) => (
    Object.entries(snapshot.commanderPlans || {}).map(([actorId, plans]) => {
      const entries = Object.values(plans || {});
      const zoneCounts = {};
      const roleCounts = {};
      const laneCounts = {};
      for (const task of entries) {
        zoneCounts[task.zoneId || "none"] = (zoneCounts[task.zoneId || "none"] || 0) + 1;
        roleCounts[task.role || task.kind || "none"] = (roleCounts[task.role || task.kind || "none"] || 0) + 1;
        if (task.laneId) {
          laneCounts[task.laneId] = (laneCounts[task.laneId] || 0) + 1;
        }
      }
      return {
        atMs: snapshot.atMs,
        actorId,
        entries,
        taskCount: entries.length,
        distinctZones: Object.keys(zoneCounts).length,
        distinctRoles: Object.keys(roleCounts).length,
        laneCounts,
        maxZoneShare: entries.length > 0 ? Math.max(...Object.values(zoneCounts)) / entries.length : 0,
      };
    })
  ));
}

function firstPlanSnapshot(planSnapshots, actorId = null) {
  return planSnapshots.find((snapshot) => (actorId ? snapshot.actorId === actorId : true) && snapshot.taskCount > 0) || null;
}

function firstDirectorPacket(packets, actorId = null) {
  return (packets || []).find((packet) => (actorId ? packet.actorId === actorId : true)) || null;
}

function countPacketIntentZones(packet) {
  return new Set(packetIntentZoneIds(packet)).size;
}

function packetIntentZoneIds(packet) {
  return [
    ...((packet?.suggestedAxes || []).map((entry) => entry.zoneId || entry)),
    ...((packet?.campaignObjectives || []).map((entry) => entry.zoneId || entry)),
    ...((packet?.supportingAxes || packet?.supportingZones || []).map((entry) => entry.zoneId || entry)),
    ...(packet?.secondaryZones || []),
    ...(packet?.primaryZones || []),
    ...(packet?.campaignObjectiveZones || []),
  ].filter(Boolean);
}

function countRole(snapshot, role) {
  return (snapshot?.entries || []).filter((task) => (task.role || task.kind) === role).length;
}

function sumDoctrineMetric(statsByActor, key) {
  return Object.values(statsByActor || {}).reduce((sum, entry) => sum + (entry?.[key] || 0), 0);
}

function computeArtilleryDoctrineStats(run) {
  const actorIds = (run.state.scenario?.actors || []).map((actor) => actor.id);
  const scenarioUnits = run.state.scenario?.units || [];
  const firesOwnerIdsByActor = Object.fromEntries(actorIds.map((actorId) => [actorId, new Set()]));
  const stats = Object.fromEntries(actorIds.map((actorId) => {
    const artilleryUnitIds = scenarioUnits.filter((unit) => unit.actor === actorId && unit.type === "artillery").map((unit) => unit.id);
    return [actorId, {
      actorId,
      artilleryUnitCount: artilleryUnitIds.length,
      firesOwnerCount: 0,
      fireMissionTaskCount: 0,
      ammoTypedFireMissionCount: 0,
      ammoStampedSamples: 0,
      missionZoneStampedSamples: 0,
    }];
  }));

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actorId of actorIds) {
      const entry = stats[actorId];
      if (!entry || entry.artilleryUnitCount === 0) continue;
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      for (const ownerId of Object.keys(snapshot.commanderPlans?.[actorId] || {})) {
        if (ownerId?.endsWith("::fires")) firesOwnerIdsByActor[actorId].add(ownerId);
      }
      entry.fireMissionTaskCount += tasks.filter((task) => task.kind === "fire_mission").length;
      entry.ammoTypedFireMissionCount += tasks.filter((task) => task.kind === "fire_mission" && Boolean(task.ammoType)).length;
      const artilleryUnits = (snapshot.units || []).filter((unit) => unit.actor === actorId && unit.type === "artillery");
      entry.ammoStampedSamples += artilleryUnits.filter((unit) => Boolean(unit.fireMissionAmmoType)).length;
      entry.missionZoneStampedSamples += artilleryUnits.filter((unit) => Boolean(unit.fireMissionZoneId)).length;
    }
  }

  for (const actorId of actorIds) {
    if (!stats[actorId]) continue;
    stats[actorId].firesOwnerCount = firesOwnerIdsByActor[actorId].size;
  }

  return stats;
}

function getZoneHexes(zone) {
  return Array.from(new Set([
    ...(zone?.coreHexIds || []),
    ...(zone?.borderHexIds || []),
    ...(zone?.hexIds || []),
  ].filter(Boolean)));
}

function getRegressionSectorBucket(hex, cols) {
  const pos = parseUnitPosition(hex);
  if (!pos || !Number.isFinite(cols) || cols <= 0) return "center";
  const third = cols / 3;
  if (pos.c < third) return "west";
  if (pos.c < third * 2) return "center";
  return "east";
}

function findArtilleryRegressionLayout(zoneModel) {
  for (const zone of zoneModel?.zones || []) {
    const zoneHexes = getZoneHexes(zone)
      .map((hex) => ({ hex, pos: parseUnitPosition(hex) }))
      .filter((entry) => entry.pos);
    if (zoneHexes.length < 4) continue;
    for (const start of zoneHexes) {
      const sorted = zoneHexes
        .filter((entry) => entry.hex !== start.hex)
        .map((entry) => ({
          hex: entry.hex,
          pos: entry.pos,
          distance: hexDistance(start.pos.c, start.pos.r, entry.pos.c, entry.pos.r),
        }))
        .sort((left, right) => left.distance - right.distance);
      const nearbyTargets = sorted.filter((entry) => entry.distance >= 1 && entry.distance <= 2);
      const moveCandidates = [
        ...sorted.filter((entry) => entry.distance >= 3 && entry.distance <= 5),
        ...sorted.filter((entry) => entry.distance >= 2),
      ];
      for (let targetIndex = 0; targetIndex < nearbyTargets.length - 1; targetIndex += 1) {
        const redArtEntry = nearbyTargets[targetIndex];
        const redArmorEntry = nearbyTargets[targetIndex + 1];
        const occupiedHexes = new Set([redArtEntry.hex, redArmorEntry.hex]);
        const moveCandidate = moveCandidates.find((entry) => {
          if (occupiedHexes.has(entry.hex)) return false;
          const line = hexLine(start.pos.c, start.pos.r, entry.pos.c, entry.pos.r)
            .map((cell) => `${cell.col},${cell.row}`)
            .slice(1);
          return line.every((hex) => !occupiedHexes.has(hex));
        });
        if (!moveCandidate) continue;
        return {
          zoneId: zone.zoneId,
          startHex: start.hex,
          redArtHex: redArtEntry.hex,
          redArmorHex: redArmorEntry.hex,
          moveHex: moveCandidate.hex,
        };
      }
    }
    return {
      zoneId: zone.zoneId,
      startHex: zoneHexes[0].hex,
      redArtHex: zoneHexes[1].hex,
      redArmorHex: zoneHexes[2].hex,
      moveHex: zoneHexes[3].hex,
    };
  }
  return null;
}

function setRegressionUnitHex(unit, hex) {
  if (!unit || !hex) return;
  unit.position = hex;
  unit.status = "ready";
  unit.modeState = unit.modeState || {};
  unit.modeState.settledHex = hex;
  unit.modeState.travelState = null;
  unit.modeState.currentCommand = null;
  unit.modeState.commandQueue = [];
  unit.modeState.fireMission = null;
  unit.modeState.fireMissionAmmoType = null;
  unit.modeState.fireMissionZoneId = null;
  unit.modeState.fireMissionTargetHex = null;
}

function buildArtilleryRegressionState(terrainData, seed = 8811) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed,
    actorOverride: (actor) => ({
      controller: "player",
      isAi: false,
      aiConfig: {
        ...(actor.aiConfig || {}),
        directorEnabled: false,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const blueArtillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const redArtillery = (state.units || []).find((unit) => unit.actor === redId && unit.type === "artillery");
  const redArmor = (state.units || []).find((unit) => unit.actor === redId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  const layout = findArtilleryRegressionLayout(state.scenario?.zoneModel);
  if (!blueArtillery || !redArtillery || !redArmor || !layout) {
    return { error: "missing-artillery-layout" };
  }

  const keepIds = new Set([blueArtillery.id, redArtillery.id, redArmor.id]);
  for (const unit of state.units || []) {
    unit.modeState = unit.modeState || {};
    if (!keepIds.has(unit.id)) {
      unit.status = "destroyed";
      unit.strength = 0;
      unit.modeState.currentCommand = null;
      unit.modeState.travelState = null;
      continue;
    }
    unit.status = "ready";
    unit.strength = Math.max(unit.strength ?? 100, 100);
    unit.ammo = Math.max(unit.ammo ?? 100, 100);
    unit.readiness = Math.max(unit.readiness ?? 100, 100);
    unit.modeState.weaponCooldownMs = unit.actor === blueId ? 0 : 999999;
  }

  setRegressionUnitHex(blueArtillery, layout.startHex);
  setRegressionUnitHex(redArtillery, layout.redArtHex);
  setRegressionUnitHex(redArmor, layout.redArmorHex);
  state.combat.spotterPool = {
    [blueId]: {
      [redArtillery.id]: {
        firstSeenAtMs: 0,
        lastConfirmedAtMs: 0,
        expiresAtMs: 45000,
        quality: "observed",
        spotterId: blueArtillery.id,
        spotterType: blueArtillery.type,
        targetHex: layout.redArtHex,
        zoneId: layout.zoneId,
      },
      [redArmor.id]: {
        firstSeenAtMs: 0,
        lastConfirmedAtMs: 0,
        expiresAtMs: 45000,
        quality: "observed",
        spotterId: blueArtillery.id,
        spotterType: blueArtillery.type,
        targetHex: layout.redArmorHex,
        zoneId: layout.zoneId,
      },
    },
  };
  blueArtillery.modeState.fireMission = {
    taskId: "artillery-regression",
    ammoType: "destroy",
    zoneId: layout.zoneId,
    targetHex: layout.redArtHex,
    targetUnitIds: [redArtillery.id, redArmor.id],
    missionRadius: 1,
  };
  blueArtillery.modeState.fireMissionZoneId = layout.zoneId;
  blueArtillery.modeState.fireMissionTargetHex = layout.redArtHex;

  return {
    state,
    blueArtilleryId: blueArtillery.id,
    redArtilleryId: redArtillery.id,
    redArmorId: redArmor.id,
    zoneId: layout.zoneId,
    moveHex: layout.moveHex,
  };
}

function chooseArtilleryRegressionMoveHex(state, terrainData, blueArtilleryId, zoneId, blockedHexes = new Set()) {
  const blueUnit = (state.units || []).find((unit) => unit.id === blueArtilleryId);
  const zone = (state.scenario?.zoneModel?.zones || []).find((entry) => entry.zoneId === zoneId) || null;
  const startPos = parseUnitPosition(blueUnit?.position || blueUnit?.modeState?.settledHex || "");
  if (!blueUnit || !zone || !startPos) return null;
  const candidates = getZoneHexes(zone)
    .filter((hex) => hex && hex !== blueUnit.position && !blockedHexes.has(hex))
    .map((hex) => ({
      hex,
      pos: parseUnitPosition(hex),
    }))
    .filter((entry) => entry.pos)
    .sort((left, right) => (
      hexDistance(startPos.c, startPos.r, left.pos.c, left.pos.r)
      - hexDistance(startPos.c, startPos.r, right.pos.c, right.pos.r)
    ));
  for (const candidate of candidates) {
    const distance = hexDistance(startPos.c, startPos.r, candidate.pos.c, candidate.pos.r);
    if (distance < 1) continue;
    const trialState = structuredClone(state);
    const moveCommand = createRtsCommand({
      unitIds: [blueArtilleryId],
      kind: "move",
      targetHex: candidate.hex,
    }, "regression_probe");
    const reduced = reduceRtsCommand(trialState, terrainData, moveCommand, "script");
    const trialBlue = (reduced.units || []).find((unit) => unit.id === blueArtilleryId);
    const route = trialBlue?.modeState?.travelState?.route || [];
    if (route.length < 2) continue;
    const blockedAlongRoute = route.slice(1).some((hex) => blockedHexes.has(hex));
    if (!blockedAlongRoute) return candidate.hex;
  }
  return null;
}

function runCounterBatteryRegression(terrainData) {
  const setup = buildArtilleryRegressionState(terrainData, 8811);
  if (setup.error) {
    return { passed: false, error: setup.error, queuedImpact: false, targetId: null, targetType: null };
  }
  const blueUnit = (setup.state.units || []).find((unit) => unit.id === setup.blueArtilleryId);
  if (!blueUnit) {
    return { passed: false, error: "missing-blue-artillery", queuedImpact: false, targetId: null, targetType: null };
  }
  blueUnit.modeState.fireMissionAmmoType = "counter_battery";
  blueUnit.modeState.fireMission = {
    ...(blueUnit.modeState.fireMission || {}),
    taskId: "counter-battery-regression",
    ammoType: "counter_battery",
    zoneId: setup.zoneId,
    targetHex: (setup.state.units || []).find((unit) => unit.id === setup.redArtilleryId)?.position || blueUnit.modeState.fireMissionTargetHex,
    targetUnitIds: [setup.redArtilleryId, setup.redArmorId],
    missionRadius: 1,
  };
  blueUnit.modeState.fireMissionTargetHex = (setup.state.units || []).find((unit) => unit.id === setup.redArtilleryId)?.position || blueUnit.modeState.fireMissionTargetHex;

  const nextState = tickRtsMatch(setup.state, terrainData);
  const impact = (nextState.combat?.pendingImpacts || []).find((entry) => entry.sourceId === setup.blueArtilleryId) || null;
  const target = impact ? (nextState.units || []).find((unit) => unit.id === impact.targetId) : null;
  return {
    passed: impact?.targetId === setup.redArtilleryId,
    queuedImpact: Boolean(impact),
    targetId: impact?.targetId || null,
    targetType: target?.type || null,
    preferredTargetId: setup.redArtilleryId,
    alternateTargetId: setup.redArmorId,
    zoneId: setup.zoneId,
  };
}

function runArtilleryEmplacementRegression(terrainData) {
  const setup = buildArtilleryRegressionState(terrainData, 8812);
  if (setup.error) {
    return { passed: false, error: setup.error, movingFireObserved: false, arrived: false, emplacedFireObserved: false };
  }
  const moveHex = chooseArtilleryRegressionMoveHex(
    setup.state,
    terrainData,
    setup.blueArtilleryId,
    setup.zoneId,
    new Set([
      (setup.state.units || []).find((unit) => unit.id === setup.redArtilleryId)?.position,
      (setup.state.units || []).find((unit) => unit.id === setup.redArmorId)?.position,
    ].filter(Boolean))
  ) || setup.moveHex;
  const moveCommand = createRtsCommand({
    unitIds: [setup.blueArtilleryId],
    kind: "move",
    targetHex: moveHex,
  }, "regression_move");
  let state = reduceRtsCommand(setup.state, terrainData, moveCommand, "script");
  const blueUnit = (state.units || []).find((unit) => unit.id === setup.blueArtilleryId);
  if (blueUnit) {
    if (blueUnit.modeState?.travelState) {
      const tickMs = state.game?.tickMs || 250;
      const movementScale = state.game?.movementTimeScale || 10;
      blueUnit.modeState.travelState.progressMs = 0;
      blueUnit.modeState.travelState.segmentMs = Math.max(tickMs * 2, tickMs);
      blueUnit.modeState.travelState.movementTimeScale = movementScale;
      blueUnit.modeState.travelState.segmentScale = movementScale;
    }
    blueUnit.modeState.fireMissionAmmoType = "destroy";
    blueUnit.modeState.fireMission = {
      ...(blueUnit.modeState.fireMission || {}),
      taskId: "emplacement-regression",
      ammoType: "destroy",
      zoneId: setup.zoneId,
      targetHex: (state.units || []).find((unit) => unit.id === setup.redArtilleryId)?.position || null,
      targetUnitIds: [setup.redArtilleryId],
      missionRadius: 1,
    };
    blueUnit.modeState.fireMissionZoneId = setup.zoneId;
    blueUnit.modeState.fireMissionTargetHex = (state.units || []).find((unit) => unit.id === setup.redArtilleryId)?.position || null;
  }

  let movingFireObserved = false;
  let arrived = false;
  let emplacedFireObserved = false;
  for (let tick = 0; tick < 24; tick += 1) {
    const marchingBlue = (state.units || []).find((unit) => unit.id === setup.blueArtilleryId);
    if (marchingBlue?.modeState?.travelState) {
      const tickMs = state.game?.tickMs || 250;
      const movementScale = state.game?.movementTimeScale || 10;
      marchingBlue.modeState.travelState.segmentMs = Math.max(tickMs * 2, tickMs);
      marchingBlue.modeState.travelState.movementTimeScale = movementScale;
      marchingBlue.modeState.travelState.segmentScale = movementScale;
    }
    state = tickRtsMatch(state, terrainData);
    const liveBlue = (state.units || []).find((unit) => unit.id === setup.blueArtilleryId);
    const blueImpacts = (state.combat?.pendingImpacts || []).filter((impact) => impact.sourceId === setup.blueArtilleryId);
    if (liveBlue?.modeState?.travelState && blueImpacts.length > 0) {
      movingFireObserved = true;
    }
    if (!liveBlue?.modeState?.travelState) {
      arrived = true;
      if (blueImpacts.length > 0) {
        emplacedFireObserved = true;
        break;
      }
      state = tickRtsMatch(state, terrainData);
      emplacedFireObserved = (state.combat?.pendingImpacts || []).some((impact) => impact.sourceId === setup.blueArtilleryId);
      break;
    }
  }

  return {
    passed: arrived && !movingFireObserved && emplacedFireObserved,
    movingFireObserved,
    arrived,
    emplacedFireObserved,
    moveHex,
    zoneId: setup.zoneId,
  };
}

function chooseOverHorizonAreaTargetHex(zoneModel, originHex) {
  const origin = parseUnitPosition(originHex);
  if (!origin) return null;
  for (const zone of zoneModel?.zones || []) {
    for (const hex of getZoneHexes(zone)) {
      if (!hex || hex === originHex) continue;
      const pos = parseUnitPosition(hex);
      if (!pos) continue;
      const distance = hexDistance(origin.c, origin.r, pos.c, pos.r);
      if (distance >= 5 && distance <= 7) {
        return { hex, zoneId: zone.zoneId };
      }
    }
  }
  return null;
}

function runOverHorizonAreaFireRegression(terrainData) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed: 8813,
    actorOverride: (actor) => ({
      controller: "player",
      isAi: false,
      aiConfig: {
        ...(actor.aiConfig || {}),
        directorEnabled: false,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 8813 });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const blueArtillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const enemy = (state.units || []).find((unit) => unit.actor === redId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  if (!blueId || !redId || !blueArtillery || !enemy) {
    return { passed: false, error: "missing-over-horizon-fixture" };
  }

  for (const unit of state.units || []) {
    unit.modeState = unit.modeState || {};
    if (unit.id !== blueArtillery.id && unit.id !== enemy.id) {
      unit.status = "destroyed";
      unit.strength = 0;
      unit.modeState.currentCommand = null;
      unit.modeState.travelState = null;
      continue;
    }
    unit.status = "ready";
    unit.strength = Math.max(unit.strength ?? 100, 100);
    unit.ammo = Math.max(unit.ammo ?? 100, 100);
    unit.readiness = Math.max(unit.readiness ?? 100, 100);
    unit.modeState.weaponCooldownMs = 0;
  }

  setRegressionUnitHex(blueArtillery, "1,3");
  const target = chooseOverHorizonAreaTargetHex(state.scenario?.zoneModel, blueArtillery.position);
  if (!target?.hex || !target.zoneId) {
    return { passed: false, error: "missing-over-horizon-target" };
  }
  setRegressionUnitHex(enemy, target.hex);
  state.game.elapsedMs = 10000;
  state.combat.spotterPool = {
    [blueId]: {
      [enemy.id]: {
        firstSeenAtMs: 0,
        lastConfirmedAtMs: 9000,
        expiresAtMs: 9000 + 45000,
        quality: "observed",
        spotterId: "memory",
        spotterType: "recon",
        targetHex: target.hex,
        zoneId: target.zoneId,
      },
    },
  };
  state.perceptionState = {
    [blueId]: {
      visibleCells: [],
      detectedUnits: [],
      contactUnits: [],
      lastKnown: {
        [enemy.id]: {
          position: target.hex,
          seenAtMs: 9000,
          type: enemy.type,
          strength: enemy.strength,
        },
      },
    },
    [redId]: {
      visibleCells: [],
      detectedUnits: [],
      contactUnits: [],
      lastKnown: {},
    },
  };
  blueArtillery.modeState.fireMission = {
    taskId: "over-horizon-area-fire",
    ammoType: "destroy",
    zoneId: target.zoneId,
    targetHex: target.hex,
    targetUnitIds: [],
    missionRadius: 1,
  };
  blueArtillery.modeState.fireMissionAmmoType = "destroy";
  blueArtillery.modeState.fireMissionZoneId = target.zoneId;
  blueArtillery.modeState.fireMissionTargetHex = target.hex;

  const nextState = tickRtsMatch(state, terrainData);
  const impacts = (nextState.combat?.pendingImpacts || []).filter((impact) => impact.sourceId === blueArtillery.id);
  const view = nextState.perceptionState?.[blueId] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  return {
    passed: impacts.length > 0
      && impacts[0]?.targetHex === target.hex
      && (view.detectedUnits?.length || 0) === 0
      && (view.contactUnits?.length || 0) === 0
      && (blueArtillery.modeState.fireMission?.targetUnitIds?.length || 0) === 0,
    queuedImpact: impacts.length > 0,
    targetHex: impacts[0]?.targetHex || null,
    detectedCount: view.detectedUnits?.length || 0,
    contactCount: view.contactUnits?.length || 0,
    lastKnownCount: Object.keys(view.lastKnown || {}).length,
  };
}

function runPreparatoryAreaFireRegression(terrainData) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed: 8814,
    actorOverride: (actor) => ({
      controller: "player",
      isAi: false,
      aiConfig: {
        ...(actor.aiConfig || {}),
        directorEnabled: false,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 8814 });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const blueArtillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const enemy = (state.units || []).find((unit) => unit.actor === redId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  if (!blueId || !redId || !blueArtillery || !enemy) {
    return { passed: false, error: "missing-preparatory-fire-fixture" };
  }

  for (const unit of state.units || []) {
    unit.modeState = unit.modeState || {};
    if (unit.id !== blueArtillery.id && unit.id !== enemy.id) {
      unit.status = "destroyed";
      unit.strength = 0;
      unit.modeState.currentCommand = null;
      unit.modeState.travelState = null;
      continue;
    }
    unit.status = "ready";
    unit.strength = Math.max(unit.strength ?? 100, 100);
    unit.ammo = Math.max(unit.ammo ?? 100, 100);
    unit.readiness = Math.max(unit.readiness ?? 100, 100);
    unit.modeState.weaponCooldownMs = 0;
  }

  setRegressionUnitHex(blueArtillery, "1,3");
  const target = chooseOverHorizonAreaTargetHex(state.scenario?.zoneModel, blueArtillery.position);
  if (!target?.hex || !target.zoneId) {
    return { passed: false, error: "missing-preparatory-target" };
  }
  setRegressionUnitHex(enemy, target.hex);
  state.game.elapsedMs = 10000;
  state.combat.spotterPool = { [blueId]: {} };
  state.perceptionState = {
    [blueId]: {
      visibleCells: [],
      detectedUnits: [],
      contactUnits: [],
      lastKnown: {},
    },
    [redId]: {
      visibleCells: [],
      detectedUnits: [],
      contactUnits: [],
      lastKnown: {},
    },
  };
  blueArtillery.modeState.fireMission = {
    taskId: "preparatory-area-fire",
    ammoType: "destroy",
    zoneId: target.zoneId,
    targetHex: target.hex,
    targetUnitIds: [],
    missionRadius: 1,
  };
  blueArtillery.modeState.fireMissionAmmoType = "destroy";
  blueArtillery.modeState.fireMissionZoneId = target.zoneId;
  blueArtillery.modeState.fireMissionTargetHex = target.hex;

  const nextState = tickRtsMatch(state, terrainData);
  const impacts = (nextState.combat?.pendingImpacts || []).filter((impact) => impact.sourceId === blueArtillery.id);
  const view = nextState.perceptionState?.[blueId] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  return {
    passed: impacts.length > 0
      && impacts[0]?.targetHex === target.hex
      && impacts[0]?.targetId == null
      && (view.detectedUnits?.length || 0) === 0
      && (view.contactUnits?.length || 0) === 0
      && Object.keys(view.lastKnown || {}).length === 0,
    queuedImpact: impacts.length > 0,
    targetHex: impacts[0]?.targetHex || null,
    targetId: impacts[0]?.targetId || null,
    detectedCount: view.detectedUnits?.length || 0,
    contactCount: view.contactUnits?.length || 0,
    lastKnownCount: Object.keys(view.lastKnown || {}).length,
  };
}

function getZoneIdForHex(zoneModel, hex) {
  return zoneModel?.interiorHexZoneMap?.[hex] || zoneModel?.hexZoneMap?.[hex] || null;
}

function computeZoneConcentrationViolations(run, {
  maxShare = 0.6,
  maxDurationMs = 90000,
} = {}) {
  const snapshots = run.state.replay?.snapshots || [];
  const violations = [];
  const maneuverRoles = new Set(["main_effort", "supporting_attack", "screen", "contain", "relief", "counterattack", "support_by_fire"]);

  for (const actor of run.state.scenario?.actors || []) {
    let streak = null;
    let previousAtMs = null;
    for (const snapshot of snapshots) {
      const tasks = Object.values(snapshot.commanderPlans?.[actor.id] || {})
        .filter((task) => maneuverRoles.has(task.role || task.kind));
      const zoneCounts = {};
      for (const task of tasks) {
        const zoneId = task.zoneId || "local";
        zoneCounts[zoneId] = (zoneCounts[zoneId] || 0) + 1;
      }
      const topEntry = Object.entries(zoneCounts).sort((left, right) => right[1] - left[1])[0] || null;
      const share = topEntry && tasks.length > 0 ? topEntry[1] / tasks.length : 0;
      const nonFriendlyZones = Object.values(snapshot.zoneAnalysis?.perSide?.[actor.id] || {}).filter((zone) => zone.state !== "friendly").length;
      const overloaded = tasks.length >= 2 && share > maxShare && nonFriendlyZones > 1;

      if (overloaded) {
        if (!streak) {
          streak = {
            actorId: actor.id,
            zoneId: topEntry?.[0] || null,
            startMs: snapshot.atMs,
            maxShareObserved: share,
          };
        } else {
          streak.maxShareObserved = Math.max(streak.maxShareObserved, share);
        }
      } else if (streak) {
        const durationMs = Math.max(0, (previousAtMs ?? snapshot.atMs) - streak.startMs);
        if (durationMs > maxDurationMs) {
          violations.push({ ...streak, endMs: previousAtMs ?? snapshot.atMs, durationMs });
        }
        streak = null;
      }

      previousAtMs = snapshot.atMs;
    }

    if (streak && previousAtMs != null) {
      const durationMs = Math.max(0, previousAtMs - streak.startMs);
      if (durationMs > maxDurationMs) {
        violations.push({ ...streak, endMs: previousAtMs, durationMs });
      }
    }
  }

  return violations;
}

function computeSupportResidency(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  const assignmentsByActor = Object.fromEntries(
    Object.entries(run.state.ai?.subordinates || {}).map(([actorId, subordinateState]) => [actorId, subordinateState?.assignments || {}])
  );
  const unitMeta = Object.fromEntries((run.state.units || []).map((unit) => [unit.id, { type: unit.type, actor: unit.actor }]));
  const supportTypes = new Set(["artillery", "headquarters", "logistics"]);
  const stats = {};

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const unit of snapshot.units || []) {
      const meta = unitMeta[unit.id];
      if (!meta || !supportTypes.has(meta.type) || unit.status === "destroyed") continue;
      const actorId = meta.actor;
      const ownerId = assignmentsByActor[actorId]?.[unit.id]?.owner || null;
      const zoneId = getZoneIdForHex(zoneModel, unit.position);
      const zoneSnapshot = snapshot.zoneAnalysis?.perSide?.[actorId]?.[zoneId] || null;
      const groupPlan = snapshot.subordinatePlans?.[actorId]?.[ownerId] || null;
      const actorPlans = Object.values(snapshot.subordinatePlans?.[actorId] || {});
      const stagingZoneId = getZoneIdForHex(zoneModel, groupPlan?.stagingHex);
      const supportZoneId = getZoneIdForHex(zoneModel, groupPlan?.supportByFireHexes?.[0]);
      const unitPos = unit.position ? parseUnitPosition(unit.position) : null;
      const assaultPos = groupPlan?.assaultHex ? parseUnitPosition(groupPlan.assaultHex) : null;
      const anchoredByActorSupportPlan = actorPlans.some((plan) => {
        if (!["rear_security", "reserve", "support_by_fire"].includes(plan?.role)) return false;
        const planStagingZoneId = getZoneIdForHex(zoneModel, plan?.stagingHex);
        const planSupportZoneId = getZoneIdForHex(zoneModel, plan?.supportByFireHexes?.[0]);
        return zoneId && (
          plan.zoneId === zoneId
          || planStagingZoneId === zoneId
          || planSupportZoneId === zoneId
        );
      });
      const tooFarForward = Boolean(
        unitPos
        && assaultPos
        && hexDistance(unitPos.c, unitPos.r, assaultPos.c, assaultPos.r) <= 1
      );
      const safeResidency = Boolean(
        zoneSnapshot
        && !tooFarForward
        && (
          zoneSnapshot.tags?.includes("rear")
          || zoneSnapshot.tags?.includes("transition")
          || (zoneSnapshot.state === "friendly" && ((zoneSnapshot.borderMix?.enemy || 0) + (zoneSnapshot.borderMix?.contested || 0)) <= 0.45)
          || (zoneSnapshot.state === "neutral" && ((zoneSnapshot.borderMix?.enemy || 0) + (zoneSnapshot.borderMix?.contested || 0)) <= 0.2)
          || (stagingZoneId && stagingZoneId === zoneId)
          || (groupPlan?.role === "support_by_fire" && supportZoneId && supportZoneId === zoneId)
          || anchoredByActorSupportPlan
        )
      );

      if (!stats[actorId]) {
        stats[actorId] = {
          actorId,
          totalSamples: 0,
          safeSamples: 0,
          unitIds: new Set(),
        };
      }
      stats[actorId].totalSamples += 1;
      stats[actorId].safeSamples += safeResidency ? 1 : 0;
      stats[actorId].unitIds.add(unit.id);
    }
  }

  return Object.fromEntries(
    Object.entries(stats).map(([actorId, entry]) => [actorId, {
      actorId,
      totalSamples: entry.totalSamples,
      safeSamples: entry.safeSamples,
      ratio: entry.totalSamples > 0 ? entry.safeSamples / entry.totalSamples : 0,
      unitCount: entry.unitIds.size,
    }])
  );
}

function computeObjectiveApproachCoverage(run, {
  roles = new Set(["main_effort", "supporting_attack"]),
  radius = 2,
} = {}) {
  const zoneModel = run.state.scenario?.zoneModel;
  const objectives = run.state.scenario?.objectives?.hexVP || run.state.scenario?.victoryConditions?.hexVP || [];
  const objectiveByZone = Object.fromEntries(
    objectives
      .map((objective) => [getObjectiveZoneId(zoneModel, objective.hex), objective])
      .filter(([zoneId]) => Boolean(zoneId))
  );
  const stats = {};
  for (const snapshot of collectCommanderPlanSnapshots(run)) {
    for (const task of snapshot.entries || []) {
      const role = task.role || task.kind || "none";
      if (!roles.has(role) || !task.zoneId || !task.targetHex) continue;
      const objective = objectiveByZone[task.zoneId];
      if (!objective?.hex) continue;
      const objectivePos = parseUnitPosition(objective.hex);
      const targetPos = task.targetHex ? parseUnitPosition(task.targetHex) : null;
      if (!objectivePos || !targetPos) continue;
      const aligned = hexDistance(targetPos.c, targetPos.r, objectivePos.c, objectivePos.r) <= radius;
      if (!stats[snapshot.actorId]) {
        stats[snapshot.actorId] = {
          actorId: snapshot.actorId,
          totalPlans: 0,
          alignedPlans: 0,
          misses: [],
        };
      }
      stats[snapshot.actorId].totalPlans += 1;
      stats[snapshot.actorId].alignedPlans += aligned ? 1 : 0;
      if (!aligned && stats[snapshot.actorId].misses.length < 8) {
        stats[snapshot.actorId].misses.push({
          atMs: snapshot.atMs,
          zoneId: task.zoneId,
          targetHex: task.targetHex,
          objectiveHex: objective.hex,
          role,
        });
      }
    }
  }
  return Object.fromEntries(
    Object.entries(stats).map(([actorId, entry]) => [actorId, {
      actorId,
      totalPlans: entry.totalPlans,
      alignedPlans: entry.alignedPlans,
      ratio: entry.totalPlans > 0 ? entry.alignedPlans / entry.totalPlans : 1,
      misses: entry.misses,
    }])
  );
}

function computeHeadquartersExposure(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  const assignmentsByActor = Object.fromEntries(
    Object.entries(run.state.ai?.subordinates || {}).map(([actorId, subordinateState]) => [actorId, subordinateState?.assignments || {}])
  );
  const unitMeta = Object.fromEntries((run.state.units || []).map((unit) => [unit.id, { type: unit.type, actor: unit.actor }]));
  const stats = {};
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const unit of snapshot.units || []) {
      const meta = unitMeta[unit.id];
      if (!meta || meta.type !== "headquarters" || unit.status === "destroyed") continue;
      const actorId = meta.actor;
      const ownerId = assignmentsByActor[actorId]?.[unit.id]?.owner || unit.id;
      const zoneId = getZoneIdForHex(zoneModel, unit.position);
      const zoneSnapshot = snapshot.zoneAnalysis?.perSide?.[actorId]?.[zoneId] || null;
      const groupPlan = snapshot.subordinatePlans?.[actorId]?.[ownerId] || null;
      const unitPos = unit.position ? parseUnitPosition(unit.position) : null;
      const assaultHex = groupPlan?.assaultHex || null;
      const anchorHex = groupPlan?.reserveHex || groupPlan?.stagingHex || groupPlan?.fallbackHex || null;
      const assaultPos = assaultHex ? parseUnitPosition(assaultHex) : null;
      const anchorPos = anchorHex ? parseUnitPosition(anchorHex) : null;
      const exposedZone = Boolean(
        zoneSnapshot
        && (
          zoneSnapshot.state === "enemy"
          || zoneSnapshot.state === "contested"
          || (
            !zoneSnapshot.tags?.includes("rear")
            && !zoneSnapshot.tags?.includes("transition")
            && ((zoneSnapshot.borderMix?.enemy || 0) + (zoneSnapshot.borderMix?.contested || 0)) > 0.35
          )
        )
      );
      const exposedByPlan = Boolean(
        unitPos
        && assaultPos
        && anchorPos
        && hexDistance(unitPos.c, unitPos.r, assaultPos.c, assaultPos.r) <= 1
        && hexDistance(unitPos.c, unitPos.r, assaultPos.c, assaultPos.r) < hexDistance(unitPos.c, unitPos.r, anchorPos.c, anchorPos.r)
      );
      if (!stats[actorId]) {
        stats[actorId] = {
          actorId,
          totalSamples: 0,
          exposedSamples: 0,
        };
      }
      stats[actorId].totalSamples += 1;
      stats[actorId].exposedSamples += (exposedZone || exposedByPlan) ? 1 : 0;
    }
  }
  return Object.fromEntries(
    Object.entries(stats).map(([actorId, entry]) => [actorId, {
      actorId,
      totalSamples: entry.totalSamples,
      exposedSamples: entry.exposedSamples,
      exposureRatio: entry.totalSamples > 0 ? entry.exposedSamples / entry.totalSamples : 0,
    }])
  );
}

function computeStackCollisionHotspots(run) {
  const collisions = (run.state.truthState?.eventLog || []).filter((entry) => (
    entry.kind === "movement"
    && /stack limit/i.test(entry.message || "")
    && entry.details?.targetHex
  ));
  const byHex = {};
  for (const collision of collisions) {
    byHex[collision.details.targetHex] = (byHex[collision.details.targetHex] || 0) + 1;
  }
  const hotspots = Object.entries(byHex)
    .map(([hex, count]) => ({ hex, count }))
    .sort((left, right) => right.count - left.count);
  return {
    totalEvents: collisions.length,
    maxEventsPerHex: hotspots[0]?.count || 0,
    hotspots: hotspots.slice(0, 6),
  };
}

function runZoneTaskCompletionRegression(baseScenario, terrainData) {
  const scenario = buildScenario(baseScenario, {
    seed: 7781,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 7781 });
  const blueId = scenario.actors?.[0]?.id;
  const targetObjective = (scenario.victoryConditions?.hexVP || []).find((objective) => objective.name === "South Ford")
    || (scenario.victoryConditions?.hexVP || [])[0]
    || null;
  if (!blueId || !targetObjective?.hex) {
    return { completed: false, objectiveController: null, zoneController: null, activeQueueLength: 1 };
  }
  const targetZoneId = getObjectiveZoneId(state.scenario?.zoneModel, targetObjective.hex);
  const targetZone = (state.scenario?.zoneModel?.zones || []).find((zone) => zone.zoneId === targetZoneId);
  const maneuverBlue = (state.units || []).filter((unit) => unit.actor === blueId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  const maneuverRed = (state.units || []).filter((unit) => unit.actor !== blueId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  const ownerUnits = maneuverBlue;
  const ownerBaseId = "completion-owner";
  const zoneCells = [...(targetZone?.borderHexIds || []), ...(targetZone?.hexIds || [])].filter((hex) => hex && hex !== targetObjective.hex);
  const fallbackZone = (state.scenario?.zoneModel?.zones || []).find((zone) => zone.zoneId && zone.zoneId !== targetZoneId);
  const fallbackCells = [...(fallbackZone?.hexIds || []), ...(fallbackZone?.borderHexIds || [])].filter(Boolean);
  const syntheticTargetHex = zoneCells[0] || targetZone?.centroidHex || targetObjective.hex;
  const mapCols = state.scenario?.map?.cols || terrainData?.cols || 12;
  const ownerSectorBucket = getRegressionSectorBucket(syntheticTargetHex, mapCols);
  const ownerZoneCells = zoneCells.filter((hex) => getRegressionSectorBucket(hex, mapCols) === ownerSectorBucket);
  const ownerId = `${ownerBaseId}::maneuver::${ownerSectorBucket}`;

  ownerUnits.forEach((unit, index) => {
    unit.parentHQ = ownerBaseId;
    unit.position = ownerZoneCells[index % Math.max(ownerZoneCells.length, 1)] || syntheticTargetHex || unit.position;
  });
  maneuverRed.forEach((unit, index) => {
    unit.position = fallbackCells[index % Math.max(fallbackCells.length, 1)] || unit.position;
  });

  const task = {
    id: "completion-regression-task",
    owner: ownerId,
    kind: "main_effort",
    role: "main_effort",
    zoneId: targetZoneId,
    edgeId: null,
    laneId: null,
    targetHex: syntheticTargetHex,
    stagingHex: syntheticTargetHex,
    supportHexes: [],
    fallbackHex: syntheticTargetHex,
    summary: "Completion regression task.",
    provenance: "doctrine",
    assignedAtMs: state.game.elapsedMs,
  };

  state.truthState.objectives[targetObjective.hex] = {
    controller: null,
    heldMs: 0,
    candidateController: null,
    candidateHeldMs: 0,
    seededFromBootstrap: false,
  };
  state.ai.commanders[blueId] = {
    lastRunAtMs: state.game.elapsedMs - 16000,
    ownerTasks: { [ownerId]: [{ ...task }] },
    ownerZoneTasks: { [ownerId]: { ...task } },
    hypotheses: null,
    replanLog: [],
    taskInvalidations: [],
    operations: {
      main: null,
      support: [],
      lastDeepReviewAtMs: null,
      lastLightReviewAtMs: null,
      alerts: [],
      lastDirectorAdvice: null,
    },
  };
  state.ai.subordinates[blueId] = {
    lastRunAtMs: state.game.elapsedMs - 6000,
    assignments: Object.fromEntries(ownerUnits.map((unit) => [unit.id, { owner: ownerId, source: "parentHQ" }])),
    owners: {},
    taskQueues: { [ownerId]: [{ ...task }] },
    reports: {},
    completedTaskIds: {},
    groupPlans: {},
    staleTaskLog: [],
  };

  const nextState = tickRtsMatch(state, terrainData);
  const commanderInvalidation = (nextState.ai?.commanders?.[blueId]?.taskInvalidations || []).find((entry) => (
    entry.ownerId === ownerId && entry.taskId === task.id
  )) || null;
  const activeTask = nextState.ai?.subordinates?.[blueId]?.taskQueues?.[ownerId]?.[0] || null;
  const completed = nextState.ai?.subordinates?.[blueId]?.completedTaskIds?.[ownerId] === task.id;
  const retiredOriginalTask = !activeTask || activeTask.id !== task.id;
  return {
    passed: (completed && retiredOriginalTask) || (Boolean(commanderInvalidation) && retiredOriginalTask),
    completed,
    commanderInvalidated: Boolean(commanderInvalidation),
    invalidationReason: commanderInvalidation?.reason || null,
    nextRole: activeTask?.role || null,
    nextTaskId: activeTask?.id || null,
    objectiveController: nextState.truthState?.objectives?.[targetObjective.hex]?.controller || null,
    zoneController: nextState.zoneAnalysis?.truth?.byZone?.[targetZoneId]?.controller || null,
    activeQueueLength: nextState.ai?.subordinates?.[blueId]?.taskQueues?.[ownerId]?.length || 0,
  };
}

function runObjectiveControlRegression(baseScenario, terrainData) {
  const scenario = buildScenario(baseScenario, {
    seed: 7782,
    rtsOptions: { objectiveHoldSeconds: 2 },
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  let state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 7782 });
  const blueId = scenario.actors?.[0]?.id;
  const targetObjective = scenario.victoryConditions?.hexVP?.[0] || scenario.objectives?.hexVP?.[0] || null;
  const targetZoneId = targetObjective ? getObjectiveZoneId(state.scenario?.zoneModel, targetObjective.hex) : null;
  const targetZone = (state.scenario?.zoneModel?.zones || []).find((zone) => zone.zoneId === targetZoneId) || null;
  const fallbackZone = (state.scenario?.zoneModel?.zones || []).find((zone) => zone.zoneId && zone.zoneId !== targetZoneId) || null;
  const targetCells = [...(targetZone?.hexIds || []), ...(targetZone?.borderHexIds || [])].filter(Boolean);
  const fallbackCells = [...(fallbackZone?.hexIds || []), ...(fallbackZone?.borderHexIds || [])].filter(Boolean);
  if (!blueId || !targetObjective?.hex || targetCells.length === 0 || fallbackCells.length === 0) {
    return { candidateController: null, controller: null, candidateHeldMs: 0, holdRequiredMs: 0 };
  }
  state.units.forEach((unit, index) => {
    if (unit.actor === blueId && !["headquarters", "artillery", "logistics"].includes(unit.type)) {
      unit.position = targetCells[index % targetCells.length];
    } else if (unit.actor !== blueId) {
      unit.position = fallbackCells[index % fallbackCells.length];
    }
  });
  state.truthState.openingControlPrimed = true;
  state.truthState.openingZoneOwners = { ...(state.truthState.openingZoneOwners || {}), [targetZoneId]: blueId };
  state.truthState.objectives[targetObjective.hex] = {
    controller: null,
    heldMs: 0,
    candidateController: null,
    candidateHeldMs: 0,
    seededFromBootstrap: false,
  };
  for (let index = 0; index < 12; index += 1) {
    state = tickRtsMatch(state, terrainData);
  }
  const record = state.truthState?.objectives?.[targetObjective.hex] || {};
  return {
    candidateController: record.candidateController || null,
    controller: record.controller || null,
    candidateHeldMs: record.candidateHeldMs || 0,
    holdRequiredMs: (scenario.rtsOptions?.objectiveHoldSeconds || 0) * 1000,
  };
}

function runOpeningBootstrapRegression(baseScenario, terrainData) {
  const scenario = buildScenario(baseScenario, {
    seed: 7783,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 7783 });
  const next = tickRtsMatch(state, terrainData);
  const actor = scenario.actors?.[0];
  const anchorZoneIds = next.scenario?.zoneModel?.actorAnchors?.[actor?.id]?.startZoneIds || [];
  const uncontestedAnchors = anchorZoneIds.filter((zoneId) => scenario.actors.every((candidate) => {
    if (candidate.id === actor.id) return true;
    const snapshot = next.zoneAnalysis?.perSide?.[candidate.id]?.[zoneId];
    return (snapshot?.controlShare || 0) < 0.12 && (snapshot?.friendlyHoldingPower || 0) < 0.8;
  }));
  const friendlyAnchors = uncontestedAnchors.filter((zoneId) => (
    next.zoneAnalysis?.truth?.byZone?.[zoneId]?.controller === actor.id
    || next.zoneAnalysis?.perSide?.[actor.id]?.[zoneId]?.state === "friendly"
  ));
  return {
    primed: Boolean(next.truthState?.openingControlPrimed),
    seededZoneCount: Object.keys(next.truthState?.openingZoneOwners || {}).length,
    uncontestedAnchorCount: uncontestedAnchors.length,
    friendlyAnchorCount: friendlyAnchors.length,
  };
}

function runVpZoneOutlineRegression(baseScenario, terrainData) {
  const scenario = buildScenario(baseScenario, { seed: 7784 });
  scenario.victoryConditions = {
    ...(scenario.victoryConditions || {}),
    hexVP: [
      { hex: "3,4", name: "North Ridge", vp: 80 },
      { hex: "4,4", name: "North Spur", vp: 20 },
      { hex: "10,6", name: "South Ford", vp: 20 },
    ],
  };
  const zoneModelA = buildZoneModel(scenario, terrainData);
  const zoneModelB = buildZoneModel(scenario, terrainData);
  const outlinesA = buildVpZoneOutlines(zoneModelA);
  const outlinesB = buildVpZoneOutlines(zoneModelB);
  const mergedOutline = outlinesA.find((outline) => (outline.objectiveHexes?.length || 0) > 1) || null;
  return {
    outlineCount: outlinesA.length,
    stable: JSON.stringify(outlinesA) === JSON.stringify(outlinesB),
    allSegmented: outlinesA.every((outline) => Array.isArray(outline.segments) && outline.segments.length > 0),
    mergedOutlinePresent: Boolean(mergedOutline),
  };
}

function runCriticalVpVictoryRegression(baseScenario, terrainData) {
  const objectiveSet = [
    { hex: "3,4", name: "Stonebrook Bridge", vp: 150 },
    { hex: "6,9", name: "South Crossing", vp: 150 },
    { hex: "10,6", name: "Highland Airstrip", vp: 150 },
  ];
  const buildVictoryState = (seed) => {
    const scenario = buildScenario(baseScenario, {
      seed,
      rtsOptions: {
        objectiveHoldSeconds: 120,
        durationLimitMinutes: 30,
      },
      actorOverride: (actor, index) => ({
        controller: "ai",
        isAi: true,
        cvpHexes: index === 0 ? ["3,4"] : ["10,6"],
        aiConfig: {
          ...(actor.aiConfig || {}),
          engine: "algorithmic",
          directorEnabled: true,
        },
      }),
    });
    scenario.victoryConditions = {
      vpGoal: 250,
      hexVP: objectiveSet,
    };
    scenario.objectives = scenario.victoryConditions;
    const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed });
    state.truthState.openingControlPrimed = true;
    state.truthState.openingZoneOwners = {};
    return state;
  };
  const applyControllers = (state, controllers) => {
    for (const objective of objectiveSet) {
      const controller = controllers[objective.hex] || null;
      state.truthState.objectives[objective.hex] = {
        controller,
        heldMs: controller ? 999999 : 0,
        candidateController: null,
        candidateHeldMs: 0,
        seededFromBootstrap: false,
      };
    }
  };

  const thresholdNoCriticalState = buildVictoryState(7785);
  applyControllers(thresholdNoCriticalState, {
    "3,4": thresholdNoCriticalState.scenario.actors?.[0]?.id || null,
    "6,9": thresholdNoCriticalState.scenario.actors?.[0]?.id || null,
    "10,6": thresholdNoCriticalState.scenario.actors?.[1]?.id || null,
  });
  thresholdNoCriticalState.game.elapsedMs = 1000;
  const noImmediateWinner = tickRtsMatch(thresholdNoCriticalState, terrainData);

  const thresholdTimeoutState = buildVictoryState(7786);
  applyControllers(thresholdTimeoutState, {
    "3,4": thresholdTimeoutState.scenario.actors?.[0]?.id || null,
    "6,9": thresholdTimeoutState.scenario.actors?.[0]?.id || null,
    "10,6": thresholdTimeoutState.scenario.actors?.[1]?.id || null,
  });
  thresholdTimeoutState.game.elapsedMs = (30 * 60 * 1000) - (thresholdTimeoutState.game.tickMs || 250);
  const timeoutWinner = tickRtsMatch(thresholdTimeoutState, terrainData);

  const allCriticalState = buildVictoryState(7787);
  applyControllers(allCriticalState, {
    "3,4": allCriticalState.scenario.actors?.[0]?.id || null,
    "6,9": allCriticalState.scenario.actors?.[0]?.id || null,
    "10,6": allCriticalState.scenario.actors?.[0]?.id || null,
  });
  allCriticalState.game.elapsedMs = 1000;
  const allCriticalWinner = tickRtsMatch(allCriticalState, terrainData);

  return {
    defaultDurationLimitMinutes: thresholdNoCriticalState.scenario?.rtsOptions?.durationLimitMinutes || 0,
    liveWinnerWithoutAllCritical: noImmediateWinner.game?.winner || null,
    timeoutWinner: timeoutWinner.game?.winner || null,
    timeoutVictoryReason: timeoutWinner.game?.victoryReason || null,
    liveWinnerWithAllCritical: allCriticalWinner.game?.winner || null,
  };
}

function runBlindContactAcquisitionRegression(terrainData) {
  const baseScenario = getPresetById("river_crossing_v2");
  const scenario = buildScenario(baseScenario, {
    seed: 7788,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const initialState = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 7788 });
  const state = tickRtsMatch(initialState, terrainData);
  const blueId = scenario.actors?.[0]?.id || null;
  const commander = blueId ? state.ai?.commanders?.[blueId] : null;
  const subordinate = blueId ? state.ai?.subordinates?.[blueId] : null;
  const plans = Object.values(commander?.ownerZoneTasks || {});
  const assignments = subordinate?.assignments || {};
  const scoutFlightUnits = (state.units || []).filter((unit) => unit.actor === blueId && /^Raptor Scout Flight/.test(unit.name || ""));
  const scoutOwners = Array.from(new Set(
    scoutFlightUnits
      .map((unit) => assignments?.[unit.id]?.owner || null)
      .filter(Boolean)
  ));
  const scoutOwnerTasks = scoutOwners
    .map((ownerId) => commander?.ownerZoneTasks?.[ownerId] || null)
    .filter(Boolean);
  const forwardScoutRoles = new Set(["screen", "contain", "supporting_attack", "main_effort", "probe", "counterattack"]);
  return {
    blindAtStart: ((initialState.perceptionState?.[blueId]?.detectedUnits?.length || 0) + (initialState.perceptionState?.[blueId]?.contactUnits?.length || 0)) === 0
      && Object.keys(initialState.perceptionState?.[blueId]?.lastKnown || {}).length === 0,
    screenTaskCount: plans.filter((task) => task?.role === "screen").length,
    scoutFlightCount: scoutFlightUnits.length,
    scoutOwnerCount: scoutOwners.length,
    scoutOwnersStayForward: scoutOwners.every((ownerId) => ownerId?.includes("::maneuver::") || ownerId?.startsWith("sector-")),
    scoutOwnersStayOnManeuverTasks: scoutOwnerTasks.length > 0 && scoutOwnerTasks.every((task) => forwardScoutRoles.has(task.role)),
    scoutOwnerRoles: scoutOwnerTasks.map((task) => task.role),
    scoutOwnerZones: scoutOwnerTasks.map((task) => task.zoneId).filter(Boolean),
  };
}

function runMixedSupportOwnerRegression(terrainData) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed: 8821,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 8821 });
  const blueId = scenario.actors?.[0]?.id || null;
  const infantry = (state.units || []).find((unit) => unit.actor === blueId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  const artillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const layout = findArtilleryRegressionLayout(state.scenario?.zoneModel);
  if (!blueId || !infantry || !artillery || !layout) {
    return { passed: false, error: "missing-mixed-support-owner-fixture", role: null };
  }
  const keepIds = new Set([infantry.id, artillery.id]);
  for (const unit of state.units || []) {
    unit.modeState = unit.modeState || {};
    if (unit.actor === blueId) {
      if (!keepIds.has(unit.id)) {
        unit.status = "destroyed";
        unit.strength = 0;
      } else {
        setRegressionUnitHex(unit, unit.type === "artillery" ? layout.startHex : layout.moveHex);
        unit.parentHQ = "mixed-support-owner";
        unit.modeState.reserveState = "held";
      }
    }
  }
  const ownerId = "mixed-support-owner";
  state.ai.subordinates[blueId] = {
    lastRunAtMs: -6000,
    assignments: {
      [infantry.id]: { owner: ownerId, source: "regression" },
      [artillery.id]: { owner: ownerId, source: "regression" },
    },
    owners: {},
    taskQueues: {},
    reports: {},
    completedTaskIds: {},
    groupPlans: {},
    staleTaskLog: [],
  };
  state.ai.commanders[blueId] = {
    lastRunAtMs: -16000,
    ownerTasks: {},
    ownerZoneTasks: {},
    hypotheses: null,
    replanLog: [],
    taskInvalidations: [],
    operations: {
      main: null,
      support: [],
      lastDeepReviewAtMs: null,
      lastLightReviewAtMs: null,
      alerts: [],
      lastDirectorAdvice: null,
    },
  };
  const nextState = tickRtsMatch(state, terrainData);
  const task = nextState.ai?.commanders?.[blueId]?.ownerZoneTasks?.[ownerId] || null;
  return {
    passed: Boolean(task) && task.role !== "reserve",
    role: task?.role || null,
    kind: task?.kind || null,
  };
}

function runMixedFireMissionRegression(terrainData) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed: 8822,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 8822 });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const infantry = (state.units || []).find((unit) => unit.actor === blueId && !["artillery", "headquarters", "logistics"].includes(unit.type));
  const blueArtillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const enemy = (state.units || []).find((unit) => unit.actor === redId && !["headquarters", "logistics"].includes(unit.type));
  const layout = findArtilleryRegressionLayout(state.scenario?.zoneModel);
  if (!blueId || !infantry || !blueArtillery || !enemy || !layout) {
    return { passed: false, error: "missing-mixed-fire-mission-fixture" };
  }
  for (const unit of state.units || []) {
    unit.modeState = unit.modeState || {};
    if (unit.actor === blueId) {
      if (![infantry.id, blueArtillery.id].includes(unit.id)) {
        unit.status = "destroyed";
        unit.strength = 0;
      }
    } else if (unit.id !== enemy.id) {
      unit.status = "destroyed";
      unit.strength = 0;
    }
  }
  setRegressionUnitHex(blueArtillery, layout.startHex);
  setRegressionUnitHex(infantry, layout.moveHex);
  setRegressionUnitHex(enemy, layout.redArtHex);
  blueArtillery.parentHQ = "mixed-fire-owner";
  infantry.parentHQ = "mixed-fire-owner";
  const ownerId = "mixed-fire-owner";
  state.combat.spotterPool = {
    [blueId]: {
      [enemy.id]: {
        firstSeenAtMs: 0,
        lastConfirmedAtMs: 0,
        expiresAtMs: 45000,
        quality: "observed",
        spotterId: infantry.id,
        spotterType: infantry.type,
        targetHex: enemy.position,
        zoneId: layout.zoneId,
      },
    },
  };
  const task = {
    id: "mixed-fire-mission-task",
    owner: ownerId,
    kind: "fire_mission",
    role: "support_by_fire",
    zoneId: layout.zoneId,
    targetHex: enemy.position,
    stagingHex: layout.moveHex,
    supportHexes: [layout.moveHex],
    fallbackHex: layout.moveHex,
    summary: "Mixed fire mission regression.",
    provenance: "doctrine",
    ammoType: "destroy",
    missionRadius: 1,
    targetUnitIds: [enemy.id],
    assignedAtMs: 0,
  };
  state.ai.commanders[blueId] = {
    lastRunAtMs: state.game.elapsedMs,
    ownerTasks: { [ownerId]: [{ ...task }] },
    ownerZoneTasks: { [ownerId]: { ...task } },
    hypotheses: null,
    replanLog: [],
    taskInvalidations: [],
    operations: {
      main: null,
      support: [],
      lastDeepReviewAtMs: null,
      lastLightReviewAtMs: null,
      alerts: [],
      lastDirectorAdvice: null,
    },
  };
  state.ai.subordinates[blueId] = {
    lastRunAtMs: -6000,
    assignments: {
      [infantry.id]: { owner: ownerId, source: "regression" },
      [blueArtillery.id]: { owner: ownerId, source: "regression" },
    },
    owners: {},
    taskQueues: { [ownerId]: [{ ...task }] },
    reports: {},
    completedTaskIds: {},
    groupPlans: {},
    staleTaskLog: [],
  };
  const nextState = tickRtsMatch(state, terrainData);
  const nextArtillery = (nextState.units || []).find((unit) => unit.id === blueArtillery.id);
  const nextInfantry = (nextState.units || []).find((unit) => unit.id === infantry.id);
  return {
    passed: Boolean(nextArtillery?.modeState?.fireMission?.taskId === task.id)
      && !nextInfantry?.modeState?.fireMission
      && ((nextInfantry?.modeState?.currentCommand?.targetHex || null) === layout.moveHex),
    artilleryMission: nextArtillery?.modeState?.fireMission || null,
    infantryCommandHex: nextInfantry?.modeState?.currentCommand?.targetHex || null,
  };
}

function configureEncirclementScenario(scenario, terrainData) {
  const zoneModel = buildZoneModel(scenario, terrainData);
  const zoneById = Object.fromEntries((zoneModel.zones || []).map((zone) => [zone.zoneId, zone]));
  const actors = scenario.actors || [];
  const blueId = actors[0]?.id;
  const redId = actors[1]?.id;
  const rearZone = zoneById.zone_1;
  const centralZone = zoneById.zone_2;
  const pocketZone = zoneById.zone_3;
  if (!blueId || !redId || !rearZone || !centralZone || !pocketZone) {
    return;
  }
  const centralPocketEdge = (zoneModel.zoneEdges || []).find((edge) => edge.edgeId === ["zone_2", "zone_3"].sort().join("__"));
  const forwardLaneHexes = Array.from(new Set((centralPocketEdge?.laneIds || []).flatMap((laneId) => {
    const lane = zoneModel.lanes?.[laneId];
    return [
      lane?.endpointHexesByZone?.[centralZone.zoneId],
      lane?.endpointHexesByZone?.[pocketZone.zoneId],
      ...(lane?.laneHexIds || []),
    ].filter(Boolean);
  })));
  const rearHexes = [...(rearZone.coreHexIds || []), ...(rearZone.borderHexIds || []), ...(rearZone.hexIds || [])];
  const centralHexes = [
    ...forwardLaneHexes.filter((hex) => zoneModel.interiorHexZoneMap?.[hex] === centralZone.zoneId),
    ...(centralZone.borderHexIds || []),
    ...(centralZone.coreHexIds || []),
    ...(centralZone.hexIds || []),
  ];
  const pocketHexes = [
    ...forwardLaneHexes.filter((hex) => zoneModel.interiorHexZoneMap?.[hex] === pocketZone.zoneId),
    ...(pocketZone.borderHexIds || []),
    ...(pocketZone.coreHexIds || []),
    ...(pocketZone.hexIds || []),
  ];
  const blueUnits = (scenario.units || []).filter((unit) => unit.actor === blueId);
  const redUnits = (scenario.units || []).filter((unit) => unit.actor === redId);
  const bluePocketUnits = blueUnits.filter((unit) => !["headquarters", "logistics", "artillery"].includes(unit.type)).slice(0, 2);
  const blueRearUnits = blueUnits.filter((unit) => !bluePocketUnits.includes(unit));
  const redForwardUnits = redUnits.filter((unit) => !["headquarters", "logistics"].includes(unit.type));
  const redRearUnits = redUnits.filter((unit) => ["headquarters", "logistics"].includes(unit.type));

  bluePocketUnits.forEach((unit, index) => {
    unit.position = pocketHexes[index % Math.max(pocketHexes.length, 1)] || unit.position;
  });
  blueRearUnits.forEach((unit, index) => {
    unit.position = rearHexes[index % Math.max(rearHexes.length, 1)] || unit.position;
  });
  redForwardUnits.forEach((unit, index) => {
    unit.position = centralHexes[index % Math.max(centralHexes.length, 1)] || unit.position;
  });
  redRearUnits.forEach((unit, index) => {
    unit.position = centralHexes[(index + redForwardUnits.length) % Math.max(centralHexes.length, 1)] || unit.position;
  });
}

try {
  const terrainData = getTestFixture();
  const multiZoneBasePreset = {
    ...getServerAiDuelPreset(),
    victoryConditions: {
      vpGoal: 999,
      hexVP: [
        { hex: "3,4", name: "North Ridge", vp: 40 },
        { hex: "6,9", name: "Central Bridge", vp: 80 },
        { hex: "10,6", name: "South Ford", vp: 20 },
      ],
    },
  };
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed: 9907,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });

  const runA = runMatch({ scenario, terrainData, seed: 9907, totalTicks: 160 });
  const runB = runMatch({ scenario, terrainData, seed: 9907, totalTicks: 160 });
  const summaryScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 9907,
    rtsOptions: { aiLogMode: "llm_summary" },
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const fullDiaryScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 9907,
    rtsOptions: { aiLogMode: "full_diary" },
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const summaryRun = runMatch({ scenario: summaryScenario, terrainData, seed: 9907, totalTicks: 160 });
  const fullDiaryRun = runMatch({ scenario: fullDiaryScenario, terrainData, seed: 9907, totalTicks: 160 });
  const cautiousScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 4412,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "cautious_defender",
        thinkBudget: "fast",
        reservePolicy: "conservative",
        releasePolicy: "staged",
      },
    }),
  });
  const aggressiveScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 4412,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "aggressive_breakthrough",
        thinkBudget: "deliberate",
        reservePolicy: "aggressive",
        releasePolicy: "immediate",
      },
    }),
  });
  const cautiousRun = runMatch({ scenario: cautiousScenario, terrainData, seed: 4412, totalTicks: 120 });
  const aggressiveRun = runMatch({ scenario: aggressiveScenario, terrainData, seed: 4412, totalTicks: 120 });
  const multiZoneScenario = buildScenario(multiZoneBasePreset, {
    seed: 9931,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const multiZoneRun = runMatch({ scenario: multiZoneScenario, terrainData, seed: 9931, totalTicks: 160 });
  const multiZoneLongRun = runMatch({ scenario: multiZoneScenario, terrainData, seed: 9931, totalTicks: 400 });
  const flankerScenario = buildScenario(multiZoneBasePreset, {
    seed: 5523,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "rough_terrain_flanker",
      },
    }),
  });
  const cautiousMultiZoneScenario = buildScenario(multiZoneBasePreset, {
    seed: 5523,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "cautious_defender",
      },
    }),
  });
  const urbanScenario = buildScenario(multiZoneBasePreset, {
    seed: 5527,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "urban_grinder",
      },
    }),
  });
  const aggressiveSupportScenario = buildScenario(multiZoneBasePreset, {
    seed: 5527,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "aggressive_breakthrough",
      },
    }),
  });
  const flankerRun = runMatch({ scenario: flankerScenario, terrainData, seed: 5523, totalTicks: 120 });
  const cautiousMultiZoneRun = runMatch({ scenario: cautiousMultiZoneScenario, terrainData, seed: 5523, totalTicks: 120 });
  const urbanRun = runMatch({ scenario: urbanScenario, terrainData, seed: 5527, totalTicks: 120 });
  const aggressiveSupportRun = runMatch({ scenario: aggressiveSupportScenario, terrainData, seed: 5527, totalTicks: 120 });
  const encirclementCautiousScenario = buildScenario(multiZoneBasePreset, {
    seed: 5531,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "cautious_defender",
      },
    }),
  });
  const encirclementAggressiveScenario = buildScenario(multiZoneBasePreset, {
    seed: 5531,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
        profile: "aggressive_breakthrough",
      },
    }),
  });
  configureEncirclementScenario(encirclementCautiousScenario, terrainData);
  configureEncirclementScenario(encirclementAggressiveScenario, terrainData);
  const encirclementCautiousRun = runMatch({ scenario: encirclementCautiousScenario, terrainData, seed: 5531, totalTicks: 72 });
  const encirclementAggressiveRun = runMatch({ scenario: encirclementAggressiveScenario, terrainData, seed: 5531, totalTicks: 72 });
  const executorScenario = buildScenario(getHeloInsertionPreset(), {
    seed: 8123,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: {
        ...(actor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      },
    }),
  });
  const stressedTransport = executorScenario.units.find((unit) => unit.name === "Falcon Lift 1");
  if (stressedTransport) {
    stressedTransport.fuel = 10;
  }
  const executorRun = runMatch({ scenario: executorScenario, terrainData, seed: 8123, totalTicks: 48 });
  const provenanceValues = [...new Set((runA.state.ai?.decisionLog || []).map((entry) => entry.provenance))];
  const decisionSources = new Set((runA.state.ai?.decisionLog || []).map((entry) => entry.source));
  const executorSources = new Set((executorRun.state.ai?.decisionLog || []).map((entry) => entry.source));
  const invalidProvenance = provenanceValues.filter((value) => !ALLOWED_PROVENANCE.has(value));
  const standardModeKeepsExtendedLogsOff = Object.keys(runA.state.ai?.summaries || {}).length === 0 && (runA.state.ai?.diary?.length || 0) === 0;
  const summaryRows = Object.values(summaryRun.state.ai?.summaries || {});
  const summaryModeReady = summaryRows.length > 0
    && summaryRows.every((row) => row?.current?.text && Array.isArray(row?.history) && row.history.length > 0);
  const summaryModeCompact = summaryRows.every((row) => (row?.current?.text || "").length > 0 && (row.current.text || "").length < 4000)
    && (summaryRun.state.ai?.diary?.length || 0) === 0;
  const fullDiaryEntries = fullDiaryRun.state.ai?.diary || [];
  const fullDiaryKinds = new Set(fullDiaryEntries.map((entry) => entry.kind));
  const fullDiaryReady = fullDiaryEntries.length > 0
    && fullDiaryKinds.has("decision")
    && fullDiaryKinds.has("order_issue")
    && fullDiaryKinds.has("thought_snapshot")
    && fullDiaryKinds.has("perception_delta");
  const subordinateReportsReady = Object.values(runA.state.ai?.subordinates || {}).some((subordinate) =>
    Object.keys(subordinate?.reports || {}).length > 0 && Object.keys(subordinate?.taskQueues || {}).length > 0
  );
  const directorTelemetryReady = (runA.state.telemetry?.directorPackets || []).length > 0
    && (runA.state.telemetry?.directorPackets || []).every((packet) => packet.pressure && packet.packageWeights);
  const replayReviewReady = (runA.state.replay?.snapshots || []).some((snapshot) => snapshot.perception && snapshot.directorPackets);
  const thoughtRows = Object.values(runA.state.ai?.thoughts || {});
  const thoughtSnapshots = runA.state.telemetry?.thoughtSnapshots || [];
  const thoughtTextReady = thoughtRows.some((row) => row?.commander?.text && row?.director?.text);
  const thoughtCadenceReady = thoughtRows.some((row) => Array.isArray(row?.history) && row.history.length >= 2 && row.history.every((entry, index, history) => (
    index === 0 || (entry.atMs - history[index - 1].atMs) >= 15000
  )));
  const replayThoughtsReady = (runA.state.replay?.snapshots || []).some((snapshot) => Object.keys(snapshot.thoughts || {}).length > 0);
  const groupPlansReady = Object.values(runA.state.ai?.subordinates || {}).some((subordinate) => Object.keys(subordinate?.groupPlans || {}).length > 0);
  const replayGroupPlansReady = (runA.state.replay?.snapshots || []).some((snapshot) =>
    Object.values(snapshot.subordinatePlans || {}).some((plans) => Object.keys(plans || {}).length > 0)
  );
  const multiZonePackets = multiZoneRun.state.telemetry?.directorPackets || [];
  const multiZonePlanSnapshots = collectCommanderPlanSnapshots(multiZoneRun);
  const multiOwnerPlansPresent = multiZonePlanSnapshots.some((snapshot) => snapshot.taskCount >= 2);
  const multiZoneModel = multiZoneRun.state.scenario?.zoneModel;
  const ridgeZoneId = getObjectiveZoneId(multiZoneModel, "3,4");
  const bridgeZoneId = getObjectiveZoneId(multiZoneModel, "6,9");
  const concentrationViolations = computeZoneConcentrationViolations(multiZoneLongRun);
  const supportResidency = computeSupportResidency(multiZoneLongRun);
  const supportResidencyViolations = Object.values(supportResidency).filter((entry) => entry.totalSamples > 0 && entry.ratio < 0.8);
  const objectiveApproachCoverage = computeObjectiveApproachCoverage(multiZoneLongRun);
  const objectiveApproachViolations = Object.values(objectiveApproachCoverage).filter((entry) => entry.totalPlans > 0 && entry.ratio < 0.6);
  const headquartersExposure = computeHeadquartersExposure(multiZoneLongRun);
  const headquartersExposureViolations = Object.values(headquartersExposure).filter((entry) => entry.totalSamples > 0 && entry.exposureRatio > 0.15);
  const stackCollisionHotspots = computeStackCollisionHotspots(multiZoneLongRun);
  const zoneTaskCompletionRegression = runZoneTaskCompletionRegression(multiZoneBasePreset, terrainData);
  const objectiveControlRegression = runObjectiveControlRegression(multiZoneBasePreset, terrainData);
  const openingBootstrapRegression = runOpeningBootstrapRegression(multiZoneBasePreset, terrainData);
  const vpZoneOutlineRegression = runVpZoneOutlineRegression(multiZoneBasePreset, terrainData);
  const criticalVpVictoryRegression = runCriticalVpVictoryRegression(multiZoneBasePreset, terrainData);
  const blindContactAcquisitionRegression = runBlindContactAcquisitionRegression(terrainData);
  const counterBatteryRegression = runCounterBatteryRegression(terrainData);
  const artilleryEmplacementRegression = runArtilleryEmplacementRegression(terrainData);
  const overHorizonAreaFireRegression = runOverHorizonAreaFireRegression(terrainData);
  const preparatoryAreaFireRegression = runPreparatoryAreaFireRegression(terrainData);
  const mixedSupportOwnerRegression = runMixedSupportOwnerRegression(terrainData);
  const mixedFireMissionRegression = runMixedFireMissionRegression(terrainData);
  const defaultArtilleryDoctrine = computeArtilleryDoctrineStats(runA);
  const urbanArtilleryDoctrine = computeArtilleryDoctrineStats(urbanRun);
  const aggressiveSupportDoctrine = computeArtilleryDoctrineStats(aggressiveSupportRun);
  const cautiousPlanSnapshots = collectCommanderPlanSnapshots(cautiousRun);
  const aggressivePlanSnapshots = collectCommanderPlanSnapshots(aggressiveRun);
  const flankerPlanSnapshots = collectCommanderPlanSnapshots(flankerRun);
  const cautiousMultiZonePlanSnapshots = collectCommanderPlanSnapshots(cautiousMultiZoneRun);
  const urbanPlanSnapshots = collectCommanderPlanSnapshots(urbanRun);
  const aggressiveSupportPlanSnapshots = collectCommanderPlanSnapshots(aggressiveSupportRun);
  const encirclementCautiousPlans = collectCommanderPlanSnapshots(encirclementCautiousRun);
  const encirclementAggressivePlans = collectCommanderPlanSnapshots(encirclementAggressiveRun);
  const earlyCautiousPlan = firstPlanSnapshot(cautiousPlanSnapshots);
  const earlyAggressivePlan = firstPlanSnapshot(aggressivePlanSnapshots);
  const earlyFlankerPlan = firstPlanSnapshot(flankerPlanSnapshots);
  const earlyCautiousMultiZonePlan = firstPlanSnapshot(cautiousMultiZonePlanSnapshots);
  const earlyFlankerPacket = firstDirectorPacket(flankerRun.state.telemetry?.directorPackets || []);
  const earlyCautiousMultiZonePacket = firstDirectorPacket(cautiousMultiZoneRun.state.telemetry?.directorPackets || []);
  const earlyUrbanPlan = firstPlanSnapshot(urbanPlanSnapshots);
  const earlyAggressiveSupportPlan = firstPlanSnapshot(aggressiveSupportPlanSnapshots);
  const earlyEncirclementCautiousPlan = firstPlanSnapshot(encirclementCautiousPlans, encirclementCautiousScenario.actors?.[0]?.id || null);
  const earlyEncirclementAggressivePlan = firstPlanSnapshot(encirclementAggressivePlans, encirclementAggressiveScenario.actors?.[0]?.id || null);
  const totalUrbanSupportByFire = urbanPlanSnapshots.reduce((sum, snapshot) => sum + countRole(snapshot, "support_by_fire"), 0);
  const totalAggressiveSupportByFire = aggressiveSupportPlanSnapshots.reduce((sum, snapshot) => sum + countRole(snapshot, "support_by_fire"), 0);
  const totalCautiousRelief = encirclementCautiousPlans.reduce((sum, snapshot) => sum + countRole(snapshot, "relief"), 0);
  const totalAggressiveRelief = encirclementAggressivePlans.reduce((sum, snapshot) => sum + countRole(snapshot, "relief"), 0);
  const artilleryActors = Object.values(defaultArtilleryDoctrine).filter((entry) => entry.artilleryUnitCount > 0);
  const artilleryDoctrineReady = artilleryActors.length > 0 && artilleryActors.every((entry) => (
    entry.firesOwnerCount >= 1
    && entry.fireMissionTaskCount >= 1
    && entry.ammoTypedFireMissionCount >= 1
    && entry.ammoStampedSamples >= 1
    && entry.missionZoneStampedSamples >= 1
  ));
  const laneLessManeuverViolations = [];
  const laneReuseViolations = [];
  const stagingDirectionViolations = [];
  for (const snapshot of multiZonePlanSnapshots) {
    for (const task of snapshot.entries || []) {
      const role = task.role || task.kind || "none";
      if (task.edgeId && !task.laneId && !["reserve", "rear_security", "fallback"].includes(role)) {
        laneLessManeuverViolations.push({ actorId: snapshot.actorId, atMs: snapshot.atMs, role, edgeId: task.edgeId });
      }
      if (task.laneId && task.originZoneId && task.stagingHex) {
        const stagingOwner = multiZoneRun.state.scenario?.zoneModel?.interiorHexZoneMap?.[task.stagingHex] || null;
        if (stagingOwner !== task.originZoneId) {
          stagingDirectionViolations.push({
            actorId: snapshot.actorId,
            atMs: snapshot.atMs,
            laneId: task.laneId,
            originZoneId: task.originZoneId,
            stagingHex: task.stagingHex,
            stagingOwner,
          });
        }
      }
    }
    for (const [laneId, count] of Object.entries(snapshot.laneCounts || {})) {
      const throughput = multiZoneRun.state.scenario?.zoneModel?.lanes?.[laneId]?.throughputScore || 0;
      if (count > 1 && throughput < 0.82) {
        laneReuseViolations.push({ actorId: snapshot.actorId, atMs: snapshot.atMs, laneId, count, throughput });
      }
    }
  }
  const directorZonePacketsReady = multiZonePackets.length > 0
    && multiZonePackets.every((packet) => Array.isArray(packet.primaryZones) && Array.isArray(packet.secondaryZones) && Array.isArray(packet.supportingZones));
  const commanderZonePlansReady = multiZonePlanSnapshots.some((snapshot) => snapshot.taskCount > 0 && snapshot.entries.some((task) => task.zoneId && (task.role || task.kind)));
  const supportZoneReady = multiZonePackets.some((packet) => (packet.supportingZones?.length || 0) > 0);
  const multiZoneSpreadReady = multiZonePlanSnapshots.some((snapshot) => snapshot.taskCount >= 2 && snapshot.distinctZones >= 2 && snapshot.maxZoneShare <= 0.75)
    || multiZonePackets.some((packet) => countPacketIntentZones(packet) >= 2);
  const sustainedSpreadReady = concentrationViolations.length === 0;
  const laneAssignmentReady = multiZonePlanSnapshots.some((snapshot) => snapshot.entries.some((task) => task.edgeId || task.laneId));
  const supportZoneScenarioReady = Boolean(ridgeZoneId && bridgeZoneId)
    && multiZonePackets.some((packet) => packet.primaryZones?.includes(bridgeZoneId))
    && (
      multiZonePackets.some((packet) => packet.supportingZones?.includes(ridgeZoneId) || packet.secondaryZones?.includes(ridgeZoneId))
      || !multiOwnerPlansPresent
      || multiZonePlanSnapshots.some((snapshot) => snapshot.entries.some((task) => (
        (task.zoneId === ridgeZoneId && ["support_by_fire", "supporting_attack"].includes(task.role))
        || (task.zoneId === bridgeZoneId && (task.kind === "fire_mission" || task.role === "support_by_fire"))
      )))
    );
  const reservePatienceReady = (cautiousRun.state.units || []).filter((unit) => unit.actor === cautiousScenario.actors?.[0]?.id && unit.modeState?.reserveState === "held").length
    > (aggressiveRun.state.units || []).filter((unit) => unit.actor === aggressiveScenario.actors?.[0]?.id && unit.modeState?.reserveState === "held").length;
  const rearSecurityBiasReady = countRole(earlyCautiousPlan, "rear_security") >= countRole(earlyAggressivePlan, "rear_security");
  const neutralZoneOpportunismReady = (earlyFlankerPlan?.distinctZones || 0) >= (earlyCautiousMultiZonePlan?.distinctZones || 0)
    && countPacketIntentZones(earlyFlankerPacket) >= countPacketIntentZones(earlyCautiousMultiZonePacket);
  const urbanFireMissionTasks = sumDoctrineMetric(urbanArtilleryDoctrine, "fireMissionTaskCount");
  const aggressiveSupportFireMissionTasks = sumDoctrineMetric(aggressiveSupportDoctrine, "fireMissionTaskCount");
  const urbanAmmoStampedSamples = sumDoctrineMetric(urbanArtilleryDoctrine, "ammoStampedSamples");
  const aggressiveSupportAmmoStampedSamples = sumDoctrineMetric(aggressiveSupportDoctrine, "ammoStampedSamples");
  const supportByFireBiasReady = totalUrbanSupportByFire >= totalAggressiveSupportByFire
    && countRole(earlyUrbanPlan, "support_by_fire") >= countRole(earlyAggressiveSupportPlan, "support_by_fire")
    && urbanFireMissionTasks > 0
    && urbanAmmoStampedSamples > 0
    && urbanFireMissionTasks >= aggressiveSupportFireMissionTasks
    && urbanAmmoStampedSamples >= aggressiveSupportAmmoStampedSamples;
  // Pocket-relief bias assertion (hardened):
  //   1) The cautious (high pocketReliefBias) profile must produce *some* relief
  //      plans — zero cautious relief is a clear failure even if aggressive also
  //      produced zero (the OR form previously let a 0-vs-0 tie silently pass).
  //   2) The cautious profile must produce strictly more relief than aggressive,
  //      evaluated over the entire run (aggregate signal is less noisy than a
  //      single snapshot).
  //   3) The early-plan snapshot must at minimum not show *aggressive* producing
  //      strictly more relief than cautious — an early inversion indicates the
  //      bias got masked by something louder on the first tick.
  const earlyCautiousRelief = countRole(earlyEncirclementCautiousPlan, "relief");
  const earlyAggressiveRelief = countRole(earlyEncirclementAggressivePlan, "relief");
  const pocketReliefBiasReady = totalCautiousRelief > 0
    && totalCautiousRelief > totalAggressiveRelief
    && earlyCautiousRelief >= earlyAggressiveRelief;
  const operationSnapshots = (multiZoneLongRun.state.replay?.snapshots || []).flatMap((snapshot) => (
    Object.entries(snapshot.commanderHypotheses || {}).map(([actorId, hypothesis]) => ({
      actorId,
      atMs: snapshot.atMs,
      currentOperation: hypothesis?.currentOperation || null,
      supportOperations: hypothesis?.supportOperations || [],
    }))
  ));
  const operationContinuityReady = (multiZoneLongRun.state.scenario?.actors || []).some((actor) => {
    const goals = (multiZoneLongRun.state.replay?.snapshots || [])
      .map((snapshot) => snapshot.commanderHypotheses?.[actor.id]?.currentOperation?.goalZoneId || null)
      .filter(Boolean);
    return goals.some((zoneId, index) => goals[index + 1] === zoneId);
  });
  const deepReviewReady = (multiZoneLongRun.state.replay?.snapshots || []).some((snapshot) => (
    Object.values(snapshot.commanderReplans || {}).some((entry) => entry?.operations?.lastDeepReviewAtMs != null)
  ));
  const emergencySupportReady = operationSnapshots.some((entry) => (
    (entry.supportOperations?.length || 0) > 0
    || (entry.currentOperation?.supportZoneIds?.length || 0) > 0
  ));
  const directorAdviceReady = Object.values(runA.state.ai?.commanders || {}).every((commanderState) => (
    ["accepted_director_advice", "deferred_director_advice", "rejected_director_advice"].includes(commanderState?.operations?.lastDirectorAdvice?.kind)
  ));
  const rtsGameSource = fs.readFileSync(path.join(projectRoot, "src", "rts", "RtsGame.jsx"), "utf8");
  const debugUiReady = !rtsGameSource.includes("directorTarget")
    && rtsGameSource.includes("directorSuggestedAxes")
    && rtsGameSource.includes("currentOperation")
    && rtsGameSource.includes("vpZoneOutlines");

  const checks = [
    {
      name: "Same-seed AI-vs-AI runs produced identical normalized state hashes",
      pass: runA.stateHash === runB.stateHash,
    },
    {
      name: "Same-seed AI-vs-AI runs produced identical replay hashes",
      pass: runA.replayHash === runB.replayHash,
    },
    {
      name: "Same-seed AI-vs-AI runs produced identical AI provenance hashes",
      pass: runA.provenanceHash === runB.provenanceHash,
    },
    {
      name: "AI produced director, subordinate, commander, and executor decision traces",
      pass: decisionSources.has("director") && decisionSources.has("subordinates") && decisionSources.has("commander") && executorSources.has("executors"),
    },
    {
      name: "Standard mode kept extended AI summaries and diaries disabled",
      pass: standardModeKeepsExtendedLogsOff,
    },
    {
      name: "LLM Summary mode produced prompt-ready per-actor summaries without enabling the full diary",
      pass: summaryModeReady && summaryModeCompact,
    },
    {
      name: "Full Diary mode captured decision, order, thought, and perception events together",
      pass: fullDiaryReady,
    },
    {
      name: "All AI provenance tags stayed within the legal fog-of-war set",
      pass: invalidProvenance.length === 0,
    },
    {
      name: "AI run emitted perception snapshots for later replay/debug inspection",
      pass: runA.perceptionSnapshots.length > 0,
    },
    {
      name: "AI run persisted subordinate task queues and status reports",
      pass: subordinateReportsReady,
    },
    {
      name: "AI run persisted subordinate local group plans in live state and replay snapshots",
      pass: groupPlansReady && replayGroupPlansReady,
    },
    {
      name: "Director telemetry captured bounded packet state for replay/debug review",
      pass: directorTelemetryReady,
    },
    {
      name: "Replay snapshots retained perception and director summaries",
      pass: replayReviewReady,
    },
    {
      name: "Multi-zone director packets carried primary, secondary, and supporting zone intents",
      pass: directorZonePacketsReady && supportZoneReady,
    },
    {
      name: "Lower-VP support zones were chosen to shape a higher-VP assault when the terrain warranted it",
      pass: supportZoneScenarioReady,
    },
    {
      name: "Commander replay snapshots retained zone-role plans with edge or lane metadata",
      pass: commanderZonePlansReady && laneAssignmentReady,
    },
    {
      name: "Multi-zone AI plans spread tasking across more than one zone instead of one pure dogpile",
      pass: multiZoneSpreadReady,
    },
    {
      name: "No side kept more than 60% of maneuver owners on one zone for over 90 continuous seconds while multiple non-friendly zones remained",
      pass: sustainedSpreadReady,
    },
    {
      name: "Cross-zone maneuver plans never dropped lane assignment and never double-booked a narrow lane",
      pass: laneLessManeuverViolations.length === 0 && laneReuseViolations.length === 0,
    },
    {
      name: "Staging hexes stayed on the correct side of the chosen lane",
      pass: stagingDirectionViolations.length === 0,
    },
    {
      name: "RTS AI generated plain-English commander and director thoughts",
      pass: thoughtTextReady,
    },
    {
      name: "RTS AI thoughts refreshed on a 15-second cadence and landed in telemetry/replay",
      pass: thoughtCadenceReady && thoughtSnapshots.length > 0 && replayThoughtsReady,
    },
    {
      name: "AI run generated command and event telemetry",
      pass: (runA.state.truthState?.commandLog?.length || 0) > 0 && (runA.state.truthState?.eventLog?.length || 0) > 0,
    },
    {
      name: "Stock AI duel formed fires owners and issued ammo-typed fire missions for artillery actors",
      pass: artilleryDoctrineReady,
    },
    {
      name: "Support units spent at least 80% of sampled time in rear, transition, or staging zones",
      pass: supportResidencyViolations.length === 0,
    },
    {
      name: "Mixed owners containing artillery were treated as support owners and never assigned reserve release roles",
      pass: mixedSupportOwnerRegression.passed,
    },
    {
      name: "Mixed support owners stamped fire-mission metadata only onto indirect-fire units while maneuver elements held the support anchor",
      pass: mixedFireMissionRegression.passed,
    },
    {
      name: "Counter-battery artillery targeted enemy guns ahead of armor when both were visible in the tasked zone",
      pass: counterBatteryRegression.passed,
    },
    {
      name: "Artillery could queue area fire from spotter memory without a direct unit lock or live visual contact",
      pass: overHorizonAreaFireRegression.passed,
    },
    {
      name: "Artillery could launch preparatory area fire on a planned assault hex even with no spotter history or live contact",
      pass: preparatoryAreaFireRegression.passed,
    },
    {
      name: "Artillery held fire while moving and resumed only after emplacement",
      pass: artilleryEmplacementRegression.passed,
    },
    {
      name: "Main-effort and supporting-attack plans stayed anchored to real objective hexes or bounded approach rings",
      pass: objectiveApproachViolations.length === 0,
    },
    {
      name: "HQs stayed out of contested or overexposed frontline zones for at least 85% of sampled time",
      pass: headquartersExposureViolations.length === 0,
    },
    {
      name: "No single hex accumulated more than six stack-limit collisions in the long multi-zone run",
      pass: stackCollisionHotspots.maxEventsPerHex <= 6,
    },
    {
      name: "Zone-role tasks can complete on zone control recovery without literal VP-hex stacking",
      pass: zoneTaskCompletionRegression.passed,
    },
    {
      name: "Neutral objectives accumulate candidate hold progress and promote to awarded control once the hold window completes",
      pass: objectiveControlRegression.candidateController != null
        && objectiveControlRegression.controller === objectiveControlRegression.candidateController
        && objectiveControlRegression.candidateHeldMs >= objectiveControlRegression.holdRequiredMs,
    },
    {
      name: "Opening bootstrap seeds uncontested anchor zones before the first AI plan",
      pass: openingBootstrapRegression.primed
        && openingBootstrapRegression.seededZoneCount > 0
        && openingBootstrapRegression.friendlyAnchorCount === openingBootstrapRegression.uncontestedAnchorCount,
    },
    {
      name: "Live VP wins require every critical objective, while timeout wins only require crossing the VP threshold at 30 minutes",
      pass: criticalVpVictoryRegression.defaultDurationLimitMinutes === 30
        && criticalVpVictoryRegression.liveWinnerWithoutAllCritical == null
        && criticalVpVictoryRegression.timeoutWinner != null
        && criticalVpVictoryRegression.timeoutVictoryReason === "time_limit"
        && criticalVpVictoryRegression.liveWinnerWithAllCritical != null,
    },
    {
      name: "Blind commanders still formed a bounded screen package while scout flights stayed off dedicated screen ownership",
      pass: blindContactAcquisitionRegression.blindAtStart
        && blindContactAcquisitionRegression.scoutFlightCount >= 2
        && blindContactAcquisitionRegression.screenTaskCount >= 1
        && !blindContactAcquisitionRegression.scoutOwnerRoles.includes("screen"),
    },
    {
      name: "Commander operations persist across adjacent reviews, capture deep-review timestamps, and can spawn support operations",
      pass: operationContinuityReady && deepReviewReady && emergencySupportReady,
    },
    {
      name: "Commander state records whether director advice was accepted, deferred, or rejected",
      pass: directorAdviceReady,
    },
    {
      name: "VP zone outline geometry is stable and produces perimeter segments for both single and merged objective zones",
      pass: vpZoneOutlineRegression.outlineCount > 0
        && vpZoneOutlineRegression.allSegmented
        && vpZoneOutlineRegression.stable
        && vpZoneOutlineRegression.mergedOutlinePresent,
    },
    {
      name: "Profile, reserve, and think-budget tuning changed the AI behavior",
      pass: cautiousRun.stateHash !== aggressiveRun.stateHash || cautiousRun.provenanceHash !== aggressiveRun.provenanceHash,
    },
    {
      name: "High reserve-patience profiles held back more reserves than low-patience profiles",
      pass: reservePatienceReady,
    },
    {
      name: "High rear-security bias preserved at least as much rear-security tasking as low-bias profiles",
      pass: rearSecurityBiasReady,
    },
    {
      name: "High neutral-zone opportunism preserved at least as much early multi-zone breadth as cautious profiles",
      pass: neutralZoneOpportunismReady,
    },
    {
      name: "High support-by-fire bias preserved artillery support tasking, fire missions, and ammo assignment volume against the aggressive baseline",
      pass: supportByFireBiasReady,
    },
    {
      name: "High pocket-relief bias favored relief plans more strongly in the encirclement scenario",
      pass: pocketReliefBiasReady,
    },
    {
      name: "RTS spectator/debug UI references zone-based hypotheses instead of stale point targets",
      pass: debugUiReady,
    },
  ];

  const summary = {
    ok: checks.every((check) => check.pass),
    status: checks.every((check) => check.pass) ? "passed" : "failed",
    runId,
    timestamp: new Date().toISOString(),
    tickStats: buildTickStats(runA.tickTimingsMs),
    outcome: runA.outcome,
    hashes: {
      stateHash: runA.stateHash,
      replayHash: runA.replayHash,
      provenanceHash: runA.provenanceHash,
    },
    provenanceValues,
    decisionSources: [...decisionSources],
    executorSources: [...executorSources],
    invalidProvenance,
    checks,
    perceptionSnapshots: runA.perceptionSnapshots,
    thoughtSnapshots,
    concentrationViolations,
    supportResidency,
    supportResidencyViolations,
    defaultArtilleryDoctrine,
    urbanArtilleryDoctrine,
    aggressiveSupportDoctrine,
    mixedSupportOwnerRegression,
    mixedFireMissionRegression,
    counterBatteryRegression,
    overHorizonAreaFireRegression,
    preparatoryAreaFireRegression,
    artilleryEmplacementRegression,
    objectiveApproachCoverage,
    objectiveApproachViolations,
    headquartersExposure,
    headquartersExposureViolations,
    stackCollisionHotspots,
    zoneTaskCompletionRegression,
    criticalVpVictoryRegression,
    blindContactAcquisitionRegression,
    recentAiDecisions: (runA.state.ai?.decisionLog || []).slice(-12),
    logModes: {
      standard: {
        summaryActors: Object.keys(runA.state.ai?.summaries || {}).length,
        diaryEntries: runA.state.ai?.diary?.length || 0,
      },
      llmSummary: {
        summaryActors: summaryRows.length,
        historyDepth: Math.max(0, ...summaryRows.map((row) => row?.history?.length || 0)),
        diaryEntries: summaryRun.state.ai?.diary?.length || 0,
      },
      fullDiary: {
        summaryActors: Object.keys(fullDiaryRun.state.ai?.summaries || {}).length,
        diaryEntries: fullDiaryEntries.length,
        diaryKinds: [...fullDiaryKinds].sort(),
      },
    },
    tuningComparison: {
      cautiousStateHash: cautiousRun.stateHash,
      aggressiveStateHash: aggressiveRun.stateHash,
      cautiousProvenanceHash: cautiousRun.provenanceHash,
      aggressiveProvenanceHash: aggressiveRun.provenanceHash,
    },
  };

  const report = [
    "# RTS AI Smoke Report",
    "",
    `- Status: ${summary.status}`,
    `- Run: \`${summary.runId}\``,
    `- Time: ${summary.timestamp}`,
    "",
    "## Checks",
    "",
    ...renderChecks(summary.checks),
    "",
    "## Outcome",
    "",
    ...renderOutcome(summary.outcome),
    `- State hash: \`${summary.hashes.stateHash}\``,
    `- Replay hash: \`${summary.hashes.replayHash}\``,
    `- Provenance hash: \`${summary.hashes.provenanceHash}\``,
    `- Tick stats: avg ${summary.tickStats.averageMs}ms, p95 ${summary.tickStats.p95Ms}ms, max ${summary.tickStats.maxMs}ms`,
    "",
    "## Provenance",
    "",
    `- Provenance tags: ${summary.provenanceValues.join(", ") || "none"}`,
    `- Decision sources: ${summary.decisionSources.join(", ") || "none"}`,
    `- Cautious profile hash: \`${summary.tuningComparison.cautiousStateHash}\``,
    `- Aggressive profile hash: \`${summary.tuningComparison.aggressiveStateHash}\``,
    `- Log modes: standard summaries=${summary.logModes.standard.summaryActors}, standard diary=${summary.logModes.standard.diaryEntries}, llm-summary actors=${summary.logModes.llmSummary.summaryActors}, llm-summary history depth=${summary.logModes.llmSummary.historyDepth}, full-diary entries=${summary.logModes.fullDiary.diaryEntries}`,
    `- Full diary kinds: ${summary.logModes.fullDiary.diaryKinds.join(", ") || "none"}`,
    `- Support residency: ${Object.entries(summary.supportResidency || {}).map(([actorId, entry]) => `${actorId}=${Math.round((entry.ratio || 0) * 100)}%`).join(" / ") || "none"}`,
    `- Default artillery doctrine: ${Object.entries(summary.defaultArtilleryDoctrine || {}).map(([actorId, entry]) => `${actorId}=fires:${entry.firesOwnerCount}, missions:${entry.fireMissionTaskCount}, ammo:${entry.ammoStampedSamples}`).join(" / ") || "none"}`,
    `- Mixed support-owner regression: role=${summary.mixedSupportOwnerRegression?.role || "none"}, kind=${summary.mixedSupportOwnerRegression?.kind || "none"}`,
    `- Mixed fire-mission regression: mission=${summary.mixedFireMissionRegression?.artilleryMission?.taskId || "none"}, infantry-anchor=${summary.mixedFireMissionRegression?.infantryCommandHex || "none"}`,
    `- Counter-battery regression: target=${summary.counterBatteryRegression?.targetType || "none"}, queued=${summary.counterBatteryRegression?.queuedImpact ? "yes" : "no"}`,
    `- Over-horizon area-fire regression: queued=${summary.overHorizonAreaFireRegression?.queuedImpact ? "yes" : "no"}, detected=${summary.overHorizonAreaFireRegression?.detectedCount || 0}, contacts=${summary.overHorizonAreaFireRegression?.contactCount || 0}`,
    `- Preparatory area-fire regression: queued=${summary.preparatoryAreaFireRegression?.queuedImpact ? "yes" : "no"}, last-known=${summary.preparatoryAreaFireRegression?.lastKnownCount || 0}, contacts=${summary.preparatoryAreaFireRegression?.contactCount || 0}`,
    `- Emplacement regression: arrived=${summary.artilleryEmplacementRegression?.arrived ? "yes" : "no"}, moving-fire=${summary.artilleryEmplacementRegression?.movingFireObserved ? "yes" : "no"}, emplaced-fire=${summary.artilleryEmplacementRegression?.emplacedFireObserved ? "yes" : "no"}`,
    `- Zone recovery regression: completed=${summary.zoneTaskCompletionRegression?.completed ? "yes" : "no"}, invalidated=${summary.zoneTaskCompletionRegression?.commanderInvalidated ? "yes" : "no"}, next-role=${summary.zoneTaskCompletionRegression?.nextRole || "none"}`,
    `- Objective approach coverage: ${Object.entries(summary.objectiveApproachCoverage || {}).map(([actorId, entry]) => `${actorId}=${Math.round((entry.ratio || 0) * 100)}%`).join(" / ") || "none"}`,
    `- HQ exposure: ${Object.entries(summary.headquartersExposure || {}).map(([actorId, entry]) => `${actorId}=${Math.round((entry.exposureRatio || 0) * 100)}%`).join(" / ") || "none"}`,
    `- Stack-limit hotspot peak: ${summary.stackCollisionHotspots?.maxEventsPerHex || 0}`,
    `- Concentration violations: ${summary.concentrationViolations.length}`,
    "",
    "## Notes",
    "",
    "- This harness runs the Cold War AI duel twice with the same seed to catch nondeterministic commander/director behavior.",
    "- The provenance check is deliberately strict: any tag outside the legal FOW vocabulary fails the run.",
    "- The sustained spread check uses the long multi-zone run and ignores late-game states where only one non-friendly zone remains.",
  ].join("\n");

  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, report);

  console.log(`[rts-ai] status=${summary.status} checks=${checks.filter((check) => check.pass).length}/${checks.length}`);
  console.log(`[rts-ai] report=${latestReportPath}`);
  console.log(`[rts-ai] summary=${latestSummaryPath}`);

  if (!summary.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  const failureSummary = {
    ok: false,
    status: "failed",
    runId,
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
  };
  writeJson(latestSummaryPath, failureSummary);
  writeMarkdown(latestReportPath, `# RTS AI Smoke Failed\n\n- Error: ${error.message}\n`);
  console.error(`[rts-ai] ${error.stack || error.message}`);
  process.exitCode = 1;
}
