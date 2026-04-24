import { buildTerrainSummary } from "../simulation/prompts.js";
import { getTemplatesForScale } from "../simulation/eraTemplates.js";
import { DEFAULT_ENVIRONMENT, SCALE_TIERS, getUnitFieldsForScale } from "../simulation/schemas.js";
import {
  normalizeRtsAiExperimentTuning,
  normalizeRtsAiGoalModel,
  normalizeRtsAiVariationConfig,
  normalizeRtsAiVariationMode,
} from "../simulation/aiProfiles.js";
import { hexDistance } from "../mapRenderer/HexMath.js";
import { parseUnitPosition } from "../mapRenderer/overlays/UnitOverlay.js";
import { buildZoneModel } from "./zoneModel.js";

const RTS_ALLOWED_BASE_TYPES = new Set([
  "infantry",
  "mechanized",
  "armor",
  "recon",
  "artillery",
  "headquarters",
  "engineer",
  "air_defense",
  "logistics",
  "special_forces",
  "parachute_infantry",
  "glider_infantry",
  "tank_destroyer",
  "armored_infantry",
  "mechanized_infantry",
  "attack_helicopter",
  "transport",
  "anti_tank",
  "airborne",
]);

export const RTS_MAX_UNITS_PER_HEX = 2;

const RTS_NON_OCCUPANCY_TYPES = new Set([
  "airborne",
  "parachute_infantry",
  "glider_infantry",
  "attack_helicopter",
  "transport",
]);

const RTS_NON_OCCUPANCY_CAPABILITIES = new Set([
  "airmobile",
  "air_assault",
  "air_transport",
]);

export function isRtsSupportedScale(scale) {
  return scale === "tactical" || scale === "grand_tactical";
}

export function isRtsSupportedUnit(unit) {
  if (!unit) return false;
  if (!RTS_ALLOWED_BASE_TYPES.has(unit.type)) return false;
  const movementType = unit.movementType || "foot";
  return movementType !== "air" && movementType !== "naval";
}

export function getRtsTemplateOptions(scale, eraId = "cold_war") {
  return getTemplatesForScale(eraId, scale).filter(template => {
    const baseType = template.baseType || template.defaults?.type;
    const movementType = template.defaults?.movementType || "foot";
    return RTS_ALLOWED_BASE_TYPES.has(baseType) && movementType !== "air" && movementType !== "naval";
  });
}

export function countsTowardRtsHexOccupation(unit) {
  if (!unit || unit.embarkedIn) return false;
  const movementType = unit.movementType || "foot";
  if (movementType === "air" || movementType === "helicopter") return false;
  if (RTS_NON_OCCUPANCY_TYPES.has(unit.type)) return false;
  const capabilities = Array.isArray(unit.specialCapabilities) ? unit.specialCapabilities : [];
  return !capabilities.some((capability) => RTS_NON_OCCUPANCY_CAPABILITIES.has(capability));
}

export function resolveRtsParentHqId(unit, units) {
  const requested = String(unit?.parentHQ || "").trim();
  if (!requested) return "";

  const headquarters = (units || []).filter((candidate) =>
    candidate?.id !== unit?.id
    && candidate?.actor === unit?.actor
    && candidate?.type === "headquarters"
  );
  if (headquarters.length === 0) return "";

  const exactId = headquarters.find((candidate) => candidate.id === requested);
  if (exactId) return exactId.id;

  const normalizedRequested = normalizeReferenceToken(requested);
  const exactName = headquarters.find((candidate) => normalizeReferenceToken(candidate.name) === normalizedRequested);
  if (exactName) return exactName.id;

  const nearest = findNearestHeadquarters(unit, headquarters);
  if (nearest) return nearest.id;

  if (headquarters.length === 1) return headquarters[0].id;
  return "";
}

export function normalizeRtsParentHqAssignments(units) {
  const normalizedUnits = (units || []).map((unit) => ({ ...unit }));
  for (const unit of normalizedUnits) {
    if (!unit?.parentHQ) continue;
    unit.parentHQ = resolveRtsParentHqId(unit, normalizedUnits);
  }
  return normalizedUnits;
}

export function buildRtsMatch({ scenarioDraft, terrainData, folder, seed }) {
  const now = new Date().toISOString();
  const id = `rts_${now.replace(/[-:T]/g, "").slice(0, 14)}`;
  const scaleTier = SCALE_TIERS[scenarioDraft.scale] || SCALE_TIERS.grand_tactical;
  const startOptions = scenarioDraft.rtsOptions || {};
  const configuredDurationLimit = startOptions.durationLimitMinutes;
  const parsedDurationLimit = Number.parseFloat(String(configuredDurationLimit));
  const durationLimitMinutes = configuredDurationLimit == null
    ? 30
    : (Number.isFinite(parsedDurationLimit) ? parsedDurationLimit : 30);
  const aiGoalModel = normalizeRtsAiGoalModel(startOptions.aiGoalModel);
  const aiVariationMode = normalizeRtsAiVariationMode(startOptions.aiVariationMode);
  const aiVariationConfig = normalizeRtsAiVariationConfig(startOptions.aiVariationConfig);
  const aiExperimentTuning = normalizeRtsAiExperimentTuning(startOptions.aiExperimentTuning);
  const rngSeed = Number.isFinite(seed) ? seed : (Number.parseInt(String(startOptions.seed || Date.now()), 10) || Date.now());
  const sanitizedUnits = normalizeRtsParentHqAssignments(
    (scenarioDraft.units || [])
      .filter(isRtsSupportedUnit)
      .map((unit) => {
      const perScale = getUnitFieldsForScale(scaleTier.tier);
      const initialReserveState = unit.initialReserveState || (unit.posture === "reserve" ? "held" : null);
      const releaseDelaySeconds = Math.max(0, Number.parseInt(String(unit.releaseDelaySeconds || 0), 10) || 0);
      return {
        ...perScale,
        ...unit,
        status: unit.status || "ready",
        readiness: unit.readiness ?? 100,
        fuel: unit.fuel ?? 100,
        munitions: unit.munitions ?? 100,
        initialReserveState,
        releaseDelaySeconds,
        modeState: {
          settledHex: unit.position || "",
          travelState: null,
          currentCommand: null,
          commandQueue: [],
          suppression: 0,
          retreatState: null,
          shatterState: null,
          recoveryState: null,
          reserveState: initialReserveState,
          releaseAtMs: releaseDelaySeconds * 1000,
          currentTaskSource: "direct",
          lastCombatEvent: null,
        },
        embarkedIn: unit.embarkedIn || null,
        visibleTo: [],
        lastKnownBy: {},
      };
      })
  );
  normalizeEmbarkedStarts(sanitizedUnits);
  for (const unit of sanitizedUnits) {
    unit.modeState.currentTaskSource = unit.parentHQ ? "subordinate" : "direct";
  }
  const zoneModel = buildZoneModel({
    ...scenarioDraft,
    units: sanitizedUnits,
  }, terrainData);

  return {
    game: {
      id,
      mode: "rts",
      name: scenarioDraft.title,
      folder: folder || null,
      createdAt: now,
      status: "active",
      scale: scaleTier.key,
      tickMs: 250,
      elapsedMs: 0,
      paused: startOptions.startPaused !== false,
      speed: startOptions.startingSpeed || 1,
      rngSeed,
      rngState: rngSeed,
      commandSeq: 0,
      autosaveSeq: 0,
      maxStackPerHex: RTS_MAX_UNITS_PER_HEX,
      winner: null,
      victoryReason: null,
    },
    scenario: {
      ...scenarioDraft,
      environment: { ...DEFAULT_ENVIRONMENT, ...(scenarioDraft.environment || {}) },
      objectives: scenarioDraft.victoryConditions || { vpGoal: 50, hexVP: [] },
      zoneModel,
      rtsOptions: {
        startPaused: startOptions.startPaused !== false,
        startingSpeed: startOptions.startingSpeed || 1,
        seed: rngSeed,
        durationLimitMinutes,
        objectiveHoldSeconds: startOptions.objectiveHoldSeconds || 0,
        debugVisibility: startOptions.debugVisibility || "player",
        aiVsAi: Boolean(startOptions.aiVsAi),
        directorEnabled: startOptions.directorEnabled ?? true,
        aiLogMode: startOptions.aiLogMode || "standard",
        aiGoalModel,
        aiVariationMode,
        aiVariationConfig,
        aiExperimentTuning,
      },
    },
    environment: { ...DEFAULT_ENVIRONMENT, ...(scenarioDraft.environment || {}) },
    terrain: {
      _ref: scenarioDraft.terrainRef || scenarioDraft.map || "test-fixture",
      summary: buildTerrainSummary(terrainData, { scaleTier: scaleTier.tier }),
    },
    units: sanitizedUnits,
    truthState: {
      occupancy: buildInitialOccupancy(sanitizedUnits),
      commandLog: [],
      eventLog: [],
      objectives: buildInitialObjectiveState(scenarioDraft),
    },
    perceptionState: buildInitialPerception(scenarioDraft.actors || []),
    occupancy: buildInitialOccupancy(sanitizedUnits),
    combat: {
      activeEngagements: [],
      pendingImpacts: [],
      lastEvents: [],
      spotterPool: {},
      counterBatteryQueue: [],
      areaEffects: [],
    },
    zoneAnalysis: {
      truth: { byZone: {}, bySide: {} },
      perSide: {},
    },
    edgeAnalysis: {
      truth: { byEdge: {}, bySide: {} },
      perSide: {},
    },
    frontlineState: {
      perSide: {},
    },
    ai: {
      directors: {},
      commanders: {},
      subordinates: {},
      executors: {},
      decisionLog: [],
      thoughts: {},
      summaries: {},
      diary: [],
    },
    telemetry: {
      ticks: 0,
      timings: [],
      provenance: [],
      snapshots: [],
      perceptionSnapshots: [],
      directorPackets: [],
      thoughtSnapshots: [],
    },
    replay: {
      seed: rngSeed,
      snapshots: [],
      events: [],
    },
  };
}

function buildInitialOccupancy(units) {
  const occupancy = {};
  for (const unit of units) {
    if (!unit.position || !countsTowardRtsHexOccupation(unit)) continue;
    if (!occupancy[unit.position]) occupancy[unit.position] = [];
    occupancy[unit.position].push(unit.id);
  }
  return occupancy;
}

function buildInitialObjectiveState(scenarioDraft) {
  const holdMsRequired = ((scenarioDraft?.rtsOptions?.objectiveHoldSeconds || 0) * 1000);
  const objectives = scenarioDraft?.victoryConditions?.hexVP || scenarioDraft?.objectives?.hexVP || [];
  return Object.fromEntries(objectives.map((objective) => [
    objective.hex,
    {
      controller: objective.initialController || null,
      heldMs: objective.initialController ? holdMsRequired : 0,
      scoreAwarded: {},
    },
  ]));
}

function buildInitialPerception(actors) {
  return Object.fromEntries((actors || []).map((actor) => [actor.id, {
    visibleCells: [],
    detectedUnits: [],
    contactUnits: [],
    lastKnown: {},
  }]));
}

function normalizeEmbarkedStarts(units) {
  const unitById = new Map((units || []).map((unit) => [unit.id, unit]));
  for (const unit of units || []) {
    if (!unit.embarkedIn) continue;
    const transport = unitById.get(unit.embarkedIn);
    if (!transport || transport.actor !== unit.actor || !isHelicopterTransport(transport) || !isEmbarkablePassenger(unit)) {
      unit.embarkedIn = null;
      continue;
    }
    unit.position = transport.position || unit.position || "";
    unit.modeState.settledHex = transport.position || unit.modeState.settledHex || "";
  }
}

function isHelicopterTransport(unit) {
  return unit?.movementType === "helicopter" && (unit.type === "transport" || (unit.transportCapacity || 0) > 0);
}

function isEmbarkablePassenger(unit) {
  return (unit?.movementType || "foot") === "foot";
}

function normalizeReferenceToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findNearestHeadquarters(unit, headquarters) {
  const unitPos = parseUnitPosition(unit?.position || "");
  if (!unitPos) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const headquartersUnit of headquarters) {
    const hqPos = parseUnitPosition(headquartersUnit?.position || "");
    if (!hqPos) continue;
    const distance = hexDistance(unitPos.c, unitPos.r, hqPos.c, hqPos.r);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = headquartersUnit;
    }
  }
  return nearest;
}
