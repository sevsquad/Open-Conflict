# One-Turn Smoke Test

Run from the `open-conflict` folder.

Available commands:
- `npm run smoke:one-turn`
- `npm run smoke:one-turn:live-parse`
- `npm run smoke:one-turn:live`

What the runner does:
- starts the standalone server on a safe local port
- optionally parses a real terrain patch from live DEM, WorldCover, and OSM sources
- builds a repeatable Llanddeusant dam-crossing scenario on top of that terrain
- saves and reloads the game through the real `/api/game/*` endpoints
- runs detection, movement, adjudication validation, state updates, and turn advance
- writes a rerunnable report to `Tests/smoke/latest-report.md` and `Tests/smoke/latest-summary.json`
- saves the same artifacts into the created game folder

Modes:
- `smoke:one-turn` uses the cached Llanddeusant terrain parse plus a deterministic mock adjudicator
- `smoke:one-turn:live-parse` reparses the Llanddeusant bbox live, then uses the deterministic mock adjudicator
- `smoke:one-turn:live` reparses live terrain and uses the preferred configured LLM provider for adjudication

Optional flags:
- `--location=llanddeusant` selects the live parse preset
- `--cellKm=0.5` overrides the live parse resolution
- `--map=/absolute/path/to/map.json` swaps in another cached terrain file in cached mode
- `--port=3110` forces a specific server port

The baseline question this harness answers is: did one full parse-to-turn pipeline still work, and did it save enough artifacts to inspect what happened afterward?
