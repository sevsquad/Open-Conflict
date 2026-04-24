#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runTaskPool,
} from "./rtsResearchHarness.mjs";
import {
  ensureDir,
  makeRunId,
  reportRoot,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_WORKERS = Math.min(12, Math.max(4, Math.floor(os.cpus().length / 2)));
const CAMPAIGN_ROOT = path.join(reportRoot, "research", "adaptive-campaigns");
const TOTAL_BATCHES = 20;
const BATCH_SIZE = 50;
const BASE_SEED = 24000;
const DEFAULT_SCENARIO_MIX = [
  { scenarioId: "multi_zone_control", count: 20 },
  { scenarioId: "rear_probe", count: 10 },
  { scenarioId: "low_supply", count: 10 },
  { scenarioId: "attrition", count: 10 },
];

const BASE_RUNTIME_HARNESS = {
  scenarioScale: "double",
  terrainMode: "expanded_fixture",
  rtsOptions: {
    aiGoalModel: "map_control_v1",
    aiVariationMode: "hybrid",
    aiVariationConfig: {
      temperature: 0.35,
      softmaxTopN: 3,
      driftSigma: 0.06,
      driftDecay: 0.85,
      driftClamp: 0.18,
    },
    aiLogMode: "summary",
  },
  actorOverrides: {
    shared: {
      profile: "balanced",
      thinkBudget: "deliberate",
    },
    byActorId: {},
  },
};

const TWEAK_CATALOG = {
  baseline: {
    id: "baseline",
    label: "Baseline",
    expectedEffect: "Establish the control dataset for the larger map family without pushing the planner in any special direction.",
    patch: {},
  },
  recon_pressure: {
    id: "recon_pressure",
    label: "Recon Pressure",
    expectedEffect: "Increase active search, keep recon forward longer, and improve enemy reacquisition when contact goes stale.",
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            reconBias: 1.18,
            neutralZoneOpportunism: 0.72,
            objectivePersistence: 0.7,
          },
          experimentTuning: {
            director: {
              styleScale: {
                flank: 1.12,
                attack: 1.04,
              },
              probe: {
                frontierWeight: 4.8,
                neutralOpportunityWeight: 3.8,
                probePackageBonus: 4.6,
              },
              roleBases: {
                screen: 10.8,
                opportunitySupport: 9.2,
              },
              roleWeights: {
                screenFlankWeight: 6.1,
                probePressureBonus: 2.8,
              },
              blindSearch: {
                maxScreenOwners: 2,
                escortLimitWhenThreePlusManeuverOwners: 2,
              },
            },
            command: {
              reconScreenThreshold: 0.9,
            },
          },
        },
      },
    },
  },
  pressure_commit: {
    id: "pressure_commit",
    label: "Pressure Commit",
    expectedEffect: "Raise objective pressure and shorten the delay before maneuver groups start pushing into scoring zones.",
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            aggression: 0.66,
            reserveRatio: 0.18,
            reservePatience: 0.42,
            breakthroughExploitation: 0.72,
            objectivePersistence: 0.78,
          },
          experimentTuning: {
            director: {
              styleScale: {
                attack: 1.12,
                vp: 1.08,
              },
              roleBases: {
                mainEffort: 12.6,
                supportingAttack: 9.8,
              },
              primaryChoice: {
                attackWeight: 1.14,
                exploitWeight: 0.72,
              },
            },
            commander: {
              reserve: {
                stagedReleaseThreshold: 0.48,
                minimumHoldBaseMs: 8000,
                minimumHoldPatienceMs: 45000,
              },
            },
          },
        },
      },
    },
  },
  combined_arms: {
    id: "combined_arms",
    label: "Combined Arms",
    expectedEffect: "Increase support-by-fire participation and make main efforts more likely to move with dedicated support rather than in isolated pulses.",
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            supportBias: 1.06,
            supportByFireBias: 0.82,
            reservePatience: 0.58,
          },
          experimentTuning: {
            director: {
              styleScale: {
                support: 1.16,
              },
              roleBases: {
                supportByFire: 10.4,
                supportingAttack: 9.6,
              },
              roleWeights: {
                supportBiasWeight: 5.7,
              },
            },
            commander: {
              roleFlex: {
                supportByFireSlotsScale: 3,
              },
            },
          },
        },
      },
    },
  },
  recon_combined_balance: {
    id: "recon_combined_balance",
    label: "Recon + Combined Balance",
    expectedEffect: "Restore active search without sacrificing support-by-fire participation or support legality on the larger map.",
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            reconBias: 1.1,
            neutralZoneOpportunism: 0.66,
            supportBias: 1.02,
            supportByFireBias: 0.72,
            reservePatience: 0.52,
          },
          experimentTuning: {
            director: {
              styleScale: {
                flank: 1.08,
                support: 1.08,
                attack: 1.05,
              },
              probe: {
                frontierWeight: 4.4,
                neutralOpportunityWeight: 3.5,
                probePackageBonus: 4,
              },
              roleBases: {
                screen: 10.2,
                supportByFire: 9.6,
                supportingAttack: 9.4,
              },
              roleWeights: {
                screenFlankWeight: 5.3,
                supportBiasWeight: 4.9,
              },
              blindSearch: {
                maxScreenOwners: 1,
                escortLimitWhenThreePlusManeuverOwners: 1,
              },
            },
          },
        },
      },
    },
  },
  reserve_discipline: {
    id: "reserve_discipline",
    label: "Reserve Discipline",
    expectedEffect: "Improve setback response and keep enough depth behind the line to punish rear pressure instead of fully flattening the formation.",
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            rearSecurityBias: 0.74,
            reservePatience: 0.72,
            reserveRatio: 0.28,
            defenseBias: 0.58,
          },
          experimentTuning: {
            director: {
              roleBases: {
                rearSecurity: 8.9,
                contain: 11,
              },
              roleWeights: {
                rearSecurityNeedBonus: 3.2,
                recoverPressureBonus: 3.1,
              },
            },
            commander: {
              reserve: {
                stagedReleaseThreshold: 0.6,
                minimumHoldBaseMs: 20000,
                minimumHoldPatienceMs: 70000,
              },
            },
          },
        },
      },
    },
  },
  stability: {
    id: "stability",
    label: "Stability",
    expectedEffect: "Reduce planner churn and reckless close-call sampling so execution fidelity improves and support plans stay legal under pressure.",
    patch: {
      rtsOptions: {
        aiVariationConfig: {
          temperature: 0.22,
          softmaxTopN: 3,
          driftSigma: 0.04,
          driftDecay: 0.88,
          driftClamp: 0.14,
        },
      },
      actorOverrides: {
        shared: {
          profileOverrides: {
            frontageDiscipline: 0.76,
            threatPenalty: 1.02,
            dangerTolerance: 0.42,
          },
          experimentTuning: {
            director: {
              styleScale: {
                caution: 1.08,
                riskPenalty: 1.12,
              },
              primaryChoice: {
                closeGapThreshold: 2.1,
                closeGapRatio: 0.1,
              },
              blindSearch: {
                maxScreenOwners: 1,
              },
            },
          },
        },
      },
    },
  },
  stress_test: {
    id: "stress_test",
    label: "Stress Test",
    expectedEffect: "Push the planner into a hotter, more aggressive envelope to see which failure modes appear first once the AI starts taking bigger risks.",
    patch: {
      rtsOptions: {
        aiVariationConfig: {
          temperature: 0.55,
          softmaxTopN: 3,
          driftSigma: 0.09,
          driftDecay: 0.82,
          driftClamp: 0.2,
        },
      },
      actorOverrides: {
        shared: {
          profileOverrides: {
            aggression: 0.74,
            dangerTolerance: 0.68,
            reservePatience: 0.34,
            reconBias: 1.16,
          },
          experimentTuning: {
            director: {
              styleScale: {
                attack: 1.18,
                flank: 1.2,
              },
              roleBases: {
                mainEffort: 13,
                screen: 11.1,
              },
              blindSearch: {
                maxScreenOwners: 2,
              },
            },
            command: {
              engagementTempoWeight: 0.6,
              objectiveTempoWeight: 0.55,
            },
          },
        },
      },
    },
  },
};

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function deepMergeObjects(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return cloneValue(base);
  }
  const result = cloneValue(base || {});
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMergeObjects(result[key], value);
    } else {
      result[key] = cloneValue(value);
    }
  }
  return result;
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readJsonIfExists(targetPath, fallback) {
  if (!fs.existsSync(targetPath)) return fallback;
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function getMetric(result, pathExpression, fallback = 0) {
  let current = result;
  for (const segment of pathExpression.split(".")) {
    if (current == null || typeof current !== "object" || !(segment in current)) {
      return fallback;
    }
    current = current[segment];
  }
  return typeof current === "number" ? current : fallback;
}

function summarizeMetric(results, pathExpression) {
  return roundMetric(average(results.map((result) => getMetric(result, pathExpression, 0))));
}

function isControlBatch(batchIndex) {
  return batchIndex === 1 || ((batchIndex - 1) % 5 === 0);
}

function buildBatchTasks(batchIndex, runtimeHarness, { identicalSides = true } = {}) {
  const tasks = [];
  let seedOffset = 0;
  for (const entry of DEFAULT_SCENARIO_MIX) {
    for (let index = 0; index < entry.count; index += 1) {
      tasks.push({
        id: `batch_${String(batchIndex).padStart(2, "0")}_task_${String(seedOffset + 1).padStart(2, "0")}`,
        bucketId: "adaptive_smoke",
        scenarioId: entry.scenarioId,
        seed: BASE_SEED + seedOffset,
        profile: "balanced",
        identicalSides,
        scenarioScale: "double",
        terrainMode: "expanded_fixture",
        runtimeHarness,
      });
      seedOffset += 1;
    }
  }
  return tasks.slice(0, BATCH_SIZE);
}

function summarizeBatchResults(results) {
  const timeLimitRate = roundMetric(results.filter((result) => result.outcome?.victoryReason === "time_limit").length / Math.max(1, results.length));
  const winners = {};
  const scenarioCounts = {};
  for (const result of results) {
    winners[result.outcome?.winner || "none"] = (winners[result.outcome?.winner || "none"] || 0) + 1;
    scenarioCounts[result.scenarioId] = (scenarioCounts[result.scenarioId] || 0) + 1;
  }
  return {
    completedRuns: results.length,
    winners,
    scenarioCounts,
    timeLimitRate,
    humanChallengeScore: summarizeMetric(results, "metrics.humanChallenge.humanChallengeScore"),
    objectivePressureRate: summarizeMetric(results, "metrics.humanChallenge.objectivePressureRate"),
    combinedArmsRate: summarizeMetric(results, "metrics.humanChallenge.combinedArmsRate"),
    threatResponseRate: summarizeMetric(results, "metrics.humanChallenge.threatResponseRate"),
    reserveTimingDiscipline: summarizeMetric(results, "metrics.humanChallenge.reserveTimingDiscipline"),
    noContactSearchRate: summarizeMetric(results, "metrics.reconAndSearch.noContactSearchRate"),
    contactSearchRate: summarizeMetric(results, "metrics.reconAndSearch.contactSearchRate"),
    reconOwnerSearchRate: summarizeMetric(results, "metrics.reconAndSearch.reconOwnerSearchRate"),
    contactReacquisitionRate: summarizeMetric(results, "metrics.reconAndSearch.contactReacquisitionRate"),
    searchEpisodeMs: summarizeMetric(results, "metrics.reconAndSearch.searchEpisodeMs"),
    executionFidelity: summarizeMetric(results, "metrics.executionAndFormation.executionFidelity"),
    stuckUnitRate: summarizeMetric(results, "metrics.hardInvariants.stuckUnitRate"),
    deadTaskPursuitRate: summarizeMetric(results, "metrics.hardInvariants.deadTaskPursuitRate"),
    invalidSupportRate: summarizeMetric(results, "metrics.hardInvariants.invalidSupportRate"),
    packageChurnPerMinute: summarizeMetric(results, "metrics.decisionQuality.packageChurnPerMinute"),
    undercommitmentRate: summarizeMetric(results, "metrics.decisionQuality.undercommitmentRate"),
    overcommitmentRate: summarizeMetric(results, "metrics.decisionQuality.overcommitmentRate"),
    commandLatencyMs: summarizeMetric(results, "metrics.executionAndFormation.commandLatencyMs"),
    averageWallMs: roundMetric(average(results.map((result) => result.wallMs || 0))),
  };
}

function deriveBatchObservations(summary) {
  const observations = [];
  if (summary.noContactSearchRate < 0.55) observations.push("Search posture is still too passive when contact drops.");
  if (summary.contactReacquisitionRate < 0.35) observations.push("Reacquisition after search remains weak.");
  if (summary.objectivePressureRate < 0.55) observations.push("The AI is not sustaining enough pressure on scoring zones.");
  if (summary.combinedArmsRate < 0.16) observations.push("Combined-arms pairing is still flatter than it should be.");
  if (summary.threatResponseRate < 0.5) observations.push("Threat response remains too slow or too thin under rear/front pressure.");
  if (summary.executionFidelity < 0.9) observations.push("Execution fidelity is leaving plan quality on the table.");
  if (summary.invalidSupportRate > 0.15) observations.push("Support planning legality is slipping under the current settings.");
  if (summary.stuckUnitRate > 0.2) observations.push("Movement friction is still high enough to visibly blunt maneuver.");
  if (summary.humanChallengeScore >= 0.62 && summary.invalidSupportRate <= 0.12 && summary.stuckUnitRate <= 0.18) {
    observations.push("The current envelope looks coherent enough to start pushing harder for failure discovery.");
  }
  if (observations.length === 0) {
    observations.push("No single failure dominated the batch; this is a good point to perturb settings more aggressively.");
  }
  return observations;
}

function chooseAdaptiveTweak(summary, history) {
  const recentTweaks = new Set(history.slice(-3).map((entry) => entry.appliedTweakId));
  const lastTweakId = history[history.length - 1]?.appliedTweakId || null;
  const choose = (id) => TWEAK_CATALOG[id];

  if (summary.noContactSearchRate < 0.55 || summary.contactReacquisitionRate < 0.35) {
    if (summary.combinedArmsRate < 0.5 && lastTweakId !== "recon_combined_balance") {
      return choose("recon_combined_balance");
    }
    return lastTweakId === "recon_pressure" ? choose("combined_arms") : choose("recon_pressure");
  }
  if (summary.objectivePressureRate < 0.55 || summary.undercommitmentRate > 0.32 || summary.humanChallengeScore < 0.52) {
    return recentTweaks.has("pressure_commit") ? choose("combined_arms") : choose("pressure_commit");
  }
  if (summary.combinedArmsRate < 0.16) {
    return recentTweaks.has("combined_arms") ? choose("pressure_commit") : choose("combined_arms");
  }
  if (summary.invalidSupportRate > 0.15 || summary.packageChurnPerMinute > 0.55 || summary.executionFidelity < 0.88 || summary.stuckUnitRate > 0.2) {
    return choose("stability");
  }
  if (summary.threatResponseRate < 0.5 || summary.overcommitmentRate > 0.34) {
    return choose("reserve_discipline");
  }
  return choose("stress_test");
}

function describeBatchEffect(currentSummary, previousSummary) {
  if (!previousSummary) {
    return "Baseline established for the larger smoke family.";
  }
  const deltas = [
    {
      label: "search coverage",
      value: roundMetric(currentSummary.noContactSearchRate - previousSummary.noContactSearchRate),
    },
    {
      label: "reacquisition",
      value: roundMetric(currentSummary.contactReacquisitionRate - previousSummary.contactReacquisitionRate),
    },
    {
      label: "objective pressure",
      value: roundMetric(currentSummary.objectivePressureRate - previousSummary.objectivePressureRate),
    },
    {
      label: "challenge score",
      value: roundMetric(currentSummary.humanChallengeScore - previousSummary.humanChallengeScore),
    },
    {
      label: "execution fidelity",
      value: roundMetric(currentSummary.executionFidelity - previousSummary.executionFidelity),
    },
  ]
    .filter((entry) => Math.abs(entry.value) >= 0.02)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 3)
    .map((entry) => `${entry.label} ${entry.value > 0 ? "up" : "down"} ${Math.abs(entry.value)}`);
  if (deltas.length === 0) {
    return "The major behavior metrics were broadly flat against the previous batch.";
  }
  return deltas.join(", ");
}

function renderBatchReport(summaryRecord) {
  const lines = [
    `# Batch ${summaryRecord.batchIndex} of ${TOTAL_BATCHES}`,
    "",
    `- Mode: ${summaryRecord.mode}`,
    `- Applied tweak: ${summaryRecord.appliedTweakLabel}`,
    `- Expected effect: ${summaryRecord.expectedEffect}`,
    `- Actual effect: ${summaryRecord.actualEffect}`,
    `- Next planned tweak: ${summaryRecord.nextPlannedTweakLabel}`,
    "",
    "## Key Metrics",
    "",
  ];
  for (const [key, value] of Object.entries(summaryRecord.summary || {})) {
    if (typeof value === "object") continue;
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Observations");
  lines.push("");
  for (const observation of summaryRecord.observations || []) {
    lines.push(`- ${observation}`);
  }
  return lines.join("\n");
}

function appendExperimentLog(campaignDir, summaryRecord) {
  const logMdPath = path.join(campaignDir, "experiment-log.md");
  const logJsonlPath = path.join(campaignDir, "experiment-log.jsonl");
  const mdSection = [
    `## Batch ${summaryRecord.batchIndex}`,
    "",
    `- Applied tweak: ${summaryRecord.appliedTweakLabel}`,
    `- Expected effect: ${summaryRecord.expectedEffect}`,
    `- Actual effect: ${summaryRecord.actualEffect}`,
    `- Next planned tweak: ${summaryRecord.nextPlannedTweakLabel}`,
    "",
    ...Object.entries(summaryRecord.summary || {}).map(([key, value]) => `- ${key}: ${value}`),
    "",
    ...(summaryRecord.observations || []).map((observation) => `- ${observation}`),
    "",
  ].join("\n");
  fs.appendFileSync(logMdPath, `${mdSection}\n`);
  fs.appendFileSync(logJsonlPath, `${JSON.stringify(summaryRecord)}\n`);
}

function parseArgs(argv) {
  let campaignDir = null;
  let workerCount = DEFAULT_WORKERS;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--campaign-dir" && argv[index + 1]) {
      campaignDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--workers" && argv[index + 1]) {
      workerCount = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || DEFAULT_WORKERS);
      index += 1;
    }
  }
  return { campaignDir, workerCount };
}

function initializeCampaignDir(campaignDir) {
  ensureDir(campaignDir);
  const statePath = path.join(campaignDir, "campaign-state.json");
  if (fs.existsSync(statePath)) {
    return statePath;
  }
  const initialState = {
    runId: path.basename(campaignDir),
    createdAt: new Date().toISOString(),
    totalBatches: TOTAL_BATCHES,
    baselineRuntimeHarness: BASE_RUNTIME_HARNESS,
    history: [],
  };
  writeJson(statePath, initialState);
  writeMarkdown(path.join(campaignDir, "experiment-log.md"), `# Adaptive RTS Smoke Campaign\n\n- Created at: ${initialState.createdAt}\n- Total batches: ${TOTAL_BATCHES}\n`);
  return statePath;
}

async function runNextBatch() {
  const { campaignDir: requestedCampaignDir, workerCount } = parseArgs(process.argv);
  const campaignDir = requestedCampaignDir || path.join(CAMPAIGN_ROOT, makeRunId("rts-adaptive"));
  const statePath = initializeCampaignDir(campaignDir);
  const state = readJsonIfExists(statePath, null);
  if (!state) {
    throw new Error(`Failed to load campaign state at ${statePath}`);
  }
  const batchIndex = (state.history?.length || 0) + 1;
  if (batchIndex > TOTAL_BATCHES) {
    console.log(`[adaptive] campaign_dir=${campaignDir}`);
    console.log("[adaptive] status=complete");
    return;
  }

  const previousEntry = state.history?.[state.history.length - 1] || null;
  const mode = isControlBatch(batchIndex) ? (batchIndex === 1 ? "baseline" : "control") : "adaptive";
  const appliedTweak = mode === "adaptive"
    ? chooseAdaptiveTweak(previousEntry?.summary || {}, state.history || [])
    : TWEAK_CATALOG.baseline;
  const runtimeHarness = deepMergeObjects(state.baselineRuntimeHarness, appliedTweak.patch || {});
  const tasks = buildBatchTasks(batchIndex, runtimeHarness, { identicalSides: true });
  const batchDir = path.join(campaignDir, `batch-${String(batchIndex).padStart(2, "0")}`);
  ensureDir(batchDir);
  writeJson(path.join(batchDir, "config.json"), {
    batchIndex,
    mode,
    appliedTweakId: appliedTweak.id,
    appliedTweakLabel: appliedTweak.label,
    expectedEffect: appliedTweak.expectedEffect,
    runtimeHarness,
    tasks,
  });

  const results = await runTaskPool(tasks, {
    workerCount,
    onProgress: ({ completed, total }) => {
      if (completed % 10 !== 0 && completed !== total) return;
      writeJson(path.join(batchDir, "checkpoint.json"), {
        batchIndex,
        completed,
        total,
      });
    },
  });
  const summary = summarizeBatchResults(results);
  const observations = deriveBatchObservations(summary);
  const actualEffect = describeBatchEffect(summary, previousEntry?.summary || null);
  const nextPlannedTweak = batchIndex >= TOTAL_BATCHES
    ? null
    : (isControlBatch(batchIndex + 1) ? TWEAK_CATALOG.baseline : chooseAdaptiveTweak(summary, [...(state.history || []), { appliedTweakId: appliedTweak.id }]));

  const summaryRecord = {
    batchIndex,
    mode,
    appliedTweakId: appliedTweak.id,
    appliedTweakLabel: appliedTweak.label,
    expectedEffect: appliedTweak.expectedEffect,
    actualEffect,
    nextPlannedTweakId: nextPlannedTweak?.id || null,
    nextPlannedTweakLabel: nextPlannedTweak?.label || "None",
    summary,
    observations,
    resultsPath: path.join(batchDir, "results.json"),
    reportPath: path.join(batchDir, "report.md"),
    configPath: path.join(batchDir, "config.json"),
  };

  writeJson(path.join(batchDir, "results.json"), results);
  writeJson(path.join(batchDir, "summary.json"), summaryRecord);
  writeMarkdown(path.join(batchDir, "report.md"), renderBatchReport(summaryRecord));
  appendExperimentLog(campaignDir, summaryRecord);

  state.history = [...(state.history || []), summaryRecord];
  state.lastUpdatedAt = new Date().toISOString();
  writeJson(statePath, state);

  console.log(`[adaptive] campaign_dir=${campaignDir}`);
  console.log(`[adaptive] batch=${batchIndex}/${TOTAL_BATCHES}`);
  console.log(`[adaptive] summary=${path.join(batchDir, "summary.json")}`);
}

const isEntrypoint = !!process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isEntrypoint) {
  runNextBatch().catch((error) => {
    console.error(`[adaptive] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
