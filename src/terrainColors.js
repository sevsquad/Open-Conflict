// ════════════════════════════════════════════════════════════════
// OPEN CONFLICT — Shared Terrain & Feature Color Maps
// Single source of truth — imported by Viewer, SimMap, and Parser
// ════════════════════════════════════════════════════════════════

// Terrain colors (grid cell base color)
export const TC = {
  deep_water: "#1E4D7A", coastal_water: "#3A7CA0", lake: "#3580A8", river: "#3478A0",
  wetland: "#4A8B6A", open_ground: "#A8B060", light_veg: "#8AA050", grassland: "#90B848", farmland: "#B8C468",
  forest: "#3D8530", dense_forest: "#2D6620", highland: "#98A068", forested_hills: "#4D7838", mountain_forest: "#5A8040",
  mountain: "#7A7A6A", peak: "#D0C8B0", desert: "#D4C090", ice: "#D0E0F0",
  light_urban: "#C0B89A", dense_urban: "#8A8070",
  // Aggregated urban (FM 90-10 pattern types)
  suburban: "#D0C8A8", urban_commercial: "#B0A890", urban_industrial: "#9A9080", urban_dense_core: "#706860",
  // Fine-grained: Buildings
  bldg_light: "#D8C8A0", bldg_residential: "#C4A880", bldg_commercial: "#A0A0B0", bldg_highrise: "#8888A8",
  bldg_institutional: "#B0A098", bldg_religious: "#C8B8A0", bldg_industrial: "#A0988A", bldg_fortified: "#707060",
  bldg_ruins: "#989080", bldg_station: "#B8A8A0",
  // Fine-grained: Roads & Rail
  motorway: "#D0D0D0", arterial: "#C0C0C0", street: "#B0B0A8", alley: "#989890",
  road_footpath: "#A8A898", rail_track: "#808080", tram_track: "#909088",
  // Fine-grained: Open Paved
  plaza: "#D8D0C0", surface_parking: "#C0C0C8", rail_yard: "#888078",
  // Fine-grained: Open Green
  park: "#90B860", sports_field: "#88C050", cemetery: "#708848", urban_trees: "#509030", allotment: "#88A048",
  // Fine-grained: Urban Water
  canal: "#4888B0", dock: "#3870A0",
  // Fine-grained: Other
  bare_ground: "#C0B890", bridge_deck: "#B8B0A0", ground_embankment: "#A8A078", underpass: "#787070", construction_site: "#B8A878",
  jungle: "#1B6B20", jungle_hills: "#2A7A30", jungle_mountains: "#1A5A1A",
  boreal: "#3A7A50", boreal_hills: "#2A6A40", boreal_mountains: "#1A5A30",
  tundra: "#B8B090", savanna: "#C0B050", savanna_hills: "#A09040",
  mangrove: "#3A7A5A",
};

// Terrain labels
export const TL = {
  deep_water: "Deep Water", coastal_water: "Coastal", lake: "Lake", river: "River",
  wetland: "Wetland", open_ground: "Open Ground", light_veg: "Light Veg", grassland: "Grassland", farmland: "Farmland",
  forest: "Forest", dense_forest: "Dense Forest", highland: "Highland", forested_hills: "Forested Hills", mountain_forest: "Mtn Forest",
  mountain: "Mountain", peak: "Peak/Alpine", desert: "Desert", ice: "Ice/Glacier",
  light_urban: "Light Urban", dense_urban: "Dense Urban",
  suburban: "Suburban", urban_commercial: "Commercial District", urban_industrial: "Industrial Zone", urban_dense_core: "Dense Core",
  bldg_light: "Light Building", bldg_residential: "Residential Bldg", bldg_commercial: "Commercial Bldg", bldg_highrise: "Highrise",
  bldg_institutional: "Institutional", bldg_religious: "Religious Bldg", bldg_industrial: "Industrial Bldg", bldg_fortified: "Fortified Bldg",
  bldg_ruins: "Ruins", bldg_station: "Station",
  motorway: "Motorway", arterial: "Arterial Road", street: "Street", alley: "Alley",
  road_footpath: "Footpath", rail_track: "Rail Track", tram_track: "Tram Track",
  plaza: "Plaza", surface_parking: "Parking Lot", rail_yard: "Rail Yard",
  park: "Park", sports_field: "Sports Field", cemetery: "Cemetery", urban_trees: "Urban Trees", allotment: "Allotment",
  canal: "Canal", dock: "Dock",
  bare_ground: "Bare Ground", bridge_deck: "Bridge", ground_embankment: "Embankment", underpass: "Underpass", construction_site: "Construction",
  jungle: "Jungle", jungle_hills: "Jungle Hills", jungle_mountains: "Jungle Mtns",
  boreal: "Boreal", boreal_hills: "Boreal Hills", boreal_mountains: "Boreal Mtns",
  tundra: "Tundra", savanna: "Savanna", savanna_hills: "Savanna Hills",
  mangrove: "Mangrove",
};

// Feature colors (overlays on terrain)
export const FC = {
  highway: "#E6A817", major_road: "#D4D4D4", road: "#B0B0B0", minor_road: "#9A9A8A",
  footpath: "#6A6A5A", trail: "#8A8A6A",
  railway: "#E05050", light_rail: "#D07070",
  dam: "#5A8ABF", river: "#3AC4E0", tunnel: "#7070A0",
  port: "#4ABFBF", airfield: "#9090D0", helipad: "#70A070", pipeline: "#A070D0",
  power_plant: "#E0D040",
  military_base: "#BF5050",
  beach: "#E0D0A0", town: "#E8A040",
  building: "#A08060", parking: "#6A6A7A", tower: "#C07050", wall: "#8A6A5A", fence: "#7A6050",
  cliffs: "#C48060", ridgeline: "#D4A860", treeline: "#88C060",
  slope_steep: "#D49040", slope_extreme: "#D45040",
  building_dense: "#C0A080", building_sparse: "#B0A090",
  hedgerow: "#6AA050", walled: "#8A6A5A", elevation_advantage: "#E0C060",
  courtyard: "#C8B898", metro_entrance: "#7080B0", fortified_structure: "#606050",
  bridge: "#C4956E", river_crossing: "#4A9ACF", stream_crossing: "#6ABADF", shoreline: "#6BB8D4",
  rough_terrain: "#C0A060",
  saddle: "#B8A870",
};

// Feature labels (auto-generated from keys)
export const FL = {};
Object.keys(FC).forEach(k => {
  FL[k] = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
});
FL.river = "River";

// Feature groups
export const FG = {
  "Roads": ["highway", "major_road", "road", "minor_road", "footpath", "trail"],
  "Rail": ["railway", "light_rail"],
  "Water": ["dam", "river", "tunnel"],
  "Transport": ["port", "airfield", "helipad", "pipeline"],
  "Energy": ["power_plant"],
  "Military": ["military_base"],
  "Strategic": ["beach", "town"],
  "Structures": ["building", "parking", "tower", "wall", "fence", "courtyard", "fortified_structure"],
  "Urban": ["metro_entrance"],
  "Terrain": ["cliffs", "ridgeline", "saddle", "treeline", "slope_steep", "slope_extreme", "building_dense", "building_sparse", "hedgerow", "walled", "elevation_advantage", "rough_terrain"],
};

// Default active features for viewer/parser
export const DEFAULT_FEATURES = ["highway", "major_road", "railway", "military_base", "airfield", "port", "dam", "river", "beach", "power_plant", "pipeline", "town", "hedgerow"];

// Actor colors for unit markers in simulation
export const ACTOR_COLORS = ["#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#A855F7", "#EC4899"];
