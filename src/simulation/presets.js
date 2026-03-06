// ════════════════════════════════════════════════════════════════
// PRESETS — Pre-built scenarios for quick simulation testing
// ════════════════════════════════════════════════════════════════

let presetCounter = 0;
function uid() { return `unit_preset_${++presetCounter}`; }

// ── Preset Registry ──────────────────────────────────────────────
// Each entry maps a preset to the map it requires.
// requiredMap: substring match against loaded map filename, or "test-fixture" for the built-in grid.

const PRESET_REGISTRY = [
  {
    id: "river_crossing",
    name: "Contested River Crossing",
    description: "Blue Force attacks to secure the Stonebrook bridge. Red Force defends the crossing.",
    era: "modern",
    requiredMap: "test-fixture",
    getPreset: () => getQuickstartPreset(),
  },
  {
    id: "bastogne_1944",
    name: "Battle of Bastogne (Dec 21–26, 1944)",
    description: "101st Airborne + CCB/10th AD defend the Bastogne perimeter against 26th VGD and elements of Panzer Lehr.",
    era: "ww2",
    requiredMap: "Bastogne",
    getPreset: () => getBastognePreset(),
  },
  {
    id: "escarpment_assault",
    name: "Escarpment Assault (Wales, 1944)",
    description: "Blue Force must cross open moorland and assault a defended escarpment. Red Force holds the high ground with fewer units but devastating terrain advantage.",
    era: "ww2",
    requiredMap: "Llanddeusant",
    getPreset: () => getEscarpmentPreset(),
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
  return PRESET_REGISTRY.map(({ id, name, description, era, requiredMap }) => (
    { id, name, description, era, requiredMap }
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
      },
      {
        id: "actor_2",
        name: "Red Force",
        controller: "player",
        objectives: ["Deny Blue Force access to the western bank", "Hold defensive line along the Stonebrook", "Preserve combat strength for counterattack"],
        constraints: ["Bridge destruction is a last resort only", "Do not withdraw past column B"],
      },
    ],

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
    return {
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
    };
  }

  // Red defender: fewer units, prepared positions, higher morale on home ground
  function red(name, type, echelon, pos, overrides = {}) {
    return {
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
    };
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
