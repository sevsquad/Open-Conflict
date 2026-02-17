// ════════════════════════════════════════════════════════════════
// HexGeometry — pointy-top hex mesh template for instanced rendering
// Creates the vertex buffer for a single unit hex (6 triangles fan)
// and defines the per-instance attribute layout.
// ════════════════════════════════════════════════════════════════

const SQRT3 = Math.sqrt(3);

// 6 vertices of a pointy-top hex centered at origin with radius 1.
// Ordered for a triangle fan from center (vertex 0 = center).
// Each triangle: center, vertex[i], vertex[(i+1)%6]
// We emit 18 vertices (6 triangles x 3 verts) for TRIANGLES mode.
function buildHexVertices() {
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30); // pointy-top: first at -30deg
    verts.push({
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  }

  // Emit triangle fan as flat array: [cx,cy, v0x,v0y, v1x,v1y, ...]
  const triangles = new Float32Array(6 * 3 * 2); // 6 tris, 3 verts each, 2 floats
  let idx = 0;
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    // Center
    triangles[idx++] = 0;
    triangles[idx++] = 0;
    // Vertex i
    triangles[idx++] = verts[i].x;
    triangles[idx++] = verts[i].y;
    // Vertex j
    triangles[idx++] = verts[j].x;
    triangles[idx++] = verts[j].y;
  }
  return triangles;
}

// The 6 edge normals (pointing inward) for a pointy-top hex.
// Edge i goes from vertex[i] to vertex[(i+1)%6].
// Used by the fragment shader for distance-to-edge calculations.
// Pre-computed here so the shader can use them as constants.
function buildEdgeNormals() {
  const normals = [];
  for (let i = 0; i < 6; i++) {
    const a0 = Math.PI / 180 * (60 * i - 30);
    const a1 = Math.PI / 180 * (60 * ((i + 1) % 6) - 30);
    const ex = Math.cos(a1) - Math.cos(a0);
    const ey = Math.sin(a1) - Math.sin(a0);
    const len = Math.sqrt(ex * ex + ey * ey);
    // Inward-pointing normal (right of edge direction for CW winding)
    normals.push(-ey / len, ex / len);
  }
  return new Float32Array(normals);
}

// Per-instance attribute layout:
// Stride = 12 floats = 48 bytes per instance
//
// offset 0:  col           (float)
// offset 1:  row           (float)
// offset 2:  terrainIndex  (float, 0-17)
// offset 3:  elevation     (float, meters)
// offset 4:  featureMask   (float, bitfield packed as float)
// offset 5:  infraIndex    (float, infrastructure type index)
// offset 6-11: neighborTerrains[6] (float each, terrain index of 6 neighbors)
//
export const INSTANCE_FLOATS = 12;
export const INSTANCE_BYTES = INSTANCE_FLOATS * 4;

// Attribute locations (must match vertex shader)
export const ATTRIB = {
  // Mesh vertex (per-vertex)
  a_hexVertex: 0,      // vec2 — local hex position (-1..1)

  // Per-instance
  a_colRow: 1,         // vec2 — grid col, row
  a_terrainElev: 2,    // vec2 — terrainIndex, elevation
  a_featureInfra: 3,   // vec2 — featureMask, infraIndex
  a_neighbors03: 4,    // vec4 — neighborTerrains[0..3]
  a_neighbors45: 5,    // vec2 — neighborTerrains[4..5]
};

export const HEX_VERTEX_DATA = buildHexVertices();
export const HEX_VERTEX_COUNT = 18; // 6 triangles x 3 verts
export const EDGE_NORMALS = buildEdgeNormals();
export { SQRT3 };
