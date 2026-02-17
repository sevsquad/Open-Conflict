// ════════════════════════════════════════════════════════════════
// LineRenderer — GPU-accelerated road/rail/waterway rendering
// Each segment → screen-space quad via 4 vertices + 2 triangles
// ════════════════════════════════════════════════════════════════

import lineVertSrc from "./shaders/line.vert.glsl?raw";
import lineFragSrc from "./shaders/line.frag.glsl?raw";
import { FC } from "../../terrainColors.js";
import { LINE_CONFIG } from "../RoadNetwork.js";

// Line type order (must match uniform arrays in shader)
const LINE_TYPES = [
  "highway", "major_road", "road", "minor_road", "footpath", "trail",
  "railway", "light_rail",
  "river", "pipeline",
  "dam", "tunnel",
];

const LINE_TYPE_INDEX = {};
LINE_TYPES.forEach((t, i) => { LINE_TYPE_INDEX[t] = i; });

function parseHexColor(hex) {
  const h = (hex || "#999999").replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

// Pre-compute line color array (flat RGB for shader uniform)
function buildLineColorArray() {
  const arr = new Float32Array(LINE_TYPES.length * 3);
  for (let i = 0; i < LINE_TYPES.length; i++) {
    const cfg = LINE_CONFIG[LINE_TYPES[i]];
    const rgb = parseHexColor(cfg?.color || FC[LINE_TYPES[i]]);
    arr[i * 3 + 0] = rgb[0];
    arr[i * 3 + 1] = rgb[1];
    arr[i * 3 + 2] = rgb[2];
  }
  return arr;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Line shader compile: ${log}`);
  }
  return shader;
}

export default class LineRenderer {
  constructor() {
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.vertexCount = 0;
    this.uniforms = {};
    this._lineColors = null;
  }

  init(gl) {
    this.gl = gl;

    const vert = compileShader(gl, gl.VERTEX_SHADER, lineVertSrc);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, lineFragSrc);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);

    // Bind attribute locations
    gl.bindAttribLocation(this.program, 0, "a_posA");
    gl.bindAttribLocation(this.program, 1, "a_posB");
    gl.bindAttribLocation(this.program, 2, "a_lineType");
    gl.bindAttribLocation(this.program, 3, "a_side");
    gl.bindAttribLocation(this.program, 4, "a_end");

    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(`Line program link: ${gl.getProgramInfoLog(this.program)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    // Cache uniforms
    const u = (name) => gl.getUniformLocation(this.program, name);
    this.uniforms = {
      u_canvasSize: u("u_canvasSize"),
      u_centerCol: u("u_centerCol"),
      u_centerRow: u("u_centerRow"),
      u_cellPixels: u("u_cellPixels"),
      u_lineWidths: u("u_lineWidths"),
      u_lineColors: u("u_lineColors"),
      u_lineDash: u("u_lineDash"),
      u_lineGap: u("u_lineGap"),
      u_lineAlpha: u("u_lineAlpha"),
    };

    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();

    this._lineColors = buildLineColorArray();
  }

  // Upload network segments to GPU
  // networks: { type: [{from: {c,r}, to: {c,r}}, ...] }
  uploadNetworks(networks, activeFeatures) {
    if (!this.gl) return;
    const gl = this.gl;

    // Count total segments
    let totalSegs = 0;
    for (const type of LINE_TYPES) {
      if (activeFeatures && !activeFeatures.has(type)) continue;
      const segs = networks[type];
      if (segs) totalSegs += segs.length;
    }

    if (totalSegs === 0) {
      this.vertexCount = 0;
      return;
    }

    // Each segment = 2 triangles = 6 vertices
    // Per vertex: posA(2) + posB(2) + lineType(1) + side(1) + end(1) = 7 floats
    const FLOATS_PER_VERT = 7;
    const data = new Float32Array(totalSegs * 6 * FLOATS_PER_VERT);
    let idx = 0;

    for (const type of LINE_TYPES) {
      if (activeFeatures && !activeFeatures.has(type)) continue;
      const segs = networks[type];
      if (!segs) continue;
      const typeIdx = LINE_TYPE_INDEX[type];

      for (const seg of segs) {
        const ax = seg.from.c, ay = seg.from.r;
        const bx = seg.to.c, by = seg.to.r;

        // 6 vertices forming 2 triangles for a quad:
        // Triangle 1: (start,-1), (start,+1), (end,+1)
        // Triangle 2: (start,-1), (end,+1), (end,-1)
        const verts = [
          // tri 1
          { side: -1, end: 0 },
          { side: 1, end: 0 },
          { side: 1, end: 1 },
          // tri 2
          { side: -1, end: 0 },
          { side: 1, end: 1 },
          { side: -1, end: 1 },
        ];

        for (const v of verts) {
          data[idx++] = ax; data[idx++] = ay;   // posA
          data[idx++] = bx; data[idx++] = by;   // posB
          data[idx++] = typeIdx;                  // lineType
          data[idx++] = v.side;                   // side
          data[idx++] = v.end;                    // end
        }
      }
    }

    this.vertexCount = totalSegs * 6;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const stride = FLOATS_PER_VERT * 4;
    // a_posA: vec2 at offset 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    // a_posB: vec2 at offset 8
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    // a_lineType: float at offset 16
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    // a_side: float at offset 20
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 20);
    // a_end: float at offset 24
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 24);

    gl.bindVertexArray(null);
  }

  render(viewport, canvasWidth, canvasHeight) {
    if (!this.gl || this.vertexCount === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);

    // Viewport uniforms
    gl.uniform2f(this.uniforms.u_canvasSize, canvasWidth, canvasHeight);
    gl.uniform1f(this.uniforms.u_centerCol, viewport.centerCol);
    gl.uniform1f(this.uniforms.u_centerRow, viewport.centerRow);
    gl.uniform1f(this.uniforms.u_cellPixels, viewport.cellPixels);

    // Line colors
    gl.uniform3fv(this.uniforms.u_lineColors, this._lineColors);

    // Line widths — scale with zoom
    const cp = viewport.cellPixels;
    const widths = new Float32Array(LINE_TYPES.length);
    const dashes = new Float32Array(LINE_TYPES.length);
    const gaps = new Float32Array(LINE_TYPES.length);
    const alphas = new Float32Array(LINE_TYPES.length);

    for (let i = 0; i < LINE_TYPES.length; i++) {
      const cfg = LINE_CONFIG[LINE_TYPES[i]];
      if (!cfg) {
        widths[i] = 0;
        alphas[i] = 0;
        continue;
      }

      // Continuous width scaling based on cellPixels
      // Instead of 4 discrete tiers, smoothly interpolate
      let w;
      if (cp < 3) {
        w = cfg.width[0] || 0;
      } else if (cp < 12) {
        const t = (cp - 3) / 9;
        w = (cfg.width[0] || 0) * (1 - t) + (cfg.width[1] || 0) * t;
      } else if (cp < 32) {
        const t = (cp - 12) / 20;
        w = (cfg.width[1] || 0) * (1 - t) + (cfg.width[2] || 0) * t;
      } else {
        const t = Math.min(1, (cp - 32) / 32);
        w = (cfg.width[2] || 0) * (1 - t) + (cfg.width[3] || 0) * t;
      }
      widths[i] = Math.max(0, w);

      // Dash/gap scaled by zoom
      const dashScale = cp / 16;
      if (cfg.dash) {
        dashes[i] = cfg.dash[0] * dashScale;
        gaps[i] = (cfg.dash[1] || cfg.dash[0]) * dashScale;
      } else {
        dashes[i] = 0;
        gaps[i] = 0;
      }

      alphas[i] = widths[i] > 0.1 ? 0.85 : 0.0;
    }

    gl.uniform1fv(this.uniforms.u_lineWidths, widths);
    gl.uniform1fv(this.uniforms.u_lineDash, dashes);
    gl.uniform1fv(this.uniforms.u_lineGap, gaps);
    gl.uniform1fv(this.uniforms.u_lineAlpha, alphas);

    // Draw
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }

  destroy() {
    if (!this.gl) return;
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}
