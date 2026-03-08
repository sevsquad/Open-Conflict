#version 300 es
precision highp float;

// ═══════════════════════════════════════════════════════════
// Hex Fragment Shader — terrain color, edge blending,
// elevation shading, grid lines, feature tinting
// ═══════════════════════════════════════════════════════════

// From vertex shader
in vec2 v_hexLocal;              // position within hex (-1..1 range)
flat in float v_terrainIndex;
flat in float v_elevation;
flat in float v_featureMask;
flat in float v_infraIndex;
flat in vec4 v_neighbors03;
flat in vec2 v_neighbors45;
flat in vec4 v_neighborElev03;
flat in vec2 v_neighborElev45;

// Uniforms
// NOTE: when adding terrain types, update BOTH this array size AND the bounds check in terrainColor()
uniform vec3 u_terrainColors[66];   // RGB for each terrain type (30 base + 36 urban/fine-grained)
uniform float u_cellPixels;         // current zoom level
uniform uint u_activeFeatures;      // bitmask of enabled features
uniform vec3 u_featureColor;        // tint color for active features (simplified)
uniform float u_gridOpacity;        // 0.0 = no grid, 1.0 = full grid

// Elevation visualization uniforms
uniform bool u_showElevBands;
uniform float u_elevMin;
uniform float u_elevMax;
uniform float u_contourInterval;    // meters between contour lines
uniform float u_hillshadeStrength;  // 0.0 to 1.0

// Strategic atlas uniforms (Phase 3: multi-scale rendering)
// When u_useAtlas is true, the base terrain color is sampled from a texture
// atlas instead of the u_terrainColors uniform array. v_infraIndex is
// repurposed as the atlas tile index. Neighbor blending, hillshade,
// contours, and grid lines still work procedurally on top.
uniform bool u_useAtlas;
uniform sampler2D u_atlas;
uniform float u_atlasGridCols;   // tile columns in atlas
uniform vec2 u_atlasSize;        // atlas dimensions in pixels
uniform float u_atlasTileSize;   // content pixels per tile (e.g., 64)
uniform float u_atlasStride;     // stride per tile (tileSize + 2*padding)

out vec4 fragColor;

const float SQRT3 = 1.7320508;
const float PI = 3.14159265;

// Pointy-top hex edge normals (inward-pointing) for unit hex
// Edge i: vertex[i] → vertex[(i+1)%6], where vertex angle = 60*i - 30 deg
vec2 edgeNormal(int i) {
    // Pre-computed inward normals for pointy-top hex
    // Edge 0: from -30deg to 30deg → normal points down-left-ish
    float a0 = PI / 180.0 * (60.0 * float(i) - 30.0);
    float a1 = PI / 180.0 * (60.0 * float(i + 1) - 30.0);
    float ex = cos(a1) - cos(a0);
    float ey = sin(a1) - sin(a0);
    float len = sqrt(ex * ex + ey * ey);
    return vec2(-ey / len, ex / len);
}

// Signed distance from point to hex edge (positive = inside)
float edgeDist(vec2 p, int edgeIdx) {
    float a0 = PI / 180.0 * (60.0 * float(edgeIdx) - 30.0);
    vec2 v0 = vec2(cos(a0), sin(a0));
    vec2 n = edgeNormal(edgeIdx);
    return dot(p - v0, n);
}

// Smoothstep
float sStep(float edge0, float edge1, float x) {
    float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Get neighbor terrain index by edge index
float getNeighborTerrain(int i) {
    if (i == 0) return v_neighbors03.x;
    if (i == 1) return v_neighbors03.y;
    if (i == 2) return v_neighbors03.z;
    if (i == 3) return v_neighbors03.w;
    if (i == 4) return v_neighbors45.x;
    return v_neighbors45.y;
}

// Terrain color lookup (index -1 = no neighbor / out of bounds)
vec3 terrainColor(float idx) {
    int i = int(idx + 0.5);
    if (i < 0 || i >= 66) return vec3(0.1, 0.1, 0.1);
    return u_terrainColors[i];
}

// Water terrain check (indices 0-4: deep_water, coastal_water, lake, river, wetland)
bool isWater(float idx) {
    int i = int(idx + 0.5);
    return i >= 0 && i <= 3; // deep_water, coastal_water, lake, river
}

// Blend margin based on terrain pair (sharp for water/land, gradual for similar)
float blendMargin(float a, float b) {
    if (abs(a - b) < 0.5) return 0.0; // same terrain
    bool aW = isWater(a);
    bool bW = isWater(b);
    if (aW != bW) return 0.08;  // water-land: sharp
    if (aW && bW) return 0.20;  // water-water: gradual
    return 0.18;                 // land-land: moderate
}

// ── Elevation visualization helpers ──

float getNeighborElev(int i) {
    if (i == 0) return v_neighborElev03.x;
    if (i == 1) return v_neighborElev03.y;
    if (i == 2) return v_neighborElev03.z;
    if (i == 3) return v_neighborElev03.w;
    if (i == 4) return v_neighborElev45.x;
    return v_neighborElev45.y;
}

// 8-stop hypsometric color ramp: lowland green → alpine white
// Smoothly interpolated between stops for a natural topo look
vec3 elevationRamp(float t) {
    // Clamp to valid range
    t = clamp(t, 0.0, 1.0);

    const vec3 c0 = vec3(0.20, 0.45, 0.28);  // deep lowland green
    const vec3 c1 = vec3(0.35, 0.55, 0.30);  // green
    const vec3 c2 = vec3(0.55, 0.62, 0.32);  // yellow-green
    const vec3 c3 = vec3(0.70, 0.65, 0.34);  // golden
    const vec3 c4 = vec3(0.72, 0.56, 0.38);  // tan
    const vec3 c5 = vec3(0.62, 0.48, 0.40);  // brown
    const vec3 c6 = vec3(0.58, 0.56, 0.54);  // gray
    const vec3 c7 = vec3(0.88, 0.86, 0.82);  // near-white

    float scaled = t * 7.0;
    int lo = int(floor(scaled));
    float f = fract(scaled);

    if (lo >= 7) return c7;
    if (lo == 0) return mix(c0, c1, f);
    if (lo == 1) return mix(c1, c2, f);
    if (lo == 2) return mix(c2, c3, f);
    if (lo == 3) return mix(c3, c4, f);
    if (lo == 4) return mix(c4, c5, f);
    if (lo == 5) return mix(c5, c6, f);
    return mix(c6, c7, f);
}

// Detect contour line along hex edges.
// If this cell and a neighbor are in different elevation bands,
// darken fragments near that shared edge. Produces clean contour
// lines that follow hex boundaries — correct for discrete-cell maps.
float contourLine(float elev, float contourInt) {
    float lineStrength = 0.0;
    float apothem = SQRT3 / 2.0;
    float thisBand = floor(elev / contourInt);

    for (int i = 0; i < 6; i++) {
        float nElev = getNeighborElev(i);
        if (nElev < -9990.0) continue;

        float nBand = floor(nElev / contourInt);
        if (thisBand == nBand) continue;  // same band, no contour here

        // Draw line along this hex edge
        float dist = edgeDist(v_hexLocal, i);
        float normDist = dist / apothem;

        float lineWidth = 2.5 / u_cellPixels;
        float line = 1.0 - sStep(0.0, lineWidth, normDist);
        lineStrength = max(lineStrength, line);
    }

    return lineStrength;
}

// Pseudo-hillshade from neighbor elevation gradient.
// Light from NW (cartographic convention). Returns 0-1 shade value.
//
// Hex neighbor layout (pointy-top, odd-r offset):
//   Edge 0: E,  Edge 1: NE, Edge 2: NW
//   Edge 3: W,  Edge 4: SW, Edge 5: SE
float computeHillshade(float elev) {
    // Use this cell's elevation as fallback for missing neighbors
    float e0 = getNeighborElev(0); if (e0 < -9990.0) e0 = elev;  // E
    float e1 = getNeighborElev(1); if (e1 < -9990.0) e1 = elev;  // NE
    float e2 = getNeighborElev(2); if (e2 < -9990.0) e2 = elev;  // NW
    float e3 = getNeighborElev(3); if (e3 < -9990.0) e3 = elev;  // W
    float e4 = getNeighborElev(4); if (e4 < -9990.0) e4 = elev;  // SW
    float e5 = getNeighborElev(5); if (e5 < -9990.0) e5 = elev;  // SE

    // Horizontal gradient (east - west)
    float dEdx = (e0 - e3);
    // Vertical gradient (south - north, screen Y inverted)
    float northAvg = (e1 + e2) * 0.5;
    float southAvg = (e4 + e5) * 0.5;
    float dEdy = (southAvg - northAvg);

    // Vertical exaggeration — moderate to avoid per-cell banding artifacts
    float exaggeration = 1.5;
    vec3 normal = normalize(vec3(-dEdx * exaggeration, -dEdy * exaggeration, 100.0));

    // Light from NW (azimuth 315°, altitude 45°)
    vec3 light = normalize(vec3(-0.5, -0.5, 0.707));

    float shade = dot(normal, light);
    // Remap [-1,1] → [0,1] with bias toward bright
    return clamp(shade * 0.5 + 0.5, 0.0, 1.0);
}

// Sample the atlas texture for a strategic hex's base color.
// v_infraIndex is repurposed as tile index when atlas is active.
// Maps v_hexLocal (-1..1) to UV within the tile.
vec3 sampleAtlas() {
    float tileIdx = v_infraIndex;
    float tileCol = mod(tileIdx, u_atlasGridCols);
    float tileRow = floor(tileIdx / u_atlasGridCols);

    // Map hex-local position to 0..1 within the tile
    // v_hexLocal ranges [-1, 1]; map to [0, 1]
    float localU = (v_hexLocal.x + 1.0) * 0.5;
    float localV = (v_hexLocal.y + 1.0) * 0.5;

    // Padding offset (tiles have PAD pixels of extrusion on each side)
    float pad = (u_atlasStride - u_atlasTileSize) * 0.5;

    // Atlas UV: tile origin + padding + position within tile
    // Half-pixel inset to avoid sampling the extrusion border
    float inset = 0.5;
    float u = (tileCol * u_atlasStride + pad + inset + localU * (u_atlasTileSize - 2.0 * inset)) / u_atlasSize.x;
    float v = (tileRow * u_atlasStride + pad + inset + localV * (u_atlasTileSize - 2.0 * inset)) / u_atlasSize.y;

    return texture(u_atlas, vec2(u, v)).rgb;
}

void main() {
    int tIdx = int(v_terrainIndex + 0.5);
    vec3 baseColor = u_useAtlas ? sampleAtlas() : terrainColor(v_terrainIndex);
    vec3 color = baseColor;

    // ── Edge blending with neighbors ──
    // The apothem (inner radius) of unit hex = sqrt(3)/2 ≈ 0.866
    float apothem = SQRT3 / 2.0;

    for (int i = 0; i < 6; i++) {
        float nTerrain = getNeighborTerrain(i);
        if (nTerrain < -0.5) continue; // no neighbor (out of bounds)

        float margin = blendMargin(v_terrainIndex, nTerrain);
        if (margin < 0.001) continue;

        // Distance from fragment to this hex edge (in unit-hex space)
        float dist = edgeDist(v_hexLocal, i);
        float normDist = dist / apothem;

        if (normDist >= margin || normDist < 0.0) continue;

        float blend = (1.0 - sStep(0.0, margin, normDist)) * 0.5;
        vec3 nColor = terrainColor(nTerrain);
        color = mix(color, nColor, blend);
    }

    // ── Elevation visualization ──
    if (u_showElevBands) {
        float elevRange = u_elevMax - u_elevMin;

        // Quantize elevation to contour interval — all cells in the same band
        // get the same color, producing clean readable bands instead of per-cell noise
        float bandElev = u_contourInterval > 0.1
            ? floor(v_elevation / u_contourInterval) * u_contourInterval
            : v_elevation;
        float normElev = elevRange > 0.1
            ? clamp((bandElev - u_elevMin) / elevRange, 0.0, 1.0)
            : 0.0;

        vec3 rampColor = elevationRamp(normElev);

        // Water cells (indices 0-3) keep their terrain color, land gets the ramp
        bool waterCell = tIdx >= 0 && tIdx <= 3;
        if (!waterCell) {
            color = mix(color, rampColor, 0.85);
        }

        // Hillshade: NW-lit pseudo-3D relief (subtle to avoid per-cell banding)
        float shade = computeHillshade(v_elevation);
        float shadeMultiplier = mix(0.8, 1.1, shade);
        color = color * mix(1.0, shadeMultiplier, u_hillshadeStrength);

        // Contour lines: dark brown at band boundaries
        // Fade out when zoomed very far out (hexes < 6px)
        if (u_cellPixels > 4.0 && !waterCell) {
            float contour = contourLine(v_elevation, u_contourInterval);
            float contourOpacity = u_cellPixels < 8.0
                ? (u_cellPixels - 4.0) / 4.0   // fade in 4-8px
                : 0.5;                           // full at 8px+
            vec3 contourColor = vec3(0.25, 0.18, 0.12);  // dark brown
            color = mix(color, contourColor, contour * contourOpacity);
        }
    } else {
        // Original subtle elevation shading when topo mode is off
        float elevScale = clamp(v_elevation / 2000.0, 0.0, 1.0);
        color += vec3(0.02, 0.02, 0.01) * elevScale;
    }

    // ── Feature tinting ──
    uint fMask = uint(v_featureMask + 0.5);
    if ((fMask & u_activeFeatures) != 0u) {
        // Determine tint strength based on zoom
        float tintStrength = u_cellPixels < 4.0 ? 0.25 : 0.15;
        // Use a generic highlight — the actual feature colors will be
        // drawn by the line renderer and overlay for clarity
        color = mix(color, color * 1.15 + vec3(0.05), tintStrength);
    }

    // ── Grid lines ──
    if (u_gridOpacity > 0.001) {
        // Compute minimum distance to any hex edge
        float minEdgeDist = 1.0;
        for (int i = 0; i < 6; i++) {
            float d = abs(edgeDist(v_hexLocal, i));
            minEdgeDist = min(minEdgeDist, d);
        }

        // Grid line width in hex-local units (thinner = more subtle)
        // Scale inversely with cellPixels so lines are ~1px on screen
        float lineWidth = 2.0 / u_cellPixels;
        float lineAlpha = (1.0 - sStep(0.0, lineWidth, minEdgeDist)) * u_gridOpacity;

        // Darken at grid lines
        color = mix(color, color * 0.65, lineAlpha);
    }

    fragColor = vec4(color, 1.0);
}
