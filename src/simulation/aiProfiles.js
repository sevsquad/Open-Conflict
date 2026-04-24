const PROFILE_CATALOG = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "Combined-arms posture that pressures VP hexes while avoiding reckless exposure.",
    aggression: 0.56,
    defenseBias: 0.52,
    vpFocus: 1.0,
    reserveRatio: 0.24,
    acceptableForceRatio: 0.95,
    dangerTolerance: 0.48,
    threatPenalty: 0.9,
    supportBias: 0.9,
    artilleryBias: 1.0,
    reconBias: 0.95,
    routeRiskBias: 0.72,
    fallbackBias: 0.55,
    salientTolerance: 0.45,
    encirclementAversion: 0.62,
    frontageDiscipline: 0.66,
    neutralZoneOpportunism: 0.54,
    rearSecurityBias: 0.58,
    reservePatience: 0.56,
    supportByFireBias: 0.62,
    trafficTolerance: 0.42,
    counterattackBias: 0.5,
    pocketReliefBias: 0.52,
    breakthroughExploitation: 0.56,
    terrainRiskBias: 0.5,
    urbanBias: 0.0,
    roughTerrainBias: 0.0,
    openTerrainBias: 0.0,
    scarceAssetConservation: 0.7,
    objectivePersistence: 0.62,
    terrainPreferences: {
      urban: 0.08,
      rough: 0.08,
      forest: 0.06,
      open: 0.0,
      wet: -0.2,
      mountain: -0.15,
      bridge: 0.2,
    },
  },
  aggressive_breakthrough: {
    id: "aggressive_breakthrough",
    label: "Aggressive Breakthrough",
    description: "Masses combat power against a main effort and commits reserves early if a seam appears.",
    aggression: 0.84,
    defenseBias: 0.28,
    vpFocus: 1.15,
    reserveRatio: 0.14,
    acceptableForceRatio: 0.78,
    dangerTolerance: 0.78,
    threatPenalty: 0.52,
    supportBias: 1.05,
    artilleryBias: 1.1,
    reconBias: 0.9,
    routeRiskBias: 1.2,
    fallbackBias: 0.18,
    salientTolerance: 0.82,
    encirclementAversion: 0.28,
    frontageDiscipline: 0.32,
    neutralZoneOpportunism: 0.64,
    rearSecurityBias: 0.28,
    reservePatience: 0.24,
    supportByFireBias: 0.48,
    trafficTolerance: 0.84,
    counterattackBias: 0.42,
    pocketReliefBias: 0.34,
    breakthroughExploitation: 0.88,
    terrainRiskBias: 0.78,
    urbanBias: -0.05,
    roughTerrainBias: -0.12,
    openTerrainBias: 0.12,
    scarceAssetConservation: 0.45,
    objectivePersistence: 0.82,
    terrainPreferences: {
      urban: -0.04,
      rough: -0.08,
      forest: -0.04,
      open: 0.12,
      wet: -0.28,
      mountain: -0.32,
      bridge: 0.26,
    },
  },
  cautious_defender: {
    id: "cautious_defender",
    label: "Cautious Defender",
    description: "Preserves combat power, prioritizes mutual support, and prefers strong defensive terrain.",
    aggression: 0.28,
    defenseBias: 0.88,
    vpFocus: 0.95,
    reserveRatio: 0.34,
    acceptableForceRatio: 1.22,
    dangerTolerance: 0.22,
    threatPenalty: 1.18,
    supportBias: 1.08,
    artilleryBias: 0.96,
    reconBias: 0.9,
    routeRiskBias: 0.5,
    fallbackBias: 0.94,
    salientTolerance: 0.18,
    encirclementAversion: 0.9,
    frontageDiscipline: 0.84,
    neutralZoneOpportunism: 0.34,
    rearSecurityBias: 0.82,
    reservePatience: 0.86,
    supportByFireBias: 0.74,
    trafficTolerance: 0.22,
    counterattackBias: 0.38,
    pocketReliefBias: 0.7,
    breakthroughExploitation: 0.28,
    terrainRiskBias: 0.26,
    urbanBias: 0.08,
    roughTerrainBias: 0.18,
    openTerrainBias: -0.1,
    scarceAssetConservation: 0.92,
    objectivePersistence: 0.45,
    terrainPreferences: {
      urban: 0.12,
      rough: 0.18,
      forest: 0.16,
      open: -0.14,
      wet: -0.12,
      mountain: 0.02,
      bridge: 0.08,
    },
  },
  rough_terrain_flanker: {
    id: "rough_terrain_flanker",
    label: "Rough Terrain Flanker",
    description: "Prefers concealment, broken terrain, and alternate axes that avoid the obvious main road.",
    aggression: 0.62,
    defenseBias: 0.44,
    vpFocus: 1.02,
    reserveRatio: 0.22,
    acceptableForceRatio: 0.88,
    dangerTolerance: 0.58,
    threatPenalty: 0.76,
    supportBias: 0.92,
    artilleryBias: 0.92,
    reconBias: 1.1,
    routeRiskBias: 0.84,
    fallbackBias: 0.48,
    salientTolerance: 0.58,
    encirclementAversion: 0.44,
    frontageDiscipline: 0.74,
    neutralZoneOpportunism: 0.7,
    rearSecurityBias: 0.44,
    reservePatience: 0.52,
    supportByFireBias: 0.58,
    trafficTolerance: 0.34,
    counterattackBias: 0.54,
    pocketReliefBias: 0.48,
    breakthroughExploitation: 0.66,
    terrainRiskBias: 0.62,
    urbanBias: -0.06,
    roughTerrainBias: 0.3,
    openTerrainBias: -0.18,
    scarceAssetConservation: 0.68,
    objectivePersistence: 0.68,
    terrainPreferences: {
      urban: -0.04,
      rough: 0.28,
      forest: 0.22,
      open: -0.18,
      wet: -0.08,
      mountain: 0.1,
      bridge: 0.1,
    },
  },
  urban_grinder: {
    id: "urban_grinder",
    label: "Urban Grinder",
    description: "Methodically closes on towns and built-up hexes, using artillery and mutual support to wear defenders down.",
    aggression: 0.6,
    defenseBias: 0.56,
    vpFocus: 1.08,
    reserveRatio: 0.2,
    acceptableForceRatio: 1.02,
    dangerTolerance: 0.46,
    threatPenalty: 0.84,
    supportBias: 1.06,
    artilleryBias: 1.18,
    reconBias: 0.86,
    routeRiskBias: 0.64,
    fallbackBias: 0.42,
    salientTolerance: 0.38,
    encirclementAversion: 0.58,
    frontageDiscipline: 0.62,
    neutralZoneOpportunism: 0.42,
    rearSecurityBias: 0.52,
    reservePatience: 0.58,
    supportByFireBias: 0.82,
    trafficTolerance: 0.36,
    counterattackBias: 0.46,
    pocketReliefBias: 0.54,
    breakthroughExploitation: 0.44,
    terrainRiskBias: 0.42,
    urbanBias: 0.34,
    roughTerrainBias: 0.08,
    openTerrainBias: -0.08,
    scarceAssetConservation: 0.74,
    objectivePersistence: 0.7,
    terrainPreferences: {
      urban: 0.34,
      rough: 0.08,
      forest: 0.02,
      open: -0.1,
      wet: -0.22,
      mountain: -0.14,
      bridge: 0.14,
    },
  },
};

const THINK_BUDGETS = {
  fast: {
    id: "fast",
    label: "Fast",
    maxHypotheses: 2,
    planVariants: 1,
    lookaheadDepth: 0,
    candidateBreadth: 2,
  },
  standard: {
    id: "standard",
    label: "Standard",
    maxHypotheses: 3,
    planVariants: 1,
    lookaheadDepth: 0,
    candidateBreadth: 3,
  },
  deliberate: {
    id: "deliberate",
    label: "Deliberate",
    maxHypotheses: 3,
    planVariants: 2,
    lookaheadDepth: 2,
    candidateBreadth: 4,
  },
};

export const RTS_AI_GOAL_MODEL_DEFAULT = "map_control_v1";
export const RTS_AI_VARIATION_MODE_DEFAULT = "hybrid";
export const RTS_AI_VARIATION_DEFAULTS = Object.freeze({
  temperature: 0.35,
  softmaxTopN: 3,
  driftSigma: 0.06,
  driftDecay: 0.85,
  driftClamp: 0.18,
});
export const RTS_AI_EXPERIMENT_TUNING_DEFAULTS = Object.freeze({
  director: {
    controlPressure: {
      baseVpWeight: 0.45,
      controlDeficitWeight: 0.85,
      frontierReachabilityWeight: 5,
      breakthroughOpportunityWeight: 6.5,
      terrainOpportunityWeight: 2.8,
      supportValueWeight: 2.8,
      enemyHoldUrgencyWeight: 10,
      congestionPenaltyWeight: 4,
      cutOffPenaltyWeight: 4.2,
    },
    defend: {
      enemyPressureWeight: 7,
      friendlyHoldThreatWeight: 11,
      cutOffRiskWeight: 6.5,
      transitionWeight: 3.5,
      threatenedBonus: 6,
      rearExposureWeight: 3.5,
    },
    exploit: {
      neutralBaseVpWeight: 1.2,
      contestedBaseVpWeight: 1,
      enemyBaseVpWeight: 0.72,
      breakthroughWeight: 6,
      frontierWeight: 4,
      terrainWeight: 2.6,
      neutralOpportunityWeight: 3.5,
      enemyHoldUrgencyWeight: 3,
      exploitabilityWeight: 2.4,
      cutOffPenaltyWeight: 2.5,
      congestionPenaltyWeight: 1.8,
    },
    support: {
      supportValueWeight: 8,
      terrainWeight: 3.3,
      frontierWeight: 2.4,
      enemyPressureWeight: 1.6,
    },
    reserve: {
      rearExposureWeight: 6,
      transitionWeight: 5,
      terrainWeight: 1.6,
      friendlyZoneBase: 4,
      nonFriendlyZoneBase: 1.5,
      holdThreatWeight: 2.2,
      congestionPenaltyWeight: 1.8,
      cutOffPenaltyWeight: 1.4,
    },
    probe: {
      neutralBase: 5,
      contestedBase: 4,
      enemyBase: 2,
      frontierWeight: 4,
      neutralOpportunityWeight: 3,
      supportValueWeight: 1.5,
      probePackageBonus: 3,
      lowControlBonus: 2,
      congestionPenaltyWeight: 1.2,
    },
    styleScale: {
      attack: 1,
      caution: 1,
      support: 1,
      reserve: 1,
      flank: 1,
      terrain: 1,
      vp: 1,
      riskPenalty: 1,
    },
    roleBases: {
      mainEffort: 11.5,
      supportingAttack: 9,
      screen: 9.4,
      opportunitySupport: 8.6,
      contain: 10.3,
      supportByFire: 8.8,
      rearSecurity: 7.6,
    },
    roleWeights: {
      mainOverloadPenalty: 2.4,
      surgeBonus: 2.5,
      secondaryOverloadBonus: 1.8,
      screenFlankWeight: 4.8,
      probePressureBonus: 2,
      opportunitySupportWeight: 2.2,
      recoverPressureBonus: 2.6,
      reliefPreferenceWeight: 3.2,
      supportBiasWeight: 4.2,
      rearSecurityWeight: 4.1,
      rearSecurityNeedBonus: 2.2,
    },
    primaryChoice: {
      closeGapThreshold: 3,
      closeGapRatio: 0.15,
      stabilizeDefendWeight: 1.05,
      stabilizeAttackWeight: 0.25,
      stabilizeHoldThreatWeight: 4,
      stabilizeDefeatInDetailWeight: 0.35,
      probeProbeWeight: 1.1,
      probeExploitWeight: 0.45,
      probeFrontierWeight: 4,
      probeDefeatInDetailWeight: 0.8,
      attackWeight: 1.05,
      exploitWeight: 0.55,
      controlPressureWeight: 0.18,
      defeatInDetailWeight: 0.9,
    },
    defeatInDetail: {
      enabled: 1,
      strengthRatioThreshold: 0.98,
      defenseBiasCeiling: 0.74,
      supportWeight: 0.85,
      frontierWeight: 0.8,
      breakthroughWeight: 0.75,
      exploitabilityWeight: 0.65,
      cutOffPenaltyWeight: 0.45,
      congestionPenaltyWeight: 0.35,
      inferiorityScale: 3.2,
      postureDefenseWeight: 0.6,
      postureAggressionWeight: 0.4,
      postureTempoWeight: 0.25,
      postureFlankWeight: 0.18,
      opportunityThreshold: 0.6,
    },
    blindSearch: {
      enabled: 1,
      maxScreenOwners: 1,
      escortLimitWhenThreePlusManeuverOwners: 1,
      roleCloseGapThreshold: 2.4,
      roleCloseGapRatio: 0.18,
    },
  },
  commander: {
    reserve: {
      aggressiveRatioDelta: -0.12,
      conservativeRatioDelta: 0.12,
      immediateReleaseThreshold: 0,
      stagedReleaseThreshold: 0.55,
      conservativeReleaseThreshold: 0.8,
      reservePatienceReleaseScale: 0.35,
      minimumHoldBaseMs: 15000,
      minimumHoldPatienceMs: 60000,
    },
    weakFallback: {
      strengthBase: 34,
      fallbackStrengthScale: 22,
      moraleBase: 18,
      defenseMoraleScale: 18,
    },
    roleFlex: {
      supportByFireSlotsScale: 2,
      reserveSlotsScale: 2,
      rearSecurityLowThreshold: 0.62,
      rearSecurityHighThreshold: 0.78,
    },
  },
  command: {
    engagementTempoWeight: 0.45,
    engagementCautionWeight: 0.28,
    engagementDangerTempoWeight: 0.25,
    engagementDangerCautionWeight: 0.32,
    objectiveTempoWeight: 0.42,
    objectiveCautionWeight: 0.28,
    objectiveDangerTempoWeight: 0.2,
    objectiveDangerCautionWeight: 0.35,
    reconScreenThreshold: 1,
    lastKnownScreenBias: 1,
  },
});

function clampConfigNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeRtsAiGoalModel(goalModel = RTS_AI_GOAL_MODEL_DEFAULT) {
  return goalModel === "legacy" ? "legacy" : RTS_AI_GOAL_MODEL_DEFAULT;
}

export function normalizeRtsAiVariationMode(variationMode = RTS_AI_VARIATION_MODE_DEFAULT) {
  return variationMode === "off" ? "off" : RTS_AI_VARIATION_MODE_DEFAULT;
}

export function normalizeRtsAiVariationConfig(config = {}) {
  return {
    temperature: clampConfigNumber(config?.temperature, RTS_AI_VARIATION_DEFAULTS.temperature, 0, 2),
    softmaxTopN: Math.round(clampConfigNumber(config?.softmaxTopN, RTS_AI_VARIATION_DEFAULTS.softmaxTopN, 1, 6)),
    driftSigma: clampConfigNumber(config?.driftSigma, RTS_AI_VARIATION_DEFAULTS.driftSigma, 0, 0.5),
    driftDecay: clampConfigNumber(config?.driftDecay, RTS_AI_VARIATION_DEFAULTS.driftDecay, 0, 0.99),
    driftClamp: clampConfigNumber(config?.driftClamp, RTS_AI_VARIATION_DEFAULTS.driftClamp, 0, 0.5),
  };
}

export function getAiProfile(profileId = "balanced") {
  return PROFILE_CATALOG[profileId] || PROFILE_CATALOG.balanced;
}

function deepMergeObjects(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }
  const result = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMergeObjects(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeRtsAiExperimentTuning(config = {}) {
  return deepMergeObjects(RTS_AI_EXPERIMENT_TUNING_DEFAULTS, config || {});
}

export function listAiProfiles() {
  return Object.values(PROFILE_CATALOG);
}

export function getThinkBudgetConfig(thinkBudget = "standard") {
  return THINK_BUDGETS[thinkBudget] || THINK_BUDGETS.standard;
}

export function listThinkBudgets() {
  return Object.values(THINK_BUDGETS);
}

export function terrainPreferenceForCategory(profile, category) {
  return profile?.terrainPreferences?.[category] || 0;
}
