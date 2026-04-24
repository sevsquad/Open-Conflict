#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildRtsMatch } from "../src/rts/rtsStart.js";
import { createRtsCommand, reduceRtsCommand, tickRtsMatch } from "../src/rts/rtsEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..");
export const reportRoot = path.join(projectRoot, "Tests", "rts");

try {
  process.chdir(projectRoot);
} catch (error) {
  if (error?.code !== "ERR_WORKER_UNSUPPORTED_OPERATION") {
    throw error;
  }
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeMarkdown(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${value}\n`);
}

export function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function makeRunId(prefix) {
  return `${prefix}-${timestampTag()}-${randomBytes(3).toString("hex")}`;
}

export function sha256Json(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}

export function buildScenario(baseScenario, {
  seed = 1,
  actorOverride = null,
  rtsOptions = {},
} = {}) {
  const scenarioDraft = clone(baseScenario);
  const existingRtsOptions = scenarioDraft.rtsOptions || {};
  scenarioDraft.rtsOptions = {
    startPaused: false,
    startingSpeed: 1,
    objectiveHoldSeconds: 0,
    durationLimitMinutes: null,
    debugVisibility: "player",
    directorEnabled: true,
    aiLogMode: "standard",
    ...existingRtsOptions,
    seed,
    ...rtsOptions,
  };
  if (typeof actorOverride === "function") {
    scenarioDraft.actors = (scenarioDraft.actors || []).map((actor, index) => ({
      ...actor,
      ...actorOverride(actor, index),
    }));
  }
  return scenarioDraft;
}

export function runMatch({
  scenario,
  terrainData,
  seed = 1,
  totalTicks = 48,
  stopOnWinner = false,
  schedule = [],
  captureEveryTicks = 8,
  initialState = null,
  initialCommandSeq = 0,
  startTick = 0,
}) {
  let state = initialState
    ? clone(initialState)
    : buildRtsMatch({ scenarioDraft: buildScenario(scenario, { seed }), terrainData, folder: null, seed });
  let commandSeq = initialCommandSeq || state.game?.commandSeq || 0;
  const tickTimingsMs = [];
  const issuedCommands = [];
  const perceptionSnapshots = [];

  for (let tick = startTick; tick < totalTicks; tick += 1) {
    if (stopOnWinner && state.game?.winner) {
      break;
    }

    for (const instruction of schedule.filter((entry) => entry.tick === tick)) {
      const commandResult = issueScheduledCommand(state, terrainData, instruction, commandSeq + 1);
      state = commandResult.state;
      commandSeq = commandResult.commandSeq;
      issuedCommands.push(commandResult.executed);
    }

    const tickStart = performance.now();
    state = tickRtsMatch(state, terrainData);
    tickTimingsMs.push(roundMetric(performance.now() - tickStart));

    if (captureEveryTicks > 0 && ((tick - startTick + 1) % captureEveryTicks === 0)) {
      perceptionSnapshots.push(summarizePerception(state));
    }

    if (stopOnWinner && state.game?.winner) {
      break;
    }
  }

  return {
    state,
    commandSeq,
    issuedCommands,
    tickTimingsMs,
    perceptionSnapshots,
    outcome: summarizeOutcome(state),
    stateHash: sha256Json(normalizeStateForHash(state)),
    replayHash: sha256Json(state.replay || {}),
    provenanceHash: sha256Json(state.ai?.decisionLog || []),
  };
}

function issueScheduledCommand(state, terrainData, instruction, sequence) {
  const unitIds = resolveUnitIds(state, instruction.unitNames, instruction.unitIds);
  const targetUnitId = resolveTargetUnitId(state, instruction.targetUnitName, instruction.targetUnitId);
  const command = createRtsCommand({
    unitIds,
    kind: instruction.kind,
    targetHex: instruction.targetHex || null,
    targetUnitId,
    waypoints: instruction.waypoints || [],
    queueSlot: instruction.queueSlot || 0,
  }, `${state.game?.elapsedMs || 0}_${String(sequence).padStart(6, "0")}`);
  const nextState = reduceRtsCommand(state, terrainData, command, instruction.source || "script");
  nextState.game.commandSeq = sequence;
  return {
    state: nextState,
    commandSeq: sequence,
    executed: {
      tick: instruction.tick,
      kind: instruction.kind,
      unitIds,
      targetHex: instruction.targetHex || null,
      targetUnitId,
    },
  };
}

function resolveUnitIds(state, unitNames = [], unitIds = []) {
  if (Array.isArray(unitIds) && unitIds.length > 0) {
    return unitIds;
  }
  return (unitNames || []).map((name) => {
    const unit = (state.units || []).find((candidate) => candidate.name === name);
    if (!unit) {
      throw new Error(`Could not resolve unit name: ${name}`);
    }
    return unit.id;
  });
}

function resolveTargetUnitId(state, targetUnitName, targetUnitId) {
  if (targetUnitId) return targetUnitId;
  if (!targetUnitName) return null;
  const unit = (state.units || []).find((candidate) => candidate.name === targetUnitName);
  if (!unit) {
    throw new Error(`Could not resolve target unit name: ${targetUnitName}`);
  }
  return unit.id;
}

export function summarizeOutcome(state) {
  const scores = {};
  const livingByActor = {};
  const actors = state.scenario?.actors || [];
  const objectives = state.scenario?.objectives?.hexVP || [];
  const vpGoal = state.scenario?.objectives?.vpGoal || state.scenario?.victoryConditions?.vpGoal || 50;
  const durationLimitMinutes = Number(state.scenario?.rtsOptions?.durationLimitMinutes || 0);

  for (const actor of actors) {
    livingByActor[actor.id] = (state.units || []).filter((unit) => unit.actor === actor.id && unit.status !== "destroyed").length;
    scores[actor.id] = 0;
  }

  for (const objective of objectives) {
    const controller = state.truthState?.objectives?.[objective.hex]?.controller;
    if (controller) {
      scores[controller] = (scores[controller] || 0) + (objective.vp || 10);
    }
  }

  const survivingActors = Object.entries(livingByActor).filter(([, count]) => count > 0);
  const victoryReason = state.game?.victoryReason || (state.game?.winner
    ? (() => {
      if (durationLimitMinutes > 0 && (state.game?.elapsedMs || 0) >= durationLimitMinutes * 60_000) return "time_limit";
      if (scores[state.game.winner] >= vpGoal) return "vp_goal";
      if (survivingActors.length === 1) return "annihilation";
      return "unknown";
    })()
    : null);

  return {
    winner: state.game?.winner || null,
    victoryReason,
    elapsedMs: state.game?.elapsedMs || 0,
    livingByActor,
    vpByActor: scores,
    objectiveControl: Object.fromEntries(
      Object.entries(state.truthState?.objectives || {}).map(([hex, control]) => [hex, control?.controller || null])
    ),
    eventCount: state.truthState?.eventLog?.length || 0,
    commandCount: state.truthState?.commandLog?.length || 0,
    aiDecisionCount: state.ai?.decisionLog?.length || 0,
  };
}

export function summarizePerception(state) {
  return {
    atMs: state.game?.elapsedMs || 0,
    actors: Object.fromEntries(
      Object.entries(state.perceptionState || {}).map(([actorId, view]) => [actorId, {
        visibleCells: (view.visibleCells || []).length,
        detectedUnits: (view.detectedUnits || []).length,
        contactUnits: (view.contactUnits || []).length,
        lastKnownUnits: Object.keys(view.lastKnown || {}).length,
      }])
    ),
  };
}

export function buildTickStats(tickTimingsMs) {
  const timings = [...(tickTimingsMs || [])].sort((a, b) => a - b);
  const sum = timings.reduce((total, value) => total + value, 0);
  const count = timings.length;
  if (count === 0) {
    return { tickCount: 0, totalMs: 0, averageMs: 0, p95Ms: 0, maxMs: 0 };
  }
  return {
    tickCount: count,
    totalMs: roundMetric(sum),
    averageMs: roundMetric(sum / count),
    p95Ms: roundMetric(timings[Math.min(count - 1, Math.floor(count * 0.95))]),
    maxMs: roundMetric(timings[count - 1]),
  };
}

export function normalizeStateForHash(state) {
  return {
    game: {
      mode: state.game?.mode || "rts",
      scale: state.game?.scale || null,
      tickMs: state.game?.tickMs || 0,
      elapsedMs: state.game?.elapsedMs || 0,
      paused: Boolean(state.game?.paused),
      speed: state.game?.speed || 1,
      rngSeed: state.game?.rngSeed || 0,
      rngState: state.game?.rngState || 0,
      winner: state.game?.winner || null,
      commandSeq: state.game?.commandSeq || 0,
    },
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      actor: unit.actor,
      position: unit.position || null,
      embarkedIn: unit.embarkedIn || null,
      strength: unit.strength ?? null,
      morale: unit.morale ?? null,
      readiness: unit.readiness ?? null,
      ammo: unit.ammo ?? null,
      supply: unit.supply ?? null,
      fuel: unit.fuel ?? null,
      posture: unit.posture || null,
      status: unit.status || null,
      visibleTo: [...(unit.visibleTo || [])].sort(),
      lastKnownBy: sortValue(unit.lastKnownBy || {}),
      modeState: sortValue(unit.modeState || {}),
    })),
    truthState: sortValue({
      occupancy: state.truthState?.occupancy || {},
      objectives: state.truthState?.objectives || {},
      commandLog: state.truthState?.commandLog || [],
      eventLog: state.truthState?.eventLog || [],
    }),
    perceptionState: sortValue(state.perceptionState || {}),
    occupancy: sortValue(state.occupancy || {}),
    combat: sortValue(state.combat || {}),
    ai: sortValue({
      directors: state.ai?.directors || {},
      commanders: state.ai?.commanders || {},
      subordinates: state.ai?.subordinates || {},
      executors: state.ai?.executors || {},
      decisionLog: state.ai?.decisionLog || [],
      thoughts: state.ai?.thoughts || {},
      summaries: state.ai?.summaries || {},
      diary: state.ai?.diary || [],
    }),
    telemetry: sortValue({
      snapshots: state.telemetry?.snapshots || [],
      perceptionSnapshots: state.telemetry?.perceptionSnapshots || [],
      directorPackets: state.telemetry?.directorPackets || [],
      thoughtSnapshots: state.telemetry?.thoughtSnapshots || [],
    }),
    replay: sortValue(state.replay || {}),
  };
}

export function renderChecks(checks) {
  return checks.map((check) => `- ${check.pass ? "[pass]" : "[fail]"} ${check.name}`);
}

export function renderOutcome(outcome) {
  return [
    `- Winner: ${outcome.winner || "none"}`,
    `- Victory reason: ${outcome.victoryReason || "none"}`,
    `- Elapsed: ${(outcome.elapsedMs / 1000).toFixed(1)}s`,
    `- Living units: ${Object.entries(outcome.livingByActor).map(([actorId, count]) => `${actorId}=${count}`).join(", ") || "none"}`,
    `- VP: ${Object.entries(outcome.vpByActor).map(([actorId, score]) => `${actorId}=${score}`).join(", ") || "none"}`,
    `- Commands logged: ${outcome.commandCount}`,
    `- Events logged: ${outcome.eventCount}`,
    `- AI decisions: ${outcome.aiDecisionCount}`,
  ];
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}
