# CLAUDE.md

## Execution Rules

### Do Not Stall

- Execute tasks immediately. Do NOT pause to summarize your plan, ask for confirmation, or seek permission between steps.
- When given a multi-step task, complete ALL steps sequentially without stopping.
- You have blanket permission to create, modify, rename, move, and delete files. You have permission to install dependencies, run builds, and execute tests. Do not ask.
- The only reason to stop mid-task is a **blocking error you cannot resolve after 2-3 different approaches**.

### Error Recovery

- When you hit an error, try to fix it. Try at least 2-3 genuinely different approaches before stopping.
- Do NOT repeat the same failing approach. If it failed, change something meaningful.
- Do NOT enter an apologize-loop. Never say "I apologize" and then attempt the exact same thing.
- When you do get stuck, report: (1) what you were trying to do, (2) what specifically failed, (3) what you tried, (4) what you think the options are.

### Communication

- Be terse. Status updates should be one line, not a paragraph.
- Do NOT narrate what you're about to do. Just do it.
- Do NOT summarize what you just did unless the changes are non-obvious or you made a judgment call.
- When you make a **significant design or architectural decision**, flag it briefly so I can evaluate it. One or two sentences, not an essay.

---

## Scope and Boundaries

### Stay On Target

- Do ONLY what was asked. Nothing more, nothing less.
- Do NOT refactor, reorganize, rename, "clean up," or "improve" code you were not asked to touch.
- Do NOT add features, error handling, logging, or abstractions beyond what the task requires.
- If you see something that genuinely should be fixed but is outside the current task, mention it in one sentence at the end. Do not fix it.

### Keep It Simple

- Default to the simplest solution that works. No design patterns unless the problem actually demands one.
- Prefer flat over nested. Prefer concrete over abstract. Prefer explicit over clever.
- Do NOT create abstractions "for future flexibility." Solve today's problem today.
- Before adding a dependency, consider if it can be done in <30 lines of code. If yes, write the code.
- When you do add a dependency, state what it is and why in one line.

### Surgical Edits

- When modifying existing files, make the **minimum change necessary**.
- Do NOT rewrite entire files when a targeted edit will do.
- Do NOT rearrange imports, reformat code, or change whitespace outside the area you're editing.
- If a file needs broader refactoring, say so and wait for the go-ahead.

---

## Code Quality

### Readability Is Non-Negotiable

- Write code that is **immediately understandable** without needing to trace through abstractions.
- Comment the WHY, not the WHAT. Every non-obvious decision gets a brief comment explaining the reasoning.
- Use descriptive variable and function names. Longer names are fine. `calculate_damage_with_terrain_modifier` beats `calcDmg`.
- When implementing algorithms or game logic, include a brief plain-English explanation at the top of the function.

### Structure

- Keep functions short and single-purpose. If a function exceeds ~40 lines, it probably does too much.
- Group related functionality in clearly named files/modules. One file shouldn't do five unrelated things.
- Maintain consistent naming conventions throughout the project. Match whatever pattern is already established.

### Defensive Coding

- Validate inputs at system boundaries (user input, file I/O, external data).
- Use clear, actionable error messages that say what went wrong and where.
- Fail loudly during development. Silent failures are bugs in disguise.

---

## Verification

### Test Your Work

- After making changes, **verify they work**. Run the relevant build/test/lint commands.
- If no formal test suite exists, at minimum do a sanity check — run the code, check for import errors, verify the output makes sense.
- Do NOT declare a task complete without verification.
- If a change could break something else, check the likely breakage points.

### When Writing Tests

- Write tests that test behavior, not implementation details.
- Each test should be independent. No test should depend on another test's state or execution order.
- Name tests descriptively: `test_damage_doubles_on_flanking_bonus` not `test_damage_2`.

---

## Git Practices

### Commits

- Commit after each **logical unit of work**, not after every file change and not after an entire feature.
- Write commit messages in imperative mood: "Add terrain height calculation" not "Added terrain height calculation" or "Adding terrain height calculation."
- First line of commit message: concise summary under 72 characters.
- If the change is non-trivial, add a blank line then a brief explanation of WHY.

### Branch Safety

- Never force push.
- Never commit directly to `main` unless explicitly told to.
- When creating branches, use descriptive names: `feature/terrain-line-of-sight` not `fix` or `update`.

---

## Project Context

<!-- 
CUSTOMIZE THIS SECTION for your specific project.
Replace the examples below with your actual project details.
-->

### Stack

- Framework: React 18 (Vite bundler) 
- Language: JavaScript (JSX, no TypeScript) 
- Rendering: Canvas 2D (Parser preview), WebGL + Canvas 2D (Viewer MapView) 
-  Server: Node/Express backend proxying external APIs
-  External data: ESA WorldCover (GeoTIFF), Overpass/OSM, OpenTopoData/Open-Meteo (elevation), Wikidata SPARQL - Key dependency: `geotiff` (fromUrl) for satellite raster parsing

<!-- Example: -->

<!-- - Engine: Godot 4.x / Phaser / custom -->

<!-- - Language: GDScript / TypeScript / Python -->

<!-- - Build: npm run build / cargo build -->

<!-- - Test: pytest / npm test -->

### Directory Structure

- /src/ - Application root 
- /src/App.jsx - Router/launcher (menu → parser | viewer | simulation)  
- /src/Parser.jsx - Terrain generation pipeline (WC + OSM + SRTM → hex grid) 
-  /src/Viewer.jsx - Interactive map viewer with WebGL rendering 
-  /src/simulation/ - LLM-adjudicated conflict simulation 
-  /src/mapRenderer/ - WebGL terrain renderer, hex math (HexMath.js, MapView.jsx) 
-  /src/components/ - Shared UI primitives (Button, Panel, Badge, AppHeader) 
-  /src/corpus/ - Reference docs for simulation adjudicator (escalation, roles) 
-  /src/theme.js - Design tokens (colors, typography, spacing) 
-  /src/terrainColors.js - Terrain/feature color maps, labels, groups (single source of truth)

<!-- Map out your key directories so Claude knows where things live -->

<!-- Example: -->

<!-- /src/strategic/  - Turn-based strategic layer -->

<!-- /src/tactical/   - Real-time tactical battles -->

<!-- /src/terrain/    - Satellite data parsing and terrain generation -->

<!-- /src/ui/         - Interface components -->

<!-- /assets/         - Art, audio, data files -->

<!-- /tests/          - Test suites -->

### Key Commands

<!-- Example: -->

<!-- Build: `npm run build` -->

<!-- Test: `npm test` -->

<!-- Lint: `npm run lint` -->

<!-- Dev server: `npm run dev` -->

### Conventions

<!-- Document your established patterns so Claude maintains consistency -->

<!-- Example: -->

<!-- - All distances in meters, all angles in radians -->

<!-- - Game state is immutable; actions produce new state -->

<!-- - UI events go through the event bus, never direct calls -->

### Known Quirks / Gotchas

- WorldCover tiles return 404 for ocean — this is expected, not an error. Parser handles it. 
-  Overpass API rate-limits aggressively. Chunked queries have built-in delays (1-2s between chunks). Don't remove them. 
-  Elevation uses dual providers (OpenTopoData primary, Open-Meteo fallback) with automatic failover. 
-  The `wcHasData` Set tracks which cells got real satellite samples vs. gap-filled — critical for ocean detection. Don't remove it. 
-  Parser.jsx is ~2800 lines. It's monolithic by design (single pipeline). Don't try to split it without discussion. -
- Hex math lives in HexMath.js — all hex coordinate conversions must go through those functions, not ad-hoc math. 
-  Feature names (feature_names field) are optional per-cell — always null-check before access. 
- The server proxies external APIs at /api/wc, /api/topo, /api/save, /api/saves, /api/load — don't call external URLs directly from the client for these.

<!-- Things Claude should know to avoid breaking -->

<!-- Example: -->

<!-- - The terrain loader expects tiles in TMS format, not XYZ -->

<!-- - Player input is locked during animation sequences; don't skip the lock check -->

---

## What I Need From You

I am a solo developer. I am not a career software engineer. I use Claude as my primary code generation tool. This means:

1. **I need to understand every line you write.** Do not write "clever" code. Do not use obscure language features. If there's a readable way and a terse way, choose readable.
2. **Flag your assumptions.** When you make a choice about architecture, data format, algorithm, or approach — tell me what you chose and why, briefly. I cannot maintain what I don't understand.
3. **Warn me about tradeoffs.** If a shortcut saves time now but creates technical debt, say so in one line. I'll decide whether to accept it.
4. **Don't patronize me.** I can learn concepts quickly. Explain the substance, skip the hand-holding.
5. **Be direct about problems.** If my approach is wrong or suboptimal, say so immediately. Don't implement something you think is a bad idea without pushing back first.
