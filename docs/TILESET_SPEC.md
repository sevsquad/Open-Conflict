# Hex Tileset Specification

## Execution Strategy

### Compositing System (not brute-force permutations)

We do NOT pre-render every terrain+feature combination as a separate tile image.
Instead, each tile is **generated at load time** by compositing layers via Canvas 2D:

```
Layer 1: Base terrain fill (pattern + icons for the terrain type)
Layer 2: Feature channels carved (river bed, road corridor cleared)
Layer 3: Feature drawn into channels (water, road surface, rail ties)
Layer 4: Interaction details (bridges, crossings, tunnel entrances)
Layer 5: Hex border (bold black outline)
```

This means the "art" we need to create is:
- **65 base terrain drawing functions** (each draws its unique pattern/icons)
- **8 linear feature style functions** (river, highway, major road, road, minor road, footpath, railway, light rail)
- **~14 route geometry patterns** (how lines curve through a hex given which edges connect)
- **~10 interaction handlers** (bridge, crossing, tunnel, etc.)

### Rotation Strategy

Hex tiles have 6-fold rotational symmetry. Every route pattern is drawn at a **canonical orientation**, then rotated by N × 60 degrees to match the actual edge configuration. We draw each canonical pattern ONCE — rotation is a canvas transform.

### Art Style Target

Advance Wars / Nintendo Wars inspired:
- **Bright, saturated, flat fills** with 2-3 tones per terrain (base + highlight + shadow)
- **Bold black hex outlines** (2-3px at standard zoom)
- **Simple geometric icons** — triangles for mountains, circles for tree canopies, rectangles for buildings, wavy lines for water
- **Each terrain instantly recognizable at a glance** by color + silhouette
- **Clean, pixel-snapped** — no gradients, no anti-aliasing within the tile art (hex edge blending handled separately by the shader)
- **Consistent icon scale** — trees are the same size whether in forest or park, buildings the same scale in all urban types

---

## Part 1: Base Terrain Catalog (65 types)

Each entry: terrain key, visual family, dominant colors, pattern description, distinguishing icon/detail.

### Water Family (6 types)

| # | Key | Style |
|---|-----|-------|
| 1 | `deep_water` | **Dark navy (#1E4D7A)**. 3-4 horizontal wavy white lines spanning the hex. Darkest water. No land visible. |
| 2 | `coastal_water` | **Medium blue (#3A7CA0)**. Gentler wave lines, slightly lighter. Thin sandy-tan fringe along one edge to suggest shoreline proximity. |
| 3 | `lake` | **Calm blue (#3580A8)**. Very subtle concentric ripple circles from center. Still, reflective feel. Lighter than coastal. |
| 4 | `river` | **Blue-green (#3478A0)**. Flowing chevron pattern (>>>) indicating current direction. Banks visible as thin tan strips on edges. This is for hexes that ARE the river, not hexes a river passes through. |
| 5 | `canal` | **Medium blue (#4888B0)** narrow channel through center. Tan/gray stone banks on both sides. Straight, artificial-looking. Differs from river by being narrow with hard geometric edges. |
| 6 | `dock` | **Blue water (#3870A0)** lower half, **wooden brown** pier/jetty structure upper half. Small boat silhouette. Bollards along edge. |

### Wetland (1 type)

| # | Key | Style |
|---|-----|-------|
| 7 | `wetland` | **Murky olive-green (#4A8B6A)**. Scattered cattail/reed tufts (3-4 thin vertical lines with oval tops). Small blue puddle patches between reeds. Muddy brown undertone. |

### Open Terrain (5 types)

| # | Key | Style |
|---|-----|-------|
| 8 | `open_ground` | **Tan/khaki (#A8B060)**. Very sparse — a few small dirt-colored dots, maybe one tiny rock. The "default" terrain, deliberately plain. |
| 9 | `bare_ground` | **Darker tan (#C0B890)**. Cracked earth pattern (irregular polygonal cracks like dry mud). Completely barren, no vegetation. |
| 10 | `light_veg` | **Light green (#8AA050)**. Small scattered green dots/shrub circles (5-7 tiny dots). More alive than open ground but not lush. |
| 11 | `grassland` | **Vibrant green (#90B848)**. Small V-shaped grass tuft marks scattered across hex (8-10 marks). Lush, healthy. Brightest green of open terrains. |
| 12 | `highland` | **Muted green-brown (#98A068)**. 2-3 gentle contour lines suggesting rolling terrain. Small heather/scrub dots. Elevated but not mountainous. |

### Agriculture (2 types)

| # | Key | Style |
|---|-----|-------|
| 13 | `farmland` | **Yellow-green (#B8C468)**. Diagonal parallel crop row lines (thin alternating green/tan stripes). Distinctly agricultural — instantly reads as "fields." |
| 14 | `allotment` | **Mixed green-brown (#88A048)**. Small rectangular garden plot grid (4-6 tiny rectangles in a grid). Each plot a slightly different shade. Community garden feel. |

### Temperate Forest Family (5 types)

| # | Key | Style |
|---|-----|-------|
| 15 | `forest` | **Medium green (#3D8530)**. 3-4 **round deciduous tree icons** (circle canopy on short trunk line). Moderate spacing, some ground visible between trees. |
| 16 | `dense_forest` | **Dark green (#2D6620)**. 5-6 **overlapping tree canopy circles**, packed tight. Almost no ground visible. Noticeably darker than regular forest. |
| 17 | `mountain_forest` | **Green + brown (#5A8040)**. 2-3 tree icons on top, angular brown/gray slope line underneath. Trees growing ON a mountainside. |
| 18 | `forested_hills` | **Medium green (#4D7838)**. 3-4 tree icons with subtle rolling contour line beneath them. Like forest but with gentle undulation visible. |
| 19 | `urban_trees` | **Bright green (#509030)** with tan path. 3-4 round tree icons with visible **tan walking path** winding between them. Park-like, maintained, not wild. |

### Jungle/Tropical Family (4 types)

| # | Key | Style |
|---|-----|-------|
| 20 | `jungle` | **Very dark green (#1B6B20)**. Dense **palm frond / broadleaf shapes** (not round like temperate). Hanging vine lines. Darkest forest type. Tropical silhouette is key differentiator from temperate forest. |
| 21 | `jungle_hills` | **Dark green (#2A7A30)**. Jungle fronds + visible brown slope contour underneath. |
| 22 | `jungle_mountains` | **Dark green + gray (#1A5A1A)**. Sparse jungle canopy, rocky gray peak visible through foliage. Steepest jungle terrain. |
| 23 | `mangrove` | **Dark green + blue (#3A7A5A)**. Bottom third is blue water with visible **tangled root lines** descending into it. Unique half-water-half-tree appearance. |

### Boreal/Cold Family (5 types)

| # | Key | Style |
|---|-----|-------|
| 24 | `boreal` | **Dark blue-green (#3A7A50)**. 3-4 **pointed conifer/spruce icons** (classic Christmas tree triangle shape). Key differentiator from temperate: triangles instead of circles. |
| 25 | `boreal_hills` | **Darker blue-green (#2A6A40)**. Conifer triangles + rolling contour line underneath. |
| 26 | `boreal_mountains` | **Darkest blue-green + gray (#1A5A30)**. Sparse conifers on gray rocky slope. Snow hints on rocks. |
| 27 | `tundra` | **Pale yellow-green (#B8B090)**. Flat and barren. Tiny scattered lichen patches (small irregular blobs). Frozen, sparse feel. Similar to bare_ground but colder/paler. |
| 28 | `ice` | **White-blue (#D0E0F0)**. Cracked ice pattern (blue cracks on white surface). Crystalline, angular. Brightest terrain type. |

### Arid Family (3 types)

| # | Key | Style |
|---|-----|-------|
| 29 | `desert` | **Sandy tan (#D4C090)**. 2-3 gentle **dune curves** (curved shadow lines). Tiny dot shadows. Warm, dry. |
| 30 | `savanna` | **Yellow-brown (#C0B050)**. Dry grass texture + 1-2 **flat-topped acacia tree silhouettes** (wide umbrella shape). Distinctly African. |
| 31 | `savanna_hills` | **Darker yellow (#A09040)**. Acacia trees + contour slope line. |

### Mountain Family (2 types)

| # | Key | Style |
|---|-----|-------|
| 32 | `mountain` | **Gray-brown (#7A7A6A)**. 2-3 **angular rock face triangles** (classic mountain peak icons). Dark shadow on one side, lighter on the other. Rocky, barren. |
| 33 | `peak` | **White-capped gray (#D0C8B0)**. Single large **snow-capped summit** triangle. White snow on top third, gray rock below. Highest terrain — the iconic mountain peak. |

### Urban Light (4 types)

| # | Key | Style |
|---|-----|-------|
| 34 | `light_urban` | **Tan (#C0B89A)** ground. 3-4 **small house rectangles** scattered with visible green yard spaces between. Low density, residential outskirts. |
| 35 | `suburban` | **Lighter tan (#D0C8A8)**. More organized **rows of small houses** (5-6 tiny rectangles in a grid pattern). Green yards visible. Slightly more structured than light_urban. |
| 36 | `bldg_light` | **Warm tan (#D8C8A0)**. 2-3 **isolated small buildings** on mostly open ground. Very sparse construction. |
| 37 | `bldg_residential` | **Medium tan (#C4A880)**. 4-5 **uniform small houses** in neat rows. Residential neighborhood. Differs from suburban by tighter packing, less yard. |

### Urban Medium (4 types)

| # | Key | Style |
|---|-----|-------|
| 38 | `bldg_commercial` | **Blue-gray (#A0A0B0)**. 3-4 **medium flat-roofed buildings** with one slightly taller. Cooler color tone distinguishes from residential warm tones. |
| 39 | `bldg_institutional` | **Muted rose (#B0A098)**. Single **large building with grounds** — one big rectangle with a small courtyard/lawn. Government/school feel. |
| 40 | `bldg_religious` | **Warm tan (#C8B8A0)**. Building with **steeple/spire icon** pointing up. Small cross or dome shape on top. Instantly recognizable. |
| 41 | `bldg_station` | **Rose-gray (#B8A8A0)**. Building with **flat canopy/platform** extending to one side. Train platform indicator. |

### Urban Heavy (5 types)

| # | Key | Style |
|---|-----|-------|
| 42 | `dense_urban` | **Dark gray (#8A8070)**. **Packed building rectangles** covering 80%+ of hex. Minimal ground visible. Dark rooftops. |
| 43 | `urban_commercial` | **Medium gray (#B0A890)**. **Taller building rectangles** than dense_urban. Slight color variety suggesting shops/offices. Some ground visible. |
| 44 | `urban_industrial` | **Dark warm gray (#9A9080)**. **Factory shapes with smokestacks** — 2-3 buildings with chimney rectangles on top. Heavy, angular, utilitarian. |
| 45 | `urban_dense_core` | **Darkest gray (#706860)**. 2-3 **tall narrow rectangles** (skyscraper silhouettes). Tallest buildings in the game. Downtown/CBD. |
| 46 | `bldg_highrise` | **Blue-gray (#8888A8)**. Single **prominent tall tower** amid 2-3 shorter buildings. The tower stands out. |

### Urban Special (3 types)

| # | Key | Style |
|---|-----|-------|
| 47 | `bldg_industrial` | **Warm gray (#A0988A)**. Single **factory building** with large flat roof + chimney. Simpler than urban_industrial — one building, not a complex. |
| 48 | `bldg_fortified` | **Dark olive (#707060)**. **Thick-walled compound** — heavy rectangle with distinctly thick walls. Military/defensive. Bunker feel. |
| 49 | `bldg_ruins` | **Faded gray (#989080)**. **Broken walls** — jagged irregular shapes suggesting collapsed structures. Rubble dots scattered. Damaged, abandoned. |

### Road Surfaces (as terrain — hex IS the road) (7 types)

| # | Key | Style |
|---|-----|-------|
| 50 | `motorway` | **Light gray (#D0D0D0)**. Wide road surface filling most of hex. **White dashed center line** + **lane markings**. Shoulders visible. |
| 51 | `arterial` | **Medium gray (#C0C0C0)**. Road surface, thinner than motorway. Single center line. Curb edges. |
| 52 | `street` | **Slightly warm gray (#B0B0A8)**. Narrow road + **sidewalk strips** on edges. Residential street feel. |
| 53 | `alley` | **Dark gray (#989890)**. Very narrow path between implied walls. Tight, shadowed. |
| 54 | `road_footpath` | **Tan-gray (#A8A898)**. Thin **paved path** (not a full road). Integrated into ground, no curbs. |
| 55 | `rail_track` | **Gray (#808080)**. **Parallel rail lines with cross-ties** (ladder pattern) running through hex. Gravel bed (lighter gray) underneath. |
| 56 | `tram_track` | **Lighter gray (#909088)**. **Thinner rails embedded in street surface**. Road visible around tracks. Differs from rail_track by being integrated into pavement. |

### Open Paved (3 types)

| # | Key | Style |
|---|-----|-------|
| 57 | `plaza` | **Warm beige (#D8D0C0)**. Large flat paved area. **Central feature** — small fountain circle or statue square. Paving pattern (subtle grid). |
| 58 | `surface_parking` | **Blue-gray (#C0C0C8)**. **Grid of parking space lines**. 2-3 tiny car-shaped rectangles. Very regular pattern. |
| 59 | `rail_yard` | **Dark gray (#888078)**. **Multiple parallel track lines** (3-4 sets of rails). Industrial rail infrastructure. Wider/busier than single rail_track. |

### Open Green (3 types)

| # | Key | Style |
|---|-----|-------|
| 60 | `park` | **Bright green (#90B860)**. Similar to urban_trees but more open. Fewer trees, more grass. Maybe a **small bench or path icon**. |
| 61 | `sports_field` | **Vivid green (#88C050)**. **White line markings** (rectangle outline + center line). Football/soccer pitch pattern. Distinctly artificial. |
| 62 | `cemetery` | **Muted green (#708848)**. Rows of **small gray headstone shapes** (tiny rectangles in orderly rows). Solemn, orderly. |

### Engineering/Special (4 types)

| # | Key | Style |
|---|-----|-------|
| 63 | `bridge_deck` | **Tan-gray (#B8B0A0)**. Road/rail surface with **railing lines on two edges**. Blue water peeking at edges to suggest spanning a gap. Structural. |
| 64 | `ground_embankment` | **Earth brown (#A8A078)**. **Raised earthwork** with sloped sides indicated by diagonal hatching. Retaining wall pattern on one edge. |
| 65 | `underpass` | **Dark gray (#787070)**. Road surface with **dark tunnel arch** at one or both edges. Shadow/darkness at the tunnel mouths. Recessed feel. |
| 66 | `construction_site` | **Orange-tan (#B8A878)**. **Crane icon** (angled line with hook). Orange/yellow hazard stripes. Scaffolding rectangles. Active work zone. |

---

## Part 2: Linear Feature Overlay Styles (8 types)

These are the visual styles for features that PASS THROUGH a hex (drawn on top of the base terrain). Each is drawn as a channel/corridor carved through the terrain, then filled.

### Rivers

| Feature | Width | Color | Pattern | Bank Style |
|---------|-------|-------|---------|------------|
| `river` (feature) | ~22% hex width | Blue (#3AC4E0) | Gentle horizontal wave ripples inside channel | Banks match underlying terrain but slightly darker. In forest: trees stop at bank. In urban: stone/concrete banks. In desert: sandy banks, slightly wider dry bed. In grassland: natural earth. |

### Roads

| Feature | Width | Color | Pattern | Edge Style |
|---------|-------|-------|---------|------------|
| `highway` | ~20% hex width | Dark gray surface, **yellow edge lines** | White dashed center line, solid yellow borders | Paved shoulders on both sides |
| `major_road` | ~16% hex width | Medium gray | Single white dashed center line | Thin curb or gravel shoulder |
| `road` | ~12% hex width | Gray | No center line | Thin edge lines |
| `minor_road` | ~8% hex width | Light gray-brown | No markings | No shoulders, blends into terrain |
| `footpath` | ~5% hex width | Tan/earth brown | **Dashed** (series of short segments) | No edges, organic shape |
| `trail` | ~3% hex width | Faint brown | **Dotted** (sparse dots) | Barely visible, almost invisible |

### Railways

| Feature | Width | Color | Pattern | Detail |
|---------|-------|-------|---------|--------|
| `railway` | ~10% hex width | Gray rails on brown ties | **Cross-tie ladder pattern** — perpendicular brown rectangles between parallel gray lines | Light gray gravel bed ~14% width underneath |
| `light_rail` | ~7% hex width | Lighter gray rails, thinner ties | Same ladder pattern but thinner and lighter | Narrower gravel bed |

---

## Part 3: Route Geometry Patterns (14 canonical shapes)

A hex has 6 edges. Linear features connect edges through the hex center. Each pattern below describes a unique connectivity shape. All other orientations are generated by 60-degree rotation.

Edge numbering: **0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE** (clockwise from East).

### 1-Edge Patterns (Dead Ends)

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `DE` | Edge 0 only | 6 | 6 | Feature enters from one edge, terminates at hex center. River: source/mouth pool at center. Road: cul-de-sac circle at center. Rail: buffer stop icon at center. |

### 2-Edge Patterns (Through Routes)

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `ST` | 0→3 (E→W) | 3 | 3 | **Straight through.** Feature enters one edge, exits the opposite. Clean straight line through hex center. Most common pattern. |
| `WB` | 0→2 (E→NW) | 6 | 6 | **Wide bend.** Gentle S-curve through center. Enters one edge, exits the one two positions away. Smooth flowing curve. |
| `SB` | 0→1 (E→NE) | 6 | 6 | **Sharp bend.** Tight curve near one side of hex. Feature turns sharply. Most dramatic curve. |

### 3-Edge Patterns (Junctions)

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `FAN` | 0,1,2 (E+NE+NW) | 6 | 6 | **Fan/Spread.** Three consecutive edges. Feature fans out from center toward one half of the hex. River: delta/fan. Road: three-way fork. |
| `TW` | 0,1,3 (E+NE+W) | 6 | 6 | **T-junction (wide).** Straight through (E→W) with branch off to NE. Classic T-intersection. Most common junction. |
| `TB` | 0,1,4 (E+NE+SW) | 6 | 6 | **T-junction (bent).** No straight through — all three branches curve. Like a Y but asymmetric. |
| `YE` | 0,2,4 (E+NW+SW) | 2 | 2 | **Y-fork (even).** Three evenly spaced branches (120 degrees apart). Symmetric. River: three-way confluence. Road: roundabout center. |
| `YW` | 0,2,3 (E+NW+W) | 6 | 6 | **Y-fork (wide).** Two branches close together, one opposite. Asymmetric Y. |

### 4-Edge Patterns (Crossroads)

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `X4C` | 0,1,2,3 (four consecutive) | 6 | 6 | **Four consecutive edges.** Dense junction — features spread across one side of hex. Uncommon. |
| `X4G` | 0,1,2,4 (three + gap + one) | 6 | 6 | **Offset crossroads.** Almost a full cross but shifted. |
| `X4P` | 0,1,3,4 (two pairs opposite) | 3 | 3 | **True crossroads.** Two straight-through routes crossing. Most common 4-edge pattern. Classic + intersection. |

### 5-Edge Patterns

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `R5` | 0,1,2,3,4 (all but edge 5) | 6 | 6 | **Five-way junction.** Roundabout center with one missing spoke. Rare. |

### 6-Edge Patterns

| ID | Canonical | Rotations | Total | Description |
|----|-----------|-----------|-------|-------------|
| `R6` | 0,1,2,3,4,5 (all edges) | 1 | 1 | **Six-way hub.** All edges connected. Roundabout or major confluence. Very rare. |

**Route pattern total: 14 canonical shapes → 69 oriented variants per feature type.**

---

## Part 4: Feature Interactions

When two or more linear features share a hex, they interact. These are the interaction rules and the additional art required.

### Bridges (Road/Rail crossing River)

A bridge is drawn whenever a road or rail route CROSSES a river route in the same hex (i.e., their paths intersect, not run parallel).

| Interaction | Visual |
|-------------|--------|
| **Highway over river** | Thick concrete bridge — gray deck with solid railings on both sides. Road surface continues unbroken over water. River visible flowing underneath on both sides of bridge. Shadow under bridge deck. |
| **Major road over river** | Medium stone/concrete bridge. Road continues, lower railings. River visible underneath. |
| **Road over river** | Simple bridge — road surface with thin railing lines. River underneath. |
| **Minor road over river** | Small wooden bridge — brown deck, simple plank railings. Rustic. |
| **Footpath over river** | Narrow footbridge — thin wooden plank with rope/wire railings. Charming. |
| **Railway over river** | Rail bridge — steel truss pattern (X-brace outlines) on sides. Track continues over. Industrial/structural. |
| **Light rail over river** | Lighter version of rail bridge. Thinner structure. |

**Crossing angle matters:**
- **Perpendicular** (routes cross at ~90 degrees): Bridge spans straight across. Clean, symmetric.
- **Diagonal** (routes cross at ~60 degrees): Bridge is angled. Asymmetric abutments.
- **Oblique** (routes cross at ~30 degrees): Long angled bridge. Most dramatic span.
- **Parallel** (routes run alongside): NO bridge. River and road/rail coexist side by side with a bank between them.

Crossing angle is determined by the edge configurations of the two features:
- River ST(0→3) + Road ST(1→4) = perpendicular cross
- River ST(0→3) + Road WB(1→3) = diagonal cross
- River and road sharing an edge pair = parallel, no bridge

### Level Crossings (Road × Railway)

| Interaction | Visual |
|-------------|--------|
| **Any road crossing railway** | White **X-shaped crossing marker** at intersection point. Road surface continues with rail tracks crossing it. Thin red/white striped crossing gate arms on road sides. |
| **Road parallel to railway** | Road and rail run side by side. No crossing marker. Fence line between them. |

### Multi-Feature Junctions

| Situation | Visual |
|-----------|--------|
| **Road through town** (road feature + town feature on same hex) | Road is the central organizing element. Buildings arranged along the road on both sides, facing it. Small sidewalk indicated. Town reads as "road town." |
| **River through town** | River channel cuts through town. Buildings stop at stone/concrete river banks. Maybe a small dock or steps down to water on one side. |
| **Road + river through town** | All three: road with buildings alongside, river with stone banks, and a BRIDGE where road crosses river. Most complex common combination. |
| **Road through forest** | Tree canopy splits to reveal road. Trees line both sides tight against road edge. Road has slight shadow from canopy. |
| **Railway through forest** | Similar to road but with track corridor. Trees slightly further back (rail safety clearance). Embankment visible. |
| **Road through farmland** | Crop rows stop cleanly at road edge. Fields on both sides with different crop orientations for variety. |
| **River through forest** | Trees stop at natural riverbank. Some trees overhang slightly. Natural feel vs. urban's stone banks. |
| **River through desert** | Wider sandy banks. Possible green vegetation strip immediately along banks (oasis effect). River stands out dramatically against sand. |

### Feature-Specific Terrain Modifications

When certain features exist on a hex, the base terrain art adapts:

| Feature | Terrain Modification |
|---------|---------------------|
| `beach` | Sand-colored fringe on water-adjacent edges. Gradual color transition from terrain to sand to water. |
| `cliffs` | **Bold dark line** along one or more edges. Vertical rock face. Dramatic shadow on lower side. |
| `ridgeline` | **Thin ridge line** along center. Terrain is slightly higher in the middle. Subtle highlight. |
| `treeline` | **Row of tree icons** along one or more edges. Trees form a line, not scattered. |
| `hedgerow` | **Dense green hedge line** along edges. Thicker and lower than treeline. Bocage feel. |
| `wall` | **Gray stone wall line** along edges. Thinner than cliffs, man-made. |
| `fence` | **Thin brown fence line** with post dots along edges. Lighter than wall. |
| `slope_steep` | **Diagonal hatching lines** on terrain indicating steep grade. Brown hash marks. |
| `slope_extreme` | **Dense diagonal hatching** + **red-brown color shift**. Warning feel. Steeper than steep. |
| `military_base` | **Perimeter fence rectangle** in hex. Small flag or star icon inside. Dark olive color overlay. |
| `airfield` | **Runway line** (gray stripe with white dashed center) cutting through hex. Flat cleared area. |
| `port` | **Dock/pier structure** extending from land into water edge. Crane icon if space permits. |
| `power_plant` | **Building with cooling tower icon** (hyperbolic shape) or smokestack. Industrial. |
| `dam` | **Gray barrier wall** spanning a river channel. Water level difference visible (higher on one side). |
| `tower` | **Single tall structure icon** (antenna/communications tower). Thin vertical line with cross-bars. |
| `bridge` (feature) | Same as road-over-river bridge, positioned based on linear path data. |
| `town` | 4-6 **small building shapes** in a cluster. Less dense than urban terrain types. Village feel. |
| `building` / `building_dense` / `building_sparse` | Building rectangles at varying densities overlaid on terrain. |
| `parking` | Small **parking grid** overlay. Gray paved area with marked spaces. |
| `tunnel` | **Tunnel entrance arch** at one or two edges. Dark semicircle, road/rail disappears into mountain. |
| `metro_entrance` | **Small staircase icon** descending into ground. Urban. |
| `courtyard` | **Open rectangular area** surrounded by building edges. Enclosed feel. |
| `fortified_structure` | **Thick-walled building** with defensive appearance. Bunker/fortress icon. |
| `saddle` | **Low point between two rises**. Subtle dip indicator on ridgeline. |
| `rough_terrain` | **Scattered rock/debris dots**. Irregular terrain overlay. |

---

## Part 5: Tile Generation Priority (Phased Approach)

### Phase 1: Core Terrains (must-have for a playable tileset)

**Base terrains (20):**
1. `deep_water` — the ocean
2. `coastal_water` — near-shore water
3. `lake` — inland water
4. `river` (terrain) — wide river hex
5. `wetland` — marshes
6. `open_ground` — default/empty
7. `grassland` — basic green
8. `farmland` — agriculture
9. `forest` — standard trees
10. `dense_forest` — thick trees
11. `highland` — rolling hills
12. `mountain` — rocky peaks
13. `peak` — snow-capped summit
14. `desert` — sand
15. `light_urban` — scattered buildings
16. `dense_urban` — city
17. `suburban` — housing
18. `light_veg` — scrubland
19. `ice` — frozen
20. `tundra` — arctic plains

**Linear feature overlays (4):**
1. River channel (all 14 route patterns × rotation)
2. Highway overlay (all 14 route patterns × rotation)
3. Road overlay (all 14 route patterns × rotation)
4. Railway overlay (all 14 route patterns × rotation)

**Interactions (2):**
1. Road-over-river bridge (3 crossing angles)
2. Rail-over-river bridge (3 crossing angles)

**Phase 1 total: 20 terrain artists + 4 feature renderers + 2 interaction handlers**
→ Renders ~20 × 69 × combinations = thousands of unique tile appearances

### Phase 2: Extended Terrains

**Base terrains (16):**
21. `jungle` — tropical forest
22. `jungle_hills`
23. `jungle_mountains`
24. `mangrove` — coastal tropical
25. `boreal` — conifer forest
26. `boreal_hills`
27. `boreal_mountains`
28. `savanna` — dry grassland with acacias
29. `savanna_hills`
30. `mountain_forest` — trees on slopes
31. `forested_hills`
32. `bare_ground` — cracked earth
33. `canal` — artificial waterway
34. `dock` — port structure
35. `urban_trees` / `park` — green space
36. `construction_site` — active building

**Linear feature overlays (4):**
5. Major road overlay
6. Minor road overlay
7. Footpath overlay
8. Light rail overlay

**Interactions (3):**
3. Level crossing (road × rail)
4. Minor bridge variants (footpath, minor road)
5. Parallel features (road alongside river)

### Phase 3: Fine-Grained Urban & Infrastructure

**Base terrains (21):**
37–41. Building types: `bldg_light`, `bldg_residential`, `bldg_commercial`, `bldg_highrise`, `bldg_industrial`
42–44. More buildings: `bldg_institutional`, `bldg_religious`, `bldg_fortified`
45–46. Special buildings: `bldg_ruins`, `bldg_station`
47–49. Urban zones: `urban_commercial`, `urban_industrial`, `urban_dense_core`
50–56. Road surfaces: `motorway`, `arterial`, `street`, `alley`, `road_footpath`, `rail_track`, `tram_track`
57–59. Open paved: `plaza`, `surface_parking`, `rail_yard`

### Phase 4: Feature Overlays & Polish

**Terrain feature overlays (20):**
All feature-specific terrain modifications listed in Part 4:
- `beach`, `cliffs`, `ridgeline`, `treeline`, `hedgerow`
- `wall`, `fence`, `slope_steep`, `slope_extreme`
- `military_base`, `airfield`, `port`, `power_plant`, `dam`
- `tower`, `town`, `building`, `parking`, `tunnel`, `metro_entrance`
- `courtyard`, `fortified_structure`, `saddle`, `rough_terrain`

**Complex interactions:**
- Road-through-town compositing
- River-through-urban compositing
- Road+river+town triple combo
- Feature combinations on forest/desert variants

**Remaining engineering terrains (4):**
60. `bridge_deck`
61. `ground_embankment`
62. `underpass`
63. `sports_field`
64. `cemetery`
65. `allotment`

---

## Part 6: Complete Tile Manifest Count

### Art Assets to Create

| Category | Canonical Pieces | With Rotations |
|----------|-----------------|----------------|
| Base terrain drawing functions | 65 | 65 (no rotation needed) |
| River route patterns | 14 | 69 |
| Highway route patterns | 14 | 69 |
| Major road route patterns | 14 | 69 |
| Road route patterns | 14 | 69 |
| Minor road route patterns | 14 | 69 |
| Footpath route patterns | 14 | 69 |
| Trail route patterns | 14 | 69 |
| Railway route patterns | 14 | 69 |
| Light rail route patterns | 14 | 69 |
| Bridge interactions | ~5 per road type × 3 angles | ~105 |
| Level crossing interactions | 3 angles | ~18 |
| Feature terrain overlays | ~20 | ~20 (edge-aligned, rotate) |
| **TOTAL unique art functions** | **~220** | — |
| **TOTAL renderable tile variants** | — | **Effectively unlimited** (composited on demand) |

### How It Actually Works at Runtime

Each hex's tile is generated by calling:
```
drawTile(terrainType, riverEdges, roadType, roadEdges, railEdges, features, neighbors)
```

This composites the layers and produces a unique tile image. The atlas stores the result. For a 100×100 hex map, that's up to 10,000 unique tiles — but each is generated from the ~220 drawing functions above combined algorithmically.

The atlas texture is generated once when map data loads, then sampled by the shader. Regenerated only when view parameters change (strategic zoom, etc.).

---

## Part 7: Technical Notes

### Tile Resolution
- Recommend **64×64 pixels** per tile for fine hexes, **128×128** for strategic zoom
- At 64px, icons need to be ~8-16px to read clearly
- Bold 2px black outlines scale well

### Canvas 2D Drawing Strategy
Each terrain/feature/interaction is a **pure function**:
```javascript
function drawForest(ctx, size) { /* fills hex with forest art */ }
function drawRiverChannel(ctx, size, entryEdge, exitEdge) { /* carves + fills river */ }
function drawBridge(ctx, size, roadAngle, riverAngle, roadType) { /* draws bridge */ }
```

Rotation is handled by wrapping in `ctx.save(); ctx.rotate(n * Math.PI/3); ... ctx.restore();`

### Color Palette Consistency
All terrain colors should be based on the existing `TC` values in `terrainColors.js` but allowed to shift ±15% for shading/highlighting within the tile art. This keeps the tileset visually consistent with the current color scheme while adding depth.

### Edge Blending
The existing shader edge-blending system can remain active on top of the tiled textures. This gives smooth terrain transitions even with the new art. Alternatively, tiles can include their own 2-3px edge blending margin.
