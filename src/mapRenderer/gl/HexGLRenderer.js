// ════════════════════════════════════════════════════════════════
// HexGLRenderer — WebGL2 instanced hex terrain renderer
// Single draw call for entire hex grid, no tile caching
// ════════════════════════════════════════════════════════════════

import hexVertSrc from "./shaders/hex.vert.glsl?raw";
import hexFragSrc from "./shaders/hex.frag.glsl?raw";
import {
  HEX_VERTEX_DATA, HEX_VERTEX_COUNT,
  INSTANCE_FLOATS, INSTANCE_BYTES, ATTRIB,
} from "./HexGeometry.js";
import { buildInstanceData, buildTerrainColorArray, buildFeatureBitmask } from "./HexGPUData.js";

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function linkProgram(gl, vertShader, fragShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);

  // Bind attribute locations before linking
  gl.bindAttribLocation(program, ATTRIB.a_hexVertex, "a_hexVertex");
  gl.bindAttribLocation(program, ATTRIB.a_colRow, "a_colRow");
  gl.bindAttribLocation(program, ATTRIB.a_terrainElev, "a_terrainElev");
  gl.bindAttribLocation(program, ATTRIB.a_featureInfra, "a_featureInfra");
  gl.bindAttribLocation(program, ATTRIB.a_neighbors03, "a_neighbors03");
  gl.bindAttribLocation(program, ATTRIB.a_neighbors45, "a_neighbors45");

  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

export default class HexGLRenderer {
  constructor() {
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.hexVBO = null;
    this.instanceVBO = null;
    this.cellCount = 0;
    this.uniforms = {};
    this._terrainColors = null;
    this._destroyed = false;
  }

  // Initialize WebGL context on a canvas element
  init(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // needed for PNG export / readPixels
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // Compile shaders
    const vert = compileShader(gl, gl.VERTEX_SHADER, hexVertSrc);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, hexFragSrc);
    this.program = linkProgram(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    // Cache uniform locations
    const u = (name) => gl.getUniformLocation(this.program, name);
    this.uniforms = {
      u_canvasSize: u("u_canvasSize"),
      u_centerCol: u("u_centerCol"),
      u_centerRow: u("u_centerRow"),
      u_cellPixels: u("u_cellPixels"),
      u_terrainColors: u("u_terrainColors"),
      u_activeFeatures: u("u_activeFeatures"),
      u_featureColor: u("u_featureColor"),
      u_gridOpacity: u("u_gridOpacity"),
    };

    // Create VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Upload hex template mesh
    this.hexVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hexVBO);
    gl.bufferData(gl.ARRAY_BUFFER, HEX_VERTEX_DATA, gl.STATIC_DRAW);
    // a_hexVertex: vec2 per vertex
    gl.enableVertexAttribArray(ATTRIB.a_hexVertex);
    gl.vertexAttribPointer(ATTRIB.a_hexVertex, 2, gl.FLOAT, false, 0, 0);

    // Create instance buffer (uploaded later when data arrives)
    this.instanceVBO = gl.createBuffer();

    gl.bindVertexArray(null);

    // Pre-compute terrain colors
    this._terrainColors = buildTerrainColorArray();

    // Enable blending for features
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Upload map data to GPU
  uploadMapData(mapData) {
    if (!this.gl || this._destroyed) return;
    const gl = this.gl;

    const { instanceData, cellCount } = buildInstanceData(mapData);
    this.cellCount = cellCount;

    gl.bindVertexArray(this.vao);

    // Upload instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

    const stride = INSTANCE_BYTES;

    // a_colRow: vec2 at offset 0
    gl.enableVertexAttribArray(ATTRIB.a_colRow);
    gl.vertexAttribPointer(ATTRIB.a_colRow, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(ATTRIB.a_colRow, 1);

    // a_terrainElev: vec2 at offset 8
    gl.enableVertexAttribArray(ATTRIB.a_terrainElev);
    gl.vertexAttribPointer(ATTRIB.a_terrainElev, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(ATTRIB.a_terrainElev, 1);

    // a_featureInfra: vec2 at offset 16
    gl.enableVertexAttribArray(ATTRIB.a_featureInfra);
    gl.vertexAttribPointer(ATTRIB.a_featureInfra, 2, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(ATTRIB.a_featureInfra, 1);

    // a_neighbors03: vec4 at offset 24
    gl.enableVertexAttribArray(ATTRIB.a_neighbors03);
    gl.vertexAttribPointer(ATTRIB.a_neighbors03, 4, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(ATTRIB.a_neighbors03, 1);

    // a_neighbors45: vec2 at offset 40
    gl.enableVertexAttribArray(ATTRIB.a_neighbors45);
    gl.vertexAttribPointer(ATTRIB.a_neighbors45, 2, gl.FLOAT, false, stride, 40);
    gl.vertexAttribDivisor(ATTRIB.a_neighbors45, 1);

    gl.bindVertexArray(null);
  }

  // Render one frame
  render(viewport, canvasWidth, canvasHeight, activeFeatures) {
    if (!this.gl || this.cellCount === 0 || this._destroyed) return;
    const gl = this.gl;

    // Resize viewport if needed
    if (gl.canvas.width !== canvasWidth || gl.canvas.height !== canvasHeight) {
      gl.canvas.width = canvasWidth;
      gl.canvas.height = canvasHeight;
    }
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    // Clear
    gl.clearColor(0.102, 0.145, 0.208, 1.0); // #1A2535
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use hex program
    gl.useProgram(this.program);

    // Set viewport uniforms
    gl.uniform2f(this.uniforms.u_canvasSize, canvasWidth, canvasHeight);
    gl.uniform1f(this.uniforms.u_centerCol, viewport.centerCol);
    gl.uniform1f(this.uniforms.u_centerRow, viewport.centerRow);
    gl.uniform1f(this.uniforms.u_cellPixels, viewport.cellPixels);

    // Terrain colors
    gl.uniform3fv(this.uniforms.u_terrainColors, this._terrainColors);

    // Active features bitmask
    const featureMask = buildFeatureBitmask(activeFeatures);
    gl.uniform1ui(this.uniforms.u_activeFeatures, featureMask);

    // Feature tint color (generic highlight)
    gl.uniform3f(this.uniforms.u_featureColor, 1.0, 0.8, 0.3);

    // Grid opacity: ramp up as we zoom in, fade out when very zoomed out
    const cp = viewport.cellPixels;
    let gridOpacity;
    if (cp < 3) gridOpacity = 0.0;
    else if (cp < 8) gridOpacity = (cp - 3) / 5 * 0.15;
    else if (cp < 16) gridOpacity = 0.15 + (cp - 8) / 8 * 0.15;
    else gridOpacity = Math.min(0.5, 0.3 + (cp - 16) / 48 * 0.2);
    gl.uniform1f(this.uniforms.u_gridOpacity, gridOpacity);

    // Draw instanced
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, HEX_VERTEX_COUNT, this.cellCount);
    gl.bindVertexArray(null);
  }

  // Render to an OffscreenCanvas for minimap or export
  renderToTarget(targetCanvas, viewport, canvasWidth, canvasHeight, activeFeatures) {
    // Save current canvas, swap, render, swap back
    const origCanvas = this.gl.canvas;
    // For OffscreenCanvas rendering, we create a temporary renderer
    // This is simpler than context switching.
    // Instead, just read pixels from main canvas after rendering.
    this.render(viewport, canvasWidth, canvasHeight, activeFeatures);
  }

  destroy() {
    this._destroyed = true;
    if (!this.gl) return;
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.hexVBO) gl.deleteBuffer(this.hexVBO);
    if (this.instanceVBO) gl.deleteBuffer(this.instanceVBO);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}
