#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getNeighbors, hexDistance } from "../src/mapRenderer/HexMath.js";
import { getTestFixture } from "../src/testFixture.js";
import { createGame as createSimulationGame } from "../src/simulation/orchestrator.js";
import { computeDetection, serializeVisibility, deserializeVisibility } from "../src/simulation/detectionEngine.js";
import { simulateMovement } from "../src/simulation/movementSimulator.js";
import { computeRange } from "../src/simulation/orderComputer.js";
import { parsePosition, positionToLabel } from "../src/simulation/prompts.js";
import { getServerAiDuelPreset } from "../src/simulation/presets.js";
import { buildEffectiveTerrain } from "../src/simulation/terrainMerge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

process.chdir(projectRoot);

const args = parseArgs(process.argv.slice(2));
const requestedTurns = Math.max(4, Number.parseInt(args.turns || "12", 10) || 12);
const runId = `${timestampTag()}-${randomBytes(3).toString("hex")}`;
const reportRoot = path.join(projectRoot, "Tests", "ai-opponent");
const runDir = path.join(reportRoot, "runs", runId);
const turnsDir = path.join(runDir, "turns");
const latestSummaryPath = path.join(reportRoot, "latest-summary.json");
const latestReportPath = path.join(reportRoot, "latest-report.md");
const dbPath = path.join(runDir, "ai-opponent-smoke.db");

ensureDir(turnsDir);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV ||= "development";

const dbModule = await import("../server/db.js");
const gameEngine = await import("../server/gameEngine.js");

const {
  getDb,
  createGame,
  addPlayer,
  getGame,
  getOrdersForTurn,
  saveTurnResults,
  getTurnResults,
} = dbModule;
const {
  generateAndSubmitAIOrders,
  finalizeTurn,
} = gameEngine;

const db = getDb();

try {
  const terrainData = getTestFixture();
  const scenario = buildScenario(args, requestedTurns);
  const llmConfig = {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.4,
  };
  const initialState = createSimulationGame({
    scenario,
    terrainRef: "test-fixture",
    terrainData,
    llmConfig,
  });
  const gameId = `ai-smoke-${randomBytes(4).toString("hex")}`;

  createGame(db, {
    id: gameId,
    name: scenario.title,
    stateJson: JSON.stringify(initialState),
    terrainJson: JSON.stringify(terrainData),
    configJson: JSON.stringify({ llm: llmConfig }),
    turnDeadlineHours: 24,
  });

  for (const actor of scenario.actors) {
    addPlayer(db, {
      gameId,
      actorId: actor.id,
      actorName: actor.name,
      email: null,
      isAi: true,
      aiConfigJson: JSON.stringify(actor.aiConfig || {}),
    });
  }

  let currentState = JSON.parse(getGame(db, gameId).state_json);
  const turnRecords = [];
  const warnings = [];
  const orderStaleness = new Map();

  for (let loopIndex = 0; loopIndex < requestedTurns; loopIndex += 1) {
    const currentTurn = currentState.game.turn;
    const orderRows = await ensureTurnOrders(db, gameId, currentTurn, scenario.actors.length);
    const sealedOrders = parseSealedOrders(orderRows);
    const playerIntents = buildPlayerIntents(orderRows);
    const previousResults = currentTurn > 1 ? getTurnResults(db, gameId, currentTurn - 1) : null;
    const previousVisibility = previousResults?.visibility_json
      ? deserializeVisibility(JSON.parse(previousResults.visibility_json))
      : null;

    const turnOutcome = simulateDeterministicTurn(currentState, terrainData, sealedOrders, previousVisibility);
    saveTurnResults(db, {
      gameId,
      turn: currentTurn,
      masterJson: JSON.stringify(turnOutcome.adjudication),
      actorResultsJson: JSON.stringify(turnOutcome.actorResults),
      visibilityJson: JSON.stringify(serializeVisibility(turnOutcome.visibilityState)),
    });

    const finalizeResult = finalizeTurn(db, gameId, turnOutcome.adjudication, playerIntents);
    if (!finalizeResult.success) {
      throw new Error(`Failed to finalize turn ${currentTurn}: ${finalizeResult.error || "Unknown error"}`);
    }

    const previousVpControl = currentState.game?.vpControl || {};
    currentState = finalizeResult.newState;

    const turnRecord = buildTurnRecord({
      scenario,
      currentTurn,
      orderRows,
      sealedOrders,
      turnOutcome,
      previousVpControl,
      currentState,
      orderStaleness,
      warnings,
    });
    turnRecords.push(turnRecord);
    writeTurnArtifacts(turnsDir, turnRecord, turnOutcome, orderRows);

    if (!hasOperationalUnits(currentState, scenario)) {
      warnings.push("One side lost all operational units before the requested soak length.");
      break;
    }
  }

  const summary = buildSummary({
    runId,
    dbPath,
    scenario,
    requestedTurns,
    completedTurns: turnRecords.length,
    finalState: currentState,
    turnRecords,
    warnings,
  });
  const report = renderMarkdownReport(summary);

  ensureDir(reportRoot);
  writeJson(path.join(runDir, "summary.json"), summary);
  writeMarkdown(path.join(runDir, "report.md"), report);
  writeJson(latestSummaryPath, summary);
  writeMarkdown(latestReportPath, report);

  printConsoleSummary(summary);
  if (!summary.ok) process.exitCode = 1;
} catch (error) {
  ensureDir(reportRoot);
  const failureSummary = {
    ok: false,
    status: "failed",
    runId,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    dbPath,
  };
  writeJson(latestSummaryPath, failureSummary);
  writeMarkdown(
    latestReportPath,
    `# AI Opponent Smoke Failed\n\n- Time: ${failureSummary.timestamp}\n- Error: ${failureSummary.error}\n`
  );
  console.error(`[ai-smoke] ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  await sleep(200);
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=", 2);
    parsed[key] = value ?? "true";
  }
  return parsed;
}

function buildScenario(args, requestedTurns) {
  const scenario = getServerAiDuelPreset();
  const budget = args.budget || "deliberate";
  const blueProfile = args["blue-profile"] || "aggressive_breakthrough";
  const redProfile = args["red-profile"] || "cautious_defender";

  scenario.maxTurns = requestedTurns;
  scenario.actors = scenario.actors.map((actor, index) => ({
    ...actor,
    controller: "ai",
    isAi: true,
    aiConfig: {
      ...actor.aiConfig,
      engine: "algorithmic",
      profile: index === 0 ? blueProfile : redProfile,
      thinkBudget: budget,
    },
  }));
  return scenario;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${value}\n`);
}

function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTurnOrders(db, gameId, turn, actorCount) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < 10_000) {
    const rows = getOrdersForTurn(db, gameId, turn);
    if (rows.length >= actorCount) return rows;

    const result = await generateAndSubmitAIOrders(db, gameId);
    const blockingErrors = (result.errors || []).filter((entry) => !String(entry.error || "").includes("already in progress"));
    if (blockingErrors.length > 0) {
      lastError = blockingErrors.map((entry) => `${entry.actorId}: ${entry.error}`).join("; ");
    }

    await sleep(rows.length > 0 ? 40 : 80);
  }

  throw new Error(
    `Timed out waiting for AI orders on turn ${turn}${lastError ? ` (${lastError})` : ""}`
  );
}

function parseSealedOrders(orderRows) {
  const sealedOrders = {};
  for (const row of orderRows) {
    sealedOrders[row.actor_id] = JSON.parse(row.orders_json);
  }
  return sealedOrders;
}

function buildPlayerIntents(orderRows) {
  return Object.fromEntries(
    orderRows.map((row) => {
      const orders = JSON.parse(row.orders_json);
      return [row.actor_id, orders.actorIntent || ""];
    })
  );
}

function simulateDeterministicTurn(gameState, terrainData, sealedOrders, previousVisibility) {
  const effectiveTerrain = buildEffectiveTerrain(terrainData, gameState.terrainMods);
  const startVisibility = computeDetection(gameState, effectiveTerrain, sealedOrders, previousVisibility);
  const movementResult = simulateMovement(gameState, effectiveTerrain, sealedOrders, previousVisibility);
  const visibilityState = movementResult.finalVisibility || startVisibility;
  const originalUnits = new Map(gameState.units.map((unit) => [unit.id, { ...unit }]));
  const workingUnits = new Map(gameState.units.map((unit) => [unit.id, { ...unit }]));
  const reasonMap = new Map();
  const terrainUpdates = [];
  const combatLogs = [];
  const captureEvents = [];
  const orderIndex = buildUnitOrderIndex(sealedOrders);

  for (const [unitId, nextPosition] of Object.entries(movementResult.finalPositions || {})) {
    const original = originalUnits.get(unitId);
    if (original && nextPosition && nextPosition !== original.position) {
      mutateUnit(workingUnits, reasonMap, unitId, "position", nextPosition, `Executed movement to ${labelHex(nextPosition)}.`);
    }
  }

  for (const unit of workingUnits.values()) {
    if (!isOperational(unit)) continue;
    const orders = orderIndex.get(unit.id) || {};
    const original = originalUnits.get(unit.id);
    const moved = original?.position !== unit.position;
    const movementOrder = orders.movementOrder || null;
    const actionOrder = orders.actionOrder || null;

    if (movementOrder?.id === "WITHDRAW" && moved) {
      mutateUnit(workingUnits, reasonMap, unit.id, "posture", "withdrawing", "Withdrew to a safer posture.");
      if (unit.morale != null) {
        mutateUnit(workingUnits, reasonMap, unit.id, "morale", clamp((unit.morale ?? 100) + 2, 0, 100), "Orderly withdrawal steadied morale.");
      }
    } else if (moved) {
      mutateUnit(workingUnits, reasonMap, unit.id, "posture", "moving", "Shifted position to support the plan.");
    }

    if (!actionOrder?.id) continue;

    switch (actionOrder.id) {
      case "ATTACK":
        mutateUnit(workingUnits, reasonMap, unit.id, "posture", "attacking", `Committed to the assault toward ${labelHex(actionOrder.target)}.`);
        if (unit.ammo != null) mutateUnit(workingUnits, reasonMap, unit.id, "ammo", clamp((unit.ammo ?? 100) - 10, 0, 100), "Assault fire consumed ammunition.");
        break;
      case "SUPPORT_FIRE":
      case "FIRE_MISSION":
      case "CAS":
      case "SHORE_BOMBARDMENT":
      case "INTERDICTION":
      case "SEAD":
      case "STRATEGIC_STRIKE":
        mutateUnit(workingUnits, reasonMap, unit.id, "posture", "attacking", `Applied fires onto ${labelHex(actionOrder.target)}.`);
        if (unit.ammo != null) mutateUnit(workingUnits, reasonMap, unit.id, "ammo", clamp((unit.ammo ?? 100) - 12, 0, 100), "Fire support consumed ammunition.");
        break;
      case "DEFEND":
        mutateUnit(workingUnits, reasonMap, unit.id, "posture", "defending", "Prepared to hold current ground.");
        if (!moved && unit.entrenchment != null) {
          mutateUnit(workingUnits, reasonMap, unit.id, "entrenchment", clamp((unit.entrenchment ?? 0) + 6, 0, 100), "Improved local defensive works while holding.");
        }
        break;
      case "DIG_IN":
        mutateUnit(workingUnits, reasonMap, unit.id, "posture", "dug_in", "Dug in on the current position.");
        if (unit.entrenchment != null) {
          mutateUnit(workingUnits, reasonMap, unit.id, "entrenchment", clamp((unit.entrenchment ?? 0) + 14, 0, 100), "Fieldworks improved under dig-in orders.");
        }
        break;
      case "RECON":
      case "AIR_RECON":
      case "CAP":
        mutateUnit(workingUnits, reasonMap, unit.id, "posture", "moving", "Prioritized reconnaissance and observation.");
        break;
      case "ENGINEER":
        applyEngineerEffects(unit, actionOrder, terrainUpdates, workingUnits, reasonMap);
        break;
      case "RESUPPLY":
        applyResupplyEffects(unit, actionOrder, workingUnits, reasonMap);
        break;
      default:
        break;
    }
  }

  const combatZones = collectCombatZones(workingUnits, orderIndex, movementResult);
  for (const zoneHex of combatZones) {
    resolveCombatZone({
      zoneHex,
      workingUnits,
      reasonMap,
      orderIndex,
      effectiveTerrain,
      combatLogs,
      captureEvents,
    });
  }

  const finalUnits = [...workingUnits.values()];
  const actorPerspectives = buildActorPerspectives({
    gameState,
    visibilityState,
    movementResult,
    finalUnits,
    combatLogs,
    captureEvents,
  });
  const stateUpdates = buildStateUpdates(originalUnits, workingUnits, reasonMap).concat(terrainUpdates);
  const masterNarrative = buildMasterNarrative(gameState, combatLogs, captureEvents, stateUpdates);
  const adjudication = {
    adjudication: {
      outcome_determination: {
        outcome_type: captureEvents.length > 0 ? "maneuver_success" : combatLogs.length > 0 ? "engagement" : "maneuver",
        narrative: masterNarrative,
        probability_assessment: "Deterministic smoke adjudication for server AI soak testing.",
        key_interactions: combatLogs.slice(0, 4).map((entry) => entry.summary).join(" "),
      },
      feasibility_analysis: {
        assessments: [],
      },
      state_updates: stateUpdates,
      actor_perspectives: actorPerspectives,
    },
    meta: {
      confidence: "high",
      notes: "Smoke-run deterministic adjudication used for repeatable AI opponent testing.",
    },
  };
  const actorResults = Object.fromEntries(
    gameState.scenario.actors.map((actor) => [
      actor.id,
      {
        adjudication: {
          situation_assessment: actorPerspectives[actor.id]?.narrative || "",
          actor_perspectives: {
            [actor.id]: actorPerspectives[actor.id] || {
              narrative: "",
              known_enemy_actions: "",
              intel_assessment: "",
              detection_resolutions: [],
            },
          },
        },
      },
    ])
  );

  return {
    adjudication,
    actorResults,
    visibilityState,
    movementResult,
    combatLogs,
    captureEvents,
    stateUpdateCount: stateUpdates.length,
  };
}

function buildUnitOrderIndex(sealedOrders) {
  const index = new Map();
  for (const [actorId, sealed] of Object.entries(sealedOrders || {})) {
    for (const [unitId, unitOrders] of Object.entries(sealed.unitOrders || {})) {
      index.set(unitId, {
        actorId,
        movementOrder: unitOrders.movementOrder || null,
        actionOrder: unitOrders.actionOrder || null,
        intent: unitOrders.intent || "",
      });
    }
  }
  return index;
}

function mutateUnit(workingUnits, reasonMap, unitId, attribute, nextValue, reason) {
  const unit = workingUnits.get(unitId);
  if (!unit) return;
  if (JSON.stringify(unit[attribute]) === JSON.stringify(nextValue)) return;
  unit[attribute] = nextValue;
  const entry = reasonMap.get(unitId) || {};
  entry[attribute] = reason;
  reasonMap.set(unitId, entry);
}

function applyEngineerEffects(unit, actionOrder, terrainUpdates, workingUnits, reasonMap) {
  const targetHex = actionOrder.target || unit.position;
  const targetLabel = labelHex(targetHex);
  switch (actionOrder.subtype) {
    case "FORTIFY":
      mutateUnit(workingUnits, reasonMap, unit.id, "posture", "defending", `Engineer work fortified ${targetLabel}.`);
      mutateUnit(
        workingUnits,
        reasonMap,
        unit.id,
        "entrenchment",
        clamp((unit.entrenchment ?? 0) + 10, 0, 100),
        `Engineering effort strengthened fieldworks at ${targetLabel}.`
      );
      terrainUpdates.push(makeTerrainUpdate(targetHex, { type: "fortification", level: clamp((unit.entrenchment ?? 0) + 15, 0, 100) }, `Engineers improved fortifications at ${targetLabel}.`));
      break;
    case "BRIDGE":
      terrainUpdates.push(makeTerrainUpdate(targetHex, { type: "bridge_built" }, `Engineers worked the crossing at ${targetLabel}.`));
      break;
    case "DEMOLISH":
      terrainUpdates.push(makeTerrainUpdate(targetHex, { type: "bridge_destroyed" }, `Engineers demolished the crossing at ${targetLabel}.`));
      break;
    case "OBSTACLE":
      terrainUpdates.push(makeTerrainUpdate(targetHex, { type: "obstacle", subtype: "engineered" }, `Engineers emplaced obstacles near ${targetLabel}.`));
      break;
    case "BREACH":
      terrainUpdates.push(makeTerrainUpdate(targetHex, { type: "obstacle_cleared" }, `Engineers cleared obstacles near ${targetLabel}.`));
      break;
    default:
      mutateUnit(workingUnits, reasonMap, unit.id, "posture", "defending", `Engineer unit supported local positions near ${targetLabel}.`);
      break;
  }
}

function applyResupplyEffects(unit, actionOrder, workingUnits, reasonMap) {
  const targetUnit = workingUnits.get(actionOrder.target);
  if (!targetUnit) return;
  if (targetUnit.supply != null) {
    mutateUnit(workingUnits, reasonMap, targetUnit.id, "supply", clamp((targetUnit.supply ?? 100) + 15, 0, 100), `Received resupply support from ${unit.name}.`);
  }
  if (targetUnit.ammo != null) {
    mutateUnit(workingUnits, reasonMap, targetUnit.id, "ammo", clamp((targetUnit.ammo ?? 100) + 10, 0, 100), `Received ammunition support from ${unit.name}.`);
  }
}

function makeTerrainUpdate(targetHex, modValue, justification) {
  return {
    entity: "terrain",
    attribute: positionToLabel(targetHex),
    old_value: null,
    new_value: modValue,
    justification,
  };
}

function collectCombatZones(workingUnits, orderIndex, movementResult) {
  const zones = new Set();

  for (const [unitId, orders] of orderIndex.entries()) {
    const actionId = orders.actionOrder?.id;
    const targetHex = orders.actionOrder?.target;
    if (!actionId || !targetHex || !isCombatAction(actionId)) continue;
    if (workingUnits.get(unitId)?.status === "destroyed") continue;
    zones.add(targetHex);
  }

  const occupiers = {};
  for (const unit of workingUnits.values()) {
    if (!isOperational(unit) || !unit.position) continue;
    occupiers[unit.position] = occupiers[unit.position] || new Set();
    occupiers[unit.position].add(unit.actor);
  }
  for (const [hexKey, actors] of Object.entries(occupiers)) {
    if (actors.size > 1) zones.add(hexKey);
  }

  for (const event of movementResult.contactEvents || []) {
    if (event.targetPos) zones.add(event.targetPos);
    if (event.observerPos) zones.add(event.observerPos);
  }

  return [...zones];
}

function resolveCombatZone({
  zoneHex,
  workingUnits,
  reasonMap,
  orderIndex,
  effectiveTerrain,
  combatLogs,
  captureEvents,
}) {
  const actorIds = new Set();
  const onHex = [...workingUnits.values()].filter((unit) => isOperational(unit) && unit.position === zoneHex);
  for (const unit of onHex) actorIds.add(unit.actor);
  for (const [unitId, orders] of orderIndex.entries()) {
    if (orders.actionOrder?.target === zoneHex && isOperational(workingUnits.get(unitId))) {
      actorIds.add(workingUnits.get(unitId).actor);
    }
  }
  if (actorIds.size === 0) return;

  const contexts = [...actorIds].map((actorId) => buildCombatContext({
    actorId,
    zoneHex,
    workingUnits,
    orderIndex,
    effectiveTerrain,
  })).filter((context) => context.totalPower > 0 || context.occupiers.length > 0);
  if (contexts.length === 0) return;

  if (contexts.length === 1) {
    const lone = contexts[0];
    if (lone.assaultUnits.length > 0 && lone.occupiers.length === 0) {
      const lead = chooseLeadUnit(lone.assaultUnits);
      if (lead && lead.position !== zoneHex) {
        mutateUnit(workingUnits, reasonMap, lead.id, "position", zoneHex, `Assault exploited into ${labelHex(zoneHex)} without opposition.`);
        combatLogs.push({
          zoneHex,
          summary: `${lead.name} occupied ${labelHex(zoneHex)} without opposition.`,
          winningActor: lone.actorId,
          losingActor: null,
          strengthShift: { [lone.actorId]: 0 },
        });
      }
    }
    return;
  }

  contexts.sort((a, b) => b.totalPower - a.totalPower);
  const winner = contexts[0];
  const loser = contexts[1];
  const ratio = winner.totalPower / Math.max(loser.totalPower, 0.1);
  const contested = ratio < 1.15;

  if (contested) {
    const loss = 9;
    distributeLosses(winner.participants, loss, workingUnits, reasonMap, `Close combat around ${labelHex(zoneHex)} caused mutual attrition.`);
    distributeLosses(loser.participants, loss, workingUnits, reasonMap, `Close combat around ${labelHex(zoneHex)} caused mutual attrition.`);
    combatLogs.push({
      zoneHex,
      summary: `Fighting around ${labelHex(zoneHex)} remained contested.`,
      winningActor: null,
      losingActor: null,
      strengthShift: {
        [winner.actorId]: -loss,
        [loser.actorId]: -loss,
      },
    });
    return;
  }

  const loserLoss = clamp(Math.round(8 + (ratio * 8) + (winner.fireUnits.length * 2) + (winner.assaultUnits.length * 2)), 8, 40);
  const winnerLoss = clamp(Math.round(3 + (10 / Math.max(ratio, 1.15)) + loser.occupiers.length), 2, 24);

  distributeLosses(loser.participants, loserLoss, workingUnits, reasonMap, `${winner.actorId} overmatched local defenders at ${labelHex(zoneHex)}.`);
  distributeLosses(winner.participants, winnerLoss, workingUnits, reasonMap, `Defenders at ${labelHex(zoneHex)} fought back effectively.`);

  const survivingLoserOccupiers = loser.occupiers.filter((unit) => isOperational(workingUnits.get(unit.id)));
  const survivingWinnerAssault = winner.assaultUnits.filter((unit) => isOperational(workingUnits.get(unit.id)));

  if (survivingLoserOccupiers.length > 0 && survivingWinnerAssault.length > 0) {
    const enemyUnits = survivingWinnerAssault.map((unit) => workingUnits.get(unit.id)).filter(Boolean);
    for (const unit of survivingLoserOccupiers) {
      const current = workingUnits.get(unit.id);
      if (!current || !isOperational(current)) continue;
      const retreatHex = findRetreatHex(current, effectiveTerrain, workingUnits, enemyUnits, zoneHex);
      if (retreatHex) {
        mutateUnit(workingUnits, reasonMap, current.id, "position", retreatHex, `Forced to retreat from ${labelHex(zoneHex)} to ${labelHex(retreatHex)}.`);
        mutateUnit(workingUnits, reasonMap, current.id, "posture", "withdrawing", `Fell back from ${labelHex(zoneHex)} under pressure.`);
      } else if ((current.strength ?? 0) <= 30) {
        mutateUnit(workingUnits, reasonMap, current.id, "status", "destroyed", `Trapped and destroyed while withdrawing from ${labelHex(zoneHex)}.`);
        mutateUnit(workingUnits, reasonMap, current.id, "strength", 0, `Combat losses destroyed the unit at ${labelHex(zoneHex)}.`);
      }
    }
  }

  const loserStillOnHex = [...workingUnits.values()].some((unit) => isOperational(unit) && unit.actor === loser.actorId && unit.position === zoneHex);
  if (!loserStillOnHex && survivingWinnerAssault.length > 0) {
    const lead = chooseLeadUnit(survivingWinnerAssault);
    if (lead && lead.position !== zoneHex) {
      mutateUnit(workingUnits, reasonMap, lead.id, "position", zoneHex, `Assault secured ${labelHex(zoneHex)} after dislodging the defender.`);
    }
    captureEvents.push({
      hex: zoneHex,
      label: labelHex(zoneHex),
      actorId: winner.actorId,
      fromActorId: loser.actorId,
    });
  }

  combatLogs.push({
    zoneHex,
    summary: `${winner.actorId} won the fight at ${labelHex(zoneHex)} (${ratio.toFixed(2)}:1).`,
    winningActor: winner.actorId,
    losingActor: loser.actorId,
    strengthShift: {
      [winner.actorId]: -winnerLoss,
      [loser.actorId]: -loserLoss,
    },
  });
}

function buildCombatContext({ actorId, zoneHex, workingUnits, orderIndex, effectiveTerrain }) {
  const occupiers = [...workingUnits.values()].filter((unit) => isOperational(unit) && unit.actor === actorId && unit.position === zoneHex);
  const participants = new Map();

  for (const unit of occupiers) {
    participants.set(unit.id, {
      unit,
      occupier: true,
      assault: true,
      actionId: null,
      weight: 1.15,
    });
  }

  for (const [unitId, orders] of orderIndex.entries()) {
    if (orders.actorId !== actorId) continue;
    const unit = workingUnits.get(unitId);
    if (!unit || !isOperational(unit)) continue;
    const actionOrder = orders.actionOrder;
    if (!actionOrder?.id || actionOrder.target !== zoneHex || !isCombatAction(actionOrder.id)) continue;

    const range = computeRange(unit.position, zoneHex, unit, effectiveTerrain?.cellSizeKm || 1);
    if (actionOrder.id === "ATTACK" && unit.position !== zoneHex && range.hexes > 1) continue;
    if (actionOrder.id !== "ATTACK" && range.band === "OUT_OF_RANGE") continue;

    const entry = participants.get(unit.id) || {
      unit,
      occupier: false,
      assault: false,
      actionId: actionOrder.id,
      weight: 1,
    };
    entry.actionId = actionOrder.id;
    entry.assault = entry.assault || actionOrder.id === "ATTACK";
    entry.weight = Math.max(entry.weight, combatActionWeight(actionOrder.id));
    participants.set(unit.id, entry);
  }

  const participantList = [...participants.values()];
  const cell = effectiveTerrain?.cells?.[zoneHex] || { terrain: "open_ground" };
  const occupierUnits = participantList.filter((entry) => entry.occupier).map((entry) => entry.unit);
  const supportPower = participantList.reduce((sum, entry) => {
    const range = entry.actionId ? computeRange(entry.unit.position, zoneHex, entry.unit, effectiveTerrain?.cellSizeKm || 1) : null;
    const rangeMod = !range ? 1 : range.band === "POINT_BLANK" ? 1.15 : range.band === "EFFECTIVE" ? 1 : range.band === "MAX" ? 0.8 : 0;
    return sum + (unitPower(entry.unit) * entry.weight * rangeMod);
  }, 0);
  const occupierDefense = occupierUnits.reduce((sum, unit) => (
    sum + (unitPower(unit) * terrainDefenseMultiplier(cell) * (1 + ((unit.entrenchment ?? 0) / 200)))
  ), 0);

  return {
    actorId,
    occupiers: occupierUnits,
    participants: participantList,
    assaultUnits: participantList.filter((entry) => entry.assault).map((entry) => entry.unit),
    fireUnits: participantList.filter((entry) => entry.actionId && entry.actionId !== "ATTACK").map((entry) => entry.unit),
    totalPower: supportPower + (occupierDefense * (occupierUnits.length > 0 ? 0.75 : 0)),
  };
}

function distributeLosses(participants, totalLoss, workingUnits, reasonMap, reason) {
  if (!participants.length || totalLoss <= 0) return;

  const weights = participants.map((entry) => {
    const unit = workingUnits.get(entry.unit.id);
    if (!unit || !isOperational(unit)) return 0;
    const exposure = entry.occupier ? 1.25 : entry.assault ? 1.15 : 0.75;
    return Math.max(0.2, unitPower(unit) * exposure);
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  let distributed = 0;

  for (let index = 0; index < participants.length; index += 1) {
    const entry = participants[index];
    const unit = workingUnits.get(entry.unit.id);
    if (!unit || !isOperational(unit)) continue;
    const remaining = totalLoss - distributed;
    const share = index === participants.length - 1
      ? remaining
      : Math.min(remaining, Math.max(1, Math.round(totalLoss * (weights[index] / weightTotal))));
    distributed += share;

    const nextStrength = clamp((unit.strength ?? 100) - share, 0, 100);
    mutateUnit(workingUnits, reasonMap, unit.id, "strength", nextStrength, reason);
    if (unit.morale != null) {
      mutateUnit(workingUnits, reasonMap, unit.id, "morale", clamp((unit.morale ?? 100) - Math.max(2, Math.round(share * 0.8)), 0, 100), `${reason} Morale fell under combat pressure.`);
    }
    if (unit.ammo != null && entry.actionId) {
      mutateUnit(workingUnits, reasonMap, unit.id, "ammo", clamp((unit.ammo ?? 100) - Math.max(2, Math.round(share * 0.4)), 0, 100), `${reason} Additional expenditure depleted ammunition.`);
    }

    if (nextStrength <= 0) {
      mutateUnit(workingUnits, reasonMap, unit.id, "status", "destroyed", reason);
    } else if (nextStrength < 25) {
      mutateUnit(workingUnits, reasonMap, unit.id, "status", "damaged", reason);
    }
  }
}

function findRetreatHex(unit, effectiveTerrain, workingUnits, enemyUnits, zoneHex) {
  const pos = parsePosition(unit.position);
  if (!pos) return null;

  let bestHex = null;
  let bestScore = -Infinity;
  for (const [col, row] of getNeighbors(pos.col, pos.row)) {
    if (col < 0 || row < 0 || col >= (effectiveTerrain?.cols || 0) || row >= (effectiveTerrain?.rows || 0)) continue;
    const hexKey = `${col},${row}`;
    const cell = effectiveTerrain?.cells?.[hexKey];
    if (!isPassableRetreat(unit, cell)) continue;

    const occupied = [...workingUnits.values()].some((other) =>
      isOperational(other) && other.id !== unit.id && other.position === hexKey
    );
    if (occupied) continue;

    const nearestEnemy = enemyUnits.reduce((min, enemy) => {
      const enemyPos = parsePosition(enemy.position);
      if (!enemyPos) return min;
      return Math.min(min, hexDistance(col, row, enemyPos.col, enemyPos.row));
    }, 99);
    const friendlySupport = [...workingUnits.values()].filter((other) => {
      if (!isOperational(other) || other.actor !== unit.actor || other.id === unit.id) return false;
      const otherPos = parsePosition(other.position);
      return otherPos && hexDistance(col, row, otherPos.col, otherPos.row) <= 2;
    }).length;
    const score = (nearestEnemy * 3) + (terrainDefenseMultiplier(cell) * 5) + friendlySupport - (hexKey === zoneHex ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestHex = hexKey;
    }
  }

  return bestHex;
}

function isPassableRetreat(unit, cell) {
  const terrain = cell?.terrain || "open_ground";
  if (terrain === "deep_water" || terrain === "coastal_water" || terrain === "lake" || terrain === "canal" || terrain === "dock") {
    return unit.type === "naval" || unit.movementType === "naval";
  }
  return true;
}

function chooseLeadUnit(units) {
  if (!units.length) return null;
  return [...units].sort((a, b) => unitPower(b) - unitPower(a))[0];
}

function buildStateUpdates(originalUnits, workingUnits, reasonMap) {
  const updates = [];
  for (const [unitId, original] of originalUnits.entries()) {
    const current = workingUnits.get(unitId);
    if (!current) continue;
    const reasonEntry = reasonMap.get(unitId) || {};
    for (const attribute of ["position", "strength", "morale", "ammo", "entrenchment", "supply", "status", "posture"]) {
      if (JSON.stringify(original[attribute]) === JSON.stringify(current[attribute])) continue;
      updates.push({
        entity: unitId,
        attribute,
        old_value: original[attribute] ?? null,
        new_value: current[attribute] ?? null,
        justification: reasonEntry[attribute] || `Updated ${original.name} ${attribute}.`,
      });
    }
  }
  return updates;
}

function buildActorPerspectives({ gameState, visibilityState, movementResult, finalUnits, combatLogs, captureEvents }) {
  const actorPerspectives = {};
  const unitById = Object.fromEntries(finalUnits.map((unit) => [unit.id, unit]));

  for (const actor of gameState.scenario.actors) {
    const actorVisibility = visibilityState?.actorVisibility?.[actor.id];
    const detected = actorVisibility ? [...(actorVisibility.detectedUnits || [])] : [];
    const contacts = actorVisibility ? [...(actorVisibility.contactUnits || [])] : [];
    const visibleEnemyNames = detected.slice(0, 5).map((unitId) => unitById[unitId]?.name || unitId);
    const ownLosses = finalUnits
      .filter((unit) => unit.actor === actor.id)
      .reduce((sum, unit) => {
        const original = gameState.units.find((entry) => entry.id === unit.id);
        return sum + Math.max(0, (original?.strength ?? 100) - (unit.strength ?? 100));
      }, 0);
    const actorCaptures = captureEvents.filter((entry) => entry.actorId === actor.id);
    const actorCombat = combatLogs.filter((entry) => entry.winningActor === actor.id || entry.losingActor === actor.id);
    const narrativeBits = [];

    if (actorCaptures.length > 0) {
      narrativeBits.push(`You secured ${actorCaptures.map((entry) => entry.label).join(", ")}.`);
    }
    if (actorCombat.length > 0) {
      narrativeBits.push(`Your forces were involved in ${actorCombat.length} major engagement(s).`);
    }
    if (visibleEnemyNames.length > 0) {
      narrativeBits.push(`Identified enemy elements included ${visibleEnemyNames.join(", ")}.`);
    }
    if (ownLosses > 0) {
      narrativeBits.push(`Friendly strength losses this turn totaled approximately ${ownLosses} points.`);
    }
    if ((movementResult.contactEvents || []).length > 0) {
      narrativeBits.push(`Movement contact reports totaled ${(movementResult.contactEvents || []).length}.`);
    }

    actorPerspectives[actor.id] = {
      narrative: narrativeBits.join(" ") || "No decisive events were observed this turn.",
      known_enemy_actions: actorCombat.map((entry) => entry.summary).join(" "),
      intel_assessment: `Detected ${detected.length} identified enemy unit(s) and ${contacts.length} contact(s).`,
      detection_resolutions: [
        ...detected.map((unitId) => ({
          unitId,
          detected: true,
          description: `${unitById[unitId]?.name || unitId} remained identified by end of turn.`,
        })),
        ...contacts.filter((unitId) => !detected.includes(unitId)).map((unitId) => ({
          unitId,
          detected: false,
          description: `${unitById[unitId]?.name || unitId} was tracked only as a contact.`,
        })),
      ],
    };
  }

  return actorPerspectives;
}

function buildMasterNarrative(gameState, combatLogs, captureEvents, stateUpdates) {
  const clauses = [];
  if (captureEvents.length > 0) {
    clauses.push(`Ground changed hands at ${captureEvents.map((entry) => entry.label).join(", ")}.`);
  }
  if (combatLogs.length > 0) {
    clauses.push(combatLogs.slice(0, 3).map((entry) => entry.summary).join(" "));
  }
  if (clauses.length === 0 && stateUpdates.length > 0) {
    clauses.push(`Units repositioned across ${new Set(stateUpdates.filter((entry) => entry.attribute === "position").map((entry) => entry.entity)).size} formations.`);
  }
  if (clauses.length === 0) {
    clauses.push("Both forces maneuvered cautiously without decisive contact.");
  }
  return `${gameState.scenario.title}: ${clauses.join(" ")}`;
}

function buildTurnRecord({
  scenario,
  currentTurn,
  orderRows,
  sealedOrders,
  turnOutcome,
  previousVpControl,
  currentState,
  orderStaleness,
  warnings,
}) {
  const selectedHypotheses = {};
  const movementByActor = {};
  const reasoningCoverage = {};
  const orderSignatures = {};

  for (const row of orderRows) {
    const parsed = JSON.parse(row.orders_json);
    const actorId = row.actor_id;
    selectedHypotheses[actorId] = parsed.reasoning?.selectedHypothesis?.id || null;
    reasoningCoverage[actorId] = {
      hasReasoning: !!parsed.reasoning,
      unitDecisions: parsed.reasoning?.unitDecisions?.length || 0,
    };
    const actorUnits = scenario.units.filter((unit) => unit.actor === actorId);
    movementByActor[actorId] = actorUnits.filter((unit) => !!parsed.unitOrders?.[unit.id]?.movementOrder?.target).length;
    orderSignatures[actorId] = JSON.stringify(parsed.unitOrders || {});

    const previous = orderStaleness.get(actorId);
    const staleRun = previous?.signature === orderSignatures[actorId] ? previous.run + 1 : 1;
    orderStaleness.set(actorId, { signature: orderSignatures[actorId], run: staleRun });
    const actorStillDynamic = movementByActor[actorId] > 0
      || turnOutcome.captureEvents.some((entry) => entry.actorId === actorId)
      || turnOutcome.combatLogs.some((entry) => entry.winningActor === actorId || entry.losingActor === actorId);
    if (staleRun >= 4 && !actorStillDynamic) {
      warnings.push(`${actorId} repeated the exact same order set ${staleRun} turns in a row by turn ${currentTurn}.`);
    }
  }

  const vpAfter = currentState.game?.vpStatus?.vp || {};
  const vpControlAfter = currentState.game?.vpControl || {};
  const controlChanges = Object.entries(vpControlAfter)
    .filter(([hex, controller]) => previousVpControl[hex] !== controller)
    .map(([hex, controller]) => ({
      hex,
      label: labelHex(hex),
      controller: controller || null,
    }));

  return {
    turn: currentTurn,
    selectedHypotheses,
    reasoningCoverage,
    movementByActor,
    controlChanges,
    captureEvents: turnOutcome.captureEvents,
    combatLogs: turnOutcome.combatLogs,
    stateUpdateCount: turnOutcome.stateUpdateCount,
    vpAfter,
    orderSignatures,
    unitOrderCount: Object.fromEntries(
      Object.entries(sealedOrders).map(([actorId, sealed]) => [actorId, Object.keys(sealed.unitOrders || {}).length])
    ),
  };
}

function writeTurnArtifacts(turnsDir, turnRecord, turnOutcome, orderRows) {
  const turnDir = path.join(turnsDir, `turn-${String(turnRecord.turn).padStart(2, "0")}`);
  ensureDir(turnDir);
  writeJson(path.join(turnDir, "turn-summary.json"), turnRecord);
  writeJson(path.join(turnDir, "adjudication.json"), turnOutcome.adjudication);

  for (const row of orderRows) {
    const parsed = JSON.parse(row.orders_json);
    writeJson(path.join(turnDir, `${row.actor_id}.orders.json`), parsed);
    if (parsed.reasoning) {
      writeJson(path.join(turnDir, `${row.actor_id}.reasoning.json`), parsed.reasoning);
    }
  }
}

function buildSummary({ runId, dbPath, scenario, requestedTurns, completedTurns, finalState, turnRecords, warnings }) {
  const totalCombatZones = turnRecords.reduce((sum, record) => sum + record.combatLogs.length, 0);
  const totalCaptures = turnRecords.reduce((sum, record) => sum + record.captureEvents.length, 0);
  const missingReasoning = turnRecords.flatMap((record) => Object.entries(record.reasoningCoverage)
    .filter(([, coverage]) => !coverage.hasReasoning || coverage.unitDecisions === 0)
    .map(([actorId]) => `${actorId} on turn ${record.turn}`));
  const finalVp = finalState.game?.vpStatus?.vp || {};
  const vpGoal = finalState.scenario?.victoryConditions?.vpGoal || null;
  const severeWarnings = [...warnings];

  if (totalCombatZones === 0) severeWarnings.push("No combat zones were resolved during the soak run.");
  if (completedTurns >= 8 && totalCaptures === 0) severeWarnings.push("No ground changed hands across a long soak run.");
  if (missingReasoning.length > 0) severeWarnings.push(`Reasoning JSON missing or empty for ${missingReasoning.join(", ")}.`);

  return {
    ok: severeWarnings.length === 0,
    status: severeWarnings.length === 0 ? "passed" : "needs-attention",
    runId,
    timestamp: new Date().toISOString(),
    dbPath,
    requestedTurns,
    completedTurns,
    scenario: {
      title: scenario.title,
      actors: scenario.actors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        aiConfig: actor.aiConfig,
      })),
      vpGoal,
    },
    finalTurn: finalState.game?.turn || completedTurns + 1,
    finalVp,
    totalCombatZones,
    totalCaptures,
    missingReasoning,
    warnings: severeWarnings,
    turnRecords,
  };
}

function renderMarkdownReport(summary) {
  const lines = [
    "# AI Opponent Smoke Report",
    "",
    `- Status: **${summary.status}**`,
    `- Run: \`${summary.runId}\``,
    `- Turns requested/completed: ${summary.requestedTurns}/${summary.completedTurns}`,
    `- Final VP: ${Object.entries(summary.finalVp).map(([actorId, vp]) => `${actorId}=${vp}`).join(", ") || "none"}`,
    `- Combat zones: ${summary.totalCombatZones}`,
    `- Captures: ${summary.totalCaptures}`,
    "",
    "## Actors",
    "",
    ...summary.scenario.actors.map((actor) => `- ${actor.name}: \`${actor.aiConfig.profile}\` / \`${actor.aiConfig.thinkBudget}\``),
    "",
    "## Turn Notes",
    "",
    ...summary.turnRecords.map((record) => {
      const captures = record.captureEvents.length > 0
        ? `captures ${record.captureEvents.map((entry) => entry.label).join(", ")}`
        : "no capture";
      const hypotheses = Object.entries(record.selectedHypotheses).map(([actorId, value]) => `${actorId}:${value || "none"}`).join(", ");
      return `- Turn ${record.turn}: ${record.combatLogs.length} combat zone(s), ${captures}, hypotheses ${hypotheses}`;
    }),
  ];

  if (summary.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...summary.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

function printConsoleSummary(summary) {
  console.log(`[ai-smoke] status=${summary.status} turns=${summary.completedTurns}/${summary.requestedTurns} combatZones=${summary.totalCombatZones} captures=${summary.totalCaptures}`);
  console.log(`[ai-smoke] final-vp ${Object.entries(summary.finalVp).map(([actorId, vp]) => `${actorId}=${vp}`).join(" ") || "none"}`);
  if (summary.warnings.length > 0) {
    console.log(`[ai-smoke] warnings: ${summary.warnings.join(" | ")}`);
  }
}

function hasOperationalUnits(gameState, scenario) {
  return scenario.actors.every((actor) =>
    gameState.units.some((unit) => unit.actor === actor.id && isOperational(unit))
  );
}

function isCombatAction(actionId) {
  return new Set(["ATTACK", "SUPPORT_FIRE", "FIRE_MISSION", "CAS", "SHORE_BOMBARDMENT", "INTERDICTION", "SEAD", "STRATEGIC_STRIKE"]).has(actionId);
}

function combatActionWeight(actionId) {
  switch (actionId) {
    case "ATTACK": return 1.35;
    case "CAS": return 1.15;
    case "SHORE_BOMBARDMENT": return 1.1;
    case "INTERDICTION":
    case "SEAD":
    case "STRATEGIC_STRIKE":
      return 1.0;
    case "SUPPORT_FIRE":
      return 0.95;
    case "FIRE_MISSION":
      return 0.9;
    default:
      return 0.85;
  }
}

function terrainDefenseMultiplier(cell) {
  const terrain = cell?.terrain || "open_ground";
  if (terrain.includes("dense_urban") || terrain.includes("highrise") || terrain === "peak" || terrain.includes("mountain")) return 1.45;
  if (terrain.includes("urban") || terrain.startsWith("bldg_") || terrain.includes("forest") || terrain.includes("highland")) return 1.25;
  if (terrain.includes("wet") || terrain === "bridge_deck" || terrain.includes("beach")) return 0.95;
  return 1.05;
}

function unitPower(unit) {
  const base = unit.type === "armor" ? 2.2
    : unit.type === "artillery" ? 1.8
    : unit.type === "mechanized" || unit.type === "mechanized_infantry" || unit.type === "armored_infantry" ? 1.8
    : unit.type === "engineer" ? 0.9
    : unit.type === "recon" ? 0.8
    : unit.type === "headquarters" || unit.type === "logistics" ? 0.45
    : unit.type === "air_defense" ? 0.9
    : unit.type === "air" || unit.type === "attack_helicopter" || unit.type === "transport" ? 1.8
    : 1.2;
  const strength = clamp((unit.strength ?? 100) / 100, 0, 1.2);
  const ammo = unit.ammo == null ? 1 : clamp((unit.ammo ?? 100) / 100, 0.3, 1.05);
  const morale = unit.morale == null ? 1 : clamp((unit.morale ?? 100) / 100, 0.3, 1.1);
  const supply = unit.supply == null ? 1 : clamp((unit.supply ?? 100) / 100, 0.35, 1.05);
  return base * strength * ammo * morale * supply;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isOperational(unit) {
  return !!unit && unit.status !== "destroyed" && unit.status !== "eliminated";
}

function labelHex(hexKey) {
  return hexKey ? positionToLabel(hexKey) : "?";
}
