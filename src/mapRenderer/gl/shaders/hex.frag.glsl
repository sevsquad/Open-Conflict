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

// Uniforms
uniform vec3 u_terrainColors[18];   // RGB for each terrain type
uniform float u_cellPixels;         // current zoom level
uniform uint u_activeFeatures;      // bitmask of enabled features
uniform vec3 u_featureColor;        // tint color for active features (simplified)
uniform float u_gridOpacity;        // 0.0 = no grid, 1.0 = full grid

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
    if (i < 0 || i >= 18) return vec3(0.1, 0.1, 0.1);
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

void main() {
    int tIdx = int(v_terrainIndex + 0.5);
    vec3 baseColor = terrainColor(v_terrainIndex);
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

    // ── Elevation shading (directional light from NW) ──
    // Use neighbor elevations to estimate gradient
    float elevScale = clamp(v_elevation / 2000.0, 0.0, 1.0);
    // Subtle brightness boost for higher elevation
    color += vec3(0.02, 0.02, 0.01) * elevScale;

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
