// ════════════════════════════════════════════════════════════════
// Signal Station — SOF night raid on a hilltop communications relay compound
// 30x40 hex grid, 10m cells (0.01km), elevation 405-518m
//
// Physical map size: 300m × 400m
//
// Layout:
//   Rows 0-5:   Northern rocky ridge (access road enters from off-map)
//   Rows 6-8:   Forest approach, OP North at 15,8
//   Rows 9-13:  Forest slope → cleared zone around compound
//   Rows 14-22: THE COMPOUND (fenced, 100m × 90m)
//   Rows 23-26: Cleared zone south → forest transition
//   Rows 27-33: Dense forest (SOF approach routes)
//   Rows 34-36: SOF staging area
//   Rows 37-38: Stream in valley
//   Row 39:     Valley floor
//
// Compound (cols 11-20, rows 14-22):
//   Row 14:    North fence, north gate at col 15
//   Row 15:    Antenna farm (sat dishes, masts, microwave tower)
//   Row 16:    Guard tower (NW), comms relay (center), ops center, armory
//   Row 17:    Admin, guard quarters (QRF), courtyard, barracks A, latrines
//   Row 18:    Generator, fuel, parking, barracks B (off-duty), mess, water
//   Row 19:    Motor pool, maintenance, supply, equipment, east patrol path
//   Row 20:    South perimeter patrol road
//   Row 21:    South staging / open area
//   Row 22:    South fence, south gate at col 15
// ════════════════════════════════════════════════════════════════

export function generateSignalStationMap() {
  const cols = 30, rows = 40;
  const cellSizeKm = 0.01;
  const cells = {};

  // ── Hilltop center and compound fence bounds ──
  const HX = 15, HY = 19;               // hilltop center
  const CL = 11, CR = 20, CT = 14, CB = 22;  // compound fence (inclusive)

  // ── Deterministic pseudo-noise for natural variation ──
  const noise = (c, r) =>
    Math.sin(c * 3.7 + r * 2.3) * 3 + Math.cos(c * 1.3 + r * 4.1) * 2;

  // ── Elevation model ──
  // Hilltop peaks at 515m (compound area), drops off radially.
  // South slope is steeper (1.3x) — valley below.
  // North slope is gentler (0.8x) — ridge continues.
  // Cleared zone (1-3 hexes from fence) blends compound-edge elevation
  // with natural terrain to prevent cliff-like discontinuities.
  function naturalElev(c, r) {
    const dx = c - HX, dy = r - HY;
    const effDy = dy > 0 ? dy * 1.3 : dy * 0.8;
    const dist = Math.sqrt(dx * dx + effDy * effDy);
    return Math.max(405, Math.min(515, 515 - dist * 3.2 + noise(c, r)));
  }
  function getElev(c, r) {
    // Compound interior: leveled/graded surface, slight N-S slope
    if (c >= CL && c <= CR && r >= CT && r <= CB) {
      return Math.round(513 - (r - CT) * 0.6);
    }
    const natural = naturalElev(c, r);
    // Smoothing in cleared zone: blend compound edge with natural terrain
    // so the graded hilltop transitions gradually to natural slopes
    const fd = fenceDist(c, r);
    if (fd >= 1 && fd <= 3) {
      const nearC = Math.max(CL, Math.min(CR, c));
      const nearR = Math.max(CT, Math.min(CB, r));
      const compEdge = 513 - (nearR - CT) * 0.6;
      const blend = 1 - fd * 0.25;  // fd=1→75%, fd=2→50%, fd=3→25% compound
      return Math.round(compEdge * blend + natural * (1 - blend));
    }
    return Math.round(natural);
  }

  // ── Distance from compound fence (positive = outside, negative = inside) ──
  function fenceDist(c, r) {
    if (c >= CL && c <= CR && r >= CT && r <= CB) return -1;
    const dx = c < CL ? CL - c : c > CR ? c - CR : 0;
    const dy = r < CT ? CT - r : r > CB ? r - CB : 0;
    return Math.max(dx, dy);
  }

  // ── Base terrain for natural areas ──
  function getTerrain(c, r, e) {
    if (c >= CL && c <= CR && r >= CT && r <= CB) return "bare_ground"; // compound fallback

    const fd = fenceDist(c, r);
    if (fd >= 1 && fd <= 2) return "bare_ground";  // cleared kill zone
    if (fd === 3) return "light_veg";               // scrubby transition

    // Valley floor (far south)
    if (r >= 38) return "grassland";
    if (r >= 36 && e < 418) return "grassland";

    // Rocky northern ridge
    if (r <= 2) return (c + r) % 3 === 0 ? "highland" : (c + r) % 2 === 0 ? "bare_ground" : "light_veg";
    if (r <= 5) return (c * 7 + r * 3) % 5 === 0 ? "highland" : (c + r) % 4 === 0 ? "light_veg" : "forest";

    // Scattered variety in the forest
    const h = (c * 7 + r * 13) % 23;
    if (h === 0) return "light_veg";
    if (h === 5 && e > 475) return "highland";
    return "forest";
  }


  // ══════════════════════════════════════════════════════════════
  // STEP 1 — Procedural fill (all 1200 cells)
  // ══════════════════════════════════════════════════════════════
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = getElev(c, r);
      cells[`${c},${r}`] = {
        terrain: getTerrain(c, r, e),
        elevation: e,
        features: [],
        feature_names: null,
      };
    }
  }

  // Override helper
  const set = (c, r, terrain, elev, features = [], fn = null) => {
    cells[`${c},${r}`] = { terrain, elevation: elev, features, feature_names: fn };
  };
  // Add feature without replacing terrain
  const feat = (c, r, ...f) => {
    const cell = cells[`${c},${r}`];
    if (cell) f.forEach(x => { if (!cell.features.includes(x)) cell.features.push(x); });
  };
  const name = (c, r, fn) => { const cell = cells[`${c},${r}`]; if (cell) cell.feature_names = fn; };


  // ══════════════════════════════════════════════════════════════
  // STEP 2 — Access road (col 15, north approach → compound)
  // Gravel road from off-map (north) to the north gate.
  // ══════════════════════════════════════════════════════════════
  for (let r = 0; r <= 13; r++) {
    const e = getElev(15, r);
    set(15, r, "bare_ground", e, ["road"]);
  }
  name(15, 0, "Access Road");

  // Road continues south from south gate through forest
  for (let r = 23; r <= 31; r++) {
    const e = getElev(15, r);
    set(15, r, "bare_ground", e, ["road"]);
  }
  // Road fades to trail past row 31
  for (let r = 32; r <= 36; r++) {
    feat(15, r, "trail");
  }


  // ══════════════════════════════════════════════════════════════
  // STEP 3 — East ridge trail (col 24, N-S)
  // Foot trail along the eastern ridgeline, monitored by OP East.
  // ══════════════════════════════════════════════════════════════
  for (let r = 3; r <= 30; r++) {
    feat(24, r, "trail");
  }
  // Short path from compound east fence to OP East (row 18, cols 21-23)
  feat(21, 18, "trail");
  feat(22, 18, "trail");
  feat(23, 18, "trail");


  // ══════════════════════════════════════════════════════════════
  // STEP 4 — Compound (cols 11-20, rows 14-22)
  // 10 cols × 9 rows = 90 cells, each individually placed.
  // Elevation: graded hilltop, 508-513m ground level.
  // Guard tower at 518m (elevated structure).
  // ══════════════════════════════════════════════════════════════

  // ── Row 14: North fence line ──
  // Chain-link + razor wire. North gate at col 15 (vehicle-width).
  for (let c = CL; c <= CR; c++) {
    if (c === 15) set(c, 14, "street",      512, ["road", "fence"], "North Gate");
    else          set(c, 14, "bare_ground",  512, ["fence"]);
  }

  // ── Row 15: Antenna farm ──
  // Open area with satellite dishes, VHF/UHF masts, microwave relay tower.
  // No tall buildings here — antenna propagation requires clear surroundings.
  set(11, 15, "bare_ground",  513, ["fence"]);
  set(12, 15, "road_footpath", 513, ["military_base"]);                     // west patrol path
  set(13, 15, "bare_ground",  513, ["military_base"], "Satellite Dishes");  // 2 large VSAT dishes on concrete pads
  set(14, 15, "bare_ground",  513, ["military_base"], "VHF/UHF Masts");    // 3 antenna masts, cable trenches
  set(15, 15, "street",       513, ["road"]);                               // internal road, cable duct
  set(16, 15, "bare_ground",  513, ["military_base"], "HF Antenna Field");  // HF wire antenna, grounding rods
  set(17, 15, "bare_ground",  513, ["military_base", "tower"], "Microwave Relay Tower"); // 15m lattice tower
  set(18, 15, "bare_ground",  513, ["military_base"], "Cable Junction");    // outdoor equipment cabinets, cable runs
  set(19, 15, "road_footpath", 513, ["military_base"]);                     // east patrol path
  set(20, 15, "bare_ground",  513, ["fence"]);

  // ── Row 16: Communications & guard tower ──
  // The two most important structures: guard tower (NW) and comms relay (center).
  // Ops center adjacent to comms. Armory near guard positions for quick access.
  set(11, 16, "bare_ground",    513, ["fence"]);
  set(12, 16, "bldg_fortified", 518, ["tower", "building", "military_base"], "Guard Tower");  // PKM MG, spotlight, thermal camera
  set(13, 16, "road_footpath",  513, []);                                                     // paved path from tower
  set(14, 16, "bldg_industrial", 513, ["building", "military_base"], "Comms Relay Building"); // PRIMARY OBJECTIVE — hardened, radio/sat equipment
  set(15, 16, "street",         513, ["road"]);                                               // internal road
  set(16, 16, "bldg_industrial", 513, ["building", "military_base"], "Operations Center");    // C2, maps, radios, monitors
  set(17, 16, "road_footpath",  513, []);                                                     // path
  set(18, 16, "bldg_light",    513, ["building", "military_base"], "Armory");                 // weapons rack, ammo cage, NVGs
  set(19, 16, "road_footpath",  513, []);                                                     // east patrol path
  set(20, 16, "bare_ground",   513, ["fence"]);

  // ── Row 17: Admin, guard quarters, courtyard ──
  // Central cross-road. Courtyard at center for formations and rally point.
  // Guard quarters (QRF) near tower and armory for fast response.
  set(11, 17, "bare_ground",     512, ["fence"]);
  set(12, 17, "bldg_light",     512, ["building", "military_base"], "Admin Building");   // duty officer, paperwork, radios
  set(13, 17, "street",         512, ["road"]);                                          // E-W cross road
  set(14, 17, "bldg_light",     512, ["building", "military_base"], "Guard Quarters");   // QRF bunk room, 8 cots, kitted gear
  set(15, 17, "plaza",          512, ["military_base"], "Central Courtyard");             // flagpole, formation area, rally point
  set(16, 17, "bldg_residential", 512, ["building", "military_base"], "Barracks A");     // 10 bunks
  set(17, 17, "street",         512, ["road"]);                                          // E-W cross road
  set(18, 17, "bldg_light",     512, ["building"], "Latrine Block");                     // toilets, showers
  set(19, 17, "road_footpath",  512, []);                                                // east patrol path
  set(20, 17, "bare_ground",    512, ["fence"]);

  // ── Row 18: Generator, barracks B, mess hall ──
  // Generator building runs 24/7 — diesel noise masks sounds within ~50m (5 hexes).
  // Fuel store adjacent (fire risk but necessary for quick refueling).
  // Barracks B is where the off-duty section sleeps (4 turns to mobilize).
  set(11, 18, "bare_ground",     511, ["fence"]);
  set(12, 18, "bldg_industrial", 511, ["building", "military_base"], "Generator Building"); // 50kW diesel gen, 24/7, NOISE SOURCE
  set(13, 18, "bldg_light",     511, ["building"], "Fuel Store");                           // 2000L diesel tank, jerry cans, fire extinguisher
  set(14, 18, "surface_parking", 511, ["parking"], "Vehicle Bay");                          // 2 spots near fuel
  set(15, 18, "street",         511, ["road"]);                                             // internal road
  set(16, 18, "bldg_residential", 511, ["building", "military_base"], "Barracks B");        // OFF-DUTY SECTION sleeps here, 10 bunks
  set(17, 18, "bldg_light",     511, ["building"], "Mess Hall");                            // kitchen, dining, food stores
  set(18, 18, "bldg_light",     511, ["building"], "Water Pump House");                     // storage tank, pump, filtration
  set(19, 18, "road_footpath",  511, ["trail"]);                                              // east patrol path → connects to east gate
  set(20, 18, "road_footpath",  511, ["fence", "trail"], "East Personnel Gate");              // small gate for OP East access

  // ── Row 19: Motor pool, supply, equipment ──
  // Vehicles parked near south gate for quick dispatch.
  // Supply warehouse and equipment storage for logistics.
  set(11, 19, "bare_ground",     510, ["fence"]);
  set(12, 19, "surface_parking", 510, ["parking", "military_base"], "Motor Pool");  // 2 pickups, 1 APC
  set(13, 19, "surface_parking", 510, ["parking"], "Motor Pool");                   // turnaround space
  set(14, 19, "bldg_light",     510, ["building"], "Maintenance Shed");             // tools, vehicle parts, jack
  set(15, 19, "street",         510, ["road"]);                                     // internal road
  set(16, 19, "bldg_light",     510, ["building"], "Supply Warehouse");             // MREs, water, replacement parts
  set(17, 19, "bldg_light",     510, ["building"], "Equipment Storage");            // tools, wire, sandbags
  set(18, 19, "plaza",          510, [], "Open Yard");                              // open paved area
  set(19, 19, "road_footpath",  510, ["military_base"], "East Perimeter Path");     // ROVING PATROL walks here
  set(20, 19, "bare_ground",    510, ["fence"]);

  // ── Row 20: South perimeter patrol road ──
  // Interior road running E-W along the south side. Guards walk this circuit.
  set(11, 20, "bare_ground",  509, ["fence"]);
  for (let c = 12; c <= 14; c++) set(c, 20, "road_footpath", 509, ["military_base"]);
  set(15, 20, "street",       509, ["road"]);
  for (let c = 16; c <= 19; c++) set(c, 20, "road_footpath", 509, ["military_base"]);
  set(20, 20, "bare_ground",  509, ["fence"]);

  // ── Row 21: South open area (inside fence) ──
  // Assembly/staging area, overflow parking, clear field of fire from fence.
  set(11, 21, "bare_ground", 509, ["fence"]);
  set(12, 21, "bare_ground", 509, ["military_base"]);
  set(13, 21, "plaza",       509, ["helipad", "military_base"], "Helipad / LZ");  // marked circle for resupply/medevac helo
  set(14, 21, "bare_ground", 509, ["military_base"]);
  set(15, 21, "street",      509, ["road"]);
  for (let c = 16; c <= 19; c++) set(c, 21, "bare_ground", 509, ["military_base"]);
  set(20, 21, "bare_ground", 509, ["fence"]);

  // ── Row 22: South fence line ──
  // South gate at col 15 — main vehicle entrance with barrier arm.
  for (let c = CL; c <= CR; c++) {
    if (c === 15) set(c, 22, "street",      508, ["road", "fence"], "South Gate");
    else          set(c, 22, "bare_ground",  508, ["fence"]);
  }


  // ══════════════════════════════════════════════════════════════
  // STEP 5 — Stream (row 37, cols 7-23)
  // Narrow stream winding through the valley floor.
  // Bridge where the access road/trail crosses at col 15.
  // ══════════════════════════════════════════════════════════════
  for (let c = 7; c <= 23; c++) {
    const e = getElev(c, 37);
    const streamElev = Math.min(e, 410);
    if (c === 15) {
      set(c, 37, "bare_ground", streamElev + 2, ["river", "bridge"], "Stream Bridge");
    } else {
      set(c, 37, "wetland", streamElev, ["river"]);
    }
  }


  // ══════════════════════════════════════════════════════════════
  // STEP 6 — Named features & observation posts
  // ══════════════════════════════════════════════════════════════

  // OP North — sandbagged position on the access road, 60m north of fence.
  // 2 guards, one Gen 2 NVG, trip-wire flare across the road.
  set(15, 8, "light_veg", getElev(15, 8), ["road", "fortified_structure"], "OP North");

  // OP East — observation post on the ridge trail, 40m east of fence.
  // 2 guards, one Gen 2 NVG, trip-wire flare on the trail.
  set(24, 18, "light_veg", getElev(24, 18), ["trail", "fortified_structure"], "OP East");

  // SOF overwatch position — slight clearing in the treeline SW of compound.
  // Support team chose this spot for its uphill sightline through a canopy gap
  // to the guard tower (~120m diagonal). Thermal scope can see through thin cover.
  set(7, 25, "light_veg", getElev(7, 25), [], "SOF Overwatch Position");

  // SOF ORP — Objective Rally Point, 70m south of the compound in dense forest.
  name(17, 29, "ORP — Assault Alpha");
  name(18, 29, "ORP — Assault Bravo");

  // SOF blocking positions
  name(14, 6, "SOF North Blocking Pos");
  name(25, 19, "SOF East Blocking Pos");


  return {
    cols, rows, cellSizeKm,
    widthKm: cols * cellSizeKm,   // 0.30 km = 300m
    heightKm: rows * cellSizeKm,  // 0.40 km = 400m
    gridType: "hex",
    center: { lat: 37.5, lng: 44.0 },
    cells,
  };
}
