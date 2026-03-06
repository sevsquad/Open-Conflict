// Direct test: read WC tile for Paris and check what pixel values we get
import { fromUrl } from 'geotiff';

const WC_BASE = "http://localhost:5173/api/wc";
const tileId = "N48E000";
const url = `${WC_BASE}/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tileId}_Map.tif`;

// Paris bbox (2km x 2km around 48.8566, 2.3522)
const bbox = {
  south: 48.8566 - 0.009,
  north: 48.8566 + 0.009,
  west: 2.3522 - 0.0135,
  east: 2.3522 + 0.0135,
};

console.log("Fetching WC tile:", tileId);
console.log("Bbox:", bbox);

try {
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const imgW = image.getWidth();
  const imgH = image.getHeight();
  console.log("Image dimensions:", imgW, "x", imgH);

  // Tile bbox (N48E000 = 48-51°N, 0-3°E)
  const tileBbox = { south: 48, north: 51, west: 0, east: 3 };

  // Pixel window for our bbox
  const px0 = Math.max(0, Math.floor((bbox.west - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
  const py0 = Math.max(0, Math.floor((tileBbox.north - bbox.north) / (tileBbox.north - tileBbox.south) * imgH));
  const px1 = Math.min(imgW, Math.ceil((bbox.east - tileBbox.west) / (tileBbox.east - tileBbox.west) * imgW));
  const py1 = Math.min(imgH, Math.ceil((tileBbox.north - bbox.south) / (tileBbox.north - tileBbox.south) * imgH));

  console.log("Pixel window:", px0, py0, px1, py1);
  console.log("Native size:", px1 - px0, "x", py1 - py0);

  const rasters = await image.readRasters({
    window: [px0, py0, px1, py1],
    width: px1 - px0,
    height: py1 - py0,
    resampleMethod: "nearest",
  });

  const data = rasters[0];
  console.log("Raster data length:", data.length);
  console.log("Expected:", (px1 - px0) * (py1 - py0));

  // Count WC class values
  const classCounts = {};
  let zeros = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === 0) zeros++;
    classCounts[v] = (classCounts[v] || 0) + 1;
  }

  console.log("\nWC class distribution:");
  const WC_NAMES = {
    0: "no_data", 10: "tree_cover", 20: "shrubland", 30: "grassland",
    40: "cropland", 50: "built_up", 60: "bare_sparse", 70: "snow_ice",
    80: "water", 90: "wetland", 95: "mangrove", 100: "moss_lichen"
  };

  for (const [cls, cnt] of Object.entries(classCounts).sort((a,b) => b[1] - a[1])) {
    const pct = (cnt / data.length * 100).toFixed(1);
    console.log(`  Class ${cls} (${WC_NAMES[cls] || "unknown"}): ${cnt} pixels (${pct}%)`);
  }

  // Sample center pixels
  const w = px1 - px0, h = py1 - py0;
  const centerY = Math.floor(h / 2), centerX = Math.floor(w / 2);
  console.log(`\nCenter pixel (${centerX}, ${centerY}): class ${data[centerY * w + centerX]}`);
  console.log("5x5 center sample:");
  for (let dy = -2; dy <= 2; dy++) {
    let row = "";
    for (let dx = -2; dx <= 2; dx++) {
      row += String(data[(centerY + dy) * w + (centerX + dx)]).padStart(4);
    }
    console.log("  ", row);
  }

} catch (e) {
  console.error("Error:", e.message);
}
