// Fulda Gap — Cold War Soviet assault through the Fulda corridor
// 20x25 hex grid, 1km cells, elevation 180-520m
// Soviet forces attack west from eastern corridor entrance;
// US armored brigade defends in depth across the gap and Vogelsberg foothills

export function generateFuldaGapMap() {
  const cols = 20, rows = 25;
  const cellSizeKm = 1.0;
  const cells = {};

  // Fill default — everything starts as grassland at moderate elevation
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "grassland",
        elevation: 250,
        features: [],
        feature_names: null,
      };
    }
  }

  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    cells[`${c},${r}`] = { terrain, elevation, features, feature_names: featureNames };
  };

  // Helper: get existing cell to merge features onto procedurally-set cells
  const get = (c, r) => cells[`${c},${r}`];

  // =========================================================================
  // PASS 1: Base elevation gradient
  // West (cols 0-6): 380-520m Vogelsberg foothills
  // Center (cols 7-13): 180-280m the corridor/gap
  // East (cols 14-19): 280-400m Rhon foothills
  // North-south variation adds gentle rolling terrain
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let elev;
      if (c <= 6) {
        // Western hills — highest at col 0, descending toward gap
        // Base: 520 at col 0, dropping to ~310 at col 6
        elev = 520 - (c * 30);
        // Add north-south rolling: higher in middle rows
        const rowFactor = 1 - Math.abs(r - 12) / 12;
        elev += rowFactor * 20;
      } else if (c <= 13) {
        // Central corridor — lowest along river (cols 9-10)
        const distFromRiver = Math.abs(c - 9.5);
        elev = 195 + distFromRiver * 18;
        // Slightly higher at north and south ends
        const edgeFactor = Math.abs(r - 12) / 12;
        elev += edgeFactor * 30;
      } else {
        // Eastern hills — rising from gap edge toward col 19
        elev = 280 + (c - 14) * 22;
        const rowFactor = 1 - Math.abs(r - 12) / 12;
        elev += rowFactor * 15;
      }

      // Add some per-cell noise for natural variation (deterministic)
      const noise = ((c * 7 + r * 13) % 11) - 5;
      elev = Math.round(elev + noise);

      // Clamp to spec range
      elev = Math.max(180, Math.min(520, elev));

      cells[`${c},${r}`] = {
        terrain: "grassland",
        elevation: elev,
        features: [],
        feature_names: null,
      };
    }
  }

  // =========================================================================
  // PASS 2: Base terrain types by zone
  // =========================================================================

  // Western hills (cols 0-6): dense forest on higher ground
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= 6; c++) {
      const cell = get(c, r);
      if (c <= 4) {
        // Dense forest on the high Vogelsberg
        cell.terrain = "forest";
      } else if (c === 5) {
        // Transition zone — mixed forest and shrubland
        cell.terrain = (r % 3 === 0) ? "light_veg" : "forest";
      } else {
        // Col 6 — forest edge, mix of forest and grassland
        cell.terrain = (r % 2 === 0) ? "forest" : "grassland";
      }
    }
  }

  // Central corridor (cols 7-13): cropland and grassland lowlands
  for (let r = 0; r < rows; r++) {
    for (let c = 7; c <= 13; c++) {
      const cell = get(c, r);
      // Alternate cropland and grassland in a natural-looking pattern
      if ((c + r) % 3 === 0) {
        cell.terrain = "farmland";
      } else {
        cell.terrain = "grassland";
      }
    }
  }

  // Eastern side (cols 14-19): rolling open terrain with some forest patches
  for (let r = 0; r < rows; r++) {
    for (let c = 14; c <= 19; c++) {
      const cell = get(c, r);
      if (c >= 18 && (r + c) % 4 === 0) {
        cell.terrain = "forest";
      } else if ((c + r) % 5 === 0) {
        cell.terrain = "farmland";
      } else {
        cell.terrain = "grassland";
      }
    }
  }

  // =========================================================================
  // PASS 3: Fulda River — cols 9-10, running north to south (rows 2-22)
  // The river is the central terrain feature of the gap
  // =========================================================================
  for (let r = 2; r <= 22; r++) {
    // River meanders slightly between cols 9 and 10
    const riverCol = (r % 5 < 3) ? 9 : 10;
    const riverElev = 180 + Math.round(Math.abs(r - 12) * 2.5);
    set(riverCol, r, "river", Math.min(riverElev, 210), ["river"], { river: "Fulda River" });
  }

  // =========================================================================
  // PASS 4: Smaller streams
  // Western stream at col 5 (rows 3-18) — drains Vogelsberg into the Fulda
  // Eastern stream at col 15 (rows 4-20) — drains Rhon foothills
  // =========================================================================
  for (let r = 3; r <= 18; r++) {
    const cell = get(5, r);
    cell.features.push("river");
    cell.elevation = Math.min(cell.elevation, 300 + r * 2);
  }
  for (let r = 4; r <= 20; r++) {
    const cell = get(15, r);
    cell.features.push("river");
    cell.elevation = Math.min(cell.elevation, 270 + r * 2);
  }

  // =========================================================================
  // PASS 5: Roads
  // =========================================================================

  // Autobahn A7 — major north-south route, cols 8-9 (rows 0-24)
  for (let r = 0; r < rows; r++) {
    // A7 runs along col 8, shifting to col 9 briefly in the south
    const roadCol = (r >= 18) ? 9 : 8;
    const cell = get(roadCol, r);
    if (cell.terrain !== "river") {
      if (!cell.features.includes("highway")) cell.features.push("highway");
      if (!cell.feature_names) cell.feature_names = { highway: "Autobahn A7" };
    }
  }

  // Autobahn A66 — east-west route through rows 13-14
  for (let c = 2; c <= 18; c++) {
    const roadRow = (c <= 10) ? 13 : 14;
    const cell = get(c, roadRow);
    if (cell.terrain !== "river") {
      if (!cell.features.includes("highway")) cell.features.push("highway");
      if (!cell.feature_names) cell.feature_names = { highway: "Autobahn A66" };
    }
  }

  // Secondary road connecting Hunfeld to the autobahn (cols 11-14, row 6-7)
  for (let c = 11; c <= 14; c++) {
    const cell = get(c, 7);
    if (!cell.features.includes("road")) cell.features.push("road");
  }

  // Secondary road from Schluchtern to A66 (cols 14-15, rows 15-18)
  for (let r = 15; r <= 18; r++) {
    const rCol = (r <= 16) ? 14 : 15;
    const cell = get(rCol, r);
    if (!cell.features.includes("road")) cell.features.push("road");
  }

  // East-west road from western forest through gap (rows 9-10 area, cols 3-12)
  for (let c = 3; c <= 12; c++) {
    const cell = get(c, 10);
    if (cell.terrain !== "river") {
      if (!cell.features.includes("road")) cell.features.push("road");
    }
  }

  // =========================================================================
  // PASS 6: Bridges where roads cross rivers/streams
  // =========================================================================

  // A7 bridge over Fulda River
  const a7BridgeRow = 10; // where east-west road crosses
  const riverColAtBridge = (a7BridgeRow % 5 < 3) ? 9 : 10;
  set(riverColAtBridge, a7BridgeRow, "river", 188, ["river", "bridge", "highway"], { bridge: "A7 Fulda River bridge" });

  // A66 bridge over Fulda River
  const a66RiverCol = (13 % 5 < 3) ? 9 : 10;
  set(a66RiverCol, 13, "river", 190, ["river", "bridge", "road"], { bridge: "A66 Fulda River bridge" });

  // Bridge over western stream on A66
  {
    const cell = get(5, 13);
    if (!cell.features.includes("bridge")) cell.features.push("bridge");
    cell.feature_names = { bridge: "A66 stream crossing" };
  }

  // Bridge over eastern stream on A66
  {
    const cell = get(15, 14);
    if (!cell.features.includes("bridge")) cell.features.push("bridge");
    cell.feature_names = { bridge: "A66 eastern stream crossing" };
  }

  // =========================================================================
  // PASS 7: Fulda city (cols 9-11, rows 12-14) — the main urban center
  // =========================================================================
  set(9,  12, "light_urban", 205, ["building", "road"], { building: "Fulda - Altstadt" });
  set(10, 12, "light_urban", 210, ["building", "road"], { building: "Fulda - Bahnhof" });
  set(11, 12, "light_urban", 218, ["building"],          { building: "Fulda - east quarter" });
  set(9,  13, "light_urban", 200, ["building", "road"], { building: "Fulda - Innenstadt" });
  set(10, 13, "light_urban", 208, ["building", "road"], { building: "Fulda - south quarter" });
  set(11, 13, "light_urban", 215, ["building"],          { building: "Fulda - industrial area" });
  set(10, 14, "light_urban", 212, ["building", "road"], { building: "Fulda - Sudstadt" });
  set(9,  14, "light_urban", 198, ["building"],          { building: "Fulda - riverside" });
  set(11, 14, "light_urban", 220, ["building"],          { building: "Fulda - suburbs" });

  // =========================================================================
  // PASS 8: Hunfeld (cols 13-14, rows 6-7) — small town northeast
  // =========================================================================
  set(13, 6, "light_urban", 248, ["building", "road"], { building: "Hunfeld - center" });
  set(14, 6, "light_urban", 258, ["building"],          { building: "Hunfeld - east" });
  set(13, 7, "light_urban", 245, ["building", "road"], { building: "Hunfeld - south" });
  set(14, 7, "light_urban", 255, ["building"],          { building: "Hunfeld - outskirts" });

  // =========================================================================
  // PASS 9: Schluchtern (cols 14-15, rows 18-19) — town to the southeast
  // =========================================================================
  set(14, 18, "light_urban", 262, ["building", "road"], { building: "Schluchtern - center" });
  set(15, 18, "light_urban", 270, ["building"],          { building: "Schluchtern - east" });
  set(14, 19, "light_urban", 258, ["building", "road"], { building: "Schluchtern - south" });
  set(15, 19, "light_urban", 268, ["building"],          { building: "Schluchtern - outskirts" });

  // =========================================================================
  // PASS 10: Scattered villages
  // Small clusters of 1-2 urban cells with buildings
  // =========================================================================

  // Neuhof — west of Fulda, cols 6-7, row 11
  set(7, 11, "light_urban", 260, ["building"], { building: "Neuhof" });
  set(6, 11, "light_urban", 275, ["building"], { building: "Neuhof - west" });

  // Eichenzell — south of Fulda, col 10, row 16
  set(10, 16, "light_urban", 225, ["building", "road"], { building: "Eichenzell" });

  // Flieden — east of Fulda along A66, col 12, row 14
  set(12, 14, "light_urban", 230, ["building", "road"], { building: "Flieden" });

  // Grossenluder — west, col 7, row 8
  set(7, 8, "light_urban", 250, ["building"], { building: "Grossenluder" });

  // Burghaun — north, col 8, row 3
  set(8, 3, "light_urban", 225, ["building", "road"], { building: "Burghaun" });

  // Bad Hersfeld approach — far north, col 10, row 1
  set(10, 1, "light_urban", 235, ["building", "road"], { building: "Hersfeld road junction" });

  // Steinau — southeast, col 16, row 21
  set(16, 21, "light_urban", 275, ["building"], { building: "Steinau" });

  // Thalau — small village west, col 4, row 17
  set(4, 17, "light_urban", 365, ["building"], { building: "Thalau" });

  // Dipperz — west of Fulda, col 6, row 15
  set(6, 15, "light_urban", 310, ["building"], { building: "Dipperz" });

  // Hofbieber — northwest, col 5, row 6
  set(5, 6, "light_urban", 340, ["building", "trail"], { building: "Hofbieber" });

  // =========================================================================
  // PASS 11: Additional forest patches
  // Eastern forest patches on higher ground
  // =========================================================================

  // Forest cluster northeast (cols 16-18, rows 2-4) — Rhon forest edge
  for (let r = 2; r <= 4; r++) {
    for (let c = 16; c <= 18; c++) {
      if ((c + r) % 2 === 0) {
        const cell = get(c, r);
        if (cell.terrain !== "light_urban") cell.terrain = "forest";
      }
    }
  }

  // Forest band along eastern hills (col 17-19, rows 8-12)
  for (let r = 8; r <= 12; r++) {
    const cell17 = get(17, r);
    if (cell17.terrain !== "light_urban") cell17.terrain = "forest";
    if (r % 2 === 0) {
      const cell18 = get(18, r);
      if (cell18.terrain !== "light_urban") cell18.terrain = "forest";
    }
  }

  // Forest patches southeast (cols 16-18, rows 19-22)
  for (let r = 19; r <= 22; r++) {
    for (let c = 16; c <= 18; c++) {
      if ((c + r) % 3 !== 0) {
        const cell = get(c, r);
        if (cell.terrain !== "light_urban") cell.terrain = "forest";
      }
    }
  }

  // Scattered woodlands along corridor edges (cols 7 and 13)
  for (let r = 0; r < rows; r++) {
    if (r % 4 === 0) {
      const cell7 = get(7, r);
      if (cell7.terrain !== "light_urban" && cell7.terrain !== "river") cell7.terrain = "forest";
    }
    if (r % 5 === 1) {
      const cell13 = get(13, r);
      if (cell13.terrain !== "light_urban" && cell13.terrain !== "river") cell13.terrain = "forest";
    }
  }

  // =========================================================================
  // PASS 12: Wetlands along river floodplain
  // Low-lying areas adjacent to the Fulda River
  // =========================================================================
  for (let r = 4; r <= 20; r++) {
    if (r % 4 === 0) {
      // Wetland patches on alternating sides of the river
      const wetCol = (r % 8 === 0) ? 8 : 11;
      const cell = get(wetCol, r);
      if (cell.terrain !== "light_urban" && cell.terrain !== "river") {
        cell.terrain = "wetland";
        cell.elevation = Math.min(cell.elevation, 210);
      }
    }
  }

  // =========================================================================
  // PASS 13: Shrubland transition zones between forest and open ground
  // =========================================================================
  for (let r = 0; r < rows; r++) {
    // Western forest edge transition at col 5-6
    if (r % 3 === 1) {
      const cell = get(6, r);
      if (cell.terrain === "grassland") cell.terrain = "light_veg";
    }
    // Eastern approach scrubby ground
    if (r % 4 === 2) {
      const cell = get(15, r);
      if (cell.terrain === "grassland" && !cell.features.includes("river")) {
        cell.terrain = "light_veg";
      }
    }
  }

  // =========================================================================
  // PASS 14: Railway line — runs north-south through the corridor
  // Roughly parallel to A7 at col 11 (rows 2-22)
  // =========================================================================
  for (let r = 2; r <= 22; r++) {
    const cell = get(11, r);
    if (cell.terrain !== "river") {
      if (!cell.features.includes("railway")) cell.features.push("railway");
    }
  }

  // =========================================================================
  // PASS 15: Trails through western forests — military access routes
  // =========================================================================

  // North-south forest trail (col 2, rows 3-20)
  for (let r = 3; r <= 20; r++) {
    const cell = get(2, r);
    if (!cell.features.includes("trail")) cell.features.push("trail");
  }

  // East-west forest trail (row 8, cols 0-5)
  for (let c = 0; c <= 5; c++) {
    const cell = get(c, 8);
    if (!cell.features.includes("trail")) cell.features.push("trail");
  }

  // East-west forest trail (row 16, cols 0-5)
  for (let c = 0; c <= 5; c++) {
    const cell = get(c, 16);
    if (!cell.features.includes("trail")) cell.features.push("trail");
  }

  // =========================================================================
  // PASS 16: Fine-tune specific cells for tactical interest
  // Ensure unit positions have sensible terrain
  // =========================================================================

  // NATO positions — mostly forest/ridgeline defensive terrain in the west,
  // mixed positions in the corridor

  // "10,5" — corridor overwatch, cropland ridge
  {
    const cell = get(10, 5);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 240);
  }

  // "8,7" — west side of corridor
  {
    const cell = get(8, 7);
    cell.elevation = Math.max(cell.elevation, 235);
  }

  // "12,7" — east side of corridor
  {
    const cell = get(12, 7);
    cell.elevation = Math.max(cell.elevation, 245);
  }

  // "6,10" — forest edge defensive position
  {
    const cell = get(6, 10);
    cell.terrain = "forest";
    cell.elevation = Math.max(cell.elevation, 320);
  }

  // "14,10" — eastern blocking position
  {
    const cell = get(14, 10);
    cell.elevation = Math.max(cell.elevation, 275);
  }

  // "10,12" — Fulda city defense
  // Already urban from Fulda city pass

  // "4,14" — deep forest rear position
  {
    const cell = get(4, 14);
    cell.terrain = "forest";
    cell.elevation = Math.max(cell.elevation, 400);
  }

  // "16,14" — eastern flank watch
  {
    const cell = get(16, 14);
    cell.elevation = Math.max(cell.elevation, 290);
  }

  // "10,17" — rear area corridor control
  {
    const cell = get(10, 17);
    cell.elevation = Math.max(cell.elevation, 220);
  }

  // "10,22" — deep rear
  {
    const cell = get(10, 22);
    cell.elevation = Math.max(cell.elevation, 225);
  }

  // Soviet positions — open terrain on eastern edge for armor assembly

  // "17,2" — north assembly
  {
    const cell = get(17, 2);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 310);
  }

  // "19,3" — far east staging
  {
    const cell = get(19, 3);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 350);
  }

  // "18,5" — armor staging
  {
    const cell = get(18, 5);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 330);
  }

  // "19,7" — eastern edge
  {
    const cell = get(19, 7);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 365);
  }

  // "19,1" — far northeast
  {
    const cell = get(19, 1);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 355);
  }

  // "19,14" — east flank south
  {
    const cell = get(19, 14);
    cell.terrain = "grassland";
    cell.elevation = Math.max(cell.elevation, 370);
  }

  // =========================================================================
  // PASS 17: Bare ground — hilltop clearings and exposed ridgelines
  // =========================================================================

  // Exposed hilltop on western ridge (col 1, rows 0-1)
  set(1, 0, "bare_ground", get(1, 0).elevation, [], { ridgeline: "Vogelsberg ridge - exposed" });
  set(0, 0, "bare_ground", get(0, 0).elevation, []);

  // Rocky ground on eastern high point
  set(19, 0, "bare_ground", get(19, 0).elevation, []);
  set(19, 24, "bare_ground", get(19, 24).elevation, []);

  // =========================================================================
  // PASS 18: Final row-edge cleanup
  // North edge (row 0) and south edge (row 24) — open approaches
  // =========================================================================
  for (let c = 7; c <= 13; c++) {
    const cellN = get(c, 0);
    if (cellN.terrain !== "light_urban") cellN.terrain = "grassland";
    const cellS = get(c, 24);
    if (cellS.terrain !== "light_urban") cellS.terrain = "grassland";
  }

  return {
    cols, rows, cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm,
    gridType: "hex",
    center: { lat: 50.55, lng: 9.68 },
    cells,
  };
}
