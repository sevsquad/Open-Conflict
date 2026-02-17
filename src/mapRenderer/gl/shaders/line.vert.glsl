#version 300 es
precision highp float;

// ═══════════════════════════════════════════════════════════
// Line Vertex Shader — road/rail/waterway rendering
// Each line segment = 2 triangles forming a screen-space quad
// ═══════════════════════════════════════════════════════════

// Per-vertex attributes
layout(location = 0) in vec2 a_posA;        // grid col,row of segment start
layout(location = 1) in vec2 a_posB;        // grid col,row of segment end
layout(location = 2) in float a_lineType;   // line type index
layout(location = 3) in float a_side;       // -1 or +1 (which side of the line)
layout(location = 4) in float a_end;        // 0 = start end, 1 = far end

// Viewport uniforms (same as hex shader)
uniform vec2 u_canvasSize;
uniform float u_centerCol;
uniform float u_centerRow;
uniform float u_cellPixels;

// Line config
uniform float u_lineWidths[12];  // width per line type at current zoom

out float v_lineType;
out float v_along;      // 0..1 along segment length (for dashing)
out float v_across;     // -1..1 across line width (for anti-aliasing)

const float SQRT3 = 1.7320508;

vec2 gridToScreen(float col, float row) {
    float hexSize = u_cellPixels / SQRT3;
    float stagger = mod(row + 0.5, 2.0) < 1.0 ? 0.0 : 0.5;
    float wx = hexSize * SQRT3 * (col + stagger);
    float wy = hexSize * 1.5 * row;

    float centerRowRounded = floor(u_centerRow + 0.5);
    float centerStagger = mod(centerRowRounded + 0.5, 2.0) < 1.0 ? 0.0 : 0.5;
    float cx = hexSize * SQRT3 * (u_centerCol + centerStagger);
    float cy = hexSize * 1.5 * u_centerRow;

    return vec2(wx - cx + u_canvasSize.x * 0.5, wy - cy + u_canvasSize.y * 0.5);
}

void main() {
    int typeIdx = int(a_lineType + 0.5);
    float width = u_lineWidths[typeIdx];

    vec2 screenA = gridToScreen(a_posA.x, a_posA.y);
    vec2 screenB = gridToScreen(a_posB.x, a_posB.y);

    // Direction and perpendicular
    vec2 dir = screenB - screenA;
    float segLen = length(dir);
    if (segLen < 0.001) {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // degenerate — clip
        return;
    }
    vec2 normDir = dir / segLen;
    vec2 perp = vec2(-normDir.y, normDir.x);

    // Position along the segment
    vec2 pos = mix(screenA, screenB, a_end);
    // Offset perpendicular by half-width
    pos += perp * a_side * width * 0.5;
    // Extend slightly past endpoints for round caps
    pos += normDir * a_end * width * 0.3 - normDir * (1.0 - a_end) * width * 0.3;

    // To clip space
    vec2 clipPos = (pos / u_canvasSize) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;
    gl_Position = vec4(clipPos, 0.0, 1.0);

    v_lineType = a_lineType;
    v_along = a_end * segLen;
    v_across = a_side;
}
