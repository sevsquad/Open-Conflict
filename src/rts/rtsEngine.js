import { computeEnhancedLOS, getNeighbors, hexDistance, hexLine, hexRange, offsetToAxial, hexDistanceAxial } from "../mapRenderer/HexMath.js";
import { cellToDisplayString, cellToPositionString, parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { buildThreatMap, findWeightedPath } from "../simulation/aiPathfinding.js";
import {
  getAiProfile,
  getThinkBudgetConfig,
  normalizeRtsAiExperimentTuning,
  normalizeRtsAiGoalModel,
  normalizeRtsAiVariationConfig,
  normalizeRtsAiVariationMode,
  RTS_AI_EXPERIMENT_TUNING_DEFAULTS,
  RTS_AI_GOAL_MODEL_DEFAULT,
  RTS_AI_VARIATION_DEFAULTS,
  RTS_AI_VARIATION_MODE_DEFAULT,
} from "../simulation/aiProfiles.js";
import { isHelicopter } from "../simulation/orderTypes.js";
import { RTS_MAX_UNITS_PER_HEX, countsTowardRtsHexOccupation } from "./rtsStart.js";
import {
  ZONE_CONTROL_THRESHOLD,
  getEdgeById,
  getLaneById,
  getObjectiveZoneId,
  getZoneById,
  getZoneIdForHex,
  getZonesForActorAnchors,
  resolveLaneTraversal,
  terrainCategoryForCell,
} from "./zoneModel.js";
import {
  buildRtsPhaseIndex,
  collectSpatialCandidateUnits,
  getIndexedDisplayPosition,
  getIndexedUnit,
  getIndexedZoneId,
  sortUnitsByGlobalOrder,
} from "./rtsPhaseIndex.js";

const COMMAND_KINDS = new Set([
  "move",
  "attack_move",
  "hold",
  "halt",
  "withdraw",
  "assault",
  "screen",
  "embark_helo",
  "disembark_helo",
]);

const FIRE_SUPPORT_UNIT_TYPES = new Set(["artillery", "logistics", "headquarters"]);
const COMMAND_SUPPORT_UNIT_TYPES = new Set(["headquarters", "logistics"]);
const ARTILLERY_TRANSIT_COMMAND_KINDS = new Set(["move", "attack_move", "withdraw", "embark_helo", "disembark_helo"]);

const LOS_TERRAIN_EFFECTS = {
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

const CANOPY_HEIGHTS = {
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

const BASE_SPEEDS = {
  foot: 0.35,
  wheeled: 0.55,
  tracked: 0.45,
  helicopter: 1.25,
  amphibious: 0.35,
  static: 0,
};
const RTS_MOVEMENT_TIME_SCALE = 10;
const RTS_THOUGHT_INTERVAL_MS = 15000;
const RTS_SYSTEM_TEMPO_SCALE = 4;
const RTS_DIRECTOR_BASE_CADENCE_MS = 30000;
const RTS_COMMANDER_BASE_CADENCE_MS = 15000;
const RTS_SUBORDINATE_BASE_CADENCE_MS = 5000;
const ARTILLERY_FLIGHT_MS = 3000;
const UNDER_FIRE_WINDOW_MS = 6000;
const ZONE_CONTROL_MIN_FOOTHOLD = 0.15;
const ZONE_CONTESTED_MIN_SHARE = 0.25;
const MAX_PRIMARY_ZONE_OWNER_SHARE = 0.5;
const LANE_OPTIONAL_ROLES = new Set(["reserve", "rear_security", "fallback"]);
const DIRECTOR_PRIMARY_FRONTIER_DEPTH = 1;
const DIRECTOR_BREAKTHROUGH_PRIMARY_DEPTH = 2;
const DIRECTOR_PROBE_FRONTIER_DEPTH = 2;
const DIRECTOR_SUPPORT_FRONTIER_DEPTH = 1;
const OPENING_ZONE_CONTEST_SHARE = 0.12;
const OPENING_ZONE_CONTEST_HOLDING_POWER = 0.8;
const COMMANDER_DEEP_REVIEW_MS = 30000;
const COMMANDER_MIN_OPERATION_COMMITMENT_MS = 30000;
const COMMANDER_SUPPORT_COMMITMENT_MS = 15000;
const COMMANDER_PROGRESS_STALL_MS = 30000;
const RTS_VARIATION_COMPONENTS = ["tempo", "flank", "support", "reserve", "caution"];

const TYPE_RANGE_KM = {
  infantry: 1.5,
  airborne: 1.5,
  parachute_infantry: 1.5,
  glider_infantry: 1.5,
  mechanized: 2.5,
  armored_infantry: 2.5,
  mechanized_infantry: 2.5,
  armor: 3.2,
  recon: 2.2,
  artillery: 7.5,
  headquarters: 1.2,
  engineer: 1.2,
  air_defense: 4.5,
  logistics: 0.8,
  special_forces: 2.0,
  attack_helicopter: 4.0,
  transport: 0.5,
  anti_tank: 3.5,
  tank_destroyer: 3.5,
};

const TYPE_DETECTION = {
  infantry: 4,
  airborne: 4,
  parachute_infantry: 4,
  glider_infantry: 4,
  mechanized: 5,
  armored_infantry: 5,
  mechanized_infantry: 5,
  armor: 5,
  recon: 7,
  artillery: 4,
  headquarters: 4,
  engineer: 3,
  air_defense: 6,
  logistics: 3,
  special_forces: 6,
  attack_helicopter: 6,
  transport: 6,
  anti_tank: 5,
  tank_destroyer: 5,
};

const TYPE_POWER = {
  infantry: 1.0,
  airborne: 1.0,
  parachute_infantry: 1.0,
  glider_infantry: 1.0,
  mechanized: 1.2,
  armored_infantry: 1.2,
  mechanized_infantry: 1.2,
  armor: 1.45,
  recon: 0.8,
  artillery: 1.15,
  headquarters: 0.45,
  engineer: 0.7,
  air_defense: 1.05,
  logistics: 0.35,
  special_forces: 1.1,
  attack_helicopter: 1.35,
  transport: 0.4,
  anti_tank: 1.25,
  tank_destroyer: 1.25,
};

const TYPE_COOLDOWN_MS = {
  artillery: 3000 * RTS_SYSTEM_TEMPO_SCALE,
  attack_helicopter: 8000 * RTS_SYSTEM_TEMPO_SCALE,
  air_defense: 1250 * RTS_SYSTEM_TEMPO_SCALE,
  armor: 1250 * RTS_SYSTEM_TEMPO_SCALE,
  mechanized: 1400 * RTS_SYSTEM_TEMPO_SCALE,
  default: 1750 * RTS_SYSTEM_TEMPO_SCALE,
};

const VISIBILITY_FACTORS = {
  excellent: 1.25,
  good: 1,
  moderate: 0.85,
  poor: 0.65,
  very_poor: 0.45,
};

const TERRAIN_DEFENSE = {
  dense_urban: 0.3,
  light_urban: 0.18,
  suburban: 0.12,
  forest: 0.18,
  dense_forest: 0.25,
  jungle: 0.25,
  mountain: 0.2,
  peak: 0.25,
  mountain_forest: 0.25,
  forested_hills: 0.18,
  trench: 0.18,
};

const MAX_LOG_ITEMS = 200;
const MAX_REPLAY_EVENTS = 1000;
const MAX_SNAPSHOTS = 100;
const AI_LOG_MODE_STANDARD = "standard";
const AI_LOG_MODE_SUMMARY = "llm_summary";
const AI_LOG_MODE_FULL_DIARY = "full_diary";
const AI_LOG_MODE_VALUES = new Set([AI_LOG_MODE_STANDARD, AI_LOG_MODE_SUMMARY, AI_LOG_MODE_FULL_DIARY]);
const MAX_SUMMARY_HISTORY = 120;
const MAX_SUMMARY_RECENT_ITEMS = 6;
const LAST_KNOWN_DECAY_MS = 180000;
const FIRE_MISSION_DECAY_MS = 20000;
const FIRE_MISSION_EXPIRY_MS = 45000;
const COUNTER_BATTERY_TTL_MS = 60000;
const ILLUMINATION_DETECTION_MULT = 1.35;
const SUPPORT_UNIT_TYPES = new Set(["artillery", "logistics", "headquarters"]);
const SPOTTER_UNIT_TYPES = new Set([
  "recon",
  "special_forces",
  "infantry",
  "airborne",
  "parachute_infantry",
  "glider_infantry",
  "mechanized_infantry",
  "armored_infantry",
  "headquarters",
  "attack_helicopter",
]);
const STRIKE_ELEMENT_TYPES = new Set(["attack_helicopter"]);
const AUTO_SUBORDINATE_ASSIGNMENT_SOURCES = new Set([
  "sector",
  "sector-fires",
  "hq-command",
  "hq-chain-command",
  "parentHQ-fires",
  "parentHQ-command",
  "parentHQ-maneuver",
]);
const FIRE_MISSION_QUALITY_MULT = {
  direct: 1,
  observed: 0.75,
  decaying: 0.45,
  preplanned: 0.3,
};
const FIRE_MISSION_RADII = {
  destroy: 1,
  suppress: 2,
  smoke: 2,
  illuminate: 3,
  counter_battery: 1,
};
const AREA_EFFECT_DURATIONS_MS = {
  smoke: 30000,
  illuminate: 45000,
};
const STACK_DISPLAY_OFFSETS = [
  { c: -0.16, r: -0.08 },
  { c: 0.16, r: 0.08 },
  { c: 0, r: -0.18 },
  { c: 0, r: 0.18 },
];

function getMaxStackPerHex(state) {
  return Math.max(1, Number.parseInt(String(state?.game?.maxStackPerHex ?? RTS_MAX_UNITS_PER_HEX), 10) || RTS_MAX_UNITS_PER_HEX);
}

function getTelemetryLimit(state, optionName, fallback) {
  const raw = state?.scenario?.rtsOptions?.[optionName];
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function getMaxLogItems(state) {
  return getTelemetryLimit(state, "maxLogItems", MAX_LOG_ITEMS);
}

function getMaxReplayEvents(state) {
  return getTelemetryLimit(state, "maxReplayEvents", MAX_REPLAY_EVENTS);
}

function getMaxSnapshots(state) {
  return getTelemetryLimit(state, "maxSnapshots", MAX_SNAPSHOTS);
}

function getSnapshotEveryTicks(state) {
  return getTelemetryLimit(state, "snapshotEveryTicks", 8);
}

function getAiLogMode(state) {
  const mode = state?.scenario?.rtsOptions?.aiLogMode;
  return AI_LOG_MODE_VALUES.has(mode) ? mode : AI_LOG_MODE_STANDARD;
}

function isAiSummaryEnabled(state) {
  const mode = getAiLogMode(state);
  return mode === AI_LOG_MODE_SUMMARY || mode === AI_LOG_MODE_FULL_DIARY;
}

function isAiDiaryEnabled(state) {
  return getAiLogMode(state) === AI_LOG_MODE_FULL_DIARY;
}

function isAiActorId(state, actorId) {
  return Boolean((state?.scenario?.actors || []).find((actor) => actor.id === actorId && actor.controller === "ai"));
}

function isSupportUnitType(type) {
  return SUPPORT_UNIT_TYPES.has(type);
}

function isSpotterCapableUnit(unit) {
  return SPOTTER_UNIT_TYPES.has(unit?.type);
}

function isStrikeElementUnit(unit) {
  return STRIKE_ELEMENT_TYPES.has(unit?.type);
}

function getFireMissionRadius(ammoType) {
  return FIRE_MISSION_RADII[ammoType] || FIRE_MISSION_RADII.destroy;
}

function getSpotterAccuracyMult(quality) {
  return FIRE_MISSION_QUALITY_MULT[quality] || FIRE_MISSION_QUALITY_MULT.observed;
}

function getOccupantsAtHex(occupancy, hex) {
  const entry = occupancy?.[hex];
  if (Array.isArray(entry)) return entry.filter(Boolean);
  if (typeof entry === "string" && entry) return [entry];
  return [];
}

function setOccupantsAtHex(occupancy, hex, unitIds) {
  const normalized = Array.from(new Set((unitIds || []).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  if (normalized.length > 0) occupancy[hex] = normalized;
  else delete occupancy[hex];
}

function addOccupantToHex(occupancy, hex, unitId) {
  const occupants = getOccupantsAtHex(occupancy, hex);
  if (!occupants.includes(unitId)) occupants.push(unitId);
  setOccupantsAtHex(occupancy, hex, occupants);
}

function removeOccupantFromHex(occupancy, hex, unitId) {
  const occupants = getOccupantsAtHex(occupancy, hex).filter((candidateId) => candidateId !== unitId);
  setOccupantsAtHex(occupancy, hex, occupants);
}

function cloneOccupancy(occupancy) {
  return Object.fromEntries(
    Object.entries(occupancy || {})
      .map(([hex, unitIds]) => [hex, [...getOccupantsAtHex(occupancy, hex)]])
      .filter(([, unitIds]) => unitIds.length > 0)
  );
}

function classifyHexEntry(state, occupancy, hex, unit) {
  if (!countsTowardRtsHexOccupation(unit)) {
    return { allowed: true, occupantIds: getOccupantsAtHex(occupancy, hex) };
  }
  const occupantIds = getOccupantsAtHex(occupancy, hex).filter((candidateId) => candidateId !== unit.id);
  const occupantUnits = occupantIds
    .map((occupantId) => (state.units || []).find((candidate) => candidate.id === occupantId))
    .filter(Boolean);
  const enemyBlocker = occupantUnits.find((occupant) => occupant.actor !== unit.actor);
  if (enemyBlocker) {
    return { allowed: false, reason: "enemy", blockerId: enemyBlocker.id, occupantIds };
  }
  if (occupantIds.length >= getMaxStackPerHex(state)) {
    return { allowed: false, reason: "capacity", blockerId: occupantIds[0] || null, occupantIds };
  }
  return { allowed: true, occupantIds };
}

export function createRtsCommand({ unitIds, kind, targetHex = null, targetUnitId = null, waypoints = [], queueSlot = 0 }, issuedAtMs) {
  const stableUnitIds = Array.from(new Set(unitIds || [])).filter(Boolean);
  const stableWaypoints = Array.isArray(waypoints) ? waypoints : [];
  const signature = [
    kind,
    targetHex || "-",
    targetUnitId || "-",
    queueSlot,
    stableUnitIds.join(","),
    stableWaypoints.join(">"),
  ].join("|");
  return {
    id: `cmd_${issuedAtMs}_${signature}`,
    kind,
    issuedAtMs,
    unitIds: stableUnitIds,
    targetHex,
    targetUnitId,
    waypoints: stableWaypoints,
    queueSlot,
  };
}

export function reduceRtsCommand(state, terrainData, command, source = "player") {
  if (!command || !COMMAND_KINDS.has(command.kind)) return state;
  const next = cloneMatch(state);
  ensureRuntimeShape(next);

  for (const unitId of command.unitIds || []) {
    const unit = next.units.find((candidate) => candidate.id === unitId);
    if (!unit || unit.status === "destroyed") continue;
    initializeUnitModeState(unit);
    if (!isUnitReleased(unit, next.game?.elapsedMs || 0)) {
      pushEvent(next, "command", `${unit.name} is not released yet.`, {
        unitId,
        releaseAtMs: unit.modeState.releaseAtMs || 0,
      });
      continue;
    }
    const perUnitCommand = { ...command, unitIds: [unitId], source };
    if (command.queueSlot === 1 && unit.modeState.currentCommand) {
      unit.modeState.commandQueue = [perUnitCommand];
      pushEvent(next, "command", `${unit.name} queued ${formatCommandLabel(command.kind)}.`, { unitId, command: perUnitCommand });
      continue;
    }
    unit.modeState.commandQueue = [];
    assignImmediateCommand(next, unit, terrainData, perUnitCommand);
  }

  return next;
}

export function tickRtsMatch(state, terrainData) {
  if (!state?.game) return state;
  const next = cloneMatch(state);
  ensureRuntimeShape(next);

  if (next.game.paused || next.game.winner) {
    return next;
  }

  const tickMs = next.game.tickMs || 250;
  next.game.elapsedMs = (next.game.elapsedMs || 0) + tickMs;
  next.telemetry.ticks = (next.telemetry.ticks || 0) + 1;
  next.combat.lastEvents = [];
  pruneCombatState(next);

  refreshZoneFrontlineAnalysis(next, terrainData);
  if (!next.truthState?.openingControlPrimed) {
    primeOpeningControlState(next, terrainData);
    refreshZoneFrontlineAnalysis(next, terrainData);
  }
  const aiPhaseIndex = buildRtsPhaseIndex(next);
  runAiCadence(next, terrainData, aiPhaseIndex);
  const movementPhaseIndex = buildRtsPhaseIndex(next);
  advanceMovement(next, terrainData, movementPhaseIndex);
  recomputeOccupancy(next);
  const engagementPhaseIndex = buildRtsPhaseIndex(next);
  const perceptions = computePerception(next, terrainData, engagementPhaseIndex);
  next.perceptionState = perceptions.serialized;
  recordPerceptionDeltas(next, state.perceptionState || {}, next.perceptionState || {});
  next.truthState.lastPerceptionTick = next.game.elapsedMs;
  refreshZoneFrontlineAnalysis(next, terrainData);
  resolveCombat(next, terrainData, perceptions.runtime, engagementPhaseIndex);
  updateMoraleAndResources(next, terrainData);
  updateObjectives(next, terrainData);
  updateVictory(next);
  snapshotReplay(next);

  return next;
}

export function computeRtsDisplayState(state, activeActorId, debugVisibility = "player") {
  const positions = {};
  for (const unit of state.units || []) {
    positions[unit.id] = getUnitDisplayPosition(unit);
  }
  applyStackDisplayOffsets(state, positions);

  if (debugVisibility === "spectator" || !activeActorId) {
    return {
      unitPositions: positions,
      fowMode: null,
      underFireUnitIds: new Set((state.units || []).filter((unit) => isUnderFire(unit, state.game.elapsedMs || 0)).map((unit) => unit.id)),
    };
  }

  const actorView = state.perceptionState?.[activeActorId] || { visibleCells: [], detectedUnits: [], contactUnits: [], lastKnown: {} };
  return {
    unitPositions: positions,
    fowMode: {
      activeActorId,
      visibleCells: new Set(actorView.visibleCells || []),
      detectedUnits: new Set(actorView.detectedUnits || []),
      contactUnits: new Set(actorView.contactUnits || []),
      lastKnown: actorView.lastKnown || {},
    },
    underFireUnitIds: new Set((state.units || []).filter((unit) => isUnderFire(unit, state.game.elapsedMs || 0)).map((unit) => unit.id)),
  };
}

function applyStackDisplayOffsets(state, positions) {
  const stackedByHex = new Map();
  for (const unit of state.units || []) {
    if (!unit || unit.status === "destroyed" || unit.embarkedIn || unit.modeState?.travelState) continue;
    const settledHex = unit.modeState?.settledHex || unit.position;
    if (!settledHex || !positions[unit.id]) continue;
    const stack = stackedByHex.get(settledHex) || [];
    stack.push(unit.id);
    stackedByHex.set(settledHex, stack);
  }

  for (const unitIds of stackedByHex.values()) {
    if (unitIds.length <= 1) continue;
    unitIds.sort((left, right) => left.localeCompare(right));
    for (let index = 0; index < unitIds.length; index += 1) {
      const unitId = unitIds[index];
      const base = positions[unitId];
      const offset = STACK_DISPLAY_OFFSETS[index] || STACK_DISPLAY_OFFSETS[index % STACK_DISPLAY_OFFSETS.length];
      if (!base || !offset) continue;
      positions[unitId] = {
        ...base,
        c: (base.c ?? base.col ?? 0) + offset.c,
        r: (base.r ?? base.row ?? 0) + offset.r,
      };
    }
  }
}

function ensureRuntimeShape(state) {
  state.game.rngState = state.game.rngState ?? (state.game.rngSeed || 1);
  state.game.maxStackPerHex = state.game.maxStackPerHex ?? RTS_MAX_UNITS_PER_HEX;
  state.game.movementTimeScale = state.game.movementTimeScale ?? RTS_MOVEMENT_TIME_SCALE;
  state.truthState = state.truthState || {};
  state.truthState.commandLog = state.truthState.commandLog || [];
  state.truthState.eventLog = state.truthState.eventLog || [];
  state.truthState.objectives = state.truthState.objectives || {};
  state.truthState.openingZoneOwners = state.truthState.openingZoneOwners || {};
  state.truthState.openingControlPrimed = Boolean(state.truthState.openingControlPrimed);
  state.occupancy = cloneOccupancy(state.occupancy || state.truthState.occupancy || {});
  state.truthState.occupancy = cloneOccupancy(state.truthState.occupancy || state.occupancy);
  state.combat = state.combat || { activeEngagements: [], pendingImpacts: [], lastEvents: [], spotterPool: {}, counterBatteryQueue: [], areaEffects: [] };
  state.combat.activeEngagements = state.combat.activeEngagements || [];
  state.combat.pendingImpacts = state.combat.pendingImpacts || [];
  state.combat.lastEvents = state.combat.lastEvents || [];
  state.combat.spotterPool = state.combat.spotterPool || {};
  state.combat.counterBatteryQueue = state.combat.counterBatteryQueue || [];
  state.combat.areaEffects = state.combat.areaEffects || [];
  state.zoneAnalysis = state.zoneAnalysis || { truth: { byZone: {}, bySide: {} }, perSide: {} };
  state.zoneAnalysis.truth = state.zoneAnalysis.truth || { byZone: {}, bySide: {} };
  state.zoneAnalysis.truth.byZone = state.zoneAnalysis.truth.byZone || {};
  state.zoneAnalysis.truth.bySide = state.zoneAnalysis.truth.bySide || {};
  state.zoneAnalysis.perSide = state.zoneAnalysis.perSide || {};
  state.edgeAnalysis = state.edgeAnalysis || { truth: { byEdge: {}, bySide: {} }, perSide: {} };
  state.edgeAnalysis.truth = state.edgeAnalysis.truth || { byEdge: {}, bySide: {} };
  state.edgeAnalysis.truth.byEdge = state.edgeAnalysis.truth.byEdge || {};
  state.edgeAnalysis.truth.bySide = state.edgeAnalysis.truth.bySide || {};
  state.edgeAnalysis.perSide = state.edgeAnalysis.perSide || {};
  state.frontlineState = state.frontlineState || { perSide: {} };
  state.frontlineState.perSide = state.frontlineState.perSide || {};
  state.ai = state.ai || { directors: {}, commanders: {}, subordinates: {}, executors: {}, decisionLog: [], thoughts: {}, summaries: {}, diary: [] };
  state.ai.directors = state.ai.directors || {};
  state.ai.commanders = state.ai.commanders || {};
  state.ai.subordinates = state.ai.subordinates || {};
  state.ai.executors = state.ai.executors || {};
  state.ai.variation = state.ai.variation || {};
  state.ai.decisionLog = state.ai.decisionLog || [];
  state.ai.thoughts = state.ai.thoughts || {};
  state.ai.summaries = state.ai.summaries || {};
  state.ai.diary = state.ai.diary || [];
  state.telemetry = state.telemetry || { ticks: 0, timings: [], provenance: [], snapshots: [], perceptionSnapshots: [], directorPackets: [], thoughtSnapshots: [] };
  state.telemetry.snapshots = state.telemetry.snapshots || [];
  state.telemetry.perceptionSnapshots = state.telemetry.perceptionSnapshots || [];
  state.telemetry.directorPackets = state.telemetry.directorPackets || [];
  state.telemetry.thoughtSnapshots = state.telemetry.thoughtSnapshots || [];
  state.replay = state.replay || { seed: state.game.rngSeed || 1, snapshots: [], events: [] };
  state.replay.snapshots = state.replay.snapshots || [];
  state.replay.events = state.replay.events || [];
  for (const unit of state.units || []) {
    initializeUnitModeState(unit);
  }
  recomputeOccupancy(state);
}

function pruneCombatState(state) {
  const nowMs = state.game?.elapsedMs || 0;
  state.combat.areaEffects = (state.combat.areaEffects || []).filter((effect) => (effect?.expiresAtMs || 0) > nowMs);
  state.combat.counterBatteryQueue = (state.combat.counterBatteryQueue || []).filter((entry) => (entry?.expiresAtMs || 0) > nowMs);
  state.combat.spotterPool = Object.fromEntries(
    Object.entries(state.combat.spotterPool || {}).map(([actorId, records]) => [actorId, Object.fromEntries(
      Object.entries(records || {}).filter(([, record]) => (record?.expiresAtMs || 0) > nowMs)
    )])
  );
}

function refreshZoneFrontlineAnalysis(state, terrainData) {
  const zoneModel = state.scenario?.zoneModel;
  if (!zoneModel?.zones?.length) return;
  const truthBySide = {};
  const perceivedBySide = {};
  const truthEdgeBySide = {};
  const perceivedEdgeBySide = {};

  for (const actor of state.scenario?.actors || []) {
    const truthPerspective = buildZonePerspective(state, terrainData, actor.id, true);
    const perceivedPerspective = buildZonePerspective(state, terrainData, actor.id, false);
    truthBySide[actor.id] = truthPerspective.zones;
    perceivedBySide[actor.id] = perceivedPerspective.zones;
    truthEdgeBySide[actor.id] = truthPerspective.edges;
    perceivedEdgeBySide[actor.id] = perceivedPerspective.edges;
    updateFrontlineDurations(state, actor.id, truthPerspective.zones);
  }

  state.zoneAnalysis.truth = {
    byZone: buildTruthZoneLedger(state, truthBySide),
    bySide: truthBySide,
    generatedAtMs: state.game.elapsedMs || 0,
  };
  state.zoneAnalysis.perSide = perceivedBySide;
  state.edgeAnalysis.truth = {
    byEdge: buildTruthEdgeLedger(zoneModel, truthEdgeBySide),
    bySide: truthEdgeBySide,
    generatedAtMs: state.game.elapsedMs || 0,
  };
  state.edgeAnalysis.perSide = perceivedEdgeBySide;
  applyOpeningZoneOwnership(state);
}

function normalizeObjectiveRecord(record, holdMsRequired = 0) {
  const normalized = {
    controller: record?.controller || null,
    heldMs: Math.max(0, Number(record?.heldMs || 0)),
    candidateController: record?.candidateController || null,
    candidateHeldMs: Math.max(0, Number(record?.candidateHeldMs || 0)),
    seededFromBootstrap: Boolean(record?.seededFromBootstrap),
    scoreAwarded: { ...(record?.scoreAwarded || {}) },
  };
  if (normalized.controller && holdMsRequired > 0) {
    normalized.heldMs = Math.max(normalized.heldMs, holdMsRequired);
  }
  if (normalized.candidateController === normalized.controller && holdMsRequired > 0) {
    normalized.candidateHeldMs = Math.max(normalized.candidateHeldMs, normalized.heldMs, holdMsRequired);
  }
  return normalized;
}

function getObjectiveProgressRecord(record, holdMsRequired = 0) {
  const normalized = normalizeObjectiveRecord(record, holdMsRequired);
  if (normalized.candidateController && (!normalized.controller || normalized.candidateController !== normalized.controller)) {
    return {
      controller: normalized.candidateController,
      heldMs: normalized.candidateHeldMs,
      progress: holdMsRequired > 0 ? clamp(normalized.candidateHeldMs / holdMsRequired, 0, 1) : (normalized.candidateController ? 1 : 0),
      contested: Boolean(normalized.controller && normalized.controller !== normalized.candidateController),
    };
  }
  return {
    controller: normalized.controller,
    heldMs: normalized.heldMs,
    progress: holdMsRequired > 0 ? clamp(normalized.heldMs / holdMsRequired, 0, 1) : (normalized.controller ? 1 : 0),
    contested: false,
  };
}

function zoneHasMeaningfulOpposition(state, zoneId, actorId) {
  const snapshot = state.zoneAnalysis?.perSide?.[actorId]?.[zoneId];
  if (!snapshot) return false;
  return (snapshot.controlShare || 0) >= OPENING_ZONE_CONTEST_SHARE
    || (snapshot.friendlyHoldingPower || 0) >= OPENING_ZONE_CONTEST_HOLDING_POWER
    || snapshot.state === "contested"
    || snapshot.state === "friendly";
}

function primeOpeningControlState(state, terrainData) {
  const zoneModel = state.scenario?.zoneModel;
  if (!zoneModel?.zones?.length || state.truthState?.openingControlPrimed) return;
  const seededOwners = {};
  const actors = state.scenario?.actors || [];
  const holdMsRequired = (state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
  const objectives = state.scenario?.objectives?.hexVP || [];

  for (const actor of actors) {
    for (const zoneId of getZonesForActorAnchors(zoneModel, actor.id)) {
      if (!zoneId) continue;
      const actorSnapshot = state.zoneAnalysis?.perSide?.[actor.id]?.[zoneId];
      const actorPresence = (actorSnapshot?.controlShare || 0) > 0.05
        || (actorSnapshot?.friendlyHoldingPower || 0) >= 0.35
        || actorSnapshot?.state === "friendly";
      if (!actorPresence) continue;
      const opposed = actors.some((other) => other.id !== actor.id && zoneHasMeaningfulOpposition(state, zoneId, other.id));
      const existingController = state.zoneAnalysis?.truth?.byZone?.[zoneId]?.controller;
      if (!opposed && (!existingController || existingController === actor.id)) {
        seededOwners[zoneId] = actor.id;
      }
    }
  }

  state.truthState.openingZoneOwners = seededOwners;
  state.truthState.openingControlPrimed = true;
  state.truthState.objectives = { ...(state.truthState.objectives || {}) };
  for (const objective of objectives) {
    const zoneId = getObjectiveZoneId(zoneModel, objective.hex) || getZoneIdForHex(zoneModel, objective.hex);
    const seededController = zoneId ? seededOwners[zoneId] || null : null;
    if (!seededController) continue;
    state.truthState.objectives[objective.hex] = {
      ...normalizeObjectiveRecord(state.truthState.objectives[objective.hex], holdMsRequired),
      controller: seededController,
      heldMs: holdMsRequired,
      candidateController: seededController,
      candidateHeldMs: holdMsRequired,
      seededFromBootstrap: true,
    };
  }
  applyOpeningZoneOwnership(state);
}

function applyOpeningZoneOwnership(state) {
  const seededOwners = { ...(state.truthState?.openingZoneOwners || {}) };
  const zoneLedger = state.zoneAnalysis?.truth?.byZone || {};
  const actors = state.scenario?.actors || [];
  const objectives = state.scenario?.objectives?.hexVP || [];
  const holdMsRequired = (state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
  const retainedOwners = {};

  for (const [zoneId, actorId] of Object.entries(seededOwners)) {
    const truthEntry = zoneLedger[zoneId];
    if (!truthEntry) continue;
    const displaced = truthEntry.controller && truthEntry.controller !== actorId;
    const opposed = actors.some((other) => other.id !== actorId && zoneHasMeaningfulOpposition(state, zoneId, other.id));
    if (displaced || opposed) {
      continue;
    }
    retainedOwners[zoneId] = actorId;
    truthEntry.controller = actorId;
    truthEntry.controlByActor = truthEntry.controlByActor || {};
    truthEntry.controlByActor[actorId] = Math.max(truthEntry.controlByActor[actorId] || 0, ZONE_CONTROL_THRESHOLD);
    truthEntry.stateByActor = truthEntry.stateByActor || {};
    for (const actor of actors) {
      const snapshot = state.zoneAnalysis?.perSide?.[actor.id]?.[zoneId];
      if (!snapshot) continue;
      if (actor.id === actorId) {
        snapshot.state = snapshot.state === "contested" ? "contested" : "friendly";
        snapshot.controlShare = Math.max(snapshot.controlShare || 0, ZONE_CONTROL_THRESHOLD);
        snapshot.enemyShare = Math.min(snapshot.enemyShare || 0, OPENING_ZONE_CONTEST_SHARE * 0.5);
        truthEntry.stateByActor[actor.id] = snapshot.state;
      } else if ((snapshot.controlShare || 0) < OPENING_ZONE_CONTEST_SHARE) {
        if (snapshot.state === "neutral") snapshot.state = "enemy";
        truthEntry.stateByActor[actor.id] = snapshot.state;
      }
    }
    for (const objective of objectives) {
      const objectiveZoneId = getObjectiveZoneId(state.scenario?.zoneModel, objective.hex) || getZoneIdForHex(state.scenario?.zoneModel, objective.hex);
      if (objectiveZoneId !== zoneId) continue;
      state.truthState.objectives[objective.hex] = {
        ...normalizeObjectiveRecord(state.truthState?.objectives?.[objective.hex], holdMsRequired),
        controller: actorId,
        heldMs: holdMsRequired,
        candidateController: actorId,
        candidateHeldMs: holdMsRequired,
        seededFromBootstrap: true,
      };
    }
  }

  state.truthState.openingZoneOwners = retainedOwners;
}

function buildZonePerspective(state, terrainData, actorId, useTruth = false) {
  const zoneModel = state.scenario?.zoneModel;
  const perspectiveUnits = buildPerspectiveUnits(state, actorId, useTruth);
  const zoneSnapshots = {};

  for (const zone of zoneModel?.zones || []) {
    const borderCounts = { friendly: 0, enemy: 0, contested: 0, neutral: 0 };
    const interiorCounts = { friendly: 0, enemy: 0, contested: 0, neutral: 0 };
    let friendlyPower = 0;
    let enemyPower = 0;
    let friendlyHoldingPower = 0;
    let enemyHoldingPower = 0;
    for (const hex of zone.hexIds || []) {
      const cell = terrainData?.cells?.[hex] || null;
      const control = computeHexControl(state, terrainData, perspectiveUnits, actorId, hex, cell);
      friendlyPower += control.friendly;
      enemyPower += control.enemy;
      friendlyHoldingPower += control.friendlyHolding;
      enemyHoldingPower += control.enemyHolding;
      const bucket = (zone.borderHexIds || []).includes(hex) ? borderCounts : interiorCounts;
      bucket[control.state] += 1;
    }
    const totalPower = Math.max(friendlyPower + enemyPower, 0.001);
    const controlShare = friendlyPower / totalPower;
    const enemyShare = enemyPower / totalPower;
    const meaningfulHoldingThreshold = Math.max(0.6, (zone.hexIds?.length || 1) * 0.08);
    zoneSnapshots[zone.zoneId] = {
      zoneId: zone.zoneId,
      side: actorId,
      state: classifyZoneState(controlShare, enemyShare, friendlyHoldingPower, enemyHoldingPower, meaningfulHoldingThreshold),
      tags: [],
      controlShare: roundMetric(controlShare),
      enemyShare: roundMetric(enemyShare),
      friendlyPower: roundMetric(friendlyPower),
      enemyPower: roundMetric(enemyPower),
      friendlyHoldingPower: roundMetric(friendlyHoldingPower),
      enemyHoldingPower: roundMetric(enemyHoldingPower),
      borderMix: normalizeMix(borderCounts),
      interiorMix: normalizeMix(interiorCounts),
      momentum: roundMetric(computeZoneMomentum(state, actorId, zone.zoneId)),
      supplyConnected: false,
      cutOffRisk: 0,
      salientRisk: 0,
      breakthroughOpportunity: 0,
      terrainOpportunity: 0,
      congestionRisk: 0,
      supportingZoneValue: 0,
      scoreBreakdown: {},
    };
  }

  const edgeSnapshots = {};
  for (const edge of zoneModel?.zoneEdges || []) {
    edgeSnapshots[edge.edgeId] = buildEdgeSnapshot(state, terrainData, actorId, edge, zoneSnapshots, perspectiveUnits);
  }

  const connectedZoneIds = computeConnectedZoneIds(state, actorId, zoneSnapshots);
  for (const zone of zoneModel?.zones || []) {
    const snapshot = zoneSnapshots[zone.zoneId];
    if (!snapshot) continue;
    snapshot.supplyConnected = connectedZoneIds.has(zone.zoneId);
    snapshot.terrainOpportunity = computeZoneTerrainOpportunity(state, actorId, zone, snapshot);
    snapshot.supportingZoneValue = computeSupportingZoneValue(zoneModel, zone, zoneSnapshots, edgeSnapshots);
    snapshot.congestionRisk = computeZoneCongestionRisk(zoneModel, zone.zoneId, edgeSnapshots);
    snapshot.cutOffRisk = roundMetric(computeCutOffRisk(snapshot));
    snapshot.salientRisk = roundMetric(computeSalientRisk(snapshot));
    snapshot.breakthroughOpportunity = roundMetric(computeBreakthroughOpportunity(snapshot, zone));
    snapshot.tags = determineZoneTags(snapshot);
    snapshot.scoreBreakdown = {
      vp: zone.totalVp,
      controlShare: snapshot.controlShare,
      terrainOpportunity: snapshot.terrainOpportunity,
      supportingZoneValue: snapshot.supportingZoneValue,
      congestionRisk: snapshot.congestionRisk,
      cutOffRisk: snapshot.cutOffRisk,
      salientRisk: snapshot.salientRisk,
      breakthroughOpportunity: snapshot.breakthroughOpportunity,
    };
  }

  return {
    zones: zoneSnapshots,
    edges: edgeSnapshots,
  };
}

function buildPerspectiveUnits(state, actorId, useTruth) {
  const liveUnits = (state.units || []).filter((unit) => unit.status !== "destroyed" && !unit.embarkedIn);
  const ownUnits = liveUnits.filter((unit) => unit.actor === actorId).map((unit) => ({
    ...unit,
    positionHex: resolveUnitHex(unit),
    certainty: 1,
    infoSource: "friendly",
  }));
  if (useTruth) {
    const enemyUnits = liveUnits.filter((unit) => unit.actor !== actorId).map((unit) => ({
      ...unit,
      positionHex: resolveUnitHex(unit),
      certainty: 1,
      infoSource: "truth",
    }));
    return [...ownUnits, ...enemyUnits];
  }

  const actorView = state.perceptionState?.[actorId] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  const knownEnemyIds = new Set([...(actorView.detectedUnits || []), ...(actorView.contactUnits || [])]);
  const enemies = [];
  for (const unit of liveUnits) {
    if (unit.actor === actorId) continue;
    if (knownEnemyIds.has(unit.id)) {
      enemies.push({
        ...unit,
        positionHex: resolveUnitHex(unit),
        certainty: actorView.detectedUnits?.includes(unit.id) ? 1 : 0.85,
        infoSource: actorView.detectedUnits?.includes(unit.id) ? "visible" : "contact",
      });
    }
  }
  for (const [unitId, memory] of Object.entries(actorView.lastKnown || {})) {
    if (knownEnemyIds.has(unitId) || !memory?.position) continue;
    const actual = liveUnits.find((unit) => unit.id === unitId);
    enemies.push({
      id: unitId,
      actor: actual?.actor || "enemy",
      type: memory.type || actual?.type || "infantry",
      strength: memory.strength ?? actual?.strength ?? 70,
      readiness: actual?.readiness ?? 70,
      morale: actual?.morale ?? 70,
      supply: actual?.supply ?? 70,
      ammo: actual?.ammo ?? 70,
      fuel: actual?.fuel ?? 70,
      movementType: actual?.movementType || "foot",
      modeState: { suppression: 0.1, moraleState: "ready" },
      positionHex: memory.position,
      certainty: 0.55,
      infoSource: "lastKnown",
    });
  }
  return [...ownUnits, ...enemies];
}

function computeHexControl(state, terrainData, perspectiveUnits, actorId, hex, cell) {
  const pos = parseUnitPosition(hex);
  let friendly = 0;
  let enemy = 0;
  let friendlyHolding = 0;
  let enemyHolding = 0;
  if (!pos) {
    return { friendly, enemy, friendlyHolding, enemyHolding, state: "neutral" };
  }
  for (const unit of perspectiveUnits) {
    const unitPos = resolvePerspectiveUnitPos(unit);
    if (!unitPos) continue;
    const reach = unitInfluenceRadius(unit, terrainData);
    const distance = hexDistance(pos.c, pos.r, unitPos.c, unitPos.r);
    if (distance > reach) continue;
    const effective = computeEffectivePower(unit, cell);
    const baseContribution = effective * ((reach + 1 - distance) / (reach + 1)) * (unit.certainty ?? 1);
    const holdingCapable = countsTowardRtsHexOccupation(unit);
    const controlContribution = baseContribution * (holdingCapable ? 1 : 0);
    if (unit.actor === actorId) {
      friendly += controlContribution;
      if (holdingCapable) friendlyHolding += baseContribution;
    } else {
      enemy += controlContribution;
      if (holdingCapable) enemyHolding += baseContribution;
    }
  }
  return {
    friendly: roundMetric(friendly),
    enemy: roundMetric(enemy),
    friendlyHolding: roundMetric(friendlyHolding),
    enemyHolding: roundMetric(enemyHolding),
    state: classifyControlState(friendly, enemy, friendlyHolding, enemyHolding),
  };
}

function buildEdgeSnapshot(state, terrainData, actorId, edge, zoneSnapshots, perspectiveUnits) {
  const laneSnapshots = (edge.laneIds || []).map((laneId) => {
    const lane = getLaneById(state.scenario?.zoneModel, laneId);
    if (!lane) return null;
    const lanePressure = computeLanePressure(state, actorId, lane);
    const adExposure = computeLaneAdExposure(terrainData, perspectiveUnits, actorId, lane);
    return {
      laneId,
      lanePressure,
      throughputScore: roundMetric(clamp((lane.throughputScore || 0.4) - lanePressure * 0.12 - adExposure * 0.15, 0.05, 1)),
      crossingRisk: lane.crossingRisk ?? lane.terrainEnvelope?.crossingRisk ?? 0,
      cover: lane.terrainEnvelope?.coverScore ?? 0.4,
      observation: roundMetric(((lane.terrainEnvelope?.elevationAdvantage || 0.4) + (lane.terrainEnvelope?.openFireLaneScore || 0.4)) / 2),
    };
  }).filter(Boolean);
  const averageLanePressure = laneSnapshots.length > 0
    ? laneSnapshots.reduce((sum, lane) => sum + lane.lanePressure, 0) / laneSnapshots.length
    : 0;
  const throughputScore = laneSnapshots.length > 0
    ? laneSnapshots.reduce((sum, lane) => sum + lane.throughputScore, 0) / laneSnapshots.length
    : roundMetric(clamp((edge.frontageWidthScore || 0.4) + (edge.terrainEnvelope?.roadAccess || 0) * 0.25 - (edge.congestionSensitivity || 0.2) * 0.1, 0.05, 1));
  const artilleryExposure = roundMetric(1 - (edge.terrainEnvelope?.artillerySafety || 0.5));
  const adExposure = laneSnapshots.length > 0
    ? roundMetric(laneSnapshots.reduce((sum, lane) => sum + computeLaneAdExposure(terrainData, perspectiveUnits, actorId, getLaneById(state.scenario?.zoneModel, lane.laneId)), 0) / laneSnapshots.length)
    : 0;
  const stateLabel = throughputScore < 0.28 || edge.crossingHexIds?.length > 0
    ? "choked"
    : averageLanePressure > 0.6
      ? "contested"
      : "open";
  return {
    edgeId: edge.edgeId,
    side: actorId,
    state: stateLabel,
    lanePressure: roundMetric(averageLanePressure),
    crossingRisk: roundMetric(edge.terrainEnvelope?.crossingRisk || 0),
    supportValue: roundMetric(edge.supportValue || 0),
    mobilityByType: edge.terrainEnvelope?.mobilityScoreByMovementType || {},
    coverProfile: roundMetric(((edge.terrainEnvelope?.coverScore || 0.5) + (edge.terrainEnvelope?.concealmentScore || 0.5)) / 2),
    observationProfile: roundMetric(((edge.terrainEnvelope?.elevationAdvantage || 0.5) + (edge.terrainEnvelope?.openFireLaneScore || 0.5)) / 2),
    artilleryExposure,
    adExposure,
    throughputScore: roundMetric(throughputScore),
    scoreBreakdown: {
      frontageWidthScore: edge.frontageWidthScore,
      congestionSensitivity: edge.congestionSensitivity,
      lanePressure: roundMetric(averageLanePressure),
      artilleryExposure,
      adExposure,
    },
  };
}

function buildTruthZoneLedger(state, truthBySide) {
  const ledger = {};
  for (const zone of state.scenario?.zoneModel?.zones || []) {
    const controlByActor = {};
    const stateByActor = {};
    for (const actor of state.scenario?.actors || []) {
      controlByActor[actor.id] = truthBySide?.[actor.id]?.[zone.zoneId]?.controlShare || 0;
      stateByActor[actor.id] = truthBySide?.[actor.id]?.[zone.zoneId]?.state || "neutral";
    }
    const ranked = Object.entries(controlByActor)
      .filter(([actorId]) => stateByActor[actorId] === "friendly")
      .sort((left, right) => right[1] - left[1]);
    ledger[zone.zoneId] = {
      zoneId: zone.zoneId,
      controller: ranked[0]?.[1] >= ZONE_CONTROL_THRESHOLD ? ranked[0][0] : null,
      controlByActor,
      stateByActor,
      totalVp: zone.totalVp,
      sourceVp: zone.sourceVp,
      sourceName: zone.sourceName,
    };
  }
  return ledger;
}

function buildTruthEdgeLedger(zoneModel, truthEdgeBySide) {
  const ledger = {};
  for (const edge of zoneModel?.zoneEdges || []) {
    const byActor = {};
    for (const actorId of Object.keys(truthEdgeBySide || {})) {
      byActor[actorId] = truthEdgeBySide[actorId]?.[edge.edgeId] || null;
    }
    ledger[edge.edgeId] = {
      edgeId: edge.edgeId,
      zoneA: edge.zoneA,
      zoneB: edge.zoneB,
      byActor,
    };
  }
  return ledger;
}

function computeConnectedZoneIds(state, actorId, zoneSnapshots) {
  const zoneModel = state.scenario?.zoneModel;
  const anchors = getZonesForActorAnchors(zoneModel, actorId);
  const queue = [...anchors];
  const visited = new Set(queue.filter((zoneId) => zoneSnapshots?.[zoneId]));
  while (queue.length > 0) {
    const zoneId = queue.shift();
    const neighbors = zoneModel?.zoneGraph?.[zoneId] || [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.zoneId)) continue;
      const snapshot = zoneSnapshots?.[neighbor.zoneId];
      if (!snapshot || !isZoneTransitable(snapshot)) continue;
      visited.add(neighbor.zoneId);
      queue.push(neighbor.zoneId);
    }
  }
  return visited;
}

function updateFrontlineDurations(state, actorId, truthZones) {
  const previous = state.frontlineState.perSide?.[actorId] || {};
  const next = {};
  for (const [zoneId, snapshot] of Object.entries(truthZones || {})) {
    const activeTag = snapshot.tags.includes("encircled")
      ? "encircled"
      : snapshot.tags.includes("salient")
        ? "salient"
        : snapshot.tags.includes("frontline")
          ? "frontline"
          : snapshot.tags.includes("transition")
            ? "transition"
            : snapshot.tags.includes("rear")
              ? "rear"
              : snapshot.state;
    const previousState = previous?.[zoneId];
    const sinceMs = previousState?.activeTag === activeTag ? (previousState?.sinceMs || state.game.elapsedMs || 0) : (state.game.elapsedMs || 0);
    next[zoneId] = {
      activeTag,
      sinceMs,
      durationMs: Math.max(0, (state.game.elapsedMs || 0) - sinceMs),
      supplyConnected: snapshot.supplyConnected,
      cutOffRisk: snapshot.cutOffRisk,
      salientRisk: snapshot.salientRisk,
    };
  }
  state.frontlineState.perSide[actorId] = next;
}

function determineZoneTags(snapshot) {
  const tags = [];
  const friendlyBorder = snapshot.borderMix?.friendly || 0;
  const enemyBorder = snapshot.borderMix?.enemy || 0;
  const contestedBorder = snapshot.borderMix?.contested || 0;
  if (snapshot.state === "friendly" && friendlyBorder >= 0.85) {
    tags.push("rear");
  } else if (snapshot.state === "friendly" && (enemyBorder + contestedBorder) >= 0.15 && (enemyBorder + contestedBorder) <= 0.5) {
    tags.push("transition");
  } else if (snapshot.state === "contested" || (enemyBorder + contestedBorder) > 0.5) {
    tags.push("frontline");
  }
  if (snapshot.supplyConnected && enemyBorder >= 0.6 && friendlyBorder <= 0.25) {
    tags.push("salient");
  }
  if (!snapshot.supplyConnected || (enemyBorder >= 0.75 && friendlyBorder <= 0.1)) {
    tags.push("encircled");
  }
  if ((snapshot.state === "contested" || snapshot.state === "friendly") && friendlyBorder >= 0.6 && (snapshot.interiorMix?.enemy || 0) > 0.1) {
    tags.push("breakthrough");
  }
  return tags;
}

function computeZoneMomentum(state, actorId, zoneId) {
  let momentum = 0;
  for (const unit of state.units || []) {
    if (unit.status === "destroyed" || unit.embarkedIn) continue;
    const currentZoneId = getZoneIdForHex(state.scenario?.zoneModel, resolveUnitHex(unit));
    const targetHex = unit.modeState?.currentCommand?.targetHex || null;
    const targetZoneId = targetHex ? getZoneIdForHex(state.scenario?.zoneModel, targetHex) : currentZoneId;
    if (currentZoneId === zoneId || targetZoneId === zoneId) {
      const direction = targetZoneId === zoneId && currentZoneId !== zoneId ? 0.12 : currentZoneId === zoneId && targetZoneId !== zoneId ? -0.08 : 0.04;
      momentum += unit.actor === actorId ? direction : -direction;
    }
  }
  return clamp(momentum, -1, 1);
}

function computeZoneTerrainOpportunity(state, actorId, zone, snapshot) {
  const terrain = zone.terrainEnvelope || {};
  const actorUnits = (state.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed" && !unit.embarkedIn);
  const composition = summarizeActorComposition(actorUnits);
  const mobilityFocus = Math.max(
    (terrain.mobilityScoreByMovementType?.tracked || 0) * composition.armor,
    (terrain.mobilityScoreByMovementType?.foot || 0) * composition.infantry,
    (terrain.mobilityScoreByMovementType?.wheeled || 0) * composition.support
  );
  return roundMetric(clamp(
    (terrain.coverScore || 0.4) * 0.18
    + (terrain.concealmentScore || 0.4) * 0.14
    + (terrain.elevationAdvantage || 0.4) * 0.18
    + (terrain.openFireLaneScore || 0.4) * 0.18
    + (terrain.roadAccess || 0.4) * 0.08
    + mobilityFocus * 0.14
    + ((snapshot.state === "contested" || snapshot.state === "enemy") ? 0.08 : 0),
    0,
    2
  ));
}

function computeSupportingZoneValue(zoneModel, zone, zoneSnapshots, edgeSnapshots) {
  let best = 0;
  for (const neighborId of zone.adjacentZoneIds || []) {
    const neighbor = getZoneById(zoneModel, neighborId);
    const neighborSnapshot = zoneSnapshots?.[neighborId];
    const edgeSnapshot = edgeSnapshots?.[[zone.zoneId, neighborId].sort().join("__")];
    if (!neighbor || !neighborSnapshot || !edgeSnapshot) continue;
    const value = ((zone.terrainEnvelope?.elevationAdvantage || 0.4) * 0.35
      + (zone.terrainEnvelope?.openFireLaneScore || 0.4) * 0.25
      + (edgeSnapshot.supportValue || 0) * 0.2
      + ((neighbor.totalVp || 0) / 30) * 0.2)
      * ((neighborSnapshot.state === "enemy" || neighborSnapshot.state === "contested") ? 1.15 : 0.75);
    best = Math.max(best, value);
  }
  return roundMetric(best);
}

function computeZoneCongestionRisk(zoneModel, zoneId, edgeSnapshots) {
  const zone = getZoneById(zoneModel, zoneId);
  const samples = (zone?.adjacentZoneIds || [])
    .map((neighborId) => edgeSnapshots?.[[zoneId, neighborId].sort().join("__")])
    .filter(Boolean);
  if (samples.length === 0) return 0;
  return roundMetric(samples.reduce((sum, edge) => sum + ((edge.lanePressure || 0) + (1 - (edge.throughputScore || 0.5))), 0) / (samples.length * 2));
}

function computeCutOffRisk(snapshot) {
  if (!snapshot.supplyConnected) return 1;
  return clamp((snapshot.borderMix?.enemy || 0) * 0.8 + (snapshot.congestionRisk || 0) * 0.2, 0, 1);
}

function computeSalientRisk(snapshot) {
  if (!snapshot.supplyConnected) return 1;
  return clamp((snapshot.borderMix?.enemy || 0) * 0.7 + (snapshot.borderMix?.contested || 0) * 0.2 + ((snapshot.borderMix?.friendly || 0) <= 0.25 ? 0.1 : 0), 0, 1);
}

function computeBreakthroughOpportunity(snapshot, zone) {
  return clamp(
    ((snapshot.borderMix?.friendly || 0) * 0.4)
    + ((snapshot.interiorMix?.enemy || 0) * 0.3)
    + ((zone.totalVp || 0) / 100) * 0.2
    + (snapshot.terrainOpportunity || 0) * 0.1,
    0,
    1.5
  );
}

function computeLanePressure(state, actorId, lane) {
  const laneHexes = new Set(lane?.laneHexIds || []);
  if (laneHexes.size === 0) return 0;
  let pressure = 0;
  for (const unit of state.units || []) {
    if (unit.actor !== actorId || unit.status === "destroyed" || unit.embarkedIn) continue;
    const settledHex = resolveUnitHex(unit);
    const targetHex = unit.modeState?.currentCommand?.targetHex || null;
    if (settledHex && laneHexes.has(settledHex)) pressure += 0.5;
    if (targetHex && laneHexes.has(targetHex)) pressure += 0.8;
    if (unit.modeState?.travelState?.route?.some((hex) => laneHexes.has(hex))) pressure += 0.9;
  }
  return roundMetric(clamp(pressure / Math.max(laneHexes.size / 2, 1), 0, 1.5));
}

function computeLaneAdExposure(terrainData, perspectiveUnits, actorId, lane) {
  const laneHexes = lane?.laneHexIds || [];
  if (laneHexes.length === 0) return 0;
  const enemyAirDefense = perspectiveUnits.filter((unit) => unit.actor !== actorId && unit.type === "air_defense");
  let exposure = 0;
  for (const unit of enemyAirDefense) {
    const pos = resolvePerspectiveUnitPos(unit);
    if (!pos) continue;
    for (const hex of laneHexes) {
      const hexPos = parseUnitPosition(hex);
      if (!hexPos) continue;
      const distance = hexDistance(pos.c, pos.r, hexPos.c, hexPos.r);
      if (distance <= 4) {
        exposure += (4 - distance + 1) * (unit.certainty ?? 1) * 0.08;
      }
    }
  }
  return roundMetric(clamp(exposure, 0, 1));
}

function classifyZoneState(controlShare, enemyShare, friendlyHoldingPower = 0, enemyHoldingPower = 0, meaningfulHoldingThreshold = 0.6) {
  const maxHoldingPower = Math.max(friendlyHoldingPower, enemyHoldingPower);
  if (maxHoldingPower < meaningfulHoldingThreshold) return "neutral";
  if (controlShare >= ZONE_CONTROL_THRESHOLD && enemyShare <= ZONE_CONTROL_MIN_FOOTHOLD && friendlyHoldingPower >= meaningfulHoldingThreshold) return "friendly";
  if (enemyShare >= ZONE_CONTROL_THRESHOLD && controlShare <= ZONE_CONTROL_MIN_FOOTHOLD && enemyHoldingPower >= meaningfulHoldingThreshold) return "enemy";
  if (controlShare >= ZONE_CONTESTED_MIN_SHARE && enemyShare >= ZONE_CONTESTED_MIN_SHARE && friendlyHoldingPower > 0 && enemyHoldingPower > 0) return "contested";
  return "neutral";
}

function classifyControlState(friendly, enemy, friendlyHolding = 0, enemyHolding = 0) {
  const total = Math.max(friendly + enemy, 0.001);
  const friendlyShare = friendly / total;
  const enemyShare = enemy / total;
  const holdingThreshold = 0.12;
  if (Math.max(friendlyHolding, enemyHolding) < holdingThreshold) return "neutral";
  if (friendlyShare >= 0.6 && enemyShare <= 0.15 && friendlyHolding >= holdingThreshold) return "friendly";
  if (enemyShare >= 0.6 && friendlyShare <= 0.15 && enemyHolding >= holdingThreshold) return "enemy";
  if (friendlyShare >= 0.25 && enemyShare >= 0.25 && friendlyHolding > 0 && enemyHolding > 0) return "contested";
  return "neutral";
}

function normalizeMix(counts) {
  const total = Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
  if (!total) {
    return { friendly: 0, enemy: 0, contested: 0, neutral: 1 };
  }
  return {
    friendly: roundMetric((counts.friendly || 0) / total),
    enemy: roundMetric((counts.enemy || 0) / total),
    contested: roundMetric((counts.contested || 0) / total),
    neutral: roundMetric((counts.neutral || 0) / total),
  };
}

function isZoneTransitable(snapshot) {
  return snapshot.state !== "enemy" || snapshot.controlShare > 0.32;
}

function summarizeActorComposition(units) {
  const totals = { infantry: 0, armor: 0, support: 0 };
  for (const unit of units || []) {
    if (["infantry", "engineer", "special_forces", "airborne", "anti_tank"].includes(unit.type)) totals.infantry += 1;
    else if (["armor", "mechanized", "armored_infantry", "mechanized_infantry", "tank_destroyer"].includes(unit.type)) totals.armor += 1;
    else totals.support += 1;
  }
  const sum = Math.max(totals.infantry + totals.armor + totals.support, 1);
  return {
    infantry: totals.infantry / sum,
    armor: totals.armor / sum,
    support: totals.support / sum,
  };
}

function resolvePerspectiveUnitPos(unit) {
  if (typeof unit.positionHex === "string") {
    return parseUnitPosition(unit.positionHex);
  }
  return parseUnitPosition(resolveUnitHex(unit));
}

function resolveUnitHex(unit) {
  return unit?.modeState?.settledHex || unit?.position || "";
}

function unitInfluenceRadius(unit, terrainData) {
  const cellKm = Math.max(terrainData?.cellSizeKm || 1, 0.25);
  const km = unit.weaponRangeKm?.effective || TYPE_RANGE_KM[unit.type] || 2;
  return clamp(Math.round(km / cellKm), 1, 4);
}

function computeEffectivePower(unit, cell) {
  const basePower = TYPE_POWER[unit.type] || 1;
  const strengthFactor = clamp((unit.strength ?? 100) / 100, 0.15, 1);
  const readinessFactor = clamp((unit.readiness ?? 100) / 100, 0.2, 1);
  const moraleFactor = clamp((unit.morale ?? 100) / 100, 0.2, 1);
  const supplyFactor = clamp((unit.supply ?? 100) / 100, 0.2, 1);
  const ammoFactor = clamp((unit.ammo ?? 100) / 100, 0.15, 1);
  const fatigue = clamp((unit.modeState?.fatigue ?? unit.fatigue ?? 0) / 100, 0, 1);
  const fatigueFactor = clamp(1 - fatigue * 0.45, 0.45, 1);
  const suppressionFactor = clamp(1 - ((unit.modeState?.suppression || 0) * 0.6), 0.18, 1);
  const postureFactor = posturePowerFactor(unit.posture || unit.modeState?.moraleState || "ready");
  const terrainFactor = terrainFitFactorForUnit(unit, cell);
  return basePower
    * strengthFactor
    * readinessFactor
    * moraleFactor
    * supplyFactor
    * ammoFactor
    * fatigueFactor
    * suppressionFactor
    * postureFactor
    * terrainFactor;
}

function posturePowerFactor(posture) {
  if (posture === "retreating" || posture === "routing") return 0.45;
  if (posture === "reserve") return 0.78;
  if (posture === "moving") return 0.84;
  if (posture === "defending" || posture === "dug_in") return 1.08;
  return 1;
}

function terrainFitFactorForUnit(unit, cell) {
  if (!cell) return 1;
  const category = terrainCategoryForCell(cell);
  if (isHelicopter(unit)) {
    return clamp(1 + ((cell.features || []).includes("airfield") ? 0.08 : 0), 0.9, 1.1);
  }
  const infantryTypes = new Set(["infantry", "engineer", "special_forces", "airborne", "anti_tank", "recon", "parachute_infantry", "glider_infantry"]);
  const armorTypes = new Set(["armor", "mechanized", "armored_infantry", "mechanized_infantry", "tank_destroyer"]);
  let modifier = 0;
  if (infantryTypes.has(unit.type)) {
    if (category === "urban" || category === "forest") modifier += 0.14;
    if (category === "rough") modifier += 0.08;
    if (category === "open") modifier -= 0.04;
  } else if (armorTypes.has(unit.type)) {
    if (category === "open") modifier += 0.12;
    if (category === "urban") modifier -= 0.12;
    if (category === "forest" || category === "wet") modifier -= 0.16;
  } else if (unit.type === "artillery" || unit.type === "air_defense") {
    if (category === "open") modifier += 0.04;
    if (category === "urban") modifier -= 0.06;
  }
  return clamp(1 + modifier, 0.62, 1.22);
}

function initializeUnitModeState(unit) {
  unit.modeState = unit.modeState || {};
  unit.modeState.settledHex = unit.modeState.settledHex || unit.position || "";
  unit.modeState.travelState = unit.modeState.travelState || null;
  normalizeTravelStateTiming(unit.modeState.travelState);
  unit.modeState.currentCommand = unit.modeState.currentCommand || null;
  unit.modeState.commandQueue = Array.isArray(unit.modeState.commandQueue) ? unit.modeState.commandQueue : [];
  unit.modeState.suppression = unit.modeState.suppression ?? 0;
  unit.modeState.fatigue = unit.modeState.fatigue ?? unit.fatigue ?? 0;
  unit.modeState.moraleState = unit.modeState.moraleState || "ready";
  unit.modeState.weaponCooldownMs = unit.modeState.weaponCooldownMs ?? 0;
  unit.modeState.lastCombatEvent = unit.modeState.lastCombatEvent || null;
  unit.modeState.retreatState = unit.modeState.retreatState || null;
  unit.modeState.shatterState = unit.modeState.shatterState || null;
  unit.modeState.recoveryState = unit.modeState.recoveryState || null;
  unit.modeState.reserveState = unit.modeState.reserveState || unit.initialReserveState || (unit.posture === "reserve" ? "held" : null);
  unit.modeState.releaseAtMs = unit.modeState.releaseAtMs ?? (Math.max(0, Number.parseInt(String(unit.releaseDelaySeconds || 0), 10) || 0) * 1000);
  unit.modeState.routeProvenance = unit.modeState.routeProvenance || null;
  unit.modeState.currentTaskSource = unit.modeState.currentTaskSource || null;
  unit.modeState.assignedTaskId = unit.modeState.assignedTaskId || null;
  unit.modeState.fireMissionAmmoType = unit.modeState.fireMissionAmmoType || null;
  unit.modeState.fireMissionZoneId = unit.modeState.fireMissionZoneId || null;
  unit.modeState.fireMissionTargetHex = unit.modeState.fireMissionTargetHex || null;
  unit.modeState.lastDecision = unit.modeState.lastDecision || null;
  unit.visibleTo = Array.isArray(unit.visibleTo) ? unit.visibleTo : [];
  unit.lastKnownBy = unit.lastKnownBy || {};
}

function normalizeTravelStateTiming(travelState) {
  if (!travelState) return;
  const previousScale = Math.max(0.1, Number(travelState.movementTimeScale || travelState.segmentScale || 1));
  const rawSegmentMs = Math.max(1, Number(travelState.segmentMs || 0) || 1);
  const progressRatio = clamp((travelState.progressMs || 0) / rawSegmentMs, 0, 1);
  const scaledSegmentMs = Math.max(
    350 * RTS_MOVEMENT_TIME_SCALE,
    Math.round(rawSegmentMs * (RTS_MOVEMENT_TIME_SCALE / previousScale))
  );
  travelState.segmentMs = scaledSegmentMs;
  travelState.progressMs = Math.round(progressRatio * scaledSegmentMs);
  travelState.movementTimeScale = RTS_MOVEMENT_TIME_SCALE;
  travelState.segmentScale = RTS_MOVEMENT_TIME_SCALE;
}

function cloneMatch(state) {
  if (typeof structuredClone === "function") {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

function formatCommandLabel(kind) {
  return kind.replace(/_/g, " ");
}

function assignImmediateCommand(state, unit, terrainData, command) {
  unit.modeState.currentCommand = command;
  unit.modeState.commandIssuedAtMs = command.issuedAtMs;
  state.truthState.commandLog.push({
    atMs: state.game.elapsedMs || 0,
    source: command.source || "player",
    unitId: unit.id,
    command: {
      id: command.id,
      kind: command.kind,
      issuedAtMs: command.issuedAtMs,
      targetHex: command.targetHex || null,
      targetUnitId: command.targetUnitId || null,
      waypoints: Array.isArray(command.waypoints) ? [...command.waypoints] : [],
      queueSlot: command.queueSlot || 0,
    },
  });
  trimArray(state.truthState.commandLog, getMaxReplayEvents(state));
  if (command.kind === "hold" || command.kind === "halt") {
    unit.modeState.travelState = null;
  } else if (command.kind === "withdraw") {
    unit.posture = "retreating";
  } else if (command.kind === "embark_helo" || command.kind === "disembark_helo") {
    unit.modeState.travelState = null;
  } else if (command.targetHex) {
    const planned = planRoute(state, unit, terrainData, command.targetHex);
    unit.modeState.travelState = planned;
    unit.modeState.routeProvenance = planned
      ? {
          planner: planned.planner || "weighted",
          threatAware: Boolean(planned.threatAware),
          waypointCount: Math.max(0, (planned.route?.length || 1) - 1),
          targetHex: command.targetHex,
        }
      : null;
  }
  pushEvent(state, "command", `${unit.name} received ${formatCommandLabel(command.kind)}.`, { unitId: unit.id, command });
}

function planRoute(state, unit, terrainData, targetHex) {
  const start = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  const goal = parseUnitPosition(targetHex);
  if (!start || !goal) return null;

  let path = null;
  let planner = "weighted";
  let threatAware = false;
  if (isHelicopter(unit)) {
    const actorView = state?.perceptionState?.[unit.actor];
    const knownThreatIds = actorView
      ? new Set([...(actorView.detectedUnits || []), ...(actorView.contactUnits || [])])
      : null;
    const knownAdUnits = (state?.units || []).filter((candidate) =>
      candidate.actor !== unit.actor
      && candidate.status !== "destroyed"
      && candidate.type === "air_defense"
      && (!knownThreatIds || knownThreatIds.has(candidate.id))
    );
    const threatMap = knownAdUnits.length > 0
      ? buildThreatMap(unit.actor, state, terrainData, knownAdUnits, { dangerTolerance: 0.05 })
      : null;
    threatAware = Boolean(threatMap);
    path = findWeightedPath(
      { col: start.c, row: start.r },
      { col: goal.c, row: goal.r },
      terrainData,
      unit.movementType || "helicopter",
      {
        terrainPreferences: {},
        threatPenalty: 3.2,
        dangerTolerance: 0.05,
      },
      threatMap
    );
    if (!path) {
      planner = "straight_line";
      path = hexLine(start.c, start.r, goal.c, goal.r).map(({ col, row }) => ({ col, row }));
    }
  } else {
    path = findWeightedPath(
      { col: start.c, row: start.r },
      { col: goal.c, row: goal.r },
      terrainData,
      unit.movementType || "foot",
      { terrainPreferences: {}, threatPenalty: 0.35, dangerTolerance: 0.45 },
      null
    );
    if (!path) {
      planner = "straight_line";
      path = hexLine(start.c, start.r, goal.c, goal.r).map(({ col, row }) => ({ col, row }));
    }
  }

  if (!Array.isArray(path) || path.length < 2) return null;
  return {
    route: path.map((step) => cellToPositionString(step.col, step.row)),
    routeIndex: 1,
    progressMs: 0,
    segmentMs: computeSegmentMs(unit, terrainData, path[0], path[1]),
    movementTimeScale: RTS_MOVEMENT_TIME_SCALE,
    segmentScale: RTS_MOVEMENT_TIME_SCALE,
    planner,
    threatAware,
  };
}

function advanceMovement(state, terrainData, phaseIndex = null) {
  const proposals = [];
  const currentOccupancy = cloneOccupancy(state.occupancy || {});
  const tickMs = state.game.tickMs || 250;

  for (const unit of state.units || []) {
    initializeUnitModeState(unit);
    tickCooldown(unit, tickMs);
    maybeProcessEmbarkDisembark(state, currentOccupancy, unit);
    const command = unit.modeState.currentCommand;
    const travel = unit.modeState.travelState;
    if (!command || !travel) continue;
    if (unit.status === "destroyed") continue;
    const moraleState = unit.modeState.moraleState;
    const haltedByMorale = moraleState === "shattered"
      || moraleState === "retreating"
      || (moraleState === "suppressed" && !isHelicopter(unit));
    if (haltedByMorale) continue;

    travel.progressMs += tickMs;
    if (travel.progressMs < travel.segmentMs) continue;
    const fromHex = travel.route[travel.routeIndex - 1];
    const toHex = travel.route[travel.routeIndex];
    proposals.push({
      unitId: unit.id,
      fromHex,
      toHex,
      issuedAtMs: command.issuedAtMs || 0,
      kind: command.kind,
    });
  }

  proposals.sort((a, b) => (a.issuedAtMs - b.issuedAtMs) || a.unitId.localeCompare(b.unitId));

  for (const proposal of proposals) {
    const unit = getIndexedUnit(proposal.unitId, phaseIndex) || state.units.find((candidate) => candidate.id === proposal.unitId);
    if (!unit || !unit.modeState.travelState) continue;
    const entry = classifyHexEntry(state, currentOccupancy, proposal.toHex, unit);

    if (!entry.allowed) {
      const targetUnit = entry.blockerId
        ? (getIndexedUnit(entry.blockerId, phaseIndex) || state.units.find((candidate) => candidate.id === entry.blockerId))
        : null;
      if (entry.reason === "enemy" && targetUnit && ["attack_move", "assault", "screen"].includes(proposal.kind)) {
        unit.modeState.travelState = null;
        unit.modeState.currentCommand = { ...unit.modeState.currentCommand, blockedBy: entry.blockerId };
        pushEvent(state, "movement", `${unit.name} halted short of ${targetUnit.name}.`, { unitId: unit.id, targetUnitId: entry.blockerId });
      } else {
        unit.modeState.travelState = null;
        unit.modeState.currentCommand = null;
        const message = entry.reason === "capacity"
          ? `${unit.name} could not enter ${proposal.toHex}; the stack limit is ${getMaxStackPerHex(state)} units.`
          : `${unit.name} could not enter an occupied hex.`;
        pushEvent(state, "movement", message, { unitId: unit.id, targetHex: proposal.toHex, blockerId: entry.blockerId });
        maybeStartQueuedCommand(state, unit, terrainData);
      }
      continue;
    }

    if (countsTowardRtsHexOccupation(unit)) {
      removeOccupantFromHex(currentOccupancy, proposal.fromHex, unit.id);
      addOccupantToHex(currentOccupancy, proposal.toHex, unit.id);
    }
    unit.position = proposal.toHex;
    unit.modeState.settledHex = proposal.toHex;
    if (isHelicopter(unit)) {
      for (const passenger of state.units || []) {
        if (passenger.embarkedIn !== unit.id) continue;
        passenger.position = proposal.toHex;
        passenger.modeState.settledHex = proposal.toHex;
      }
    }
    unit.modeState.travelState.progressMs = 0;
    unit.modeState.travelState.routeIndex += 1;
    unit.posture = proposal.kind === "withdraw" ? "retreating" : "moving";
    drainMovementResources(unit, terrainData);

    const route = unit.modeState.travelState.route;
    if (unit.modeState.travelState.routeIndex >= route.length) {
      unit.modeState.travelState = null;
      if (unit.modeState.currentCommand?.kind === "hold" || unit.modeState.currentCommand?.kind === "halt") {
        unit.posture = "defending";
      } else if (unit.posture !== "retreating") {
        unit.posture = "ready";
      }
      unit.modeState.currentCommand = null;
      maybeStartQueuedCommand(state, unit, terrainData);
    } else {
      const from = parseUnitPosition(route[unit.modeState.travelState.routeIndex - 1]);
      const to = parseUnitPosition(route[unit.modeState.travelState.routeIndex]);
      unit.modeState.travelState.segmentMs = computeSegmentMs(unit, terrainData, from, to);
      unit.modeState.travelState.movementTimeScale = RTS_MOVEMENT_TIME_SCALE;
      unit.modeState.travelState.segmentScale = RTS_MOVEMENT_TIME_SCALE;
    }
  }

  state.occupancy = currentOccupancy;
}

function maybeProcessEmbarkDisembark(state, occupancy, unit) {
  const command = unit.modeState.currentCommand;
  if (!command) return;

  if (command.kind === "embark_helo") {
    const transport = state.units.find((candidate) => candidate.id === command.targetUnitId);
    if (!transport || !isTransportHelicopter(transport)) {
      unit.modeState.currentCommand = null;
      return;
    }
    const unitHex = parseUnitPosition(unit.modeState.settledHex || unit.position);
    const transportHex = parseUnitPosition(transport.modeState?.settledHex || transport.position);
    if (!unitHex || !transportHex || unit.actor !== transport.actor) return;
    if (hexDistance(unitHex.c, unitHex.r, transportHex.c, transportHex.r) <= 1 && isFootMobile(unit)) {
      const embarkHex = unit.modeState.settledHex || unit.position;
      unit.embarkedIn = transport.id;
      unit.position = transport.position;
      unit.modeState.settledHex = transport.modeState?.settledHex || transport.position;
      unit.modeState.currentCommand = null;
      unit.modeState.travelState = null;
      if (embarkHex && countsTowardRtsHexOccupation(unit)) removeOccupantFromHex(occupancy, embarkHex, unit.id);
      pushEvent(state, "logistics", `${unit.name} embarked aboard ${transport.name}.`, { unitId: unit.id, transportId: transport.id });
    }
    return;
  }

  if (command.kind === "disembark_helo" && isHelicopter(unit)) {
    const embarkedUnits = (state.units || []).filter((candidate) => candidate.embarkedIn === unit.id);
    if (embarkedUnits.length === 0 || !command.targetHex) {
      unit.modeState.currentCommand = null;
      return;
    }
    const target = parseUnitPosition(command.targetHex);
    const transportPos = parseUnitPosition(unit.modeState.settledHex || unit.position);
    if (!target || !transportPos) return;
    if (hexDistance(target.c, target.r, transportPos.c, transportPos.r) > 1) return;
    const occupantIds = getOccupantsAtHex(occupancy, command.targetHex);
    const occupantUnits = occupantIds
      .map((occupantId) => (state.units || []).find((candidate) => candidate.id === occupantId))
      .filter(Boolean);
    const countedEmbarkedUnits = embarkedUnits.filter((passenger) => countsTowardRtsHexOccupation({ ...passenger, embarkedIn: null }));
    if (occupantUnits.some((occupant) => occupant.actor !== unit.actor)) return;
    if ((occupantIds.length + countedEmbarkedUnits.length) > getMaxStackPerHex(state)) return;
    for (const passenger of embarkedUnits) {
      passenger.embarkedIn = null;
      passenger.position = command.targetHex;
      passenger.modeState.settledHex = command.targetHex;
      passenger.modeState.currentCommand = null;
      passenger.modeState.travelState = null;
      passenger.posture = "ready";
      if (countsTowardRtsHexOccupation(passenger)) addOccupantToHex(occupancy, command.targetHex, passenger.id);
    }
    unit.modeState.currentCommand = null;
    pushEvent(state, "logistics", `${unit.name} disembarked troops at ${command.targetHex}.`, { unitId: unit.id });
  }
}

function recomputeOccupancy(state) {
  const occupancy = {};
  for (const unit of state.units || []) {
    if (unit.status === "destroyed" || !countsTowardRtsHexOccupation(unit)) continue;
    const settled = unit.modeState?.settledHex || unit.position;
    if (settled) addOccupantToHex(occupancy, settled, unit.id);
  }
  state.occupancy = occupancy;
  state.truthState.occupancy = cloneOccupancy(occupancy);
}

function getAreaEffectCenter(effect) {
  return parseUnitPosition(effect?.centerHex || effect?.targetHex || "");
}

function isPositionInAreaEffect(effect, position) {
  const center = getAreaEffectCenter(effect);
  if (!center || !position) return false;
  return hexDistance(center.c, center.r, Math.round(position.c), Math.round(position.r)) <= (effect?.radius || 0);
}

function getActiveAreaEffects(state, kind = null, actorId = null) {
  return (state.combat?.areaEffects || []).filter((effect) => {
    if (kind && effect?.kind !== kind) return false;
    if (actorId && effect?.actorId !== actorId) return false;
    return true;
  });
}

function doesSmokeBlockLos(state, fromPos, toPos) {
  const smokeEffects = getActiveAreaEffects(state, "smoke");
  if (smokeEffects.length === 0) return false;
  const line = hexLine(
    Math.round(fromPos.c),
    Math.round(fromPos.r),
    Math.round(toPos.c),
    Math.round(toPos.r)
  );
  return smokeEffects.some((effect) => {
    const center = getAreaEffectCenter(effect);
    if (!center) return false;
    return line.some((cell) => hexDistance(cell.col, cell.row, center.c, center.r) <= (effect.radius || 0));
  });
}

function computeLosWithAreaEffects(state, fromPos, toPos, terrainData) {
  if (!fromPos || !toPos) return { result: "BLOCKED", reason: "invalid" };
  if (doesSmokeBlockLos(state, fromPos, toPos)) {
    return { result: "BLOCKED", reason: "smoke" };
  }
  return computeEnhancedLOS(
    Math.round(fromPos.c),
    Math.round(fromPos.r),
    Math.round(toPos.c),
    Math.round(toPos.r),
    terrainData,
    LOS_TERRAIN_EFFECTS,
    CANOPY_HEIGHTS
  );
}

function getDetectionRadiusAgainstTarget(unit, environment, state, target) {
  const base = detectionRadius(unit, environment);
  const targetPos = getUnitDisplayPosition(target);
  if (!targetPos) return base;
  const illumBonus = getActiveAreaEffects(state, "illuminate", unit.actor).some((effect) => isPositionInAreaEffect(effect, targetPos));
  return illumBonus ? Math.max(2, Math.round(base * ILLUMINATION_DETECTION_MULT)) : base;
}

function isUnitsInCurrentEngagement(left, right, nowMs) {
  const leftEvent = left?.modeState?.lastCombatEvent;
  const rightEvent = right?.modeState?.lastCombatEvent;
  const leftRecent = leftEvent && leftEvent.from === right?.id && (nowMs - (leftEvent.atMs || 0)) <= UNDER_FIRE_WINDOW_MS;
  const rightRecent = rightEvent && rightEvent.from === left?.id && (nowMs - (rightEvent.atMs || 0)) <= UNDER_FIRE_WINDOW_MS;
  return Boolean(leftRecent || rightRecent);
}

function seedSpotterPoolFromMemory(state, actorId) {
  const nowMs = state.game.elapsedMs || 0;
  const previous = state.combat?.spotterPool?.[actorId] || {};
  const next = {};
  for (const [enemyId, record] of Object.entries(previous)) {
    const lastConfirmedAtMs = record?.lastConfirmedAtMs || 0;
    const ageMs = Math.max(0, nowMs - lastConfirmedAtMs);
    if (ageMs > FIRE_MISSION_EXPIRY_MS) continue;
    next[enemyId] = {
      ...record,
      quality: ageMs > FIRE_MISSION_DECAY_MS ? "decaying" : "observed",
      expiresAtMs: lastConfirmedAtMs + FIRE_MISSION_EXPIRY_MS,
    };
  }
  return next;
}

function mergeSpotterRecord(existing, candidate) {
  if (!existing) return candidate;
  const rank = { decaying: 0, observed: 1, direct: 2 };
  const candidateStronger = (rank[candidate?.quality] || 0) >= (rank[existing?.quality] || 0);
  return {
    ...existing,
    ...candidate,
    firstSeenAtMs: Math.min(existing?.firstSeenAtMs ?? candidate.firstSeenAtMs, candidate.firstSeenAtMs),
    spotterId: candidateStronger ? candidate.spotterId : existing?.spotterId,
    spotterType: candidateStronger ? candidate.spotterType : existing?.spotterType,
    quality: candidateStronger ? candidate.quality : existing?.quality,
    targetHex: candidate.targetHex || existing?.targetHex || null,
    zoneId: candidate.zoneId || existing?.zoneId || null,
    lastConfirmedAtMs: Math.max(existing?.lastConfirmedAtMs || 0, candidate.lastConfirmedAtMs || 0),
    expiresAtMs: Math.max(existing?.expiresAtMs || 0, candidate.expiresAtMs || 0),
  };
}

function computePerception(state, terrainData, phaseIndex = null) {
  const serialized = {};
  const runtime = {};
  const serializedSpotterPool = {};
  const nowMs = state.game.elapsedMs || 0;
  for (const actor of state.scenario?.actors || []) {
    const visibleCells = new Set();
    const detectedUnits = new Set();
    const contactUnits = new Set();
    const spotterPool = seedSpotterPoolFromMemory(state, actor.id);
    const lastKnown = Object.fromEntries(
      Object.entries(state.perceptionState?.[actor.id]?.lastKnown || {}).filter(([, memory]) =>
        (nowMs - (memory?.seenAtMs || 0)) <= LAST_KNOWN_DECAY_MS
      )
    );
    const friendlies = phaseIndex?.liveUnitsByActor?.[actor.id]
      || (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed" && !unit.embarkedIn);
    const enemies = phaseIndex?.enemyUnitsByActor?.[actor.id]
      || (state.units || []).filter((unit) => unit.actor !== actor.id && unit.status !== "destroyed" && !unit.embarkedIn);

    for (const friendly of friendlies) {
      const origin = getIndexedDisplayPosition(friendly, phaseIndex) || getUnitDisplayPosition(friendly);
      if (!origin) continue;
      const radius = detectionRadius(friendly, state.environment);
      for (const cell of hexRange(Math.round(origin.c), Math.round(origin.r), radius)) {
        visibleCells.add(cellToPositionString(cell.col, cell.row));
      }

      const maxCandidateRadius = Math.max(
        2,
        Math.round(radius * ILLUMINATION_DETECTION_MULT)
      ) + 1;
      const candidateEnemies = phaseIndex
        ? collectSpatialCandidateUnits(
          phaseIndex,
          origin,
          maxCandidateRadius,
          (enemy) => enemy.actor !== actor.id
        )
        : enemies;

      for (const enemy of candidateEnemies) {
        const enemyPos = getIndexedDisplayPosition(enemy, phaseIndex) || getUnitDisplayPosition(enemy);
        if (!enemyPos) continue;
        const detectionRadiusForEnemy = getDetectionRadiusAgainstTarget(friendly, state.environment, state, enemy);
        const distance = estimateHexDistance(origin, enemyPos);
        const contactRadius = detectionRadiusForEnemy + (enemy.modeState?.travelState ? 1 : 0);
        if (distance > contactRadius) continue;
        const los = computeLosWithAreaEffects(state, origin, enemyPos, terrainData);
        const enemyHex = cellToPositionString(Math.round(enemyPos.c), Math.round(enemyPos.r));
        const directContact = distance <= 1 || isUnitsInCurrentEngagement(friendly, enemy, nowMs);
        if (directContact) {
          detectedUnits.add(enemy.id);
          contactUnits.add(enemy.id);
          lastKnown[enemy.id] = {
            position: enemyHex,
            seenAtMs: nowMs,
            type: enemy.type,
            strength: enemy.strength,
          };
          spotterPool[enemy.id] = mergeSpotterRecord(spotterPool[enemy.id], {
            firstSeenAtMs: spotterPool[enemy.id]?.firstSeenAtMs || nowMs,
            lastConfirmedAtMs: nowMs,
            expiresAtMs: nowMs + FIRE_MISSION_EXPIRY_MS,
            quality: "direct",
            spotterId: friendly.id,
            spotterType: friendly.type,
            targetHex: enemyHex,
            zoneId: getZoneIdForHex(state.scenario?.zoneModel, enemyHex),
          });
        } else if (distance <= detectionRadiusForEnemy && los.result === "CLEAR") {
          detectedUnits.add(enemy.id);
          lastKnown[enemy.id] = {
            position: enemyHex,
            seenAtMs: nowMs,
            type: enemy.type,
            strength: enemy.strength,
          };
          if (isSpotterCapableUnit(friendly)) {
            spotterPool[enemy.id] = mergeSpotterRecord(spotterPool[enemy.id], {
              firstSeenAtMs: spotterPool[enemy.id]?.firstSeenAtMs || nowMs,
              lastConfirmedAtMs: nowMs,
              expiresAtMs: nowMs + FIRE_MISSION_EXPIRY_MS,
              quality: "observed",
              spotterId: friendly.id,
              spotterType: friendly.type,
              targetHex: enemyHex,
              zoneId: getZoneIdForHex(state.scenario?.zoneModel, enemyHex),
            });
          }
        } else if (distance <= contactRadius && los.result !== "BLOCKED") {
          contactUnits.add(enemy.id);
          lastKnown[enemy.id] = {
            position: enemyHex,
            seenAtMs: nowMs,
            type: enemy.type,
            strength: enemy.strength,
          };
        }
      }
    }

    runtime[actor.id] = {
      visibleCells,
      detectedUnits,
      contactUnits,
      lastKnown,
    };
    serializedSpotterPool[actor.id] = spotterPool;
    serialized[actor.id] = {
      visibleCells: Array.from(visibleCells),
      detectedUnits: Array.from(detectedUnits),
      contactUnits: Array.from(contactUnits),
      lastKnown,
    };
  }

  state.combat.spotterPool = serializedSpotterPool;

  for (const unit of state.units || []) {
    unit.visibleTo = [];
    unit.lastKnownBy = unit.lastKnownBy || {};
    for (const actorId of Object.keys(runtime)) {
      if (runtime[actorId].detectedUnits.has(unit.id) || unit.actor === actorId) {
        unit.visibleTo.push(actorId);
      } else if (runtime[actorId].lastKnown[unit.id]) {
        unit.lastKnownBy[actorId] = runtime[actorId].lastKnown[unit.id];
      }
    }
  }

  return { serialized, runtime };
}

function resolveCombat(state, terrainData, runtimePerception, phaseIndex = null) {
  const currentMs = state.game.elapsedMs;
  const directFireEvents = [];
  const destroyedUnits = new Set();

  for (const impact of [...state.combat.pendingImpacts]) {
    if (impact.impactAtMs > currentMs) continue;
    applyImpact(state, impact);
  }
  state.combat.pendingImpacts = state.combat.pendingImpacts.filter((impact) => impact.impactAtMs > currentMs);

  for (const unit of state.units || []) {
    if (unit.status === "destroyed" || unit.embarkedIn) continue;
    if ((unit.modeState.weaponCooldownMs || 0) > 0) continue;
    if (unit.modeState.moraleState === "shattered") continue;
    if ((unit.ammo ?? 100) <= 0 || (unit.readiness ?? 100) <= 0) continue;
    if (unit.type === "artillery" && !isArtilleryEmplaced(unit)) continue;

    const actorView = runtimePerception[unit.actor];
    const target = selectCombatTarget(state, unit, state.units || [], actorView, terrainData, state.scenario?.zoneModel, phaseIndex);
    if (!target) continue;

    if (unit.type === "artillery") {
      queueArtilleryImpact(state, unit, target);
      continue;
    }

    const attack = performDirectFire(state, unit, target.enemy, terrainData);
    if (!attack) continue;
    directFireEvents.push(attack.message);
    if (target.enemy?.strength <= 0) {
      destroyedUnits.add(target.enemy.id);
    }
  }

  for (const unit of state.units || []) {
    if (destroyedUnits.has(unit.id)) {
      markDestroyed(state, unit);
    }
  }

  state.combat.lastEvents = directFireEvents.slice(-10);
}

function updateMoraleAndResources(state, terrainData) {
  for (const unit of state.units || []) {
    if (unit.status === "destroyed") continue;
    const nearbySupport = findNearbySupport(unit, state.units || []);
    const inCombat = isUnderFire(unit, state.game.elapsedMs);
    const previousMoraleState = unit.modeState.moraleState || "ready";
    const zoneEffects = getZoneOperationalEffects(state, unit);

    unit.modeState.suppression = clamp((unit.modeState.suppression || 0) - ((nearbySupport ? 0.0125 : 0.00625) * zoneEffects.suppressionRecoveryFactor), 0, 1.5);
    unit.modeState.fatigue = clamp((unit.modeState.fatigue || 0) + (unit.modeState.travelState ? 0.2 : inCombat ? 0.1 : -0.05), 0, 100);
    unit.fatigue = Math.round(unit.modeState.fatigue);

    if (!inCombat && nearbySupport) {
      unit.supply = clamp((unit.supply ?? 100) + (0.125 * zoneEffects.readinessRecoveryFactor) - zoneEffects.supplyDrainPerTick, 0, 100);
      unit.ammo = clamp((unit.ammo ?? 100) + (0.08 * zoneEffects.readinessRecoveryFactor), 0, 100);
      unit.fuel = clamp((unit.fuel ?? 100) + (0.1 * zoneEffects.readinessRecoveryFactor), 0, 100);
      unit.readiness = clamp((unit.readiness ?? 100) + (0.09 * zoneEffects.readinessRecoveryFactor), 0, 100);
    } else if (!inCombat) {
      unit.readiness = clamp((unit.readiness ?? 100) + (0.03 * zoneEffects.readinessRecoveryFactor), 0, 100);
      unit.supply = clamp((unit.supply ?? 100) - zoneEffects.supplyDrainPerTick, 0, 100);
    } else {
      unit.supply = clamp((unit.supply ?? 100) - zoneEffects.supplyDrainPerTick, 0, 100);
      unit.morale = clamp((unit.morale ?? 100) - zoneEffects.combatStressPerTick, 0, 100);
    }

    if ((unit.morale ?? 100) <= zoneEffects.shatterThreshold || unit.strength <= 0) {
      unit.modeState.moraleState = "shattered";
      unit.posture = "routing";
    } else if ((unit.morale ?? 100) <= zoneEffects.retreatThreshold) {
      unit.modeState.moraleState = "retreating";
      unit.posture = "retreating";
      handleRetreat(state, unit, terrainData);
    } else if ((unit.modeState.suppression || 0) >= 0.65) {
      unit.modeState.moraleState = "suppressed";
      unit.posture = "defending";
    } else if (inCombat) {
      unit.modeState.moraleState = "engaged";
    } else if ((unit.modeState.suppression || 0) > 0.15) {
      unit.modeState.moraleState = "recovering";
    } else {
      unit.modeState.moraleState = "ready";
      if (unit.posture === "retreating" || unit.posture === "routing") {
        unit.posture = "ready";
      }
    }

    if (unit.modeState.travelState && ["suppressed", "retreating", "shattered"].includes(unit.modeState.moraleState)) {
      unit.modeState.travelState = null;
      if (unit.modeState.currentCommand?.kind !== "withdraw") {
        unit.modeState.currentCommand = null;
      }
      pushEvent(state, "movement", `${unit.name} halted movement after losing cohesion.`, { unitId: unit.id, moraleState: unit.modeState.moraleState });
    }

    if (previousMoraleState !== unit.modeState.moraleState) {
      if (unit.modeState.moraleState === "suppressed") {
        pushEvent(state, "combat", `${unit.name} is suppressed and hugging cover.`, { unitId: unit.id, moraleState: "suppressed" });
      } else if (unit.modeState.moraleState === "retreating") {
        pushEvent(state, "combat", `${unit.name} is withdrawing under pressure.`, { unitId: unit.id, moraleState: "retreating" });
      } else if (unit.modeState.moraleState === "shattered") {
        pushEvent(state, "combat", `${unit.name} broke and is routing.`, { unitId: unit.id, moraleState: "shattered" });
      } else if (unit.modeState.moraleState === "recovering") {
        pushEvent(state, "combat", `${unit.name} is regaining cohesion.`, { unitId: unit.id, moraleState: "recovering" });
      } else if (unit.modeState.moraleState === "ready" && previousMoraleState !== "ready") {
        pushEvent(state, "combat", `${unit.name} recovered and is back in the fight.`, { unitId: unit.id, moraleState: "ready" });
      }
    }
  }
}

function getZoneOperationalEffects(state, unit) {
  const zoneId = getZoneIdForHex(state.scenario?.zoneModel, resolveUnitHex(unit));
  const frontline = state.frontlineState?.perSide?.[unit.actor]?.[zoneId] || null;
  const durationMs = frontline?.durationMs || 0;
  if (!frontline) {
    return {
      moraleLossMultiplier: 1,
      readinessRecoveryFactor: 1,
      suppressionRecoveryFactor: 1,
      supplyDrainPerTick: 0,
      combatStressPerTick: 0,
      retreatThreshold: 25,
      shatterThreshold: 10,
    };
  }
  if (frontline.activeTag === "encircled") {
    if (durationMs >= 90000) {
      return {
        moraleLossMultiplier: 1.8,
        readinessRecoveryFactor: 0,
        suppressionRecoveryFactor: 0.5,
        supplyDrainPerTick: 0.18,
        combatStressPerTick: 0.18,
        retreatThreshold: 36,
        shatterThreshold: 18,
      };
    }
    if (durationMs >= 30000) {
      return {
        moraleLossMultiplier: 1.65,
        readinessRecoveryFactor: 0,
        suppressionRecoveryFactor: 0.5,
        supplyDrainPerTick: 0.14,
        combatStressPerTick: 0.14,
        retreatThreshold: 33,
        shatterThreshold: 15,
      };
    }
    return {
      moraleLossMultiplier: 1.5,
      readinessRecoveryFactor: 0,
      suppressionRecoveryFactor: 0.5,
      supplyDrainPerTick: 0.1,
      combatStressPerTick: 0.1,
      retreatThreshold: 30,
      shatterThreshold: 12,
    };
  }
  if (frontline.activeTag === "salient") {
    if (durationMs >= 30000) {
      return {
        moraleLossMultiplier: 1.35,
        readinessRecoveryFactor: 0.65,
        suppressionRecoveryFactor: 0.65,
        supplyDrainPerTick: 0.08,
        combatStressPerTick: 0.06,
        retreatThreshold: 28,
        shatterThreshold: 11,
      };
    }
    return {
      moraleLossMultiplier: 1.25,
      readinessRecoveryFactor: 0.75,
      suppressionRecoveryFactor: 0.75,
      supplyDrainPerTick: 0.05,
      combatStressPerTick: 0.04,
      retreatThreshold: 26,
      shatterThreshold: 10,
    };
  }
  return {
    moraleLossMultiplier: 1,
    readinessRecoveryFactor: 1,
    suppressionRecoveryFactor: 1,
    supplyDrainPerTick: 0,
    combatStressPerTick: 0,
    retreatThreshold: 25,
    shatterThreshold: 10,
  };
}

function updateObjectives(state, terrainData) {
  const hexVP = state.scenario?.objectives?.hexVP || state.scenario?.victoryConditions?.hexVP || [];
  const holdMsRequired = (state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
  const nextObjectiveState = { ...(state.truthState.objectives || {}) };
  const tickMs = state.game.tickMs || 250;

  for (const objective of hexVP) {
    const zoneId = getObjectiveZoneId(state.scenario?.zoneModel, objective.hex) || getZoneIdForHex(state.scenario?.zoneModel, objective.hex);
    const zoneTruth = state.zoneAnalysis?.truth?.byZone?.[zoneId] || null;
    const openingSeedController = zoneId ? state.truthState?.openingZoneOwners?.[zoneId] || null : null;
    const current = normalizeObjectiveRecord(nextObjectiveState[objective.hex], holdMsRequired);
    const candidate = zoneTruth?.controller || openingSeedController || null;

    if (!candidate) {
      current.candidateController = null;
      current.candidateHeldMs = 0;
      if (!current.controller) {
        current.heldMs = 0;
      } else if (holdMsRequired > 0) {
        current.heldMs = Math.max(current.heldMs, holdMsRequired);
      }
    } else if (holdMsRequired <= 0) {
      current.controller = candidate;
      current.heldMs = holdMsRequired;
      current.candidateController = candidate;
      current.candidateHeldMs = holdMsRequired;
      current.seededFromBootstrap = false;
    } else {
      if (current.candidateController === candidate) {
        current.candidateHeldMs += tickMs;
      } else {
        current.candidateController = candidate;
        current.candidateHeldMs = tickMs;
      }
      if (current.controller === candidate) {
        current.heldMs = Math.max(current.heldMs, holdMsRequired);
        current.candidateHeldMs = Math.max(current.candidateHeldMs, holdMsRequired);
      } else {
        current.heldMs = current.controller && current.seededFromBootstrap
          ? holdMsRequired
          : Math.max(0, current.heldMs);
      }
      if (current.candidateHeldMs >= holdMsRequired) {
        current.controller = candidate;
        current.heldMs = holdMsRequired;
        current.candidateHeldMs = holdMsRequired;
        current.seededFromBootstrap = false;
      }
    }

    nextObjectiveState[objective.hex] = current;
  }

  state.truthState.objectives = nextObjectiveState;
}

function getCriticalObjectiveHexes(state) {
  return Array.from(new Set(
    (state.scenario?.actors || []).flatMap((actor) => (
      Array.isArray(actor?.cvpHexes) ? actor.cvpHexes : []
    ))
  )).filter(Boolean);
}

function actorControlsAllCriticalObjectives(state, actorId, criticalObjectiveHexes = []) {
  if (!actorId) return false;
  if (!criticalObjectiveHexes.length) return true;
  return criticalObjectiveHexes.every((hex) => (
    state.truthState?.objectives?.[hex]?.controller === actorId
  ));
}

function updateVictory(state) {
  const hexVP = state.scenario?.objectives?.hexVP || state.scenario?.victoryConditions?.hexVP || [];
  const vpGoal = state.scenario?.objectives?.vpGoal || state.scenario?.victoryConditions?.vpGoal || 50;
  const durationLimitMinutes = Number(state.scenario?.rtsOptions?.durationLimitMinutes || 0);
  const actors = state.scenario?.actors || [];
  const criticalObjectiveHexes = getCriticalObjectiveHexes(state);
  const scores = {};

  for (const actor of actors) {
    scores[actor.id] = 0;
  }

  for (const objective of hexVP) {
    const control = state.truthState.objectives?.[objective.hex];
    if (control?.controller) {
      scores[control.controller] = (scores[control.controller] || 0) + (objective.vp || 10);
    }
  }

  const livingByActor = {};
  for (const actor of actors) {
    livingByActor[actor.id] = (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed").length;
  }

  const thresholdWinners = Object.entries(scores).filter(([, score]) => score >= vpGoal);
  const liveCriticalWinners = thresholdWinners.filter(([actorId]) => (
    actorControlsAllCriticalObjectives(state, actorId, criticalObjectiveHexes)
  ));

  if (durationLimitMinutes > 0 && (state.game.elapsedMs || 0) >= durationLimitMinutes * 60_000) {
    const eligibleScores = Object.fromEntries(thresholdWinners);
    const eligibleLiving = Object.fromEntries(
      thresholdWinners.map(([actorId]) => [actorId, livingByActor[actorId] || 0])
    );
    const timerResult = thresholdWinners.length > 0
      ? resolveTimedVictory(eligibleScores, eligibleLiving)
      : { winner: "draw" };
    state.game.winner = timerResult.winner;
    state.game.status = "finished";
    state.game.victoryReason = "time_limit";
    pushEvent(
      state,
      "objective",
      thresholdWinners.length === 0
        ? `Time expired after ${durationLimitMinutes} minutes before any side reached the victory-point threshold.`
        : timerResult.winner === "draw"
          ? `Time expired after ${durationLimitMinutes} minutes with multiple sides above the victory-point threshold.`
          : `${timerResult.winner} held at least ${vpGoal} VP when the ${durationLimitMinutes}-minute limit expired.`,
      { actorId: timerResult.winner, reason: "time_limit" }
    );
    return;
  }

  if (liveCriticalWinners.length > 0) {
    const liveResult = resolveTimedVictory(
      Object.fromEntries(liveCriticalWinners),
      Object.fromEntries(liveCriticalWinners.map(([actorId]) => [actorId, livingByActor[actorId] || 0]))
    );
    state.game.winner = liveResult.winner;
    state.game.status = "finished";
    state.game.victoryReason = "vp_goal";
    pushEvent(
      state,
      "objective",
      liveResult.winner === "draw"
        ? "Multiple sides simultaneously secured every critical objective while crossing the victory-point threshold."
        : criticalObjectiveHexes.length > 0
          ? `${liveResult.winner} captured every critical objective and reached the victory-point threshold.`
          : `${liveResult.winner} reached the victory-point threshold.`,
      { actorId: liveResult.winner, reason: "vp_goal" }
    );
    return;
  }

  const survivingActors = Object.entries(livingByActor).filter(([, count]) => count > 0);
  if (survivingActors.length === 1) {
    state.game.winner = survivingActors[0][0];
    state.game.status = "finished";
    state.game.victoryReason = "annihilation";
    pushEvent(state, "objective", `${survivingActors[0][0]} destroyed the opposing force.`, { actorId: survivingActors[0][0] });
  }
}

function runAiCadence(state, terrainData, phaseIndex = null) {
  for (const actor of state.scenario?.actors || []) {
    if (actor.controller !== "ai") continue;
    const directives = buildAiDirectives(state, actor);
    directives.variation = buildVariationTelemetry(getActorVariationState(state, actor.id), directives);
    const commanderState = state.ai.commanders[actor.id] || {
      lastRunAtMs: -Infinity,
      ownerTasks: {},
      ownerZoneTasks: {},
      hypotheses: null,
      replanLog: [],
      operations: {
        main: null,
        support: [],
        lastDeepReviewAtMs: null,
        lastLightReviewAtMs: null,
        alerts: [],
        lastDirectorAdvice: null,
      },
    };
    const subordinateState = state.ai.subordinates[actor.id] || {
      lastRunAtMs: -Infinity,
      assignments: {},
      owners: {},
      taskQueues: {},
      reports: {},
      completedTaskIds: {},
      groupPlans: {},
      staleTaskLog: [],
    };
    const directorState = state.ai.directors[actor.id] || { lastRunAtMs: -Infinity, packet: null, evidence: {}, activePackages: [], history: [] };
    const executorState = state.ai.executors[actor.id] || { lastRunAtMs: -Infinity, reactions: [] };
    const friendlyUnits = phaseIndex?.liveUnitsByActor?.[actor.id]
      || (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed" && !unit.embarkedIn);
    subordinateState.assignments = buildSubordinateAssignments(state, actor.id, subordinateState.assignments || {});
    const directorEnabled = actor.aiConfig?.directorEnabled ?? state.scenario?.rtsOptions?.directorEnabled ?? true;

    if ((state.game.elapsedMs - directorState.lastRunAtMs) >= directives.directorCadenceMs) {
      if (directorEnabled) {
        updateDirectorState(state, actor, directorState, directives);
        pushAiDecision(state, actor.id, null, "directorHint", "director", directorState.packet.summary, {
          packet: directorState.packet,
          activePackages: directorState.activePackages,
        });
      } else {
        directorState.packet = null;
        directorState.activePackages = [];
      }
      directorState.lastRunAtMs = state.game.elapsedMs;
      state.ai.directors[actor.id] = directorState;
    }

    const commanderDue = (state.game.elapsedMs - commanderState.lastRunAtMs) >= directives.commanderCadenceMs;
    const subordinateDue = (state.game.elapsedMs - subordinateState.lastRunAtMs) >= directives.subordinateCadenceMs;
    const ownerWorkDue = commanderDue || subordinateDue;
    const ownerView = ownerWorkDue
      ? buildSubordinateOwnerView(friendlyUnits, subordinateState.assignments || {})
      : null;

    if (commanderDue) {
      runCommanderPass(state, terrainData, actor, commanderState, subordinateState, directorState.packet, directives, friendlyUnits, ownerView);
      commanderState.lastRunAtMs = state.game.elapsedMs;
      state.ai.commanders[actor.id] = commanderState;
    }

    if (subordinateDue) {
      runSubordinatePass(state, terrainData, actor, commanderState, subordinateState, directives, friendlyUnits, ownerView, phaseIndex);
      subordinateState.lastRunAtMs = state.game.elapsedMs;
      state.ai.subordinates[actor.id] = subordinateState;
    }

    runExecutorPass(state, terrainData, actor, executorState, friendlyUnits);
    executorState.lastRunAtMs = state.game.elapsedMs;
    state.ai.executors[actor.id] = executorState;
    updateAiThoughtSnapshots(state, actor, directives, directorState, commanderState, subordinateState);
  }
}

function ensureCommanderOperationsShape(commanderState) {
  commanderState.operations = commanderState.operations || {};
  commanderState.operations.main = commanderState.operations.main || null;
  commanderState.operations.support = Array.isArray(commanderState.operations.support) ? commanderState.operations.support : [];
  commanderState.operations.lastDeepReviewAtMs = commanderState.operations.lastDeepReviewAtMs ?? null;
  commanderState.operations.lastLightReviewAtMs = commanderState.operations.lastLightReviewAtMs ?? null;
  commanderState.operations.alerts = Array.isArray(commanderState.operations.alerts) ? commanderState.operations.alerts : [];
  commanderState.operations.lastDirectorAdvice = commanderState.operations.lastDirectorAdvice || null;
  commanderState.taskInvalidations = Array.isArray(commanderState.taskInvalidations) ? commanderState.taskInvalidations : [];
}

function normalizeAdviceEntries(entries, role = "axis") {
  return (entries || [])
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        return {
          zoneId: entry,
          score: 0.5,
          role,
          urgency: 0.5,
          reason: [],
        };
      }
      return {
        zoneId: entry.zoneId || entry.id || null,
        score: Number(entry.score ?? entry.weight ?? entry.urgency ?? 0.5),
        role: entry.role || role,
        urgency: Number(entry.urgency ?? entry.score ?? 0.5),
        reason: Array.isArray(entry.reason) ? entry.reason : (Array.isArray(entry.why) ? entry.why : []),
        horizon: entry.horizon || null,
        kind: entry.kind || null,
      };
    })
    .filter((entry) => entry?.zoneId);
}

function normalizeDirectorAdvice(state, actorId, directorPacket) {
  const legacy = directorPacket || {};
  const suggestedAxes = normalizeAdviceEntries(
    directorPacket?.suggestedAxes
    || [
      ...(legacy.primaryZones || []).map((zoneId, index) => ({ zoneId, score: index === 0 ? 1 : 0.8, role: index === 0 ? "main" : "secondary" })),
      ...(legacy.secondaryZones || []).map((zoneId) => ({ zoneId, score: 0.7, role: "secondary" })),
    ],
    "axis"
  );
  const supportingAxes = normalizeAdviceEntries(
    directorPacket?.supportingAxes
    || (legacy.supportingZones || []).map((zoneId) => ({ zoneId, score: 0.65, role: "support" })),
    "support"
  );
  const campaignObjectives = normalizeAdviceEntries(
    directorPacket?.campaignObjectives
    || (legacy.campaignObjectiveZones || []).map((zoneId, index) => ({ zoneId, score: index === 0 ? 0.9 : 0.7, role: "campaign", horizon: "long" })),
    "campaign"
  );
  const opportunities = normalizeAdviceEntries(
    directorPacket?.opportunities
    || (legacy.opportunityZones || []).map((zoneId) => ({ zoneId, score: 0.6, role: "opportunity" })),
    "opportunity"
  );
  const risks = normalizeAdviceEntries(
    directorPacket?.risks
    || (legacy.threatenedZones || []).map((zoneId) => ({ zoneId, score: 0.75, urgency: 0.75, role: "risk", kind: "threatened" })),
    "risk"
  );
  const alerts = (directorPacket?.alerts || [])
    .map((entry) => ({
      kind: entry.kind || "alert",
      zoneId: entry.zoneId || null,
      severity: entry.severity || "operational",
      urgency: Number(entry.urgency ?? 0.75),
      reason: Array.isArray(entry.reason) ? entry.reason : (entry.reason ? [entry.reason] : []),
    }));
  for (const zoneId of legacy.cutOffAlerts || []) {
    alerts.push({ kind: "cut_off", zoneId, severity: "existential", urgency: 0.95, reason: ["cut_off_risk"] });
  }
  for (const zoneId of legacy.salientAlerts || []) {
    alerts.push({ kind: "salient", zoneId, severity: "operational", urgency: 0.7, reason: ["salient_risk"] });
  }
  for (const entry of risks) {
    if (!alerts.some((alert) => alert.zoneId === entry.zoneId && alert.kind === (entry.kind || "threatened"))) {
      alerts.push({
        kind: entry.kind || "threatened",
        zoneId: entry.zoneId,
        severity: entry.kind === "cut_off" ? "existential" : "operational",
        urgency: entry.urgency || entry.score || 0.7,
        reason: entry.reason || [],
      });
    }
  }
  return {
    suggestedAxes,
    supportingAxes,
    campaignObjectives,
    opportunities,
    risks,
    alerts,
    pressureAssessment: directorPacket?.pressureAssessment || legacy.pressure || "steady",
    confidence: Number(directorPacket?.confidence ?? 0.6),
    activePackages: legacy.activePackages || [],
    packageWeights: legacy.packageWeights || {},
    metrics: legacy.metrics || {},
    frontierZoneIds: legacy.frontierZoneIds || [],
    legacy,
  };
}

function mergeCommanderAlerts(previousAlerts, nextAlerts, nowMs) {
  const previousByKey = Object.fromEntries((previousAlerts || []).map((alert) => [`${alert.kind}:${alert.zoneId || "-"}`, alert]));
  return (nextAlerts || []).map((alert) => {
    const key = `${alert.kind}:${alert.zoneId || "-"}`;
    const previous = previousByKey[key];
    return {
      ...alert,
      seenCount: previous ? (previous.seenCount || 1) + 1 : 1,
      firstSeenAtMs: previous?.firstSeenAtMs ?? nowMs,
      lastSeenAtMs: nowMs,
    };
  });
}

function buildCommanderAlerts(state, actorId, advice, subordinateState, previousAlerts = []) {
  const nowMs = state.game.elapsedMs || 0;
  const alerts = [...(advice.alerts || [])];
  for (const staleEntry of subordinateState?.staleTaskLog || []) {
    if ((nowMs - (staleEntry.atMs || 0)) > RTS_COMMANDER_BASE_CADENCE_MS * 2) continue;
    alerts.push({
      kind: staleEntry.reason || "stale_task",
      zoneId: staleEntry.zoneId || null,
      severity: ["force_wiped", "zone_lost"].includes(staleEntry.reason) ? "operational" : "local",
      urgency: staleEntry.reason === "force_wiped" ? 0.9 : 0.65,
      reason: [staleEntry.reason],
    });
  }
  for (const invalidation of state.ai?.commanders?.[actorId]?.taskInvalidations || []) {
    if ((nowMs - (invalidation.atMs || 0)) > RTS_COMMANDER_BASE_CADENCE_MS * 2) continue;
    alerts.push({
      kind: invalidation.reason || "task_invalidation",
      zoneId: invalidation.zoneId || null,
      severity: invalidation.reason === "force_wiped" ? "operational" : "local",
      urgency: invalidation.reason === "force_wiped" ? 0.95 : 0.7,
      reason: [invalidation.reason],
    });
  }
  return mergeCommanderAlerts(previousAlerts, alerts, nowMs);
}

function buildOperationRecord(state, kind, goalZoneId, options = {}) {
  if (!goalZoneId) return null;
  const nowMs = state.game.elapsedMs || 0;
  const objective = getZoneObjective(state, goalZoneId);
  const status = options.status || "active";
  return {
    id: options.id || `op_${kind}_${goalZoneId}_${nowMs}`,
    kind,
    goalZoneId,
    goalObjectiveHex: options.goalObjectiveHex || objective?.hex || null,
    phase: options.phase || (status === "secured" ? "secure_objective" : kind === "support" ? "support" : "approach"),
    approachZoneIds: Array.from(new Set(options.approachZoneIds || [goalZoneId])).filter(Boolean),
    supportZoneIds: Array.from(new Set(options.supportZoneIds || [])).filter(Boolean),
    startedAtMs: options.startedAtMs ?? nowMs,
    phaseStartedAtMs: options.phaseStartedAtMs ?? nowMs,
    lastMeaningfulProgressAtMs: options.lastMeaningfulProgressAtMs ?? nowMs,
    commitmentUntilAtMs: options.commitmentUntilAtMs ?? (nowMs + (kind === "support" ? COMMANDER_SUPPORT_COMMITMENT_MS : COMMANDER_MIN_OPERATION_COMMITMENT_MS)),
    viabilityScore: Number(options.viabilityScore ?? 0.65),
    viabilityTrend: Number(options.viabilityTrend ?? 0),
    obstacleSummary: options.obstacleSummary || { blockedReasons: {}, underFireCount: 0, lowCohesionCount: 0, casualtyDelta: 0 },
    branchCandidates: Array.isArray(options.branchCandidates) ? options.branchCandidates : [],
    status,
  };
}

function matchReportsToOperation(operation, reports) {
  if (!operation) return [];
  const supportZoneIds = new Set(operation.supportZoneIds || []);
  return Object.values(reports || {}).filter((report) => {
    if (!report) return false;
    if (report.zoneId && report.zoneId === operation.goalZoneId) return true;
    if (report.zoneId && supportZoneIds.has(report.zoneId)) return true;
    return false;
  });
}

function updateOperationFromReports(state, actorId, operation, reports) {
  if (!operation) return null;
  const relevantReports = matchReportsToOperation(operation, reports);
  const zoneLedger = state.zoneAnalysis?.truth?.byZone?.[operation.goalZoneId] || null;
  const actorSnapshot = state.zoneAnalysis?.perSide?.[actorId]?.[operation.goalZoneId] || null;
  const hadProgress = relevantReports.some((report) => (
    (report.distanceTrend || 0) > 0.2
    || (report.recentDisplacement || 0) >= 1
    || (report.routeProgress || 0) >= 0.4
  ));
  const totalCasualties = relevantReports.reduce((sum, report) => sum + (report.casualtyDelta || 0), 0);
  const obstacleSummary = {
    blockedReasons: {},
    underFireCount: relevantReports.reduce((sum, report) => sum + (report.underFireCount || 0), 0),
    lowCohesionCount: relevantReports.reduce((sum, report) => sum + (report.lowCohesionCount || 0), 0),
    casualtyDelta: totalCasualties,
  };
  for (const report of relevantReports) {
    for (const reason of report.blockedReasons || []) {
      obstacleSummary.blockedReasons[reason] = (obstacleSummary.blockedReasons[reason] || 0) + 1;
    }
  }
  const obstaclePressure = Object.values(obstacleSummary.blockedReasons).reduce((sum, count) => sum + count, 0) * 0.04
    + obstacleSummary.lowCohesionCount * 0.035
    + obstacleSummary.underFireCount * 0.02
    + obstacleSummary.casualtyDelta * 0.08;
  const zoneSecure = zoneLedger?.controller === actorId
    || ((actorSnapshot?.controlShare || 0) >= ZONE_CONTROL_THRESHOLD && ((actorSnapshot?.enemyShare || 0) <= ZONE_CONTROL_MIN_FOOTHOLD));
  const baseScore = clamp(
    (zoneSecure ? 0.92 : operation.viabilityScore || 0.65)
    + (hadProgress ? 0.08 : -0.09)
    - obstaclePressure,
    0,
    1
  );
  const next = {
    ...operation,
    viabilityTrend: roundMetric(baseScore - (operation.viabilityScore || 0)),
    viabilityScore: baseScore,
    obstacleSummary,
    status: zoneSecure ? "secured" : baseScore < 0.24 ? "failing" : "active",
  };
  if (hadProgress || zoneSecure) {
    next.lastMeaningfulProgressAtMs = state.game.elapsedMs || 0;
  }
  return next;
}

function shouldRunCommanderDeepReview(state, commanderState, alerts, reserveRelease, subordinateState) {
  const nowMs = state.game.elapsedMs || 0;
  const operations = commanderState.operations || {};
  const main = operations.main || null;
  const reasons = [];
  const existential = (alerts || []).some((alert) => alert.severity === "existential");
  const persistentOperational = (alerts || []).some((alert) => alert.severity === "operational" && (alert.seenCount || 0) >= 2);
  if (!main) reasons.push("no_main_operation");
  if ((operations.lastDeepReviewAtMs == null) || (nowMs - operations.lastDeepReviewAtMs) >= COMMANDER_DEEP_REVIEW_MS) {
    reasons.push("cadence");
  }
  if (main && (nowMs - (main.lastMeaningfulProgressAtMs || 0)) >= COMMANDER_PROGRESS_STALL_MS) {
    reasons.push("stall");
  }
  if (main?.status === "secured") reasons.push("objective_secured");
  if ((commanderState.hypotheses?.reserveRelease ?? reserveRelease) !== reserveRelease) reasons.push("reserve_state_change");
  if ((subordinateState?.staleTaskLog || []).some((entry) => (nowMs - (entry.atMs || 0)) <= RTS_COMMANDER_BASE_CADENCE_MS * 2)) {
    reasons.push("stale_task");
  }
  if (existential) reasons.push("existential_emergency");
  else if (persistentOperational) reasons.push("operational_emergency");
  return {
    deep: reasons.length > 0,
    existential,
    persistentOperational,
    reasons,
  };
}

function scoreOperationCandidate(state, actorId, zoneId, advice, currentOperation = null) {
  const snapshot = state.zoneAnalysis?.perSide?.[actorId]?.[zoneId];
  if (!snapshot) return -Infinity;
  const findScore = (entries, weight, urgencyWeight = 0.2) => entries
    .filter((entry) => entry.zoneId === zoneId)
    .reduce((sum, entry) => sum + (entry.score || 0.5) * weight + (entry.urgency || 0.5) * urgencyWeight, 0);
  let score = 0;
  score += findScore(advice.suggestedAxes, 0.55, 0.12);
  score += findScore(advice.campaignObjectives, 0.28, 0.08);
  score += findScore(advice.opportunities, 0.22, 0.06);
  score += findScore(advice.risks, 0.34, 0.12);
  if (advice.frontierZoneIds?.includes(zoneId)) score += 0.12;
  if (snapshot.state === "contested") score += 0.24;
  else if (snapshot.state === "enemy") score += 0.2;
  else if (snapshot.state === "friendly") score -= 0.1;
  score += (snapshot.breakthroughOpportunity || 0) * 0.18;
  score += (snapshot.supportingZoneValue || 0) * 0.08;
  score -= (snapshot.congestionRisk || 0) * 0.16;
  score -= (snapshot.cutOffRisk || 0) * 0.1;
  if (currentOperation?.goalZoneId === zoneId) {
    score += 0.3 + (currentOperation.viabilityScore || 0) * 0.2;
  }
  return roundMetric(score);
}

function chooseOperationPhase(state, actorId, operation, advice) {
  const snapshot = state.zoneAnalysis?.perSide?.[actorId]?.[operation.goalZoneId] || null;
  if (operation.status === "secured") return "secure_objective";
  if (snapshot?.state === "friendly" && advice.pressureAssessment === "recover") return "stabilize";
  if (snapshot?.state === "friendly") return "consolidate";
  if (snapshot?.state === "contested") return "fight_through";
  return "approach";
}

function chooseCommanderOperations(state, actor, commanderState, subordinateState, advice, reserveRelease, review) {
  const nowMs = state.game.elapsedMs || 0;
  const currentMain = updateOperationFromReports(state, actor.id, commanderState.operations?.main, subordinateState.reports || {});
  const currentSupport = (commanderState.operations?.support || [])
    .map((operation) => updateOperationFromReports(state, actor.id, operation, subordinateState.reports || {}))
    .filter(Boolean);
  const candidateZoneIds = Array.from(new Set([
    currentMain?.goalZoneId,
    ...advice.suggestedAxes.map((entry) => entry.zoneId),
    ...advice.campaignObjectives.map((entry) => entry.zoneId),
    ...advice.opportunities.map((entry) => entry.zoneId),
    ...advice.risks.map((entry) => entry.zoneId),
  ].filter(Boolean)));
  const rankedCandidates = candidateZoneIds
    .map((zoneId) => ({ zoneId, score: scoreOperationCandidate(state, actor.id, zoneId, advice, currentMain) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);
  const topCandidateZoneId = rankedCandidates[0]?.zoneId || null;
  const canReplaceMain = review.existential || nowMs >= (currentMain?.commitmentUntilAtMs || 0);
  let main = currentMain;
  let reviewAction = "continue_phase";
  const reviewReasons = [...review.reasons];

  if (!main && topCandidateZoneId) {
    main = buildOperationRecord(state, "main", topCandidateZoneId, {
      supportZoneIds: advice.supportingAxes.map((entry) => entry.zoneId).slice(0, 2),
      branchCandidates: rankedCandidates.slice(1, 4).map((entry) => entry.zoneId),
    });
    reviewAction = "adjust_axis";
  } else if (main?.status === "secured" && topCandidateZoneId && topCandidateZoneId !== main.goalZoneId) {
    main = buildOperationRecord(state, "main", topCandidateZoneId, {
      supportZoneIds: advice.supportingAxes.map((entry) => entry.zoneId).slice(0, 2),
      branchCandidates: rankedCandidates.slice(1, 4).map((entry) => entry.zoneId),
    });
    reviewAction = "branch_phase";
  } else if (main && topCandidateZoneId && topCandidateZoneId !== main.goalZoneId && canReplaceMain && (main.viabilityScore || 0) < 0.42) {
    main = buildOperationRecord(state, "main", topCandidateZoneId, {
      supportZoneIds: advice.supportingAxes.map((entry) => entry.zoneId).slice(0, 2),
      branchCandidates: rankedCandidates.slice(1, 4).map((entry) => entry.zoneId),
    });
    reviewAction = review.existential ? "abort_and_reframe" : "adjust_axis";
  } else if (main && reserveRelease && (main.viabilityScore || 0) < 0.5 && nowMs >= (main.commitmentUntilAtMs || 0)) {
    reviewAction = "commit_reserve";
  }

  if (main) {
    main = {
      ...main,
      phase: chooseOperationPhase(state, actor.id, main, advice),
      supportZoneIds: Array.from(new Set([...(main.supportZoneIds || []), ...advice.supportingAxes.map((entry) => entry.zoneId)])).filter(Boolean).slice(0, 2),
      branchCandidates: Array.from(new Set([...(main.branchCandidates || []), ...rankedCandidates.slice(1, 4).map((entry) => entry.zoneId)])).filter(Boolean).slice(0, 4),
    };
  }

  const supportCandidates = Array.from(new Set([
    ...advice.risks.map((entry) => entry.zoneId),
    ...advice.supportingAxes.map((entry) => entry.zoneId),
  ].filter((zoneId) => zoneId && zoneId !== main?.goalZoneId)));
  const supportOps = [];
  for (const zoneId of supportCandidates) {
    const existing = currentSupport.find((operation) => operation.goalZoneId === zoneId) || null;
    if (existing && nowMs < (existing.commitmentUntilAtMs || 0) && existing.status !== "failing") {
      supportOps.push({
        ...existing,
        phase: chooseOperationPhase(state, actor.id, existing, advice),
      });
      continue;
    }
    supportOps.push(buildOperationRecord(state, "support", zoneId, {
      supportZoneIds: main?.goalZoneId ? [main.goalZoneId] : [],
      viabilityScore: existing?.viabilityScore ?? 0.6,
      branchCandidates: main?.branchCandidates || [],
    }));
    if (existing == null && reviewAction === "continue_phase" && (advice.risks.some((entry) => entry.zoneId === zoneId) || review.persistentOperational)) {
      reviewAction = "spawn_emergency_support_op";
    } else if (reviewAction === "continue_phase" && advice.supportingAxes.some((entry) => entry.zoneId === zoneId) && (main?.viabilityScore || 0) < 0.55) {
      reviewAction = "shift_support";
    }
    if (supportOps.length >= 2) break;
  }

  const topSuggested = advice.suggestedAxes[0]?.zoneId || null;
  const adviceDecision = !topSuggested || main?.goalZoneId === topSuggested
    ? { kind: "accepted_director_advice", reasons: topSuggested ? ["aligned_with_current_operation"] : ["no_primary_suggestion"] }
    : review.existential
      ? { kind: "rejected_director_advice", reasons: ["rear_emergency"] }
      : canReplaceMain
        ? { kind: "rejected_director_advice", reasons: ["unreachable_now"] }
        : { kind: "deferred_director_advice", reasons: ["current_plan_viable"] };

  return {
    main,
    support: supportOps.filter(Boolean).slice(0, 2),
    reviewAction,
    reviewReasons,
    adviceDecision,
  };
}

function buildPlanningPacketFromOperations(state, actorId, advice, operations) {
  const mainZoneId = operations?.main?.goalZoneId || advice.suggestedAxes[0]?.zoneId || null;
  const supportZoneIds = Array.from(new Set((operations?.support || []).map((operation) => operation.goalZoneId).filter(Boolean)));
  return {
    primaryZones: mainZoneId ? [mainZoneId] : [],
    secondaryZones: advice.suggestedAxes.map((entry) => entry.zoneId).filter((zoneId) => zoneId && zoneId !== mainZoneId).slice(0, 2),
    campaignObjectiveZones: advice.campaignObjectives.map((entry) => entry.zoneId).filter(Boolean).slice(0, 3),
    supportingZones: (supportZoneIds.length > 0 ? supportZoneIds : advice.supportingAxes.map((entry) => entry.zoneId)).filter((zoneId) => zoneId && zoneId !== mainZoneId).slice(0, 2),
    opportunityZones: advice.opportunities.map((entry) => entry.zoneId).filter(Boolean).slice(0, 3),
    threatenedZones: advice.risks.map((entry) => entry.zoneId).filter(Boolean).slice(0, 3),
    reserveZones: advice.risks.map((entry) => entry.zoneId).filter(Boolean).slice(0, 2).length > 0
      ? advice.risks.map((entry) => entry.zoneId).filter(Boolean).slice(0, 2)
      : [findBestRearZoneForActor(state, actorId)].filter(Boolean),
    frontierZoneIds: advice.frontierZoneIds || [],
    currentPhaseDepthBudget: advice.legacy?.currentPhaseDepthBudget ?? null,
    pressure: advice.pressureAssessment,
    pressureAssessment: advice.pressureAssessment,
    activePackages: advice.activePackages,
    packageWeights: advice.packageWeights,
    metrics: advice.metrics,
    suggestedAxes: advice.suggestedAxes,
    supportingAxes: advice.supportingAxes,
    campaignObjectives: advice.campaignObjectives,
    risks: advice.risks,
    opportunities: advice.opportunities,
    alerts: advice.alerts,
    confidence: advice.confidence,
    currentOperation: operations?.main ? {
      goalZoneId: operations.main.goalZoneId,
      phase: operations.main.phase,
      status: operations.main.status,
      viabilityScore: operations.main.viabilityScore,
      lastMeaningfulProgressAtMs: operations.main.lastMeaningfulProgressAtMs,
    } : null,
  };
}

function runCommanderPass(state, terrainData, actor, commanderState, subordinateState, directorPacket, directives, friendlyUnits = null, ownerView = null) {
  const actorView = state.perceptionState?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  const visibleEnemyIds = new Set([...(actorView.detectedUnits || []), ...(actorView.contactUnits || [])]);
  const lastKnown = actorView.lastKnown || {};
  const objectives = state.scenario?.objectives?.hexVP || [];
  const actorUnits = friendlyUnits || (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed" && !unit.embarkedIn);
  const reserveSet = buildReserveSet(actorUnits, directives);
  const advice = normalizeDirectorAdvice(state, actor.id, directorPacket);
  const reserveRelease = shouldReleaseReserves(actorView, objectives, actor.id, state, {
    ...directorPacket,
    threatenedZones: advice.risks.map((entry) => entry.zoneId),
    cutOffAlerts: advice.alerts.filter((alert) => alert.kind === "cut_off").map((alert) => alert.zoneId),
    pressure: advice.pressureAssessment,
  }, directives);
  const localOwnerView = ownerView || buildSubordinateOwnerView(actorUnits, subordinateState.assignments || {});
  const owners = localOwnerView.owners;
  const ownerTasks = {};
  const replanReasons = new Set();
  ensureCommanderOperationsShape(commanderState);
  const invalidations = invalidateCommanderTasks(state, actor, commanderState, owners, localOwnerView.ownerUnitsByOwner);
  for (const invalidation of invalidations) {
    replanReasons.add(invalidation.reason);
    pushAiDecision(
      state,
      actor.id,
      null,
      invalidation.provenance || "doctrine",
      "commander",
      `${invalidation.ownerId} canceled ${invalidation.kind?.replace(/_/g, " ") || "task"} — ${invalidation.reason.replace(/_/g, " ")}.`,
      invalidation
    );
  }

  for (const unit of actorUnits) {
    if (!isUnitReleased(unit, state.game.elapsedMs || 0)) {
      unit.modeState.reserveState = unit.modeState.reserveState || "timed";
      continue;
    }
    if (reserveSet.has(unit.id) && !reserveRelease) {
      if (unit.modeState.reserveState !== "held") {
        unit.modeState.reserveState = "held";
        unit.posture = "reserve";
        pushAiDecision(state, actor.id, unit.id, "doctrine", "commander", "Holding unit in reserve pending a clearer trigger.");
      }
      continue;
    }
    if (unit.modeState.reserveState === "held") {
      unit.modeState.reserveState = "released";
      pushAiDecision(state, actor.id, unit.id, "doctrine", "commander", "Releasing reserve unit to the main fight.");
    } else {
      unit.modeState.reserveState = null;
    }
  }

  commanderState.operations.alerts = buildCommanderAlerts(state, actor.id, advice, subordinateState, commanderState.operations.alerts);
  const review = shouldRunCommanderDeepReview(state, commanderState, commanderState.operations.alerts, reserveRelease, subordinateState);
  const chosenOperations = chooseCommanderOperations(state, actor, commanderState, subordinateState, advice, reserveRelease, review);
  commanderState.operations.main = chosenOperations.main;
  commanderState.operations.support = chosenOperations.support;
  commanderState.operations.lastLightReviewAtMs = state.game.elapsedMs;
  if (review.deep) {
    commanderState.operations.lastDeepReviewAtMs = state.game.elapsedMs;
  }
  commanderState.operations.lastDirectorAdvice = {
    atMs: state.game.elapsedMs,
    kind: chosenOperations.adviceDecision.kind,
    reasons: chosenOperations.adviceDecision.reasons,
    suggestedZoneId: advice.suggestedAxes[0]?.zoneId || null,
    chosenZoneId: chosenOperations.main?.goalZoneId || null,
  };
  const planningPacket = buildPlanningPacketFromOperations(state, actor.id, advice, commanderState.operations);
  pushAiDecision(
    state,
    actor.id,
    null,
    "doctrine",
    "commander",
    `${chosenOperations.adviceDecision.kind.replace(/_/g, " ")}; ${chosenOperations.reviewAction.replace(/_/g, " ")}${chosenOperations.main?.goalZoneId ? ` toward ${chosenOperations.main.goalZoneId}` : ""}.`,
    {
      reviewAction: chosenOperations.reviewAction,
      reviewReasons: chosenOperations.reviewReasons,
      directorAdvice: commanderState.operations.lastDirectorAdvice,
      operation: commanderState.operations.main,
    }
  );

  const zonePlans = planCommanderOwnerTasks({
    state,
    terrainData,
    actor,
    directives,
    directorPacket: planningPacket,
    owners,
    ownerUnitsByOwner: localOwnerView.ownerUnitsByOwner,
    reserveRelease,
    visibleEnemyIds,
    lastKnown,
  });
  for (const [ownerId, task] of Object.entries(zonePlans)) {
    ownerTasks[ownerId] = [{ ...task }];
    replanReasons.add(task.reason || task.role || "zone-plan");
    pushAiDecision(state, actor.id, null, task.provenance || "doctrine", "commander", `${ownerId} -> ${task.summary}`, {
      owner: ownerId,
      task,
      });
  }

  if (chosenOperations.reviewAction) {
    replanReasons.add(chosenOperations.reviewAction);
  }
  for (const reason of chosenOperations.reviewReasons || []) {
    replanReasons.add(reason);
  }

  const hypotheses = buildCommanderHypotheses(actor.id, actorView, objectives, state, reserveRelease, planningPacket, owners, zonePlans, commanderState.operations);
  const plansChanged = !areTaskQueuesEquivalent(commanderState.ownerTasks || {}, ownerTasks);

  commanderState.ownerTasks = ownerTasks;
  commanderState.ownerZoneTasks = zonePlans;
  commanderState.hypotheses = hypotheses;
  commanderState.lastReplanReasons = Array.from(replanReasons);
  if (plansChanged) {
    commanderState.lastMeaningfulPlanAtMs = state.game.elapsedMs;
    commanderState.replanLog = Array.isArray(commanderState.replanLog) ? commanderState.replanLog : [];
    commanderState.replanLog.push({
      atMs: state.game.elapsedMs,
      reasons: Array.from(replanReasons),
      hypotheses,
      primaryZones: planningPacket?.primaryZones || [],
      supportingZones: planningPacket?.supportingZones || [],
    });
    trimArray(commanderState.replanLog, getMaxLogItems(state));
  }
}

function runSubordinatePass(state, terrainData, actor, commanderState, subordinateState, directives, friendlyUnits = null, ownerView = null, phaseIndex = null) {
  const actorView = state.perceptionState?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  const actorUnits = friendlyUnits || (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed" && !unit.embarkedIn);
  const localOwnerView = ownerView || buildSubordinateOwnerView(actorUnits, subordinateState.assignments || {});
  const owners = localOwnerView.owners;
  subordinateState.owners = owners;
  subordinateState.taskQueues = subordinateState.taskQueues || {};
  subordinateState.reports = subordinateState.reports || {};
  subordinateState.completedTaskIds = subordinateState.completedTaskIds || {};
  subordinateState.groupPlans = subordinateState.groupPlans || {};
  subordinateState.staleTaskLog = Array.isArray(subordinateState.staleTaskLog) ? subordinateState.staleTaskLog : [];

  for (const owner of Object.values(owners)) {
    const ownerUnits = localOwnerView.ownerUnitsByOwner[owner.owner] || [];
    const commanderQueue = (commanderState.ownerTasks?.[owner.owner] || []).map((task) => ({ ...task }));
    const previousQueue = Array.isArray(subordinateState.taskQueues[owner.owner]) ? subordinateState.taskQueues[owner.owner] : [];
    const recentInvalidation = getRecentCommanderTaskInvalidation(commanderState, owner.owner, previousQueue[0]?.id);
    if (recentInvalidation && previousQueue[0]?.id === recentInvalidation.taskId) {
      previousQueue.shift();
      subordinateState.taskQueues[owner.owner] = previousQueue;
      pushAiDecision(
        state,
        actor.id,
        null,
        recentInvalidation.provenance || "doctrine",
        "subordinates",
        `${owner.owner} dropped stale ${recentInvalidation.kind?.replace(/_/g, " ") || "task"} — ${recentInvalidation.reason.replace(/_/g, " ")}.`,
        { owner: owner.owner, invalidation: recentInvalidation }
      );
    }
    const completedTaskId = subordinateState.completedTaskIds[owner.owner] || null;
    if (
      commanderQueue.length > 0
      && commanderQueue[0]?.id !== completedTaskId
      && !areTaskQueuesEquivalent({ value: previousQueue }, { value: commanderQueue })
    ) {
      subordinateState.taskQueues[owner.owner] = commanderQueue;
      pushAiDecision(
        state,
        actor.id,
        null,
        commanderQueue[0].provenance,
        "subordinates",
        `${owner.owner} accepted ${commanderQueue[0].kind.replace(/_/g, " ")} orders.`,
        { owner: owner.owner, task: commanderQueue[0] }
      );
    } else if (!subordinateState.taskQueues[owner.owner]) {
      subordinateState.taskQueues[owner.owner] = commanderQueue;
    }

    let queue = subordinateState.taskQueues[owner.owner];
    let activeTask = queue?.[0] || null;
    if (activeTask && isTaskSatisfied(state, actor.id, activeTask, ownerUnits, actorView)) {
      queue.shift();
      subordinateState.completedTaskIds[owner.owner] = activeTask.id;
      pushAiDecision(state, actor.id, null, activeTask.provenance, "subordinates", `${owner.owner} completed ${activeTask.kind.replace(/_/g, " ")}.`, {
        owner: owner.owner,
        task: activeTask,
      });
      activeTask = queue[0] || null;
    } else if (activeTask) {
      // Proactive staleness check — drop tasks whose premise has been invalidated
      // by the world even though they are not "satisfied" in the success sense.
      // We mark the task id in completedTaskIds so the subordinate pass won't
      // silently re-accept the same queue entry from the commander; the next
      // commander pass will issue fresh orders matched to the current zone state.
      const staleness = detectStaleTask(state, actor.id, activeTask, ownerUnits);
      if (staleness.stale) {
        queue.shift();
        subordinateState.completedTaskIds[owner.owner] = activeTask.id;
        subordinateState.staleTaskLog.push({
          atMs: state.game.elapsedMs,
          owner: owner.owner,
          taskId: activeTask.id,
          reason: staleness.reason,
          zoneId: activeTask.zoneId || null,
        });
        trimArray(subordinateState.staleTaskLog, getMaxLogItems(state));
        const reasonLabel = staleness.reason.replace(/_/g, " ");
        pushAiDecision(
          state,
          actor.id,
          null,
          activeTask.provenance || "doctrine",
          "subordinates",
          `${owner.owner} abandoned ${activeTask.kind.replace(/_/g, " ")} — ${reasonLabel}.`,
          { owner: owner.owner, task: activeTask, stale: staleness.reason }
        );
        activeTask = queue[0] || null;
      }
    }

    const groupPlan = activeTask
      ? buildSubordinateGroupPlan(state, terrainData, actor.id, owner, ownerUnits, activeTask)
      : null;
    if (groupPlan) subordinateState.groupPlans[owner.owner] = groupPlan;
    else delete subordinateState.groupPlans[owner.owner];

    let issuedCount = 0;
    if (activeTask) {
      // For fire missions, stamp the task's ammo type onto each artillery unit
      // in the owner group so the combat tick (queueArtilleryImpact) can vary
      // impact effects per round. Stamp every tick the task is active so that
      // commander replans (switching suppress→destroy, etc.) take effect
      // immediately rather than waiting for the next unit-order cycle.
      if (activeTask.kind === "fire_mission") {
        const fireMission = {
          taskId: activeTask.id,
          ammoType: activeTask.ammoType || "destroy",
          zoneId: activeTask.zoneId || null,
          targetHex: activeTask.targetHex || null,
          targetUnitIds: Array.isArray(activeTask.targetUnitIds) ? [...activeTask.targetUnitIds] : [],
          missionRadius: activeTask.missionRadius || getFireMissionRadius(activeTask.ammoType || "destroy"),
        };
        for (const unit of ownerUnits) {
          unit.modeState = unit.modeState || {};
          if (isIndirectFireUnit(unit)) {
            unit.modeState.fireMission = fireMission;
            unit.modeState.fireMissionAmmoType = fireMission.ammoType;
            unit.modeState.fireMissionZoneId = fireMission.zoneId;
            unit.modeState.fireMissionTargetHex = fireMission.targetHex;
          } else {
            unit.modeState.fireMission = null;
            unit.modeState.fireMissionAmmoType = null;
            unit.modeState.fireMissionZoneId = null;
            unit.modeState.fireMissionTargetHex = null;
          }
        }
      } else {
        for (const unit of ownerUnits) {
          if (!unit.modeState) continue;
          unit.modeState.fireMission = null;
          unit.modeState.fireMissionAmmoType = null;
          unit.modeState.fireMissionZoneId = null;
          unit.modeState.fireMissionTargetHex = null;
        }
      }
      for (const unit of ownerUnits) {
        if (!isUnitReleased(unit, state.game.elapsedMs || 0)) continue;
        if (unit.modeState?.reserveState === "held") continue;
        if (unit.modeState?.currentCommand || unit.modeState?.travelState) continue;
        const order = buildSubordinateUnitOrder(state, terrainData, unit, activeTask, ownerUnits, directives, groupPlan, phaseIndex);
        if (!order) continue;
        reduceIssue(
          state,
          terrainData,
          unit.id,
          order.kind,
          order.targetHex,
          order.targetUnitId,
          0,
          order.provenance,
          order.summary,
          "subordinates",
          { taskOwner: owner.owner, taskId: activeTask.id, taskKind: activeTask.kind }
        );
        issuedCount += 1;
      }
    }

    subordinateState.reports[owner.owner] = buildSubordinateReport(
      state,
      actor.id,
      owner,
      ownerUnits,
      activeTask,
      actorView,
      issuedCount,
      groupPlan,
      subordinateState.reports[owner.owner] || null
    );
  }
}

function runExecutorPass(state, terrainData, actor, executorState, friendlyUnits = null) {
  const actorView = state.perceptionState?.[actor.id] || { detectedUnits: [], contactUnits: [] };
  const visibleEnemyIds = new Set([...(actorView.detectedUnits || []), ...(actorView.contactUnits || [])]);
  const actorUnits = friendlyUnits || (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed" && !unit.embarkedIn);
  executorState.reactions = Array.isArray(executorState.reactions) ? executorState.reactions : [];

  for (const unit of actorUnits) {
    if (!isUnitReleased(unit, state.game.elapsedMs || 0)) continue;
    if (unit.modeState?.reserveState === "held") continue;

    if (maybeResumeBlockedAdvance(state, terrainData, unit)) {
      executorState.reactions.push({
        atMs: state.game.elapsedMs,
        unitId: unit.id,
        type: "resume-blocked-advance",
      });
      continue;
    }

    const localEnemy = findNearestUnitByIdList(unit, state.units || [], visibleEnemyIds);
    const localProvenance = localEnemy
      ? (actorView.detectedUnits?.includes(localEnemy.id) ? "visible" : "contact")
      : "doctrine";

    if (
      unit.modeState?.currentCommand?.kind !== "withdraw"
      && ((unit.modeState?.suppression || 0) >= 0.95 || (((unit.strength ?? 100) < 20 || (unit.morale ?? 100) < 18) && isUnderFire(unit, state.game.elapsedMs)))
    ) {
      const fallback = findNearestFriendlyAnchor(unit, friendlyUnits);
      if (fallback) {
        reduceIssue(
          state,
          terrainData,
          unit.id,
          "withdraw",
          fallback,
          null,
          0,
          localProvenance,
          "Breaking contact after a local combat shock.",
          "executors",
          { taskOwner: "executor", taskKind: "reaction" }
        );
        executorState.reactions.push({
          atMs: state.game.elapsedMs,
          unitId: unit.id,
          type: "combat-shock-withdraw",
        });
        continue;
      }
    }

    if (isHelicopter(unit) && (unit.fuel ?? 100) <= 15 && unit.modeState?.currentCommand?.kind !== "withdraw") {
      const fallback = findNearestFriendlyAnchor(unit, friendlyUnits) || unit.modeState?.settledHex || unit.position;
      if (fallback) {
        reduceIssue(
          state,
          terrainData,
          unit.id,
          "move",
          fallback,
          null,
          0,
          "doctrine",
          "Returning to refuel before the aircraft runs dry.",
          "executors",
          { taskOwner: "executor", taskKind: "refuel" }
        );
        executorState.reactions.push({
          atMs: state.game.elapsedMs,
          unitId: unit.id,
          type: "refuel-return",
        });
      }
    }
  }

  trimArray(executorState.reactions, getMaxLogItems(state));
}

function mergeAiProfileOverrides(profile, overrides = {}) {
  if (!overrides || typeof overrides !== "object") return { ...(profile || {}) };
  return {
    ...(profile || {}),
    ...overrides,
    terrainPreferences: {
      ...(profile?.terrainPreferences || {}),
      ...(overrides?.terrainPreferences || {}),
    },
  };
}

function getDirectiveTuning(directives, path, fallback) {
  let current = directives?.tuning || RTS_AI_EXPERIMENT_TUNING_DEFAULTS;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }
  return current ?? fallback;
}

function resolveActorAiRuntimeConfig(state, actor) {
  const scenarioOptions = state.scenario?.rtsOptions || {};
  const actorConfig = actor?.aiConfig || {};
  const goalModel = normalizeRtsAiGoalModel(actorConfig.aiGoalModel ?? scenarioOptions.aiGoalModel ?? RTS_AI_GOAL_MODEL_DEFAULT);
  const variationMode = normalizeRtsAiVariationMode(actorConfig.aiVariationMode ?? scenarioOptions.aiVariationMode ?? RTS_AI_VARIATION_MODE_DEFAULT);
  const variationConfig = normalizeRtsAiVariationConfig({
    ...(scenarioOptions.aiVariationConfig || RTS_AI_VARIATION_DEFAULTS),
    ...(actorConfig.aiVariationConfig || {}),
  });
  const experimentTuning = normalizeRtsAiExperimentTuning({
    ...(scenarioOptions.aiExperimentTuning || {}),
    ...(actorConfig.experimentTuning || {}),
  });
  const profileOverrides = mergeAiProfileOverrides({}, {
    ...(scenarioOptions.aiProfileOverrides || {}),
    ...(actorConfig.profileOverrides || {}),
  });
  return {
    goalModel,
    variationMode,
    variationConfig,
    experimentTuning,
    profileOverrides,
  };
}

function buildZeroVariationDrift() {
  return Object.fromEntries(RTS_VARIATION_COMPONENTS.map((component) => [component, 0]));
}

function getActorVariationState(state, actorId) {
  state.ai = state.ai || {};
  state.ai.variation = state.ai.variation || {};
  const existing = state.ai.variation[actorId] || {};
  const drift = {
    ...buildZeroVariationDrift(),
    ...(existing.drift || {}),
  };
  const lastNoise = {
    ...buildZeroVariationDrift(),
    ...(existing.lastNoise || {}),
  };
  const variationState = {
    decisionCounters: existing.decisionCounters || {},
    drift,
    lastNoise,
    lastUpdatedAtMs: existing.lastUpdatedAtMs ?? null,
    lastMode: existing.lastMode || null,
    lastGoalModel: existing.lastGoalModel || null,
  };
  state.ai.variation[actorId] = variationState;
  return variationState;
}

function hashDeterministicString(text, seed = 2166136261) {
  let hash = seed >>> 0;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicRandomFromSeed(seed) {
  let t = (seed + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function nextAiDecisionRandom(state, actorId, subsystem) {
  const variationState = getActorVariationState(state, actorId);
  const decisionCounters = variationState.decisionCounters || {};
  const counter = decisionCounters[subsystem] || 0;
  decisionCounters[subsystem] = counter + 1;
  variationState.decisionCounters = decisionCounters;
  const baseSeed = hashDeterministicString(
    `${state.game?.rngSeed || 1}|${actorId}|${subsystem}|${counter}`,
    (state.game?.rngSeed || 1) >>> 0
  );
  return {
    value: deterministicRandomFromSeed(baseSeed),
    counter,
    seed: baseSeed >>> 0,
  };
}

function isHybridVariationEnabled(directives) {
  return directives?.variationMode === "hybrid";
}

function updateActorVariationDrift(state, actorId, directives) {
  const variationState = getActorVariationState(state, actorId);
  const zeroDrift = buildZeroVariationDrift();
  variationState.lastMode = directives?.variationMode || RTS_AI_VARIATION_MODE_DEFAULT;
  variationState.lastGoalModel = directives?.goalModel || RTS_AI_GOAL_MODEL_DEFAULT;
  if (!isHybridVariationEnabled(directives)) {
    variationState.drift = zeroDrift;
    variationState.lastNoise = zeroDrift;
    variationState.lastUpdatedAtMs = state.game?.elapsedMs || 0;
    return variationState;
  }
  const config = directives?.variationConfig || RTS_AI_VARIATION_DEFAULTS;
  const previous = {
    ...zeroDrift,
    ...(variationState.drift || {}),
  };
  const nextDrift = {};
  const lastNoise = {};
  for (const component of RTS_VARIATION_COMPONENTS) {
    const roll = nextAiDecisionRandom(state, actorId, `variation:${component}`);
    const noise = roundMetric((roll.value * 2) - 1);
    nextDrift[component] = roundMetric(clamp(
      (previous[component] || 0) * config.driftDecay + noise * config.driftSigma,
      -config.driftClamp,
      config.driftClamp
    ));
    lastNoise[component] = noise;
  }
  variationState.drift = nextDrift;
  variationState.lastNoise = lastNoise;
  variationState.lastUpdatedAtMs = state.game?.elapsedMs || 0;
  return variationState;
}

function buildVariationTelemetry(variationState, directives) {
  return {
    goalModel: directives?.goalModel || RTS_AI_GOAL_MODEL_DEFAULT,
    variationMode: directives?.variationMode || RTS_AI_VARIATION_MODE_DEFAULT,
    variationConfig: directives?.variationConfig || RTS_AI_VARIATION_DEFAULTS,
    drift: {
      ...buildZeroVariationDrift(),
      ...(variationState?.drift || {}),
    },
    noiseOffsets: {
      ...buildZeroVariationDrift(),
      ...(variationState?.lastNoise || {}),
    },
    updatedAtMs: variationState?.lastUpdatedAtMs ?? null,
  };
}

function buildAiDirectives(state, actor) {
  const baseProfile = getAiProfile(actor.aiConfig?.profile || "balanced");
  const budget = getThinkBudgetConfig(actor.aiConfig?.thinkBudget || "standard");
  const reservePolicy = actor.aiConfig?.reservePolicy || "balanced";
  const releasePolicy = actor.aiConfig?.releasePolicy || "staged";
  const runtimeConfig = resolveActorAiRuntimeConfig(state, actor);
  const profile = mergeAiProfileOverrides(baseProfile, runtimeConfig.profileOverrides);
  const reserveTuning = runtimeConfig.experimentTuning?.commander?.reserve || {};
  const cadenceFactor = budget.id === "fast" ? 1.35 : budget.id === "deliberate" ? 0.8 : 1;
  const reservePatience = profile.reservePatience || 0.5;
  const reserveRatio = reservePolicy === "aggressive"
    ? Math.max(0.08, profile.reserveRatio + (reserveTuning.aggressiveRatioDelta ?? -0.12))
    : reservePolicy === "conservative"
      ? Math.min(0.45, profile.reserveRatio + (reserveTuning.conservativeRatioDelta ?? 0.12))
      : profile.reserveRatio;
  const baseReleaseThreshold = releasePolicy === "immediate"
    ? (reserveTuning.immediateReleaseThreshold ?? 0)
    : releasePolicy === "staged"
      ? (reserveTuning.stagedReleaseThreshold ?? 0.55)
      : (reserveTuning.conservativeReleaseThreshold ?? 0.8);
  const releaseThreshold = clamp(
    baseReleaseThreshold + ((reservePatience - 0.5) * (reserveTuning.reservePatienceReleaseScale ?? 0.35)),
    0,
    1.2
  );
  return {
    profile,
    budget,
    reservePolicy,
    releasePolicy,
    goalModel: runtimeConfig.goalModel,
    variationMode: runtimeConfig.variationMode,
    variationConfig: runtimeConfig.variationConfig,
    tuning: runtimeConfig.experimentTuning,
    reserveRatio,
    releaseThreshold,
    minimumReserveHoldMs: Math.round(
      (reserveTuning.minimumHoldBaseMs ?? 15000) + reservePatience * (reserveTuning.minimumHoldPatienceMs ?? 60000)
    ),
    directorCadenceMs: Math.max(12000, Math.round(RTS_DIRECTOR_BASE_CADENCE_MS * cadenceFactor)),
    subordinateCadenceMs: Math.max(3000, Math.round(RTS_SUBORDINATE_BASE_CADENCE_MS * cadenceFactor)),
    commanderCadenceMs: Math.max(8000, Math.round(RTS_COMMANDER_BASE_CADENCE_MS * cadenceFactor)),
  };
}

function buildReserveSet(friendlyUnits, directives) {
  const reserveCandidates = (friendlyUnits || [])
    .filter((unit) => !["headquarters", "logistics", "artillery"].includes(unit.type) && !isScreenCapableUnit(unit))
    .sort((left, right) => {
      const leftScore = (left.strength ?? 100) + (left.readiness ?? 100);
      const rightScore = (right.strength ?? 100) + (right.readiness ?? 100);
      return rightScore - leftScore;
    });
  const reserveCount = Math.max(0, Math.floor(reserveCandidates.length * directives.reserveRatio));
  return new Set(reserveCandidates.slice(0, reserveCount).map((unit) => unit.id));
}

function shouldReleaseReserves(actorView, objectives, actorId, state, directorPacket, directives) {
  if (directives.releasePolicy === "immediate") return true;
  const visiblePressure = ((actorView.detectedUnits?.length || 0) + (actorView.contactUnits?.length || 0)) / Math.max(1, (state.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed").length);
  const objectiveLosses = (objectives || []).filter((objective) => state.truthState?.objectives?.[objective.hex]?.controller && state.truthState.objectives[objective.hex].controller !== actorId).length;
  const objectivePressure = (objectives || []).length > 0 ? objectiveLosses / objectives.length : 0;
  const threatenedZones = directorPacket?.threatenedZones?.length || 0;
  const cutOffAlerts = directorPacket?.cutOffAlerts?.length || 0;
  const forcedByDirector = directorPacket?.pressure === "recover" || threatenedZones > 0 || cutOffAlerts > 0;
  if (forcedByDirector) return true;
  if ((state.game?.elapsedMs || 0) < (directives.minimumReserveHoldMs || 0)) return false;
  return visiblePressure >= directives.releaseThreshold || objectivePressure >= directives.releaseThreshold;
}

function selectScoredCandidateForActor(state, actorId, subsystem, candidates, directives, {
  closeGapThreshold = 3,
  closeGapRatio = 0.15,
} = {}) {
  const ranked = (candidates || [])
    .filter((candidate) => candidate && Number.isFinite(candidate.score))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.id || left.label || "").localeCompare(String(right.id || right.label || ""));
    });
  if (ranked.length === 0) {
    return {
      selected: null,
      mode: "none",
      sampled: false,
      branch: "empty",
      sampledCandidates: [],
      topTwoGap: null,
      relativeGap: null,
    };
  }
  const top = ranked[0];
  const second = ranked[1] || null;
  const topTwoGap = second ? roundMetric(top.score - second.score) : Number.POSITIVE_INFINITY;
  const relativeGap = second
    ? roundMetric(topTwoGap / Math.max(1, Math.abs(top.score)))
    : Number.POSITIVE_INFINITY;
  const shouldSample = Boolean(state && actorId)
    && isHybridVariationEnabled(directives)
    && ranked.length > 1
    && (topTwoGap <= closeGapThreshold || relativeGap <= closeGapRatio);
  if (!shouldSample) {
    return {
      selected: top,
      mode: "deterministic",
      sampled: false,
      branch: "greedy",
      sampledCandidates: ranked.slice(0, directives?.variationConfig?.softmaxTopN || RTS_AI_VARIATION_DEFAULTS.softmaxTopN).map((candidate) => ({
        id: candidate.id || candidate.label || null,
        label: candidate.label || candidate.id || null,
        score: roundMetric(candidate.score),
        noiseOffset: 0,
        combinedScore: roundMetric(candidate.score),
      })),
      topTwoGap,
      relativeGap,
      temperature: directives?.variationConfig?.temperature || RTS_AI_VARIATION_DEFAULTS.temperature,
    };
  }
  const topN = directives?.variationConfig?.softmaxTopN || RTS_AI_VARIATION_DEFAULTS.softmaxTopN;
  const temperature = Math.max(0.001, directives?.variationConfig?.temperature || RTS_AI_VARIATION_DEFAULTS.temperature);
  const sampledCandidates = ranked.slice(0, topN).map((candidate, index) => {
    const roll = nextAiDecisionRandom(state, actorId, `choice:${subsystem}:${index}`);
    const u = clamp(roll.value, 1e-6, 1 - 1e-6);
    const noiseOffset = -Math.log(-Math.log(u));
    return {
      ...candidate,
      noiseOffset: roundMetric(noiseOffset),
      combinedScore: roundMetric((candidate.score / temperature) + noiseOffset),
    };
  }).sort((left, right) => {
    if (right.combinedScore !== left.combinedScore) return right.combinedScore - left.combinedScore;
    return String(left.id || left.label || "").localeCompare(String(right.id || right.label || ""));
  });
  return {
    selected: sampledCandidates[0],
    mode: "sampled",
    sampled: true,
    branch: "temperature",
    sampledCandidates: sampledCandidates.map((candidate) => ({
      id: candidate.id || candidate.label || null,
      label: candidate.label || candidate.id || null,
      score: roundMetric(candidate.score),
      noiseOffset: candidate.noiseOffset,
      combinedScore: candidate.combinedScore,
    })),
    topTwoGap,
    relativeGap,
    temperature,
  };
}

function getDirectiveDrift(directives) {
  return {
    ...buildZeroVariationDrift(),
    ...(directives?.variation?.drift || {}),
  };
}

function selectEngagementCommandDetailed(state, actorId, unit, directives, directorPacket = null) {
  const breakthroughWeight = directorPacket?.packageWeights?.breakthrough || 0;
  const stabilizeWeight = directorPacket?.packageWeights?.stabilize || 0;
  const drift = getDirectiveDrift(directives);
  const commandTuning = directives?.tuning?.command || {};
  const aggression = directives.profile.aggression
    + breakthroughWeight * 0.18
    - stabilizeWeight * 0.16
    + drift.tempo * (commandTuning.engagementTempoWeight ?? 0.45)
    - drift.caution * (commandTuning.engagementCautionWeight ?? 0.28);
  const dangerTolerance = directives.profile.dangerTolerance
    + breakthroughWeight * 0.1
    - stabilizeWeight * 0.08
    + drift.tempo * (commandTuning.engagementDangerTempoWeight ?? 0.25)
    - drift.caution * (commandTuning.engagementDangerCautionWeight ?? 0.32);
  if (unit.type === "artillery") {
    return {
      commandKind: "hold",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "hold", label: "hold", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  if (isScreenCapableUnit(unit) && directives.profile.reconBias > (commandTuning.reconScreenThreshold ?? 1)) {
    return {
      commandKind: "screen",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "screen", label: "screen", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  const choice = selectScoredCandidateForActor(state, actorId, "engagement-command", [
    {
      id: "assault",
      label: "assault",
      score: roundMetric(6 + aggression * 7.4 + dangerTolerance * 2.4 + breakthroughWeight * 2.6 - stabilizeWeight * 0.8),
    },
    {
      id: "attack_move",
      label: "attack_move",
      score: roundMetric(6.2 + aggression * 6.6 + (1 - Math.abs(dangerTolerance - 0.55)) * 1.8 + drift.support * 0.8),
    },
  ], directives);
  return {
    commandKind: choice.selected?.id || "attack_move",
    choice,
  };
}

function selectEngagementCommand(unit, directives, directorPacket = null) {
  return selectEngagementCommandDetailed(null, null, unit, directives, directorPacket).commandKind;
}

function selectObjectiveCommandDetailed(state, actorId, unit, directives, directorPacket = null) {
  const breakthroughWeight = directorPacket?.packageWeights?.breakthrough || 0;
  const stabilizeWeight = directorPacket?.packageWeights?.stabilize || 0;
  const drift = getDirectiveDrift(directives);
  const commandTuning = directives?.tuning?.command || {};
  const aggression = directives.profile.aggression
    + breakthroughWeight * 0.18
    - stabilizeWeight * 0.14
    + drift.tempo * (commandTuning.objectiveTempoWeight ?? 0.42)
    - drift.caution * (commandTuning.objectiveCautionWeight ?? 0.28);
  const dangerTolerance = directives.profile.dangerTolerance
    + breakthroughWeight * 0.12
    - stabilizeWeight * 0.1
    + drift.tempo * (commandTuning.objectiveDangerTempoWeight ?? 0.2)
    - drift.caution * (commandTuning.objectiveDangerCautionWeight ?? 0.35);
  if (unit.type === "artillery") {
    return {
      commandKind: "hold",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "hold", label: "hold", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  if (isScreenCapableUnit(unit) && directives.profile.reconBias > (commandTuning.reconScreenThreshold ?? 1)) {
    return {
      commandKind: "screen",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "screen", label: "screen", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  const choice = selectScoredCandidateForActor(state, actorId, "objective-command", [
    {
      id: "assault",
      label: "assault",
      score: roundMetric(5.8 + aggression * 7.2 + dangerTolerance * 3.1 + breakthroughWeight * 2.2 - stabilizeWeight * 1.2),
    },
    {
      id: "move",
      label: "move",
      score: roundMetric(6.3 + aggression * 5.8 + (1 - Math.abs(dangerTolerance - 0.52)) * 2 + drift.flank * 0.9 + drift.reserve * 0.4),
    },
  ], directives);
  return {
    commandKind: choice.selected?.id || "move",
    choice,
  };
}

function selectObjectiveCommand(unit, directives, directorPacket = null) {
  return selectObjectiveCommandDetailed(null, null, unit, directives, directorPacket).commandKind;
}

function resolveTimedVictory(scores, livingByActor) {
  const rankedScores = Object.entries(scores || {}).sort((left, right) => right[1] - left[1]);
  if (rankedScores.length === 0) {
    return { winner: "draw" };
  }
  if (rankedScores.length === 1 || rankedScores[0][1] > rankedScores[1][1]) {
    return { winner: rankedScores[0][0] };
  }
  const rankedLiving = Object.entries(livingByActor || {}).sort((left, right) => right[1] - left[1]);
  if (rankedLiving.length === 0 || rankedLiving.length === 1 || rankedLiving[0][1] > rankedLiving[1][1]) {
    return { winner: rankedLiving[0]?.[0] || "draw" };
  }
  return { winner: "draw" };
}

function reduceIssue(state, terrainData, unitId, kind, targetHex, targetUnitId, queueSlot, provenance, summary, source = "commander", details = null) {
  const command = {
    id: `ai_${state.game.elapsedMs}_${unitId}_${kind}`,
    kind,
    issuedAtMs: state.game.elapsedMs,
    unitIds: [unitId],
    targetHex,
    targetUnitId,
    waypoints: [],
    queueSlot,
  };
  const next = reduceRtsCommand(state, terrainData, command, "ai");
  Object.assign(state, next);
  const liveUnit = state.units.find((unit) => unit.id === unitId);
  if (liveUnit) {
    liveUnit.modeState.currentTaskSource = details?.taskOwner || source;
    liveUnit.modeState.assignedTaskId = details?.taskId || liveUnit.modeState.assignedTaskId || null;
    liveUnit.modeState.lastDecision = {
      atMs: state.game.elapsedMs,
      source,
      provenance,
      summary,
      details,
    };
  }
  if (isAiDiaryEnabled(state)) {
    pushAiDiaryEntry(state, {
      actorId: liveUnit?.actor || null,
      unitId,
      source,
      kind: "order_issue",
      summary: `Issued ${formatCommandLabel(kind)}${targetHex ? ` toward ${targetHex}` : ""}${targetUnitId ? ` against ${targetUnitId}` : ""}.`,
      provenance,
      details: {
        targetHex,
        targetUnitId,
        queueSlot,
        taskOwner: details?.taskOwner || source,
        taskId: details?.taskId || null,
        command: {
          id: command.id,
          kind: command.kind,
          issuedAtMs: command.issuedAtMs,
          targetHex: command.targetHex,
          targetUnitId: command.targetUnitId,
          queueSlot: command.queueSlot,
        },
      },
    });
  }
  pushAiDecision(state, liveUnit?.actor || null, unitId, provenance, source, summary, details);
}

function updateDirectorState(state, actor, directorState, directives) {
  const variationState = updateActorVariationDrift(state, actor.id, directives);
  directives.variation = buildVariationTelemetry(variationState, directives);
  const metrics = computeDirectorMetrics(state, actor.id);
  if (directorState.lastStateSignature === metrics.stateSignature) {
    metrics.staleMs = Math.max(0, (state.game.elapsedMs || 0) - (directorState.lastStateChangeAtMs || 0));
  } else {
    directorState.lastStateSignature = metrics.stateSignature;
    directorState.lastStateChangeAtMs = state.game.elapsedMs || 0;
    metrics.staleMs = 0;
  }
  const evidence = computeDirectorEvidence(directorState.evidence || {}, metrics, directives, variationState);
  const packageWeights = computeDirectorWeights(evidence);
  const previousActive = new Set(directorState.activePackages || []);
  const drift = variationState.drift || buildZeroVariationDrift();
  const thresholds = {
    breakthrough: {
      on: clamp(1.05 - Math.max(0, drift.tempo) * 0.18 - Math.max(0, drift.flank) * 0.08, 0.78, 1.15),
      off: clamp(0.45 - Math.max(0, drift.tempo) * 0.08, 0.25, 0.55),
    },
    stabilize: {
      on: clamp(1.05 - Math.max(0, drift.caution) * 0.12 - Math.max(0, drift.reserve) * 0.06, 0.82, 1.18),
      off: clamp(0.45 - Math.max(0, drift.caution) * 0.06, 0.25, 0.55),
    },
    probe: {
      on: clamp(0.95 - Math.max(0, drift.flank) * 0.12, 0.7, 1),
      off: clamp(0.4 - Math.max(0, drift.flank) * 0.05, 0.2, 0.45),
    },
  };
  const activePackages = Object.entries(evidence)
    .filter(([key, value]) => previousActive.has(key) ? value > thresholds[key].off : value >= thresholds[key].on)
    .map(([key]) => key);
  const packet = buildDirectorPacket(state, actor, metrics, packageWeights, activePackages, directives, variationState);
  directorState.metrics = metrics;
  directorState.evidence = evidence;
  directorState.activePackages = activePackages;
  directorState.packet = packet;
  directorState.history = Array.isArray(directorState.history) ? directorState.history : [];
  directorState.history.push({
    atMs: state.game.elapsedMs,
    pressure: packet.pressureAssessment || packet.pressure,
    pressureAssessment: packet.pressureAssessment || packet.pressure,
    primaryZones: packet.primaryZones,
    campaignObjectiveZones: packet.campaignObjectiveZones,
    secondaryZones: packet.secondaryZones,
    supportingZones: packet.supportingZones,
    threatenedZones: packet.threatenedZones,
    opportunityZones: packet.opportunityZones,
    reserveZones: packet.reserveZones,
    frontierZoneIds: packet.frontierZoneIds,
    currentPhaseDepthBudget: packet.currentPhaseDepthBudget,
    suggestedAxes: packet.suggestedAxes || [],
    campaignObjectives: packet.campaignObjectives || [],
    supportingAxes: packet.supportingAxes || [],
    risks: packet.risks || [],
    opportunities: packet.opportunities || [],
    alerts: packet.alerts || [],
    confidence: packet.confidence ?? null,
    activePackages,
    packageWeights,
    goalModel: packet.goalModel,
    variationMode: packet.variationMode,
    variation: packet.variation,
    primaryChoice: packet.primaryChoice,
    strategicIntent: packet.strategicIntent,
  });
  trimArray(directorState.history, getMaxLogItems(state));
  state.telemetry.directorPackets.push({
    atMs: state.game.elapsedMs,
    actorId: actor.id,
    pressure: packet.pressureAssessment || packet.pressure,
    pressureAssessment: packet.pressureAssessment || packet.pressure,
    primaryZones: packet.primaryZones,
    campaignObjectiveZones: packet.campaignObjectiveZones,
    secondaryZones: packet.secondaryZones,
    supportingZones: packet.supportingZones,
    threatenedZones: packet.threatenedZones,
    opportunityZones: packet.opportunityZones,
    reserveZones: packet.reserveZones,
    frontierZoneIds: packet.frontierZoneIds,
    currentPhaseDepthBudget: packet.currentPhaseDepthBudget,
    suggestedAxes: packet.suggestedAxes || [],
    campaignObjectives: packet.campaignObjectives || [],
    supportingAxes: packet.supportingAxes || [],
    risks: packet.risks || [],
    opportunities: packet.opportunities || [],
    alerts: packet.alerts || [],
    confidence: packet.confidence ?? null,
    activePackages,
    packageWeights,
    metrics,
    replanReason: packet.replanReason,
    goalModel: packet.goalModel,
    variationMode: packet.variationMode,
    variation: packet.variation,
    primaryChoice: packet.primaryChoice,
    strategicIntent: packet.strategicIntent,
  });
  trimArray(state.telemetry.directorPackets, getMaxLogItems(state));
}

function buildDirectorPacket(state, actor, metrics, packageWeights, activePackages, directives, variationState) {
  const actorId = actor.id;
  const zoneScores = scoreZonesForDirector(state, actorId, packageWeights, activePackages, directives);
  const primaryChoiceTuning = getDirectiveTuning(directives, ["director", "primaryChoice"], {});
  const defeatInDetailTuning = getDirectiveTuning(directives, ["director", "defeatInDetail"], {});
  const frontierContext = computeDirectorFrontierContext(state, actorId, metrics, packageWeights, activePackages);
  const campaignObjective = zoneScores.attack.find(isDirectorPrimaryCandidate)
    || zoneScores.exploit.find(isDirectorPrimaryCandidate)
    || zoneScores.attack[0]
    || zoneScores.exploit[0]
    || zoneScores.stabilize[0]
    || zoneScores.defend[0]
    || null;
  const reachableAttack = filterDirectorEntriesByFrontier(zoneScores.attack, frontierContext, { maxDepth: frontierContext.primaryDepthBudget });
  const reachableExploit = filterDirectorEntriesByFrontier(zoneScores.exploit, frontierContext, { maxDepth: frontierContext.primaryDepthBudget });
  const reachableSupporting = filterDirectorEntriesByFrontier(zoneScores.supporting, frontierContext, {
    maxDepth: frontierContext.supportDepthBudget,
    includeFriendly: true,
  });
  const reachableProbe = filterDirectorEntriesByFrontier(zoneScores.probe, frontierContext, { maxDepth: frontierContext.probeDepthBudget });
  const primaryCandidates = dedupeDirectorEntries([
    ...(activePackages.includes("stabilize") ? zoneScores.stabilize.slice(0, 3) : []),
    ...reachableAttack.slice(0, 3),
    ...reachableExploit.slice(0, 3),
    ...zoneScores.defend.slice(0, 2),
  ])
    .filter(isDirectorPrimaryCandidate)
    .map((entry) => ({
      id: entry.zoneId,
      label: entry.zone?.sourceName || entry.zoneId,
      score: computeDirectorPrimaryChoiceScore(entry, activePackages, metrics, directives),
      entry,
    }));
  const tunedPrimaryChoice = selectScoredCandidateForActor(state, actorId, "director-primary-zone", primaryCandidates, directives, {
    closeGapThreshold: primaryChoiceTuning.closeGapThreshold ?? 3,
    closeGapRatio: primaryChoiceTuning.closeGapRatio ?? 0.15,
  });
  const preferredPrimary = tunedPrimaryChoice.selected?.entry || null;
  const primary = preferredPrimary
    || zoneScores.stabilize[0]
    || zoneScores.defend[0]
    || reachableAttack[0]
    || reachableExploit[0]
    || campaignObjective
    || null;
  const secondary = dedupeDirectorEntries([...reachableAttack, ...reachableExploit])
    .filter((entry) => entry.zoneId !== primary?.zoneId)
    .slice(0, 2);
  const hold = zoneScores.defend.filter((entry) => entry.zoneId !== primary?.zoneId).slice(0, 3);
  const opportunity = reachableExploit.slice(0, 3);
  const supporting = reachableSupporting.filter((entry) => entry.zoneId !== primary?.zoneId).slice(0, 2);
  const reserve = zoneScores.reserve.slice(0, 2);
  const pressure = activePackages.includes("stabilize")
    ? "recover"
    : activePackages.includes("breakthrough")
      ? "surge"
      : activePackages.includes("probe")
        ? "probe"
        : metrics.friendlyStrength >= metrics.enemyStrength
          ? "maintain"
          : "recover";
  const replanReason = activePackages.includes("stabilize")
    ? (metrics.cutOffZones > 0 ? "encirclement-risk" : "pressure-spike")
    : activePackages.includes("breakthrough")
      ? "favorable-window"
      : activePackages.includes("probe")
        ? "stale-front"
        : "steady-state";
  const summarizeScore = (entry) => roundMetric(Math.max(entry?.attack || 0, entry?.defend || 0, entry?.exploit || 0, entry?.supporting || 0, entry?.probe || 0));
  const toAdviceEntry = (entry, role, extras = {}) => ({
    zoneId: entry.zoneId,
    score: extras.score ?? summarizeScore(entry),
    role,
    urgency: extras.urgency ?? extras.score ?? summarizeScore(entry),
    horizon: extras.horizon || "near",
    kind: extras.kind || null,
    reason: extras.reason || [role],
  });
  const suggestedAxes = [
    ...(primary ? [toAdviceEntry(primary, "main", { score: summarizeScore(primary), reason: ["highest_reachable_axis"] })] : []),
    ...secondary.map((entry) => toAdviceEntry(entry, "secondary", { score: summarizeScore(entry), reason: ["supporting_axis"] })),
  ];
  const campaignObjectives = campaignObjective ? [toAdviceEntry(campaignObjective, "campaign", {
    score: summarizeScore(campaignObjective),
    horizon: "long",
    reason: ["campaign_objective"],
  })] : [];
  const supportingAxes = supporting.map((entry) => toAdviceEntry(entry, "support", {
    score: summarizeScore(entry),
    reason: ["support_shaping"],
  }));
  const risks = zoneScores.stabilize.slice(0, 3).map((entry) => toAdviceEntry(entry, "risk", {
    score: summarizeScore(entry),
    urgency: clamp((entry.defend || 0) / Math.max(1, (zoneScores.stabilize[0]?.defend || 1)), 0.35, 1),
    kind: entry.snapshot.tags?.includes("encircled") ? "cut_off" : (entry.snapshot.tags?.includes("salient") ? "salient" : "threatened"),
    reason: entry.snapshot.tags?.filter(Boolean) || ["pressure_spike"],
  }));
  const defeatInDetailZones = dedupeDirectorEntries([...reachableAttack, ...reachableExploit, ...reachableProbe])
    .map((entry) => ({
      entry,
      score: computeDefeatInDetailOpportunity(entry, metrics, directives),
    }))
    .filter((row) => row.score > (defeatInDetailTuning.opportunityThreshold ?? 0.6))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const opportunities = opportunity.map((entry) => toAdviceEntry(entry, "opportunity", {
    score: summarizeScore(entry),
    reason: [
      "weak_hold",
      ...(computeDefeatInDetailOpportunity(entry, metrics, directives) > (defeatInDetailTuning.opportunityThreshold ?? 0.6) ? ["defeat_in_detail"] : []),
    ],
  })).concat(
    defeatInDetailZones
      .filter((row) => !opportunity.some((entry) => entry.zoneId === row.entry.zoneId))
      .map((row) => toAdviceEntry(row.entry, "opportunity", {
        score: roundMetric(Math.max(summarizeScore(row.entry), row.score * 4)),
        kind: "defeat_in_detail",
        reason: ["defeat_in_detail"],
      }))
  );
  const alerts = [
    ...risks.map((entry) => ({
      kind: entry.kind || "threatened",
      zoneId: entry.zoneId,
      severity: entry.kind === "cut_off" ? "existential" : "operational",
      urgency: entry.urgency,
      reason: entry.reason,
    })),
  ];
  const confidence = clamp(
    0.4 + ((summarizeScore(primary || campaignObjective || {}) - summarizeScore(secondary[0] || {})) * 0.03) + ((metrics.strengthRatio || 1) - 1) * 0.12,
    0.2,
    0.95
  );
  const strategicIntent = summarizeStrategicIntent(primary, directives, metrics);
  return {
    goalModel: directives?.goalModel || RTS_AI_GOAL_MODEL_DEFAULT,
    variationMode: directives?.variationMode || RTS_AI_VARIATION_MODE_DEFAULT,
    variation: buildVariationTelemetry(variationState, directives),
    primaryZones: primary ? [primary.zoneId] : [],
    campaignObjectiveZones: campaignObjective ? [campaignObjective.zoneId] : [],
    secondaryZones: secondary.map((entry) => entry.zoneId),
    holdZones: hold.map((entry) => entry.zoneId),
    probeZones: reachableProbe.slice(0, 2).map((entry) => entry.zoneId),
    threatenedZones: zoneScores.stabilize.slice(0, 3).map((entry) => entry.zoneId),
    opportunityZones: opportunity.map((entry) => entry.zoneId),
    defeatInDetailZones: defeatInDetailZones.map((row) => row.entry.zoneId),
    reserveZones: reserve.map((entry) => entry.zoneId),
    supportingZones: supporting.map((entry) => entry.zoneId),
    frontierZoneIds: frontierContext.frontierZoneIds,
    currentPhaseDepthBudget: frontierContext.primaryDepthBudget,
    cutOffAlerts: zoneScores.stabilize.filter((entry) => entry.snapshot.tags?.includes("encircled")).map((entry) => entry.zoneId),
    salientAlerts: zoneScores.stabilize.filter((entry) => entry.snapshot.tags?.includes("salient")).map((entry) => entry.zoneId),
    frontageIntent: computeFrontageIntent(metrics, primary, secondary, activePackages),
    pressure,
    pressureAssessment: pressure,
    confidence,
    activePackages,
    packageWeights,
    replanReason,
    metrics,
    suggestedAxes,
    campaignObjectives,
    supportingAxes,
    risks,
    opportunities,
    alerts,
    strategicIntent,
    primaryChoice: {
      mode: tunedPrimaryChoice.mode,
      sampled: tunedPrimaryChoice.sampled,
      branch: tunedPrimaryChoice.branch,
      temperature: tunedPrimaryChoice.temperature,
      topTwoGap: tunedPrimaryChoice.topTwoGap,
      relativeGap: tunedPrimaryChoice.relativeGap,
      selectedZoneId: tunedPrimaryChoice.selected?.id || primary?.zoneId || null,
      selectedLabel: tunedPrimaryChoice.selected?.label || primary?.zone?.sourceName || primary?.zoneId || null,
      sampledCandidates: tunedPrimaryChoice.sampledCandidates || [],
    },
    zoneScores: {
      attack: zoneScores.attack.slice(0, 4).map((entry) => ({ zoneId: entry.zoneId, score: entry.attack })),
      defend: zoneScores.defend.slice(0, 4).map((entry) => ({ zoneId: entry.zoneId, score: entry.defend })),
      exploit: zoneScores.exploit.slice(0, 4).map((entry) => ({ zoneId: entry.zoneId, score: entry.exploit })),
      supporting: zoneScores.supporting.slice(0, 4).map((entry) => ({ zoneId: entry.zoneId, score: entry.supporting })),
    },
    summary: describeDirectorPacket(state, primary, pressure, activePackages, metrics, supporting, campaignObjective, strategicIntent),
  };
}

function computeDirectorFrontierContext(state, actorId, metrics, packageWeights, activePackages) {
  const zoneModel = state.scenario?.zoneModel;
  const zoneSnapshots = state.zoneAnalysis?.perSide?.[actorId] || {};
  const depthByZone = buildDirectorZoneDepthMap(zoneModel, zoneSnapshots);
  const strongBreakthrough = activePackages.includes("breakthrough")
    && (packageWeights?.breakthrough || 0) >= 0.68
    && (metrics?.strengthRatio || 0) >= 1.08;
  const primaryDepthBudget = strongBreakthrough ? DIRECTOR_BREAKTHROUGH_PRIMARY_DEPTH : DIRECTOR_PRIMARY_FRONTIER_DEPTH;
  const supportDepthBudget = strongBreakthrough ? DIRECTOR_BREAKTHROUGH_PRIMARY_DEPTH : DIRECTOR_SUPPORT_FRONTIER_DEPTH;
  const probeDepthBudget = activePackages.includes("probe") ? DIRECTOR_PROBE_FRONTIER_DEPTH : supportDepthBudget;
  const frontierZoneIds = (zoneModel?.zones || [])
    .filter((zone) => {
      const snapshot = zoneSnapshots?.[zone.zoneId];
      const depth = depthByZone[zone.zoneId];
      return snapshot && (snapshot.state === "contested" || (snapshot.state !== "friendly" && depth === 1));
    })
    .map((zone) => zone.zoneId);
  return {
    depthByZone,
    primaryDepthBudget,
    supportDepthBudget,
    probeDepthBudget,
    frontierZoneIds,
  };
}

function buildDirectorZoneDepthMap(zoneModel, zoneSnapshots) {
  const depthByZone = Object.fromEntries((zoneModel?.zones || []).map((zone) => [zone.zoneId, Number.POSITIVE_INFINITY]));
  const seeds = (zoneModel?.zones || [])
    .filter((zone) => {
      const snapshot = zoneSnapshots?.[zone.zoneId];
      return snapshot && (
        snapshot.state === "friendly"
        || snapshot.state === "contested"
        || snapshot.tags?.some((tag) => ["frontline", "transition", "salient", "encircled", "breakthrough"].includes(tag))
      );
    })
    .map((zone) => zone.zoneId);
  const queue = seeds.length > 0
    ? seeds.map((zoneId) => ({ zoneId, depth: 0 }))
    : (zoneModel?.zones || []).map((zone) => ({ zoneId: zone.zoneId, depth: 0 }));
  for (const seed of queue) {
    depthByZone[seed.zoneId] = 0;
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const neighbor of zoneModel?.zoneGraph?.[current.zoneId] || []) {
      const nextDepth = current.depth + 1;
      if (nextDepth >= (depthByZone[neighbor.zoneId] ?? Number.POSITIVE_INFINITY)) continue;
      depthByZone[neighbor.zoneId] = nextDepth;
      queue.push({ zoneId: neighbor.zoneId, depth: nextDepth });
    }
  }
  return depthByZone;
}

function filterDirectorEntriesByFrontier(entries, frontierContext, { maxDepth = DIRECTOR_PRIMARY_FRONTIER_DEPTH, includeFriendly = false } = {}) {
  const filtered = (entries || []).filter((entry) => {
    if (!entry?.snapshot) return false;
    if (entry.snapshot.state === "contested") return true;
    if (includeFriendly && entry.snapshot.state === "friendly") return true;
    const depth = frontierContext?.depthByZone?.[entry.zoneId];
    return Number.isFinite(depth) && depth <= maxDepth;
  });
  if (filtered.length > 0) return filtered;
  const reachable = (entries || []).filter((entry) => Number.isFinite(frontierContext?.depthByZone?.[entry.zoneId]));
  if (reachable.length === 0) return entries || [];
  const nearestDepth = Math.min(...reachable.map((entry) => frontierContext.depthByZone[entry.zoneId]));
  return reachable.filter((entry) => frontierContext.depthByZone[entry.zoneId] === nearestDepth);
}

function dedupeDirectorEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries || []) {
    if (!entry?.zoneId || seen.has(entry.zoneId)) continue;
    seen.add(entry.zoneId);
    result.push(entry);
  }
  return result;
}

function isDirectorPrimaryCandidate(entry) {
  if (!entry?.snapshot) return false;
  if (entry.snapshot.state !== "friendly") return true;
  return entry.snapshot.tags?.some((tag) => ["frontline", "transition", "salient", "encircled", "breakthrough"].includes(tag))
    || (entry.snapshot.controlShare || 0) < 0.8;
}

function updateAiThoughtSnapshots(state, actor, directives, directorState, commanderState, subordinateState) {
  const now = state.game.elapsedMs || 0;
  const thoughtState = state.ai.thoughts?.[actor.id] || { commander: null, director: null, history: [] };
  const lastUpdatedAtMs = Math.max(thoughtState.commander?.atMs || -Infinity, thoughtState.director?.atMs || -Infinity);
  if (lastUpdatedAtMs > -Infinity && (now - lastUpdatedAtMs) < RTS_THOUGHT_INTERVAL_MS) {
    state.ai.thoughts[actor.id] = thoughtState;
    return;
  }

  const directorText = buildDirectorThought(state, actor, directives, directorState);
  const commanderText = buildCommanderThought(state, actor, directives, commanderState, subordinateState, directorState.packet);
  const snapshot = {
    atMs: now,
    actorId: actor.id,
    commander: commanderText,
    director: directorText,
  };

  thoughtState.commander = { atMs: now, text: commanderText };
  thoughtState.director = { atMs: now, text: directorText };
  thoughtState.history = Array.isArray(thoughtState.history) ? thoughtState.history : [];
  thoughtState.history.push(snapshot);
  trimArray(thoughtState.history, getMaxLogItems(state));
  state.ai.thoughts[actor.id] = thoughtState;

  state.telemetry.thoughtSnapshots.push(snapshot);
  trimArray(state.telemetry.thoughtSnapshots, getMaxLogItems(state));
  upsertAiSummary(state, actor.id, { forceHistory: true, reason: "thought_snapshot" });
  if (isAiDiaryEnabled(state)) {
    pushAiDiaryEntry(state, {
      actorId: actor.id,
      source: "thoughts",
      kind: "thought_snapshot",
      summary: "Refreshed commander and director thought snapshot.",
      details: {
        commander: commanderText,
        director: directorText,
      },
    });
  }
}

function buildDirectorThought(state, actor, directives, directorState) {
  const packet = directorState?.packet || null;
  if (!packet) {
    return "I do not have a fresh director packet yet, so I am letting the commander continue on doctrine and existing tasking.";
  }

  const metrics = packet.metrics || directorState?.metrics || {};
  const primaryZoneText = describeZoneList(state, packet.primaryZones || []);
  const supportZoneText = describeZoneList(state, packet.supportingZones || []);
  const targetText = primaryZoneText || "the current front";
  const pressureText = packet.pressure === "surge"
    ? `lean hard into a breakthrough toward ${targetText}`
    : packet.pressure === "recover"
      ? `stabilize the fight around ${targetText}`
      : packet.pressure === "probe"
        ? `probe around ${targetText} until the picture clears`
        : `keep steady pressure across ${targetText}`;
  const objectiveText = describeObjectiveBalance(metrics);
  const packageText = describeThoughtPackages(packet.activePackages || []);
  const reasonText = describeDirectorReplanReason(packet.replanReason);
  const strategicIntentText = packet.strategicIntent?.summary || "Shared map-control pressure is still too flat to favor one zone strongly.";
  const choiceText = packet.primaryChoice?.sampled
    ? `I sampled among close primary-axis options to avoid repeating the exact same opening every run.`
    : "The primary axis was clear enough to choose deterministically.";
  const defeatInDetailText = (packet.defeatInDetailZones || []).length > 0
    ? `While outmatched, I am also watching defeat-in-detail windows around ${describeZoneList(state, packet.defeatInDetailZones)}.`
    : "";

  return [
    `I am trying to ${pressureText}.`,
    `${objectiveText} and our visible strength ratio is ${(metrics.strengthRatio || 0).toFixed(2)}.`,
    supportZoneText ? `I also want supporting control around ${supportZoneText}.` : "I am not seeing a distinct supporting zone that outweighs the main effort yet.",
    strategicIntentText,
    defeatInDetailText,
    packageText
      ? `I am weighting ${packageText} because ${reasonText}.`
      : `I am staying on the baseline package because ${reasonText}.`,
    choiceText,
    `The current commander profile is ${formatDoctrineLabel(directives.profile?.id || actor.aiConfig?.profile || "balanced")}, and the shared goal model is ${packet.goalModel || directives.goalModel || "map control v1"}.`,
  ].join(" ");
}

function buildCommanderThought(state, actor, directives, commanderState, subordinateState, directorPacket) {
  const hypotheses = commanderState?.hypotheses || {};
  const ownerTasks = Object.values(commanderState?.ownerTasks || {})
    .map((queue) => queue?.[0] || null)
    .filter(Boolean);
  const taskSentence = describeCommanderTasks(state, ownerTasks);
  const contactText = describeCommanderIntel(hypotheses.visibleContacts || 0, hypotheses.lastKnownCount || 0);
  const reserveHeld = (state.units || []).filter((unit) => unit.actor === actor.id && unit.modeState?.reserveState === "held").length;
  const reserveText = hypotheses.reserveRelease
    ? "I have released the reserve and I am feeding it into the fight."
    : reserveHeld > 0
      ? `I am still keeping ${reserveHeld} reserve ${reserveHeld === 1 ? "unit" : "units"} back for a sharper trigger.`
      : "Everything available is already committed forward.";
  const suggestedAxes = (directorPacket?.suggestedAxes || []).map((entry) => entry.zoneId || entry).filter(Boolean);
  const supportingAxes = (directorPacket?.supportingAxes || directorPacket?.supportingZones || []).map((entry) => entry.zoneId || entry).filter(Boolean);
  const campaignObjectives = (directorPacket?.campaignObjectives || []).map((entry) => entry.zoneId || entry).filter(Boolean);
  const directorText = suggestedAxes.length > 0
    ? `The director is recommending ${describeZoneList(state, suggestedAxes)}${campaignObjectives.length > 0 ? ` as the near axis toward ${describeZoneList(state, campaignObjectives)}` : ""}, with shaping pressure around ${describeZoneList(state, supportingAxes) || "the adjacent front"}.`
    : "The director is feeding me risk and opportunity assessments without forcing a new axis.";
  const operationText = hypotheses.currentOperation?.goalZoneId
    ? `I am maintaining the ${hypotheses.currentOperation.phase || "current"} operation around ${describeZoneList(state, [hypotheses.currentOperation.goalZoneId])}.`
    : "I am still framing the next operation.";
  const ownerCount = hypotheses.ownerCount || Object.keys(subordinateState?.owners || {}).length || 0;
  const strategicIntentText = directorPacket?.strategicIntent?.summary || null;
  const variationText = directorPacket?.variationMode === "hybrid"
    ? `Variation drift is active at tempo=${directorPacket?.variation?.drift?.tempo ?? 0}, flank=${directorPacket?.variation?.drift?.flank ?? 0}, support=${directorPacket?.variation?.drift?.support ?? 0}, reserve=${directorPacket?.variation?.drift?.reserve ?? 0}, caution=${directorPacket?.variation?.drift?.caution ?? 0}.`
    : "Variation drift is disabled for this commander.";

  return [
    taskSentence || "I am holding the line while I wait for a clearer task.",
    contactText,
    reserveText,
    operationText,
    ownerCount > 0 ? `I am coordinating ${ownerCount} subordinate ${ownerCount === 1 ? "group" : "groups"}.` : "I do not have subordinate groupings formed yet.",
    strategicIntentText,
    `My doctrine is ${formatDoctrineLabel(directives.profile?.id || actor.aiConfig?.profile || "balanced")}, but my shared goal is ${directorPacket?.goalModel || directives.goalModel || "map control v1"}.`,
    variationText,
    directorText,
  ].join(" ");
}

function upsertAiSummary(state, actorId, { forceHistory = false, reason = "update" } = {}) {
  if (!isAiSummaryEnabled(state) || !actorId) return;
  const packet = buildAiSummaryPacket(state, actorId, reason);
  if (!packet) return;
  const summaryState = state.ai.summaries?.[actorId] || { current: null, history: [], lastSnapshotSignature: null };
  summaryState.current = packet;
  summaryState.history = Array.isArray(summaryState.history) ? summaryState.history : [];
  if ((forceHistory || summaryState.history.length === 0) && summaryState.lastSnapshotSignature !== packet.signature) {
    summaryState.history.push(packet);
    trimArray(summaryState.history, MAX_SUMMARY_HISTORY);
    summaryState.lastSnapshotSignature = packet.signature;
  }
  state.ai.summaries[actorId] = summaryState;
}

function buildAiSummaryPacket(state, actorId, reason = "update") {
  const actor = (state.scenario?.actors || []).find((candidate) => candidate.id === actorId);
  if (!actor) return null;
  const runtimeConfig = resolveActorAiRuntimeConfig(state, actor);
  const directorState = state.ai?.directors?.[actorId] || {};
  const commanderState = state.ai?.commanders?.[actorId] || {};
  const subordinateState = state.ai?.subordinates?.[actorId] || {};
  const executorState = state.ai?.executors?.[actorId] || {};
  const directorPacket = directorState.packet || null;
  const hypotheses = commanderState.hypotheses || {};
  const perception = state.perceptionState?.[actorId] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  const livingUnits = (state.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed").length;
  const reserveHeld = (state.units || []).filter((unit) => unit.actor === actorId && unit.modeState?.reserveState === "held").length;
  const ownerCount = Object.keys(subordinateState.owners || {}).length;
  const queuedTasks = Object.values(subordinateState.taskQueues || {}).reduce((sum, queue) => sum + (queue?.length || 0), 0);
  const packetPrimaryZones = (directorPacket?.suggestedAxes || []).map((entry) => entry.zoneId || entry).filter(Boolean);
  const packetSupportingZones = (directorPacket?.supportingAxes || directorPacket?.supportingZones || []).map((entry) => entry.zoneId || entry).filter(Boolean);
  const primaryZones = packetPrimaryZones.length > 0 ? packetPrimaryZones : (hypotheses.directorSuggestedAxes || []);
  const supportingZones = packetSupportingZones.length > 0
    ? packetSupportingZones
    : ((hypotheses.directorSupportingAxes || []).length > 0 ? hypotheses.directorSupportingAxes : (directorPacket?.secondaryZones || []));
  const plannedZones = hypotheses.plannedZones || Object.values(commanderState.ownerZoneTasks || {}).map((task) => task?.zoneId).filter(Boolean);
  const recentDecisions = collectRecentAiDecisions(state, actorId);
  const recentEvents = collectRecentActorEvents(state, actorId);
  const commanderThought = state.ai?.thoughts?.[actorId]?.commander?.text || null;
  const directorThought = state.ai?.thoughts?.[actorId]?.director?.text || null;
  const pressure = directorPacket?.pressureAssessment || directorPacket?.pressure || "steady";
  const packages = directorPacket?.activePackages || [];
  const goalModel = directorPacket?.goalModel || runtimeConfig.goalModel;
  const variationMode = directorPacket?.variationMode || runtimeConfig.variationMode;
  const variation = directorPacket?.variation || null;
  const operation = hypotheses.currentOperation || commanderState.operations?.main || null;
  const overview = [
    primaryZones.length > 0
      ? `Focus ${pressure} into ${describeZoneList(state, primaryZones)}.`
      : `Focus ${pressure} across the current front.`,
    `Goal model: ${goalModel}. Variation: ${variationMode}.`,
    supportingZones.length > 0
      ? `Support shifts around ${describeZoneList(state, supportingZones)}.`
      : null,
    directorPacket?.strategicIntent?.summary || null,
    operation?.goalZoneId
      ? `Current operation: ${operation.phase || "current"} around ${describeZoneList(state, [operation.goalZoneId])}.`
      : null,
    `Enemy picture: ${describeCommanderIntel((perception.detectedUnits?.length || 0) + (perception.contactUnits?.length || 0), Object.keys(perception.lastKnown || {}).length)}`,
    `Force state: ${livingUnits} living units, ${reserveHeld} reserve held, ${ownerCount} subordinate ${ownerCount === 1 ? "group" : "groups"}, ${queuedTasks} queued tasks.`,
    recentDecisions.length > 0
      ? `Recent decisions: ${recentDecisions.map((entry) => `${formatSummaryClock(entry.atMs)} ${entry.source}/${entry.provenance}: ${entry.summary}`).join(" | ")}`
      : "Recent decisions: none logged.",
    recentEvents.length > 0
      ? `Recent battlefield changes: ${recentEvents.map((entry) => `${formatSummaryClock(entry.atMs)} ${entry.message}`).join(" | ")}`
      : "Recent battlefield changes: none tied to this actor.",
  ].filter(Boolean).join(" ");
  const text = [
    overview,
    commanderThought ? `Commander thought: ${commanderThought}` : null,
    directorThought ? `Director thought: ${directorThought}` : null,
  ].filter(Boolean).join("\n\n");
  const signature = JSON.stringify({
    pressure,
    goalModel,
    variationMode,
    primaryZones,
    supportingZones,
    plannedZones,
    packages,
    detected: perception.detectedUnits?.length || 0,
    contacts: perception.contactUnits?.length || 0,
    lastKnown: Object.keys(perception.lastKnown || {}).length,
    reserveHeld,
    ownerCount,
    queuedTasks,
    recentDecisions: recentDecisions.map((entry) => `${entry.atMs}:${entry.source}:${entry.summary}`),
    recentEvents: recentEvents.map((entry) => `${entry.atMs}:${entry.kind}:${entry.message}`),
    commanderThought,
    directorThought,
    variation,
  });
  return {
    atMs: state.game?.elapsedMs || 0,
    actorId,
    actorName: actor.name,
    profile: actor.aiConfig?.profile || "balanced",
    reason,
    pressure,
    goalModel,
    variationMode,
    variation,
    primaryZones,
    supportingZones,
    plannedZones,
    strategicIntent: directorPacket?.strategicIntent || null,
    primaryChoice: directorPacket?.primaryChoice || null,
    defeatInDetailZones: directorPacket?.defeatInDetailZones || [],
    activePackages: packages,
    enemyPicture: {
      detectedCount: perception.detectedUnits?.length || 0,
      contactCount: perception.contactUnits?.length || 0,
      lastKnownCount: Object.keys(perception.lastKnown || {}).length,
    },
    forceState: {
      livingUnits,
      reserveHeld,
      ownerCount,
      queuedTasks,
      executorReactions: executorState.reactions?.length || 0,
    },
    recentDecisions,
    recentEvents,
    commanderThought,
    directorThought,
    text,
    signature,
  };
}

function collectRecentAiDecisions(state, actorId) {
  return (state.ai?.decisionLog || [])
    .filter((entry) => entry.actorId === actorId)
    .slice(-MAX_SUMMARY_RECENT_ITEMS)
    .map((entry) => ({
      atMs: entry.atMs,
      source: entry.source,
      provenance: entry.provenance,
      summary: entry.summary,
    }));
}

function collectRecentActorEvents(state, actorId) {
  const actorUnitIds = new Set((state.units || []).filter((unit) => unit.actor === actorId).map((unit) => unit.id));
  return (state.truthState?.eventLog || [])
    .filter((entry) => eventRelatesToActor(entry, actorId, actorUnitIds))
    .slice(-MAX_SUMMARY_RECENT_ITEMS)
    .map((entry) => ({
      atMs: entry.atMs,
      kind: entry.kind,
      message: entry.message,
    }));
}

function eventRelatesToActor(entry, actorId, actorUnitIds) {
  const details = entry?.details || {};
  if (details.actorId === actorId) return true;
  const relatedUnitIds = [details.unitId, details.attackerId, details.targetId, details.transportId].filter(Boolean);
  return relatedUnitIds.some((unitId) => actorUnitIds.has(unitId));
}

function pushAiDiaryEntry(state, { actorId = null, unitId = null, source = "system", kind = "note", summary = "", provenance = null, details = null }) {
  if (!isAiDiaryEnabled(state)) return;
  if (actorId && !isAiActorId(state, actorId)) return;
  state.ai.diary.push({
    atMs: state.game?.elapsedMs || 0,
    actorId,
    unitId,
    source,
    kind,
    summary,
    provenance,
    details,
  });
}

function recordPerceptionDeltas(state, previousPerception, nextPerception) {
  if (!isAiDiaryEnabled(state) && !isAiSummaryEnabled(state)) return;
  for (const actor of state.scenario?.actors || []) {
    if (actor.controller !== "ai") continue;
    const previous = previousPerception?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
    const current = nextPerception?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
    const gainedDetected = differenceList(current.detectedUnits, previous.detectedUnits);
    const lostDetected = differenceList(previous.detectedUnits, current.detectedUnits);
    const gainedContacts = differenceList(current.contactUnits, previous.contactUnits);
    const lostContacts = differenceList(previous.contactUnits, current.contactUnits);
    const gainedMemory = differenceList(Object.keys(current.lastKnown || {}), Object.keys(previous.lastKnown || {}));
    const lostMemory = differenceList(Object.keys(previous.lastKnown || {}), Object.keys(current.lastKnown || {}));
    if (
      gainedDetected.length === 0
      && lostDetected.length === 0
      && gainedContacts.length === 0
      && lostContacts.length === 0
      && gainedMemory.length === 0
      && lostMemory.length === 0
    ) {
      continue;
    }
    if (isAiSummaryEnabled(state)) {
      upsertAiSummary(state, actor.id, { reason: "perception" });
    }
    if (isAiDiaryEnabled(state)) {
      const parts = [];
      if (gainedDetected.length > 0) parts.push(`detected +${gainedDetected.length} (${describeDiaryUnits(state, gainedDetected)})`);
      if (lostDetected.length > 0) parts.push(`detected -${lostDetected.length} (${describeDiaryUnits(state, lostDetected)})`);
      if (gainedContacts.length > 0) parts.push(`contacts +${gainedContacts.length} (${describeDiaryUnits(state, gainedContacts)})`);
      if (lostContacts.length > 0) parts.push(`contacts -${lostContacts.length} (${describeDiaryUnits(state, lostContacts)})`);
      if (gainedMemory.length > 0) parts.push(`memory +${gainedMemory.length} (${describeDiaryUnits(state, gainedMemory)})`);
      if (lostMemory.length > 0) parts.push(`memory -${lostMemory.length} (${describeDiaryUnits(state, lostMemory)})`);
      pushAiDiaryEntry(state, {
        actorId: actor.id,
        source: "perception",
        kind: "perception_delta",
        summary: `Perception changed: ${parts.join("; ")}.`,
        details: {
          gainedDetected,
          lostDetected,
          gainedContacts,
          lostContacts,
          gainedMemory,
          lostMemory,
        },
      });
    }
  }
}

function differenceList(nextValues = [], previousValues = []) {
  const previous = new Set(previousValues || []);
  return (nextValues || []).filter((value) => !previous.has(value));
}

function describeDiaryUnits(state, unitIds) {
  const names = (unitIds || []).map((unitId) => resolveDiaryUnitName(state, unitId)).filter(Boolean);
  if (names.length === 0) return "none";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function resolveDiaryUnitName(state, unitId) {
  return (state.units || []).find((unit) => unit.id === unitId)?.name || unitId;
}

function resolveDiaryActorId(state, details) {
  if (details?.actorId) return details.actorId;
  const relatedUnitIds = [details?.unitId, details?.attackerId, details?.targetId, details?.transportId].filter(Boolean);
  const actorIds = Array.from(new Set(
    relatedUnitIds
      .map((unitId) => (state.units || []).find((unit) => unit.id === unitId)?.actor || null)
      .filter(Boolean)
  ));
  return actorIds.length === 1 ? actorIds[0] : null;
}

function formatSummaryClock(atMs) {
  const totalSeconds = Math.max(0, Math.floor((atMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function shouldPreserveSubordinateAssignment(assignment) {
  if (!assignment?.owner) return false;
  if (assignment.pinned === true) return true;
  return !AUTO_SUBORDINATE_ASSIGNMENT_SOURCES.has(assignment.source || "");
}

function buildSubordinateAssignments(state, actorId, previousAssignments = {}) {
  const assignments = {};
  const cols = state.terrain?.summary?.cols || 1;
  for (const unit of state.units || []) {
    if (unit.actor !== actorId || unit.status === "destroyed") continue;
    const computed = buildSubordinateOwnerDescriptor(unit, cols);
    const existing = previousAssignments?.[unit.id];
    assignments[unit.id] = shouldPreserveSubordinateAssignment(existing)
      ? { ...computed, ...existing, source: existing.source || computed.source }
      : computed;
  }
  return assignments;
}

function getOwnerSectorBucketForUnit(unit, cols) {
  const pos = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  if (!pos) return "center";
  const third = cols / 3;
  if (pos.c < third) return "west";
  if (pos.c < third * 2) return "center";
  return "east";
}

function buildSubordinateOwnerDescriptor(unit, cols) {
  const sectorBucket = getOwnerSectorBucketForUnit(unit, cols);
  if (unit.type === "headquarters") {
    const commandBase = unit.parentHQ || unit.id;
    return {
      owner: `${commandBase}::command`,
      source: unit.parentHQ ? "hq-chain-command" : "hq-command",
    };
  }
  if (unit.parentHQ) {
    if (unit.type === "artillery") {
      return { owner: `${unit.parentHQ}::fires`, source: "parentHQ-fires" };
    }
    if (unit.type === "logistics") {
      return { owner: `${unit.parentHQ}::command`, source: "parentHQ-command" };
    }
    return { owner: `${unit.parentHQ}::maneuver::${sectorBucket}`, source: "parentHQ-maneuver" };
  }
  if (unit.type === "artillery") {
    return { owner: `sector-${sectorBucket}::fires`, source: "sector-fires" };
  }
  return { owner: `sector-${sectorBucket}`, source: "sector" };
}

function buildSubordinateOwnerView(friendlyUnits, assignments) {
  const owners = {};
  const ownerUnitsByOwner = {};
  const ownerIdByUnitId = {};
  for (const unit of friendlyUnits || []) {
    const assignment = assignments?.[unit.id] || { owner: "sector-center", source: "sector" };
    if (!owners[assignment.owner]) {
      owners[assignment.owner] = {
        owner: assignment.owner,
        source: assignment.source || "sector",
        unitIds: [],
      };
      ownerUnitsByOwner[assignment.owner] = [];
    }
    owners[assignment.owner].unitIds.push(unit.id);
    ownerUnitsByOwner[assignment.owner].push(unit);
    ownerIdByUnitId[unit.id] = assignment.owner;
  }
  return {
    owners,
    ownerUnitsByOwner,
    ownerIdByUnitId,
  };
}

function buildSubordinateOwners(friendlyUnits, assignments) {
  return buildSubordinateOwnerView(friendlyUnits, assignments).owners;
}

function pickFlexibleCommanderRoleAssignment({
  state,
  actorId,
  ownerId,
  directives,
  directorPacket,
  zoneSnapshots,
  ownerCanAcquireContact,
  primaryZoneId,
  secondaryZoneIds,
  supportingZoneIds,
  opportunityZoneIds,
  threatenedZoneIds,
  reserveZoneIds,
  rearZoneId,
  usedZoneCounts,
  maxPrimaryOwners,
  supportByFireAssigned,
  supportByFireLimit,
  rearSecurityAssigned,
  desiredRearSecurityOwners,
}) {
  const drift = getDirectiveDrift(directives);
  const roleBases = getDirectiveTuning(directives, ["director", "roleBases"], {});
  const roleWeights = getDirectiveTuning(directives, ["director", "roleWeights"], {});
  const blindSearchTuning = getDirectiveTuning(directives, ["director", "blindSearch"], {});
  const supportBiasLevel = clamp((directives.profile.supportByFireBias || 0.5) + drift.support * 0.55, 0, 1);
  const rearSecurityLevel = clamp((directives.profile.rearSecurityBias || 0.5) + drift.caution * 0.5 + drift.reserve * 0.25 - drift.tempo * 0.12, 0, 1);
  const flankCuriosityLevel = clamp((directives.profile.neutralZoneOpportunism || 0.5) + drift.flank * 0.65 + drift.tempo * 0.12, 0, 1);
  const reliefPreferenceLevel = clamp((directives.profile.pocketReliefBias || 0.5) + drift.caution * 0.2 + drift.support * 0.1, 0, 1);
  const zonePressure = (zoneId) => {
    const snapshot = zoneId ? zoneSnapshots?.[zoneId] : null;
    if (!snapshot) return 0;
    return roundMetric(
      (1 - (snapshot.controlShare || 0)) * 4
      + (snapshot.breakthroughOpportunity || 0) * 4
      + (snapshot.supportingZoneValue || 0) * 3
      + (((snapshot.borderMix?.enemy || 0) + (snapshot.borderMix?.contested || 0)) * 3.5)
      - (snapshot.congestionRisk || 0) * 2.2
      - (((snapshot.cutOffRisk || 0) + (snapshot.salientRisk || 0)) * 2.2)
      + (snapshot.state === "neutral" ? 1.5 : snapshot.state === "contested" ? 1 : 0)
    );
  };
  const chooseLeastUsed = (zoneIds) => pickLeastAssignedZone(zoneIds, usedZoneCounts) || zoneIds?.[0] || null;
  const bestSecondaryZoneId = chooseLeastUsed(secondaryZoneIds);
  const bestSupportingZoneId = chooseLeastUsed(supportingZoneIds);
  const bestOpportunityZoneId = chooseLeastUsed(opportunityZoneIds);
  const prioritizedThreats = prioritizeThreatenedZones(threatenedZoneIds, zoneSnapshots, usedZoneCounts, directives.profile);
  const bestThreatenedZoneId = prioritizedThreats[0] || chooseLeastUsed(threatenedZoneIds);
  const mainOverloadPenalty = primaryZoneId
    ? Math.max(0, (usedZoneCounts[primaryZoneId] || 0) - Math.max(0, maxPrimaryOwners - 1)) * (roleWeights.mainOverloadPenalty ?? 2.4)
    : 0;
  const candidates = [];
  const pushCandidate = (role, zoneId, score, reason) => {
    if (!zoneId || !Number.isFinite(score)) return;
    const zoneLabel = getZoneById(state.scenario?.zoneModel, zoneId)?.sourceName || zoneId;
    candidates.push({
      id: `${role}:${zoneId}`,
      label: `${role.replace(/_/g, " ")} -> ${zoneLabel}`,
      role,
      zoneId,
      score: roundMetric(score),
      reason,
    });
  };

  if (primaryZoneId) {
    pushCandidate(
      "main_effort",
      primaryZoneId,
      (roleBases.mainEffort ?? 11.5) + zonePressure(primaryZoneId) + (directorPacket?.pressure === "surge" ? (roleWeights.surgeBonus ?? 2.5) : 0) - mainOverloadPenalty,
      ["shared_goal", "main_axis"]
    );
  }
  if (bestSecondaryZoneId) {
    pushCandidate(
      "supporting_attack",
      bestSecondaryZoneId,
      (roleBases.supportingAttack ?? 9) + zonePressure(bestSecondaryZoneId) + (primaryZoneId && (usedZoneCounts[primaryZoneId] || 0) >= maxPrimaryOwners ? (roleWeights.secondaryOverloadBonus ?? 1.8) : 0),
      ["shared_goal", "secondary_axis"]
    );
  }
  if (bestOpportunityZoneId) {
    if (ownerCanAcquireContact) {
      pushCandidate(
        "screen",
        bestOpportunityZoneId,
        (roleBases.screen ?? 9.4) + zonePressure(bestOpportunityZoneId) + flankCuriosityLevel * (roleWeights.screenFlankWeight ?? 4.8) + (directorPacket?.pressure === "probe" ? (roleWeights.probePressureBonus ?? 2) : 0),
        ["shared_goal", "screen_opportunity"]
      );
    } else {
      pushCandidate(
        "supporting_attack",
        bestOpportunityZoneId,
        (roleBases.opportunitySupport ?? 8.6) + zonePressure(bestOpportunityZoneId) + flankCuriosityLevel * (roleWeights.opportunitySupportWeight ?? 2.2),
        ["shared_goal", "opportunity_axis"]
      );
    }
  }
  if (bestThreatenedZoneId) {
    const threatenedSnapshot = zoneSnapshots?.[bestThreatenedZoneId];
    const preferRelief = shouldPreferReliefForZone(threatenedSnapshot, directives.profile);
    pushCandidate(
      preferRelief ? "relief" : "contain",
      bestThreatenedZoneId,
      (roleBases.contain ?? 10.3) + zonePressure(bestThreatenedZoneId) + (directorPacket?.pressure === "recover" ? (roleWeights.recoverPressureBonus ?? 2.6) : 0) + reliefPreferenceLevel * (roleWeights.reliefPreferenceWeight ?? 3.2),
      ["shared_goal", "threat_response"]
    );
  }
  if (bestSupportingZoneId && supportByFireAssigned < supportByFireLimit) {
    pushCandidate(
      "support_by_fire",
      bestSupportingZoneId,
      (roleBases.supportByFire ?? 8.8) + zonePressure(bestSupportingZoneId) + supportBiasLevel * (roleWeights.supportBiasWeight ?? 4.2),
      ["shared_goal", "support_shaping"]
    );
  }
  const rearChoiceZoneId = reserveZoneIds[0] || rearZoneId || primaryZoneId || bestSecondaryZoneId || bestOpportunityZoneId;
  if (rearChoiceZoneId) {
    const rearSecurityBonus = desiredRearSecurityOwners > rearSecurityAssigned ? (roleWeights.rearSecurityNeedBonus ?? 2.2) : 0;
    pushCandidate(
      "rear_security",
      rearChoiceZoneId,
      (roleBases.rearSecurity ?? 7.6) + zonePressure(rearChoiceZoneId) * 0.55 + rearSecurityLevel * (roleWeights.rearSecurityWeight ?? 4.1) + rearSecurityBonus,
      ["shared_goal", "rear_security"]
    );
  }

  const choice = selectScoredCandidateForActor(state, actorId, `owner-role:${ownerId}`, candidates, directives, {
    closeGapThreshold: blindSearchTuning.roleCloseGapThreshold ?? 2.4,
    closeGapRatio: blindSearchTuning.roleCloseGapRatio ?? 0.18,
  });
  const selected = choice.selected || candidates[0] || null;
  return {
    role: selected?.role || "main_effort",
    targetZoneId: selected?.zoneId || primaryZoneId || rearZoneId || bestSecondaryZoneId || bestOpportunityZoneId || null,
    roleChoice: {
      mode: choice.mode,
      sampled: choice.sampled,
      branch: choice.branch,
      temperature: choice.temperature,
      topTwoGap: choice.topTwoGap,
      relativeGap: choice.relativeGap,
      selectedRole: selected?.role || null,
      selectedZoneId: selected?.zoneId || null,
      sampledCandidates: choice.sampledCandidates || [],
    },
  };
}

function planCommanderOwnerTasks({ state, terrainData, actor, directives, directorPacket, owners, ownerUnitsByOwner = {}, reserveRelease, visibleEnemyIds, lastKnown }) {
  const zoneModel = state.scenario?.zoneModel;
  if (!zoneModel?.zones?.length) {
    const legacyTasks = {};
    for (const owner of Object.values(owners)) {
      const ownerUnits = ownerUnitsByOwner[owner.owner] || [];
      const task = selectCommanderTask({
        state,
        actor,
        actorView: state.perceptionState?.[actor.id] || { detectedUnits: [], contactUnits: [], lastKnown: {} },
        directives,
        directorPacket,
        owner,
        ownerUnits,
        visibleEnemyIds,
        lastKnown,
        objectives: state.scenario?.objectives?.hexVP || [],
        assignments: {},
      });
      if (task) legacyTasks[owner.owner] = task;
    }
    return legacyTasks;
  }

  const zoneSnapshots = state.zoneAnalysis?.perSide?.[actor.id] || {};
  const edgeSnapshots = state.edgeAnalysis?.perSide?.[actor.id] || {};
  const ownerEntries = Object.values(owners)
    .map((owner) => ({
      ...owner,
      ownerUnits: ownerUnitsByOwner[owner.owner] || [],
    }))
    .filter((owner) => owner.ownerUnits.length > 0)
    .sort((left, right) => scoreOwnerCombatWeight(right.ownerUnits) - scoreOwnerCombatWeight(left.ownerUnits));

  const primaryZoneId = directorPacket?.primaryZones?.[0] || directorPacket?.supportingZones?.[0] || directorPacket?.secondaryZones?.[0] || null;
  const secondaryZoneIds = directorPacket?.secondaryZones || [];
  const supportingZoneIds = directorPacket?.supportingZones || [];
  const opportunityZoneIds = directorPacket?.opportunityZones || [];
  const threatenedZoneIds = directorPacket?.threatenedZones || [];
  const reserveZoneIds = directorPacket?.reserveZones || [];
  const rearZoneId = findBestRearZoneForActor(state, actor.id);
  const usedLaneIds = new Set();
  const usedZoneCounts = {};
  const plan = {};
  const maneuverOwners = ownerEntries.filter((owner) => !isSupportOwner(owner.ownerUnits));
  const maxPrimaryOwners = Math.max(1, Math.floor(maneuverOwners.length * MAX_PRIMARY_ZONE_OWNER_SHARE));
  const drift = getDirectiveDrift(directives);
  const roleFlexTuning = getDirectiveTuning(directives, ["commander", "roleFlex"], {});
  const blindSearchTuning = getDirectiveTuning(directives, ["director", "blindSearch"], {});
  const supportBiasLevel = clamp((directives.profile.supportByFireBias || 0.5) + drift.support * 0.55, 0, 1);
  const reservePatienceLevel = clamp((directives.profile.reservePatience || 0.5) + drift.reserve * 0.6 + drift.caution * 0.15, 0, 1);
  const rearSecurityLevel = clamp((directives.profile.rearSecurityBias || 0.5) + drift.caution * 0.5 + drift.reserve * 0.25 - drift.tempo * 0.12, 0, 1);
  const supportByFireLimit = supportingZoneIds.length > 0 ? Math.max(1, Math.round(supportBiasLevel * (roleFlexTuning.supportByFireSlotsScale ?? 2))) : 0;
  const reserveLimit = reserveZoneIds.length > 0 ? Math.max(1, Math.round(reservePatienceLevel * (roleFlexTuning.reserveSlotsScale ?? 2))) : 1;
  const desiredRearSecurityOwners = rearSecurityLevel >= (roleFlexTuning.rearSecurityHighThreshold ?? 0.78)
    ? 2
    : rearSecurityLevel >= (roleFlexTuning.rearSecurityLowThreshold ?? 0.62)
      ? 1
      : 0;
  const currentOperation = directorPacket?.currentOperation || null;
  const noFreshContact = (visibleEnemyIds?.size || 0) === 0;
  const noLastKnown = Object.keys(lastKnown || {}).length === 0;
  const stalledMain = Boolean(
    currentOperation
    && (
      currentOperation.status === "failing"
      || ((state.game.elapsedMs || 0) - (currentOperation.lastMeaningfulProgressAtMs || (state.game.elapsedMs || 0))) >= COMMANDER_PROGRESS_STALL_MS
      || (currentOperation.viabilityScore || 0) < 0.42
    )
  );
  const blindContactAcquisitionActive = (blindSearchTuning.enabled ?? 1) !== 0
    && noFreshContact
    && noLastKnown
    && (
      directorPacket?.pressure === "probe"
      || directorPacket?.pressure === "recover"
      || directorPacket?.activePackages?.includes("probe")
      || stalledMain
    );
  const blindProbeZoneIds = Array.from(new Set([
    ...opportunityZoneIds,
    ...secondaryZoneIds,
    ...(directorPacket?.frontierZoneIds || []),
    primaryZoneId,
    ...supportingZoneIds,
  ].filter(Boolean))).filter((zoneId) => {
    const snapshot = zoneSnapshots?.[zoneId];
    return snapshot ? snapshot.state !== "friendly" : true;
  });
  const blindProbeZoneId = pickLeastAssignedZone(blindProbeZoneIds, usedZoneCounts) || blindProbeZoneIds[0] || null;
  let supportByFireAssigned = 0;
  let reserveAssigned = 0;
  let rearSecurityAssigned = 0;
  let blindContactScreenAssigned = 0;
  let blindContactEscortAssigned = 0;
  const blindContactEscortLimit = blindContactAcquisitionActive
    && blindProbeZoneId
    && maneuverOwners.length >= 3
    ? (blindSearchTuning.escortLimitWhenThreePlusManeuverOwners ?? 1)
    : 0;

  for (const owner of ownerEntries) {
    const ownerType = classifyOwnerType(owner.ownerUnits);
    const ownerCanAcquireContact = ownerHasScreenCapability(owner.ownerUnits);
    const currentZoneId = getCurrentOwnerZoneId(state, owner.ownerUnits);
    const commandOwner = isCommandOwner(owner.ownerUnits);
    const fireSupportOwner = isFireSupportOwner(owner.ownerUnits);
    const weakTask = maybeBuildWeakOwnerFallback(state, owner, directives);
    if (weakTask) {
      plan[owner.owner] = weakTask;
      continue;
    }

    const heldUnits = owner.ownerUnits.filter((unit) => unit.modeState?.reserveState === "held").length;
    // Reserve-eligible means the *entire* owner group is being held. If only a
    // subset of units is held (e.g., 1 of 3) we must not assign the whole owner
    // a reserve role — the other two units would get yanked back from active
    // engagement. The commander pass can still tag individual units as held,
    // but the owner-level plan must reflect the majority committed state.
    const reserveEligible = heldUnits > 0
      && heldUnits === owner.ownerUnits.length
      && !reserveRelease
      && !isSupportOwner(owner.ownerUnits);
    let role = "main_effort";
    let targetZoneId = primaryZoneId;
    let forcedBlindContactRole = null;
    let roleChoice = null;

    if (reserveEligible && reserveAssigned < reserveLimit) {
      role = "reserve";
      targetZoneId = reserveZoneIds[reserveAssigned] || rearZoneId || getCurrentOwnerZoneId(state, owner.ownerUnits);
    } else if (commandOwner) {
      role = "rear_security";
      targetZoneId = reserveZoneIds[0] || currentZoneId || rearZoneId || getCurrentOwnerZoneId(state, owner.ownerUnits);
    } else if (fireSupportOwner) {
      const fireSupportZoneId = pickFireSupportTargetZone(state, actor.id, directorPacket, usedZoneCounts);
      if (fireSupportZoneId) {
        role = "support_by_fire";
        targetZoneId = fireSupportZoneId;
      } else {
        role = "rear_security";
        targetZoneId = reserveZoneIds[0] || rearZoneId || currentZoneId || getCurrentOwnerZoneId(state, owner.ownerUnits);
      }
    } else if (isSupportOwner(owner.ownerUnits)) {
      if (
        supportingZoneIds.length > 0
        && supportByFireAssigned < supportByFireLimit
        && supportBiasLevel >= (rearSecurityLevel - 0.05)
      ) {
        role = "support_by_fire";
        targetZoneId = supportingZoneIds[supportByFireAssigned] || supportingZoneIds[0];
      } else {
        role = "rear_security";
        targetZoneId = reserveZoneIds[0] || rearZoneId || getCurrentOwnerZoneId(state, owner.ownerUnits);
      }
    } else if (
      blindContactAcquisitionActive
      && blindProbeZoneId
      && blindContactScreenAssigned < (blindSearchTuning.maxScreenOwners ?? 1)
      && ownerCanAcquireContact
    ) {
      role = "screen";
      targetZoneId = blindProbeZoneId;
      forcedBlindContactRole = "screen";
    } else if (
      blindContactAcquisitionActive
      && blindProbeZoneId
      && blindContactScreenAssigned >= 1
      && blindContactEscortAssigned < blindContactEscortLimit
      && !ownerCanAcquireContact
      && !commandOwner
      && !isSupportOwner(owner.ownerUnits)
    ) {
      role = "supporting_attack";
      targetZoneId = blindProbeZoneId;
      forcedBlindContactRole = "escort";
    } else {
      const flexibleAssignment = pickFlexibleCommanderRoleAssignment({
        state,
        actorId: actor.id,
        ownerId: owner.owner,
        directives,
        directorPacket,
        zoneSnapshots,
        ownerCanAcquireContact,
        primaryZoneId,
        secondaryZoneIds,
        supportingZoneIds,
        opportunityZoneIds,
        threatenedZoneIds,
        reserveZoneIds,
        rearZoneId,
        usedZoneCounts,
        maxPrimaryOwners,
        supportByFireAssigned,
        supportByFireLimit,
        rearSecurityAssigned,
        desiredRearSecurityOwners,
      });
      role = flexibleAssignment.role;
      targetZoneId = flexibleAssignment.targetZoneId;
      roleChoice = flexibleAssignment.roleChoice;
    }

    if (!targetZoneId) {
      role = "rear_security";
      targetZoneId = rearZoneId || getCurrentOwnerZoneId(state, owner.ownerUnits);
    }
    if (
      targetZoneId
      && zoneSnapshots?.[targetZoneId]?.tags?.includes("salient")
      && (directives.profile.salientTolerance || 0.5) < 0.4
      && ["main_effort", "supporting_attack"].includes(role)
    ) {
      role = "contain";
    }
    const taskAttempts = buildZoneTaskAttempts({
      chosenRole: role,
      chosenZoneId: targetZoneId,
      currentZoneId,
      rearZoneId,
      supportingZoneIds,
      secondaryZoneIds,
      opportunityZoneIds,
      threatenedZoneIds,
      reserveZoneIds,
      zoneSnapshots,
      directives,
      ownerType,
      ownerCanAcquireContact,
      supportOwner: isSupportOwner(owner.ownerUnits),
    });
    let task = null;
    for (const attempt of taskAttempts) {
      task = buildZoneTaskForOwner({
        state,
        terrainData,
        actor,
        directives,
        directorPacket,
        owner,
        ownerUnits: owner.ownerUnits,
        role: attempt.role,
        targetZoneId: attempt.zoneId,
        usedLaneIds,
        zoneSnapshots,
        edgeSnapshots,
      });
      if (task) break;
    }
    if (!task) {
      task = {
        id: `task_${state.game.elapsedMs}_${owner.owner}_hold_sector`,
        owner: owner.owner,
        role: "rear_security",
        kind: "rear_security",
        zoneId: currentZoneId,
        edgeId: null,
        laneId: null,
        targetHex: owner.ownerUnits[0]?.position || null,
        stagingHex: owner.ownerUnits[0]?.position || null,
        supportHexes: [],
        fallbackHex: owner.ownerUnits[0]?.position || null,
        objectiveStyle: "hold",
        commandKind: "hold",
        provenance: "doctrine",
        summary: "Hold current sector frontage.",
        reason: "hold-sector",
        assignedAtMs: state.game.elapsedMs,
      };
    }
    task.contactSearchActive = Boolean(blindContactAcquisitionActive && blindProbeZoneId);
    task.contactSearchRole = forcedBlindContactRole || null;
    task.contactSearchZoneId = blindContactAcquisitionActive ? blindProbeZoneId : null;
    task.contactSearchReason = blindContactAcquisitionActive
      ? (directorPacket?.pressure === "recover" ? "recover_no_contact" : directorPacket?.pressure === "probe" ? "probe_no_contact" : stalledMain ? "stalled_no_contact" : "no_contact")
      : null;
    if (roleChoice) {
      task.roleChoice = roleChoice;
    }
    plan[owner.owner] = task;
    if (task.zoneId) {
      usedZoneCounts[task.zoneId] = (usedZoneCounts[task.zoneId] || 0) + 1;
    }
    if (task.laneId) {
      usedLaneIds.add(task.laneId);
    }
    if (forcedBlindContactRole === "screen" && task.role === "screen") blindContactScreenAssigned += 1;
    if (forcedBlindContactRole === "escort" && task.role === "supporting_attack") blindContactEscortAssigned += 1;
    if (task.role === "support_by_fire") supportByFireAssigned += 1;
    if (task.role === "reserve") reserveAssigned += 1;
    if (task.role === "rear_security") rearSecurityAssigned += 1;
  }

  return plan;
}

function maybeBuildWeakOwnerFallback(state, owner, directives) {
  const averageStrength = owner.ownerUnits.reduce((sum, unit) => sum + (unit.strength ?? 100), 0) / Math.max(owner.ownerUnits.length, 1);
  const averageMorale = owner.ownerUnits.reduce((sum, unit) => sum + (unit.morale ?? 100), 0) / Math.max(owner.ownerUnits.length, 1);
  const weakFallbackTuning = getDirectiveTuning(directives, ["commander", "weakFallback"], {});
  const weakStrengthThreshold = Math.round((weakFallbackTuning.strengthBase ?? 34) + (directives.profile.fallbackBias * (weakFallbackTuning.fallbackStrengthScale ?? 22)));
  const weakMoraleThreshold = Math.round((weakFallbackTuning.moraleBase ?? 18) + (directives.profile.defenseBias * (weakFallbackTuning.defenseMoraleScale ?? 18)));
  if (averageStrength >= weakStrengthThreshold && averageMorale >= weakMoraleThreshold) {
    return null;
  }
  const leadUnit = owner.ownerUnits[0];
  const fallbackHex = findNearestFriendlyAnchor(leadUnit, owner.ownerUnits) || leadUnit.position;
  return {
    id: `task_${state.game.elapsedMs}_${owner.owner}_fallback`,
    owner: owner.owner,
    role: "fallback",
    kind: "fallback",
    zoneId: getZoneIdForHex(state.scenario?.zoneModel, fallbackHex),
    edgeId: null,
    laneId: null,
    targetHex: fallbackHex,
    stagingHex: fallbackHex,
    supportHexes: [],
    fallbackHex,
    objectiveStyle: "regroup",
    commandKind: "withdraw",
    provenance: "doctrine",
    summary: `Regroup toward ${fallbackHex}.`,
    reason: "fallback",
    assignedAtMs: state.game.elapsedMs,
  };
}

function buildZoneTaskForOwner({ state, terrainData, actor, directives, directorPacket, owner, ownerUnits, role, targetZoneId, usedLaneIds, zoneSnapshots, edgeSnapshots }) {
  const zoneModel = state.scenario?.zoneModel;
  const leadUnit = ownerUnits.find((unit) => isUnitReleased(unit, state.game.elapsedMs || 0) && unit.modeState?.reserveState !== "held") || ownerUnits[0];
  const currentZoneId = getCurrentOwnerZoneId(state, ownerUnits);
  const path = findZonePath(zoneModel, currentZoneId, targetZoneId, edgeSnapshots, directives.profile, ownerUnits);
  const nextZoneId = path?.[1] || targetZoneId || currentZoneId;
  const edgeId = currentZoneId && nextZoneId && currentZoneId !== nextZoneId ? [currentZoneId, nextZoneId].sort().join("__") : null;
  const isCrossZoneTask = Boolean(edgeId && currentZoneId && nextZoneId && currentZoneId !== nextZoneId);
  const laneId = edgeId ? chooseBestLane(zoneModel, edgeId, currentZoneId, nextZoneId, usedLaneIds, ownerUnits, directives.profile, role) : null;
  const lane = laneId ? resolveLaneTraversal(zoneModel, laneId, currentZoneId, nextZoneId) : null;
  if (isCrossZoneTask && !lane?.isDirectionalValid && !LANE_OPTIONAL_ROLES.has(role)) {
    return null;
  }
  const targetZone = getZoneById(zoneModel, targetZoneId);
  const stagingZone = isCrossZoneTask ? getZoneById(zoneModel, currentZoneId) || targetZone : targetZone;
  const stagingHex = chooseZoneHexForRole(state, terrainData, stagingZone, role, ownerUnits, {
    anchorHex: lane?.ingressHex || leadUnit?.position || stagingZone?.centroidHex || null,
    preferBorder: isCrossZoneTask,
  });
  const objective = getZoneObjective(state, targetZone?.zoneId);
  const supportHex = role === "support_by_fire"
    ? chooseZoneHexForRole(state, terrainData, targetZone, "support_by_fire", ownerUnits, {
      anchorHex: lane?.egressHex || targetZone?.centroidHex || lane?.midpointHex || null,
      preferBorder: true,
      objectiveHex: objective?.hex || targetZone?.sourceHex || targetZone?.centroidHex || null,
      maxDistanceFromAnchor: isCrossZoneTask ? 4 : 3,
      maxDistanceFromObjective: 4,
      forwardSlack: 1,
    })
    : null;
  const targetHex = chooseTaskTargetHex(state, terrainData, targetZone, role, ownerUnits, lane, zoneSnapshots?.[targetZoneId], isCrossZoneTask);
  const fallbackHex = findNearestFriendlyAnchor(leadUnit, (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed")) || leadUnit?.position || targetHex;
  const summaryZoneName = targetZone?.sourceName || targetZone?.zoneId || targetHex;
  const blindScreening = role === "screen"
    && (((directorPacket?.metrics?.detectedCount || 0) + (directorPacket?.metrics?.contactCount || 0)) === 0)
    && (directorPacket?.metrics?.lastKnownCount || 0) === 0;
  const provenance = role === "main_effort" || role === "supporting_attack" || role === "support_by_fire"
    ? "directorHint"
    : role === "screen"
      ? (blindScreening ? "doctrine" : "lastKnown")
      : "doctrine";
  // Specialization: a support_by_fire task handed to any owner with an
  // indirect-fire element becomes a fire mission. Non-indirect units in the
  // owner still hold the support/staging anchor while the battery executes.
  const counterBatteryTarget = role === "support_by_fire"
    ? selectCounterBatteryTarget(state, actor.id, targetZoneId)
    : null;
  // Specialization: a support_by_fire task handed to a dedicated fires package is
  // really a fire mission. The task kind becomes `fire_mission` so satisfaction
  // logic (ammo depletion / target cleared) and decision-log framing can treat
  // it distinctly from infantry/armor support-by-fire (which is a movement +
  // overwatch task). Role stays `support_by_fire` so downstream role-based
  // branches (e.g., posture assignment at line 4769) keep working unchanged.
  const hasIndirectFireUnit = role === "support_by_fire"
    && ownerUnits.length > 0
    && ownerUnits.some((unit) => isIndirectFireUnit(unit));
  const taskKind = hasIndirectFireUnit ? "fire_mission" : role;
  // Ammo type selection for fire missions: counter-battery when enemy artillery
  // is detected in the target zone, destroy for primary-zone preparation fires,
  // suppress when supporting a maneuver element. Other enum values (smoke,
  // illuminate) are reserved for future overlays; selectFireMissionAmmoType
  // returns `destroy` as the safe default.
  const ammoType = hasIndirectFireUnit
    ? (counterBatteryTarget ? "counter_battery" : selectFireMissionAmmoType(state, actor.id, targetZoneId, directorPacket))
    : undefined;
  const missionTargetHex = counterBatteryTarget?.targetHex || targetHex;
  const missionTargetUnitIds = counterBatteryTarget?.sourceUnitId ? [counterBatteryTarget.sourceUnitId] : [];
  const commandChoice = chooseCommandKindForRoleDetailed(state, leadUnit, role, directives, directorPacket);
  return {
    id: `task_${state.game.elapsedMs}_${owner.owner}_${taskKind}_${targetZoneId || "local"}`,
    owner: owner.owner,
    kind: taskKind,
    role,
    originZoneId: currentZoneId,
    zoneId: targetZoneId,
    nextZoneId,
    edgeId,
    laneId,
    targetHex: missionTargetHex,
    stagingHex,
    supportHexes: supportHex ? [supportHex] : [],
    fallbackHex,
    objectiveStyle: role,
    commandKind: commandChoice.commandKind,
    commandChoice: commandChoice.choice,
    provenance,
    summary: hasIndirectFireUnit
      ? (counterBatteryTarget ? `Counter-battery mission on ${summaryZoneName}.` : `Fire mission on ${summaryZoneName}.`)
      : summarizeZoneRole(role, summaryZoneName, lane),
    reason: role,
    fireMissionAmmoFloor: hasIndirectFireUnit ? 20 : undefined,
    ammoType,
    missionRadius: hasIndirectFireUnit ? getFireMissionRadius(ammoType) : undefined,
    targetUnitIds: hasIndirectFireUnit ? missionTargetUnitIds : undefined,
    assignedAtMs: state.game.elapsedMs,
  };
}

function selectCounterBatteryTarget(state, actorId, preferredZoneId = null) {
  const liveEntries = (state.combat?.counterBatteryQueue || [])
    .filter((entry) => entry.actorId !== actorId)
    .sort((left, right) => (right.createdAtMs || 0) - (left.createdAtMs || 0));
  if (liveEntries.length === 0) return null;
  if (preferredZoneId) {
    const preferred = liveEntries.find((entry) => getZoneIdForHex(state.scenario?.zoneModel, entry.targetHex) === preferredZoneId);
    if (preferred) return preferred;
  }
  return liveEntries[0];
}

function selectFireMissionAmmoType(state, actorId, targetZoneId, directorPacket) {
  if (!targetZoneId) return "destroy";
  if (selectCounterBatteryTarget(state, actorId, targetZoneId)) {
    return "counter_battery";
  }
  const actorView = state.perceptionState?.[actorId];
  const detectedIds = new Set(actorView?.detectedUnits || []);
  const enemiesInZone = (state.units || []).filter((u) => (
    u.actor !== actorId
    && u.status !== "destroyed"
    && !u.embarkedIn
    && getZoneIdForHex(state.scenario?.zoneModel, u.modeState?.settledHex || u.position) === targetZoneId
    && detectedIds.has(u.id)
  ));
  const enemyArtyPresent = enemiesInZone.some((u) => u.type === "artillery");
  if (enemyArtyPresent) return "counter_battery";
  const primaryZones = directorPacket?.primaryZones || [];
  if (primaryZones.includes(targetZoneId)) return "destroy";
  const supportingZones = directorPacket?.supportingZones || [];
  const opportunityZones = directorPacket?.opportunityZones || [];
  if (supportingZones.includes(targetZoneId) || opportunityZones.includes(targetZoneId)) {
    return "suppress";
  }
  return "destroy";
}

function zoneHasDetectedEnemyArtillery(state, actorId, targetZoneId) {
  if (!targetZoneId) return false;
  const actorView = state.perceptionState?.[actorId];
  const detectedIds = new Set(actorView?.detectedUnits || []);
  return (state.units || []).some((unit) => (
    unit.actor !== actorId
    && unit.status !== "destroyed"
    && !unit.embarkedIn
    && unit.type === "artillery"
    && detectedIds.has(unit.id)
    && getZoneIdForHex(state.scenario?.zoneModel, unit.modeState?.settledHex || unit.position) === targetZoneId
  ));
}

function pickFireSupportTargetZone(state, actorId, directorPacket, usedZoneCounts) {
  const counterBatteryTarget = selectCounterBatteryTarget(state, actorId);
  if (counterBatteryTarget?.targetHex) {
    const counterBatteryZoneId = getZoneIdForHex(state.scenario?.zoneModel, counterBatteryTarget.targetHex);
    if (counterBatteryZoneId) return counterBatteryZoneId;
  }
  const primaryZones = directorPacket?.primaryZones || [];
  const supportingZones = directorPacket?.supportingZones || [];
  const threatenedZones = directorPacket?.threatenedZones || [];
  const secondaryZones = directorPacket?.secondaryZones || [];
  const opportunityZones = directorPacket?.opportunityZones || [];
  const intentZoneIds = Array.from(new Set([
    ...primaryZones,
    ...supportingZones,
    ...threatenedZones,
    ...secondaryZones,
    ...opportunityZones,
  ].filter(Boolean)));
  const counterBatteryZones = intentZoneIds.filter((zoneId) => zoneHasDetectedEnemyArtillery(state, actorId, zoneId));
  if (counterBatteryZones.length > 0) {
    return pickLeastAssignedZone(counterBatteryZones, usedZoneCounts) || counterBatteryZones[0];
  }
  for (const bucket of [primaryZones, supportingZones, threatenedZones, secondaryZones, opportunityZones]) {
    const zoneId = pickLeastAssignedZone(bucket, usedZoneCounts) || bucket?.[0] || null;
    if (zoneId) return zoneId;
  }
  return null;
}

function chooseCommandKindForRoleDetailed(state, unit, role, directives, directorPacket) {
  if (role === "fallback") {
    return {
      commandKind: "withdraw",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "withdraw", label: "withdraw", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  if (role === "reserve" || role === "rear_security" || role === "support_by_fire") {
    return {
      commandKind: "hold",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "hold", label: "hold", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  if (role === "screen") {
    const commandKind = isScreenCapableUnit(unit) ? "screen" : "attack_move";
    return {
      commandKind,
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: commandKind, label: commandKind, score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  if (role === "relief" || role === "counterattack") {
    return selectEngagementCommandDetailed(state, unit?.actor || null, unit, directives, directorPacket);
  }
  if (role === "contain") {
    return {
      commandKind: "attack_move",
      choice: {
        mode: "deterministic",
        sampled: false,
        branch: "hard_gate",
        sampledCandidates: [{ id: "attack_move", label: "attack_move", score: 1, noiseOffset: 0, combinedScore: 1 }],
      },
    };
  }
  return selectObjectiveCommandDetailed(state, unit?.actor || null, unit, directives, directorPacket);
}

function chooseCommandKindForRole(unit, role, directives, directorPacket) {
  return chooseCommandKindForRoleDetailed(null, unit, role, directives, directorPacket).commandKind;
}

function summarizeZoneRole(role, zoneName, lane) {
  const laneText = lane?.ingressHex ? ` via ${lane.ingressHex}` : "";
  switch (role) {
    case "main_effort":
      return `Main effort toward ${zoneName}${laneText}.`;
    case "supporting_attack":
      return `Support the main effort by shaping ${zoneName}${laneText}.`;
    case "support_by_fire":
      return `Occupy a support-by-fire position overlooking ${zoneName}.`;
    case "reserve":
      return `Hold reserve in depth around ${zoneName}.`;
    case "rear_security":
      return `Secure the rear and support belt around ${zoneName}.`;
    case "screen":
      return `Screen and probe through ${zoneName}${laneText}.`;
    case "relief":
      return `Relieve pressure around ${zoneName}${laneText}.`;
    case "contain":
      return `Contain enemy activity around ${zoneName}${laneText}.`;
    case "counterattack":
      return `Counterattack into ${zoneName}${laneText}.`;
    default:
      return `Operate around ${zoneName}${laneText}.`;
  }
}

function scoreOwnerCombatWeight(ownerUnits) {
  return ownerUnits.reduce((sum, unit) => sum + computeEffectivePower(unit, null), 0);
}

function classifyOwnerType(ownerUnits) {
  const counts = { support: 0, recon: 0, armor: 0, infantry: 0 };
  for (const unit of ownerUnits || []) {
    if (isSupportUnitType(unit.type)) counts.support += 1;
    else if (isScreenCapableUnit(unit)) counts.recon += 1;
    else if (["armor", "mechanized", "armored_infantry", "mechanized_infantry", "tank_destroyer"].includes(unit.type)) counts.armor += 1;
    else counts.infantry += 1;
  }
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] || "infantry";
}

function isScreenCapableUnit(unit) {
  return ["recon", "special_forces"].includes(unit?.type);
}

function ownerHasScreenCapability(ownerUnits) {
  return (ownerUnits || []).some((unit) => isScreenCapableUnit(unit));
}

function isFireSupportOwner(ownerUnits) {
  if (!ownerUnits || ownerUnits.length === 0) return false;
  const artilleryCount = ownerUnits.filter((unit) => unit.type === "artillery").length;
  return artilleryCount > 0 && ownerUnits.every((unit) => FIRE_SUPPORT_UNIT_TYPES.has(unit.type));
}

function isSupportOwner(ownerUnits) {
  return (ownerUnits || []).some((unit) => isSupportUnitType(unit?.type));
}

function isCommandOwner(ownerUnits) {
  if (!ownerUnits || ownerUnits.length === 0) return false;
  const headquartersCount = ownerUnits.filter((unit) => unit.type === "headquarters").length;
  return headquartersCount > 0 && ownerUnits.every((unit) => COMMAND_SUPPORT_UNIT_TYPES.has(unit.type));
}

function pickLeastAssignedZone(zoneIds, usedZoneCounts) {
  return [...(zoneIds || [])].sort((left, right) => (usedZoneCounts[left] || 0) - (usedZoneCounts[right] || 0))[0] || null;
}

function shouldPreferReliefForZone(snapshot, profile) {
  if (!snapshot) return false;
  const pocketReliefBias = profile?.pocketReliefBias || 0.5;
  if (pocketReliefBias < 0.5) return false;
  if (snapshot.tags?.includes("encircled")) return true;
  if (snapshot.state === "enemy" && snapshot.controlShare < 0.1) return false;
  const pressuredFoothold = snapshot.controlShare >= 0.12 && snapshot.controlShare <= 0.78;
  const threatened = snapshot.cutOffRisk >= 0.15 || snapshot.salientRisk >= 0.15 || ((snapshot.borderMix?.enemy || 0) + (snapshot.borderMix?.contested || 0)) >= 0.2;
  if (pocketReliefBias >= 0.7 && threatened && snapshot.state !== "enemy") {
    return true;
  }
  return pressuredFoothold && threatened;
}

function prioritizeThreatenedZones(zoneIds, zoneSnapshots, usedZoneCounts, profile) {
  const pocketReliefBias = profile?.pocketReliefBias || 0.5;
  return [...(zoneIds || [])].sort((leftZoneId, rightZoneId) => {
    const left = zoneSnapshots?.[leftZoneId];
    const right = zoneSnapshots?.[rightZoneId];
    const leftScore = scoreThreatenedZonePriority(left, pocketReliefBias) - ((usedZoneCounts?.[leftZoneId] || 0) * 0.25);
    const rightScore = scoreThreatenedZonePriority(right, pocketReliefBias) - ((usedZoneCounts?.[rightZoneId] || 0) * 0.25);
    if (Math.abs(rightScore - leftScore) > 0.001) {
      return rightScore - leftScore;
    }
    return (usedZoneCounts?.[leftZoneId] || 0) - (usedZoneCounts?.[rightZoneId] || 0);
  });
}

function scoreThreatenedZonePriority(snapshot, pocketReliefBias) {
  if (!snapshot) return -Infinity;
  const friendlyFoothold = clamp(snapshot.controlShare || 0, 0, 1);
  const contestedBonus = snapshot.state === "contested" ? 0.8 : snapshot.state === "friendly" ? 0.35 : 0;
  const friendlyPresenceBonus = snapshot.friendlyHoldingPower > 0 ? 0.4 : 0;
  const encircledBonus = snapshot.tags?.includes("encircled") ? (snapshot.state === "enemy" ? 0.45 : 1.6) : 0;
  const salientBonus = snapshot.tags?.includes("salient") ? 0.85 : 0;
  const pocketPressure = ((snapshot.cutOffRisk || 0) * 1.7) + ((snapshot.salientRisk || 0) * 1.25);
  const supportValue = (snapshot.supportingZoneValue || 0) * 0.2;
  const enemyOnlyPenalty = snapshot.state === "enemy" && friendlyFoothold < 0.12 ? 0.95 : 0;
  return (friendlyFoothold * (1.2 + pocketReliefBias))
    + contestedBonus
    + friendlyPresenceBonus
    + encircledBonus
    + salientBonus
    + pocketPressure
    + supportValue
    - enemyOnlyPenalty;
}

function buildZoneTaskAttempts({
  chosenRole,
  chosenZoneId,
  currentZoneId,
  rearZoneId,
  supportingZoneIds,
  secondaryZoneIds,
  opportunityZoneIds,
  threatenedZoneIds,
  reserveZoneIds,
  zoneSnapshots,
  directives,
  ownerType,
  ownerCanAcquireContact,
  supportOwner,
}) {
  const attempts = [];
  const seen = new Set();
  const orderedThreatenedZoneIds = prioritizeThreatenedZones(threatenedZoneIds, zoneSnapshots, {}, directives.profile);
  const pushAttempt = (role, zoneId) => {
    if (!zoneId) return;
    const key = `${role}|${zoneId}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ role, zoneId });
  };

  pushAttempt(chosenRole, chosenZoneId);
  for (const zoneId of supportingZoneIds || []) {
    pushAttempt(supportOwner || (directives.profile.supportByFireBias || 0.5) >= 0.7 ? "support_by_fire" : "supporting_attack", zoneId);
  }
  for (const zoneId of secondaryZoneIds || []) {
    pushAttempt("supporting_attack", zoneId);
  }
  for (const zoneId of opportunityZoneIds || []) {
    pushAttempt(ownerCanAcquireContact || ownerType === "recon" ? "screen" : "supporting_attack", zoneId);
  }
  for (const zoneId of orderedThreatenedZoneIds || []) {
    pushAttempt(shouldPreferReliefForZone(zoneSnapshots?.[zoneId], directives.profile) ? "relief" : "contain", zoneId);
  }
  for (const zoneId of reserveZoneIds || []) {
    pushAttempt("reserve", zoneId);
  }
  pushAttempt("rear_security", rearZoneId || currentZoneId);
  if (currentZoneId) {
    pushAttempt("rear_security", currentZoneId);
  }
  return attempts;
}

function findBestRearZoneForActor(state, actorId) {
  const zoneModel = state.scenario?.zoneModel;
  const rearZones = getZonesForActorAnchors(zoneModel, actorId);
  return rearZones[0] || zoneModel?.zones?.[0]?.zoneId || null;
}

function getCurrentOwnerZoneId(state, ownerUnits) {
  const lead = ownerUnits.find((unit) => resolveUnitHex(unit)) || ownerUnits[0];
  return getZoneIdForHex(state.scenario?.zoneModel, resolveUnitHex(lead));
}

function findZonePath(zoneModel, startZoneId, targetZoneId, edgeSnapshots, profile, ownerUnits) {
  if (!startZoneId || !targetZoneId || startZoneId === targetZoneId) {
    return startZoneId ? [startZoneId] : [];
  }
  const frontier = [{ zoneId: startZoneId, cost: 0 }];
  const bestCost = { [startZoneId]: 0 };
  const cameFrom = {};
  while (frontier.length > 0) {
    frontier.sort((left, right) => left.cost - right.cost);
    const current = frontier.shift();
    if (!current) break;
    if (current.zoneId === targetZoneId) break;
    for (const neighbor of zoneModel?.zoneGraph?.[current.zoneId] || []) {
      const edgeSnapshot = edgeSnapshots?.[neighbor.edgeId];
      const terrainPenalty = 1 - (computeLaneFitForOwner(zoneModel, neighbor.edgeId, ownerUnits, profile) || 0.5);
      const cost = current.cost
        + 1
        + (edgeSnapshot?.crossingRisk || 0) * (1 + (profile.encirclementAversion || 0.5))
        + (edgeSnapshot?.lanePressure || 0) * (1 + (profile.frontageDiscipline || 0.5))
        + terrainPenalty * (1 + (1 - (profile.terrainRiskBias || 0.5)));
      if (!Number.isFinite(cost) || cost >= (bestCost[neighbor.zoneId] ?? Infinity)) continue;
      bestCost[neighbor.zoneId] = cost;
      cameFrom[neighbor.zoneId] = current.zoneId;
      frontier.push({ zoneId: neighbor.zoneId, cost });
    }
  }
  if (!(targetZoneId in cameFrom)) {
    return [startZoneId, targetZoneId];
  }
  const path = [targetZoneId];
  let cursor = targetZoneId;
  while (cameFrom[cursor]) {
    cursor = cameFrom[cursor];
    path.unshift(cursor);
  }
  return path;
}

function chooseBestLane(zoneModel, edgeId, fromZoneId, toZoneId, usedLaneIds, ownerUnits, profile, role) {
  const edge = getEdgeById(zoneModel, edgeId);
  const candidates = (edge?.laneIds || [])
    .map((laneId) => resolveLaneTraversal(zoneModel, laneId, fromZoneId, toZoneId))
    .filter((lane) => lane?.isDirectionalValid)
    .sort((left, right) => scoreLaneForOwner(right, ownerUnits, profile, role) - scoreLaneForOwner(left, ownerUnits, profile, role));
  const freeLane = candidates.find((lane) => !usedLaneIds.has(lane.laneId));
  if (freeLane) return freeLane.laneId;
  const highThroughput = candidates.find((lane) => (lane.throughputScore || 0) >= 0.82);
  return highThroughput?.laneId || null;
}

function scoreLaneForOwner(lane, ownerUnits, profile, role) {
  const terrainFit = computeLaneFitForOwner({ lanes: { [lane.laneId]: lane }, zoneEdges: [] }, lane.edgeId, ownerUnits, profile, lane);
  const supportBias = role === "support_by_fire" ? 0.12 + (profile.supportByFireBias || 0.5) * 0.22 : role === "reserve" ? -0.1 : 0;
  return (lane.throughputScore || 0.5)
    + terrainFit * 0.5
    - (lane.crossingRisk || 0) * (1.1 - (profile.trafficTolerance || 0.4))
    + supportBias;
}

function computeLaneFitForOwner(zoneModel, edgeId, ownerUnits, profile, resolvedLane = null) {
  const edge = getEdgeById(zoneModel, edgeId);
  const lane = resolvedLane || (edge?.laneIds || []).map((laneId) => getLaneById(zoneModel, laneId)).filter(Boolean)[0];
  if (!lane) return 0.5;
  const ownerType = classifyOwnerType(ownerUnits);
  const envelope = lane.terrainEnvelope || edge?.terrainEnvelope || {};
  const mobility = ownerType === "armor"
    ? envelope.mobilityScoreByMovementType?.tracked || 0.5
    : ownerType === "infantry" || ownerType === "recon"
      ? envelope.mobilityScoreByMovementType?.foot || 0.5
      : envelope.mobilityScoreByMovementType?.wheeled || 0.5;
  const cover = envelope.coverScore || 0.5;
  const observation = ((envelope.elevationAdvantage || 0.5) + (envelope.openFireLaneScore || 0.5)) / 2;
  if (ownerType === "armor") {
    return clamp(mobility * 0.5 + observation * 0.35 - (envelope.crossingRisk || 0) * 0.2 + (profile.openTerrainBias || 0) * 0.2, 0, 1.5);
  }
  if (ownerType === "recon") {
    return clamp(cover * 0.25 + (envelope.concealmentScore || 0.5) * 0.35 + mobility * 0.2 + observation * 0.2, 0, 1.5);
  }
  return clamp(cover * 0.3 + (envelope.concealmentScore || 0.5) * 0.2 + mobility * 0.25 + observation * 0.15, 0, 1.5);
}

function chooseTaskTargetHex(state, terrainData, targetZone, role, ownerUnits, lane, zoneSnapshot, isCrossZoneTask = false) {
  if (!targetZone) return ownerUnits[0]?.position || null;
  if (role === "reserve" || role === "rear_security") {
    return chooseZoneHexForRole(state, terrainData, targetZone, role, ownerUnits, {
      anchorHex: lane?.ingressHex || targetZone.centroidHex,
    });
  }
  if (role === "support_by_fire") {
    return chooseZoneHexForRole(state, terrainData, targetZone, role, ownerUnits, {
      anchorHex: lane?.egressHex || targetZone.centroidHex,
      preferBorder: true,
    });
  }
  if (role === "screen") {
    return lane?.egressHex || chooseZoneHexForRole(state, terrainData, targetZone, role, ownerUnits, {
      anchorHex: targetZone.centroidHex,
      preferBorder: isCrossZoneTask,
    });
  }
  const objectiveApproachHex = ["main_effort", "supporting_attack", "counterattack", "relief", "contain"].includes(role)
    ? chooseObjectiveApproachHex(state, terrainData, targetZone, role, ownerUnits, lane, zoneSnapshot, isCrossZoneTask)
    : null;
  if (objectiveApproachHex) {
    return objectiveApproachHex;
  }
  if (zoneSnapshot?.state === "enemy" || zoneSnapshot?.state === "contested") {
    const objective = getZoneObjective(state, targetZone.zoneId);
    return objective?.hex || lane?.egressHex || chooseZoneHexForRole(state, terrainData, targetZone, role, ownerUnits, {
      anchorHex: lane?.egressHex || targetZone.centroidHex,
      preferBorder: isCrossZoneTask,
    });
  }
  return lane?.egressHex || chooseZoneHexForRole(state, terrainData, targetZone, role, ownerUnits, {
    anchorHex: targetZone.centroidHex,
    preferBorder: isCrossZoneTask,
  });
}

function getZoneObjective(state, zoneId) {
  if (!zoneId) return null;
  return (state.scenario?.objectives?.hexVP || []).find((candidate) => getObjectiveZoneId(state.scenario?.zoneModel, candidate.hex) === zoneId) || null;
}

function chooseObjectiveApproachHex(state, terrainData, targetZone, role, ownerUnits, lane, zoneSnapshot, isCrossZoneTask = false) {
  const objective = getZoneObjective(state, targetZone?.zoneId);
  if (!objective?.hex) return null;
  const objectivePos = parseUnitPosition(objective.hex);
  if (!objectivePos) return objective.hex;
  const anchorHex = lane?.egressHex || targetZone?.centroidHex || objective.hex;
  const anchorPos = parseUnitPosition(anchorHex) || objectivePos;
  const directAssault = zoneSnapshot?.state === "enemy" || zoneSnapshot?.state === "contested";
  const objectiveRadius = directAssault ? 1 : 2;
  const anchorRadius = objectiveRadius + (isCrossZoneTask ? 2 : 1);
  const candidatePool = Array.from(new Set([
    objective.hex,
    ...(targetZone?.hexIds || []),
    ...(targetZone?.borderHexIds || []),
  ])).filter(Boolean);
  const candidates = candidatePool.filter((hex) => {
    const pos = parseUnitPosition(hex);
    if (!pos) return false;
    const objectiveDistance = hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r);
    const anchorDistance = anchorPos ? hexDistance(pos.c, pos.r, anchorPos.c, anchorPos.r) : 0;
    return objectiveDistance <= objectiveRadius && anchorDistance <= anchorRadius;
  });
  const scoredCandidates = candidates.length > 0 ? candidates : [objective.hex];
  let bestHex = objective.hex;
  let bestScore = -Infinity;
  for (const hex of scoredCandidates) {
    const cell = terrainData?.cells?.[hex];
    const pos = parseUnitPosition(hex);
    if (!pos) continue;
    const objectiveDistance = hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r);
    const anchorDistance = anchorPos ? hexDistance(pos.c, pos.r, anchorPos.c, anchorPos.r) : 0;
    const exactObjectiveBonus = hex === objective.hex
      ? (directAssault ? 0.28 : 0.1)
      : (directAssault && objectiveDistance === 1 ? 0.12 : 0.04);
    const laneBonus = lane?.egressHex === hex ? 0.08 : 0;
    const score = scoreHexForRole(cell, role, ownerUnits)
      + exactObjectiveBonus
      + laneBonus
      - objectiveDistance * 0.045
      - anchorDistance * 0.03;
    if (score > bestScore) {
      bestScore = score;
      bestHex = hex;
    }
  }
  return bestHex;
}

function chooseZoneHexForRole(state, terrainData, zone, role, ownerUnits, options = {}) {
  const normalizedOptions = typeof options === "string" ? { anchorHex: options } : (options || {});
  const anchorHex = normalizedOptions.anchorHex || null;
  const objectiveHex = normalizedOptions.objectiveHex || null;
  const preferBorder = Boolean(normalizedOptions.preferBorder || role === "support_by_fire");
  const maxDistanceFromAnchor = Number.isFinite(normalizedOptions.maxDistanceFromAnchor) ? normalizedOptions.maxDistanceFromAnchor : null;
  const maxDistanceFromObjective = Number.isFinite(normalizedOptions.maxDistanceFromObjective) ? normalizedOptions.maxDistanceFromObjective : null;
  const forwardSlack = Number.isFinite(normalizedOptions.forwardSlack) ? normalizedOptions.forwardSlack : null;
  const primaryCandidates = preferBorder ? (zone?.borderHexIds?.length ? zone.borderHexIds : zone?.hexIds || []) : zone?.hexIds || [];
  const candidates = primaryCandidates.slice();
  if (candidates.length === 0) return anchorHex || zone?.centroidHex || zone?.sourceHex;
  const anchorPos = anchorHex ? parseUnitPosition(anchorHex) : null;
  const objectivePos = objectiveHex ? parseUnitPosition(objectiveHex) : null;
  let bestHex = anchorHex || zone?.centroidHex || zone?.sourceHex;
  let bestScore = -Infinity;
  const candidatePasses = [];
  if (anchorPos || objectivePos) {
    const constrained = candidates.filter((hex) => {
      const pos = parseUnitPosition(hex);
      if (!pos) return false;
      if (anchorPos && maxDistanceFromAnchor != null && hexDistance(pos.c, pos.r, anchorPos.c, anchorPos.r) > maxDistanceFromAnchor) {
        return false;
      }
      if (objectivePos && maxDistanceFromObjective != null && hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r) > maxDistanceFromObjective) {
        return false;
      }
      if (anchorPos && objectivePos && forwardSlack != null) {
        const anchorObjectiveDistance = hexDistance(anchorPos.c, anchorPos.r, objectivePos.c, objectivePos.r);
        const candidateObjectiveDistance = hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r);
        if (candidateObjectiveDistance > anchorObjectiveDistance + forwardSlack) {
          return false;
        }
      }
      return true;
    });
    if (constrained.length > 0) {
      candidatePasses.push(constrained);
    }
  }
  candidatePasses.push(candidates);
  for (const pass of candidatePasses) {
    for (const hex of pass) {
      const cell = terrainData?.cells?.[hex];
      const pos = parseUnitPosition(hex);
      const distancePenalty = anchorPos && pos ? hexDistance(pos.c, pos.r, anchorPos.c, anchorPos.r) * 0.035 : 0;
      const objectivePenalty = objectivePos && pos ? hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r) * 0.03 : 0;
      const borderBonus = preferBorder && (zone?.borderHexIds || []).includes(hex) ? 0.14 : 0;
      const objectiveBonus = objectiveHex && hex === objectiveHex ? 0.08 : 0;
      const score = scoreHexForRole(cell, role, ownerUnits) + borderBonus + objectiveBonus - distancePenalty - objectivePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestHex = hex;
      }
    }
    if (bestScore > -Infinity) break;
  }
  return bestHex;
}

function scoreHexForRole(cell, role, ownerUnits) {
  const category = terrainCategoryForCell(cell);
  const ownerType = classifyOwnerType(ownerUnits);
  const cover = TERRAIN_DEFENSE[cell?.terrain || "open_ground"] || 0.12;
  const features = cell?.features || [];
  const road = features.some((feature) => feature === "highway" || feature === "major_road" || feature === "road") ? 0.12 : 0;
  const observation = ((Number(cell?.elevation) || 0) / 1200) + (category === "open" ? 0.08 : 0);
  if (role === "support_by_fire") {
    return cover * 0.3 + observation * 0.45 + road * 0.1 + (category === "forest" || category === "rough" ? 0.15 : 0);
  }
  if (role === "reserve" || role === "rear_security") {
    return cover * 0.4 + road * 0.2 + (category === "urban" || category === "forest" ? 0.18 : 0);
  }
  if (role === "screen") {
    return (category === "forest" ? 0.28 : 0) + cover * 0.22 + observation * 0.12 + road * 0.08;
  }
  if (ownerType === "armor") {
    return (category === "open" ? 0.25 : 0) + observation * 0.18 + road * 0.15 - (category === "urban" || category === "wet" ? 0.12 : 0);
  }
  return cover * 0.32 + (category === "urban" || category === "forest" ? 0.18 : 0.02) + road * 0.08;
}

function selectCommanderTask({ state, actor, actorView, directives, directorPacket, owner, ownerUnits, visibleEnemyIds, lastKnown, objectives, assignments }) {
  const leadUnit = ownerUnits.find((unit) => isUnitReleased(unit, state.game.elapsedMs || 0) && unit.modeState?.reserveState !== "held") || ownerUnits[0];
  if (!leadUnit) return null;

  const weakStrengthThreshold = Math.round(34 + (directives.profile.fallbackBias * 22));
  const weakMoraleThreshold = Math.round(18 + (directives.profile.defenseBias * 18));
  const averageStrength = ownerUnits.reduce((sum, unit) => sum + (unit.strength ?? 100), 0) / Math.max(ownerUnits.length, 1);
  const averageMorale = ownerUnits.reduce((sum, unit) => sum + (unit.morale ?? 100), 0) / Math.max(ownerUnits.length, 1);
  if (averageStrength < weakStrengthThreshold || averageMorale < weakMoraleThreshold) {
    const fallback = findNearestFriendlyAnchor(leadUnit, ownerUnits) || leadUnit.position;
    return {
      id: `task_${state.game.elapsedMs}_${owner.owner}_fallback`,
      owner: owner.owner,
      kind: "fallback",
      targetHex: fallback,
      targetUnitId: null,
      commandKind: "withdraw",
      provenance: "doctrine",
      summary: `Regroup toward ${fallback}.`,
      reason: "fallback",
      assignedAtMs: state.game.elapsedMs,
    };
  }

  const visibleEnemy = findNearestUnitByIdList(leadUnit, state.units || [], visibleEnemyIds);
  if (visibleEnemy) {
    const provenance = actorView.detectedUnits?.includes(visibleEnemy.id) ? "visible" : "contact";
    const targetUnitId = actorView.detectedUnits?.includes(visibleEnemy.id) ? visibleEnemy.id : null;
    const engagementChoice = selectEngagementCommandDetailed(state, actor.id, leadUnit, directives, directorPacket);
    return {
      id: `task_${state.game.elapsedMs}_${owner.owner}_engage_${visibleEnemy.id}`,
      owner: owner.owner,
      kind: "engage",
      targetHex: visibleEnemy.position,
      targetUnitId,
      commandKind: engagementChoice.commandKind,
      commandChoice: engagementChoice.choice,
      provenance,
      summary: `Press enemy contact near ${visibleEnemy.position}.`,
      reason: "visible-contact",
      assignedAtMs: state.game.elapsedMs,
    };
  }

  const rememberedEnemy = findNearestLastKnown(leadUnit, lastKnown);
  if (rememberedEnemy) {
    return {
      id: `task_${state.game.elapsedMs}_${owner.owner}_probe_${rememberedEnemy.unitId}`,
      owner: owner.owner,
      kind: "probe",
      targetHex: rememberedEnemy.position,
      targetUnitId: null,
      commandKind: leadUnit.type === "recon" || directives.profile.reconBias > 1 || directorPacket?.activePackages?.includes("probe")
        ? "screen"
        : "attack_move",
      provenance: "lastKnown",
      summary: `Probe the last reported contact near ${rememberedEnemy.position}.`,
      reason: "last-known",
      assignedAtMs: state.game.elapsedMs,
    };
  }

  const assignedObjective = findAssignedObjective(leadUnit, objectives, assignments, actor.id, directorPacket, state.scenario?.zoneModel);
  if (assignedObjective) {
    const directorPrimaryZoneId = directorPacket?.primaryZones?.[0] || null;
    const assignedZoneId = getObjectiveZoneId(state.scenario?.zoneModel, assignedObjective.hex);
    const followsDirector = Boolean(directorPrimaryZoneId && assignedZoneId === directorPrimaryZoneId);
    const objectiveChoice = selectObjectiveCommandDetailed(state, actor.id, leadUnit, directives, directorPacket);
    return {
      id: `task_${state.game.elapsedMs}_${owner.owner}_seize_${assignedObjective.hex}`,
      owner: owner.owner,
      kind: "seize",
      targetHex: assignedObjective.hex,
      targetUnitId: null,
      commandKind: objectiveChoice.commandKind,
      commandChoice: objectiveChoice.choice,
      provenance: followsDirector ? "directorHint" : "doctrine",
      summary: `Secure objective ${assignedObjective.name || assignedObjective.hex}.`,
      reason: followsDirector ? directorPacket.replanReason || "director" : "objective",
      assignedAtMs: state.game.elapsedMs,
    };
  }

  return {
    id: `task_${state.game.elapsedMs}_${owner.owner}_hold`,
    owner: owner.owner,
    kind: "hold-sector",
    targetHex: leadUnit.position,
    targetUnitId: null,
    commandKind: "hold",
    provenance: "doctrine",
    summary: "Hold current sector frontage.",
    reason: "hold-sector",
    assignedAtMs: state.game.elapsedMs,
  };
}

function buildCommanderHypotheses(actorId, actorView, objectives, state, reserveRelease, directorPacket, owners, zonePlans = {}, operations = null) {
  return {
    actorId,
    visibleContacts: (actorView.detectedUnits?.length || 0) + (actorView.contactUnits?.length || 0),
    lastKnownCount: Object.keys(actorView.lastKnown || {}).length,
    uncontrolledObjectives: (objectives || [])
      .filter((objective) => state.truthState?.objectives?.[objective.hex]?.controller !== actorId)
      .map((objective) => objective.hex),
    reserveRelease,
    directorSuggestedAxes: (directorPacket?.suggestedAxes || []).map((entry) => entry.zoneId || entry).filter(Boolean),
    directorCampaignObjectives: (directorPacket?.campaignObjectives || []).map((entry) => entry.zoneId || entry).filter(Boolean),
    directorSupportingAxes: (directorPacket?.supportingAxes || directorPacket?.supportingZones || []).map((entry) => entry.zoneId || entry).filter(Boolean),
    directorPackages: directorPacket?.activePackages || [],
    ownerCount: Object.keys(owners || {}).length,
    plannedZones: Object.values(zonePlans).map((task) => task.zoneId).filter(Boolean),
    plannedEdges: Object.values(zonePlans).map((task) => task.edgeId).filter(Boolean),
    plannedLanes: Object.values(zonePlans).map((task) => task.laneId).filter(Boolean),
    currentOperation: operations?.main ? {
      goalZoneId: operations.main.goalZoneId,
      phase: operations.main.phase,
      status: operations.main.status,
      supportZoneIds: operations.main.supportZoneIds || [],
    } : null,
    supportOperations: (operations?.support || []).map((operation) => ({
      goalZoneId: operation.goalZoneId,
      phase: operation.phase,
      status: operation.status,
    })),
  };
}

function buildSubordinateReport(state, actorId, owner, ownerUnits, activeTask, actorView, issuedCount, groupPlan = null, previousReport = null) {
  const frontlineHex = estimateGroupHex(ownerUnits);
  const readyUnits = ownerUnits.filter((unit) => !unit.modeState?.currentCommand && !unit.modeState?.travelState).length;
  const reserveHeld = ownerUnits.filter((unit) => unit.modeState?.reserveState === "held").length;
  const visibleEnemies = countNearbyKnownEnemies(ownerUnits, state.units || [], actorView);
  const liveUnits = ownerUnits.filter((unit) => unit.status !== "destroyed").length;
  const strengthTotal = ownerUnits.reduce((sum, unit) => sum + Number(unit.strength || 0), 0);
  const blockedReasons = ownerUnits
    .map((unit) => unit.modeState?.currentCommand?.blockedBy || null)
    .filter(Boolean);
  const underFireCount = ownerUnits.filter((unit) => isUnderFire(unit, state.game.elapsedMs || 0)).length;
  const lowCohesionCount = ownerUnits.filter((unit) => ["suppressed", "retreating", "shattered"].includes(unit.modeState?.moraleState)).length;
  const targetPos = activeTask?.targetHex ? parseUnitPosition(activeTask.targetHex) : null;
  const distances = targetPos
    ? ownerUnits
      .map((unit) => parseUnitPosition(unit.modeState?.settledHex || unit.position))
      .filter(Boolean)
      .map((pos) => hexDistance(pos.c, pos.r, targetPos.c, targetPos.r))
    : [];
  const avgDistanceToTarget = distances.length > 0
    ? roundMetric(distances.reduce((sum, distance) => sum + distance, 0) / distances.length)
    : null;
  const previousDistance = Number.isFinite(previousReport?.avgDistanceToTarget) ? previousReport.avgDistanceToTarget : null;
  const distanceTrend = previousDistance != null && avgDistanceToTarget != null
    ? roundMetric(previousDistance - avgDistanceToTarget)
    : 0;
  const previousFrontline = previousReport?.frontlineHex ? parseUnitPosition(previousReport.frontlineHex) : null;
  const currentFrontline = frontlineHex ? parseUnitPosition(frontlineHex) : null;
  const recentDisplacement = previousFrontline && currentFrontline
    ? hexDistance(previousFrontline.c, previousFrontline.r, currentFrontline.c, currentFrontline.r)
    : 0;
  const routeLength = Array.isArray(groupPlan?.route) ? groupPlan.route.length : 0;
  const routeProgress = routeLength > 1 && groupPlan?.assaultHex
    ? clamp((routeLength - 1 - Math.max(0, avgDistanceToTarget || 0)) / Math.max(1, routeLength - 1), 0, 1)
    : 0;
  const casualtyDelta = previousReport ? Math.max(0, (previousReport.liveUnits || 0) - liveUnits) : 0;
  return {
    owner: owner.owner,
    source: owner.source,
    unitCount: ownerUnits.length,
    liveUnits,
    readyUnits,
    reserveHeld,
    visibleEnemies,
    issuedCount,
    frontlineHex,
    activeTaskId: activeTask?.id || null,
    activeTaskKind: activeTask?.kind || null,
    activeTaskRole: activeTask?.role || null,
    zoneId: activeTask?.zoneId || null,
    edgeId: activeTask?.edgeId || null,
    laneId: activeTask?.laneId || null,
    targetHex: activeTask?.targetHex || null,
    status: activeTask ? (issuedCount > 0 ? "issuing" : "executing") : "idle",
    summary: activeTask?.summary || "Awaiting commander tasking.",
    contactSearchActive: Boolean(activeTask?.contactSearchActive),
    contactSearchRole: activeTask?.contactSearchRole || null,
    contactSearchZoneId: activeTask?.contactSearchZoneId || null,
    contactSearchReason: activeTask?.contactSearchReason || null,
    stagingHex: groupPlan?.stagingHex || null,
    assaultHex: groupPlan?.assaultHex || null,
    supportHexes: groupPlan?.supportByFireHexes || [],
    fallbackHex: groupPlan?.fallbackHex || null,
    reserveHex: groupPlan?.reserveHex || null,
    route: groupPlan?.route || [],
    terrainIntent: groupPlan?.terrainIntent || null,
    avgDistanceToTarget,
    distanceTrend,
    recentDisplacement,
    routeProgress,
    blockedReasons,
    underFireCount,
    lowCohesionCount,
    casualtyDelta,
    strengthTotal,
    reportedAtMs: state.game.elapsedMs,
    actorId,
  };
}

function buildSubordinateGroupPlan(state, terrainData, actorId, owner, ownerUnits, activeTask) {
  if (!activeTask) return null;
  const zoneModel = state.scenario?.zoneModel;
  const lane = activeTask.laneId && activeTask.originZoneId && activeTask.nextZoneId
    ? resolveLaneTraversal(zoneModel, activeTask.laneId, activeTask.originZoneId, activeTask.nextZoneId)
    : (activeTask.laneId ? getLaneById(zoneModel, activeTask.laneId) : null);
  const friendlyUnits = (state.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed");
  const stagingHex = activeTask.stagingHex || lane?.ingressHex || estimateGroupHex(ownerUnits) || ownerUnits[0]?.position || null;
  const supportByFireHexes = Array.isArray(activeTask.supportHexes) ? [...activeTask.supportHexes] : [];
  const assaultHex = ["main_effort", "supporting_attack", "counterattack", "relief", "contain", "screen", "seize", "engage", "probe"].includes(activeTask.role || activeTask.kind)
    ? (activeTask.targetHex || lane?.egressHex || null)
    : null;
  const reserveHex = activeTask.role === "reserve" || activeTask.role === "rear_security"
    ? (activeTask.stagingHex || stagingHex)
    : null;
  const fallbackHex = activeTask.fallbackHex || findNearestFriendlyAnchor(ownerUnits[0], friendlyUnits) || stagingHex || assaultHex;
  return {
    owner: owner.owner,
    taskId: activeTask.id,
    zoneId: activeTask.zoneId || null,
    edgeId: activeTask.edgeId || null,
    laneId: activeTask.laneId || null,
    role: activeTask.role || activeTask.kind || null,
    stagingHex,
    assaultHex,
    supportByFireHexes,
    screenArc: activeTask.role === "screen"
      ? {
        originHex: stagingHex,
        targetHex: assaultHex || activeTask.targetHex || null,
      }
      : null,
    fallbackHex,
    reserveHex,
    route: buildSubordinatePlanRoute(activeTask, lane, stagingHex, assaultHex, reserveHex, fallbackHex),
    terrainIntent: describeSubordinateTerrainIntent(activeTask.role || activeTask.kind, ownerUnits, terrainData, stagingHex, assaultHex || activeTask.targetHex || supportByFireHexes[0] || reserveHex),
    planReason: activeTask.summary || `${activeTask.kind || "hold"} local plan`,
    generatedAtMs: state.game.elapsedMs,
  };
}

function buildSubordinatePlanRoute(activeTask, lane, stagingHex, assaultHex, reserveHex, fallbackHex) {
  const route = [];
  for (const hex of [
    stagingHex,
    ...(lane?.laneHexIds || []),
    assaultHex,
    reserveHex,
    activeTask?.targetHex,
    fallbackHex,
  ]) {
    if (!hex || route[route.length - 1] === hex) continue;
    route.push(hex);
  }
  return route;
}

function describeSubordinateTerrainIntent(role, ownerUnits, terrainData, primaryHex, anchorHex = null) {
  const ownerType = classifyOwnerType(ownerUnits);
  const primaryCell = terrainData?.cells?.[primaryHex] || null;
  const anchorCell = terrainData?.cells?.[anchorHex] || primaryCell || null;
  const primaryTerrain = primaryCell?.terrain || "unknown";
  const anchorTerrain = anchorCell?.terrain || primaryTerrain;
  if (role === "support_by_fire") {
    return {
      posture: "support_by_fire",
      preferred: "elevation and cover",
      ownerType,
      anchorTerrain,
      primaryTerrain,
    };
  }
  if (role === "reserve" || role === "rear_security") {
    return {
      posture: "staging",
      preferred: "covered road-access terrain",
      ownerType,
      anchorTerrain,
      primaryTerrain,
    };
  }
  if (role === "screen") {
    return {
      posture: "screen",
      preferred: "concealment and observation",
      ownerType,
      anchorTerrain,
      primaryTerrain,
    };
  }
  return {
    posture: role || "maneuver",
    preferred: ownerType === "armor" ? "open mobility lanes" : "cover and defensible approach terrain",
    ownerType,
    anchorTerrain,
    primaryTerrain,
  };
}

function findStrikeElementTarget(state, unit, activeTask, phaseIndex = null) {
  const spotterPool = state.combat?.spotterPool?.[unit.actor] || {};
  const taskTargetPos = parseUnitPosition(activeTask?.targetHex || "");
  const indexedZoneCandidates = activeTask?.zoneId && phaseIndex?.liveUnitsByZoneId
    ? (phaseIndex.liveUnitsByZoneId.get(activeTask.zoneId) || [])
    : [];
  const indexedSpatialCandidates = taskTargetPos && phaseIndex
    ? collectSpatialCandidateUnits(phaseIndex, taskTargetPos, 3, (enemy) => enemy.actor !== unit.actor)
    : [];
  const candidates = phaseIndex
    ? sortUnitsByGlobalOrder(
      [...indexedZoneCandidates, ...indexedSpatialCandidates].filter((enemy, index, entries) => (
        enemy.actor !== unit.actor
        && enemy.status !== "destroyed"
        && !enemy.embarkedIn
        && Boolean(spotterPool[enemy.id])
        && entries.findIndex((entry) => entry.id === enemy.id) === index
      )),
      phaseIndex
    ).filter((enemy) => {
      if (activeTask?.zoneId) {
        const enemyZoneId = getIndexedZoneId(enemy, phaseIndex)
          || getZoneIdForHex(state.scenario?.zoneModel, enemy.modeState?.settledHex || enemy.position);
        if (enemyZoneId === activeTask.zoneId) return true;
      }
      if (!taskTargetPos) return false;
      const enemyPos = getIndexedDisplayPosition(enemy, phaseIndex) || getUnitDisplayPosition(enemy);
      return enemyPos && estimateHexDistance(taskTargetPos, enemyPos) <= 3;
    })
    : (state.units || []).filter((enemy) => {
      if (enemy.actor === unit.actor || enemy.status === "destroyed" || enemy.embarkedIn) return false;
      if (!spotterPool[enemy.id]) return false;
      if (activeTask?.zoneId) {
        const enemyZoneId = getZoneIdForHex(state.scenario?.zoneModel, enemy.modeState?.settledHex || enemy.position);
        if (enemyZoneId === activeTask.zoneId) return true;
      }
      if (!taskTargetPos) return false;
      const enemyPos = getUnitDisplayPosition(enemy);
      return enemyPos && estimateHexDistance(taskTargetPos, enemyPos) <= 3;
    });
  return candidates.sort((left, right) => (TYPE_POWER[right.type] || 1) - (TYPE_POWER[left.type] || 1))[0] || null;
}

function chooseStrikeStandoffHex(state, terrainData, unit, activeTask, groupPlan, targetUnit) {
  const anchorHex = groupPlan?.supportByFireHexes?.[0]
    || activeTask.supportHexes?.[0]
    || groupPlan?.stagingHex
    || activeTask.stagingHex
    || unit.position;
  const targetPos = getUnitDisplayPosition(targetUnit);
  const anchorPos = parseUnitPosition(anchorHex || "");
  if (!targetPos || !anchorPos) return anchorHex;
  const rangeHex = combatRangeHex(unit, terrainData);
  const candidates = hexRange(Math.round(targetPos.c), Math.round(targetPos.r), Math.max(1, rangeHex))
    .filter((cell) => {
      const cellHex = cellToPositionString(cell.col, cell.row);
      const cellPos = { c: cell.col, r: cell.row };
      const distanceToTarget = estimateHexDistance(cellPos, targetPos);
      return distanceToTarget >= 1
        && distanceToTarget <= rangeHex
        && (!terrainData?.cells || terrainData.cells[cellHex]);
    })
    .sort((left, right) => {
      const leftAnchor = hexDistance(left.col, left.row, anchorPos.c, anchorPos.r);
      const rightAnchor = hexDistance(right.col, right.row, anchorPos.c, anchorPos.r);
      if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
      const leftTarget = hexDistance(left.col, left.row, Math.round(targetPos.c), Math.round(targetPos.r));
      const rightTarget = hexDistance(right.col, right.row, Math.round(targetPos.c), Math.round(targetPos.r));
      return rightTarget - leftTarget;
    });
  const best = candidates[0];
  return best ? cellToPositionString(best.col, best.row) : anchorHex;
}

function buildSubordinateUnitOrder(state, terrainData, unit, activeTask, ownerUnits, directives, groupPlan = null, phaseIndex = null) {
  if (!activeTask) return null;
  if (unit.type === "headquarters" && activeTask.kind !== "fallback") {
    const commandHex = groupPlan?.reserveHex
      || groupPlan?.stagingHex
      || activeTask.stagingHex
      || findNearestFriendlyAnchor(unit, ownerUnits)
      || unit.position;
    return {
      kind: unit.position === commandHex ? "hold" : "move",
      targetHex: commandHex,
      targetUnitId: null,
      provenance: "doctrine",
      summary: `Establishing a command post for ${activeTask.owner}.`,
    };
  }
  if (activeTask.kind === "fire_mission" && !isIndirectFireUnit(unit) && activeTask.kind !== "fallback") {
    const holdHex = groupPlan?.supportByFireHexes?.[0]
      || activeTask.supportHexes?.[0]
      || groupPlan?.stagingHex
      || activeTask.stagingHex
      || unit.position;
    return {
      kind: unit.position === holdHex ? "hold" : "move",
      targetHex: holdHex,
      targetUnitId: null,
      provenance: "doctrine",
      summary: `Holding support position for ${activeTask.owner}.`,
    };
  }
  if (["artillery", "logistics"].includes(unit.type) && activeTask.kind !== "fallback") {
    const supportHex = groupPlan?.supportByFireHexes?.[0] || groupPlan?.stagingHex || activeTask.supportHexes?.[0] || activeTask.stagingHex || findNearestFriendlyAnchor(unit, ownerUnits) || unit.position;
    return {
      kind: unit.position === supportHex ? "hold" : "move",
      targetHex: supportHex,
      targetUnitId: null,
      provenance: "doctrine",
      summary: `Holding support position for ${activeTask.owner}.`,
    };
  }
  if (activeTask.kind === "fallback") {
    const fallbackHex = groupPlan?.fallbackHex || activeTask.targetHex;
    return {
      kind: "withdraw",
      targetHex: fallbackHex,
      targetUnitId: null,
      provenance: activeTask.provenance,
      summary: `Falling back toward ${fallbackHex}.`,
    };
  }
  if (activeTask.role === "reserve" || activeTask.role === "rear_security") {
    const holdHex = groupPlan?.reserveHex || groupPlan?.stagingHex || activeTask.stagingHex || activeTask.targetHex;
    return {
      kind: unit.position === holdHex ? "hold" : "move",
      targetHex: holdHex,
      targetUnitId: null,
      provenance: activeTask.provenance,
      summary: `Holding role position near ${holdHex}.`,
    };
  }
  if (isStrikeElementUnit(unit) && activeTask.kind !== "fallback") {
    const target = findStrikeElementTarget(state, unit, activeTask, phaseIndex);
    const anchorHex = groupPlan?.supportByFireHexes?.[0]
      || activeTask.supportHexes?.[0]
      || groupPlan?.stagingHex
      || activeTask.stagingHex
      || unit.position;
    if (!target) {
      return {
        kind: unit.position === anchorHex ? "hold" : "move",
        targetHex: anchorHex,
        targetUnitId: null,
        provenance: activeTask.provenance,
        summary: `Holding strike position near ${anchorHex}.`,
      };
    }
    const standoffHex = chooseStrikeStandoffHex(state, terrainData, unit, activeTask, groupPlan, target);
    return {
      kind: unit.position === standoffHex ? "hold" : "move",
      targetHex: standoffHex,
      targetUnitId: target.id,
      provenance: activeTask.provenance,
      summary: `Staging a strike from ${standoffHex}.`,
    };
  }
  if (activeTask.role === "support_by_fire") {
    const supportHex = groupPlan?.supportByFireHexes?.[0] || activeTask.supportHexes?.[0] || activeTask.targetHex;
    return {
      kind: unit.position === supportHex ? "hold" : "move",
      targetHex: supportHex,
      targetUnitId: null,
      provenance: activeTask.provenance,
      summary: `Occupying a support-by-fire position near ${supportHex}.`,
    };
  }
  const targetHex = groupPlan?.assaultHex || activeTask.targetHex;
  return {
    kind: activeTask.commandKind || "move",
    targetHex,
    targetUnitId: activeTask.targetUnitId,
    provenance: activeTask.provenance,
    summary: `Executing ${activeTask.kind.replace(/_/g, " ")} toward ${targetHex}.`,
  };
}

function detectCommanderTaskInvalidation(state, actorId, activeTask, ownerUnits) {
  if (!activeTask) return null;
  const living = (ownerUnits || []).filter((unit) => unit && unit.status !== "destroyed" && !unit.embarkedIn);
  if (living.length === 0) return "force_wiped";

  const role = activeTask.role || activeTask.kind;
  const taskContext = getOperationalTaskContext(state, actorId, activeTask);
  if (["main_effort", "supporting_attack", "seize"].includes(role) && isZoneSecureForActor(taskContext, actorId)) {
    return "zone_already_secure";
  }
  if (role === "relief") {
    const encircled = taskContext.actorSnapshot?.tags?.includes("encircled")
      || taskContext.zoneLedger?.tags?.includes("encircled")
      || taskContext.frontline?.activeTag === "encircled";
    if (!encircled) return "pocket_relieved";
  }
  if (role === "contain") {
    if ((taskContext.actorSnapshot?.state === "friendly" || taskContext.zoneLedger?.controller === actorId) && (taskContext.otherControl || 0) < 0.1) {
      return "threat_departed";
    }
  }
  if (role === "counterattack") {
    if ((taskContext.otherControl || 0) < 0.1) return "counterattack_target_withdrew";
  }
  return null;
}

function invalidateCommanderTasks(state, actor, commanderState, owners, ownerUnitsByOwner = {}) {
  commanderState.taskInvalidations = Array.isArray(commanderState.taskInvalidations) ? commanderState.taskInvalidations : [];
  const ownerMap = Object.fromEntries(Object.values(owners || {}).map((owner) => [owner.owner, owner]));
  const invalidations = [];
  for (const [ownerId, taskQueue] of Object.entries(commanderState.ownerTasks || {})) {
    const activeTask = taskQueue?.[0];
    if (!activeTask) continue;
    const ownerUnits = ownerUnitsByOwner[ownerId]
      || (state.units || []).filter((unit) => ownerMap[ownerId]?.unitIds?.includes(unit.id));
    const reason = detectCommanderTaskInvalidation(state, actor.id, activeTask, ownerUnits);
    if (!reason) continue;
    commanderState.ownerTasks[ownerId] = (taskQueue || []).slice(1);
    const invalidation = {
      atMs: state.game.elapsedMs,
      ownerId,
      taskId: activeTask.id,
      reason,
      zoneId: activeTask.zoneId || null,
      kind: activeTask.kind,
      provenance: activeTask.provenance || "doctrine",
    };
    commanderState.taskInvalidations.push(invalidation);
    invalidations.push(invalidation);
  }
  trimArray(commanderState.taskInvalidations, getMaxLogItems(state));
  return invalidations;
}

function getRecentCommanderTaskInvalidation(commanderState, ownerId, taskId = null) {
  const invalidations = Array.isArray(commanderState?.taskInvalidations) ? commanderState.taskInvalidations : [];
  const cutoffMs = (commanderState?.lastMeaningfulPlanAtMs || 0) - RTS_COMMANDER_BASE_CADENCE_MS;
  for (let index = invalidations.length - 1; index >= 0; index -= 1) {
    const entry = invalidations[index];
    if (entry.ownerId !== ownerId) continue;
    if (taskId && entry.taskId !== taskId) continue;
    if ((entry.atMs || 0) < cutoffMs) continue;
    return entry;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// detectStaleTask — Proactive task invalidation.
//
// Complements `isTaskSatisfied` (which handles *success* cases) by detecting
// tasks whose premise has been invalidated by the world even though the
// success condition is not met. Running on the subordinate cadence (5s) this
// drops stale tasks roughly 10s earlier than waiting for the next commander
// replan (15s cadence), and avoids committing already-committed units to an
// objective that no longer makes sense.
//
// Staleness reasons:
//   • force_wiped        — all owner units destroyed or embarked
//   • zone_lost          — offensive task, but zone is enemy-dominant and we have ~no presence
//   • contain_dissolved  — contain task, but the enemy pocket has evaporated
//   • objective_secured  — task targets a VP hex we already hold past the full hold threshold
//
// Returns { stale: boolean, reason?: string }. Callers that fire on `stale`
// should drop the task, emit a decision-log entry (so the doctrine chip is
// explicit), and wait for the next commander pass to replan.
// ════════════════════════════════════════════════════════════════
const _OFFENSIVE_TASK_ROLES = new Set(["main_effort", "supporting_attack", "counterattack", "relief"]);

function detectStaleTask(state, actorId, activeTask, ownerUnits) {
  if (!activeTask) return { stale: false };

  // 1) Force-wiped owner group
  const living = (ownerUnits || []).filter((u) => u && u.status !== "destroyed" && !u.embarkedIn);
  if (living.length === 0) {
    return { stale: true, reason: "force_wiped" };
  }

  const kind = activeTask.kind;
  const role = activeTask.role;
  const isOffensive = kind === "seize" || kind === "probe" || _OFFENSIVE_TASK_ROLES.has(role);

  // 2) Offensive task on a zone that has decisively flipped to the enemy
  if (isOffensive) {
    const ctx = getOperationalTaskContext(state, actorId, activeTask);
    if (ctx.zoneId && ctx.zoneLedger) {
      const ourShare = ctx.actorSnapshot?.controlShare || 0;
      const enemyShare = ctx.otherControl || 0;
      const enemyController = ctx.zoneLedger.controller && ctx.zoneLedger.controller !== actorId;
      if (enemyController && enemyShare >= ZONE_CONTROL_THRESHOLD + 0.15 && ourShare <= 0.08) {
        return { stale: true, reason: "zone_lost" };
      }
    }
  }

  // 3) Contain task on a dissolved pocket (enemy no longer present)
  if (role === "contain") {
    const ctx = getOperationalTaskContext(state, actorId, activeTask);
    if (ctx.zoneId && ctx.zoneLedger) {
      const enemyShare = ctx.otherControl || 0;
      if (enemyShare < 0.05 && ctx.actorSnapshot?.state === "friendly") {
        return { stale: true, reason: "contain_dissolved" };
      }
    }
  }

  // 4) VP objective already held past the full hold-to-capture threshold
  const holdMsRequired = (state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
  if (holdMsRequired > 0 && activeTask.targetHex && (kind === "seize" || role === "main_effort" || role === "supporting_attack")) {
    const rec = state.truthState?.objectives?.[activeTask.targetHex];
    const progress = getObjectiveProgressRecord(rec, holdMsRequired);
    if (rec && rec.controller === actorId && (rec.heldMs || 0) >= holdMsRequired) {
      return { stale: true, reason: "objective_secured" };
    }
    if (progress.controller === actorId && progress.progress >= 1) {
      return { stale: true, reason: "objective_secured" };
    }
  }

  return { stale: false };
}

function isTaskSatisfied(state, actorId, activeTask, ownerUnits, actorView) {
  if (!activeTask) return true;
  if (activeTask.kind === "seize" || activeTask.role === "main_effort" || activeTask.role === "supporting_attack" || activeTask.role === "counterattack" || activeTask.role === "relief" || activeTask.role === "contain") {
    const taskContext = getOperationalTaskContext(state, actorId, activeTask);
    if (!taskContext.zoneId) {
      const holdMsRequired = (state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000;
      const progress = getObjectiveProgressRecord(state.truthState?.objectives?.[activeTask.targetHex], holdMsRequired);
      return progress.controller === actorId && progress.progress >= 1;
    }
    if (activeTask.role === "relief") {
      return isReliefTaskSatisfied(taskContext, actorId);
    }
    if (activeTask.role === "contain") {
      return isContainTaskSatisfied(taskContext, actorId);
    }
    return isZoneSecureForActor(taskContext, actorId);
  }
  if (activeTask.kind === "engage") {
    if (!activeTask.targetUnitId) return false;
    const target = (state.units || []).find((unit) => unit.id === activeTask.targetUnitId);
    return !target || target.status === "destroyed";
  }
  if (activeTask.kind === "probe") {
    const memory = actorView?.lastKnown?.[activeTask.targetUnitId];
    const lead = ownerUnits[0];
    const leadPos = parseUnitPosition(lead?.modeState?.settledHex || lead?.position);
    const targetPos = parseUnitPosition(activeTask.targetHex);
    return !memory && leadPos && targetPos && hexDistance(leadPos.c, leadPos.r, targetPos.c, targetPos.r) <= 1;
  }
  if (activeTask.kind === "fallback") {
    const targetPos = parseUnitPosition(activeTask.targetHex);
    if (!targetPos) return false;
    return ownerUnits.every((unit) => {
      const pos = parseUnitPosition(unit.modeState?.settledHex || unit.position);
      return pos && hexDistance(pos.c, pos.r, targetPos.c, targetPos.r) <= 1;
    });
  }
  if (activeTask.kind === "fire_mission") {
    // Fire mission completes when either (a) the target zone has no remaining
    // enemy presence for this actor (nothing left to shoot at) or (b) the
    // battery's ammunition has dropped below a configured floor and needs to
    // refit. Either condition returns the artillery to the commander pool so
    // it can be re-tasked to a new target or to a rear resupply posture.
    const ammoFloor = typeof activeTask.fireMissionAmmoFloor === "number" ? activeTask.fireMissionAmmoFloor : 20;
    const minAmmo = Math.min(...ownerUnits.map((u) => (u?.ammo ?? 0)));
    if (Number.isFinite(minAmmo) && minAmmo <= ammoFloor) return true;
    const ctx = getOperationalTaskContext(state, actorId, activeTask);
    if (ctx.zoneId && ctx.zoneLedger) {
      const enemyShare = ctx.otherControl || 0;
      if (enemyShare < 0.05) return true;
    }
    return false;
  }
  if (activeTask.role === "reserve" || activeTask.role === "rear_security" || activeTask.role === "support_by_fire" || activeTask.role === "screen") {
    return false;
  }
  return false;
}

function getOperationalTaskContext(state, actorId, activeTask) {
  const zoneId = activeTask.zoneId || getObjectiveZoneId(state.scenario?.zoneModel, activeTask.targetHex);
  const zoneLedger = state.zoneAnalysis?.truth?.byZone?.[zoneId] || null;
  const actorSnapshot = state.zoneAnalysis?.truth?.bySide?.[actorId]?.[zoneId]
    || state.zoneAnalysis?.perSide?.[actorId]?.[zoneId]
    || null;
  const frontline = state.frontlineState?.perSide?.[actorId]?.[zoneId] || null;
  const otherControl = Math.max(
    0,
    ...Object.entries(zoneLedger?.controlByActor || {})
      .filter(([candidateActorId]) => candidateActorId !== actorId)
      .map(([, share]) => Number(share) || 0)
  );
  return {
    zoneId,
    zoneLedger,
    actorSnapshot,
    frontline,
    otherControl,
  };
}

function isZoneSecureForActor(taskContext, actorId) {
  const actorSnapshot = taskContext?.actorSnapshot;
  const zoneLedger = taskContext?.zoneLedger;
  if (!actorSnapshot || !zoneLedger) return false;
  if (zoneLedger.controller === actorId) return true;
  return actorSnapshot.state === "friendly"
    && (actorSnapshot.controlShare || 0) >= ZONE_CONTROL_THRESHOLD
    && taskContext.otherControl <= ZONE_CONTROL_MIN_FOOTHOLD;
}

function isReliefTaskSatisfied(taskContext, actorId) {
  const actorSnapshot = taskContext?.actorSnapshot;
  if (!actorSnapshot) return false;
  const zoneRecovered = isZoneSecureForActor(taskContext, actorId) || (actorSnapshot.controlShare || 0) >= 0.45;
  const noLongerPressured = !(taskContext.frontline?.activeTag === "encircled" || taskContext.frontline?.activeTag === "salient")
    && actorSnapshot.supplyConnected
    && (actorSnapshot.cutOffRisk || 0) < 0.25
    && (actorSnapshot.salientRisk || 0) < 0.25;
  return zoneRecovered && noLongerPressured;
}

function isContainTaskSatisfied(taskContext, actorId) {
  const actorSnapshot = taskContext?.actorSnapshot;
  if (!actorSnapshot) return false;
  if (isZoneSecureForActor(taskContext, actorId)) return true;
  const enemyPressureBroken = taskContext.otherControl <= 0.45;
  const breakoutSuppressed = (actorSnapshot.breakthroughOpportunity || 0) < 0.35;
  return enemyPressureBroken && breakoutSuppressed && actorSnapshot.state !== "enemy";
}

function computeDirectorMetrics(state, actorId) {
  const objectives = state.scenario?.objectives?.hexVP || [];
  const zoneSnapshots = state.zoneAnalysis?.perSide?.[actorId] || {};
  const zones = Object.values(zoneSnapshots);
  const actorView = state.perceptionState?.[actorId] || { detectedUnits: [], contactUnits: [], lastKnown: {} };
  const friendlyUnits = (state.units || []).filter((unit) => unit.actor === actorId && unit.status !== "destroyed");
  const enemyUnits = (state.units || []).filter((unit) => unit.actor !== actorId && unit.status !== "destroyed");
  const friendlyStrength = friendlyUnits.reduce((sum, unit) => sum + (unit.strength ?? 100), 0);
  const enemyStrength = enemyUnits.reduce((sum, unit) => sum + (unit.strength ?? 100), 0);
  const friendlyObjectives = objectives.filter((objective) => state.truthState?.objectives?.[objective.hex]?.controller === actorId).length;
  const enemyObjectives = objectives.filter((objective) => {
    const controller = state.truthState?.objectives?.[objective.hex]?.controller;
    return controller && controller !== actorId;
  }).length;
  const threatenedZones = zones.filter((zone) => zone.state === "friendly" && ((zone.borderMix?.enemy || 0) + (zone.borderMix?.contested || 0)) > 0.35).length;
  const opportunityZones = zones.filter((zone) => (zone.state === "neutral" || zone.state === "contested") && zone.breakthroughOpportunity >= 0.3).length;
  const cutOffZones = zones.filter((zone) => zone.tags?.includes("encircled")).length;
  const supportCandidateZones = zones.filter((zone) => zone.supportingZoneValue >= 0.6).length;
  const objectiveSignature = zones.map((zone) => `${zone.zoneId}:${zone.state}:${zone.controlShare}`).join("|");
  const commandSignature = (state.truthState?.commandLog || []).slice(-6).map((entry) => `${entry.unitId}:${entry.command?.kind || "-"}`).join("|");
  const stateSignature = `${objectiveSignature}|${commandSignature}`;
  return {
    friendlyStrength,
    enemyStrength,
    strengthRatio: friendlyStrength / Math.max(enemyStrength, 1),
    friendlyObjectives,
    enemyObjectives,
    threatenedZones,
    opportunityZones,
    cutOffZones,
    supportCandidateZones,
    detectedCount: (actorView.detectedUnits || []).length,
    contactCount: (actorView.contactUnits || []).length,
    lastKnownCount: Object.keys(actorView.lastKnown || {}).length,
    stateSignature,
  };
}

function computeDirectorEvidence(previousEvidence, metrics, directives, variationState = null) {
  const drift = variationState?.drift || buildZeroVariationDrift();
  const base = {
    breakthrough: clamp((previousEvidence.breakthrough || 0) * 0.78, 0, 2),
    stabilize: clamp((previousEvidence.stabilize || 0) * 0.78, 0, 2),
    probe: clamp((previousEvidence.probe || 0) * 0.78, 0, 2),
  };
  if (metrics.strengthRatio >= 1.05 && (metrics.friendlyObjectives <= metrics.enemyObjectives || metrics.opportunityZones > 0)) {
    base.breakthrough = clamp(base.breakthrough + 0.6, 0, 2);
  }
  if (metrics.strengthRatio < 0.95 || metrics.enemyObjectives > metrics.friendlyObjectives || metrics.threatenedZones > 0 || metrics.cutOffZones > 0) {
    base.stabilize = clamp(base.stabilize + 0.65, 0, 2);
  }
  if ((metrics.detectedCount + metrics.contactCount) === 0 && metrics.lastKnownCount === 0) {
    base.probe = clamp(base.probe + 0.45, 0, 2);
  }
  if ((metrics.staleMs || 0) >= 12_000) {
    base.probe = clamp(base.probe + 0.4, 0, 2);
  }
  if (directives?.goalModel !== "legacy") {
    base.breakthrough = clamp(base.breakthrough + Math.max(0, drift.tempo) * 0.22 + Math.max(0, drift.flank) * 0.12 - Math.max(0, drift.caution) * 0.1, 0, 2);
    base.stabilize = clamp(base.stabilize + Math.max(0, drift.caution) * 0.2 + Math.max(0, drift.reserve) * 0.12 - Math.max(0, drift.tempo) * 0.08, 0, 2);
    base.probe = clamp(base.probe + Math.max(0, drift.flank) * 0.18 + Math.max(0, drift.support) * 0.05 - Math.max(0, drift.reserve) * 0.04, 0, 2);
  }
  return base;
}

function computeDirectorWeights(evidence) {
  const weights = {};
  for (const [key, value] of Object.entries(evidence || {})) {
    weights[key] = clamp(value / 2, 0, 1);
  }
  return weights;
}

// Hold-to-capture urgency. When the hold window is nonzero, an enemy-held
// objective that's still accumulating its hold timer is a disruption
// opportunity (attack urgency). A friendly-held objective under enemy pressure
// with hold decaying is a defense urgency.
// Returns enemyHoldUrgency (boosts attack score) and friendlyHoldThreat
// (boosts defend score). Both 0..1 scaled.
function computeZoneHoldUrgency(state, actorId, zoneId) {
  const holdMsRequired = ((state.scenario?.rtsOptions?.objectiveHoldSeconds || 0) * 1000);
  if (holdMsRequired <= 0) return { enemyHoldUrgency: 0, friendlyHoldThreat: 0 };
  const objectives = state.scenario?.objectives?.hexVP || [];
  const truthObjectives = state.truthState?.objectives || {};
  let enemyUrgency = 0;
  let friendlyThreat = 0;
  for (const objective of objectives) {
    if (getObjectiveZoneId(state.scenario?.zoneModel, objective.hex) !== zoneId) continue;
    const record = truthObjectives[objective.hex];
    if (!record) continue;
    const liveProgress = getObjectiveProgressRecord(record, holdMsRequired);
    if (liveProgress.controller && liveProgress.controller !== actorId && (!record.controller || record.controller !== liveProgress.controller)) {
      enemyUrgency = Math.max(enemyUrgency, liveProgress.progress > 0.2 ? liveProgress.progress : liveProgress.progress * 0.4);
    } else if (record.controller === actorId && liveProgress.controller && liveProgress.controller !== actorId) {
      friendlyThreat = Math.max(friendlyThreat, liveProgress.progress);
    } else if (record.controller !== actorId && record.controller && liveProgress.controller === actorId) {
      enemyUrgency = Math.max(enemyUrgency, liveProgress.progress * 0.25);
    }
  }
  return { enemyHoldUrgency: enemyUrgency, friendlyHoldThreat: friendlyThreat };
}

function computeSharedZoneControlPressure(state, actorId, zone, snapshot, activePackages = [], directives = null) {
  const controlTuning = getDirectiveTuning(directives, ["director", "controlPressure"], {});
  const defendTuning = getDirectiveTuning(directives, ["director", "defend"], {});
  const exploitTuning = getDirectiveTuning(directives, ["director", "exploit"], {});
  const supportTuning = getDirectiveTuning(directives, ["director", "support"], {});
  const reserveTuning = getDirectiveTuning(directives, ["director", "reserve"], {});
  const probeTuning = getDirectiveTuning(directives, ["director", "probe"], {});
  const baseVp = Math.max(1, zone.totalVp || 0);
  const threatened = snapshot.tags?.includes("encircled") || snapshot.tags?.includes("salient");
  const { enemyHoldUrgency, friendlyHoldThreat } = computeZoneHoldUrgency(state, actorId, zone.zoneId);
  const controlDeficit = clamp(1 - (snapshot.controlShare || 0), 0, 1);
  const frontierReachability = clamp(
    (snapshot.state === "contested" ? 0.45 : 0)
    + ((snapshot.borderMix?.enemy || 0) * 0.55)
    + ((snapshot.borderMix?.contested || 0) * 0.35)
    + (snapshot.tags?.some((tag) => ["frontline", "transition", "breakthrough"].includes(tag)) ? 0.2 : 0),
    0,
    1.5
  );
  const breakthroughOpportunity = clamp(snapshot.breakthroughOpportunity || 0, 0, 1.5);
  const terrainOpportunity = clamp(snapshot.terrainOpportunity || 0, 0, 1.5);
  const supportValue = clamp(snapshot.supportingZoneValue || 0, 0, 1.5);
  const congestionCost = clamp(snapshot.congestionRisk || 0, 0, 1.5);
  const cutOffRisk = clamp((snapshot.cutOffRisk || 0) + ((snapshot.salientRisk || 0) * 0.8), 0, 2);
  const enemyPressure = clamp((snapshot.borderMix?.enemy || 0) + (snapshot.borderMix?.contested || 0), 0, 1.6);
  const rearExposure = snapshot.tags?.includes("rear") ? 1 : 0;
  const transitionValue = snapshot.tags?.includes("transition") ? 1 : snapshot.tags?.includes("frontline") ? 0.65 : 0;
  const neutralOpportunity = snapshot.state === "neutral" ? 1 : snapshot.state === "contested" ? 0.55 : 0;
  const exploitability = clamp((1 - (snapshot.enemyPower || 0) * 0.01), 0, 1.25);
  const controlPressure = roundMetric(
    baseVp * ((controlTuning.baseVpWeight ?? 0.45) + controlDeficit * (controlTuning.controlDeficitWeight ?? 0.85))
    + frontierReachability * (controlTuning.frontierReachabilityWeight ?? 5)
    + breakthroughOpportunity * (controlTuning.breakthroughOpportunityWeight ?? 6.5)
    + terrainOpportunity * (controlTuning.terrainOpportunityWeight ?? 2.8)
    + supportValue * (controlTuning.supportValueWeight ?? 2.8)
    + enemyHoldUrgency * (controlTuning.enemyHoldUrgencyWeight ?? 10)
    - congestionCost * (controlTuning.congestionPenaltyWeight ?? 4)
    - cutOffRisk * (controlTuning.cutOffPenaltyWeight ?? 4.2)
  );
  return {
    baseVp,
    threatened,
    controlDeficit,
    frontierReachability: roundMetric(frontierReachability),
    breakthroughOpportunity: roundMetric(breakthroughOpportunity),
    terrainOpportunity: roundMetric(terrainOpportunity),
    supportValue: roundMetric(supportValue),
    congestionCost: roundMetric(congestionCost),
    cutOffRisk: roundMetric(cutOffRisk),
    enemyPressure: roundMetric(enemyPressure),
    rearExposure,
    transitionValue: roundMetric(transitionValue),
    neutralOpportunity: roundMetric(neutralOpportunity),
    exploitability: roundMetric(exploitability),
    enemyHoldUrgency: roundMetric(enemyHoldUrgency),
    friendlyHoldThreat: roundMetric(friendlyHoldThreat),
    controlPressure,
    attackBase: roundMetric(
      controlPressure
      + baseVp * 0.35
      + supportValue * 1.4
      - congestionCost * 0.8
    ),
    defendBase: roundMetric(
      baseVp * (0.42 + (snapshot.controlShare || 0) * 0.65)
      + enemyPressure * (defendTuning.enemyPressureWeight ?? 7)
      + friendlyHoldThreat * (defendTuning.friendlyHoldThreatWeight ?? 11)
      + cutOffRisk * (defendTuning.cutOffRiskWeight ?? 6.5)
      + transitionValue * (defendTuning.transitionWeight ?? 3.5)
      + (threatened ? (defendTuning.threatenedBonus ?? 6) : 0)
      + rearExposure * (defendTuning.rearExposureWeight ?? 3.5)
    ),
    exploitBase: roundMetric(
      baseVp * (snapshot.state === "neutral"
        ? (exploitTuning.neutralBaseVpWeight ?? 1.2)
        : snapshot.state === "contested"
          ? (exploitTuning.contestedBaseVpWeight ?? 1)
          : snapshot.state === "enemy"
            ? (exploitTuning.enemyBaseVpWeight ?? 0.72)
            : 0.14)
      + breakthroughOpportunity * (exploitTuning.breakthroughWeight ?? 6)
      + frontierReachability * (exploitTuning.frontierWeight ?? 4)
      + terrainOpportunity * (exploitTuning.terrainWeight ?? 2.6)
      + neutralOpportunity * (exploitTuning.neutralOpportunityWeight ?? 3.5)
      + enemyHoldUrgency * (exploitTuning.enemyHoldUrgencyWeight ?? 3)
      + exploitability * (exploitTuning.exploitabilityWeight ?? 2.4)
      - cutOffRisk * (exploitTuning.cutOffPenaltyWeight ?? 2.5)
      - congestionCost * (exploitTuning.congestionPenaltyWeight ?? 1.8)
    ),
    supportBase: roundMetric(
      supportValue * (supportTuning.supportValueWeight ?? 8)
      + terrainOpportunity * (supportTuning.terrainWeight ?? 3.3)
      + frontierReachability * (supportTuning.frontierWeight ?? 2.4)
      + enemyPressure * (supportTuning.enemyPressureWeight ?? 1.6)
    ),
    reserveBase: roundMetric(
      rearExposure * (reserveTuning.rearExposureWeight ?? 6)
      + transitionValue * (reserveTuning.transitionWeight ?? 5)
      + terrainOpportunity * (reserveTuning.terrainWeight ?? 1.6)
      + (snapshot.state === "friendly" ? (reserveTuning.friendlyZoneBase ?? 4) : (reserveTuning.nonFriendlyZoneBase ?? 1.5))
      + friendlyHoldThreat * (reserveTuning.holdThreatWeight ?? 2.2)
      - congestionCost * (reserveTuning.congestionPenaltyWeight ?? 1.8)
      - cutOffRisk * (reserveTuning.cutOffPenaltyWeight ?? 1.4)
    ),
    probeBase: roundMetric(
      (snapshot.state === "neutral"
        ? (probeTuning.neutralBase ?? 5)
        : snapshot.state === "contested"
          ? (probeTuning.contestedBase ?? 4)
          : snapshot.state === "enemy"
            ? (probeTuning.enemyBase ?? 2)
            : 0)
      + frontierReachability * (probeTuning.frontierWeight ?? 4)
      + neutralOpportunity * (probeTuning.neutralOpportunityWeight ?? 3)
      + supportValue * (probeTuning.supportValueWeight ?? 1.5)
      + ((activePackages || []).includes("probe") ? (probeTuning.probePackageBonus ?? 3) : 0)
      + ((snapshot.controlShare || 0) < 0.45 ? (probeTuning.lowControlBonus ?? 2) : 0)
      - congestionCost * (probeTuning.congestionPenaltyWeight ?? 1.2)
    ),
  };
}

function buildDirectorStyleModel(profile, directives) {
  const drift = getDirectiveDrift(directives);
  const scale = getDirectiveTuning(directives, ["director", "styleScale"], {});
  return {
    attackWeight: (1 + ((profile.aggression || 0.5) - 0.5) * 0.55 + drift.tempo * 0.65 - drift.caution * 0.18) * (scale.attack ?? 1),
    cautionWeight: (1 + ((profile.defenseBias || 0.5) - 0.5) * 0.5 + ((profile.encirclementAversion || 0.5) - 0.5) * 0.35 + drift.caution * 0.75) * (scale.caution ?? 1),
    supportWeight: (1 + ((profile.supportBias || 1) - 1) * 0.45 + ((profile.supportByFireBias || 0.5) - 0.5) * 0.35 + drift.support * 0.75) * (scale.support ?? 1),
    reserveWeight: (1 + ((profile.reservePatience || 0.5) - 0.5) * 0.45 + ((profile.reserveRatio || 0.24) - 0.24) * 1.4 + drift.reserve * 0.85) * (scale.reserve ?? 1),
    flankWeight: (1 + ((profile.neutralZoneOpportunism || 0.5) - 0.5) * 0.35 + drift.flank * 0.8) * (scale.flank ?? 1),
    terrainWeight: (1 + ((profile.breakthroughExploitation || 0.5) - 0.5) * 0.35 + drift.flank * 0.2) * (scale.terrain ?? 1),
    vpWeight: (1 + ((profile.vpFocus || 1) - 1) * 0.7) * (scale.vp ?? 1),
    riskPenaltyWeight: (1 + ((profile.frontageDiscipline || 0.5) - 0.5) * 0.4 + ((profile.threatPenalty || 1) - 1) * 0.35 + drift.caution * 0.25) * (scale.riskPenalty ?? 1),
  };
}

function computeDefeatInDetailOpportunity(entry, metrics, directives) {
  const profile = directives?.profile || {};
  const drift = getDirectiveDrift(directives);
  const tuning = getDirectiveTuning(directives, ["director", "defeatInDetail"], {});
  const strengthRatio = metrics?.strengthRatio || 1;
  const eligible = (tuning.enabled ?? 1) !== 0
    && strengthRatio < (tuning.strengthRatioThreshold ?? 0.98)
    && (profile.defenseBias || 0.5) < (tuning.defenseBiasCeiling ?? 0.74);
  if (!eligible || !entry?.intent) return 0;
  const localIsolationWindow = (
    (entry.intent.supportValue || 0) * (tuning.supportWeight ?? 0.85)
    + (entry.intent.frontierReachability || 0) * (tuning.frontierWeight ?? 0.8)
    + (entry.intent.breakthroughOpportunity || 0) * (tuning.breakthroughWeight ?? 0.75)
    + (entry.intent.exploitability || 0) * (tuning.exploitabilityWeight ?? 0.65)
    - (entry.intent.cutOffRisk || 0) * (tuning.cutOffPenaltyWeight ?? 0.45)
    - (entry.intent.congestionCost || 0) * (tuning.congestionPenaltyWeight ?? 0.35)
  );
  const globalInferiority = clamp((1 - strengthRatio) * (tuning.inferiorityScale ?? 3.2), 0, 1.4);
  const postureAllowance = clamp(
    0.95
    - (profile.defenseBias || 0.5) * (tuning.postureDefenseWeight ?? 0.6)
    + (profile.aggression || 0.5) * (tuning.postureAggressionWeight ?? 0.4)
    + Math.max(0, drift.tempo) * (tuning.postureTempoWeight ?? 0.25)
    + Math.max(0, drift.flank) * (tuning.postureFlankWeight ?? 0.18),
    0,
    1.2
  );
  return roundMetric(clamp((localIsolationWindow + globalInferiority) * postureAllowance, 0, 3));
}

function computeDirectorPrimaryChoiceScore(entry, activePackages, metrics, directives) {
  if (!entry) return -Infinity;
  const defeatInDetailOpportunity = computeDefeatInDetailOpportunity(entry, metrics, directives);
  const tuning = getDirectiveTuning(directives, ["director", "primaryChoice"], {});
  if ((activePackages || []).includes("stabilize")) {
    return roundMetric(
      (entry.defend || 0) * (tuning.stabilizeDefendWeight ?? 1.05)
      + (entry.attack || 0) * (tuning.stabilizeAttackWeight ?? 0.25)
      + (entry.intent?.friendlyHoldThreat || 0) * (tuning.stabilizeHoldThreatWeight ?? 4)
      + defeatInDetailOpportunity * (tuning.stabilizeDefeatInDetailWeight ?? 0.35)
    );
  }
  if ((activePackages || []).includes("probe") && !(activePackages || []).includes("breakthrough")) {
    return roundMetric(
      (entry.probe || 0) * (tuning.probeProbeWeight ?? 1.1)
      + (entry.exploit || 0) * (tuning.probeExploitWeight ?? 0.45)
      + (entry.intent?.frontierReachability || 0) * (tuning.probeFrontierWeight ?? 4)
      + defeatInDetailOpportunity * (tuning.probeDefeatInDetailWeight ?? 0.8)
    );
  }
  return roundMetric(
    (entry.attack || 0) * (tuning.attackWeight ?? 1.05)
    + (entry.exploit || 0) * (tuning.exploitWeight ?? 0.55)
    + (entry.intent?.controlPressure || 0) * (tuning.controlPressureWeight ?? 0.18)
    + defeatInDetailOpportunity * (tuning.defeatInDetailWeight ?? 0.9)
  );
}

function summarizeStrategicIntent(entry, directives, metrics = null) {
  if (!entry?.intent) return null;
  const zoneLabel = entry.zone?.sourceName || entry.zoneId;
  const driverRows = [
    { key: "controlDeficit", label: "control deficit", value: entry.intent.controlDeficit },
    { key: "frontierReachability", label: "frontier reachability", value: entry.intent.frontierReachability },
    { key: "enemyHoldUrgency", label: "enemy hold urgency", value: entry.intent.enemyHoldUrgency },
    { key: "friendlyHoldThreat", label: "friendly hold threat", value: entry.intent.friendlyHoldThreat },
    { key: "breakthroughOpportunity", label: "breakthrough opportunity", value: entry.intent.breakthroughOpportunity },
    { key: "supportValue", label: "support value", value: entry.intent.supportValue },
    { key: "cutOffRisk", label: "cut-off risk", value: entry.intent.cutOffRisk },
    { key: "congestionCost", label: "congestion cost", value: entry.intent.congestionCost },
  ]
    .filter((driver) => Number.isFinite(driver.value) && driver.value > 0.08)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((driver) => ({ ...driver, value: roundMetric(driver.value) }));
  const driverText = driverRows.length > 0
    ? driverRows.map((driver) => `${driver.label}=${driver.value}`).join(", ")
    : "no dominant driver";
  const defeatInDetailOpportunity = directives ? computeDefeatInDetailOpportunity(entry, metrics, directives) : 0;
  return {
    goalModel: directives?.goalModel || RTS_AI_GOAL_MODEL_DEFAULT,
    zoneId: entry.zoneId,
    zoneLabel,
    controlPressure: roundMetric(entry.intent.controlPressure || 0),
    defeatInDetailOpportunity,
    topDrivers: driverRows,
    summary: `Shared map-control pressure favors ${zoneLabel} because ${driverText}${defeatInDetailOpportunity > 0.6 ? "; it also looks like a local defeat-in-detail opportunity" : ""}.`,
  };
}

function scoreZonesForDirectorLegacy(state, actorId, packageWeights, activePackages, directives) {
  const zoneModel = state.scenario?.zoneModel;
  const zoneSnapshots = state.zoneAnalysis?.perSide?.[actorId] || {};
  const edgeSnapshots = state.edgeAnalysis?.perSide?.[actorId] || {};
  const profile = directives?.profile || getAiProfile((state.scenario?.actors || []).find((actor) => actor.id === actorId)?.aiConfig?.profile || "balanced");
  const scored = [];
  for (const zone of zoneModel?.zones || []) {
    const snapshot = zoneSnapshots?.[zone.zoneId];
    if (!snapshot) continue;
    const baseVp = Math.max(1, zone.totalVp || 0);
    const threatened = snapshot.tags?.includes("encircled") || snapshot.tags?.includes("salient");
    const neutralOpportunity = snapshot.state === "neutral" ? (2 + (profile.neutralZoneOpportunism || 0.5) * 8) : 0;
    const salientPenalty = snapshot.salientRisk * (7 - (profile.salientTolerance || 0.5) * 4);
    const rearSecurityBonus = (snapshot.tags?.includes("rear") ? 1 : 0) * (4 + (profile.rearSecurityBias || 0.5) * 6);
    const supportBiasBonus = snapshot.supportingZoneValue * (6 + (profile.supportByFireBias || 0.5) * 4);
    const encircledReliefBonus = snapshot.tags?.includes("encircled") ? (12 + (profile.pocketReliefBias || 0.5) * 18) : 0;
    const { enemyHoldUrgency, friendlyHoldThreat } = computeZoneHoldUrgency(state, actorId, zone.zoneId);
    const attackScore = (
      baseVp * (1 - snapshot.controlShare) * profile.vpFocus
      + snapshot.breakthroughOpportunity * 12
      + snapshot.terrainOpportunity * (4 + profile.breakthroughExploitation * 2)
      + snapshot.supportingZoneValue * 4
      + enemyHoldUrgency * (10 + profile.vpFocus * 4)
      - snapshot.congestionRisk * (5 + profile.frontageDiscipline * 4)
      - snapshot.cutOffRisk * (3 + profile.encirclementAversion * 4)
      - salientPenalty
    );
    const defendScore = (
      baseVp * (snapshot.controlShare + 0.15)
      + ((snapshot.borderMix?.enemy || 0) + (snapshot.borderMix?.contested || 0)) * 18
      + snapshot.cutOffRisk * 10
      + snapshot.salientRisk * 8
      + (threatened ? 10 : 0)
      + encircledReliefBonus
      + rearSecurityBonus
      + friendlyHoldThreat * (8 + profile.defenseBias * 4)
    );
    const exploitScore = (
      baseVp * (snapshot.state === "neutral" ? 1.25 : snapshot.state === "contested" ? 1 : snapshot.state === "enemy" ? 0.65 : 0.08)
      + snapshot.breakthroughOpportunity * 9
      + (snapshot.controlShare < 0.5 ? 5 : 0)
      + neutralOpportunity
      - snapshot.enemyPower * 0.2
      - (snapshot.salientRisk * (5 - (profile.salientTolerance || 0.5) * 3))
    );
    const supportingScore = supportBiasBonus + snapshot.terrainOpportunity * 3 + neutralOpportunity * 0.35;
    const reserveScore = ((snapshot.tags?.includes("transition") || snapshot.tags?.includes("rear")) ? 8 : 2)
      + snapshot.terrainOpportunity * 2
      + (snapshot.state === "friendly" ? 4 : 0)
      + rearSecurityBonus
      + (snapshot.tags?.includes("transition") ? (profile.reservePatience || 0.5) * 4 : 0);
    const probeScore = ((activePackages || []).includes("probe") ? 8 : 2)
      + (snapshot.state === "neutral" ? 6 : snapshot.state === "contested" ? 3 : 0)
      + (snapshot.controlShare < 0.45 ? 3 : 0)
      + neutralOpportunity;
    const targetHex = chooseZoneRepresentativeHexForDirector(state, zone, snapshot, edgeSnapshots);
    scored.push({
      zoneId: zone.zoneId,
      zone,
      snapshot,
      targetHex,
      intent: computeSharedZoneControlPressure(state, actorId, zone, snapshot, activePackages, directives),
      attack: roundMetric(attackScore),
      defend: roundMetric(defendScore),
      exploit: roundMetric(exploitScore),
      supporting: roundMetric(supportingScore),
      reserve: roundMetric(reserveScore),
      probe: roundMetric(probeScore),
    });
  }
  return {
    attack: [...scored].sort((left, right) => right.attack - left.attack),
    defend: [...scored].sort((left, right) => right.defend - left.defend),
    exploit: [...scored].sort((left, right) => right.exploit - left.exploit),
    supporting: [...scored].sort((left, right) => right.supporting - left.supporting),
    reserve: [...scored].sort((left, right) => right.reserve - left.reserve),
    probe: [...scored].sort((left, right) => right.probe - left.probe),
    stabilize: [...scored]
      .filter((entry) => entry.snapshot.state === "friendly" || entry.snapshot.tags?.includes("encircled") || entry.snapshot.tags?.includes("salient"))
      .sort((left, right) => right.defend - left.defend),
  };
}

function scoreZonesForDirector(state, actorId, packageWeights, activePackages, directives) {
  if (directives?.goalModel === "legacy") {
    return scoreZonesForDirectorLegacy(state, actorId, packageWeights, activePackages, directives);
  }
  const zoneModel = state.scenario?.zoneModel;
  const zoneSnapshots = state.zoneAnalysis?.perSide?.[actorId] || {};
  const edgeSnapshots = state.edgeAnalysis?.perSide?.[actorId] || {};
  const profile = directives?.profile || getAiProfile((state.scenario?.actors || []).find((actor) => actor.id === actorId)?.aiConfig?.profile || "balanced");
  const style = buildDirectorStyleModel(profile, directives);
  const drift = getDirectiveDrift(directives);
  const scored = [];
  for (const zone of zoneModel?.zones || []) {
    const snapshot = zoneSnapshots?.[zone.zoneId];
    if (!snapshot) continue;
    const intent = computeSharedZoneControlPressure(state, actorId, zone, snapshot, activePackages, directives);
    const targetHex = chooseZoneRepresentativeHexForDirector(state, zone, snapshot, edgeSnapshots);
    const attackScore = (
      intent.attackBase * style.attackWeight
      + intent.baseVp * (style.vpWeight - 1) * 2.2
      + intent.terrainOpportunity * (style.terrainWeight - 1) * 6
      + intent.supportValue * (style.supportWeight - 1) * 4
      - intent.cutOffRisk * (style.cautionWeight - 1) * 3.5
      - intent.congestionCost * (style.riskPenaltyWeight - 1) * 2.8
    );
    const defendScore = (
      intent.defendBase * style.cautionWeight
      + intent.rearExposure * (((profile.rearSecurityBias || 0.5) - 0.5) * 7)
      + intent.transitionValue * (((profile.frontageDiscipline || 0.5) - 0.5) * 5)
      + intent.supportValue * (style.supportWeight - 1) * 2.2
    );
    const exploitScore = (
      intent.exploitBase * ((style.attackWeight * 0.55) + (style.flankWeight * 0.45))
      + intent.controlDeficit * (((profile.neutralZoneOpportunism || 0.5) - 0.5) * 7)
      - intent.cutOffRisk * (style.cautionWeight - 1) * 2.4
    );
    const supportingScore = (
      intent.supportBase * style.supportWeight
      + intent.controlPressure * 0.06
      + intent.breakthroughOpportunity * drift.support * 2
    );
    const reserveScore = (
      intent.reserveBase * style.reserveWeight
      + intent.cutOffRisk * (style.cautionWeight - 1) * 2
      + intent.rearExposure * (((profile.rearSecurityBias || 0.5) - 0.5) * 6)
    );
    const probeScore = (
      intent.probeBase * ((style.flankWeight * 0.55) + (style.attackWeight * 0.2) + 0.25)
      + ((activePackages || []).includes("probe") ? 2.5 : 0)
      - Math.max(0, drift.reserve) * 1.5
    );
    scored.push({
      zoneId: zone.zoneId,
      zone,
      snapshot,
      targetHex,
      intent,
      attack: roundMetric(attackScore),
      defend: roundMetric(defendScore),
      exploit: roundMetric(exploitScore),
      supporting: roundMetric(supportingScore),
      reserve: roundMetric(reserveScore),
      probe: roundMetric(probeScore),
    });
  }
  return {
    attack: [...scored].sort((left, right) => right.attack - left.attack),
    defend: [...scored].sort((left, right) => right.defend - left.defend),
    exploit: [...scored].sort((left, right) => right.exploit - left.exploit),
    supporting: [...scored].sort((left, right) => right.supporting - left.supporting),
    reserve: [...scored].sort((left, right) => right.reserve - left.reserve),
    probe: [...scored].sort((left, right) => right.probe - left.probe),
    stabilize: [...scored]
      .filter((entry) => entry.snapshot.state === "friendly" || entry.snapshot.tags?.includes("encircled") || entry.snapshot.tags?.includes("salient"))
      .sort((left, right) => right.defend - left.defend),
  };
}

function chooseZoneRepresentativeHexForDirector(state, zone, snapshot, edgeSnapshots) {
  const objective = (state.scenario?.objectives?.hexVP || []).find((candidate) => getObjectiveZoneId(state.scenario?.zoneModel, candidate.hex) === zone.zoneId);
  if (objective && (snapshot.state === "enemy" || snapshot.state === "contested")) return objective.hex;
  if (snapshot.tags?.includes("encircled") || snapshot.tags?.includes("salient")) {
    const hottestEdge = (zone.adjacentZoneIds || [])
      .map((neighborId) => edgeSnapshots?.[[zone.zoneId, neighborId].sort().join("__")])
      .filter(Boolean)
      .sort((left, right) => (right.lanePressure + right.crossingRisk) - (left.lanePressure + left.crossingRisk))[0];
    if (hottestEdge) {
      const edge = getEdgeById(state.scenario?.zoneModel, hottestEdge.edgeId);
      return edge?.crossingHexIds?.[0] || edge?.edgeHexIds?.[0] || zone.centroidHex;
    }
  }
  return zone.centroidHex || zone.sourceHex;
}

function computeFrontageIntent(metrics, primary, secondary, activePackages) {
  if ((activePackages || []).includes("stabilize") || metrics.threatenedZones > 0) return "stabilize";
  if (secondary?.length > 0 || metrics.supportCandidateZones > 0) return "broad";
  if ((activePackages || []).includes("breakthrough")) return "focused";
  return "balanced";
}

function selectDirectorTarget(state, actorId, objectives, activePackages) {
  const objectiveRows = (objectives || []).map((objective) => {
    const controller = state.truthState?.objectives?.[objective.hex]?.controller || null;
    const objectivePos = parseUnitPosition(objective.hex);
    const enemyNear = objectivePos
      ? (state.units || []).filter((unit) => {
        if (unit.actor === actorId || unit.status === "destroyed") return false;
        const pos = parseUnitPosition(unit.modeState?.settledHex || unit.position);
        return pos && hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r) <= 2;
      }).length
      : 0;
    const friendlyNear = objectivePos
      ? (state.units || []).filter((unit) => {
        if (unit.actor !== actorId || unit.status === "destroyed") return false;
        const pos = parseUnitPosition(unit.modeState?.settledHex || unit.position);
        return pos && hexDistance(pos.c, pos.r, objectivePos.c, objectivePos.r) <= 2;
      }).length
      : 0;
    return { ...objective, controller, enemyNear, friendlyNear };
  });

  if (activePackages.includes("stabilize")) {
    return objectiveRows.find((objective) => objective.controller === actorId && objective.enemyNear > objective.friendlyNear)
      || objectiveRows.find((objective) => objective.controller !== actorId)
      || objectiveRows[0]
      || null;
  }
  if (activePackages.includes("breakthrough")) {
    return objectiveRows
      .filter((objective) => objective.controller !== actorId)
      .sort((left, right) => left.enemyNear - right.enemyNear)[0]
      || objectiveRows[0]
      || null;
  }
  if (activePackages.includes("probe")) {
    return objectiveRows.find((objective) => objective.controller !== actorId) || objectiveRows[0] || null;
  }
  return objectiveRows.find((objective) => objective.controller !== actorId) || objectiveRows[0] || null;
}

function describeThoughtTarget(state, hex) {
  if (!hex) return "the current front";
  const objective = (state.scenario?.objectives?.hexVP || []).find((candidate) => candidate.hex === hex);
  if (objective?.name) return objective.name;
  const parsed = parseUnitPosition(hex);
  if (!parsed) return hex;
  return cellToDisplayString(parsed.c, parsed.r);
}

function describeZoneList(state, zoneIds) {
  const names = (zoneIds || [])
    .map((zoneId) => getZoneById(state.scenario?.zoneModel, zoneId))
    .filter(Boolean)
    .map((zone) => zone.sourceName || zone.zoneId);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function describeObjectiveBalance(metrics) {
  const friendly = metrics?.friendlyObjectives || 0;
  const enemy = metrics?.enemyObjectives || 0;
  if (friendly > enemy) {
    return `We currently hold ${friendly} objective${friendly === 1 ? "" : "s"} to their ${enemy}`;
  }
  if (enemy > friendly) {
    return `They are ahead on objectives, ${enemy} to ${friendly}`;
  }
  if (friendly === 0 && enemy === 0) {
    return "No side has locked down an objective yet";
  }
  return `Objective control is even at ${friendly}-${enemy}`;
}

function describeThoughtPackages(activePackages) {
  if (!Array.isArray(activePackages) || activePackages.length === 0) return "";
  if (activePackages.length === 1) {
    return `the ${activePackages[0].replace(/_/g, " ")} package`;
  }
  const normalized = activePackages.map((value) => value.replace(/_/g, " "));
  return `${normalized.slice(0, -1).join(", ")} and ${normalized[normalized.length - 1]} packages`;
}

function describeDirectorReplanReason(reason) {
  switch (reason) {
    case "pressure-spike":
      return "enemy pressure is rising on a key point";
    case "favorable-window":
      return "there is a favorable opening to exploit";
    case "stale-front":
      return "the front has gone stale and needs a probe";
    default:
      return "the battle picture is still broadly stable";
  }
}

function formatDoctrineLabel(profileId) {
  return String(profileId || "balanced").replace(/_/g, " ");
}

function describeCommanderTasks(state, ownerTasks) {
  if (!Array.isArray(ownerTasks) || ownerTasks.length === 0) {
    return "";
  }
  const fragments = ownerTasks.slice(0, 2).map((task) => {
    const ownerLabel = describeTaskOwner(state, task.owner);
    const targetText = describeThoughtTarget(state, task.targetHex);
    switch (task.kind) {
      case "fallback":
        return `${ownerLabel} regroup toward ${targetText}`;
      case "engage":
        return `${ownerLabel} press the fight near ${targetText}`;
      case "probe":
        return `${ownerLabel} probe toward ${targetText}`;
      case "seize":
        return `${ownerLabel} secure ${targetText}`;
      case "hold-sector":
        return `${ownerLabel} hold the current frontage`;
      default:
        return `${ownerLabel} execute ${task.kind.replace(/_/g, " ")} toward ${targetText}`;
    }
  });
  if (fragments.length === 1) {
    return `I am directing ${fragments[0]}.`;
  }
  return `I am directing ${fragments[0]}, while ${fragments[1]}.`;
}

function describeTaskOwner(state, ownerId) {
  const ownerText = String(ownerId || "");
  const [baseOwnerId, packageKind, packageDetail] = ownerText.split("::");
  const headquarters = (state.units || []).find((unit) => unit.id === ownerId || unit.id === baseOwnerId);
  if (headquarters?.name) {
    if (packageKind === "fires") return `${headquarters.name} fires`;
    if (packageKind === "command") return `${headquarters.name} command group`;
    if (packageKind === "maneuver") {
      const detailText = packageDetail ? ` ${packageDetail.replace(/-/g, " ")}` : "";
      return `${headquarters.name}${detailText} maneuver group`;
    }
    return headquarters.name;
  }
  if (!ownerId) return "the line";
  if (packageKind === "fires") return `${baseOwnerId.replace(/-/g, " ")} fires`;
  if (packageKind === "command") return `${baseOwnerId.replace(/-/g, " ")} command group`;
  if (packageKind === "maneuver") {
    const detailText = packageDetail ? ` ${packageDetail.replace(/-/g, " ")}` : "";
    return `${baseOwnerId.replace(/-/g, " ")}${detailText} maneuver group`;
  }
  if (ownerId.startsWith("sector-")) {
    return `${ownerId.replace(/^sector-/, "the ").replace(/-/g, " ")} sector`;
  }
  return ownerId.replace(/-/g, " ");
}

function describeCommanderIntel(visibleContacts, lastKnownCount) {
  if (visibleContacts > 0) {
    return `I have ${visibleContacts} confirmed ${visibleContacts === 1 ? "contact" : "contacts"} in view${lastKnownCount > 0 ? `, plus ${lastKnownCount} fading ${lastKnownCount === 1 ? "report" : "reports"}` : ""}.`;
  }
  if (lastKnownCount > 0) {
    return `I do not have a live target, but I am still working from ${lastKnownCount} ${lastKnownCount === 1 ? "last-known report" : "last-known reports"}.`;
  }
  return "I do not have a clean enemy picture yet, so I am leaning on doctrine, terrain, and objective pressure.";
}

function describeDirectorPacket(state, primary, pressure, activePackages, metrics, supporting = [], campaignObjective = null, strategicIntent = null) {
  const packageText = activePackages.length > 0 ? activePackages.join(", ") : "baseline";
  const targetText = primary?.zone?.sourceName || primary?.zoneId || "the current front";
  const campaignText = campaignObjective && campaignObjective.zoneId !== primary?.zoneId
    ? ` while shaping toward ${campaignObjective.zone?.sourceName || campaignObjective.zoneId}`
    : "";
  const supportText = supporting.length > 0 ? ` with support around ${describeZoneList(state, supporting.map((entry) => entry.zoneId))}` : "";
  const intentText = strategicIntent?.summary ? ` ${strategicIntent.summary}` : "";
  return `Director ${pressure} toward ${targetText}${campaignText}${supportText} using ${packageText}; strength ratio ${(metrics.strengthRatio || 0).toFixed(2)}.${intentText}`;
}

function maybeResumeBlockedAdvance(state, terrainData, unit) {
  const command = unit.modeState?.currentCommand;
  if (!command?.blockedBy || unit.modeState?.travelState || !command.targetHex) return false;
  const entry = classifyHexEntry(state, state.occupancy || {}, command.targetHex, unit);
  if (!entry.allowed) {
    return false;
  }
  const replanned = planRoute(state, unit, terrainData, command.targetHex);
  if (!replanned) return false;
  unit.modeState.currentCommand = { ...command, blockedBy: null };
  unit.modeState.travelState = replanned;
  unit.modeState.routeProvenance = {
    planner: replanned.planner || "weighted",
    threatAware: Boolean(replanned.threatAware),
    waypointCount: Math.max(0, (replanned.route?.length || 1) - 1),
    targetHex: command.targetHex,
  };
  pushEvent(state, "movement", `${unit.name} resumed its advance on ${command.targetHex}.`, { unitId: unit.id, targetHex: command.targetHex });
  return true;
}

function estimateGroupHex(units) {
  const positions = (units || [])
    .map((unit) => parseUnitPosition(unit.modeState?.settledHex || unit.position))
    .filter(Boolean);
  if (positions.length === 0) return null;
  const avgCol = positions.reduce((sum, pos) => sum + pos.c, 0) / positions.length;
  const avgRow = positions.reduce((sum, pos) => sum + pos.r, 0) / positions.length;
  return cellToPositionString(Math.round(avgCol), Math.round(avgRow));
}

function countNearbyKnownEnemies(ownerUnits, units, actorView) {
  const lead = ownerUnits[0];
  const leadPos = parseUnitPosition(lead?.modeState?.settledHex || lead?.position);
  if (!leadPos) return 0;
  const known = new Set([...(actorView?.detectedUnits || []), ...(actorView?.contactUnits || [])]);
  return (units || []).filter((unit) => {
    if (!known.has(unit.id)) return false;
    const pos = parseUnitPosition(unit.modeState?.settledHex || unit.position);
    return pos && hexDistance(leadPos.c, leadPos.r, pos.c, pos.r) <= 4;
  }).length;
}

function areTaskQueuesEquivalent(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false;
    const leftQueue = left[leftKeys[index]] || [];
    const rightQueue = right[rightKeys[index]] || [];
    if (leftQueue.length !== rightQueue.length) return false;
    for (let queueIndex = 0; queueIndex < leftQueue.length; queueIndex += 1) {
      const leftTask = leftQueue[queueIndex];
      const rightTask = rightQueue[queueIndex];
      if (
        leftTask?.id !== rightTask?.id
        || leftTask?.kind !== rightTask?.kind
        || leftTask?.targetHex !== rightTask?.targetHex
        || leftTask?.targetUnitId !== rightTask?.targetUnitId
      ) {
        return false;
      }
    }
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// isIndirectFireUnit — True for unit types that deliver fires via
// ballistic arcs and can be called onto targets they cannot see
// themselves as long as a friendly spotter has eyes on.
//
// Currently only `artillery` qualifies; future additions (mortar,
// mlrs, rocket_artillery) would go here. Attack helicopters are
// intentionally direct-fire flyers and do NOT belong on this list.
// ════════════════════════════════════════════════════════════════
function isIndirectFireUnit(unit) {
  return unit?.type === "artillery";
}

function isEnemyInFireMissionEnvelope(enemy, mission) {
  if (!enemy || !mission) return false;
  if (Array.isArray(mission.targetUnitIds) && mission.targetUnitIds.length > 0) {
    return mission.targetUnitIds.includes(enemy.id);
  }
  if (mission.zoneId) {
    const enemyZoneId = getZoneIdForHex(mission.zoneModel, enemy.position);
    if (enemyZoneId && enemyZoneId === mission.zoneId) return true;
  }
  const missionCenter = parseUnitPosition(mission.targetHex || "");
  const enemyPos = getUnitDisplayPosition(enemy);
  if (!missionCenter || !enemyPos) return false;
  return estimateHexDistance(missionCenter, enemyPos) <= (mission.missionRadius || 0);
}

function buildAreaTargetingSolution(mission) {
  if (!mission?.targetHex) return null;
  const quality = mission.areaFireQuality
    || (mission.ammoType === "counter_battery" ? "observed" : ["destroy", "suppress"].includes(mission.ammoType) ? "preplanned" : "direct");
  return {
    enemy: null,
    targetId: null,
    targetHex: mission.targetHex,
    spotterQuality: quality,
    accuracyMult: getSpotterAccuracyMult(quality),
  };
}

function canUsePreplannedAreaFire(mission) {
  return Boolean(
    mission?.targetHex
    && ["destroy", "suppress"].includes(mission?.ammoType)
  );
}

function isArtilleryEmplaced(unit) {
  if (unit.type !== "artillery") return true;
  if (unit.modeState?.travelState) return false;
  const commandKind = unit.modeState?.currentCommand?.kind || null;
  if (!commandKind) return true;
  if (ARTILLERY_TRANSIT_COMMAND_KINDS.has(commandKind)) return false;
  return commandKind === "hold";
}

function getCombatUnitZoneId(zoneModel, unit) {
  return getZoneIdForHex(zoneModel, unit.modeState?.settledHex || unit.position);
}

function selectCombatTarget(state, unit, units, actorView, terrainData, zoneModel = null, phaseIndex = null) {
  const detected = new Set(actorView?.detectedUnits || []);
  const contacts = new Set(actorView?.contactUnits || []);
  const origin = getIndexedDisplayPosition(unit, phaseIndex) || getUnitDisplayPosition(unit);
  if (!origin) return null;
  const rangeHex = combatRangeHex(unit, terrainData);
  const indirect = isIndirectFireUnit(unit);
  const fireMission = indirect
    ? {
      ...(unit.modeState?.fireMission || null),
      zoneId: unit.modeState?.fireMission?.zoneId || unit.modeState?.fireMissionZoneId || null,
      ammoType: unit.modeState?.fireMission?.ammoType || unit.modeState?.fireMissionAmmoType || null,
      targetHex: unit.modeState?.fireMission?.targetHex || unit.modeState?.fireMissionTargetHex || null,
      zoneModel,
    }
    : null;
  const actorSpotterPool = state.combat?.spotterPool?.[unit.actor] || {};

  if (indirect && !fireMission) return null;
  if (indirect && ["smoke", "illuminate"].includes(fireMission?.ammoType)) {
    return buildAreaTargetingSolution(fireMission);
  }

  const candidates = [];
  const candidateUnits = phaseIndex
    ? collectSpatialCandidateUnits(phaseIndex, origin, rangeHex, (enemy) => enemy.actor !== unit.actor)
    : units;
  for (const enemy of candidateUnits) {
    if (enemy.actor === unit.actor || enemy.status === "destroyed" || enemy.embarkedIn) continue;
    const targetPos = getIndexedDisplayPosition(enemy, phaseIndex) || getUnitDisplayPosition(enemy);
    if (!targetPos) continue;
    const distance = estimateHexDistance(origin, targetPos);
    if (distance > rangeHex) continue;

    if (indirect) {
      const spotterRecord = actorSpotterPool[enemy.id];
      if (!spotterRecord || !isEnemyInFireMissionEnvelope(enemy, fireMission)) continue;
      const quality = spotterRecord.quality || "observed";
      const accuracyMult = getSpotterAccuracyMult(quality);
      const selfLos = computeLosWithAreaEffects(state, origin, targetPos, terrainData);
      const losPenalty = selfLos.result === "BLOCKED" ? 0.25 : 0;
      const score = (TYPE_POWER[enemy.type] || 1) - (distance * 0.08) - losPenalty + accuracyMult * 0.35;
      candidates.push({
        enemy,
        targetId: enemy.id,
        targetHex: spotterRecord.targetHex || cellToPositionString(Math.round(targetPos.c), Math.round(targetPos.r)),
        spotterQuality: quality,
        accuracyMult,
        score,
        perceivedType: enemy.type,
      });
      continue;
    }

    if (!detected.has(enemy.id) && !contacts.has(enemy.id)) continue;
    const los = computeLosWithAreaEffects(state, origin, targetPos, terrainData);
    if (los.result === "BLOCKED") continue;
    const helicopterBonus = isHelicopter(enemy) && unit.type === "air_defense" ? 0.75 : 0;
    const perceivedType = detected.has(enemy.id)
      ? enemy.type
      : actorView?.lastKnown?.[enemy.id]?.type || null;
    const score = (TYPE_POWER[perceivedType] || 1) - (distance * 0.1) + helicopterBonus;
    candidates.push({
      enemy,
      targetId: enemy.id,
      targetHex: cellToPositionString(Math.round(targetPos.c), Math.round(targetPos.r)),
      spotterQuality: "direct",
      accuracyMult: 1,
      score,
      perceivedType,
    });
  }
  if (candidates.length === 0) {
    if (!indirect) return null;
    if (fireMission?.ammoType === "counter_battery") {
      return buildAreaTargetingSolution(fireMission);
    }
    if (canUsePreplannedAreaFire(fireMission)) {
      return buildAreaTargetingSolution({
        ...fireMission,
        areaFireQuality: "preplanned",
      });
    }
    return null;
  }

  const rankedCandidates = [...candidates].sort((left, right) => right.score - left.score);
  if (indirect && fireMission?.ammoType === "counter_battery") {
    const artilleryCandidates = rankedCandidates.filter((candidate) => candidate.perceivedType === "artillery" || candidate.enemy?.type === "artillery");
    if (artilleryCandidates.length > 0) return artilleryCandidates[0];
  }
  return rankedCandidates[0];
}

function performDirectFire(state, attacker, target, terrainData) {
  const attackerPos = getUnitDisplayPosition(attacker);
  const targetPos = getUnitDisplayPosition(target);
  if (!attackerPos || !targetPos) return null;
  const distance = estimateHexDistance(attackerPos, targetPos);
  const rangeHex = combatRangeHex(attacker, terrainData);
  const targetCellKey = cellToPositionString(Math.round(targetPos.c), Math.round(targetPos.r));
  const terrain = terrainData?.cells?.[targetCellKey]?.terrain || "open_ground";
  // Cover scaling: helicopters in flight gain only partial benefit from ground
  // cover, and that benefit disappears entirely when engaged by air-defense.
  // Against other attackers the helo keeps half the usual cover value (a
  // compromise between "airborne target is exposed" and "fast mover is harder
  // to hit"), preserving transport survivability through infantry fire but
  // making AD threat envelopes meaningful.
  const adAntiAir = attacker.type === "air_defense" && isHelicopter(target);
  const coverMult = isHelicopter(target) ? (adAntiAir ? 0.25 : 0.5) : 1;
  const cover = (TERRAIN_DEFENSE[terrain] || 0) * coverMult;
  const readinessFactor = clamp((attacker.readiness ?? 100) / 100, 0.3, 1);
  const power = (TYPE_POWER[attacker.type] || 1) * readinessFactor * clamp((attacker.strength ?? 100) / 100, 0.2, 1);
  const rangeFactor = clamp(1 - (distance / Math.max(rangeHex, 1)) * 0.5, 0.4, 1.1);
  const hitChance = clamp(0.25 + (power * 0.18) + rangeFactor * 0.2 - cover + (adAntiAir ? 0.06 : 0), 0.1, 0.92);
  const roll = nextRandom(state);
  const hit = roll <= hitChance;
  const damageMult = adAntiAir ? 1.15 : 1.0;
  const damage = hit ? Math.round((power * 7 + nextRandom(state) * 5) * (1 - cover) * damageMult) : 0;
  const suppression = hit ? 0.22 + nextRandom(state) * 0.2 : 0.05 + nextRandom(state) * 0.05;
  const targetZoneEffects = getZoneOperationalEffects(state, target);

  target.strength = clamp((target.strength ?? 100) - damage, 0, 100);
  target.morale = clamp((target.morale ?? 100) - Math.round((damage * 0.6 + suppression * 12) * targetZoneEffects.moraleLossMultiplier), 0, 100);
  target.modeState.suppression = clamp((target.modeState.suppression || 0) + suppression, 0, 1.5);
  target.modeState.lastCombatEvent = { atMs: state.game.elapsedMs, type: "incoming-fire", from: attacker.id };
  attacker.modeState.lastCombatEvent = { atMs: state.game.elapsedMs, type: "firing", target: target.id };
  attacker.modeState.weaponCooldownMs = TYPE_COOLDOWN_MS[attacker.type] || TYPE_COOLDOWN_MS.default;
  attacker.ammo = clamp((attacker.ammo ?? 100) - (attacker.type === "attack_helicopter" ? 4 : attacker.type === "armor" ? 3 : 2), 0, 100);
  attacker.readiness = clamp((attacker.readiness ?? 100) - 0.8, 0, 100);

  const message = `${attacker.name} engaged ${target.name}${hit ? ` for ${damage}% damage` : " without effect"}.`;
  pushEvent(state, "combat", message, { attackerId: attacker.id, targetId: target.id, damage, hit });
  return { message };
}

function queueArtilleryImpact(state, attacker, targetingSolution) {
  const origin = getUnitDisplayPosition(attacker);
  const mission = attacker.modeState?.fireMission || {};
  const targetHex = targetingSolution?.targetHex || mission.targetHex || attacker.modeState?.fireMissionTargetHex || null;
  if (!origin || !targetHex) return;
  const ammoType = mission.ammoType || attacker.modeState?.fireMissionAmmoType || "destroy";
  const ammo = AMMO_TYPE_EFFECTS[ammoType] || AMMO_TYPE_EFFECTS.destroy;
  state.combat.pendingImpacts.push({
    id: `impact_${state.game.elapsedMs}_${attacker.id}`,
    sourceId: attacker.id,
    actorId: attacker.actor,
    targetId: targetingSolution?.targetId || null,
    targetHex,
    impactAtMs: state.game.elapsedMs + ARTILLERY_FLIGHT_MS,
    power: TYPE_POWER[attacker.type] || 1,
    ammoType,
    radius: mission.missionRadius || ammo.radius || getFireMissionRadius(ammoType),
    spotterQuality: targetingSolution?.spotterQuality || "observed",
    accuracyMult: targetingSolution?.accuracyMult ?? FIRE_MISSION_QUALITY_MULT.observed,
  });
  state.combat.counterBatteryQueue.push({
    actorId: attacker.actor,
    sourceUnitId: attacker.id,
    targetHex: cellToPositionString(Math.round(origin.c), Math.round(origin.r)),
    createdAtMs: state.game.elapsedMs,
    expiresAtMs: state.game.elapsedMs + COUNTER_BATTERY_TTL_MS,
  });
  attacker.modeState.weaponCooldownMs = TYPE_COOLDOWN_MS.artillery;
  attacker.ammo = clamp((attacker.ammo ?? 100) - (ammo.ammoCost || 5), 0, 100);
  const ammoLabel = ammoType !== "destroy" ? ` (${ammoType.replace(/_/g, " ")})` : "";
  pushEvent(state, "combat", `${attacker.name} fired an artillery mission${ammoLabel}.`, {
    attackerId: attacker.id,
    targetId: targetingSolution?.targetId || null,
    targetHex,
    ammoType,
  });
}

// ════════════════════════════════════════════════════════════════
// Ammunition-type damage/suppression/selection multipliers.
//
//   destroy         — standard HE, balanced damage and suppression (baseline).
//   suppress        — thin-walled submunitions, low damage but heavy
//                     suppression and morale shock; meant to pin not kill.
//   counter_battery — armor-piercing + precision; higher damage against
//                     artillery, ordinary against other types.
//   smoke           — no damage, no suppression — reserved for future overlay
//                     work that actually obscures LOS. For now treated as a
//                     zero-effect round (the commander still burns ammo).
//   illuminate      — same as smoke for now; future overlay will boost
//                     friendly detection in the area.
// ════════════════════════════════════════════════════════════════
const AMMO_TYPE_EFFECTS = {
  destroy: { damageMult: 1.0, suppressionMult: 1.0, moraleMult: 1.0, selectorFor: null, radius: 1, ammoCost: 5, areaEffectKind: null },
  suppress: { damageMult: 0.45, suppressionMult: 1.75, moraleMult: 1.35, selectorFor: null, radius: 2, ammoCost: 3, areaEffectKind: null },
  counter_battery: { damageMult: 1.1, suppressionMult: 0.85, moraleMult: 0.8, selectorFor: "artillery", radius: 1, ammoCost: 6, areaEffectKind: null },
  smoke: { damageMult: 0, suppressionMult: 0.1, moraleMult: 0, selectorFor: null, radius: 2, ammoCost: 2, areaEffectKind: "smoke" },
  illuminate: { damageMult: 0, suppressionMult: 0, moraleMult: 0, selectorFor: null, radius: 3, ammoCost: 1, areaEffectKind: "illuminate" },
};

function applyAreaEffectFromImpact(state, impact, ammo) {
  if (!ammo?.areaEffectKind || !impact?.targetHex) return;
  const durationMs = AREA_EFFECT_DURATIONS_MS[ammo.areaEffectKind] || 0;
  if (!durationMs) return;
  const effectId = `${ammo.areaEffectKind}_${impact.actorId}_${impact.targetHex}`;
  state.combat.areaEffects = (state.combat.areaEffects || []).filter((effect) => effect.id !== effectId);
  state.combat.areaEffects.push({
    id: effectId,
    kind: ammo.areaEffectKind,
    actorId: impact.actorId,
    centerHex: impact.targetHex,
    radius: impact.radius || ammo.radius || getFireMissionRadius(impact.ammoType),
    createdAtMs: state.game.elapsedMs,
    expiresAtMs: state.game.elapsedMs + durationMs,
  });
}

function applyImpact(state, impact) {
  const targetPos = parseUnitPosition(impact.targetHex);
  if (!targetPos) return;
  const ammo = AMMO_TYPE_EFFECTS[impact.ammoType] || AMMO_TYPE_EFFECTS.destroy;
  applyAreaEffectFromImpact(state, impact, ammo);
  const radius = impact.radius || ammo.radius || 1;
  const accuracyMult = impact.accuracyMult ?? 1;
  for (const unit of state.units || []) {
    if (unit.status === "destroyed") continue;
    const pos = getUnitDisplayPosition(unit);
    if (!pos) continue;
    const distance = estimateHexDistance(pos, targetPos);
    if (distance > radius) continue;
    const falloff = distance === 0 ? 1 : clamp(1 - (distance / Math.max(radius + 0.5, 1)), 0.2, 0.75);
    const selectorPenalty = ammo.selectorFor && unit.type !== ammo.selectorFor ? 0.4 : 1.0;
    const baseDamage = (impact.power * 8 + nextRandom(state) * 6) * falloff * accuracyMult;
    const damage = Math.round(baseDamage * ammo.damageMult * selectorPenalty);
    const zoneEffects = getZoneOperationalEffects(state, unit);
    unit.strength = clamp((unit.strength ?? 100) - damage, 0, 100);
    unit.morale = clamp(
      (unit.morale ?? 100) - Math.round((damage * 0.5 + 4 * ammo.moraleMult) * zoneEffects.moraleLossMultiplier),
      0,
      100
    );
    unit.modeState.suppression = clamp(
      (unit.modeState.suppression || 0) + 0.3 * falloff * ammo.suppressionMult * accuracyMult,
      0,
      1.5
    );
    unit.modeState.lastCombatEvent = { atMs: state.game.elapsedMs, type: "impact", from: impact.sourceId };
    if (unit.strength <= 0) {
      markDestroyed(state, unit);
    }
  }
  pushEvent(state, "combat", `Artillery impacted at ${impact.targetHex}.`, { impact });
}

function handleRetreat(state, unit, terrainData) {
  const friendlies = (state.units || []).filter((candidate) => candidate.actor === unit.actor && candidate.id !== unit.id && candidate.status !== "destroyed");
  const anchor = findNearestFriendlyAnchor(unit, friendlies);
  if (!anchor) return;
  unit.modeState.currentCommand = {
    id: `retreat_${state.game.elapsedMs}_${unit.id}`,
    kind: "withdraw",
    issuedAtMs: state.game.elapsedMs,
    unitIds: [unit.id],
    targetHex: anchor,
    queueSlot: 0,
  };
  unit.modeState.travelState = planRoute(state, unit, terrainData, anchor);
}

function markDestroyed(state, unit) {
  if (unit.status === "destroyed") return;
  unit.status = "destroyed";
  unit.strength = 0;
  unit.modeState.travelState = null;
  unit.modeState.currentCommand = null;
  unit.modeState.moraleState = "destroyed";
  unit.visibleTo = [];
  pushEvent(state, "combat", `${unit.name} was destroyed.`, { unitId: unit.id });
}

function maybeStartQueuedCommand(state, unit, terrainData) {
  if (!unit.modeState.commandQueue?.length) return;
  const [queued] = unit.modeState.commandQueue;
  unit.modeState.commandQueue = [];
  assignImmediateCommand(state, unit, terrainData, queued);
}

function pushAiDecision(state, actorId, unitId, provenance, source, summary, details = null) {
  const entry = {
    atMs: state.game.elapsedMs,
    actorId,
    unitId,
    provenance,
    source,
    summary,
    details,
  };
  state.ai.decisionLog.push(entry);
  state.telemetry.provenance.push(entry);
  trimArray(state.ai.decisionLog, getMaxLogItems(state));
  trimArray(state.telemetry.provenance, getMaxLogItems(state));
  if (isAiSummaryEnabled(state) && actorId) {
    upsertAiSummary(state, actorId, { reason: "decision" });
  }
  if (isAiDiaryEnabled(state)) {
    pushAiDiaryEntry(state, {
      actorId,
      unitId,
      source,
      kind: "decision",
      summary,
      provenance,
      details,
    });
  }
}

function pushEvent(state, kind, message, details = null) {
  const entry = {
    atMs: state.game.elapsedMs || 0,
    kind,
    message,
    details,
  };
  state.truthState.eventLog.push(entry);
  trimArray(state.truthState.eventLog, getMaxLogItems(state));
  state.replay.events.push(entry);
  trimArray(state.replay.events, getMaxReplayEvents(state));
  if (isAiDiaryEnabled(state)) {
    pushAiDiaryEntry(state, {
      actorId: resolveDiaryActorId(state, details),
      unitId: details?.unitId || details?.attackerId || details?.targetId || null,
      source: "battlefield",
      kind: `${kind}_event`,
      summary: message,
      details,
    });
  }
}

function snapshotReplay(state) {
  if ((state.telemetry.ticks || 0) % getSnapshotEveryTicks(state) !== 0) return;
  const snapshot = {
    atMs: state.game.elapsedMs,
    winner: state.game.winner,
    objectiveControl: Object.fromEntries(
      Object.entries(state.truthState?.objectives || {}).map(([hex, control]) => [hex, {
        controller: control?.controller || null,
        heldMs: control?.heldMs || 0,
        candidateController: control?.candidateController || null,
        candidateHeldMs: control?.candidateHeldMs || 0,
        seededFromBootstrap: Boolean(control?.seededFromBootstrap),
      }])
    ),
    directorPackets: Object.fromEntries(
      Object.entries(state.ai?.directors || {}).map(([actorId, directorState]) => [actorId, {
        goalModel: directorState?.packet?.goalModel || null,
        variationMode: directorState?.packet?.variationMode || null,
        variation: directorState?.packet?.variation || null,
        pressure: directorState?.packet?.pressureAssessment || directorState?.packet?.pressure || null,
        pressureAssessment: directorState?.packet?.pressureAssessment || directorState?.packet?.pressure || null,
        primaryZones: directorState?.packet?.primaryZones || [],
        campaignObjectiveZones: directorState?.packet?.campaignObjectiveZones || [],
        secondaryZones: directorState?.packet?.secondaryZones || [],
        holdZones: directorState?.packet?.holdZones || [],
        probeZones: directorState?.packet?.probeZones || [],
        threatenedZones: directorState?.packet?.threatenedZones || [],
        opportunityZones: directorState?.packet?.opportunityZones || [],
        defeatInDetailZones: directorState?.packet?.defeatInDetailZones || [],
        reserveZones: directorState?.packet?.reserveZones || [],
        supportingZones: directorState?.packet?.supportingZones || [],
        frontierZoneIds: directorState?.packet?.frontierZoneIds || [],
        currentPhaseDepthBudget: directorState?.packet?.currentPhaseDepthBudget ?? null,
        frontageIntent: directorState?.packet?.frontageIntent || null,
        suggestedAxes: directorState?.packet?.suggestedAxes || [],
        campaignObjectives: directorState?.packet?.campaignObjectives || [],
        supportingAxes: directorState?.packet?.supportingAxes || [],
        risks: directorState?.packet?.risks || [],
        opportunities: directorState?.packet?.opportunities || [],
        alerts: directorState?.packet?.alerts || [],
        confidence: directorState?.packet?.confidence ?? null,
        replanReason: directorState?.packet?.replanReason || null,
        activePackages: directorState?.packet?.activePackages || [],
        primaryChoice: directorState?.packet?.primaryChoice || null,
        strategicIntent: directorState?.packet?.strategicIntent || null,
        summary: directorState?.packet?.summary || null,
      }])
    ),
    zoneAnalysis: {
      perSide: Object.fromEntries(
        Object.entries(state.zoneAnalysis?.perSide || {}).map(([actorId, zones]) => [actorId, Object.fromEntries(
          Object.entries(zones || {}).map(([zoneId, zone]) => [zoneId, {
            state: zone.state,
            tags: zone.tags,
            controlShare: zone.controlShare,
            supportingZoneValue: zone.supportingZoneValue,
            congestionRisk: zone.congestionRisk,
            cutOffRisk: zone.cutOffRisk,
            salientRisk: zone.salientRisk,
            friendlyHoldingPower: zone.friendlyHoldingPower,
            enemyHoldingPower: zone.enemyHoldingPower,
            borderMix: zone.borderMix || null,
          }])
        )])
      ),
    },
    edgeAnalysis: {
      perSide: Object.fromEntries(
        Object.entries(state.edgeAnalysis?.perSide || {}).map(([actorId, edges]) => [actorId, Object.fromEntries(
          Object.entries(edges || {}).map(([edgeId, edge]) => [edgeId, {
            state: edge.state,
            lanePressure: edge.lanePressure,
            throughputScore: edge.throughputScore,
          }])
        )])
      ),
    },
    perception: Object.fromEntries(
      Object.entries(state.perceptionState || {}).map(([actorId, view]) => {
        const lastKnownEntries = Object.values(view.lastKnown || {});
        const ages = lastKnownEntries.map((entry) => Math.max(0, (state.game.elapsedMs || 0) - (entry?.seenAtMs || 0)));
        const staleThreshold = Math.round(LAST_KNOWN_DECAY_MS * 0.66);
        return [actorId, {
          visibleCells: (view.visibleCells || []).length,
          detectedUnits: (view.detectedUnits || []).length,
          contactUnits: (view.contactUnits || []).length,
          lastKnownUnits: lastKnownEntries.length,
          agingLastKnownUnits: ages.filter((ageMs) => ageMs >= staleThreshold).length,
          lastKnownMaxAgeMs: ages.length > 0 ? Math.max(...ages) : 0,
          lastKnownMeanAgeMs: ages.length > 0 ? roundMetric(ages.reduce((sum, ageMs) => sum + ageMs, 0) / ages.length) : 0,
        }];
      })
    ),
    thoughts: Object.fromEntries(
      Object.entries(state.ai?.thoughts || {}).map(([actorId, thoughtState]) => [actorId, {
        commander: thoughtState?.commander?.text || null,
        director: thoughtState?.director?.text || null,
        atMs: Math.max(thoughtState?.commander?.atMs || 0, thoughtState?.director?.atMs || 0),
      }])
    ),
    commanderHypotheses: Object.fromEntries(
      Object.entries(state.ai?.commanders || {}).map(([actorId, commanderState]) => [actorId, commanderState?.hypotheses || null])
    ),
    commanderReplans: Object.fromEntries(
      Object.entries(state.ai?.commanders || {}).map(([actorId, commanderState]) => [actorId, {
        lastMeaningfulPlanAtMs: commanderState?.lastMeaningfulPlanAtMs || null,
        lastReplanReasons: commanderState?.lastReplanReasons || [],
        replanCount: Array.isArray(commanderState?.replanLog) ? commanderState.replanLog.length : 0,
        operations: commanderState?.operations || null,
      }])
    ),
    commanderInvalidations: Object.fromEntries(
      Object.entries(state.ai?.commanders || {}).map(([actorId, commanderState]) => [actorId, commanderState?.taskInvalidations || []])
    ),
    commanderPlans: Object.fromEntries(
      Object.entries(state.ai?.commanders || {}).map(([actorId, commanderState]) => [actorId, commanderState?.ownerZoneTasks || {}])
    ),
    subordinatePlans: Object.fromEntries(
      Object.entries(state.ai?.subordinates || {}).map(([actorId, subordinateState]) => [actorId, subordinateState?.groupPlans || {}])
    ),
    subordinateReports: Object.fromEntries(
      Object.entries(state.ai?.subordinates || {}).map(([actorId, subordinateState]) => [actorId, subordinateState?.reports || {}])
    ),
    combat: {
      areaEffects: (state.combat?.areaEffects || []).map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        actorId: effect.actorId,
        centerHex: effect.centerHex,
        radius: effect.radius,
        createdAtMs: effect.createdAtMs,
        expiresAtMs: effect.expiresAtMs,
      })),
      counterBatteryQueue: (state.combat?.counterBatteryQueue || []).map((entry) => ({
        actorId: entry.actorId,
        sourceUnitId: entry.sourceUnitId,
        targetHex: entry.targetHex,
        createdAtMs: entry.createdAtMs,
        expiresAtMs: entry.expiresAtMs,
      })),
      spotterPool: Object.fromEntries(
        Object.entries(state.combat?.spotterPool || {}).map(([actorId, records]) => [actorId, Object.fromEntries(
          Object.entries(records || {}).map(([enemyId, record]) => [enemyId, {
            firstSeenAtMs: record.firstSeenAtMs,
            lastConfirmedAtMs: record.lastConfirmedAtMs,
            expiresAtMs: record.expiresAtMs,
            quality: record.quality,
            spotterId: record.spotterId,
            spotterType: record.spotterType,
            targetHex: record.targetHex,
            zoneId: record.zoneId,
          }])
        )])
      ),
    },
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      actor: unit.actor,
      type: unit.type,
      position: unit.position,
      settledHex: unit.modeState?.settledHex || unit.position,
      strength: unit.strength,
      morale: unit.morale,
      readiness: unit.readiness,
      ammo: unit.ammo,
      fuel: unit.fuel,
      status: unit.status,
      embarkedIn: unit.embarkedIn || null,
      command: unit.modeState?.currentCommand?.kind || null,
      commandId: unit.modeState?.currentCommand?.id || null,
      commandTargetHex: unit.modeState?.currentCommand?.targetHex || null,
      commandTargetUnitId: unit.modeState?.currentCommand?.targetUnitId || null,
      commandIssuedAtMs: unit.modeState?.commandIssuedAtMs || unit.modeState?.currentCommand?.issuedAtMs || null,
      commandBlockedBy: unit.modeState?.currentCommand?.blockedBy || null,
      queueLength: unit.modeState?.commandQueue?.length || 0,
      reserveState: unit.modeState?.reserveState || null,
      currentTaskSource: unit.modeState?.currentTaskSource || null,
      assignedTaskId: unit.modeState?.assignedTaskId || null,
      moraleState: unit.modeState?.moraleState || null,
      suppression: unit.modeState?.suppression || 0,
      fireMission: unit.modeState?.fireMission || null,
      fireMissionAmmoType: unit.modeState?.fireMissionAmmoType || null,
      fireMissionZoneId: unit.modeState?.fireMissionZoneId || null,
      fireMissionTargetHex: unit.modeState?.fireMissionTargetHex || null,
      routeProvenance: unit.modeState?.routeProvenance || null,
      lastCombatEvent: unit.modeState?.lastCombatEvent || null,
    })),
  };
  state.replay.snapshots.push(snapshot);
  trimArray(state.replay.snapshots, getMaxSnapshots(state));
  state.telemetry.snapshots.push({
    atMs: snapshot.atMs,
    livingUnits: snapshot.units.filter((unit) => unit.status !== "destroyed").length,
  });
  state.telemetry.perceptionSnapshots.push({
    atMs: snapshot.atMs,
    actors: snapshot.perception,
  });
  trimArray(state.telemetry.snapshots, getMaxSnapshots(state));
  trimArray(state.telemetry.perceptionSnapshots, getMaxSnapshots(state));
}

function combatRangeHex(unit, terrainData) {
  const km = unit.weaponRangeKm?.effective || TYPE_RANGE_KM[unit.type] || 2;
  const cellKm = terrainData?.cellSizeKm || 1;
  return Math.max(1, Math.round(km / Math.max(cellKm, 0.25)));
}

function detectionRadius(unit, environment) {
  const base = TYPE_DETECTION[unit.type] || 4;
  const factor = VISIBILITY_FACTORS[environment?.visibility || "good"] || 1;
  return Math.max(2, Math.round(base * factor));
}

function findNearestFriendlyAnchor(unit, friendlies) {
  const origin = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  if (!origin) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const friendly of friendlies) {
    if (friendly.id === unit.id || friendly.status === "destroyed") continue;
    if (!(friendly.type === "headquarters" || friendly.type === "logistics")) continue;
    const pos = parseUnitPosition(friendly.modeState?.settledHex || friendly.position);
    if (!pos) continue;
    const distance = hexDistance(origin.c, origin.r, pos.c, pos.r);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = friendly.position;
    }
  }
  return best;
}

function findNearestLastKnown(unit, lastKnown) {
  const origin = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  if (!origin) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const [unitId, memory] of Object.entries(lastKnown || {})) {
    const pos = parseUnitPosition(memory.position);
    if (!pos) continue;
    const distance = hexDistance(origin.c, origin.r, pos.c, pos.r);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { unitId, ...memory };
    }
  }
  return best;
}

function findAssignedObjective(unit, objectives, assignments, actorId, directorPacket, zoneModel = null) {
  if (!Array.isArray(objectives) || objectives.length === 0) return null;
  const primaryZoneId = directorPacket?.currentOperation?.goalZoneId
    || directorPacket?.suggestedAxes?.[0]?.zoneId
    || directorPacket?.primaryZones?.[0]
    || null;
  if (primaryZoneId && zoneModel) {
    const zoneObjective = objectives.find((objective) => getObjectiveZoneId(zoneModel, objective.hex) === primaryZoneId);
    if (zoneObjective) {
      return zoneObjective;
    }
  }
  const assignment = assignments?.[unit.id];
  if (!assignment) return objectives[0];
  if (assignment.owner === "sector-west") return objectives[0];
  if (assignment.owner === "sector-center") return objectives[Math.floor(objectives.length / 2)] || objectives[0];
  if (assignment.owner === "sector-east") return objectives[objectives.length - 1] || objectives[0];
  return objectives[0];
}

function findNearestUnitByIdList(unit, units, idSet) {
  const origin = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  if (!origin) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of units) {
    if (!idSet.has(candidate.id)) continue;
    const pos = parseUnitPosition(candidate.modeState?.settledHex || candidate.position);
    if (!pos) continue;
    const distance = hexDistance(origin.c, origin.r, pos.c, pos.r);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function findNearbySupport(unit, units) {
  const origin = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  if (!origin) return false;
  return (units || []).some((candidate) => {
    if (candidate.actor !== unit.actor || candidate.id === unit.id || candidate.status === "destroyed") return false;
    if (!(candidate.type === "headquarters" || candidate.type === "logistics")) return false;
    const pos = parseUnitPosition(candidate.modeState?.settledHex || candidate.position);
    if (!pos) return false;
    return hexDistance(origin.c, origin.r, pos.c, pos.r) <= 2;
  });
}

function isFootMobile(unit) {
  return (unit.movementType || "foot") === "foot" && !isHelicopter(unit);
}

function isTransportHelicopter(unit) {
  return isHelicopter(unit) && (unit.type === "transport" || (unit.transportCapacity || 0) > 0);
}

function isUnitReleased(unit, elapsedMs) {
  return (unit?.modeState?.releaseAtMs || 0) <= elapsedMs;
}

function drainMovementResources(unit) {
  unit.fuel = clamp((unit.fuel ?? 100) - (isHelicopter(unit) ? 2.5 : 0.8), 0, 100);
  unit.supply = clamp((unit.supply ?? 100) - 0.35, 0, 100);
  unit.readiness = clamp((unit.readiness ?? 100) - 0.5, 0, 100);
}

function computeSegmentMs(unit, terrainData, from, to) {
  if (!from || !to) return 1000 * RTS_MOVEMENT_TIME_SCALE;
  const movementType = unit.movementType || "foot";
  const base = BASE_SPEEDS[movementType] || BASE_SPEEDS.foot;
  if (base <= 0) return 999999;
  const cell = terrainData?.cells?.[cellToPositionString(to.col, to.row)];
  const terrainMultiplier = terrainCostMultiplier(cell, movementType);
  const readinessFactor = clamp((unit.readiness ?? 100) / 100, 0.45, 1);
  const fuelFactor = clamp((unit.fuel ?? 100) / 100, 0.4, 1);
  const speed = base * readinessFactor * fuelFactor;
  return Math.max(350 * RTS_MOVEMENT_TIME_SCALE, Math.round(((1000 * terrainMultiplier) / Math.max(speed, 0.05)) * RTS_MOVEMENT_TIME_SCALE));
}

function terrainCostMultiplier(cell, movementType) {
  if (!cell) return 1;
  if (movementType === "helicopter") return 0.75;
  const terrain = cell.terrain || "open_ground";
  if (terrain === "dense_urban" || terrain === "dense_forest" || terrain === "jungle") return 1.75;
  if (terrain === "light_urban" || terrain === "forest" || terrain === "mountain") return 1.35;
  if (terrain === "suburban" || terrain === "forested_hills" || terrain === "wetland") return 1.2;
  return 1;
}

function getUnitDisplayPosition(unit) {
  const settled = parseUnitPosition(unit.modeState?.settledHex || unit.position);
  const travel = unit.modeState?.travelState;
  if (!settled || !travel || !travel.route || travel.routeIndex <= 0 || travel.routeIndex >= travel.route.length) {
    return settled;
  }
  const from = parseUnitPosition(travel.route[travel.routeIndex - 1]);
  const to = parseUnitPosition(travel.route[travel.routeIndex]);
  if (!from || !to) return settled;
  const progress = clamp((travel.progressMs || 0) / Math.max(travel.segmentMs || 1, 1), 0, 1);
  return interpolateOffsetHex(from, to, progress);
}

function interpolateOffsetHex(from, to, progress) {
  const axialFrom = offsetToAxial(from.c ?? from.col, from.r ?? from.row);
  const axialTo = offsetToAxial(to.c ?? to.col, to.r ?? to.row);
  const q = axialFrom.q + (axialTo.q - axialFrom.q) * progress;
  const r = axialFrom.r + (axialTo.r - axialFrom.r) * progress;
  const col = q + (r - (Math.round(r) & 1)) / 2;
  return { c: col, r };
}

function estimateHexDistance(a, b) {
  const ax = offsetToAxial(a.c ?? a.col, Math.round(a.r ?? a.row));
  const bx = offsetToAxial(b.c ?? b.col, Math.round(b.r ?? b.row));
  return hexDistanceAxial(ax.q, ax.r, bx.q, bx.r);
}

function isUnderFire(unit, nowMs) {
  const last = unit.modeState?.lastCombatEvent?.atMs || 0;
  return nowMs - last <= UNDER_FIRE_WINDOW_MS;
}

function tickCooldown(unit, tickMs) {
  unit.modeState.weaponCooldownMs = Math.max(0, (unit.modeState.weaponCooldownMs || 0) - tickMs);
}

function nextRandom(state) {
  let seed = (state.game.rngState || state.game.rngSeed || 1) >>> 0;
  seed += 0x6D2B79F5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  state.game.rngState = seed >>> 0;
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function trimArray(arr, maxLength) {
  if (arr.length > maxLength) {
    arr.splice(0, arr.length - maxLength);
  }
}
