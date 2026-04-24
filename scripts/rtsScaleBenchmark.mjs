#!/usr/bin/env node

import path from "node:path";

import {
  SCALE_CASES,
  loadScaleBaseline,
  renderScaleBenchmarkReport,
  runScaleBenchmark,
} from "./rtsScaleHarness.mjs";
import { ensureDir, makeRunId, reportRoot, writeJson, writeMarkdown } from "./rtsHarness.mjs";

const runId = makeRunId("rts-scale-benchmark");
const runDir = path.join(reportRoot, "runs", runId);
const latestSummaryPath = path.join(reportRoot, "latest-scale-benchmark-summary.json");
const latestReportPath = path.join(reportRoot, "latest-scale-benchmark-report.md");

ensureDir(runDir);

try {
  const results = SCALE_CASES.map((caseDef) => runScaleBenchmark(caseDef));
  const comparisons = Object.fromEntries(results.map((result) => {
    const baseline = loadScaleBaseline(result.id);
    const averageImprovementPct = percentImprovement(baseline.benchmarkBaseline.averageTickMs, result.averageTickMs);
    const p95ImprovementPct = percentImprovement(baseline.benchmarkBaseline.averageP95Ms, result.averageP95Ms);
    return [
      result.id,
      {
        averageImprovementPct,
        p95ImprovementPct,
        baselineAverageTickMs: baseline.benchmarkBaseline.averageTickMs,
        baselineAverageP95Ms: baseline.benchmarkBaseline.averageP95Ms,
      },
    ];
  }));
  const checks = results.flatMap((result) => {
    if (result.id !== "stress-100") return [];
    const comparison = comparisons[result.id];
    return [
      {
        name: "100-total-unit average tick improved by at least 25%",
        pass: comparison.averageImprovementPct >= 25,
      },
      {
        name: "100-total-unit average p95 improved by at least 20%",
        pass: comparison.p95ImprovementPct >= 20,
      },
    ];
  });

  const summary = {
    ok: checks.every((check) => check.pass),
    status: checks.every((check) => check.pass) ? "passed" : "failed",
    runId,
    timestamp: new Date().toISOString(),
    results,
    comparisons,
    checks,
  };

  const report = [
    renderScaleBenchmarkReport(results, comparisons),
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.pass ? "[pass]" : "[fail]"} ${check.name}`),
  ].join("\n");

  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, report);

  console.log(`[rts-scale-benchmark] status=${summary.status} cases=${results.length}`);
  console.log(`[rts-scale-benchmark] report=${latestReportPath}`);
  console.log(`[rts-scale-benchmark] summary=${latestSummaryPath}`);

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
  writeMarkdown(latestReportPath, `# RTS Scale Benchmark Failed\n\n- Error: ${error.message}\n`);
  console.error(`[rts-scale-benchmark] ${error.stack || error.message}`);
  process.exitCode = 1;
}

function percentImprovement(baseline, current) {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(current)) return 0;
  return Math.round((((baseline - current) / baseline) * 100) * 1000) / 1000;
}
