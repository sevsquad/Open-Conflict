#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { ensureDir, makeRunId, reportRoot, writeJson, writeMarkdown } from "./rtsHarness.mjs";
import { runTaskPool } from "./rtsResearchHarness.mjs";

const DEFAULT_BASELINE_RESULTS = path.join(
  reportRoot,
  "research",
  "runs",
  "rts-research-2026-04-23T18-49-14-786Z-bd609f",
  "symmetry_validation",
  "results.json"
);
const DEFAULT_WORKERS = 12;
const DEFAULT_TOTAL_CASES = 50;
const SCENARIO_WEIGHTS = {
  multi_zone_control: 10,
  encirclement: 10,
  rear_probe: 10,
  low_supply: 8,
  attrition: 8,
  long_run_duel: 4,
};

function parseArgs(argv) {
  let baselinePath = DEFAULT_BASELINE_RESULTS;
  let workerCount = DEFAULT_WORKERS;
  let totalCases = DEFAULT_TOTAL_CASES;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline" && argv[index + 1]) {
      baselinePath = path.resolve(String(argv[index + 1]));
      index += 1;
    } else if (arg === "--workers" && argv[index + 1]) {
      workerCount = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || DEFAULT_WORKERS);
      index += 1;
    } else if (arg === "--count" && argv[index + 1]) {
      totalCases = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || DEFAULT_TOTAL_CASES);
      index += 1;
    }
  }
  return { baselinePath, workerCount, totalCases };
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sign(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function allocateScenarioCounts(totalCases, availableByScenario) {
  const totalWeight = Object.values(SCENARIO_WEIGHTS).reduce((sum, value) => sum + value, 0);
  const allocations = Object.entries(SCENARIO_WEIGHTS).map(([scenarioId, weight]) => {
    const exact = totalCases * (weight / totalWeight);
    return {
      scenarioId,
      exact,
      count: Math.min(availableByScenario[scenarioId] || 0, Math.floor(exact)),
      remainder: exact - Math.floor(exact),
    };
  });

  let assigned = allocations.reduce((sum, entry) => sum + entry.count, 0);
  while (assigned < totalCases) {
    const candidate = [...allocations]
      .filter((entry) => entry.count < (availableByScenario[entry.scenarioId] || 0))
      .sort((left, right) => right.remainder - left.remainder || left.scenarioId.localeCompare(right.scenarioId))[0];
    if (!candidate) break;
    candidate.count += 1;
    candidate.remainder = 0;
    assigned += 1;
  }

  return Object.fromEntries(allocations.map((entry) => [entry.scenarioId, entry.count]));
}

function selectBaselineCases(baselineResults, totalCases) {
  const grouped = {};
  for (const result of baselineResults) {
    if (!result.identicalSides) continue;
    grouped[result.scenarioId] = grouped[result.scenarioId] || [];
    grouped[result.scenarioId].push(result);
  }

  for (const results of Object.values(grouped)) {
    results.sort((left, right) => left.seed - right.seed || left.taskId.localeCompare(right.taskId));
  }

  const availableByScenario = Object.fromEntries(
    Object.entries(grouped).map(([scenarioId, results]) => [scenarioId, results.length])
  );
  const requestedByScenario = allocateScenarioCounts(totalCases, availableByScenario);
  const selected = [];

  for (const [scenarioId, requestedCount] of Object.entries(requestedByScenario)) {
    selected.push(...(grouped[scenarioId] || []).slice(0, requestedCount));
  }

  return {
    selected: selected.sort((left, right) => left.seed - right.seed || left.taskId.localeCompare(right.taskId)),
    requestedByScenario,
  };
}

function comparePairedRuns(baseline, mirrored) {
  const baselineLead = baseline.metrics.symmetry.actor1VpLead;
  const mirroredLead = mirrored.metrics.symmetry.actor1VpLead;
  const baselineRoleA = baseline.metrics.actorMetrics.actor_1.openingDominantRole;
  const baselineRoleB = baseline.metrics.actorMetrics.actor_2.openingDominantRole;
  const mirroredRoleA = mirrored.metrics.actorMetrics.actor_1.openingDominantRole;
  const mirroredRoleB = mirrored.metrics.actorMetrics.actor_2.openingDominantRole;
  const baselineZoneA = baseline.metrics.actorMetrics.actor_1.openingPrimaryZoneId;
  const baselineZoneB = baseline.metrics.actorMetrics.actor_2.openingPrimaryZoneId;
  const mirroredZoneA = mirrored.metrics.actorMetrics.actor_1.openingPrimaryZoneId;
  const mirroredZoneB = mirrored.metrics.actorMetrics.actor_2.openingPrimaryZoneId;

  return {
    scenarioId: baseline.scenarioId,
    seed: baseline.seed,
    baselineLead,
    mirroredLead,
    leadFlipped: sign(baselineLead) !== 0 && sign(baselineLead) === -sign(mirroredLead),
    labelBiasPersisted: sign(baselineLead) !== 0 && sign(baselineLead) === sign(mirroredLead),
    positionRoleCarryover: Number(baselineRoleA === mirroredRoleB && baselineRoleB === mirroredRoleA),
    positionZoneCarryover: Number(baselineZoneA === mirroredZoneB && baselineZoneB === mirroredZoneA),
    baselineOpeningRoles: `${baselineRoleA} vs ${baselineRoleB}`,
    mirroredOpeningRoles: `${mirroredRoleA} vs ${mirroredRoleB}`,
    baselineOpeningZones: `${baselineZoneA} vs ${baselineZoneB}`,
    mirroredOpeningZones: `${mirroredZoneA} vs ${mirroredZoneB}`,
    baselineVp: baseline.outcome.vpByActor,
    mirroredVp: mirrored.outcome.vpByActor,
    baselineWinner: baseline.outcome.winner || "draw",
    mirroredWinner: mirrored.outcome.winner || "draw",
    baselineAsymmetry: baseline.metrics.symmetry.asymmetryScore,
    mirroredAsymmetry: mirrored.metrics.symmetry.asymmetryScore,
  };
}

function summarizePairs(pairs) {
  const byScenario = {};
  for (const pair of pairs) {
    byScenario[pair.scenarioId] = byScenario[pair.scenarioId] || [];
    byScenario[pair.scenarioId].push(pair);
  }

  const overall = {
    pairCount: pairs.length,
    baselineActor2LeadRate: roundMetric(average(pairs.map((pair) => Number(pair.baselineLead < 0)))),
    mirroredActor1LeadRate: roundMetric(average(pairs.map((pair) => Number(pair.mirroredLead > 0)))),
    mirroredActor2LeadRate: roundMetric(average(pairs.map((pair) => Number(pair.mirroredLead < 0)))),
    leadFlipRate: roundMetric(average(pairs.map((pair) => Number(pair.leadFlipped)))),
    labelBiasPersistenceRate: roundMetric(average(pairs.map((pair) => Number(pair.labelBiasPersisted)))),
    positionRoleCarryoverRate: roundMetric(average(pairs.map((pair) => pair.positionRoleCarryover))),
    positionZoneCarryoverRate: roundMetric(average(pairs.map((pair) => pair.positionZoneCarryover))),
    baselineWinners: countBy(pairs, (pair) => pair.baselineWinner),
    mirroredWinners: countBy(pairs, (pair) => pair.mirroredWinner),
  };

  const scenarioSummary = Object.fromEntries(
    Object.entries(byScenario).map(([scenarioId, scenarioPairs]) => [
      scenarioId,
      {
        count: scenarioPairs.length,
        baselineActor2LeadRate: roundMetric(average(scenarioPairs.map((pair) => Number(pair.baselineLead < 0)))),
        mirroredActor1LeadRate: roundMetric(average(scenarioPairs.map((pair) => Number(pair.mirroredLead > 0)))),
        leadFlipRate: roundMetric(average(scenarioPairs.map((pair) => Number(pair.leadFlipped)))),
        labelBiasPersistenceRate: roundMetric(average(scenarioPairs.map((pair) => Number(pair.labelBiasPersisted)))),
        positionRoleCarryoverRate: roundMetric(average(scenarioPairs.map((pair) => pair.positionRoleCarryover))),
        positionZoneCarryoverRate: roundMetric(average(scenarioPairs.map((pair) => pair.positionZoneCarryover))),
      },
    ])
  );

  const notablePairs = [...pairs]
    .sort((left, right) => Math.abs(right.baselineLead - right.mirroredLead) - Math.abs(left.baselineLead - left.mirroredLead))
    .slice(0, 12);

  return { overall, scenarioSummary, notablePairs };
}

function renderMarkdownReport({ baselinePath, requestedByScenario, selectedCases, summary, runDir }) {
  const lines = [
    "# Symmetry Mirror Probe",
    "",
    `- Baseline: ${baselinePath}`,
    `- Mirrored cases: ${summary.overall.pairCount}`,
    `- Report directory: ${runDir}`,
    `- Requested scenario mix: ${Object.entries(requestedByScenario).filter(([, count]) => count > 0).map(([scenarioId, count]) => `${scenarioId}=${count}`).join(", ")}`,
    "",
    "## Main Read",
    "",
    `- Baseline actor_2 VP-lead rate: ${summary.overall.baselineActor2LeadRate}`,
    `- Mirrored actor_1 VP-lead rate: ${summary.overall.mirroredActor1LeadRate}`,
    `- Mirrored actor_2 VP-lead rate: ${summary.overall.mirroredActor2LeadRate}`,
    `- VP-lead flip rate after side swap: ${summary.overall.leadFlipRate}`,
    `- Label-bias persistence rate: ${summary.overall.labelBiasPersistenceRate}`,
    `- Position opening-role carryover rate: ${summary.overall.positionRoleCarryoverRate}`,
    `- Position opening-zone carryover rate: ${summary.overall.positionZoneCarryoverRate}`,
    "",
    "## Scenario Summary",
    "",
  ];

  for (const [scenarioId, scenarioSummary] of Object.entries(summary.scenarioSummary)) {
    lines.push(`### ${scenarioId}`);
    lines.push("");
    lines.push(`- Count: ${scenarioSummary.count}`);
    lines.push(`- Baseline actor_2 VP-lead rate: ${scenarioSummary.baselineActor2LeadRate}`);
    lines.push(`- Mirrored actor_1 VP-lead rate: ${scenarioSummary.mirroredActor1LeadRate}`);
    lines.push(`- VP-lead flip rate: ${scenarioSummary.leadFlipRate}`);
    lines.push(`- Label-bias persistence rate: ${scenarioSummary.labelBiasPersistenceRate}`);
    lines.push(`- Position opening-role carryover rate: ${scenarioSummary.positionRoleCarryoverRate}`);
    lines.push(`- Position opening-zone carryover rate: ${scenarioSummary.positionZoneCarryoverRate}`);
    lines.push("");
  }

  lines.push("## Notable Pairs");
  lines.push("");
  for (const pair of summary.notablePairs) {
    lines.push(`- seed=${pair.seed} scenario=${pair.scenarioId} baselineLead=${pair.baselineLead} mirroredLead=${pair.mirroredLead} baselineRoles=${pair.baselineOpeningRoles} mirroredRoles=${pair.mirroredOpeningRoles} baselineZones=${pair.baselineOpeningZones} mirroredZones=${pair.mirroredOpeningZones}`);
  }

  lines.push("");
  lines.push("## Selected Baseline Cases");
  lines.push("");
  for (const result of selectedCases) {
    lines.push(`- ${result.taskId}: scenario=${result.scenarioId} seed=${result.seed} vp=${result.outcome.vpByActor.actor_1}-${result.outcome.vpByActor.actor_2} lead=${result.metrics.symmetry.actor1VpLead}`);
  }

  return lines.join("\n");
}

async function main() {
  const { baselinePath, workerCount, totalCases } = parseArgs(process.argv);
  const baselineResults = readJson(baselinePath);
  const { selected, requestedByScenario } = selectBaselineCases(baselineResults, totalCases);
  if (selected.length === 0) {
    throw new Error(`No identical-side baseline results found in ${baselinePath}`);
  }

  const runId = makeRunId("rts-symmetry-mirror-probe");
  const runDir = ensureDir(path.join(reportRoot, "research", "mirror-probes", runId));
  const tasks = selected.map((result, index) => ({
    id: `mirror_probe_${String(index + 1).padStart(3, "0")}`,
    bucketId: "symmetry_mirror_probe",
    scenarioId: result.scenarioId,
    seed: result.seed,
    profile: result.profile || "balanced",
    identicalSides: true,
    mirrorSides: true,
  }));

  console.log(`[rts-mirror-probe] baseline=${baselinePath}`);
  console.log(`[rts-mirror-probe] selected=${selected.length} workers=${workerCount}`);

  const mirroredResults = await runTaskPool(tasks, {
    workerCount,
    onProgress: ({ completed, total }) => {
      if (completed % 10 === 0 || completed === total) {
        console.log(`[rts-mirror-probe] progress=${completed}/${total}`);
      }
    },
  });

  const mirroredByKey = Object.fromEntries(
    mirroredResults.map((result) => [`${result.scenarioId}::${result.seed}`, result])
  );
  const pairs = selected.map((baseline) => {
    const mirrored = mirroredByKey[`${baseline.scenarioId}::${baseline.seed}`];
    if (!mirrored) {
      throw new Error(`Missing mirrored result for ${baseline.scenarioId} seed ${baseline.seed}`);
    }
    return comparePairedRuns(baseline, mirrored);
  });
  const summary = summarizePairs(pairs);
  const report = renderMarkdownReport({
    baselinePath,
    requestedByScenario,
    selectedCases: selected,
    summary,
    runDir,
  });

  writeJson(path.join(runDir, "selected-baseline-cases.json"), selected);
  writeJson(path.join(runDir, "mirror-results.json"), mirroredResults);
  writeJson(path.join(runDir, "pair-summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);

  console.log(`[rts-mirror-probe] report=${path.join(runDir, "report.md")}`);
}

main().catch((error) => {
  console.error(`[rts-mirror-probe] ${error.stack || error.message}`);
  process.exitCode = 1;
});
