// ════════════════════════════════════════════════════════════════
// HexGLRenderer — WebGL2 instanced hex terrain renderer
// Tile-based viewport culling: grid is divided into rectangular
// tiles, each with its own VBO. Only visible tiles are drawn.
// ════════════════════════════════════════════════════════════════

import hexVertSrc from "./shaders/hex.vert.glsl?raw";
import hexFragSrc from "./shaders/hex.frag.glsl?raw";
import {
  HEX_VERTEX_DATA, HEX_VERTEX_COUNT,
  INSTANCE_FLOATS, INSTANCE_BYTES, ATTRIB,
} from "./HexGeometry.js";
import { buildAllTiles, buildTerrainColorArray, buildFeatureBitmask, computeElevationRange, buildStrategicInstanceData } from "./HexGPUData.js";
import { uploadAtlasTexture } from "./StrategicAtlas.js";

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
  gl.bindAttribLocation(program, ATTRIB.a_neighborElev03, "a_neighborElev03");
  gl.bindAttribLocation(program, ATTRIB.a_neighborElev45, "a_neighborElev45");

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
    this.hexVBO = null;
    // Tile-based rendering: each tile has its own VAO, VBO, and cell range
    this.tiles = [];   // { vao, vbo, instanceCount, colMin, colMax, rowMin, rowMax }
    this.uniforms = {};
    this._terrainColors = null;
    this._destroyed = false;
    // Strategic rendering: single buffer for strategic hexes + atlas texture
    this._strategicVAO = null;
    this._strategicVBO = null;
    this._strategicCount = 0;
    this._atlasTexture = null;
    this._atlasInfo = null;  // { atlasGridCols, atlasSize, tileSize, tilePad, tileStride }
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
      u_showElevBands: u("u_showElevBands"),
      u_elevMin: u("u_elevMin"),
      u_elevMax: u("u_elevMax"),
      u_contourInterval: u("u_contourInterval"),
      u_hillshadeStrength: u("u_hillshadeStrength"),
      // Strategic atlas uniforms
      u_useAtlas: u("u_useAtlas"),
      u_atlas: u("u_atlas"),
      u_atlasGridCols: u("u_atlasGridCols"),
      u_atlasSize: u("u_atlasSize"),
      u_atlasTileSize: u("u_atlasTileSize"),
      u_atlasStride: u("u_atlasStride"),
    };

    // Upload hex template mesh (shared across all tiles)
    this.hexVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hexVBO);
    gl.bufferData(gl.ARRAY_BUFFER, HEX_VERTEX_DATA, gl.STATIC_DRAW);

    // Pre-compute terrain colors
    this._terrainColors = buildTerrainColorArray();

    // Enable blending for features
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Create a VAO for a tile, binding the shared hex template VBO and the tile's instance VBO.
  _createTileVAO(gl, tileVBO) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Bind shared hex template vertices (per-vertex, no divisor)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hexVBO);
    gl.enableVertexAttribArray(ATTRIB.a_hexVertex);
    gl.vertexAttribPointer(ATTRIB.a_hexVertex, 2, gl.FLOAT, false, 0, 0);

    // Bind tile instance data (per-instance, divisor=1)
    gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO);
    const stride = INSTANCE_BYTES;

    gl.enableVertexAttribArray(ATTRIB.a_colRow);
    gl.vertexAttribPointer(ATTRIB.a_colRow, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(ATTRIB.a_colRow, 1);

    gl.enableVertexAttribArray(ATTRIB.a_terrainElev);
    gl.vertexAttribPointer(ATTRIB.a_terrainElev, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(ATTRIB.a_terrainElev, 1);

    gl.enableVertexAttribArray(ATTRIB.a_featureInfra);
    gl.vertexAttribPointer(ATTRIB.a_featureInfra, 2, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(ATTRIB.a_featureInfra, 1);

    gl.enableVertexAttribArray(ATTRIB.a_neighbors03);
    gl.vertexAttribPointer(ATTRIB.a_neighbors03, 4, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(ATTRIB.a_neighbors03, 1);

    gl.enableVertexAttribArray(ATTRIB.a_neighbors45);
    gl.vertexAttribPointer(ATTRIB.a_neighbors45, 2, gl.FLOAT, false, stride, 40);
    gl.vertexAttribDivisor(ATTRIB.a_neighbors45, 1);

    gl.enableVertexAttribArray(ATTRIB.a_neighborElev03);
    gl.vertexAttribPointer(ATTRIB.a_neighborElev03, 4, gl.FLOAT, false, stride, 48);
    gl.vertexAttribDivisor(ATTRIB.a_neighborElev03, 1);

    gl.enableVertexAttribArray(ATTRIB.a_neighborElev45);
    gl.vertexAttribPointer(ATTRIB.a_neighborElev45, 2, gl.FLOAT, false, stride, 64);
    gl.vertexAttribDivisor(ATTRIB.a_neighborElev45, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  // Upload tile atlas for illustrated hex rendering.
  // atlasResult: from generateTileAtlas() — { canvas, tileIndexMap, atlasInfo }
  uploadTileAtlas(atlasResult) {
    if (!this.gl || this._destroyed || !atlasResult) return;
    const gl = this.gl;

    // Clean up previous tile atlas
    if (this._tileAtlasTexture) gl.deleteTexture(this._tileAtlasTexture);

    this._tileAtlasTexture = uploadAtlasTexture(gl, atlasResult.canvas);
    this._tileAtlasInfo = atlasResult.atlasInfo;
  }

  // Upload map data to GPU as tiles. Returns { smoothedElevMap } for contour labels.
  // tileIndexMap: optional Map<hexKey, tileIdx> from generateTileAtlas(), maps hex
  // positions to atlas tile indices. When provided, infraIndex is repurposed.
  uploadMapData(mapData, tileIndexMap) {
    if (!this.gl || this._destroyed) return null;
    const gl = this.gl;

    // Clean up any previous tiles
    this._destroyTiles();

    const { tiles: tileData, smoothedElevMap } = buildAllTiles(mapData, tileIndexMap || null);

    for (const td of tileData) {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, td.instanceData, gl.STATIC_DRAW);

      const vao = this._createTileVAO(gl, vbo);

      this.tiles.push({
        vao,
        vbo,
        instanceCount: td.cellCount,
        colMin: td.colMin,
        colMax: td.colMax,
        rowMin: td.rowMin,
        rowMax: td.rowMax,
      });
    }

    return { smoothedElevMap };
  }

  // Upload strategic grid data and atlas texture for strategic mode rendering.
  // strategicGrid: from buildStrategicGrid()
  // atlasResult: from generateStrategicAtlas()
  uploadStrategicData(strategicGrid, atlasResult) {
    if (!this.gl || this._destroyed) return;
    const gl = this.gl;

    // Clean up previous strategic data
    this._destroyStrategic();

    // Build strategic hex instance data
    const { instanceData, cellCount } = buildStrategicInstanceData(
      strategicGrid, atlasResult.tileIndexMap
    );

    // Upload instance VBO
    this._strategicVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._strategicVBO);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

    // Create VAO (same attribute layout as fine hex tiles)
    this._strategicVAO = this._createTileVAO(gl, this._strategicVBO);
    this._strategicCount = cellCount;

    // Upload atlas texture
    this._atlasTexture = uploadAtlasTexture(gl, atlasResult.canvas);
    this._atlasInfo = {
      atlasGridCols: atlasResult.atlasGridCols,
      atlasSize: atlasResult.atlasSize,
      tileSize: atlasResult.tileSize,
      tileStride: atlasResult.tileStride,
    };
  }

  // Render strategic hexes with atlas texture
  renderStrategic(viewport, canvasWidth, canvasHeight, activeFeatures, elevBands = null) {
    if (!this.gl || !this._strategicVAO || this._strategicCount === 0 || this._destroyed) return;
    const gl = this.gl;

    // Resize viewport if needed
    if (gl.canvas.width !== canvasWidth || gl.canvas.height !== canvasHeight) {
      gl.canvas.width = canvasWidth;
      gl.canvas.height = canvasHeight;
    }
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    // Clear
    gl.clearColor(0.102, 0.145, 0.208, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use hex program
    gl.useProgram(this.program);

    // Set viewport uniforms — the viewport here is in strategic grid coords
    gl.uniform2f(this.uniforms.u_canvasSize, canvasWidth, canvasHeight);
    gl.uniform1f(this.uniforms.u_centerCol, viewport.centerCol);
    gl.uniform1f(this.uniforms.u_centerRow, viewport.centerRow);
    gl.uniform1f(this.uniforms.u_cellPixels, viewport.cellPixels);

    // Terrain colors (still needed for neighbor blending)
    gl.uniform3fv(this.uniforms.u_terrainColors, this._terrainColors);

    // Active features bitmask
    const featureMask = buildFeatureBitmask(activeFeatures);
    gl.uniform1ui(this.uniforms.u_activeFeatures, featureMask);
    gl.uniform3f(this.uniforms.u_featureColor, 1.0, 0.8, 0.3);

    // Elevation bands
    const showBands = elevBands !== null;
    gl.uniform1i(this.uniforms.u_showElevBands, showBands ? 1 : 0);
    if (showBands) {
      gl.uniform1f(this.uniforms.u_elevMin, elevBands.min);
      gl.uniform1f(this.uniforms.u_elevMax, elevBands.max);
      gl.uniform1f(this.uniforms.u_contourInterval, elevBands.contourInterval);
      gl.uniform1f(this.uniforms.u_hillshadeStrength, 0.35);
    }

    // Grid — show at all zoom levels in strategic mode (hexes are large)
    const cp = viewport.cellPixels;
    let gridOpacity;
    if (showBands) gridOpacity = 0.0;
    else if (cp < 8) gridOpacity = 0.15;
    else gridOpacity = Math.min(0.5, 0.15 + (cp - 8) / 48 * 0.35);
    gl.uniform1f(this.uniforms.u_gridOpacity, gridOpacity);

    // Enable atlas
    gl.uniform1i(this.uniforms.u_useAtlas, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
    gl.uniform1i(this.uniforms.u_atlas, 0);
    gl.uniform1f(this.uniforms.u_atlasGridCols, this._atlasInfo.atlasGridCols);
    gl.uniform2f(this.uniforms.u_atlasSize, this._atlasInfo.atlasSize.w, this._atlasInfo.atlasSize.h);
    gl.uniform1f(this.uniforms.u_atlasTileSize, this._atlasInfo.tileSize);
    gl.uniform1f(this.uniforms.u_atlasStride, this._atlasInfo.tileStride);

    // Draw all strategic hexes (no tiling needed — typically < 2500 hexes)
    gl.bindVertexArray(this._strategicVAO);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, HEX_VERTEX_COUNT, this._strategicCount);
    gl.bindVertexArray(null);

    // Disable atlas for next frame
    gl.uniform1i(this.uniforms.u_useAtlas, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _destroyStrategic() {
    if (!this.gl) return;
    const gl = this.gl;
    if (this._strategicVAO) gl.deleteVertexArray(this._strategicVAO);
    if (this._strategicVBO) gl.deleteBuffer(this._strategicVBO);
    if (this._atlasTexture) gl.deleteTexture(this._atlasTexture);
    this._strategicVAO = null;
    this._strategicVBO = null;
    this._strategicCount = 0;
    this._atlasTexture = null;
    this._atlasInfo = null;
  }

  // Test if a tile overlaps the visible range (with 1-cell margin for edge hexes)
  _tileVisible(tile, visRange) {
    return tile.colMin <= visRange.colMax + 1 &&
           tile.colMax >= visRange.colMin - 1 &&
           tile.rowMin <= visRange.rowMax + 1 &&
           tile.rowMax >= visRange.rowMin - 1;
  }

  // Render one frame — only draws tiles overlapping the viewport
  // visRange: { colMin, colMax, rowMin, rowMax } from getVisibleRange(), or null to draw all
  render(viewport, canvasWidth, canvasHeight, activeFeatures, elevBands = null, visRange = null) {
    if (!this.gl || this.tiles.length === 0 || this._destroyed) return;
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

    // Enable tile atlas for illustrated hex rendering if available
    if (this._tileAtlasTexture && this._tileAtlasInfo) {
      gl.uniform1i(this.uniforms.u_useAtlas, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._tileAtlasTexture);
      gl.uniform1i(this.uniforms.u_atlas, 0);
      gl.uniform1f(this.uniforms.u_atlasGridCols, this._tileAtlasInfo.atlasGridCols);
      gl.uniform2f(this.uniforms.u_atlasSize, this._tileAtlasInfo.atlasSize.w, this._tileAtlasInfo.atlasSize.h);
      gl.uniform1f(this.uniforms.u_atlasTileSize, this._tileAtlasInfo.tileSize);
      gl.uniform1f(this.uniforms.u_atlasStride, this._tileAtlasInfo.tileStride);
    } else {
      gl.uniform1i(this.uniforms.u_useAtlas, 0);
    }

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

    // Elevation bands
    const showBands = elevBands !== null;
    gl.uniform1i(this.uniforms.u_showElevBands, showBands ? 1 : 0);
    if (showBands) {
      gl.uniform1f(this.uniforms.u_elevMin, elevBands.min);
      gl.uniform1f(this.uniforms.u_elevMax, elevBands.max);
      gl.uniform1f(this.uniforms.u_contourInterval, elevBands.contourInterval);
      gl.uniform1f(this.uniforms.u_hillshadeStrength, 0.35);
    }

    // Grid opacity: suppress in topo mode (contour lines provide edge structure),
    // otherwise ramp up as we zoom in
    const cp = viewport.cellPixels;
    let gridOpacity;
    if (showBands) {
      gridOpacity = 0.0;
    } else if (cp < 3) gridOpacity = 0.0;
    else if (cp < 8) gridOpacity = (cp - 3) / 5 * 0.15;
    else if (cp < 16) gridOpacity = 0.15 + (cp - 8) / 8 * 0.15;
    else gridOpacity = Math.min(0.5, 0.3 + (cp - 16) / 48 * 0.2);
    gl.uniform1f(this.uniforms.u_gridOpacity, gridOpacity);

    // Draw visible tiles
    for (const tile of this.tiles) {
      if (visRange && !this._tileVisible(tile, visRange)) continue;
      gl.bindVertexArray(tile.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, HEX_VERTEX_COUNT, tile.instanceCount);
    }
    gl.bindVertexArray(null);
  }

  // Render to an OffscreenCanvas for minimap or export
  renderToTarget(targetCanvas, viewport, canvasWidth, canvasHeight, activeFeatures) {
    // Render all tiles (no culling) for export
    this.render(viewport, canvasWidth, canvasHeight, activeFeatures);
  }

  _destroyTiles() {
    if (!this.gl) return;
    const gl = this.gl;
    for (const tile of this.tiles) {
      if (tile.vao) gl.deleteVertexArray(tile.vao);
      if (tile.vbo) gl.deleteBuffer(tile.vbo);
    }
    this.tiles = [];
  }

  destroy() {
    this._destroyed = true;
    if (!this.gl) return;
    const gl = this.gl;
    this._destroyTiles();
    this._destroyStrategic();
    if (this._tileAtlasTexture) gl.deleteTexture(this._tileAtlasTexture);
    this._tileAtlasTexture = null;
    this._tileAtlasInfo = null;
    if (this.hexVBO) gl.deleteBuffer(this.hexVBO);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
  }
}
