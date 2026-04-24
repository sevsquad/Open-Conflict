#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { getTestFixture } from "../src/testFixture.js";
import { buildRtsMatch } from "../src/rts/rtsStart.js";
import { tickRtsMatch } from "../src/rts/rtsEngine.js";
import { cellToPositionString, parseUnitPosition } from "../src/mapRenderer/overlays/UnitOverlay.js";
import { getServerAiDuelPreset } from "../src/simulation/presets.js";
import {
  buildScenario,
  buildTickStats,
  ensureDir,
  projectRoot,
  renderOutcome,
  reportRoot,
  runMatch,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const DEFAULT_TICKS = 120;
const DEFAULT_ITERATIONS = 3;
const LEFT_RIGHT_BAND_WIDTH = 4;

export const SCALE_CASES = [
  {
    id: "stress-80",
    label: "80 Total Units",
    hqPerSide: 8,
    infantryPerHq: 4,
    totalTicks: DEFAULT_TICKS,
    seed: 9080,
  },
  {
    id: "stress-100",
    label: "100 Total Units",
    hqPerSide: 10,
    infantryPerHq: 4,
    totalTicks: DEFAULT_TICKS,
    seed: 9100,
  },
];

export function getScaleCase(caseId) {
  const found = SCALE_CASES.find((entry) => entry.id === caseId);
  if (!found) {
    throw new Error(`Unknown scale case: ${caseId}`);
  }
  return found;
}

export function getScaleBaselinePath(caseId) {
  return path.join(projectRoot, "Tests", "rts", `${caseId}-baseline.json`);
}

export function loadScaleBaseline(caseId) {
  const baselinePath = getScaleBaselinePath(caseId);
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

export function buildScaleScenario(caseDef, seed = caseDef.seed) {
  const terrainData = getTestFixture();
  const basePreset = getServerAiDuelPreset();
  const actors = basePreset.actors || [];
  if (actors.length < 2) {
    throw new Error("Scale harness requires a two-actor RTS preset.");
  }
  const units = buildStressUnits(basePreset, terrainData, caseDef);
  const scenario = buildScenario(
    {
      ...basePreset,
      title: `${basePreset.title || "AI Duel"} ${caseDef.label}`,
      units,
    },
    {
      seed,
      actorOverride: (actor) => ({
        controller: "ai",
        isAi: true,
        aiConfig: { ...(actor.aiConfig || {}), engine: "algorithmic", directorEnabled: true },
      }),
      rtsOptions: {
        aiVsAi: true,
        directorEnabled: true,
        durationLimitMinutes: 10,
        objectiveHoldSeconds: 0,
      },
    }
  );
  return { scenario, terrainData };
}

export function runScaleCase(caseDef, {
  seed = caseDef.seed,
  totalTicks = caseDef.totalTicks,
} = {}) {
  const { scenario, terrainData } = buildScaleScenario(caseDef, seed);
  return runMatch({
    scenario,
    terrainData,
    seed,
    totalTicks,
  });
}

export function runScaleBenchmark(caseDef, {
  iterations = DEFAULT_ITERATIONS,
  totalTicks = caseDef.totalTicks,
} = {}) {
  const runs = [];
  for (let index = 0; index < iterations; index += 1) {
    const seed = caseDef.seed + index;
    const run = runScaleCase(caseDef, { seed, totalTicks });
    runs.push({
      seed,
      ticksExecuted: run.tickTimingsMs.length,
      tickStats: buildTickStats(run.tickTimingsMs),
      outcome: run.outcome,
      stateHash: run.stateHash,
      replayHash: run.replayHash,
      provenanceHash: run.provenanceHash,
    });
  }
  const averageTickMs = roundMetric(runs.reduce((sum, run) => sum + run.tickStats.averageMs, 0) / runs.length);
  const averageP95Ms = roundMetric(runs.reduce((sum, run) => sum + run.tickStats.p95Ms, 0) / runs.length);
  const peakTickMs = roundMetric(Math.max(...runs.map((run) => run.tickStats.maxMs)));
  return {
    id: caseDef.id,
    label: caseDef.label,
    config: summarizeCase(caseDef),
    iterations,
    totalTicks,
    averageTickMs,
    averageP95Ms,
    peakTickMs,
    runs,
  };
}

export function writeScaleBaselines() {
  const writtenPaths = [];
  for (const caseDef of SCALE_CASES) {
    const parityRun = runScaleCase(caseDef, { seed: caseDef.seed, totalTicks: caseDef.totalTicks });
    const benchmark = runScaleBenchmark(caseDef, { iterations: DEFAULT_ITERATIONS, totalTicks: caseDef.totalTicks });
    const payload = {
      id: caseDef.id,
      label: caseDef.label,
      generatedAt: new Date().toISOString(),
      config: summarizeCase(caseDef),
      parity: {
        seed: caseDef.seed,
        totalTicks: caseDef.totalTicks,
        stateHash: parityRun.stateHash,
        replayHash: parityRun.replayHash,
        provenanceHash: parityRun.provenanceHash,
        tickStats: buildTickStats(parityRun.tickTimingsMs),
        outcome: parityRun.outcome,
      },
      benchmarkBaseline: benchmark,
    };
    const baselinePath = getScaleBaselinePath(caseDef.id);
    writeJson(baselinePath, payload);
    writtenPaths.push(baselinePath);
  }
  return writtenPaths;
}

export function buildSpotterTieRegression() {
  const terrainData = getTestFixture();
  const preset = getServerAiDuelPreset();
  const blueId = preset.actors?.[0]?.id || "blue";
  const redId = preset.actors?.[1]?.id || "red";
  const scenario = buildScenario(
    {
      ...preset,
      title: "Spotter Tie Regression",
      units: [
        makeUnit({ id: "blue_spotter_a", actor: blueId, name: "Blue Spotter A", type: "recon", position: "2,6" }),
        makeUnit({ id: "blue_spotter_b", actor: blueId, name: "Blue Spotter B", type: "recon", position: "2,8" }),
        makeUnit({ id: "red_target", actor: redId, name: "Red Target", type: "infantry", position: "2,7" }),
      ],
    },
    {
      seed: 9911,
      actorOverride: (actor) => ({
        controller: "player",
        isAi: false,
        aiConfig: { ...(actor.aiConfig || {}), directorEnabled: false },
      }),
      rtsOptions: {
        directorEnabled: false,
        durationLimitMinutes: 5,
      },
    }
  );
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 9911 });
  const next = tickRtsMatch(state, terrainData);
  const spotterId = next.combat?.spotterPool?.[blueId]?.red_target?.spotterId || null;
  return {
    expectedSpotterId: "blue_spotter_b",
    observedSpotterId: spotterId,
    passed: spotterId === "blue_spotter_b",
  };
}

export function buildCombatTieRegression() {
  const terrainData = getTestFixture();
  const preset = getServerAiDuelPreset();
  const blueId = preset.actors?.[0]?.id || "blue";
  const redId = preset.actors?.[1]?.id || "red";
  const scenario = buildScenario(
    {
      ...preset,
      title: "Combat Tie Regression",
      units: [
        makeUnit({ id: "blue_attacker", actor: blueId, name: "Blue Attacker", type: "infantry", position: "2,7" }),
        makeUnit({ id: "blue_support", actor: blueId, name: "Blue Support", type: "infantry", position: "1,7" }),
        makeUnit({ id: "red_alpha", actor: redId, name: "Red Alpha", type: "infantry", position: "3,6" }),
        makeUnit({ id: "red_bravo", actor: redId, name: "Red Bravo", type: "infantry", position: "3,8" }),
      ],
    },
    {
      seed: 9922,
      actorOverride: (actor) => ({
        controller: "player",
        isAi: false,
        aiConfig: { ...(actor.aiConfig || {}), directorEnabled: false },
      }),
      rtsOptions: {
        directorEnabled: false,
        durationLimitMinutes: 5,
      },
    }
  );
  const state = buildRtsMatch({ scenarioDraft: scenario, terrainData, folder: null, seed: 9922 });
  const next = tickRtsMatch(state, terrainData);
  const firstAttackEvent = (next.truthState?.eventLog || []).find((entry) => entry?.details?.attackerId === "blue_attacker");
  const targetId = firstAttackEvent?.details?.targetId || null;
  return {
    expectedTargetId: "red_alpha",
    observedTargetId: targetId,
    passed: targetId === "red_alpha",
  };
}

export function renderScaleParityReport(results) {
  return [
    "# RTS Scale Parity Report",
    "",
    ...results.flatMap((entry) => [
      `## ${entry.label}`,
      "",
      `- Seed: ${entry.seed}`,
      `- Hash parity: ${entry.pass ? "pass" : "fail"}`,
      `- State hash: \`${entry.observed.stateHash}\``,
      `- Replay hash: \`${entry.observed.replayHash}\``,
      `- Provenance hash: \`${entry.observed.provenanceHash}\``,
      ...renderOutcome(entry.observed.outcome || {}),
      "",
    ]),
  ].join("\n");
}

export function renderScaleBenchmarkReport(results, comparisons) {
  return [
    "# RTS Scale Benchmark Report",
    "",
    ...results.flatMap((result) => {
      const comparison = comparisons[result.id];
      return [
        `## ${result.label}`,
        "",
        `- Iterations: ${result.iterations}`,
        `- Average tick: ${result.averageTickMs}ms`,
        `- Average p95: ${result.averageP95Ms}ms`,
        `- Peak tick: ${result.peakTickMs}ms`,
        `- Improvement vs baseline avg: ${comparison.averageImprovementPct}%`,
        `- Improvement vs baseline p95: ${comparison.p95ImprovementPct}%`,
        "",
      ];
    }),
  ].join("\n");
}

function summarizeCase(caseDef) {
  return {
    hqPerSide: caseDef.hqPerSide,
    infantryPerHq: caseDef.infantryPerHq,
    totalUnits: caseDef.hqPerSide * (caseDef.infantryPerHq + 1) * 2,
    totalTicks: caseDef.totalTicks,
    seed: caseDef.seed,
  };
}

function buildStressUnits(basePreset, terrainData, caseDef) {
  const actorIds = (basePreset.actors || []).slice(0, 2).map((actor) => actor.id);
  const unitsPerSide = caseDef.hqPerSide * (caseDef.infantryPerHq + 1);
  const leftHexes = collectSideHexes(terrainData, "left", unitsPerSide);
  const rightHexes = collectSideHexes(terrainData, "right", unitsPerSide);
  return [
    ...buildSideUnits(actorIds[0], "Blue", leftHexes, caseDef),
    ...buildSideUnits(actorIds[1], "Red", rightHexes, caseDef),
  ];
}

function buildSideUnits(actorId, label, sideHexes, caseDef) {
  const units = [];
  let cursor = 0;
  for (let hqIndex = 0; hqIndex < caseDef.hqPerSide; hqIndex += 1) {
    const hqId = `${actorId}_hq_${String(hqIndex + 1).padStart(2, "0")}`;
    const hqHex = sideHexes[cursor];
    cursor += 1;
    units.push(makeUnit({
      id: hqId,
      actor: actorId,
      name: `${label} HQ ${hqIndex + 1}`,
      type: "headquarters",
      position: hqHex,
    }));
    for (let infIndex = 0; infIndex < caseDef.infantryPerHq; infIndex += 1) {
      const infId = `${actorId}_inf_${String(hqIndex + 1).padStart(2, "0")}_${String(infIndex + 1).padStart(2, "0")}`;
      const hex = sideHexes[cursor];
      cursor += 1;
      units.push(makeUnit({
        id: infId,
        actor: actorId,
        name: `${label} Infantry ${hqIndex + 1}-${infIndex + 1}`,
        type: "infantry",
        position: hex,
        parentHQ: hqId,
      }));
    }
  }
  return units;
}

function collectSideHexes(terrainData, side, requiredCount) {
  const cells = Object.keys(terrainData?.cells || {})
    .map((hex) => ({ hex, pos: parseUnitPosition(hex) }))
    .filter((entry) => entry.pos);
  if (cells.length < requiredCount) {
    throw new Error(`Not enough terrain cells to build ${side} stress layout.`);
  }
  const cols = cells.map((entry) => entry.pos.c);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const sorted = [...cells].sort((left, right) => {
    if (left.pos.r !== right.pos.r) return left.pos.r - right.pos.r;
    return left.pos.c - right.pos.c;
  });

  for (let extraWidth = 0; extraWidth <= 4; extraWidth += 1) {
    const bandWidth = LEFT_RIGHT_BAND_WIDTH + extraWidth;
    const band = sorted.filter((entry) => (
      side === "left"
        ? entry.pos.c <= (minCol + bandWidth - 1)
        : entry.pos.c >= (maxCol - bandWidth + 1)
    ));
    if (band.length >= requiredCount) {
      return band.slice(0, requiredCount).map((entry) => entry.hex);
    }
  }

  throw new Error(`Could not allocate ${requiredCount} ${side} deployment hexes.`);
}

function makeUnit({
  id,
  actor,
  name,
  type,
  position,
  parentHQ = "",
}) {
  return {
    id,
    actor,
    name,
    type,
    position,
    parentHQ,
    movementType: "foot",
    status: "ready",
    posture: "ready",
    strength: 100,
    morale: 100,
    readiness: 100,
    ammo: 100,
    supply: 100,
    fuel: 100,
  };
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}
