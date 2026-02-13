// ════════════════════════════════════════════════════════════════
// OPEN CONFLICT — Shared Terrain & Feature Color Maps
// Single source of truth — imported by Viewer, SimMap, and Parser
// ════════════════════════════════════════════════════════════════

// Terrain colors (grid cell base color)
export const TC = {
  deep_water: "#1A3A5C", coastal_water: "#2A5A7C", lake: "#2E6B8A", river: "#3478A0",
  wetland: "#3A6B55", open_ground: "#A8B060", light_veg: "#8AA050", farmland: "#B8C468",
  forest: "#2D6B1E", dense_forest: "#1A4A12", highland: "#8A9060", mountain_forest: "#4A6830",
  mountain: "#7A7A6A", peak: "#B0A890", desert: "#D4C090", ice: "#D0E0F0",
  light_urban: "#B0A890", dense_urban: "#8A8070",
};

// Terrain labels
export const TL = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", mountain_forest: "Mtn Forest",
  mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert", ice: "Ice/Glacier",
  light_urban: "Light Urban", dense_urban: "Dense Urban",
};

// Feature colors (overlays on terrain)
export const FC = {
  highway: "#E6A817", major_road: "#D4D4D4", road: "#B0B0B0", minor_road: "#9A9A8A",
  footpath: "#6A6A5A", trail: "#8A8A6A",
  railway: "#E05050", light_rail: "#D07070",
  dam: "#5A8ABF", navigable_waterway: "#3AC4E0", tunnel: "#7070A0",
  port: "#4ABFBF", airfield: "#9090D0", helipad: "#70A070", pipeline: "#A070D0",
  power_plant: "#E0D040",
  military_base: "#BF5050",
  chokepoint: "#FF4040", landing_zone: "#40E080", beach: "#E0D0A0", town: "#E8A040",
  building: "#A08060", parking: "#6A6A7A", tower: "#C07050", wall: "#8A6A5A", fence: "#7A6050",
  cliffs: "#C48060", ridgeline: "#D4A860", treeline: "#88C060",
  slope_steep: "#D49040", slope_extreme: "#D45040",
  building_dense: "#C0A080", building_sparse: "#B0A090",
  hedgerow: "#6AA050", walled: "#8A6A5A", elevation_advantage: "#E0C060",
  bridge: "#C4956E", river_crossing: "#4A9ACF", stream_crossing: "#6ABADF", shoreline: "#6BB8D4",
};

// Feature labels (auto-generated from keys)
export const FL = {};
Object.keys(FC).forEach(k => {
  FL[k] = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
});
FL.navigable_waterway = "Nav. Waterway";

// Feature groups
export const FG = {
  "Roads": ["highway", "major_road", "road", "minor_road", "footpath", "trail"],
  "Rail": ["railway", "light_rail"],
  "Water": ["dam", "navigable_waterway", "tunnel"],
  "Transport": ["port", "airfield", "helipad", "pipeline"],
  "Energy": ["power_plant"],
  "Military": ["military_base"],
  "Strategic": ["chokepoint", "landing_zone", "beach", "town"],
  "Structures": ["building", "parking", "tower", "wall", "fence"],
  "Terrain": ["cliffs", "ridgeline", "treeline", "slope_steep", "slope_extreme", "building_dense", "building_sparse", "hedgerow", "walled", "elevation_advantage"],
};

// Default active features for viewer/parser
export const DEFAULT_FEATURES = ["highway", "major_road", "railway", "military_base", "airfield", "port", "dam", "navigable_waterway", "chokepoint", "landing_zone", "beach", "power_plant", "pipeline", "town", "hedgerow"];

// Actor colors for unit markers in simulation
export const ACTOR_COLORS = ["#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#A855F7", "#EC4899"];
