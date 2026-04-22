#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

process.chdir(projectRoot);

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(projectRoot, ".env"));

const selectedPort = await findAvailablePort(
  Number.parseInt(args.port || process.env.OC_SMOKE_PORT || process.env.PORT || "3101", 10) || 3101
);

process.env.PORT = String(selectedPort);
process.env.CORS_ORIGIN ||= `http://127.0.0.1:${args.vitePort || process.env.OC_SMOKE_VITE_PORT || "5174"}`;
process.env.NODE_ENV ||= "development";

const baseUrl = `http://127.0.0.1:${process.env.PORT}`;
const defaultMapPath = path.join(projectRoot, "saves", "Llanddeusant_0.5km_20x23_2026-03-04.json");
const reportDir = path.join(projectRoot, "Tests", "smoke");
const latestReportPath = path.join(reportDir, "latest-report.md");
const latestSummaryPath = path.join(reportDir, "latest-summary.json");
const useLiveParse = args["live-parse"] === "true" || args.liveParse === true;

let restoreFetch = null;

try {
  await import("../server/index.js");
  await waitForHealth(`${baseUrl}/api/health`);

  let mockResponder = null;
  restoreFetch = installFetchBridge(baseUrl, () => mockResponder);

  const orchestrator = await import("../src/simulation/orchestrator.js");
  const detectionEngine = await import("../src/simulation/detectionEngine.js");
  const movementSimulator = await import("../src/simulation/movementSimulator.js");
  const loggerModule = await import("../src/simulation/logger.js");
  const presets = await import("../src/simulation/presets.js");
  const prompts = await import("../src/simulation/prompts.js");

  const parserModule = useLiveParse ? await import("../src/Parser.jsx") : null;
  const terrainSource = useLiveParse
    ? await runLiveParse(parserModule.scanSinglePatch, args)
    : loadCachedTerrain(args.map || defaultMapPath);
  const terrainFile = terrainSource.file;
  const terrainData = terrainSource.terrainData;
  const terrainAnalysis = analyzeTerrain(terrainData);
  const scenario = buildScenario(presets.getQuickstartPreset(), terrainAnalysis);
  const llmConfig = args.liveLlm
    ? await pickLiveProvider(orchestrator.getProviders)
    : { provider: "mock", model: "mock-one-turn", temperature: 0.1 };

  const folder = await orchestrator.createGameFolder(
    `${slugify(scenario.title)}-${timestampTag()}`,
    terrainData
  );

  const initialGameState = orchestrator.createGame({
    scenario,
    terrainRef: path.basename(terrainFile),
    terrainData,
    llmConfig,
    folder,
  });

  await orchestrator.saveGameState(initialGameState);
  const loadedTerrain = await orchestrator.loadGameTerrain(folder);
  const reloadedGameState = await orchestrator.loadGameState(folder, { folder: true });

  const sealedOrders = buildSealedOrders(reloadedGameState, terrainAnalysis);
  const actorUnitOrders = Object.fromEntries(
    Object.entries(sealedOrders).map(([actorId, sealed]) => [actorId, sealed.unitOrders || {}])
  );
  const playerActions = buildPlayerActions(
    reloadedGameState.scenario.actors,
    actorUnitOrders,
    reloadedGameState.units,
    prompts.positionToLabel
  );

  const visibility = detectionEngine.computeDetection(reloadedGameState, terrainData, sealedOrders, null);
  const movement = movementSimulator.simulateMovement(reloadedGameState, terrainData, sealedOrders, visibility);
  const detectionContext = buildDetectionContext(visibility, movement);
  const logger = loggerModule.createLogger(reloadedGameState.game.id);

  if (!args.liveLlm) {
    mockResponder = () => buildMockLlmPayload({
      gameState: reloadedGameState,
      terrainAnalysis,
      sealedOrders,
      movement,
      playerActions,
      objectiveLabel: prompts.positionToLabel(terrainAnalysis.primaryObjective.key),
      supportLabel: prompts.positionToLabel(terrainAnalysis.supportObjective.key),
      townLabel: prompts.positionToLabel(terrainAnalysis.townObjective.key),
      highGroundLabel: prompts.positionToLabel(terrainAnalysis.highGroundObjective.key),
    });
  }

  const adjudicationResult = await orchestrator.adjudicate(
    reloadedGameState,
    playerActions,
    terrainData,
    logger,
    {
      unitOrders: actorUnitOrders,
      actorIntents: Object.fromEntries(
        Object.entries(sealedOrders).map(([actorId, sealed]) => [actorId, sealed.actorIntent || ""])
      ),
    },
    detectionContext,
    null
  );

  if (adjudicationResult.error && !adjudicationResult.adjudication) {
    throw new Error(adjudicationResult.error);
  }

  normalizeStateUpdateEntities(adjudicationResult.adjudication, reloadedGameState);

  const updatedGameState = orchestrator.applyStateUpdates(
    reloadedGameState,
    adjudicationResult.adjudication,
    sealedOrders
  );
  const advancedGameState = orchestrator.advanceTurn(updatedGameState);

  await orchestrator.saveGameState(advancedGameState);
  await logger.flush(advancedGameState.game.id, advancedGameState.game.folder);
  const finalReloadedGameState = await orchestrator.loadGameState(folder, { folder: true });

  const checks = buildChecks({
    args,
    terrainSource,
    terrainData,
    loadedTerrain,
    initialGameState,
    reloadedGameState,
    updatedGameState,
    advancedGameState,
    finalReloadedGameState,
    adjudicationResult,
    terrainAnalysis,
  });

  const summary = buildSummary({
    args,
    terrainFile,
    terrainData,
    terrainAnalysis,
    folder,
    scenario,
    llmConfig,
    sealedOrders,
    movement,
    adjudicationResult,
    updatedGameState,
    advancedGameState,
    finalReloadedGameState,
    checks,
    terrainSource,
  });

  ensureDir(reportDir);
  fs.writeFileSync(latestSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const reportMarkdown = renderMarkdownReport(summary);
  fs.writeFileSync(latestReportPath, `${reportMarkdown}\n`);

  await saveArtifact(folder, "smoke-report.md", reportMarkdown);
  await saveArtifact(folder, "smoke-summary.json", summary);

  printConsoleSummary(summary);

  if (!summary.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  ensureDir(reportDir);
  const failureSummary = {
    ok: false,
    status: "failed",
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    baseUrl,
  };
  fs.writeFileSync(latestSummaryPath, `${JSON.stringify(failureSummary, null, 2)}\n`);
  fs.writeFileSync(
    latestReportPath,
    `# One-Turn Smoke Test Failed\n\n- Time: ${failureSummary.timestamp}\n- Error: ${failureSummary.error}\n`
  );
  console.error(`[smoke] ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  if (restoreFetch) restoreFetch();
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    if (arg === "--live-llm") {
      parsed.liveLlm = true;
      continue;
    }
    const [key, value] = arg.slice(2).split("=", 2);
    parsed[key] = value ?? "true";
  }
  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
    if (available) return port;
  }
  throw new Error(`No open port found near ${startPort}`);
}

async function waitForHealth(url) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Wait for the listener to come up.
    }
    await sleep(150);
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

function installFetchBridge(base, getMockResponder) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = undefined) => {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url || String(input);

    if (rawUrl.startsWith("/")) {
      const mockResponder = getMockResponder?.();
      if (mockResponder && rawUrl.startsWith("/api/llm/adjudicate")) {
        const payload = await mockResponder(rawUrl, init);
        return jsonResponse(payload);
      }
      return originalFetch(`${base}${rawUrl}`, init);
    }

    return originalFetch(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function normalizeTerrain(rawTerrain) {
  if (rawTerrain?.map?.cells) return rawTerrain.map;
  if (rawTerrain?.cells) return rawTerrain;
  throw new Error("Terrain file does not contain a map or cells object");
}

function loadCachedTerrain(mapPath) {
  const terrainFile = path.resolve(projectRoot, mapPath);
  const terrainEnvelope = JSON.parse(fs.readFileSync(terrainFile, "utf8"));
  return {
    terrainData: normalizeTerrain(terrainEnvelope),
    file: terrainFile,
    location: "Llanddeusant, Wales",
    sourceType: "cached-parse",
    bbox: terrainEnvelope?.map?.bbox || terrainEnvelope?.bbox || null,
  };
}

async function runLiveParse(scanSinglePatch, args) {
  const preset = getLiveParsePreset(args.location || "llanddeusant");
  const cellKm = Number.parseFloat(args.cellKm || preset.cellKm || "0.5") || preset.cellKm || 0.5;
  const parseResult = await scanSinglePatch(preset.bbox, cellKm, {
    onStatus: (status) => console.log(`[parse] ${status}`),
    onProgress: (progress) => {
      if (progress?.phase && progress?.total != null) {
        console.log(`[parse] ${progress.phase}: ${progress.current ?? 0}/${progress.total}`);
      }
    },
  });

  const terrainData = parserResultToTerrainData(parseResult, cellKm, preset);
  const cacheDir = path.join(reportDir, "cache");
  ensureDir(cacheDir);
  const outputPath = path.join(cacheDir, `${preset.id}_${cellKm}km_${timestampTag()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify({ map: terrainData }, null, 2)}\n`);

  return {
    terrainData,
    file: outputPath,
    location: preset.name,
    sourceType: "live-parse",
    bbox: parseResult.bbox || preset.bbox,
  };
}

function getLiveParsePreset(name) {
  const presets = {
    llanddeusant: {
      id: "llanddeusant",
      name: "Llanddeusant, Wales",
      cellKm: 0.5,
      bbox: {
        south: 51.83508444125045,
        north: 51.924915558749554,
        west: -3.8227600722644546,
        east: -3.6772399277355454,
      },
    },
  };
  const preset = presets[String(name || "").toLowerCase()];
  if (!preset) {
    throw new Error(`Unknown live parse preset: ${name}`);
  }
  return preset;
}

function parserResultToTerrainData(parseResult, cellKm, preset) {
  const cells = {};
  for (let index = 0; index < parseResult.cells.length; index += 1) {
    const cell = parseResult.cells[index];
    const col = index % parseResult.cols;
    const row = Math.floor(index / parseResult.cols);
    cells[`${col},${row}`] = {
      terrain: cell.terrain,
      elevation: cell.elevation,
      features: cell.features || [],
      infrastructure: cell.infrastructure || "none",
      attributes: cell.attributes || [],
      confidence: cell.confidence,
      feature_names: cell.feature_names,
      lat: cell.lat,
      lng: cell.lng,
      slope_angle: cell.slope_angle,
      climate_zone: cell.climate_zone,
      population: cell.population,
    };
  }

  const bbox = parseResult.bbox || preset.bbox;
  return {
    cols: parseResult.cols,
    rows: parseResult.rows,
    cellSizeKm: cellKm,
    widthKm: parseResult.cols * cellKm,
    heightKm: parseResult.rows * cellKm,
    gridType: "hex",
    center: {
      lat: (bbox.south + bbox.north) / 2,
      lng: (bbox.west + bbox.east) / 2,
    },
    bbox,
    cells,
  };
}
function analyzeTerrain(terrainData) {
  const cells = Object.entries(terrainData.cells || {}).map(([key, cell]) => {
    const [col, row] = key.split(",").map(Number);
    const features = Array.isArray(cell.features) ? cell.features : [];
    return {
      key,
      col,
      row,
      terrain: cell.terrain || "unknown",
      infrastructure: cell.infrastructure || "none",
      elevation: Number.isFinite(Number(cell.elevation)) ? Number(cell.elevation) : 0,
      features,
    };
  });

  const primaryObjective = chooseCell(cells, (cell) => {
    let score = 0;
    if (cell.infrastructure === "dam" || cell.features.includes("dam")) score += 500;
    if (cell.infrastructure === "bridge" || cell.features.includes("bridge")) score += 400;
    if (cell.features.includes("town")) score += 200;
    if (cell.features.includes("saddle")) score += 120;
    if (cell.features.includes("elevation_advantage")) score += 80;
    if (cell.infrastructure === "trail") score += 25;
    score -= Math.abs(cell.col - Math.floor(terrainData.cols / 2));
    return score;
  });

  if (!primaryObjective) {
    throw new Error("Failed to identify a primary objective on the cached terrain");
  }

  const townObjective = chooseCell(cells, (cell) => {
    if (!cell.features.includes("town")) return Number.NEGATIVE_INFINITY;
    return 200 - hexDistance(cell, primaryObjective);
  }) || primaryObjective;

  const highGroundObjective = chooseCell(cells, (cell) => {
    if (cell.key === primaryObjective.key) return Number.NEGATIVE_INFINITY;
    if (cell.col <= primaryObjective.col) return Number.NEGATIVE_INFINITY;
    if (cell.features.includes("river")) return Number.NEGATIVE_INFINITY;
    const distance = hexDistance(cell, primaryObjective);
    if (distance < 1 || distance > 6) return Number.NEGATIVE_INFINITY;
    let score = cell.elevation;
    if (cell.features.includes("saddle")) score += 200;
    if (cell.features.includes("elevation_advantage")) score += 100;
    if (cell.features.includes("cliffs")) score += 50;
    score -= distance * 15;
    return score;
  }) || primaryObjective;

  const supportObjective = chooseCell(cells, (cell) => {
    if (cell.key === primaryObjective.key) return Number.NEGATIVE_INFINITY;
    if (cell.col >= primaryObjective.col) return Number.NEGATIVE_INFINITY;
    if (cell.features.includes("river")) return Number.NEGATIVE_INFINITY;
    const distance = hexDistance(cell, primaryObjective);
    if (distance < 1 || distance > 4) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (cell.infrastructure === "trail") score += 150;
    if (cell.features.includes("rough_terrain")) score += 40;
    if (cell.features.includes("cliffs")) score += 30;
    score -= distance * 10;
    return score;
  }) || townObjective;

  const deployments = chooseDeployments(cells, primaryObjective);

  return {
    cols: terrainData.cols,
    rows: terrainData.rows,
    cellSizeKm: terrainData.cellSizeKm,
    primaryObjective,
    townObjective,
    highGroundObjective,
    supportObjective,
    deployments,
  };
}

function chooseDeployments(cells, objective) {
  const used = new Set([objective.key]);
  const roles = [
    ["1st Recon (Shadow)", { side: "west", minDist: 2, maxDist: 5, preferTrail: true, preferHigh: false, rowOffset: -1 }],
    ["Alpha Company",      { side: "west", minDist: 2, maxDist: 4, preferTrail: true, preferHigh: false, rowOffset: 0 }],
    ["Bravo Company",      { side: "west", minDist: 2, maxDist: 4, preferTrail: true, preferHigh: false, rowOffset: 1 }],
    ["1st Armor (Steel)",  { side: "west", minDist: 3, maxDist: 5, preferTrail: true, preferHigh: false, rowOffset: 0 }],
    ["Thunder Battery",    { side: "west", minDist: 5, maxDist: 9, preferTrail: true, preferHigh: false, rowOffset: 2 }],
    ["Blue HQ (Citadel)",  { side: "west", minDist: 6, maxDist: 10, preferTrail: true, preferHigh: false, rowOffset: 3 }],
    ["Viper Recon",        { side: "east", minDist: 2, maxDist: 4, preferTrail: false, preferHigh: true, rowOffset: -1 }],
    ["Red Guard Platoon",  { side: "east", minDist: 1, maxDist: 3, preferTrail: false, preferHigh: true, rowOffset: 0 }],
    ["Sentinel Platoon",   { side: "east", minDist: 2, maxDist: 5, preferTrail: false, preferHigh: true, rowOffset: 2 }],
    ["Iron Fist Troop",    { side: "east", minDist: 3, maxDist: 5, preferTrail: false, preferHigh: true, rowOffset: 1 }],
    ["Hammer Battery",     { side: "east", minDist: 5, maxDist: 9, preferTrail: false, preferHigh: true, rowOffset: 3 }],
    ["Red HQ (Bastion)",   { side: "east", minDist: 6, maxDist: 10, preferTrail: false, preferHigh: true, rowOffset: 2 }],
  ];

  const assignments = {};
  for (const [unitName, role] of roles) {
    const picked = chooseCell(cells, (cell) => deploymentScore(cell, objective, role, used));
    if (!picked) {
      throw new Error(`Could not find a deployment hex for ${unitName}`);
    }
    used.add(picked.key);
    assignments[unitName] = picked.key;
  }
  return assignments;
}

function deploymentScore(cell, objective, role, used) {
  if (used.has(cell.key)) return Number.NEGATIVE_INFINITY;
  if (cell.key === objective.key) return Number.NEGATIVE_INFINITY;
  if (cell.features.includes("river")) return Number.NEGATIVE_INFINITY;
  if (cell.infrastructure === "dam") return Number.NEGATIVE_INFINITY;

  const distance = hexDistance(cell, objective);
  if (distance < role.minDist || distance > role.maxDist) return Number.NEGATIVE_INFINITY;

  if (role.side === "west" && cell.col >= objective.col) return Number.NEGATIVE_INFINITY;
  if (role.side === "east" && cell.col <= objective.col) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (role.preferTrail && cell.infrastructure === "trail") score += 80;
  if (role.preferHigh) {
    score += cell.elevation / 3;
  } else {
    score -= cell.elevation / 10;
  }
  if (cell.features.includes("saddle")) score += 60;
  if (cell.features.includes("elevation_advantage")) score += 35;
  if (cell.features.includes("treeline")) score += 20;
  if (cell.features.includes("rough_terrain")) score += role.preferHigh ? 10 : 4;
  score -= Math.abs((cell.row - objective.row) - role.rowOffset) * 9;
  score -= distance * 12;
  return score;
}

function buildScenario(basePreset, terrainAnalysis) {
  const scenario = JSON.parse(JSON.stringify(basePreset));
  const objectiveLabel = labelFromKey(terrainAnalysis.primaryObjective.key);
  const supportLabel = labelFromKey(terrainAnalysis.supportObjective.key);
  const townLabel = labelFromKey(terrainAnalysis.townObjective.key);
  const highGroundLabel = labelFromKey(terrainAnalysis.highGroundObjective.key);

  scenario.title = "Llanddeusant Dam Crossing Smoke";
  scenario.description = "A reusable one-turn smoke scenario built on a cached real-world parse of Llanddeusant, Wales. Blue attacks along the western trail network to seize the dam while Red holds the eastern high ground.";
  scenario.initialConditions = `Early morning. Visibility is moderate over broken highland terrain. The dam at ${objectiveLabel} is the critical crossing and observation point. The town at ${townLabel} anchors Blue's western approach while Red's best defensive high ground lies around ${highGroundLabel}.`;
  scenario.specialRules = `The dam at ${objectiveLabel} is treated as the decisive objective. Trail hexes accelerate approach, rough terrain slows support weapons, and the high ground around ${highGroundLabel} offers defenders strong observation over the crossing.`;
  scenario.startDate = "2026-03-11";
  scenario.turnDuration = "4 hours";
  scenario.environment = {
    weather: "overcast",
    visibility: "moderate",
    groundCondition: "wet",
    timeOfDay: "morning",
    climate: "temperate",
    stability: "medium",
    severity: "moderate",
  };

  scenario.actors = [
    {
      ...scenario.actors[0],
      objectives: [
        `Seize the dam at ${objectiveLabel}`,
        `Secure the western trail junction at ${townLabel}`,
        `Push a support-by-fire element onto ${supportLabel}`,
      ],
      constraints: [
        "Do not wreck the dam with your own fires",
        "Keep the HQ and artillery west of the objective",
      ],
      cvpHexes: [terrainAnalysis.primaryObjective.key, terrainAnalysis.townObjective.key],
    },
    {
      ...scenario.actors[1],
      objectives: [
        `Hold the dam complex at ${objectiveLabel}`,
        `Retain control of the eastern high ground near ${highGroundLabel}`,
        "Disrupt Blue's western approach with artillery and counterattack pressure",
      ],
      constraints: [
        "Do not abandon the high ground before contact is made",
        "Preserve artillery for at least one more turn of fire missions",
      ],
      cvpHexes: [terrainAnalysis.primaryObjective.key, terrainAnalysis.highGroundObjective.key],
    },
  ];

  scenario.victoryConditions = {
    type: "vp",
    vpGoal: 40,
    hexVP: [
      { hex: terrainAnalysis.primaryObjective.key, name: `Dam (${objectiveLabel})`, vp: 25 },
      { hex: terrainAnalysis.highGroundObjective.key, name: `Eastern High Ground (${highGroundLabel})`, vp: 10 },
      { hex: terrainAnalysis.townObjective.key, name: `Trail Junction (${townLabel})`, vp: 5 },
    ],
  };

  scenario.units = scenario.units.map((unit) => ({
    ...unit,
    position: terrainAnalysis.deployments[unit.name] || unit.position,
    notes: `${unit.notes || ""} [Smoke test deployment]`.trim(),
  }));

  return scenario;
}

function buildSealedOrders(gameState, terrainAnalysis) {
  const primary = terrainAnalysis.primaryObjective.key;
  const support = terrainAnalysis.supportObjective.key;
  const town = terrainAnalysis.townObjective.key;
  const highGround = terrainAnalysis.highGroundObjective.key;

  const ordersByName = {
    "1st Recon (Shadow)": {
      movementOrder: { id: "MOVE", target: support },
      actionOrder: { id: "RECON", target: primary },
      intent: "Probe the dam approaches and confirm the defender layout.",
    },
    "Alpha Company": {
      movementOrder: { id: "MOVE", target: primary },
      actionOrder: { id: "ATTACK", target: primary },
      intent: "Close on the dam and force Red Guard off the objective.",
    },
    "Bravo Company": {
      movementOrder: { id: "MOVE", target: support },
      actionOrder: { id: "SUPPORT_FIRE", target: primary },
      intent: "Support Alpha's push with suppressive fires from the western ridge.",
    },
    "1st Armor (Steel)": {
      movementOrder: { id: "MOVE", target: support },
      actionOrder: { id: "ATTACK", target: highGround },
      intent: "Threaten the eastern high ground and pin Iron Fist in place.",
    },
    "Thunder Battery": {
      movementOrder: null,
      actionOrder: { id: "FIRE_MISSION", target: highGround },
      intent: "Drop artillery onto the eastern crest to break Red overwatch.",
    },
    "Blue HQ (Citadel)": {
      movementOrder: null,
      actionOrder: { id: "DEFEND", target: town },
      intent: "Hold the western trail junction and keep the assault organized.",
    },
    "Viper Recon": {
      movementOrder: { id: "MOVE", target: highGround },
      actionOrder: { id: "RECON", target: support },
      intent: "Screen the eastern slope and keep eyes on the western approach.",
    },
    "Red Guard Platoon": {
      movementOrder: { id: "MOVE", target: primary },
      actionOrder: { id: "DEFEND", target: primary },
      intent: "Anchor the dam complex and absorb Blue's first assault wave.",
    },
    "Sentinel Platoon": {
      movementOrder: { id: "MOVE", target: highGround },
      actionOrder: { id: "DIG_IN", target: highGround },
      intent: "Deepen defensive works on the eastern crest and hold the observation line.",
    },
    "Iron Fist Troop": {
      movementOrder: { id: "MOVE", target: support },
      actionOrder: { id: "ATTACK", target: support },
      intent: "Counterattack toward the western support-by-fire position if Blue overextends.",
    },
    "Hammer Battery": {
      movementOrder: null,
      actionOrder: { id: "FIRE_MISSION", target: support },
      intent: "Break up Blue's assault support before it can mass on the dam.",
    },
    "Red HQ (Bastion)": {
      movementOrder: null,
      actionOrder: { id: "DEFEND", target: highGround },
      intent: "Maintain control of the eastern high ground and preserve cohesion.",
    },
  };

  const actorMap = {};
  for (const actor of gameState.scenario.actors) {
    const actorUnits = gameState.units.filter((unit) => unit.actor === actor.id);
    actorMap[actor.id] = {
      unitOrders: {},
      actorIntent: actor.id === "actor_1"
        ? "Seize the dam quickly before Red's position hardens."
        : "Hold the dam and eastern heights through the first Blue probe.",
    };
    for (const unit of actorUnits) {
      actorMap[actor.id].unitOrders[unit.id] = ordersByName[unit.name] || {
        movementOrder: null,
        actionOrder: null,
        intent: "",
      };
    }
  }

  return actorMap;
}

function buildPlayerActions(actors, orders, units, positionToLabel) {
  const result = {};
  for (const actor of actors) {
    const actorOrders = orders[actor.id] || {};
    const actorUnits = units.filter((unit) => unit.actor === actor.id);
    const lines = [];

    for (const unit of actorUnits) {
      const unitOrders = actorOrders[unit.id];
      if (!unitOrders || (!unitOrders.movementOrder && !unitOrders.actionOrder)) {
        lines.push(`${unit.name}: HOLD`);
        continue;
      }

      const steps = [];
      if (unitOrders.movementOrder?.target) {
        steps.push(`${unitOrders.movementOrder.id} to ${positionToLabel(unitOrders.movementOrder.target)}`);
      }
      if (unitOrders.actionOrder?.id) {
        const target = unitOrders.actionOrder.target
          ? ` at ${positionToLabel(unitOrders.actionOrder.target)}`
          : "";
        steps.push(`${unitOrders.actionOrder.id}${target}`);
      }

      lines.push(`${unit.name}: ${steps.join(" then ")}`);
      if (unitOrders.intent) {
        lines.push(`  Intent: ${unitOrders.intent}`);
      }
    }

    result[actor.id] = lines.join("\n");
  }
  return result;
}

function buildDetectionContext(visibility, movement) {
  const actorVisibility = {};
  for (const [actorId, av] of Object.entries(visibility.actorVisibility || {})) {
    actorVisibility[actorId] = {
      visibleCells: [...(av.visibleCells || [])],
      detectedUnits: [...(av.detectedUnits || [])],
      contactUnits: [...(av.contactUnits || [])],
      detectionDetails: av.detectionDetails || {},
      lastKnown: av.lastKnown || {},
      movePaths: [],
    };
  }
  return {
    actorVisibility,
    contactEvents: movement.contactEvents || [],
  };
}

function buildMockLlmPayload(context) {
  const unitById = new Map(context.gameState.units.map((unit) => [unit.id, unit]));
  const stateUpdates = [];

  for (const unit of context.gameState.units) {
    const unitOrders = context.sealedOrders[unit.actor]?.unitOrders?.[unit.id];
    const path = context.movement.unitPaths?.[unit.id] || [unit.position];
    const finalPosition = path[path.length - 1] || unit.position;
    const movementJustification = unitOrders?.movementOrder
      ? `${unit.name} executed its planned move toward ${labelFromKey(finalPosition)} over realistic terrain.`
      : `${unit.name} held position to support the developing action.`;

    stateUpdates.push({
      entity: unit.name,
      attribute: "position",
      old_value: unit.position,
      new_value: finalPosition,
      justification: movementJustification,
    });
  }

  pushUnitUpdate(stateUpdates, unitById, "Alpha Company", "strength", 94, "Red Guard's close defense and artillery fragments blunted the assault at the dam.");
  pushUnitUpdate(stateUpdates, unitById, "Alpha Company", "ammo", 88, "Alpha Company expended ammunition aggressively during the push onto the objective.");
  pushUnitUpdate(stateUpdates, unitById, "Alpha Company", "status", "engaged", "Alpha Company is now in direct contact at the dam.");
  pushUnitUpdate(stateUpdates, unitById, "Bravo Company", "ammo", 92, "Bravo Company fired sustained supporting bursts into the eastern slope.");
  pushUnitUpdate(stateUpdates, unitById, "1st Armor (Steel)", "status", "engaged", "Iron Fist's counter-movement forced Steel to deploy into contact.");
  pushUnitUpdate(stateUpdates, unitById, "1st Armor (Steel)", "ammo", 90, "Steel fired on eastern positions while screening Alpha's advance.");
  pushUnitUpdate(stateUpdates, unitById, "Thunder Battery", "ammo", 78, "Thunder Battery completed a full fire mission onto the eastern crest.");
  pushUnitUpdate(stateUpdates, unitById, "Red Guard Platoon", "strength", 82, "Alpha and Bravo's combined pressure shook the primary defense on the dam.");
  pushUnitUpdate(stateUpdates, unitById, "Red Guard Platoon", "ammo", 84, "Red Guard burned ammunition holding the objective under direct assault.");
  pushUnitUpdate(stateUpdates, unitById, "Red Guard Platoon", "status", "damaged", "The platoon remains on line but took noticeable losses around the dam.");
  pushUnitUpdate(stateUpdates, unitById, "Sentinel Platoon", "entrenchment", 70, "Sentinel improved its fighting positions on the eastern crest during the opening phase.");
  pushUnitUpdate(stateUpdates, unitById, "Iron Fist Troop", "status", "engaged", "Iron Fist committed early into the support corridor to contest Blue's flank.");
  pushUnitUpdate(stateUpdates, unitById, "Iron Fist Troop", "ammo", 87, "Iron Fist exchanged fire with Blue support elements while moving into the fight.");
  pushUnitUpdate(stateUpdates, unitById, "Hammer Battery", "ammo", 76, "Hammer Battery fired preplanned missions onto Blue's western support area.");
  pushUnitUpdate(stateUpdates, unitById, "Viper Recon", "status", "engaged", "Viper Recon remained under observation pressure while screening the eastern slope.");

  stateUpdates.push({
    entity: "terrain",
    attribute: context.objectiveLabel,
    old_value: null,
    new_value: { type: "smoke", turnsRemaining: 2 },
    justification: `Artillery from both sides threw smoke and dust over the dam at ${context.objectiveLabel}.`,
  });

  return {
    ok: true,
    content: JSON.stringify({
      adjudication: {
        situation_assessment: {
          current_state_summary: `Blue is pushing from the western trail network toward the dam at ${context.objectiveLabel}, while Red is trying to hold the objective from the eastern high ground.`,
          key_terrain_factors: `The dam at ${context.objectiveLabel} is the decisive crossing, ${context.supportLabel} is the main western support position, ${context.townLabel} anchors Blue's rear, and ${context.highGroundLabel} dominates the eastern approach.`,
          active_conditions: ["Moderate visibility", "Broken highland terrain", "Both sides began the turn in organized combat formations"],
        },
        action_interpretation: {
          actions_received: Object.entries(context.playerActions).map(([actor, actionSummary]) => ({
            actor,
            action_summary: actionSummary,
            intent_assessment: actor === "actor_1"
              ? "Blue aims to seize the dam quickly with a supported frontal thrust."
              : "Red intends to hold the crossing while disrupting Blue's support position.",
          })),
        },
        feasibility_analysis: {
          assessments: [
            {
              actor: "actor_1",
              action: "Blue assault on the dam",
              feasibility: "moderate",
              reasoning: "The western trail network allows a focused approach, but the final dam assault remains exposed to direct and indirect fire.",
              citations: ["[terrain: cached_llanddeusant_map]", "[orders: blue_turn_1]"],
              weaknesses_identified: ["Blue must cross exposed ground near the objective before it can consolidate."],
            },
            {
              actor: "actor_2",
              action: "Red defense and immediate counterpressure",
              feasibility: "high",
              reasoning: "Red starts on the better ground and can mass defensive fires onto a narrow western approach.",
              citations: ["[terrain: eastern_high_ground]", "[orders: red_turn_1]"],
              weaknesses_identified: ["Red's forward platoon risks being isolated if the dam position is breached."],
            },
          ],
        },
        outcome_determination: {
          narrative: `Blue closed from ${context.townLabel} toward ${context.supportLabel} and the dam at ${context.objectiveLabel}, using Thunder Battery to pound the eastern crest. Alpha Company reached the objective under smoke and artillery disruption, but Red Guard and Iron Fist held enough local combat power to keep the crossing contested. Sentinel improved its eastern positions around ${context.highGroundLabel}, and both batteries expended a meaningful share of their opening ammunition. By the end of the turn, Blue had gained contact and partial footholds west of the dam, but Red still prevented a clean seizure of the crossing.`,
          outcome_type: "partial_success",
          probability_assessment: "This was a plausible result given the narrow approach, the defender's elevation advantage, and the amount of supporting fire both sides committed.",
          key_interactions: "Blue's coordinated assault and artillery suppressed the eastern defenders, but Red's early counterpressure prevented a decisive breakthrough.",
        },
        actor_perspectives: {
          actor_1: {
            narrative: `Blue sees the dam shrouded in dust and smoke, with Red Guard still contesting the objective and enemy armor appearing near ${context.supportLabel}.`,
            known_enemy_actions: "Observed Red artillery impacts on the western support position and a local armored counter-movement from the east.",
            intel_assessment: "The crossing is not secured, but Red has already committed important assets.",
            detection_resolutions: [],
          },
          actor_2: {
            narrative: `Red sees Blue massing on the western trail network and pushing directly onto the dam while artillery tries to strip away the eastern overwatch position.`,
            known_enemy_actions: "Observed Blue artillery on the eastern crest and a supported infantry move onto the objective.",
            intel_assessment: "Blue is committed to the dam approach and likely to renew the attack next turn.",
            detection_resolutions: [],
          },
        },
        state_updates: stateUpdates,
      },
      meta: {
        confidence: "high",
        notes: "Mock adjudication used for deterministic smoke validation.",
      },
    }),
    usage: { input: 0, output: 0 },
    model: "mock-one-turn",
    stop_reason: "end_turn",
  };
}

function pushUnitUpdate(updates, unitById, unitName, attribute, newValue, justification) {
  const unit = [...unitById.values()].find((candidate) => candidate.name === unitName);
  if (!unit) return;
  updates.push({
    entity: unit.name,
    attribute,
    old_value: unit[attribute],
    new_value: newValue,
    justification,
  });
}

function normalizeStateUpdateEntities(adjudicationResponse, gameState) {
  const nameMap = new Map(gameState.units.map((unit) => [unit.name.toLowerCase(), unit.id]));
  const updates = adjudicationResponse?.adjudication?.state_updates || [];
  for (const update of updates) {
    const id = nameMap.get(String(update.entity || "").toLowerCase());
    if (id) {
      update.entity = id;
    }
  }
}

function buildChecks(context) {
  const checks = [];
  const updatedUnitCount = countUpdatedUnits(context.adjudicationResult.adjudication);
  const totalUnits = context.reloadedGameState.units.length;
  const primaryControl = context.finalReloadedGameState.game?.vpControl?.[context.terrainAnalysis.primaryObjective.key];
  const isLiveOutcomeCheck = context.args.liveLlm || context.terrainSource?.sourceType === "live-parse";

  pushCheck(checks, "Terrain round-trip dims match", context.loadedTerrain.cols === context.terrainData.cols && context.loadedTerrain.rows === context.terrainData.rows);
  pushCheck(checks, "Terrain round-trip cell count matches", Object.keys(context.loadedTerrain.cells || {}).length === Object.keys(context.terrainData.cells || {}).length);
  pushCheck(checks, "Initial state persisted and reloaded", context.reloadedGameState.game.folder === context.initialGameState.game.folder);
  pushCheck(checks, "Adjudication returned structured data", Boolean(context.adjudicationResult.adjudication?.adjudication?.state_updates?.length));
  pushCheck(
    checks,
    isLiveOutcomeCheck ? "Live adjudication updated a broad slice of the roster" : "All twelve units received at least one update",
    isLiveOutcomeCheck ? updatedUnitCount >= Math.max(8, Math.ceil(totalUnits * 0.6)) : updatedUnitCount === totalUnits
  );
  pushCheck(checks, "Turn log entry recorded", (context.updatedGameState.turnLog || []).length === 1);
  pushCheck(checks, "Turn advanced to 2", context.advancedGameState.game.turn === 2);
  pushCheck(checks, "Final state saved and reloaded", context.finalReloadedGameState.game.turn === 2);
  pushCheck(
    checks,
    isLiveOutcomeCheck ? "Primary objective control resolved" : "Dam objective remains contested after turn 1",
    isLiveOutcomeCheck ? primaryControl !== undefined && primaryControl !== null : unitAtHex(context.updatedGameState.units, context.terrainAnalysis.primaryObjective.key, "actor_1") && unitAtHex(context.updatedGameState.units, context.terrainAnalysis.primaryObjective.key, "actor_2")
  );
  return checks;
}

function countUpdatedUnits(adjudicationResponse) {
  const updates = adjudicationResponse?.adjudication?.state_updates || [];
  return new Set(
    updates
      .filter((update) => update.entity !== "terrain" && update.entity !== "diplomacy")
      .map((update) => update.entity)
  ).size;
}

function unitAtHex(units, hex, actorId) {
  return units.some((unit) => unit.actor === actorId && unit.position === hex && unit.status !== "destroyed" && unit.status !== "eliminated");
}

function buildSummary(context) {
  const updates = context.adjudicationResult.adjudication?.adjudication?.state_updates || [];
  const changedUnits = summarizeChangedUnits(context.finalReloadedGameState.units, updates);
  const narrative = context.adjudicationResult.adjudication?.adjudication?.outcome_determination?.narrative || "";
  const outcomeType = context.adjudicationResult.adjudication?.adjudication?.outcome_determination?.outcome_type || "unknown";

  return {
    ok: context.checks.every((check) => check.pass),
    status: context.checks.every((check) => check.pass) ? "passed" : "failed",
    timestamp: new Date().toISOString(),
    mode: context.terrainSource.sourceType === "live-parse"
      ? (context.args.liveLlm ? "live-parse-live-llm" : "live-parse-mock-llm")
      : (context.args.liveLlm ? "live-llm" : "mock-llm"),
    terrainSource: {
      file: context.terrainSource.file || context.terrainFile,
      location: context.terrainSource.location,
      sourceType: context.terrainSource.sourceType,
      cellSizeKm: context.terrainData.cellSizeKm,
      cols: context.terrainData.cols,
      rows: context.terrainData.rows,
      bbox: context.terrainSource.bbox || null,
    },
    scenario: {
      title: context.scenario.title,
      scale: context.scenario.scale,
      folder: context.folder,
      turnStarted: context.updatedGameState.game.turn,
      turnEnded: context.advancedGameState.game.turn,
    },
    llm: context.llmConfig,
    objectives: {
      primary: formatObjective(context.terrainAnalysis.primaryObjective),
      support: formatObjective(context.terrainAnalysis.supportObjective),
      town: formatObjective(context.terrainAnalysis.townObjective),
      highGround: formatObjective(context.terrainAnalysis.highGroundObjective),
    },
    checks: context.checks,
    contactEvents: (context.movement.contactEvents || []).length,
    orders: summarizeOrders(context.sealedOrders, context.updatedGameState.units),
    adjudication: {
      outcomeType,
      narrative,
      updateCount: updates.length,
      changedUnits,
    },
    finalState: {
      turn: context.finalReloadedGameState.game.turn,
      currentDate: context.finalReloadedGameState.game.currentDate,
      turnLogEntries: (context.finalReloadedGameState.turnLog || []).length,
      terrainMods: context.finalReloadedGameState.terrainMods || {},
      changedUnits,
    },
  };
}

function summarizeChangedUnits(units, updates) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const grouped = new Map();

  for (const update of updates) {
    if (!unitById.has(update.entity)) continue;
    if (!grouped.has(update.entity)) {
      grouped.set(update.entity, {
        id: update.entity,
        name: unitById.get(update.entity).name,
        actor: unitById.get(update.entity).actor,
        changes: [],
      });
    }
    grouped.get(update.entity).changes.push({
      attribute: update.attribute,
      oldValue: update.old_value,
      newValue: update.new_value,
    });
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeOrders(sealedOrders, units) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const summary = [];

  for (const [actorId, sealed] of Object.entries(sealedOrders)) {
    for (const [unitId, orders] of Object.entries(sealed.unitOrders || {})) {
      const unit = unitById.get(unitId);
      if (!unit) continue;
      summary.push({
        actorId,
        unit: unit.name,
        movement: orders.movementOrder || null,
        action: orders.actionOrder || null,
        intent: orders.intent || "",
      });
    }
  }

  return summary;
}

function clampPositionFromPath(unit, path) {
  const movementBudgets = {
    foot: 3,
    wheeled: 5,
    tracked: 4,
    air: 8,
    naval: 6,
    amphibious: 4,
    static: 0,
  };
  const effectivePath = Array.isArray(path) && path.length > 0 ? path : [unit.position];
  const budget = movementBudgets[unit.movementType || "foot"] ?? 3;
  const index = Math.min(effectivePath.length - 1, budget);
  return effectivePath[index] || unit.position;
}
function renderMarkdownReport(summary) {
  const lines = [];
  lines.push("# One-Turn Smoke Report");
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Time: ${summary.timestamp}`);
  lines.push(`- Mode: ${summary.mode}`);
  lines.push(`- Scenario: ${summary.scenario.title}`);
  lines.push(`- Terrain: ${summary.terrainSource.location} (${summary.terrainSource.cellSizeKm} km cells, ${summary.terrainSource.cols}x${summary.terrainSource.rows})`);
  lines.push(`- Folder: ${summary.scenario.folder}`);
  lines.push(`- LLM: ${summary.llm.provider}/${summary.llm.model}`);
  lines.push("");
  lines.push("## Objectives");
  lines.push("");
  lines.push(`- Primary: ${summary.objectives.primary.name}`);
  lines.push(`- Support: ${summary.objectives.support.name}`);
  lines.push(`- Town: ${summary.objectives.town.name}`);
  lines.push(`- High Ground: ${summary.objectives.highGround.name}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  for (const check of summary.checks) {
    lines.push(`- ${check.pass ? "[pass]" : "[fail]"} ${check.name}`);
  }
  lines.push("");
  lines.push("## Adjudication");
  lines.push("");
  lines.push(`- Outcome: ${summary.adjudication.outcomeType}`);
  lines.push(`- Contact events: ${summary.contactEvents}`);
  lines.push(`- State updates: ${summary.adjudication.updateCount}`);
  lines.push("");
  lines.push(summary.adjudication.narrative);
  lines.push("");
  lines.push("## Unit Changes");
  lines.push("");
  for (const unit of summary.adjudication.changedUnits) {
    const changeText = unit.changes.map((change) => `${change.attribute}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`).join("; ");
    lines.push(`- ${unit.name}: ${changeText}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This baseline uses a cached real-world terrain parse so the test remains deterministic.");
  lines.push("- Mock mode validates the sim plumbing, not the creative quality of a real provider's narrative.");
  return lines.join("\n");
}

function printConsoleSummary(summary) {
  console.log("");
  console.log(`[smoke] status: ${summary.status}`);
  console.log(`[smoke] scenario: ${summary.scenario.title}`);
  console.log(`[smoke] terrain: ${summary.terrainSource.location} (${summary.terrainSource.cellSizeKm} km, ${summary.terrainSource.cols}x${summary.terrainSource.rows})`);
  console.log(`[smoke] llm: ${summary.llm.provider}/${summary.llm.model}`);
  console.log(`[smoke] folder: ${summary.scenario.folder}`);
  console.log(`[smoke] checks: ${summary.checks.filter((check) => check.pass).length}/${summary.checks.length} passed`);
  console.log(`[smoke] report: ${latestReportPath}`);
  console.log(`[smoke] summary: ${latestSummaryPath}`);
  console.log("");
}

async function pickLiveProvider(getProviders) {
  const response = await getProviders();
  const providers = response.providers || [];
  const preferred = [
    ["anthropic", "claude-sonnet-4-6"],
    ["openai", "gpt-4o"],
    ["openai", "gpt-4o-mini"],
  ];

  for (const [providerId, modelId] of preferred) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    const model = provider?.models?.find((candidate) => candidate.id === modelId);
    if (provider && model) {
      return {
        provider: provider.id,
        model: model.id,
        temperature: model.temperature ?? 0.4,
      };
    }
  }

  const firstProvider = providers[0];
  const firstModel = firstProvider?.models?.[0];
  if (!firstProvider || !firstModel) {
    throw new Error("No live LLM provider is configured for --live-llm");
  }

  return {
    provider: firstProvider.id,
    model: firstModel.id,
    temperature: firstModel.temperature ?? 0.4,
  };
}

async function saveArtifact(folder, filename, data) {
  const response = await fetch("/api/game/save-artifact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, filename, data }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save artifact ${filename}`);
  }
}

function formatObjective(cell) {
  return {
    key: cell.key,
    label: labelFromKey(cell.key),
    name: `${labelFromKey(cell.key)} (${cell.terrain}, ${cell.infrastructure})`,
    elevation: cell.elevation,
    features: cell.features,
  };
}

function pushCheck(checks, name, pass) {
  checks.push({ name, pass: Boolean(pass) });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function chooseCell(cells, scorer) {
  let bestCell = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const score = scorer(cell);
    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }
  return bestCell;
}

function hexDistance(a, b) {
  const aq = a.col - (a.row - (a.row & 1)) / 2;
  const bq = b.col - (b.row - (b.row & 1)) / 2;
  const dq = aq - bq;
  const dr = a.row - b.row;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function labelFromKey(key) {
  const [colRaw, rowRaw] = String(key).split(",");
  let col = Number.parseInt(colRaw, 10);
  const row = Number.parseInt(rowRaw, 10) + 1;
  let label = "";
  while (col >= 0) {
    label = String.fromCharCode(65 + (col % 26)) + label;
    col = Math.floor(col / 26) - 1;
  }
  return `${label}${row}`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}


