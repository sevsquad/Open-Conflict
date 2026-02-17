# Map System Rewrite Plan

## Problem Statement

The current map rendering system (16 files in `src/mapRenderer/`, plus `Viewer.jsx` and `SimMap.jsx`) has fundamental issues:

- **Hex geometry/alignment bugs**: Chunk boundary seams, off-by-one stagger issues in viewport auto-fit, tile positioning uses approximate offsets (`screenPos.x - size, screenPos.y - size`) that cause visible gaps
- **Feature rendering**: Roads/rivers drawn as separate screen-space overlays that don't align with chunk-cached terrain tiles during panning; feature insets use horizontal banding that looks nonsensical
- **Visual design**: 4 completely separate rendering codepaths (Strategic/Operational/Tactical/Closeup) with inconsistent visual language and jarring transitions between tiers; terrain blending only exists in Tier 3 (Closeup), flat colors everywhere else
- **Architecture**: Duplicated `getFeats()` helper in 5 files; Viewer and SimMap are near-identical 887-line and 285-line wrappers with divergent event handling; Canvas 2D pixel-by-pixel blending in `TerrainBlend.js` is slow

## Architecture Overview

Replace the Canvas 2D tile-chunk system with a WebGL2 instanced-rendering pipeline. Every hex cell becomes a GPU instance with terrain type, elevation, and feature data encoded as vertex attributes. The GPU handles terrain coloring, elevation shading, terrain-edge blending, and feature overlays in fragment shaders — eliminating the 4-tier split, the tile cache, and the per-pixel JS blending.

Canvas 2D is retained as a transparent overlay for text labels, coordinate grids, and unit markers (text rendering in WebGL is not worth the complexity).

```
Parser output (mapData)
        │
        ▼
┌─────────────────────────────────┐
│  HexGPUData (new)               │  One-time: pack cell data into
│  - vertex buffer (hex geometry)  │  typed arrays / GPU buffers
│  - instance buffer (per-cell)    │
│  - feature line buffer           │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  HexGLRenderer (new)            │  WebGL2 render loop
│  - terrain pass (instanced hex) │  - Single draw call for all hexes
│  - feature pass (lines/icons)   │  - Zoom-continuous (no tier jumps)
│  - selection pass (highlights)  │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Canvas2D overlay               │  Text labels, coords, units
│  (LabelOverlay, UnitOverlay)    │  Drawn on transparent canvas
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  MapView (new, shared)          │  Single React component replaces
│  - Used by Viewer and SimMap    │  both Viewer.jsx and SimMap.jsx
│  - Props control mode/features  │
└─────────────────────────────────┘
```

## Detailed Plan

### Phase 1: Core WebGL Hex Renderer

**New files:**
- `src/mapRenderer/gl/HexGLRenderer.js` — WebGL2 context, render loop, shader management
- `src/mapRenderer/gl/HexGeometry.js` — hex mesh generation (single hex → instanced)
- `src/mapRenderer/gl/HexGPUData.js` — pack mapData.cells into GPU buffers
- `src/mapRenderer/gl/shaders/hex.vert.glsl` — vertex shader (instanced hex positioning)
- `src/mapRenderer/gl/shaders/hex.frag.glsl` — fragment shader (terrain color, blending, elevation)

**How it works:**

1. **Hex mesh**: One pointy-top hexagon as 6 triangles (fan from center). This is the "template" geometry, drawn once.

2. **Instance data**: For each cell `(col, row)`, pack into a float32 instance buffer:
   - `col, row` (position — vertex shader computes pixel position from these)
   - `terrainIndex` (0–17, maps to terrain color via uniform array)
   - `elevation` (meters, for shading)
   - `featureMask` (bitmask of which features are present, up to 32 features)
   - `neighborTerrainIndices[6]` (for edge blending in fragment shader)

3. **Vertex shader**: Takes the template hex vertex + instance data. Computes screen position using the viewport uniforms (centerCol, centerRow, cellPixels, canvasSize). Outputs `v_terrainIndex`, `v_elevation`, `v_hexLocalPos` (position within hex, -1 to 1), `v_neighborTerrains[6]`.

4. **Fragment shader**:
   - Base terrain color from `v_terrainIndex` lookup
   - Edge blending: use `v_hexLocalPos` to compute distance to each of 6 edges; blend toward neighbor color within a margin (replaces the entire `TerrainBlend.js` per-pixel loop)
   - Elevation shading: directional light based on elevation gradients (replaces `applyElevationShading`)
   - Feature tinting: use `v_featureMask` + active feature uniform to modulate color
   - Hex grid lines: draw border when `v_hexLocalPos` is near edge (width scales with zoom)

5. **Viewport uniforms** (updated every frame, no buffer rebuild):
   - `u_centerCol, u_centerRow, u_cellPixels` (viewport state)
   - `u_canvasSize` (width, height)
   - `u_terrainColors[18]` (vec3 array)
   - `u_activeFeatures` (uint bitmask)
   - `u_gridOpacity` (scales with zoom)

**Key advantage**: The entire terrain grid is ONE draw call (`gl.drawArraysInstanced`). No chunks, no tile cache, no progressive loading. For a 200x200 map that's 40,000 instances — trivial for a GPU.

### Phase 2: Linear Features (Roads, Rails, Waterways)

**New files:**
- `src/mapRenderer/gl/LineRenderer.js` — GPU line rendering for roads/rails/waterways
- `src/mapRenderer/gl/shaders/line.vert.glsl` / `line.frag.glsl`

**How it works:**

1. Reuse the existing `buildLinearNetworks()` BFS from `RoadNetwork.js` to get segments
2. Pack segments into a line vertex buffer: each segment = 2 vertices with `(col, row, lineType, lineWidth)`
3. Vertex shader converts grid coords to screen space (same viewport uniforms)
4. Fragment shader colors by line type, applies dash patterns via `gl_FragCoord`, respects active feature filter
5. Line width scales continuously with zoom (no tier-based width table)

### Phase 3: Canvas 2D Overlay Layer

**Modified files:**
- `src/mapRenderer/overlays/LabelOverlay.js` — keep, minor refactor (remove gridToScreen dependency, use new viewport math)
- `src/mapRenderer/overlays/UnitOverlay.js` — keep, simplify (remove 4-tier split, single continuous scaling)
- `src/mapRenderer/overlays/SelectionOverlay.js` — keep, adapt to new viewport

**How it works:**

A second `<canvas>` element sits on top of the WebGL canvas with `position: absolute` and transparent background. Each frame, after WebGL renders terrain + features, the 2D overlay canvas draws:
- Name labels (with existing collision detection)
- Coordinate labels
- Unit markers (continuous scaling instead of 4 discrete tiers)
- Hover/selection highlights

The overlay canvas shares the same viewport state and uses the same `hexToScreen()` math from `HexMath.js` (which is kept as-is — the hex math itself is correct).

### Phase 4: Unified MapView Component

**New files:**
- `src/mapRenderer/MapView.jsx` — single React component replacing both Viewer and SimMap wrappers

**Modified files:**
- `src/Viewer.jsx` — becomes thin wrapper: `<MapView mode="viewer" ... />`
- `src/simulation/SimMap.jsx` — becomes thin wrapper: `<MapView mode="sim" ... />`

**How `MapView` works:**

```jsx
<MapView
  mapData={terrainData}           // from parser
  mode="viewer" | "sim"           // controls which overlays render
  units={units}                   // sim mode only
  actors={actors}                 // sim mode only
  activeFeatures={Set}            // viewer mode: filterable; sim mode: all
  onCellClick={fn}                // interaction callback
  onCellHover={fn}                // interaction callback
  interactionMode="navigate"|"place_unit"
  selectedUnitId={string}
  ghostUnit={object}
/>
```

Internally:
- Creates WebGL canvas + overlay Canvas2D, stacked
- Manages viewport state (pan, zoom) — single implementation, not duplicated
- Dispatches to `HexGLRenderer` for terrain, `LineRenderer` for features
- Dispatches to overlay functions for labels/units/selection
- Handles mouse/wheel/keyboard input once

### Phase 5: Cleanup — Delete Old System

**Files to delete:**
- `src/mapRenderer/MapRenderer.js` (replaced by `HexGLRenderer`)
- `src/mapRenderer/TileCache.js` (no longer needed — no tile caching)
- `src/mapRenderer/TerrainBlend.js` (blending now in fragment shader)
- `src/mapRenderer/tiers/StrategicRenderer.js`
- `src/mapRenderer/tiers/OperationalRenderer.js`
- `src/mapRenderer/tiers/TacticalRenderer.js`
- `src/mapRenderer/tiers/CloseupRenderer.js`

**Files kept (possibly modified):**
- `src/mapRenderer/HexMath.js` — core hex math is correct, keep as-is
- `src/mapRenderer/ViewportState.js` — viewport math is correct, keep (remove chunk-related functions)
- `src/mapRenderer/RoadNetwork.js` — BFS network building is correct, keep `buildLinearNetworks()`; remove `drawLinearFeatures()` (replaced by GPU `LineRenderer`)
- `src/mapRenderer/overlays/LabelOverlay.js` — keep, adapt
- `src/mapRenderer/overlays/UnitOverlay.js` — keep, simplify from 4 tiers to continuous
- `src/mapRenderer/overlays/SelectionOverlay.js` — keep, adapt
- `src/mapRenderer/overlays/GridOverlay.js` — delete (grid lines now in hex fragment shader)
- `src/terrainColors.js` — keep as-is (shared color source of truth)

## Implementation Order

| Step | What | Est. Lines | Depends On |
|------|------|-----------|------------|
| 1 | `HexGeometry.js` — hex mesh + instance buffer layout | ~80 | — |
| 2 | `hex.vert.glsl` + `hex.frag.glsl` — terrain + blending + grid shaders | ~200 | — |
| 3 | `HexGPUData.js` — pack mapData into GPU buffers | ~120 | 1 |
| 4 | `HexGLRenderer.js` — WebGL2 context, shader compilation, render loop | ~250 | 1, 2, 3 |
| 5 | `line.vert.glsl` + `line.frag.glsl` + `LineRenderer.js` — road/rail GPU lines | ~180 | 4 |
| 6 | `MapView.jsx` — unified React component with dual canvas stack | ~300 | 4, 5 |
| 7 | Adapt overlay files (LabelOverlay, UnitOverlay, SelectionOverlay) | ~100 delta | 6 |
| 8 | Refactor `Viewer.jsx` and `SimMap.jsx` to thin wrappers | ~100 delta | 6 |
| 9 | Delete old files (7 files), clean up ViewportState/RoadNetwork | —  | 8 |
| 10 | PNG export path (render WebGL to OffscreenCanvas for download) | ~60 | 4 |

## Key Design Decisions

1. **No tile caching**: GPU instanced rendering is fast enough to redraw 40k+ hexes every frame at 60fps. Eliminates the entire category of chunk-boundary and cache-invalidation bugs.

2. **Continuous LOD instead of 4 tiers**: Grid line width, label visibility, unit marker size, and feature detail all scale smoothly with `cellPixels`. No discrete tier boundaries means no visual jumps during zoom.

3. **Neighbor terrain in instance data**: Each cell stores its 6 neighbor terrain indices so the fragment shader can do edge blending without texture lookups. This costs 6 extra floats per instance (~960KB for a 200x200 map) but eliminates the most expensive part of the old system.

4. **Labels/units stay Canvas 2D**: Text rendering, collision detection, and complex vector icons (NATO symbols) are better suited to Canvas 2D than WebGL. The transparent overlay approach is standard practice (e.g. Mapbox GL, deck.gl).

5. **Feature bitmask**: With ~40 feature types, a uint32 bitmask per cell lets the shader test feature presence in one instruction. The active-feature filter is a uniform bitmask ANDed with the per-cell mask.

6. **No new dependencies**: WebGL2 is native. No Three.js, no deck.gl, no PIXI. Keeps the bundle small and the system self-contained.

## Risk Mitigation

- **WebGL2 availability**: WebGL2 is supported in all modern browsers (98%+ coverage). Fallback to the old Canvas 2D system is possible but not planned unless specifically requested.
- **Shader complexity**: The fragment shader does blending + elevation + grid + features in one pass. If this causes issues on low-end GPUs, the blending can be simplified to a 2-neighbor approximation.
- **Large maps (500x500+)**: 250k instances is still well within GPU capability. If needed, frustum culling can skip off-screen instances, but the GPU handles this naturally via clip space.
