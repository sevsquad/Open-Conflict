# Open Conflict v0.10 — Full Code Review

**Date:** 2026-03-08
**Scope:** All application and server source files
**Reviewed by:** Claude (automated review)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 11 |
| Major    | 25 |
| Minor    | 40 |
| Nitpick  | 27 |

### Priority Tiers

**Tier 1 — Fix immediately (data corruption, security, broken logic):**
Issues #1–11 (Critical)

**Tier 2 — Fix soon (stale state, race conditions, dead code masking bugs):**
Issues #12–36 (Major)

**Tier 3 — Fix when touching the file (minor bugs, UX, maintainability):**
Issues #37–76 (Minor) and #77–103 (Nitpick)

---

## Critical Issues

### C-01: Server — global mutable state race condition in `gameEngine.js`
**File:** `server/gameEngine.js:28-34, 45-71`

`_activeGameApiKeys` is a module-global that `processTurn` sets before `await adjudicate()` and clears in `finally`. If two `/process-turn` requests overlap (Node yields at `await`), the second call overwrites the first call's keys. The `globalThis.fetch` monkeypatch at line 71 references this same global, so the first call's LLM request uses the wrong API keys.

**Fix:** Pass API keys explicitly through the call chain. Or add a mutex so only one `processTurn` runs at a time.

---

### C-02: Server — `process.env` mutation race condition in `aiPlayer.js`
**File:** `server/aiPlayer.js:64-66, 96-100`

AI player key-swapping mutates `process.env` globally. Concurrent AI player calls clobber each other's keys. The `finally` block also has a gap: if no env var existed originally (`originalKey === undefined`), the AI player's key persists in `process.env` permanently.

**Fix:** Pass the key directly to `callLLM` via the existing `apiKeys` parameter instead of mutating `process.env`.

---

### C-03: Server — rate limiters are dead code
**File:** `server/index.js:104-109`

`llmLimiter` and `authLimiter` are registered *after* `app.use("/api/admin", adminRoutes)` on line 102. Express processes middleware in registration order, so route handlers complete before limiters execute. Zero rate limiting is in effect.

**Fix:** Move limiter registrations before `app.use("/api/admin", adminRoutes)`, or apply them inside `routes/admin.js` on specific routes.

---

### C-04: Server — `allowModel()` permanently expands global allowlist
**File:** `server/aiPlayer.js:59-61`, `server/llmProxy.js:63-67`

`allowModel()` mutates the global `ALLOWED_MODELS` set. Once any AI player config requests an expensive model, it's permanently allowed for all future requests, defeating cost control.

**Fix:** Validate AI models against a separate expanded allowlist, or don't mutate the global set.

---

### C-05: Server — `finalizeTurn` receives wrong argument shape
**File:** `server/routes/admin.js:217`

Calls `finalizeTurn(db, req.gameId, { adjudication }, playerActions)` but the function expects the raw adjudication object, not wrapped in `{ adjudication }`. This silently corrupts game state on every turn finalization.

**Fix:** Change to `finalizeTurn(db, req.gameId, adjudication, playerActions)`.

---

### C-06: Orchestrator — diplomacy key format mismatch
**File:** `orchestrator.js:953` vs `schemas.js`

`initDiplomacy()` creates keys as `"actor_1-actor_2"` (unsorted, `-` separator). `processReinforcementQueue()` creates keys with `"||"` separator and sorts IDs. These keys never match, so reinforcement actors' diplomacy status is always undefined.

**Fix:** Standardize on one key format. Extract a `diplomacyKey(a, b)` helper used everywhere.

---

### C-07: Orchestrator — invalid rebuttal silently accepted on final retry
**File:** `orchestrator.js:632`

When the last retry attempt produces an invalid adjudication, the code falls through and returns the invalid result as if it succeeded. The caller has no way to distinguish a valid result from garbage.

**Fix:** After the retry loop, check validity and return an explicit error if all retries failed.

---

### C-08: Orchestrator — depot supply deduction multiplied by depot count
**File:** `orchestrator.js:894-896`

`totalConsumed` is subtracted from *every* depot independently. Two depots with 50 supply each and 30 consumed results in both going to 20 (60 total drained instead of 30).

**Fix:** Distribute consumption across depots proportionally, or deduct from a single aggregate pool.

---

### C-09: Orchestrator — position correction writes to wrong field
**File:** `orchestrator.js:376`

`update.position = c.corrected` writes the clamped position, but `applyStateUpdates` at line 761 reads `update.new_value`. Clamped positions are never applied — units can teleport to impossible hexes.

**Fix:** Change to `update.new_value = c.corrected` (verify against `schemas.js` first).

---

### C-10: SimGame — `triggerReAdjudication` unhandled promise rejection
**File:** `SimGame.jsx:862`

`triggerReAdjudication` is async but called without `.catch()` from `handleSubmitChallenge` (line 811) and `handleSubmitCounterRebuttal` (line 828). If the LLM call throws, `adjudicatingLLM` stays `true` forever, permanently locking the UI.

**Fix:** Wrap the body of `triggerReAdjudication` in try/catch with a `finally` that resets `adjudicatingLLM`.

---

### C-11: Vite plugins missing path traversal guards
**File:** `vite.config.js:347, 395, 490`

`auditlogPlugin`, `netlogPlugin`, and `gamePlugin` sanitize filenames but don't verify the resolved filepath stays inside the target directory (unlike `savePlugin` which does this correctly at line 45).

**Fix:** Add `if (!filepath.startsWith(targetDir))` guards, matching the pattern in `savePlugin`.

---

## Major Issues

### M-01: SimGame — stale state from `setGs({ ...gs, ... })` pattern
**File:** `SimGame.jsx:1164, 1177, 1275-1290`

Inline `setGs({ ...gs, ... })` captures a stale `gs` snapshot. Two rapid changes overwrite each other. The functional updater `setGs(prev => ({ ...prev, ... }))` is already used correctly in `handleAddReinforcementUnit` but not here.

**Fix:** Replace all `setGs({ ...gs, ... })` with `setGs(prev => ({ ...prev, ... }))`.

---

### M-02: SimGame — `selectedUnit` stores a snapshot, not a reference
**File:** `SimGame.jsx:115`

Stores the full unit object. If `gs.units` updates (moderator override, combat resolution), `selectedUnit` contains stale data.

**Fix:** Store `selectedUnitId` instead and derive the unit: `const selectedUnit = gs.units.find(u => u.id === selectedUnitId)`.

---

### M-03: SimGame — stale closure in RESOLVING phase effect
**File:** `SimGame.jsx:263-273`

`applyMasterAdjudication` is called from a `useEffect` with only `[turnPhase]` as deps, but closes over `gs`, `masterAdjudication`, `sealedOrders`, etc. The `eslint-disable` masks this.

**Fix:** Include `applyMasterAdjudication` in the dep array, or restructure to pass values directly.

---

### M-04: SimGame — `visibilityState` missing from `handleExportBriefing` deps
**File:** `SimGame.jsx:1001-1009`

`handleExportBriefing` uses `visibilityState` but doesn't include it in the `useCallback` dependency array.

**Fix:** Add `visibilityState` to the dependency array.

---

### M-05: SimGame — synchronous heavy computation blocks UI
**File:** `SimGame.jsx:247-259`

`simulateMovement()` runs synchronously in a `useEffect`. The loading spinner won't animate because the main thread is blocked.

**Fix:** Wrap in `setTimeout(0)` or `requestIdleCallback` to allow one paint before computation.

---

### M-06: SimGame — duplicate `playerActions` construction in three places
**File:** `SimGame.jsx:287-315, 710-737, 870-873`

The third version (line 873) produces a different format than the other two. If the format expected by `adjudicateRebuttal` differs from `adjudicate`, this is a bug.

**Fix:** Extract a shared `buildPlayerActionsFromSealed()` helper.

---

### M-07: Orchestrator — `applyStateUpdates` blocks new attributes
**File:** `orchestrator.js:775`

`if (attribute in newUnits[unitIdx])` means the LLM cannot set `routing: true` on a unit that was initialized without a `routing` field, even though `routing` is in `ALLOWED_UPDATE_ATTRIBUTES`.

**Fix:** Change to `if (unitIdx !== -1 && ALLOWED_UPDATE_ATTRIBUTES.has(attribute))` — the allowlist is the guard, not the object shape.

---

### M-08: Orchestrator — duplicate code between `adjudicate()` and `adjudicateRebuttal()`
**File:** `orchestrator.js:112-430, 448-688`

~240 lines duplicated. `adjudicate()` validates state updates; `adjudicateRebuttal()` skips that validation. This divergence is a bug waiting to happen.

**Fix:** Extract shared retry/parse/validate logic into a helper.

---

### M-09: Orchestrator — missing `resp.ok` checks on fetch calls
**File:** `orchestrator.js:237, 1030, 1069, 1077, 1117`

Non-JSON error bodies (nginx 502, etc.) cause misleading `SyntaxError` exceptions instead of meaningful error messages.

**Fix:** Add `if (!resp.ok) throw new Error(...)` before `resp.json()`.

---

### M-10: Server — no auth on game creation/listing
**File:** `server/routes/admin.js:24-86, 120-124`

Anyone can create games (with up to 10MB payload) and list all games. The intended rate limiter is dead code (C-03).

**Fix:** Add authentication, or at minimum move the rate limiter before routes.

---

### M-11: Server — `hashOrders` uses unstable serialization
**File:** `server/db.js:116-118`

`JSON.stringify(orders, Object.keys(orders).sort())` only sorts top-level keys. Nested objects retain insertion order. Same logical orders can produce different hashes.

**Fix:** Use recursive key-sorting canonicalization or `json-stable-stringify`.

---

### M-12: Server — `visibilityJson: null` overwrites original visibility
**File:** `server/gameEngine.js:289-291`

`processRebuttal` saves `visibilityJson: null`, destroying the original visibility data via `INSERT OR REPLACE`.

**Fix:** Preserve the existing visibility JSON when saving rebuttal results.

---

### M-13: Server — timing-attack vulnerable token comparison
**File:** `server/auth.js:62`

Uses `!==` for token comparison. Brute force is infeasible against 64-hex-char tokens, but this is a known vulnerability pattern.

**Fix:** Use `crypto.timingSafeEqual(Buffer.from(game.moderator_token), Buffer.from(token))`.

---

### M-14: Server — global `fetch` monkeypatch
**File:** `server/gameEngine.js:71`

Replaces `globalThis.fetch` for the entire Node process. Any URL containing `/api/llm/adjudicate` gets intercepted. Works today but is fragile.

**Fix:** Use a custom `llmFetch` function passed through the call chain instead of patching the global.

---

### M-15: Server — `sanitizePlayerText` strips valid game text
**File:** `server/routes/game.js:342`

`/\{[^}]*\}/g` strips all text between curly braces, destroying legitimate content like "Attack {Hill 42}".

**Fix:** Use more targeted injection defense.

---

### M-16: narrativeAuditor — `positionToLabel` returning falsy skips hex scanning
**File:** `narrativeAuditor.js:107-108`

If `positionToLabel` returns `""` (falsy), the forbidden unit's hex position is never scanned. This is a fog-of-war information leak.

**Fix:** Check `if (hexLabel == null)` instead of `if (!hexLabel)`.

---

### M-17: narrativeAuditor — falsy corrections silently dropped
**File:** `narrativeAuditor.js:339-341`

`if (corrections.narrative)` is falsy when the correction is `""`. An auditor that blanks a leaking field gets ignored.

**Fix:** Change to `if (corrections.narrative != null)`.

---

### M-18: Dashboard — `refreshGames` makes sequential API calls
**File:** `Dashboard.jsx:63-71`

Sequential `await` per game. With 10 saved games, that's 20 sequential HTTP requests.

**Fix:** Use `Promise.allSettled` to parallelize.

---

### M-19: Dashboard — `handleDecision` no double-submission guard
**File:** `Dashboard.jsx:656-671`

No loading state guard. Rapid double-click sends two POST requests.

**Fix:** Add a `submitting` guard (the state variable already exists but is never set).

---

### M-20: Dashboard — actor ID generation produces duplicates
**File:** `Dashboard.jsx:504`

`id: \`actor_${prev.length + 1}\`` after remove + add creates duplicate IDs.

**Fix:** Use an incrementing counter ref, or `Math.max(...prev.map(a => parseInt(a.id.split('_')[1]))) + 1`.

---

### M-21: SimGame — race condition in `triggerReAdjudication` abort handling
**File:** `SimGame.jsx:862-939`

After the first `await`, `adjAbortRef.current = null` (line 891). Clicking Cancel during the audit won't abort it, and state mutations proceed even though `handleCancelAdjudication` already reset the phase.

**Fix:** Move `adjAbortRef.current = null` after all async work. Add abort-signal checks between sequential awaits.

---

### M-22: SimGame — non-FOW multi-actor review lacks phase transition
**File:** `SimGame.jsx:662-672`

When `fogOfWar` is false and there are multiple actors, `setActiveActorIndex(nextIdx)` advances without a `turnPhase` transition. Works because phase stays REVIEW, but fragile.

---

### M-23: Orchestrator — abort listener leak
**File:** `orchestrator.js:76`

`addEventListener("abort", ...)` on `externalSignal` with `{ once: true }` only auto-removes if it fires. If it never fires, closures holding `controller` accumulate.

**Fix:** Remove the listener in the `finally` block of `fetchWithTimeout`.

---

### M-24: Server — `handleServerLLMCall` always returns `ok: true`
**File:** `server/gameEngine.js:57-64`

The fake Response object always has `ok: true`, even when `callLLM` returns `{ ok: false }`. Violates fetch API contract.

**Fix:** Set `ok` based on `result.ok`.

---

### M-25: Server — game ID collision possible
**File:** `server/routes/admin.js:44`

`randomBytes(4)` gives 8 hex chars (~4B possibilities). No collision check. A duplicate ID causes an unhandled primary key violation.

**Fix:** Add a collision check, or use `randomBytes(8)` for practical uniqueness.

---

## Minor Issues

### m-01: `COMBAT_ORDER_IDS` constant created on every render
`SimGame.jsx:492` — Move `new Set(...)` outside the component.

### m-02: `_pending` variable recomputed every render, only used for initializers
`SimGame.jsx:63, 78, 82` — Move into `useState` initializer callbacks.

### m-03: `formatEnvironmentBrief` called inline in render path
`SimGame.jsx:1134` — Could be memoized.

### m-04: `BriefingDropdown` doesn't close on click-outside
`SimGame.jsx:2093-2135` — Add a document click listener or overlay.

### m-05: 8 `eslint-disable` comments suppress legitimate warnings
`SimGame.jsx:234, 244, 259, 273, 416, 673, 814, 830` — Each should explain why missing deps are safe.

### m-06: `window.confirm()` blocks main thread
`SimGame.jsx:989` — Use a custom modal for consistency.

### m-07: `selectedUnit` can become stale after moderator override
`SimGame.jsx:115, 419-421, 454-460` — Related to M-02.

### m-08: `actorIntents` not restored on cancel adjudication when `sealedOrders` is empty
`SimGame.jsx:846-858` — Edge case: orders cleared by `sealAndAdvance` are lost.

### m-09: Token count display uses IIFE in JSX
`SimGame.jsx:1146-1149` — Extract to a variable before return.

### m-10: narrativeAuditor `startsWith("CLEAN")` is overly permissive
`narrativeAuditor.js:281` — "CLEAN but here's some JSON" treated as clean.

### m-11: narrativeAuditor audit timeout is 10 minutes
`narrativeAuditor.js:228` — Extreme for a haiku/mini call.

### m-12: narrativeAuditor `deterministicScrub` `\b` fragile for hex labels
`narrativeAuditor.js:53-81` — "atH4" or "H4's" may not match correctly.

### m-13: adjudicationFilter potential crash on nullish `gameState.units`
`adjudicationFilter.js:33` — No guard, unlike other params.

### m-14: Orchestrator `impossibleEntities` regex matching is fragile
`orchestrator.js:752-756` — Substring unit names can false-match.

### m-15: Orchestrator non-rate-limit errors retry without backoff
`orchestrator.js:261-274` — Immediate retry wastes quota.

### m-16: Orchestrator `autosave` doesn't handle `listSavedGames` failure
`orchestrator.js:1098` — Pruning step crashes if list call fails.

### m-17: Server `sanitizePlayerText` over-aggressive regex
`server/routes/game.js:342` — Strips valid military notation.

### m-18: Server variable re-declaration shadows outer `game`
`server/routes/game.js:253` — Unnecessary re-fetch.

### m-19: Server OpenAI always forces `response_format: json_object`
`server/llmProxy.js:141` — Breaks if prompt doesn't mention "JSON".

### m-20: Server `req.setTimeout` affects socket, not request
`server/index.js:79-83` — Can affect other requests on keep-alive connections.

### m-21: Server filename sanitization allows double extensions
`server/index.js:125` — `file.json.exe` is allowed.

### m-22: Dashboard session tokens in plaintext localStorage
`Dashboard.jsx:24-28` — XSS would expose all tokens.

### m-23: Dashboard `GameDetail` state initialized from prop, never updates
`Dashboard.jsx:608-611` — Brief stale render possible.

### m-24: Dashboard dead code: `submitting`/`submitResult` state unused
`Dashboard.jsx:615` — Placeholders for unimplemented UI.

### m-25: Dashboard no terrain validation before game creation
`Dashboard.jsx:268-270` — Silent fallback to blank map.

### m-26: Dashboard `GameCard` remove button clickable when invisible
`Dashboard.jsx:594` — `opacity: 0` doesn't prevent clicks.

### m-27: App.jsx recent map click handler navigates with no data
`App.jsx:313-314` — `setViewerData(null)` then `setMode("viewer")` — buttons are decorative.

### m-28: Orchestrator `migrateGameState` mutates input object
`orchestrator.js:1039-1051` — Inconsistent with immutable patterns elsewhere.

### m-29: adjudicationFilter `extractProposedMoves` O(n*m) lookup
`adjudicationFilter.js:146` — Could use a Map for O(n+m).

### m-30 through m-40: Additional minor issues across vite.config.js
See Nitpick section for remaining items.

---

## Nitpick Issues

### n-01: SimGame unused import `isSystemActive`
`SimGame.jsx:7` — Remove.

### n-02: SimGame unused state `showRaw`
`SimGame.jsx:101` — `showRaw`/`setShowRaw` declared but never used. Remove.

### n-03: SimGame magic number 300ms sealing timeout
`SimGame.jsx:624` — Document or make configurable.

### n-04: narrativeAuditor `saveAuditLog` fire-and-forget with no rate limiting
`narrativeAuditor.js:19-27` — Could create many small files.

### n-05: narrativeAuditor hardcoded model strings
`narrativeAuditor.js:34-38` — Will go stale. Centralize in config.

### n-06: Orchestrator `saveNetLog` fire-and-forget swallows errors
`orchestrator.js:87-95` — Silent loss of debug data.

### n-07: Dashboard `apiFetch` sets Content-Type on GET requests
`Dashboard.jsx:38` — Unnecessary but harmless.

### n-08: Dashboard hardcoded model string
`Dashboard.jsx:287` — `"claude-sonnet-4-20250514"` will go stale.

### n-09: adjudicationFilter `visible_state_updates` redundancy
`adjudicationFilter.js:121` — Two copies of same data possible.

### n-10: adjudicationFilter silent phantom unit IDs in visibility set
`adjudicationFilter.js:52-57` — Non-existent unit IDs silently enter the set.

### n-11: Server `setGlobalDispatcher` affects all fetch calls
`server/llmProxy.js:7` — 15-minute timeout for all HTTP calls, not just LLM.

### n-12: Server `nodeLoaderHooks.js` extension heuristic fragile
`server/nodeLoaderHooks.js:29-31` — All `.md` imports treated as raw text.

### n-13: Server no `closeDb()` for graceful shutdown
`server/db.js:15` — Singleton pattern prevents testing.

### n-14: Server `aiPlayer.js` poor error context on JSON parse failure
`server/aiPlayer.js:87` — Include truncated LLM output in error.

### n-15: Vite config hardcoded model IDs scattered across files
`vite.config.js:301-315`, `narrativeAuditor.js:35`, `server/llmProxy.js` — Centralize.

### n-16: Markdown code fence stripping duplicated
`orchestrator.js:315`, `narrativeAuditor.js:291` — Extract shared utility.

### n-17: `detectedUnits`/`contactUnits` Set/Array ambiguity
Handled inconsistently across files. Normalize in one place.

### n-18 through n-27: Whitespace, naming, and style consistency issues
Various files — minor formatting inconsistencies that don't affect behavior.

---

## Quick Wins (low effort, high value)

These can each be fixed in under 5 minutes:

1. **Move rate limiters before routes** in `server/index.js` (fixes C-03)
2. **Fix `finalizeTurn` argument wrapping** in `admin.js:217` (fixes C-05)
3. **Switch `setGs({ ...gs })` to `setGs(prev => ...)`** in SimGame (fixes M-01)
4. **Add `resp.ok` checks** to all fetch calls in orchestrator (fixes M-09)
5. **Add try/catch** around `triggerReAdjudication` (fixes C-10)
6. **Add path traversal guards** to vite plugins — copy from `savePlugin` (fixes C-11)
7. **Remove unused imports** `isSystemActive`, `showRaw` in SimGame (fixes n-01, n-02)
8. **Move `COMBAT_ORDER_IDS`** outside component body (fixes m-01)
9. **Use `crypto.timingSafeEqual`** for token comparison (fixes M-13)
10. **Fix actor ID generation** in Dashboard with counter ref (fixes M-20)

---

## Cross-Cutting Concerns

### 1. Fire-and-Forget Fetch Pattern
Appears in `orchestrator.js:94`, `narrativeAuditor.js:22`, and elsewhere. Silent `.catch(() => {})` swallows all errors. At minimum, log to `console.warn`.

### 2. Hardcoded Model IDs
Scattered across `narrativeAuditor.js:35`, `vite.config.js:301-315`, `server/llmProxy.js`, `Dashboard.jsx:287`. These will go stale with model releases. Centralize in a single config.

### 3. Duplicate Adjudication Logic
`adjudicate()` and `adjudicateRebuttal()` in `orchestrator.js` share ~240 lines of nearly identical retry/parse/validate logic. They've already diverged (rebuttal skips `validateStateUpdates`). Extract shared helpers.

### 4. Global State Mutation in Server
`gameEngine.js` and `aiPlayer.js` use module globals and `process.env` mutation for API key passing. This is the single biggest architectural issue — it will cause real bugs under any concurrent load.

### 5. Set/Array Ambiguity for Detection Data
`detectedUnits`/`contactUnits` are sometimes Sets, sometimes Arrays. `SimGame.jsx` normalizes with `instanceof Set`, `adjudicationFilter.js` doesn't. Normalize at serialization/deserialization boundary.
