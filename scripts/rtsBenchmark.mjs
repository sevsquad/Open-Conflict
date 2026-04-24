#!/usr/bin/env node

import path from "node:path";
import { performance } from "node:perf_hooks";

import { getTestFixture } from "../src/testFixture.js";
import { getHeloInsertionPreset, getServerAiDuelPreset } from "../src/simulation/presets.js";
import {
  buildScenario,
  buildTickStats,
  ensureDir,
  makeRunId,
  reportRoot,
  runMatch,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const runId = makeRunId("rts-benchmark");
const runDir = path.join(reportRoot, "runs", runId);
const latestSummaryPath = path.join(reportRoot, "latest-benchmark-summary.json");
const latestReportPath = path.join(reportRoot, "latest-benchmark-report.md");

ensureDir(runDir);

try {
  const terrainData = getTestFixture();
  const duelScenario = buildScenario(getServerAiDuelPreset(), {
    seed: 2468,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: { ...(actor.aiConfig || {}), engine: "algorithmic", directorEnabled: true },
    }),
  });
  const heloScenario = buildScenario(getHeloInsertionPreset(), {
    seed: 1357,
    actorOverride: (actor, index) => ({
      controller: index === 0 ? "player" : "ai",
      isAi: index === 1,
      aiConfig: index === 1 ? { ...(actor.aiConfig || {}), engine: "algorithmic", directorEnabled: true } : actor.aiConfig,
    }),
  });
  const terminalDuelPreset = getServerAiDuelPreset();
  terminalDuelPreset.victoryConditions = {
    ...(terminalDuelPreset.victoryConditions || {}),
    vpGoal: 45,
  };
  const terminalDuelScenario = buildScenario(terminalDuelPreset, {
    seed: 8642,
    actorOverride: (actor) => ({
      controller: "ai",
      isAi: true,
      aiConfig: { ...(actor.aiConfig || {}), engine: "algorithmic", directorEnabled: true },
    }),
    rtsOptions: {
      objectiveHoldSeconds: 20,
      durationLimitMinutes: 10,
    },
  });
  const heloSchedule = [
    { tick: 0, kind: "embark_helo", unitNames: ["Air Assault Infantry"], targetUnitName: "Falcon Lift 1", targetHex: "10,8" },
    { tick: 1, kind: "move", unitNames: ["Falcon Lift 1"], targetHex: "7,4" },
    { tick: 1, kind: "attack_move", unitNames: ["Viper Gunship"], targetHex: "7,5", targetUnitName: "Shilka Section" },
    { tick: 18, kind: "disembark_helo", unitNames: ["Falcon Lift 1"], targetHex: "8,5" },
  ];

  const benchmarks = [
    {
      id: "ai-duel",
      label: "AI Duel",
      scenario: duelScenario,
      seed: 2468,
      totalTicks: 160,
      schedule: [],
      iterations: 3,
    },
    {
      id: "helo-corridor",
      label: "Helo Corridor",
      scenario: heloScenario,
      seed: 1357,
      totalTicks: 72,
      schedule: heloSchedule,
      iterations: 3,
    },
    {
      id: "ai-duel-terminal",
      label: "AI Duel Terminal",
      scenario: terminalDuelScenario,
      seed: 8642,
      totalTicks: 2400,
      stopOnWinner: true,
      schedule: [],
      iterations: 3,
      note: "Runs until a real terminal state with a 10-minute cap, 20-second objective hold, and a 45 VP threshold.",
    },
  ];

  const results = benchmarks.map((benchmark) => {
    const runs = [];
    for (let iteration = 0; iteration < benchmark.iterations; iteration += 1) {
      const seed = benchmark.seed + iteration;
      const wallStart = performance.now();
      const run = runMatch({
        scenario: benchmark.scenario,
        terrainData,
        seed,
        totalTicks: benchmark.totalTicks,
        stopOnWinner: Boolean(benchmark.stopOnWinner),
        schedule: benchmark.schedule,
      });
      const wallMs = roundMetric(performance.now() - wallStart);
      runs.push({
        seed,
        wallMs,
        outcome: run.outcome,
        stateHash: run.stateHash,
        replayHash: run.replayHash,
        ticksExecuted: run.tickTimingsMs.length,
        simSecondsPerWallSecond: roundMetric((run.outcome.elapsedMs || 0) / Math.max(wallMs, 1)),
        tickStats: buildTickStats(run.tickTimingsMs),
      });
    }

    const averageTickMs = runs.reduce((sum, run) => sum + run.tickStats.averageMs, 0) / runs.length;
    const averageWallMs = runs.reduce((sum, run) => sum + run.wallMs, 0) / runs.length;
    const averageTicksExecuted = runs.reduce((sum, run) => sum + run.ticksExecuted, 0) / runs.length;
    const averageSimSpeed = runs.reduce((sum, run) => sum + run.simSecondsPerWallSecond, 0) / runs.length;
    const peakTickMs = Math.max(...runs.map((run) => run.tickStats.maxMs));
    return {
      id: benchmark.id,
      label: benchmark.label,
      totalTicks: benchmark.totalTicks,
      iterations: benchmark.iterations,
      stopOnWinner: Boolean(benchmark.stopOnWinner),
      note: benchmark.note || null,
      averageTickMs: Math.round(averageTickMs * 1000) / 1000,
      averageWallMs: roundMetric(averageWallMs),
      averageTicksExecuted: roundMetric(averageTicksExecuted),
      averageSimSpeed: roundMetric(averageSimSpeed),
      peakTickMs,
      runs,
    };
  });

  const summary = {
    ok: true,
    status: "passed",
    runId,
    timestamp: new Date().toISOString(),
    results,
  };

  const reportLines = [
    "# RTS Benchmark Report",
    "",
    `- Run: \`${summary.runId}\``,
    `- Time: ${summary.timestamp}`,
    "",
    "## Scenario Results",
    "",
  ];

  for (const result of results) {
    reportLines.push(`### ${result.label}`);
    reportLines.push("");
    reportLines.push(`- Iterations: ${result.iterations}`);
    reportLines.push(`- Tick cap per run: ${result.totalTicks}`);
    reportLines.push(`- Stop on winner: ${result.stopOnWinner ? "yes" : "no"}`);
    reportLines.push(`- Average tick cost: ${result.averageTickMs}ms`);
    reportLines.push(`- Average wall time per run: ${result.averageWallMs}ms`);
    reportLines.push(`- Average ticks executed: ${result.averageTicksExecuted}`);
    reportLines.push(`- Average simulated seconds per wall second: ${result.averageSimSpeed}x`);
    reportLines.push(`- Peak tick cost: ${result.peakTickMs}ms`);
    if (result.note) {
      reportLines.push(`- Note: ${result.note}`);
    }
    reportLines.push("");
    for (const run of result.runs) {
      reportLines.push(`- Seed ${run.seed}: ${run.ticksExecuted} ticks, wall ${run.wallMs}ms, avg ${run.tickStats.averageMs}ms, p95 ${run.tickStats.p95Ms}ms, max ${run.tickStats.maxMs}ms, winner ${run.outcome.winner || "none"} (${run.outcome.victoryReason || "none"}), speed ${run.simSecondsPerWallSecond}x, replay \`${run.replayHash}\``);
    }
    reportLines.push("");
  }

  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), reportLines.join("\n"));
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, reportLines.join("\n"));

  console.log(`[rts-benchmark] status=${summary.status} scenarios=${results.length}`);
  console.log(`[rts-benchmark] report=${latestReportPath}`);
  console.log(`[rts-benchmark] summary=${latestSummaryPath}`);
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
  writeMarkdown(latestReportPath, `# RTS Benchmark Failed\n\n- Error: ${error.message}\n`);
  console.error(`[rts-benchmark] ${error.stack || error.message}`);
  process.exitCode = 1;
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}
