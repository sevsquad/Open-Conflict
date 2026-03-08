// ═══════════════════════════════════════════════════════════════
// NODE LOADER HOOKS — ESM resolve/load hooks for Vite compat.
// Handles `?raw` imports: strips the query param for resolution,
// then reads the file as UTF-8 and exports it as a default string.
// ═══════════════════════════════════════════════════════════════

import fs from "fs";
import { fileURLToPath } from "url";

/**
 * Resolve hook: strip `?raw` query so Node finds the actual file.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("?raw")) {
    const cleaned = specifier.slice(0, -4); // remove "?raw"
    return nextResolve(cleaned, context);
  }
  return nextResolve(specifier, context);
}

/**
 * Load hook: if the original specifier had `?raw`, read the file
 * and return it as a JS module that default-exports the string.
 */
export async function load(url, context, nextLoad) {
  // Check if this was a ?raw import by looking at the file extension.
  // The resolve hook already stripped ?raw, but we can detect .md files
  // (and other non-JS files) that should be loaded as raw text.
  const extensions = [".md", ".txt", ".csv", ".glsl", ".vert", ".frag"];
  const isRawText = extensions.some(ext => url.endsWith(ext));

  if (isRawText) {
    const filepath = fileURLToPath(url);
    const content = fs.readFileSync(filepath, "utf-8");
    // Export as a default string, escaping backticks and dollar signs
    const escaped = content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
    return {
      format: "module",
      source: `export default \`${escaped}\`;`,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
