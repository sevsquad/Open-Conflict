// ════════════════════════════════════════════════════════════════
// PRESETS — Pre-built scenarios for quick simulation testing
// ════════════════════════════════════════════════════════════════

import { isAirUnit } from "./orderTypes.js";

let presetCounter = 0;
function uid() { return `unit_preset_${++presetCounter}`; }

// Air-capable units get additional fields for readiness, fuel, munitions, baseHex, airProfile.
// Called by factory functions to enrich air units automatically.
function addAirFields(unit, overrides) {
  if (!isAirUnit(unit)) return unit;
  return {
    ...unit,
    readiness: overrides.readiness ?? 85,
    munitions: overrides.munitions ?? 100,
    fuel: overrides.fuel ?? 100,
    baseHex: overrides.baseHex || unit.position, // Default: based at starting position
    airProfile: overrides.airProfile || {
      speed: unit.movementType === "helicopter" ? "slow" : "medium",
      maneuverability: 6,
      weaponsPackage: "precision_guided",
      defensiveArmament: false,
      ecm: false,
      radarEquipped: false,
    },
  };
}

// ── Preset Registry ──────────────────────────────────────────────
// Each entry maps a preset to the map it requires.
// mapType: "test-fixture" = built-in test grid
//          "saves"     = requires map file from saves/ (substring match on requiredMap)
//          "built-in"  = has a map generator in preset-maps/ (auto-loaded)
// requiredMap: used for "saves" type (substring match against filename), or display name for "built-in"

const PRESET_REGISTRY = [
  {
    id: "river_crossing_v2",
    name: "Contested River Crossing",
    description: "Cold War 1985. US 3rd MID attacks north to secure the Stonebrook Bridge and coastal port. Soviet 47th MRD (understrength) + 11th Air Assault Brigade defends.",
    era: "cold_war",
    scale: "grand_tactical",
    mapType: "built-in",
    requiredMap: "river_crossing_v2",
    getPreset: () => getRiverCrossingV2Preset(),
  },
  {
    id: "bastogne_1944",
    name: "Battle of Bastogne (Dec 21–26, 1944)",
    description: "101st Airborne + CCB/10th AD defend the Bastogne perimeter against 26th VGD and elements of Panzer Lehr.",
    era: "ww2",
    scale: "grand_tactical",
    mapType: "saves",
    requiredMap: "Bastogne",
    getPreset: () => getBastognePreset(),
  },
  {
    id: "escarpment_assault",
    name: "Escarpment Assault (Wales, 1944)",
    description: "Blue Force must cross open moorland and assault a defended escarpment. Red Force holds the high ground with fewer units but devastating terrain advantage.",
    era: "ww2",
    scale: "grand_tactical",
    mapType: "saves",
    requiredMap: "Llanddeusant",
    getPreset: () => getEscarpmentPreset(),
  },
  // ── NEW PRESETS ──────────────────────────────────────────────
  {
    id: "signal_station",
    name: "Signal Station Nightfall",
    description: "SOF team infiltrates a hilltop communications relay at night. Security platoon defends. Tests detection, stealth, fatigue, and building-level combat.",
    era: "modern",
    scale: "sub_tactical",
    mapType: "built-in",
    requiredMap: "signal_station",
    getPreset: () => getSignalStationPreset(),
  },
  {
    id: "bocage_breakout",
    name: "Bocage Breakout (Normandy, 1944)",
    description: "US reinforced rifle company attacks through deadly hedgerow country near Saint-Lô. German defenders exploit interlocking fields of fire and pre-registered mortars.",
    era: "ww2",
    scale: "tactical",
    mapType: "built-in",
    requiredMap: "bocage_breakout",
    getPreset: () => getBocagePreset(),
  },
  {
    id: "fulda_gap",
    name: "Red Storm: Fulda Gap (1985)",
    description: "Soviet motor rifle regiment attacks through the Fulda corridor. US armored brigade defends in depth using AirLand Battle doctrine. Tests supply, C2, and combined arms.",
    era: "cold_war",
    scale: "grand_tactical",
    mapType: "built-in",
    requiredMap: "fulda_gap",
    getPreset: () => getFuldaGapPreset(),
  },
  {
    id: "mosul_corridor",
    name: "Mosul Corridor (2017)",
    description: "Coalition mechanized company secures a corridor through contested urban fringe. Irregular defenders use IEDs, SVBIEDs, and ambush tactics. Tests asymmetric warfare and ISR.",
    era: "modern",
    scale: "tactical",
    mapType: "built-in",
    requiredMap: "mosul_corridor",
    getPreset: () => getMosulCorridorPreset(),
  },
  {
    id: "volturno_crossing",
    name: "Crossing the Volturno (Oct 1943)",
    description: "US 7th Infantry Regiment forces a crossing of the Volturno River against entrenched German positions. Tests river obstacles, engineer bridging, artillery coordination, and entrenchment.",
    era: "ww2",
    scale: "grand_tactical",
    mapType: "built-in",
    requiredMap: "volturno_crossing",
    getPreset: () => getVolturnoPreset(),
  },
  // Air operations reference scenario — tests all air system features
  {
    id: "air_reference",
    name: "Air Strike: Ashbury (Modern)",
    description: "Modern combined-arms with air power. Blue Force has CAS and air superiority assets. Red Force has SHORAD and medium AD. Tests air orders, AD coverage, altitude, readiness, and interception.",
    era: "modern",
    scale: "grand_tactical",
    mapType: "test-fixture",
    requiredMap: "test-fixture",
    getPreset: () => getAirReferencePreset(),
  },
  // AD stress test — dense overlapping AD corridor, aircraft fly straight through it
  {
    id: "ad_valley",
    name: "AD Valley (Kill Zone Test)",
    description: "2 fighter flights fly low through a corridor packed with 8 overlapping AD systems (gun, IR, radar). Should be a near-certain death sentence. Tests whether the adjudicator correctly destroys or cripples aircraft under overwhelming AD.",
    era: "modern",
    scale: "grand_tactical",
    mapType: "test-fixture",
    requiredMap: "test-fixture",
    getPreset: () => getAdValleyPreset(),
  },
  // AI reference — human vs AI for testing AI player features
  {
    id: "ai_reference",
    name: "AI Commander Test (Human vs AI)",
    description: "Human-controlled Blue Force vs AI-controlled Red Force. Tests AI order generation, idle tracking, mixed human/AI handoff, review auto-accept, and AI call logging.",
    era: "cold_war",
    scale: "grand_tactical",
    mapType: "test-fixture",
    requiredMap: "test-fixture",
    getPreset: () => getAIReferencePreset(),
  },
  {
    id: "server_ai_duel",
    name: "AI Opponent Test (AI vs AI)",
    description: "Algorithmic server AI on both sides over the VP river-crossing test map. Used for long-run soak testing, profile divergence, and reasoning artifact capture.",
    era: "cold_war",
    scale: "grand_tactical",
    mapType: "test-fixture",
    requiredMap: "test-fixture",
    getPreset: () => getServerAiDuelPreset(),
  },
  // LEGACY — original test-fixture preset, kept for backward compatibility
  {
    id: "river_crossing",
    name: "Contested River Crossing LEGACY",
    description: "(Original 12x18 test fixture) Blue Force attacks to secure the Stonebrook bridge. Red Force defends the crossing.",
    era: "modern",
    scale: "grand_tactical",
    mapType: "test-fixture",
    requiredMap: "test-fixture",
    getPreset: () => getQuickstartPreset(),
  },
];

/**
 * Get presets available for a given map.
 * @param {string} mapName - filename or "test-fixture"
 * @returns {Array<{ id, name, description, era }>}
 */
export function getPresetsForMap(mapName) {
  if (!mapName) return [];
  return PRESET_REGISTRY.filter(p => {
    if (p.requiredMap === "test-fixture") return mapName === "test-fixture";
    return mapName.includes(p.requiredMap);
  }).map(({ id, name, description, era }) => ({ id, name, description, era }));
}

/**
 * Load a preset by its registry ID.
 * @param {string} id
 * @returns {Object|null} full preset object or null if not found
 */
export function getPresetById(id) {
  const entry = PRESET_REGISTRY.find(p => p.id === id);
  return entry ? entry.getPreset() : null;
}

/**
 * Get all available presets (for quick-start menus).
 * @returns {Array<{ id, name, description, era, requiredMap }>}
 */
export function getAllPresets() {
  return PRESET_REGISTRY.map(({ id, name, description, era, scale, mapType, requiredMap }) => (
    { id, name, description, era, scale, mapType, requiredMap }
  ));
}

/**
 * "Contested River Crossing" — Uses the 12x15 test fixture terrain.
 * Blue Force attacks east-to-west to secure the Stonebrook river crossing.
 * Red Force defends west of the river.
 * ~6 units per side, mixed types.
 */
export function getQuickstartPreset() {
  presetCounter = 0; // reset for deterministic IDs

  return {
    // Scale: Grand Tactical — battalion/brigade combined-arms on the test fixture
    scale: "grand_tactical",

    // Scenario fields
    title: "Contested River Crossing",
    description: "Blue Force must secure the bridge over Stonebrook River (D5) and establish a bridgehead on the western bank. Red Force defends the crossing and surrounding approaches.",
    initialConditions: "Dawn. Visibility moderate. Both forces are at full readiness. The Stonebrook bridge at Ashbury is the only viable heavy vehicle crossing point. Red Force has had 24 hours to prepare defensive positions west of the river.",
    specialRules: "The bridge can be destroyed by either side (artillery or demolition). If destroyed, only infantry can ford the river at reduced speed. Urban areas (Ashbury, Hexville) provide defensive bonuses.",
    turnDuration: "4 hours",
    startDate: "2024-06-15",

    // Environment
    environment: {
      weather: "overcast",
      visibility: "moderate",
      groundCondition: "wet",
      timeOfDay: "dawn",
      climate: "temperate",
      stability: "medium",
      severity: "moderate",
    },

    // Actors
    actors: [
      {
        id: "actor_1",
        name: "Blue Force",
        controller: "player",
        objectives: ["Secure the Stonebrook bridge at D5", "Establish a bridgehead west of the river", "Neutralize Red Force artillery positions"],
        constraints: ["Minimize civilian casualties in Ashbury and Hexville", "Bridge capture preferred over destruction"],
        cvpHexes: ["3,4"],  // D5 — Stonebrook Bridge is critical for Blue
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: ["Deny Blue Force access to the western bank", "Hold defensive line along the Stonebrook", "Preserve combat strength for counterattack"],
        constraints: ["Bridge destruction is a last resort only", "Do not withdraw past column B"],
        cvpHexes: ["3,4", "1,6"],  // D5 bridge + B7 Hexville are critical for Red
      },
    ],

    // Victory conditions — VP-based scoring
    victoryConditions: {
      type: "vp",
      vpGoal: 50,          // first to 50 VP wins (or highest at game end)
      hexVP: [
        { hex: "3,4", name: "Stonebrook Bridge", vp: 30 },   // D5 — the bridge
        { hex: "5,5", name: "Ashbury",           vp: 15 },   // F6 — town east of bridge
        { hex: "1,6", name: "Hexville",           vp: 10 },   // B7 — town west of river
      ],
    },

    // Units — Blue Force (east side, cols 7-11)
    // Units — Red Force (west side, cols 0-4)
    units: [
      // ── Blue Force ──
      { id: uid(), actor: "actor_1", name: "1st Recon (Shadow)", type: "recon", echelon: "company", posture: "moving", position: "7,3", strength: 100, supply: 100, status: "ready", notes: "Forward screening element", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_6", movementType: "wheeled", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Alpha Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "8,4", strength: 100, supply: 100, status: "ready", notes: "Main assault infantry", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_6", movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Bravo Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "9,5", strength: 100, supply: 100, status: "ready", notes: "Supporting infantry", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_6", movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "1st Armor (Steel)", type: "armor", echelon: "battalion", posture: "reserve", position: "9,3", strength: 100, supply: 100, status: "ready", notes: "Exploitation force", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_6", movementType: "tracked", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Thunder Battery", type: "artillery", echelon: "artillery_battery", posture: "ready", position: "11,6", strength: 100, supply: 100, status: "ready", notes: "Fire support from tree cover", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_6", movementType: "wheeled", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Blue HQ (Citadel)", type: "headquarters", echelon: "brigade", posture: "ready", position: "10,7", strength: 100, supply: 100, status: "ready", notes: "Command post near Camp Ironwood", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "", movementType: "wheeled", specialCapabilities: [] },

      // ── Red Force ──
      { id: uid(), actor: "actor_2", name: "Viper Recon", type: "recon", echelon: "company", posture: "defending", position: "4,3", strength: 100, supply: 100, status: "ready", notes: "Forward observation east of river", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_12", movementType: "wheeled", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Red Guard Platoon", type: "infantry", echelon: "battalion", posture: "defending", position: "2,4", strength: 100, supply: 100, status: "ready", notes: "Primary river defense", morale: 100, ammo: 100, entrenchment: 30, detected: true, parentHQ: "unit_preset_12", movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Sentinel Platoon", type: "infantry", echelon: "battalion", posture: "dug_in", position: "2,6", strength: 100, supply: 100, status: "ready", notes: "Forest defense line", morale: 100, ammo: 100, entrenchment: 60, detected: true, parentHQ: "unit_preset_12", movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Iron Fist Troop", type: "armor", echelon: "battalion", posture: "reserve", position: "1,5", strength: 100, supply: 100, status: "ready", notes: "Counterattack reserve", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_12", movementType: "tracked", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Hammer Battery", type: "artillery", echelon: "artillery_battery", posture: "ready", position: "1,8", strength: 100, supply: 100, status: "ready", notes: "Indirect fire from jungle hills", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "unit_preset_12", movementType: "wheeled", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Red HQ (Bastion)", type: "headquarters", echelon: "brigade", posture: "ready", position: "0,6", strength: 100, supply: 100, status: "ready", notes: "Command post", morale: 100, ammo: 100, entrenchment: 0, detected: true, parentHQ: "", movementType: "wheeled", specialCapabilities: [] },
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// AI REFERENCE — Human vs AI for testing AI player features.
// Reuses quickstart units/map but makes Red Force an AI actor with
// personality. Tests: AI order generation, idle tracking, mixed
// human/AI handoff, review auto-accept, AI call logging.
// ════════════════════════════════════════════════════════════════

function getAIReferencePreset() {
  const base = getQuickstartPreset();

  // Override Red Force to be AI-controlled with a personality
  base.actors = [
    {
      id: "actor_1",
      name: "Blue Force",
      controller: "player",
      objectives: ["Secure the Stonebrook bridge at D5", "Establish a bridgehead west of the river"],
      constraints: ["Minimize civilian casualties in Ashbury"],
    },
    {
      id: "actor_2",
      name: "Red Force",
      controller: "ai",
      aiConfig: {
        provider: "",  // empty = use adjudication provider (filled at runtime)
        model: "",     // empty = use adjudication model (filled at runtime)
        personality: "Aggressive Soviet-doctrine commander. Favors armored thrusts with artillery preparation. "
          + "Will counterattack rather than hold static positions. Commits reserves early if an opportunity presents. "
          + "Low tolerance for retreat — prefers fighting withdrawal over disengagement. "
          + "Values surprise and tempo over methodical approaches.",
      },
      objectives: ["Deny Blue Force access to the western bank", "Destroy the bridge rather than let it be captured", "Counterattack any penetration of the main defensive line"],
      constraints: ["Do not withdraw past column B", "Preserve artillery for counter-battery fire"],
    },
  ];

  base.title = "AI Commander Test";
  base.description = "Human-controlled Blue Force vs AI-controlled Red Force. Red Force uses aggressive Soviet doctrine with armored counterattack bias.";

  return base;
}

export function getServerAiDuelPreset() {
  const base = getQuickstartPreset();

  base.title = "AI Opponent Test";
  base.description = "Algorithmic server AI on both sides fighting over Stonebrook Bridge, Ashbury, and Hexville. Intended for long-run opponent soak tests with doctrine divergence and reasoning capture.";
  base.maxTurns = 16;
  base.actors = [
    {
      ...base.actors[0],
      controller: "ai",
      isAi: true,
      aiConfig: {
        engine: "algorithmic",
        profile: "aggressive_breakthrough",
        thinkBudget: "deliberate",
      },
      objectives: [
        "Seize Stonebrook Bridge and Ashbury quickly",
        "Exploit across the river before Red Force can recover",
        "Use armor as the main effort once the bridgehead opens",
      ],
      constraints: [
        "Keep pressure on the decisive crossing",
        "Do not strand the reserve without support",
      ],
    },
    {
      ...base.actors[1],
      controller: "ai",
      isAi: true,
      aiConfig: {
        engine: "algorithmic",
        profile: "cautious_defender",
        thinkBudget: "deliberate",
      },
      objectives: [
        "Hold Stonebrook Bridge and Hexville",
        "Trade space for time only if the bridge line is collapsing",
        "Preserve the reserve for a deliberate counterattack",
      ],
      constraints: [
        "Do not waste the counterattack reserve early",
        "Force Blue to pay for every crossing attempt",
      ],
    },
  ];

  return base;
}

// ════════════════════════════════════════════════════════════════
// CONTESTED RIVER CROSSING (v2) — Cold War division-scale confrontation
// Blue: US mechanized infantry division + attached armor battalion (south)
// Red: Soviet understrength motor rifle division + air assault brigade (north)
// 20x30 hex grid, 1km cells
// ════════════════════════════════════════════════════════════════

function getRiverCrossingV2Preset() {
  presetCounter = 0;

  // Shorthand builders
  function blue(name, type, echelon, pos, overrides = {}) {
    return addAirFields({
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "moving",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 100,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 90,
      ammo: overrides.ammo || 100,
      entrenchment: overrides.entrenchment || 0,
      detected: overrides.detected !== undefined ? overrides.detected : true,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "tracked",
      specialCapabilities: overrides.specialCapabilities || [],
    }, overrides);
  }

  function red(name, type, echelon, pos, overrides = {}) {
    return addAirFields({
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 90,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 85,
      ammo: overrides.ammo || 100,
      entrenchment: overrides.entrenchment || 30,
      detected: overrides.detected !== undefined ? overrides.detected : true,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "tracked",
      specialCapabilities: overrides.specialCapabilities || [],
    }, overrides);
  }

  const northernTowns = "Northfield, Ridgemont, and Clearwater";
  const blueRearCvpHexes = ["5,14", "10,16", "6,19", "9,27", "7,28"];
  const redRearCvpHexes = ["7,1", "9,2", "5,3", "10,5", "6,7"];
  const riverCrossingHexVP = [
    // Primary swing points around the crossing and highland flank.
    { hex: "4,10", name: "Stonebrook Bridge", vp: 70 },
    { hex: "16,10", name: "Stonebrook Dam", vp: 45 },
    { hex: "3,9", name: "Ashbury", vp: 40 },
    { hex: "2,10", name: "Stonebrook Harbor", vp: 30 },
    { hex: "3,11", name: "Hexville", vp: 30 },
    { hex: "2,9", name: "Ashbury Port", vp: 25 },
    { hex: "7,10", name: "Ashbury Power Station", vp: 20 },
    { hex: "2,11", name: "Hexville Docks", vp: 18 },
    { hex: "17,10", name: "Stonebrook Lake", vp: 7 },

    // Named towns and bases on the northern approaches.
    { hex: "7,1", name: "Northern Air Base", vp: 18 },
    { hex: "9,2", name: "Camp Sentinel", vp: 15 },
    { hex: "5,3", name: "Northfield", vp: 15 },
    { hex: "10,5", name: "Ridgemont", vp: 20 },
    { hex: "6,7", name: "Clearwater", vp: 15 },

    // Blue rear-area positions that still matter if Red breaks through.
    { hex: "5,14", name: "Southhaven", vp: 15 },
    { hex: "10,16", name: "Pinewood", vp: 15 },
    { hex: "6,19", name: "Millbrook", vp: 12 },
    { hex: "9,27", name: "Camp Vanguard", vp: 15 },
    { hex: "7,28", name: "Southern Air Base", vp: 18 },
  ];

  return {
    scale: "grand_tactical",
    title: "Contested River Crossing",
    description: `Blue Force (US 3rd Mechanized Infantry Division) attacks south-to-north to secure the Stonebrook Bridge, the coastal port at Ashbury, and capture all towns north of the river (${northernTowns}). Red Force (Soviet 47th Motor Rifle Division, understrength, with 11th Air Assault Brigade) defends the crossing and northern approaches. The sheltered highland valley to the east offers a potential approach over rough ground, though movement is slow and the terrain channels forces.`,
    initialConditions: "Dawn, early summer 1985. Visibility moderate due to morning fog in river valley. Blue Force is advancing from the south along the main highway corridor. Red Force has had 48 hours to prepare defensive positions north of the Stonebrook. The 11th Air Assault Brigade is in reserve with transport helicopters at Northern Air Base. The highland valley east of the ridge offers a concealed N-S movement corridor invisible from the plain. Both sides have engineer assets capable of bridging the Stonebrook at any point along its length given sufficient time and security.",
    specialRules: "The Stonebrook Bridge at Ashbury is the only pre-existing crossing — capturing it intact saves critical time. Engineers can erect temporary bridges at any point along the river (requires ~4 hours uninterrupted work and local security). Infantry can ford the river at reduced speed but vehicles require a bridge. The coastal port at Ashbury is a strategic logistics objective. Urban areas provide +30% defensive bonus. Red air assault brigade can conduct helicopter insertion behind Blue lines. Both sides have limited attack helicopter sorties (fuel/maintenance). SAM umbrella restricts helicopter operations within 3km of AD units. The highland valley is dead ground from the plain — units in the valley cannot be observed from west of the ridge except through the river gap.",
    turnDuration: "4 hours",
    startDate: "1985-06-12",

    environment: {
      weather: "overcast",
      visibility: "moderate",
      groundCondition: "dry",
      timeOfDay: "dawn",
      climate: "temperate",
      stability: "medium",
      severity: "moderate",
    },

    actors: [
      {
        id: "actor_1",
        name: "Blue Force — US 3rd Mechanized Infantry Division",
        controller: "player",
        objectives: [
          "Secure the Stonebrook Bridge at Ashbury intact",
          "Capture the coastal port at Ashbury",
          `Capture all towns north of the river: ${northernTowns}`,
          "Establish defensive positions on the northern bank",
          "Neutralize Red Force artillery and air defense",
        ],
        constraints: [
          "Minimize collateral damage in Ashbury and Hexville",
          "Bridge capture preferred — destruction is mission failure",
          "Do not advance beyond row 0 (northern map edge)",
          "Maintain supply lines along the highway corridor",
        ],
        cvpHexes: blueRearCvpHexes,
      },
      {
        id: "actor_2",
        name: "Red Force — Soviet 47th Motor Rifle Division",
        controller: "player",
        objectives: [
          "Deny Blue Force access to the northern bank",
          "Hold all towns north of the Stonebrook",
          "Deny Blue Force use of the coastal port",
          "Preserve combat strength — cannot afford attrition",
          "Use air assault brigade to disrupt Blue rear areas",
        ],
        constraints: [
          "Bridge destruction only as last resort (requires Division HQ authorization)",
          "Do not withdraw past row 3 without authorization",
          "Air assault brigade limited to 2 major helicopter lifts (fuel constraints)",
          "Understrength — no replacements available",
        ],
        cvpHexes: redRearCvpHexes,
      },
    ],

    victoryConditions: {
      type: "vp",
      vpGoal: 250,
      hexVP: riverCrossingHexVP,
    },

    units: [
      // ══════════════════════════════════════════════════
      // BLUE FORCE — US 3rd Mechanized Infantry Division
      // Attacking south to north along highway corridor
      // Starting positions: rows 18-28 (southern half)
      // ══════════════════════════════════════════════════

      // ── Division HQ ──
      blue("3rd MID HQ (Warhorse)", "headquarters", "division", "7,26", {
        posture: "ready", movementType: "wheeled",
        notes: "Division command post, rear area near Southern Air Base",
      }),

      // ── 1st Brigade "Ironclad" — Main Effort (highway axis) ──
      blue("1st Bde HQ (Ironclad)", "headquarters", "brigade", "7,22", {
        posture: "ready", movementType: "tracked",
        notes: "Main effort brigade — attacks along highway axis toward the bridge",
        parentHQ: "unit_preset_1",
      }),
      blue("1-12 Mech Infantry (Wolfpack)", "mechanized_infantry", "battalion", "7,20", {
        posture: "attacking", notes: "Lead assault battalion, M2 Bradleys",
        parentHQ: "unit_preset_2",
      }),
      blue("2-12 Mech Infantry (Spearhead)", "mechanized_infantry", "battalion", "6,21", {
        posture: "attacking", notes: "Supporting assault, M2 Bradleys",
        parentHQ: "unit_preset_2",
      }),
      blue("1-64 Armor (Razorback)", "armor", "battalion", "8,21", {
        posture: "reserve", notes: "Brigade organic armor, M1 Abrams — exploitation force",
        parentHQ: "unit_preset_2",
      }),
      blue("1-9 Field Artillery (Thunderstrike)", "artillery", "battalion", "7,23", {
        posture: "ready", movementType: "tracked",
        notes: "M109 155mm SP — direct support to 1st Brigade",
        parentHQ: "unit_preset_2",
      }),

      // ── 2nd Brigade "Pegasus" — Supporting Effort (east flank) ──
      blue("2nd Bde HQ (Pegasus)", "headquarters", "brigade", "10,23", {
        posture: "ready", movementType: "tracked",
        notes: "Eastern flank — advance through farmland, potential ford crossing",
        parentHQ: "unit_preset_1",
      }),
      blue("1-14 Mech Infantry (Warhammer)", "mechanized_infantry", "battalion", "10,20", {
        posture: "attacking", notes: "Eastern approach, M2 Bradleys",
        parentHQ: "unit_preset_8",
      }),
      blue("2-14 Mech Infantry (Stormcrow)", "mechanized_infantry", "battalion", "11,21", {
        posture: "moving", notes: "Eastern flank security, M2 Bradleys",
        parentHQ: "unit_preset_8",
      }),
      blue("2-64 Armor (Hellcat)", "armor", "battalion", "9,22", {
        posture: "reserve", notes: "M1 Abrams — eastern exploitation",
        parentHQ: "unit_preset_8",
      }),
      blue("2-9 Field Artillery (Rolling Thunder)", "artillery", "battalion", "10,24", {
        posture: "ready", movementType: "tracked",
        notes: "M109 155mm SP — direct support to 2nd Brigade",
        parentHQ: "unit_preset_8",
      }),

      // ── 3rd Brigade "Vanguard" — Reserve / Western Flank ──
      blue("3rd Bde HQ (Vanguard)", "headquarters", "brigade", "5,24", {
        posture: "ready", movementType: "tracked",
        notes: "Reserve brigade — western flank along coast, ready to reinforce",
        parentHQ: "unit_preset_1",
      }),
      blue("1-8 Mech Infantry (Nightstalker)", "mechanized_infantry", "battalion", "5,22", {
        posture: "moving", notes: "Western approach along coast, M2 Bradleys",
        parentHQ: "unit_preset_14",
      }),
      blue("2-8 Mech Infantry (Ironside)", "mechanized_infantry", "battalion", "4,23", {
        posture: "reserve", notes: "Reserve infantry, M2 Bradleys",
        parentHQ: "unit_preset_14",
      }),
      blue("3-64 Armor (Sabre)", "armor", "battalion", "6,24", {
        posture: "reserve", notes: "M1 Abrams — division reserve armor",
        parentHQ: "unit_preset_14",
      }),
      blue("3-9 Field Artillery (Firestorm)", "artillery", "battalion", "5,25", {
        posture: "ready", movementType: "tracked",
        notes: "M109 155mm SP — direct support to 3rd Brigade",
        parentHQ: "unit_preset_14",
      }),

      // ── Division Troops ──
      blue("4-17 Field Artillery (Earthquake)", "artillery", "battalion", "7,27", {
        posture: "ready", movementType: "tracked",
        notes: "M110 203mm SP — general support, counterbattery",
        parentHQ: "unit_preset_1",
      }),
      blue("3rd Cav Squadron (Ghostrider)", "recon", "battalion", "8,18", {
        posture: "moving", movementType: "tracked",
        notes: "M3 Bradley CFVs — forward screen, eyes of the division",
        parentHQ: "unit_preset_1",
      }),
      blue("5-3 ADA Battalion (Skyshield)", "air_defense", "battalion", "6,25", {
        posture: "ready", movementType: "tracked",
        notes: "M48 Chaparral, M163 Vulcan, Stinger teams",
        parentHQ: "unit_preset_1",
      }),
      blue("3rd Aviation Bde (Raptor)", "attack_helicopter", "battalion", "7,28", {
        posture: "ready", movementType: "helicopter",
        notes: "AH-1 Cobra attack helicopters — 18 airframes",
        parentHQ: "unit_preset_1",
        specialCapabilities: ["attack_helicopter"],
      }),
      blue("3rd Engineer Bn (Bridgebuilder)", "engineer", "battalion", "7,21", {
        posture: "ready", movementType: "tracked",
        notes: "Combat engineers — bridging, breaching, mine clearing",
        parentHQ: "unit_preset_1",
      }),

      // ══════════════════════════════════════════════════
      // RED FORCE — Soviet 47th Motor Rifle Division (understrength)
      // + 11th Air Assault Brigade
      // Defending north of Stonebrook, rows 0-10
      // 3rd MRR destroyed in earlier fighting — 2 of 3 regiments present
      // ══════════════════════════════════════════════════

      // ── Division HQ ──
      red("47th MRD HQ (Ural)", "headquarters", "division", "7,3", {
        posture: "ready", movementType: "wheeled",
        notes: "Division command post, northern sector near Camp Sentinel",
      }),

      // ── 93rd Motor Rifle Regiment — Ashbury/bridge defense (main line) ──
      red("93rd MRR HQ (Molot)", "headquarters", "regiment", "5,7", {
        posture: "defending", movementType: "tracked",
        notes: "Defending Ashbury, port, and bridge approaches",
        parentHQ: "unit_preset_23",
      }),
      red("1/93 Motor Rifle Bn (Volk)", "mechanized_infantry", "battalion", "4,9", {
        posture: "dug_in", entrenchment: 60,
        notes: "BMP-2s, dug in at Ashbury — primary bridge defense",
        parentHQ: "unit_preset_24",
      }),
      red("2/93 Motor Rifle Bn (Berkut)", "mechanized_infantry", "battalion", "6,8", {
        posture: "dug_in", entrenchment: 50,
        notes: "BMP-2s, defending northern approaches east of city",
        parentHQ: "unit_preset_24",
      }),
      red("3/93 Motor Rifle Bn (Sokol)", "mechanized_infantry", "battalion", "3,8", {
        posture: "defending", entrenchment: 40,
        notes: "BMP-2s, covering port and western coastal approaches",
        parentHQ: "unit_preset_24",
      }),
      red("93rd Tank Bn (Taifun)", "armor", "battalion", "5,6", {
        posture: "reserve", entrenchment: 0,
        notes: "31x T-72 — regimental armor reserve for counterattack",
        parentHQ: "unit_preset_24",
      }),
      red("93rd Arty Bn (Grad)", "artillery", "battalion", "6,5", {
        posture: "ready", movementType: "tracked",
        notes: "18x 2S1 Gvozdika 122mm SP — regimental fire support",
        parentHQ: "unit_preset_24",
      }),

      // ── 141st Motor Rifle Regiment — Northern defense / reserve ──
      red("141st MRR HQ (Shchit)", "headquarters", "regiment", "8,4", {
        posture: "defending", movementType: "tracked",
        notes: "Second-line defense, eastern sector and town garrisons",
        parentHQ: "unit_preset_23",
      }),
      red("1/141 Motor Rifle Bn (Medved)", "mechanized_infantry", "battalion", "5,3", {
        posture: "defending", entrenchment: 30,
        notes: "BMP-1s, garrison at Northfield",
        parentHQ: "unit_preset_31",
      }),
      red("2/141 Motor Rifle Bn (Kobra)", "mechanized_infantry", "battalion", "10,5", {
        posture: "defending", entrenchment: 30,
        notes: "BMP-1s, garrison at Ridgemont",
        parentHQ: "unit_preset_31",
      }),
      red("3/141 Motor Rifle Bn (Bars)", "mechanized_infantry", "battalion", "8,5", {
        posture: "reserve", entrenchment: 0,
        notes: "BMP-1s, regimental reserve",
        parentHQ: "unit_preset_31",
      }),
      red("141st Tank Bn (Buran)", "armor", "battalion", "9,4", {
        posture: "reserve", entrenchment: 0,
        notes: "31x T-72 — regimental counterattack force",
        parentHQ: "unit_preset_31",
      }),
      red("141st Arty Bn (Smerch)", "artillery", "battalion", "9,3", {
        posture: "ready", movementType: "tracked",
        notes: "18x 2S1 Gvozdika 122mm SP",
        parentHQ: "unit_preset_31",
      }),

      // NOTE: 3rd Motor Rifle Regiment destroyed in earlier fighting — not present

      // ── Division Troops ──
      red("47th DAG (Vulkan)", "artillery", "regiment", "8,2", {
        posture: "ready", movementType: "tracked",
        notes: "2S3 Akatsiya 152mm + BM-21 Grad MRL — general support",
        parentHQ: "unit_preset_23",
      }),
      red("47th ADA Regt (Kupol)", "air_defense", "regiment", "7,2", {
        posture: "ready", movementType: "tracked",
        notes: "ZSU-23-4 Shilka, SA-6 Gainful, SA-9 Gaskin",
        parentHQ: "unit_preset_23",
      }),
      red("47th Recon Bn (Ten)", "recon", "battalion", "5,9", {
        posture: "defending", movementType: "wheeled", entrenchment: 20,
        notes: "BRDM-2s — forward observation on Stonebrook line",
        parentHQ: "unit_preset_23",
      }),
      red("47th AT Bn (Kornet)", "anti_tank", "battalion", "4,7", {
        posture: "dug_in", entrenchment: 50, movementType: "wheeled",
        notes: "BRDM-2 with AT-5 Spandrel — covering bridge approaches",
        parentHQ: "unit_preset_23",
      }),
      red("47th Engineer Bn (Sapyor)", "engineer", "battalion", "6,4", {
        posture: "ready", movementType: "tracked",
        notes: "Combat engineers — minefields, obstacles, bridge demolition prep",
        parentHQ: "unit_preset_23",
      }),

      // ── 11th Air Assault Brigade (Front-level attachment) ──
      red("11th AAB HQ (Kondor)", "headquarters", "brigade", "7,1", {
        posture: "ready", movementType: "helicopter",
        notes: "Air assault brigade — reserve for deep insertion behind Blue lines",
        parentHQ: "unit_preset_23",
      }),
      red("1/11 Air Assault Bn (Orlyonok)", "airborne", "battalion", "7,1", {
        posture: "reserve", movementType: "helicopter", entrenchment: 0,
        notes: "Light infantry — helicopter insertable, RPGs, AGS-17",
        parentHQ: "unit_preset_44",
      }),
      red("2/11 Air Assault Bn (Yastreb)", "airborne", "battalion", "7,1", {
        posture: "reserve", movementType: "helicopter", entrenchment: 0,
        notes: "Light infantry — helicopter insertable",
        parentHQ: "unit_preset_44",
      }),
      red("3/11 Air Assault Bn (Krechet)", "airborne", "battalion", "7,1", {
        posture: "reserve", movementType: "helicopter", entrenchment: 0,
        notes: "Light infantry — helicopter insertable",
        parentHQ: "unit_preset_44",
      }),
      red("11th Transport Aviation (Shtorm)", "transport", "battalion", "7,1", {
        posture: "ready", movementType: "helicopter",
        notes: "24x Mi-8 Hip transport helicopters — insertion capability for air assault brigade",
        parentHQ: "unit_preset_44",
        specialCapabilities: ["air_transport"],
      }),

      // ── Divisional Attack Helicopter Squadron ──
      red("47th Attack Helo Sqn (Kobra)", "attack_helicopter", "company", "7,1", {
        posture: "ready", movementType: "helicopter", strength: 80,
        notes: "6x Mi-24 Hind attack helicopters — divisional fire support, small squadron",
        parentHQ: "unit_preset_23",
        specialCapabilities: ["attack_helicopter"],
      }),

      // ── City Militia — local territorial defense garrisons ──
      red("Ashbury Peoples Militia (Zarya)", "infantry", "company", "4,9", {
        posture: "defending", movementType: "foot", entrenchment: 40,
        strength: 70, morale: 70, supply: 60,
        notes: "Territorial defense militia — AKMs, RPGs, local knowledge of Ashbury streets",
        specialCapabilities: ["local_knowledge"],
      }),
      red("Hexville Peoples Militia (Voskhod)", "infantry", "company", "3,11", {
        posture: "defending", movementType: "foot", entrenchment: 40,
        strength: 65, morale: 70, supply: 60,
        notes: "Territorial defense militia — AKMs, RPGs, local knowledge of Hexville district",
        specialCapabilities: ["local_knowledge"],
      }),

      // ── Blue Special Forces — infiltrated north of the eastern ford ──
      blue("ODA 312 (Pathfinder)", "special_forces", "company", "11,9", {
        posture: "ready", movementType: "foot", detected: false,
        strength: 100, morale: 95, supply: 80,
        notes: "Special Forces ODA — pre-positioned in dense forest north of Stonebrook ford, recon and direct action",
        specialCapabilities: ["local_knowledge"],
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// BATTLE OF BASTOGNE — Dec 21-26, 1944
// 101st Airborne Division + attachments vs 26th VGD + Panzer Lehr elements
// Grand tactical scale: company/battalion echelons on 80x92 hex grid (0.5km/hex)
// ════════════════════════════════════════════════════════════════

function getBastognePreset() {
  presetCounter = 0;

  // Shorthand for US unit — siege conditions: low ammo, frozen ground, elite airborne morale
  function us(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 30,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 85,
      cohesion: overrides.cohesion || 85,
      ammo: overrides.ammo || 25,
      entrenchment: overrides.entrenchment || 20,
      detected: true, // Known perimeter positions
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  // Shorthand for German unit — attacking force, better supplied but mixed quality
  function de(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "attacking",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 60,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 65,
      cohesion: overrides.cohesion || 75,
      ammo: overrides.ammo || 55,
      entrenchment: overrides.entrenchment || 5,
      detected: false, // Encircling force — positions unknown to defenders
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  // HQ IDs for parentHQ references (deterministic from uid counter)
  // US HQ will be unit_preset_1, German HQ will be unit_preset_25
  const US_HQ = "unit_preset_1";
  const DE_HQ = "unit_preset_25";

  return {
    scale: "grand_tactical",

    title: "Battle of Bastogne",
    description: "Dec 21-26, 1944. The 101st Airborne Division and attached units defend the vital crossroads town of Bastogne against the German XLVII Panzer Corps during the Battle of the Bulge. The garrison is encircled, low on ammunition, and fighting in brutal winter conditions — but they hold.",
    initialConditions: "The 101st Airborne arrived Dec 18-19 and established a perimeter defense around Bastogne. By Dec 21, the town is fully encircled. The garrison has ~18,000 troops but critically short ammunition (10 rounds per gun per day for artillery). Ground is frozen solid, making digging nearly impossible. The German 26th Volksgrenadier Division probes for weak points while Panzer Lehr elements press from the southeast.",
    specialRules: "US artillery is severely rationed — fire missions should be rare and decisive. Airborne troops have no organic heavy weapons beyond the 75mm pack howitzers. Weather prevents air support until Dec 23. The 115th Panzergrenadier KG arrives Dec 24 from the west as reinforcement. Terrain is rolling hills with dense forest (Bois Jacques) and scattered villages.",
    turnDuration: "4 hours",
    startDate: "1944-12-21",

    environment: {
      weather: "overcast",
      visibility: "poor",
      groundCondition: "frozen",
      timeOfDay: "dawn",
      climate: "temperate",
      stability: "high",
      severity: "harsh",
    },

    actors: [
      {
        id: "actor_1",
        name: "US Garrison (McAuliffe)",
        controller: "player",
        objectives: [
          "Hold Bastogne and all road junctions",
          "Maintain perimeter integrity — no penetrations to the town center",
          "Preserve combat strength until relief arrives (Patton's 4th AD, ETA Dec 26)",
        ],
        constraints: [
          "Artillery ammunition critically limited — 10 rounds/gun/day",
          "No air support until weather clears (Dec 23 earliest)",
          "Cannot withdraw — Bastogne must be held at all costs",
          "Conserve armor reserves for counterattack against penetrations",
        ],
      },
      {
        id: "actor_2",
        name: "German XLVII Panzer Corps",
        controller: "player",
        objectives: [
          "Capture Bastogne to secure the road network for westward advance",
          "Destroy or force surrender of the US garrison",
          "Open the Bastogne-Marche road for Panzer formations",
        ],
        constraints: [
          "Must take Bastogne quickly — each day of delay threatens the Ardennes timetable",
          "Panzer Lehr elements are depleted and cannot sustain heavy losses",
          "Coordinate VGD infantry probes with armored thrusts for maximum effect",
          "Volksgrenadier divisions are adequate but not elite — avoid costly frontal assaults",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // US FORCES — 101st Airborne Division + Attachments
      // ═══════════════════════════════════════════════════════════

      // Command
      us("101st Abn Div HQ (McAuliffe)", "headquarters", "brigade", "39,45", {
        notes: "BG McAuliffe, Heintz Barracks. 'NUTS!' — Dec 22 reply to German surrender demand",
        morale: 95, cohesion: 95, ammo: 40, supply: 35, entrenchment: 30,
        movementType: "wheeled",
      }),

      // ── 501st PIR (Col. Julian Ewell) — Eastern sector ──
      us("1st Bn/501st PIR", "parachute_infantry", "battalion", "47,42", {
        notes: "East of Neffe, covering Mageret road. Contact with Pz Lehr patrols",
        morale: 85, cohesion: 90, ammo: 25, entrenchment: 15, parentHQ: US_HQ,
      }),
      us("2nd Bn/501st PIR", "parachute_infantry", "battalion", "46,40", {
        notes: "Bizory, Hill 510. Strong position overlooking eastern approaches",
        morale: 85, cohesion: 90, ammo: 20, entrenchment: 25, parentHQ: US_HQ,
      }),
      us("3rd Bn/501st PIR", "parachute_infantry", "battalion", "45,38", {
        notes: "Between Bizory and Foy, linking 501st and 506th sectors",
        morale: 85, cohesion: 85, ammo: 20, entrenchment: 15, parentHQ: US_HQ,
      }),

      // ── 506th PIR (Col. Robert Sink) — Northern sector ──
      us("1st Bn/506th PIR", "parachute_infantry", "battalion", "42,37", {
        notes: "Division reserve after Noville withdrawal. 65% strength — heavy losses Dec 19-20",
        strength: 65, morale: 80, cohesion: 70, ammo: 20, entrenchment: 10,
        posture: "reserve", parentHQ: US_HQ,
      }),
      us("2nd Bn/506th PIR", "parachute_infantry", "battalion", "43,33", {
        notes: "Bois Jacques woods. Easy Company sector — veteran paratroopers in foxholes",
        morale: 90, cohesion: 95, ammo: 20, entrenchment: 35, parentHQ: US_HQ,
      }),
      us("3rd Bn/506th PIR", "parachute_infantry", "battalion", "44,34", {
        notes: "Foy village. Under periodic mortar and artillery fire",
        morale: 85, cohesion: 85, ammo: 20, entrenchment: 20, parentHQ: US_HQ,
      }),

      // ── 502nd PIR (Col. Steve Chappuis) — Northwestern sector ──
      us("1st Bn/502nd PIR", "parachute_infantry", "battalion", "32,35", {
        notes: "Champs. Anchoring NW perimeter, will face Dec 25 Christmas attack",
        morale: 85, cohesion: 90, ammo: 25, entrenchment: 25, parentHQ: US_HQ,
      }),
      us("2nd Bn/502nd PIR", "parachute_infantry", "battalion", "35,32", {
        notes: "Longchamps area. NW perimeter extension",
        morale: 85, cohesion: 85, ammo: 20, entrenchment: 15, parentHQ: US_HQ,
      }),
      us("3rd Bn/502nd PIR", "parachute_infantry", "battalion", "42,32", {
        notes: "Recogne. Northern perimeter linking to 506th sector",
        morale: 85, cohesion: 85, ammo: 20, entrenchment: 20, parentHQ: US_HQ,
      }),

      // ── 327th GIR + 401st GIR — Southern/SW sector ──
      us("1st Bn/327th GIR", "glider_infantry", "battalion", "36,50", {
        notes: "South sector perimeter. Covering Sibret road approach",
        morale: 80, cohesion: 80, ammo: 25, entrenchment: 20, parentHQ: US_HQ,
      }),
      us("2nd Bn/327th GIR", "glider_infantry", "battalion", "43,50", {
        notes: "Marvie. Critical southern anchor — repeated German attacks here",
        morale: 80, cohesion: 85, ammo: 25, entrenchment: 25, parentHQ: US_HQ,
      }),
      us("3rd Bn/401st GIR", "glider_infantry", "battalion", "34,39", {
        notes: "Hemroulle. Western perimeter, covering Flamierge approach",
        morale: 80, cohesion: 80, ammo: 20, entrenchment: 15, parentHQ: US_HQ,
      }),

      // ── Attached/Support units ──
      us("326th Abn Engineer Bn", "engineer", "battalion", "37,52", {
        notes: "Fighting as infantry on south perimeter. Pioneer work impossible in frozen ground",
        morale: 75, cohesion: 75, ammo: 20, entrenchment: 10, parentHQ: US_HQ,
      }),
      us("CCB/10th Armored Div", "armor", "battalion", "39,44", {
        notes: "~40 Shermans, central mobile reserve. Consolidated remnants of Teams Cherry/Desobry/O'Hara HQ elements + CCR/9th AD survivors",
        morale: 75, cohesion: 60, ammo: 35, supply: 40, entrenchment: 5,
        posture: "reserve", movementType: "tracked", parentHQ: US_HQ,
      }),
      us("Team O'Hara", "armored_infantry", "company", "44,49", {
        notes: "Half-tracks + 4 Shermans near Marvie. Depleted but experienced combined-arms team",
        strength: 50, morale: 75, cohesion: 55, ammo: 30, supply: 35,
        entrenchment: 15, movementType: "tracked", parentHQ: US_HQ,
      }),
      us("705th TD Bn", "tank_destroyer", "battalion", "40,43", {
        notes: "M18 Hellcats. Platoons distributed across perimeter as mobile AT reserve",
        morale: 80, cohesion: 75, ammo: 35, supply: 40, entrenchment: 5,
        movementType: "wheeled", parentHQ: US_HQ,
      }),

      // ── Artillery (critically low ammo — 10 rds/gun/day) ──
      us("377th PFAB", "artillery", "artillery_battery", "38,42", {
        notes: "75mm pack howitzers. Critically low ammo — rationed fire only",
        morale: 80, cohesion: 85, ammo: 15, entrenchment: 15,
        movementType: "wheeled", parentHQ: US_HQ,
      }),
      us("463rd PFAB", "artillery", "artillery_battery", "35,40", {
        notes: "75mm pack howitzers near Hemroulle. Same ammo crisis",
        morale: 80, cohesion: 85, ammo: 15, entrenchment: 15,
        movementType: "wheeled", parentHQ: US_HQ,
      }),
      us("420th AFA Bn", "artillery", "artillery_battery", "30,45", {
        notes: "105mm SP near Senonchamps. Most capable US arty but limited rounds",
        morale: 80, cohesion: 80, ammo: 20, entrenchment: 10,
        movementType: "tracked", parentHQ: US_HQ,
      }),
      us("755th/969th FAB", "artillery", "artillery_battery", "37,44", {
        notes: "155mm howitzers. Very limited ammo — saved for emergencies only",
        morale: 75, cohesion: 75, ammo: 15, entrenchment: 10,
        movementType: "wheeled", parentHQ: US_HQ,
      }),
      us("321st/907th GFAB", "artillery", "artillery_battery", "40,41", {
        notes: "75mm pack howitzers. Division artillery general support",
        morale: 80, cohesion: 80, ammo: 15, entrenchment: 10,
        movementType: "wheeled", parentHQ: US_HQ,
      }),

      // ── Miscellaneous garrison ──
      us("Team SNAFU", "infantry", "company", "40,45", {
        notes: "Stragglers collected from 28 different units. Town defense — low cohesion, adequate morale",
        strength: 60, morale: 65, cohesion: 30, ammo: 30, entrenchment: 15,
        parentHQ: US_HQ,
      }),
      us("81st AA Bn (det)", "air_defense", "company", "39,43", {
        notes: "M16 quad .50 half-tracks. Ground defense role — devastating against infantry in open",
        morale: 80, cohesion: 75, ammo: 40, entrenchment: 5,
        movementType: "tracked", parentHQ: US_HQ,
      }),

      // ═══════════════════════════════════════════════════════════
      // GERMAN FORCES — XLVII Panzer Corps
      // ═══════════════════════════════════════════════════════════

      // Command
      de("26th VGD HQ (Kokott)", "headquarters", "brigade", "54,32", {
        notes: "GenMaj Heinz Kokott. Coordinates VGD regiment attacks on Bastogne perimeter",
        morale: 70, cohesion: 80, ammo: 60, supply: 65, entrenchment: 10,
        movementType: "wheeled",
      }),

      // ── 26th Volksgrenadier Division ──
      de("I./GR 77", "infantry", "battalion", "28,33", {
        notes: "NW approach, west of Champs. Probing for gaps in 502nd PIR sector",
        morale: 65, cohesion: 80, ammo: 55, parentHQ: DE_HQ,
      }),
      de("II./GR 77", "infantry", "battalion", "27,36", {
        notes: "West approach toward Flamierge-Hemroulle axis",
        morale: 65, cohesion: 75, ammo: 50, parentHQ: DE_HQ,
      }),
      de("I./GR 78", "infantry", "battalion", "48,30", {
        notes: "NE sector, probing toward Foy-Recogne. Will participate in Foy attacks",
        morale: 65, cohesion: 80, ammo: 55, parentHQ: DE_HQ,
      }),
      de("II./GR 78", "infantry", "battalion", "50,36", {
        notes: "East approach toward Bizory. Facing veteran 501st PIR positions",
        morale: 60, cohesion: 75, ammo: 50, parentHQ: DE_HQ,
      }),
      de("Füsilier-Regiment 39", "infantry", "battalion", "35,56", {
        notes: "South sector, Assenois axis. Screening toward Sibret",
        morale: 60, cohesion: 75, ammo: 50, parentHQ: DE_HQ,
      }),
      de("PzJg.Abt 26", "tank_destroyer", "company", "48,34", {
        notes: "14 Jagdpanzer 38 Hetzers. AT reserve for NE sector",
        morale: 70, cohesion: 80, ammo: 60,
        movementType: "tracked", parentHQ: DE_HQ,
      }),
      de("Pi.Btl 26", "engineer", "battalion", "45,31", {
        notes: "Screening Foy-Recogne area. May be used for obstacle/breach work",
        morale: 60, cohesion: 75, ammo: 45, parentHQ: DE_HQ,
      }),
      de("AR 26", "artillery", "artillery_battery", "52,28", {
        notes: "~48 guns (105mm, 150mm). Division artillery — well supplied",
        morale: 70, cohesion: 80, ammo: 65,
        movementType: "wheeled", parentHQ: DE_HQ,
      }),

      // ── Panzer Lehr elements + attachments ──
      de("KG 901 (Panzer Lehr)", "mechanized", "battalion", "48,52", {
        notes: "SE axis toward Marvie. Remnant of depleted Panzer Lehr Div — mixed Pz IVs + PzGren",
        strength: 70, morale: 60, cohesion: 55, ammo: 50, supply: 50,
        movementType: "tracked", parentHQ: DE_HQ,
      }),
      de("KG Kunkel", "armored_infantry", "battalion", "26,50", {
        notes: "SW, Senonchamps area. Ad hoc from divisional recon + attached elements. Poor cohesion",
        strength: 80, morale: 55, cohesion: 45, ammo: 45, supply: 50,
        movementType: "tracked", parentHQ: DE_HQ,
      }),
      de("FJR 14 (5th FJD)", "parachute_infantry", "battalion", "42,58", {
        notes: "South screening. Low-quality — former Luftwaffe ground crew replacements. 'Fallschirmjäger' in name only",
        morale: 55, cohesion: 50, ammo: 45,
        parentHQ: DE_HQ,
      }),
      de("15th Volkswerfer Brigade", "artillery", "artillery_battery", "30,38", {
        notes: "Nebelwerfer rocket launchers. NW sector fire support — devastating but inaccurate",
        morale: 65, cohesion: 70, ammo: 55,
        movementType: "wheeled", parentHQ: DE_HQ,
      }),

      // ── Reinforcement: arrives Dec 24 ──
      de("115th PzGren KG", "armor", "battalion", "20,37", {
        notes: "18 Pz IV tanks. Arrives Dec 24, assembly west of Flamizoulle. Will spearhead Christmas Day attack on Champs-Hemroulle",
        strength: 90, morale: 70, cohesion: 70, ammo: 70, supply: 65,
        entrenchment: 0, posture: "reserve",
        movementType: "tracked", parentHQ: DE_HQ,
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// ESCARPMENT ASSAULT — Wales, Black Mountain, 1944
// Blue Force assaults across open moorland to seize a defended escarpment.
// Red Force defends the high ground with fewer units but terrain advantage.
// Grand tactical scale: company/battalion on 20x23 hex grid (0.5km/hex)
// ════════════════════════════════════════════════════════════════

function getEscarpmentPreset() {
  presetCounter = 0;

  // Blue attacker: well-supplied combined arms force, lower morale (attacking uphill into the unknown)
  function blue(name, type, echelon, pos, overrides = {}) {
    return addAirFields({
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "ready",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 85,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 75,
      cohesion: overrides.cohesion || 80,
      ammo: overrides.ammo || 90,
      entrenchment: overrides.entrenchment || 0,
      detected: true,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    }, overrides);
  }

  // Red defender: fewer units, prepared positions, higher morale on home ground
  function red(name, type, echelon, pos, overrides = {}) {
    return addAirFields({
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 95,
      supply: overrides.supply || 65,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 80,
      cohesion: overrides.cohesion || 85,
      ammo: overrides.ammo || 75,
      entrenchment: overrides.entrenchment || 40,
      detected: false, // Dug-in on the escarpment — positions not yet revealed
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    }, overrides);
  }

  // HQ IDs (deterministic from uid counter)
  // Blue HQ = unit_preset_13, Red HQ = unit_preset_25
  const BLUE_HQ = "unit_preset_13";
  const RED_HQ = "unit_preset_25";

  return {
    scale: "grand_tactical",

    title: "Operation Black Mountain",
    description: "Autumn 1944. Blue Force must cross 5km of open Welsh moorland and assault a 500m escarpment defended by a dug-in infantry battalion. The escarpment's cliffs and steep slopes funnel attackers toward a handful of approach routes — the central road through a saddle, river valleys offering dead ground, and cliff faces only elite troops can attempt. Red Force has fewer units but devastating observation and fields of fire from the crest.",
    initialConditions: "Dawn, overcast with low cloud on the escarpment — visibility moderate. Ground is wet from recent rain. Blue Force has staged around Llanddeusant village in the northern valley overnight. Red Force has had 48 hours to prepare positions along the escarpment crest and reverse slope. Blue artillery is registered on likely defensive positions but exact Red locations are unknown.",
    specialRules: "Armor and wheeled vehicles cannot traverse cliff or steep slope hexes — they must use roads through saddle points. Rangers/commandos may attempt cliff hexes at half speed. The escarpment cliffs provide EXCELLENT defensive terrain. Reverse slope positions (south of the crest) are hidden from direct observation. Wet ground reduces wheeled vehicle speed by 25%. Fog may roll in on the escarpment during turns, reducing visibility to poor.",
    turnDuration: "2 hours",
    startDate: "1944-10-15",

    environment: {
      weather: "overcast",
      visibility: "moderate",
      groundCondition: "wet",
      timeOfDay: "dawn",
      climate: "mountain",
      stability: "low",
      severity: "moderate",
    },

    actors: [
      {
        id: "actor_1",
        name: "Blue Force",
        controller: "player",
        objectives: [
          "Seize the escarpment crest line between rows 10-14",
          "Secure the road through the central saddle (N12 area)",
          "Establish at least two companies on the highland plateau south of the escarpment",
        ],
        constraints: [
          "Armor and wheeled vehicles restricted to roads through the escarpment — cannot traverse cliff or steep slope hexes",
          "Must preserve combat power — cannot sustain more than 40% total casualties",
          "Rangers may attempt cliff hexes at reduced speed but risk heavy losses if detected",
          "Maintain supply line from Llanddeusant (G5) — if cut, forward units lose resupply",
        ],
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: [
          "Hold the escarpment crest line — deny Blue Force access to the highland plateau",
          "Inflict maximum casualties during Blue's approach across open moorland",
          "Preserve the AT battery covering the central road approach",
        ],
        constraints: [
          "No reinforcements available — must hold with current force",
          "Artillery ammunition limited (70% supply) — conserve for decisive moments",
          "Must maintain at least one observation post on the escarpment face for early warning",
          "Tank platoon is the only mobile reserve — commit carefully",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // BLUE FORCE — Reinforced Infantry Battalion (attacker)
      // Staged in the northern valley, rows 0-7
      // ═══════════════════════════════════════════════════════════

      // ── Assault infantry ──
      blue('1st Rifle Co "Able"', "infantry", "company", "5,2", {
        notes: "West assault echelon. Tasked with flanking through forested hills in NW",
        morale: 75, cohesion: 80, parentHQ: BLUE_HQ,
      }),
      blue('2nd Rifle Co "Baker"', "infantry", "company", "8,2", {
        notes: "Center assault echelon. Will advance through moorland toward the escarpment face",
        morale: 75, cohesion: 80, parentHQ: BLUE_HQ,
      }),
      blue('3rd Rifle Co "Charlie"', "infantry", "company", "12,3", {
        notes: "East assault echelon. Approaching along the River Usk valley for partial defilade",
        morale: 75, cohesion: 80, parentHQ: BLUE_HQ,
      }),
      blue('Ranger Platoon "Dagger"', "special_forces", "company", "3,1", {
        notes: "Elite cliff assault team. Can attempt cliff hexes at half speed. High risk, high reward if they gain the crest undetected",
        strength: 85, morale: 85, cohesion: 90, ammo: 80,
        specialCapabilities: ["cliff_assault"], parentHQ: BLUE_HQ,
      }),

      // ── Mechanized / armor ──
      blue('Mech Infantry Co "Fox"', "mechanized", "company", "11,4", {
        notes: "Half-track mounted. Must use roads through escarpment — cannot traverse cliffs",
        morale: 70, cohesion: 75, ammo: 85,
        movementType: "tracked", parentHQ: BLUE_HQ,
      }),
      blue('Tank Co "Hammer"', "armor", "company", "10,5", {
        notes: "Medium tanks (Shermans). Road-bound through the escarpment. Devastating if they reach the plateau",
        morale: 70, cohesion: 75, ammo: 80,
        movementType: "tracked", parentHQ: BLUE_HQ,
      }),
      blue('Recon Platoon "Ghost"', "recon", "company", "7,0", {
        notes: "Forward screen. Route-finding through the moorland. First to detect Red positions",
        strength: 80, morale: 75, cohesion: 75, ammo: 70,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),

      // ── Support ──
      blue('Engineer Co "Sapper"', "engineer", "company", "6,4", {
        notes: "Obstacle breaching, path improvement through steep terrain. Critical for opening routes",
        morale: 70, cohesion: 75, ammo: 75, parentHQ: BLUE_HQ,
      }),
      blue("1st Artillery Bty", "artillery", "artillery_battery", "4,6", {
        notes: "105mm howitzers. Suppression and smoke missions on the escarpment face",
        morale: 70, cohesion: 80, ammo: 85,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),
      blue("2nd Artillery Bty", "artillery", "artillery_battery", "13,6", {
        notes: "105mm howitzers. Eastern fire support. Can range the full escarpment",
        morale: 70, cohesion: 80, ammo: 85,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),
      blue('Mortar Team "Thud"', "artillery", "company", "7,3", {
        notes: "81mm mortars. Close fire support for the assault companies. Smoke capability",
        morale: 70, cohesion: 75, ammo: 80, parentHQ: BLUE_HQ,
      }),
      blue("AT Gun Section", "tank_destroyer", "company", "9,5", {
        notes: "6-pounder AT guns. Covering flanks against Red armor counterattack",
        morale: 70, cohesion: 75, ammo: 85,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),

      // ── Command & logistics ──
      blue('Btn HQ "Sunray"', "headquarters", "battalion", "6,4", {
        notes: "Battalion command post at Llanddeusant. Supply hub for all Blue units",
        morale: 80, cohesion: 85, ammo: 90, supply: 90,
        movementType: "wheeled",
      }),
      blue("Supply Column", "logistics", "company", "2,6", {
        notes: "Ammo and supply forward from rear area. Must maintain route to Llanddeusant",
        strength: 100, morale: 60, cohesion: 70, ammo: 100, supply: 100,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),
      blue("AA Section", "air_defense", "company", "8,5", {
        notes: "Bofors 40mm. Air defense umbrella over the staging area",
        morale: 65, cohesion: 70, ammo: 80,
        movementType: "wheeled", parentHQ: BLUE_HQ,
      }),

      // ═══════════════════════════════════════════════════════════
      // RED FORCE — Infantry Battalion in prepared positions (defender)
      // Dug in along the escarpment crest and reverse slope, rows 9-17
      // ═══════════════════════════════════════════════════════════

      // ── Escarpment defense line ──
      red('1st Rifle Co "Alpen"', "infantry", "company", "5,11", {
        notes: "West escarpment sector. Dug-in positions with clear fields of fire over the moorland below",
        morale: 80, cohesion: 85, entrenchment: 60, parentHQ: RED_HQ,
        posture: "dug_in",
      }),
      red('2nd Rifle Co "Berg"', "infantry", "company", "14,10", {
        notes: "East escarpment sector. Covering River Usk valley approach and eastern road",
        morale: 80, cohesion: 85, entrenchment: 60, parentHQ: RED_HQ,
        posture: "dug_in",
      }),
      red('MG Co "Kreuz"', "infantry", "company", "9,9", {
        notes: "Vickers MG platoons on the escarpment crest. Interlocking fire lanes covering the central approach. EXCELLENT defensive terrain",
        morale: 80, cohesion: 90, entrenchment: 75, parentHQ: RED_HQ,
        posture: "dug_in",
      }),

      // ── AT and fire support ──
      red('AT Battery "Amboss"', "tank_destroyer", "company", "12,10", {
        notes: "6-pounder AT guns covering the central road through the saddle. Primary anti-armor defense",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 50,
        movementType: "wheeled", parentHQ: RED_HQ,
        posture: "dug_in",
      }),
      red('Mortar Team "Donner"', "artillery", "company", "8,13", {
        notes: "81mm mortars in reverse slope positions. Hidden from direct Blue observation. Pre-registered targets on approach routes",
        morale: 75, cohesion: 80, ammo: 70, entrenchment: 30, parentHQ: RED_HQ,
      }),
      red('Artillery Bty "Hagel"', "artillery", "artillery_battery", "9,15", {
        notes: "25-pounder battery behind the ridge. Indirect fire on the moorland approaches. Ammo limited — save for massed fire",
        morale: 70, cohesion: 80, ammo: 70, supply: 60, entrenchment: 20,
        movementType: "wheeled", parentHQ: RED_HQ,
      }),

      // ── Mobile reserve ──
      red('Tank Platoon "Panzer"', "armor", "company", "11,15", {
        notes: "4x medium tanks. Mobile reserve on the plateau. Only commit against a confirmed penetration of the escarpment line",
        morale: 75, cohesion: 75, ammo: 75, entrenchment: 0,
        movementType: "tracked", parentHQ: RED_HQ,
        posture: "reserve",
      }),

      // ── Engineers & special ──
      red('Engineer Co "Pionier"', "engineer", "company", "10,10", {
        notes: "Obstacles and wire along the escarpment face. Prepared demolition charges on key trails",
        morale: 70, cohesion: 75, ammo: 70, entrenchment: 30, parentHQ: RED_HQ,
      }),
      red('Sniper Team "Schatten"', "infantry", "company", "8,7", {
        notes: "Forward observation post on the escarpment face. Early warning and harassing fire against Blue recon. Will be overrun if Blue pushes hard",
        strength: 75, morale: 85, cohesion: 90, ammo: 60, entrenchment: 20, parentHQ: RED_HQ,
      }),

      // ── Command & support ──
      red('Btn HQ "Adler"', "headquarters", "battalion", "10,14", {
        notes: "Battalion command post on the reverse slope. Supply depot for the escarpment garrison",
        morale: 80, cohesion: 85, ammo: 85, supply: 70, entrenchment: 25,
        movementType: "wheeled",
      }),
      red('AA Section "Flak"', "air_defense", "company", "12,13", {
        notes: "Flak 38 20mm. Air defense over the plateau. Can engage ground targets in emergency",
        morale: 65, cohesion: 70, ammo: 75, entrenchment: 15,
        movementType: "wheeled", parentHQ: RED_HQ,
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// SIGNAL STATION NIGHTFALL — Modern SOF Night Raid
// Sub-tactical scale: fireteam/squad, 5-min turns, 100m hexes
// SOF raiding party infiltrates a hilltop communications relay at night.
// Security platoon defends with limited NVGs and thermal.
// Tests: detection engine, night visibility, fatigue, stealth, building combat
// ════════════════════════════════════════════════════════════════

function getSignalStationPreset() {
  presetCounter = 0;

  // SOF attacker: elite, NVG-equipped, suppressed weapons, high training
  function sof(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "moving",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 90,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 90,
      cohesion: overrides.cohesion || 95,
      ammo: overrides.ammo || 85,
      entrenchment: 0,
      fatigue: overrides.fatigue || 15,
      detected: false,
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  // Security defender: conventional garrison, mixed alertness
  function sec(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 80,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 60,
      cohesion: overrides.cohesion || 65,
      ammo: overrides.ammo || 75,
      entrenchment: overrides.entrenchment || 10,
      fatigue: overrides.fatigue || 30,
      detected: true,
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  return {
    scale: "sub_tactical",

    title: "Signal Station Nightfall",
    description: "A special operations team must infiltrate a hilltop communications relay station under cover of darkness, destroy the communications equipment, and exfiltrate before a quick reaction force responds. The security platoon defends with a mix of static posts, roving patrols, and observation positions on the approaches.",
    initialConditions: "0200 hours, new moon. Visibility: very poor (15-30m unaided, 300-600m with Gen 3 NVGs). The SOF team has been inserted by helicopter at an offset LZ further south and has moved to an objective rally point in the forest 70m south of the compound. The hilltop relay station is lit by perimeter lights — the guards' night vision is degraded by the light island effect. A diesel generator runs continuously, masking sounds within 5 hexes. The security platoon has been on a standard rotation with guards changed at 2200 — current sentries have been on post for 4 hours and alertness is low.",
    specialRules: "STEALTH PHASE: Until the SOF team is detected or initiates combat, stealth rules apply — movement is slow (1 hex/turn) but undetected units cannot be engaged. Detection is by line-of-sight observation, noise, or sensor tripwire. ALERT CASCADE: When the first shot is fired or alarm raised, it takes the QRF 2 turns to arm and respond, off-duty personnel 4 turns. GENERATOR: If destroyed, perimeter lights go dark — defenders lose their light advantage. COMMUNICATIONS BUILDING: The primary objective. Requires 1 full turn inside the building (after clearing it) to set demolition charges. EXFILTRATION: After charges are set, SOF must reach any map edge to exfiltrate.",
    turnDuration: "5 minutes",
    startDate: "2024-11-15",

    environment: {
      weather: "clear",
      visibility: "very_poor",
      groundCondition: "dry",
      timeOfDay: "night",
      climate: "temperate",
      stability: "high",
      severity: "light",
    },

    actors: [
      {
        id: "actor_1",
        name: "Task Force Shadow",
        controller: "player",
        objectives: [
          "Destroy communications equipment in the relay building (requires 1 turn inside after clearing)",
          "Exfiltrate all surviving operators to any map edge",
          "Neutralize the guard tower before it activates the spotlight",
        ],
        constraints: [
          "Surprise is the primary advantage — once lost, the QRF activates in 2 turns",
          "Cannot call external fire support (covert operation, no signature)",
          "Must complete demolition before dawn (12 turns from start)",
          "Minimize casualties — each operator lost is 10-15% of combat power",
        ],
      },
      {
        id: "actor_2",
        name: "Garrison Security Platoon",
        controller: "player",
        objectives: [
          "Protect the communications relay equipment from destruction",
          "Detect and repel any intrusion into the compound",
          "If attacked, transmit an alert to regional QRF (requires 1 uninterrupted turn with a radio)",
        ],
        constraints: [
          "No external reinforcements within the scenario timeframe",
          "Guard rotation has created fatigue — sentries are at reduced alertness",
          "Perimeter lights create a light island — guards cannot see beyond the lit zone with unaided eyes",
          "QRF squad needs 2 turns to arm and deploy after alert; off-duty personnel need 4 turns",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // TASK FORCE SHADOW — SOF Raiding Party (~24 operators)
      // ORP 70m south of compound, overwatch SW, blocking positions on approaches
      // ═══════════════════════════════════════════════════════════

      sof("Assault Team Alpha", "special_forces", "fireteam", "17,29", {
        notes: "CQB loadout: suppressed carbines, breaching charges, flashbangs. At ORP 70m south of south fence. Assigned to breach and clear comms relay building",
        morale: 95, cohesion: 95, ammo: 85,
        specialCapabilities: ["breaching"],
      }),
      sof("Assault Team Bravo", "special_forces", "fireteam", "18,29", {
        notes: "CQB loadout: suppressed carbines, demo charges. At ORP adjacent to Alpha. Assigned to clear guard quarters and set demolitions on comms equipment",
        morale: 95, cohesion: 95, ammo: 85,
        specialCapabilities: ["breaching"],
      }),
      sof("Support Team (Overwatch)", "special_forces", "weapons_team", "7,25", {
        notes: "2x suppressed M240 MGs, sniper with thermal scope. SW flank position in clearing, ~100m diagonal to guard tower. Base of fire — suppresses tower and courtyard on signal",
        morale: 90, cohesion: 95, ammo: 90,
        specialCapabilities: ["precision_fire", "sustained_fire"],
      }),
      sof("Security Team North", "special_forces", "fireteam", "14,6", {
        notes: "Blocking position in forest beside access road, 80m north of compound. Claymores covering the road. Prevents reinforcement from off-map",
        morale: 90, cohesion: 90, ammo: 80,
      }),
      sof("Security Team East", "special_forces", "fireteam", "25,19", {
        notes: "Blocking position in forest beside ridge trail, 50m east of compound. Claymores covering the trail approach",
        morale: 90, cohesion: 90, ammo: 80,
      }),

      // ═══════════════════════════════════════════════════════════
      // GARRISON SECURITY PLATOON (~30 personnel)
      // Compound at hilltop center, OPs on north road and east ridge
      // ═══════════════════════════════════════════════════════════

      sec("Gate Guard", "infantry", "fireteam", "15,22", {
        notes: "2 soldiers at south gate checkpoint. Armed with rifles, one handheld flashlight. Fatigued from 4hr post",
        strength: 100, morale: 50, cohesion: 60, ammo: 75, fatigue: 45,
        entrenchment: 15,
      }),
      sec("Tower Guard", "infantry", "fireteam", "12,16", {
        notes: "2 soldiers in NW guard tower with PKM MG and spotlight. 518m elevation — highest point in compound. Gen 2 NVG available but rarely used. Thermal camera mounted but often pointed away",
        strength: 100, morale: 55, cohesion: 60, ammo: 80, fatigue: 40,
        entrenchment: 25,
        specialCapabilities: ["sustained_fire"],
      }),
      sec("Roving Patrol", "infantry", "fireteam", "19,19", {
        notes: "3 soldiers walking perimeter on predictable 20-min circuit. Currently on east patrol path. Armed with rifles and one NVG",
        strength: 100, morale: 55, cohesion: 65, ammo: 70, fatigue: 35,
        posture: "moving",
      }),
      sec("OP North", "infantry", "fireteam", "15,8", {
        notes: "2 soldiers in sandbagged observation post on access road, 60m north of fence. Radio link to compound. One Gen 2 NVG. Trip-wire flare across the road",
        strength: 100, morale: 55, cohesion: 65, ammo: 65, fatigue: 40,
        entrenchment: 20,
      }),
      sec("OP East", "infantry", "fireteam", "24,18", {
        notes: "2 soldiers in observation post on ridge trail, 40m east of fence. Radio link. Trip-wire flare covering the eastern approach",
        strength: 100, morale: 50, cohesion: 60, ammo: 65, fatigue: 45,
        entrenchment: 20,
      }),
      sec("QRF Squad", "infantry", "squad", "14,17", {
        notes: "8 soldiers in guard quarters near armory. Kitted but sleeping — requires 2 turns after alert to deploy. RPG, PKM, rifles",
        strength: 100, morale: 65, cohesion: 70, ammo: 80, fatigue: 20,
        posture: "reserve", entrenchment: 0,
        specialCapabilities: ["anti_armor"],
      }),
      sec("Off-Duty Section", "infantry", "squad", "16,18", {
        notes: "10 soldiers sleeping in Barracks B. Requires 4 turns after alert — disoriented, slow to arm. Basic rifles only",
        strength: 100, morale: 45, cohesion: 50, ammo: 70, fatigue: 10,
        posture: "reserve", entrenchment: 0,
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// BOCAGE BREAKOUT — Normandy, July 1944
// Tactical scale: platoon/company, 30-min turns, 200m hexes
// US reinforced rifle company attacks through hedgerow country.
// German defenders exploit interlocking MG42 fields of fire,
// pre-registered mortars, and immediate counterattack doctrine.
// Tests: terrain obstruction, ambush, morale cascade, close AT, combined arms
// ════════════════════════════════════════════════════════════════

function getBocagePreset() {
  presetCounter = 0;

  // US attacker: well-supplied but nervous troops facing the bocage
  function us(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "ready",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 85,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 70,
      cohesion: overrides.cohesion || 75,
      ammo: overrides.ammo || 85,
      entrenchment: overrides.entrenchment || 0,
      fatigue: overrides.fatigue || 10,
      detected: true,
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  // German defender: dug-in MG42 teams with pre-registered fires
  function de(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "dug_in",
      position: pos,
      strength: overrides.strength || 95,
      supply: overrides.supply || 70,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 75,
      cohesion: overrides.cohesion || 80,
      ammo: overrides.ammo || 70,
      entrenchment: overrides.entrenchment || 55,
      fatigue: overrides.fatigue || 15,
      detected: false,
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  const US_HQ = "unit_preset_13";
  const DE_HQ = "unit_preset_21";

  return {
    scale: "tactical",

    title: "Bocage Breakout",
    description: "July 1944, near Saint-Lô. A US reinforced rifle company must break through German-held hedgerow country to secure a road junction 1.5km south. Each 200m hex contains 2-4 hedgerow-enclosed fields with earth berms topped by dense vegetation. Visibility is limited to 1-2 hexes. The German defense exploits interlocking MG42 fields of fire, pre-registered mortar targets, and immediate counterattack doctrine to turn every field into a kill zone.",
    initialConditions: "Morning, overcast. Ground wet from overnight rain. The company has staged behind a hedgerow line at the north edge of the map. Enemy positions are known to exist ahead but exact locations are unclear — aggressive patrolling has identified some MG nests but the defense in depth is unmapped. A tank platoon of 4 Shermans (2 fitted with Culin hedgerow cutters) is attached. Battalion 81mm mortars are available on call.",
    specialRules: "HEDGEROW TERRAIN: All bocage hexes provide EXCELLENT cover and severely restrict LOS to 1-2 hexes. Vehicles without Rhino cutters cannot cross hedgerow berms — they must use gaps, gates, or roads (which are pre-registered by German mortars). RHINO CUTTERS: 2 of 4 Shermans have Culin hedgerow cutters and can breach berms at half speed. TANK-INFANTRY COMMS: A field telephone is mounted on each tank's rear deck — infantry within the same hex as a tank get a combined arms bonus. GERMAN COUNTERATTACK: German doctrine mandates immediate local counterattack against any penetration — the reserve squad will be committed aggressively. PRE-REGISTERED FIRES: German mortars on the first fire mission against known approach routes get +50% accuracy.",
    turnDuration: "30 minutes",
    startDate: "1944-07-18",

    environment: {
      weather: "overcast",
      visibility: "moderate",
      groundCondition: "wet",
      timeOfDay: "morning",
      climate: "temperate",
      stability: "medium",
      severity: "moderate",
    },

    actors: [
      {
        id: "actor_1",
        name: "Company A, 2nd Bn/120th Infantry",
        controller: "player",
        objectives: [
          "Secure the road junction at the southern map edge (row 16-17)",
          "Clear at least 3 hedgerow lines to open a corridor for follow-on forces",
          "Destroy or suppress the German MG positions blocking the central axis",
        ],
        constraints: [
          "Cannot sustain more than 40% casualties — the battalion has no replacements available",
          "Rhino-equipped Shermans are irreplaceable — losing both cripples the attack",
          "Must maintain communication with battalion HQ for mortar support",
          "Wet ground reduces wheeled movement by 25%",
        ],
      },
      {
        id: "actor_2",
        name: "2. Kompanie, Grenadier-Regiment 914",
        controller: "player",
        objectives: [
          "Hold the road junction and deny the Americans a breakthrough corridor",
          "Inflict maximum casualties during the American approach through open fields",
          "Preserve the counterattack reserve for a decisive local counterstroke",
        ],
        constraints: [
          "No reinforcements — must hold with current strength",
          "Ammunition limited to 70% — conserve mortar rounds for high-value targets",
          "Must counterattack any penetration immediately per standing orders",
          "If the road junction falls, the entire battalion position is compromised",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // US FORCES — Reinforced Rifle Company (attacker)
      // Staged behind initial hedgerow line, rows 0-3
      // ═══════════════════════════════════════════════════════════

      us("1st Platoon (Lt. Hanson)", "infantry", "platoon", "3,1", {
        notes: "West assault echelon. 3 rifle squads + BAR teams. Tasked with left flank through orchard country",
        morale: 70, cohesion: 75,
      }),
      us("2nd Platoon (Lt. Kovacs)", "infantry", "platoon", "7,1", {
        notes: "Center assault echelon. 3 rifle squads. Main effort along the sunken lane toward the junction",
        morale: 70, cohesion: 80,
      }),
      us("3rd Platoon (Lt. Rivera)", "infantry", "platoon", "11,1", {
        notes: "East assault echelon. 3 rifle squads. Advancing through farm fields along the east creek bed",
        morale: 65, cohesion: 70, strength: 85,
      }),
      us("Weapons Platoon (MG Section)", "infantry", "platoon", "7,2", {
        notes: "2x M1919A4 .30 cal MGs on tripods. Base of fire — suppresses hedgerow positions from the rear",
        morale: 70, cohesion: 80, ammo: 90,
        specialCapabilities: ["sustained_fire"],
      }),
      us("60mm Mortar Section", "artillery", "mortar_section", "8,3", {
        notes: "3x M2 60mm mortars. Organic company indirect fire — smoke and HE. Range: 8 hexes",
        morale: 70, cohesion: 75, ammo: 80,
      }),
      us('Tank Plt "Rhino" (2 cutters)', "armor", "platoon", "6,2", {
        notes: "2x M4 Sherman with Culin hedgerow cutters + 2x standard M4. The cutters can breach bocage berms. Field telephone on rear deck for infantry comms",
        morale: 70, cohesion: 75, ammo: 80,
        movementType: "tracked",
      }),
      us("TD Section (2x M10)", "tank_destroyer", "anti_tank_team", "10,3", {
        notes: "2x M10 Wolverine tank destroyers. Overwatching from hull-down behind the initial hedgerow. Covering the east flank",
        morale: 70, cohesion: 70, ammo: 85,
        movementType: "tracked",
        specialCapabilities: ["anti_armor"],
      }),
      us("Engineer Squad", "engineer", "squad", "5,2", {
        notes: "Demolitions and gap-clearing. Bangalore torpedoes for breaching hedgerow berms where tanks can't go",
        morale: 65, cohesion: 70, ammo: 75,
        specialCapabilities: ["breaching"],
      }),
      us("FO Team (81mm)", "artillery", "forward_observer", "8,1", {
        notes: "Forward observer for battalion 81mm mortar platoon (6 tubes, off-map). Call-for-fire: 1 turn delay. Smoke and HE",
        morale: 70, cohesion: 75, ammo: 100,
        specialCapabilities: ["precision_fire"],
      }),
      us("Bazooka Team", "infantry", "anti_tank_team", "4,2", {
        notes: "2x M1A1 bazookas from company weapons. AT close defense against armored counterattack",
        morale: 65, cohesion: 70, ammo: 75,
        specialCapabilities: ["anti_armor"],
      }),
      us("Recon Scout Section", "recon", "squad", "7,0", {
        notes: "2 scouts probing for German positions. Expendable — their job is to draw fire and reveal MG nests",
        strength: 80, morale: 60, cohesion: 65, ammo: 70,
      }),
      us("Co A HQ (Capt. Morrison)", "headquarters", "company", "8,3", {
        notes: "Company CP behind the start line. Radio link to battalion for mortar support. SCR-300 radio",
        morale: 75, cohesion: 80, ammo: 90, supply: 90,
      }),

      // ═══════════════════════════════════════════════════════════
      // GERMAN FORCES — Reinforced Kompanie (defender)
      // Dug in across 3 hedgerow defense lines, rows 6-16
      // ═══════════════════════════════════════════════════════════

      de("1. Zug (MG42 West)", "infantry", "platoon", "3,7", {
        notes: "Squad with MG42 dug into hedgerow berm, NW field. Interlocking fire with center position. Camouflaged — not visible until they fire",
        morale: 75, cohesion: 85, entrenchment: 65,
        specialCapabilities: ["sustained_fire"],
      }),
      de("2. Zug (MG42 Center)", "infantry", "platoon", "7,6", {
        notes: "Squad with 2x MG42s in keystone position covering the sunken lane. Both guns in earth bunkers with overhead cover. Pre-registered mortar DF to the north",
        morale: 80, cohesion: 90, entrenchment: 70,
        specialCapabilities: ["sustained_fire"],
      }),
      de("3. Zug (MG42 East)", "infantry", "platoon", "11,8", {
        notes: "Squad with MG42 covering the east creek approach. Positioned in a stone farmhouse ruin — hard cover",
        morale: 75, cohesion: 80, entrenchment: 60,
        specialCapabilities: ["sustained_fire"],
      }),
      de("4. Zug (AT Position)", "infantry", "anti_tank_team", "8,11", {
        notes: "PAK 40 75mm AT gun covering the road through a narrow bocage gap. 2x Panzerfaust teams flanking",
        morale: 75, cohesion: 80, ammo: 65, entrenchment: 50,
        specialCapabilities: ["anti_armor"],
      }),
      de("Mortar Team (80mm)", "artillery", "mortar_section", "5,13", {
        notes: "2x GrW 34 80mm mortars south of stream behind hedgerow. Pre-registered targets on 3 approach routes. Ammo limited — 35 rounds per tube",
        morale: 70, cohesion: 80, ammo: 60, entrenchment: 40,
      }),
      de("Sniper (Waldteufel)", "infantry", "sniper_team", "5,9", {
        notes: "Expert sniper in a tree position overlooking 3 fields. Will target US officers and NCOs. Extremely hard to locate",
        strength: 90, morale: 85, cohesion: 90, ammo: 75, entrenchment: 30,
        specialCapabilities: ["precision_fire"],
      }),
      de("Counterattack Squad", "infantry", "platoon", "7,15", {
        notes: "Reserve squad + MG42 team behind the road junction. Standing orders: counterattack any penetration immediately",
        morale: 80, cohesion: 85, ammo: 75, entrenchment: 20,
        posture: "reserve",
        specialCapabilities: ["sustained_fire"],
      }),
      de("StuG III (attached)", "armor", "anti_tank_team", "9,16", {
        notes: "1x StuG III Ausf.G. Mobile reserve hull-down behind the junction. 75mm gun can destroy any Sherman",
        morale: 70, cohesion: 75, ammo: 65, entrenchment: 15,
        movementType: "tracked",
        posture: "reserve",
        specialCapabilities: ["anti_armor", "heavy_armor"],
      }),
      de("Kp.HQ (Hptm. Brandt)", "headquarters", "company", "8,14", {
        notes: "Company CP in a stone farmhouse. Field telephone wire to all positions. Directs mortar fire and counterattack timing",
        morale: 75, cohesion: 80, ammo: 80, supply: 70, entrenchment: 35,
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// RED STORM: FULDA GAP — Cold War, 1985
// Grand tactical scale: company/battalion, 4-hour turns, 1km hexes
// Soviet MRR attacks through the Fulda corridor.
// US armored brigade defends in depth per AirLand Battle doctrine.
// Tests: supply network, command hierarchy, combined arms, defense in depth
// ════════════════════════════════════════════════════════════════

function getFuldaGapPreset() {
  presetCounter = 0;

  function sov(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "attacking",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 70,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 60,
      cohesion: overrides.cohesion || 75,
      ammo: overrides.ammo || 65,
      entrenchment: overrides.entrenchment || 0,
      detected: overrides.detected ?? false,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "tracked",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  function nato(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 85,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 80,
      cohesion: overrides.cohesion || 85,
      ammo: overrides.ammo || 80,
      entrenchment: overrides.entrenchment || 30,
      detected: true,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "tracked",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  const SOV_HQ = "unit_preset_1";
  const NATO_HQ = "unit_preset_16";

  return {
    scale: "grand_tactical",

    title: "Red Storm: Fulda Gap",
    description: "August 1985. A Soviet motor rifle regiment of the 8th Guards Combined Arms Army attacks through the Fulda corridor toward Frankfurt. Elements of a US armored brigade (V Corps, 3rd Armored Division) defend prepared positions in depth. The Soviets attack in two echelons with a fresh battalion 15-20km behind ready to exploit success. NATO must identify the main effort, attrit the first echelon, and prevent the second echelon from reaching the fight.",
    initialConditions: "Dawn, Day 3 of the war. The 11th ACR covering force has been pushed back after 48 hours of delay. The Soviet regiment is deploying from march column into attack formation. NATO positions are prepared with pre-planned engagement areas and kill zones. Both sides' artillery has been firing counterbattery for 6 hours. Electronic warfare is heavy — radio communications are intermittent.",
    specialRules: "ECHELONMENT: Soviet 2nd echelon battalion starts 18 hexes behind the 1st echelon and advances at march rate until committed. Commitment requires a regimental order (1 turn delay). SUPPLY: Soviet regiment carries 1.5 days of combat supply — operations degrade after 6 turns of heavy combat if cut off. NATO has limited TOW reloads (7 per Bradley). COMBINED ARMS: Units attacking with both armor and infantry in the same or adjacent hex receive a combined arms bonus. CAS: NATO may request 1 A-10 sortie per turn, but Soviet AD umbrella degrades effectiveness. If SA-8/SA-13 battery destroyed, CAS effectiveness doubles. C2 DEGRADATION: Destroying a HQ causes 2-turn paralysis (Soviet) or 1-turn coordination loss (NATO).",
    turnDuration: "4 hours",
    startDate: "1985-08-15",

    environment: {
      weather: "overcast",
      visibility: "moderate",
      groundCondition: "dry",
      timeOfDay: "dawn",
      climate: "temperate",
      stability: "low",
      severity: "moderate",
    },

    actors: [
      {
        id: "actor_1",
        name: "142nd Motor Rifle Regiment, 8th Guards CAA",
        controller: "player",
        objectives: [
          "Break through the NATO main battle area and advance at least 15km westward",
          "Seize the key road junction to open the corridor for division exploitation",
          "Destroy or bypass at least one NATO battalion task force",
        ],
        constraints: [
          "Must maintain momentum — the division timetable requires 20km/day advance",
          "Second echelon cannot be committed without regimental order (1 turn delay)",
          "Ammunition limited to 1.5 unit-of-fire — cannot sustain heavy combat beyond 6 turns without resupply",
          "AD umbrella must remain intact to suppress NATO CAS",
        ],
      },
      {
        id: "actor_2",
        name: "1st Brigade, 3rd Armored Division (V Corps)",
        controller: "player",
        objectives: [
          "Hold the main battle area — prevent Soviet penetration beyond phase line Alpha (column 8)",
          "Destroy 50% of the Soviet first echelon before the second echelon arrives",
          "Preserve the counterattack reserve for a decisive blow",
        ],
        constraints: [
          "Cannot withdraw past phase line Bravo (column 5) without corps authorization",
          "TOW missile supply critical — each Bradley carries only 7, no resupply during the battle",
          "CAS limited to 1 sortie per turn — Soviet AD must be degraded first",
          "Must maintain at least one functioning battalion HQ for coordination",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // SOVIET 142ND MRR — Two echelons + supporting arms
      // ═══════════════════════════════════════════════════════════

      sov("142nd MRR HQ (Col. Volkov)", "headquarters", "brigade", "19,10", {
        notes: "Regimental CP in BTR. If destroyed, regiment paralyzed 2 turns. All orders flow through here",
        morale: 65, cohesion: 80, ammo: 60, supply: 75, entrenchment: 5,
        detected: true,
      }),

      // 1st MR Battalion (BMP-2, 1st echelon north)
      sov("1st MR Co (BMP-2)", "mechanized", "company", "18,5", {
        notes: "Lead company north. 10x BMP-2 with 30mm + AT-5 ATGM. Dismounted MR squads",
        morale: 60, cohesion: 75, ammo: 65, parentHQ: SOV_HQ,
      }),
      sov("2nd MR Co (BMP-2)", "mechanized", "company", "19,6", {
        notes: "Supporting company north. 10x BMP-2. Echeloned 1km behind lead",
        morale: 60, cohesion: 75, ammo: 65, parentHQ: SOV_HQ,
      }),
      sov("3rd MR Co (BMP-2)", "mechanized", "company", "19,7", {
        notes: "1st Bn reserve. Will reinforce or exploit on northern axis",
        morale: 55, cohesion: 70, ammo: 65, parentHQ: SOV_HQ, posture: "reserve",
      }),

      // 2nd MR Battalion (BTR-80, 1st echelon south)
      sov("4th MR Co (BTR-80)", "mechanized", "company", "18,14", {
        notes: "Lead company south. 12x BTR-80 APCs — infantry must dismount to fight",
        morale: 60, cohesion: 70, ammo: 60, parentHQ: SOV_HQ, movementType: "wheeled",
      }),
      sov("5th MR Co (BTR-80)", "mechanized", "company", "19,15", {
        notes: "Supporting company south. 12x BTR-80. Following 4th Company",
        morale: 55, cohesion: 70, ammo: 60, parentHQ: SOV_HQ, movementType: "wheeled",
      }),
      sov("6th MR Co (BTR-80)", "mechanized", "company", "19,13", {
        notes: "2nd Bn reserve. Southern echelon",
        morale: 55, cohesion: 70, ammo: 60, parentHQ: SOV_HQ, posture: "reserve", movementType: "wheeled",
      }),

      // Tank Battalion
      sov("1st Tank Co (T-72B)", "armor", "company", "17,8", {
        notes: "10x T-72B. Spearhead north. 125mm gun effective 1-2km vs M1. No thermal sights",
        morale: 65, cohesion: 80, ammo: 70, parentHQ: SOV_HQ,
        specialCapabilities: ["heavy_armor"],
      }),
      sov("2nd Tank Co (T-72B)", "armor", "company", "17,12", {
        notes: "10x T-72B. Supporting south. Exploitation force if southern penetration succeeds",
        morale: 65, cohesion: 80, ammo: 70, parentHQ: SOV_HQ,
        specialCapabilities: ["heavy_armor"],
      }),
      sov("3rd Tank Co (T-72B)", "armor", "company", "19,11", {
        notes: "10x T-72B. Regimental reserve — committed only on order to exploit breakthrough",
        morale: 65, cohesion: 75, ammo: 70, parentHQ: SOV_HQ, posture: "reserve",
        specialCapabilities: ["heavy_armor"],
      }),

      // 3rd MR Battalion (BMP-1, 2nd echelon — 18km behind)
      sov("7th MR Co (BMP-1)", "mechanized", "company", "19,4", {
        notes: "2nd echelon lead. 10x BMP-1. At eastern staging area. Cannot commit without regimental order",
        morale: 55, cohesion: 70, ammo: 65, parentHQ: SOV_HQ, posture: "moving",
      }),
      sov("8th MR Co (BMP-1)", "mechanized", "company", "19,5", {
        notes: "2nd echelon follow-on. BMP-1. In march column",
        morale: 55, cohesion: 70, ammo: 65, parentHQ: SOV_HQ, posture: "moving",
      }),
      sov("9th MR Co (BMP-1)", "mechanized", "company", "18,7", {
        notes: "2nd echelon tail. BMP-1. Last element of 3rd Battalion. Staging one hex west/south of main column",
        morale: 55, cohesion: 65, ammo: 65, parentHQ: SOV_HQ, posture: "moving",
      }),

      // Supporting arms
      sov("Regt Artillery Bn (2S1)", "artillery", "artillery_battery", "18,10", {
        notes: "18x 2S1 122mm SP howitzers. Pre-planned fire schedule. Slow to redirect (1 turn delay for new targets)",
        morale: 65, cohesion: 80, ammo: 55, supply: 60, parentHQ: SOV_HQ,
      }),

      // ── NATO Brigade HQ — this is unit_preset_16 ──

      nato("1st Bde HQ (Col. Andrews)", "headquarters", "brigade", "4,10", {
        notes: "Brigade TOC. If destroyed, 1-turn coordination loss. Alternate TAC CP at 3,8",
        morale: 85, cohesion: 90, ammo: 90, supply: 90, entrenchment: 40,
        movementType: "wheeled",
      }),

      // Continue Soviet supporting arms (after NATO HQ to maintain unit ID ordering)
      sov("Recon Company (BRDM-2)", "recon", "company", "16,10", {
        notes: "BRDM-2 scouts + BMP-1R. Forward screen 5km ahead. Identifying NATO positions",
        morale: 60, cohesion: 70, ammo: 50, parentHQ: SOV_HQ,
        specialCapabilities: ["drone_equipped"],
      }),
      sov("AD Battery (ZSU-23-4/SA-13)", "air_defense", "company", "19,9", {
        notes: "4x ZSU-23-4 Shilka + 4x SA-13 Gopher. If destroyed, NATO CAS effectiveness doubles",
        morale: 60, cohesion: 75, ammo: 60, parentHQ: SOV_HQ,
        specialCapabilities: ["short_range_ad"],
      }),
      sov("Engineer Company", "engineer", "company", "19,12", {
        notes: "Mine-clearing, bridging, obstacle breaching. TMM bridge-layer. Critical for advance through NATO obstacles",
        morale: 55, cohesion: 70, ammo: 50, parentHQ: SOV_HQ,
        specialCapabilities: ["breaching", "bridging"],
      }),
      sov("Regimental Supply Train", "logistics", "company", "18,11", {
        notes: "0.5 UoF ammo + fuel. If destroyed, regiment loses resupply capability",
        morale: 45, cohesion: 60, ammo: 100, supply: 100, parentHQ: SOV_HQ,
        movementType: "wheeled",
      }),

      // ═══════════════════════════════════════════════════════════
      // NATO 1ST BRIGADE — Defense in depth
      // ═══════════════════════════════════════════════════════════

      // TF 1-32 Armor (tank-heavy, northern sector)
      nato("A Co, 1-32 Armor (M1)", "armor", "company", "11,4", {
        notes: "14x M1 Abrams (105mm). Forward battle position, hull-down. Thermal sights = first-shot advantage at 2-3km",
        morale: 85, cohesion: 90, ammo: 80, entrenchment: 35, parentHQ: NATO_HQ,
        specialCapabilities: ["heavy_armor"],
      }),
      nato("B Co, 1-32 Armor (M1)", "armor", "company", "8,5", {
        notes: "14x M1 Abrams. Depth position. Will displace after 2 engagements",
        morale: 85, cohesion: 85, ammo: 80, entrenchment: 30, parentHQ: NATO_HQ,
        specialCapabilities: ["heavy_armor"],
      }),
      nato("C Co (Mech), 1-32 (M2)", "mechanized", "company", "12,6", {
        notes: "13x M2 Bradley. TOW overwatch northern approaches. 7 TOW per vehicle — no resupply",
        morale: 80, cohesion: 85, ammo: 80, entrenchment: 40, parentHQ: NATO_HQ,
        specialCapabilities: ["anti_armor"],
      }),

      // TF 2-36 Infantry (mech-heavy, southern sector)
      nato("A Co (Mech), 2-36 Inf (M2)", "mechanized", "company", "12,14", {
        notes: "13x M2 Bradley. Forward position south. TOW overwatch. Dismounts with Dragons",
        morale: 80, cohesion: 85, ammo: 80, entrenchment: 40, parentHQ: NATO_HQ,
        specialCapabilities: ["anti_armor"],
      }),
      nato("B Co (Mech), 2-36 Inf (M2)", "mechanized", "company", "10,15", {
        notes: "13x M2 Bradley. Depth position south. East of Fulda River, covering alternate avenue of approach",
        morale: 80, cohesion: 80, ammo: 80, entrenchment: 35, parentHQ: NATO_HQ,
        specialCapabilities: ["anti_armor"],
      }),
      nato("C Co, 2-36 (Armor, M1)", "armor", "company", "10,12", {
        notes: "14x M1 cross-attached. Mobile firepower south. Pre-positioned for lateral displacement",
        morale: 85, cohesion: 85, ammo: 80, entrenchment: 25, parentHQ: NATO_HQ,
        specialCapabilities: ["heavy_armor"],
      }),

      // Brigade reserve
      nato("D Co, 3-5 Cav (M1/M3)", "armor", "company", "4,7", {
        notes: "Mixed M1/M3 cavalry. Brigade counterattack reserve — committed only against confirmed breakthrough",
        morale: 85, cohesion: 85, ammo: 85, entrenchment: 15, parentHQ: NATO_HQ,
        posture: "reserve", specialCapabilities: ["heavy_armor"],
      }),
      nato("E Co, 3-5 Cav (M2)", "mechanized", "company", "5,12", {
        notes: "M2 Bradleys. Second reserve element. Designated for southern counterattack",
        morale: 80, cohesion: 85, ammo: 85, entrenchment: 10, parentHQ: NATO_HQ,
        posture: "reserve", specialCapabilities: ["anti_armor"],
      }),

      // Fire support
      nato("2-3 FA (DS Artillery)", "artillery", "artillery_battery", "3,10", {
        notes: "18x M109A3 155mm SP. Direct support — responsive fires, DPICM and HE. Priority: counterbattery, then EAs",
        morale: 80, cohesion: 85, ammo: 75, supply: 80, entrenchment: 20, parentHQ: NATO_HQ,
      }),

      // Engineers
      nato("B Co, 23rd Engineer Bn", "engineer", "company", "7,10", {
        notes: "Obstacle belt complete — minefields and tank ditches across both EAs. FASCAM available",
        morale: 75, cohesion: 80, ammo: 70, entrenchment: 20, parentHQ: NATO_HQ,
        movementType: "wheeled", specialCapabilities: ["breaching"],
      }),

      // Air defense
      nato("A Btry, 2-6 ADA", "air_defense", "company", "6,9", {
        notes: "M163 Vulcan 20mm + Stinger MANPADS. SHORAD coverage over TOC and artillery",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 15, parentHQ: NATO_HQ,
        specialCapabilities: ["short_range_ad"],
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// MOSUL CORRIDOR — Modern Urban/Asymmetric, 2017
// Tactical scale: platoon/company, 1-hour turns, 100m hexes
// Coalition mechanized company secures a corridor through urban fringe.
// ISIS fighters defend with IEDs, SVBIEDs, snipers, and tunnel networks.
// Tests: urban warfare, asymmetric, ISR/drones, restricted ROE, IEDs
// ════════════════════════════════════════════════════════════════

function getMosulCorridorPreset() {
  presetCounter = 0;

  function coa(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "ready",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 85,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 70,
      cohesion: overrides.cohesion || 75,
      ammo: overrides.ammo || 80,
      entrenchment: overrides.entrenchment || 0,
      fatigue: overrides.fatigue || 10,
      detected: true,
      movementType: overrides.movementType || "tracked",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  function isis(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 50,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 75,
      cohesion: overrides.cohesion || 60,
      ammo: overrides.ammo || 60,
      entrenchment: overrides.entrenchment || 40,
      fatigue: overrides.fatigue || 20,
      detected: false,
      movementType: "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  return {
    scale: "tactical",

    title: "Mosul Corridor",
    description: "January 2017, eastern Mosul outskirts. An Iraqi CTS mechanized company with US SOF advisors must secure a 6km corridor through contested urban fringe to relieve a besieged outpost. ISIS fighters defend using IED networks, SVBIEDs, snipers, mouse-holed buildings, and tunnel systems. Each 100m hex captures 1-2 city blocks in built-up areas. 60x65 hex grid spans dense urban core (north) through suburban fringe to open farmland (south), with the Tigris River along the eastern edge.",
    initialConditions: "Morning, hazy. The company is staged in cleared farmland at the southern map edge (rows 58-63). Intelligence indicates 40-80 ISIS fighters with 3-5 SVBIEDs and an extensive IED belt in the suburban transition zone (rows 30-45). A Raven drone is available for 90-minute sorties. CAS is on-call but restricted by civilian presence. Three major N-S arterial roads (cols 12, 25, 40) provide approach routes.",
    specialRules: "IED THREAT: Suburban/urban hexes may contain IEDs. Un-cleared hex movement risks IED strike. Route clearance (engineer) reduces risk by 80% but costs 1 hex/turn. SVBIED: ISIS can launch SVBIEDs from building hexes — they move 3-4 hexes/turn. Catastrophic if they reach a unit. Stoppable by direct fire. ROE: Heavy weapons against buildings require JTAC confirmation (1 turn delay). TUNNELS: ISIS can move 1 squad between building hexes within 5 hex range without crossing open ground. ISR: Raven drone reveals enemy in 5-hex radius (open ground only). 6 turns per sortie, 3 turns to relaunch. IRRIGATION CANAL: Col 45 canal is fordable by infantry but blocks vehicles.",
    turnDuration: "1 hour",
    startDate: "2017-01-15",

    environment: {
      weather: "hazy",
      visibility: "moderate",
      groundCondition: "dry",
      timeOfDay: "morning",
      climate: "arid",
      stability: "low",
      severity: "light",
    },

    actors: [
      {
        id: "actor_1",
        name: "3rd Company, 1st ISOF Battalion (Golden Division)",
        controller: "player",
        objectives: [
          "Secure a corridor north to the besieged Coalition Outpost at (30,5)",
          "Clear the IED belt in the suburban fringe to allow vehicle movement",
          "Neutralize all SVBIED staging positions identified by ISR",
        ],
        constraints: [
          "ROE restricts heavy weapons against buildings without JTAC confirmation (1 turn delay)",
          "Civilian presence — collateral damage degrades future intelligence cooperation",
          "CTS cannot sustain more than 30% casualties — irreplaceable elite troops",
          "Raven drone has limited endurance (6 turns/sortie, 3 turns to relaunch)",
        ],
      },
      {
        id: "actor_2",
        name: "East Mosul Defense Cell (ISIS)",
        controller: "player",
        objectives: [
          "Prevent coalition forces from reaching the besieged outpost at (30,5)",
          "Inflict maximum vehicle casualties with IEDs and SVBIEDs",
          "Hold the dense urban zone as long as possible",
        ],
        constraints: [
          "No reinforcements — fight with available forces only",
          "SVBIED assets finite (4 vehicles) — cannot be replaced",
          "Limited ammunition and medical supplies",
          "Must exploit civilian presence as shield",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // COALITION — Iraqi CTS + US SOF
      // ═══════════════════════════════════════════════════════════

      coa("1st Tank Section (M1A1M)", "armor", "platoon", "12,62", {
        notes: "3x M1A1M Abrams. Lead armor on western arterial (col 12). 120mm gun but ROE-restricted in urban areas",
        morale: 70, cohesion: 75, ammo: 80,
        specialCapabilities: ["heavy_armor"],
      }),
      coa("2nd Tank Section (M1A1M)", "armor", "platoon", "25,62", {
        notes: "3x M1A1M. Follow-on armor on central arterial (col 25). Leapfrogs with 1st Section",
        morale: 70, cohesion: 75, ammo: 80,
        specialCapabilities: ["heavy_armor"],
      }),
      coa("1st Mech Platoon (M113)", "mechanized", "platoon", "14,60", {
        notes: "3x M113 + 30 CTS dismounts. Urban warfare specialists. Lead dismounted clearance western axis",
        morale: 75, cohesion: 80, ammo: 80,
      }),
      coa("2nd Mech Platoon (Humvee)", "mechanized", "platoon", "38,60", {
        notes: "4x Up-armored Humvees + 25 CTS dismounts. Eastern flank clearance along col 40 road",
        morale: 70, cohesion: 75, ammo: 75, movementType: "wheeled",
      }),
      coa("ODA 5131 Advisory Element", "special_forces", "squad", "12,61", {
        notes: "4x US SOF: team leader, JTAC (critical for CAS), comms, medic. Embedded with 1st Tank on western arterial",
        strength: 100, morale: 90, cohesion: 95, ammo: 85,
        movementType: "foot", specialCapabilities: ["precision_fire"],
      }),
      coa("Raven Drone Team", "recon", "squad", "20,63", {
        notes: "RQ-11 Raven. 5-hex radius ISR, day/IR. Cannot see inside buildings. 6 turns/sortie, 3 to relaunch. Needs open ground for launch",
        morale: 75, cohesion: 80, ammo: 100,
        movementType: "foot", specialCapabilities: ["drone_equipped"],
      }),
      coa("Engineer Squad (Route Clearance)", "engineer", "squad", "14,58", {
        notes: "Sappers with mine detectors + EOD. Route clearance: 1 hex/turn, reduces IED risk 80%. Forward on western approach ahead of armor",
        morale: 65, cohesion: 70, ammo: 70,
        movementType: "foot", specialCapabilities: ["breaching"],
      }),
      coa("Mortar Section (60mm)", "artillery", "mortar_section", "28,63", {
        notes: "2x 60mm mortars. Smoke and HE. Less ROE-restricted than tank guns. Rear staging area",
        morale: 70, cohesion: 75, ammo: 75, movementType: "foot",
      }),
      coa("3rd Co HQ (Capt. Haider)", "headquarters", "company", "25,61", {
        notes: "Company command in MRAP on central arterial. CAS requests through ODA JTAC. Directs route clearance priority",
        morale: 75, cohesion: 80, ammo: 85, supply: 85, movementType: "wheeled",
      }),

      // ═══════════════════════════════════════════════════════════
      // ISIS — East Mosul Defense Cell (~60 fighters)
      // ═══════════════════════════════════════════════════════════

      // Outer IED belt — suburban transition zone, blocking approach roads
      isis("IED Cell Alpha", "engineer", "squad", "14,38", {
        notes: "4 fighters managing command-wire IEDs on western suburban approach. 8 IEDs planted along col 12 road, rows 36-42",
        morale: 80, cohesion: 65, ammo: 50, specialCapabilities: ["breaching"],
      }),
      isis("IED Cell Bravo", "engineer", "squad", "38,36", {
        notes: "3 fighters managing pressure-plate IEDs on eastern approach. 6 IEDs along col 40 road, rows 34-40",
        morale: 75, cohesion: 60, ammo: 50, specialCapabilities: ["breaching"],
      }),
      isis("Sniper Team (Dhubab)", "infantry", "sniper_team", "25,24", {
        notes: "2-man sniper, Dragunov SVD, building overlooking E-W arterial (row 25) and central market. Targets CTS officers and JTAC",
        morale: 85, cohesion: 85, ammo: 70, entrenchment: 30,
        specialCapabilities: ["precision_fire"],
      }),

      // SVBIEDs — hidden deep in urban core, released when Coalition approaches
      isis("SVBIED 1 (West)", "armor", "squad", "10,12", {
        notes: "Up-armored SUV, 500kg HME. Hidden in garage off western arterial. Drone-guided. Catastrophic on contact",
        morale: 95, cohesion: 50, ammo: 100,
        movementType: "wheeled", posture: "reserve",
      }),
      isis("SVBIED 2 (East)", "armor", "squad", "35,18", {
        notes: "Disguised taxi, 600kg HME. Hidden in building on eastern urban fringe. Second wave — exploits confusion from first SVBIED",
        morale: 95, cohesion: 50, ammo: 100,
        movementType: "wheeled", posture: "reserve",
      }),

      // Urban defense cells — layered defense through the urban zone
      isis("Defense Cell 1 (Al-Quds)", "infantry", "platoon", "12,18", {
        notes: "20 fighters in western blocks along col 12 arterial. Mouse-holed buildings. PKM, RPG-7s. Tunnel access to Cell 2",
        morale: 75, cohesion: 65, ammo: 60, entrenchment: 50,
        specialCapabilities: ["anti_armor"],
      }),
      isis("Defense Cell 2 (Al-Zahra)", "infantry", "platoon", "25,10", {
        notes: "15 fighters at central arterial/E-W road intersection near hospital. 2-story buildings. Mortar pit on rooftop",
        morale: 70, cohesion: 60, ammo: 55, entrenchment: 45,
        specialCapabilities: ["anti_armor"],
      }),
      isis("Defense Cell 3 (Al-Noor)", "infantry", "platoon", "30,4", {
        notes: "18 fighters, deepest position near Coalition outpost at (30,5). Barricades, rubble berms, wire. Last line of defense. Will fight to the death",
        morale: 80, cohesion: 70, ammo: 65, entrenchment: 60,
        specialCapabilities: ["anti_armor"],
      }),
      isis("Mortar Team (82mm)", "artillery", "mortar_section", "22,7", {
        notes: "2x 82mm mortars in park near government complex. Pre-surveyed targets on all 3 approach arterials. 40 rounds total — conserve for high-value",
        morale: 70, cohesion: 65, ammo: 50, entrenchment: 25,
      }),
      isis("ATGM Team (Kornet)", "infantry", "anti_tank_team", "12,28", {
        notes: "2x 9M133 Kornet on rooftop at row 28, LOS down western arterial (col 12). 4 missiles total. Ambush lead armor at urban fringe",
        morale: 80, cohesion: 70, ammo: 55, entrenchment: 20,
        specialCapabilities: ["anti_armor", "precision_fire"],
      }),
      isis("Drone Recon Cell", "recon", "squad", "32,15", {
        notes: "DJI Phantom quadcopter. Real-time video to cells, guides SVBIEDs. Can drop 40mm grenades. Operating from rubble near university",
        morale: 70, cohesion: 65, ammo: 40,
        specialCapabilities: ["drone_equipped"],
      }),
      isis("Command Cell (Abu Khalid)", "headquarters", "company", "28,3", {
        notes: "Cell commander + 3 staff in hardened basement near government complex, deep in urban core. Controls SVBIED release and mortar allocation. If destroyed, cells fight independently",
        morale: 75, cohesion: 70, ammo: 60, supply: 40, entrenchment: 55,
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// CROSSING THE VOLTURNO — Italy, October 1943
// Grand tactical: company/battalion, 4-hour turns, 500m hexes
// US 7th Infantry Regiment forces a crossing of the Volturno River
// against the Hermann Göring Panzer Division.
// Tests: river crossing, entrenchment, artillery, weather, engineer bridging
// ════════════════════════════════════════════════════════════════

function getVolturnoPreset() {
  presetCounter = 0;

  function us(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_1", name, type, echelon,
      posture: overrides.posture || "ready",
      position: pos,
      strength: overrides.strength || 100,
      supply: overrides.supply || 80,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 75,
      cohesion: overrides.cohesion || 80,
      ammo: overrides.ammo || 80,
      entrenchment: overrides.entrenchment || 10,
      detected: true,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  function de(name, type, echelon, pos, overrides = {}) {
    return {
      id: uid(), actor: "actor_2", name, type, echelon,
      posture: overrides.posture || "defending",
      position: pos,
      strength: overrides.strength || 95,
      supply: overrides.supply || 65,
      status: overrides.status || "ready",
      notes: overrides.notes || "",
      morale: overrides.morale || 70,
      cohesion: overrides.cohesion || 75,
      ammo: overrides.ammo || 65,
      entrenchment: overrides.entrenchment || 45,
      detected: false,
      parentHQ: overrides.parentHQ || "",
      movementType: overrides.movementType || "foot",
      specialCapabilities: overrides.specialCapabilities || [],
    };
  }

  const US_HQ = "unit_preset_1";
  const DE_HQ = "unit_preset_15";

  return {
    scale: "grand_tactical",

    title: "Crossing the Volturno",
    description: "Night of October 12-13, 1943. The US 7th Infantry Regiment (3rd Infantry Division) must force a crossing of the rain-swollen Volturno River against prepared positions of the Hermann Göring Panzer Division. The river is 50-70m wide, 1-1.5m deep, with steep 2-5m banks. All bridges demolished. Assault crossing begins at midnight under a 1-hour artillery preparation.",
    initialConditions: "Night, heavy overcast, intermittent rain. The 7th Infantry has spent 6 days reconnoitering the far bank. Assault boats and engineering equipment staged 500m south. Division artillery (48 tubes) fires a 1-hour preparation at 0100. The Germans have held the north bank for 10 days with moderate entrenchment along the river and dominating ridgelines behind.",
    specialRules: "RIVER OBSTACLE: Infantry crosses by assault boat (1 turn) or wading at fords (1 turn, fatiguing). Vehicles cannot cross until bridge built. BRIDGING: Engineers begin construction after infantry secures far bank within 2 hexes. Light bridge: 2 turns. Heavy bridge: 4 turns. Construction halts under direct fire. NIGHT CROSSING: Turns 1-2 are night — reduced detection, slower movement. Turn 3 (dawn) restores normal visibility. PREPARATION: Turn 1 artillery suppresses all German units within 3 hexes of the river. RAIN: Wheeled movement -25%. Assault boats have 10% capsize risk per crossing.",
    turnDuration: "4 hours",
    startDate: "1943-10-12",

    environment: {
      weather: "rain",
      visibility: "poor",
      groundCondition: "wet",
      timeOfDay: "night",
      climate: "temperate",
      stability: "low",
      severity: "harsh",
    },

    actors: [
      {
        id: "actor_1",
        name: "7th Infantry Regiment, 3rd Infantry Division",
        controller: "player",
        objectives: [
          "Force a crossing and establish a bridgehead on the north bank",
          "Seize Triflisco Ridge (key high ground dominating the crossing site)",
          "Build at least one heavy bridge for tanks within 16 hours (4 turns)",
        ],
        constraints: [
          "Vehicles cannot cross until bridge complete — infantry fights alone first 2-4 turns",
          "Only 2 companies can cross simultaneously per bridge site",
          "Bridge construction halts under direct fire — must suppress overwatching positions",
          "Artillery adequate but not unlimited — 48 tubes, standard allocation",
        ],
      },
      {
        id: "actor_2",
        name: "Kampfgruppe Schmalz, Hermann Göring Panzer Division",
        controller: "player",
        objectives: [
          "Delay the crossing as long as possible — each turn gained helps Gustav Line preparation",
          "Inflict maximum casualties during the river crossing when Americans are most vulnerable",
          "Hold Triflisco Ridge — if it falls, the river position is untenable",
        ],
        constraints: [
          "Delaying position — withdrawal authorized if untenable, but not before inflicting significant delay",
          "Counterattack reserves limited — panzergrenadier company is the only mobile reserve",
          "Artillery ammunition moderate (65%) — conserve for decisive fires on crossing sites",
          "All bridges demolished — Americans must build their own, buying time",
        ],
      },
    ],

    units: [
      // ═══════════════════════════════════════════════════════════
      // US 7TH INFANTRY + SUPPORT — South bank, rows 12-17
      // River at rows 9-10
      // ═══════════════════════════════════════════════════════════

      us("7th Inf Regt HQ (Col. Sherman)", "headquarters", "brigade", "9,15", {
        notes: "Regimental CP south of river. Coordinates 3-battalion crossing with division artillery",
        morale: 85, cohesion: 90, ammo: 85, supply: 85, entrenchment: 15, movementType: "wheeled",
      }),

      // 1st Battalion (main effort — hairpin loop crossing)
      us("A Co, 1/7th Infantry", "infantry", "company", "7,12", {
        notes: "Lead assault company. Assault boats at hairpin loop, then attack NE toward Hill 502",
        morale: 80, cohesion: 85, ammo: 80, entrenchment: 5, parentHQ: US_HQ,
      }),
      us("B Co, 1/7th Infantry", "infantry", "company", "8,13", {
        notes: "Follow-on. Crosses after A Co secures near bank, pushes north to expand bridgehead",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 5, parentHQ: US_HQ,
      }),
      us("C Co, 1/7th Infantry", "infantry", "company", "6,13", {
        notes: "Flank security. Crosses west of hairpin at secondary ford, attacks toward Triflisco Ridge from east",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 5, parentHQ: US_HQ,
      }),
      us("D Co (Weapons), 1/7th", "infantry", "company", "8,14", {
        notes: "4x HMGs, 6x 81mm mortars. Fire support from south bank. Pre-registered targets on far bank",
        morale: 75, cohesion: 80, ammo: 85, entrenchment: 10, parentHQ: US_HQ,
        specialCapabilities: ["sustained_fire"],
      }),

      // 2nd Battalion (supporting attack — upstream crossing)
      us("E Co, 2/7th Infantry", "infantry", "company", "12,12", {
        notes: "Crossing upstream at tank ford. Diversionary attack to fix German reserves",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 5, parentHQ: US_HQ,
      }),
      us("F Co, 2/7th Infantry", "infantry", "company", "13,13", {
        notes: "Follow-on for 2nd Bn. Exploits weakness in eastern German positions",
        morale: 75, cohesion: 75, ammo: 80, entrenchment: 5, parentHQ: US_HQ,
      }),
      us("G Co, 2/7th Infantry", "infantry", "company", "11,13", {
        notes: "2nd Bn reserve. Committed once both leads are across and bridgehead expanding",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 5, parentHQ: US_HQ, posture: "reserve",
      }),

      // 3rd Battalion (regimental reserve)
      us("3rd Bn, 7th Infantry", "infantry", "battalion", "9,16", {
        notes: "Regimental reserve. Committed once heavy bridge built to exploit breakthrough. 750 troops",
        morale: 75, cohesion: 80, ammo: 85, entrenchment: 10, parentHQ: US_HQ, posture: "reserve",
      }),

      // Engineers
      us("Co A, 10th Engineer Bn", "engineer", "company", "7,13", {
        notes: "Light bridge builders. Assault boats at hairpin loop. Light bridge (jeep): 2 turns after far bank secured",
        morale: 75, cohesion: 80, ammo: 70, parentHQ: US_HQ,
        specialCapabilities: ["bridging", "breaching"],
      }),
      us("Co B, 10th Engineer Bn", "engineer", "company", "11,14", {
        notes: "Heavy bridge builders. 30-ton treadway for tanks: 4 turns. Begins after light bridge complete",
        morale: 75, cohesion: 80, ammo: 70, parentHQ: US_HQ,
        specialCapabilities: ["bridging"],
      }),

      // Division Artillery
      us("10th FA Bn (105mm)", "artillery", "artillery_battery", "6,16", {
        notes: "12x 105mm howitzers. Direct support. H-hour preparation, then responsive fire. Smoke available",
        morale: 80, cohesion: 85, ammo: 80, entrenchment: 15, parentHQ: US_HQ, movementType: "wheeled",
      }),
      us("39th FA Bn (105mm)", "artillery", "artillery_battery", "12,16", {
        notes: "12x 105mm. General support reinforcing. Counterbattery and ridgeline suppression",
        morale: 80, cohesion: 85, ammo: 80, entrenchment: 15, parentHQ: US_HQ, movementType: "wheeled",
      }),
      us("9th FA Bn (155mm)", "artillery", "artillery_battery", "9,17", {
        notes: "12x 155mm. Heavy fires for preparation. Prioritize Triflisco Ridge positions",
        morale: 80, cohesion: 85, ammo: 75, entrenchment: 15, parentHQ: US_HQ, movementType: "wheeled",
      }),

      // Armor (cannot cross until heavy bridge)
      us("Co A, 751st Tank Bn", "armor", "company", "10,16", {
        notes: "14x M4 Sherman. CANNOT cross until 30-ton bridge complete (~4 turns). Decisive exploitation once across",
        morale: 75, cohesion: 80, ammo: 80, entrenchment: 5, parentHQ: US_HQ, movementType: "tracked",
      }),

      // ═══════════════════════════════════════════════════════════
      // GERMAN KG SCHMALZ — North bank, rows 0-8
      // ═══════════════════════════════════════════════════════════

      de("KG Schmalz HQ", "headquarters", "brigade", "8,2", {
        notes: "Battle group CP on reverse slope of Triflisco Ridge. Wire comms to all positions. Controls counterattack timing",
        morale: 70, cohesion: 80, ammo: 65, supply: 65, entrenchment: 40, movementType: "wheeled",
      }),

      // River line
      de("1. Kompanie (Bank West)", "infantry", "company", "5,8", {
        notes: "120 troops dug into north bank/flood levee west of hairpin loop. 4x MG42 in earth bunkers. Wire at crossing points",
        morale: 70, cohesion: 75, ammo: 65, entrenchment: 55, parentHQ: DE_HQ,
        specialCapabilities: ["sustained_fire"],
      }),
      de("2. Kompanie (Bank East)", "infantry", "company", "12,7", {
        notes: "100 troops at tank ford. Stone quarry positions, excellent fields of fire over 200m open ground",
        morale: 65, cohesion: 70, ammo: 60, entrenchment: 40, parentHQ: DE_HQ,
        specialCapabilities: ["sustained_fire"],
      }),
      de("MG Platoon (Hairpin Loop)", "infantry", "company", "8,8", {
        notes: "3x MG42 on tripods covering hairpin loop — the kill zone. Interlocking fire. Camouflaged earth bunkers",
        morale: 75, cohesion: 85, ammo: 70, entrenchment: 65, parentHQ: DE_HQ,
        specialCapabilities: ["sustained_fire"],
      }),

      // Triflisco Ridge
      de("3. Kompanie (Ridge West)", "infantry", "company", "4,4", {
        notes: "80 troops on western Triflisco Ridge. Reverse slope — hidden from US observation. Dominates crossing sites",
        morale: 70, cohesion: 75, ammo: 60, entrenchment: 50, parentHQ: DE_HQ, posture: "dug_in",
      }),
      de("4. Kompanie (Hill 502)", "infantry", "company", "11,3", {
        notes: "90 troops on Monte Majulo. Key observation point. If Americans take this hill, east bank position collapses",
        morale: 70, cohesion: 75, ammo: 60, entrenchment: 45, parentHQ: DE_HQ, posture: "dug_in",
      }),

      // AT
      de("PaK 40 Battery (Ridge Gap)", "tank_destroyer", "company", "7,5", {
        notes: "2x PaK 40 75mm AT guns in Triflisco Gap covering road. Pre-registered fire lanes. Well-camouflaged",
        morale: 70, cohesion: 80, ammo: 65, entrenchment: 50, parentHQ: DE_HQ,
        specialCapabilities: ["anti_armor"],
      }),

      // Artillery
      de("Artillerie-Abteilung (105/150mm)", "artillery", "artillery_battery", "6,1", {
        notes: "4x 105mm + 2x 150mm. Main gun area on massif. Pre-registered on all crossing sites and assembly areas",
        morale: 70, cohesion: 80, ammo: 60, supply: 60, entrenchment: 30, parentHQ: DE_HQ, movementType: "wheeled",
      }),
      de("Nebelwerfer Battery", "artillery", "artillery_battery", "10,1", {
        notes: "4x 150mm Nebelwerfer 41 rockets. Devastating area fire, inaccurate. Pre-registered on south bank assembly areas",
        morale: 65, cohesion: 75, ammo: 55, entrenchment: 20, parentHQ: DE_HQ, movementType: "wheeled",
        specialCapabilities: ["area_fire"],
      }),
      de("80mm Mortar Section", "artillery", "company", "9,6", {
        notes: "4x 80mm mortars forward. Pre-registered on crossing sites. Fast response. 60 rounds per tube",
        morale: 70, cohesion: 80, ammo: 55, entrenchment: 35, parentHQ: DE_HQ,
      }),

      // Mobile reserve
      de("PzGren Kompanie (Reserve)", "armored_infantry", "company", "8,3", {
        notes: "120 panzergrenadiers in half-tracks. Only counterattack force. Immediate counterattack against ridge penetration",
        morale: 75, cohesion: 80, ammo: 70, entrenchment: 10, parentHQ: DE_HQ,
        posture: "reserve", movementType: "tracked",
      }),
      de("StuG III Platoon", "armor", "company", "7,2", {
        notes: "2x StuG III Ausf.G. Hull-down behind ridge. Engages American armor if they get tanks across",
        morale: 70, cohesion: 75, ammo: 65, entrenchment: 20, parentHQ: DE_HQ,
        posture: "reserve", movementType: "tracked",
        specialCapabilities: ["anti_armor", "heavy_armor"],
      }),

      // FO
      de("FO Team (Ridge Crest)", "recon", "squad", "9,4", {
        notes: "Artillery observers on ridge crest. Superb observation of US assembly area and crossings. PRIORITY TARGET for US artillery",
        strength: 90, morale: 75, cohesion: 85, ammo: 50, entrenchment: 35, parentHQ: DE_HQ,
        specialCapabilities: ["precision_fire"],
      }),
    ],
  };
}

// ════════════════════════════════════════════════════════════════
// AIR REFERENCE — Combined arms with air power on the 12x18 test fixture
// Tests: air orders, altitude, AD coverage, readiness, fuel, interception,
//        CAS targeting, escort assignment, bingo warnings, flight paths
// ════════════════════════════════════════════════════════════════

function getAirReferencePreset() {
  presetCounter = 0;

  return {
    scale: "grand_tactical",
    title: "Air Strike: Ashbury",
    description: "Blue Force launches a combined arms assault on Ashbury supported by CAS and air superiority sorties from Ashbury Strip (K5). Red Force defends with SHORAD and medium AD coverage.",
    initialConditions: "Morning. Clear skies. Blue Force controls the airfield at Ashbury Strip (K5). Red Force has established a defensive line west of the river with integrated air defense.",
    specialRules: "Air units can operate from Ashbury Strip airfield. AD coverage affects flight path planning. Altitude selection impacts AD vulnerability and CAS effectiveness.",
    turnDuration: "4 hours",
    startDate: "2024-09-15",

    environment: {
      weather: "clear",
      visibility: "good",
      groundCondition: "dry",
      timeOfDay: "morning",
      climate: "temperate",
      stability: "medium",
      severity: "low",
    },

    actors: [
      {
        id: "actor_1",
        name: "Blue Force",
        controller: "player",
        objectives: ["Secure Ashbury and the bridge at D5", "Achieve air superiority over the AO", "Neutralize Red AD to enable CAS"],
        constraints: ["Minimize collateral damage to Ashbury", "Maintain air readiness above 40%"],
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: ["Deny Blue Force the river crossing", "Shoot down Blue air assets", "Hold defensive line west of river"],
        constraints: ["Do not withdraw past column B", "Preserve AD assets for sustained defense"],
      },
    ],

    eraSelections: { actor_1: "modern", actor_2: "modern" },

    units: [
      // ── Blue Force — Ground ──
      { id: uid(), actor: "actor_1", name: "Alpha Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "8,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "1st Armor (Steel)", type: "armor", echelon: "battalion", posture: "reserve", position: "9,3", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "tracked", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Thunder Battery", type: "artillery", echelon: "artillery_battery", posture: "ready", position: "11,6", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
      { id: uid(), actor: "actor_1", name: "Blue HQ", type: "headquarters", echelon: "brigade", posture: "ready", position: "10,7", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },

      // ── Blue Force — Air ──
      // CAS flight at the airfield (airfield is at 10,4 "Ashbury Strip")
      { id: uid(), actor: "actor_1", name: "Viper Flight (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
        airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
        specialCapabilities: ["close_air_support", "precision_strike", "all_weather"] },
      // Air superiority fighter
      { id: uid(), actor: "actor_1", name: "Eagle Flight (F-15C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
        airProfile: { speed: "fast", maneuverability: 8, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
        specialCapabilities: ["air_superiority", "bvr_capable"] },
      // Attack helicopter (persistent — has fuel)
      { id: uid(), actor: "actor_1", name: "Apache Pair", type: "attack_helicopter", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 80, munitions: 100, fuel: 100, baseHex: "10,4", detected: true, movementType: "helicopter",
        airProfile: { speed: "slow", maneuverability: 6, weaponsPackage: "precision_guided", defensiveArmament: false, ecm: false, radarEquipped: false },
        specialCapabilities: ["close_air_support", "anti_armor"] },

      // ── Red Force — Ground ──
      { id: uid(), actor: "actor_2", name: "Red Guard Platoon", type: "infantry", echelon: "battalion", posture: "defending", position: "2,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Sentinel Platoon", type: "infantry", echelon: "battalion", posture: "dug_in", position: "2,6", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 60, detected: true, movementType: "foot", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Iron Fist Troop", type: "armor", echelon: "battalion", posture: "reserve", position: "1,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "tracked", specialCapabilities: [] },
      { id: uid(), actor: "actor_2", name: "Red HQ", type: "headquarters", echelon: "brigade", posture: "ready", position: "0,6", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },

      // ── Red Force — Air Defense ──
      // SHORAD unit near the front (gun + IR missile)
      { id: uid(), actor: "actor_2", name: "Tunguska Battery", type: "air_defense", echelon: "company", posture: "defending", position: "3,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: true, movementType: "tracked",
        specialCapabilities: ["gun_ad", "ir_missile_ad"] },
      // Medium AD unit further back (radar missile)
      { id: uid(), actor: "actor_2", name: "SA-11 Battery", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "1,7", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: true, movementType: "tracked",
        specialCapabilities: ["radar_missile_ad"] },

      // ── Red Force — Air ──
      // Interceptor (no airfield on Red side — off-map based, lower readiness)
      { id: uid(), actor: "actor_2", name: "Flanker Pair (Su-27)", type: "air", echelon: "company", posture: "ready", position: "0,3", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 70, munitions: 100, baseHex: "", detected: true, movementType: "air",
        airProfile: { speed: "fast", maneuverability: 9, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
        specialCapabilities: ["air_superiority", "bvr_capable"] },
    ],
  };
}

// ── AD Valley: Dense overlapping AD corridor stress test ──
// 2 fighter flights fly LOW through 8 AD systems spanning 7 columns.
// Every hex on the flight path is inside at least 2-3 AD engagement envelopes.
// Realistic outcome: both flights destroyed or combat-ineffective before reaching target.
function getAdValleyPreset() {
  presetCounter = 0;

  return {
    scale: "grand_tactical",
    title: "AD Valley Kill Zone",
    description: "Two F-16 flights attempt a low-altitude CAS run through a valley saturated with overlapping air defenses. 8 AD systems — guns, IR missiles, and radar SAMs — create interlocking kill zones with no safe corridor. This is a suicide mission.",
    initialConditions: "Clear morning. Blue Force has launched two CAS flights from Ashbury Strip (K5) targeting Red infantry at B4. The flight path crosses directly through Red Force's integrated air defense network spanning columns C through I. Red AD is fully alert, radar active, weapons free.",
    specialRules: "All AD units are at full readiness with weapons free ROE. Aircraft are flying LOW altitude through the entire corridor. No SEAD or EW support. No escort. This is a worst-case scenario for the attacking aircraft.",
    turnDuration: "2 hours",
    startDate: "2024-09-15",

    environment: {
      weather: "clear",
      visibility: "unlimited",
      groundCondition: "dry",
      timeOfDay: "morning",
      climate: "temperate",
      stability: "high",
      severity: "mild",
    },

    actors: [
      {
        id: "actor_1",
        name: "Blue Force",
        controller: "player",
        objectives: ["Provide CAS to friendly ground forces at B4"],
        constraints: ["No SEAD assets available", "Must fly through AD corridor"],
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: ["Destroy all Blue air assets", "Maintain AD umbrella over the valley"],
        constraints: ["Hold positions", "Weapons free on all air contacts"],
      },
    ],

    eraSelections: { actor_1: "modern", actor_2: "modern" },

    units: [
      // ── Blue Force — Air (the guinea pigs) ──
      // Two F-16 flights flying CAS — based at Ashbury Strip (10,4)
      { id: uid(), actor: "actor_1", name: "Falcon 1 (F-16C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
        airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
        specialCapabilities: ["close_air_support", "precision_strike"] },
      { id: uid(), actor: "actor_1", name: "Falcon 2 (F-16C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
        airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
        specialCapabilities: ["close_air_support", "precision_strike"] },

      // ── Blue Force — Ground (the CAS target, something for them to aim at) ──
      { id: uid(), actor: "actor_1", name: "Bravo Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "2,3", strength: 75, supply: 80, status: "ready", morale: 85, ammo: 80, entrenchment: 0, detected: true, movementType: "foot", specialCapabilities: [] },

      // ── Red Force — Ground (what Blue is trying to CAS) ──
      { id: uid(), actor: "actor_2", name: "Red Guard Battalion", type: "infantry", echelon: "battalion", posture: "dug_in", position: "1,3", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, entrenchment: 60, detected: true, movementType: "foot", specialCapabilities: [] },

      // ── Red Force — AD Corridor (the gauntlet) ──
      // Spaced across columns 3-9, rows 3-5, creating overlapping engagement zones.
      // Each radar_missile_ad covers 4 hex, ir_missile_ad 2 hex, gun_ad 1 hex.
      // At LOW altitude, all types are highly effective.

      // Col 3: SHORAD pair — first thing the planes hit
      { id: uid(), actor: "actor_2", name: "ZSU-23 Shilka", type: "air_defense", echelon: "company", posture: "defending", position: "8,3", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: true, movementType: "tracked",
        specialCapabilities: ["gun_ad"] },
      { id: uid(), actor: "actor_2", name: "Strela-10 Battery", type: "air_defense", echelon: "company", posture: "defending", position: "8,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: true, movementType: "tracked",
        specialCapabilities: ["ir_missile_ad"] },

      // Col 5-6: SA-11 radar SAM — medium range, covers the mid-corridor
      { id: uid(), actor: "actor_2", name: "SA-11 Buk Battery A", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "6,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "tracked",
        specialCapabilities: ["radar_missile_ad"] },
      { id: uid(), actor: "actor_2", name: "SA-11 Buk Battery B", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "5,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "tracked",
        specialCapabilities: ["radar_missile_ad"] },

      // Col 4: Tunguska — dual gun+IR, deadly at low alt
      { id: uid(), actor: "actor_2", name: "Tunguska Battery", type: "air_defense", echelon: "company", posture: "defending", position: "7,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: true, movementType: "tracked",
        specialCapabilities: ["gun_ad", "ir_missile_ad"] },

      // Col 7: Another SA-11 — long range umbrella covering deep corridor
      { id: uid(), actor: "actor_2", name: "SA-11 Buk Battery C", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "4,3", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "tracked",
        specialCapabilities: ["radar_missile_ad"] },

      // Col 8-9: Terminal defense — last chance to kill before target
      { id: uid(), actor: "actor_2", name: "Pantsir Battery", type: "air_defense", echelon: "company", posture: "defending", position: "3,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: true, movementType: "tracked",
        specialCapabilities: ["gun_ad", "ir_missile_ad", "radar_missile_ad"] },
      { id: uid(), actor: "actor_2", name: "SA-15 Tor Battery", type: "air_defense", echelon: "company", posture: "defending", position: "3,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 25, detected: true, movementType: "tracked",
        specialCapabilities: ["ir_missile_ad", "radar_missile_ad"] },
    ],
  };
}
