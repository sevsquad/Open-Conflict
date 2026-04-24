#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTaskPool } from "./rtsResearchHarness.mjs";
import {
  ensureDir,
  makeRunId,
  reportRoot,
  writeJson,
  writeMarkdown,
} from "./rtsHarness.mjs";

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_WORKERS = Math.min(12, Math.max(4, Math.floor(os.cpus().length / 2)));
const SCREENING_ROOT = path.join(reportRoot, "research", "screening-campaigns");
const TOTAL_BATCHES = 10;
const PAIR_COUNT = 25;
const BASE_SEED = 41000;
const DEFAULT_PAIR_REPEATS = 5;
const DEFAULT_SCENARIOS = [
  "multi_zone_control",
  "rear_probe",
  "attrition",
  "low_supply",
  "encirclement",
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

const BATCH_CATALOG = [
  {
    id: "recon_search_ownership",
    label: "Recon/Search Ownership",
    expectedEffect: "Push active search, screen ownership, and stale-contact hunting hard enough to reveal whether recon pressure can scale without collapsing the rest of the force.",
    touchedSystems: ["recon", "search", "screen roles", "blind search"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            reconBias: 1.24,
            neutralZoneOpportunism: 0.74,
            objectivePersistence: 0.68,
            supportBias: 0.94,
          },
          experimentTuning: {
            director: {
              styleScale: {
                flank: 1.14,
                attack: 1.05,
              },
              probe: {
                frontierWeight: 5,
                neutralOpportunityWeight: 4.2,
                probePackageBonus: 4.8,
                lowControlBonus: 3,
              },
              roleBases: {
                screen: 11.2,
                opportunitySupport: 9.1,
              },
              roleWeights: {
                screenFlankWeight: 6.2,
                probePressureBonus: 3.1,
              },
              blindSearch: {
                maxScreenOwners: 2,
                escortLimitWhenThreePlusManeuverOwners: 2,
                roleCloseGapThreshold: 3.2,
                roleCloseGapRatio: 0.24,
              },
            },
            command: {
              reconScreenThreshold: 0.88,
              lastKnownScreenBias: 1.22,
            },
          },
        },
      },
    },
  },
  {
    id: "contact_memory_handoff",
    label: "Contact Memory And Handoff",
    expectedEffect: "Bias the force toward holding contact and handing it off to support and maneuver owners instead of letting probe behavior stay isolated.",
    touchedSystems: ["contact memory", "last-known bias", "support handoff", "maneuver follow-up"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            reconBias: 1.08,
            supportBias: 1.12,
            supportByFireBias: 0.86,
            objectivePersistence: 0.78,
            reservePatience: 0.5,
          },
          experimentTuning: {
            director: {
              styleScale: {
                support: 1.12,
                attack: 1.04,
              },
              roleBases: {
                screen: 10.2,
                opportunitySupport: 10.4,
                supportByFire: 9.8,
                supportingAttack: 9.8,
              },
              roleWeights: {
                opportunitySupportWeight: 3.6,
                supportBiasWeight: 5.6,
                probePressureBonus: 2.2,
              },
              blindSearch: {
                maxScreenOwners: 1,
                escortLimitWhenThreePlusManeuverOwners: 1,
                roleCloseGapThreshold: 2.8,
                roleCloseGapRatio: 0.15,
              },
            },
            commander: {
              roleFlex: {
                supportByFireSlotsScale: 3,
              },
            },
            command: {
              reconScreenThreshold: 0.96,
              lastKnownScreenBias: 1.45,
            },
          },
        },
      },
    },
  },
  {
    id: "director_objective_prioritization",
    label: "Director Objective Prioritization",
    expectedEffect: "Test whether stronger map-control pressure and more decisive primary-choice scoring can make the AI act more like a campaign planner instead of a local reaction machine.",
    touchedSystems: ["director pressure model", "primary choice", "zone prioritization", "role assignment"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            vpFocus: 1.12,
            objectivePersistence: 0.82,
            breakthroughExploitation: 0.72,
            rearSecurityBias: 0.44,
          },
          experimentTuning: {
            director: {
              controlPressure: {
                baseVpWeight: 0.6,
                controlDeficitWeight: 1,
                frontierReachabilityWeight: 6.2,
                breakthroughOpportunityWeight: 7.6,
                terrainOpportunityWeight: 3.2,
                enemyHoldUrgencyWeight: 12,
                congestionPenaltyWeight: 3.2,
                cutOffPenaltyWeight: 3.2,
              },
              exploit: {
                neutralBaseVpWeight: 1.35,
                contestedBaseVpWeight: 1.15,
                enemyBaseVpWeight: 0.84,
                breakthroughWeight: 7,
                frontierWeight: 4.8,
                terrainWeight: 3.1,
                neutralOpportunityWeight: 4,
                enemyHoldUrgencyWeight: 3.4,
                exploitabilityWeight: 3.2,
                cutOffPenaltyWeight: 2.2,
                congestionPenaltyWeight: 1.5,
              },
              roleBases: {
                mainEffort: 12.4,
                supportingAttack: 9.6,
                contain: 11.2,
              },
              primaryChoice: {
                attackWeight: 1.16,
                exploitWeight: 0.68,
                controlPressureWeight: 0.25,
                defeatInDetailWeight: 1,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "support_legality_combined_arms",
    label: "Support Legality And Combined Arms",
    expectedEffect: "Stress the support stack to see if the AI can keep fire support legal and present while still moving with coherent attack packages.",
    touchedSystems: ["support bias", "support-by-fire slots", "support legality", "combined arms"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            supportBias: 1.18,
            supportByFireBias: 0.92,
            artilleryBias: 1.14,
            aggression: 0.5,
          },
          experimentTuning: {
            director: {
              styleScale: {
                support: 1.2,
                caution: 1.05,
              },
              support: {
                supportValueWeight: 9.5,
                terrainWeight: 3.8,
                frontierWeight: 2.8,
                enemyPressureWeight: 2.1,
              },
              roleBases: {
                mainEffort: 11.2,
                supportingAttack: 10,
                supportByFire: 10.8,
              },
              roleWeights: {
                opportunitySupportWeight: 3,
                supportBiasWeight: 6.2,
              },
            },
            commander: {
              roleFlex: {
                supportByFireSlotsScale: 3,
                reserveSlotsScale: 2,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "reserve_commit_defeat_in_detail",
    label: "Reserve Commitment And Defeat In Detail",
    expectedEffect: "Probe whether earlier reserve release and stronger isolate-and-crush logic can help non-defensive commanders punish local enemy weakness without flattening the line.",
    touchedSystems: ["reserve release", "counterattack logic", "defeat in detail", "local superiority"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            aggression: 0.64,
            defenseBias: 0.42,
            reserveRatio: 0.2,
            reservePatience: 0.48,
            counterattackBias: 0.62,
            breakthroughExploitation: 0.8,
            dangerTolerance: 0.56,
          },
          experimentTuning: {
            director: {
              roleBases: {
                mainEffort: 12,
                contain: 10.8,
                rearSecurity: 7,
              },
              roleWeights: {
                recoverPressureBonus: 3.2,
                reliefPreferenceWeight: 3.8,
              },
              defeatInDetail: {
                enabled: 1,
                strengthRatioThreshold: 1.05,
                defenseBiasCeiling: 0.78,
                supportWeight: 1.05,
                frontierWeight: 0.95,
                breakthroughWeight: 0.9,
                exploitabilityWeight: 0.8,
                cutOffPenaltyWeight: 0.35,
                congestionPenaltyWeight: 0.25,
                inferiorityScale: 4.2,
                postureDefenseWeight: 0.5,
                postureAggressionWeight: 0.55,
                postureTempoWeight: 0.35,
                postureFlankWeight: 0.3,
                opportunityThreshold: 0.5,
              },
            },
            commander: {
              reserve: {
                stagedReleaseThreshold: 0.48,
                conservativeReleaseThreshold: 0.72,
                minimumHoldBaseMs: 10000,
                minimumHoldPatienceMs: 42000,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "mobility_path_frontage",
    label: "Mobility, Path Discipline, And Frontage",
    expectedEffect: "Push the system toward tidier movement, fewer overloaded lanes, and better frontage discipline so maneuver quality rises on the larger map family.",
    touchedSystems: ["movement", "congestion", "frontage", "risk penalty"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            frontageDiscipline: 0.82,
            routeRiskBias: 0.58,
            trafficTolerance: 0.18,
            salientTolerance: 0.36,
            objectivePersistence: 0.58,
          },
          experimentTuning: {
            director: {
              styleScale: {
                caution: 1.12,
                reserve: 1.05,
                flank: 0.92,
                riskPenalty: 1.18,
              },
              controlPressure: {
                congestionPenaltyWeight: 5.4,
                cutOffPenaltyWeight: 4.8,
                terrainOpportunityWeight: 2.4,
              },
              defend: {
                transitionWeight: 4.1,
                rearExposureWeight: 4.4,
              },
              reserve: {
                congestionPenaltyWeight: 2.4,
                cutOffPenaltyWeight: 1.8,
              },
              roleWeights: {
                mainOverloadPenalty: 3.2,
                secondaryOverloadBonus: 1.2,
                rearSecurityNeedBonus: 2.8,
              },
            },
            commander: {
              roleFlex: {
                rearSecurityLowThreshold: 0.56,
                rearSecurityHighThreshold: 0.72,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "objective_conversion_finish",
    label: "Objective Conversion And Finish Behavior",
    expectedEffect: "Bias the AI toward finishing promising fights and turning objective pressure into actual capture and score conversion.",
    touchedSystems: ["objective persistence", "exploit scoring", "finish behavior", "capture conversion"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            aggression: 0.68,
            objectivePersistence: 0.88,
            breakthroughExploitation: 0.84,
            vpFocus: 1.14,
            supportByFireBias: 0.7,
            reservePatience: 0.46,
          },
          experimentTuning: {
            director: {
              controlPressure: {
                baseVpWeight: 0.6,
                controlDeficitWeight: 1,
                frontierReachabilityWeight: 5.6,
                breakthroughOpportunityWeight: 7.4,
                enemyHoldUrgencyWeight: 12.5,
              },
              exploit: {
                neutralBaseVpWeight: 1.4,
                contestedBaseVpWeight: 1.2,
                enemyBaseVpWeight: 0.84,
                breakthroughWeight: 7,
                frontierWeight: 4.8,
                neutralOpportunityWeight: 3.8,
                exploitabilityWeight: 3.2,
                cutOffPenaltyWeight: 2.2,
              },
              roleBases: {
                mainEffort: 12.8,
                supportingAttack: 9.8,
                contain: 10.8,
              },
              primaryChoice: {
                attackWeight: 1.18,
                exploitWeight: 0.72,
                controlPressureWeight: 0.26,
                defeatInDetailWeight: 0.85,
              },
            },
            commander: {
              reserve: {
                stagedReleaseThreshold: 0.46,
                minimumHoldBaseMs: 8000,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "survival_retreat_sustainment",
    label: "Survival, Retreat, And Sustainment",
    expectedEffect: "See whether a more survival-conscious posture reduces dumb losses and dead-end pushes without making the AI too passive to matter.",
    touchedSystems: ["retreat logic", "sustainment posture", "threat handling", "combat preservation"],
    patch: {
      actorOverrides: {
        shared: {
          profileOverrides: {
            defenseBias: 0.66,
            dangerTolerance: 0.34,
            fallbackBias: 0.82,
            encirclementAversion: 0.78,
            reservePatience: 0.72,
            reserveRatio: 0.28,
            scarceAssetConservation: 0.86,
            threatPenalty: 1.08,
            rearSecurityBias: 0.72,
          },
          experimentTuning: {
            director: {
              styleScale: {
                caution: 1.18,
                reserve: 1.16,
                attack: 0.96,
                riskPenalty: 1.15,
              },
              defend: {
                enemyPressureWeight: 7.8,
                friendlyHoldThreatWeight: 12.2,
                cutOffRiskWeight: 7.2,
                threatenedBonus: 7.2,
                rearExposureWeight: 4.2,
              },
              reserve: {
                rearExposureWeight: 6.6,
                transitionWeight: 5.6,
                friendlyZoneBase: 4.6,
                holdThreatWeight: 2.8,
                congestionPenaltyWeight: 2,
                cutOffPenaltyWeight: 1.8,
              },
            },
            commander: {
              reserve: {
                stagedReleaseThreshold: 0.62,
                conservativeReleaseThreshold: 0.84,
                minimumHoldBaseMs: 18000,
                minimumHoldPatienceMs: 80000,
              },
              weakFallback: {
                strengthBase: 38,
                fallbackStrengthScale: 24,
                moraleBase: 16,
                defenseMoraleScale: 20,
              },
            },
          },
        },
      },
    },
  },
  {
    id: "tempo_cadence_persistence",
    label: "Tempo, Cadence, And Persistence",
    expectedEffect: "Test whether steadier decision cadence and lower close-call randomness produce cleaner persistence, lower churn, and better follow-through.",
    touchedSystems: ["variation temperature", "decision cadence", "persistence", "package churn"],
    patch: {
      rtsOptions: {
        aiVariationConfig: {
          temperature: 0.24,
          softmaxTopN: 3,
          driftSigma: 0.04,
          driftDecay: 0.9,
          driftClamp: 0.12,
        },
      },
      actorOverrides: {
        shared: {
          profileOverrides: {
            objectivePersistence: 0.82,
            frontageDiscipline: 0.74,
            reservePatience: 0.54,
          },
          experimentTuning: {
            director: {
              primaryChoice: {
                closeGapThreshold: 2.2,
                closeGapRatio: 0.1,
                attackWeight: 1.08,
                exploitWeight: 0.58,
              },
              blindSearch: {
                maxScreenOwners: 1,
              },
            },
            command: {
              engagementTempoWeight: 0.42,
              engagementCautionWeight: 0.24,
              objectiveTempoWeight: 0.46,
              objectiveCautionWeight: 0.24,
              objectiveDangerTempoWeight: 0.18,
              objectiveDangerCautionWeight: 0.28,
            },
          },
        },
      },
    },
  },
  {
    id: "variation_flank_opportunism",
    label: "Variation, Flank, And Opportunism",
    expectedEffect: "Push unpredictability and lateral opportunism to see where creative play starts helping and where it starts becoming undisciplined noise.",
    touchedSystems: ["variation drift", "temperature", "flank bias", "opportunism"],
    patch: {
      rtsOptions: {
        aiVariationConfig: {
          temperature: 0.58,
          softmaxTopN: 3,
          driftSigma: 0.1,
          driftDecay: 0.82,
          driftClamp: 0.22,
        },
      },
      actorOverrides: {
        shared: {
          profileOverrides: {
            reconBias: 1.08,
            neutralZoneOpportunism: 0.76,
            terrainRiskBias: 0.62,
            counterattackBias: 0.58,
            breakthroughExploitation: 0.72,
            frontageDiscipline: 0.54,
            dangerTolerance: 0.6,
          },
          experimentTuning: {
            director: {
              styleScale: {
                flank: 1.24,
                attack: 1.1,
                terrain: 1.08,
              },
              probe: {
                neutralBase: 6,
                contestedBase: 4.6,
                enemyBase: 2.4,
                frontierWeight: 4.8,
                neutralOpportunityWeight: 4.2,
                probePackageBonus: 4.4,
                lowControlBonus: 2.8,
              },
              roleBases: {
                screen: 10.8,
                opportunitySupport: 9.4,
                contain: 10.6,
              },
            },
          },
        },
      },
    },
  },
];

const METRIC_CATALOG = [
  {
    key: "humanChallengeScore",
    label: "Human Challenge",
    group: "pressure",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.humanChallenge.humanChallengeScore"),
  },
  {
    key: "objectivePressureRate",
    label: "Objective Pressure",
    group: "pressure",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.humanChallenge.objectivePressureRate"),
  },
  {
    key: "opportunityConversionRate",
    label: "Opportunity Conversion",
    group: "pressure",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.decisionQuality.opportunityConversionRate"),
  },
  {
    key: "timeToFirstObjectivePressureMs",
    label: "Time To First Pressure (ms)",
    group: "pressure",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.decisionQuality.timeToFirstObjectivePressureMs"),
  },
  {
    key: "meanObjectiveVp",
    label: "Mean Objective VP",
    group: "pressure",
    better: "higher",
    getter: (result) => average(Object.values(result?.metrics?.actorMetrics || {}).map((entry) => entry?.objectiveVp || 0)),
  },
  {
    key: "vpSpreadAbs",
    label: "VP Spread Abs",
    group: "pressure",
    better: "higher",
    getter: (result) => {
      const vp = result?.outcome?.vpByActor || {};
      const values = Object.values(vp).map((value) => Number(value) || 0);
      if (values.length < 2) return 0;
      return Math.abs(values[0] - values[1]);
    },
  },
  {
    key: "contactSearchRate",
    label: "Contact Search",
    group: "recon",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.reconAndSearch.contactSearchRate"),
  },
  {
    key: "reconOwnerSearchRate",
    label: "Recon-Owner Search",
    group: "recon",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.reconAndSearch.reconOwnerSearchRate"),
  },
  {
    key: "contactReacquisitionRate",
    label: "Contact Reacquisition",
    group: "recon",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.reconAndSearch.contactReacquisitionRate"),
  },
  {
    key: "searchEpisodeMs",
    label: "Search Episode (ms)",
    group: "recon",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.reconAndSearch.searchEpisodeMs"),
  },
  {
    key: "combinedArmsRate",
    label: "Combined Arms",
    group: "support",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.humanChallenge.combinedArmsRate"),
  },
  {
    key: "invalidSupportRate",
    label: "Invalid Support",
    group: "support",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.hardInvariants.invalidSupportRate"),
  },
  {
    key: "assaultSupportRatio",
    label: "Assault/Support Ratio",
    group: "support",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.assaultSupportRatio"),
  },
  {
    key: "supportLeash",
    label: "Support Leash",
    group: "support",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.supportLeash"),
  },
  {
    key: "coherenceRate",
    label: "Commander/Director Coherence",
    group: "planning",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.decisionQuality.coherenceRate"),
  },
  {
    key: "executionFidelity",
    label: "Execution Fidelity",
    group: "planning",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.executionFidelity"),
  },
  {
    key: "planCompletionRate",
    label: "Plan Completion",
    group: "planning",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.decisionQuality.planCompletionRate"),
  },
  {
    key: "packageChurnPerMinute",
    label: "Package Churn/Minute",
    group: "planning",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.decisionQuality.packageChurnPerMinute"),
  },
  {
    key: "commandLatencyMs",
    label: "Command Latency (ms)",
    group: "planning",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.commandLatencyMs"),
  },
  {
    key: "stuckUnitRate",
    label: "Stuck Units",
    group: "movement",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.hardInvariants.stuckUnitRate"),
  },
  {
    key: "laneCongestionEventsPerMinute",
    label: "Congestion/Minute",
    group: "movement",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.hardInvariants.laneCongestionEventsPerMinute"),
  },
  {
    key: "frontlineCoverageGapRate",
    label: "Frontline Gap Rate",
    group: "movement",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.frontlineCoverageGapRate"),
  },
  {
    key: "mainEffortCohesion",
    label: "Main Effort Cohesion",
    group: "movement",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.executionAndFormation.mainEffortCohesion"),
  },
  {
    key: "reserveTimingDiscipline",
    label: "Reserve Timing Discipline",
    group: "risk",
    better: "higher",
    getter: (result) => readMetric(result, "metrics.humanChallenge.reserveTimingDiscipline"),
  },
  {
    key: "overcommitmentRate",
    label: "Overcommitment",
    group: "risk",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.decisionQuality.overcommitmentRate"),
  },
  {
    key: "undercommitmentRate",
    label: "Undercommitment",
    group: "risk",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.decisionQuality.undercommitmentRate"),
  },
  {
    key: "deadTaskPursuitRate",
    label: "Dead Task Pursuit",
    group: "risk",
    better: "lower",
    getter: (result) => readMetric(result, "metrics.hardInvariants.deadTaskPursuitRate"),
  },
  {
    key: "meanReserveReleaseAtMs",
    label: "Mean Reserve Release (ms)",
    group: "risk",
    better: "lower",
    getter: (result) => average(Object.values(result?.metrics?.actorMetrics || {}).map((entry) => entry?.reserveReleaseAtMs).filter(Number.isFinite)),
  },
  {
    key: "decisiveOutcomeRate",
    label: "Decisive Outcome",
    group: "outcome",
    better: "higher",
    getter: (result) => Number((result?.outcome?.winner || "draw") !== "draw"),
  },
  {
    key: "timeLimitRate",
    label: "Time Limit",
    group: "outcome",
    better: "lower",
    getter: (result) => Number((result?.outcome?.victoryReason || "none") === "time_limit"),
  },
];

const GROUP_LABELS = {
  pressure: "Pressure And Conversion",
  recon: "Recon And Contact",
  support: "Support And Combined Arms",
  planning: "Planning And Execution",
  movement: "Movement And Frontage",
  risk: "Risk, Reserve, And Sustainment",
  outcome: "Outcome Shape",
};

const PRIORITY_METRICS = [
  "humanChallengeScore",
  "objectivePressureRate",
  "opportunityConversionRate",
  "contactSearchRate",
  "contactReacquisitionRate",
  "combinedArmsRate",
  "invalidSupportRate",
  "stuckUnitRate",
  "overcommitmentRate",
  "decisiveOutcomeRate",
];

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

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function readJsonIfExists(targetPath, fallback) {
  if (!fs.existsSync(targetPath)) return fallback;
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function readMetric(result, pathExpression, fallback = 0) {
  let current = result;
  for (const segment of pathExpression.split(".")) {
    if (current == null || typeof current !== "object" || !(segment in current)) {
      return fallback;
    }
    current = current[segment];
  }
  return Number.isFinite(current) ? current : fallback;
}

function formatSigned(value, digits = 3) {
  const rounded = roundMetric(value, digits);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function metricByKey(metricKey) {
  return METRIC_CATALOG.find((metric) => metric.key === metricKey) || null;
}

function metricGetter(metricKey) {
  return metricByKey(metricKey)?.getter || (() => 0);
}

function buildPairCases(pairLimit = PAIR_COUNT) {
  const cases = [];
  let pairIndex = 0;
  for (let scenarioIndex = 0; scenarioIndex < DEFAULT_SCENARIOS.length; scenarioIndex += 1) {
    const scenarioId = DEFAULT_SCENARIOS[scenarioIndex];
    for (let variant = 0; variant < DEFAULT_PAIR_REPEATS; variant += 1) {
      pairIndex += 1;
      cases.push({
        pairId: `pair_${String(pairIndex).padStart(2, "0")}`,
        pairIndex,
        scenarioId,
        seed: BASE_SEED + (scenarioIndex * 100) + variant,
        scenarioOrdinal: variant + 1,
      });
    }
  }
  return cases.slice(0, pairLimit);
}

function buildTaskId(batchIndex, pair, variantId) {
  return `batch_${String(batchIndex).padStart(2, "0")}_${pair.pairId}_${variantId}`;
}

function buildBatchTasks(batchIndex, batchConfig, pairCases) {
  const treatmentHarness = deepMergeObjects(BASE_RUNTIME_HARNESS, batchConfig.patch || {});
  const controlHarness = deepMergeObjects(BASE_RUNTIME_HARNESS, {});
  const tasks = [];
  for (const pair of pairCases) {
    tasks.push({
      id: buildTaskId(batchIndex, pair, "control"),
      bucketId: "wide_screening_control",
      scenarioId: pair.scenarioId,
      seed: pair.seed,
      profile: "balanced",
      identicalSides: true,
      scenarioScale: "double",
      terrainMode: "expanded_fixture",
      runtimeHarness: controlHarness,
      batchIndex,
    });
    tasks.push({
      id: buildTaskId(batchIndex, pair, "treatment"),
      bucketId: "wide_screening_treatment",
      scenarioId: pair.scenarioId,
      seed: pair.seed,
      profile: "balanced",
      identicalSides: true,
      scenarioScale: "double",
      terrainMode: "expanded_fixture",
      runtimeHarness: treatmentHarness,
      batchIndex,
    });
  }
  return { tasks, controlHarness, treatmentHarness };
}

function buildTaskIndex(pairCases, batchIndex) {
  const taskIndex = {};
  for (const pair of pairCases) {
    taskIndex[buildTaskId(batchIndex, pair, "control")] = { ...pair, variantId: "control" };
    taskIndex[buildTaskId(batchIndex, pair, "treatment")] = { ...pair, variantId: "treatment" };
  }
  return taskIndex;
}

function summarizeVariantMetrics(results) {
  const summary = {};
  for (const metric of METRIC_CATALOG) {
    summary[metric.key] = roundMetric(average(results.map((result) => metric.getter(result))));
  }
  return summary;
}

function buildPairComparisons(results, taskIndex) {
  const grouped = {};
  for (const result of results) {
    const taskMeta = taskIndex[result.taskId];
    if (!taskMeta) continue;
    grouped[taskMeta.pairId] = grouped[taskMeta.pairId] || {
      pairId: taskMeta.pairId,
      pairIndex: taskMeta.pairIndex,
      scenarioId: taskMeta.scenarioId,
      seed: taskMeta.seed,
      control: null,
      treatment: null,
    };
    grouped[taskMeta.pairId][taskMeta.variantId] = result;
  }
  const pairs = [];
  for (const pair of Object.values(grouped)) {
    if (!pair.control || !pair.treatment) continue;
    const controlMetrics = summarizeVariantMetrics([pair.control]);
    const treatmentMetrics = summarizeVariantMetrics([pair.treatment]);
    const deltas = {};
    for (const metric of METRIC_CATALOG) {
      deltas[metric.key] = roundMetric((treatmentMetrics[metric.key] || 0) - (controlMetrics[metric.key] || 0));
    }
    pairs.push({
      pairId: pair.pairId,
      pairIndex: pair.pairIndex,
      scenarioId: pair.scenarioId,
      seed: pair.seed,
      controlTaskId: pair.control.taskId,
      treatmentTaskId: pair.treatment.taskId,
      controlOutcome: pair.control.outcome,
      treatmentOutcome: pair.treatment.outcome,
      controlMetrics,
      treatmentMetrics,
      deltas,
    });
  }
  return pairs.sort((left, right) => left.pairIndex - right.pairIndex);
}

function metricImproved(metric, delta) {
  if (!metric) return false;
  return metric.better === "lower" ? delta < 0 : delta > 0;
}

function summarizePairDeltas(pairs) {
  const deltaMeans = {};
  const improvementRates = {};
  for (const metric of METRIC_CATALOG) {
    const deltas = pairs.map((pair) => pair.deltas[metric.key] || 0);
    deltaMeans[metric.key] = roundMetric(average(deltas));
    improvementRates[metric.key] = pairs.length > 0
      ? roundMetric(average(deltas.map((delta) => Number(metricImproved(metric, delta)))))
      : 0;
  }
  return { deltaMeans, improvementRates };
}

function summarizeScenarioBreakdown(pairs) {
  const grouped = {};
  for (const pair of pairs) {
    grouped[pair.scenarioId] = grouped[pair.scenarioId] || [];
    grouped[pair.scenarioId].push(pair);
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([scenarioId, rows]) => {
      const challengeDelta = roundMetric(average(rows.map((pair) => pair.deltas.humanChallengeScore || 0)));
      const pressureDelta = roundMetric(average(rows.map((pair) => pair.deltas.objectivePressureRate || 0)));
      const combinedDelta = roundMetric(average(rows.map((pair) => pair.deltas.combinedArmsRate || 0)));
      const searchDelta = roundMetric(average(rows.map((pair) => pair.deltas.contactSearchRate || 0)));
      const reacquireDelta = roundMetric(average(rows.map((pair) => pair.deltas.contactReacquisitionRate || 0)));
      const supportDelta = roundMetric(average(rows.map((pair) => pair.deltas.invalidSupportRate || 0)));
      const stuckDelta = roundMetric(average(rows.map((pair) => pair.deltas.stuckUnitRate || 0)));
      return [scenarioId, {
        pairCount: rows.length,
        challengeDelta,
        pressureDelta,
        combinedDelta,
        searchDelta,
        reacquireDelta,
        invalidSupportDelta: supportDelta,
        stuckDelta,
      }];
    })
  );
}

function batchSignalScore(deltaMeans) {
  const scales = {
    humanChallengeScore: 0.1,
    objectivePressureRate: 0.15,
    opportunityConversionRate: 0.15,
    contactSearchRate: 0.2,
    contactReacquisitionRate: 0.15,
    combinedArmsRate: 0.15,
    invalidSupportRate: 0.15,
    stuckUnitRate: 0.15,
    overcommitmentRate: 0.1,
    decisiveOutcomeRate: 0.05,
  };
  let score = 0;
  for (const [key, scale] of Object.entries(scales)) {
    score += Math.abs((deltaMeans[key] || 0) / scale);
  }
  return roundMetric(score, 2);
}

function batchPromiseScore(deltaMeans) {
  const score = (
    (deltaMeans.humanChallengeScore || 0) * 2.6
    + (deltaMeans.objectivePressureRate || 0) * 2.2
    + (deltaMeans.opportunityConversionRate || 0) * 1.8
    + (deltaMeans.contactReacquisitionRate || 0) * 1.8
    + (deltaMeans.contactSearchRate || 0) * 1.2
    + (deltaMeans.combinedArmsRate || 0) * 1.5
    - (deltaMeans.invalidSupportRate || 0) * 1.7
    - (deltaMeans.stuckUnitRate || 0) * 1.3
    - (deltaMeans.overcommitmentRate || 0) * 1.2
    - (deltaMeans.undercommitmentRate || 0) * 0.8
    + (deltaMeans.decisiveOutcomeRate || 0) * 1.4
    - (deltaMeans.timeLimitRate || 0) * 0.8
  );
  return roundMetric(score, 3);
}

function topMetricDeltaText(deltaMeans, keys, desired = "improved", count = 3) {
  return keys
    .map((key) => ({ key, value: deltaMeans[key] || 0, metric: metricByKey(key) }))
    .filter((entry) => Math.abs(entry.value) > 0.001)
    .filter((entry) => {
      const improved = metricImproved(entry.metric, entry.value);
      return desired === "improved" ? improved : !improved;
    })
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, count)
    .map((entry) => `${entry.metric?.label || entry.key} ${formatSigned(entry.value)}`);
}

function deriveBatchObservations(batchConfig, treatmentMeans, controlMeans, deltaMeans) {
  const observations = [];
  const reconUp = (deltaMeans.contactSearchRate || 0) > 0.08 || (deltaMeans.contactReacquisitionRate || 0) > 0.05;
  const supportUp = (deltaMeans.combinedArmsRate || 0) > 0.05 && (deltaMeans.invalidSupportRate || 0) < -0.05;
  const pressureUp = (deltaMeans.objectivePressureRate || 0) > 0.05 || (deltaMeans.opportunityConversionRate || 0) > 0.04;
  const movementUp = (deltaMeans.stuckUnitRate || 0) < -0.04 || (deltaMeans.frontlineCoverageGapRate || 0) < -0.04;
  const riskWorse = (deltaMeans.overcommitmentRate || 0) > 0.03 || (deltaMeans.invalidSupportRate || 0) > 0.05;
  const noDecisionChange = Math.abs(deltaMeans.decisiveOutcomeRate || 0) < 0.01 && treatmentMeans.timeLimitRate >= controlMeans.timeLimitRate;

  if (reconUp && !supportUp && (deltaMeans.combinedArmsRate || 0) < -0.05) {
    observations.push("Recon/contact activity rose, but it still traded directly against combined-arms integration.");
  }
  if (supportUp && (deltaMeans.contactReacquisitionRate || 0) < -0.03) {
    observations.push("Support cohesion improved, but the branch paid for it by losing contact continuity.");
  }
  if (pressureUp && noDecisionChange) {
    observations.push("The batch created more pressure without converting that pressure into decisive outcomes.");
  }
  if (movementUp && (deltaMeans.objectivePressureRate || 0) > 0) {
    observations.push("Cleaner movement helped pressure rather than slowing the force down, which makes this branch worth revisiting.");
  }
  if (riskWorse) {
    observations.push("The treatment pushed at least one important risk signal in the wrong direction, so any follow-on should pair it with brakes.");
  }
  if ((deltaMeans.humanChallengeScore || 0) > 0.03 && (deltaMeans.invalidSupportRate || 0) <= 0.01 && (deltaMeans.stuckUnitRate || 0) <= 0.01) {
    observations.push("This is one of the cleaner challenge lifts because it did not buy pressure with obviously worse legality or mobility.");
  }
  if (observations.length === 0) {
    observations.push(`The ${batchConfig.label} shock moved the system, but the signal was mixed rather than dominated by one clean effect.`);
  }
  return observations;
}

function summarizeBatch(batchConfig, results, pairCases, taskIndex) {
  const controlResults = [];
  const treatmentResults = [];
  for (const result of results) {
    const taskMeta = taskIndex[result.taskId];
    if (!taskMeta) continue;
    if (taskMeta.variantId === "control") controlResults.push(result);
    else treatmentResults.push(result);
  }
  const controlMeans = summarizeVariantMetrics(controlResults);
  const treatmentMeans = summarizeVariantMetrics(treatmentResults);
  const pairs = buildPairComparisons(results, taskIndex);
  const { deltaMeans, improvementRates } = summarizePairDeltas(pairs);
  const scenarioBreakdown = summarizeScenarioBreakdown(pairs);
  const observations = deriveBatchObservations(batchConfig, treatmentMeans, controlMeans, deltaMeans);

  return {
    completedRuns: results.length,
    pairCount: pairs.length,
    controlMeans,
    treatmentMeans,
    deltaMeans,
    improvementRates,
    signalScore: batchSignalScore(deltaMeans),
    promiseScore: batchPromiseScore(deltaMeans),
    scenarioBreakdown,
    observations,
    pairs,
    strongestShifts: {
      positive: topMetricDeltaText(deltaMeans, PRIORITY_METRICS, "improved", 3),
      negative: topMetricDeltaText(deltaMeans, PRIORITY_METRICS, "degraded", 3),
    },
  };
}

function renderMetricTable(controlMeans, treatmentMeans, deltaMeans, metricKeys) {
  const lines = [
    "| Metric | Control | Treatment | Delta |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const key of metricKeys) {
    const metric = metricByKey(key);
    if (!metric) continue;
    lines.push(`| ${metric.label} | ${controlMeans[key] ?? 0} | ${treatmentMeans[key] ?? 0} | ${formatSigned(deltaMeans[key] ?? 0)} |`);
  }
  return lines.join("\n");
}

function renderScenarioTable(scenarioBreakdown) {
  const lines = [
    "| Scenario | Challenge Delta | Pressure Delta | Search Delta | Reacq Delta | Combined Delta | Invalid Support Delta | Stuck Delta |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [scenarioId, entry] of Object.entries(scenarioBreakdown || {})) {
    lines.push(`| ${scenarioId} | ${formatSigned(entry.challengeDelta)} | ${formatSigned(entry.pressureDelta)} | ${formatSigned(entry.searchDelta)} | ${formatSigned(entry.reacquireDelta)} | ${formatSigned(entry.combinedDelta)} | ${formatSigned(entry.invalidSupportDelta)} | ${formatSigned(entry.stuckDelta)} |`);
  }
  return lines.join("\n");
}

function renderBatchReport(record) {
  const groupOrder = ["pressure", "recon", "support", "planning", "movement", "risk", "outcome"];
  const lines = [
    `# Batch ${record.batchIndex} of ${TOTAL_BATCHES}: ${record.label}`,
    "",
    `- Focus: ${record.id}`,
    `- Touched systems: ${(record.touchedSystems || []).join(", ")}`,
    `- Expected effect: ${record.expectedEffect}`,
    `- Completed runs: ${record.summary.completedRuns}`,
    `- Pair count: ${record.summary.pairCount}`,
    `- Signal score: ${record.summary.signalScore}`,
    `- Promise score: ${record.summary.promiseScore}`,
    "",
    "## Observations",
    "",
    ...(record.summary.observations || []).map((observation) => `- ${observation}`),
    "",
    "## Pair Signal",
    "",
    `- Strongest positive shifts: ${(record.summary.strongestShifts?.positive || []).join("; ") || "none"}`,
    `- Strongest negative shifts: ${(record.summary.strongestShifts?.negative || []).join("; ") || "none"}`,
    "",
  ];

  for (const groupId of groupOrder) {
    const metricKeys = METRIC_CATALOG.filter((metric) => metric.group === groupId).map((metric) => metric.key);
    if (metricKeys.length === 0) continue;
    lines.push(`## ${GROUP_LABELS[groupId] || groupId}`);
    lines.push("");
    lines.push(renderMetricTable(record.summary.controlMeans, record.summary.treatmentMeans, record.summary.deltaMeans, metricKeys));
    lines.push("");
  }

  lines.push("## Scenario Breakdown");
  lines.push("");
  lines.push(renderScenarioTable(record.summary.scenarioBreakdown));
  lines.push("");
  return lines.join("\n");
}

function appendExperimentLog(campaignDir, record) {
  const logMdPath = path.join(campaignDir, "experiment-log.md");
  const logJsonlPath = path.join(campaignDir, "experiment-log.jsonl");
  const lines = [
    `## Batch ${record.batchIndex}: ${record.label}`,
    "",
    `- Focus: ${record.id}`,
    `- Touched systems: ${(record.touchedSystems || []).join(", ")}`,
    `- Expected effect: ${record.expectedEffect}`,
    `- Signal score: ${record.summary.signalScore}`,
    `- Promise score: ${record.summary.promiseScore}`,
    `- Human challenge delta: ${formatSigned(record.summary.deltaMeans.humanChallengeScore)}`,
    `- Objective pressure delta: ${formatSigned(record.summary.deltaMeans.objectivePressureRate)}`,
    `- Combined-arms delta: ${formatSigned(record.summary.deltaMeans.combinedArmsRate)}`,
    `- Contact search delta: ${formatSigned(record.summary.deltaMeans.contactSearchRate)}`,
    `- Contact reacquisition delta: ${formatSigned(record.summary.deltaMeans.contactReacquisitionRate)}`,
    `- Invalid support delta: ${formatSigned(record.summary.deltaMeans.invalidSupportRate)}`,
    `- Stuck-unit delta: ${formatSigned(record.summary.deltaMeans.stuckUnitRate)}`,
    "",
    ...(record.summary.observations || []).map((observation) => `- ${observation}`),
    "",
  ];
  fs.appendFileSync(logMdPath, `${lines.join("\n")}\n`);
  fs.appendFileSync(logJsonlPath, `${JSON.stringify(record)}\n`);
}

function parseArgs(argv) {
  let campaignDir = null;
  let workerCount = DEFAULT_WORKERS;
  let batchLimit = null;
  let pairLimit = PAIR_COUNT;
  let reportOnly = false;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--campaign-dir" && argv[index + 1]) {
      campaignDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--workers" && argv[index + 1]) {
      workerCount = Math.max(1, Number.parseInt(String(argv[index + 1]), 10) || DEFAULT_WORKERS);
      index += 1;
    } else if (arg === "--batch-limit" && argv[index + 1]) {
      batchLimit = Math.max(1, Math.min(TOTAL_BATCHES, Number.parseInt(String(argv[index + 1]), 10) || TOTAL_BATCHES));
      index += 1;
    } else if (arg === "--pair-limit" && argv[index + 1]) {
      pairLimit = Math.max(1, Math.min(PAIR_COUNT, Number.parseInt(String(argv[index + 1]), 10) || PAIR_COUNT));
      index += 1;
    } else if (arg === "--report-only") {
      reportOnly = true;
    }
  }
  return { campaignDir, workerCount, batchLimit, pairLimit, reportOnly };
}

function initializeCampaignDir(campaignDir, pairLimit) {
  ensureDir(campaignDir);
  const statePath = path.join(campaignDir, "campaign-state.json");
  if (fs.existsSync(statePath)) return statePath;
  const initialState = {
    runId: path.basename(campaignDir),
    createdAt: new Date().toISOString(),
    totalBatches: TOTAL_BATCHES,
    pairLimit,
    pairCases: buildPairCases(pairLimit),
    baselineRuntimeHarness: BASE_RUNTIME_HARNESS,
    batches: BATCH_CATALOG.map((batch, index) => ({
      batchIndex: index + 1,
      id: batch.id,
      label: batch.label,
      expectedEffect: batch.expectedEffect,
      touchedSystems: batch.touchedSystems,
    })),
    history: [],
  };
  writeJson(statePath, initialState);
  writeMarkdown(
    path.join(campaignDir, "experiment-log.md"),
    `# RTS Wide Screening Campaign\n\n- Created at: ${initialState.createdAt}\n- Total batches: ${TOTAL_BATCHES}\n- Pair count per batch: ${pairLimit}\n`
  );
  return statePath;
}

function scoreBatchRecord(record) {
  return {
    batchIndex: record.batchIndex,
    id: record.id,
    label: record.label,
    signalScore: record.summary?.signalScore || 0,
    promiseScore: record.summary?.promiseScore || 0,
    deltaMeans: record.summary?.deltaMeans || {},
    observations: record.summary?.observations || [],
  };
}

function rankBatchRecords(records) {
  return [...records]
    .map(scoreBatchRecord)
    .sort((left, right) => {
      if (Math.abs((right.promiseScore || 0) - (left.promiseScore || 0)) > 0.001) {
        return (right.promiseScore || 0) - (left.promiseScore || 0);
      }
      return (right.signalScore || 0) - (left.signalScore || 0);
    });
}

function findBatchWithBestDelta(records, metricKey, desired = "best") {
  const metric = metricByKey(metricKey);
  if (!metric) return null;
  const sorted = [...records].sort((left, right) => {
    const leftValue = left.summary?.deltaMeans?.[metricKey] || 0;
    const rightValue = right.summary?.deltaMeans?.[metricKey] || 0;
    if (metric.better === "lower") {
      return desired === "best" ? leftValue - rightValue : rightValue - leftValue;
    }
    return desired === "best" ? rightValue - leftValue : leftValue - rightValue;
  });
  return sorted[0] || null;
}

function countCleanLifts(records) {
  return records.filter((record) => (
    (record.summary?.deltaMeans?.humanChallengeScore || 0) > 0.02
    && (record.summary?.deltaMeans?.invalidSupportRate || 0) <= 0.02
    && (record.summary?.deltaMeans?.stuckUnitRate || 0) <= 0.02
  )).length;
}

function renderWideFindingsReport(state) {
  const history = state.history || [];
  const ranked = rankBatchRecords(history);
  const topPromise = ranked.slice(0, 3);
  const topSignal = [...ranked].sort((left, right) => (right.signalScore || 0) - (left.signalScore || 0)).slice(0, 3);
  const bestChallenge = findBatchWithBestDelta(history, "humanChallengeScore", "best");
  const bestPressure = findBatchWithBestDelta(history, "objectivePressureRate", "best");
  const bestConversion = findBatchWithBestDelta(history, "opportunityConversionRate", "best");
  const bestCombined = findBatchWithBestDelta(history, "combinedArmsRate", "best");
  const bestSearch = findBatchWithBestDelta(history, "contactSearchRate", "best");
  const bestReacq = findBatchWithBestDelta(history, "contactReacquisitionRate", "best");
  const bestSupportReduction = findBatchWithBestDelta(history, "invalidSupportRate", "best");
  const bestMovementReduction = findBatchWithBestDelta(history, "stuckUnitRate", "best");
  const cleanLifts = countCleanLifts(history);
  const meanTimeLimitDelta = roundMetric(average(history.map((record) => record.summary?.deltaMeans?.timeLimitRate || 0)));
  const meanDecisiveDelta = roundMetric(average(history.map((record) => record.summary?.deltaMeans?.decisiveOutcomeRate || 0)));
  const meanReconOwnerDelta = roundMetric(average(history.map((record) => record.summary?.deltaMeans?.reconOwnerSearchRate || 0)));

  const lines = [
    "# Wide Findings Deep Dive",
    "",
    `- Campaign: ${state.runId}`,
    `- Completed batches: ${history.length}/${TOTAL_BATCHES}`,
    `- Pair count per batch: ${state.pairLimit || PAIR_COUNT}`,
    `- Total runs: ${(state.pairLimit || PAIR_COUNT) * 2 * history.length}`,
    "",
    "## Executive Read",
    "",
    `- The first ${history.length} screening batches produced ${cleanLifts} clean challenge lifts, which means most subsystem shocks still carry a visible tradeoff instead of a free improvement.`,
    `- Mean decisive-outcome delta across the screen was ${formatSigned(meanDecisiveDelta)}, while mean time-limit delta was ${formatSigned(meanTimeLimitDelta)}. The main ceiling is still conversion, not mere activity.`,
    `- Mean recon-owner-search delta was ${formatSigned(meanReconOwnerDelta)}, which is the clearest sign that the current harness can stress recon behavior but still cannot create a true recon-owner loop on its own.`,
    "",
    "## Strongest Positive Signals",
    "",
    `- Best challenge lift: ${bestChallenge ? `Batch ${bestChallenge.batchIndex} (${bestChallenge.label}) at ${formatSigned(bestChallenge.summary?.deltaMeans?.humanChallengeScore || 0)}` : "n/a"}`,
    `- Best pressure lift: ${bestPressure ? `Batch ${bestPressure.batchIndex} (${bestPressure.label}) at ${formatSigned(bestPressure.summary?.deltaMeans?.objectivePressureRate || 0)}` : "n/a"}`,
    `- Best opportunity-conversion lift: ${bestConversion ? `Batch ${bestConversion.batchIndex} (${bestConversion.label}) at ${formatSigned(bestConversion.summary?.deltaMeans?.opportunityConversionRate || 0)}` : "n/a"}`,
    `- Best combined-arms lift: ${bestCombined ? `Batch ${bestCombined.batchIndex} (${bestCombined.label}) at ${formatSigned(bestCombined.summary?.deltaMeans?.combinedArmsRate || 0)}` : "n/a"}`,
    `- Best search lift: ${bestSearch ? `Batch ${bestSearch.batchIndex} (${bestSearch.label}) at ${formatSigned(bestSearch.summary?.deltaMeans?.contactSearchRate || 0)}` : "n/a"}`,
    `- Best reacquisition lift: ${bestReacq ? `Batch ${bestReacq.batchIndex} (${bestReacq.label}) at ${formatSigned(bestReacq.summary?.deltaMeans?.contactReacquisitionRate || 0)}` : "n/a"}`,
    `- Best support-legality improvement: ${bestSupportReduction ? `Batch ${bestSupportReduction.batchIndex} (${bestSupportReduction.label}) at ${formatSigned(bestSupportReduction.summary?.deltaMeans?.invalidSupportRate || 0)}` : "n/a"}`,
    `- Best stuck-unit reduction: ${bestMovementReduction ? `Batch ${bestMovementReduction.batchIndex} (${bestMovementReduction.label}) at ${formatSigned(bestMovementReduction.summary?.deltaMeans?.stuckUnitRate || 0)}` : "n/a"}`,
    "",
    "## Broad Themes",
    "",
  ];

  if (bestSearch && bestCombined && bestSearch.batchIndex !== bestCombined.batchIndex) {
    lines.push(`- Search and combined-arms quality still peak in different branches: ${bestSearch.label} moved recon/contact best, while ${bestCombined.label} moved integrated fighting best.`);
  }
  if (bestPressure && bestConversion && bestPressure.batchIndex === bestConversion.batchIndex) {
    lines.push(`- ${bestPressure.label} was the cleanest pressure-and-conversion branch, which makes it a strong candidate for follow-on interaction testing.`);
  } else {
    lines.push("- Pressure and conversion did not fully align inside one subsystem shock, which argues for a second-stage interaction campaign rather than another one-axis sweep.");
  }
  if (meanDecisiveDelta <= 0.01) {
    lines.push("- No subsystem shock materially changed decisiveness. The screen widened the information set, but it did not solve finish behavior by itself.");
  }
  if (meanReconOwnerDelta <= 0.01) {
    lines.push("- Recon-owner behavior remained effectively flat across the screening set. That is a structural telemetry result, not just a tuning disappointment.");
  }
  lines.push("");
  lines.push("## Highest-Value Batches");
  lines.push("");
  lines.push("| Rank | Batch | Promise | Signal | Challenge Δ | Pressure Δ | Search Δ | Reacq Δ | Combined Δ | Invalid Support Δ | Stuck Δ |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (let index = 0; index < topPromise.length; index += 1) {
    const entry = topPromise[index];
    const deltas = entry.deltaMeans || {};
    lines.push(`| ${index + 1} | Batch ${entry.batchIndex} ${entry.label} | ${entry.promiseScore} | ${entry.signalScore} | ${formatSigned(deltas.humanChallengeScore || 0)} | ${formatSigned(deltas.objectivePressureRate || 0)} | ${formatSigned(deltas.contactSearchRate || 0)} | ${formatSigned(deltas.contactReacquisitionRate || 0)} | ${formatSigned(deltas.combinedArmsRate || 0)} | ${formatSigned(deltas.invalidSupportRate || 0)} | ${formatSigned(deltas.stuckUnitRate || 0)} |`);
  }
  lines.push("");
  lines.push("## Widest Information Batches");
  lines.push("");
  lines.push("| Rank | Batch | Signal | Promise | Key read |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  for (let index = 0; index < topSignal.length; index += 1) {
    const entry = topSignal[index];
    lines.push(`| ${index + 1} | Batch ${entry.batchIndex} ${entry.label} | ${entry.signalScore} | ${entry.promiseScore} | ${(entry.observations || []).slice(0, 1).join(" ") || "mixed signal"} |`);
  }
  lines.push("");
  lines.push("## Batch Notes");
  lines.push("");
  for (const record of history) {
    lines.push(`### Batch ${record.batchIndex}: ${record.label}`);
    lines.push("");
    lines.push(`- Focus: ${record.id}`);
    lines.push(`- Touched systems: ${(record.touchedSystems || []).join(", ")}`);
    lines.push(`- Promise score: ${record.summary?.promiseScore || 0}`);
    lines.push(`- Signal score: ${record.summary?.signalScore || 0}`);
    lines.push(`- Priority deltas: challenge ${formatSigned(record.summary?.deltaMeans?.humanChallengeScore || 0)}, pressure ${formatSigned(record.summary?.deltaMeans?.objectivePressureRate || 0)}, search ${formatSigned(record.summary?.deltaMeans?.contactSearchRate || 0)}, reacq ${formatSigned(record.summary?.deltaMeans?.contactReacquisitionRate || 0)}, combined ${formatSigned(record.summary?.deltaMeans?.combinedArmsRate || 0)}, invalid support ${formatSigned(record.summary?.deltaMeans?.invalidSupportRate || 0)}, stuck ${formatSigned(record.summary?.deltaMeans?.stuckUnitRate || 0)}`);
    for (const observation of record.summary?.observations || []) {
      lines.push(`- ${observation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderFollowOnPlanReport(state) {
  const history = state.history || [];
  const ranked = rankBatchRecords(history);
  const topThree = ranked.slice(0, 3);
  const bestSearch = findBatchWithBestDelta(history, "contactReacquisitionRate", "best");
  const bestCombined = findBatchWithBestDelta(history, "combinedArmsRate", "best");
  const bestSupport = findBatchWithBestDelta(history, "invalidSupportRate", "best");
  const bestMovement = findBatchWithBestDelta(history, "stuckUnitRate", "best");
  const bestPressure = findBatchWithBestDelta(history, "objectivePressureRate", "best");

  const lines = [
    "# Additional Test Strategy",
    "",
    `- Based on: ${state.runId}`,
    `- Completed screening batches: ${history.length}/${TOTAL_BATCHES}`,
    "",
    "## Goal",
    "",
    "- Use the next test block to turn the widest-screen information into a narrower set of interaction tests that move the AI toward playing with intelligence and presenting a challenge to a human player.",
    "",
    "## What To Keep",
    "",
    "- Keep the matched A/B pair structure: 25 case pairs per batch, same seed and scenario on control and treatment.",
    "- Keep the same frozen control harness through the whole next block so every interaction remains attributable.",
    "- Keep the five-scenario large-map mix because it touched recon, pressure, sustainment, mobility, and encirclement behavior in one compact suite.",
    "- Keep the wider metric watchlist, especially the pressure, recon, support, movement, and outcome groups.",
    "",
    "## What To Change",
    "",
    "- Stop testing one isolated subsystem at a time after this checkpoint. The wide screen already told us which directions carry signal.",
    "- Spend the next block on interaction tests that deliberately combine the most promising pressure/recon ideas with the best braking mechanisms from support and mobility branches.",
    "- Add one fixed duplicate-seed control pair inside each future batch so replay stability and opening stability stay visible during heavier interaction work.",
    "",
    "## Recommended Additional-Test Sequence",
    "",
    "1. Interaction Batches",
    `Use the top 2-3 branches as building blocks: ${topThree.map((entry) => `Batch ${entry.batchIndex} ${entry.label}`).join(", ") || "top screening branches"}.`,
    `First interaction targets should include ${bestSearch ? bestSearch.label : "the best recon/contact branch"} + ${bestCombined ? bestCombined.label : "the best combined-arms branch"} and ${bestPressure ? bestPressure.label : "the best pressure branch"} + ${bestSupport ? bestSupport.label : "the best support-legality branch"}.`,
    "2. Brake Batches",
    `Pair the strongest pressure-raising branch with the best stabilizers from ${bestSupport ? bestSupport.label : "support"} and ${bestMovement ? bestMovement.label : "movement"} so we can see whether pressure can stay high without legality and mobility collapsing.`,
    "3. Failure-Discovery Batches",
    "After a promising interaction appears, deliberately overheat it with higher temperature, lower reserve patience, or wider flank bias so we can see where the AI starts looking unintelligent.",
    "4. Confirmation Batches",
    "Only after one or two interactions look clean should we spend larger volume on confirmation runs and mirrored checks.",
    "",
    "## Suggested Next 8-10 Batches",
    "",
    "- Batch A: best recon/contact branch + best support-legality branch",
    "- Batch B: best pressure branch + best movement/frontage branch",
    "- Batch C: best conversion branch + best reserve/defeat-in-detail branch",
    "- Batch D: best promising trio combined at conservative temperature",
    "- Batch E: same as D but hotter variation to test robustness",
    "- Batch F: same as D but stricter support gating and lower overcommit tolerance",
    "- Batch G: same as D but with mobility/frontage brakes removed to reveal hidden dependence",
    "- Batch H: best clean interaction rerun on alternate seed family",
    "- Batch I: best clean interaction rerun with mirrored sides",
    "- Batch J: fixed control vs winning interaction confirmation batch",
    "",
    "## Telemetry Additions Before The Next Block",
    "",
    "- Add explicit recon-owner tasking telemetry, because the wide screen still shows that recon-owner search barely moves.",
    "- Add contact-to-support handoff timing, so we can tell whether contact is merely found or actually converted into supported maneuver.",
    "- Add objective conversion stages: contested, entered, secured, and held long enough to score.",
    "- Add reserve commit reasons and overcommit trigger reasons, so pressure and recklessness stop hiding inside the same averages.",
    "",
    "## Decision Rules",
    "",
    "- Promote a branch only if human challenge, pressure, or conversion rises without clearly worse invalid-support and stuck-unit rates.",
    "- Kill a branch quickly if it raises search and pressure but drives combined-arms quality or legality sharply downward.",
    "- Treat any branch that still leaves decisive-outcome rate flat after improving pressure as a conversion problem, not a final answer.",
    "",
    "## Expected Outcome",
    "",
    "- The next block should stop asking \"which subsystem matters?\" and start answering \"which combination produces pressure, coherent fighting, and fewer obviously dumb failures at the same time?\"",
    "",
  ];

  return lines.join("\n");
}

function writeCampaignReports(campaignDir, state) {
  const findingsReportPath = path.join(campaignDir, "wide-findings-report.md");
  const followOnReportPath = path.join(campaignDir, "additional-test-strategy.md");
  writeMarkdown(findingsReportPath, renderWideFindingsReport(state));
  writeMarkdown(followOnReportPath, renderFollowOnPlanReport(state));
  return { findingsReportPath, followOnReportPath };
}

async function runCampaign() {
  const { campaignDir: requestedCampaignDir, workerCount, batchLimit, pairLimit, reportOnly } = parseArgs(process.argv);
  const campaignDir = requestedCampaignDir || path.join(SCREENING_ROOT, makeRunId("rts-wide-screen"));
  const statePath = initializeCampaignDir(campaignDir, pairLimit);
  const state = readJsonIfExists(statePath, null);
  if (!state) {
    throw new Error(`Failed to load campaign state at ${statePath}`);
  }

  if (!Array.isArray(state.pairCases) || state.pairCases.length === 0) {
    state.pairCases = buildPairCases(pairLimit);
  }

  if (!reportOnly) {
    const remaining = TOTAL_BATCHES - (state.history?.length || 0);
    const batchesToRun = Math.min(batchLimit || remaining, remaining);
    for (let offset = 0; offset < batchesToRun; offset += 1) {
      const batchIndex = (state.history?.length || 0) + 1;
      const batchConfig = BATCH_CATALOG[batchIndex - 1];
      if (!batchConfig) break;

      const batchDir = path.join(campaignDir, `batch-${String(batchIndex).padStart(2, "0")}`);
      ensureDir(batchDir);
      const { tasks, controlHarness, treatmentHarness } = buildBatchTasks(batchIndex, batchConfig, state.pairCases);
      const taskIndex = buildTaskIndex(state.pairCases, batchIndex);
      const pairDetailPath = path.join(batchDir, "pair-analysis.json");
      writeJson(path.join(batchDir, "config.json"), {
        batchIndex,
        ...batchConfig,
        controlHarness,
        treatmentHarness,
        pairCases: state.pairCases,
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

      const summary = summarizeBatch(batchConfig, results, state.pairCases, taskIndex);
      const pairRows = summary.pairs || [];
      const summaryForRecord = {
        ...summary,
      };
      delete summaryForRecord.pairs;
      const record = {
        batchIndex,
        id: batchConfig.id,
        label: batchConfig.label,
        expectedEffect: batchConfig.expectedEffect,
        touchedSystems: batchConfig.touchedSystems,
        summary: summaryForRecord,
        configPath: path.join(batchDir, "config.json"),
        resultsPath: path.join(batchDir, "results.json"),
        pairDetailPath,
        reportPath: path.join(batchDir, "report.md"),
        summaryPath: path.join(batchDir, "summary.json"),
      };

      writeJson(path.join(batchDir, "results.json"), results);
      writeJson(pairDetailPath, pairRows);
      writeJson(path.join(batchDir, "summary.json"), record);
      writeMarkdown(path.join(batchDir, "report.md"), renderBatchReport(record));
      appendExperimentLog(campaignDir, record);

      state.history = [...(state.history || []), record];
      state.lastUpdatedAt = new Date().toISOString();
      writeJson(statePath, state);

      console.log(`[wide-screen] campaign_dir=${campaignDir}`);
      console.log(`[wide-screen] batch=${batchIndex}/${TOTAL_BATCHES}`);
      console.log(`[wide-screen] summary=${record.summaryPath}`);
    }
  }

  const reportPaths = writeCampaignReports(campaignDir, state);
  console.log(`[wide-screen] findings_report=${reportPaths.findingsReportPath}`);
  console.log(`[wide-screen] follow_on_report=${reportPaths.followOnReportPath}`);
}

const isEntrypoint = !!process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isEntrypoint) {
  runCampaign().catch((error) => {
    console.error(`[wide-screen] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
