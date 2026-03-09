// ════════════════════════════════════════════════════════════════
// AIR TEST SCENARIOS — Comprehensive air system stress tests.
// Each scenario returns { preset, orders, meta } where:
//   preset: full scenario object (same format as presets.js)
//   orders: { actorId: { unitId: { movementOrder, actionOrder, intent } } }
//   meta: { id, name, testing, expectedOutcome }
//
// Designed to be loaded into SimGame and adjudicated automatically.
// ════════════════════════════════════════════════════════════════

let counter = 0;
function uid() { return `airtest_${++counter}`; }

// Shared environment presets
const CLEAR_MORNING = {
  weather: "clear", visibility: "unlimited", groundCondition: "dry",
  timeOfDay: "morning", climate: "temperate", stability: "high", severity: "mild",
};
const NIGHT_CLEAR = {
  weather: "clear", visibility: "good", groundCondition: "dry",
  timeOfDay: "night", climate: "temperate", stability: "medium", severity: "mild",
};

// Helper: standard actor pair
function actors(blueObj, redObj) {
  return [
    { id: "actor_1", name: "Blue Force", controller: "player",
      objectives: blueObj, constraints: [] },
    { id: "actor_2", name: "Red Force", controller: "player",
      objectives: redObj, constraints: [] },
  ];
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 1: Hidden AD in Dense Forest
// AD units are undetected (detected: false) and under dense canopy.
// Planes should fly in blind and get ambushed.
// ════════════════════════════════════════════════════════════════
function scenario_hiddenAD() {
  counter = 0;
  const f1 = uid(), f2 = uid(), bravo = uid(), redInf = uid();
  const ad1 = uid(), ad2 = uid(), ad3 = uid();

  return {
    meta: {
      id: "hidden_ad",
      name: "Hidden AD Ambush in Dense Forest",
      testing: "Do planes fly into undetected AD? Does the adjudicator resolve the ambush correctly? Blue cannot see the AD units (detected:false + dense_forest canopy).",
      expectedOutcome: "Blue CAS flights enter the corridor unaware of AD. Adjudicator should have them take fire and sustain significant damage or be shot down. Key question: does the LLM know about the AD (from full game state) even though Blue doesn't?",
    },
    preset: {
      scale: "grand_tactical",
      title: "Hidden AD Ambush",
      description: "Blue CAS flies toward Red infantry. Unknown to Blue, 3 AD systems are hidden under dense forest canopy along the route.",
      initialConditions: "Clear morning. Blue believes the corridor is clear of AD. Intelligence has not detected any air defense assets along the approach route.",
      specialRules: "AD units are concealed under dense forest canopy. Blue Force has no prior intelligence on Red AD positions.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Provide CAS to ground forces at C4"],
        ["Defend positions", "Shoot down Blue aircraft"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        // Blue — 2 CAS flights
        { id: f1, actor: "actor_1", name: "Hawk 1 (F-16C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        { id: f2, actor: "actor_1", name: "Hawk 2 (F-16C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        // Blue ground
        { id: bravo, actor: "actor_1", name: "Bravo Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "3,3", strength: 80, supply: 80, status: "ready", morale: 85, ammo: 80, entrenchment: 0, detected: true, movementType: "foot", specialCapabilities: [] },
        // Red ground target
        { id: redInf, actor: "actor_2", name: "Red Guard Platoon", type: "infantry", echelon: "battalion", posture: "dug_in", position: "2,4", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, entrenchment: 50, detected: true, movementType: "foot", specialCapabilities: [] },
        // Red AD — UNDETECTED, in dense forest hexes (rows 6-8 are forest in test fixture)
        { id: ad1, actor: "actor_2", name: "SA-11 Battery (Hidden)", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "6,7", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: false, movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"] },
        { id: ad2, actor: "actor_2", name: "Tunguska (Hidden)", type: "air_defense", echelon: "company", posture: "defending", position: "7,6", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: false, movementType: "tracked",
          specialCapabilities: ["gun_ad", "ir_missile_ad"] },
        { id: ad3, actor: "actor_2", name: "Strela-10 (Hidden)", type: "air_defense", echelon: "company", posture: "defending", position: "8,7", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: false, movementType: "tracked",
          specialCapabilities: ["ir_missile_ad"] },
      ],
    },
    orders: {
      actor_1: {
        [f1]: { actionOrder: { id: "CAS", target: "2,4", altitude: "LOW" }, intent: "Strike Red Guard position at B5" },
        [f2]: { actionOrder: { id: "CAS", target: "2,4", altitude: "LOW" }, intent: "Follow-up CAS strike on B5" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 2: WW2 Supply Trucks vs Modern CAS
// Defenseless WW2 logistics convoy hit by precision-guided CAS.
// Should be total destruction.
// ════════════════════════════════════════════════════════════════
function scenario_trucksVsCAS() {
  counter = 0;
  const cas1 = uid(), convoy1 = uid(), convoy2 = uid();

  return {
    meta: {
      id: "trucks_vs_cas",
      name: "WW2 Supply Trucks vs Modern CAS",
      testing: "Does modern CAS utterly destroy defenseless WW2 logistics? No AD, no fighters, open terrain. Sanity check for proportional damage.",
      expectedOutcome: "Total destruction or near-total. The convoy has no AA capability, no air cover, is on an open road. A single precision CAS flight should obliterate both supply columns.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Turkey Shoot",
      description: "A modern F-16 flight with precision munitions catches a WW2-era supply column on an open highway with zero air defense.",
      initialConditions: "Clear morning. Two supply convoys are moving along the main highway through open farmland. No air cover, no AA guns, no fighter escort.",
      specialRules: "WW2 logistics units have no air defense capability. Open terrain with no concealment.",
      turnDuration: "2 hours", startDate: "1944-06-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Destroy the supply convoy"],
        ["Deliver supplies to the front"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "ww2" },
      units: [
        // Modern CAS
        { id: cas1, actor: "actor_1", name: "Viper Flight (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 95, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: true, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike", "all_weather"] },
        // WW2 supply convoys — open terrain, on road, zero defense
        { id: convoy1, actor: "actor_2", name: "1st Supply Column", type: "logistics", echelon: "battalion", posture: "moving", position: "5,4", strength: 100, supply: 100, status: "ready", morale: 60, ammo: 0, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
        { id: convoy2, actor: "actor_2", name: "2nd Supply Column", type: "logistics", echelon: "battalion", posture: "moving", position: "5,5", strength: 100, supply: 100, status: "ready", morale: 60, ammo: 0, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [cas1]: { actionOrder: { id: "CAS", target: "5,4", altitude: "LOW" }, intent: "Destroy the supply convoy on the highway" },
      },
      actor_2: {
        [convoy1]: { movementOrder: { id: "MOVE", target: "4,4" }, intent: "Continue moving west along the highway" },
        [convoy2]: { movementOrder: { id: "MOVE", target: "4,5" }, intent: "Continue moving west" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 3: Contested Airspace — Full Air War
// Both sides have fighters, CAS, AD. Complex multi-layer test.
// ════════════════════════════════════════════════════════════════
function scenario_contestedAirspace() {
  counter = 0;
  const bCas = uid(), bCap = uid(), bSead = uid();
  const bInf = uid();
  const rFighter = uid(), rAd1 = uid(), rAd2 = uid();
  const rInf = uid();

  return {
    meta: {
      id: "contested_airspace",
      name: "Contested Airspace — Full Air War",
      testing: "Can the system model a complex air battle with CAS, CAP, SEAD, enemy fighters, and layered AD all interacting simultaneously?",
      expectedOutcome: "Blue SEAD should suppress AD, Blue CAP should engage Red fighters, Blue CAS should attempt to strike through contested airspace. Expect losses on both sides. The adjudicator should model air-to-air engagements, SEAD effects, and CAS delivery as interconnected events.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Contested Skies",
      description: "Full air battle: Blue launches a coordinated strike package (CAS + SEAD + CAP) into Red airspace defended by fighters and layered AD.",
      initialConditions: "Blue has committed a 3-ship strike package: SEAD lead, CAS wingman, CAP escort. Red has a fighter pair on alert and two AD systems covering the sector.",
      specialRules: "SEAD mission should suppress AD to enable CAS. CAP should engage enemy fighters. This is a coordinated strike package.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Suppress Red AD", "Destroy Red infantry at C4", "Achieve air superiority"],
        ["Shoot down Blue aircraft", "Maintain AD umbrella", "Defend positions"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        // Blue strike package
        { id: bSead, actor: "actor_1", name: "Weasel Flight (F-16CJ)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: true, radarEquipped: true },
          specialCapabilities: ["sead", "precision_strike", "ecm_suite"] },
        { id: bCas, actor: "actor_1", name: "Hammer Flight (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        { id: bCap, actor: "actor_1", name: "Eagle CAP (F-15C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 95, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 8, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
        // Blue ground
        { id: bInf, actor: "actor_1", name: "Alpha Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "3,3", strength: 85, supply: 80, status: "ready", morale: 85, ammo: 80, entrenchment: 0, detected: true, movementType: "foot", specialCapabilities: [] },
        // Red fighters
        { id: rFighter, actor: "actor_2", name: "Flanker Pair (Su-27)", type: "air", echelon: "company", posture: "ready", position: "0,3", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 80, munitions: 100, baseHex: "", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 9, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
        // Red AD
        { id: rAd1, actor: "actor_2", name: "SA-11 Buk Battery", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "4,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"] },
        { id: rAd2, actor: "actor_2", name: "Tunguska SHORAD", type: "air_defense", echelon: "company", posture: "defending", position: "3,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 25, detected: true, movementType: "tracked",
          specialCapabilities: ["gun_ad", "ir_missile_ad"] },
        // Red ground
        { id: rInf, actor: "actor_2", name: "Red Guard Battalion", type: "infantry", echelon: "battalion", posture: "dug_in", position: "2,4", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, entrenchment: 50, detected: true, movementType: "foot", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [bSead]: { actionOrder: { id: "SEAD", target: "4,5", altitude: "MEDIUM" }, intent: "Suppress the SA-11 to open a corridor for CAS" },
        [bCas]: { actionOrder: { id: "CAS", target: "2,4", altitude: "LOW" }, intent: "Strike Red Guard positions once SEAD clears the way" },
        [bCap]: { actionOrder: { id: "AIR_SUPERIORITY", target: "3,3", altitude: "HIGH" }, intent: "Provide air cover for the strike package" },
      },
      actor_2: {
        [rFighter]: { actionOrder: { id: "AIR_SUPERIORITY", target: "5,4", altitude: "HIGH" }, intent: "Intercept Blue strike package" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 4: WW2 Furball — Prop Fighters Dogfighting
// ════════════════════════════════════════════════════════════════
function scenario_ww2Furball() {
  counter = 0;
  const bFight1 = uid(), bFight2 = uid();
  const rFight1 = uid(), rFight2 = uid();

  return {
    meta: {
      id: "ww2_furball",
      name: "WW2 Furball — Prop Dogfight",
      testing: "Can the system model a WW2 turning fight without anachronistic modern concepts (BVR, radar missiles)? Should use period-appropriate tactics: altitude advantage, deflection shooting, energy fighting.",
      expectedOutcome: "Close-range dogfight with guns. Expect narrative about turning fights, altitude trades, deflection shooting. No radar missiles, no BVR. Casualties should be attritional (some damage both sides) rather than decisive.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Channel Dogfight 1940",
      description: "Two flights of Spitfires bounce two flights of Bf-109s over the English Channel. Classic WW2 prop dogfight.",
      initialConditions: "Summer 1940. Blue flight of Spitfires spots Red 109s at similar altitude over the Channel. Both sides commit to the engagement.",
      specialRules: "WW2 era — guns only, no missiles. Visual identification required. Altitude advantage matters. Aircraft limited by fuel for return to base.",
      turnDuration: "30 minutes", startDate: "1940-08-15",
      environment: { ...CLEAR_MORNING, stability: "medium" },
      actors: actors(
        ["Shoot down the enemy fighters"],
        ["Shoot down the enemy fighters"]
      ),
      eraSelections: { actor_1: "ww2", actor_2: "ww2" },
      units: [
        // Blue — Spitfires
        { id: bFight1, actor: "actor_1", name: "Red Section (Spitfire Mk.I)", type: "air", echelon: "company", posture: "ready", position: "8,4", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 100, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "medium", maneuverability: 8, weaponsPackage: "guns_only", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: [] },
        { id: bFight2, actor: "actor_1", name: "Blue Section (Spitfire Mk.I)", type: "air", echelon: "company", posture: "ready", position: "8,5", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, readiness: 100, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "medium", maneuverability: 8, weaponsPackage: "guns_only", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: [] },
        // Red — Bf-109s
        { id: rFight1, actor: "actor_2", name: "Schwarm 1 (Bf-109E)", type: "air", echelon: "company", posture: "ready", position: "4,4", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 100, munitions: 100, baseHex: "0,4", detected: true, movementType: "air",
          airProfile: { speed: "medium", maneuverability: 7, weaponsPackage: "guns_only", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: [] },
        { id: rFight2, actor: "actor_2", name: "Schwarm 2 (Bf-109E)", type: "air", echelon: "company", posture: "ready", position: "4,5", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, readiness: 100, munitions: 100, baseHex: "0,4", detected: true, movementType: "air",
          airProfile: { speed: "medium", maneuverability: 7, weaponsPackage: "guns_only", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [bFight1]: { actionOrder: { id: "AIR_SUPERIORITY", target: "4,4", altitude: "MEDIUM" }, intent: "Engage the 109s, use altitude advantage" },
        [bFight2]: { actionOrder: { id: "AIR_SUPERIORITY", target: "4,5", altitude: "MEDIUM" }, intent: "Support Red Section, engage second Schwarm" },
      },
      actor_2: {
        [rFight1]: { actionOrder: { id: "AIR_SUPERIORITY", target: "8,4", altitude: "MEDIUM" }, intent: "Engage the Spitfires head-on" },
        [rFight2]: { actionOrder: { id: "AIR_SUPERIORITY", target: "8,5", altitude: "MEDIUM" }, intent: "Support Schwarm 1, engage second Spitfire section" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 5: Dug-in Urban Defenders vs CAS
// Heavily fortified infantry in a city. CAS should do minimal damage.
// ════════════════════════════════════════════════════════════════
function scenario_urbanDugIn() {
  counter = 0;
  const cas1 = uid(), cas2 = uid();
  const rInf1 = uid(), rInf2 = uid();

  return {
    meta: {
      id: "urban_dug_in",
      name: "Dug-in Urban Defenders vs CAS",
      testing: "Does CAS against heavily entrenched infantry in urban terrain correctly produce minimal damage? Buildings provide overhead cover; troops are dispersed in basements and reinforced positions.",
      expectedOutcome: "CAS causes some disruption (suppression, morale damage) but minimal actual casualties. The bombs hit buildings, not the troops inside. Strength should drop only slightly (5-15%) at most.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Bombing the Bunkers",
      description: "Two CAS flights attempt to dislodge a dug-in infantry battalion from a dense urban area. The defenders have 60% entrenchment and are dispersed through reinforced buildings.",
      initialConditions: "Red infantry has been dug into the urban core for 48 hours. Basements reinforced, overhead cover improvised from rubble. No AD coverage but excellent concealment.",
      specialRules: "Urban terrain provides overhead cover against air-delivered munitions. Dug-in posture with high entrenchment means troops are in hardened positions. CAS should struggle to cause meaningful casualties.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Destroy or dislodge Red infantry from the urban area"],
        ["Hold urban positions against air attack"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        // Blue CAS
        { id: cas1, actor: "actor_1", name: "Hammer 1 (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        { id: cas2, actor: "actor_1", name: "Hammer 2 (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        // Red dug-in urban infantry (test fixture row 6-8 has urban/forest)
        // Use position 5,15 or 6,15 which are in the fine-grained urban zone (rows 15-17)
        { id: rInf1, actor: "actor_2", name: "Red 1st Battalion", type: "infantry", echelon: "battalion", posture: "dug_in", position: "5,16", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, entrenchment: 60, detected: true, movementType: "foot", specialCapabilities: [] },
        { id: rInf2, actor: "actor_2", name: "Red 2nd Battalion", type: "infantry", echelon: "battalion", posture: "dug_in", position: "6,16", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, entrenchment: 55, detected: true, movementType: "foot", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [cas1]: { actionOrder: { id: "CAS", target: "5,16", altitude: "MEDIUM" }, intent: "Strike Red 1st Battalion in the urban area" },
        [cas2]: { actionOrder: { id: "CAS", target: "6,16", altitude: "MEDIUM" }, intent: "Strike Red 2nd Battalion" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 6: HIGH Altitude vs SHORAD Only
// Planes at HIGH should be untouchable by gun_ad and ir_missile_ad.
// ════════════════════════════════════════════════════════════════
function scenario_highVsShorad() {
  counter = 0;
  const cas1 = uid();
  const rInf = uid(), rAd1 = uid(), rAd2 = uid(), rAd3 = uid();

  return {
    meta: {
      id: "high_vs_shorad",
      name: "HIGH Altitude vs SHORAD Only",
      testing: "Do planes at HIGH altitude correctly avoid gun_ad and ir_missile_ad? The AD effectiveness matrix shows 0 effectiveness for both types at HIGH altitude. Planes should be completely safe.",
      expectedOutcome: "CAS at HIGH altitude should be immune to SHORAD. No aircraft damage. However, CAS effectiveness at HIGH should be degraded (harder to acquire targets, less precise).",
    },
    preset: {
      scale: "grand_tactical",
      title: "Above the Ceiling",
      description: "CAS flight operates at HIGH altitude above SHORAD engagement envelopes. Three SHORAD systems below cannot reach.",
      initialConditions: "Blue CAS operating at high altitude. Red has SHORAD coverage only — no radar SAMs that can reach HIGH altitude.",
      specialRules: "Gun AD and IR missile AD cannot engage targets at HIGH altitude. CAS effectiveness is reduced at HIGH altitude (less precise targeting).",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Strike Red infantry from safe altitude"],
        ["Defend against air attack"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: cas1, actor: "actor_1", name: "Raptor Flight (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        { id: rInf, actor: "actor_2", name: "Red Infantry", type: "infantry", echelon: "battalion", posture: "defending", position: "4,4", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, entrenchment: 30, detected: true, movementType: "foot", specialCapabilities: [] },
        { id: rAd1, actor: "actor_2", name: "ZSU-23 Shilka", type: "air_defense", echelon: "company", posture: "defending", position: "4,3", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: true, movementType: "tracked", specialCapabilities: ["gun_ad"] },
        { id: rAd2, actor: "actor_2", name: "Strela-10", type: "air_defense", echelon: "company", posture: "defending", position: "5,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: true, movementType: "tracked", specialCapabilities: ["ir_missile_ad"] },
        { id: rAd3, actor: "actor_2", name: "Igla Team", type: "air_defense", echelon: "company", posture: "defending", position: "3,5", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 20, detected: true, movementType: "foot", specialCapabilities: ["ir_missile_ad"] },
      ],
    },
    orders: {
      actor_1: {
        [cas1]: { actionOrder: { id: "CAS", target: "4,4", altitude: "HIGH" }, intent: "Strike from high altitude — stay above SHORAD ceiling" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 7: Retreating Column on Highway — Interdiction
// Moving units in the open on a road. Perfect interdiction target.
// ════════════════════════════════════════════════════════════════
function scenario_retreatingColumn() {
  counter = 0;
  const strike1 = uid();
  const rMech = uid(), rInf = uid(), rArt = uid();

  return {
    meta: {
      id: "retreating_column",
      name: "Retreating Column — Highway Interdiction",
      testing: "Does interdiction against a moving column on an open road cause devastating damage? Moving posture + road + no cover = ideal target. Tests INTERDICTION order type.",
      expectedOutcome: "Heavy casualties. Column stretched on highway with no overhead cover. Vehicles can't disperse off-road quickly. Should see 30-50% strength loss at minimum, with disrupted/broken status.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Highway of Death",
      description: "Red Force retreating along the main highway. Blue interdiction flight catches them in the open.",
      initialConditions: "Red mechanized column withdrawing along highway through open farmland. No air cover. Column stretched over several kilometers.",
      specialRules: "Moving units on roads are especially vulnerable to air interdiction. Vehicles cannot quickly disperse into cover.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Destroy the retreating column"],
        ["Withdraw to safety"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: strike1, actor: "actor_1", name: "Strike Flight (F-15E)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 95, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 6, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: true, radarEquipped: true },
          specialCapabilities: ["precision_strike", "all_weather"] },
        { id: rMech, actor: "actor_2", name: "Red Mech Battalion", type: "mechanized", echelon: "battalion", posture: "retreating", position: "5,4", strength: 85, supply: 70, status: "ready", morale: 55, ammo: 60, entrenchment: 0, detected: true, movementType: "tracked", specialCapabilities: [] },
        { id: rInf, actor: "actor_2", name: "Red Infantry", type: "infantry", echelon: "battalion", posture: "retreating", position: "6,4", strength: 80, supply: 65, status: "ready", morale: 50, ammo: 50, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
        { id: rArt, actor: "actor_2", name: "Red Artillery", type: "artillery", echelon: "artillery_battery", posture: "retreating", position: "7,4", strength: 90, supply: 60, status: "ready", morale: 55, ammo: 40, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [strike1]: { actionOrder: { id: "INTERDICTION", target: "5,4", altitude: "LOW" }, intent: "Interdict the retreating column on the highway" },
      },
      actor_2: {
        [rMech]: { movementOrder: { id: "WITHDRAW", target: "3,4" }, intent: "Withdraw west" },
        [rInf]: { movementOrder: { id: "WITHDRAW", target: "4,4" }, intent: "Withdraw west" },
        [rArt]: { movementOrder: { id: "WITHDRAW", target: "5,4" }, intent: "Withdraw west" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 8: BVR Engagement — Off-Map Approach
// Two fighter groups approach from opposite map edges.
// Tests the gap: no off-map engagement mechanism exists.
// ════════════════════════════════════════════════════════════════
function scenario_bvrApproach() {
  counter = 0;
  const bF15 = uid(), bF15b = uid();
  const rSu27 = uid(), rSu27b = uid();

  return {
    meta: {
      id: "bvr_approach",
      name: "BVR Engagement — Head-On Approach",
      testing: "How does the system handle two modern fighter groups approaching head-on? They would detect each other at 100+ km and fire BVR missiles before reaching visual range. There is no off-map engagement mechanism — does the adjudicator handle this narratively?",
      expectedOutcome: "The adjudicator should recognize that BVR engagement would occur before the aircraft close to visual range. It should model missile exchanges and potentially resolve losses before the merge. This tests a known system gap.",
    },
    preset: {
      scale: "grand_tactical",
      title: "BVR Intercept",
      description: "Two F-15C flights and two Su-27 flights approach head-on. Both sides have BVR capability and radar. At grand tactical scale (~3km/hex), they start 30km apart.",
      initialConditions: "Blue and Red fighter pairs are approaching each other head-on. Both detected. Both radar-equipped with BVR-capable missiles. Range is closing fast.",
      specialRules: "Modern BVR-capable fighters should engage with missiles before reaching gun range. Radar provides detection at 100+ km. AIM-120 and R-27 class weapons have 50-80km range.",
      turnDuration: "30 minutes", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Destroy Red fighters", "Achieve air superiority"],
        ["Destroy Blue fighters", "Achieve air superiority"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: bF15, actor: "actor_1", name: "Eagle 1 (F-15C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, readiness: 95, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 8, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
        { id: bF15b, actor: "actor_1", name: "Eagle 2 (F-15C)", type: "air", echelon: "company", posture: "ready", position: "10,5", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 8, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
        { id: rSu27, actor: "actor_2", name: "Flanker 1 (Su-27)", type: "air", echelon: "company", posture: "ready", position: "1,4", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 85, munitions: 100, baseHex: "", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 9, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
        { id: rSu27b, actor: "actor_2", name: "Flanker 2 (Su-27)", type: "air", echelon: "company", posture: "ready", position: "1,5", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, readiness: 80, munitions: 100, baseHex: "", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 9, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
      ],
    },
    orders: {
      actor_1: {
        [bF15]: { actionOrder: { id: "AIR_SUPERIORITY", target: "1,4", altitude: "HIGH" }, intent: "Engage and destroy Flanker pair" },
        [bF15b]: { actionOrder: { id: "AIR_SUPERIORITY", target: "1,5", altitude: "HIGH" }, intent: "Engage second Flanker pair" },
      },
      actor_2: {
        [rSu27]: { actionOrder: { id: "AIR_SUPERIORITY", target: "10,4", altitude: "HIGH" }, intent: "Intercept and destroy Eagle pair" },
        [rSu27b]: { actionOrder: { id: "AIR_SUPERIORITY", target: "10,5", altitude: "HIGH" }, intent: "Intercept second Eagle pair" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 9: Helicopter vs Radar SAM — Altitude Matters
// Slow helo at LOW should survive radar SAMs (low effectiveness).
// Same helo at MEDIUM should get killed.
// ════════════════════════════════════════════════════════════════
function scenario_heloVsSAM() {
  counter = 0;
  const helo1 = uid(), helo2 = uid();
  const rInf = uid(), rSam = uid();

  return {
    meta: {
      id: "helo_vs_sam",
      name: "Apache vs Radar SAM — Low vs Medium Altitude",
      testing: "Do slow helicopters at LOW altitude correctly avoid radar SAMs? Radar SAMs have low effectiveness at LOW (2/5) but very high at MEDIUM (5/5). One Apache at LOW, one at MEDIUM. The LOW one should survive; the MEDIUM one should be in serious trouble.",
      expectedOutcome: "Apache at LOW survives with minor or no damage (radar SAMs struggle at low altitude against slow targets using terrain masking). Apache at MEDIUM takes severe damage or is destroyed (sitting duck for radar-guided missiles).",
    },
    preset: {
      scale: "grand_tactical",
      title: "Terrain Masking Test",
      description: "Two Apache pairs run CAS missions against an SA-11 defended target. One flies LOW (terrain masking), one flies MEDIUM (exposed to radar).",
      initialConditions: "Two Apache helicopter pairs approach from the east. SA-11 battery covering the target area. One pair uses nap-of-the-earth flying (LOW), the other approaches at MEDIUM altitude.",
      specialRules: "Helicopters at LOW altitude can use terrain masking against radar-guided SAMs. At MEDIUM altitude they are fully exposed to radar engagement.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Provide CAS support"],
        ["Shoot down enemy helicopters"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        // LOW Apache
        { id: helo1, actor: "actor_1", name: "Apache LOW (Terrain Masking)", type: "attack_helicopter", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 85, munitions: 100, fuel: 80, baseHex: "10,4", detected: true, movementType: "helicopter",
          airProfile: { speed: "slow", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: ["close_air_support", "anti_armor"] },
        // MEDIUM Apache
        { id: helo2, actor: "actor_1", name: "Apache MED (Exposed)", type: "attack_helicopter", echelon: "company", posture: "ready", position: "10,5", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, readiness: 85, munitions: 100, fuel: 80, baseHex: "10,4", detected: true, movementType: "helicopter",
          airProfile: { speed: "slow", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: ["close_air_support", "anti_armor"] },
        // Target
        { id: rInf, actor: "actor_2", name: "Red Infantry", type: "infantry", echelon: "battalion", posture: "defending", position: "4,4", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, entrenchment: 30, detected: true, movementType: "foot", specialCapabilities: [] },
        // SA-11 — deadly at MEDIUM, weak at LOW
        { id: rSam, actor: "actor_2", name: "SA-11 Buk Battery", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "5,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 40, detected: true, movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"] },
      ],
    },
    orders: {
      actor_1: {
        [helo1]: { actionOrder: { id: "CAS", target: "4,4", altitude: "LOW" }, intent: "CAS at low altitude using terrain masking against radar SAM" },
        [helo2]: { actionOrder: { id: "CAS", target: "4,4", altitude: "MEDIUM" }, intent: "CAS at medium altitude — higher risk to radar SAM" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 10: Danger Close — CAS Near Friendlies
// ════════════════════════════════════════════════════════════════
function scenario_dangerClose() {
  counter = 0;
  const cas1 = uid();
  const bInf = uid(), rInf = uid();

  return {
    meta: {
      id: "danger_close",
      name: "Danger Close — CAS Near Friendly Troops",
      testing: "Does the adjudicator recognize and handle friendly fire risk when CAS is ordered on a hex adjacent to (or containing) friendly troops? Should either refuse, cause friendly casualties, or note extreme caution.",
      expectedOutcome: "Adjudicator should flag danger close situation. May reduce CAS effectiveness due to restricted weapons employment. Could cause friendly casualties. Should NOT casually bomb the hex without acknowledging the risk.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Danger Close CAS",
      description: "Blue CAS ordered to strike a hex immediately adjacent to friendly infantry in contact with the enemy.",
      initialConditions: "Blue infantry is in close contact with Red infantry. The two units are one hex apart. CAS is called on the enemy hex — danger close.",
      specialRules: "CAS within 1 hex of friendly troops is danger close. Risk of friendly casualties. Requires extreme precision and coordination.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Support friendly infantry with CAS"],
        ["Hold positions"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: cas1, actor: "actor_1", name: "Hawg Flight (A-10C)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "slow", maneuverability: 6, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: false },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        // Blue infantry — right next to the target
        { id: bInf, actor: "actor_1", name: "Charlie Company", type: "infantry", echelon: "battalion", posture: "attacking", position: "4,4", strength: 80, supply: 75, status: "ready", morale: 80, ammo: 70, entrenchment: 0, detected: true, movementType: "foot", specialCapabilities: [] },
        // Red infantry — the CAS target, 1 hex from friendlies
        { id: rInf, actor: "actor_2", name: "Red Platoon", type: "infantry", echelon: "battalion", posture: "defending", position: "3,4", strength: 100, supply: 100, status: "ready", morale: 85, ammo: 100, entrenchment: 30, detected: true, movementType: "foot", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [cas1]: { actionOrder: { id: "CAS", target: "3,4", altitude: "LOW" }, intent: "Danger close CAS — enemy is 1 hex from our infantry. Coordinate carefully." },
        [bInf]: { actionOrder: { id: "ATTACK", target: "3,4" }, intent: "Assault Red positions with CAS support" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 11: Airlift Through Fighter-Patrolled Airspace
// Unescorted transports vs enemy fighters. Turkey shoot.
// ════════════════════════════════════════════════════════════════
function scenario_airliftAmbush() {
  counter = 0;
  const transport = uid();
  const rFighter = uid();

  return {
    meta: {
      id: "airlift_ambush",
      name: "Unescorted Airlift vs Fighters",
      testing: "Are slow, defenseless transport aircraft properly destroyed by enemy fighters? Transports have no weapons, no ECM, slow speed. Should be a massacre.",
      expectedOutcome: "Transport destroyed or severely damaged. Fighters should intercept easily (speed advantage, weapons advantage, no defensive capability on transport). A turkey shoot.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Unescorted Airlift",
      description: "A transport flight attempts to deliver supplies through airspace patrolled by enemy fighters. No escort.",
      initialConditions: "C-130 transport flight heading west to deliver supplies. Su-27 fighter pair on patrol directly in the flight path. No escort fighters available.",
      specialRules: "Transport aircraft are slow, unarmed, and have no countermeasures. They are extremely vulnerable to fighter interception.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Deliver supplies via airlift"],
        ["Control the airspace", "Shoot down enemy aircraft"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: transport, actor: "actor_1", name: "Hercules (C-130J)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 70, ammo: 0, readiness: 90, munitions: 0, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "slow", maneuverability: 2, weaponsPackage: "none", defensiveArmament: false, ecm: false, radarEquipped: false },
          specialCapabilities: ["airlift"] },
        { id: rFighter, actor: "actor_2", name: "Flanker Pair (Su-27)", type: "air", echelon: "company", posture: "ready", position: "5,4", strength: 100, supply: 100, status: "ready", morale: 95, ammo: 100, readiness: 90, munitions: 100, baseHex: "", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 9, weaponsPackage: "air_to_air", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["air_superiority", "bvr_capable"] },
      ],
    },
    orders: {
      actor_1: {
        [transport]: { actionOrder: { id: "AIRLIFT", target: "2,4", altitude: "MEDIUM" }, intent: "Deliver supplies to forward base" },
      },
      actor_2: {
        [rFighter]: { actionOrder: { id: "AIR_SUPERIORITY", target: "7,4", altitude: "HIGH" }, intent: "Intercept any Blue aircraft entering the sector" },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 12: SEAD Then CAS — Sequential Suppression
// Does artillery + SEAD suppress AD for a follow-up CAS?
// ════════════════════════════════════════════════════════════════
function scenario_seadThenCAS() {
  counter = 0;
  const sead = uid(), cas = uid(), arty = uid();
  const rInf = uid(), rAd = uid();

  return {
    meta: {
      id: "sead_then_cas",
      name: "SEAD + Artillery Suppress AD for CAS",
      testing: "Does the adjudicator model SEAD suppressing AD to enable a follow-up CAS mission? Tests cross-domain synergy: artillery fires on AD position while SEAD targets it, then CAS flies through the suppressed corridor.",
      expectedOutcome: "SEAD and artillery should degrade the AD system (damage, disruption, or suppression). CAS should have an easier time getting through. The adjudicator should model these as connected events.",
    },
    preset: {
      scale: "grand_tactical",
      title: "Coordinated SEAD/CAS Package",
      description: "Blue launches a coordinated strike: artillery suppresses AD position while SEAD targets the radar, then CAS flies through the gap.",
      initialConditions: "Blue has identified a single SA-11 covering the approach to Red infantry. Plan: suppress with artillery, SEAD the radar, then CAS the infantry.",
      specialRules: "SEAD and artillery fire should suppress or degrade AD effectiveness. CAS follows through the suppressed corridor.",
      turnDuration: "2 hours", startDate: "2024-09-15",
      environment: CLEAR_MORNING,
      actors: actors(
        ["Suppress Red AD then deliver CAS"],
        ["Maintain AD coverage", "Defend infantry positions"]
      ),
      eraSelections: { actor_1: "modern", actor_2: "modern" },
      units: [
        { id: sead, actor: "actor_1", name: "Weasel (F-16CJ)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 90, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: true, radarEquipped: true },
          specialCapabilities: ["sead", "ecm_suite", "precision_strike"] },
        { id: cas, actor: "actor_1", name: "Hammer (F-16CG)", type: "air", echelon: "company", posture: "ready", position: "10,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, readiness: 85, munitions: 100, baseHex: "10,4", detected: true, movementType: "air",
          airProfile: { speed: "fast", maneuverability: 7, weaponsPackage: "precision_guided", defensiveArmament: true, ecm: false, radarEquipped: true },
          specialCapabilities: ["close_air_support", "precision_strike"] },
        { id: arty, actor: "actor_1", name: "King Battery (155mm)", type: "artillery", echelon: "artillery_battery", posture: "ready", position: "8,6", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 0, detected: true, movementType: "wheeled", specialCapabilities: [] },
        { id: rAd, actor: "actor_2", name: "SA-11 Buk Battery", type: "air_defense", echelon: "artillery_battery", posture: "defending", position: "5,4", strength: 100, supply: 100, status: "ready", morale: 100, ammo: 100, entrenchment: 30, detected: true, movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"] },
        { id: rInf, actor: "actor_2", name: "Red Infantry", type: "infantry", echelon: "battalion", posture: "dug_in", position: "3,4", strength: 100, supply: 100, status: "ready", morale: 90, ammo: 100, entrenchment: 40, detected: true, movementType: "foot", specialCapabilities: [] },
      ],
    },
    orders: {
      actor_1: {
        [sead]: { actionOrder: { id: "SEAD", target: "5,4", altitude: "MEDIUM" }, intent: "Suppress the SA-11 radar to open a corridor" },
        [cas]: { actionOrder: { id: "CAS", target: "3,4", altitude: "LOW" }, intent: "Strike Red infantry once SEAD clears the AD" },
        [arty]: { actionOrder: { id: "FIRE_MISSION", target: "5,4" }, intent: "Suppressive fire on SA-11 position to support SEAD" },
      },
      actor_2: {},
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 13: Soviet Anti-Carrier Saturation Attack
// Full-scale 1985 Reconnaissance-Strike Complex:
// 24 Tu-22M3 Backfires (3 squadrons, 3 axes), Oscar SSGN (24 P-700),
// Slava cruiser (16 P-500), MiG-31 escort, Bear-D recon
// vs. US CVBG with Aegis, F-14 CAP, E-2C, EA-6B
// ════════════════════════════════════════════════════════════════
function scenario_carrierStrike() {
  counter = 0;

  // US Forces (actor_1) — Carrier Battle Group "Bravo"
  const cvn        = uid(); // 1: CVN-69 Eisenhower
  const aegis      = uid(); // 2: Aegis cruiser group (2x Ticonderoga)
  const ddScreen   = uid(); // 3: Destroyer screen north (DD-963 + DDG-993)
  const ffgScreen  = uid(); // 4: Frigate screen south (FFG-36 + FFG-40)
  const capAlpha   = uid(); // 5: Tomcat CAP Alpha (4x F-14A) — north station
  const capBravo   = uid(); // 6: Tomcat CAP Bravo (4x F-14A) — south station
  const hawkeye    = uid(); // 7: E-2C Hawkeye AEW
  const alertCats  = uid(); // 8: Alert Tomcats (8x F-14A) — on deck
  const prowler    = uid(); // 9: EA-6B Prowler ECM

  // Soviet Forces (actor_2) — 5th Naval Missile Aviation Division
  const bearD      = uid(); // 10: Tu-95RT Bear-D recon
  const bf1        = uid(); // 11: 1st Backfire Sqn (8x Tu-22M3) — north axis
  const bf2        = uid(); // 12: 2nd Backfire Sqn (8x Tu-22M3) — center axis
  const bf3        = uid(); // 13: 3rd Backfire Sqn (8x Tu-22M3) — south axis
  const mig31      = uid(); // 14: MiG-31 Escort Flight (4x MiG-31BM)
  const oscar      = uid(); // 15: Oscar-II SSGN K-148 Krasnodar
  const slava      = uid(); // 16: Slava-class CG Marshal Ustinov

  const OCEAN_ENVIRONMENT = {
    weather: "clear", visibility: "unlimited", groundCondition: "dry",
    timeOfDay: "morning", climate: "temperate", stability: "medium", severity: "mild",
  };

  return {
    meta: {
      id: "carrier_strike",
      name: "Soviet Anti-Carrier Saturation Attack (1985)",
      testing: "Can the system model a full-scale Cold War carrier battle? "
        + "24 Backfires + Oscar SSGN + Slava cruiser launch 60-80 anti-ship missiles from 3 axes "
        + "against a US CVBG with F-14 outer air battle, Aegis area defense, and point defense layers. "
        + "Tests: multi-axis coordination, BVR intercept of bombers, missile saturation vs layered defense, "
        + "ECM effects, submarine surprise, and whether the carrier survives.",
      expectedOutcome: "F-14 CAP should intercept some Backfires in outer air battle (AIM-54 Phoenix at 100nm). "
        + "Surviving Backfires launch Kh-22 missiles. Oscar fires 24 P-700 Granit from submerged (undetected). "
        + "Aegis engages with SM-2 (shoot-shoot-look-shoot). Some missiles leak through to inner defenses. "
        + "Escorts may take hits screening the carrier. The carrier may or may not survive — "
        + "this tests whether the system can model the saturation calculus honestly.",
    },

    preset: {
      scale: "operational",
      title: "Soviet Anti-Carrier Saturation Attack",
      description: "Norwegian Sea, 1985. A full Soviet Naval Missile Aviation division "
        + "(24 Tu-22M3 Backfire bombers in three squadrons) supported by an Oscar-II SSGN "
        + "and a Slava-class cruiser executes a coordinated saturation attack on US Carrier "
        + "Battle Group Bravo (CVN-69 Eisenhower). The carrier group deploys layered defenses: "
        + "F-14 Tomcat CAP with AIM-54 Phoenix for the outer air battle, two Aegis cruisers "
        + "with SM-2 for area defense, and Sea Sparrow/Phalanx for point defense.",
      initialConditions: "0615 local, Norwegian Sea, 300nm southwest of Bear Island. "
        + "CVBG Bravo has been operating under EMCON conditions but the Bear-D detected the group "
        + "at 0540. Soviet strike package launched from Kola Peninsula airfields at 0530 and is "
        + "now approaching from the west on three axes. The E-2C Hawkeye detected the inbound raid "
        + "at 0600 — F-14 CAP has been vectored to intercept. Alert Tomcats are launching from the deck. "
        + "The Oscar SSGN has been trailing the battle group for 12 hours, undetected, and will "
        + "time its salvo to arrive simultaneously with the Backfire missiles.",

      specialRules: `NAVAL SCENARIO — ANTI-CARRIER SATURATION ATTACK (1985 Cold War)

SCALE: Each hex represents approximately 50 nautical miles (90 km). Ignore all terrain features on the hex grid — every hex is open ocean. The scenario covers approximately 1,000 km east-west.

SOVIET ATTACK DOCTRINE (Reconnaissance-Strike Complex):
Three Tu-22M3 Backfire squadrons (24 aircraft total, each carrying 1-2 Kh-22 Kitchen anti-ship missiles) approach from three bearings (north, center, south) to split defensive fire. The Oscar-II SSGN launches 24 P-700 Granit missiles from a submerged position closer to the battle group. The Slava-class cruiser fires 16 P-500 Bazalt missiles. Total potential inbound anti-ship missiles: 60-80.

WEAPON SPECIFICATIONS:
- Kh-22 (AS-4 Kitchen): Mach 4.6 terminal dive from 27km altitude, 960kg warhead, launched at ~300nm range from HIGH altitude. A single hit will mission-kill any surface combatant and severely damage or sink a carrier.
- P-700 Granit (SS-N-19 Shipwreck): Mach 2.5, 750kg warhead, 400-625km range. SWARM GUIDANCE — one missile flies HIGH as "leader" designating targets via datalink, others sea-skim at 20m altitude. If leader is shot down, next missile assumes the role. Missiles autonomously distribute themselves across different ships.
- P-500 Bazalt (SS-N-12 Sandbox): Mach 2.5, 1000kg warhead, 550km range. Similar sea-skimming profile.

US CARRIER BATTLE GROUP LAYERED DEFENSE:
Layer 1 — OUTER AIR BATTLE (200+ nm from carrier): F-14A Tomcats with AIM-54C Phoenix missiles. AWG-9 radar tracks 24 targets, guides 6 Phoenix simultaneously at 6 separate targets. Phoenix: 100nm range, Mach 5. Realistic Pk per Phoenix: 30-50% against bomber-sized targets at long range. Each F-14 carries 4 Phoenix + 2 Sparrow + 2 Sidewinder. Goal: kill Backfires BEFORE they reach Kh-22 launch range.

Layer 2 — AREA DEFENSE (10-90 nm): Two Aegis cruisers with AN/SPY-1B phased array radar tracking 100+ targets simultaneously. ~80 SM-2MR per cruiser (160 total). SM-2 range: 90nm. SHOOT-SHOOT-LOOK-SHOOT doctrine: fire 2 SM-2 at each target, assess, re-engage leakers. One cruiser can realistically engage ~15-20 targets in a compressed raid before becoming saturated. Two cruisers: ~30-40 targets maximum. Against 60+ inbound missiles from 3 axes simultaneously, this may not be enough.

Layer 3 — POINT DEFENSE (1-10 nm): RIM-7 Sea Sparrow, 10-16nm range, on carrier and escorts. Last engagement opportunity for missiles that penetrate the SM-2 zone.

Layer 4 — TERMINAL DEFENSE (0-1 nm): Mk 15 Phalanx CIWS 20mm gatling, ~2km effective range. 2-3 second engagement window against Mach 3+ missiles. One mount per escort, 3-4 on carrier.

ECM/CHAFF: SLQ-32 EW suite on all escorts. Mk 36 SRBOC chaff launchers create false targets. EA-6B Prowler jams Backfire targeting radars. ECM estimated to decoy 30-50% of missiles in the terminal phase. Chaff corridors may redirect sea-skimming missiles.

CRITICAL MODELING REQUIREMENTS:
- The Bear-D must survive to provide mid-course guidance updates to P-700 Granit missiles. If the Bear-D is shot down, P-700 missiles lose datalink updates and accuracy degrades by ~50%.
- The Oscar SSGN is SUBMERGED and UNDETECTED — its salvo arrives with no warning.
- Escorts will maneuver to screen the carrier — destroyers/frigates may deliberately position between incoming missiles and the CVN.
- Each missile that hits ANY ship is catastrophic (ship-killer warheads designed to sink cruisers with single hits). A carrier can absorb 1-2 hits and remain afloat but will be mission-killed.
- MiG-31 escort has R-33 missiles (100nm range, radar-guided) to protect Backfires from F-14 intercept.
- Soviet planners accepted 50% Backfire losses as the cost of sinking a carrier.
- Model the saturation calculus honestly: count how many missiles penetrate each defense layer, and whether total leakers exceed point defense capacity.`,

      turnDuration: "45 minutes",
      startDate: "1985-09-15",
      environment: OCEAN_ENVIRONMENT,

      actors: actors(
        [
          "Defend Carrier Battle Group Bravo (CVN-69 Eisenhower)",
          "Destroy or turn back the Soviet strike package before missile launch",
          "Protect the carrier at all costs — escorts are expendable",
        ],
        [
          "Sink or mission-kill the American aircraft carrier",
          "Achieve simultaneous time-on-target from all missile platforms",
          "Backfire losses of up to 50% are acceptable if the carrier is hit",
        ]
      ),

      eraSelections: { actor_1: "cold_war", actor_2: "cold_war" },

      units: [
        // ── US Carrier Battle Group ──
        {
          id: cvn, actor: "actor_1",
          name: "CVN-69 USS Eisenhower (Nimitz-class)",
          type: "naval", echelon: "brigade", posture: "defending",
          position: "9,9", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, entrenchment: 0, detected: true,
          movementType: "naval",
          specialCapabilities: ["ir_missile_ad", "gun_ad"],
          // Sea Sparrow (3 launchers, 24 missiles) + Phalanx CIWS (3-4 mounts)
        },
        {
          id: aegis, actor: "actor_1",
          name: "Aegis Group (CG-47 Ticonderoga + CG-48 Yorktown)",
          type: "air_defense", echelon: "company", posture: "defending",
          position: "8,8", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, entrenchment: 0, detected: true,
          movementType: "naval",
          specialCapabilities: ["long_range_ad", "radar_missile_ad"],
          // 2 Aegis cruisers: 160 SM-2 total, SPY-1 tracks 100+ targets
        },
        {
          id: ddScreen, actor: "actor_1",
          name: "Destroyer Screen (DD-963 Spruance + DDG-993 Kidd)",
          type: "naval", echelon: "company", posture: "defending",
          position: "7,7", strength: 100, supply: 100, status: "ready",
          morale: 90, ammo: 100, entrenchment: 0, detected: true,
          movementType: "naval",
          specialCapabilities: ["medium_range_ad", "radar_missile_ad", "ir_missile_ad"],
          // Sea Sparrow + Phalanx + Mk 26 launchers
        },
        {
          id: ffgScreen, actor: "actor_1",
          name: "Frigate Screen (FFG-36 Underwood + FFG-40 Halyburton)",
          type: "naval", echelon: "company", posture: "defending",
          position: "9,11", strength: 100, supply: 100, status: "ready",
          morale: 85, ammo: 100, entrenchment: 0, detected: true,
          movementType: "naval",
          specialCapabilities: ["ir_missile_ad", "gun_ad"],
          // SM-1MR (single-arm Mk 13) + Phalanx CIWS — weakest AD in the group
        },
        {
          id: capAlpha, actor: "actor_1",
          name: "Tomcat CAP Alpha (4× F-14A Tomcat)",
          type: "air", echelon: "company", posture: "ready",
          position: "5,6", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, detected: true,
          movementType: "air", readiness: 95, munitions: 100, fuel: 70,
          baseHex: "9,9",
          airProfile: {
            speed: "supersonic", maneuverability: 8,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles", "bvr_missiles"],
            defensiveArmament: false, ecm: false, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "bvr_capable"],
          // 4 AIM-54C Phoenix + 2 AIM-7 Sparrow + 2 AIM-9 Sidewinder per aircraft
        },
        {
          id: capBravo, actor: "actor_1",
          name: "Tomcat CAP Bravo (4× F-14A Tomcat)",
          type: "air", echelon: "company", posture: "ready",
          position: "5,12", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, detected: true,
          movementType: "air", readiness: 95, munitions: 100, fuel: 70,
          baseHex: "9,9",
          airProfile: {
            speed: "supersonic", maneuverability: 8,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles", "bvr_missiles"],
            defensiveArmament: false, ecm: false, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "bvr_capable"],
        },
        {
          id: hawkeye, actor: "actor_1",
          name: "E-2C Hawkeye (AEW)",
          type: "air", echelon: "platoon", posture: "ready",
          position: "7,9", strength: 100, supply: 100, status: "ready",
          morale: 90, ammo: 0, detected: true,
          movementType: "air", readiness: 90, munitions: 0, fuel: 65,
          baseHex: "9,9",
          airProfile: {
            speed: "medium", maneuverability: 3,
            weaponsPackage: "none",
            defensiveArmament: false, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["observation", "deep_reconnaissance"],
          // AN/APS-145 radar: 200+ nm detection range, tracks 2000 targets
        },
        {
          id: alertCats, actor: "actor_1",
          name: "Alert Tomcats (8× F-14A Tomcat)",
          type: "air", echelon: "battalion", posture: "ready",
          position: "9,9", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, detected: false,
          movementType: "air", readiness: 80, munitions: 100, fuel: 100,
          baseHex: "9,9",
          airProfile: {
            speed: "supersonic", maneuverability: 8,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles", "bvr_missiles"],
            defensiveArmament: false, ecm: false, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "bvr_capable"],
          // Launching from deck — will take time to reach CAP stations
        },
        {
          id: prowler, actor: "actor_1",
          name: "EA-6B Prowler (ECM)",
          type: "air", echelon: "platoon", posture: "ready",
          position: "7,9", strength: 100, supply: 100, status: "ready",
          morale: 90, ammo: 80, detected: true,
          movementType: "air", readiness: 90, munitions: 80, fuel: 65,
          baseHex: "9,9",
          airProfile: {
            speed: "fast", maneuverability: 4,
            weaponsPackage: "none",
            defensiveArmament: false, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["jamming", "ecm_suite", "sead_capable"],
          // ALQ-99 jamming pods — can jam Backfire targeting radars + missile seekers
        },

        // ── Soviet Naval Missile Strike ──
        {
          id: bearD, actor: "actor_2",
          name: "Tu-95RT Bear-D (Maritime Recon)",
          type: "air", echelon: "platoon", posture: "ready",
          position: "0,9", strength: 100, supply: 100, status: "ready",
          morale: 80, ammo: 0, detected: true,
          movementType: "air", readiness: 85, munitions: 0, fuel: 60,
          baseHex: "0,9",
          airProfile: {
            speed: "medium", maneuverability: 2,
            weaponsPackage: "none",
            defensiveArmament: true, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["observation", "deep_reconnaissance"],
          // Big Bulge surface search radar — provides targeting data + midcourse guidance for P-700
        },
        {
          id: bf1, actor: "actor_2",
          name: "1st Backfire Squadron (8× Tu-22M3)",
          type: "air", echelon: "battalion", posture: "attacking",
          position: "1,4", strength: 100, supply: 100, status: "ready",
          morale: 75, ammo: 100, detected: true,
          movementType: "air", readiness: 85, munitions: 100, fuel: 55,
          baseHex: "0,0",
          airProfile: {
            speed: "supersonic", maneuverability: 4,
            weaponsPackage: "precision_guided",
            defensiveArmament: true, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["standoff_strike", "strategic_bombing"],
          // 8-16 Kh-22 Kitchen missiles total (1-2 per aircraft)
        },
        {
          id: bf2, actor: "actor_2",
          name: "2nd Backfire Squadron (8× Tu-22M3)",
          type: "air", echelon: "battalion", posture: "attacking",
          position: "1,9", strength: 100, supply: 100, status: "ready",
          morale: 75, ammo: 100, detected: true,
          movementType: "air", readiness: 85, munitions: 100, fuel: 55,
          baseHex: "0,9",
          airProfile: {
            speed: "supersonic", maneuverability: 4,
            weaponsPackage: "precision_guided",
            defensiveArmament: true, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["standoff_strike", "strategic_bombing"],
        },
        {
          id: bf3, actor: "actor_2",
          name: "3rd Backfire Squadron (8× Tu-22M3)",
          type: "air", echelon: "battalion", posture: "attacking",
          position: "1,14", strength: 100, supply: 100, status: "ready",
          morale: 75, ammo: 100, detected: true,
          movementType: "air", readiness: 85, munitions: 100, fuel: 55,
          baseHex: "0,17",
          airProfile: {
            speed: "supersonic", maneuverability: 4,
            weaponsPackage: "precision_guided",
            defensiveArmament: true, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["standoff_strike", "strategic_bombing"],
        },
        {
          id: mig31, actor: "actor_2",
          name: "MiG-31BM Escort Flight (4× MiG-31)",
          type: "air", echelon: "company", posture: "attacking",
          position: "2,7", strength: 100, supply: 100, status: "ready",
          morale: 85, ammo: 100, detected: true,
          movementType: "air", readiness: 80, munitions: 100, fuel: 45,
          baseHex: "0,0",
          airProfile: {
            speed: "supersonic", maneuverability: 5,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles", "bvr_missiles"],
            defensiveArmament: false, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "bvr_capable"],
          // R-33 (AA-9 Amos): 100nm range, Mach 4.5, radar-guided. Zaslon phased array.
        },
        {
          id: oscar, actor: "actor_2",
          name: "Oscar-II SSGN K-148 Krasnodar (24× P-700 Granit)",
          type: "naval", echelon: "company", posture: "attacking",
          position: "5,10", strength: 100, supply: 100, status: "ready",
          morale: 90, ammo: 100, entrenchment: 0, detected: false,
          movementType: "naval",
          specialCapabilities: ["standoff_strike"],
          // SUBMERGED. 24 P-700 Granit (SS-N-19 Shipwreck) in angled tubes.
          // Swarm guidance: leader missile flies HIGH, rest sea-skim.
        },
        {
          id: slava, actor: "actor_2",
          name: "Slava-class CG Marshal Ustinov (16× P-500 Bazalt)",
          type: "naval", echelon: "company", posture: "attacking",
          position: "3,9", strength: 100, supply: 100, status: "ready",
          morale: 85, ammo: 100, entrenchment: 0, detected: true,
          movementType: "naval",
          specialCapabilities: ["standoff_strike", "medium_range_ad", "radar_missile_ad"],
          // 16 P-500 Bazalt (SS-N-12 Sandbox) + S-300F Fort SAM for self-defense
        },
      ],
    },

    orders: {
      actor_1: {
        [cvn]:       { actionOrder: { id: "DEFEND" },
                       intent: "Maintain formation center. Launch alert Tomcats. All point defense weapons free. Maneuver to unmask CIWS arcs." },
        [aegis]:     { actionOrder: { id: "DEFEND" },
                       intent: "Area air defense — engage ALL inbound aircraft and missiles with SM-2. Shoot-shoot-look-shoot. Priority: missiles over aircraft. Coordinate fire between both cruisers to avoid double-engaging same target." },
        [ddScreen]:  { actionOrder: { id: "DEFEND" },
                       intent: "Screen north. Sea Sparrow and Phalanx weapons free. Maneuver to interpose between threat axis and carrier if missiles leak through Aegis zone." },
        [ffgScreen]: { actionOrder: { id: "DEFEND" },
                       intent: "Screen south. SM-1 and Phalanx weapons free. Sacrifice ship to screen carrier if necessary." },
        [capAlpha]:  { actionOrder: { id: "AIR_SUPERIORITY", target: "3,5", altitude: "HIGH" },
                       intent: "OUTER AIR BATTLE. Intercept 1st Backfire Squadron on northern axis BEFORE they reach Kh-22 launch range. Engage at maximum Phoenix range (~100nm). Splash bombers, not escorts — the MiG-31s are a distraction." },
        [capBravo]:  { actionOrder: { id: "AIR_SUPERIORITY", target: "3,13", altitude: "HIGH" },
                       intent: "OUTER AIR BATTLE. Intercept 3rd Backfire Squadron on southern axis. Phoenix engagement at max range. Kill bombers before they launch." },
        [hawkeye]:   { actionOrder: { id: "AIR_RECON", target: "4,9", altitude: "HIGH" },
                       intent: "Maintain AEW station. Provide fighter direction and target cueing for all F-14 intercepts. Track every inbound contact. Vector alert Tomcats to center axis threat." },
        [alertCats]: { actionOrder: { id: "AIR_SUPERIORITY", target: "5,9", altitude: "HIGH" },
                       intent: "Scramble from deck, afterburner to intercept 2nd Backfire Squadron on center axis. This is the undefended axis — NO CAP station covers it. Phoenix engagement as soon as weapons range." },
        [prowler]:   { actionOrder: { id: "ESCORT", target: alertCats },
                       intent: "ECM support. Jam Backfire DownBeat targeting radars to degrade Kh-22 launch solutions. Jam P-700 Granit terminal seekers if possible. Protect battle group electronic environment." },
      },
      actor_2: {
        [bearD]:  { actionOrder: { id: "AIR_RECON", target: "9,9", altitude: "HIGH" },
                    intent: "Maintain contact with carrier battle group. Relay continuous targeting data to strike aircraft and Oscar SSGN for mid-course guidance. Stay at maximum radar range — do not close within F-14 engagement envelope." },
        [bf1]:    { movementOrder: { id: "MOVE", target: "4,4" },
                    actionOrder: { id: "STRATEGIC_STRIKE", target: "9,9", altitude: "HIGH" },
                    intent: "Northern axis strike. Ingress at HIGH altitude, launch Kh-22 missiles at maximum range (~300nm) against carrier. All aircraft fire simultaneously — 1-minute launch window. Egress at supersonic speed immediately after launch. Accept losses from F-14 intercept." },
        [bf2]:    { movementOrder: { id: "MOVE", target: "4,9" },
                    actionOrder: { id: "STRATEGIC_STRIKE", target: "9,9", altitude: "HIGH" },
                    intent: "Center axis strike. Coordinate launch timing with 1st and 3rd squadrons for simultaneous missile arrival. This axis has the shortest ingress — expect to launch first and draw defensive attention." },
        [bf3]:    { movementOrder: { id: "MOVE", target: "4,14" },
                    actionOrder: { id: "STRATEGIC_STRIKE", target: "9,9", altitude: "HIGH" },
                    intent: "Southern axis strike. Launch Kh-22s on same time-on-target as other squadrons. Southern approach may be less defended — exploit any gap in F-14 coverage." },
        [mig31]:  { actionOrder: { id: "AIR_SUPERIORITY", target: "4,6", altitude: "HIGH" },
                    intent: "Engage F-14 Tomcats with R-33 missiles to protect 1st Backfire Squadron. Disrupt the outer air battle — every Backfire that survives to launch is a missile in the air. Do NOT pursue past column 5 — fuel limitations." },
        [oscar]:  { actionOrder: { id: "FIRE_MISSION", target: "9,9", subtype: "HE" },
                    intent: "Surface to launch depth. Fire FULL SALVO of 24 P-700 Granit anti-ship missiles. Time launch for simultaneous arrival with Backfire Kh-22 salvo. One missile climbs to HIGH altitude as swarm leader to designate targets via datalink — remaining 23 sea-skim at 20m altitude. Priority target: carrier." },
        [slava]:  { actionOrder: { id: "FIRE_MISSION", target: "9,9", subtype: "HE" },
                    intent: "Launch 16 P-500 Bazalt anti-ship missiles at carrier battle group. Coordinate timing with Oscar SSGN for maximum saturation. Missiles sea-skim in terminal phase. After launch, withdraw west at flank speed." },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// SCENARIO 14: Fulda Gap — Soviet MRD Assault on NATO V Corps
// Full-scale Cold War combined arms land battle. 18 units.
// Soviet 39th Guards MRD vs 11th ACR + 3rd Armored Division.
// ════════════════════════════════════════════════════════════════
function scenario_fuldaGap() {
  counter = 0;

  // NATO Forces (actor_1) — V Corps, Fulda Sector
  const eagleTrp = uid();  // 1: 11th ACR, Eagle Troop — CFA covering force
  const tf267    = uid();  // 2: 3rd AD, TF 2-67 Armor — GDP northern sector
  const tf35cav  = uid();  // 3: 3rd AD, TF 3-5 Cavalry — GDP southern sector
  const m109bty  = uid();  // 4: 2-3 FA Battalion — direct support artillery
  const mlrs     = uid();  // 5: V Corps MLRS Battery — counter-battery / deep fires
  const apaches  = uid();  // 6: 3rd AD Avn Bde, Apache Company — attack helos
  const a10s     = uid();  // 7: A-10A Flight — CAS
  const f16s     = uid();  // 8: F-16C Flight — air superiority / SEAD
  const hawk     = uid();  // 9: Hawk AD Battery — covering GDP

  // Soviet Forces (actor_2) — 39th Guards MRD, 8th Guards Army
  const mrr1bn1   = uid(); // 10: 1st MRR, 1st Bn — main assault
  const mrr1tank  = uid(); // 11: 1st MRR, Tank Bn — armored exploitation
  const mrr2bn1   = uid(); // 12: 2nd MRR, 1st Bn — supporting attack south
  const tankRegt  = uid(); // 13: Tank Regiment, 1st Bn — second echelon
  const divArty   = uid(); // 14: Division Artillery Group — fire preparation
  const sa6bty    = uid(); // 15: SA-6 Battery — AD umbrella
  const hinds     = uid(); // 16: Mi-24 Hind Squadron — attack helos
  const frogfoots = uid(); // 17: Su-25 Frogfoot Flight — CAS
  const mig29s    = uid(); // 18: MiG-29 Escort Flight — air superiority

  const FULDA_ENVIRONMENT = {
    weather: "overcast", visibility: "good", groundCondition: "damp",
    timeOfDay: "dawn", climate: "temperate", stability: "low", severity: "moderate",
  };

  return {
    meta: {
      id: "fulda_gap",
      name: "Battle of the Fulda Gap (1985 Cold War)",
      testing: "Can the system model a full-scale Cold War combined arms land battle? "
        + "A Soviet Motor Rifle Division assaults through the Fulda corridor against 11th ACR's "
        + "covering force and 3rd Armored Division's general defense positions. "
        + "Tests: echeloned ground assault, combined arms integration, artillery preparation, "
        + "fighting withdrawal mechanics, hull-down armor defense, attack helicopter ambush, "
        + "CAS vs layered AD, SEAD, air superiority, counter-battery fire.",
      expectedOutcome: "11th ACR fights a costly withdrawal through the CFA, destroying the "
        + "Soviet advance guard but being forced back. Soviet first echelon hits the GDP and gets "
        + "mauled by hull-down M1A1s and TOW missiles. Soviet artillery suppresses some GDP positions. "
        + "Apaches ambush the tank exploitation force. A-10s face SA-6 threat. F-16s contest airspace "
        + "against MiG-29s. The question: do Soviet numbers overwhelm NATO qualitative superiority?",
    },

    preset: {
      scale: "grand_tactical",
      title: "Battle of the Fulda Gap",
      description: "Hesse, West Germany, October 1985. The 39th Guards Motor Rifle Division "
        + "(8th Guards Combined Arms Army) launches a divisional assault through the Fulda corridor — "
        + "the most dangerous axis of advance into NATO's Central European front. The 11th Armored "
        + "Cavalry Regiment fights a delaying action in the Covering Force Area while V Corps' "
        + "3rd Armored Division mans the General Defense Position. Both sides commit attack helicopters "
        + "and ground-attack aircraft; the air battle overhead is as fierce as the ground fight.",

      initialConditions: "0545 local, 15 October 1985. Pre-dawn. Soviet 30-minute artillery "
        + "preparation has just begun — 2S3 and BM-21 salvos are impacting 11th ACR positions in the CFA. "
        + "Eagle Troop occupies hull-down battle positions on a ridgeline at the western edge of the CFA. "
        + "3rd AD's TF 2-67 Armor and TF 3-5 Cavalry are dug in on the GDP 15km to the rear. "
        + "MLRS has fired its first counter-battery salvo against detected Soviet gun positions. "
        + "The 39th Guards MRD's first-echelon regiments are deployed in attack formation and advancing. "
        + "Mi-24 Hinds are moving to pop-up positions. Su-25s and MiG-29s are inbound. "
        + "A-10 Thunderbolts are scrambling from their forward operating location. "
        + "Apache company is moving to an ambush position behind a tree line.",

      specialRules: `LAND SCENARIO — FULDA GAP COMBINED ARMS BATTLE (1985 Cold War)

SCALE: Each hex represents approximately 2-3 km. The scenario covers a 30km-wide corridor in the Fulda Gap, Hesse, West Germany. Terrain is rolling hills, mixed forest, small villages, and cultivated fields — typical Central European landscape. Use hex terrain features from the map where they exist; otherwise assume rolling mixed terrain.

SOVIET 39TH GUARDS MOTOR RIFLE DIVISION — FIRST ECHELON ASSAULT:
The division attacks with two Motor Rifle Regiments in the first echelon (1st MRR on the main axis, 2nd MRR supporting from the south) and the Tank Regiment in the second echelon for exploitation. Committed this turn: ~120 T-80BV and T-72B tanks, ~90 BMP-2 IFVs, ~2,000 dismounted infantry, 72 artillery tubes + 18 MRL launchers.

SOVIET EQUIPMENT SPECIFICATIONS:
- T-80BV: 125mm 2A46 smoothbore (APFSDS, HEAT, AT-11 ATGM), Kontakt-1 ERA, gas turbine 1100hp, 70km/h. 3 crew (autoloader). Effective vs M1 frontally only at <1500m with best ammo. Catastrophic ammo cookoff if carousel penetrated.
- T-72B: 125mm 2A46, Kontakt-1 ERA, diesel, 60km/h. Inferior fire control to T-80. Cannot reliably penetrate M1A1 frontal armor at typical engagement ranges.
- BMP-2: 30mm 2A42 autocannon (effective vs light armor, helicopters), AT-5 Spandrel ATGM (4km range, can kill M1 from side/rear). 7 dismounts. Aluminum armor — vulnerable to 25mm+.
- 2S3 Akatsiya: 152mm SP howitzer, 18.5km range (24km RAP). 54 tubes in 3 battalions. Fire preparation, suppression, counter-battery.
- BM-21 Grad: 40-round 122mm MRL, 20km range. 18 launchers. Area saturation — devastating against troops in the open.
- SA-6 Gainful (2K12 Kub): Semi-active radar SAM, 4-24km range, altitude 50-14000m. 4 triple launchers (12 missiles ready) + Straight Flush radar. Deadly to low-flying CAS. Caused massive NATO air losses in 1973 Yom Kippur War.
- Mi-24V Hind-E: AT-6 Spiral ATGM (5km range), 80mm S-8 rockets, 12.7mm rotary gun. Armored cockpit (resists 12.7mm). 335km/h. Pop-up attacks from behind terrain at 3-4km standoff.
- Su-25 Frogfoot: 30mm GSh-30-2, bombs, rockets, Kh-25ML laser-guided missiles. Titanium cockpit (resists 23mm). Soviet A-10 equivalent. Combat radius 375km.
- MiG-29A Fulcrum: R-27 Alamo BVR (~50km), R-73 Archer IR (helmet-mounted sight — lethal in dogfight), IRST for passive tracking. Excellent low-speed maneuverability but weak radar and limited fuel vs F-16.

SOVIET ASSAULT DOCTRINE:
1. FIRE PREPARATION (30 min): All 72 tubes concentrate on NATO positions. Counter-battery radars seek NATO guns.
2. FIRST ECHELON: 1st MRR advances two-up/one-back. BMPs to 800m, dismount infantry. Tanks direct fire from 1500-2000m. Engineers breach minefields.
3. EXPLOITATION: Once breach achieved, Tank Regiment pushes through at speed to reach the GDP.
4. Artillery "shoot and scoot": SP guns displace within 2-3 minutes of firing to avoid counter-battery.

NATO V CORPS — DEFENSE OF THE FULDA GAP:
11th ACR covering force battle: engage from hull-down at max range, destroy advance guard, withdraw 3-5km to next position. Goal: delay 24-48 hours, attrit the assault. 3rd AD defends the GDP from prepared positions with interlocking fields of fire, pre-planned obstacle belts, and registered artillery.

NATO EQUIPMENT SPECIFICATIONS:
- M1A1 Abrams: 120mm M256, M829A1 DU APFSDS (570mm+ penetration at 2000m — kills ANY Soviet tank frontally). Chobham + DU mesh armor (~600mm+ vs APFSDS). FLIR thermal — acquires targets at 3000m+ in darkness/smoke/dust. Stabilized gun, accurate on the move. 1500hp, 72km/h. DECISIVE ADVANTAGE: first-shot kill at night with thermal sights.
- M3 Bradley CFV: 25mm M242 Bushmaster (kills BMP-2 at 2500m), TOW-2 ATGM (3750m, 900mm+ penetration — lethal to T-72/T-80 from any angle). Must be stationary to fire TOW (10-15s vulnerability).
- M109A3: 155mm SP howitzer, 18km (30km RAP). Copperhead laser-guided round hits individual tanks at 16km.
- M270 MLRS: 12× 227mm rockets, 32km range, 644 DPICM submunitions per rocket. One 12-rocket salvo saturates 1km².
- AH-64A Apache: 16× AGM-114 Hellfire (8km, tandem HEAT, kills any tank). TADS/PNVS thermal (6km+ at night). Pop-up from behind terrain. 6 Apaches can kill 30+ vehicles in one engagement.
- A-10A Thunderbolt II: 30mm GAU-8 DU gatling (3900rpm, penetrates top/rear of any Soviet tank), AGM-65 Maverick (IR, 8km+), CBU cluster bombs. Titanium bathtub (survives 23mm). 2-hour loiter. Deadly but vulnerable to SA-6 at altitude and ZSU-23-4 at low level.
- F-16C Viper: AIM-7 Sparrow BVR, AIM-9 Sidewinder IR, 2× AGM-88 HARM anti-radiation missile (homes on SA-6 Straight Flush radar). APG-68 radar superior to MiG-29.
- MIM-23B Improved Hawk: Medium-range SAM, 40km range. Covers GDP against Su-25 and Mi-24.

CRITICAL MODELING REQUIREMENTS:
- THERMAL SIGHT ADVANTAGE: M1A1 thermal sights engage at 3000m in dawn/smoke/dust. Soviet tanks lack comparable thermals — effective range 1500-2000m in these conditions. This 1000-1500m "kill zone" is devastating head-on.
- HULL-DOWN POSITIONS: M1A1s in prepared hull-down expose only turret (~60% less target area, thickest armor presented). Soviets attacking across open ground are fully exposed.
- TOW MISSILES: Bradleys with TOW-2 kill T-80s at 3750m from flank positions, but 10-15 second guidance vulnerability.
- APACHE AMBUSH: Hellfire at 8km is outside all Soviet weapons except SA-6. ZSU-23-4 (2500m) and SA-13 (5km) deadly if Apaches hover.
- ARTILLERY DUEL: NATO FIREFINDER radar detects Soviet guns from incoming shell trajectories, MLRS responds in 2-3 min. Soviet SNAR-10 does the same. Counter-battery is a battle within the battle.
- CAS VS LAYERED AD: A-10s at 100-500ft face SA-6 (if they climb), ZSU-23-4, SA-13 (IR, 5km). Maverick standoff (8km) helps but gun runs require 2-3km closing. Expected attrition: ~7% per 100 sorties vs a division with full AD.
- SOVIET DOCTRINE: Accepts 50-60% first-echelon losses to break through. The question: can NATO destroy enough that the exploitation force arrives too late or too weak?
- CORRELATION OF FORCES: Soviet ~3:1 numerical superiority in armor vs NATO qualitative superiority (thermals, DU rounds, Hellfire, prepared positions). Model this honestly.`,

      turnDuration: "2 hours",
      startDate: "1985-10-15",
      environment: FULDA_ENVIRONMENT,

      actors: actors(
        [
          "Delay the Soviet advance in the Covering Force Area (11th ACR)",
          "Destroy the Soviet first echelon at the General Defense Position (3rd AD)",
          "Prevent a breakthrough that would allow the Tank Regiment to exploit",
        ],
        [
          "Break through the Covering Force Area and reach the GDP",
          "Achieve a breach in the GDP for the Tank Regiment to exploit",
          "Suppress NATO air power with SA-6 and MiG-29 air umbrella",
        ]
      ),

      eraSelections: { actor_1: "cold_war", actor_2: "cold_war" },

      units: [
        // ── NATO — V Corps, Fulda Sector ──
        {
          id: eagleTrp, actor: "actor_1",
          name: "Eagle Troop, 2nd Sqn, 11th ACR (M1A1 + M3 Bradley)",
          type: "armor", echelon: "company", posture: "defending",
          position: "4,7", strength: 100, supply: 90, status: "ready",
          morale: 95, ammo: 90, entrenchment: 30, detected: true,
          movementType: "tracked",
          specialCapabilities: ["ir_missile_ad"],
          // 14 M1A1, 13 M3 Bradley (TOW-2), 2 M106 mortars, Stinger teams
        },
        {
          id: tf267, actor: "actor_1",
          name: "TF 2-67 Armor, 3rd AD (M1A1 Abrams battalion)",
          type: "armor", echelon: "battalion", posture: "defending",
          position: "8,5", strength: 100, supply: 95, status: "ready",
          morale: 90, ammo: 95, entrenchment: 50, detected: true,
          movementType: "tracked",
          specialCapabilities: [],
          // 58 M1A1 in hull-down prepared positions, 14 M2 Bradley
        },
        {
          id: tf35cav, actor: "actor_1",
          name: "TF 3-5 Cavalry, 3rd AD (M3 Bradley + TOW)",
          type: "mechanized", echelon: "battalion", posture: "defending",
          position: "8,10", strength: 100, supply: 95, status: "ready",
          morale: 90, ammo: 95, entrenchment: 45, detected: true,
          movementType: "tracked",
          specialCapabilities: [],
          // 40 M3 Bradleys with TOW-2, infantry in prepared fighting positions
        },
        {
          id: m109bty, actor: "actor_1",
          name: "2-3 FA Battalion (18× M109A3 155mm)",
          type: "artillery", echelon: "battalion", posture: "defending",
          position: "10,7", strength: 100, supply: 85, status: "ready",
          morale: 85, ammo: 85, entrenchment: 20, detected: false,
          movementType: "tracked",
          specialCapabilities: ["indirect_fire"],
          // 18 M109A3 SP howitzers, Copperhead precision rounds available
        },
        {
          id: mlrs, actor: "actor_1",
          name: "V Corps MLRS Battery (6× M270)",
          type: "artillery", echelon: "company", posture: "defending",
          position: "11,8", strength: 100, supply: 80, status: "ready",
          morale: 85, ammo: 80, entrenchment: 10, detected: false,
          movementType: "tracked",
          specialCapabilities: ["indirect_fire"],
          // 6 M270 MLRS, 72 rockets. FIREFINDER radar for counter-battery targeting.
        },
        {
          id: apaches, actor: "actor_1",
          name: "Apache Company, 3rd AD Avn Bde (6× AH-64A)",
          type: "attack_helicopter", echelon: "company", posture: "ready",
          position: "7,5", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, detected: false,
          movementType: "helicopter", readiness: 95, munitions: 100, fuel: 85,
          baseHex: "11,5",
          airProfile: {
            speed: "medium", maneuverability: 8,
            weaponsPackage: "precision_guided",
            defensiveArmament: false, ecm: false, radarEquipped: true,
          },
          specialCapabilities: ["close_air_support", "precision_strike"],
          // 96 Hellfire total (16 each), 30mm M230 chain gun, Hydra 70 rockets. TADS/PNVS thermal.
        },
        {
          id: a10s, actor: "actor_1",
          name: "A-10 Flight, 81st TFW (4× A-10A Thunderbolt II)",
          type: "air", echelon: "company", posture: "ready",
          position: "11,6", strength: 100, supply: 100, status: "ready",
          morale: 90, ammo: 100, detected: true,
          movementType: "air", readiness: 90, munitions: 100, fuel: 80,
          baseHex: "11,6",
          airProfile: {
            speed: "slow", maneuverability: 6,
            weaponsPackage: "precision_guided",
            defensiveArmament: false, ecm: false, radarEquipped: false,
          },
          specialCapabilities: ["close_air_support", "precision_strike"],
          // 30mm GAU-8 DU, 4× AGM-65 Maverick, CBU-87. Titanium bathtub.
        },
        {
          id: f16s, actor: "actor_1",
          name: "F-16C Flight, 50th TFW (4× F-16C Viper)",
          type: "air", echelon: "company", posture: "ready",
          position: "11,4", strength: 100, supply: 100, status: "ready",
          morale: 95, ammo: 100, detected: true,
          movementType: "air", readiness: 90, munitions: 100, fuel: 75,
          baseHex: "11,4",
          airProfile: {
            speed: "supersonic", maneuverability: 9,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles"],
            defensiveArmament: false, ecm: true, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "sead_capable"],
          // AIM-7 Sparrow, AIM-9L Sidewinder, 2× AGM-88 HARM. APG-68 radar.
        },
        {
          id: hawk, actor: "actor_1",
          name: "Hawk AD Battery, 3rd AD ADA Bn (MIM-23B)",
          type: "air_defense", echelon: "company", posture: "defending",
          position: "9,7", strength: 100, supply: 90, status: "ready",
          morale: 85, ammo: 90, entrenchment: 30, detected: false,
          movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"],
          // Improved Hawk: 40km range. Covers GDP against Su-25 and Mi-24.
        },

        // ── Soviet — 39th Guards MRD, 8th Guards Army ──
        {
          id: mrr1bn1, actor: "actor_2",
          name: "1st MRR, 1st Bn (40× BMP-2 + T-80BV company)",
          type: "mechanized", echelon: "battalion", posture: "attacking",
          position: "2,6", strength: 100, supply: 90, status: "ready",
          morale: 80, ammo: 95, entrenchment: 0, detected: true,
          movementType: "tracked",
          specialCapabilities: [],
          // 40 BMP-2, 10 T-80BV (attached tank company), ~400 dismounts
        },
        {
          id: mrr1tank, actor: "actor_2",
          name: "1st MRR, Tank Bn (31× T-80BV)",
          type: "armor", echelon: "battalion", posture: "attacking",
          position: "2,8", strength: 100, supply: 90, status: "ready",
          morale: 80, ammo: 95, entrenchment: 0, detected: true,
          movementType: "tracked",
          specialCapabilities: [],
          // 31 T-80BV with Kontakt-1 ERA. 125mm APFSDS + AT-11 ATGM.
        },
        {
          id: mrr2bn1, actor: "actor_2",
          name: "2nd MRR, 1st Bn (40× BMP-2 + dismounts)",
          type: "mechanized", echelon: "battalion", posture: "attacking",
          position: "2,11", strength: 100, supply: 90, status: "ready",
          morale: 75, ammo: 95, entrenchment: 0, detected: true,
          movementType: "tracked",
          specialCapabilities: [],
          // 40 BMP-2, ~400 dismounts. Supporting attack on southern axis.
        },
        {
          id: tankRegt, actor: "actor_2",
          name: "Tank Regiment, 1st Bn (31× T-72B)",
          type: "armor", echelon: "battalion", posture: "attacking",
          position: "0,7", strength: 100, supply: 95, status: "ready",
          morale: 85, ammo: 100, entrenchment: 0, detected: false,
          movementType: "tracked",
          specialCapabilities: [],
          // Second echelon / exploitation. 31 T-72B with Kontakt-1 ERA.
        },
        {
          id: divArty, actor: "actor_2",
          name: "Div Artillery Group (54× 2S3 Akatsiya + 18× BM-21 Grad)",
          type: "artillery", echelon: "regiment", posture: "attacking",
          position: "0,8", strength: 100, supply: 85, status: "ready",
          morale: 80, ammo: 85, entrenchment: 10, detected: true,
          movementType: "tracked",
          specialCapabilities: ["indirect_fire"],
          // 54× 152mm SP howitzer + 18× 122mm MRL. Fire preparation ongoing.
        },
        {
          id: sa6bty, actor: "actor_2",
          name: "SA-6 Battery (2K12 Kub, 4 TEL + Straight Flush radar)",
          type: "air_defense", echelon: "company", posture: "defending",
          position: "1,7", strength: 100, supply: 95, status: "ready",
          morale: 85, ammo: 95, entrenchment: 15, detected: false,
          movementType: "tracked",
          specialCapabilities: ["radar_missile_ad"],
          // 4 triple launchers (12 missiles ready), Straight Flush radar. 4-24km range.
        },
        {
          id: hinds, actor: "actor_2",
          name: "Hind Squadron (8× Mi-24V)",
          type: "attack_helicopter", echelon: "company", posture: "attacking",
          position: "1,5", strength: 100, supply: 100, status: "ready",
          morale: 80, ammo: 100, detected: false,
          movementType: "helicopter", readiness: 85, munitions: 100, fuel: 75,
          baseHex: "0,5",
          airProfile: {
            speed: "medium", maneuverability: 6,
            weaponsPackage: "precision_guided",
            defensiveArmament: true, ecm: false, radarEquipped: false,
          },
          specialCapabilities: ["close_air_support"],
          // AT-6 Spiral (5km), S-8 rockets, 12.7mm YakB rotary gun. Armored cockpit.
        },
        {
          id: frogfoots, actor: "actor_2",
          name: "Su-25 Frogfoot Flight (4× Su-25)",
          type: "air", echelon: "company", posture: "attacking",
          position: "0,10", strength: 100, supply: 100, status: "ready",
          morale: 80, ammo: 100, detected: true,
          movementType: "air", readiness: 85, munitions: 100, fuel: 70,
          baseHex: "0,10",
          airProfile: {
            speed: "medium", maneuverability: 6,
            weaponsPackage: "precision_guided",
            defensiveArmament: false, ecm: false, radarEquipped: false,
          },
          specialCapabilities: ["close_air_support", "precision_strike"],
          // 30mm cannon, Kh-25ML guided missiles, bombs, rockets. Titanium cockpit.
        },
        {
          id: mig29s, actor: "actor_2",
          name: "MiG-29 Escort Flight (4× MiG-29A Fulcrum)",
          type: "air", echelon: "company", posture: "attacking",
          position: "0,6", strength: 100, supply: 100, status: "ready",
          morale: 85, ammo: 100, detected: true,
          movementType: "air", readiness: 80, munitions: 100, fuel: 60,
          baseHex: "0,6",
          airProfile: {
            speed: "supersonic", maneuverability: 9,
            weaponsPackage: ["guns", "ir_missiles", "radar_missiles"],
            defensiveArmament: false, ecm: false, radarEquipped: true,
          },
          specialCapabilities: ["air_superiority", "bvr_capable"],
          // R-27 Alamo BVR (~50km), R-73 Archer (helmet-mounted sight), IRST. GSh-30-1.
        },
      ],
    },

    orders: {
      actor_1: {
        [eagleTrp]:  { actionOrder: { id: "DEFEND" },
                       intent: "COVERING FORCE BATTLE. Fight from hull-down positions on the ridgeline. Engage T-80s at 3000m with M1A1 thermal sights — dawn light and smoke give massive advantage. Bradleys fire TOW-2 from flank at 3000-3750m. Destroy the advance guard, then withdraw 3-5km east to next delay position before being decisively engaged. Blow pre-planned demolitions on withdrawal route." },
        [tf267]:     { actionOrder: { id: "DEFEND" },
                       intent: "GDP DEFENSE — Northern sector. Hold hull-down prepared positions. M1A1s engage Soviet armor at 2500-3000m as it exits the CFA. Interlocking fields of fire with TF 3-5 Cav on the right. Do NOT advance forward of the GDP line." },
        [tf35cav]:   { actionOrder: { id: "DEFEND" },
                       intent: "GDP DEFENSE — Southern sector. TOW-2 Bradleys cover the southern approach from prepared positions. Engage BMPs and tanks at max TOW range (3750m). Dismounted infantry with Dragon ATGMs cover dead ground between vehicle positions." },
        [m109bty]:   { actionOrder: { id: "FIRE_MISSION", target: "3,7", subtype: "HE" },
                       intent: "Fire support for Eagle Troop's withdrawal. Suppress Soviet assault formations closing on CFA positions. Copperhead precision rounds against identified command vehicles. Shift to GDP final protective fires when Soviet first echelon reaches column 6." },
        [mlrs]:      { actionOrder: { id: "FIRE_MISSION", target: "1,8", subtype: "HE" },
                       intent: "COUNTER-BATTERY and deep fires. FIREFINDER radar has located Soviet artillery positions — fire DPICM salvo at Division Artillery Group. Secondary: DPICM on Tank Regiment assembly area to attrit the exploitation force before it commits." },
        [apaches]:   { movementOrder: { id: "MOVE", target: "6,4" },
                       actionOrder: { id: "CAS", target: "4,7", altitude: "LOW" },
                       intent: "ATTACK HELICOPTER AMBUSH. Move to hide position behind tree line. Pop-up with Hellfire at 6-8km against 1st MRR Tank Bn as it advances through the CFA. Fire salvos, drop behind terrain. Displace after 2-3 engagements to avoid SA-13 and ZSU-23-4 fire." },
        [a10s]:      { movementOrder: { id: "MOVE", target: "6,9" },
                       actionOrder: { id: "CAS", target: "3,8", altitude: "LOW" },
                       intent: "CAS — kill Soviet armor in the CFA. Ingress at 100-300ft using terrain masking. Mavericks at 8km standoff against tank concentrations. 30mm gun runs against BMPs in the open. WARNING: SA-6 is in the area — do NOT climb above 50m until SA-6 is suppressed." },
        [f16s]:      { movementOrder: { id: "MOVE", target: "4,5" },
                       actionOrder: { id: "SEAD", target: sa6bty, altitude: "MEDIUM" },
                       intent: "DUAL MISSION: (1) SEAD — fire AGM-88 HARM at SA-6 Straight Flush radar to suppress/destroy it, opening the corridor for A-10 CAS. (2) After HARM shots, switch to air superiority — engage MiG-29s with AIM-7 at BVR and AIM-9 in the merge." },
        [hawk]:      { actionOrder: { id: "DEFEND" },
                       intent: "Air defense of the GDP. Engage Su-25 Frogfoots and Mi-24 Hinds at max range. Priority: aircraft attempting CAS against GDP positions." },
      },
      actor_2: {
        [mrr1bn1]:   { movementOrder: { id: "MOVE", target: "4,6" },
                       actionOrder: { id: "ATTACK", target: "4,7" },
                       intent: "MAIN ASSAULT — 1st echelon. Advance under artillery prep. BMPs to 800m, dismount infantry. Tank company direct fire from 1500-2000m. Fix Eagle Troop in position so they cannot withdraw cleanly. Engineers breach minefields." },
        [mrr1tank]:  { movementOrder: { id: "MOVE", target: "4,8" },
                       actionOrder: { id: "ATTACK", target: "4,7" },
                       intent: "ARMORED EXPLOITATION — 1st MRR. Follow behind 1st Bn assault. Once Eagle Troop is fixed or withdrawing, push through the gap at speed to reach GDP before NATO consolidates. T-80BVs lead — ERA absorbs first TOW hit. Close to <1500m to negate M1A1 range advantage." },
        [mrr2bn1]:   { movementOrder: { id: "MOVE", target: "4,11" },
                       actionOrder: { id: "ATTACK", target: "8,10" },
                       intent: "SUPPORTING ATTACK — southern axis. Fix TF 3-5 Cav on the GDP. BMP-2 30mm suppressive fire, AT-5 Spandrel teams engage Bradleys at 4km. Dismount through dead ground if breach achieved. Even if stalled, prevents NATO shifting reserves north." },
        [tankRegt]:  { movementOrder: { id: "MOVE", target: "3,7" },
                       intent: "SECOND ECHELON — advance to forward assembly area. Wait for 1st MRR to breach the covering force. Exploit any gap at speed — drive through to GDP before 3rd AD reacts. Do not commit until breach confirmed." },
        [divArty]:   { actionOrder: { id: "FIRE_MISSION", target: "4,7", subtype: "HE" },
                       intent: "FIRE PREPARATION — all 72 tubes on Eagle Troop ridgeline + northern GDP. BM-21 Grad for area saturation, 2S3 for precision suppression. Counter-battery: SNAR-10 radar locating M109 positions. Shift fires forward as assault advances. Shoot and scoot — displace within 3 min." },
        [sa6bty]:    { actionOrder: { id: "DEFEND" },
                       intent: "AD UMBRELLA. Straight Flush in search mode. Engage ANY NATO aircraft in the 4-24km envelope — priority: A-10s and Apaches. Radar activates only 30 seconds per engagement to minimize HARM exposure. Relocate after every 2 engagements." },
        [hinds]:     { movementOrder: { id: "MOVE", target: "3,5" },
                       actionOrder: { id: "CAS", target: "4,7", altitude: "LOW" },
                       intent: "ATTACK HELO SUPPORT. Pop-up behind ridgeline, engage NATO armor in CFA with AT-6 Spiral at 4-5km. Priority: M1A1s in hull-down holding up the ground assault. Rockets on infantry positions. Stay below ridgeline — Hawk SAMs are deadly if exposed." },
        [frogfoots]: { movementOrder: { id: "MOVE", target: "5,10" },
                       actionOrder: { id: "CAS", target: "8,10", altitude: "LOW" },
                       intent: "CAS — strike GDP southern sector. Ingress low under SA-6 umbrella. Kh-25ML against vehicle concentrations. 30mm strafing on Bradley positions. Stay low and fast — Hawk SAM threat. Egress west after weapons release." },
        [mig29s]:    { movementOrder: { id: "MOVE", target: "4,5" },
                       actionOrder: { id: "AIR_SUPERIORITY", target: "5,6", altitude: "HIGH" },
                       intent: "AIR SUPERIORITY over the battlefield. Engage F-16Cs with R-27 Alamo at BVR. If merge, R-73 Archer with helmet-mounted sight is superior close-in. Protect Su-25s and Mi-24s from F-16 interference. Use IRST for passive tracking to avoid HARM." },
      },
    },
  };
}


// ════════════════════════════════════════════════════════════════
// Export all scenarios
// ════════════════════════════════════════════════════════════════
export const AIR_TEST_SCENARIOS = [
  scenario_hiddenAD,
  scenario_trucksVsCAS,
  scenario_contestedAirspace,
  scenario_ww2Furball,
  scenario_urbanDugIn,
  scenario_highVsShorad,
  scenario_retreatingColumn,
  scenario_bvrApproach,
  scenario_heloVsSAM,
  scenario_dangerClose,
  scenario_airliftAmbush,
  scenario_seadThenCAS,
  scenario_carrierStrike,
  scenario_fuldaGap,
];
