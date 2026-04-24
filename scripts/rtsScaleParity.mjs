#!/usr/bin/env node

import path from "node:path";

import {
  SCALE_CASES,
  buildCombatTieRegression,
  buildSpotterTieRegression,
  getScaleBaselinePath,
  loadScaleBaseline,
  renderScaleParityReport,
  runScaleCase,
} from "./rtsScaleHarness.mjs";
import { ensureDir, makeRunId, reportRoot, writeJson, writeMarkdown } from "./rtsHarness.mjs";

const runId = makeRunId("rts-scale-parity");
const runDir = path.join(reportRoot, "runs", runId);
const latestSummaryPath = path.join(reportRoot, "latest-scale-parity-summary.json");
const latestReportPath = path.join(reportRoot, "latest-scale-parity-report.md");

ensureDir(runDir);

try {
  const results = SCALE_CASES.map((caseDef) => {
    const baseline = loadScaleBaseline(caseDef.id);
    const run = runScaleCase(caseDef, { seed: baseline.parity.seed, totalTicks: baseline.parity.totalTicks });
    return {
      id: caseDef.id,
      label: caseDef.label,
      seed: baseline.parity.seed,
      pass: run.stateHash === baseline.parity.stateHash
        && run.replayHash === baseline.parity.replayHash
        && run.provenanceHash === baseline.parity.provenanceHash,
      expected: baseline.parity,
      observed: {
        stateHash: run.stateHash,
        replayHash: run.replayHash,
        provenanceHash: run.provenanceHash,
        tickStats: baseline.parity.tickStats,
        outcome: run.outcome,
      },
      baselinePath: getScaleBaselinePath(caseDef.id),
    };
  });

  const spotterTie = buildSpotterTieRegression();
  const combatTie = buildCombatTieRegression();
  const checks = [
    ...results.map((result) => ({
      name: `${result.label} hash parity`,
      pass: result.pass,
    })),
    {
      name: "Equal-quality spotter tie preserved the later global-order spotter",
      pass: spotterTie.passed,
    },
    {
      name: "Equal-score combat tie preserved the earlier global-order target",
      pass: combatTie.passed,
    },
  ];

  const summary = {
    ok: checks.every((check) => check.pass),
    status: checks.every((check) => check.pass) ? "passed" : "failed",
    runId,
    timestamp: new Date().toISOString(),
    checks,
    results,
    spotterTie,
    combatTie,
  };

  const report = [
    renderScaleParityReport(results),
    "",
    "## Tie Regressions",
    "",
    `- Spotter tie expected \`${spotterTie.expectedSpotterId}\`, observed \`${spotterTie.observedSpotterId || "none"}\``,
    `- Combat tie expected \`${combatTie.expectedTargetId}\`, observed \`${combatTie.observedTargetId || "none"}\``,
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.pass ? "[pass]" : "[fail]"} ${check.name}`),
  ].join("\n");

  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, report);

  console.log(`[rts-scale-parity] status=${summary.status} checks=${checks.filter((check) => check.pass).length}/${checks.length}`);
  console.log(`[rts-scale-parity] report=${latestReportPath}`);
  console.log(`[rts-scale-parity] summary=${latestSummaryPath}`);

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
  writeMarkdown(latestReportPath, `# RTS Scale Parity Failed\n\n- Error: ${error.message}\n`);
  console.error(`[rts-scale-parity] ${error.stack || error.message}`);
  process.exitCode = 1;
}
