// ════════════════════════════════════════════════════════════════
// TEST FIXTURE — Deterministic 12x15 hex grid for automated testing.
// No external API dependencies. Covers 15+ terrain types, 10+ features,
// elevation 0-1200m, and named features.
//
// Layout (rows top to bottom):
//   0-2:  coastal/water zone
//   3-5:  lowland (farmland, open ground, wetland, light urban)
//   6-8:  mid-elevation (forest, dense forest, urban cluster)
//   9-11: highland (forested hills, boreal, jungle)
//  12-14: high altitude (mountain, peak, desert, tundra)
// ════════════════════════════════════════════════════════════════

export function getTestFixture() {
  const cols = 12, rows = 15;
  const cells = {};

  // Fill every cell with a default first, then overwrite interesting ones.
  // This guarantees no missing cells (MapView iterates all col,row pairs).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "open_ground",
        elevation: 50 + r * 20,
        features: [],
        infrastructure: "",
        attributes: [],
        confidence: 0.75,
      };
    }
  }

  // Helper: overwrite a cell with specific data
  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    const cell = cells[`${c},${r}`];
    cell.terrain = terrain;
    cell.elevation = elevation;
    cell.features = features;
    cell.infrastructure = features[0] || "";
    cell.confidence = 0.8;
    if (featureNames) cell.feature_names = featureNames;
  };

  // ── Row 0-2: Coastal / Water ──
  for (let c = 0; c < cols; c++) {
    if (c < 4) set(c, 0, "deep_water", 0);
    else if (c < 7) set(c, 0, "coastal_water", 0, ["shoreline"]);
    else set(c, 0, "open_ground", 5, ["beach"]);
  }
  for (let c = 0; c < cols; c++) {
    if (c < 3) set(c, 1, "deep_water", 0);
    else if (c < 6) set(c, 1, "coastal_water", 1, ["shoreline"]);
    else set(c, 1, "open_ground", 8);
  }
  set(4, 1, "coastal_water", 1, ["port", "shoreline"], { port: "Greyport" });
  for (let c = 0; c < cols; c++) {
    if (c < 2) set(c, 2, "coastal_water", 0);
    else if (c < 4) set(c, 2, "wetland", 3);
    else set(c, 2, "open_ground", 12);
  }
  set(3, 2, "wetland", 2, ["river", "river_crossing"], { river: "Stonebrook" });
  set(9, 2, "lake", 4);
  set(10, 2, "lake", 4);

  // ── Row 3-5: Lowland (farmland, roads, settlement) ──
  for (let c = 0; c < cols; c++) set(c, 3, "farmland", 20 + c * 2);
  set(5, 3, "farmland", 30, ["road", "trail"]);
  set(6, 3, "farmland", 32, ["highway"], { town: "Millfield" });
  set(3, 3, "wetland", 15, ["river"], { river: "Stonebrook" });

  for (let c = 0; c < cols; c++) set(c, 4, "farmland", 35 + c * 2);
  set(5, 4, "light_urban", 42, ["highway", "road", "building", "town"], { town: "Ashbury" });
  set(6, 4, "light_urban", 44, ["highway", "road", "building_sparse"]);
  set(3, 4, "light_veg", 30, ["river", "bridge"], { river: "Stonebrook" });
  set(10, 4, "farmland", 50, ["airfield"], { airfield: "Ashbury Strip" });

  for (let c = 0; c < cols; c++) set(c, 5, "farmland", 50 + c * 3);
  set(4, 5, "open_ground", 55, ["major_road"]);
  set(5, 5, "light_urban", 58, ["major_road", "railway", "building"]);
  set(6, 5, "light_urban", 60, ["railway", "building_sparse"]);
  set(3, 5, "farmland", 48, ["river"], { river: "Stonebrook" });

  // ── Row 6-8: Mid-elevation (forest, urban cluster) ──
  for (let c = 0; c < cols; c++) set(c, 6, "forest", 80 + c * 5);
  set(5, 6, "dense_urban", 92, ["highway", "railway", "building_dense", "town"], { town: "Hexville" });
  set(6, 6, "dense_urban", 95, ["major_road", "railway", "building_dense"]);
  set(7, 6, "light_urban", 100, ["road", "building", "power_plant"]);
  set(3, 6, "forest", 85, ["river", "stream_crossing"], { river: "Stonebrook" });
  set(0, 6, "savanna", 75);
  set(1, 6, "savanna_hills", 78);

  for (let c = 0; c < cols; c++) set(c, 7, "forest", 110 + c * 5);
  set(5, 7, "light_urban", 130, ["road", "building_sparse"]);
  set(6, 7, "forest", 135, ["minor_road", "hedgerow"]);
  set(3, 7, "dense_forest", 120, ["river", "treeline"], { river: "Stonebrook" });
  set(10, 7, "forest", 155, ["military_base"], { military: "Camp Ironwood" });
  set(11, 7, "forest", 160, ["fence"]);
  set(0, 7, "mangrove", 105);

  for (let c = 0; c < cols; c++) set(c, 8, "dense_forest", 150 + c * 6);
  set(3, 8, "forest", 160, ["river"], { river: "Stonebrook" });
  set(5, 8, "forest", 165, ["footpath"]);
  set(8, 8, "dense_forest", 185, ["dam", "river"], { river: "Stonebrook" });
  set(0, 8, "jungle", 145);
  set(1, 8, "jungle_hills", 148);

  // ── Row 9-11: Highland (hills, boreal, varied) ──
  for (let c = 0; c < cols; c++) set(c, 9, "forested_hills", 250 + c * 10);
  set(3, 9, "highland", 280, ["trail", "ridgeline"]);
  set(5, 9, "forested_hills", 300, ["trail"]);
  set(0, 9, "jungle_mountains", 240);
  set(11, 9, "boreal", 360);

  for (let c = 0; c < cols; c++) set(c, 10, "highland", 350 + c * 12);
  set(4, 10, "forested_hills", 400, ["river", "bridge", "trail"], { river: "Stonebrook" });
  set(8, 10, "mountain_forest", 440, ["slope_steep"]);
  set(11, 10, "boreal_hills", 480);
  set(0, 10, "savanna", 340);

  for (let c = 0; c < cols; c++) set(c, 11, "highland", 450 + c * 15);
  set(3, 11, "highland", 490, ["cliffs"]);
  set(7, 11, "mountain_forest", 540, ["slope_steep", "treeline"]);
  set(10, 11, "boreal_mountains", 580);
  set(11, 11, "boreal_mountains", 600);
  set(0, 11, "tundra", 440);
  set(1, 11, "tundra", 455);

  // ── Row 12-14: High altitude (mountain, peak, desert, ice) ──
  for (let c = 0; c < cols; c++) set(c, 12, "mountain", 600 + c * 20);
  set(5, 12, "mountain", 700, ["slope_steep", "saddle"]);
  set(6, 12, "mountain", 720, ["slope_steep"]);
  set(0, 12, "desert", 580);
  set(1, 12, "desert", 600);
  set(11, 12, "ice", 820);

  for (let c = 0; c < cols; c++) set(c, 13, "mountain", 750 + c * 25);
  set(5, 13, "mountain", 870, ["slope_extreme", "ridgeline"]);
  set(6, 13, "peak", 1050, ["slope_extreme"]);
  set(7, 13, "peak", 1200, ["slope_extreme", "elevation_advantage"]);
  set(0, 13, "desert", 720);
  set(11, 13, "ice", 1020);

  for (let c = 0; c < cols; c++) set(c, 14, "mountain", 800 + c * 20);
  set(4, 14, "mountain", 880, ["trail", "rough_terrain"]);
  set(6, 14, "peak", 1100, ["slope_extreme"]);
  set(7, 14, "mountain", 1000, ["slope_steep", "wall"]);
  set(0, 14, "desert", 780);
  set(1, 14, "desert", 800);
  set(10, 14, "ice", 980);
  set(11, 14, "ice", 1000);

  return {
    cols,
    rows,
    cellSizeKm: 1.0,
    widthKm: 12,
    heightKm: 13,
    gridType: "hex",
    center: { lat: 49.5, lng: 6.0 },
    bbox: { south: 49.435, north: 49.565, west: 5.92, east: 6.08 },
    cells,
    labels: {},
    linearPaths: [],
  };
}
