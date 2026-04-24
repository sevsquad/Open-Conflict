# Open Conflict v0.10 Feature List

Compiled from the current application shell, simulation flows, PBEM client/server routes, and supporting docs. This list aims to capture implemented capabilities, not roadmap ideas.

## Core Product Modes

- Terrain Parser
- Map Viewer
- Simulation sandbox
- PBEM game dashboard
- World Scanner

## Terrain Parser

- Generates structured terrain maps from real-world sources including ESA WorldCover, OpenStreetMap, SRTM elevation, and OpenTopoData-backed elevation helpers.
- Supports military planning scales from close/tactical through theater-scale map generation.
- Classifies terrain into a large catalog of terrain types, infrastructure types, and tactical attributes.
- Resolves roads, rail, waterways, ports, airfields, military sites, buildings, and named features into the grid.
- Uses hex-grid geographic projection logic that supports large maps and difficult longitude cases.
- Includes city search-driven location selection for building maps from named places.
- Can derive a strategic grid from finer-resolution terrain for multi-scale viewing.
- Auto-saves generated maps for later loading.

## Map Viewer

- Loads terrain from parser output, saved server-side maps, or local JSON files.
- Supports zoom, pan, fit-to-map, keyboard navigation, hover/select inspection, and grouped feature filters.
- Provides minimap support and an elevation visualization toggle.
- Exports annotated terrain PNGs, elevation PNGs, and compact LLM-oriented text exports.
- Reconstructs and displays dual-resolution terrain when fine-grid data is present.
- Includes a standalone viewer HTML file for sharing exports without running the full app.

## Scenario Setup And Sandbox Authoring

- Starts simulations from saved terrain maps, saved games, built-in fixtures, or built-in generated preset maps.
- Offers a quick-start scenario browser with multiple built-in scenarios across WW2, Cold War, and modern eras.
- Supports custom scenario authoring with title, description, initial conditions, special rules, turn duration, start date, and environment settings.
- Lets designers add and remove actors, objectives, constraints, and AI controller settings.
- Lets designers place, duplicate, edit, and remove units directly on the map.
- Supports terrain editing during scenario setup.
- Supports victory-point hexes and actor-specific critical-vulnerability-point hexes.
- Can enable a strategic overlay/grid during setup.
- Creates folder-based game storage for new scenarios.

## Live Simulation

- Runs a turn-state machine covering planning, handoff, detection, movement/detection, adjudication, review, challenge, counter-rebuttal, re-adjudication, and resolution.
- Uses sealed per-actor orders and handoff screens for hotseat privacy.
- Applies fog of war with actor-specific visibility, detected contacts, and filtered adjudication views.
- Supports structured movement and action orders with path previews, range checks, and order validation helpers.
- Supports reinforcement placement and map-based unit interaction during play.
- Uses LLM adjudication with challenge and re-adjudication loops.
- Tracks fortune rolls, friction events, movement outcomes, narratives, and turn logs.
- Builds per-actor and full-command markdown briefings for external LLM or human play.
- Supports save, autosave, reload, pause, resume, and end-game flows.
- Includes an air-system test runner mode for validating air operations behavior.

## AI Commander Features

- Supports AI-controlled actors inside local simulations.
- Generates AI orders client-side with provider/model selection and optional vision-model map capture.
- Records AI call logs, prompts, responses, and readable transcripts for auditing.
- Stores and displays commander thought text for spectator/debug views.
- Supports all-AI simulations in step mode or auto-run mode.
- Includes multiple AI behavior profiles such as Balanced, Aggressive Breakthrough, Cautious Defender, Rough Terrain Flanker, and Urban Grinder.
- Includes selectable think budgets from Fast through Deliberate.

## PBEM Multiplayer

- Creates asynchronous PBEM games from the dashboard.
- Supports invite-token join flow for players and local session persistence in the browser.
- Supports player-facing PBEM gameplay with planning, waiting, review, challenge, and rebuttal phases.
- Auto-saves draft orders with a debounced Google Docs-style workflow.
- Polls for turn status and loads per-turn adjudication results from the server.
- Supports challenge submission tied to specific units plus rebuttal submission after opponent challenges.
- Supports both Human Moderator and Player Moderator processing models.
- Allows mixed human/AI rosters plus per-actor AI profile and think-budget selection during game creation.
- Returns moderator tokens and per-actor invite tokens during game creation.
- Supports turn deadlines and email-driven invite/result/your-turn notifications when email is configured.

## Moderator Tools

- Provides a full-screen moderator panel with god-view state access.
- Shows player roster, join status, and per-turn order submission status.
- Allows manual turn processing and turn finalization.
- Allows pause, resume, and end-game controls.
- Shows a recent game log for moderator review.

## World Scanner

- Runs browser-side world scanning at 10 km strategic resolution or 0.5 km tactical resolution.
- Requests persistent browser storage to protect cached scan data.
- Uses a wake lock to keep long-running scans alive.
- Tracks scan progress, completed cells, failed patches, and total coverage.
- Supports pause/resume behavior, retrying failed patches, verification passes, and full reset.
- Stores a patch manifest and exposes a clickable world patch map with per-patch inspection.

## Backend And Persistence

- Uses an Express backend with SQLite persistence.
- Exposes health and configured-LLM-provider endpoints.
- Proxies terrain/elevation requests to upstream terrain data services.
- Provides a rate-limited LLM adjudication proxy.
- Stores terrain saves, game folders, preset terrain caches, and generated artifacts.
- Exposes player-facing PBEM APIs and moderator-facing admin APIs.
- Supports folder-based game storage plus list/load endpoints for maps and games.

## Built-In Content And Test Harnesses

- Includes built-in scenario presets such as Contested River Crossing, Signal Station Nightfall, Bocage Breakout, Fulda Gap, Mosul Corridor, Volturno Crossing, air-reference tests, AI reference, and AI-vs-AI duel scenarios.
- Includes code-generated preset maps that can be cached server-side for reuse.
- Includes smoke-test scripts for one-turn runs, AI-opponent runs, and visual snapshots.
