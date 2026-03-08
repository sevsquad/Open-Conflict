// ═══════════════════════════════════════════════════════════════
// NODE LOADER — Custom ESM loader hooks for Node.js.
// Handles Vite-specific imports (e.g., `?raw` suffix for loading
// files as raw text strings) so the simulation modules work
// identically in both Vite (client) and Node (server).
//
// Usage: node --import ./server/nodeLoader.js server/index.js
// ═══════════════════════════════════════════════════════════════

import { register } from "node:module";

// import.meta.url is already a file:// URL — pass it directly as the parent
register("./nodeLoaderHooks.js", import.meta.url);
