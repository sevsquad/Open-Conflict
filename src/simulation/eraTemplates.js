// ═══════════════════════════════════════════════════════════════
// ERA TEMPLATES — Historical unit palettes for each warfare era
//
// Each era defines unit templates with historical names, base types
// (for sim engine compatibility), scale ranges, and rich defaults.
// Templates map to abstract baseTypes so all downstream systems
// (TYPE_ICONS, order validity, range bands, detection, LLM prompts)
// work unmodified.
// ═══════════════════════════════════════════════════════════════

import { BRANCH_SCALE_RELEVANCE, SCALE_TIERS } from "./schemas.js";

// ── Default/Custom era ─────────────────────────────────────────
// Wraps existing BRANCH_SCALE_RELEVANCE keys as templates so the
// current palette behavior is preserved exactly when no era is selected.

function buildDefaultTemplates() {
  // Convert type key to display-friendly name
  const formatName = (key) => key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return Object.entries(BRANCH_SCALE_RELEVANCE).map(([key, [min, max]]) => ({
    templateId: key,
    name: formatName(key),
    baseType: key,
    scaleRange: [min, max],
    defaults: {},
    description: "",
  }));
}

const DEFAULT_ERA = {
  id: "default",
  label: "Default / Custom",
  shortLabel: "Default",
  echelonLabels: {},
  templates: buildDefaultTemplates(),
};

// ── WW2 (1939–1945) ───────────────────────────────────────────

const WW2_ERA = {
  id: "ww2",
  label: "World War II (1939–1945)",
  shortLabel: "WW2",
  echelonLabels: {
    // WW2 uses mostly standard modern echelon names
    artillery_battery: "Artillery Battery",
    battle_group: "Kampfgruppe / Battle Group",
  },
  templates: [
    // ── Ground (17) ──
    {
      templateId: "ww2_rifle_infantry",
      name: "Rifle Infantry",
      baseType: "infantry",
      scaleRange: [1, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Bolt-action and semi-auto rifle squads — the baseline infantry of all nations",
    },
    {
      templateId: "ww2_mechanized_infantry",
      name: "Mechanized Infantry",
      baseType: "mechanized",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.1, effective: 0.5, max: 1.0 } },
      description: "Halftrack or truck-mounted infantry with mobile fire support",
    },
    {
      templateId: "ww2_airborne_infantry",
      name: "Airborne Infantry",
      baseType: "parachute_infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["airborne"], weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Parachute-delivered infantry for vertical envelopment and deep operations",
    },
    {
      templateId: "ww2_glider_infantry",
      name: "Glider Infantry",
      baseType: "glider_infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["airborne"], weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Glider-delivered troops with heavier equipment than paratroopers",
    },
    {
      templateId: "ww2_ranger_commando",
      name: "Ranger / Commando",
      baseType: "special_forces",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Elite light infantry — Rangers, Commandos, Brandenburgers",
    },
    {
      templateId: "ww2_partisan",
      name: "Partisan / Militia",
      baseType: "infantry",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", specialCapabilities: ["guerrilla", "low_morale"], weaponRangeKm: { pointBlank: 0.05, effective: 0.2, max: 0.5 } },
      description: "Irregular resistance fighters — low organization, light arms, local knowledge, sabotage",
    },
    {
      templateId: "ww2_machine_gun_team",
      name: "Machine Gun Team",
      baseType: "infantry",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", specialCapabilities: ["sustained_fire"], weaponRangeKm: { pointBlank: 0.1, effective: 0.6, max: 1.2 } },
      description: "MG-42, Browning M1919, Vickers — sustained suppressive fire",
    },
    {
      templateId: "ww2_mortar_team",
      name: "Mortar Team",
      baseType: "artillery",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 2.0, max: 4.0 } },
      description: "60mm–120mm mortars — organic indirect fire support",
    },
    {
      templateId: "ww2_anti_tank_gun",
      name: "Anti-Tank Gun",
      baseType: "artillery",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["anti_armor"], weaponRangeKm: { pointBlank: 0.2, effective: 1.0, max: 2.0 } },
      description: "Towed anti-tank guns — PaK 40, 6-pounder, ZiS-3 — ambush and defense",
    },
    {
      templateId: "ww2_sniper_team",
      name: "Sniper Team",
      baseType: "special_forces",
      scaleRange: [1, 2],
      defaults: { movementType: "foot", specialCapabilities: ["precision_fire"], weaponRangeKm: { pointBlank: 0.1, effective: 0.6, max: 1.0 } },
      description: "Precision fire and harassment — two-man sniper/spotter teams",
    },
    {
      templateId: "ww2_light_tank",
      name: "Light Tank",
      baseType: "armor",
      scaleRange: [2, 4],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.3, effective: 0.8, max: 1.5 } },
      description: "Recon and infantry support — Stuart, T-70, Panzer II",
    },
    {
      templateId: "ww2_medium_tank",
      name: "Medium Tank",
      baseType: "armor",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.5, effective: 1.5, max: 2.5 } },
      description: "Sherman, T-34, Panzer IV — the workhorse of armored warfare",
    },
    {
      templateId: "ww2_heavy_tank",
      name: "Heavy Tank",
      baseType: "armor",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["heavy_armor"], weaponRangeKm: { pointBlank: 0.5, effective: 2.0, max: 3.5 } },
      description: "Tiger, IS-2, Churchill — breakthrough and overwatch",
    },
    {
      templateId: "ww2_tank_destroyer",
      name: "Tank Destroyer / Assault Gun",
      baseType: "tank_destroyer",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["anti_armor"], weaponRangeKm: { pointBlank: 0.5, effective: 1.5, max: 3.0 } },
      description: "StuG III, M10 Wolverine, SU-85 — dedicated anti-tank and infantry support",
    },
    {
      templateId: "ww2_armored_car",
      name: "Armored Car / Recon Vehicle",
      baseType: "recon",
      scaleRange: [1, 4],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Sdkfz 222, M8 Greyhound, BA-64 — screening and scouting",
    },
    {
      templateId: "ww2_armored_infantry",
      name: "Armored Infantry",
      baseType: "armored_infantry",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 1.0 } },
      description: "Half-track mounted infantry — Sdkfz 251, M3 Half-track",
    },
    {
      templateId: "ww2_combat_engineers",
      name: "Combat Engineers",
      baseType: "engineer",
      scaleRange: [2, 4],
      defaults: { movementType: "foot", specialCapabilities: ["breaching", "bridging"], weaponRangeKm: { pointBlank: 0.05, effective: 0.1, max: 0.5 } },
      description: "Breaching, bridging, demolition, mine clearing",
    },

    // ── Artillery & Support (5) ──
    {
      templateId: "ww2_field_artillery",
      name: "Field Artillery Battery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 2.0, effective: 8.0, max: 11.0 } },
      description: "105mm howitzer, 25-pounder, 10.5cm leFH — divisional fire support",
    },
    {
      templateId: "ww2_rocket_artillery",
      name: "Rocket Artillery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["area_fire"], weaponRangeKm: { pointBlank: 3.0, effective: 6.0, max: 9.0 } },
      description: "Katyusha, Nebelwerfer, Calliope — devastating area saturation",
    },
    {
      templateId: "ww2_anti_aircraft",
      name: "Anti-Aircraft Battery",
      baseType: "air_defense",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["dual_role", "gun_ad"], weaponRangeKm: { pointBlank: 0.5, effective: 2.0, max: 4.0 } },
      description: "Bofors 40mm, Flak 88, Oerlikon — air defense with anti-armor dual role",
    },
    {
      templateId: "ww2_logistics",
      name: "Supply / Logistics Column",
      baseType: "logistics",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Truck convoys, Red Ball Express, mule trains — the lifeblood of armies",
    },
    {
      templateId: "ww2_headquarters",
      name: "Headquarters",
      baseType: "headquarters",
      scaleRange: [2, 6],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Division, Corps, or Army HQ — command and coordination",
    },

    // ── Air (4) ──
    {
      templateId: "ww2_fighter",
      name: "Fighter Aircraft",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority"],
        weaponRangeKm: { pointBlank: 0, effective: 15.0, max: 30.0 },
        airProfile: { speed: "medium", maneuverability: 8, weaponsPackage: ["guns"], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "Spitfire, Bf-109, P-51, Zero — air superiority fighters",
    },
    {
      templateId: "ww2_fighter_bomber",
      name: "Fighter-Bomber",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority", "close_air_support"],
        weaponRangeKm: { pointBlank: 0, effective: 12.0, max: 25.0 },
        airProfile: { speed: "medium", maneuverability: 6, weaponsPackage: ["guns"], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "P-47, Fw-190, Typhoon — dual-role air combat and ground attack",
    },
    {
      templateId: "ww2_night_fighter",
      name: "Night Fighter",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority"],
        weaponRangeKm: { pointBlank: 0, effective: 10.0, max: 20.0 },
        airProfile: { speed: "medium", maneuverability: 5, weaponsPackage: ["guns"], defensiveArmament: false, ecm: false, radarEquipped: true },
      },
      description: "Bf-110G, Mosquito NF, P-61 Black Widow — radar-equipped night interception",
    },
    {
      templateId: "ww2_tactical_bomber",
      name: "Tactical Bomber / Dive Bomber",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["close_air_support"],
        weaponRangeKm: { pointBlank: 0, effective: 10.0, max: 20.0 },
        airProfile: { speed: "medium", maneuverability: 4, weaponsPackage: ["guns"], defensiveArmament: true, ecm: false, radarEquipped: false },
      },
      description: "Stuka, Il-2, P-47 — close air support and interdiction",
    },
    {
      templateId: "ww2_strategic_bomber",
      name: "Strategic Bomber",
      baseType: "air",
      scaleRange: [4, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["strategic_bombing"],
        weaponRangeKm: { pointBlank: 0, effective: 30.0, max: 80.0 },
        airProfile: { speed: "medium", maneuverability: 2, weaponsPackage: ["guns"], defensiveArmament: true, ecm: false, radarEquipped: false },
      },
      description: "B-17, Lancaster, He-111 — area and precision strategic bombing",
    },
    {
      templateId: "ww2_transport_aircraft",
      name: "Transport Aircraft",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["airlift"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "medium", maneuverability: 2, weaponsPackage: [], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "C-47 Skytrain, Ju-52 — airborne operations and supply drops",
    },

    // ── Naval (10) ──
    {
      templateId: "ww2_battleship",
      name: "Battleship",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["shore_bombardment", "heavy_armor"], weaponRangeKm: { pointBlank: 2.0, effective: 25.0, max: 38.0 } },
      description: "Fire support and fleet engagement — Iowa, Bismarck, Yamato",
    },
    {
      templateId: "ww2_aircraft_carrier",
      name: "Aircraft Carrier",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["carrier_air", "air_superiority"], weaponRangeKm: { pointBlank: 0, effective: 50.0, max: 150.0 } },
      description: "Power projection via carrier strike groups — Essex, Illustrious, Shokaku",
    },
    {
      templateId: "ww2_escort_carrier",
      name: "Escort Carrier",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["carrier_air", "asw"], weaponRangeKm: { pointBlank: 0, effective: 30.0, max: 80.0 } },
      description: "Jeep carriers — convoy ASW and close air support for landings",
    },
    {
      templateId: "ww2_cruiser",
      name: "Heavy / Light Cruiser",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["shore_bombardment"], weaponRangeKm: { pointBlank: 2.0, effective: 15.0, max: 25.0 } },
      description: "Surface action, shore bombardment, escort — multi-role warships",
    },
    {
      templateId: "ww2_destroyer",
      name: "Destroyer / Escort",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["asw", "torpedo"], weaponRangeKm: { pointBlank: 1.0, effective: 8.0, max: 15.0 } },
      description: "ASW, screening, torpedo attack — the fleet's workhorses",
    },
    {
      templateId: "ww2_submarine",
      name: "Submarine",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["submarine", "torpedo"], weaponRangeKm: { pointBlank: 0.5, effective: 3.0, max: 8.0 } },
      description: "Commerce raiding, wolfpack tactics — U-boats, Gato-class",
    },
    {
      templateId: "ww2_pt_boat",
      name: "PT Boat / Motor Torpedo Boat",
      baseType: "naval",
      scaleRange: [3, 5],
      defaults: { movementType: "naval", specialCapabilities: ["torpedo", "fast_attack"], weaponRangeKm: { pointBlank: 0.2, effective: 2.0, max: 5.0 } },
      description: "Fast attack craft — night raids, coastal interdiction",
    },
    {
      templateId: "ww2_landing_craft",
      name: "Landing Craft (LST/LCVP)",
      baseType: "naval",
      scaleRange: [3, 5],
      defaults: { movementType: "amphibious", specialCapabilities: ["amphibious_assault"], weaponRangeKm: { pointBlank: 0, effective: 0, max: 0.5 } },
      description: "Amphibious assault — beach landings, vehicle delivery",
    },
    {
      templateId: "ww2_mine_warfare",
      name: "Mine Warfare Vessel",
      baseType: "naval",
      scaleRange: [3, 5],
      defaults: { movementType: "naval", specialCapabilities: ["mine_warfare"], weaponRangeKm: { pointBlank: 0, effective: 0, max: 0.5 } },
      description: "Mine laying and sweeping — channel control, harbor defense",
    },
    {
      templateId: "ww2_marine_infantry",
      name: "Marine Infantry",
      baseType: "infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "amphibious", specialCapabilities: ["amphibious_assault"], weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Amphibious assault infantry — USMC, Royal Marines, SNLF",
    },
  ],
};

// ── Cold War (1947–1991) ───────────────────────────────────────

const COLD_WAR_ERA = {
  id: "cold_war",
  label: "Cold War (1947–1991)",
  shortLabel: "Cold War",
  echelonLabels: {},
  templates: [
    // ── Ground ──
    {
      templateId: "cw_motorized_rifle",
      name: "Motorized Rifle Infantry",
      baseType: "infantry",
      scaleRange: [1, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Truck-mounted rifle infantry — BTR-mounted Soviet motor rifles, NATO motorized",
    },
    {
      templateId: "cw_mechanized_infantry",
      name: "Mechanized Infantry",
      baseType: "mechanized",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.2, effective: 1.0, max: 3.0 } },
      description: "IFV/APC-mounted infantry — BMP, M113, Marder, Warrior",
    },
    {
      templateId: "cw_main_battle_tank",
      name: "Main Battle Tank",
      baseType: "armor",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.5, effective: 2.0, max: 3.5 } },
      description: "T-72, M60 Patton, Leopard 1, Chieftain — combined arms spearhead",
    },
    {
      templateId: "cw_airborne",
      name: "Airborne Infantry",
      baseType: "parachute_infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["airborne"], weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Parachute forces — VDV, 82nd Airborne, Paras",
    },
    {
      templateId: "cw_air_assault",
      name: "Air Assault Infantry",
      baseType: "infantry",
      scaleRange: [2, 4],
      defaults: { movementType: "air", specialCapabilities: ["air_assault"], weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Helicopter-delivered infantry — 101st Airborne (Air Assault), Soviet air assault brigades",
    },
    {
      templateId: "cw_recon",
      name: "Reconnaissance",
      baseType: "recon",
      scaleRange: [1, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "BRDM, M114, Luchs — screening and forward reconnaissance",
    },
    {
      templateId: "cw_combat_engineer",
      name: "Combat Engineer",
      baseType: "engineer",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["breaching", "bridging"], weaponRangeKm: { pointBlank: 0.05, effective: 0.1, max: 0.5 } },
      description: "Mechanized engineers — bridging, mine clearing, obstacle emplacement",
    },
    {
      templateId: "cw_nbc_defense",
      name: "NBC Defense",
      baseType: "engineer",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["nbc_defense"], weaponRangeKm: { pointBlank: 0, effective: 0, max: 0.3 } },
      description: "Nuclear/biological/chemical defense — decontamination, detection",
    },
    {
      templateId: "cw_light_infantry",
      name: "Light Infantry",
      baseType: "infantry",
      scaleRange: [1, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.05, effective: 0.3, max: 0.6 } },
      description: "Foot-mobile conventional infantry — PAVN, PLA, Jäger, 10th Mountain, light role battalions",
    },
    {
      templateId: "cw_special_operations",
      name: "Special Operations Forces",
      baseType: "recon",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", specialCapabilities: ["deep_reconnaissance", "sabotage", "unconventional_warfare"], weaponRangeKm: { pointBlank: 0.05, effective: 0.3, max: 0.8 } },
      description: "Spetsnaz GRU, Green Berets, SAS, SEALs — behind-the-lines sabotage, UW, deep recon",
    },
    {
      templateId: "cw_guerrilla",
      name: "Guerrilla / Irregular Forces",
      baseType: "infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["ambush", "sabotage", "dispersal"], weaponRangeKm: { pointBlank: 0.05, effective: 0.2, max: 0.5 } },
      description: "Viet Cong, Mujahideen, UNITA, Contras — irregular fighters using ambush, IEDs, local terrain knowledge",
    },
    {
      templateId: "cw_militia",
      name: "Militia / Territorial Defense",
      baseType: "infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["local_knowledge"], weaponRangeKm: { pointBlank: 0.05, effective: 0.2, max: 0.5 } },
      description: "Yugoslav Territorial Defense, Kampfgruppen, Home Guard, Swiss militia — state-organized second-line defense",
    },
    {
      templateId: "cw_anti_tank",
      name: "Anti-Tank (ATGM)",
      baseType: "mechanized",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["anti_armor"], weaponRangeKm: { pointBlank: 0.1, effective: 3.0, max: 4.0 } },
      description: "BRDM-2 AT-5, M901 ITV, Jaguar, Shturm-S — dedicated ATGM tank-killing platforms",
    },

    // ── Artillery & Support ──
    {
      templateId: "cw_sp_artillery",
      name: "Self-Propelled Artillery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 3.0, effective: 15.0, max: 24.0 } },
      description: "M109, 2S3 Akatsiya, AS-90 — mobile divisional fire support",
    },
    {
      templateId: "cw_mlrs",
      name: "Multiple Rocket Launcher",
      baseType: "artillery",
      scaleRange: [3, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["area_fire"], weaponRangeKm: { pointBlank: 5.0, effective: 15.0, max: 20.0 } },
      description: "BM-21 Grad, MLRS — devastating area saturation fires",
    },
    {
      templateId: "cw_shorad",
      name: "SHORAD",
      baseType: "air_defense",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["short_range_ad", "gun_ad", "ir_missile_ad"], weaponRangeKm: { pointBlank: 0.3, effective: 2.5, max: 4.0 } },
      description: "ZSU-23-4 Shilka, M163 VADS, Roland — short-range air defense",
    },
    {
      templateId: "cw_medium_ad",
      name: "Medium-Range Air Defense",
      baseType: "air_defense",
      scaleRange: [3, 6],
      defaults: { movementType: "wheeled", specialCapabilities: ["medium_range_ad", "radar_missile_ad"], weaponRangeKm: { pointBlank: 3.0, effective: 15.0, max: 25.0 } },
      description: "SA-6 Gainful, Hawk, Rapier — area air defense coverage",
    },
    {
      templateId: "cw_towed_artillery",
      name: "Towed Artillery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "towed", weaponRangeKm: { pointBlank: 2.0, effective: 11.0, max: 15.0 } },
      description: "D-30 122mm, M102 105mm, Type 59 130mm — lighter, cheaper but slower to displace than SP guns",
    },
    {
      templateId: "cw_tactical_missile",
      name: "Tactical Ballistic Missile",
      baseType: "artillery",
      scaleRange: [3, 6],
      defaults: { movementType: "wheeled", specialCapabilities: ["ballistic_missile"], weaponRangeKm: { pointBlank: 20.0, effective: 120.0, max: 300.0 } },
      description: "SCUD-B, SS-21 Scarab, Lance, Pershing II — long-range strike, potential WMD delivery",
    },
    {
      templateId: "cw_electronic_warfare",
      name: "Electronic Warfare",
      baseType: "headquarters",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["jamming", "sigint"], weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "EW battalions — comms jamming, SIGINT intercept, direction finding, degrades enemy C2",
    },
    {
      templateId: "cw_headquarters",
      name: "Headquarters",
      baseType: "headquarters",
      scaleRange: [2, 6],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Division, Corps, or Army HQ — command and control",
    },
    {
      templateId: "cw_rear_services",
      name: "Rear Services / Logistics",
      baseType: "logistics",
      scaleRange: [2, 6],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Supply, maintenance, medical — rear area support echelons",
    },

    // ── Air ──
    {
      templateId: "cw_attack_helicopter",
      name: "Attack Helicopter",
      baseType: "attack_helicopter",
      scaleRange: [2, 5],
      defaults: {
        movementType: "helicopter", specialCapabilities: ["anti_armor", "close_air_support"],
        weaponRangeKm: { pointBlank: 0, effective: 5.0, max: 10.0 },
        airProfile: { speed: "slow", maneuverability: 7, weaponsPackage: ["guns", "ir_missiles"], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "Mi-24 Hind, AH-1 Cobra, Gazelle HOT — tank-killing rotary wing",
    },
    {
      templateId: "cw_transport_helicopter",
      name: "Transport Helicopter",
      baseType: "transport",
      scaleRange: [2, 5],
      defaults: {
        movementType: "helicopter", specialCapabilities: ["air_transport", "resupply"], transportCapacity: 2,
        weaponRangeKm: { pointBlank: 0, effective: 0.1, max: 0.3 },
        airProfile: { speed: "slow", maneuverability: 4, weaponsPackage: [], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "Mi-8 Hip, UH-1 Huey, CH-47 Chinook — troop lift, resupply, CASEVAC, door guns only",
    },
    {
      templateId: "cw_cas",
      name: "Close Air Support",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["close_air_support"],
        weaponRangeKm: { pointBlank: 0, effective: 15.0, max: 30.0 },
        airProfile: { speed: "fast", maneuverability: 5, weaponsPackage: ["guns"], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "A-10, Su-25 Frogfoot, Harrier — dedicated ground attack",
    },
    {
      templateId: "cw_fighter",
      name: "Fighter / Interceptor",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority"],
        weaponRangeKm: { pointBlank: 0, effective: 20.0, max: 40.0 },
        airProfile: { speed: "supersonic", maneuverability: 8, weaponsPackage: ["guns", "ir_missiles", "radar_missiles"], defensiveArmament: false, ecm: false, radarEquipped: true },
      },
      description: "F-15, MiG-29, Mirage 2000 — air superiority and interception",
    },
    {
      templateId: "cw_wild_weasel",
      name: "SEAD / Wild Weasel",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["sead_capable", "precision_strike"],
        weaponRangeKm: { pointBlank: 0, effective: 20.0, max: 40.0 },
        airProfile: { speed: "supersonic", maneuverability: 6, weaponsPackage: ["guns", "ir_missiles", "radar_missiles"], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "F-4G Wild Weasel, Tornado ECR — suppression and destruction of enemy air defenses",
    },
    {
      templateId: "cw_ecm_aircraft",
      name: "EW / ECM Aircraft",
      baseType: "air",
      scaleRange: [4, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["jamming", "sigint"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "fast", maneuverability: 3, weaponsPackage: [], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "EA-6B Prowler, EF-111 Raven — electronic warfare, radar jamming, SIGINT",
    },

    // ── Naval ──
    {
      templateId: "cw_naval_task_force",
      name: "Naval Surface Combatant",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["radar", "missile"], weaponRangeKm: { pointBlank: 2.0, effective: 30.0, max: 60.0 } },
      description: "Cruisers, destroyers, frigates — surface warfare and escorts",
    },
    {
      templateId: "cw_submarine",
      name: "Submarine",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["submarine", "torpedo"], weaponRangeKm: { pointBlank: 1.0, effective: 10.0, max: 30.0 } },
      description: "SSN/SSK — anti-shipping, intelligence gathering, SLBM deterrence",
    },
    {
      templateId: "cw_amphibious_ship",
      name: "Amphibious Assault Ship",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["amphibious_assault", "carrier_air"], transportCapacity: 4, weaponRangeKm: { pointBlank: 1.0, effective: 5.0, max: 10.0 } },
      description: "LPH, LPD, LSD — amphibious assault with embarked Marines and helos",
    },
    {
      templateId: "cw_marine_infantry",
      name: "Marine Infantry",
      baseType: "infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "amphibious", specialCapabilities: ["amphibious_assault"], weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "USMC, Royal Marines, Soviet Naval Infantry — amphibious warfare specialists",
    },
  ],
};

// ── Modern / Information Age (1991–Present) ────────────────────

const MODERN_ERA = {
  id: "modern",
  label: "Information Age (1991–Present)",
  shortLabel: "Modern",
  echelonLabels: {},
  templates: [
    // ── Ground ──
    {
      templateId: "mod_light_infantry",
      name: "Light Infantry",
      baseType: "infantry",
      scaleRange: [1, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Dismounted infantry — versatile, deployable, terrain-independent",
    },
    {
      templateId: "mod_mech_infantry",
      name: "Mechanized Infantry",
      baseType: "mechanized",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.2, effective: 1.0, max: 4.0 } },
      description: "Stryker, BTR-80, Piranha — medium-weight wheeled or tracked IFV",
    },
    {
      templateId: "mod_heavy_mech",
      name: "Heavy Mechanized Infantry",
      baseType: "mechanized",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["heavy_armor"], weaponRangeKm: { pointBlank: 0.2, effective: 1.5, max: 5.0 } },
      description: "Bradley, BMP-3, Puma — heavy IFVs with significant organic firepower",
    },
    {
      templateId: "mod_mbt",
      name: "Main Battle Tank",
      baseType: "armor",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 0.5, effective: 3.0, max: 5.0 } },
      description: "M1A2 Abrams, Leopard 2, T-90, Merkava — the arm of decision",
    },
    {
      templateId: "mod_lav",
      name: "Light Armored Vehicle",
      baseType: "armor",
      scaleRange: [2, 4],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0.3, effective: 1.5, max: 3.0 } },
      description: "LAV-25, Fennek, VBL — rapid deployment, screening, urban ops",
    },
    {
      templateId: "mod_airborne",
      name: "Airborne Infantry",
      baseType: "parachute_infantry",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["airborne"], weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "82nd Airborne, VDV, French Paras — strategic rapid response",
    },
    {
      templateId: "mod_air_assault",
      name: "Air Assault Infantry",
      baseType: "infantry",
      scaleRange: [2, 4],
      defaults: { movementType: "air", specialCapabilities: ["air_assault"], weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Helicopter-borne infantry — 101st Airborne, air assault brigades",
    },
    {
      templateId: "mod_sof",
      name: "Special Operations Forces",
      baseType: "special_forces",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 0.4, max: 0.8 } },
      description: "Delta Force, SAS, Spetsnaz, KSK — direct action, special reconnaissance",
    },
    {
      templateId: "mod_recon",
      name: "ISR / Reconnaissance",
      baseType: "recon",
      scaleRange: [1, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["drone_equipped"], weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.8 } },
      description: "Drone-equipped scouts — BRDM-3, Fennek, JLTV with UAS",
    },
    {
      templateId: "mod_combat_engineer",
      name: "Combat Engineer",
      baseType: "engineer",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["breaching", "bridging"], weaponRangeKm: { pointBlank: 0.05, effective: 0.1, max: 0.5 } },
      description: "Mechanized engineers — assault breaching, route clearance, bridging",
    },
    {
      templateId: "mod_cbrn",
      name: "CBRN Defense",
      baseType: "engineer",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["nbc_defense"], weaponRangeKm: { pointBlank: 0, effective: 0, max: 0.3 } },
      description: "Chemical, biological, radiological, nuclear defense and decontamination",
    },

    // ── Artillery & Fire Support ──
    {
      templateId: "mod_sp_artillery",
      name: "Self-Propelled Artillery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", weaponRangeKm: { pointBlank: 4.0, effective: 24.0, max: 40.0 } },
      description: "PzH 2000, M109A7, 2S19 Msta — precision fires with GPS-guided rounds",
    },
    {
      templateId: "mod_mlrs",
      name: "MLRS / HIMARS",
      baseType: "artillery",
      scaleRange: [3, 6],
      defaults: { movementType: "wheeled", specialCapabilities: ["precision_strike", "area_fire"], weaponRangeKm: { pointBlank: 15.0, effective: 45.0, max: 70.0 } },
      description: "M270 MLRS, M142 HIMARS — precision deep fires and area suppression",
    },
    {
      templateId: "mod_mortar",
      name: "Mortar Platoon",
      baseType: "artillery",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.1, effective: 3.0, max: 6.0 } },
      description: "81mm/120mm mortars — organic battalion-level indirect fire",
    },

    // ── Air Defense ──
    {
      templateId: "mod_shorad",
      name: "SHORAD",
      baseType: "air_defense",
      scaleRange: [2, 5],
      defaults: { movementType: "tracked", specialCapabilities: ["short_range_ad", "gun_ad", "ir_missile_ad", "counter_uas"], weaponRangeKm: { pointBlank: 0.3, effective: 4.0, max: 8.0 } },
      description: "Avenger, Tunguska, Gepard — short-range air defense including counter-UAS",
    },
    {
      templateId: "mod_medium_ad",
      name: "Medium-Range Air Defense",
      baseType: "air_defense",
      scaleRange: [3, 6],
      defaults: { movementType: "wheeled", specialCapabilities: ["medium_range_ad", "radar", "radar_missile_ad"], weaponRangeKm: { pointBlank: 3.0, effective: 20.0, max: 40.0 } },
      description: "NASAMS, Buk, Iron Dome — area defense against aircraft and missiles",
    },
    {
      templateId: "mod_long_range_ad",
      name: "Long-Range Air Defense",
      baseType: "air_defense",
      scaleRange: [4, 6],
      defaults: { movementType: "wheeled", specialCapabilities: ["long_range_ad", "radar", "radar_missile_ad"], weaponRangeKm: { pointBlank: 20.0, effective: 100.0, max: 200.0 } },
      description: "Patriot, S-400, SAMP/T — theater-level air and ballistic missile defense",
    },
    {
      templateId: "mod_counter_uas",
      name: "Counter-UAS System",
      baseType: "air_defense",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", specialCapabilities: ["counter_uas", "gun_ad", "jamming"], weaponRangeKm: { pointBlank: 0.1, effective: 2.0, max: 5.0 } },
      description: "Dedicated C-UAS — EW jamming, autocannon, directed energy against drones",
    },

    // ── Command & Support ──
    {
      templateId: "mod_bct_hq",
      name: "BCT / Brigade HQ",
      baseType: "headquarters",
      scaleRange: [3, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Brigade Combat Team headquarters — mission command node",
    },
    {
      templateId: "mod_div_hq",
      name: "Division HQ",
      baseType: "headquarters",
      scaleRange: [4, 6],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Division or Corps headquarters — operational-level command",
    },
    {
      templateId: "mod_forward_support",
      name: "Forward Support Company",
      baseType: "logistics",
      scaleRange: [2, 5],
      defaults: { movementType: "wheeled", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "BSA forward element — fuel, ammo, maintenance, medical at brigade level",
    },

    // ── Aviation ──
    {
      templateId: "mod_attack_aviation",
      name: "Attack Aviation",
      baseType: "attack_helicopter",
      scaleRange: [2, 5],
      defaults: {
        movementType: "helicopter", specialCapabilities: ["anti_armor", "close_air_support"],
        weaponRangeKm: { pointBlank: 0, effective: 8.0, max: 15.0 },
        airProfile: { speed: "slow", maneuverability: 8, weaponsPackage: ["guns", "ir_missiles", "radar_missiles"], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "AH-64 Apache, Ka-52, Tiger — anti-armor and close combat attack",
    },
    {
      templateId: "mod_uas",
      name: "UAS / Drone",
      baseType: "air",
      scaleRange: [1, 5],
      defaults: {
        movementType: "air", specialCapabilities: ["drone_equipped", "precision_strike"],
        weaponRangeKm: { pointBlank: 0, effective: 10.0, max: 20.0 },
        airProfile: { speed: "slow", maneuverability: 3, weaponsPackage: [], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "MQ-9, TB2 Bayraktar, Shahed — ISR, precision strike, loitering munitions",
    },
    {
      templateId: "mod_fighter",
      name: "Multirole Fighter",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority", "precision_strike"],
        weaponRangeKm: { pointBlank: 0, effective: 30.0, max: 60.0 },
        airProfile: { speed: "supersonic", maneuverability: 9, weaponsPackage: ["guns", "ir_missiles", "bvr_missiles"], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "F-35, Su-57, Rafale, Eurofighter — air dominance and deep strike",
    },
    {
      templateId: "mod_ew_aircraft",
      name: "EW Aircraft",
      baseType: "air",
      scaleRange: [4, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["jamming", "sigint", "sead_capable"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "fast", maneuverability: 4, weaponsPackage: [], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "EA-18G Growler — electronic attack, SEAD escort, signals intelligence",
    },
    {
      templateId: "mod_isr_platform",
      name: "ISR Platform",
      baseType: "air",
      scaleRange: [3, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["drone_equipped", "deep_reconnaissance"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "medium", maneuverability: 2, weaponsPackage: [], defensiveArmament: false, ecm: false, radarEquipped: true },
      },
      description: "RQ-4 Global Hawk, E-8 JSTARS — persistent wide-area surveillance and targeting",
    },
    {
      templateId: "mod_standoff_strike",
      name: "Standoff Strike",
      baseType: "air",
      scaleRange: [4, 6],
      defaults: {
        movementType: "air", specialCapabilities: ["precision_strike", "strategic_bombing", "standoff_strike"],
        weaponRangeKm: { pointBlank: 0, effective: 80.0, max: 200.0 },
        airProfile: { speed: "fast", maneuverability: 3, weaponsPackage: ["ir_missiles"], defensiveArmament: false, ecm: true, radarEquipped: true },
      },
      description: "B-1B Lancer, Tu-160 — cruise missile and standoff precision strike",
    },

    // ── Naval ──
    {
      templateId: "mod_surface_combatant",
      name: "Naval Surface Combatant",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["radar", "missile", "asw"], weaponRangeKm: { pointBlank: 2.0, effective: 50.0, max: 130.0 } },
      description: "Destroyers, frigates, corvettes — Arleigh Burke, Type 052D, FREMM",
    },
    {
      templateId: "mod_submarine",
      name: "Submarine",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["submarine", "torpedo", "missile"], weaponRangeKm: { pointBlank: 1.0, effective: 20.0, max: 50.0 } },
      description: "SSN/SSK — Virginia-class, Yasen, Soryu — anti-ship and land attack",
    },
    {
      templateId: "mod_amphibious_group",
      name: "Amphibious Ready Group",
      baseType: "naval",
      scaleRange: [4, 6],
      defaults: { movementType: "naval", specialCapabilities: ["amphibious_assault", "carrier_air"], weaponRangeKm: { pointBlank: 1.0, effective: 10.0, max: 25.0 } },
      description: "LHD/LPD with embarked Marines — Wasp-class, Mistral, Juan Carlos",
    },
  ],
};

// ── WW1 (1914–1918) ──────────────────────────────────────────

const WW1_ERA = {
  id: "ww1",
  label: "World War I (1914–1918)",
  shortLabel: "WW1",
  echelonLabels: {
    battle_group: "Brigade Group",
  },
  templates: [
    // ── Ground ──
    {
      templateId: "ww1_rifle_infantry",
      name: "Rifle Infantry",
      baseType: "infantry",
      scaleRange: [1, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.05, effective: 0.2, max: 0.5 } },
      description: "Bolt-action rifle infantry — the mass of all WW1 armies",
    },
    {
      templateId: "ww1_stormtrooper",
      name: "Stormtrooper / Assault Infantry",
      baseType: "special_forces",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", specialCapabilities: ["infiltration"], weaponRangeKm: { pointBlank: 0.05, effective: 0.15, max: 0.3 } },
      description: "Sturmtruppen, Arditi — elite assault infantry for trench warfare",
    },
    {
      templateId: "ww1_machine_gun",
      name: "Machine Gun Section",
      baseType: "infantry",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", specialCapabilities: ["sustained_fire"], weaponRangeKm: { pointBlank: 0.1, effective: 0.6, max: 1.5 } },
      description: "Vickers, MG 08, Hotchkiss — devastating defensive firepower",
    },
    {
      templateId: "ww1_cavalry",
      name: "Cavalry",
      baseType: "recon",
      scaleRange: [1, 4],
      defaults: { movementType: "foot", specialCapabilities: ["mounted"], weaponRangeKm: { pointBlank: 0.05, effective: 0.2, max: 0.5 } },
      description: "Reconnaissance and exploitation — limited by trench warfare",
    },
    {
      templateId: "ww1_field_artillery",
      name: "Field Artillery Battery",
      baseType: "artillery",
      scaleRange: [2, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 1.0, effective: 5.0, max: 8.0 } },
      description: "75mm, 77mm, 18-pounder — the workhorse of WW1 indirect fire",
    },
    {
      templateId: "ww1_heavy_artillery",
      name: "Heavy Artillery",
      baseType: "artillery",
      scaleRange: [3, 5],
      defaults: { movementType: "foot", specialCapabilities: ["area_fire"], weaponRangeKm: { pointBlank: 3.0, effective: 8.0, max: 14.0 } },
      description: "Howitzers 150mm+, siege guns — trench destruction and counter-battery",
    },
    {
      templateId: "ww1_trench_mortar",
      name: "Trench Mortar",
      baseType: "artillery",
      scaleRange: [1, 3],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0.05, effective: 0.5, max: 1.5 } },
      description: "Stokes mortar, Minenwerfer — short-range trench-to-trench fire",
    },
    {
      templateId: "ww1_engineer",
      name: "Pioneer / Sapper",
      baseType: "engineer",
      scaleRange: [2, 4],
      defaults: { movementType: "foot", specialCapabilities: ["breaching", "fortify"], weaponRangeKm: { pointBlank: 0.05, effective: 0.1, max: 0.3 } },
      description: "Trench construction, mining, wire cutting, tunneling",
    },
    {
      templateId: "ww1_headquarters",
      name: "Headquarters",
      baseType: "headquarters",
      scaleRange: [2, 6],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Division, Corps, or Army HQ — command node (very limited comms by modern standards)",
    },
    {
      templateId: "ww1_logistics",
      name: "Supply Train",
      baseType: "logistics",
      scaleRange: [2, 5],
      defaults: { movementType: "foot", weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 } },
      description: "Horse-drawn and narrow-gauge rail supply — slow, vulnerable, critical",
    },
    {
      templateId: "ww1_tank",
      name: "Tank",
      baseType: "armor",
      scaleRange: [2, 4],
      defaults: { movementType: "tracked", specialCapabilities: ["heavy_armor"], weaponRangeKm: { pointBlank: 0.1, effective: 0.3, max: 0.5 } },
      description: "Mark IV, FT-17, A7V — slow, unreliable, terrifying for defenders (late war only)",
    },

    // ── Air (4) ──
    {
      templateId: "ww1_observation_balloon",
      name: "Observation Balloon",
      baseType: "air",
      scaleRange: [2, 4],
      defaults: {
        movementType: "static", specialCapabilities: ["observation", "tethered"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "slow", maneuverability: 0, weaponsPackage: [], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "Tethered hydrogen balloon — massive observation range, extremely vulnerable to fighters",
    },
    {
      templateId: "ww1_observation_aircraft",
      name: "Observation Aircraft",
      baseType: "air",
      scaleRange: [3, 5],
      defaults: {
        movementType: "air", specialCapabilities: ["observation", "deep_reconnaissance"],
        weaponRangeKm: { pointBlank: 0, effective: 0, max: 0 },
        airProfile: { speed: "slow", maneuverability: 3, weaponsPackage: ["guns"], defensiveArmament: true, ecm: false, radarEquipped: false },
      },
      description: "BE.2, Albatros C-series, SPAD XI — artillery spotting and reconnaissance",
    },
    {
      templateId: "ww1_fighter",
      name: "Fighter",
      baseType: "air",
      scaleRange: [3, 5],
      defaults: {
        movementType: "air", specialCapabilities: ["air_superiority"],
        weaponRangeKm: { pointBlank: 0, effective: 5.0, max: 10.0 },
        airProfile: { speed: "slow", maneuverability: 7, weaponsPackage: ["guns"], defensiveArmament: false, ecm: false, radarEquipped: false },
      },
      description: "Sopwith Camel, Fokker D.VII, SPAD XIII — air combat to deny enemy observation",
    },
    {
      templateId: "ww1_bomber",
      name: "Bomber",
      baseType: "air",
      scaleRange: [4, 5],
      defaults: {
        movementType: "air", specialCapabilities: ["strategic_bombing"],
        weaponRangeKm: { pointBlank: 0, effective: 10.0, max: 25.0 },
        airProfile: { speed: "slow", maneuverability: 2, weaponsPackage: [], defensiveArmament: true, ecm: false, radarEquipped: false },
      },
      description: "Gotha, Handley Page, Caproni — limited strategic bombing (late war only)",
    },

    // ── Air Defense ──
    {
      templateId: "ww1_anti_aircraft",
      name: "Anti-Aircraft Section",
      baseType: "air_defense",
      scaleRange: [2, 5],
      defaults: { movementType: "foot", specialCapabilities: ["gun_ad"], weaponRangeKm: { pointBlank: 0.3, effective: 1.5, max: 3.0 } },
      description: "Adapted field guns on AA mounts — volume of fire creates kill zones over key positions",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// Exports and lookup functions
// ═══════════════════════════════════════════════════════════════

export const ERA_DEFINITIONS = [
  DEFAULT_ERA,
  WW1_ERA,
  WW2_ERA,
  COLD_WAR_ERA,
  MODERN_ERA,
];

export const DEFAULT_ERA_ID = "default";

/** Look up an era by ID. Returns the Default era if not found. */
export function getEraById(eraId) {
  return ERA_DEFINITIONS.find(e => e.id === eraId) || DEFAULT_ERA;
}

/**
 * Get templates for a given era filtered by the current scale tier.
 * Returns only templates whose scaleRange includes the active tier.
 */
export function getTemplatesForScale(eraId, scaleKey) {
  const era = getEraById(eraId);
  const tier = SCALE_TIERS[scaleKey]?.tier || 3;
  return era.templates.filter(t => tier >= t.scaleRange[0] && tier <= t.scaleRange[1]);
}

/** Look up a single template by era and template ID. */
export function getTemplateById(eraId, templateId) {
  const era = getEraById(eraId);
  return era.templates.find(t => t.templateId === templateId) || null;
}

/** Search all eras for a template by ID. Used by save migration when eraId is unknown. */
export function findTemplateAcrossEras(templateId) {
  for (const era of ERA_DEFINITIONS) {
    const tpl = era.templates.find(t => t.templateId === templateId);
    if (tpl) return tpl;
  }
  return null;
}
