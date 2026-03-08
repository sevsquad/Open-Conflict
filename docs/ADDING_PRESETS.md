# Adding Preset Scenarios

## Quick Reference

Presets live in two files:
- **`src/simulation/presets.js`** — Scenario data (units, actors, objectives, rules)
- **`src/simulation/preset-maps/index.js`** — Map generator registry (for "built-in" maps)

## Map Types

Each preset uses one of three map sources:

| `mapType` | Description | Map Source |
|-----------|-------------|------------|
| `"test-fixture"` | Built-in 12x15 test grid | `src/testFixture.js` |
| `"saves"` | Parsed map from `saves/` | User must have parsed the map via Parser |
| `"built-in"` | Generated from code | `src/simulation/preset-maps/<name>.js` |

## Steps to Add a New Preset

### 1. Add the registry entry in `presets.js`

Add to the `PRESET_REGISTRY` array:

```js
{
  id: "my_scenario",           // Unique ID (snake_case)
  name: "My Scenario",         // Display name
  description: "Brief description shown in the UI.",
  era: "modern",               // "ww2" | "cold_war" | "modern"
  scale: "tactical",           // "sub_tactical" | "tactical" | "grand_tactical"
  mapType: "built-in",         // See table above
  requiredMap: "my_scenario",  // For "saves": substring match on filename
  getPreset: () => getMyScenarioPreset(),
}
```

### 2. Write the preset function in `presets.js`

```js
function getMyScenarioPreset() {
  presetCounter = 0; // Reset for deterministic IDs

  return {
    scale: "tactical",
    title: "My Scenario",
    description: "...",
    initialConditions: "...",
    specialRules: "...",
    turnDuration: "1 hour",
    startDate: "2024-01-15",
    environment: {
      weather: "clear", visibility: "good", groundCondition: "dry",
      timeOfDay: "morning", climate: "temperate", stability: "medium",
      severity: "light",
    },
    actors: [
      { id: "actor_1", name: "Blue Force", controller: "player",
        objectives: [...], constraints: [...] },
      { id: "actor_2", name: "Red Force", controller: "player",
        objectives: [...], constraints: [...] },
    ],
    units: [
      // Use uid() for each unit ID — reset presetCounter = 0 at top
      { id: uid(), actor: "actor_1", name: "1st Platoon", type: "infantry",
        echelon: "company", posture: "ready", position: "5,3",
        strength: 100, supply: 100, status: "ready", notes: "",
        morale: 80, cohesion: 80, ammo: 90, entrenchment: 0,
        detected: true, parentHQ: "", movementType: "foot",
        specialCapabilities: [] },
      // ... more units
    ],
  };
}
```

### 3. For "built-in" maps: Create a map generator

Create `src/simulation/preset-maps/myScenario.js`:

```js
// Returns a terrain map object (same format as Parser output)
export function generateMyScenarioMap() {
  const cols = 20, rows = 25;
  const cellSizeKm = 0.5;
  const cells = {};

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[`${c},${r}`] = {
        terrain: "grassland",       // Primary terrain type
        elevation: 100,             // Meters
        features: [],               // e.g. ["road", "bridge"]
        feature_names: null,        // Optional { road: "Route 7" }
      };
    }
  }

  return {
    cols, rows, cellSizeKm,
    widthKm: cols * cellSizeKm,
    heightKm: rows * cellSizeKm,
    center: { lat: 50.0, lng: 9.0 },
    cells,
  };
}
```

Then register it in `src/simulation/preset-maps/index.js`:

```js
import { generateMyScenarioMap } from "./myScenario.js";

const PRESET_MAP_GENERATORS = {
  my_scenario: { generate: generateMyScenarioMap, cacheKey: "my_scenario" },
};
```

### 4. For "saves" maps: Parse via the Parser

1. Open the app at `/?mode=parser`
2. Set the coordinates, area, and cell size to match your scenario
3. Run the parse pipeline
4. Save the result — it goes to `saves/<name>.json`
5. Set `requiredMap` to a substring of the filename

The preset will match if `savedFileName.includes(requiredMap)`.

## Game Folder System

When a user starts a game from a preset:
1. A naming modal appears
2. The system creates `games/<slugified-name>/`
3. Terrain is copied to `games/<name>/terrain.json`
4. Game state saves to `games/<name>/state.json`

This means clearing `saves/` won't break saved games — each game has its own terrain copy.

Preset terrain (for "built-in" maps) is cached in `games/presets/<cacheKey>.json` after first generation.

## Terrain Cell Format

Each cell in the `cells` object is keyed as `"col,row"`:

```js
{
  terrain: "forest",          // Primary: grassland, forest, urban, water, etc.
  elevation: 450,             // Meters above sea level
  features: ["road", "river"],// Overlay features
  feature_names: {            // Optional names
    road: "Highway 1",
    river: "Volturno River"
  },
}
```

Common terrain types: `grassland`, `forest`, `urban`, `water`, `cropland`, `bare`, `shrubland`, `wetland`, `snow`

Common features: `road`, `trail`, `river`, `stream`, `bridge`, `building`, `fence`, `wall`, `railway`

## Unit Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Use `uid()` — auto-increments |
| `actor` | string | `"actor_1"` or `"actor_2"` |
| `name` | string | Display name |
| `type` | string | `infantry`, `armor`, `artillery`, `recon`, `engineer`, `headquarters`, `logistics`, etc. |
| `echelon` | string | `company`, `battalion`, `brigade`, `artillery_battery` |
| `posture` | string | `ready`, `attacking`, `defending`, `dug_in`, `moving`, `reserve` |
| `position` | string | `"col,row"` hex position |
| `strength` | number | 0-100 |
| `supply` | number | 0-100 |
| `morale` | number | 0-100 |
| `cohesion` | number | 0-100 |
| `ammo` | number | 0-100 |
| `entrenchment` | number | 0-100 |
| `detected` | boolean | Whether enemy can see this unit |
| `parentHQ` | string | ID of parent HQ unit (for command hierarchy) |
| `movementType` | string | `foot`, `wheeled`, `tracked` |
| `specialCapabilities` | array | e.g. `["cliff_assault"]`, `["ied_detection"]` |

## Scale Tiers

| Scale | Echelon | Turn Duration | Cell Size | Active Systems |
|-------|---------|---------------|-----------|----------------|
| `sub_tactical` | Fireteam/Squad | 5-15 min | 50-100m | Detection, fatigue, building combat |
| `tactical` | Platoon/Company | 30min-2hr | 100-500m | Morale, cohesion, combined arms |
| `grand_tactical` | Company/Battalion | 2-6hr | 0.5-2km | Supply, command hierarchy, combined arms bonus |
