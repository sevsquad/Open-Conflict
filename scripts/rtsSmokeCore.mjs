#!/usr/bin/env node

import path from "node:path";

import { getTestFixture } from "../src/testFixture.js";
import { computeEnhancedLOS, hexDistance, hexLine } from "../src/mapRenderer/HexMath.js";
import { cellToPositionString, parseUnitPosition } from "../src/mapRenderer/overlays/UnitOverlay.js";
import { buildRtsMatch } from "../src/rts/rtsStart.js";
import { tickRtsMatch } from "../src/rts/rtsEngine.js";
import { buildZoneModel, resolveLaneTraversal } from "../src/rts/zoneModel.js";
import { getHeloInsertionPreset, getPresetById, getServerAiDuelPreset } from "../src/simulation/presets.js";
import {
  buildScenario,
  buildTickStats,
  clone,
  ensureDir,
  makeRunId,
  normalizeStateForHash,
  projectRoot,
  renderChecks,
  renderOutcome,
  reportRoot,
  runMatch,
  sha256Json,
  summarizeOutcome,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const runId = makeRunId("rts-core");
const runDir = path.join(reportRoot, "runs", runId);
const latestSummaryPath = path.join(reportRoot, "latest-core-summary.json");
const latestReportPath = path.join(reportRoot, "latest-core-report.md");

ensureDir(runDir);

function summarizeZoneMerge(zoneModel) {
  return (zoneModel?.zones || [])
    .map((zone) => ({
      totalVp: zone.totalVp,
      members: [...(zone.memberVpIds || [])].sort(),
      sourceVp: zone.sourceVp,
    }))
    .sort((left, right) => right.totalVp - left.totalVp || left.members.join("|").localeCompare(right.members.join("|")));
}

function buildZoneMergeScenario(entries) {
  return {
    title: "Zone Merge Fixture",
    actors: [],
    units: [],
    victoryConditions: {
      vpGoal: 999,
      hexVP: entries.map((entry) => ({
        hex: entry.hex,
        name: entry.name,
        vp: entry.vp,
      })),
    },
  };
}

const CORE_LOS_TERRAIN_EFFECTS = {
  forest: "block",
  dense_forest: "block",
  jungle: "block",
  jungle_hills: "block",
  jungle_mountains: "block",
  boreal: "block",
  boreal_hills: "block",
  boreal_mountains: "block",
  dense_urban: "block",
  light_urban: "partial",
  suburban: "partial",
  bldg_light: "partial",
  bldg_residential: "partial",
  bldg_commercial: "block",
  bldg_highrise: "block",
  bldg_institutional: "block",
  bldg_industrial: "block",
  bldg_fortified: "block",
  mountain: "block",
  peak: "block",
  mountain_forest: "block",
  forested_hills: "partial",
};

const CORE_CANOPY_HEIGHTS = {
  forest: 20,
  dense_forest: 25,
  jungle: 28,
  jungle_hills: 28,
  boreal: 18,
  boreal_hills: 18,
  dense_urban: 22,
  light_urban: 12,
  bldg_highrise: 35,
  bldg_commercial: 22,
  bldg_institutional: 18,
  bldg_industrial: 16,
  bldg_fortified: 14,
};

function setFixtureUnitHex(unit, hex) {
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

function actorHasDetectedTarget(state, actorId, targetUnitId) {
  const view = state.perceptionState?.[actorId] || {};
  return (view.detectedUnits || []).includes(targetUnitId) || (view.contactUnits || []).includes(targetUnitId);
}

function findClearLosPair(terrainData, { minDistance = 3, maxDistance = minDistance } = {}) {
  const entries = Object.entries(terrainData?.cells || {})
    .map(([hex, cell]) => ({ hex, cell, pos: parseUnitPosition(hex) }))
    .filter((entry) => entry.pos && entry.cell);
  for (let sourceIndex = 0; sourceIndex < entries.length; sourceIndex += 1) {
    const source = entries[sourceIndex];
    const sourceEffect = CORE_LOS_TERRAIN_EFFECTS[source.cell.terrain];
    if (sourceEffect === "block") continue;
    for (let targetIndex = sourceIndex + 1; targetIndex < entries.length; targetIndex += 1) {
      const target = entries[targetIndex];
      const targetEffect = CORE_LOS_TERRAIN_EFFECTS[target.cell.terrain];
      if (targetEffect === "block") continue;
      const distance = hexDistance(source.pos.c, source.pos.r, target.pos.c, target.pos.r);
      if (distance < minDistance || distance > maxDistance) continue;
      const los = computeEnhancedLOS(
        source.pos.c,
        source.pos.r,
        target.pos.c,
        target.pos.r,
        terrainData,
        CORE_LOS_TERRAIN_EFFECTS,
        CORE_CANOPY_HEIGHTS
      );
      if (los.result !== "CLEAR") continue;
      const line = hexLine(source.pos.c, source.pos.r, target.pos.c, target.pos.r).map((cell) => cellToPositionString(cell.col, cell.row));
      if (line.length < 2) continue;
      return {
        sourceHex: source.hex,
        targetHex: target.hex,
        distance,
        line,
        centerHex: line[Math.floor(line.length / 2)] || line[1] || target.hex,
      };
    }
  }
  return null;
}

function buildBinaryPerceptionState(terrainData, {
  seed,
  blueType,
  redType,
  blueHex,
  redHex,
  areaEffects = [],
} = {}) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const blueUnit = (state.units || []).find((unit) => unit.actor === blueId && unit.type === blueType);
  const redUnit = (state.units || []).find((unit) => unit.actor === redId && unit.type === redType);
  if (!blueId || !redId || !blueUnit || !redUnit || !blueHex || !redHex) {
    return { error: "missing-binary-perception-fixture" };
  }

  const keepIds = new Set([blueUnit.id, redUnit.id]);
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
  }

  setFixtureUnitHex(blueUnit, blueHex);
  setFixtureUnitHex(redUnit, redHex);
  state.combat.areaEffects = areaEffects.map((effect) => ({ ...effect }));
  return {
    state,
    blueId,
    redId,
    blueUnitId: blueUnit.id,
    redUnitId: redUnit.id,
  };
}

function getZoneHexes(zone) {
  return Array.from(new Set([...(zone?.hexIds || []), ...(zone?.borderHexIds || []), ...(zone?.coreHexIds || [])]));
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
            .map((cell) => cellToPositionString(cell.col, cell.row))
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
  }
  return null;
}

function buildCounterBatteryCoreState(terrainData, seed = 8833) {
  const scenario = buildScenario(getServerAiDuelPreset(), {
    seed,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed });
  const blueId = scenario.actors?.[0]?.id || null;
  const redId = scenario.actors?.[1]?.id || null;
  const blueArtillery = (state.units || []).find((unit) => unit.actor === blueId && unit.type === "artillery");
  const redArtillery = (state.units || []).find((unit) => unit.actor === redId && unit.type === "artillery");
  const layout = findArtilleryRegressionLayout(state.scenario?.zoneModel);
  if (!blueId || !redId || !blueArtillery || !redArtillery || !layout) {
    return { error: "missing-counter-battery-fixture" };
  }

  const keepIds = new Set([blueArtillery.id, redArtillery.id]);
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
    unit.modeState.weaponCooldownMs = 0;
  }

  setFixtureUnitHex(blueArtillery, layout.startHex);
  setFixtureUnitHex(redArtillery, layout.redArtHex);
  state.combat.spotterPool = {
    [redId]: {
      [blueArtillery.id]: {
        firstSeenAtMs: 0,
        lastConfirmedAtMs: 0,
        expiresAtMs: 45000,
        quality: "observed",
        spotterId: redArtillery.id,
        spotterType: redArtillery.type,
        targetHex: blueArtillery.position,
        zoneId: layout.zoneId,
      },
    },
  };
  redArtillery.modeState.fireMission = {
    taskId: "counter-battery-core-enemy-fire",
    ammoType: "destroy",
    zoneId: layout.zoneId,
    targetHex: blueArtillery.position,
    targetUnitIds: [blueArtillery.id],
    missionRadius: 1,
  };
  redArtillery.modeState.fireMissionAmmoType = "destroy";
  redArtillery.modeState.fireMissionZoneId = layout.zoneId;
  redArtillery.modeState.fireMissionTargetHex = blueArtillery.position;

  return {
    state,
    blueId,
    redId,
    blueArtilleryId: blueArtillery.id,
    redArtilleryId: redArtillery.id,
    zoneId: layout.zoneId,
  };
}

try {
  const terrainData = getTestFixture();
  const slowMovementScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 4099,
    actorOverride: (actor) => ({ controller: "player", isAi: false }),
  });
  const slowMovementRun = runMatch({
    scenario: slowMovementScenario,
    terrainData,
    seed: 4099,
    totalTicks: 12,
    schedule: [{ tick: 0, kind: "move", unitNames: ["1st Recon (Shadow)"], targetHex: "8,3" }],
  });
  const conflictScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 4101,
    actorOverride: (actor) => ({ controller: "player", isAi: false }),
  });
  const conflictSchedule = [
    { tick: 0, kind: "move", unitNames: ["1st Recon (Shadow)"], targetHex: "8,3" },
    { tick: 0, kind: "move", unitNames: ["1st Armor (Steel)"], targetHex: "8,3" },
  ];
  const conflictA = runMatch({ scenario: conflictScenario, terrainData, seed: 4101, totalTicks: 180, schedule: conflictSchedule });
  const conflictB = runMatch({ scenario: conflictScenario, terrainData, seed: 4101, totalTicks: 180, schedule: conflictSchedule });

  const stackLimitScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 4127,
    actorOverride: (actor) => ({ controller: "player", isAi: false }),
  });
  const stackLimitSchedule = [
    { tick: 0, kind: "move", unitNames: ["1st Recon (Shadow)"], targetHex: "8,3" },
    { tick: 0, kind: "move", unitNames: ["Alpha Company"], targetHex: "8,3" },
    { tick: 0, kind: "move", unitNames: ["1st Armor (Steel)"], targetHex: "8,3" },
  ];
  const stackLimitRun = runMatch({ scenario: stackLimitScenario, terrainData, seed: 4127, totalTicks: 180, schedule: stackLimitSchedule });

  const timedScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 5511,
    actorOverride: () => ({ controller: "player", isAi: false }),
    rtsOptions: { durationLimitMinutes: 1 },
  });
  timedScenario.victoryConditions = { vpGoal: 999, hexVP: [] };
  const timedRun = runMatch({ scenario: timedScenario, terrainData, seed: 5511, totalTicks: 241 });

  const delayedReleaseScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 6613,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const delayedRecon = delayedReleaseScenario.units.find((unit) => unit.name === "1st Recon (Shadow)");
  if (delayedRecon) {
    delayedRecon.releaseDelaySeconds = 90;
  }
  const delayedReleaseRun = runMatch({
    scenario: delayedReleaseScenario,
    terrainData,
    seed: 6613,
    totalTicks: 12,
    schedule: [{ tick: 0, kind: "move", unitNames: ["1st Recon (Shadow)"], targetHex: "8,3" }],
  });

  const objectiveSeedScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 6627,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  objectiveSeedScenario.victoryConditions = {
    vpGoal: 999,
    hexVP: [{ hex: "0,0", name: "Rear Area", vp: 10, initialController: "actor_2" }],
  };
  const objectiveSeedRun = runMatch({ scenario: objectiveSeedScenario, terrainData, seed: 6627, totalTicks: 4 });

  const suppressionScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 6841,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const suppressionPrep = runMatch({
    scenario: suppressionScenario,
    terrainData,
    seed: 6841,
    totalTicks: 2,
    schedule: [{ tick: 0, kind: "move", unitNames: ["1st Recon (Shadow)"], targetHex: "10,3" }],
  });
  const suppressionState = clone(suppressionPrep.state);
  const suppressionRecon = suppressionState.units.find((unit) => unit.name === "1st Recon (Shadow)");
  if (suppressionRecon) {
    suppressionRecon.modeState.suppression = 1.1;
  }
  const suppressionRun = runMatch({
    scenario: suppressionScenario,
    terrainData,
    seed: 6841,
    totalTicks: 5,
    initialState: suppressionState,
    initialCommandSeq: suppressionPrep.commandSeq,
    startTick: 2,
  });

  const parentNormalizationScenario = buildScenario(getPresetById("fulda_gap"), {
    seed: 7313,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const pegasus = parentNormalizationScenario.units.find((unit) => unit.name === "2nd Bde HQ (Pegasus)");
  const warhammer = parentNormalizationScenario.units.find((unit) => unit.name === "1-14 Mech Infantry (Warhammer)");
  if (warhammer) {
    warhammer.parentHQ = "stale_pegasus_reference";
  }
  const parentNormalizationRun = runMatch({ scenario: parentNormalizationScenario, terrainData, seed: 7313, totalTicks: 1 });

  const heloScenario = buildScenario(getHeloInsertionPreset(), {
    seed: 7719,
    actorOverride: (actor, index) => ({
      controller: index === 0 ? "player" : "player",
      isAi: false,
    }),
    rtsOptions: { objectiveHoldSeconds: 60 },
  });
  heloScenario.victoryConditions = {
    ...(heloScenario.victoryConditions || {}),
    vpGoal: 999,
  };
  const heloSchedule = [
    { tick: 0, kind: "embark_helo", unitNames: ["Air Assault Infantry"], targetUnitName: "Falcon Lift 1", targetHex: "10,8" },
    { tick: 1, kind: "move", unitNames: ["Falcon Lift 1"], targetHex: "7,4" },
    { tick: 1, kind: "attack_move", unitNames: ["Viper Gunship"], targetHex: "7,5", targetUnitName: "Shilka Section" },
    { tick: 200, kind: "disembark_helo", unitNames: ["Falcon Lift 1"], targetHex: "8,5" },
  ];
  const heloFull = runMatch({ scenario: heloScenario, terrainData, seed: 7719, totalTicks: 260, schedule: heloSchedule });
  const heloRepeat = runMatch({ scenario: heloScenario, terrainData, seed: 7719, totalTicks: 260, schedule: heloSchedule });
  const heloHalf = runMatch({ scenario: heloScenario, terrainData, seed: 7719, totalTicks: 130, schedule: heloSchedule });
  const heloResumed = runMatch({
    scenario: heloScenario,
    terrainData,
    seed: 7719,
    totalTicks: 260,
    schedule: heloSchedule,
    startTick: 130,
    initialState: clone(heloHalf.state),
    initialCommandSeq: heloHalf.commandSeq,
  });

  const airOnlyObjectiveScenario = buildScenario(getHeloInsertionPreset(), {
    seed: 7721,
    actorOverride: () => ({ controller: "player", isAi: false }),
    rtsOptions: { objectiveHoldSeconds: 0 },
  });
  airOnlyObjectiveScenario.victoryConditions = {
    vpGoal: 999,
    hexVP: [{ hex: "7,4", name: "Landing Zone", vp: 10 }],
  };
  airOnlyObjectiveScenario.units = (airOnlyObjectiveScenario.units || [])
    .filter((unit) => ["Falcon Lift 1", "Viper Gunship"].includes(unit.name))
    .map((unit) => ({ ...unit, actor: "actor_1", parentHQ: "" }));
  const airOnlyControlRun = runMatch({
    scenario: airOnlyObjectiveScenario,
    terrainData,
    seed: 7721,
    totalTicks: 160,
    schedule: [
      { tick: 0, kind: "move", unitNames: ["Falcon Lift 1"], targetHex: "7,4" },
      { tick: 0, kind: "move", unitNames: ["Viper Gunship"], targetHex: "7,4" },
    ],
  });

  const smokeLosPair = findClearLosPair(terrainData, { minDistance: 3, maxDistance: 4 });
  const smokeBaselineSetup = smokeLosPair
    ? buildBinaryPerceptionState(terrainData, {
      seed: 7723,
      blueType: "recon",
      redType: "infantry",
      blueHex: smokeLosPair.sourceHex,
      redHex: smokeLosPair.targetHex,
    })
    : { error: "missing-smoke-los-pair" };
  const smokeBlockedSetup = smokeLosPair
    ? buildBinaryPerceptionState(terrainData, {
      seed: 7724,
      blueType: "recon",
      redType: "infantry",
      blueHex: smokeLosPair.sourceHex,
      redHex: smokeLosPair.targetHex,
      areaEffects: [{
        id: "core-smoke-test",
        kind: "smoke",
        actorId: "actor_1",
        centerHex: smokeLosPair.centerHex,
        radius: 0,
        createdAtMs: 0,
        expiresAtMs: 30000,
      }],
    })
    : { error: "missing-smoke-los-pair" };
  const smokeExpiredSetup = smokeLosPair
    ? buildBinaryPerceptionState(terrainData, {
      seed: 7725,
      blueType: "recon",
      redType: "infantry",
      blueHex: smokeLosPair.sourceHex,
      redHex: smokeLosPair.targetHex,
      areaEffects: [{
        id: "core-smoke-expired",
        kind: "smoke",
        actorId: "actor_1",
        centerHex: smokeLosPair.centerHex,
        radius: 0,
        createdAtMs: 0,
        expiresAtMs: 200,
      }],
    })
    : { error: "missing-smoke-los-pair" };
  const smokeBaselineState = smokeBaselineSetup.error ? null : tickRtsMatch(smokeBaselineSetup.state, terrainData);
  const smokeBlockedState = smokeBlockedSetup.error ? null : tickRtsMatch(smokeBlockedSetup.state, terrainData);
  const smokeExpiredState = smokeExpiredSetup.error ? null : tickRtsMatch(smokeExpiredSetup.state, terrainData);
  const smokeBaselineDetected = smokeBaselineState
    ? actorHasDetectedTarget(smokeBaselineState, smokeBaselineSetup.blueId, smokeBaselineSetup.redUnitId)
    : false;
  const smokeBlockedDetected = smokeBlockedState
    ? actorHasDetectedTarget(smokeBlockedState, smokeBlockedSetup.blueId, smokeBlockedSetup.redUnitId)
    : false;
  const smokeExpiredDetected = smokeExpiredState
    ? actorHasDetectedTarget(smokeExpiredState, smokeExpiredSetup.blueId, smokeExpiredSetup.redUnitId)
    : false;

  const illuminationLosPair = findClearLosPair(terrainData, { minDistance: 8, maxDistance: 8 });
  const illuminationBaselineSetup = illuminationLosPair
    ? buildBinaryPerceptionState(terrainData, {
      seed: 7726,
      blueType: "recon",
      redType: "infantry",
      blueHex: illuminationLosPair.sourceHex,
      redHex: illuminationLosPair.targetHex,
    })
    : { error: "missing-illumination-los-pair" };
  const illuminationBoostedSetup = illuminationLosPair
    ? buildBinaryPerceptionState(terrainData, {
      seed: 7727,
      blueType: "recon",
      redType: "infantry",
      blueHex: illuminationLosPair.sourceHex,
      redHex: illuminationLosPair.targetHex,
      areaEffects: [{
        id: "core-illumination-test",
        kind: "illuminate",
        actorId: "actor_1",
        centerHex: illuminationLosPair.targetHex,
        radius: 0,
        createdAtMs: 0,
        expiresAtMs: 45000,
      }],
    })
    : { error: "missing-illumination-los-pair" };
  const illuminationBaselineState = illuminationBaselineSetup.error ? null : tickRtsMatch(illuminationBaselineSetup.state, terrainData);
  const illuminationBoostedState = illuminationBoostedSetup.error ? null : tickRtsMatch(illuminationBoostedSetup.state, terrainData);
  const illuminationBaselineDetected = illuminationBaselineState
    ? actorHasDetectedTarget(illuminationBaselineState, illuminationBaselineSetup.blueId, illuminationBaselineSetup.redUnitId)
    : false;
  const illuminationBoostedDetected = illuminationBoostedState
    ? actorHasDetectedTarget(illuminationBoostedState, illuminationBoostedSetup.blueId, illuminationBoostedSetup.redUnitId)
    : false;

  const counterBatterySetup = buildCounterBatteryCoreState(terrainData, 7728);
  let counterBatteryQueueEntry = null;
  let counterBatteryMission = null;
  if (!counterBatterySetup.error) {
    const queuedState = tickRtsMatch(counterBatterySetup.state, terrainData);
    counterBatteryQueueEntry = (queuedState.combat?.counterBatteryQueue || []).find((entry) => entry.sourceUnitId === counterBatterySetup.redArtilleryId) || null;
    const blueActor = (queuedState.scenario?.actors || []).find((actor) => actor.id === counterBatterySetup.blueId);
    if (blueActor) {
      blueActor.controller = "ai";
      blueActor.isAi = true;
      blueActor.aiConfig = {
        ...(blueActor.aiConfig || {}),
        engine: "algorithmic",
        directorEnabled: true,
      };
    }
    queuedState.ai = queuedState.ai || { commanders: {}, subordinates: {}, directors: {}, executors: {} };
    const assignedState = tickRtsMatch(queuedState, terrainData);
    counterBatteryMission = Object.values(assignedState.ai?.commanders?.[counterBatterySetup.blueId]?.ownerZoneTasks || {}).find((task) => (
      task?.kind === "fire_mission" && task?.ammoType === "counter_battery"
    )) || null;
  }

  const zoneMergeFixtures = [
    {
      name: "Scenario 1",
      entries: [
        { hex: "4,4", name: "A", vp: 70 },
        { hex: "6,4", name: "B", vp: 40 },
        { hex: "9,4", name: "C", vp: 50 },
      ],
      expected: [
        { totalVp: 110, members: ["4,4", "6,4"] },
        { totalVp: 50, members: ["9,4"] },
      ],
    },
    {
      name: "Scenario 2",
      entries: [
        { hex: "4,6", name: "A", vp: 40 },
        { hex: "6,6", name: "B", vp: 40 },
        { hex: "9,6", name: "C", vp: 50 },
      ],
      expected: [
        { totalVp: 90, members: ["6,6", "9,6"] },
        { totalVp: 40, members: ["4,6"] },
      ],
    },
    {
      name: "Scenario 3",
      entries: [
        { hex: "4,8", name: "A", vp: 10 },
        { hex: "6,8", name: "B", vp: 40 },
        { hex: "9,8", name: "C", vp: 50 },
      ],
      expected: [
        { totalVp: 50, members: ["4,8", "6,8"] },
        { totalVp: 50, members: ["9,8"] },
      ],
    },
    {
      name: "Scenario 4",
      entries: [
        { hex: "4,10", name: "A", vp: 10 },
        { hex: "6,10", name: "B", vp: 50 },
        { hex: "9,10", name: "C", vp: 40 },
      ],
      expected: [
        { totalVp: 100, members: ["4,10", "6,10", "9,10"] },
      ],
    },
    {
      name: "Scenario 5",
      entries: [
        { hex: "4,12", name: "A", vp: 30 },
        { hex: "6,12", name: "B", vp: 50 },
        { hex: "8,12", name: "C", vp: 60 },
      ],
      expected: [
        { totalVp: 110, members: ["6,12", "8,12"] },
        { totalVp: 30, members: ["4,12"] },
      ],
    },
    {
      name: "Scenario 6",
      entries: [
        { hex: "4,14", name: "A", vp: 20 },
        { hex: "6,14", name: "B", vp: 20 },
        { hex: "8,14", name: "C", vp: 20 },
      ],
      expected: [
        { totalVp: 20, members: ["4,14"] },
        { totalVp: 20, members: ["6,14"] },
        { totalVp: 20, members: ["8,14"] },
      ],
    },
  ];
  const zoneMergeResults = zoneMergeFixtures.map((fixture) => ({
    name: fixture.name,
    actual: summarizeZoneMerge(buildZoneModel(buildZoneMergeScenario(fixture.entries), terrainData))
      .map((zone) => ({ totalVp: zone.totalVp, members: zone.members })),
    expected: fixture.expected,
  }));
  const boundaryFixtureModel = buildZoneModel(buildZoneMergeScenario([
    { hex: "4,16", name: "West", vp: 40 },
    { hex: "8,16", name: "East", vp: 40 },
  ]), terrainData);
  const sampleBoundaryHex = (boundaryFixtureModel.boundaryHexIds || []).find((hex) => (boundaryFixtureModel.boundaryClaims?.[hex] || []).length === 2) || null;
  const sampleBoundaryClaims = sampleBoundaryHex ? boundaryFixtureModel.boundaryClaims[sampleBoundaryHex] || [] : [];
  const expectedBoundaryEdgeId = sampleBoundaryClaims.length === 2 ? sampleBoundaryClaims.slice().sort().join("__") : null;
  const directionalLaneScenario = buildScenario({
    ...getServerAiDuelPreset(),
    victoryConditions: {
      vpGoal: 999,
      hexVP: [
        { hex: "3,4", name: "North Ridge", vp: 40 },
        { hex: "6,9", name: "Central Bridge", vp: 80 },
        { hex: "10,6", name: "South Ford", vp: 20 },
      ],
    },
  }, {
    seed: 9931,
    actorOverride: () => ({ controller: "player", isAi: false }),
  });
  const directionalLaneModel = buildZoneModel(directionalLaneScenario, terrainData);
  const directionalLaneFailures = [];
  for (const edge of directionalLaneModel.zoneEdges || []) {
    for (const laneId of edge.laneIds || []) {
      for (const [fromZoneId, toZoneId] of [[edge.zoneA, edge.zoneB], [edge.zoneB, edge.zoneA]]) {
        const resolved = resolveLaneTraversal(directionalLaneModel, laneId, fromZoneId, toZoneId);
        const ingressOwner = resolved?.ingressHex ? directionalLaneModel.interiorHexZoneMap?.[resolved.ingressHex] || null : null;
        const egressOwner = resolved?.egressHex ? directionalLaneModel.interiorHexZoneMap?.[resolved.egressHex] || null : null;
        if (!resolved?.isDirectionalValid || ingressOwner !== fromZoneId || egressOwner !== toZoneId) {
          directionalLaneFailures.push({ laneId, fromZoneId, toZoneId, ingressOwner, egressOwner });
        }
      }
    }
  }

  const slowRecon = slowMovementRun.state.units.find((unit) => unit.name === "1st Recon (Shadow)");
  const recon = conflictA.state.units.find((unit) => unit.name === "1st Recon (Shadow)");
  const armor = conflictA.state.units.find((unit) => unit.name === "1st Armor (Steel)");
  const alphaCompany = stackLimitRun.state.units.find((unit) => unit.name === "Alpha Company");
  const stackRecon = stackLimitRun.state.units.find((unit) => unit.name === "1st Recon (Shadow)");
  const stackArmor = stackLimitRun.state.units.find((unit) => unit.name === "1st Armor (Steel)");
  const transport = heloFull.state.units.find((unit) => unit.name === "Falcon Lift 1");
  const gunship = heloFull.state.units.find((unit) => unit.name === "Viper Gunship");
  const infantry = heloFull.state.units.find((unit) => unit.name === "Air Assault Infantry");
  const eventMessages = (heloFull.state.replay?.events || heloFull.state.truthState?.eventLog || []).map((entry) => entry.message);
  const stackLimitMessages = (stackLimitRun.state.truthState?.eventLog || []).map((entry) => entry.message);
  const timedMessages = (timedRun.state.truthState?.eventLog || []).map((entry) => entry.message);
  const delayedRunMessages = (delayedReleaseRun.state.truthState?.eventLog || []).map((entry) => entry.message);
  const delayedReconState = delayedReleaseRun.state.units.find((unit) => unit.name === "1st Recon (Shadow)");
  const suppressionReconState = suppressionRun.state.units.find((unit) => unit.name === "1st Recon (Shadow)");
  const suppressionMessages = (suppressionRun.state.truthState?.eventLog || []).map((entry) => entry.message);
  const heloOccupancyIds = Object.values(heloFull.state.occupancy || {}).flat();
  const normalizedWarhammer = parentNormalizationRun.state.units.find((unit) => unit.name === "1-14 Mech Infantry (Warhammer)");
  const airOnlyObjectiveController = airOnlyControlRun.state.truthState?.objectives?.["7,4"]?.controller || null;

  const checks = [
    {
      name: "Base RTS movement now stays in transit after 12 ticks instead of finishing the first hex hop",
      pass: slowRecon
        && slowRecon.position !== "8,3"
        && Boolean(slowRecon.modeState?.travelState),
    },
    {
      name: "Same-seed conflict run produced identical normalized state hash",
      pass: conflictA.stateHash === conflictB.stateHash,
    },
    {
      name: "Same-seed conflict run produced identical replay hash",
      pass: conflictA.replayHash === conflictB.replayHash,
    },
    {
      name: "Simultaneous arrival allowed two friendlies to share hex 8,3",
      pass: Array.isArray(conflictA.state.occupancy?.["8,3"])
        && conflictA.state.occupancy["8,3"].length === 2
        && conflictA.state.occupancy["8,3"].includes(recon?.id)
        && conflictA.state.occupancy["8,3"].includes(armor?.id)
        && recon?.position === "8,3"
        && armor?.position === "8,3",
    },
    {
      name: "A third friendly was denied once hex 8,3 reached the two-unit stack cap",
      pass: Array.isArray(stackLimitRun.state.occupancy?.["8,3"])
        && stackLimitRun.state.occupancy["8,3"].length === 2
        && [alphaCompany, stackRecon, stackArmor].filter((unit) => unit?.position === "8,3").length === 2
        && stackLimitMessages.some((message) => message.includes("stack limit is 2 units")),
    },
    {
      name: "Duration limit ended an otherwise idle match on time",
      pass: timedRun.state.game?.status === "finished"
        && timedRun.state.game?.winner === "draw"
        && (timedRun.state.game?.elapsedMs || 0) >= 60_000
        && timedMessages.some((message) => message.includes("Time expired")),
    },
    {
      name: "Delayed-release units ignored commands before their timer elapsed",
      pass: delayedReconState?.position === "7,3"
        && delayedRunMessages.some((message) => message.includes("not released yet")),
    },
    {
      name: "Initial objective controllers seed RTS ownership before the first tick",
      pass: objectiveSeedRun.state.truthState?.objectives?.["0,0"]?.controller === "actor_2",
    },
    {
      name: "Suppression interrupts transit and logs the halt",
      pass: suppressionReconState
        && !suppressionReconState.modeState?.travelState
        && suppressionReconState.modeState?.moraleState === "suppressed"
        && suppressionMessages.some((message) => message.includes("halted movement after losing cohesion")),
    },
    {
      name: "Stale parent HQ references were normalized to a live headquarters unit",
      pass: normalizedWarhammer?.parentHQ === pegasus?.id,
    },
    {
      name: "All six VP clustering fixtures produced the expected source-zone merges",
      pass: zoneMergeResults.every((fixture) => sha256Json(fixture.actual) === sha256Json(fixture.expected)),
    },
    {
      name: "Equidistant cells became explicit boundary hexes and did not count toward any zone interior",
      pass: Boolean(sampleBoundaryHex)
        && sampleBoundaryClaims.length === 2
        && !boundaryFixtureModel.interiorHexZoneMap?.[sampleBoundaryHex]
        && (boundaryFixtureModel.zones || []).every((zone) => !zone.hexIds.includes(sampleBoundaryHex)),
    },
    {
      name: "Shared boundary hexes still produced the expected inter-zone edge",
      pass: Boolean(expectedBoundaryEdgeId)
        && (boundaryFixtureModel.zoneEdges || []).some((edge) => edge.edgeId === expectedBoundaryEdgeId),
    },
    {
      name: "Every generated lane resolved to the correct ingress and egress zone in both directions",
      pass: directionalLaneFailures.length === 0,
    },
    {
      name: "Same-seed helicopter run produced identical normalized state hash",
      pass: heloFull.stateHash === heloRepeat.stateHash,
    },
    {
      name: "Replay from the 130-tick snapshot matched the uninterrupted helicopter run",
      pass: sha256Json(normalizeStateForHash(heloFull.state)) === sha256Json(normalizeStateForHash(heloResumed.state)),
    },
    {
      name: "Helicopter insertion logged embark and disembark events",
      pass: eventMessages.some((message) => message.includes("embarked aboard")) && eventMessages.some((message) => message.includes("disembarked troops")),
    },
    {
      name: "Infantry ended the run disembarked on the map",
      pass: infantry && !infantry.embarkedIn && Boolean(infantry.position),
    },
    {
      name: "Air and airmobile units did not consume ground hex occupancy slots",
      pass: transport
        && gunship
        && infantry
        && !heloOccupancyIds.includes(transport.id)
        && !heloOccupancyIds.includes(gunship.id)
        && !heloOccupancyIds.includes(infantry.id),
    },
    {
      name: "Air-only or airmobile-only presence did not capture RTS objectives",
      pass: airOnlyObjectiveController === null,
    },
    {
      name: "Transport helicopter took resource or combat stress while crossing the AD threat area",
      pass: transport && (
        (transport.fuel ?? 100) < 100 ||
        (transport.strength ?? 100) < 100 ||
        (transport.morale ?? 100) < 90 ||
        (transport.modeState?.suppression || 0) > 0 ||
        transport.modeState?.lastCombatEvent
      ),
    },
    {
      name: "Smoke area effects blocked LOS while active and released it after expiry",
      pass: Boolean(smokeLosPair)
        && smokeBaselineDetected
        && !smokeBlockedDetected
        && smokeExpiredDetected,
    },
    {
      name: "Illumination area effects increased friendly detection inside the lit ring",
      pass: Boolean(illuminationLosPair)
        && !illuminationBaselineDetected
        && illuminationBoostedDetected,
    },
    {
      name: "Enemy artillery fire created a counter-battery queue entry and the next friendly fires owner received a counter-battery mission",
      pass: Boolean(counterBatteryQueueEntry)
        && Boolean(counterBatteryMission)
        && counterBatteryMission.targetHex === counterBatteryQueueEntry.targetHex,
    },
  ];

  const summary = {
    ok: checks.every((check) => check.pass),
    status: checks.every((check) => check.pass) ? "passed" : "failed",
    runId,
    timestamp: new Date().toISOString(),
    scenarios: {
      conflict: {
        stateHash: conflictA.stateHash,
        replayHash: conflictA.replayHash,
        outcome: summarizeOutcome(conflictA.state),
        tickStats: buildTickStats(conflictA.tickTimingsMs),
        issuedCommands: conflictA.issuedCommands,
        perceptionSnapshots: conflictA.perceptionSnapshots,
      },
      timed: {
        stateHash: timedRun.stateHash,
        replayHash: timedRun.replayHash,
        outcome: summarizeOutcome(timedRun.state),
        tickStats: buildTickStats(timedRun.tickTimingsMs),
        issuedCommands: timedRun.issuedCommands,
        perceptionSnapshots: timedRun.perceptionSnapshots,
      },
      helicopter: {
        stateHash: heloFull.stateHash,
        replayHash: heloFull.replayHash,
        outcome: summarizeOutcome(heloFull.state),
        tickStats: buildTickStats(heloFull.tickTimingsMs),
        issuedCommands: heloFull.issuedCommands,
        perceptionSnapshots: heloFull.perceptionSnapshots,
      },
    },
    smokeLosRegression: {
      pair: smokeLosPair,
      baselineDetected: smokeBaselineDetected,
      blockedDetected: smokeBlockedDetected,
      expiredDetected: smokeExpiredDetected,
    },
    illuminationRegression: {
      pair: illuminationLosPair,
      baselineDetected: illuminationBaselineDetected,
      boostedDetected: illuminationBoostedDetected,
    },
    counterBatteryRegression: {
      queued: Boolean(counterBatteryQueueEntry),
      targetHex: counterBatteryQueueEntry?.targetHex || null,
      missionAmmoType: counterBatteryMission?.ammoType || null,
      missionTargetHex: counterBatteryMission?.targetHex || null,
    },
    checks,
  };

  const report = [
    "# RTS Core Smoke Report",
    "",
    `- Status: ${summary.status}`,
    `- Run: \`${summary.runId}\``,
    `- Time: ${summary.timestamp}`,
    "",
    "## Checks",
    "",
    ...renderChecks(summary.checks),
    "",
    "## Conflict Scenario",
    "",
    ...renderOutcome(summary.scenarios.conflict.outcome),
    `- State hash: \`${summary.scenarios.conflict.stateHash}\``,
    `- Replay hash: \`${summary.scenarios.conflict.replayHash}\``,
    `- Tick stats: avg ${summary.scenarios.conflict.tickStats.averageMs}ms, p95 ${summary.scenarios.conflict.tickStats.p95Ms}ms, max ${summary.scenarios.conflict.tickStats.maxMs}ms`,
    "",
    "## Timed Scenario",
    "",
    ...renderOutcome(summary.scenarios.timed.outcome),
    `- State hash: \`${summary.scenarios.timed.stateHash}\``,
    `- Replay hash: \`${summary.scenarios.timed.replayHash}\``,
    `- Tick stats: avg ${summary.scenarios.timed.tickStats.averageMs}ms, p95 ${summary.scenarios.timed.tickStats.p95Ms}ms, max ${summary.scenarios.timed.tickStats.maxMs}ms`,
    "",
    "## Helicopter Scenario",
    "",
    ...renderOutcome(summary.scenarios.helicopter.outcome),
    `- State hash: \`${summary.scenarios.helicopter.stateHash}\``,
    `- Replay hash: \`${summary.scenarios.helicopter.replayHash}\``,
    `- Tick stats: avg ${summary.scenarios.helicopter.tickStats.averageMs}ms, p95 ${summary.scenarios.helicopter.tickStats.p95Ms}ms, max ${summary.scenarios.helicopter.tickStats.maxMs}ms`,
    "",
    "## Notes",
    "",
    "- Conflict smoke checks deterministic occupancy resolution when two friendlies converge on the same hex on the same tick.",
    "- Timed smoke verifies that duration-limited matches terminate cleanly even without VP capture or force destruction.",
    "- Helicopter smoke exercises embark, transit, AD exposure, disembark, and snapshot-resume determinism.",
    `- Smoke LOS regression: baseline=${summary.smokeLosRegression?.baselineDetected ? "seen" : "blocked"}, active-smoke=${summary.smokeLosRegression?.blockedDetected ? "seen" : "blocked"}, expired=${summary.smokeLosRegression?.expiredDetected ? "seen" : "blocked"}.`,
    `- Illumination regression: baseline=${summary.illuminationRegression?.baselineDetected ? "seen" : "not-seen"}, illuminated=${summary.illuminationRegression?.boostedDetected ? "seen" : "not-seen"}.`,
    `- Counter-battery regression: queued=${summary.counterBatteryRegression?.queued ? "yes" : "no"}, mission=${summary.counterBatteryRegression?.missionAmmoType || "none"} -> ${summary.counterBatteryRegression?.missionTargetHex || "none"}.`,
  ].join("\n");

  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, report);

  console.log(`[rts-core] status=${summary.status} checks=${checks.filter((check) => check.pass).length}/${checks.length}`);
  console.log(`[rts-core] report=${latestReportPath}`);
  console.log(`[rts-core] summary=${latestSummaryPath}`);

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
  writeMarkdown(latestReportPath, `# RTS Core Smoke Failed\n\n- Error: ${error.message}\n`);
  console.error(`[rts-core] ${error.stack || error.message}`);
  process.exitCode = 1;
}
