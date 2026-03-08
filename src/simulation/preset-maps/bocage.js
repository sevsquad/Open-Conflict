// ════════════════════════════════════════════════════════════════
// BOCAGE BREAKOUT — Normandy hedgerow country, summer 1944
// US forces attack south through dense bocage near Sainte-Mere-Eglise.
// 15x18 grid, 200m cells. Hedgerows modeled as forest cells with
// "hedgerow" feature; fields are open_ground/farmland between them.
// ════════════════════════════════════════════════════════════════

export function generateBocageMap() {
  const cols = 15, rows = 18;
  const cellSizeKm = 0.2;
  const cells = {};

  // Default fill: open farmland at 35m
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "farmland",
        elevation: 35,
        features: [],
        feature_names: null,
      };
    }
  }

  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    cells[`${c},${r}`] = { terrain, elevation, features, feature_names: featureNames };
  };

  // ────────────────────────────────────────────
  // ELEVATION MAP — gentle Normandy undulation
  // Ridge around rows 8-10, low near stream at row 12
  // ────────────────────────────────────────────
  const elevationMap = [
  //  c: 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14
    [ 32, 30, 33, 35, 34, 36, 35, 38, 35, 34, 33, 35, 32, 30, 31],  // r0
    [ 33, 32, 35, 36, 37, 38, 36, 39, 37, 36, 35, 34, 33, 31, 32],  // r1
    [ 35, 34, 37, 38, 40, 39, 38, 40, 39, 38, 37, 36, 35, 33, 34],  // r2
    [ 37, 36, 39, 41, 42, 43, 42, 43, 42, 41, 40, 38, 37, 35, 36],  // r3
    [ 40, 38, 42, 44, 45, 46, 45, 46, 45, 44, 43, 41, 39, 37, 38],  // r4
    [ 42, 41, 44, 47, 48, 50, 48, 49, 48, 47, 46, 44, 42, 40, 41],  // r5
    [ 45, 44, 48, 52, 55, 58, 56, 55, 57, 55, 52, 48, 45, 43, 44],  // r6
    [ 50, 48, 52, 58, 62, 65, 63, 60, 64, 62, 58, 53, 50, 47, 48],  // r7
    [ 55, 53, 58, 64, 70, 75, 72, 68, 74, 72, 66, 60, 55, 52, 53],  // r8  ridge
    [ 58, 55, 60, 68, 74, 80, 78, 72, 80, 78, 70, 63, 58, 54, 55],  // r9  ridge peak
    [ 55, 52, 57, 63, 68, 75, 72, 70, 74, 72, 65, 58, 54, 50, 52],  // r10
    [ 48, 45, 50, 55, 58, 60, 56, 55, 58, 57, 53, 48, 45, 42, 44],  // r11
    [ 25, 22, 24, 28, 30, 32, 28, 25, 30, 28, 25, 22, 20, 18, 20],  // r12 stream valley
    [ 30, 28, 32, 36, 38, 42, 40, 38, 42, 40, 36, 32, 28, 25, 27],  // r13
    [ 35, 33, 38, 42, 45, 50, 48, 45, 48, 46, 42, 38, 34, 30, 32],  // r14
    [ 38, 36, 40, 45, 48, 52, 50, 48, 50, 48, 44, 40, 36, 33, 35],  // r15
    [ 40, 38, 42, 46, 50, 52, 50, 48, 50, 49, 46, 42, 38, 35, 37],  // r16
    [ 42, 40, 44, 48, 50, 53, 51, 50, 52, 50, 48, 44, 40, 37, 39],  // r17
  ];

  // Apply elevation to all cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`].elevation = elevationMap[r][c];
    }
  }

  // ────────────────────────────────────────────
  // ROW 0-2: US ASSEMBLY AREA
  // Partially cleared bocage — fields with scattered hedgerows,
  // main road through col 7
  // ────────────────────────────────────────────

  // Row 0 — rear assembly, mostly open fields
  set(0, 0, "open_ground", 32, ["hedgerow"]);
  set(1, 0, "farmland",    30, []);
  set(2, 0, "farmland",    33, []);
  set(3, 0, "open_ground", 35, ["hedgerow"]);
  set(4, 0, "farmland",    34, []);
  set(5, 0, "farmland",    36, ["hedgerow"]);
  set(6, 0, "open_ground", 35, []);
  set(7, 0, "open_ground", 38, ["road"]);              // main N-S road
  set(8, 0, "farmland",    35, []);
  set(9, 0, "farmland",    34, ["hedgerow"]);
  set(10, 0, "open_ground", 33, []);
  set(11, 0, "farmland",    35, []);
  set(12, 0, "open_ground", 32, ["hedgerow"]);
  set(13, 0, "farmland",    30, []);
  set(14, 0, "farmland",    31, []);

  // Row 1 — fields with hedgerow borders starting to thicken
  set(0, 1, "farmland",    33, []);
  set(1, 1, "farmland",    32, ["hedgerow"]);
  set(2, 1, "open_ground", 35, []);                    // Blue unit at 2,1
  set(3, 1, "forest",      36, ["hedgerow"]);           // hedgerow bank
  set(4, 1, "farmland",    37, []);
  set(5, 1, "open_ground", 38, ["hedgerow"]);
  set(6, 1, "farmland",    36, []);                     // Blue unit at 6,1
  set(7, 1, "open_ground", 39, ["road"]);               // main road
  set(8, 1, "farmland",    37, []);                     // Blue unit at 8,1
  set(9, 1, "open_ground", 36, ["hedgerow"]);
  set(10, 1, "farmland",   35, []);
  set(11, 1, "forest",     34, ["hedgerow"]);
  set(12, 1, "farmland",   33, []);
  set(13, 1, "open_ground", 31, ["hedgerow"]);
  set(14, 1, "farmland",   32, []);

  // Row 2 — hedgerows thicken toward no-man's-land
  set(0, 2, "forest",      35, ["hedgerow"]);
  set(1, 2, "farmland",    34, []);
  set(2, 2, "open_ground", 37, ["hedgerow"]);
  set(3, 2, "farmland",    38, []);
  set(4, 2, "forest",      40, ["hedgerow"]);
  set(5, 2, "open_ground", 39, []);                     // Blue unit at 5,2
  set(6, 2, "farmland",    38, ["hedgerow"]);
  set(7, 2, "open_ground", 40, ["road"]);               // Blue unit at 7,2 on road
  set(8, 2, "forest",      39, ["hedgerow"]);
  set(9, 2, "farmland",    38, []);                     // Blue unit at 9,2
  set(10, 2, "open_ground", 37, ["hedgerow"]);
  set(11, 2, "farmland",   36, []);
  set(12, 2, "forest",     35, ["hedgerow"]);
  set(13, 2, "open_ground", 33, []);
  set(14, 2, "farmland",   34, ["hedgerow"]);

  // ────────────────────────────────────────────
  // ROW 3-5: NO MAN'S LAND — densest hedgerow
  // Checkerboard of fields and thick hedge banks,
  // sunken lanes running E-W
  // ────────────────────────────────────────────

  // Row 3 — dense hedgerow with E-W sunken lane through middle
  set(0, 3, "forest",      37, ["hedgerow"]);
  set(1, 3, "open_ground", 36, ["trail", "hedgerow"]);  // sunken lane
  set(2, 3, "forest",      39, ["hedgerow"]);
  set(3, 3, "farmland",    41, []);
  set(4, 3, "forest",      42, ["hedgerow"]);           // Blue unit at 4,3
  set(5, 3, "open_ground", 43, ["trail", "hedgerow"]);  // sunken lane
  set(6, 3, "forest",      42, ["hedgerow"]);
  set(7, 3, "open_ground", 43, ["road"]);               // road continues
  set(8, 3, "forest",      42, ["hedgerow"]);
  set(9, 3, "open_ground", 41, ["trail", "hedgerow"]);  // sunken lane
  set(10, 3, "forest",     40, ["hedgerow"]);           // Blue unit at 10,3
  set(11, 3, "farmland",   38, []);
  set(12, 3, "forest",     37, ["hedgerow"]);
  set(13, 3, "open_ground", 35, ["trail", "hedgerow"]); // sunken lane
  set(14, 3, "forest",     36, ["hedgerow"]);

  // Row 4 — alternating fields and hedgerows
  set(0, 4, "farmland",    40, []);
  set(1, 4, "forest",      38, ["hedgerow"]);
  set(2, 4, "open_ground", 42, []);
  set(3, 4, "forest",      44, ["hedgerow"]);
  set(4, 4, "farmland",    45, []);
  set(5, 4, "forest",      46, ["hedgerow"]);
  set(6, 4, "open_ground", 45, []);
  set(7, 4, "farmland",    46, ["road"]);               // Blue unit at 7,4
  set(8, 4, "forest",      45, ["hedgerow"]);
  set(9, 4, "open_ground", 44, []);
  set(10, 4, "forest",     43, ["hedgerow"]);
  set(11, 4, "farmland",   41, []);
  set(12, 4, "forest",     39, ["hedgerow"]);
  set(13, 4, "open_ground", 37, []);
  set(14, 4, "forest",     38, ["hedgerow"]);

  // Row 5 — dense bocage belt, another E-W sunken lane
  set(0, 5, "forest",      42, ["hedgerow"]);
  set(1, 5, "farmland",    41, []);
  set(2, 5, "forest",      44, ["hedgerow"]);
  set(3, 5, "open_ground", 47, ["trail", "hedgerow"]);  // sunken lane
  set(4, 5, "forest",      48, ["hedgerow"]);
  set(5, 5, "farmland",    50, []);
  set(6, 5, "forest",      48, ["hedgerow"]);
  set(7, 5, "open_ground", 49, ["road"]);               // main road
  set(8, 5, "forest",      48, ["hedgerow"]);
  set(9, 5, "farmland",    47, []);
  set(10, 5, "forest",     46, ["hedgerow"]);
  set(11, 5, "open_ground", 44, ["trail", "hedgerow"]); // sunken lane
  set(12, 5, "forest",     42, ["hedgerow"]);
  set(13, 5, "farmland",   40, []);
  set(14, 5, "forest",     41, ["hedgerow"]);

  // ────────────────────────────────────────────
  // ROW 6-9: FIRST GERMAN DEFENSE LINE
  // Hedgerows with farm compounds, small village
  // at col 7 rows 7-8, orchards (farmland+treeline)
  // Cross-road at row 7
  // ────────────────────────────────────────────

  // Row 6 — hedgerow defense belt
  set(0, 6, "farmland",    45, ["hedgerow"]);
  set(1, 6, "forest",      44, ["hedgerow"]);
  set(2, 6, "open_ground", 48, []);
  set(3, 6, "forest",      52, ["hedgerow"]);
  set(4, 6, "farmland",    55, ["hedgerow"]);
  set(5, 6, "forest",      58, ["hedgerow"]);
  set(6, 6, "farmland",    56, ["building"]);            // farm compound
  set(7, 6, "open_ground", 55, ["road"]);
  set(8, 6, "forest",      57, ["hedgerow"]);
  set(9, 6, "farmland",    55, ["building"]);            // farm compound
  set(10, 6, "forest",     52, ["hedgerow"]);
  set(11, 6, "open_ground", 48, []);
  set(12, 6, "forest",     45, ["hedgerow"]);
  set(13, 6, "farmland",   43, ["hedgerow"]);
  set(14, 6, "forest",     44, ["hedgerow"]);

  // Row 7 — village center, E-W cross-road
  set(0, 7, "forest",      50, ["hedgerow"]);
  set(1, 7, "farmland",    48, ["trail"]);
  set(2, 7, "open_ground", 52, ["road"]);                // cross-road E-W
  set(3, 7, "farmland",    58, ["road", "hedgerow"]);    // road through hedge
  set(4, 7, "forest",      62, ["hedgerow"]);
  set(5, 7, "farmland",    65, ["road", "building"]);    // farm on crossroad
  set(6, 7, "light_urban", 63, ["road", "building"]);    // village edge
  set(7, 7, "light_urban", 60, ["road", "building", "town"]);  // Red unit at 7,7 — village center
  set(8, 7, "light_urban", 64, ["road", "building"]);    // village edge
  set(9, 7, "farmland",    62, ["road", "building"]);    // farm on crossroad
  set(10, 7, "forest",     58, ["hedgerow"]);
  set(11, 7, "farmland",   53, ["road"]);                // cross-road continues
  set(12, 7, "open_ground", 50, ["road", "hedgerow"]);
  set(13, 7, "farmland",   47, ["trail"]);
  set(14, 7, "forest",     48, ["hedgerow"]);

  // Row 8 — village south edge, orchards, ridge continues
  set(0, 8, "farmland",    55, ["treeline"]);            // orchard
  set(1, 8, "forest",      53, ["hedgerow"]);
  set(2, 8, "farmland",    58, ["treeline"]);            // orchard
  set(3, 8, "forest",      64, ["hedgerow"]);
  set(4, 8, "farmland",    70, ["treeline"]);            // orchard
  set(5, 8, "light_urban", 75, ["building"]);            // Red unit at 5,8
  set(6, 8, "farmland",    72, ["treeline"]);            // orchard
  set(7, 8, "light_urban", 68, ["road", "building"]);    // village south
  set(8, 8, "farmland",    74, ["treeline"]);            // orchard
  set(9, 8, "light_urban", 72, ["building"]);            // Red unit at 9,8
  set(10, 8, "farmland",   66, ["treeline"]);            // orchard
  set(11, 8, "forest",     60, ["hedgerow"]);
  set(12, 8, "farmland",   55, ["treeline"]);            // orchard
  set(13, 8, "forest",     52, ["hedgerow"]);
  set(14, 8, "farmland",   53, []);

  // Row 9 — ridge crest, hedgerow defense positions
  set(0, 9, "forest",      58, ["hedgerow"]);
  set(1, 9, "open_ground", 55, []);
  set(2, 9, "forest",      60, ["hedgerow"]);
  set(3, 9, "farmland",    68, []);
  set(4, 9, "forest",      74, ["hedgerow"]);
  set(5, 9, "open_ground", 80, ["hedgerow"]);            // ridge crest
  set(6, 9, "forest",      78, ["hedgerow"]);
  set(7, 9, "farmland",    72, ["road"]);                // main road over ridge
  set(8, 9, "forest",      80, ["hedgerow"]);
  set(9, 9, "open_ground", 78, ["hedgerow"]);            // ridge crest
  set(10, 9, "forest",     70, ["hedgerow"]);
  set(11, 9, "farmland",   63, []);
  set(12, 9, "forest",     58, ["hedgerow"]);
  set(13, 9, "open_ground", 54, []);
  set(14, 9, "forest",     55, ["hedgerow"]);

  // ────────────────────────────────────────────
  // ROW 10-13: SECOND GERMAN DEFENSE LINE
  // More open but still hedgerow-laced. Stream
  // crosses E-W at row 12. Buildings at key positions.
  // ────────────────────────────────────────────

  // Row 10 — descending from ridge, mixed bocage
  set(0, 10, "farmland",   55, []);
  set(1, 10, "forest",     52, ["hedgerow"]);
  set(2, 10, "open_ground", 57, []);
  set(3, 10, "forest",     63, ["hedgerow"]);
  set(4, 10, "farmland",   68, ["hedgerow"]);
  set(5, 10, "open_ground", 75, []);
  set(6, 10, "forest",     72, ["hedgerow"]);
  set(7, 10, "farmland",   70, ["road", "building"]);   // Red unit at 7,10 — fortified farm
  set(8, 10, "forest",     74, ["hedgerow"]);
  set(9, 10, "open_ground", 72, []);
  set(10, 10, "farmland",  65, ["hedgerow"]);
  set(11, 10, "forest",    58, ["hedgerow"]);
  set(12, 10, "open_ground", 54, []);
  set(13, 10, "forest",    50, ["hedgerow"]);
  set(14, 10, "farmland",  52, []);

  // Row 11 — approaching stream valley, defense positions
  set(0, 11, "forest",     48, ["hedgerow"]);
  set(1, 11, "open_ground", 45, []);
  set(2, 11, "farmland",   50, ["trail"]);
  set(3, 11, "forest",     55, ["hedgerow"]);
  set(4, 11, "open_ground", 58, ["building"]);           // Red unit at 4,11 — farm strongpoint
  set(5, 11, "forest",     60, ["hedgerow"]);
  set(6, 11, "farmland",   56, []);
  set(7, 11, "open_ground", 55, ["road"]);
  set(8, 11, "forest",     58, ["hedgerow"]);
  set(9, 11, "farmland",   57, []);
  set(10, 11, "open_ground", 53, ["building"]);          // Red unit at 10,11 — farm strongpoint
  set(11, 11, "forest",    48, ["hedgerow"]);
  set(12, 11, "farmland",  45, ["trail"]);
  set(13, 11, "open_ground", 42, []);
  set(14, 11, "forest",    44, ["hedgerow"]);

  // Row 12 — stream valley, E-W watercourse
  set(0, 12, "wetland",    25, []);
  set(1, 12, "wetland",    22, ["river"]);
  set(2, 12, "wetland",    24, ["river"]);
  set(3, 12, "open_ground", 28, ["river", "hedgerow"]); // stream through hedge
  set(4, 12, "wetland",    30, ["river"]);
  set(5, 12, "open_ground", 32, ["river"]);
  set(6, 12, "wetland",    28, ["river"]);  // Note: mortar at 5,12 (open_ground) not here
  set(7, 12, "open_ground", 25, ["road", "river", "bridge"]);  // road crosses stream
  set(8, 12, "wetland",    30, ["river"]);
  set(9, 12, "open_ground", 28, ["river"]);
  set(10, 12, "wetland",   25, ["river"]);
  set(11, 12, "open_ground", 22, ["river", "hedgerow"]);
  set(12, 12, "wetland",   20, ["river"]);
  set(13, 12, "open_ground", 18, ["river"]);
  set(14, 12, "wetland",   20, ["river"]);

  // Row 13 — south of stream, rebuilding bocage
  set(0, 13, "forest",     30, ["hedgerow"]);
  set(1, 13, "open_ground", 28, []);
  set(2, 13, "farmland",   32, ["hedgerow"]);
  set(3, 13, "forest",     36, ["hedgerow"]);
  set(4, 13, "open_ground", 38, []);
  set(5, 13, "farmland",   42, ["hedgerow"]);
  set(6, 13, "forest",     40, ["hedgerow", "building"]); // Red unit at 6,13 — defended farm
  set(7, 13, "open_ground", 38, ["road"]);
  set(8, 13, "forest",     42, ["hedgerow", "building"]); // Red unit at 8,13 — defended farm
  set(9, 13, "farmland",   40, []);
  set(10, 13, "open_ground", 36, ["hedgerow"]);
  set(11, 13, "forest",    32, ["hedgerow"]);
  set(12, 13, "farmland",  28, []);
  set(13, 13, "open_ground", 25, ["hedgerow"]);
  set(14, 13, "forest",    27, ["hedgerow"]);

  // ────────────────────────────────────────────
  // ROW 14-17: GERMAN REAR AREA — road junction objective
  // Bocage thins out, road junction at col 7 row 16,
  // hamlet around the junction
  // ────────────────────────────────────────────

  // Row 14 — transitional, bocage thinning
  set(0, 14, "farmland",   35, []);
  set(1, 14, "open_ground", 33, ["hedgerow"]);
  set(2, 14, "farmland",   38, []);
  set(3, 14, "forest",     42, ["hedgerow"]);
  set(4, 14, "open_ground", 45, []);
  set(5, 14, "farmland",   50, ["hedgerow"]);
  set(6, 14, "open_ground", 48, []);
  set(7, 14, "farmland",   45, ["road"]);
  set(8, 14, "open_ground", 48, []);
  set(9, 14, "farmland",   46, ["hedgerow"]);
  set(10, 14, "open_ground", 42, []);
  set(11, 14, "forest",    38, ["hedgerow"]);
  set(12, 14, "farmland",  34, []);
  set(13, 14, "open_ground", 30, []);
  set(14, 14, "farmland",  32, ["hedgerow"]);

  // Row 15 — approach to junction hamlet
  set(0, 15, "open_ground", 38, []);
  set(1, 15, "farmland",   36, []);
  set(2, 15, "forest",     40, ["hedgerow"]);
  set(3, 15, "farmland",   45, []);
  set(4, 15, "open_ground", 48, ["hedgerow"]);
  set(5, 15, "farmland",   52, []);
  set(6, 15, "open_ground", 50, ["building"]);           // hamlet outskirts
  set(7, 15, "farmland",   48, ["road"]);
  set(8, 15, "open_ground", 50, ["building"]);           // hamlet outskirts
  set(9, 15, "farmland",   48, []);
  set(10, 15, "open_ground", 44, ["hedgerow"]);
  set(11, 15, "farmland",  40, []);
  set(12, 15, "forest",    36, ["hedgerow"]);
  set(13, 15, "open_ground", 33, []);
  set(14, 15, "farmland",  35, []);

  // Row 16 — ROAD JUNCTION and hamlet, main objective
  set(0, 16, "farmland",   40, []);
  set(1, 16, "open_ground", 38, ["trail"]);
  set(2, 16, "farmland",   42, []);
  set(3, 16, "open_ground", 46, ["road"]);               // E-W road west
  set(4, 16, "farmland",   50, ["road"]);                // E-W road
  set(5, 16, "open_ground", 52, ["road"]);               // E-W road
  set(6, 16, "light_urban", 50, ["road", "building"]);   // hamlet west
  set(7, 16, "light_urban", 48, ["road", "building", "town"]);  // Red unit at 7,16 — junction center
  set(8, 16, "light_urban", 50, ["road", "building"]);   // hamlet east
  set(9, 16, "open_ground", 49, ["road"]);               // E-W road
  set(10, 16, "farmland",  46, ["road"]);                // E-W road
  set(11, 16, "open_ground", 42, ["road"]);              // E-W road east
  set(12, 16, "farmland",  38, ["trail"]);
  set(13, 16, "open_ground", 35, []);
  set(14, 16, "farmland",  37, []);

  // Row 17 — German rear, more open farmland
  set(0, 17, "open_ground", 42, []);
  set(1, 17, "farmland",   40, ["hedgerow"]);
  set(2, 17, "open_ground", 44, []);
  set(3, 17, "farmland",   48, []);
  set(4, 17, "open_ground", 50, ["hedgerow"]);
  set(5, 17, "farmland",   53, []);
  set(6, 17, "open_ground", 51, []);
  set(7, 17, "farmland",   50, ["road"]);                // road continues south
  set(8, 17, "open_ground", 52, []);
  set(9, 17, "farmland",   50, []);
  set(10, 17, "open_ground", 48, ["hedgerow"]);
  set(11, 17, "farmland",  44, []);
  set(12, 17, "open_ground", 40, []);
  set(13, 17, "farmland",  37, ["hedgerow"]);
  set(14, 17, "open_ground", 39, []);

  // ────────────────────────────────────────────
  // FEATURE NAMES — named locations for narrative
  // ────────────────────────────────────────────
  cells["7,7"].feature_names = { town: "Ste-Marie-du-Champ" };
  cells["7,16"].feature_names = { town: "Le Carrefour" };
  cells["7,12"].feature_names = { bridge: "Pont de la Douve" };

  return {
    cols,
    rows,
    cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm,
    gridType: "hex",
    center: { lat: 49.41, lng: -1.31 },
    cells,
  };
}
