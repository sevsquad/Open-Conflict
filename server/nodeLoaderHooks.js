import fs from "fs";
import { fileURLToPath } from "url";
import { transform } from "esbuild";

export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("?raw")) {
    const cleaned = specifier.slice(0, -4);
    return nextResolve(cleaned, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const extensions = [".md", ".txt", ".csv", ".glsl", ".vert", ".frag"];
  const isRawText = extensions.some(ext => url.endsWith(ext));

  if (isRawText) {
    const filepath = fileURLToPath(url);
    const content = fs.readFileSync(filepath, "utf-8");
    const escaped = content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
    return {
      format: "module",
      source: `export default \`${escaped}\`;`,
      shortCircuit: true,
    };
  }

  if (url.endsWith(".json")) {
    const filepath = fileURLToPath(url);
    const json = fs.readFileSync(filepath, "utf-8");
    return {
      format: "module",
      source: `export default ${json.trim()};`,
      shortCircuit: true,
    };
  }

  if (url.endsWith(".jsx") || url.endsWith(".tsx")) {
    const filepath = fileURLToPath(url);
    const source = fs.readFileSync(filepath, "utf-8");
    const loader = url.endsWith(".tsx") ? "tsx" : "jsx";
    const result = await transform(source, {
      loader,
      format: "esm",
      jsx: "automatic",
      target: "es2020",
      sourcefile: filepath,
      sourcemap: "inline",
    });
    return {
      format: "module",
      source: result.code,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
