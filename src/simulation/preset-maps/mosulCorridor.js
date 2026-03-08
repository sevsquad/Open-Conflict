// ════════════════════════════════════════════════════════════════
// MOSUL CORRIDOR — Coalition push through urban fringe, Jan 2017
// 60x65 hex grid, 100m cells (6km × 6.5km), elevation 220-285m
//
// Eastern Mosul fringe: dense urban north (ISIS defense zone),
// contested suburban center, open farmland south (Coalition staging),
// Tigris River along eastern edge.
//
// Procedurally generated with deterministic seeded pseudo-random.
// Named landmarks placed explicitly after base terrain fill.
// ════════════════════════════════════════════════════════════════

export function generateMosulCorridorMap() {
  const cols = 60, rows = 65;
  const cellSizeKm = 0.1;
  const cells = {};

  // ── Deterministic hash for pseudo-random terrain variation ──
  // Returns 0..1 for any (col, row) pair, same result every time.
  // Used to vary urban density, farmland placement, etc.
  const hash = (c, r) => {
    let h = (c * 374761393 + r * 668265263 + 7) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
  };

  // ── Elevation model ──
  // Flat Mesopotamian plain, gentle west-to-east slope toward Tigris.
  // River at ~220m, western edge ~280m. Slight N-S undulation.
  const getElev = (c, r) => {
    const eastSlope = (c / cols) * 50;            // 0-50m drop west→east
    const nsWave = Math.sin(r * 0.08) * 4;        // gentle N-S undulation
    const noise = Math.sin(c * 0.7 + r * 0.3) * 3 // micro-variation
                + Math.cos(c * 0.3 - r * 0.5) * 2;
    return Math.round(282 - eastSlope + nsWave + noise);
  };

  // ── Urban density probability by row ──
  // Row 0 = north (ISIS stronghold), Row 64 = south (Coalition staging)
  //   Rows  0-15: dense urban core  (80-90% built-up)
  //   Rows 16-30: urban fringe      (55%→30%, fading south)
  //   Rows 31-45: suburban scatter   (15%→5%)
  //   Rows 46-64: open farmland      (2-3%)
  const urbanProb = (r) => {
    if (r <= 15) return 0.85;
    if (r <= 30) return 0.55 - (r - 15) * 0.025;   // 0.55 → 0.175
    if (r <= 45) return 0.15 - (r - 30) * 0.007;    // 0.15 → 0.045
    return 0.03;
  };

  // ═══════════════════════════════════════════════════════════════
  // PASS 1: Base terrain fill — every cell gets zone-appropriate type
  // ═══════════════════════════════════════════════════════════════
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const elev = getElev(c, r);
      const rnd = hash(c, r);

      // Tigris River — eastern 4 columns (cols 56-59)
      if (c >= 56) {
        cells[`${c},${r}`] = {
          terrain: "river", elevation: 220,
          features: ["river"], feature_names: "Tigris River",
        };
        continue;
      }

      // Riverbank — transitional wetland/vegetation strip (cols 53-55)
      if (c >= 53) {
        const t = rnd < 0.4 ? "wetland" : "light_veg";
        const fn = rnd < 0.25 ? "Riverbank reeds" : null;
        cells[`${c},${r}`] = {
          terrain: t, elevation: 225 + (55 - c) * 5,
          features: [], feature_names: fn,
        };
        continue;
      }

      // Main terrain: urban vs farmland vs grassland based on zone
      const up = urbanProb(r);
      let terrain, features = [], fn = null;

      if (rnd < up) {
        // Urban cell — dense_urban only in core zone with high density
        terrain = (r <= 15 && rnd < up * 0.35) ? "dense_urban" : "light_urban";
        features.push("building");
      } else if (r > 30 && rnd < up + 0.30) {
        // Farmland in suburban/open areas
        terrain = "farmland";
        if (hash(c + 100, r) < 0.3) fn = "Irrigated field";
      } else {
        terrain = "grassland";
        // Southern zone: more farmland
        if (r > 45 && hash(c + 200, r) > 0.45) {
          terrain = "farmland";
          const crops = ["Wheat field", "Barley field", "Irrigated field"];
          fn = crops[Math.floor(hash(c + 300, r) * 3)];
        }
      }

      cells[`${c},${r}`] = { terrain, elevation: elev, features, feature_names: fn };
    }
  }

  // ── Helpers ──
  const set = (c, r, terrain, elevation, features = [], featureNames = null) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    cells[`${c},${r}`] = { terrain, elevation, features, feature_names: featureNames };
  };

  const addFeat = (c, r, ...feats) => {
    const k = `${c},${r}`;
    const cell = cells[k];
    if (!cell || cell.terrain === "river" || cell.terrain === "wetland") return;
    feats.forEach(f => { if (!cell.features.includes(f)) cell.features.push(f); });
  };

  // ═══════════════════════════════════════════════════════════════
  // PASS 2: Irrigation canal — N-S along col 45, rows 20-64
  // Feeds farmland south of urban zone. Cuts through any terrain.
  // ═══════════════════════════════════════════════════════════════
  for (let r = 20; r < rows; r++) {
    const cell = cells[`45,${r}`];
    if (cell && cell.terrain !== "river") {
      cell.features = cell.features.filter(f => f !== "building");
      if (!cell.features.includes("river")) cell.features.push("river");
      // Convert urban cells over canal to grassland
      if (cell.terrain === "light_urban" || cell.terrain === "dense_urban") {
        cell.terrain = "grassland";
      }
      cell.feature_names = "Irrigation canal";
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PASS 3: Named landmarks — specific cells set explicitly
  // ═══════════════════════════════════════════════════════════════

  // Coalition Outpost — besieged, deep in urban core (the objective)
  set(30, 5, "light_urban", 268, ["building", "fence", "military_base"], "Coalition Outpost");
  set(31, 5, "light_urban", 268, ["building", "fence"], "Outpost perimeter");
  set(30, 6, "light_urban", 268, ["building"], "Outpost supply yard");

  // Al-Salam Hospital — ROE restricted zone
  set(18, 10, "light_urban", 272, ["building"], "Al-Salam Hospital (ROE restricted)");
  set(19, 10, "light_urban", 272, ["building"], "Hospital annex");
  set(18, 11, "grassland",   271, [], "Hospital courtyard");

  // Al-Nuri Mosque — ROE restricted zone
  set(35, 8, "light_urban", 262, ["building"], "Al-Nuri Mosque (ROE restricted)");
  set(36, 8, "light_urban", 262, ["building"], "Mosque courtyard");

  // Government complex — hardened
  set(20, 3, "dense_urban", 275, ["building", "fence"], "Government building");
  set(21, 3, "dense_urban", 275, ["building"], "Government annex");

  // Central market — contested zone
  set(25, 22, "light_urban", 260, ["building"], "Central market");
  set(26, 22, "light_urban", 260, ["building"], "Market stalls");
  set(25, 23, "grassland",   260, [], "Market square");

  // University campus — eastern urban fringe
  set(40, 14, "light_urban", 252, ["building", "fence"], "University campus");
  set(41, 14, "light_urban", 252, ["building"], "University hall");
  set(40, 15, "grassland",   252, [], "University grounds");

  // Tigris bridge — E-W road crossing at row 30
  set(54, 30, "light_urban", 228, ["bridge", "major_road"], "Tigris bridge (east approach)");
  set(55, 30, "river", 220, ["river", "bridge", "major_road"], "Tigris bridge");

  // Parks / open spaces in urban core (break up building monotony)
  set(15, 6,  "grassland", 275, [], "Al-Tahrir Park");
  set(16, 6,  "grassland", 275, [], "Park grounds");
  set(16, 7,  "grassland", 274, [], "Park south");
  set(22, 12, "grassland", 268, [], "Small park");
  set(38, 5,  "grassland", 258, [], "Playground");
  set(10, 20, "grassland", 270, [], "Vacant lot");
  set(28, 17, "bare_ground", 265, [], "Rubble field");
  set(33, 25, "bare_ground", 258, [], "Collapsed building");
  set(46, 10, "grassland", 250, [], "School yard");

  // Walled compounds in suburban zone
  set(15, 38, "light_urban", 258, ["building", "fence"], "Walled compound");
  set(30, 42, "light_urban", 252, ["building", "fence"], "Farm compound");
  set(20, 50, "light_urban", 248, ["building"], "Roadside compound");
  set(42, 48, "light_urban", 246, ["building"], "Roadside shack");

  // ═══════════════════════════════════════════════════════════════
  // PASS 4: Road network
  //   - 3 major N-S arterials (major_road): cols 12, 25, 40
  //   - 2 major E-W arterials (major_road): rows 10, 25
  //   - E-W suburban connector (road): row 45
  //   - E-W road to Tigris bridge: row 30
  //   - Secondary streets in urban zone
  //   - Suburban N-S connectors
  // ═══════════════════════════════════════════════════════════════

  // Major N-S arterials — full map length
  for (const col of [12, 25, 40]) {
    for (let r = 0; r < rows; r++) addFeat(col, r, "major_road");
  }

  // Major E-W arterials — across urban+suburban zone (stop before riverbank)
  for (const row of [10, 25]) {
    for (let c = 0; c < 53; c++) addFeat(c, row, "major_road");
  }

  // E-W suburban connector road (row 45)
  for (let c = 0; c < 53; c++) addFeat(c, 45, "road");

  // E-W road to Tigris bridge (row 30, eastern extension)
  for (let c = 40; c <= 54; c++) addFeat(c, 30, "major_road");

  // Secondary N-S streets in urban zone (rows 0-30)
  for (const col of [6, 18, 32, 47]) {
    for (let r = 0; r <= 30; r++) addFeat(col, r, "road");
  }

  // Secondary E-W streets in dense urban (rows 0-15)
  for (const row of [3, 8, 13]) {
    for (let c = 0; c < 53; c++) addFeat(c, row, "road");
  }

  // E-W connector streets in urban fringe (rows 16-30)
  for (const row of [18, 22, 28]) {
    for (let c = 0; c < 53; c++) addFeat(c, row, "road");
  }

  // Suburban N-S connectors (rows 30-64, arterial columns only)
  for (const col of [12, 25, 40]) {
    for (let r = 30; r < rows; r++) addFeat(col, r, "road");
  }

  // ═══════════════════════════════════════════════════════════════
  // PASS 5: Battle damage in contested zone (rows 16-30)
  // Some urban cells are destroyed — rubble/bare ground
  // ═══════════════════════════════════════════════════════════════
  for (let r = 16; r <= 30; r++) {
    for (let c = 0; c < 53; c++) {
      if (hash(c + 500, r + 500) < 0.05) {
        const cell = cells[`${c},${r}`];
        if (cell && (cell.terrain === "light_urban" || cell.terrain === "dense_urban")) {
          cell.terrain = "bare_ground";
          cell.features = cell.features.filter(f => f !== "building");
          cell.feature_names = "Rubble";
        }
      }
    }
  }

  return {
    cols, rows, cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm,
    gridType: "hex",
    center: { lat: 36.35, lng: 43.13 },
    cells,
  };
}
