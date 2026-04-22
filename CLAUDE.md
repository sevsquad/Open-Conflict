# CLAUDE.md — Complex Project Override

> Drop this file in any project root where Claude Code's default simplicity bias is counterproductive. Customize the [CONFIGURE] sections for your specific project.

---

## Project Classification

This is a **mature, architecturally complex project**. The codebase has evolved through extensive iteration and the current structure reflects intentional design decisions. Complexity here is a feature, not a problem to solve.

---

## Solution Memory

### Never revert to failed approaches
When an approach has been tried and failed in this conversation — or when I tell you something was already attempted — that path is **permanently eliminated**. Do not suggest it again. If you catch yourself circling back, stop and say so, then propose a genuinely different solution.

### Maintain solution fidelity
When replacing or refactoring code, the new version must be **at least as capable** as the old. Do not:
- Replace a working multi-step pipeline with a "simpler" version that drops edge cases
- Flatten intentional abstraction layers
- Remove error handling, retry logic, or defensive patterns that exist because they were needed
- Consolidate separated files without understanding why they were separated
- Strip type definitions, interfaces, or schemas that document the domain model

### Scale up when asked
When I say "make this more robust" or "harden this," I mean: add error handling, cover edge cases, add validation, build defensive patterns. Do not preemptively constrain solutions to minimal scope.

---

## Architecture and Abstraction Policy

### Abstractions are welcome when they serve a purpose:
- A pattern appears 2+ times or will foreseeably repeat
- Multiple integration points benefit from a shared interface
- Testing or debugging is materially easier with the abstraction
- The domain model calls for distinct concepts to be modeled distinctly

### New files are welcome when they serve a purpose:
- A module exceeds ~300 lines with separable concerns
- A new system or feature warrants its own namespace
- Test files, configuration files, or data files are needed
- Separation improves navigation, parallel work, or build performance

### Do not "simplify" by:
- Inlining functions that exist for readability or reuse
- Merging files that were separated for architectural reasons
- Removing type definitions or interfaces that document the domain
- Stripping comments that explain *why* (not just *what*)
- Deleting "unused" code without confirming it's truly dead — it may be used dynamically, conditionally, or by external consumers

---

## Communication

### Explain your reasoning on complex changes
For non-trivial changes (architectural decisions, multi-file refactors, tricky bugs):
- Explain what you're changing and **why this approach** over alternatives
- Flag tradeoffs or risks
- If uncertain between approaches, present the options instead of silently picking the simplest one

### Warn before simplifying
If you believe existing code is genuinely over-engineered, **say so explicitly with reasoning** before changing anything. Do not silently simplify. I may agree, or I may explain context you're missing.

### Treat existing patterns as intentional
If the codebase uses a specific pattern (state management approach, data flow, custom abstraction layer), assume it was chosen deliberately unless it's clearly broken. Ask before replacing established patterns with "simpler" alternatives.

---

## Task Execution

### Plan multi-file changes
For any change touching 3+ files or involving architectural decisions:
1. State the plan before writing code
2. Identify affected files and how they'll change
3. Flag risks or dependencies
4. Wait for confirmation

### Verify incrementally
- After each significant change, verify it works before moving on
- Run existing tests if available; otherwise do a sanity check
- Do not make many changes then debug them all at once

### When blocked or uncertain
- Say "I'm stuck on X because Y" — do not silently downgrade the solution
- Propose 2-3 alternatives with tradeoffs instead of defaulting to simplest
- Ask clarifying questions rather than making assumptions that lead to oversimplification

---

## Context Preservation

### Critical context to preserve during compaction:
- **Failed approaches** and why they failed
- **Architectural decisions** and their rationale
- **Domain constraints** (data formats, coordinate systems, schemas, protocols)
- **Integration points** between modules
- **Current state** of what works vs. what's in progress vs. what's broken

### If context feels stale:
- Re-read key files before modifying, even if you "remember" their contents
- Say "I want to confirm my understanding of X before proceeding" rather than guessing
- Ask me to re-state requirements if the conversation has been long

---

## Compact Instructions

When compacting this conversation, you MUST preserve:
- All failed approaches and the specific reasons they failed
- Architectural decisions made during this session
- The current working state of each component being modified
- Any domain-specific constraints or rules established during discussion

---

## Tech Stack

- **React 18** with hooks (no Redux/Zustand — state management via useState/useRef/useCallback)
- **Vite 5** — Dev server on port 5173, custom plugins for save/LLM proxy/timeouts
- **Node.js 18+ / Express 5** — Backend on port 3001, ES modules throughout
- **better-sqlite3** — Synchronous SQLite for PBEM game persistence
- **WebGL2 + Canvas2D** — Dual-layer hex map rendering (terrain via GPU, overlays via 2D canvas)

**Scripts:**
- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run server:dev` — Backend with --watch (port 3001)
- `npm run build` — Production build
- `npm run smoke:one-turn` / `smoke:ai-opponent` — Test runners

---

## Domain-Specific Rules

- **Coordinate system:** Odd-R offset coordinates `(col, row)` for hex grid storage. Conversions in `HexMath.js`: offset ↔ axial ↔ pixel. Pointy-top hexagons. Cell keys are `"col,row"` strings throughout state.
- **Terrain data pipeline:** Parser.jsx → hex grid classification → JSON export to `saves/`. Viewer loads from saves. Simulation receives terrain from Viewer. Do not bypass stages.
- **Scale tier system:** 6 tiers in `schemas.js` (sub_tactical → theater). Each tier activates/deactivates game systems (morale, supply, air ops, diplomacy). Scale drives echelon, turn duration, and which rules apply. See `SCALE_TIERS`, `SCALE_SYSTEMS`, `isSystemActive()`.
- **Simulation modules are pure JS:** Everything in `src/simulation/*.js` has zero React/DOM dependencies. This is intentional — the server imports and runs the same logic via `server/gameEngine.js`. Do not add React imports to simulation modules.
- **State management:** React hooks only (useState, useRef, useCallback). Data threads parent-to-child: App.jsx → Simulation.jsx (initialData) → SimGame.jsx. No global store by design.
- **LLM integration:** Adjudication calls go through `orchestrator.js` → LLM proxy → Anthropic/OpenAI. Server-side fetch is patched in `gameEngine.js`. Prompts are assembled in `prompts.js`. Budget limits enforced by `llmBudget.js`.
- **PBEM authentication:** Moderator uses bearer token, players use session tokens, admin endpoints are rate-limited. See `server/routes/game.js`.

---

## File Organization

Directories and modules that should not be merged or flattened:

- `src/simulation/` — Pure JS game logic, shared between client and server. Each file owns a distinct system (detection, movement, orders, terrain, air, friction, etc.). Do not merge modules.
- `src/mapRenderer/` — Rendering layer. `gl/` = WebGL2 terrain shaders/meshes. `overlays/` = Canvas2D interactive overlays (units, orders, fog-of-war, VP markers, air). `MapView.jsx` is the unified React interface. Do not collapse gl/ and overlays/ together.
- `server/routes/` — Express API route handlers, separated by concern (game.js, admin.js)
- `server/` — Backend modules each own a responsibility: `db.js` (persistence), `gameEngine.js` (turn processing), `llmProxy.js` (LLM routing), `aiPlayer.js` (AI opponent)
- `Tests/` — Smoke tests and AI opponent test fixtures
- `scripts/` — Standalone test runner entry points

**Intentionally large files (do not split):**
- `Parser.jsx` (~5700 lines) — Monolithic terrain generation pipeline, tight coupling to data sources
- `SimGame.jsx` (~3200 lines) — Client-side turn management UI, tightly coupled to game state
- `orchestrator.js` (~1700 lines) — Turn cycle core, prompt assembly, adjudication
- `orderComputer.js` (~3200 lines) — Pre-compute ranges, paths, LOS, force ratios

---

## Testing & Verification

**URL parameter testing (bypasses menu, loads test data):**
- `?mode=viewer&test=true` — Viewer with 12x15 test fixture
- `?mode=simulation&test=true` — Simulation setup with test fixture
- `?mode=simulation&preset=quickstart&test=true` — Auto-start simulation
- `?mode=viewer&load=<filename>` — Load a specific save file

**Smoke tests (CLI):**
- `npm run smoke:one-turn` — One-turn adjudication test
- `npm run smoke:ai-opponent` — AI opponent generation test
- `npm run smoke:one-turn:live` — Live LLM integration test

**Test fixture:** `src/testFixture.js` — Deterministic 12x15 hex grid, 15+ terrain types, 10+ features, 0-1200m elevation.

**Verification workflow for UI changes:**
1. Start dev server, navigate with test URL params
2. Use `preview_snapshot` / `preview_console_logs` / `preview_inspect` (not `preview_screenshot` — crashes headless browser on this app)
3. Or run `npx vite build` to verify no build errors

---

## Key Architecture Notes

### Data flow
```
Terrain:  Parser.jsx → hex grid JSON → saves/ → Viewer.jsx → Simulation.jsx → SimGame.jsx
Game:     SimGame (orders) → orchestrator.adjudicate() → LLM → state update → re-render
PBEM:     Client → /api/games/{id}/orders → server/gameEngine.processTurn() → turn_results
```

### Rendering (MapView.jsx)
- **WebGL2 layer:** Terrain mesh batching, hex geometry, elevation-colored shaders, strategic atlas
- **Canvas2D layer:** Unit symbols, fog-of-war, order ghosts, labels, VP markers, air overlays
- **ViewportState.js:** Camera pan/zoom, scroll wheel

### Server (port 3001)
- `gameEngine.js` — Turn processor, imports orchestrator + calls LLM server-side
- `db.js` — SQLite schema: games, players, sealed_orders, turn_results, actor_decisions, game_log
- `llmProxy.js` — Routes to Anthropic or OpenAI based on model selection
- Custom node loader (`nodeLoader.js`) allows server to import client-side simulation modules

### Environment (.env)
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — LLM providers
- `LLM_BUDGET_*` — Rate limiting (requests/tokens per time window)
- `SMTP_*` / `EMAIL_FROM` / `APP_URL` — Optional email notifications for PBEM

---

## What "Good Engineering" Means Here

Default Claude Code behavior optimizes for: minimal changes, minimal files, minimal abstraction, minimal output. That's fine for quick fixes.

**For this project, good engineering means:**
- Solutions that handle edge cases, not just the happy path
- Abstractions that improve maintainability
- Files organized for navigability and separation of concerns
- Explanations that help me understand and verify your work
- Persistence on complex solutions when complexity is warranted
- Honest communication about tradeoffs, uncertainty, and risk

**The goal is a correct, maintainable, well-structured system — not the shortest diff.**
