#version 300 es
precision highp float;

// ═══════════════════════════════════════════════════════════
// Hex Vertex Shader — instanced pointy-top hex rendering
// ═══════════════════════════════════════════════════════════

// Per-vertex (hex template)
layout(location = 0) in vec2 a_hexVertex;   // local position on unit hex (-1..1)

// Per-instance
layout(location = 1) in vec2 a_colRow;       // grid col, row
layout(location = 2) in vec2 a_terrainElev;  // terrainIndex, elevation
layout(location = 3) in vec2 a_featureInfra; // featureMask (as float bits), infraIndex
layout(location = 4) in vec4 a_neighbors03;  // neighborTerrains[0..3]
layout(location = 5) in vec2 a_neighbors45;  // neighborTerrains[4..5]

// Viewport uniforms
uniform vec2 u_canvasSize;       // width, height in pixels
uniform float u_centerCol;       // viewport center column (float)
uniform float u_centerRow;       // viewport center row (float)
uniform float u_cellPixels;      // hex width in pixels

// Outputs to fragment shader
out vec2 v_hexLocal;             // position within hex (-1..1 range)
flat out float v_terrainIndex;
flat out float v_elevation;
flat out float v_featureMask;
flat out float v_infraIndex;
flat out vec4 v_neighbors03;
flat out vec2 v_neighbors45;

const float SQRT3 = 1.7320508;

// Offset grid (col, row) → world pixel position (pointy-top, odd-r)
vec2 gridToWorld(float col, float row, float hexSize) {
    float stagger = mod(row + 0.5, 2.0) < 1.0 ? 0.0 : 0.5;
    float wx = hexSize * SQRT3 * (col + stagger);
    float wy = hexSize * 1.5 * row;
    return vec2(wx, wy);
}

void main() {
    float col = a_colRow.x;
    float row = a_colRow.y;

    // Hex outer radius (size) from cellPixels
    // cellPixels = hex width = sqrt(3) * size → size = cellPixels / sqrt(3)
    float hexSize = u_cellPixels / SQRT3;

    // Scale the template vertex by hexSize
    vec2 localOffset = a_hexVertex * hexSize;

    // World position of this hex center
    vec2 worldPos = gridToWorld(col, row, hexSize);

    // World position of viewport center
    float centerRowRounded = floor(u_centerRow + 0.5);
    float centerStagger = mod(centerRowRounded + 0.5, 2.0) < 1.0 ? 0.0 : 0.5;
    vec2 centerWorld = vec2(
        hexSize * SQRT3 * (u_centerCol + centerStagger),
        hexSize * 1.5 * u_centerRow
    );

    // Screen position: offset from center, then shift to canvas center
    vec2 screenPos = (worldPos + localOffset) - centerWorld + u_canvasSize * 0.5;

    // Convert to clip space: (0,0) = top-left, (w,h) = bottom-right → (-1,1) to (1,-1)
    vec2 clipPos = (screenPos / u_canvasSize) * 2.0 - 1.0;
    clipPos.y = -clipPos.y; // flip Y for WebGL

    gl_Position = vec4(clipPos, 0.0, 1.0);

    // Pass to fragment shader
    v_hexLocal = a_hexVertex;
    v_terrainIndex = a_terrainElev.x;
    v_elevation = a_terrainElev.y;
    v_featureMask = a_featureInfra.x;
    v_infraIndex = a_featureInfra.y;
    v_neighbors03 = a_neighbors03;
    v_neighbors45 = a_neighbors45;
}
