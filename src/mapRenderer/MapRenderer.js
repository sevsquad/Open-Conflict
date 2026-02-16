// ════════════════════════════════════════════════════════════════
// MapRenderer — main render loop, tier dispatch, tile composition
// Core engine shared by Viewer and SimMap
// ════════════════════════════════════════════════════════════════

import TileCache from "./TileCache.js";
import {
  getTier, getVisibleChunks, getAdaptiveChunkSize,
  getVisibleRange, gridToScreen,
} from "./ViewportState.js";
import { cellPixelsToHexSize, hexChunkLayout, SQRT3 } from "./HexMath.js";
import { renderStrategicChunk, renderStrategicFullMap } from "./tiers/StrategicRenderer.js";
import { renderOperationalChunk } from "./tiers/OperationalRenderer.js";
import { renderTacticalChunk } from "./tiers/TacticalRenderer.js";
import { renderCloseupChunk } from "./tiers/CloseupRenderer.js";
import { drawLinearFeatures } from "./RoadNetwork.js";
import { drawGridOverlay } from "./overlays/GridOverlay.js";
import { drawNameLabels, drawCoordLabels } from "./overlays/LabelOverlay.js";
import { drawHoverHighlight, drawSelectionHighlight } from "./overlays/SelectionOverlay.js";
import { drawUnits } from "./overlays/UnitOverlay.js";

const MAX_TILE_RENDERS_PER_FRAME = 6;
const BG_COLOR = "#0A0F1A";

// Tier-specific chunk renderers
const TIER_RENDERERS = {
  0: renderStrategicChunk,
  1: renderOperationalChunk,
  2: renderTacticalChunk,
  3: renderCloseupChunk,
};

export default class MapRenderer {
  constructor() {
    this.tileCache = new TileCache(64);
    this.minimapCanvas = null; // cached minimap
    this.lastTier = -1;
    this._pendingRender = false;
    this._isAnimating = false;
  }

  // Invalidate all cached tiles (call when feature filters change, data reloads, etc.)
  invalidateAll() {
    this.tileCache.invalidateAll();
    this.minimapCanvas = null;
  }

  // Invalidate tiles in a specific cell region (for unit movement)
  invalidateRegion(colMin, colMax, rowMin, rowMax, cols, rows) {
    for (let tier = 0; tier <= 3; tier++) {
      const chunkSize = getAdaptiveChunkSize(tier, cols, rows);
      this.tileCache.invalidateRegion(colMin, colMax, rowMin, rowMax, chunkSize);
    }
  }

  // Main render frame
  render(ctx, canvasWidth, canvasHeight, viewport, mapData, options = {}) {
    const {
      activeFeatures = null,
      roadNetworks = null,
      nameGroups = null,
      hovCell = null,    // { c, r } or null
      selCell = null,    // { c, r } or null
      units = null,      // array of unit objects
      actorColorMap = {},
      skipLabels = false, // true during zoom animation
      setupOptions = null, // { ghostUnit, isSetupMode, draggedUnitId } for setup mode
    } = options;

    const cols = mapData.cols;
    const rows = mapData.rows;
    const cells = mapData.cells;
    const tier = getTier(viewport.cellPixels);

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Get visible chunks for current tier
    const chunks = getVisibleChunks(viewport, canvasWidth, canvasHeight, cols, rows, tier);
    const chunkSize = getAdaptiveChunkSize(tier, cols, rows);
    let tilesRendered = 0;

    // Draw tile chunks
    for (const chunk of chunks) {
      let tileCanvas = this.tileCache.get(tier, chunk.chunkCol, chunk.chunkRow);

      if (!tileCanvas) {
        if (tilesRendered < MAX_TILE_RENDERS_PER_FRAME) {
          // Render this tile
          const renderer = TIER_RENDERERS[tier];
          if (renderer) {
            tileCanvas = renderer(chunk, viewport.cellPixels, cells, activeFeatures);
            if (tileCanvas) {
              this.tileCache.set(tier, chunk.chunkCol, chunk.chunkRow, tileCanvas);
              tilesRendered++;
            }
          }
        }

        if (!tileCanvas) {
          // Try fallback from lower tier (scaled up)
          const fallback = this.tileCache.getFallback(tier, chunk.chunkCol, chunk.chunkRow, chunkSize, cols, rows);
          if (fallback) {
            tileCanvas = fallback.canvas;
            // Request re-render for next frame
            this._requestRerender();
          }
        }
      }

      if (tileCanvas) {
        // Compute where this chunk draws on screen (hex-aware)
        // gridToScreen returns the CENTER of cell (colStart, rowStart).
        // In the tile canvas, that cell's center is at (layout.padX, layout.padY).
        const screenPos = gridToScreen(chunk.colStart, chunk.rowStart, viewport, canvasWidth, canvasHeight);
        const size = cellPixelsToHexSize(viewport.cellPixels);
        ctx.drawImage(tileCanvas, screenPos.x - size, screenPos.y - size);
      }
    }

    // If we hit the tile render budget, request another frame to finish
    if (tilesRendered >= MAX_TILE_RENDERS_PER_FRAME) {
      this._requestRerender();
    }

    // Linear features (roads, rails, waterways) — drawn as screen-space overlay
    if (roadNetworks && tier >= 1) {
      drawLinearFeatures(ctx, roadNetworks, viewport, canvasWidth, canvasHeight, tier, activeFeatures);
    }

    // Overlays (screen-space, not cached)
    if (!skipLabels) {
      // Name labels
      if (nameGroups && viewport.cellPixels >= 3) {
        drawNameLabels(ctx, viewport, canvasWidth, canvasHeight, nameGroups, cols, rows);
      }

      // Coordinate labels
      if (viewport.cellPixels >= 6) {
        drawCoordLabels(ctx, viewport, canvasWidth, canvasHeight, cols, rows);
      }
    }

    // Units (SimMap only)
    if (units || setupOptions?.ghostUnit) {
      drawUnits(ctx, units, actorColorMap, viewport, canvasWidth, canvasHeight, cols, rows, setupOptions);
    }

    // Selection / hover highlights
    if (hovCell) {
      drawHoverHighlight(ctx, viewport, canvasWidth, canvasHeight, hovCell.c, hovCell.r);
    }
    if (selCell) {
      drawSelectionHighlight(ctx, viewport, canvasWidth, canvasHeight, selCell.c, selCell.r);
    }

    this.lastTier = tier;
  }

  // Render minimap (uses StrategicRenderer for full map)
  renderMinimap(minimapCtx, minimapWidth, minimapHeight, viewport, mapData, canvasWidth, canvasHeight) {
    const cols = mapData.cols;
    const rows = mapData.rows;

    // Render terrain if not cached
    if (!this.minimapCanvas) {
      this.minimapCanvas = renderStrategicFullMap(cols, rows, mapData.cells, Math.max(minimapWidth, minimapHeight));
    }

    // Draw cached terrain
    minimapCtx.drawImage(this.minimapCanvas, 0, 0, minimapWidth, minimapHeight);

    // Viewport rectangle
    const range = getVisibleRange(viewport, canvasWidth, canvasHeight, cols, rows);
    const scaleX = minimapWidth / cols;
    const scaleY = minimapHeight / rows;
    const rx = range.colMin * scaleX;
    const ry = range.rowMin * scaleY;
    const rw = (range.colMax - range.colMin) * scaleX;
    const rh = (range.rowMax - range.rowMin) * scaleY;
    minimapCtx.strokeStyle = "rgba(79,195,247,0.8)";
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeRect(
      Math.max(0, rx), Math.max(0, ry),
      Math.min(rw, minimapWidth), Math.min(rh, minimapHeight)
    );
  }

  // Render full map for PNG export (at Tier 2 quality)
  renderExport(mapData, activeFeatures, roadNetworks, nameGroups) {
    const cols = mapData.cols;
    const rows = mapData.rows;
    const exportCellSize = 28; // match original
    const size = cellPixelsToHexSize(exportCellSize);
    // Hex map dimensions: width includes stagger, height uses row spacing
    const width = Math.ceil(size * SQRT3 * (cols + 0.5)) + 1;
    const height = Math.ceil(size * 1.5 * (rows - 1) + size * 2) + 1;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    // Create a virtual viewport covering the entire map
    const viewport = {
      centerCol: cols / 2,
      centerRow: rows / 2,
      cellPixels: exportCellSize,
    };

    // Render all chunks at Tier 2 directly (no caching needed for export)
    const chunkSize = 8;
    for (let cr = 0; cr < Math.ceil(rows / chunkSize); cr++) {
      for (let cc = 0; cc < Math.ceil(cols / chunkSize); cc++) {
        const chunk = {
          chunkCol: cc, chunkRow: cr,
          colStart: cc * chunkSize, rowStart: cr * chunkSize,
          colEnd: Math.min((cc + 1) * chunkSize, cols),
          rowEnd: Math.min((cr + 1) * chunkSize, rows),
          chunkSize,
        };
        const tile = renderTacticalChunk(chunk, exportCellSize, mapData.cells, activeFeatures);
        if (tile) {
          // Position using hex world coordinates
          const cx = size * SQRT3 * (chunk.colStart + 0.5 * (chunk.rowStart & 1));
          const cy = size * 1.5 * chunk.rowStart;
          ctx.drawImage(tile, cx - size, cy - size);
        }
      }
    }

    // Road overlays
    if (roadNetworks) {
      drawLinearFeatures(ctx, roadNetworks, viewport, width, height, 2, activeFeatures);
    }

    // Labels
    if (nameGroups) {
      drawNameLabels(ctx, viewport, width, height, nameGroups, cols, rows, { centerFade: false });
      drawCoordLabels(ctx, viewport, width, height, cols, rows);
    }

    return canvas;
  }

  // Internal: request re-render on next frame (for progressive tile loading)
  _requestRerender() {
    if (this._pendingRender) return;
    this._pendingRender = true;
    requestAnimationFrame(() => {
      this._pendingRender = false;
      // The component using MapRenderer should call render() again
      // This is signaled via the onNeedsRerender callback if set
      if (this.onNeedsRerender) this.onNeedsRerender();
    });
  }

  get stats() {
    return {
      cachedTiles: this.tileCache.size,
      memoryMB: this.tileCache.memoryMB,
      lastTier: this.lastTier,
    };
  }
}
