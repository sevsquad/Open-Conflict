#version 300 es
precision highp float;

// ═══════════════════════════════════════════════════════════
// Line Fragment Shader — color, dash patterns, anti-aliasing
// ═══════════════════════════════════════════════════════════

in float v_lineType;
in float v_along;       // distance along segment in screen pixels
in float v_across;      // -1..1 across width

uniform vec3 u_lineColors[12];   // color per line type
uniform float u_lineDash[12];    // dash length (0 = solid)
uniform float u_lineGap[12];     // gap length
uniform float u_lineAlpha[12];   // base alpha per type

out vec4 fragColor;

void main() {
    int typeIdx = int(v_lineType + 0.5);
    vec3 color = u_lineColors[typeIdx];
    float alpha = u_lineAlpha[typeIdx];

    // Dash pattern
    float dashLen = u_lineDash[typeIdx];
    if (dashLen > 0.5) {
        float gapLen = u_lineGap[typeIdx];
        float cycle = dashLen + gapLen;
        float pos = mod(v_along, cycle);
        if (pos > dashLen) {
            discard;
        }
    }

    // Anti-aliasing at edges (smooth falloff in the last 20% of width)
    float edgeDist = 1.0 - abs(v_across);
    float aa = smoothstep(0.0, 0.3, edgeDist);
    alpha *= aa;

    fragColor = vec4(color, alpha);
}
