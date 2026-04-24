#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { hexDistance } from "../src/mapRenderer/HexMath.js";
import { parseUnitPosition } from "../src/mapRenderer/overlays/UnitOverlay.js";
import { buildZoneModel, getObjectiveZoneId } from "../src/rts/zoneModel.js";
import { getTestFixture } from "../src/testFixture.js";
import { getHeloInsertionPreset, getServerAiDuelPreset } from "../src/simulation/presets.js";
import {
  buildScenario,
  buildTickStats,
  clone,
  ensureDir,
  makeRunId,
  reportRoot,
  runMatch,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const RESEARCH_ROOT = path.join(reportRoot, "research");
const DEFAULT_WORKERS = Math.min(16, Math.max(4, Math.floor(os.cpus().length / 2)));
const DEFAULT_PROFILE_SET = [
  "balanced",
  "cautious_defender",
  "aggressive_breakthrough",
  "rough_terrain_flanker",
  "urban_grinder",
];
const IDENTICAL_SIDE_PROFILE = "balanced";
const IDENTICAL_SIDE_OBJECTIVES = [
  "Secure and hold decisive objective zones without collapsing frontage.",
  "Preserve combat power long enough to sustain pressure after first contact.",
  "Exploit opportunities only when support, reserve posture, and local control are coherent.",
];
const IDENTICAL_SIDE_CONSTRAINTS = [
  "Do not overextend without support or a recoverable fallback route.",
  "Keep some reserve capacity until the local fight clearly justifies commitment.",
];
const METRIC_STATUS = {
  measured: "measured",
  proxy: "proxy",
  blocked: "blocked",
};

const BUCKET_CONFIG = {
  hard_invariants: {
    label: "Hard Invariants",
    allocation: 900,
    scenarioMix: [
      { scenarioId: "multi_zone_control", count: 320 },
      { scenarioId: "encirclement", count: 220 },
      { scenarioId: "helo_ai", count: 140 },
      { scenarioId: "rear_probe", count: 120 },
      { scenarioId: "long_run_duel", count: 100 },
    ],
  },
  decision_quality: {
    label: "Decision Quality",
    allocation: 900,
    scenarioMix: [
      { scenarioId: "multi_zone_control", count: 320 },
      { scenarioId: "encirclement", count: 220 },
      { scenarioId: "low_supply", count: 160 },
      { scenarioId: "attrition", count: 120 },
      { scenarioId: "helo_ai", count: 80 },
    ],
  },
  profile_differentiation: {
    label: "Profile Differentiation",
    allocation: 600,
    profileComparison: true,
    seedFamilies: 120,
    profiles: DEFAULT_PROFILE_SET,
    scenarioId: "multi_zone_control",
  },
  execution_and_formation: {
    label: "Execution And Formation",
    allocation: 600,
    scenarioMix: [
      { scenarioId: "multi_zone_control", count: 220 },
      { scenarioId: "low_supply", count: 120 },
      { scenarioId: "helo_ai", count: 120 },
      { scenarioId: "rear_probe", count: 80 },
      { scenarioId: "attrition", count: 60 },
    ],
  },
  scenario_stress: {
    label: "Scenario Stress",
    allocation: 600,
    scenarioMix: [
      { scenarioId: "rear_probe", count: 140 },
      { scenarioId: "encirclement", count: 140 },
      { scenarioId: "low_supply", count: 120 },
      { scenarioId: "attrition", count: 80 },
      { scenarioId: "helo_ai", count: 60 },
      { scenarioId: "long_run_duel", count: 60 },
    ],
  },
};

const OPTIONAL_BUCKET_CONFIG = {
  symmetry_validation: {
    label: "Symmetry Validation",
    allocation: 1000,
    identicalSides: true,
    profile: IDENTICAL_SIDE_PROFILE,
    scenarioMix: [
      { scenarioId: "multi_zone_control", count: 320 },
      { scenarioId: "encirclement", count: 220 },
      { scenarioId: "rear_probe", count: 160 },
      { scenarioId: "low_supply", count: 120 },
      { scenarioId: "attrition", count: 120 },
      { scenarioId: "long_run_duel", count: 60 },
    ],
  },
};
const ALL_BUCKET_CONFIG = {
  ...BUCKET_CONFIG,
  ...OPTIONAL_BUCKET_CONFIG,
};

const BUCKET_METRIC_CATALOG = {
  hard_invariants: {
    replan_churn: METRIC_STATUS.measured,
    stuck_unit_rate: METRIC_STATUS.measured,
    ping_pong_rate: METRIC_STATUS.measured,
    threat_neglect_time: METRIC_STATUS.measured,
    objective_neglect_time: METRIC_STATUS.measured,
    frontier_depth_overshoot: METRIC_STATUS.measured,
    invalid_support_rate: METRIC_STATUS.measured,
    lane_congestion_burden: METRIC_STATUS.measured,
    dead_task_pursuit: METRIC_STATUS.measured,
    garrison_anchor_violations: METRIC_STATUS.proxy,
    constraint_violations: METRIC_STATUS.proxy,
    narrative_intent_drift: METRIC_STATUS.proxy,
  },
  decision_quality: {
    decision_source_mix: METRIC_STATUS.measured,
    contact_response_latency: METRIC_STATUS.measured,
    reserve_release_latency: METRIC_STATUS.measured,
    plan_completion_rate: METRIC_STATUS.measured,
    time_to_first_objective_pressure: METRIC_STATUS.measured,
    opportunity_conversion: METRIC_STATUS.measured,
    commander_director_coherence: METRIC_STATUS.measured,
    package_churn: METRIC_STATUS.measured,
    package_dwell_time: METRIC_STATUS.measured,
    overcommitment_rate: METRIC_STATUS.measured,
    undercommitment_rate: METRIC_STATUS.measured,
    loss_economics: METRIC_STATUS.proxy,
    fire_allocation_quality: METRIC_STATUS.proxy,
    support_response_latency: METRIC_STATUS.proxy,
  },
  profile_differentiation: {
    breadth_vs_focus: METRIC_STATUS.measured,
    reserve_behavior: METRIC_STATUS.measured,
    terrain_preference_realization: METRIC_STATUS.proxy,
    risk_appetite_realized: METRIC_STATUS.proxy,
    recon_appetite_realized: METRIC_STATUS.measured,
    relief_counterattack_tendency: METRIC_STATUS.measured,
    rear_security_preservation: METRIC_STATUS.measured,
    exploitation_behavior: METRIC_STATUS.measured,
    profile_separability: METRIC_STATUS.measured,
  },
  execution_and_formation: {
    formation_coherence: METRIC_STATUS.measured,
    support_leash: METRIC_STATUS.measured,
    main_effort_cohesion: METRIC_STATUS.measured,
    frontline_coverage_gaps: METRIC_STATUS.measured,
    assault_to_support_ratio: METRIC_STATUS.measured,
    route_efficiency: METRIC_STATUS.proxy,
    traffic_idle_time: METRIC_STATUS.measured,
    command_latency: METRIC_STATUS.measured,
    order_replacement_rate: METRIC_STATUS.measured,
    execution_fidelity: METRIC_STATUS.measured,
    special_asset_sanity: METRIC_STATUS.measured,
  },
  scenario_stress: {
    bridge_loss_adaptation_latency: METRIC_STATUS.blocked,
    surprise_rear_contact_response: METRIC_STATUS.measured,
    false_intel_susceptibility: METRIC_STATUS.proxy,
    encirclement_reaction: METRIC_STATUS.measured,
    multi_objective_tradeoff_quality: METRIC_STATUS.measured,
    attrition_stress_response: METRIC_STATUS.measured,
    low_supply_behavior: METRIC_STATUS.measured,
    helo_exception_quality: METRIC_STATUS.measured,
    long_run_fatigue: METRIC_STATUS.measured,
    recovery_after_failure: METRIC_STATUS.measured,
  },
};

const OPTIONAL_BUCKET_METRIC_CATALOG = {
  symmetry_validation: {
    opening_primary_zone_symmetry: METRIC_STATUS.measured,
    opening_role_symmetry: METRIC_STATUS.measured,
    role_mix_divergence: METRIC_STATUS.measured,
    reserve_release_symmetry: METRIC_STATUS.measured,
    objective_pressure_symmetry: METRIC_STATUS.measured,
    side_advantage: METRIC_STATUS.measured,
    asymmetry_score: METRIC_STATUS.measured,
    outcome_consistency: METRIC_STATUS.measured,
    timer_threshold_consistency: METRIC_STATUS.measured,
  },
};
const ALL_BUCKET_METRIC_CATALOG = {
  ...BUCKET_METRIC_CATALOG,
  ...OPTIONAL_BUCKET_METRIC_CATALOG,
};

export function buildResearchRtsOptions(overrides = {}) {
  return {
    objectiveHoldSeconds: 20,
    durationLimitMinutes: 8,
    snapshotEveryTicks: 16,
    maxSnapshots: 320,
    maxLogItems: 2500,
    maxReplayEvents: 5000,
    ...overrides,
  };
}

export function enableAiActor(actor, profile = null, extraAiConfig = {}) {
  return {
    controller: "ai",
    isAi: true,
    aiConfig: {
      ...(actor.aiConfig || {}),
      engine: "algorithmic",
      directorEnabled: true,
      ...(profile ? { profile } : {}),
      ...extraAiConfig,
    },
  };
}

function normalizeScenarioForIdenticalSides(scenario, task) {
  const sharedProfile = task.profile || IDENTICAL_SIDE_PROFILE;
  const sharedCriticalHexes = Array.from(new Set(
    ((scenario.victoryConditions?.hexVP || scenario.objectives?.hexVP || []).map((objective) => objective.hex)).filter(Boolean)
  ));
  scenario.actors = (scenario.actors || []).map((actor) => ({
    ...actor,
    ...enableAiActor(actor, sharedProfile, { thinkBudget: "deliberate" }),
    objectives: [...IDENTICAL_SIDE_OBJECTIVES],
    constraints: [...IDENTICAL_SIDE_CONSTRAINTS],
    cvpHexes: sharedCriticalHexes,
  }));
  scenario.researchMetadata = {
    ...(scenario.researchMetadata || {}),
    identicalSides: true,
    sharedProfile,
    sharedCriticalHexes,
  };
  return scenario;
}

function mirrorScenarioSides(scenario) {
  const actors = scenario.actors || [];
  if (actors.length < 2) return scenario;
  const actorSwap = {
    [actors[0].id]: actors[1].id,
    [actors[1].id]: actors[0].id,
  };
  scenario.units = (scenario.units || []).map((unit) => ({
    ...unit,
    actor: actorSwap[unit.actor] || unit.actor,
  }));
  scenario.researchMetadata = {
    ...(scenario.researchMetadata || {}),
    mirrorSides: true,
    actorSwap,
  };
  return scenario;
}

function buildMultiZoneBasePreset() {
  return {
    ...getServerAiDuelPreset(),
    victoryConditions: {
      vpGoal: 60,
      hexVP: [
        { hex: "3,4", name: "North Ridge", vp: 20 },
        { hex: "6,9", name: "Central Bridge", vp: 30 },
        { hex: "10,6", name: "South Ford", vp: 10 },
      ],
    },
  };
}

function formatHex(c, r) {
  return `${Math.round(c)},${Math.round(r)}`;
}

function offsetHex(hex, dc = 0, dr = 0) {
  const parsed = parseUnitPosition(hex);
  if (!parsed) return hex;
  return formatHex(parsed.c + dc, parsed.r + dr);
}

function scaleHex(hex, scaleX = 1, scaleY = scaleX) {
  const parsed = parseUnitPosition(hex);
  if (!parsed) return hex;
  return formatHex(parsed.c * scaleX, parsed.r * scaleY);
}

export function buildExpandedTestFixture({ colMultiplier = 2, rowMultiplier = 2 } = {}) {
  const base = getTestFixture();
  const cells = {};
  for (let tileR = 0; tileR < rowMultiplier; tileR += 1) {
    for (let tileC = 0; tileC < colMultiplier; tileC += 1) {
      const colOffset = tileC * base.cols;
      const rowOffset = tileR * base.rows;
      for (const [hex, cell] of Object.entries(base.cells || {})) {
        const parsed = parseUnitPosition(hex);
        if (!parsed) continue;
        cells[formatHex(parsed.c + colOffset, parsed.r + rowOffset)] = clone(cell);
      }
    }
  }
  const linearPaths = [];
  for (let tileR = 0; tileR < rowMultiplier; tileR += 1) {
    for (let tileC = 0; tileC < colMultiplier; tileC += 1) {
      const colOffset = tileC * base.cols;
      const rowOffset = tileR * base.rows;
      for (const pathDef of base.linearPaths || []) {
        linearPaths.push({
          ...clone(pathDef),
          cells: (pathDef.cells || []).map(([c, r]) => [c + colOffset, r + rowOffset]),
        });
      }
    }
  }
  return {
    ...clone(base),
    cols: base.cols * colMultiplier,
    rows: base.rows * rowMultiplier,
    widthKm: (base.widthKm || base.cols) * colMultiplier,
    heightKm: (base.heightKm || base.rows) * rowMultiplier,
    cells,
    linearPaths,
  };
}

function buildLargeResearchPreset() {
  const base = clone(buildMultiZoneBasePreset());
  const scaledUnits = (base.units || []).map((unit) => ({
    ...unit,
    position: scaleHex(unit.position, 2),
  }));
  const duplicatedUnits = [];
  for (const unit of scaledUnits) {
    duplicatedUnits.push(unit);
    duplicatedUnits.push({
      ...clone(unit),
      id: `${unit.id}_south`,
      name: `${unit.name} (South)`,
      position: offsetHex(unit.position, 0, 12),
      parentHQ: unit.parentHQ ? `${unit.parentHQ}_south` : "",
    });
  }
  return {
    ...base,
    title: `${base.title} Large Smoke Harness`,
    description: "Expanded 24x36 research scenario with doubled formations on two parallel lanes for harness tuning.",
    victoryConditions: {
      ...clone(base.victoryConditions || {}),
      vpGoal: 120,
      hexVP: [
        { hex: scaleHex("3,4", 2), name: "North Ridge", vp: 20 },
        { hex: scaleHex("6,9", 2), name: "North Crossing", vp: 20 },
        { hex: scaleHex("10,6", 2), name: "North Ford", vp: 20 },
        { hex: offsetHex(scaleHex("3,4", 2), 0, 12), name: "South Ridge", vp: 20 },
        { hex: offsetHex(scaleHex("6,9", 2), 0, 12), name: "South Crossing", vp: 20 },
        { hex: offsetHex(scaleHex("10,6", 2), 0, 12), name: "South Ford", vp: 20 },
      ],
    },
    units: duplicatedUnits,
    researchMetadata: {
      ...(base.researchMetadata || {}),
      scenarioScale: "double",
      terrainMode: "expanded_fixture",
      scenarioFamily: "large_smoke_family",
    },
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
  if (!blueId || !redId || !rearZone || !centralZone || !pocketZone) return;

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

function configureRearProbeScenario(scenario, terrainData) {
  const zoneModel = buildZoneModel(scenario, terrainData);
  const actors = scenario.actors || [];
  const blueId = actors[0]?.id;
  const redId = actors[1]?.id;
  if (!blueId || !redId) return;

  const objectives = scenario.victoryConditions?.hexVP || [];
  const averageColForActor = (actorId) => {
    const positions = (scenario.units || [])
      .filter((unit) => unit.actor === actorId)
      .map((unit) => parseUnitPosition(unit.position))
      .filter(Boolean);
    return positions.length > 0 ? average(positions.map((pos) => pos.c)) : 0;
  };
  const blueAvgCol = averageColForActor(blueId);
  const redAvgCol = averageColForActor(redId);
  const sortedObjectives = objectives
    .map((objective) => ({ objective, pos: parseUnitPosition(objective.hex) }))
    .filter((entry) => entry.pos)
    .sort((left, right) => left.pos.c - right.pos.c);
  const rearObjectiveForActor = (actorId) => {
    if (sortedObjectives.length === 0) return null;
    const actorAvgCol = actorId === blueId ? blueAvgCol : redAvgCol;
    const enemyAvgCol = actorId === blueId ? redAvgCol : blueAvgCol;
    return actorAvgCol >= enemyAvgCol
      ? sortedObjectives[sortedObjectives.length - 1]?.objective || null
      : sortedObjectives[0]?.objective || null;
  };
  const blueRearObjective = rearObjectiveForActor(blueId);
  const redRearObjective = rearObjectiveForActor(redId);
  const blueRearZoneId = blueRearObjective ? getObjectiveZoneId(zoneModel, blueRearObjective.hex) : null;
  const redRearZoneId = redRearObjective ? getObjectiveZoneId(zoneModel, redRearObjective.hex) : null;
  const blueRearZone = (zoneModel.zones || []).find((zone) => zone.zoneId === blueRearZoneId);
  const redRearZone = (zoneModel.zones || []).find((zone) => zone.zoneId === redRearZoneId);
  const blueRearHexes = [...(blueRearZone?.borderHexIds || []), ...(blueRearZone?.hexIds || [])].filter(Boolean);
  const redRearHexes = [...(redRearZone?.borderHexIds || []), ...(redRearZone?.hexIds || [])].filter(Boolean);
  const blueUnits = (scenario.units || []).filter((unit) => unit.actor === blueId);
  const redUnits = (scenario.units || []).filter((unit) => unit.actor === redId);
  const redProbe = redUnits.find((unit) => unit.type === "recon" || unit.type === "mechanized_infantry" || unit.type === "infantry");
  const blueProbe = blueUnits.find((unit) => unit.type === "recon" || unit.type === "mechanized_infantry" || unit.type === "infantry");

  if (redProbe && blueRearHexes.length > 0) {
    redProbe.position = blueRearHexes[0];
    redProbe.posture = "moving";
  }
  if (blueProbe && redRearHexes.length > 0) {
    blueProbe.position = redRearHexes[0];
    blueProbe.posture = "moving";
  }
}

function configureLowSupplyScenario(scenario) {
  for (const unit of scenario.units || []) {
    if (["armor", "mechanized_infantry", "mechanized", "artillery"].includes(unit.type)) {
      unit.supply = Math.min(unit.supply ?? 100, 42);
      unit.ammo = Math.min(unit.ammo ?? 100, 55);
    } else {
      unit.supply = Math.min(unit.supply ?? 100, 55);
    }
  }
}

function configureAttritionScenario(scenario) {
  for (const unit of scenario.units || []) {
    if (["headquarters", "logistics"].includes(unit.type)) continue;
    unit.strength = Math.min(unit.strength ?? 100, 68);
    unit.morale = Math.min(unit.morale ?? 100, 62);
    unit.readiness = Math.min(unit.readiness ?? 100, 64);
  }
}

export function buildResearchScenario(task, terrainData) {
  const profile = task.profile || null;
  const runtimeHarness = resolveTaskRuntimeHarness(task);
  const sharedActorOverrides = runtimeHarness.actorOverrides?.shared || {};
  const actorOverridesById = runtimeHarness.actorOverrides?.byActorId || {};
  const scenarioScale = task.scenarioScale || runtimeHarness.scenarioScale || "standard";
  const baseRtsOptions = deepMergeObjects(
    buildResearchRtsOptions(task.scenarioId === "long_run_duel"
      ? { durationLimitMinutes: 12, maxSnapshots: 480, maxLogItems: 3200, maxReplayEvents: 6500 }
      : {}),
    runtimeHarness.rtsOptions || {}
  );
  const actorOverride = (actor) => {
    const actorSpecific = actorOverridesById[actor.id] || {};
    const mergedActorConfig = deepMergeObjects(sharedActorOverrides, actorSpecific);
    return enableAiActor(actor, mergedActorConfig.profile || profile, mergedActorConfig);
  };
  if (task.scenarioId === "helo_ai") {
    const scenario = buildScenario(getHeloInsertionPreset(), {
      seed: task.seed,
      actorOverride,
      rtsOptions: deepMergeObjects(baseRtsOptions, {
        objectiveHoldSeconds: 15,
        durationLimitMinutes: 6,
      }),
    });
    const normalizedScenario = task.identicalSides ? normalizeScenarioForIdenticalSides(scenario, task) : scenario;
    return task.mirrorSides ? mirrorScenarioSides(normalizedScenario) : normalizedScenario;
  }

  const scenario = buildScenario(scenarioScale === "double" ? buildLargeResearchPreset() : buildMultiZoneBasePreset(), {
    seed: task.seed,
    actorOverride,
    rtsOptions: deepMergeObjects(baseRtsOptions, scenarioScale === "double"
      ? { durationLimitMinutes: 8, maxSnapshots: 420, maxLogItems: 3600, maxReplayEvents: 7200 }
      : {}),
  });

  if (task.scenarioId === "encirclement") {
    configureEncirclementScenario(scenario, terrainData);
  } else if (task.scenarioId === "rear_probe") {
    configureRearProbeScenario(scenario, terrainData);
  } else if (task.scenarioId === "low_supply") {
    configureLowSupplyScenario(scenario);
  } else if (task.scenarioId === "attrition") {
    configureAttritionScenario(scenario);
  }

  scenario.researchMetadata = {
    ...(scenario.researchMetadata || {}),
    scenarioScale,
    terrainMode: task.terrainMode || runtimeHarness.terrainMode || "standard_fixture",
    runtimeHarness: {
      scenarioScale,
      terrainMode: task.terrainMode || runtimeHarness.terrainMode || "standard_fixture",
      actorOverrides: {
        shared: sharedActorOverrides,
        byActorId: actorOverridesById,
      },
      rtsOptions: runtimeHarness.rtsOptions || {},
    },
  };
  const normalizedScenario = task.identicalSides ? normalizeScenarioForIdenticalSides(scenario, task) : scenario;
  return task.mirrorSides ? mirrorScenarioSides(normalizedScenario) : normalizedScenario;
}

function buildBucketTasks() {
  const tasks = {};
  let taskSeq = 0;

  for (const [bucketId, config] of Object.entries(ALL_BUCKET_CONFIG)) {
    if (config.profileComparison) {
      const bucketTasks = [];
      for (let seedFamily = 0; seedFamily < config.seedFamilies; seedFamily += 1) {
        const baseSeed = 50000 + seedFamily;
        for (const profile of config.profiles) {
          bucketTasks.push({
            id: `task_${++taskSeq}`,
            bucketId,
            scenarioId: config.scenarioId,
            seed: baseSeed,
            profile,
            identicalSides: Boolean(config.identicalSides),
          });
        }
      }
      tasks[bucketId] = bucketTasks;
      continue;
    }

    const bucketTasks = [];
    let seed = 1000;
    for (const entry of config.scenarioMix || []) {
      for (let index = 0; index < entry.count; index += 1) {
        bucketTasks.push({
          id: `task_${++taskSeq}`,
          bucketId,
          scenarioId: entry.scenarioId,
          seed: seed++,
          profile: entry.profile ?? config.profile ?? null,
          identicalSides: Boolean(entry.identicalSides ?? config.identicalSides),
        });
      }
    }
    tasks[bucketId] = bucketTasks;
  }

  return tasks;
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deepMergeObjects(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return clone(base);
  }
  const result = clone(base || {});
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMergeObjects(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

function resolveTaskRuntimeHarness(task = {}) {
  return task.runtimeHarness || {};
}

export function resolveTerrainDataForTask(task = {}) {
  const runtimeHarness = resolveTaskRuntimeHarness(task);
  const terrainMode = task.terrainMode || runtimeHarness.terrainMode || "standard_fixture";
  if (terrainMode === "expanded_fixture") {
    return buildExpandedTestFixture();
  }
  return getTestFixture();
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function resolveTimedWinner(scores, livingByActor) {
  const rankedScores = Object.entries(scores || {}).sort((left, right) => right[1] - left[1]);
  if (rankedScores.length === 0) {
    return "draw";
  }
  if (rankedScores.length === 1 || rankedScores[0][1] > rankedScores[1][1]) {
    return rankedScores[0][0];
  }
  const rankedLiving = Object.entries(livingByActor || {}).sort((left, right) => right[1] - left[1]);
  if (rankedLiving.length === 0) return "draw";
  if (rankedLiving.length === 1 || rankedLiving[0][1] > rankedLiving[1][1]) {
    return rankedLiving[0][0];
  }
  return "draw";
}

function summarizeNumeric(values) {
  const filtered = (values || []).filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0, p90: 0 };
  }
  const sorted = [...filtered].sort((a, b) => a - b);
  return {
    count: filtered.length,
    mean: roundMetric(average(filtered)),
    median: roundMetric(median(filtered)),
    min: roundMetric(sorted[0]),
    max: roundMetric(sorted[sorted.length - 1]),
    p90: roundMetric(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]),
  };
}

function objectiveZoneMap(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  return Object.fromEntries(
    (run.state.scenario?.objectives?.hexVP || []).map((objective) => [
      getObjectiveZoneId(zoneModel, objective.hex),
      objective,
    ]).filter(([zoneId]) => Boolean(zoneId))
  );
}

function getZoneIdForHex(zoneModel, hex) {
  return zoneModel?.interiorHexZoneMap?.[hex] || zoneModel?.hexZoneMap?.[hex] || null;
}

function buildZoneAdjacency(zoneModel) {
  const adjacency = {};
  for (const zone of zoneModel?.zones || []) {
    adjacency[zone.zoneId] = new Set();
  }
  for (const edge of zoneModel?.zoneEdges || []) {
    const zones = edge?.zoneIds || edge?.edgeId?.split("__") || [];
    if (zones.length !== 2) continue;
    adjacency[zones[0]] = adjacency[zones[0]] || new Set();
    adjacency[zones[1]] = adjacency[zones[1]] || new Set();
    adjacency[zones[0]].add(zones[1]);
    adjacency[zones[1]].add(zones[0]);
  }
  return adjacency;
}

function buildDepthMapForActor(zoneModel, perSideZones = {}) {
  const adjacency = buildZoneAdjacency(zoneModel);
  const depthMap = {};
  const queue = [];
  for (const zone of zoneModel?.zones || []) {
    const snapshot = perSideZones[zone.zoneId];
    if (snapshot?.state === "friendly" || snapshot?.state === "contested") {
      depthMap[zone.zoneId] = 0;
      queue.push(zone.zoneId);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    const baseDepth = depthMap[current] ?? 0;
    for (const neighbor of adjacency[current] || []) {
      if (depthMap[neighbor] != null) continue;
      depthMap[neighbor] = baseDepth + 1;
      queue.push(neighbor);
    }
  }
  return depthMap;
}

function distanceBetweenHexes(leftHex, rightHex) {
  const left = parseUnitPosition(leftHex);
  const right = parseUnitPosition(rightHex);
  if (!left || !right) return null;
  return hexDistance(left.c, left.r, right.c, right.r);
}

function groupSnapshotsByActor(run) {
  const grouped = {};
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actorId of Object.keys(snapshot.commanderPlans || {})) {
      grouped[actorId] = grouped[actorId] || [];
      grouped[actorId].push(snapshot);
    }
  }
  return grouped;
}

function buildOwnerHistories(run) {
  const histories = {};
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const [actorId, plans] of Object.entries(snapshot.commanderPlans || {})) {
      histories[actorId] = histories[actorId] || {};
      for (const [ownerId, task] of Object.entries(plans || {})) {
        histories[actorId][ownerId] = histories[actorId][ownerId] || [];
        histories[actorId][ownerId].push({
          atMs: snapshot.atMs,
          zoneId: task.zoneId || null,
          role: task.role || task.kind || null,
          provenance: task.provenance || null,
          targetHex: task.targetHex || null,
          assignedAtMs: task.assignedAtMs || null,
        });
      }
    }
  }
  return histories;
}

function buildUnitHistories(run) {
  const histories = {};
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const unit of snapshot.units || []) {
      histories[unit.id] = histories[unit.id] || [];
      histories[unit.id].push({
        atMs: snapshot.atMs,
        actor: unit.actor,
        type: unit.type,
        position: unit.position || unit.settledHex || null,
        settledHex: unit.settledHex || unit.position || null,
        status: unit.status,
        command: unit.command || null,
        commandTargetHex: unit.commandTargetHex || null,
        commandIssuedAtMs: unit.commandIssuedAtMs || null,
        commandBlockedBy: unit.commandBlockedBy || null,
        reserveState: unit.reserveState || null,
      });
    }
  }
  return histories;
}

function getSnapshotStepMs(run) {
  const snapshots = run.state.replay?.snapshots || [];
  if (snapshots.length < 2) return 0;
  const diffs = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    diffs.push(snapshots[index].atMs - snapshots[index - 1].atMs);
  }
  return median(diffs);
}

function computeReplanChurn(ownerHistories) {
  let changeCount = 0;
  let quick30 = 0;
  let quick60 = 0;
  for (const actorHistories of Object.values(ownerHistories || {})) {
    for (const history of Object.values(actorHistories || {})) {
      let lastChangeAtMs = null;
      let previous = null;
      for (const entry of history) {
        if (!previous || previous.zoneId !== entry.zoneId || previous.role !== entry.role) {
          if (lastChangeAtMs != null) {
            const delta = entry.atMs - lastChangeAtMs;
            if (delta <= 30000) quick30 += 1;
            if (delta <= 60000) quick60 += 1;
          }
          changeCount += previous ? 1 : 0;
          lastChangeAtMs = entry.atMs;
        }
        previous = entry;
      }
    }
  }
  return { changeCount, quick30, quick60 };
}

function computeStuckAndTrafficMetrics(unitHistories, stepMs) {
  const windowSamples = Math.max(2, Math.round(30000 / Math.max(stepMs, 1)));
  let activeSamples = 0;
  let stuckSamples = 0;
  let blockedSamples = 0;
  for (const history of Object.values(unitHistories || {})) {
    for (let index = windowSamples; index < history.length; index += 1) {
      const current = history[index];
      const previous = history[index - windowSamples];
      if (!current || !previous) continue;
      if (!current.command || current.command === "hold" || current.command === "halt") continue;
      if (current.status === "destroyed") continue;
      const displacement = distanceBetweenHexes(previous.settledHex, current.settledHex) ?? 0;
      activeSamples += 1;
      if (displacement <= 1) stuckSamples += 1;
      if (current.commandBlockedBy) blockedSamples += 1;
    }
  }
  return {
    activeSamples,
    stuckSamples,
    blockedSamples,
    stuckRate: activeSamples > 0 ? roundMetric(stuckSamples / activeSamples) : 0,
    trafficIdleRate: activeSamples > 0 ? roundMetric(blockedSamples / activeSamples) : 0,
  };
}

function computePingPong(ownerHistories, unitHistories, run) {
  const zoneModel = run.state.scenario?.zoneModel;
  let ownerPingPong = 0;
  let unitPingPong = 0;

  for (const actorHistories of Object.values(ownerHistories || {})) {
    for (const history of Object.values(actorHistories || {})) {
      for (let index = 2; index < history.length; index += 1) {
        const a = history[index - 2]?.zoneId;
        const b = history[index - 1]?.zoneId;
        const c = history[index]?.zoneId;
        if (a && b && c && a === c && a !== b) {
          ownerPingPong += 1;
        }
      }
    }
  }

  for (const history of Object.values(unitHistories || {})) {
    for (let index = 2; index < history.length; index += 1) {
      const a = getZoneIdForHex(zoneModel, history[index - 2]?.settledHex);
      const b = getZoneIdForHex(zoneModel, history[index - 1]?.settledHex);
      const c = getZoneIdForHex(zoneModel, history[index]?.settledHex);
      if (a && b && c && a === c && a !== b) {
        unitPingPong += 1;
      }
    }
  }

  return { ownerPingPong, unitPingPong };
}

function computeThreatAndObjectiveNeglect(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  const objectivesByZone = objectiveZoneMap(run);
  const threatWindows = [];
  const objectiveWindows = [];

  for (const actor of run.state.scenario?.actors || []) {
    const actorId = actor.id;
    let activeThreats = {};
    let activeObjectives = {};
    for (const snapshot of run.state.replay?.snapshots || []) {
      const threatenedZones = new Set(snapshot.directorPackets?.[actorId]?.threatenedZones || []);
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const taskZones = new Set(tasks.map((task) => task.zoneId).filter(Boolean));
      for (const zoneId of threatenedZones) {
        if (!activeThreats[zoneId]) activeThreats[zoneId] = { startedAtMs: snapshot.atMs, addressedAtMs: null };
        if (!activeThreats[zoneId].addressedAtMs && tasks.some((task) => ["contain", "relief", "rear_security", "reserve", "counterattack"].includes(task.role || task.kind) && task.zoneId === zoneId)) {
          activeThreats[zoneId].addressedAtMs = snapshot.atMs;
          threatWindows.push(activeThreats[zoneId].addressedAtMs - activeThreats[zoneId].startedAtMs);
          delete activeThreats[zoneId];
        }
      }

      const depthMap = buildDepthMapForActor(zoneModel, snapshot.zoneAnalysis?.perSide?.[actorId] || {});
      for (const [zoneId, objective] of Object.entries(objectivesByZone)) {
        const objectiveState = snapshot.objectiveControl?.[objective.hex];
        const controlled = objectiveState?.controller === actorId;
        const depth = depthMap[zoneId] ?? Infinity;
        if (!controlled && depth <= 2) {
          if (!activeObjectives[zoneId]) activeObjectives[zoneId] = { startedAtMs: snapshot.atMs };
          const pressured = tasks.some((task) => task.zoneId === zoneId && ["main_effort", "supporting_attack", "screen", "contain", "relief"].includes(task.role || task.kind));
          if (pressured) {
            objectiveWindows.push(snapshot.atMs - activeObjectives[zoneId].startedAtMs);
            delete activeObjectives[zoneId];
          }
        }
      }
    }
  }

  return {
    maxThreatNeglectMs: threatWindows.length > 0 ? Math.max(...threatWindows) : 0,
    maxObjectiveNeglectMs: objectiveWindows.length > 0 ? Math.max(...objectiveWindows) : 0,
  };
}

function computeFrontierOvershoot(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  let evaluated = 0;
  let overshoots = 0;
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const depthMap = buildDepthMapForActor(zoneModel, snapshot.zoneAnalysis?.perSide?.[actorId] || {});
      const budget = snapshot.directorPackets?.[actorId]?.currentPhaseDepthBudget ?? 1;
      for (const task of Object.values(snapshot.commanderPlans?.[actorId] || {})) {
        if (!["main_effort", "supporting_attack", "contain", "relief", "counterattack"].includes(task.role || task.kind)) continue;
        const depth = depthMap[task.zoneId] ?? 0;
        evaluated += 1;
        if (depth > budget + 1) overshoots += 1;
      }
    }
  }
  return { evaluated, overshoots, overshootRate: evaluated > 0 ? roundMetric(overshoots / evaluated) : 0 };
}

function computeInvalidSupportRate(run) {
  let supportPlans = 0;
  let invalidPlans = 0;
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const [actorId, reports] of Object.entries(snapshot.subordinateReports || {})) {
      void actorId;
      for (const report of Object.values(reports || {})) {
        if (report.activeTaskRole !== "support_by_fire") continue;
        if (report.activeTaskKind === "fire_mission") continue;
        supportPlans += 1;
        const targetDistance = distanceBetweenHexes(report.supportHexes?.[0] || report.stagingHex, report.targetHex || report.assaultHex);
        if (targetDistance == null || targetDistance > 5) {
          invalidPlans += 1;
        }
      }
    }
  }
  return { supportPlans, invalidPlans, invalidSupportRate: supportPlans > 0 ? roundMetric(invalidPlans / supportPlans) : 0 };
}

function computeDecisionMetrics(run) {
  const decisions = run.state.ai?.decisionLog || [];
  const provenanceCounts = {};
  let accepted = 0;
  let completed = 0;
  for (const entry of decisions) {
    provenanceCounts[entry.provenance || "unknown"] = (provenanceCounts[entry.provenance || "unknown"] || 0) + 1;
    if (entry.source === "subordinates" && /accepted/i.test(entry.summary || "")) accepted += 1;
    if (entry.source === "subordinates" && /completed/i.test(entry.summary || "")) completed += 1;
  }
  return {
    provenanceCounts,
    planCompletionRate: accepted > 0 ? roundMetric(completed / accepted) : 0,
  };
}

function computeContactAndReserveLatencies(run) {
  const firstContact = {};
  const responseLatencies = [];
  const reserveLatencies = [];
  const initialReserveUnits = new Set(
    (run.state.scenario?.units || [])
      .filter((unit) => unit.posture === "reserve" || unit.initialReserveState === "held")
      .map((unit) => unit.id)
  );

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const perception = snapshot.perception?.[actorId];
      const plans = Object.values(snapshot.commanderPlans?.[actorId] || {});
      if (!firstContact[actorId] && ((perception?.detectedUnits || 0) + (perception?.contactUnits || 0)) > 0) {
        firstContact[actorId] = snapshot.atMs;
      }
      if (firstContact[actorId] && !responseLatencies.some((entry) => entry.actorId === actorId)) {
        const reacted = plans.some((task) => ["contain", "relief", "counterattack", "main_effort", "support_by_fire"].includes(task.role || task.kind));
        if (reacted) {
          responseLatencies.push({ actorId, latencyMs: snapshot.atMs - firstContact[actorId] });
        }
      }

      const reserveTriggered = snapshot.commanderHypotheses?.[actorId]?.reserveRelease;
      if (reserveTriggered && !reserveLatencies.some((entry) => entry.actorId === actorId)) {
        const released = (snapshot.units || []).some((unit) => unit.actor === actorId && initialReserveUnits.has(unit.id) && unit.reserveState !== "held");
        if (released) {
          reserveLatencies.push({ actorId, latencyMs: 0 });
        }
      }
    }
  }

  return {
    contactResponseMs: responseLatencies.length > 0 ? roundMetric(average(responseLatencies.map((entry) => entry.latencyMs))) : 0,
    reserveReleaseLatencyMs: reserveLatencies.length > 0 ? roundMetric(average(reserveLatencies.map((entry) => entry.latencyMs))) : 0,
  };
}

function computeObjectiveAndOpportunityMetrics(run) {
  const objectivesByZone = objectiveZoneMap(run);
  const firstObjectivePressure = [];
  let opportunitySeen = 0;
  let opportunityConverted = 0;

  for (const actor of run.state.scenario?.actors || []) {
    const actorId = actor.id;
    let objectiveSeenAtMs = null;
    for (const snapshot of run.state.replay?.snapshots || []) {
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const taskZones = new Set(tasks.map((task) => task.zoneId).filter(Boolean));
      if (objectiveSeenAtMs == null && Object.keys(objectivesByZone).length > 0) {
        objectiveSeenAtMs = snapshot.atMs;
      }
      if (objectiveSeenAtMs != null && !firstObjectivePressure.some((entry) => entry.actorId === actorId)) {
        const pressured = Object.keys(objectivesByZone).some((zoneId) => taskZones.has(zoneId));
        if (pressured) {
          firstObjectivePressure.push({ actorId, latencyMs: snapshot.atMs - objectiveSeenAtMs });
        }
      }

      const opportunities = snapshot.directorPackets?.[actorId]?.opportunityZones || [];
      if (opportunities.length > 0) {
        opportunitySeen += opportunities.length;
        if (tasks.some((task) => opportunities.includes(task.zoneId))) {
          opportunityConverted += 1;
        }
      }
    }
  }

  return {
    timeToFirstObjectivePressureMs: firstObjectivePressure.length > 0 ? roundMetric(average(firstObjectivePressure.map((entry) => entry.latencyMs))) : 0,
    opportunityConversionRate: opportunitySeen > 0 ? roundMetric(opportunityConverted / opportunitySeen) : 0,
  };
}

function computeCommanderDirectorCoherence(run) {
  let evaluated = 0;
  let aligned = 0;
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const packet = snapshot.directorPackets?.[actorId] || {};
      const validZones = new Set([
        ...(packet.primaryZones || []),
        ...(packet.secondaryZones || []),
        ...(packet.supportingZones || []),
        ...(packet.opportunityZones || []),
        ...(packet.reserveZones || []),
        ...(packet.threatenedZones || []),
      ]);
      for (const task of Object.values(snapshot.commanderPlans?.[actorId] || {})) {
        evaluated += 1;
        if (!task.zoneId || validZones.has(task.zoneId)) aligned += 1;
      }
    }
  }
  return { evaluated, aligned, coherenceRate: evaluated > 0 ? roundMetric(aligned / evaluated) : 0 };
}

function computePackageStats(run) {
  let transitions = 0;
  const dwells = [];
  for (const actor of run.state.scenario?.actors || []) {
    const actorId = actor.id;
    let previousKey = null;
    let previousAtMs = null;
    for (const snapshot of run.state.replay?.snapshots || []) {
      const key = (snapshot.directorPackets?.[actorId]?.activePackages || []).slice().sort().join("|");
      if (previousKey == null) {
        previousKey = key;
        previousAtMs = snapshot.atMs;
        continue;
      }
      if (key !== previousKey) {
        transitions += 1;
        dwells.push(snapshot.atMs - previousAtMs);
        previousKey = key;
        previousAtMs = snapshot.atMs;
      }
    }
  }
  const simMinutes = Math.max(1, (run.outcome.elapsedMs || 0) / 60000);
  return {
    packageChurnPerMinute: roundMetric(transitions / simMinutes),
    packageDwellMs: dwells.length > 0 ? roundMetric(average(dwells)) : 0,
  };
}

function computeCommitmentMetrics(run) {
  let overcommitmentSamples = 0;
  let undercommitmentSamples = 0;
  let evaluated = 0;
  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const zoneCounts = {};
      for (const task of tasks) {
        if (!task.zoneId) continue;
        zoneCounts[task.zoneId] = (zoneCounts[task.zoneId] || 0) + 1;
      }
      const maxShare = tasks.length > 0 ? Math.max(0, ...Object.values(zoneCounts)) / tasks.length : 0;
      const threatened = snapshot.directorPackets?.[actorId]?.threatenedZones || [];
      evaluated += 1;
      if (tasks.length >= 2 && maxShare > 0.7) overcommitmentSamples += 1;
      if (threatened.length > 0 && !tasks.some((task) => threatened.includes(task.zoneId))) undercommitmentSamples += 1;
    }
  }
  return {
    overcommitmentRate: evaluated > 0 ? roundMetric(overcommitmentSamples / evaluated) : 0,
    undercommitmentRate: evaluated > 0 ? roundMetric(undercommitmentSamples / evaluated) : 0,
  };
}

function computeLossEconomics(run) {
  const initialStrength = (run.state.scenario?.units || []).reduce((sum, unit) => sum + (unit.strength ?? 100), 0);
  const finalStrength = (run.state.units || []).reduce((sum, unit) => sum + (unit.strength ?? 0), 0);
  const totalLoss = Math.max(0, initialStrength - finalStrength);
  const pressuredObjectives = objectiveZoneMap(run);
  return {
    totalStrengthLoss: roundMetric(totalLoss),
    strengthLossPerObjective: roundMetric(totalLoss / Math.max(1, Object.keys(pressuredObjectives).length)),
  };
}

function computeFormationMetrics(run) {
  const zoneModel = run.state.scenario?.zoneModel;
  const assignments = Object.fromEntries(
    Object.entries(run.state.ai?.subordinates || {}).map(([actorId, subordinateState]) => [actorId, subordinateState?.assignments || {}])
  );
  const scenarioUnitMeta = Object.fromEntries((run.state.scenario?.units || []).map((unit) => [unit.id, unit]));
  let supportDistances = [];
  let mainEffortSpreads = [];
  let coverageSamples = 0;
  let uncoveredFrontier = 0;
  let assaultTasks = 0;
  let supportTasks = 0;

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const actorUnits = (snapshot.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed");
      const ownerGroups = {};
      for (const unit of actorUnits) {
        const ownerId = assignments[actorId]?.[unit.id]?.owner || unit.id;
        ownerGroups[ownerId] = ownerGroups[ownerId] || [];
        ownerGroups[ownerId].push(unit);
      }

      const maneuverCentroids = Object.fromEntries(
        Object.entries(ownerGroups).map(([ownerId, units]) => {
          const maneuver = units.filter((unit) => !["headquarters", "artillery", "logistics"].includes(unit.type));
          const source = maneuver.length > 0 ? maneuver : units;
          const positions = source.map((unit) => parseUnitPosition(unit.settledHex || unit.position)).filter(Boolean);
          if (positions.length === 0) return [ownerId, null];
          return [ownerId, {
            c: average(positions.map((pos) => pos.c)),
            r: average(positions.map((pos) => pos.r)),
          }];
        })
      );

      for (const unit of actorUnits) {
        if (!["headquarters", "artillery", "logistics"].includes(unit.type)) continue;
        const ownerId = assignments[actorId]?.[unit.id]?.owner || unit.id;
        const ownCentroid = maneuverCentroids[ownerId];
        const position = parseUnitPosition(unit.settledHex || unit.position);
        if (ownCentroid && position) {
          supportDistances.push(hexDistance(position.c, position.r, Math.round(ownCentroid.c), Math.round(ownCentroid.r)));
        }
      }

      for (const [ownerId, units] of Object.entries(ownerGroups)) {
        const task = snapshot.commanderPlans?.[actorId]?.[ownerId];
        if (!task || task.role !== "main_effort") continue;
        const positions = units.map((unit) => parseUnitPosition(unit.settledHex || unit.position)).filter(Boolean);
        if (positions.length < 2) continue;
        const centroid = { c: average(positions.map((pos) => pos.c)), r: average(positions.map((pos) => pos.r)) };
        const spread = Math.max(...positions.map((pos) => hexDistance(pos.c, pos.r, Math.round(centroid.c), Math.round(centroid.r))));
        mainEffortSpreads.push(spread);
      }

      const packet = snapshot.directorPackets?.[actorId] || {};
      const frontierZones = packet.frontierZoneIds || [];
      const taskZones = new Set(Object.values(snapshot.commanderPlans?.[actorId] || {}).map((task) => task.zoneId).filter(Boolean));
      if (frontierZones.length > 0) {
        coverageSamples += frontierZones.length;
        uncoveredFrontier += frontierZones.filter((zoneId) => !taskZones.has(zoneId)).length;
      }

      for (const task of Object.values(snapshot.commanderPlans?.[actorId] || {})) {
        if (["main_effort", "supporting_attack", "screen", "contain", "relief", "counterattack"].includes(task.role || task.kind)) assaultTasks += 1;
        if (["support_by_fire", "reserve", "rear_security"].includes(task.role || task.kind)) supportTasks += 1;
      }
    }
  }

  return {
    formationCoherence: supportDistances.length > 0 ? roundMetric(average(supportDistances)) : 0,
    supportLeash: supportDistances.length > 0 ? roundMetric(median(supportDistances)) : 0,
    mainEffortCohesion: mainEffortSpreads.length > 0 ? roundMetric(average(mainEffortSpreads)) : 0,
    frontlineCoverageGapRate: coverageSamples > 0 ? roundMetric(uncoveredFrontier / coverageSamples) : 0,
    assaultSupportRatio: supportTasks > 0 ? roundMetric(assaultTasks / supportTasks) : assaultTasks > 0 ? assaultTasks : 0,
  };
}

function computeCommandAndExecutionMetrics(run) {
  const stepMs = getSnapshotStepMs(run);
  const unitHistories = buildUnitHistories(run);
  let commandLatencySamples = [];
  let orderReplacements = 0;
  let orderOpportunities = 0;
  let fidelityNumerator = 0;
  let fidelityDenominator = 0;

  const commandLogByUnit = {};
  for (const entry of run.state.truthState?.commandLog || []) {
    commandLogByUnit[entry.unitId] = commandLogByUnit[entry.unitId] || [];
    commandLogByUnit[entry.unitId].push(entry);
  }
  for (const entries of Object.values(commandLogByUnit)) {
    for (let index = 1; index < entries.length; index += 1) {
      orderOpportunities += 1;
      if ((entries[index].atMs - entries[index - 1].atMs) <= Math.max(stepMs, 12000)) {
        orderReplacements += 1;
      }
    }
  }

  for (const history of Object.values(unitHistories || {})) {
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1];
      const current = history[index];
      if (current.commandIssuedAtMs != null && current.commandIssuedAtMs >= previous.atMs && current.commandIssuedAtMs <= current.atMs) {
        commandLatencySamples.push(current.atMs - current.commandIssuedAtMs);
      }
      if (!previous.commandTargetHex || !current.commandTargetHex) continue;
      const prevDistance = distanceBetweenHexes(previous.settledHex, previous.commandTargetHex);
      const nextDistance = distanceBetweenHexes(current.settledHex, current.commandTargetHex);
      if (prevDistance == null || nextDistance == null) continue;
      fidelityDenominator += 1;
      if (nextDistance <= prevDistance) fidelityNumerator += 1;
    }
  }

  return {
    commandLatencyMs: commandLatencySamples.length > 0 ? roundMetric(average(commandLatencySamples)) : 0,
    orderReplacementRate: orderOpportunities > 0 ? roundMetric(orderReplacements / orderOpportunities) : 0,
    executionFidelity: fidelityDenominator > 0 ? roundMetric(fidelityNumerator / fidelityDenominator) : 0,
  };
}

function computeSpecialAssetMetrics(run) {
  const scenarioMeta = Object.fromEntries((run.state.scenario?.units || []).map((unit) => [unit.id, unit]));
  let reconSamples = 0;
  let reconScreenSamples = 0;
  let specialViolations = 0;
  let specialSamples = 0;

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const [actorId, plans] of Object.entries(snapshot.commanderPlans || {})) {
      for (const [ownerId, task] of Object.entries(plans || {})) {
        const ownerReport = snapshot.subordinateReports?.[actorId]?.[ownerId];
        if (!ownerReport) continue;
        const groupUnits = (snapshot.units || []).filter((unit) => unit.actor === actorId && unit.commandId && (scenarioMeta[unit.id]?.parentHQ === ownerId || unit.id === ownerId));
        const hasRecon = groupUnits.some((unit) => unit.type === "recon");
        if (hasRecon) {
          reconSamples += 1;
          if (["screen", "contain", "probe"].includes(task.role || task.kind)) reconScreenSamples += 1;
        }
      }
    }
    for (const unit of snapshot.units || []) {
      if (!["transport", "attack_helicopter", "air_defense", "engineer", "recon"].includes(unit.type)) continue;
      specialSamples += 1;
      if ((unit.type === "air_defense" || unit.type === "engineer") && unit.command === "attack_move") {
        specialViolations += 1;
      }
      if (unit.type === "transport" && unit.command && !["move", "hold", "embark_helo", "disembark_helo", "withdraw"].includes(unit.command)) {
        specialViolations += 1;
      }
    }
  }

  return {
    reconScreenRate: reconSamples > 0 ? roundMetric(reconScreenSamples / reconSamples) : 0,
    specialAssetSanity: specialSamples > 0 ? roundMetric(1 - (specialViolations / specialSamples)) : 1,
  };
}

function computeReconSearchMetrics(run) {
  const scenarioMeta = Object.fromEntries((run.state.scenario?.units || []).map((unit) => [unit.id, unit]));
  let actorSnapshotSamples = 0;
  let noContactSamples = 0;
  let noContactSearchSamples = 0;
  let probePackageSamples = 0;
  let contactSearchSamples = 0;
  let reconOwnerSamples = 0;
  let reconOwnerActiveSamples = 0;
  let reacquireOpportunities = 0;
  let reacquireSuccesses = 0;
  const searchEpisodeDurations = [];

  for (const actor of run.state.scenario?.actors || []) {
    const actorId = actor.id;
    let searchEpisodeStartAtMs = null;
    let reacquireDeadlineAtMs = null;

    for (const snapshot of run.state.replay?.snapshots || []) {
      actorSnapshotSamples += 1;
      const packet = snapshot.directorPackets?.[actorId] || {};
      const perception = snapshot.perception?.[actorId] || {};
      const reports = snapshot.subordinateReports?.[actorId] || {};
      const tasks = snapshot.commanderPlans?.[actorId] || {};
      const hasContact = ((perception.detectedUnits || 0) + (perception.contactUnits || 0)) > 0;
      const noContact = !hasContact;
      const probePackageActive = (packet.activePackages || []).includes("probe");
      const reportRows = Object.entries(reports || {});
      const activeSearch = probePackageActive
        || reportRows.some(([, report]) => Boolean(report?.contactSearchActive))
        || Object.values(tasks || {}).some((task) => task?.contactSearchActive || ["screen", "probe"].includes(task?.role || task?.kind));

      if (probePackageActive) {
        probePackageSamples += 1;
      }
      if (noContact) {
        noContactSamples += 1;
        if (activeSearch) {
          noContactSearchSamples += 1;
        }
      }
      if (activeSearch) {
        contactSearchSamples += 1;
        searchEpisodeStartAtMs = searchEpisodeStartAtMs ?? snapshot.atMs;
      } else if (searchEpisodeStartAtMs != null) {
        searchEpisodeDurations.push(snapshot.atMs - searchEpisodeStartAtMs);
        searchEpisodeStartAtMs = null;
      }

      for (const [ownerId, report] of reportRows) {
        const groupUnits = (snapshot.units || []).filter((unit) => unit.actor === actorId && unit.commandId && (scenarioMeta[unit.id]?.parentHQ === ownerId || unit.id === ownerId));
        const hasRecon = groupUnits.some((unit) => unit.type === "recon" || unit.type === "special_forces");
        if (!hasRecon) continue;
        reconOwnerSamples += 1;
        if (report?.contactSearchActive || ["screen", "probe", "contain"].includes(report?.activeTaskRole)) {
          reconOwnerActiveSamples += 1;
        }
      }

      if (noContact && activeSearch && reacquireDeadlineAtMs == null) {
        reacquireOpportunities += 1;
        reacquireDeadlineAtMs = snapshot.atMs + 60000;
      }
      if (reacquireDeadlineAtMs != null && hasContact) {
        reacquireSuccesses += 1;
        reacquireDeadlineAtMs = null;
      } else if (reacquireDeadlineAtMs != null && snapshot.atMs >= reacquireDeadlineAtMs) {
        reacquireDeadlineAtMs = null;
      }
    }

    if (searchEpisodeStartAtMs != null) {
      searchEpisodeDurations.push(Math.max(0, (run.outcome.elapsedMs || 0) - searchEpisodeStartAtMs));
    }
  }

  return {
    noContactSearchRate: noContactSamples > 0 ? roundMetric(noContactSearchSamples / noContactSamples) : 0,
    probePackageRate: actorSnapshotSamples > 0 ? roundMetric(probePackageSamples / actorSnapshotSamples) : 0,
    contactSearchRate: actorSnapshotSamples > 0 ? roundMetric(contactSearchSamples / actorSnapshotSamples) : 0,
    searchEpisodeMs: searchEpisodeDurations.length > 0 ? roundMetric(average(searchEpisodeDurations)) : 0,
    reconOwnerSearchRate: reconOwnerSamples > 0 ? roundMetric(reconOwnerActiveSamples / reconOwnerSamples) : 0,
    contactReacquisitionRate: reacquireOpportunities > 0 ? roundMetric(reacquireSuccesses / reacquireOpportunities) : 0,
  };
}

function computeHumanChallengeMetrics(run, shared, reconSearch, actorMetrics) {
  let totalActorSnapshots = 0;
  let objectivePressureHits = 0;
  let combinedArmsSamples = 0;
  let threatResponseSamples = 0;
  let threatResponseHits = 0;

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const packet = snapshot.directorPackets?.[actorId] || {};
      const activeRoles = tasks.map((task) => task.role || task.kind);
      const hasObjectivePressure = tasks.some((task) => Boolean(task.zoneId) && (packet.primaryZones || []).includes(task.zoneId))
        || tasks.some((task) => /objective/i.test(task.summary || ""));
      const hasCombinedArms = activeRoles.includes("main_effort") && activeRoles.includes("support_by_fire");
      const hasThreat = (packet.threatenedZones || []).length > 0 || packet.pressure === "recover";
      const hasThreatResponse = activeRoles.some((role) => ["contain", "relief", "rear_security", "reserve"].includes(role));
      totalActorSnapshots += 1;
      if (hasObjectivePressure) objectivePressureHits += 1;
      if (hasCombinedArms) combinedArmsSamples += 1;
      if (hasThreat) {
        threatResponseSamples += 1;
        if (hasThreatResponse) threatResponseHits += 1;
      }
    }
  }

  const actors = run.state.scenario?.actors || [];
  const reserveDisciplineSamples = actors
    .map((actor) => {
      const metrics = actorMetrics?.[actor.id] || {};
      if (metrics.reserveReleaseAtMs == null || metrics.firstContactAtMs == null) return 0.55;
      const deltaMs = Math.abs(metrics.reserveReleaseAtMs - metrics.firstContactAtMs);
      return clamp(1 - (deltaMs / 180000), 0, 1);
    });
  const denominator = Math.max(1, totalActorSnapshots);
  const combinedArmsRate = roundMetric(combinedArmsSamples / denominator);
  const objectivePressureRate = roundMetric(objectivePressureHits / denominator);
  const threatResponseRate = threatResponseSamples > 0 ? roundMetric(threatResponseHits / threatResponseSamples) : 0;
  const reserveTimingDiscipline = reserveDisciplineSamples.length > 0 ? roundMetric(average(reserveDisciplineSamples)) : 0;
  const humanChallengeScore = roundMetric(
    objectivePressureRate * 0.22
    + combinedArmsRate * 0.18
    + threatResponseRate * 0.14
    + reserveTimingDiscipline * 0.1
    + (reconSearch.noContactSearchRate || 0) * 0.2
    + (reconSearch.contactReacquisitionRate || 0) * 0.08
    + (shared.executionFidelity || 0) * 0.08
  );

  return {
    objectivePressureRate,
    combinedArmsRate,
    threatResponseRate,
    reserveTimingDiscipline,
    humanChallengeScore,
  };
}

function computeProfileSignals(run, task) {
  const mainEffortZoneCounts = [];
  const terrainTally = { rough: 0, urban: 0, open: 0 };
  let terrainSamples = 0;
  let rearSecuritySamples = 0;
  let reliefSamples = 0;
  let counterattackSamples = 0;
  let exploitationDepthSamples = [];

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      mainEffortZoneCounts.push(new Set(tasks.filter((entry) => ["main_effort", "supporting_attack", "screen"].includes(entry.role || entry.kind)).map((entry) => entry.zoneId).filter(Boolean)).size);
      rearSecuritySamples += tasks.filter((entry) => (entry.role || entry.kind) === "rear_security").length;
      reliefSamples += tasks.filter((entry) => (entry.role || entry.kind) === "relief").length;
      counterattackSamples += tasks.filter((entry) => (entry.role || entry.kind) === "counterattack").length;
      const budget = snapshot.directorPackets?.[actorId]?.currentPhaseDepthBudget ?? 1;
      const depthMap = buildDepthMapForActor(run.state.scenario?.zoneModel, snapshot.zoneAnalysis?.perSide?.[actorId] || {});
      for (const entry of tasks.filter((taskEntry) => ["main_effort", "supporting_attack"].includes(taskEntry.role || taskEntry.kind))) {
        exploitationDepthSamples.push((depthMap[entry.zoneId] ?? 0) - budget);
      }
    }

    for (const unit of snapshot.units || []) {
      const pos = unit.settledHex || unit.position;
      const cell = run.state.terrainData?.cells?.[pos];
      const terrain = String(cell?.terrain || "");
      terrainSamples += 1;
      if (/urban|town|city/i.test(terrain)) terrainTally.urban += 1;
      else if (/forest|hill|rough|mountain/i.test(terrain)) terrainTally.rough += 1;
      else terrainTally.open += 1;
    }
  }

  return {
    breadthVsFocus: mainEffortZoneCounts.length > 0 ? roundMetric(average(mainEffortZoneCounts)) : 0,
    rearSecurityRate: roundMetric(rearSecuritySamples / Math.max(1, run.state.replay?.snapshots?.length || 1)),
    reliefCounterattackRate: roundMetric((reliefSamples + counterattackSamples) / Math.max(1, run.state.replay?.snapshots?.length || 1)),
    exploitationBehavior: exploitationDepthSamples.length > 0 ? roundMetric(average(exploitationDepthSamples)) : 0,
    terrainPreference: terrainSamples > 0 ? {
      rough: roundMetric(terrainTally.rough / terrainSamples),
      urban: roundMetric(terrainTally.urban / terrainSamples),
      open: roundMetric(terrainTally.open / terrainSamples),
    } : { rough: 0, urban: 0, open: 0 },
    profile: task.profile || "default",
  };
}

function computeStressMetrics(run, shared, task) {
  const scenarioId = task.scenarioId;
  const stress = {
    bridgeLossAdaptationLatency: null,
    surpriseRearContactResponse: scenarioId === "rear_probe" ? shared.contactResponseMs : null,
    falseIntelSusceptibility: shared.deadTaskPursuitRate,
    encirclementReaction: scenarioId === "encirclement" ? shared.threatNeglect.maxThreatNeglectMs : null,
    multiObjectiveTradeoffQuality: scenarioId === "helo_ai" ? null : roundMetric(1 - shared.overcommitmentRate),
    attritionStressResponse: scenarioId === "attrition" ? shared.packageChurnPerMinute : null,
    lowSupplyBehavior: scenarioId === "low_supply" ? roundMetric(shared.assaultSupportRatio) : null,
    heloExceptionQuality: scenarioId === "helo_ai" ? shared.specialAssetSanity : null,
    longRunFatigue: scenarioId === "long_run_duel" ? shared.longRunFatigue : null,
    recoveryAfterFailure: shared.recoveryAfterFailure,
  };
  return stress;
}

function computeNarrativeAndConstraintMetrics(run, shared) {
  const actors = run.state.scenario?.actors || [];
  const zoneModel = run.state.scenario?.zoneModel;
  let driftScore = 0;
  let violations = 0;
  for (const actor of actors) {
    const actorId = actor.id;
    const defensiveIntent = /hold|deny|preserve|defend/i.test(`${(actor.objectives || []).join(" ")} ${(actor.constraints || []).join(" ")}`);
    for (const snapshot of run.state.replay?.snapshots || []) {
      const depthMap = buildDepthMapForActor(zoneModel, snapshot.zoneAnalysis?.perSide?.[actorId] || {});
      const threatened = snapshot.directorPackets?.[actorId]?.threatenedZones || [];
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const deepAttacks = tasks.filter((task) => ["main_effort", "supporting_attack"].includes(task.role || task.kind) && (depthMap[task.zoneId] ?? 0) > 2).length;
      if (defensiveIntent && threatened.length > 0 && deepAttacks > 0) {
        driftScore += deepAttacks;
      }
      const reserveTasks = tasks.filter((task) => (task.role || task.kind) === "reserve").length;
      if (reserveTasks > 0 && (snapshot.commanderHypotheses?.[actorId]?.reserveRelease === false)) {
        violations += 1;
      }
    }
  }
  return {
    narrativeIntentDrift: roundMetric(driftScore / Math.max(1, run.state.replay?.snapshots?.length || 1)),
    constraintViolations: violations,
  };
}

function computeLongRunFatigue(run) {
  const snapshots = run.state.replay?.snapshots || [];
  if (snapshots.length < 6) return 0;
  const halfway = Math.floor(snapshots.length / 2);
  const firstHalf = { snapshots: snapshots.slice(0, halfway), state: run.state };
  const secondHalf = { snapshots: snapshots.slice(halfway), state: run.state };
  const firstOwnerHistories = buildOwnerHistories({ state: { replay: { snapshots: firstHalf.snapshots } } });
  const secondOwnerHistories = buildOwnerHistories({ state: { replay: { snapshots: secondHalf.snapshots } } });
  const firstChurn = computeReplanChurn(firstOwnerHistories);
  const secondChurn = computeReplanChurn(secondOwnerHistories);
  return roundMetric((secondChurn.quick30 + secondChurn.quick60) - (firstChurn.quick30 + firstChurn.quick60));
}

function computeRecoveryAfterFailure(run) {
  let recoveries = 0;
  let opportunities = 0;
  for (const actor of run.state.scenario?.actors || []) {
    const actorId = actor.id;
    let previousPrimary = null;
    let stallStart = null;
    for (const snapshot of run.state.replay?.snapshots || []) {
      const primary = snapshot.directorPackets?.[actorId]?.primaryZones?.[0] || null;
      const supportPressure = Object.values(snapshot.subordinateReports?.[actorId] || {}).every((report) => report?.issuedCount === 0);
      if (primary && primary === previousPrimary && supportPressure) {
        stallStart = stallStart ?? snapshot.atMs;
      }
      if (stallStart != null && primary && primary !== previousPrimary && (snapshot.atMs - stallStart) >= 30000) {
        opportunities += 1;
        recoveries += 1;
        stallStart = null;
      }
      previousPrimary = primary || previousPrimary;
    }
  }
  return opportunities > 0 ? roundMetric(recoveries / opportunities) : 0;
}

function computeOperationMetrics(run) {
  let continuityEvaluated = 0;
  let continuityStable = 0;
  let emergencySamples = 0;
  let emergencyOverrides = 0;
  let phaseStarts = 0;
  let phaseCompleted = 0;
  const deepReviews = new Set();
  const adviceCounts = {
    accepted_director_advice: 0,
    deferred_director_advice: 0,
    rejected_director_advice: 0,
  };

  for (const actor of run.state.scenario?.actors || []) {
    let previousGoalZoneId = null;
    let previousPhaseKey = null;
    for (const snapshot of run.state.replay?.snapshots || []) {
      const hypothesis = snapshot.commanderHypotheses?.[actor.id] || {};
      const operations = snapshot.commanderReplans?.[actor.id]?.operations || {};
      const currentOperation = hypothesis.currentOperation || operations.main || null;
      const supportOperations = hypothesis.supportOperations || operations.support || [];
      const lastDirectorAdvice = operations.lastDirectorAdvice?.kind || null;
      if (lastDirectorAdvice && adviceCounts[lastDirectorAdvice] != null) {
        adviceCounts[lastDirectorAdvice] += 1;
      }
      if (operations.lastDeepReviewAtMs != null) {
        deepReviews.add(`${actor.id}:${operations.lastDeepReviewAtMs}`);
      }
      if (currentOperation?.goalZoneId) {
        if (previousGoalZoneId != null) {
          continuityEvaluated += 1;
          if (previousGoalZoneId === currentOperation.goalZoneId) continuityStable += 1;
        }
        const phaseKey = `${currentOperation.goalZoneId}:${currentOperation.phase || "none"}`;
        if (phaseKey !== previousPhaseKey) {
          phaseStarts += 1;
        }
        if (currentOperation.status === "secured") {
          phaseCompleted += 1;
        }
        previousGoalZoneId = currentOperation.goalZoneId;
        previousPhaseKey = phaseKey;
      }
      const alerts = operations.alerts || [];
      if (alerts.length > 0) {
        emergencySamples += 1;
        if ((supportOperations?.length || 0) > 0 || (operations.lastDirectorAdvice?.reasons || []).includes("rear_emergency")) {
          emergencyOverrides += 1;
        }
      }
    }
  }

  return {
    operationContinuityRate: continuityEvaluated > 0 ? roundMetric(continuityStable / continuityEvaluated) : 0,
    deepReviewCount: deepReviews.size,
    emergencyOverrideRate: emergencySamples > 0 ? roundMetric(emergencyOverrides / emergencySamples) : 0,
    directorAdviceAcceptedCount: adviceCounts.accepted_director_advice,
    directorAdviceDeferredCount: adviceCounts.deferred_director_advice,
    directorAdviceRejectedCount: adviceCounts.rejected_director_advice,
    phaseCompletionRate: phaseStarts > 0 ? roundMetric(phaseCompleted / phaseStarts) : 0,
  };
}

function buildRoleShareMap(counts = {}) {
  const total = Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return {};
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => [key, roundMetric(value / total)])
  );
}

function dominantKey(counts = {}) {
  const ranked = Object.entries(counts || {}).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
  return ranked[0]?.[0] || null;
}

function computeActorMetrics(run) {
  const actors = run.state.scenario?.actors || [];
  const objectiveZones = new Set(Object.keys(objectiveZoneMap(run)));
  const objectiveHexes = run.state.scenario?.objectives?.hexVP || run.state.scenario?.victoryConditions?.hexVP || [];
  const scenarioUnitMeta = Object.fromEntries((run.state.scenario?.units || []).map((unit) => [unit.id, unit]));
  const finalUnits = run.state.units || [];
  const initialReserveUnitsByActor = Object.fromEntries(
    actors.map((actor) => [actor.id, new Set(
      (run.state.scenario?.units || [])
        .filter((unit) => unit.actor === actor.id && (unit.posture === "reserve" || unit.initialReserveState === "held"))
        .map((unit) => unit.id)
    )])
  );
  const decisionCounts = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
  const commandCounts = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
  const roleCounts = Object.fromEntries(actors.map((actor) => [actor.id, {}]));
  const firstContactAtMs = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const firstObjectivePressureAtMs = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const reserveReleaseAtMs = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const openingPrimaryZoneId = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const openingDominantRole = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const primaryZoneTransitions = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
  const previousPrimaryZone = Object.fromEntries(actors.map((actor) => [actor.id, null]));
  const finalObjectiveVp = Object.fromEntries(actors.map((actor) => [actor.id, 0]));
  const controlledObjectiveCount = Object.fromEntries(actors.map((actor) => [actor.id, 0]));

  for (const entry of run.state.ai?.decisionLog || []) {
    if (decisionCounts[entry.actorId] != null) {
      decisionCounts[entry.actorId] += 1;
    }
  }

  for (const entry of run.state.truthState?.commandLog || []) {
    const actorId = scenarioUnitMeta[entry.unitId]?.actor || null;
    if (actorId && commandCounts[actorId] != null) {
      commandCounts[actorId] += 1;
    }
  }

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of actors) {
      const actorId = actor.id;
      const perception = snapshot.perception?.[actorId] || {};
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      const packet = snapshot.directorPackets?.[actorId] || {};

      if (firstContactAtMs[actorId] == null && ((perception.detectedUnits || 0) + (perception.contactUnits || 0)) > 0) {
        firstContactAtMs[actorId] = snapshot.atMs;
      }
      if (firstObjectivePressureAtMs[actorId] == null && tasks.some((task) => objectiveZones.has(task.zoneId))) {
        firstObjectivePressureAtMs[actorId] = snapshot.atMs;
      }
      if (openingPrimaryZoneId[actorId] == null && packet.primaryZones?.[0]) {
        openingPrimaryZoneId[actorId] = packet.primaryZones[0];
      }
      if (openingDominantRole[actorId] == null && tasks.length > 0) {
        const counts = {};
        for (const taskEntry of tasks) {
          const role = taskEntry.role || taskEntry.kind || "none";
          counts[role] = (counts[role] || 0) + 1;
        }
        openingDominantRole[actorId] = dominantKey(counts);
      }

      for (const taskEntry of tasks) {
        const role = taskEntry.role || taskEntry.kind || "none";
        roleCounts[actorId][role] = (roleCounts[actorId][role] || 0) + 1;
      }

      const currentPrimaryZone = packet.primaryZones?.[0] || null;
      if (previousPrimaryZone[actorId] && currentPrimaryZone && previousPrimaryZone[actorId] !== currentPrimaryZone) {
        primaryZoneTransitions[actorId] += 1;
      }
      if (currentPrimaryZone) {
        previousPrimaryZone[actorId] = currentPrimaryZone;
      }

      if (
        reserveReleaseAtMs[actorId] == null
        && initialReserveUnitsByActor[actorId]?.size > 0
        && (snapshot.units || []).some((unit) => (
          unit.actor === actorId
          && initialReserveUnitsByActor[actorId].has(unit.id)
          && unit.reserveState !== "held"
        ))
      ) {
        reserveReleaseAtMs[actorId] = snapshot.atMs;
      }
    }
  }

  for (const objective of objectiveHexes) {
    const controller = run.state.truthState?.objectives?.[objective.hex]?.controller || null;
    if (!controller || finalObjectiveVp[controller] == null) continue;
    finalObjectiveVp[controller] += objective.vp || 10;
    controlledObjectiveCount[controller] += 1;
  }

  return Object.fromEntries(actors.map((actor) => {
    const actorId = actor.id;
    const initialUnits = (run.state.scenario?.units || []).filter((unit) => unit.actor === actorId);
    const currentUnits = finalUnits.filter((unit) => unit.actor === actorId);
    const initialStrength = initialUnits.reduce((sum, unit) => sum + (unit.strength ?? 100), 0);
    const finalStrength = currentUnits.reduce((sum, unit) => sum + Math.max(0, unit.strength ?? 0), 0);
    const finalLivingUnits = currentUnits.filter((unit) => unit.status !== "destroyed").length;
    return [actorId, {
      initialStrength: roundMetric(initialStrength),
      finalStrength: roundMetric(finalStrength),
      strengthLoss: roundMetric(Math.max(0, initialStrength - finalStrength)),
      finalLivingUnits,
      objectiveVp: finalObjectiveVp[actorId] || 0,
      controlledObjectiveCount: controlledObjectiveCount[actorId] || 0,
      decisionCount: decisionCounts[actorId] || 0,
      commandCount: commandCounts[actorId] || 0,
      firstContactAtMs: firstContactAtMs[actorId],
      firstObjectivePressureAtMs: firstObjectivePressureAtMs[actorId],
      reserveReleaseAtMs: reserveReleaseAtMs[actorId],
      openingPrimaryZoneId: openingPrimaryZoneId[actorId],
      openingDominantRole: openingDominantRole[actorId],
      primaryZoneTransitions: primaryZoneTransitions[actorId] || 0,
      roleShares: buildRoleShareMap(roleCounts[actorId]),
    }];
  }));
}

function actorControlsCriticalHexes(run, actorId, criticalObjectiveHexes = []) {
  if (!actorId) return false;
  if (!criticalObjectiveHexes.length) return true;
  return criticalObjectiveHexes.every((hex) => run.state.truthState?.objectives?.[hex]?.controller === actorId);
}

function computeOutcomeAudit(run) {
  const objectiveHexes = run.state.scenario?.objectives?.hexVP || run.state.scenario?.victoryConditions?.hexVP || [];
  const vpGoal = run.state.scenario?.objectives?.vpGoal || run.state.scenario?.victoryConditions?.vpGoal || 50;
  const durationLimitMinutes = Number(run.state.scenario?.rtsOptions?.durationLimitMinutes || 0);
  const actors = run.state.scenario?.actors || [];
  const criticalObjectiveHexes = Array.from(new Set(
    actors.flatMap((actor) => (Array.isArray(actor?.cvpHexes) ? actor.cvpHexes : [])).filter(Boolean)
  ));
  const scores = {};
  const livingByActor = {};

  for (const actor of actors) {
    scores[actor.id] = 0;
    livingByActor[actor.id] = (run.state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed").length;
  }
  for (const objective of objectiveHexes) {
    const controller = run.state.truthState?.objectives?.[objective.hex]?.controller || null;
    if (controller) {
      scores[controller] = (scores[controller] || 0) + (objective.vp || 10);
    }
  }

  const thresholdWinners = Object.entries(scores).filter(([, score]) => score >= vpGoal);
  const liveCriticalWinners = thresholdWinners.filter(([actorId]) => actorControlsCriticalHexes(run, actorId, criticalObjectiveHexes));
  const survivingActors = Object.entries(livingByActor).filter(([, count]) => count > 0);
  const elapsedMs = run.outcome.elapsedMs || run.state.game?.elapsedMs || 0;

  let derivedWinner = null;
  let derivedReason = null;
  if (durationLimitMinutes > 0 && elapsedMs >= durationLimitMinutes * 60_000) {
    const eligibleScores = Object.fromEntries(thresholdWinners);
    const eligibleLiving = Object.fromEntries(
      thresholdWinners.map(([actorId]) => [actorId, livingByActor[actorId] || 0])
    );
    derivedWinner = thresholdWinners.length > 0 ? resolveTimedWinner(eligibleScores, eligibleLiving) : "draw";
    derivedReason = "time_limit";
  } else if (liveCriticalWinners.length > 0) {
    derivedWinner = resolveTimedWinner(
      Object.fromEntries(liveCriticalWinners),
      Object.fromEntries(liveCriticalWinners.map(([actorId]) => [actorId, livingByActor[actorId] || 0]))
    );
    derivedReason = "vp_goal";
  } else if (survivingActors.length === 1) {
    derivedWinner = survivingActors[0][0];
    derivedReason = "annihilation";
  }

  const declaredWinner = run.outcome.winner || null;
  const declaredReason = run.outcome.victoryReason || null;
  const declaredWinnerScore = declaredWinner && declaredWinner !== "draw" ? (scores[declaredWinner] || 0) : 0;
  const declaredWinnerCriticalCoverageRate = declaredWinner && declaredWinner !== "draw" && criticalObjectiveHexes.length > 0
    ? roundMetric(criticalObjectiveHexes.filter((hex) => run.state.truthState?.objectives?.[hex]?.controller === declaredWinner).length / criticalObjectiveHexes.length)
    : criticalObjectiveHexes.length === 0 ? 1 : 0;

  return {
    declaredOutcomeMatchesDerived: Number(declaredWinner === derivedWinner && declaredReason === derivedReason),
    timeLimitWinnerAboveThreshold: declaredReason === "time_limit" && declaredWinner && declaredWinner !== "draw"
      ? Number((scores[declaredWinner] || 0) >= vpGoal)
      : 1,
    vpGoalWinnerControlsCritical: declaredReason === "vp_goal" && declaredWinner && declaredWinner !== "draw"
      ? Number(actorControlsCriticalHexes(run, declaredWinner, criticalObjectiveHexes))
      : 1,
    annihilationWinnerIsLastSurvivor: declaredReason === "annihilation" && declaredWinner && declaredWinner !== "draw"
      ? Number(survivingActors.length === 1 && survivingActors[0][0] === declaredWinner)
      : 1,
    finalThresholdWinnerCount: thresholdWinners.length,
    criticalObjectiveCount: criticalObjectiveHexes.length,
    declaredWinnerScore,
    declaredWinnerCriticalCoverageRate,
    derivedWinner,
    derivedReason,
  };
}

function categoricalMatch(left, right) {
  if (!left && !right) return 1;
  return left === right ? 1 : 0;
}

function numericAbsDelta(left, right) {
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  return roundMetric(Math.abs((Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)));
}

function computeSymmetryMetrics(run, actorMetrics) {
  const actorIds = (run.state.scenario?.actors || []).map((actor) => actor.id);
  if (actorIds.length < 2) return null;
  const [leftId, rightId] = actorIds;
  const left = actorMetrics[leftId] || {};
  const right = actorMetrics[rightId] || {};
  const roleKeys = new Set([
    ...Object.keys(left.roleShares || {}),
    ...Object.keys(right.roleShares || {}),
  ]);
  const roleShareL1Distance = roundMetric(
    [...roleKeys].reduce((sum, key) => sum + Math.abs((left.roleShares?.[key] || 0) - (right.roleShares?.[key] || 0)), 0) / 2
  );
  const openingPrimaryZoneSame = categoricalMatch(left.openingPrimaryZoneId, right.openingPrimaryZoneId);
  const openingDominantRoleSame = categoricalMatch(left.openingDominantRole, right.openingDominantRole);
  const livingUnitDeltaAbs = numericAbsDelta(left.finalLivingUnits, right.finalLivingUnits);
  const remainingStrengthDeltaAbs = numericAbsDelta(left.finalStrength, right.finalStrength);
  const strengthLossDeltaAbs = numericAbsDelta(left.strengthLoss, right.strengthLoss);
  const vpDeltaAbs = numericAbsDelta(left.objectiveVp, right.objectiveVp);
  const controlledObjectiveDeltaAbs = numericAbsDelta(left.controlledObjectiveCount, right.controlledObjectiveCount);
  const decisionCountDeltaAbs = numericAbsDelta(left.decisionCount, right.decisionCount);
  const commandCountDeltaAbs = numericAbsDelta(left.commandCount, right.commandCount);
  const firstContactDeltaMsAbs = numericAbsDelta(left.firstContactAtMs, right.firstContactAtMs);
  const firstObjectivePressureDeltaMsAbs = numericAbsDelta(left.firstObjectivePressureAtMs, right.firstObjectivePressureAtMs);
  const reserveReleaseDeltaMsAbs = numericAbsDelta(left.reserveReleaseAtMs, right.reserveReleaseAtMs);
  const primaryZoneTransitionDeltaAbs = numericAbsDelta(left.primaryZoneTransitions, right.primaryZoneTransitions);
  const asymmetryScore = roundMetric(
    (1 - openingPrimaryZoneSame) * 1.5
    + (1 - openingDominantRoleSame) * 1
    + Math.min(1, vpDeltaAbs / 20) * 2
    + Math.min(1, livingUnitDeltaAbs / 2) * 1.5
    + Math.min(1, strengthLossDeltaAbs / 150) * 1.5
    + Math.min(1, firstObjectivePressureDeltaMsAbs / 30000) * 1
    + Math.min(1, reserveReleaseDeltaMsAbs / 30000) * 1
    + Math.min(1, roleShareL1Distance / 0.5) * 2
    + Math.min(1, decisionCountDeltaAbs / 20) * 0.5
    + Math.min(1, commandCountDeltaAbs / 6) * 0.5
  );

  return {
    openingPrimaryZoneSame,
    openingDominantRoleSame,
    roleShareL1Distance,
    livingUnitDeltaAbs,
    remainingStrengthDeltaAbs,
    strengthLossDeltaAbs,
    vpDeltaAbs,
    controlledObjectiveDeltaAbs,
    decisionCountDeltaAbs,
    commandCountDeltaAbs,
    firstContactDeltaMsAbs,
    firstObjectivePressureDeltaMsAbs,
    reserveReleaseDeltaMsAbs,
    primaryZoneTransitionDeltaAbs,
    actor1VpLead: roundMetric((left.objectiveVp || 0) - (right.objectiveVp || 0)),
    actor1LivingLead: roundMetric((left.finalLivingUnits || 0) - (right.finalLivingUnits || 0)),
    actor1StrengthLead: roundMetric((left.finalStrength || 0) - (right.finalStrength || 0)),
    winnerBias: run.outcome.winner === leftId ? 1 : run.outcome.winner === rightId ? -1 : 0,
    asymmetryScore,
  };
}

function analyzeRun(run, terrainData, task) {
  run.state.terrainData = terrainData;
  const stepMs = getSnapshotStepMs(run);
  const ownerHistories = buildOwnerHistories(run);
  const unitHistories = buildUnitHistories(run);
  const replan = computeReplanChurn(ownerHistories);
  const stuck = computeStuckAndTrafficMetrics(unitHistories, stepMs);
  const pingPong = computePingPong(ownerHistories, unitHistories, run);
  const threatNeglect = computeThreatAndObjectiveNeglect(run);
  const overshoot = computeFrontierOvershoot(run);
  const invalidSupport = computeInvalidSupportRate(run);
  const decision = computeDecisionMetrics(run);
  const latencies = computeContactAndReserveLatencies(run);
  const objectives = computeObjectiveAndOpportunityMetrics(run);
  const coherence = computeCommanderDirectorCoherence(run);
  const packages = computePackageStats(run);
  const commitment = computeCommitmentMetrics(run);
  const lossEconomics = computeLossEconomics(run);
  const formation = computeFormationMetrics(run);
  const commandExecution = computeCommandAndExecutionMetrics(run);
  const specialAssets = computeSpecialAssetMetrics(run);
  const reconSearch = computeReconSearchMetrics(run);
  const narrativeAndConstraints = computeNarrativeAndConstraintMetrics(run, {});
  const longRunFatigue = computeLongRunFatigue(run);
  const recoveryAfterFailure = computeRecoveryAfterFailure(run);
  const operationMetrics = computeOperationMetrics(run);
  const actorMetrics = computeActorMetrics(run);
  const humanChallenge = computeHumanChallengeMetrics(run, {
    executionFidelity: commandExecution.executionFidelity,
  }, reconSearch, actorMetrics);
  const outcomeAudit = computeOutcomeAudit(run);
  const symmetry = task.identicalSides ? computeSymmetryMetrics(run, actorMetrics) : null;

  const eventCongestion = (run.state.replay?.events || []).filter((event) => event.kind === "movement" && (event.details?.blockerId || /halted short|blocked/i.test(event.message || ""))).length;
  const simMinutes = Math.max(1, (run.outcome.elapsedMs || 0) / 60000);
  const deadTaskSamples = (run.state.replay?.snapshots || []).flatMap((snapshot) => (
    (run.state.scenario?.actors || []).map((actor) => {
      const actorId = actor.id;
      const perception = snapshot.perception?.[actorId];
      const tasks = Object.values(snapshot.commanderPlans?.[actorId] || {});
      return tasks.some((task) => task.provenance === "lastKnown") && (perception?.agingLastKnownUnits || 0) > 0 && ((perception?.detectedUnits || 0) + (perception?.contactUnits || 0) === 0);
    })
  )).filter(Boolean).length;

  const shared = {
    replanQuick30: replan.quick30,
    replanQuick60: replan.quick60,
    stuckUnitRate: stuck.stuckRate,
    ownerPingPongRate: roundMetric(pingPong.ownerPingPong / Math.max(1, Object.values(ownerHistories).reduce((sum, actorHistories) => sum + Object.keys(actorHistories || {}).length, 0))),
    unitPingPongRate: roundMetric(pingPong.unitPingPong / Math.max(1, Object.keys(unitHistories).length)),
    threatNeglect,
    frontierOvershootRate: overshoot.overshootRate,
    invalidSupportRate: invalidSupport.invalidSupportRate,
    laneCongestionEventsPerMinute: roundMetric(eventCongestion / simMinutes),
    deadTaskPursuitRate: roundMetric(deadTaskSamples / Math.max(1, run.state.replay?.snapshots?.length || 1)),
    garrisonAnchorViolationRate: 0,
    constraintViolations: narrativeAndConstraints.constraintViolations,
    narrativeIntentDrift: narrativeAndConstraints.narrativeIntentDrift,
    decisionSourceMix: decision.provenanceCounts,
    contactResponseMs: latencies.contactResponseMs,
    reserveReleaseLatencyMs: latencies.reserveReleaseLatencyMs,
    planCompletionRate: decision.planCompletionRate,
    timeToFirstObjectivePressureMs: objectives.timeToFirstObjectivePressureMs,
    opportunityConversionRate: objectives.opportunityConversionRate,
    coherenceRate: coherence.coherenceRate,
    packageChurnPerMinute: packages.packageChurnPerMinute,
    packageDwellMs: packages.packageDwellMs,
    operationContinuityRate: operationMetrics.operationContinuityRate,
    deepReviewCount: operationMetrics.deepReviewCount,
    emergencyOverrideRate: operationMetrics.emergencyOverrideRate,
    directorAdviceAcceptedCount: operationMetrics.directorAdviceAcceptedCount,
    directorAdviceDeferredCount: operationMetrics.directorAdviceDeferredCount,
    directorAdviceRejectedCount: operationMetrics.directorAdviceRejectedCount,
    phaseCompletionRate: operationMetrics.phaseCompletionRate,
    overcommitmentRate: commitment.overcommitmentRate,
    undercommitmentRate: commitment.undercommitmentRate,
    lossEconomics,
    supportResponseLatencyMs: 0,
    formationCoherence: formation.formationCoherence,
    supportLeash: formation.supportLeash,
    mainEffortCohesion: formation.mainEffortCohesion,
    frontlineCoverageGapRate: formation.frontlineCoverageGapRate,
    assaultSupportRatio: formation.assaultSupportRatio,
    trafficIdleRate: stuck.trafficIdleRate,
    commandLatencyMs: commandExecution.commandLatencyMs,
    orderReplacementRate: commandExecution.orderReplacementRate,
    executionFidelity: commandExecution.executionFidelity,
    specialAssetSanity: specialAssets.specialAssetSanity,
    reconScreenRate: specialAssets.reconScreenRate,
    noContactSearchRate: reconSearch.noContactSearchRate,
    probePackageRate: reconSearch.probePackageRate,
    contactSearchRate: reconSearch.contactSearchRate,
    searchEpisodeMs: reconSearch.searchEpisodeMs,
    reconOwnerSearchRate: reconSearch.reconOwnerSearchRate,
    contactReacquisitionRate: reconSearch.contactReacquisitionRate,
    objectivePressureRate: humanChallenge.objectivePressureRate,
    combinedArmsRate: humanChallenge.combinedArmsRate,
    threatResponseRate: humanChallenge.threatResponseRate,
    reserveTimingDiscipline: humanChallenge.reserveTimingDiscipline,
    humanChallengeScore: humanChallenge.humanChallengeScore,
    longRunFatigue,
    recoveryAfterFailure,
  };

  return {
    stepMs,
    hardInvariants: {
      replanChurn30: shared.replanQuick30,
      replanChurn60: shared.replanQuick60,
      stuckUnitRate: shared.stuckUnitRate,
      ownerPingPongRate: shared.ownerPingPongRate,
      unitPingPongRate: shared.unitPingPongRate,
      threatNeglectMsMax: threatNeglect.maxThreatNeglectMs,
      objectiveNeglectMsMax: threatNeglect.maxObjectiveNeglectMs,
      frontierDepthOvershootRate: shared.frontierOvershootRate,
      invalidSupportRate: shared.invalidSupportRate,
      laneCongestionEventsPerMinute: shared.laneCongestionEventsPerMinute,
      deadTaskPursuitRate: shared.deadTaskPursuitRate,
      garrisonAnchorViolationRate: shared.garrisonAnchorViolationRate,
      constraintViolations: shared.constraintViolations,
      narrativeIntentDrift: shared.narrativeIntentDrift,
    },
    decisionQuality: {
      decisionSourceMix: shared.decisionSourceMix,
      contactResponseMs: shared.contactResponseMs,
      reserveReleaseLatencyMs: shared.reserveReleaseLatencyMs,
      planCompletionRate: shared.planCompletionRate,
      timeToFirstObjectivePressureMs: shared.timeToFirstObjectivePressureMs,
      opportunityConversionRate: shared.opportunityConversionRate,
      coherenceRate: shared.coherenceRate,
      packageChurnPerMinute: shared.packageChurnPerMinute,
      packageDwellMs: shared.packageDwellMs,
      operationContinuityRate: shared.operationContinuityRate,
      deepReviewCount: shared.deepReviewCount,
      emergencyOverrideRate: shared.emergencyOverrideRate,
      directorAdviceAcceptedCount: shared.directorAdviceAcceptedCount,
      directorAdviceDeferredCount: shared.directorAdviceDeferredCount,
      directorAdviceRejectedCount: shared.directorAdviceRejectedCount,
      phaseCompletionRate: shared.phaseCompletionRate,
      overcommitmentRate: shared.overcommitmentRate,
      undercommitmentRate: shared.undercommitmentRate,
      lossEconomics: shared.lossEconomics,
      supportResponseLatencyMs: shared.supportResponseLatencyMs,
    },
    profileDifferentiation: computeProfileSignals(run, task),
    executionAndFormation: {
      formationCoherence: shared.formationCoherence,
      supportLeash: shared.supportLeash,
      mainEffortCohesion: shared.mainEffortCohesion,
      frontlineCoverageGapRate: shared.frontlineCoverageGapRate,
      assaultSupportRatio: shared.assaultSupportRatio,
      trafficIdleRate: shared.trafficIdleRate,
      commandLatencyMs: shared.commandLatencyMs,
      orderReplacementRate: shared.orderReplacementRate,
      executionFidelity: shared.executionFidelity,
      specialAssetSanity: shared.specialAssetSanity,
    },
    reconAndSearch: {
      reconScreenRate: shared.reconScreenRate,
      noContactSearchRate: shared.noContactSearchRate,
      probePackageRate: shared.probePackageRate,
      contactSearchRate: shared.contactSearchRate,
      searchEpisodeMs: shared.searchEpisodeMs,
      reconOwnerSearchRate: shared.reconOwnerSearchRate,
      contactReacquisitionRate: shared.contactReacquisitionRate,
    },
    humanChallenge: {
      objectivePressureRate: shared.objectivePressureRate,
      combinedArmsRate: shared.combinedArmsRate,
      threatResponseRate: shared.threatResponseRate,
      reserveTimingDiscipline: shared.reserveTimingDiscipline,
      humanChallengeScore: shared.humanChallengeScore,
    },
    scenarioStress: computeStressMetrics(run, shared, task),
    outcomeAudit,
    ...(task.identicalSides ? {
      actorMetrics,
      symmetry,
    } : {}),
    exemplars: buildExemplars(run, task, shared),
  };
}

function buildExemplars(run, task, shared) {
  let firstOvershootAtMs = null;
  let firstDeadTaskAtMs = null;
  let firstRearThreatAtMs = null;

  for (const snapshot of run.state.replay?.snapshots || []) {
    for (const actor of run.state.scenario?.actors || []) {
      const actorId = actor.id;
      const packet = snapshot.directorPackets?.[actorId] || {};
      const depthMap = buildDepthMapForActor(run.state.scenario?.zoneModel, snapshot.zoneAnalysis?.perSide?.[actorId] || {});
      const budget = packet.currentPhaseDepthBudget ?? 1;
      for (const taskEntry of Object.values(snapshot.commanderPlans?.[actorId] || {})) {
        if (firstOvershootAtMs == null && ["main_effort", "supporting_attack", "contain", "relief", "counterattack"].includes(taskEntry.role || taskEntry.kind)) {
          const depth = depthMap[taskEntry.zoneId] ?? 0;
          if (depth > budget + 1) {
            firstOvershootAtMs = snapshot.atMs;
          }
        }
        if (firstDeadTaskAtMs == null && taskEntry.provenance === "lastKnown" && (snapshot.perception?.[actorId]?.agingLastKnownUnits || 0) > 0) {
          firstDeadTaskAtMs = snapshot.atMs;
        }
      }
      if (firstRearThreatAtMs == null && task.scenarioId === "rear_probe" && (packet.threatenedZones || []).length > 0) {
        firstRearThreatAtMs = snapshot.atMs;
      }
    }
  }

  return {
    outcome: {
      winner: run.outcome.winner,
      victoryReason: run.outcome.victoryReason,
      elapsedMs: run.outcome.elapsedMs,
      vpByActor: run.outcome.vpByActor,
    },
    firstOvershootAtMs,
    firstDeadTaskAtMs,
    firstRearThreatAtMs,
    stuckUnitRate: shared.stuckUnitRate,
    invalidSupportRate: shared.invalidSupportRate,
    packageChurnPerMinute: shared.packageChurnPerMinute,
  };
}

function flattenNumericMetrics(value, prefix = "") {
  const rows = {};
  for (const [key, nested] of Object.entries(value || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      Object.assign(rows, flattenNumericMetrics(nested, nextKey));
    } else if (typeof nested === "number") {
      rows[nextKey] = nested;
    }
  }
  return rows;
}

function buildWatchlistScore(result) {
  return roundMetric(
    (result.metrics?.hardInvariants?.stuckUnitRate || 0) * 3
    + (result.metrics?.hardInvariants?.frontierDepthOvershootRate || 0) * 4
    + (result.metrics?.decisionQuality?.undercommitmentRate || 0) * 3
    + (1 - (result.metrics?.executionAndFormation?.specialAssetSanity || 1)) * 4
    + (result.metrics?.scenarioStress?.falseIntelSusceptibility || 0) * 2
    + (1 - (result.metrics?.outcomeAudit?.declaredOutcomeMatchesDerived ?? 1)) * 5
    + (result.metrics?.symmetry?.asymmetryScore || 0) * 0.75
  );
}

function buildActorOrder(result) {
  return Array.from(new Set([
    ...Object.keys(result.metrics?.actorMetrics || {}),
    ...Object.keys(result.outcome?.vpByActor || {}),
  ])).sort();
}

function buildOpeningPairSignature(result, field) {
  const actorOrder = buildActorOrder(result);
  if (actorOrder.length === 0) return null;
  return actorOrder.map((actorId) => result.metrics?.actorMetrics?.[actorId]?.[field] || "none").join(" vs ");
}

function buildScorelineSignature(result) {
  const actorOrder = buildActorOrder(result);
  if (actorOrder.length === 0) return null;
  return actorOrder.map((actorId) => `${actorId}:${result.outcome?.vpByActor?.[actorId] || 0}`).join("|");
}

function computeEntropyForSignatures(signatures) {
  const counts = {};
  for (const signature of signatures.filter(Boolean)) {
    counts[signature] = (counts[signature] || 0) + 1;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;
  const entropy = Object.values(counts).reduce((sum, count) => {
    const p = count / total;
    return sum - (p * Math.log2(p));
  }, 0);
  return roundMetric(entropy);
}

function buildComparableResultKey(result, { includeSeed = false, includeMirror = true } = {}) {
  return [
    result.scenarioId,
    result.profile || "default",
    Number(Boolean(result.identicalSides)),
    includeMirror ? Number(Boolean(result.mirrorSides)) : "x",
    includeSeed ? result.seed : "x",
  ].join("|");
}

function computeFixedSeedReproducibility(results) {
  const grouped = {};
  for (const result of results) {
    const key = buildComparableResultKey(result, { includeSeed: true, includeMirror: true });
    grouped[key] = grouped[key] || [];
    grouped[key].push(result);
  }
  const duplicateGroups = Object.values(grouped).filter((rows) => rows.length >= 2);
  const replayRates = duplicateGroups.map((rows) => Number(new Set(rows.map((row) => row.replayHash || "")).size === 1));
  const openingRates = duplicateGroups.map((rows) => {
    const signatures = rows.map((row) => `${buildOpeningPairSignature(row, "openingPrimaryZoneId") || "none"}|${buildOpeningPairSignature(row, "openingDominantRole") || "none"}`);
    return Number(new Set(signatures).size === 1);
  });
  return {
    duplicateSeedGroupCount: duplicateGroups.length,
    duplicateSeedRunCount: duplicateGroups.reduce((sum, rows) => sum + rows.length, 0),
    replayHashStabilityRate: duplicateGroups.length > 0 ? roundMetric(average(replayRates)) : null,
    openingStabilityRate: duplicateGroups.length > 0 ? roundMetric(average(openingRates)) : null,
  };
}

function computeSeedDiversity(results) {
  const grouped = {};
  for (const result of results) {
    const key = buildComparableResultKey(result, { includeSeed: false, includeMirror: true });
    grouped[key] = grouped[key] || [];
    grouped[key].push(result);
  }
  const families = Object.values(grouped).filter((rows) => rows.length > 0);
  return {
    familyCount: families.length,
    openingZonePairEntropy: summarizeNumeric(families.map((rows) => computeEntropyForSignatures(rows.map((row) => buildOpeningPairSignature(row, "openingPrimaryZoneId"))))),
    openingRolePairEntropy: summarizeNumeric(families.map((rows) => computeEntropyForSignatures(rows.map((row) => buildOpeningPairSignature(row, "openingDominantRole"))))),
    distinctOpeningZonePairs: summarizeNumeric(families.map((rows) => new Set(rows.map((row) => buildOpeningPairSignature(row, "openingPrimaryZoneId")).filter(Boolean)).size)),
    distinctOpeningRolePairs: summarizeNumeric(families.map((rows) => new Set(rows.map((row) => buildOpeningPairSignature(row, "openingDominantRole")).filter(Boolean)).size)),
    distinctScorelineCount: summarizeNumeric(families.map((rows) => new Set(rows.map((row) => buildScorelineSignature(row)).filter(Boolean)).size)),
  };
}

function compareMirrorPair(baseline, mirrored) {
  const actorOrder = buildActorOrder(baseline);
  if (actorOrder.length < 2) return null;
  const [leftId, rightId] = actorOrder;
  const baselineLead = (baseline.outcome?.vpByActor?.[leftId] || 0) - (baseline.outcome?.vpByActor?.[rightId] || 0);
  const mirroredLead = (mirrored.outcome?.vpByActor?.[leftId] || 0) - (mirrored.outcome?.vpByActor?.[rightId] || 0);
  const baselineRoleLeft = baseline.metrics?.actorMetrics?.[leftId]?.openingDominantRole || null;
  const baselineRoleRight = baseline.metrics?.actorMetrics?.[rightId]?.openingDominantRole || null;
  const mirroredRoleLeft = mirrored.metrics?.actorMetrics?.[leftId]?.openingDominantRole || null;
  const mirroredRoleRight = mirrored.metrics?.actorMetrics?.[rightId]?.openingDominantRole || null;
  const baselineZoneLeft = baseline.metrics?.actorMetrics?.[leftId]?.openingPrimaryZoneId || null;
  const baselineZoneRight = baseline.metrics?.actorMetrics?.[rightId]?.openingPrimaryZoneId || null;
  const mirroredZoneLeft = mirrored.metrics?.actorMetrics?.[leftId]?.openingPrimaryZoneId || null;
  const mirroredZoneRight = mirrored.metrics?.actorMetrics?.[rightId]?.openingPrimaryZoneId || null;
  const sign = (value) => value > 0 ? 1 : value < 0 ? -1 : 0;
  return {
    leadFlipped: sign(baselineLead) !== 0 && sign(baselineLead) === -sign(mirroredLead),
    labelBiasPersisted: sign(baselineLead) !== 0 && sign(baselineLead) === sign(mirroredLead),
    exactScoreInversion: (baseline.outcome?.vpByActor?.[leftId] || 0) === (mirrored.outcome?.vpByActor?.[rightId] || 0)
      && (baseline.outcome?.vpByActor?.[rightId] || 0) === (mirrored.outcome?.vpByActor?.[leftId] || 0),
    positionRoleCarryover: Number(baselineRoleLeft === mirroredRoleRight && baselineRoleRight === mirroredRoleLeft),
    positionZoneCarryover: Number(baselineZoneLeft === mirroredZoneRight && baselineZoneRight === mirroredZoneLeft),
  };
}

function computeMirrorBiasMetrics(results) {
  const grouped = {};
  for (const result of results) {
    const key = buildComparableResultKey(result, { includeSeed: true, includeMirror: false });
    grouped[key] = grouped[key] || {};
    grouped[key][result.mirrorSides ? "mirrored" : "baseline"] = result;
  }
  const pairs = Object.values(grouped)
    .filter((entry) => entry.baseline && entry.mirrored)
    .map((entry) => compareMirrorPair(entry.baseline, entry.mirrored))
    .filter(Boolean);
  return {
    pairCount: pairs.length,
    leadFlipRate: pairs.length > 0 ? roundMetric(average(pairs.map((pair) => Number(pair.leadFlipped)))) : null,
    labelBiasPersistenceRate: pairs.length > 0 ? roundMetric(average(pairs.map((pair) => Number(pair.labelBiasPersisted)))) : null,
    exactScoreInversionRate: pairs.length > 0 ? roundMetric(average(pairs.map((pair) => Number(pair.exactScoreInversion)))) : null,
    positionRoleCarryoverRate: pairs.length > 0 ? roundMetric(average(pairs.map((pair) => pair.positionRoleCarryover))) : null,
    positionZoneCarryoverRate: pairs.length > 0 ? roundMetric(average(pairs.map((pair) => pair.positionZoneCarryover))) : null,
  };
}

function computeCrossRunMetrics(results) {
  return {
    reproducibility: computeFixedSeedReproducibility(results),
    diversity: computeSeedDiversity(results),
    mirrorBias: computeMirrorBiasMetrics(results),
  };
}

function aggregateBucketResults(bucketId, results) {
  const flattenedRows = results.map((result) => flattenNumericMetrics(result.metrics));
  const numericKeys = new Set(flattenedRows.flatMap((row) => Object.keys(row)));
  const metricSummaries = Object.fromEntries(
    [...numericKeys].sort().map((key) => [key, summarizeNumeric(flattenedRows.map((row) => row[key]).filter((value) => value != null))])
  );
  const crossRunMetrics = computeCrossRunMetrics(results);
  const scenarioCounts = {};
  const winners = {};
  for (const result of results) {
    scenarioCounts[result.scenarioId] = (scenarioCounts[result.scenarioId] || 0) + 1;
    winners[result.outcome.winner || "none"] = (winners[result.outcome.winner || "none"] || 0) + 1;
  }

  const worstRuns = [...results]
    .map((result) => ({ ...result, watchlistScore: buildWatchlistScore(result) }))
    .sort((left, right) => right.watchlistScore - left.watchlistScore)
    .slice(0, 12)
    .map((result) => ({
      taskId: result.taskId,
      scenarioId: result.scenarioId,
      seed: result.seed,
      profile: result.profile || null,
      watchlistScore: result.watchlistScore,
      outcome: result.outcome,
      outcomeAudit: result.metrics?.outcomeAudit || null,
      symmetry: result.metrics?.symmetry || null,
      exemplars: result.metrics?.exemplars || {},
    }));

  const profileRows = {};
  for (const result of results) {
    if (!result.profile) continue;
    profileRows[result.profile] = profileRows[result.profile] || [];
    profileRows[result.profile].push(result);
  }
  const profileSummaries = Object.fromEntries(
    Object.entries(profileRows).map(([profile, rows]) => [profile, {
      breadthVsFocus: summarizeNumeric(rows.map((row) => row.metrics?.profileDifferentiation?.breadthVsFocus || 0)),
      rearSecurityRate: summarizeNumeric(rows.map((row) => row.metrics?.profileDifferentiation?.rearSecurityRate || 0)),
      reconScreenRate: summarizeNumeric(rows.map((row) => row.metrics?.profileDifferentiation?.reconScreenRate || 0)),
      exploitationBehavior: summarizeNumeric(rows.map((row) => row.metrics?.profileDifferentiation?.exploitationBehavior || 0)),
      specialAssetSanity: summarizeNumeric(rows.map((row) => row.metrics?.executionAndFormation?.specialAssetSanity || 0)),
    }])
  );

  return {
    bucketId,
    label: ALL_BUCKET_CONFIG[bucketId]?.label || bucketId,
    allocation: ALL_BUCKET_CONFIG[bucketId]?.allocation || results.length,
    completedRuns: results.length,
    scenarioCounts,
    winners,
    metricStatus: ALL_BUCKET_METRIC_CATALOG[bucketId] || {},
    metricSummaries,
    crossRunMetrics,
    profileSummaries,
    worstRuns,
  };
}

function deriveBucketFindings(bucketId, aggregate) {
  const findings = [];
  const metrics = aggregate.metricSummaries || {};
  const crossRun = aggregate.crossRunMetrics || {};
  const getMean = (key) => metrics[key]?.mean || 0;

  if ((crossRun.reproducibility?.duplicateSeedGroupCount || 0) > 0 && (crossRun.reproducibility?.replayHashStabilityRate || 0) < 1) {
    findings.push("Repeated fixed-seed runs are not replay-identical, so at least one RTS decision path is still leaking non-determinism.");
  }
  if ((crossRun.reproducibility?.duplicateSeedGroupCount || 0) > 0 && (crossRun.reproducibility?.openingStabilityRate || 0) < 1) {
    findings.push("Repeated fixed-seed runs are changing opening behavior, which means the new variability is not fully seed-stable yet.");
  }

  if (bucketId === "hard_invariants") {
    if (getMean("hardInvariants.stuckUnitRate") > 0.12) findings.push("Stuck-unit behavior is materially elevated and needs pathing, congestion, or order-lifecycle tuning.");
    if (getMean("hardInvariants.frontierDepthOvershootRate") > 0.08) findings.push("Frontier-depth overshoots are happening often enough to question current phase-line gating.");
    if (getMean("hardInvariants.deadTaskPursuitRate") > 0.08) findings.push("Last-known pursuit is lingering after memory ages out, which can distort plans and local execution.");
    if (getMean("hardInvariants.laneCongestionEventsPerMinute") > 3) findings.push("Lane congestion is a recurring burden and is likely driving some of the visible weirdness in maneuver behavior.");
  } else if (bucketId === "decision_quality") {
    if (getMean("decisionQuality.coherenceRate") < 0.7) findings.push("Commander-director coherence is weaker than it should be, suggesting packet intent is not translating cleanly into owner plans.");
    if (getMean("decisionQuality.opportunityConversionRate") < 0.35) findings.push("The AI is seeing opportunities more often than it converts them into plans.");
    if (getMean("decisionQuality.packageChurnPerMinute") > 0.5) findings.push("Package churn is high enough to imply unstable operational framing.");
    if (getMean("decisionQuality.planCompletionRate") < 0.55) findings.push("Too many plans are being superseded or stalling before completion.");
  } else if (bucketId === "profile_differentiation") {
    if (Object.keys(aggregate.profileSummaries || {}).length > 1) findings.push("Profiles are separating on measurable behavior, which is a good sign that doctrine variance is surviving the new planner constraints.");
    if ((aggregate.profileSummaries?.urban_grinder?.breadthVsFocus?.mean || 0) === (aggregate.profileSummaries?.rough_terrain_flanker?.breadthVsFocus?.mean || 0)) findings.push("Some profile signatures may still be flatter than intended and worth differentiating further.");
  } else if (bucketId === "execution_and_formation") {
    if (getMean("executionAndFormation.frontlineCoverageGapRate") > 0.2) findings.push("Frontline coverage gaps are showing up often enough to leave holes in the active front.");
    if (getMean("executionAndFormation.executionFidelity") < 0.75) findings.push("Execution fidelity is below the comfort range, so units are not consistently translating plans into directional movement.");
    if (getMean("executionAndFormation.commandLatencyMs") > 12000) findings.push("Command latency is high enough to slow plan translation into unit action.");
  } else if (bucketId === "scenario_stress") {
    findings.push("Bridge-loss adaptation remains blocked in the RTS path because dynamic bridge demolition is not currently represented in the match loop.");
    if (getMean("scenarioStress.surpriseRearContactResponse") > 45000) findings.push("Rear-contact response is slower than desired under probe stress.");
    if (getMean("scenarioStress.longRunFatigue") > 0) findings.push("Long-run fatigue is increasing replan instability later in matches.");
  } else if (bucketId === "symmetry_validation") {
    const actor1Wins = aggregate.winners?.actor_1 || 0;
    const actor2Wins = aggregate.winners?.actor_2 || 0;
    const decidedRuns = actor1Wins + actor2Wins;
    const sideSkew = decidedRuns > 0 ? Math.abs(actor1Wins - actor2Wins) / decidedRuns : 0;
    if (getMean("outcomeAudit.declaredOutcomeMatchesDerived") < 1) findings.push("Some logged winners do not match the final-state victory rules, so winner counts should be read alongside the outcome audit.");
    if (getMean("outcomeAudit.timeLimitWinnerAboveThreshold") < 1) findings.push("At least some time-limit wins are being recorded without the winner actually sitting above the VP threshold at the final state.");
    if (sideSkew > 0.18) findings.push("Same-doctrine runs still show a meaningful side bias, which points to scenario-side asymmetry, planner asymmetry, or both.");
    if (getMean("symmetry.asymmetryScore") > 3.5) findings.push("Identical-side matches are diverging materially in opening choices or end-state outcomes more often than they should.");
    if (getMean("symmetry.roleShareL1Distance") > 0.25) findings.push("Role mix diverges noticeably between sides even when the doctrine inputs are intentionally matched.");
    if (getMean("symmetry.openingPrimaryZoneSame") < 0.6) findings.push("The director is splitting into different opening primary zones in a large share of same-doctrine runs.");
    if ((crossRun.diversity?.distinctOpeningZonePairs?.mean || 0) < 3) findings.push("Cross-seed opening-zone diversity is still too flat; the new variability is not producing enough distinct opening zone pairings.");
    if ((crossRun.diversity?.distinctOpeningRolePairs?.mean || 0) < 3) findings.push("Cross-seed opening-role diversity is still too flat; the new variability is not producing enough distinct opening role pairings.");
    if ((crossRun.mirrorBias?.pairCount || 0) > 0 && (crossRun.mirrorBias?.labelBiasPersistenceRate || 0) > 0.2) findings.push("Mirrored runs still preserve actor-label bias more often than expected, so some logic remains label-conditioned.");
    if ((crossRun.mirrorBias?.pairCount || 0) > 0 && (crossRun.mirrorBias?.leadFlipRate || 1) < 0.6) findings.push("Mirrored runs are not flipping lead reliably enough, which weakens the case that the remaining skew is mostly map-position driven.");
  }

  if (findings.length === 0) {
    findings.push("No single failure mode dominated this bucket; the dataset is more useful as a baseline and for seed-to-seed outlier hunting.");
  }
  return findings;
}

function renderBucketReport(bucketId, aggregate) {
  const findings = deriveBucketFindings(bucketId, aggregate);
  const crossRun = aggregate.crossRunMetrics || {};
  const lines = [
    `# ${aggregate.label} Research Report`,
    "",
    `- Completed runs: ${aggregate.completedRuns}`,
    `- Planned allocation: ${aggregate.allocation}`,
    `- Scenario mix: ${Object.entries(aggregate.scenarioCounts || {}).map(([scenarioId, count]) => `${scenarioId}=${count}`).join(", ") || "none"}`,
    `- Winner distribution: ${Object.entries(aggregate.winners || {}).map(([winner, count]) => `${winner}=${count}`).join(", ") || "none"}`,
    "",
    "## Metric Status",
    "",
    ...Object.entries(aggregate.metricStatus || {}).map(([metricId, status]) => `- ${metricId}: ${status}`),
    "",
    "## Findings",
    "",
    ...findings.map((line) => `- ${line}`),
    "",
    "## Numeric Summaries",
    "",
  ];

  for (const [metricKey, summary] of Object.entries(aggregate.metricSummaries || {})) {
    if (!summary.count) continue;
    lines.push(`- ${metricKey}: mean ${summary.mean}, median ${summary.median}, p90 ${summary.p90}, max ${summary.max}`);
  }

  if (Object.keys(aggregate.profileSummaries || {}).length > 0) {
    lines.push("");
    lines.push("## Profile Comparison");
    lines.push("");
    for (const [profile, summary] of Object.entries(aggregate.profileSummaries)) {
      lines.push(`### ${profile}`);
      lines.push("");
      for (const [metricKey, metricSummary] of Object.entries(summary || {})) {
        lines.push(`- ${metricKey}: mean ${metricSummary.mean}, median ${metricSummary.median}, p90 ${metricSummary.p90}`);
      }
      lines.push("");
    }
  }

  if (aggregate.metricSummaries?.["symmetry.asymmetryScore"]) {
    const actor1Wins = aggregate.winners?.actor_1 || 0;
    const actor2Wins = aggregate.winners?.actor_2 || 0;
    const decidedRuns = actor1Wins + actor2Wins;
    const sideSkew = decidedRuns > 0 ? roundMetric(Math.abs(actor1Wins - actor2Wins) / decidedRuns) : 0;
    lines.push("");
    lines.push("## Symmetry Snapshot");
    lines.push("");
    lines.push(`- Mean asymmetry score: ${aggregate.metricSummaries["symmetry.asymmetryScore"]?.mean || 0}`);
    lines.push(`- Opening primary-zone match rate: ${aggregate.metricSummaries["symmetry.openingPrimaryZoneSame"]?.mean || 0}`);
    lines.push(`- Opening dominant-role match rate: ${aggregate.metricSummaries["symmetry.openingDominantRoleSame"]?.mean || 0}`);
    lines.push(`- Mean role-share divergence: ${aggregate.metricSummaries["symmetry.roleShareL1Distance"]?.mean || 0}`);
    lines.push(`- Winner skew across decided runs: ${sideSkew}`);
  }

  lines.push("");
  lines.push("## Cross-Run Metrics");
  lines.push("");
  lines.push(`- Duplicate fixed-seed groups: ${crossRun.reproducibility?.duplicateSeedGroupCount || 0}`);
  lines.push(`- Fixed-seed replay-hash stability: ${crossRun.reproducibility?.replayHashStabilityRate ?? "n/a"}`);
  lines.push(`- Fixed-seed opening stability: ${crossRun.reproducibility?.openingStabilityRate ?? "n/a"}`);
  lines.push(`- Mean opening-zone pair entropy: ${crossRun.diversity?.openingZonePairEntropy?.mean || 0}`);
  lines.push(`- Mean opening-role pair entropy: ${crossRun.diversity?.openingRolePairEntropy?.mean || 0}`);
  lines.push(`- Mean distinct opening-zone pairs per family: ${crossRun.diversity?.distinctOpeningZonePairs?.mean || 0}`);
  lines.push(`- Mean distinct opening-role pairs per family: ${crossRun.diversity?.distinctOpeningRolePairs?.mean || 0}`);
  lines.push(`- Mean distinct scorelines per family: ${crossRun.diversity?.distinctScorelineCount?.mean || 0}`);
  if ((crossRun.mirrorBias?.pairCount || 0) > 0) {
    lines.push(`- Mirrored pair count: ${crossRun.mirrorBias.pairCount}`);
    lines.push(`- Mirror lead-flip rate: ${crossRun.mirrorBias.leadFlipRate}`);
    lines.push(`- Mirror label-bias persistence rate: ${crossRun.mirrorBias.labelBiasPersistenceRate}`);
    lines.push(`- Mirror exact score inversion rate: ${crossRun.mirrorBias.exactScoreInversionRate}`);
    lines.push(`- Mirror position role carryover rate: ${crossRun.mirrorBias.positionRoleCarryoverRate}`);
    lines.push(`- Mirror position zone carryover rate: ${crossRun.mirrorBias.positionZoneCarryoverRate}`);
  }

  if (aggregate.metricSummaries?.["outcomeAudit.declaredOutcomeMatchesDerived"]) {
    lines.push("");
    lines.push("## Outcome Audit");
    lines.push("");
    lines.push(`- Declared/derived outcome match rate: ${aggregate.metricSummaries["outcomeAudit.declaredOutcomeMatchesDerived"]?.mean || 0}`);
    lines.push(`- Time-limit winner above-threshold rate: ${aggregate.metricSummaries["outcomeAudit.timeLimitWinnerAboveThreshold"]?.mean || 0}`);
    lines.push(`- VP-goal critical-control validity rate: ${aggregate.metricSummaries["outcomeAudit.vpGoalWinnerControlsCritical"]?.mean || 0}`);
    lines.push(`- Annihilation last-survivor validity rate: ${aggregate.metricSummaries["outcomeAudit.annihilationWinnerIsLastSurvivor"]?.mean || 0}`);
  }

  lines.push("## Worst Runs");
  lines.push("");
  for (const run of aggregate.worstRuns || []) {
    const symmetryScore = run.symmetry?.asymmetryScore != null ? `, asymmetry=${run.symmetry.asymmetryScore}` : "";
    const outcomeMatch = run.outcomeAudit?.declaredOutcomeMatchesDerived != null ? `, outcome_match=${run.outcomeAudit.declaredOutcomeMatchesDerived}` : "";
    lines.push(`- ${run.taskId}: scenario=${run.scenarioId}, seed=${run.seed}, profile=${run.profile || "default"}, score=${run.watchlistScore}, winner=${run.outcome?.winner || "none"}, reason=${run.outcome?.victoryReason || "none"}${symmetryScore}${outcomeMatch}`);
  }

  return lines.join("\n");
}

function getScenarioMaxTicks(scenario) {
  const durationMinutes = Number(scenario.rtsOptions?.durationLimitMinutes || 8);
  return Math.max(240, Math.ceil((durationMinutes * 60_000) / 250));
}

export function executeResearchTask(task, terrainData = null) {
  const resolvedTerrainData = terrainData || resolveTerrainDataForTask(task);
  const scenario = buildResearchScenario(task, resolvedTerrainData);
  const totalTicks = getScenarioMaxTicks(scenario);
  const wallStart = performance.now();
  const run = runMatch({
    scenario,
    terrainData: resolvedTerrainData,
    seed: task.seed,
    totalTicks,
    stopOnWinner: true,
  });
  const wallMs = performance.now() - wallStart;
  const metrics = analyzeRun(run, resolvedTerrainData, task);
  return {
    taskId: task.id,
    bucketId: task.bucketId,
    scenarioId: task.scenarioId,
    seed: task.seed,
    profile: task.profile || null,
    identicalSides: Boolean(task.identicalSides),
    mirrorSides: Boolean(task.mirrorSides),
    replayHash: run.replayHash || null,
    stateHash: run.stateHash || null,
    researchMetadata: run.state.scenario?.researchMetadata || null,
    wallMs: roundMetric(wallMs),
    tickStats: buildTickStats(run.tickTimingsMs),
    outcome: run.outcome,
    metrics,
  };
}

export async function runTaskPool(tasks, { workerCount = DEFAULT_WORKERS, onProgress = null } = {}) {
  const results = [];
  const total = tasks.length;
  let nextIndex = 0;
  let completed = 0;

  const workers = Array.from({ length: Math.min(workerCount, total) }, () => new Worker(new URL(import.meta.url), {
    workerData: { role: "research-worker" },
  }));

  return new Promise((resolve, reject) => {
    const assignNext = (worker) => {
      if (nextIndex >= total) {
        worker.postMessage({ type: "stop" });
        return;
      }
      const task = tasks[nextIndex++];
      worker.postMessage({ type: "run", task });
    };

    for (const worker of workers) {
      worker.on("message", (message) => {
        if (message.type === "ready") {
          assignNext(worker);
          return;
        }
        if (message.type === "result") {
          results.push(message.result);
          completed += 1;
          if (typeof onProgress === "function") {
            onProgress({ completed, total, results });
          }
          if (completed >= total) {
            Promise.all(workers.map((candidate) => candidate.terminate()))
              .then(() => resolve(results))
              .catch(reject);
            return;
          }
          assignNext(worker);
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0 && completed < total) {
          reject(new Error(`Research worker exited with code ${code}`));
        }
      });
    }
  });
}

function parseArgs(argv) {
  const selectedBuckets = [];
  let workerCount = DEFAULT_WORKERS;
  let limit = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bucket" && argv[index + 1]) {
      selectedBuckets.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--workers" && argv[index + 1]) {
      workerCount = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || DEFAULT_WORKERS);
      index += 1;
    } else if (arg === "--limit" && argv[index + 1]) {
      limit = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || 1);
      index += 1;
    }
  }
  return { selectedBuckets, workerCount, limit };
}

async function runResearchCampaign() {
  const { selectedBuckets, workerCount, limit } = parseArgs(process.argv);
  const runId = makeRunId("rts-research");
  const runDir = path.join(RESEARCH_ROOT, "runs", runId);
  ensureDir(runDir);
  const tasksByBucket = buildBucketTasks();
  const bucketIds = selectedBuckets.length > 0 ? selectedBuckets : Object.keys(BUCKET_CONFIG);
  const invalidBucketIds = bucketIds.filter((bucketId) => !ALL_BUCKET_CONFIG[bucketId]);
  if (invalidBucketIds.length > 0) {
    throw new Error(`Unknown research bucket(s): ${invalidBucketIds.join(", ")}. Available buckets: ${Object.keys(ALL_BUCKET_CONFIG).join(", ")}`);
  }
  const campaignSummary = {
    runId,
    timestamp: new Date().toISOString(),
    workerCount,
    buckets: {},
  };

  for (const bucketId of bucketIds) {
    const bucketDir = path.join(runDir, bucketId);
    ensureDir(bucketDir);
    const tasks = limit ? (tasksByBucket[bucketId] || []).slice(0, limit) : (tasksByBucket[bucketId] || []);
    const pilotTasks = tasks.slice(0, Math.min(8, tasks.length));
    const pilotResults = await runTaskPool(pilotTasks, { workerCount: Math.min(workerCount, pilotTasks.length || 1) });
    const pilotSummary = {
      bucketId,
      completedRuns: pilotResults.length,
      snapshotCounts: summarizeNumeric(pilotResults.map((result) => result.tickStats.tickCount)),
      sampleMetrics: aggregateBucketResults(bucketId, pilotResults).metricSummaries,
    };
    writeJson(path.join(bucketDir, "pilot-summary.json"), pilotSummary);

    const fullResults = await runTaskPool(tasks, {
      workerCount,
      onProgress: ({ completed, total, results }) => {
        if (completed % 50 !== 0 && completed !== total) return;
        writeJson(path.join(bucketDir, "checkpoint.json"), {
          bucketId,
          completed,
          total,
          latestTaskId: results[results.length - 1]?.taskId || null,
        });
      },
    });

    const aggregate = aggregateBucketResults(bucketId, fullResults);
    const reportText = renderBucketReport(bucketId, aggregate);
    writeJson(path.join(bucketDir, "results.json"), fullResults);
    writeJson(path.join(bucketDir, "aggregate.json"), aggregate);
    writeMarkdown(path.join(bucketDir, "report.md"), reportText);
    campaignSummary.buckets[bucketId] = {
      completedRuns: aggregate.completedRuns,
      profile: ALL_BUCKET_CONFIG[bucketId]?.profile || null,
      identicalSides: Boolean(ALL_BUCKET_CONFIG[bucketId]?.identicalSides),
      reportPath: path.join(bucketDir, "report.md"),
      aggregatePath: path.join(bucketDir, "aggregate.json"),
    };
  }

  writeJson(path.join(runDir, "campaign-summary.json"), campaignSummary);
  writeJson(path.join(RESEARCH_ROOT, "latest-campaign-summary.json"), campaignSummary);
  console.log(`[rts-research] run=${runId} buckets=${bucketIds.length} workers=${workerCount}`);
  console.log(`[rts-research] summary=${path.join(runDir, "campaign-summary.json")}`);
}

async function runWorkerLoop() {
  parentPort.postMessage({ type: "ready" });
  parentPort.on("message", (message) => {
    if (message.type === "stop") {
      process.exit(0);
    }
    if (message.type === "run") {
      const result = executeResearchTask(message.task, resolveTerrainDataForTask(message.task));
      parentPort.postMessage({ type: "result", result });
    }
  });
}

const isEntrypoint = isMainThread && !!process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (!isMainThread && workerData?.role === "research-worker") {
  runWorkerLoop();
} else if (isEntrypoint) {
  runResearchCampaign().catch((error) => {
    console.error(`[rts-research] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
