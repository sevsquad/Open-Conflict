/**
 * visual-snapshot.mjs — take real browser screenshots of key app views.
 *
 * Uses puppeteer-core + the system Chrome install so no extra downloads needed.
 * Screenshots are saved to tests/visual/ as PNG files that Claude can Read
 * to visually verify rendering (the Read tool supports image display).
 *
 * Usage:
 *   npm run visual:snapshot            # headless, saves screenshots
 *   npm run visual:snapshot -- --show  # visible browser window
 *
 * Then in Claude: Read("tests/visual/viewer-test.png") to see the render.
 */

import puppeteer from 'puppeteer-core';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'tests', 'visual');
const BASE_URL = 'http://localhost:5173';

// Common Chrome locations on Windows (checked in order)
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

const SHOW_BROWSER = process.argv.includes('--show');

// ── Snapshot definitions ──────────────────────────────────────
// waitFor: ms to wait after navigation before screenshot.
// Needs to be long enough for WebGL tile atlas generation.

const SNAPSHOTS = [
  {
    name: 'menu',
    url: `${BASE_URL}/`,
    waitFor: 800,
    desc: 'Main menu',
  },
  {
    name: 'viewer-empty',
    url: `${BASE_URL}/?mode=viewer`,
    waitFor: 1200,
    desc: 'Viewer with no map loaded (file browser)',
  },
  {
    name: 'viewer-test',
    url: `${BASE_URL}/?mode=viewer&test=true`,
    waitFor: 3000,
    desc: 'Viewer with 12x18 test fixture',
  },
  {
    name: 'viewer-elev',
    url: `${BASE_URL}/?mode=viewer&test=true`,
    waitFor: 3000,
    desc: 'Viewer with elevation (topo) mode',
    after: async (page) => {
      // Press E to toggle elevation mode
      await page.keyboard.press('e');
      await new Promise(r => setTimeout(r, 800));
    },
  },
  {
    name: 'sim-setup',
    url: `${BASE_URL}/?mode=simulation&test=true`,
    waitFor: 2500,
    desc: 'Simulation setup screen',
  },
  {
    name: 'sim-quickstart',
    url: `${BASE_URL}/?mode=simulation&preset=quickstart&test=true`,
    waitFor: 4000,
    desc: 'Simulation Turn 1, planning phase',
  },
];

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const chromePath = CHROME_PATHS.find(p => existsSync(p));
  if (!chromePath) {
    console.error('Chrome not found. Set CHROME_PATH env var or install Chrome.');
    console.error('Checked:', CHROME_PATHS);
    process.exit(1);
  }

  // Ensure dev server is reachable before starting
  try {
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`Dev server not reachable at ${BASE_URL}`);
    console.error('Run "npm run dev" in another terminal first.');
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Chrome: ${chromePath}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Mode: ${SHOW_BROWSER ? 'visible' : 'headless'}\n`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: SHOW_BROWSER ? false : 'new',
    defaultViewport: { width: 1280, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Allow WebGL in headless mode
      '--enable-webgl',
      '--use-gl=angle',
      '--enable-features=VaapiVideoDecoder',
    ],
  });

  const page = await browser.newPage();

  // Capture console logs from the page so we can wait for tile atlas
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('[TileAtlas]') || text.includes('[URL]')) {
      process.stdout.write(`  [page] ${text}\n`);
    }
  });
  page.on('pageerror', err => {
    console.error(`  [ERROR] ${err.message}`);
  });

  for (const snap of SNAPSHOTS) {
    consoleLogs.length = 0;
    console.log(`▶ ${snap.name} — ${snap.desc}`);
    console.log(`  URL: ${snap.url}`);

    await page.goto(snap.url, { waitUntil: 'networkidle0', timeout: 15000 });

    // Wait for tile atlas if this view renders a map
    if (snap.url.includes('test=true')) {
      const deadline = Date.now() + 8000;
      while (!consoleLogs.some(l => l.includes('[TileAtlas]')) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Fixed wait for render completion
    await new Promise(r => setTimeout(r, snap.waitFor));

    // Run any post-navigation actions (e.g. keypress)
    if (snap.after) {
      await snap.after(page);
    }

    const outPath = path.join(OUTPUT_DIR, `${snap.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  ✓ saved ${path.relative(ROOT, outPath)}\n`);
  }

  await browser.close();

  console.log('Done. To view screenshots in Claude, run:');
  console.log('  Read("tests/visual/<name>.png")');
  console.log('\nFiles saved:');
  for (const snap of SNAPSHOTS) {
    console.log(`  tests/visual/${snap.name}.png — ${snap.desc}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
