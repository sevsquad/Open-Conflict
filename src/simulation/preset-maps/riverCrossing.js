// ════════════════════════════════════════════════════════════════
// Contested River Crossing — Cold War division-scale confrontation
// 20x30 hex grid, 1km cells, elevation 0-2200m
//
// Layout (left to right):
//   Cols 0-1:  Ocean/coast
//   Cols 2-6:  Coastal city (Ashbury north bank, Hexville south bank, port)
//   Cols 7-11: Lowland plain — farmland, scattered forest
//   Cols 12-17: Highlands — valley + ridge feature
//   Cols 17-19: Mountain range (1500-2200m)
//
// Highland profile (east to west):
//   Mountains (1500-2200m) → Valley (400-600m) → Ridge (700-900m) → Plain (20-100m)
//   River carves a gap through the ridge at rows 9-11.
//
// River "Stonebrook" originates from mountain lake at ~row 10,
// flows west through forested hills, across the plain, through
// the coastal city, and into the ocean.
//
// Bridge at the contested crossing is the only heavy vehicle route.
// Ford with wetlands in the eastern forest offers an alternative
// infantry crossing.
// ════════════════════════════════════════════════════════════════

export function generateRiverCrossingMap() {
  const cols = 20, rows = 30;
  const cellSizeKm = 1.0;
  const cells = {};

  // Fill default — open_ground at moderate elevation
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "open_ground",
        elevation: 80,
        features: [],
        feature_names: null,
      };
    }
  }

  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    cells[`${c},${r}`] = { terrain, elevation, features, feature_names: featureNames };
  };

  // Helper: add features to existing cell without overwriting terrain
  const addFeatures = (c, r, newFeatures, featureNames = null) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    const cell = cells[`${c},${r}`];
    cell.features = [...cell.features, ...newFeatures];
    if (featureNames) cell.feature_names = { ...(cell.feature_names || {}), ...featureNames };
  };

  // =========================================================================
  // PASS 1: Elevation gradient
  // Coast: 0-20m | Plain: 20-100m | Ridge: 700-900m | Valley: 400-600m | Mountains: 1500-2200m
  // =========================================================================
  // Mountain width per row (1-3 tiles of true mountain on the east edge)
  const mtnWidth = [
    2,2,1,1,1,1,1,2,2,2,  // rows 0-9
    3,3,2,2,2,2,1,1,2,2,  // rows 10-19
    2,2,2,3,3,3,2,2,2,1,  // rows 20-29
  ];

  // Highland width per row (2-5 tiles between mountains and plain)
  // Includes both valley floor and ridge
  const highlandWidth = [
    3,3,3,4,4,3,3,3,4,4,  // rows 0-9
    5,5,4,4,3,3,3,4,4,3,  // rows 10-19
    3,3,4,4,5,5,4,3,3,2,  // rows 20-29
  ];

  // Ocean width per row
  const oceanWidth = [
    3,3,3,2,2,2,2,1,1,1,  // rows 0-9
    1,1,1,1,2,2,2,2,3,3,  // rows 10-19
    3,3,4,4,4,3,3,3,3,3,  // rows 20-29
  ];

  for (let r = 0; r < rows; r++) {
    const ow = oceanWidth[r];
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    // Deterministic noise per cell
    const noise = (c) => ((c * 7 + r * 13) % 9) - 4;

    for (let c = 0; c < cols; c++) {
      let elev;
      const mtnStart = cols - mw; // first mountain column (from left)
      const highStart = mtnStart - hw; // first highland column

      if (c < ow) {
        elev = 0; // ocean
      } else if (c < ow + 1) {
        elev = 5 + ((r * 3) % 7); // coastal strip
      } else if (c < highStart) {
        // Lowland plain: gentle rise from coast to highland edge
        const frac = (c - ow) / Math.max(1, highStart - ow);
        elev = Math.round(20 + frac * 80 + noise(c));
      } else if (c < mtnStart) {
        // Highland zone — valley + ridge profile
        const hlIdx = c - highStart; // 0 = western edge (ridge), hw-1 = eastern edge (valley floor)
        const ridgeIdx = 0; // western-most highland col is the ridge
        const valleyStart = Math.max(1, hw - 2); // eastern 1-2 cols are valley floor

        // Is this the river gap? Ridge drops at rows 9-11
        const isRiverGap = (r >= 9 && r <= 11) && hlIdx <= 1;

        if (isRiverGap) {
          // River carved through the ridge — low elevation
          elev = Math.round(400 + noise(c) + 20);
        } else if (hlIdx <= ridgeIdx) {
          // Ridge crest — highest point in highlands, blocks LOS into valley
          elev = Math.round(750 + ((r * 5) % 80) + noise(c));
        } else if (hlIdx >= valleyStart) {
          // Valley floor — lower than both ridge and mountains
          const depth = (hlIdx - valleyStart) / Math.max(1, hw - valleyStart);
          elev = Math.round(450 + depth * 100 + noise(c));
        } else {
          // Transition slope between ridge and valley
          const frac = (hlIdx - ridgeIdx) / Math.max(1, valleyStart - ridgeIdx);
          elev = Math.round(750 - frac * 250 + noise(c));
        }
      } else {
        // Mountain zone: 1500-2200m
        const mtnIdx = c - mtnStart; // 0 = lowest mountain, mw-1 = highest
        const peakProx = 1 - Math.abs(r - 10) / 15; // row 10 has highest peaks
        const baseElev = 1500 + mtnIdx * 250 + Math.round(peakProx * 200);
        elev = Math.max(1500, Math.round(baseElev + noise(c)));
      }

      elev = Math.max(0, elev);
      cells[`${c},${r}`] = {
        terrain: "open_ground",
        elevation: elev,
        features: [],
        feature_names: null,
      };
    }
  }

  // =========================================================================
  // PASS 2: Ocean / coast (left side)
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    const ow = oceanWidth[r];
    for (let c = 0; c < ow; c++) {
      if (c < ow - 1) {
        set(c, r, "deep_water", 0);
      } else {
        set(c, r, "coastal_water", 0, ["shoreline"]);
      }
    }
    // Coastal strip just inland of ocean
    if (ow < cols) {
      const coastC = ow;
      const coastElev = cells[`${coastC},${r}`].elevation;
      if (r >= 6 && r <= 8) {
        set(coastC, r, "wetland", coastElev);
      } else if (r >= 20 && r <= 22) {
        set(coastC, r, "mangrove", coastElev);
      } else if (r < 4 || (r >= 26 && r <= 29)) {
        set(coastC, r, "open_ground", coastElev, ["beach"]);
      }
      // City coast rows (9-11) — dock/harbor tiles connecting port to ocean
      if (r >= 9 && r <= 11) {
        set(coastC, r, "coastal_water", 0, ["dock", "port"], { port: "Stonebrook Harbor" });
      }
    }
  }

  // =========================================================================
  // PASS 3: Mountains (right side)
  // 1500-2200m, at least 1 true mountain tile on col 19 every row
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    const mw = mtnWidth[r];
    const mtnStart = cols - mw;
    for (let i = 0; i < mw; i++) {
      const c = mtnStart + i;
      const elev = cells[`${c},${r}`].elevation;
      if (elev > 1800) {
        set(c, r, "peak", elev, ["slope_extreme"]);
      } else {
        set(c, r, "mountain", elev, ["slope_steep"]);
      }
    }
  }

  // Row 10 special: mountain lake origin of Stonebrook
  const mtnStart10 = cols - mtnWidth[10]; // col 17
  set(mtnStart10, 10, "lake", 1400, [], { lake: "Stonebrook Lake" });
  // Dam one tile west of lake (in highland zone)
  set(mtnStart10 - 1, 10, "highland", 900, ["dam", "river"], { river: "Stonebrook", dam: "Stonebrook Dam" });

  // Mountain zone cold biomes
  for (let r = 0; r < rows; r++) {
    const mw = mtnWidth[r];
    const ms = cols - mw;
    for (let i = 0; i < mw; i++) {
      const c = ms + i;
      const cell = cells[`${c},${r}`];
      if (cell.elevation > 1800 && r <= 5) {
        cell.terrain = "ice";
      } else if (cell.elevation > 1600 && r <= 3) {
        cell.terrain = "boreal_mountains";
      }
    }
  }

  // =========================================================================
  // PASS 4: Highland zone — valley + ridge
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    const mtnStart = cols - mw;
    const highStart = mtnStart - hw;

    for (let c = highStart; c < mtnStart; c++) {
      const cell = cells[`${c},${r}`];
      if (cell.terrain !== "open_ground") continue; // already set (lake, dam, etc.)
      const elev = cell.elevation;
      const hlIdx = c - highStart;
      const isRiverGap = (r >= 9 && r <= 11) && hlIdx <= 1;

      // Pick terrain type based on position and latitude
      if (r <= 2) {
        // Northern cold zone
        set(c, r, "boreal_hills", elev);
      } else if (r >= 27) {
        // Southern hot zone
        set(c, r, "jungle_hills", elev);
      } else if (r >= 24 && r <= 26) {
        // Warm transition
        if ((c + r) % 3 === 0) {
          set(c, r, "savanna_hills", elev);
        } else {
          set(c, r, "highland", elev);
        }
      } else if (isRiverGap) {
        // River gap through the ridge — forested hills at lower elevation
        set(c, r, "forested_hills", elev);
      } else if (hlIdx <= 0) {
        // Ridge crest
        set(c, r, "highland", elev);
      } else {
        // Valley floor and slopes — mix of forested_hills and highland
        if ((c + r) % 3 === 0 || (r >= 8 && r <= 12)) {
          set(c, r, "forested_hills", elev);
        } else {
          set(c, r, "highland", elev);
        }
      }
    }
  }

  // ── Highland-to-plain transition ──
  // One tile of forested hills (~300-400m) just west of the ridge
  // to avoid a harsh 700m single-tile drop to the lowland plain
  for (let r = 0; r < rows; r++) {
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    const mtnStart = cols - mw;
    const highStart = mtnStart - hw;
    const transC = highStart - 1;
    if (transC < 2) continue; // skip if in ocean/coast zone
    const cell = cells[`${transC},${r}`];
    // Only apply to base terrain — don't overwrite city, airports, towns, etc.
    if (["open_ground"].includes(cell.terrain)) {
      const noise = ((transC * 7 + r * 13) % 9) - 4;
      const transElev = Math.round(320 + noise + ((r * 3) % 60));
      set(transC, r, "forested_hills", transElev);
    }
  }

  // =========================================================================
  // PASS 5: Base terrain for the lowland plain
  // Farmland with scattered forest, no column-aligned pillar patterns
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    const ow = oceanWidth[r];
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    const leftEdge = ow + 1; // skip coast strip
    const rightEdge = cols - mw - hw - 1; // stop before highlands

    for (let c = leftEdge; c <= rightEdge; c++) {
      const cell = cells[`${c},${r}`];
      if (cell.terrain !== "open_ground") continue; // already set

      const elev = cell.elevation;

      // Far south hot zone (rows 27-29)
      if (r >= 27) {
        if (c > rightEdge - 2) {
          set(c, r, "jungle", elev);
        } else if ((c + r) % 3 === 0) {
          set(c, r, "desert", elev);
        } else {
          set(c, r, "savanna", elev);
        }
        continue;
      }

      // Far south warm zone (rows 24-26)
      if (r >= 24) {
        if ((c + r) % 4 === 0) {
          set(c, r, "savanna", elev);
        } else {
          set(c, r, "farmland", elev);
        }
        continue;
      }

      // Northern cold zone (rows 0-2)
      if (r <= 2) {
        if ((c + r) % 3 === 0) {
          set(c, r, "tundra", elev);
        } else {
          set(c, r, "farmland", elev);
        }
        continue;
      }

      // Main temperate zone — mostly farmland
      if ((c * 5 + r * 11) % 7 === 0) {
        set(c, r, "light_veg", elev);
      } else {
        set(c, r, "farmland", elev);
      }
    }
  }

  // =========================================================================
  // PASS 6: Forest — naturalistic distribution
  // Eastern river corridor + 3 larger forests + scattered small patches
  // =========================================================================

  // Eastern river corridor: forest along the river from mid-map to highlands
  // Cols 8 to the highland edge, rows 8-12
  for (let r = 8; r <= 12; r++) {
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    const highStart = cols - mw - hw;
    for (let c = 8; c < highStart; c++) {
      const cell = cells[`${c},${r}`];
      if (cell.terrain === "farmland" || cell.terrain === "open_ground" || cell.terrain === "light_veg") {
        const elev = cell.elevation;
        if ((c + r) % 4 === 0) {
          set(c, r, "dense_forest", elev);
        } else {
          set(c, r, "forest", elev);
        }
      }
    }
  }

  // Larger forest area 1: north of river, cols 7-9, rows 3-6
  const forest1 = [[7,3],[8,3],[7,4],[8,4],[9,4],[8,5],[9,5],[8,6]];
  for (const [c, r] of forest1) {
    const cell = cells[`${c},${r}`];
    if (cell.terrain === "farmland" || cell.terrain === "open_ground" || cell.terrain === "light_veg" || cell.terrain === "tundra") {
      set(c, r, (c + r) % 3 === 0 ? "dense_forest" : "forest", cell.elevation);
    }
  }

  // Larger forest area 2: south of river, cols 7-10, rows 14-17
  const forest2 = [[7,14],[8,14],[9,14],[7,15],[8,15],[9,15],[10,15],[8,16],[9,16],[10,16],[9,17]];
  for (const [c, r] of forest2) {
    const cell = cells[`${c},${r}`];
    if (cell.terrain === "farmland" || cell.terrain === "open_ground" || cell.terrain === "light_veg") {
      set(c, r, (c + r) % 3 === 0 ? "dense_forest" : "forest", cell.elevation);
    }
  }

  // Larger forest area 3: near highland edge, cols 9-11, rows 20-22
  const forest3 = [[9,20],[10,20],[11,20],[9,21],[10,21],[11,21],[10,22],[11,22]];
  for (const [c, r] of forest3) {
    const cell = cells[`${c},${r}`];
    if (cell.terrain === "farmland" || cell.terrain === "open_ground" || cell.terrain === "savanna") {
      set(c, r, "forest", cell.elevation);
    }
  }

  // Scattered small woodlands — deterministic, organic clusters
  // Avoid city area (cols 2-7, rows 7-13) and very near coast
  for (let r = 3; r < 27; r++) {
    const ow = oceanWidth[r];
    const mw = mtnWidth[r];
    const hw = highlandWidth[r];
    const rightEdge = cols - mw - hw - 1;
    for (let c = ow + 2; c <= rightEdge; c++) {
      // Skip city vicinity
      if (c <= 7 && r >= 7 && r <= 13) continue;
      const cell = cells[`${c},${r}`];
      if (cell.terrain !== "farmland") continue;
      // Deterministic scatter — ~10% of farmland tiles
      if ((c * 13 + r * 17) % 11 === 0) {
        set(c, r, "forest", cell.elevation);
      }
    }
  }

  // =========================================================================
  // PASS 7: River "Stonebrook"
  // Origin: mountain lake, flows west through forested highlands,
  // across the plain, through the coastal city, into the ocean
  // =========================================================================
  const riverPath = [
    [16, 10], // from dam area
    [15, 10], [14, 10], [13, 11], [12, 11],
    [11, 11], // L12 — gap fix
    [11, 10], [10, 10], [9, 10], [8, 10],
    [7, 10], [6, 11], [5, 11],
    [4, 11], // E12 — gap fix
    [4, 10], [3, 10],
    [2, 10], // entering city waterfront
    [1, 10], // B11 — river mouth into ocean
  ];

  for (const [c, r] of riverPath) {
    const cell = cells[`${c},${r}`];
    if (cell.terrain === "deep_water" || cell.terrain === "coastal_water") continue;
    // Don't duplicate river feature if already present (e.g. dam tile)
    if (!cell.features.includes("river")) {
      cell.features = [...cell.features, "river"];
    }
    if (!cell.feature_names) cell.feature_names = {};
    cell.feature_names.river = "Stonebrook";
    // River valley is slightly lower
    cell.elevation = Math.max(5, cell.elevation - 20);
  }

  // River mouth — add river feature to the dock tile (already set in PASS 2)
  addFeatures(1, 10, ["river"], { river: "Stonebrook" });

  // =========================================================================
  // PASS 8: Ford with wetlands (eastern river in the forest)
  // Where the river meets the forested area near the highland transition
  // =========================================================================
  // Ford in the lowland forest — where the river widens before entering the highlands
  set(10, 11, "wetland", 60, ["river", "river_crossing"], { river: "Stonebrook" });
  set(11, 11, "wetland", 65, ["river", "river_crossing"], { river: "Stonebrook" });
  set(10, 10, "wetland", 58, ["river"], { river: "Stonebrook" });

  // =========================================================================
  // PASS 9: Coastal City — Ashbury (north), Hexville (south), port
  // City core cols 3-6, rows 8-12. Port at col 2, rows 9-11.
  // =========================================================================

  // Port waterfront (col 2, rows 9-11)
  set(2, 9, "light_urban", 10, ["port", "building_sparse"], { port: "Ashbury Port" });
  set(2, 10, "light_urban", 8, ["port", "river", "dock"], { river: "Stonebrook", port: "Stonebrook Harbor" });
  set(2, 11, "light_urban", 10, ["port", "building_sparse"], { port: "Hexville Docks" });

  // Ashbury — north bank (rows 8-9, cols 3-6)
  set(3, 8, "suburban", 18, ["building_sparse"]);
  set(4, 8, "light_urban", 20, ["building"]);
  set(5, 8, "suburban", 22, ["building_sparse"]);
  set(3, 9, "dense_urban", 15, ["building_dense", "town"], { town: "Ashbury" });
  set(4, 9, "dense_urban", 18, ["building_dense"]);
  set(5, 9, "urban_commercial", 20, ["building"]);
  set(6, 9, "suburban", 22, ["building_sparse"]);

  // City core along river (row 10, cols 3-5)
  set(3, 10, "urban_industrial", 12, ["river", "building_dense"], { river: "Stonebrook" });
  set(4, 10, "dense_urban", 14, ["river", "bridge", "building_dense"], { river: "Stonebrook", bridge: "Stonebrook Bridge" });
  set(5, 10, "urban_commercial", 16, ["river", "building"], { river: "Stonebrook" });
  set(6, 10, "light_urban", 20, ["building_sparse"]);

  // Hexville — south bank (rows 11-12, cols 3-6)
  set(3, 11, "dense_urban", 14, ["building_dense", "town"], { town: "Hexville" });
  set(4, 11, "dense_urban", 16, ["building_dense", "river"], { river: "Stonebrook" });
  set(5, 11, "urban_commercial", 18, ["building", "river"], { river: "Stonebrook" });
  set(6, 11, "suburban", 20, ["building_sparse", "river"], { river: "Stonebrook" });
  set(3, 12, "suburban", 16, ["building_sparse"]);
  set(4, 12, "light_urban", 18, ["building"]);
  set(5, 12, "suburban", 20, ["building_sparse"]);

  // City periphery
  set(7, 9, "farmland", 25);
  set(7, 11, "farmland", 24);
  set(2, 8, "light_urban", 12, ["building_sparse"]);
  set(2, 12, "light_urban", 12, ["building_sparse"]);

  // Park in the city
  set(5, 12, "park", 20);

  // Power plant on city outskirts
  set(7, 10, "light_urban", 25, ["river", "power_plant"], { river: "Stonebrook", power_plant: "Ashbury Power Station" });

  // =========================================================================
  // PASS 10: Airports at extreme north and south
  // =========================================================================
  set(7, 1, "open_ground", 30, ["airfield"], { airfield: "Northern Air Base" });
  set(8, 1, "open_ground", 32);

  set(7, 28, "open_ground", 25, ["airfield"], { airfield: "Southern Air Base" });
  set(8, 28, "open_ground", 28);

  // =========================================================================
  // PASS 11: Small towns (6 total, 1 hex each)
  // =========================================================================

  // Northern towns (rows 3-8)
  set(5, 3, "light_urban", 35, ["building", "town"], { town: "Northfield" });
  set(10, 5, "light_urban", 60, ["building", "town"], { town: "Ridgemont" });
  set(6, 7, "light_urban", 30, ["building", "town"], { town: "Clearwater" });

  // Southern towns (rows 13-20)
  set(5, 14, "light_urban", 35, ["building", "town"], { town: "Southhaven" });
  set(10, 16, "light_urban", 55, ["building", "town"], { town: "Pinewood" });
  set(6, 19, "light_urban", 30, ["building", "town"], { town: "Millbrook" });

  // =========================================================================
  // PASS 12: Military bases / camps near airports
  // =========================================================================
  set(9, 2, "forest", 40, ["military_base"], { military: "Camp Sentinel" });
  set(9, 27, "forest", 35, ["military_base"], { military: "Camp Vanguard" });

  // =========================================================================
  // Linear paths — roads, rail, river overlay
  // =========================================================================

  // Highway runs N-S, routing through the coastal city for the bridge
  // Col 6-7 in open country, curving west through cols 4-5 in the city
  const linearPaths = [
    // ── Highway: N-S through center, curves through city for bridge ──
    { type: "highway", cells: [
      [7,0],[7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],
      [6,8],[5,9], // curve into city
      [4,10], // BRIDGE over Stonebrook
      [5,11],[6,12], // curve out of city
      [7,13],[7,14],[7,15],[7,16],[7,17],[7,18],[7,19],
      [7,20],[7,21],[7,22],[7,23],[7,24],[7,25],[7,26],[7,27],[7,28],[7,29],
    ]},

    // ── River (as linear path for overlay rendering) ──
    { type: "river", cells: riverPath },

    // ── Major roads in the city ──
    // E-W through Ashbury (north bank)
    { type: "major_road", cells: [
      [2,9],[3,9],[4,9],[5,9],[6,9],
    ]},
    // E-W through Hexville (south bank)
    { type: "major_road", cells: [
      [2,11],[3,11],[4,11],[5,11],[6,11],
    ]},
    // N-S road east of city
    { type: "major_road", cells: [
      [6,7],[6,8],[6,9],[6,10],[6,11],[6,12],[6,13],
    ]},
    // N-S road through port/waterfront
    { type: "major_road", cells: [
      [2,8],[2,9],[2,10],[2,11],[2,12],
    ]},

    // ── Minor roads in city ──
    { type: "minor_road", cells: [
      [3,8],[3,9],[3,10],[3,11],[3,12],
    ]},
    { type: "minor_road", cells: [
      [5,8],[5,9],[5,10],[5,11],[5,12],
    ]},

    // ── Roads connecting small towns ──
    // Northfield to highway
    { type: "road", cells: [
      [5,3],[6,3],[7,3],
    ]},
    // Ridgemont to highway
    { type: "road", cells: [
      [7,5],[8,5],[9,5],[10,5],
    ]},
    // Clearwater to city road
    { type: "road", cells: [
      [6,7],[6,8],[6,9],
    ]},
    // Southhaven to highway
    { type: "road", cells: [
      [5,14],[6,14],[7,14],
    ]},
    // Pinewood to highway
    { type: "road", cells: [
      [7,16],[8,16],[9,16],[10,16],
    ]},
    // Millbrook to highway
    { type: "road", cells: [
      [6,19],[7,19],
    ]},

    // ── Railway: south side ──
    { type: "railway", cells: [
      [5,11],[5,12],[6,13],[7,14],[7,15],[7,16],[7,17],
      [7,18],[7,19],[7,20],[7,21],[7,22],[7,23],[7,24],
      [7,25],[7,26],[7,27],[7,28],[7,29],
    ]},

    // ── Trails in highland area ──
    { type: "trail", cells: [
      [13,8],[13,9],[14,10],[15,10],[16,10],
    ]},
    { type: "trail", cells: [
      [13,12],[14,12],[14,13],[15,13],
    ]},
  ];

  return {
    cols,
    rows,
    cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm * 0.866, // hex row spacing
    gridType: "hex",
    center: { lat: 50.0, lng: 7.0 },
    bbox: { south: 49.87, north: 50.13, west: 6.87, east: 7.13 },
    cells,
    labels: {},
    linearPaths,
  };
}
