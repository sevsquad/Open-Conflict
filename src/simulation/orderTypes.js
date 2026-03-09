// ═══════════════════════════════════════════════════════════════
// ORDER TYPES — Structured per-unit order definitions
// Defines the 10 order buttons + Hold default, which unit types
// can use each, and which movement+action pairs are compatible.
// ═══════════════════════════════════════════════════════════════

// ── Air-capable unit type check ──────────────────────────────
// All unit types that fly — fixed-wing, rotary, transport, UAS.
// Use this everywhere instead of `unit.type === "air"` to ensure
// helicopters and transports get air logistics, flight plans, etc.
const AIR_UNIT_TYPES = new Set(["air", "attack_helicopter", "transport"]);
export function isAirUnit(unit) {
  return AIR_UNIT_TYPES.has(unit?.type);
}
// Subset: only helicopter types (for movement speed, altitude lock, fuel)
const HELICOPTER_TYPES = new Set(["attack_helicopter", "transport"]);
export function isHelicopter(unit) {
  return HELICOPTER_TYPES.has(unit?.type) || unit?.movementType === "helicopter";
}

// ── Order Definitions ──────────────────────────────────────────
// Each order is either a "movement" or "action" slot order.
// A unit gets up to one of each per turn.

export const ORDER_SLOT = {
  MOVEMENT: "movement",
  ACTION: "action",
};

export const ORDER_TYPES = {
  // === Movement slot orders ===
  MOVE: {
    id: "MOVE",
    label: "Move",
    slot: ORDER_SLOT.MOVEMENT,
    requiresTarget: "hex",         // click a destination hex
    description: "Move to a new position",
  },
  WITHDRAW: {
    id: "WITHDRAW",
    label: "Withdraw",
    slot: ORDER_SLOT.MOVEMENT,
    requiresTarget: "hex",         // click a fallback hex
    description: "Fall back to a safer position",
  },

  // === Action slot orders ===
  ATTACK: {
    id: "ATTACK",
    label: "Attack",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex_or_unit", // click enemy unit or hex containing enemy
    description: "Assault an enemy position",
  },
  DEFEND: {
    id: "DEFEND",
    label: "Defend",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: null,          // one click, current position
    description: "Defend current position",
  },
  SUPPORT_FIRE: {
    id: "SUPPORT_FIRE",
    label: "Support Fire",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // click hex to put fire on
    description: "Fire on a position without moving",
  },
  FIRE_MISSION: {
    id: "FIRE_MISSION",
    label: "Fire Mission",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // click target hex
    description: "Artillery fire mission (HE or Smoke)",
    subtypes: ["HE", "SMOKE"],
  },
  DIG_IN: {
    id: "DIG_IN",
    label: "Dig In",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: null,
    description: "Improve entrenchment at current position",
  },
  RECON: {
    id: "RECON",
    label: "Recon",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // click hex to scout
    description: "Scout a location for enemy activity",
  },
  RESUPPLY: {
    id: "RESUPPLY",
    label: "Resupply",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "unit",        // click subordinate unit
    description: "Prioritize resupply to a subordinate unit",
  },
  ENGINEER: {
    id: "ENGINEER",
    label: "Engineer",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",
    description: "Perform engineering task at a location",
    subtypes: ["BRIDGE", "OBSTACLE", "BREACH", "FORTIFY", "DEMOLISH"],
  },

  // === Naval-specific orders ===
  SHORE_BOMBARDMENT: {
    id: "SHORE_BOMBARDMENT",
    label: "Shore Bombard",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // click a land hex within range
    description: "Naval gunfire support against land targets",
  },
  BLOCKADE: {
    id: "BLOCKADE",
    label: "Blockade",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: null,          // blocks sea lanes in area around current position
    description: "Deny enemy naval movement and supply through nearby sea lanes",
  },

  // === Air-specific orders ===
  CAS: {
    id: "CAS",
    label: "CAS",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // click sector center hex (3-5 hex area)
    description: "Close air support — attack enemy units in a sector",
    subtypes: ["DIRECT", "BOMBING", "STANDOFF"],
    requiresAltitude: true,
  },
  AIR_SUPERIORITY: {
    id: "AIR_SUPERIORITY",
    label: "Air Superiority",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // sector center
    description: "Establish air superiority over a sector",
  },
  INTERDICTION: {
    id: "INTERDICTION",
    label: "Interdiction",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // road junction, bridge, supply route
    description: "Interdict enemy supply lines and movement routes",
    requiresAltitude: true,
  },
  SEAD: {
    id: "SEAD",
    label: "SEAD",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "unit",        // click specific AD unit
    description: "Suppress/destroy enemy air defenses",
    requiresAltitude: true,
  },
  STRATEGIC_STRIKE: {
    id: "STRATEGIC_STRIKE",
    label: "Strategic Strike",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // strategic target location
    description: "Strategic bombardment of rear-area targets",
  },
  AIRLIFT: {
    id: "AIRLIFT",
    label: "Airlift",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "unit",        // cargo unit to transport
    description: "Airlift cargo or troops to a destination",
  },
  AIR_RECON: {
    id: "AIR_RECON",
    label: "Air Recon",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "hex",         // area to reconnoiter
    description: "Aerial reconnaissance of an area",
    requiresAltitude: true,
  },
  CAP: {
    id: "CAP",
    label: "CAP",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: null,          // patrol current sector
    description: "Combat air patrol — loiter to intercept enemy air",
  },
  ESCORT: {
    id: "ESCORT",
    label: "Escort",
    slot: ORDER_SLOT.ACTION,
    requiresTarget: "unit",        // friendly air unit to escort
    description: "Escort a friendly air unit on all its sorties this turn",
  },

  // === Transport orders ===
  DISEMBARK: {
    id: "DISEMBARK",
    label: "Disembark",
    slot: ORDER_SLOT.MOVEMENT,
    requiresTarget: null,          // exits at transport's current/final position
    description: "Exit transport at its current or destination hex",
  },

  // === Default (no explicit order given) ===
  HOLD: {
    id: "HOLD",
    label: "Hold",
    slot: null,                    // not a real slot — it's the absence of orders
    requiresTarget: null,
    description: "Maintain current position and posture",
  },
};

// ── Unit Type Validity Matrix ──────────────────────────────────
// Which order buttons show up for each unit type.
// true = primary capability, "reduced" = can do it but less effectively.

const ALL_COMBAT = ["infantry", "mechanized", "armor", "recon", "special_forces", "parachute_infantry", "glider_infantry", "tank_destroyer", "armored_infantry", "mechanized_infantry", "airborne", "anti_tank"];
const ALL_TYPES = ["infantry", "mechanized", "armor", "recon", "artillery", "headquarters", "engineer", "air_defense", "logistics", "special_forces", "air", "naval", "parachute_infantry", "glider_infantry", "tank_destroyer", "armored_infantry", "mechanized_infantry", "attack_helicopter", "airborne", "anti_tank", "transport"];

export const ORDER_VALIDITY = {
  MOVE:         fromList(ALL_TYPES),
  WITHDRAW:     fromList(ALL_TYPES),
  ATTACK:       fromList(["infantry", "mechanized", "armor", "special_forces", "parachute_infantry", "glider_infantry", "armored_infantry", "mechanized_infantry", "airborne"], ["recon", "engineer", "tank_destroyer", "anti_tank"]),
  DEFEND:       fromList(ALL_TYPES),
  SUPPORT_FIRE: fromList(["infantry", "mechanized", "armor", "tank_destroyer", "armored_infantry", "mechanized_infantry", "anti_tank"], ["recon", "parachute_infantry", "glider_infantry", "airborne"]),
  FIRE_MISSION: fromList(["artillery"]),
  DIG_IN:       fromList(["infantry", "mechanized", "artillery", "engineer", "headquarters", "air_defense", "parachute_infantry", "glider_infantry", "armored_infantry", "mechanized_infantry", "airborne", "anti_tank"]),
  RECON:        fromList(["recon"], ALL_COMBAT),   // recon primary, combat units reduced
  RESUPPLY:     fromList(["headquarters", "logistics"]),
  ENGINEER:     fromList(["engineer"]),
  SHORE_BOMBARDMENT: fromList(["naval"]),             // naval-only: fire support to land
  BLOCKADE:          fromList(["naval"]),             // naval-only: deny sea lanes
  // Air-specific order validity
  CAS:              fromList(["air", "attack_helicopter"]),  // air with close_air_support capability (checked at runtime)
  AIR_SUPERIORITY:  fromList(["air"]),                       // air with air_superiority capability
  INTERDICTION:     fromList(["air", "attack_helicopter"]),  // air with close_air_support or precision_strike
  SEAD:             fromList(["air"]),                       // air with precision_strike or sead_capable
  STRATEGIC_STRIKE: fromList(["air"]),                       // air with strategic_bombing or precision_strike
  AIRLIFT:          fromList(["air", "transport"]),          // air with airlift or air_transport
  AIR_RECON:        fromList(["air", "attack_helicopter", "transport"]),  // air (any)
  CAP:              fromList(["air"]),                       // air with air_superiority capability
  ESCORT:           fromList(["air"]),                       // air with air_superiority capability
  DISEMBARK:    fromList(ALL_TYPES),                   // exit transport — movement slot, frees action slot
  HOLD:         fromList(ALL_TYPES),
};

// Helper: build a validity map from primary and reduced-capability lists
function fromList(primary, reduced = []) {
  const map = {};
  for (const t of primary) map[t] = true;
  for (const t of reduced) {
    if (!map[t]) map[t] = "reduced";
  }
  return map;
}

/**
 * Get valid orders for a unit type.
 * Returns array of { orderId, capability } where capability is true or "reduced".
 */
export function getValidOrders(unitType) {
  const result = [];
  for (const [orderId, validTypes] of Object.entries(ORDER_VALIDITY)) {
    const cap = validTypes[unitType];
    if (cap) result.push({ orderId, capability: cap });
  }
  return result;
}

/**
 * Check if a specific order is valid for a unit type.
 * Returns true, "reduced", or false.
 */
export function isOrderValid(orderId, unitType) {
  return ORDER_VALIDITY[orderId]?.[unitType] || false;
}

// ── Movement + Action Compatibility Matrix ─────────────────────
// Which action orders can pair with which movement orders.
// true = compatible, false = incompatible.
// When player clicks an incompatible combo, the conflicting order is replaced.

export const COMPATIBILITY = {
  //                    + MOVE    + WITHDRAW   + DISEMBARK   No Movement
  ATTACK:       { MOVE: true,  WITHDRAW: false, DISEMBARK: true,  NONE: true  },
  DEFEND:       { MOVE: true,  WITHDRAW: true,  DISEMBARK: true,  NONE: true  },
  SUPPORT_FIRE: { MOVE: true,  WITHDRAW: false, DISEMBARK: true,  NONE: true  },
  FIRE_MISSION: { MOVE: false, WITHDRAW: false, DISEMBARK: false, NONE: true  },  // can't call fire from a helicopter
  DIG_IN:       { MOVE: false, WITHDRAW: false, DISEMBARK: true,  NONE: true  },
  RECON:        { MOVE: true,  WITHDRAW: false, DISEMBARK: true,  NONE: true  },
  ENGINEER:     { MOVE: false, WITHDRAW: false, DISEMBARK: false, NONE: true  },
  RESUPPLY:     { MOVE: false, WITHDRAW: false, DISEMBARK: false, NONE: true  },
  SHORE_BOMBARDMENT: { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },  // can fire while repositioning
  BLOCKADE:          { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },  // patrol area while blockading
  // Air orders — MOVE = transit to mission area; WITHDRAW = RTB after abort
  CAS:              { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  AIR_SUPERIORITY:  { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  INTERDICTION:     { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  SEAD:             { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  STRATEGIC_STRIKE: { MOVE: false, WITHDRAW: false, DISEMBARK: false, NONE: true  },  // flies from base, no separate movement
  AIRLIFT:          { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  AIR_RECON:        { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  CAP:              { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
  ESCORT:           { MOVE: true,  WITHDRAW: false, DISEMBARK: false, NONE: true  },
};

/**
 * Check if a movement+action pair is compatible.
 * @param {string|null} movementOrderId - "MOVE", "WITHDRAW", or null
 * @param {string|null} actionOrderId - action order ID or null
 * @returns {boolean}
 */
export function isCompatible(movementOrderId, actionOrderId) {
  if (!actionOrderId) return true;  // no action = always fine
  if (!movementOrderId) {
    // No movement — check the NONE column
    return COMPATIBILITY[actionOrderId]?.NONE !== false;
  }
  return COMPATIBILITY[actionOrderId]?.[movementOrderId] !== false;
}

/**
 * Given a unit's current orders, determine what happens when a new order is selected.
 * Returns { movementOrder, actionOrder, replaced } describing the new state.
 * `replaced` is the order ID that was auto-deselected, or null.
 */
export function resolveOrderConflict(currentMovement, currentAction, newOrderId) {
  // All params are string order IDs (e.g. "MOVE", "ATTACK") or null.
  const newOrder = ORDER_TYPES[newOrderId];
  if (!newOrder) return { movementOrder: currentMovement, actionOrder: currentAction, replaced: null };

  // Toggling off: if clicking the same order that's already selected, deselect it
  if (currentMovement === newOrderId) {
    return { movementOrder: null, actionOrder: currentAction, replaced: null };
  }
  if (currentAction === newOrderId) {
    return { movementOrder: currentMovement, actionOrder: null, replaced: null };
  }

  if (newOrder.slot === ORDER_SLOT.MOVEMENT) {
    // New movement order — check compatibility with existing action
    if (currentAction && !isCompatible(newOrderId, currentAction)) {
      return { movementOrder: newOrderId, actionOrder: null, replaced: currentAction };
    }
    return { movementOrder: newOrderId, actionOrder: currentAction || null, replaced: null };
  }

  if (newOrder.slot === ORDER_SLOT.ACTION) {
    // New action order — check compatibility with existing movement
    if (currentMovement && !isCompatible(currentMovement, newOrderId)) {
      return { movementOrder: null, actionOrder: newOrderId, replaced: currentMovement };
    }
    return { movementOrder: currentMovement || null, actionOrder: newOrderId, replaced: null };
  }

  return { movementOrder: currentMovement, actionOrder: currentAction, replaced: null };
}

// ── Weapon Range Defaults (km) ────────────────────────────────
// Fallback weapon ranges per base type in kilometers.
// Era templates override these via weaponRangeKm in their defaults.
// pointBlank: close-quarters engagement zone (or minimum range for indirect fire)
// effective: reliable engagement range
// max: maximum engagement range (degraded accuracy)

export const WEAPON_RANGE_KM = {
  infantry:           { pointBlank: 0.1, effective: 0.3,  max: 0.8  },
  mechanized:         { pointBlank: 0.2, effective: 0.5,  max: 1.0  },
  armor:              { pointBlank: 0.5, effective: 2.0,  max: 3.0  },
  artillery:          { pointBlank: 2.0, effective: 10.0, max: 15.0 },
  recon:              { pointBlank: 0.1, effective: 0.2,  max: 0.5  },
  engineer:           { pointBlank: 0.05, effective: 0.1, max: 0.5  },
  special_forces:     { pointBlank: 0.1, effective: 0.3,  max: 0.6  },
  air_defense:        { pointBlank: 1.0, effective: 5.0,  max: 10.0 },
  headquarters:       { pointBlank: 0,   effective: 0,    max: 0    },
  logistics:          { pointBlank: 0,   effective: 0,    max: 0    },
  air:                { pointBlank: 0,   effective: 10.0, max: 20.0 },
  naval:              { pointBlank: 1.0, effective: 15.0, max: 30.0 },
  parachute_infantry: { pointBlank: 0.1, effective: 0.3,  max: 0.8  },
  glider_infantry:    { pointBlank: 0.1, effective: 0.3,  max: 0.8  },
  tank_destroyer:     { pointBlank: 0.3, effective: 1.5,  max: 2.5  },
  armored_infantry:   { pointBlank: 0.1, effective: 0.4,  max: 1.0  },
  mechanized_infantry:{ pointBlank: 0.2, effective: 0.5,  max: 1.0  }, // same as mechanized
  attack_helicopter:  { pointBlank: 0,   effective: 5.0,  max: 10.0 }, // rotary CAS platform
  airborne:           { pointBlank: 0.1, effective: 0.3,  max: 0.8  }, // same as parachute_infantry
  anti_tank:          { pointBlank: 0.1, effective: 3.0,  max: 4.0  }, // ATGM platform
  transport:          { pointBlank: 0,   effective: 0.1,  max: 0.3  }, // door guns only
};

// ── Movement Budgets Per Movement Type ─────────────────────────
// Base hex budget per turn (cross-country). Road multiplier applied separately.

export const MOVEMENT_BUDGETS = {
  foot:       3,    // 3-4 hex (8-12km cross-country)
  wheeled:    5,    // 5-6 hex on road, 3-4 cross-country
  tracked:    4,    // 4-5 hex (12-16km cross-country)
  air:        8,    // largely terrain-independent
  helicopter: 10,   // rotary wing — ~10km combat radius per turn
  naval:      6,    // water only
  amphibious: 4,    // can cross water at reduced speed
  static:     0,    // tethered/fixed — observation balloons, etc.
};

// ── Terrain Movement Cost Multipliers ──────────────────────────
// Cost to enter a hex of this terrain type. 1.0 = normal, higher = slower.

export const TERRAIN_COSTS = {
  open_ground:    1.0,
  farmland:       1.0,
  light_veg:      1.0,
  light_urban:    1.2,
  dense_urban:    2.0,
  // Aggregated urban
  suburban:        1.0,
  urban_commercial:1.5,
  urban_industrial:1.3,
  urban_dense_core:2.5,
  // Fine-grained: Buildings
  bldg_light: 2.0, bldg_residential: 2.5, bldg_commercial: 2.0, bldg_highrise: 2.5,
  bldg_institutional: 2.5, bldg_religious: 1.5, bldg_industrial: 1.8, bldg_fortified: 3.0,
  bldg_ruins: 2.5, bldg_station: 2.0,
  // Fine-grained: Roads & Rail
  motorway: 0.7, arterial: 0.8, street: 0.9, alley: 1.2,
  road_footpath: 1.0, rail_track: 1.5, tram_track: 1.2,
  // Fine-grained: Open Paved
  plaza: 0.8, surface_parking: 0.9, rail_yard: 1.8,
  // Fine-grained: Open Green
  park: 1.0, sports_field: 0.9, cemetery: 1.3, urban_trees: 1.5, allotment: 1.3,
  // Fine-grained: Urban Water
  canal: 999, dock: 999,
  // Fine-grained: Other
  bare_ground: 1.0, bridge_deck: 0.8, ground_embankment: 1.5, underpass: 1.0, construction_site: 1.5,
  forest:         1.5,
  dense_forest:   2.0,
  highland:       1.5,
  forested_hills: 1.8,
  mountain_forest:2.0,
  mountain:       2.5,
  peak:           3.0,
  desert:         1.3,
  ice:            1.5,
  wetland:        2.0,
  jungle:         2.0,
  jungle_hills:   2.5,
  jungle_mountains:3.0,
  boreal:         1.5,
  boreal_hills:   1.8,
  boreal_mountains:2.5,
  tundra:         1.5,
  savanna:        1.0,
  savanna_hills:  1.3,
  mangrove:       2.5,
  coastal_water:  999,  // impassable for ground units
  deep_water:     999,
  lake:           999,
};

// ── Naval Terrain Costs ──────────────────────────────────────
// For units with movementType "naval" — water is passable, land is not.

export const NAVAL_TERRAIN_COSTS = {
  deep_water:     1.0,
  coastal_water:  1.0,
  lake:           1.5,   // confined waters
  // Everything not listed here defaults to 999 (impassable for ships)
};

// ── Amphibious Terrain Costs ─────────────────────────────────
// For units with movementType "amphibious" — can traverse both water
// and land, but slower on each than the respective specialist.

export const AMPHIBIOUS_TERRAIN_COSTS = {
  // Water hexes
  deep_water:     1.5,
  coastal_water:  1.2,
  lake:           2.0,
  // Land hexes use TERRAIN_COSTS × 1.5 penalty (computed at runtime)
};

// ── Terrain Defensive Values ───────────────────────────────────
// Base defense label for each terrain type.

export const TERRAIN_DEFENSE = {
  open_ground:    "POOR",
  farmland:       "POOR",
  light_veg:      "POOR",
  light_urban:    "STRONG",
  dense_urban:    "EXCELLENT",
  suburban:        "MODERATE",
  urban_commercial:"STRONG",
  urban_industrial:"MODERATE",
  urban_dense_core:"EXCELLENT",
  bldg_light: "POOR", bldg_residential: "MODERATE", bldg_commercial: "STRONG", bldg_highrise: "STRONG",
  bldg_institutional: "STRONG", bldg_religious: "MODERATE", bldg_industrial: "MODERATE", bldg_fortified: "EXCELLENT",
  bldg_ruins: "MODERATE", bldg_station: "MODERATE",
  motorway: "NONE", arterial: "NONE", street: "NONE", alley: "NONE",
  road_footpath: "NONE", rail_track: "POOR", tram_track: "NONE",
  plaza: "NONE", surface_parking: "NONE", rail_yard: "POOR",
  park: "POOR", sports_field: "NONE", cemetery: "POOR", urban_trees: "MODERATE", allotment: "POOR",
  canal: "NONE", dock: "NONE",
  bare_ground: "NONE", bridge_deck: "NONE", ground_embankment: "MODERATE", underpass: "MODERATE", construction_site: "POOR",
  forest:         "MODERATE",
  dense_forest:   "STRONG",
  highland:       "MODERATE",
  forested_hills: "STRONG",
  mountain_forest:"STRONG",
  mountain:       "EXCELLENT",
  peak:           "EXCELLENT",
  desert:         "POOR",
  ice:            "POOR",
  wetland:        "POOR",
  jungle:         "STRONG",
  jungle_hills:   "STRONG",
  jungle_mountains:"EXCELLENT",
  boreal:         "MODERATE",
  boreal_hills:   "STRONG",
  boreal_mountains:"EXCELLENT",
  tundra:         "POOR",
  savanna:        "POOR",
  savanna_hills:  "MODERATE",
  mangrove:       "MODERATE",
  coastal_water:  "NONE",
  deep_water:     "NONE",
  lake:           "NONE",
};

// ── LOS-Blocking Terrain ───────────────────────────────────────
// "block" = fully blocks LOS, "partial" = degrades LOS

export const LOS_TERRAIN = {
  dense_forest:     "block",
  dense_urban:      "block",
  urban_dense_core: "block",
  jungle:           "block",
  jungle_hills:     "block",
  jungle_mountains: "block",
  // Fine-grained buildings that block LOS
  bldg_residential: "block", bldg_commercial: "block", bldg_highrise: "block",
  bldg_institutional: "block", bldg_religious: "block", bldg_fortified: "block",
  underpass: "block",
  // Partial LOS blockers
  forest:           "partial",
  light_urban:      "partial",
  urban_commercial: "partial",
  mountain_forest:  "partial",
  boreal:           "partial",
  mangrove:         "partial",
  bldg_light: "partial", bldg_industrial: "partial", bldg_ruins: "partial",
  bldg_station: "partial", urban_trees: "partial", ground_embankment: "partial",
};

// ── Echelon Combat Weights ─────────────────────────────────────
// Used in force ratio calculations. Bigger echelons = more combat power.

export const ECHELON_WEIGHTS = {
  fireteam:          0.25,
  squad:             0.5,
  weapons_team:      0.5,
  sniper_team:       0.25,
  platoon:           1,
  company:           1,
  mortar_section:    0.5,
  anti_tank_team:    0.5,
  forward_observer:  0.25,
  battalion:         3,
  battle_group:      3,
  brigade:           9,
  artillery_battery: 2,
  engineer_company:  1,
  division:          27,
  corps_asset:       3,
  aviation_brigade:  9,
  corps:             81,
  army:              243,
  air_force_wing:    27,
  naval_task_force:  27,
  army_group:        729,
  national_forces:   2187,
  coalition_command:  2187,
};

// ── Transport Compatibility ──────────────────────────────────
// Which movement types a transport capability can carry.
// air_transport (helicopters): foot-mobile units only
// amphibious_assault (ships): broader range including vehicles

const AIR_TRANSPORTABLE = new Set(["foot"]);
const NAVAL_TRANSPORTABLE = new Set(["foot", "wheeled", "tracked", "amphibious"]);

/**
 * Check if a unit can be loaded into a transport.
 * @param {Object} cargoUnit - the unit to embark
 * @param {Object} transportUnit - the transport to load into
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canEmbark(cargoUnit, transportUnit) {
  const caps = transportUnit.specialCapabilities || [];
  const cargoMovType = cargoUnit.movementType || "foot";

  // Must have a transport capability
  const isAirTransport = caps.includes("air_transport");
  const isNavalTransport = caps.includes("amphibious_assault");
  if (!isAirTransport && !isNavalTransport) {
    return { allowed: false, reason: "Unit has no transport capability" };
  }

  // Can't transport other air units or transports
  if (cargoUnit.movementType === "air" || cargoUnit.movementType === "helicopter" || cargoUnit.movementType === "naval") {
    return { allowed: false, reason: "Cannot transport air or naval units" };
  }

  // Check movement type compatibility
  if (isAirTransport && !AIR_TRANSPORTABLE.has(cargoMovType)) {
    return { allowed: false, reason: "Air transport can only carry foot-mobile units" };
  }
  if (isNavalTransport && !NAVAL_TRANSPORTABLE.has(cargoMovType)) {
    return { allowed: false, reason: "Cannot transport this movement type by sea" };
  }

  // Check capacity
  const cargo = transportUnit.cargo || [];
  const capacity = transportUnit.transportCapacity || 0;
  if (cargo.length >= capacity) {
    return { allowed: false, reason: "Transport is at full capacity" };
  }

  // Can't embark if already embarked
  if (cargoUnit.embarkedIn) {
    return { allowed: false, reason: "Unit is already embarked" };
  }

  return { allowed: true };
}
