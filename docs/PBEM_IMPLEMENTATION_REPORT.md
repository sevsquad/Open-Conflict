# PBEM Implementation Report — What We Need To Do

## Summary

Converting Open Conflict from hotseat to PBEM requires a **server-authoritative architecture**. The game currently runs entirely in the browser with a thin Vite dev server providing LLM proxying and file I/O. For PBEM, the server must own the game state, run the simulation, and serve each player only their filtered view.

This report is organized as a task list grouped by domain. Each task has a priority (P0 = must have for alpha, P1 = should have, P2 = nice to have) and estimated effort.

---

## DOMAIN 1: BUILD A REAL SERVER

The Vite dev server plugin approach (`configureServer` hooks in vite.config.js) disappears in production builds. We need a standalone server.

### Tasks

#### 1.1 Extract backend into standalone Express/Fastify server [P0, HIGH]

- Create `server/index.js` (or similar)
- Move all endpoint logic from vite.config.js plugins into proper route handlers
- Keep vite.config.js for dev server proxying to the standalone server during development
- Package: `"start:server": "node server/index.js"`

#### 1.2 Add body size limits to all POST endpoints [P0, LOW]

- `POST /api/save` currently has NO body size limit — can fill disk
- Add `express.json({ limit: '5mb' })` or equivalent to all routes
- Each endpoint should validate payload size appropriate to its use case

#### 1.3 Add request logging [P1, LOW]

- Log all API requests with timestamp, endpoint, player ID, IP, response status
- Use a lightweight logger (pino or morgan)
- Store logs in a dedicated directory, rotate daily

#### 1.4 Separate dev and production configurations [P0, MEDIUM]

- Dev: Vite dev server + standalone server on different ports, Vite proxies API calls
- Production: Standalone server serves static build + handles API
- `.env` for API keys and config, never in code

---

## DOMAIN 2: AUTHENTICATION & AUTHORIZATION

### Tasks

#### 2.1 Implement game-scoped auth tokens [P0, MEDIUM]

- Moderator creates game → server generates an invite token per player
- Player clicks invite link → exchanges invite token for a session token
- Session token: `crypto.randomBytes(32).toString('hex')`
- Store: `{ token, gameId, actorId, createdAt, expiresAt }` in a tokens file/table
- All subsequent requests require `Authorization: Bearer <token>`

#### 2.2 Add auth middleware [P0, MEDIUM]

- Middleware checks token on every request to `/api/game/*`
- Extracts `{ gameId, actorId }` from token
- Rejects expired or invalid tokens with 401
- Blocks access to other games' data

#### 2.3 Add role-based access control [P1, MEDIUM]

- Roles: `player`, `moderator`
- Players can only access their own actor's data
- Moderators can access full game state, pause, override
- Moderator role set during game creation (one moderator per game)

#### 2.4 Implement CORS [P0, LOW]

- Set `Access-Control-Allow-Origin` to the game server's domain only
- No wildcard origins in production

---

## DOMAIN 3: SERVER-SIDE SIMULATION

The simulation engine (orchestrator, detection, movement, fortune, friction) must run server-side.

### Tasks

#### 3.1 Move orchestrator to server [P0, HIGH]

- `orchestrator.adjudicate()` currently runs in the browser
- Move to a server route: when all players submit orders, server triggers adjudication
- The function is pure JS with no DOM dependencies — it can run in Node.js as-is
- The LLM proxy call stays server-side (already is, via fetch to `/api/llm/adjudicate`)
- **Key change:** The LLM call becomes a direct server-to-LLM call, no HTTP proxy needed

#### 3.2 Move detection engine to server [P0, MEDIUM]

- `computeDetection()` returns all actors' visibility data
- Must run server-side so clients never see the god-view
- `Math.random()` in detection rolls becomes server-authoritative (no client manipulation)

#### 3.3 Move movement simulator to server [P0, MEDIUM]

- `simulateMovement()` returns all units' paths, positions, contact events
- Must run server-side — contains omniscient movement data

#### 3.4 Move fortune/friction to server [P0, LOW]

- `generateUnitFortuneRolls()` already uses CSPRNG — move to server
- `generateUnitFrictionEvents()` uses `Math.random()` — move to server, switch to CSPRNG
- `progressEnvironment()` uses `Math.random()` — move to server, switch to CSPRNG

#### 3.5 Server-side per-actor filtering [P0, MEDIUM]

- After adjudication, call `filterAdjudicationForActor()` on the server
- Send only the filtered result to each player
- Never send the master adjudication to any player

#### 3.6 Fix unfiltered adjudication fields [P1, MEDIUM]

- `situation_assessment` passes through unfiltered — may contain cross-actor info
- `de_escalation_assessment` passes through unfiltered — may reference private objectives
- `meta.notes` passes through unfiltered — may contain moderator-only notes
- Options: (a) strip these fields from player views entirely, (b) have the LLM generate per-actor versions, (c) add regex-based scrubbing

---

## DOMAIN 4: API DESIGN

### Tasks

#### 4.1 Implement player-facing API endpoints [P0, HIGH]

| Endpoint                       | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `POST /api/game/:id/join`      | Exchange invite token for session token         |
| `GET /api/game/:id/state`      | Get per-actor filtered game state               |
| `POST /api/game/:id/orders`    | Submit sealed orders (validates it's your turn) |
| `POST /api/game/:id/accept`    | Accept adjudication results                     |
| `POST /api/game/:id/challenge` | Submit challenge text                           |
| `POST /api/game/:id/rebuttal`  | Submit counter-rebuttal                         |
| `GET /api/game/:id/briefing`   | Download per-actor briefing markdown            |
| `GET /api/game/:id/map`        | Get terrain + FOW-filtered unit data            |

#### 4.2 Implement moderator API endpoints [P1, MEDIUM]

| Endpoint                            | Purpose                      |
| ----------------------------------- | ---------------------------- |
| `POST /api/admin/game/create`       | Create new game (full setup) |
| `GET /api/admin/game/:id/state`     | Get full god-view state      |
| `POST /api/admin/game/:id/pause`    | Pause/resume game            |
| `POST /api/admin/game/:id/override` | Override unit stats          |
| `GET /api/admin/game/:id/logs`      | View game logs               |

#### 4.3 Add input validation to all endpoints [P0, MEDIUM]

- Validate order structure against schema (correct order types, valid target hexes, unit ownership)
- Validate text field lengths (commander's intent: max 2000 chars, challenge: max 2000, rebuttal: max 2000)
- Reject orders for units the player doesn't own
- Reject orders when it's not the player's turn
- Reject duplicate submissions (idempotency)

---

## DOMAIN 5: FRONT-END CHANGES

### Tasks

#### 5.1 Add PBEM client mode [P0, HIGH]

- Detect PBEM mode via URL parameter or server response
- In PBEM mode: fetch state from server, hide debug tools, enforce FOW
- The React components (OrderRoster, UnitOrderCard, map) are reusable
- Main change is data source: server API instead of local state

#### 5.2 Gate debug tools behind build flag [P0, MEDIUM]

**SimGame.jsx toolbar — items to gate:**

| Item                                | Line(s)          | Gate                         |
| ----------------------------------- | ---------------- | ---------------------------- |
| FoW toggle button                   | ~1198            | `__DEV_TOOLS__` only         |
| View Prompt button                  | ~1195            | `__DEV_TOOLS__` only         |
| Token counter                       | toolbar          | `__DEV_TOOLS__` only         |
| LLM model switch dropdowns          | toolbar          | Moderator or `__DEV_TOOLS__` |
| Export Log button                   | toolbar          | `__DEV_TOOLS__` only         |
| Full Briefing export option         | toolbar dropdown | Moderator only               |
| Start Over button                   | review phase     | Moderator only               |
| Cancel button (during adjudication) | loading spinner  | Moderator only               |

**SimGame.jsx adjudication tabs:**

| Tab                     | Gate                                            |
| ----------------------- | ----------------------------------------------- |
| Raw tab                 | `__DEV_TOOLS__` only                            |
| Full narrative (master) | Never show to players; show per-actor narrative |

**SimGame.jsx pause panel:**

| Feature              | Gate           |
| -------------------- | -------------- |
| Pause button itself  | Moderator only |
| Unit override editor | Moderator only |
| Diplomacy editing    | Moderator only |
| Moderator notes      | Moderator only |

#### 5.3 Build flag implementation [P0, LOW]

```javascript
// vite.config.js
define: {
  __DEV_TOOLS__: JSON.stringify(process.env.NODE_ENV !== 'production'),
}
```

Use `if (__DEV_TOOLS__)` guards — Vite will tree-shake these in production builds.

#### 5.4 Player status indicators [P1, LOW]

- Show which players have submitted orders: "Player A: Orders sealed / Player B: Planning..."
- Show turn deadline countdown (if deadlines enabled)
- Show game phase clearly: "Waiting for adjudication" / "Results ready"

#### 5.5 Async order submission flow [P0, MEDIUM]

- Replace the hotseat "seal orders → handoff screen" flow with:
  - Player assigns orders → clicks "Seal Orders" → POST to server
  - UI shows "Orders sealed. Waiting for [other player(s)]."
  - When server processes turn, UI updates (polling or SSE)

---

## DOMAIN 6: SECURITY HARDENING

### Tasks

#### 6.1 Sanitize player text before LLM prompt injection [P1, MEDIUM]

Player text goes into LLM prompts in these fields:

- Commander's intent (per unit)
- Challenge text
- Counter-rebuttal text
- Unit notes

Sanitize:

```javascript
function sanitizePlayerText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .slice(0, 2000)
    .replace(/\b(SYSTEM|HUMAN|ASSISTANT|USER)\s*:/gi, '[filtered]:')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}
```

Apply to all player text before it enters `prompts.js` functions.

#### 6.2 Order integrity hashing [P1, LOW]

- When player submits orders, server computes SHA-256 hash
- Hash stored alongside orders
- Hash returned to player as receipt
- On adjudication, verify orders match hash (integrity check)

#### 6.3 HTTPS enforcement [P0, LOW for deployment]

- Use TLS certificates (Let's Encrypt via certbot, or a reverse proxy like nginx/Caddy)
- Set HSTS header: `Strict-Transport-Security: max-age=31536000`
- Redirect HTTP → HTTPS

#### 6.4 Rate limiting [P1, LOW]

- Per-player: 30 requests per minute (generous for normal play)
- Per-IP: 100 requests per minute
- LLM proxy: keep existing 10 per 60 seconds
- Use `express-rate-limit` or similar

#### 6.5 Restrict log endpoint access [P0, LOW]

- `POST /api/netlog/save` — disable in production, or restrict to moderator
- `POST /api/auditlog/save` — disable in production, or restrict to moderator
- `POST /api/parsernetlog/save` — disable in production

These endpoints write diagnostic data containing sensitive information (forbidden enemy names, prompt metadata). In alpha:

- Option A: Disable entirely (simplest)
- Option B: Keep but require moderator auth

#### 6.6 Prevent save file exposure [P0, LOW]

- Game save files must not be served statically
- Add explicit deny rules for `/saves/*` in the server
- File permissions: `0600` (owner read/write only)

#### 6.7 Narrative auditor hardening [P2, MEDIUM]

- Add fail-closed option: if audit fails, block the turn and retry
- Log audit failures prominently
- Consider running audit with a more capable model for PBEM games

---

## DOMAIN 7: EMAIL INTEGRATION

### Tasks

#### 7.1 Add email notification service [P1, MEDIUM]

- Integrate SendGrid, Mailgun, or AWS SES
- Send notifications at these events:
  - "It's your turn" (all players have submitted or game just started)
  - "Results are ready" (adjudication complete)
  - "Challenge filed" (another player challenged)
  - "Game created — you've been invited" (initial invite)

#### 7.2 Email templates [P1, LOW]

- Simple HTML emails with:
  - Game name, turn number, phase
  - Direct link to the game: `https://server/game/:id?token=:token`
  - Brief status ("Your opponent has submitted orders")
- No sensitive game data in emails (just the link)

#### 7.3 Invite link system [P0, LOW]

- Moderator creates game → gets invite URLs
- Each URL contains a one-time join token
- Player clicks → joins game → token is consumed
- Returns session token for future access

---

## DOMAIN 8: DEPLOYMENT

### Tasks

#### 8.1 Choose deployment platform [P0, Decision]

Options for alpha:

- **VPS (DigitalOcean, Linode, etc.)** — full control, ~$5-12/mo
- **Railway / Render / Fly.io** — managed, easy deploy, free tier or ~$7/mo
- **Self-hosted** — your own machine, free, less reliable

Recommendation: Railway or Render for simplicity. They handle HTTPS, can run Node.js, and have free tiers sufficient for alpha testing.

#### 8.2 Environment configuration [P0, LOW]

- `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` as environment variables
- `GAME_SECRET` for signing tokens (if using signed tokens)
- `SMTP_*` variables for email service
- `BASE_URL` for constructing invite links

#### 8.3 Static asset serving [P0, LOW]

- `npm run build` produces `dist/` with static assets
- Server serves `dist/` for the SPA
- API routes handled separately

---

## DECISION LOG — RESOLVED

### D1: Email vs. Web-Only for Alpha?
**DECIDED: Option A** — Web-based order submission + email notifications.

### D2: Who runs the server?
**DECIDED: Option A** — You host it (cloud service). For a handful of friends/volunteers, a single Railway/Render/Fly.io instance is perfect. ~$7/mo, handles HTTPS automatically, environment variable injection for API keys. No need for players to install anything.

### D3: Turn deadlines?
**DECIDED: Yes, 48 hours.** Auto-HOLD for units with no orders when deadline expires. Configurable per-game.

### D4: How many concurrent games?
**DECIDED: Multiple, with a dashboard.** Each game is a separate state file. Dashboard shows active games with map thumbnails per actor. Architecture supports this naturally since games are already identified by ID.

### D5: Spectators?
**DECIDED: Defer to post-alpha.** See discussion in DOMAIN 9 below for architecture considerations.

### D6: Persistence format?
**DECIDED: SQLite.** Better than JSON files for concurrent access and querying (game listings, player lookups). Still a single file, no server dependency. `better-sqlite3` is a single npm package, synchronous API, zero-config. Migrating from JSON files is straightforward — each game is a row with a JSON blob column.

---

## DOMAIN 9: SPECTATOR MODE (DEFERRED — ARCHITECTURE NOTES)

You raised a valid concern: spectators could create accounts to spy on the enemy. Options to consider when we get here:

| Approach | How It Works | Anti-Cheat |
|----------|-------------|------------|
| **Time-delayed spectating** | Spectators see the game N turns behind real-time | Stale info is less useful. Delay 2-3 turns. |
| **Post-game replay** | Spectators only watch completed games | No competitive advantage possible. |
| **Invite-only spectators** | Each player approves spectators for their side | Players can vet who watches. |
| **Fog-of-war spectating** | Spectators pick a side and see only that side's FOW view | No new info beyond what the player already sees. |
| **IP/account linkage** | Detect if a spectator and a player share IP/device | Deterrent, not foolproof. |

**Recommendation for eventual implementation:** Post-game replay is the safest and simplest. Time-delayed spectating (2-3 turns behind) is good for "live" viewing. Both are immune to the alt-account problem.

---

## DOMAIN 10: LLM-AS-PLAYER (AI OPPONENT)

Players should be able to play against an AI opponent (LLM playing one or more sides).

### How It Works

1. During game creation, moderator marks an actor as "AI-controlled"
2. When it's the AI actor's turn, the server:
   a. Builds a per-actor briefing for the AI side (using `buildActorBriefing()` — already FOW-filtered)
   b. Sends it to the LLM with a "you are the commander" system prompt
   c. Parses the LLM's response into structured orders (MOVE, ATTACK, etc.)
   d. Submits those orders as the AI actor's sealed orders
3. Turn proceeds normally — the adjudication LLM sees AI orders just like human orders

### API Key Handling

Two options for who pays for the AI opponent's LLM calls:

**Option A: Server's API key (simplest for alpha)**
- The server uses its own Anthropic/OpenAI key for AI opponent calls
- Cost is on you (the host)
- Simple, no player key management needed
- For alpha with a few friends, this is fine

**Option B: Player-provided API key (scale/fairness)**
- Player provides their own API key when requesting an AI opponent
- Key stored encrypted in the game record (AES-256-GCM, server-side encryption key from env var)
- Used only for that player's AI opponent calls
- Key never sent back to any client
- Deleted when game ends

```javascript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encryptApiKey(key, serverSecret) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(serverSecret, 'hex'), iv);
  let encrypted = cipher.update(key, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptApiKey(stored, serverSecret) {
  const [ivHex, tagHex, encrypted] = stored.split(':');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(serverSecret, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

**Storage:** The `GAME_ENCRYPTION_KEY` (32 bytes, hex-encoded) lives in the server's environment variables. Player API keys are encrypted at rest and only decrypted in-memory for the duration of an LLM call.

**Recommendation:** Start with Option A for alpha. Add Option B later if players want to use their own models or you want to distribute costs.

### AI Order Parsing — Exact Data Format

The sealed orders format the AI must produce matches the human player format exactly:

```javascript
// What sealAndAdvance() produces when a human player seals orders:
sealedOrders[actorId] = {
  unitOrders: {
    "unit_id_1": {
      movementOrder: { id: "MOVE", target: "3,4" },        // or null
      actionOrder: { id: "ATTACK", target: "3,5", subtype: null }, // or null
      intent: "Advance to the ridge and engage enemy armor"  // or ""
    },
    "unit_id_2": {
      movementOrder: null,    // HOLD — no movement
      actionOrder: { id: "DEFEND", target: null },
      intent: ""
    }
  },
  actorIntent: "Main effort on the left flank. Fix enemy in center."
}
```

**Valid order IDs:** MOVE, WITHDRAW, ATTACK, DEFEND, SUPPORT_FIRE, FIRE_MISSION, DIG_IN, RECON, RESUPPLY, ENGINEER, SHORE_BOMBARDMENT, BLOCKADE

**Valid subtypes:** FIRE_MISSION → "HE" or "SMOKE"; ENGINEER → "BRIDGE", "OBSTACLE", "BREACH", "FORTIFY", "DEMOLISH"

**Target format:** `"col,row"` string (0-indexed), or null for orders that don't need a target (DEFEND, DIG_IN, HOLD)

**Constraint:** Each unit gets at most one movementOrder (MOVE or WITHDRAW) and one actionOrder. Units with no orders default to HOLD.

### AI Player Implementation

The AI player system prompt receives the same `buildActorBriefing()` output that human players can export — it's already FOW-filtered and contains terrain, own forces, detected enemies, capabilities, and recent history. The AI then outputs structured JSON orders.

**Key insight:** The AI player uses the SAME per-actor briefing infrastructure as the human player export. No new data pipeline needed. The briefing already includes unit capabilities, nearby enemies, terrain costs, and hex coordinates. The AI just needs to output the JSON order format above.

**AI does NOT see:** Undetected enemies, other actors' orders, master adjudication, or any data the human player wouldn't see. The `buildActorBriefing()` function enforces this via the `visibilityState` parameter.

**Order validation:** AI orders go through the same `validateActiveActorOrders()` logic as human orders — movement feasibility, range checks, unit ownership. Invalid orders are corrected or rejected, same as for humans.

---

## DOMAIN 11: DEV/PROD ENVIRONMENT SEPARATION

### The Problem

You need to develop and test locally while a production server runs for alpha testers. Bouncing between environments should be seamless.

### Solution: Two Completely Separate Stacks

```
LOCAL DEVELOPMENT                    PRODUCTION
─────────────────                    ──────────
npm run dev                          Railway/Render
  → Vite dev server (5173)             → Node server (PORT)
  → vite.config.js plugins              → server/index.js
  → .env (local keys)                   → env vars (prod keys)
  → saves/ (local files)                → SQLite (persistent disk)
  → http://localhost:5173               → https://yourgame.up.railway.app
  → All debug tools ON                  → Debug tools OFF
  → No auth required                    → Auth required
  → FoW toggleable                      → FoW always ON
```

### How This Works Day-to-Day

| What You're Doing | Command | What Happens |
|-------------------|---------|--------------|
| Developing/testing locally | `npm run dev` | Vite dev server, all debug tools, no auth, local saves |
| Testing the production server locally | `npm run server:dev` | Express server on :3001, Vite proxies to it, auth enabled |
| Building for production | `npm run build && npm run server` | Static build served by Express, full production mode |
| Deploying to cloud | `git push` (with Railway/Render auto-deploy) | Auto-builds and deploys |

### Key Files

```
vite.config.js          — Dev server plugins (unchanged, only runs locally)
server/
  index.js              — Production Express server
  auth.js               — Token auth middleware
  gameEngine.js         — Server-side simulation orchestration
  db.js                 — SQLite persistence layer
  email.js              — Email notification service
  routes/
    game.js             — Player-facing API routes
    admin.js            — Moderator API routes
```

### Build Flags

```javascript
// vite.config.js
define: {
  __DEV_TOOLS__: JSON.stringify(process.env.NODE_ENV !== 'production'),
}
```

- `npm run dev` → `NODE_ENV=development` → `__DEV_TOOLS__ = true` → all debug tools visible
- `npm run build` → `NODE_ENV=production` → `__DEV_TOOLS__ = false` → debug tools tree-shaken out of bundle

**You never need to toggle anything.** Dev mode is automatic when you `npm run dev`. Production mode is automatic when you `npm run build`.

### Shared Simulation Code

The simulation engine files (`orchestrator.js`, `detectionEngine.js`, `movementSimulator.js`, etc.) are **pure JS with no DOM dependencies**. They can be imported by both:
- The Vite dev server (client-side, as they are today)
- The Express production server (server-side, via `import`)

No duplication needed. The same files serve both environments.

---

## SECOND-PASS SECURITY FINDINGS

Additional issues found in the second security audit pass:

### CRITICAL

| Finding | File | Issue |
|---------|------|-------|
| **Rotate API keys** | `.env` | Keys were visible in audit conversation. Rotate immediately. |
| **LLM can modify any unit attribute** | `orchestrator.js:774` | `applyStateUpdates` allows LLM to set `id`, `actor`, `name`, `type` on units. Add attribute whitelist. |
| **Client controls LLM model selection** | `vite.config.js:126` | Player could select expensive models. Whitelist allowed models server-side. |

### HIGH

| Finding | File | Issue |
|---------|------|-------|
| **`auditlogs/` not in .gitignore** | `.gitignore` | **FIXED** — added during this session. |
| **Error messages leak internal paths** | `vite.config.js` (multiple) | `e.message` returned to client — can reveal filesystem paths. Return generic errors. |
| **No body size limit on `/api/save`** | `vite.config.js:31` | Only endpoint missing the `readBody()` wrapper. Can exhaust server memory. |

### MEDIUM

| Finding | File | Issue |
|---------|------|-------|
| **`compare_paris.cjs` leaks developer path** | project root | Contains hardcoded `C:/Users/Ryan/...` path. Delete or gitignore before publishing. |
| **Filename sanitization allows leading dots** | `vite.config.js` | Could write `.env` or `.htaccess` in save directories. Require `.json` extension. |
| **No rate limiting on file endpoints** | `vite.config.js` | Only LLM endpoint has rate limiting. Add to all write endpoints. |

### CLEAN (No Issues Found)

| Area | Status |
|------|--------|
| XSS | No `dangerouslySetInnerHTML` or `innerHTML` anywhere. React auto-escapes. |
| Prototype pollution | No `Object.assign` with user input. Spread operators are structurally safe. |
| Client-side storage | No `localStorage`/`sessionStorage`/`cookie` usage. |
| Open redirects | No user-controlled redirects. |
| Source maps | Vite default: dev only, not in production builds. |
| Dependencies | Minimal footprint (react, geotiff, undici). Run `npm audit` before deploy. |

---

## ESTIMATED EFFORT (UPDATED)

| Phase                  | Tasks                                                                                     | Estimated Effort    |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| **Phase 1: MVP PBEM**  | Server build, auth, server-side sim, player API, debug gating, SQLite, email notifications | 2-3 weeks           |
| **Phase 2: Hardening** | Input sanitization, integrity hashing, rate limiting, attribute whitelist, error sanitizing | 1 week              |
| **Phase 3: Dashboard** | Game dashboard with map thumbnails, turn deadlines, game history                           | 1 week              |
| **Phase 4: AI Player** | LLM-as-opponent, structured order parsing, API key management                             | 1 week              |
| **Phase 5: Polish**    | Spectator mode, mobile UI, replay system                                                  | 1-2 weeks           |

**Total for playable alpha (Phases 1-2): ~3-4 weeks**

---

## CHECKLIST: WHAT MUST BE TRUE BEFORE ALPHA

- [ ] **Rotate API keys** (both Anthropic and OpenAI) — *manual step before deploy*
- [x] Server runs standalone Express (not Vite dev server) — `server/index.js`
- [x] Players authenticate with game-scoped tokens — `server/auth.js`
- [x] Each player sees ONLY their per-actor filtered data — `server/routes/game.js` + `adjudicationFilter.js`
- [x] All simulation runs server-side (detection, movement, fortune, friction, adjudication) — `server/gameEngine.js`
- [x] FoW toggle, View Prompt, Raw tab, Export Log removed from production build — `__DEV_TOOLS__` flag
- [x] Pause/override panel is moderator-only — gated behind `__DEV_TOOLS__`
- [x] Game saves are server-only (SQLite), never sent raw to clients — `server/db.js`
- [x] Master adjudication never sent to any player — `server/routes/game.js` uses `actorResults[actorId]`
- [x] LLM attribute whitelist in `applyStateUpdates` (block `id`, `actor`, `name`, `type`) — `ALLOWED_UPDATE_ATTRIBUTES` in `orchestrator.js`
- [x] LLM model whitelist in adjudication endpoint — `ALLOWED_MODELS` in `server/llmProxy.js`
- [ ] HTTPS enabled (handled by Railway/Render) — *deploy config*
- [x] API keys secured in environment variables (not `.env` file in production)
- [x] Player text sanitized before LLM prompt insertion — `sanitizePlayerText()` in `server/routes/game.js`
- [x] Body size limits on all POST endpoints — `express.json({ limit: '10mb' })` in `server/index.js`
- [x] Order validation enforced (your units only, your turn only) — actor unit check in `POST /orders`
- [x] Email notifications work (invite link + turn notification) — `server/email.js` (console fallback if SMTP not configured)
- [x] Error messages sanitized (no internal paths in responses) — generic error handler in `server/index.js`
- [x] `compare_paris.cjs` gitignored — added to `.gitignore`
- [x] Filename sanitization: no leading dots, path traversal check — fixed in `vite.config.js` + `server/index.js`
- [x] Run `npm audit` — fixed rollup vulnerability, remaining are dev-only moderate
- [x] `situation_assessment` stripped from player views — removed from `adjudicationFilter.js`
- [x] `de_escalation_assessment` stripped from player views — removed from `adjudicationFilter.js`
- [x] `meta` stripped from player views — removed from `adjudicationFilter.js`
- [x] Narrative auditor fails closed (deterministic scrub fallback) — `narrativeAuditor.js`

---

## IMPLEMENTATION STATUS

### Files Created

| File | Purpose |
|------|---------|
| `server/index.js` | Main Express server entry point |
| `server/db.js` | SQLite persistence layer (better-sqlite3) |
| `server/auth.js` | Token-based authentication middleware |
| `server/llmProxy.js` | Server-side LLM API calls with model whitelist |
| `server/gameEngine.js` | Server-side turn processing orchestration |
| `server/email.js` | Email notification service (SMTP or console) |
| `server/aiPlayer.js` | AI opponent order generation via LLM |
| `server/nodeLoader.js` | ESM loader for Vite `?raw` imports in Node |
| `server/nodeLoaderHooks.js` | Resolve/load hooks for `.md` file imports |
| `server/routes/game.js` | Player-facing API endpoints |
| `server/routes/admin.js` | Moderator/admin API endpoints |
| `src/Dashboard.jsx` | PBEM game dashboard (join, list, manage games) |

### Files Modified

| File | Changes |
|------|---------|
| `vite.config.js` | Added `__DEV_TOOLS__` define, fixed filename sanitization |
| `src/simulation/SimGame.jsx` | Wrapped debug tools in `__DEV_TOOLS__` guards |
| `src/simulation/orchestrator.js` | Added `ALLOWED_UPDATE_ATTRIBUTES` whitelist |
| `src/simulation/adjudicationFilter.js` | Stripped `situation_assessment`, `de_escalation_assessment`, `meta` from player views |
| `src/simulation/narrativeAuditor.js` | Fail-closed with deterministic scrub fallback |
| `package.json` | Added server scripts, new dependencies |
| `.gitignore` | Added `data/` directory, `compare_paris.cjs` |
| `.env.example` | Added SMTP and server configuration vars |
| `src/App.jsx` | Added "dashboard" mode, PBEM Games menu card |
| `src/components/AppHeader.jsx` | Added "dashboard" mode label |
| `server/routes/admin.js` | Wired up email notifications (invite, results, your-turn) |
| `server/routes/game.js` | Wired up email notifications (all-orders-in, challenge) |
| `server/index.js` | Added email service initialization |

### NPM Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server (client) |
| `npm run server:dev` | Express server with `--watch` |
| `npm run server` | Express server (production) |
| `npm run start` | Build + production server |
| `npm run build` | Production client build (`__DEV_TOOLS__=false`) |

### API Endpoints

#### Player API (`/api/game/...`, requires Bearer session token)
- `GET /state` — FOW-filtered game state
- `GET /terrain` — Shared terrain data
- `POST /orders` — Submit sealed orders
- `GET /results/:turn` — Filtered turn results
- `POST /decision` — Accept/challenge adjudication
- `GET /briefing` — FOW-filtered briefing markdown
- `GET /log` — Actor-scoped game log
- `GET /status` — Order submission status

#### Admin API (`/api/admin/...`)
- `POST /games` — Create game (returns moderator token + invite tokens)
- `POST /join` — Exchange invite token for session token
- `GET /games` — List all games
- `GET /games/:id/state` — Full god-view state (mod only)
- `GET /games/:id/players` — Player list (mod only)
- `POST /games/:id/process-turn` — Trigger turn processing (mod only)
- `POST /games/:id/finalize-turn` — Apply state updates (mod only)
- `POST /games/:id/pause|resume|end` — Game control (mod only)

### Remaining Work Before Alpha Deploy

1. ~~**Build game dashboard UI**~~ — Done (`src/Dashboard.jsx`)
2. ~~**Wire up email notifications**~~ — Done (invite, results, your-turn, all-orders-in, challenge)
3. **Deploy to Railway/Render** with environment variables
4. **Rotate API keys** before giving access to external testers
5. ~~**Remove `compare_paris.cjs`**~~ — Gitignored
6. **Test full end-to-end flow**: create game → invite → join → submit orders → adjudicate → review → next turn

---

*Report generated: 2026-03-07*
*Updated: 2026-03-07 (Phase 1+2 implementation complete — server, auth, API, security, AI player, email, dashboard UI, email wiring)*
