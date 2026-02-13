# Open Conflict v0.10

Terrain analysis toolkit for wargaming and operational planning. Generates structured terrain maps from satellite data (ESA WorldCover, OpenStreetMap, SRTM elevation) at six military planning scales from squad-level to theater.

## Quick Start

**Prerequisites:** Node.js 18+

**First run:**
```
cd open-conflict
npm install
```

**Launch:**
- Mac/Linux: `./launch.sh` (or double-click)
- Windows: double-click `launch.bat`
- Manual: `npm run dev`

Opens at http://localhost:5173

## Structure

```
open-conflict/
├── launch.sh / launch.bat    # One-click launchers
├── vite.config.js             # Dev server + save API + proxy config
├── src/
│   ├── App.jsx                # Menu shell — routes to Parser or Viewer
│   ├── Parser.jsx             # Terrain generation engine (~3000 lines)
│   ├── Viewer.jsx             # Interactive map viewer (~650 lines)
│   └── main.jsx               # React entry point
├── saves/                     # Auto-saved terrain maps (JSON)
└── viewer-standalone.html     # Standalone viewer (no Node.js needed)
```

## Tools

### Terrain Parser
Generates terrain grids from real-world data. Select a scale preset (Close through Theater) and a location, then generate. Each cell gets:
- Terrain type (18 classifications)
- Elevation (meters)
- Features (roads, railways, waterways, military installations, etc.)
- Attributes (slope, ridgeline, treeline, hedgerow, chokepoint, etc.)
- Feature names (settlement and river names from OSM/Wikidata)

Maps auto-save to `saves/` with names derived from the nearest settlement.

### Map Viewer
Interactive canvas viewer with zoom/pan, feature filtering, cell inspection, and exports:
- **PNG** — annotated map image with name labels
- **LLM Export** — text format optimized for language model consumption
- **Saved Maps** — browse and load from the saves folder

The standalone `viewer-standalone.html` works without Node.js for sharing exports.

## Data Sources
- **ESA WorldCover** — 10m land cover classification
- **OpenStreetMap** — infrastructure, buildings, waterways, barriers
- **SRTM** — 30m elevation data
- **Wikidata** — river name resolution

## Scale Presets

| Scale | Cell Size | Default Extent | Echelon |
|-------|-----------|----------------|---------|
| Close | 100m | 8×8km | Platoon–Company |
| Tactical | 500m | 40×40km | Company–Battalion |
| Grand Tactical | 2km | 150×150km | Battalion–Brigade |
| Operational | 5km | 350×350km | Brigade–Division |
| Strategic | 10km | 1000×1000km | Division–Corps |
| Theater | 20km | 2000×2000km | Corps+ |
