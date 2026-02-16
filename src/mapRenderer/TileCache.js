// ════════════════════════════════════════════════════════════════
// TileCache — off-screen canvas tile cache with LRU eviction
// ════════════════════════════════════════════════════════════════

export default class TileCache {
  constructor(maxMemoryMB = 64) {
    this.cache = new Map(); // key → { canvas, lastUsed, memBytes }
    this.maxBytes = maxMemoryMB * 1024 * 1024;
    this.currentBytes = 0;
  }

  _key(tier, chunkCol, chunkRow) {
    return `${tier}:${chunkCol}:${chunkRow}`;
  }

  get(tier, chunkCol, chunkRow) {
    const key = this._key(tier, chunkCol, chunkRow);
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastUsed = performance.now();
      return entry.canvas;
    }
    return null;
  }

  set(tier, chunkCol, chunkRow, canvas) {
    const key = this._key(tier, chunkCol, chunkRow);
    // Remove old entry if exists
    const old = this.cache.get(key);
    if (old) this.currentBytes -= old.memBytes;
    const memBytes = canvas.width * canvas.height * 4; // RGBA
    this.currentBytes += memBytes;
    this.cache.set(key, { canvas, lastUsed: performance.now(), memBytes });
    this._evictIfNeeded();
  }

  invalidateAll() {
    this.cache.clear();
    this.currentBytes = 0;
  }

  invalidateTier(tier) {
    for (const [key, entry] of this.cache) {
      if (key.startsWith(`${tier}:`)) {
        this.currentBytes -= entry.memBytes;
        this.cache.delete(key);
      }
    }
  }

  invalidateRegion(colMin, colMax, rowMin, rowMax, chunkSize) {
    const ccMin = Math.floor(colMin / chunkSize);
    const ccMax = Math.ceil(colMax / chunkSize);
    const crMin = Math.floor(rowMin / chunkSize);
    const crMax = Math.ceil(rowMax / chunkSize);
    for (const [key, entry] of this.cache) {
      const parts = key.split(":");
      const cc = parseInt(parts[1]);
      const cr = parseInt(parts[2]);
      if (cc >= ccMin && cc < ccMax && cr >= crMin && cr < crMax) {
        this.currentBytes -= entry.memBytes;
        this.cache.delete(key);
      }
    }
  }

  _evictIfNeeded() {
    if (this.currentBytes <= this.maxBytes) return;
    // Sort by lastUsed ascending (oldest first)
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    // Evict until we're at 75% capacity
    const target = this.maxBytes * 0.75;
    while (this.currentBytes > target && entries.length > 0) {
      const [key, entry] = entries.shift();
      this.currentBytes -= entry.memBytes;
      this.cache.delete(key);
    }
  }

  get size() {
    return this.cache.size;
  }

  get memoryMB() {
    return (this.currentBytes / (1024 * 1024)).toFixed(1);
  }
}
