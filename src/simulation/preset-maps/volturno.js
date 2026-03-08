// Volturno River Crossing — US 3rd Infantry Division assault, October 1943
// 18x20 hex grid, 500m cells, elevation 25-380m
// US forces stage on south bank (rows 12-17), Germans defend north bank and Triflisco Ridge (rows 0-8)
// Volturno River runs east-west at rows 9-10 with a hairpin loop at cols 7-8

export function generateVolturnoMap() {
  const cols = 18, rows = 20;
  const cellSizeKm = 0.5;
  const cells = {};

  // Fill default — everything starts as open_ground at moderate elevation
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "open_ground",
        elevation: 50,
        features: [],
        feature_names: null,
      };
    }
  }

  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    cells[`${c},${r}`] = { terrain, elevation, features, feature_names: featureNames };
  };

  // Helper for river cells
  const river = (c, r, elev) => {
    set(c, r, "river", elev, ["river"], { river: "Volturno River" });
  };

  // =========================================================================
  // Row 0 — Triflisco Ridge crest, German rear area (280-380m)
  // Rocky crests with forest in saddles between peaks
  // =========================================================================
  set(0,  0, "forest",      295, []);
  set(1,  0, "forest",      310, []);
  set(2,  0, "highland",    330, []);
  set(3,  0, "highland",    345, ["ridgeline"]);
  set(4,  0, "forest",      320, []);
  set(5,  0, "highland",    350, ["ridgeline"]);
  set(6,  0, "forest",      315, []);              // 6,1 arty access
  set(7,  0, "highland",    340, []);
  set(8,  0, "forest",      325, []);
  set(9,  0, "highland",    355, ["ridgeline"]);
  set(10, 0, "forest",      330, []);               // 10,1 arty access
  set(11, 0, "highland",    360, ["ridgeline"]);
  set(12, 0, "forest",      335, []);
  set(13, 0, "highland",    350, []);
  set(14, 0, "forest",      310, []);
  set(15, 0, "highland",    340, ["ridgeline"]);
  set(16, 0, "forest",      305, []);
  set(17, 0, "forest",      290, []);

  // =========================================================================
  // Row 1 — Ridge rear slopes, German artillery positions (300-370m)
  // 6,1 and 10,1 are German arty emplacements behind the ridge
  // =========================================================================
  set(0,  1, "forest",      290, []);
  set(1,  1, "forest",      305, []);
  set(2,  1, "highland",    325, []);
  set(3,  1, "highland",    340, ["ridgeline"]);
  set(4,  1, "forest",      315, []);
  set(5,  1, "highland",    345, ["ridgeline"]);
  set(6,  1, "light_veg",   310, ["road"],         { road: "Ridge supply road" });  // German arty pos
  set(7,  1, "highland",    335, []);
  set(8,  1, "forest",      320, []);
  set(9,  1, "highland",    350, ["ridgeline"],  { ridgeline: "Triflisco Ridge" });
  set(10, 1, "light_veg",   325, ["road"],         { road: "Ridge supply road" });  // German arty pos
  set(11, 1, "highland",    365, ["ridgeline"]);    // Monte Majulo slopes
  set(12, 1, "forest",      340, []);
  set(13, 1, "highland",    345, []);
  set(14, 1, "forest",      305, []);
  set(15, 1, "highland",    335, []);
  set(16, 1, "forest",      300, []);
  set(17, 1, "forest",      285, []);

  // =========================================================================
  // Row 2 — Ridge crest zone, German HQ at 8,2 (310-370m)
  // 8,2: HQ tucked behind reverse slope in shrubland
  // 7,2: StuG platoon position concealed in forest
  // =========================================================================
  set(0,  2, "forest",      285, []);
  set(1,  2, "forest",      300, []);
  set(2,  2, "highland",    320, []);
  set(3,  2, "forest",      330, []);
  set(4,  2, "highland",    335, []);
  set(5,  2, "light_veg",   315, ["road"]);          // road north-south through col 5
  set(6,  2, "forest",      305, []);
  set(7,  2, "forest",      325, []);                 // StuG concealed in trees
  set(8,  2, "light_veg",   320, ["road"]);           // German HQ, road through col 9 area
  set(9,  2, "highland",    345, ["ridgeline"]);
  set(10, 2, "forest",      330, []);
  set(11, 2, "highland",    380, ["ridgeline"],  { ridgeline: "Monte Majulo (Hill 502)" });
  set(12, 2, "forest",      345, []);
  set(13, 2, "highland",    340, []);
  set(14, 2, "forest",      300, []);
  set(15, 2, "forest",      310, []);
  set(16, 2, "forest",      295, []);
  set(17, 2, "forest",      280, []);

  // =========================================================================
  // Row 3 — Upper forward slope, steep descent begins (280-350m)
  // 11,3: bare rocky position on Monte Majulo (Hill 502)
  // 8,3: PzGren reserve in forest
  // =========================================================================
  set(0,  3, "forest",      275, []);
  set(1,  3, "forest",      290, []);
  set(2,  3, "forest",      300, []);
  set(3,  3, "highland",    310, []);
  set(4,  3, "forest",      305, []);
  set(5,  3, "light_veg",   290, ["road"]);          // secondary road col 5
  set(6,  3, "forest",      285, []);
  set(7,  3, "forest",      300, []);
  set(8,  3, "forest",      295, ["road"]);           // PzGren reserve, main road col 9 area
  set(9,  3, "highland",    320, []);
  set(10, 3, "forest",      310, []);
  set(11, 3, "highland",    350, ["ridgeline"]);      // Monte Majulo summit — exposed rocky crest
  set(12, 3, "forest",      325, []);
  set(13, 3, "highland",    315, []);
  set(14, 3, "forest",      285, []);
  set(15, 3, "forest",      295, []);
  set(16, 3, "forest",      280, []);
  set(17, 3, "forest",      265, []);

  // =========================================================================
  // Row 4 — German forward positions, reverse slopes (230-300m)
  // 4,4: forest position on ridge west flank
  // 9,4: FO on crest with excellent observation
  // Terrain drops steeply toward the river from here
  // =========================================================================
  set(0,  4, "forest",      250, []);
  set(1,  4, "forest",      265, []);
  set(2,  4, "light_veg",   275, []);
  set(3,  4, "forest",      285, []);
  set(4,  4, "forest",      290, ["slope_steep"]);    // ridge west position
  set(5,  4, "light_veg",   260, ["road"]);           // secondary road
  set(6,  4, "forest",      255, []);
  set(7,  4, "light_veg",   270, []);
  set(8,  4, "forest",      265, []);
  set(9,  4, "light_veg",   290, ["road"]);           // FO on crest, main road
  set(10, 4, "forest",      280, []);
  set(11, 4, "highland",    300, ["slope_steep"]);
  set(12, 4, "forest",      275, []);
  set(13, 4, "light_veg",   260, []);
  set(14, 4, "forest",      250, []);
  set(15, 4, "forest",      265, []);
  set(16, 4, "forest",      255, []);
  set(17, 4, "forest",      240, []);

  // =========================================================================
  // Row 5 — Mid-slope, German AT and defensive positions (180-265m)
  // 7,5: AT position in gap between ridges
  // Olive groves (farmland) appear on lower slopes
  // =========================================================================
  set(0,  5, "forest",      215, []);
  set(1,  5, "farmland",    220, []);                  // olive terraces
  set(2,  5, "light_veg",   230, []);
  set(3,  5, "forest",      245, []);
  set(4,  5, "forest",      250, ["slope_steep"]);
  set(5,  5, "farmland",    225, ["road"]);            // secondary road through olive groves
  set(6,  5, "light_veg",   235, []);
  set(7,  5, "light_veg",   260, []);                  // AT position in gap
  set(8,  5, "forest",      240, []);
  set(9,  5, "light_veg",   250, ["road"]);            // main road descending
  set(10, 5, "forest",      245, []);
  set(11, 5, "highland",    265, ["slope_steep"]);
  set(12, 5, "forest",      240, []);
  set(13, 5, "farmland",    220, []);                  // olive groves
  set(14, 5, "light_veg",   210, []);
  set(15, 5, "forest",      225, []);
  set(16, 5, "farmland",    215, []);
  set(17, 5, "forest",      200, []);

  // =========================================================================
  // Row 6 — Lower slopes approaching flood plain (120-210m)
  // 9,6: mortar position on last piece of high ground before river flat
  // Terrain transitions from wooded slopes to open farmland
  // =========================================================================
  set(0,  6, "farmland",    155, []);
  set(1,  6, "light_veg",   165, []);
  set(2,  6, "forest",      180, []);
  set(3,  6, "light_veg",   190, []);
  set(4,  6, "forest",      195, ["slope_steep"]);
  set(5,  6, "farmland",    170, ["road"]);
  set(6,  6, "light_veg",   185, []);
  set(7,  6, "forest",      195, []);
  set(8,  6, "light_veg",   180, []);
  set(9,  6, "open_ground", 200, ["road"]);            // mortar position
  set(10, 6, "forest",      190, []);
  set(11, 6, "highland",    210, []);
  set(12, 6, "forest",      185, []);
  set(13, 6, "farmland",    160, []);
  set(14, 6, "light_veg",   145, []);
  set(15, 6, "farmland",    155, []);
  set(16, 6, "light_veg",   140, []);
  set(17, 6, "farmland",    130, []);

  // =========================================================================
  // Row 7 — German river line, north bank flood plain (40-90m)
  // Sharp elevation drop to the river flat
  // 5,8 and 12,7 are German entrenched positions along the bank
  // =========================================================================
  set(0,  7, "farmland",    80,  []);
  set(1,  7, "open_ground", 75,  []);
  set(2,  7, "farmland",    70,  []);
  set(3,  7, "light_veg",   65,  []);
  set(4,  7, "farmland",    60,  []);
  set(5,  7, "open_ground", 55,  ["road"]);            // secondary road to demolished bridge
  set(6,  7, "farmland",    50,  []);
  set(7,  7, "open_ground", 45,  []);                   // north bank near hairpin
  set(8,  7, "open_ground", 42,  ["road"]);             // main road approach to crossing
  set(9,  7, "farmland",    48,  []);
  set(10, 7, "open_ground", 50,  []);
  set(11, 7, "light_veg",   55,  []);
  set(12, 7, "open_ground", 50,  []);                   // German entrenched position
  set(13, 7, "farmland",    55,  []);
  set(14, 7, "open_ground", 60,  []);
  set(15, 7, "farmland",    65,  []);
  set(16, 7, "open_ground", 70,  []);
  set(17, 7, "farmland",    75,  []);

  // =========================================================================
  // Row 8 — Immediate north bank, entrenched German line (38-55m)
  // Lowest ground before the river, some wetland in flood plain
  // 5,8: grassland with entrenchment, 8,8: MG at hairpin loop
  // =========================================================================
  set(0,  8, "farmland",    55,  []);
  set(1,  8, "open_ground", 50,  []);
  set(2,  8, "wetland",     42,  []);
  set(3,  8, "open_ground", 45,  []);
  set(4,  8, "wetland",     40,  []);
  set(5,  8, "open_ground", 45,  []);                   // entrenched position
  set(6,  8, "wetland",     38,  []);
  set(7,  8, "open_ground", 40,  []);                   // north side of hairpin
  set(8,  8, "open_ground", 40,  ["road"]);             // MG at hairpin loop
  set(9,  8, "wetland",     38,  []);
  set(10, 8, "open_ground", 42,  []);
  set(11, 8, "wetland",     40,  []);
  set(12, 8, "open_ground", 45,  []);
  set(13, 8, "wetland",     42,  []);
  set(14, 8, "open_ground", 48,  []);
  set(15, 8, "wetland",     45,  []);
  set(16, 8, "open_ground", 50,  []);
  set(17, 8, "farmland",    52,  []);

  // =========================================================================
  // Row 9 — VOLTURNO RIVER (primary band) — elevation 25-30m
  // River runs east-west. Hairpin loop dips south at cols 7-8.
  // Demolished bridges at cols 5 and 12.
  // =========================================================================
  river(0,  9, 28);
  river(1,  9, 27);
  river(2,  9, 27);
  river(3,  9, 26);
  river(4,  9, 26);
  set(5,  9, "open_ground", 32,  ["bridge"],           { bridge: "Demolished bridge (west)" }); // demolished bridge
  river(6,  9, 26);
  river(7,  9, 25);                                    // hairpin bend west
  river(8,  9, 25);                                    // hairpin bend east
  river(9,  9, 26);
  river(10, 9, 27);
  river(11, 9, 27);
  set(12, 9, "open_ground", 32,  ["bridge"],           { bridge: "Demolished bridge (east)" }); // demolished bridge
  river(13, 9, 27);
  river(14, 9, 28);
  river(15, 9, 28);
  river(16, 9, 29);
  river(17, 9, 29);

  // =========================================================================
  // Row 10 — River southern edge / hairpin loop south (25-38m)
  // Cols 7-8 still river (hairpin extends south). Rest is wetland/flood plain.
  // =========================================================================
  set(0,  10, "wetland",     35,  []);
  set(1,  10, "wetland",     33,  []);
  set(2,  10, "open_ground", 35,  []);
  set(3,  10, "wetland",     32,  []);
  set(4,  10, "open_ground", 34,  []);
  set(5,  10, "wetland",     33,  []);
  set(6,  10, "wetland",     30,  []);
  river(7,  10, 25);                                   // hairpin loop south
  river(8,  10, 25);                                   // hairpin loop south
  set(9,  10, "wetland",     30,  []);
  set(10, 10, "open_ground", 33,  []);
  set(11, 10, "wetland",     32,  []);
  set(12, 10, "open_ground", 34,  []);
  set(13, 10, "wetland",     33,  []);
  set(14, 10, "open_ground", 35,  []);
  set(15, 10, "wetland",     34,  []);
  set(16, 10, "open_ground", 36,  []);
  set(17, 10, "wetland",     35,  []);

  // =========================================================================
  // Row 11 — South bank flood plain, US forward staging (35-55m)
  // Flat agricultural land with scattered farm buildings
  // =========================================================================
  set(0,  11, "farmland",    45,  []);
  set(1,  11, "open_ground", 42,  []);
  set(2,  11, "farmland",    44,  []);
  set(3,  11, "open_ground", 40,  []);
  set(4,  11, "farmland",    42,  []);
  set(5,  11, "open_ground", 40,  ["road"]);            // secondary road
  set(6,  11, "farmland",    43,  []);
  set(7,  11, "open_ground", 38,  []);                   // near hairpin south bank
  set(8,  11, "farmland",    39,  []);
  set(9,  11, "open_ground", 42,  ["road"]);             // main road
  set(10, 11, "farmland",    44,  []);
  set(11, 11, "open_ground", 46,  []);
  set(12, 11, "farmland",    48,  []);
  set(13, 11, "light_veg",   50,  []);
  set(14, 11, "farmland",    52,  []);
  set(15, 11, "open_ground", 50,  []);
  set(16, 11, "farmland",    52,  []);
  set(17, 11, "open_ground", 48,  []);

  // =========================================================================
  // Row 12 — US forward positions (40-65m)
  // 7,12: 1st Bn forward, 12,12: 2nd Bn forward
  // Farm compounds and staging areas
  // =========================================================================
  set(0,  12, "farmland",    55,  []);
  set(1,  12, "farmland",    52,  []);
  set(2,  12, "open_ground", 50,  []);
  set(3,  12, "farmland",    52,  []);
  set(4,  12, "light_veg",   55,  []);
  set(5,  12, "farmland",    50,  ["road"]);
  set(6,  12, "open_ground", 48,  []);
  set(7,  12, "farmland",    50,  []);                   // 1st Bn forward position
  set(8,  12, "light_urban", 52,  ["building", "road"], { building: "Farm compound" }); // farm building
  set(9,  12, "farmland",    54,  ["road"]);             // main road
  set(10, 12, "open_ground", 52,  []);
  set(11, 12, "farmland",    55,  []);
  set(12, 12, "farmland",    58,  []);                   // 2nd Bn forward position
  set(13, 12, "light_veg",   60,  []);
  set(14, 12, "farmland",    58,  []);
  set(15, 12, "open_ground", 55,  []);
  set(16, 12, "farmland",    60,  []);
  set(17, 12, "farmland",    58,  []);

  // =========================================================================
  // Row 13 — US main line of departure (48-70m)
  // 8,13: 1st Bn, 6,13: 1st Bn, 13,13: 2nd Bn, 11,13: 2nd Bn
  // 7,13: Engineers, 11,14 (next row): Engineers
  // Mix of farmland and light urban (farm villages)
  // =========================================================================
  set(0,  13, "farmland",    62,  []);
  set(1,  13, "light_veg",   58,  []);
  set(2,  13, "farmland",    60,  []);
  set(3,  13, "open_ground", 55,  []);
  set(4,  13, "farmland",    58,  []);
  set(5,  13, "farmland",    55,  ["road"]);
  set(6,  13, "open_ground", 52,  []);                   // 1st Bn position
  set(7,  13, "farmland",    54,  []);                   // Engineers forward
  set(8,  13, "farmland",    56,  ["road"]);             // 1st Bn
  set(9,  13, "open_ground", 58,  ["road"]);             // main road
  set(10, 13, "farmland",    60,  []);
  set(11, 13, "light_veg",   62,  []);                   // 2nd Bn
  set(12, 13, "farmland",    65,  []);
  set(13, 13, "farmland",    68,  []);                   // 2nd Bn
  set(14, 13, "light_veg",   65,  []);
  set(15, 13, "farmland",    62,  []);
  set(16, 13, "farmland",    66,  []);
  set(17, 13, "open_ground", 60,  []);

  // =========================================================================
  // Row 14 — US staging depth (55-80m)
  // 8,14: 1st Bn depth, 11,14: Engineers
  // Gentle terrain, mostly farmland with some trees
  // =========================================================================
  set(0,  14, "farmland",    68,  []);
  set(1,  14, "forest",      72,  []);
  set(2,  14, "farmland",    65,  []);
  set(3,  14, "light_veg",   62,  []);
  set(4,  14, "farmland",    64,  []);
  set(5,  14, "farmland",    60,  ["road"]);
  set(6,  14, "light_veg",   62,  []);
  set(7,  14, "farmland",    65,  []);
  set(8,  14, "farmland",    68,  ["road"]);             // 1st Bn depth
  set(9,  14, "open_ground", 70,  ["road"]);             // main road
  set(10, 14, "farmland",    72,  []);
  set(11, 14, "open_ground", 75,  []);                   // Engineers
  set(12, 14, "farmland",    72,  []);
  set(13, 14, "light_veg",   70,  []);
  set(14, 14, "farmland",    68,  []);
  set(15, 14, "farmland",    65,  []);
  set(16, 14, "forest",      72,  []);
  set(17, 14, "farmland",    68,  []);

  // =========================================================================
  // Row 15 — US support and artillery zone (60-90m)
  // 9,15: HQ, 6,16 and 12,16 arty (next row), 10,16 armor (next row)
  // East-west logistics road runs along this row
  // =========================================================================
  set(0,  15, "farmland",    78,  []);
  set(1,  15, "light_veg",   82,  []);
  set(2,  15, "farmland",    75,  ["road"]);             // E-W logistics road
  set(3,  15, "farmland",    72,  ["road"]);
  set(4,  15, "farmland",    70,  ["road"]);
  set(5,  15, "open_ground", 68,  ["road"]);             // road junction
  set(6,  15, "farmland",    72,  ["road"]);
  set(7,  15, "farmland",    75,  ["road"]);
  set(8,  15, "light_veg",   78,  ["road"]);
  set(9,  15, "light_urban", 80,  ["building", "road"], { building: "Farm HQ compound" }); // HQ position
  set(10, 15, "farmland",    78,  ["road"]);
  set(11, 15, "farmland",    80,  ["road"]);
  set(12, 15, "farmland",    82,  ["road"]);
  set(13, 15, "farmland",    85,  ["road"]);
  set(14, 15, "light_veg",   82,  ["road"]);
  set(15, 15, "farmland",    80,  ["road"]);
  set(16, 15, "forest",      85,  []);
  set(17, 15, "farmland",    80,  []);

  // =========================================================================
  // Row 16 — US artillery and armor positions (65-95m)
  // 6,16: Artillery west, 12,16: Artillery east, 9,17 arty (next row)
  // 10,16: Armor in defilade, 9,16: 3rd Bn reserve
  // =========================================================================
  set(0,  16, "farmland",    82,  []);
  set(1,  16, "forest",      88,  []);
  set(2,  16, "farmland",    80,  []);
  set(3,  16, "light_veg",   78,  []);
  set(4,  16, "farmland",    76,  []);
  set(5,  16, "farmland",    74,  ["road"]);             // secondary road
  set(6,  16, "open_ground", 78,  []);                   // Artillery west
  set(7,  16, "farmland",    80,  []);
  set(8,  16, "light_veg",   82,  []);
  set(9,  16, "farmland",    85,  ["road"]);             // 3rd Bn reserve
  set(10, 16, "open_ground", 82,  []);                   // Armor in defilade
  set(11, 16, "farmland",    84,  []);
  set(12, 16, "open_ground", 88,  []);                   // Artillery east
  set(13, 16, "farmland",    90,  []);
  set(14, 16, "forest",      88,  []);
  set(15, 16, "farmland",    85,  []);
  set(16, 16, "forest",      90,  []);
  set(17, 16, "farmland",    85,  []);

  // =========================================================================
  // Row 17 — US rear area (70-105m)
  // 9,17: Artillery center (behind the HQ)
  // Gentle rolling hills with farm fields and woodlots
  // =========================================================================
  set(0,  17, "forest",      90,  []);
  set(1,  17, "farmland",    92,  []);
  set(2,  17, "light_veg",   88,  []);
  set(3,  17, "farmland",    85,  []);
  set(4,  17, "forest",      82,  []);
  set(5,  17, "farmland",    80,  ["road"]);
  set(6,  17, "light_veg",   84,  []);
  set(7,  17, "farmland",    88,  []);
  set(8,  17, "farmland",    92,  []);
  set(9,  17, "open_ground", 95,  ["road"]);             // Artillery center
  set(10, 17, "farmland",    92,  []);
  set(11, 17, "forest",      95,  []);
  set(12, 17, "farmland",    98,  []);
  set(13, 17, "light_veg",   95,  []);
  set(14, 17, "farmland",    90,  []);
  set(15, 17, "forest",      95,  []);
  set(16, 17, "farmland",    100, []);
  set(17, 17, "forest",      95,  []);

  // =========================================================================
  // Row 18 — Southern hills, small village (80-115m)
  // Village cluster around col 9 (light_urban with buildings)
  // =========================================================================
  set(0,  18, "forest",      98,  []);
  set(1,  18, "farmland",    95,  []);
  set(2,  18, "farmland",    92,  []);
  set(3,  18, "forest",      90,  []);
  set(4,  18, "farmland",    88,  []);
  set(5,  18, "light_veg",   85,  ["road"]);
  set(6,  18, "farmland",    90,  []);
  set(7,  18, "farmland",    95,  []);
  set(8,  18, "light_urban", 100, ["building", "road"], { building: "Village south" });
  set(9,  18, "light_urban", 105, ["building", "road"], { building: "Village center" });
  set(10, 18, "light_urban", 102, ["building"],         { building: "Village east" });
  set(11, 18, "farmland",    100, []);
  set(12, 18, "forest",      105, []);
  set(13, 18, "farmland",    100, []);
  set(14, 18, "forest",      98,  []);
  set(15, 18, "farmland",    95,  []);
  set(16, 18, "forest",      105, []);
  set(17, 18, "farmland",    100, []);

  // =========================================================================
  // Row 19 — Southern edge, rolling hills (85-120m)
  // Supply lines disappear off-map to the south
  // =========================================================================
  set(0,  19, "forest",      105, []);
  set(1,  19, "farmland",    100, []);
  set(2,  19, "light_veg",   98,  []);
  set(3,  19, "forest",      95,  []);
  set(4,  19, "farmland",    92,  []);
  set(5,  19, "farmland",    90,  ["road"]);
  set(6,  19, "light_veg",   95,  []);
  set(7,  19, "farmland",    100, []);
  set(8,  19, "farmland",    105, []);
  set(9,  19, "open_ground", 110, ["road"]);
  set(10, 19, "farmland",    108, []);
  set(11, 19, "forest",      110, []);
  set(12, 19, "farmland",    112, []);
  set(13, 19, "light_veg",   108, []);
  set(14, 19, "farmland",    105, []);
  set(15, 19, "forest",      110, []);
  set(16, 19, "farmland",    115, []);
  set(17, 19, "forest",      112, []);

  return {
    cols, rows, cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm,
    gridType: "hex",
    center: { lat: 41.25, lng: 14.10 },
    cells,
  };
}
