// ═══════════════════════════════════════════════════════════════
// DETECTION RANGES — Physical-range data tables for the FOW engine.
// All visual ranges in KILOMETERS, converted to hexes via cellSizeKm.
// Three-tier model: Identified / Contact / Undetected.
// ═══════════════════════════════════════════════════════════════


// ── Observer Visual Range (km) ───────────────────────────────
// Base IDENTIFICATION range in ideal conditions (clear, daytime, flat).
// This is how far this unit type can positively identify a standard
// vehicle-sized target. Contact range = id_range × CONTACT_RANGE_MULT.

export const OBSERVER_VISUAL_KM = {
  infantry:           5,    // Standard binoculars
  mechanized:         8,    // Vehicle optics
  armor:              10,   // Thermal sights, stabilized optics
  recon:              12,   // Best optics available, trained observers
  special_forces:     8,    // Good optics, excellent fieldcraft
  artillery:          3,    // Basic observation (FO would be separate)
  engineer:           5,    // Standard binoculars
  air_defense:        8,    // Optics suite, radar (visual only in V1)
  headquarters:       5,    // Standard binoculars
  logistics:          3,    // Minimal observation equipment
  air:                30,   // Altitude advantage, aircraft sensors
  naval:              20,   // Elevated bridge + optics
  parachute_infantry: 5,    // Standard binoculars
  glider_infantry:    5,    // Standard binoculars
  tank_destroyer:     10,   // Good optics, hull-down observation doctrine
  armored_infantry:   8,    // Vehicle optics
};

export const DEFAULT_OBSERVER_VISUAL_KM = 5;


// ── Target Size Modifier ─────────────────────────────────────
// Multiplier on the OBSERVER's identification range when looking at
// this target type. Bigger/louder targets are visible from further away.
// Example: infantry observer (5km) looking at armor (×1.5) = 7.5km id range.

export const TARGET_SIZE_MOD = {
  infantry:           0.5,  // Small, dispersed foot soldiers
  mechanized:         1.2,  // Medium vehicles, dust/noise
  armor:              1.5,  // Large, loud, thermal signature
  recon:              0.3,  // Deliberately small signature
  special_forces:     0.2,  // Trained concealment, minimal profile
  artillery:          1.0,  // Medium when stationary; action boost when firing
  engineer:           0.8,  // Equipment visible
  air_defense:        1.0,  // Vehicles + radar dishes
  headquarters:       0.8,  // Vehicles + antenna arrays
  logistics:          1.2,  // Convoys are visible
  air:                1.5,  // Large, altitude-visible
  naval:              2.0,  // Very large targets
  parachute_infantry: 0.5,  // Same as infantry
  glider_infantry:    0.5,  // Same as infantry
  tank_destroyer:     1.0,  // Medium vehicle, lower profile than tank
  armored_infantry:   1.0,  // Medium vehicles
};

export const DEFAULT_TARGET_SIZE_MOD = 0.8;


// ── Contact Range Multiplier ─────────────────────────────────
// Detection range (for Contact tier) = identification range × this.
// Contact means "something is there" but you can't tell what.
export const CONTACT_RANGE_MULT = 1.75;


// ── Canopy/Structure Height (meters) ─────────────────────────
// For "look over" LOS logic. An observer above this height can
// see OVER an intervening hex of this terrain to what's beyond,
// but NOT into that hex to see units hiding there.

export const CANOPY_HEIGHT = {
  forest:           20,
  dense_forest:     25,
  light_urban:      10,
  dense_urban:      20,
  // Aggregated urban
  suburban:          8,
  urban_commercial: 15,
  urban_industrial: 12,
  urban_dense_core: 25,
  // Fine-grained: Buildings (structure height for "look over" LOS)
  bldg_light: 6, bldg_residential: 12, bldg_commercial: 18, bldg_highrise: 35,
  bldg_institutional: 15, bldg_religious: 20, bldg_industrial: 10, bldg_fortified: 5,
  bldg_ruins: 4, bldg_station: 12,
  // Fine-grained: Other tall elements
  urban_trees: 15, ground_embankment: 4, underpass: 5,
  jungle:           30,
  jungle_hills:     25,
  jungle_mountains: 20,
  mountain_forest:  20,
  boreal:           15,
  mangrove:         8,
};


// ── Atmospheric Visibility Cap (km) ──────────────────────────
// Hard ceiling on visual range regardless of equipment or elevation.
// Even with the best optics, you can't see through fog.

export const ATMOSPHERIC_CAP = {
  clear:    30,
  overcast: 20,
  rain:     8,
  storm:    3,
  snow:     5,
  fog:      1,
};

export const DEFAULT_ATMOSPHERIC_CAP = 30;


// ── Weather Range Modifier ───────────────────────────────────
// Multiplier on identification RANGE (not probability).
// Reduces how far you can identify targets in bad weather.

export const WEATHER_RANGE_MOD = {
  clear:    1.0,
  overcast: 0.85,
  rain:     0.5,
  storm:    0.25,
  snow:     0.6,
  fog:      0.15,
};


// ── Time-of-Day Range Modifier ───────────────────────────────
// Multiplier on identification range based on light conditions.

export const TIME_RANGE_MOD = {
  dawn:      0.5,
  morning:   1.0,
  afternoon: 1.0,
  dusk:      0.5,
  night:     0.15,
};


// ── Posture Range Modifier ───────────────────────────────────
// Multiplier on identification range affecting the TARGET.
// Moving/attacking units are easier to spot from further away;
// dug-in units are much harder.

export const POSTURE_RANGE_MOD = {
  attacking:   1.4,
  moving:      1.2,
  ready:       0.85,
  defending:   0.7,
  dug_in:      0.35,
  retreating:  1.3,
  reserve:     0.45,
  routing:     1.5,   // Panicked, disorganized movement is very visible
};


// ── Posture Concealment Modifier ────────────────────────────
// Multiplier on detection PROBABILITY based on target posture.
// Applied at the probability stage alongside TERRAIN_CONCEALMENT.
// Separate from POSTURE_RANGE_MOD (which affects detection range).
// Dug-in fieldworks offset open-terrain exposure; panicked troops
// lose concealment discipline even in good terrain.

export const POSTURE_CONCEALMENT = {
  dug_in:      0.75,  // Fieldworks + camo nets (1.3 × 0.75 = 0.975 in open ground)
  defending:   0.85,  // Prepared positions
  reserve:     0.9,   // Stationary, some discipline
  ready:       1.0,   // Neutral
  moving:      1.0,   // No concealment effort
  attacking:   1.1,   // Actively exposing
  retreating:  1.1,   // Disorganized
  routing:     1.2,   // Panicked, zero discipline
};


// ── Terrain Concealment ──────────────────────────────────────
// Multiplier on detection PROBABILITY when the target occupies
// this terrain. Applied AFTER range check passes. Lower = harder
// to detect even when you're looking right at the hex. Values
// above 1.0 mean actively exposed — open terrain with no cover.

export const TERRAIN_CONCEALMENT = {
  open_ground:      1.3,   // Nothing to hide behind
  grassland:        1.1,   // Low grass, minimal concealment
  farmland:         1.1,   // Low crops, sparse hedgerows
  light_veg:        1.1,   // Scrubland, scattered brush
  light_urban:      0.5,
  dense_urban:      0.3,
  suburban:         0.7,
  urban_commercial: 0.4,
  urban_industrial: 0.6,
  urban_dense_core: 0.2,
  // Fine-grained: Buildings
  bldg_light: 0.5, bldg_residential: 0.3, bldg_commercial: 0.3, bldg_highrise: 0.25,
  bldg_institutional: 0.3, bldg_religious: 0.4, bldg_industrial: 0.5, bldg_fortified: 0.2,
  bldg_ruins: 0.3, bldg_station: 0.4,
  // Fine-grained: Roads (exposed)
  motorway: 1.3, arterial: 1.2, street: 1.0, alley: 0.7,
  road_footpath: 0.9, rail_track: 1.0, tram_track: 1.0,
  // Fine-grained: Open Paved
  plaza: 1.3, surface_parking: 1.1, rail_yard: 0.8,
  // Fine-grained: Open Green
  park: 0.8, sports_field: 1.2, cemetery: 0.7, urban_trees: 0.4, allotment: 0.6,
  // Fine-grained: Urban Water
  canal: 1.0, dock: 1.0,
  // Fine-grained: Other
  bare_ground: 1.2, bridge_deck: 1.2, ground_embankment: 0.6, underpass: 0.3, construction_site: 0.8,
  forest:           0.4,
  dense_forest:     0.2,
  highland:         0.7,
  forested_hills:   0.35,
  mountain_forest:  0.3,
  mountain:         0.6,
  peak:             0.5,
  desert:           1.2,   // Flat, dusty, high contrast
  ice:              1.2,   // Flat, high visual contrast
  wetland:          0.6,
  jungle:           0.2,
  jungle_hills:     0.2,
  jungle_mountains: 0.15,
  boreal:           0.4,
  boreal_hills:     0.35,
  boreal_mountains: 0.3,
  tundra:           0.95,  // Low scrub, marginally exposed
  savanna:          0.95,  // Scattered trees, borderline
  savanna_hills:    0.7,
  mangrove:         0.3,
  coastal_water:    1.0,
  deep_water:       1.0,
  lake:             1.0,
};


// ── Detection-by-Action Modifiers ────────────────────────────
// Additive boost to target size mod for units that performed
// these actions THIS turn. Firing creates muzzle flash, dust,
// sound; movement creates engine noise and dust plumes.

export const ACTION_SIZE_BOOST = {
  FIRE_MISSION:  2.0,   // Muzzle flash, dust, sustained fire signature
  ATTACK:        1.5,   // Gunfire, explosions, movement
  SUPPORT_FIRE:  1.0,   // Sustained fire position
  MOVE:          0.5,   // Generic movement (foot/wheeled/tracked averaged)
  ADVANCE:       0.6,   // Cautious forward movement
  RECON:         0.1,   // Careful, trained movement
  DIG_IN:        0.3,   // Digging noise, earth disturbance
  DEFEND:        0.0,   // No additional signature
  HOLD:          0.0,   // No additional signature
  WITHDRAW:      0.8,   // Rapid rearward movement
  RETREAT:       0.8,   // Disorganized rearward movement
};

// Movement-type-specific boost (overrides generic MOVE when known)
export const MOVEMENT_TYPE_BOOST = {
  tracked:  0.8,  // Heavy engine noise, visible dust/tracks
  wheeled:  0.6,  // Engine noise, road dust
  foot:     0.2,  // Minimal signature
};


// ── Skyline Silhouette Boost ────────────────────────────────
// Additive boost to target size mod when the target is silhouetted
// on a crest — higher elevation than the 3 hexes behind it from
// the observer's perspective. Makes ridgeline defenders easier to spot.
// Real-world defenders use the military crest (just below the
// topographic crest) specifically to avoid this effect.

export const SKYLINE_SILHOUETTE_BOOST = 0.3;


// ── Surprise Combat Modifiers ────────────────────────────────
// When surprise contacts occur during movement simulation, these
// modify combat effectiveness. Injected into the LLM prompt to
// constrain adjudication outcomes.

export const SURPRISE_MODIFIERS = {
  attacker_surprised:  { effectiveness: 0.5, label: "Ambushed — disorganized, reacting" },
  defender_surprised:  { effectiveness: 0.7, label: "Caught off guard — scrambling to respond" },
  mutual_surprise:     { effectiveness: 0.8, label: "Meeting engagement — both sides disorganized" },
  no_surprise:         { effectiveness: 1.0, label: "Normal engagement" },
};


// ── Close-Range Detection Floors ─────────────────────────────
// Minimum detection probability at very close range, regardless of
// concealment/posture. You can't hide a tank 500m away in an open field.

export const CLOSE_RANGE_FLOORS = {
  0: 1.0,   // Same hex: guaranteed detection
  1: 0.6,   // Adjacent hex: very likely
  2: 0.35,  // 2 hexes: moderate floor
};


// ── Last-Known Intel Degradation ─────────────────────────────
// How many turns before last-known intel degrades or expires.

export const INTEL_DEGRADATION = {
  STALE_AFTER: 3,    // turns before "stale" label appears
  EXPIRE_AFTER: 6,   // turns before last-known entry is removed entirely
};


// ── RECON Bonus ──────────────────────────────────────────────
// Multiplier on visual range when a unit has a RECON order
// toward a specific target hex. Applied in the direction of
// the recon target only.

export const RECON_RANGE_BONUS_KM = 4;  // extra km in recon direction


// ── Special Capability Detection Modifiers ───────────────────
// Units with these entries in their specialCapabilities array get
// detection modifiers. Applied multiplicatively to observer range
// or target size during evaluateDetection().

export const SPECIAL_CAPABILITY_DETECTION_MODS = {
  // Submarines are nearly invisible when submerged — periscope-only view
  submarine:    { targetSizeMod: 0.1,  observerRangeMod: 0.4 },
  // Radar-equipped surface ships detect at extended range
  radar:        { targetSizeMod: null, observerRangeMod: 1.5 },
  // Drone-equipped units have better ISR reach
  drone_equipped: { targetSizeMod: null, observerRangeMod: 1.3 },
};
