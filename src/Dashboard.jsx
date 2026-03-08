import { useState, useEffect, useCallback } from "react";
import { colors, typography, radius, shadows, animation, space } from "./theme.js";
import { Button, Input, Card, Badge, SectionHeader } from "./components/ui.jsx";
import PBEMGame from "./simulation/PBEMGame.jsx";
import ModeratorPanel from "./simulation/ModeratorPanel.jsx";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — PBEM game lobby and management screen.
// Players join games with invite tokens, view active games,
// check game status, and submit orders.
//
// Session tokens are stored in localStorage keyed by gameId.
// Each token is game-scoped — losing it means re-joining.
// ═══════════════════════════════════════════════════════════════

const API_BASE = "/api";

// ── localStorage helpers for session tokens ──────────────────

function getSavedGames() {
  try {
    return JSON.parse(localStorage.getItem("oc_games") || "[]");
  } catch { return []; }
}

function saveGame(entry) {
  const games = getSavedGames().filter(g => g.gameId !== entry.gameId);
  games.unshift(entry); // newest first
  localStorage.setItem("oc_games", JSON.stringify(games));
}

function removeGame(gameId) {
  const games = getSavedGames().filter(g => g.gameId !== gameId);
  localStorage.setItem("oc_games", JSON.stringify(games));
}

// ── API helpers ──────────────────────────────────────────────

async function apiFetch(path, token, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function Dashboard({ onBack }) {
  const [inviteToken, setInviteToken] = useState("");
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [games, setGames] = useState([]); // local list of joined games with live status
  const [selectedGame, setSelectedGame] = useState(null); // expanded game detail
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false); // create game form toggle
  const [activeGame, setActiveGame] = useState(null);  // game entry to launch PBEMGame
  const [moderating, setModerating] = useState(null);  // { gameId, moderatorToken } to launch ModeratorPanel

  // Load joined games from localStorage and fetch their status
  const refreshGames = useCallback(async () => {
    setRefreshing(true);
    const saved = getSavedGames();
    const updated = [];

    for (const entry of saved) {
      try {
        const state = await apiFetch("/game/state", entry.sessionToken);
        const status = await apiFetch("/game/status", entry.sessionToken);
        updated.push({ ...entry, state, status, error: null });
      } catch (err) {
        // Token may be invalid/expired — keep the entry but show error
        updated.push({ ...entry, state: null, status: null, error: err.message });
      }
    }

    setGames(updated);
    setRefreshing(false);
  }, []);

  useEffect(() => { refreshGames(); }, [refreshGames]);

  // ── Join Game ──────────────────────────────────────────────

  const handleJoin = useCallback(async () => {
    if (!inviteToken.trim()) return;
    setJoining(true);
    setJoinError(null);

    try {
      const result = await apiFetch("/admin/join", null, {
        method: "POST",
        body: JSON.stringify({ inviteToken: inviteToken.trim() }),
      });

      saveGame({
        gameId: result.gameId,
        actorId: result.actorId,
        actorName: result.actorName,
        sessionToken: result.sessionToken,
        joinedAt: new Date().toISOString(),
      });

      setInviteToken("");
      await refreshGames();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }, [inviteToken, refreshGames]);

  // ── Remove Game from local list ────────────────────────────

  const handleRemove = useCallback((gameId) => {
    removeGame(gameId);
    if (selectedGame?.gameId === gameId) setSelectedGame(null);
    setGames(prev => prev.filter(g => g.gameId !== gameId));
  }, [selectedGame]);

  // ── Moderator Panel (full-screen) ──────────────────────────

  if (moderating) {
    return (
      <ModeratorPanel
        gameId={moderating.gameId}
        moderatorToken={moderating.moderatorToken}
        onBack={() => setModerating(null)}
      />
    );
  }

  // ── Active PBEM Game (full-screen game view) ────────────────

  if (activeGame) {
    return (
      <PBEMGame
        sessionToken={activeGame.sessionToken}
        gameId={activeGame.gameId}
        actorId={activeGame.actorId}
        actorName={activeGame.actorName}
        onBack={() => { setActiveGame(null); refreshGames(); }}
      />
    );
  }

  // ── Create Game View ────────────────────────────────────────

  if (showCreate) {
    return (
      <CreateGame
        onBack={() => setShowCreate(false)}
        onCreated={(result) => {
          setShowCreate(false);
          refreshGames();
        }}
      />
    );
  }

  // ── Game Detail View ───────────────────────────────────────

  if (selectedGame) {
    return (
      <GameDetail
        game={selectedGame}
        onBack={() => setSelectedGame(null)}
        onRefresh={refreshGames}
        onPlay={(game) => setActiveGame(game)}
      />
    );
  }

  // ── Main Dashboard ─────────────────────────────────────────

  return (
    <div style={{
      height: "100%", overflow: "auto",
      background: colors.bg.base, color: colors.text.primary,
      fontFamily: typography.fontFamily,
      display: "flex", justifyContent: "center",
      padding: `${space[8]}px ${space[4]}px`,
    }}>
      <div style={{ width: "100%", maxWidth: 640 }}>

        {/* Join Game */}
        <Card accent={colors.accent.amber} style={{ marginBottom: space[6] }}>
          <SectionHeader accent={colors.accent.amber}>Join a Game</SectionHeader>
          <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[3] }}>
            Paste the invite token you received from the game moderator.
          </div>
          <div style={{ display: "flex", gap: space[2], alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <Input
                value={inviteToken}
                onChange={setInviteToken}
                placeholder="Paste invite token..."
                style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }}
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              />
            </div>
            <Button onClick={handleJoin} disabled={joining || !inviteToken.trim()}>
              {joining ? "Joining..." : "Join"}
            </Button>
          </div>
          {joinError && (
            <div style={{ color: colors.accent.red, fontSize: typography.body.sm, marginTop: space[1] }}>
              {joinError}
            </div>
          )}
        </Card>

        {/* Moderate Game */}
        <ModerateSection onModerate={setModerating} />

        {/* Active Games */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space[3] }}>
          <SectionHeader accent={colors.accent.blue} style={{ marginBottom: 0 }}>Your Games</SectionHeader>
          <div style={{ display: "flex", gap: space[2] }}>
            <Button variant="ghost" size="sm" onClick={refreshGames} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>+ Create Game</Button>
          </div>
        </div>

        {games.length === 0 && (
          <div style={{
            padding: space[8], textAlign: "center",
            color: colors.text.muted, fontSize: typography.body.sm,
            border: `1px dashed ${colors.border.subtle}`, borderRadius: radius.lg,
          }}>
            No games yet. Join one with an invite token above.
          </div>
        )}

        {games.map(game => (
          <GameCard
            key={game.gameId}
            game={game}
            onSelect={() => setSelectedGame(game)}
            onRemove={() => handleRemove(game.gameId)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Create Game Form ─────────────────────────────────────────

function CreateGame({ onBack, onCreated }) {
  const [gameName, setGameName] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [terrainFiles, setTerrainFiles] = useState([]);
  const [selectedTerrain, setSelectedTerrain] = useState("");
  const [loadingTerrain, setLoadingTerrain] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { gameId, moderatorToken, inviteTokens }

  // Moderation mode: "player" (auto-process, no moderator needed) or "human" (manual review)
  const [moderationMode, setModerationMode] = useState("player");

  // Actor configuration — simple 2-player default
  const [actors, setActors] = useState([
    { id: "actor_1", name: "Blue Force", email: "", isAi: false },
    { id: "actor_2", name: "Red Force", email: "", isAi: false },
  ]);

  // Load available terrain saves on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/saves");
        const files = await res.json();
        setTerrainFiles(files);
      } catch {
        setTerrainFiles([]);
      } finally {
        setLoadingTerrain(false);
      }
    })();
  }, []);

  const updateActor = (index, field, value) => {
    setActors(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a));
  };

  const handleCreate = async () => {
    if (!gameName.trim()) { setError("Game name is required"); return; }
    if (!anthropicKey.trim() && !openaiKey.trim()) {
      setError("At least one API key is required (Anthropic or OpenAI)");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // Load terrain data if a file was selected
      let terrainData = null;
      if (selectedTerrain) {
        const res = await fetch(`/api/load?file=${encodeURIComponent(selectedTerrain)}`);
        if (res.ok) terrainData = await res.json();
      }

      // Build scenario from actors
      const scenario = {
        name: gameName.trim(),
        actors: actors.map(a => ({
          id: a.id,
          name: a.name,
          email: a.email || undefined,
          isAi: a.isAi,
          affiliation: a.id === "actor_1" ? "friendly" : "hostile",
        })),
      };

      // Determine LLM provider based on which key was provided
      const provider = anthropicKey.trim() ? "anthropic" : "openai";
      const model = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o";

      const body = {
        name: gameName.trim(),
        scenario,
        terrainData,
        config: {
          llm: { provider, model, temperature: 0.4 },
          moderationMode,
        },
        apiKeys: {},
      };
      if (anthropicKey.trim()) body.apiKeys.anthropicKey = anthropicKey.trim();
      if (openaiKey.trim()) body.apiKeys.openaiKey = openaiKey.trim();

      const data = await apiFetch("/admin/games", null, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // ── Success screen — show tokens ────────────────────────────

  if (result) {
    return (
      <div style={{
        height: "100%", overflow: "auto",
        background: colors.bg.base, color: colors.text.primary,
        fontFamily: typography.fontFamily,
        display: "flex", justifyContent: "center",
        padding: `${space[8]}px ${space[4]}px`,
      }}>
        <div style={{ width: "100%", maxWidth: 640 }}>
          <Card accent={colors.accent.green} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.green}>Game Created</SectionHeader>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary, marginBottom: space[4] }}>
              Save these tokens — they cannot be retrieved later.
            </div>

            <div style={{ marginBottom: space[3] }}>
              <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 4 }}>Moderator Token (admin access)</div>
              <div style={{
                padding: space[2], background: colors.bg.base, borderRadius: radius.md,
                fontFamily: typography.monoFamily, fontSize: typography.body.xs,
                border: `1px solid ${colors.border.subtle}`, wordBreak: "break-all",
                userSelect: "all",
              }}>
                {result.moderatorToken}
              </div>
            </div>

            {Object.entries(result.inviteTokens || {}).map(([actorId, token]) => {
              const actor = actors.find(a => a.id === actorId);
              return (
                <div key={actorId} style={{ marginBottom: space[3] }}>
                  <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 4 }}>
                    Invite Token — {actor?.name || actorId}
                  </div>
                  <div style={{
                    padding: space[2], background: colors.bg.base, borderRadius: radius.md,
                    fontFamily: typography.monoFamily, fontSize: typography.body.xs,
                    border: `1px solid ${colors.border.subtle}`, wordBreak: "break-all",
                    userSelect: "all",
                  }}>
                    {token}
                  </div>
                </div>
              );
            })}

            <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginTop: space[2] }}>
              Game ID: {result.gameId}
            </div>
          </Card>

          <Button onClick={() => onCreated(result)}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  // ── Create form ─────────────────────────────────────────────

  return (
    <div style={{
      height: "100%", overflow: "auto",
      background: colors.bg.base, color: colors.text.primary,
      fontFamily: typography.fontFamily,
      display: "flex", justifyContent: "center",
      padding: `${space[8]}px ${space[4]}px`,
    }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: space[3], marginBottom: space[6] }}>
          <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
          <div style={{ fontSize: typography.heading.lg, fontWeight: typography.weight.bold }}>
            Create New Game
          </div>
        </div>

        {error && (
          <div style={{
            padding: space[3], marginBottom: space[4],
            background: colors.accent.red + "15", border: `1px solid ${colors.accent.red}40`,
            borderRadius: radius.md, color: colors.accent.red, fontSize: typography.body.sm,
          }}>
            {error}
          </div>
        )}

        {/* Game Name */}
        <Card accent={colors.accent.blue} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.blue}>Game Details</SectionHeader>
          <div style={{ marginBottom: space[3] }}>
            <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 4 }}>
              Game Name
            </label>
            <Input value={gameName} onChange={setGameName} placeholder="e.g. Battle of the Bulge" />
          </div>

          <div>
            <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 4 }}>
              Terrain File {loadingTerrain && "(loading...)"}
            </label>
            {terrainFiles.length > 0 ? (
              <select
                value={selectedTerrain}
                onChange={e => setSelectedTerrain(e.target.value)}
                style={{
                  width: "100%", padding: `${space[2]}px`, borderRadius: radius.md,
                  background: colors.bg.base, color: colors.text.primary,
                  border: `1px solid ${colors.border.subtle}`,
                  fontFamily: typography.fontFamily, fontSize: typography.body.sm,
                }}
              >
                <option value="">No terrain (blank map)</option>
                {terrainFiles.map(f => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>
                No terrain saves found. Generate terrain in the Parser first.
              </div>
            )}
          </div>
        </Card>

        {/* API Keys */}
        <Card accent={colors.accent.amber} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.amber}>API Keys</SectionHeader>
          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[3] }}>
            Provide at least one API key. Keys are stored server-side and used only for this game's LLM adjudication calls.
            They are never exposed to players.
          </div>

          <div style={{ marginBottom: space[3] }}>
            <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 4 }}>
              Anthropic API Key
            </label>
            <Input
              value={anthropicKey}
              onChange={setAnthropicKey}
              placeholder="sk-ant-..."
              style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }}
            />
          </div>

          <div>
            <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 4 }}>
              OpenAI API Key (optional if Anthropic provided)
            </label>
            <Input
              value={openaiKey}
              onChange={setOpenaiKey}
              placeholder="sk-..."
              style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }}
            />
          </div>
        </Card>

        {/* Moderation Mode */}
        <Card accent={colors.accent.cyan} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.cyan}>Moderation Mode</SectionHeader>
          <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[3] }}>
            Controls how turns are processed after all players submit orders.
          </div>
          {[
            { value: "player", label: "Player Moderator", desc: "Turns auto-process when all orders are in. Players can challenge results." },
            { value: "human", label: "Human Moderator", desc: "A moderator manually reviews and processes each turn. Requires moderator token." },
          ].map(opt => (
            <label key={opt.value} style={{
              display: "flex", alignItems: "flex-start", gap: space[2], cursor: "pointer",
              padding: `${space[2]}px`, marginBottom: space[1], borderRadius: radius.sm,
              background: moderationMode === opt.value ? `${colors.accent.cyan}10` : "transparent",
              border: `1px solid ${moderationMode === opt.value ? colors.accent.cyan + "40" : "transparent"}`,
            }}>
              <input type="radio" name="moderationMode" value={opt.value} checked={moderationMode === opt.value} onChange={() => setModerationMode(opt.value)} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: typography.body.sm, fontWeight: typography.weight.semibold, color: colors.text.primary }}>{opt.label}</div>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </Card>

        {/* Actors */}
        <Card accent={colors.accent.purple} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.purple}>Players / Actors</SectionHeader>
          {actors.map((actor, i) => (
            <div key={actor.id} style={{
              padding: space[2], marginBottom: space[2],
              background: colors.bg.base, borderRadius: radius.md,
              border: `1px solid ${colors.border.subtle}`,
            }}>
              <div style={{ display: "flex", gap: space[2], marginBottom: space[2] }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 2 }}>Name</label>
                  <Input value={actor.name} onChange={v => updateActor(i, "name", v)} placeholder="Force name" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: typography.body.xs, color: colors.text.muted, display: "block", marginBottom: 2 }}>Email (optional)</label>
                  <Input value={actor.email} onChange={v => updateActor(i, "email", v)} placeholder="player@email.com" />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: space[1], fontSize: typography.body.xs, color: colors.text.muted, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={actor.isAi}
                  onChange={e => updateActor(i, "isAi", e.target.checked)}
                />
                AI-controlled
              </label>
            </div>
          ))}
          <Button
            variant="ghost" size="sm"
            onClick={() => setActors(prev => {
              const nextNum = prev.reduce((max, a) => Math.max(max, parseInt(a.id.split('_')[1]) || 0), 0) + 1;
              return [...prev, {
                id: `actor_${nextNum}`,
                name: `Force ${nextNum}`,
                email: "",
                isAi: false,
              }];
            })}
          >
            + Add Actor
          </Button>
        </Card>

        <div style={{ display: "flex", gap: space[2] }}>
          <Button variant="secondary" onClick={onBack}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Game"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Game Card (list item) ────────────────────────────────────

function GameCard({ game, onSelect, onRemove }) {
  const [hovered, setHovered] = useState(false);
  const state = game.state;
  const status = game.status;

  const statusColor = game.error ? colors.accent.red
    : state?.game?.status === "ended" ? colors.text.muted
    : state?.game?.status === "paused" ? colors.accent.amber
    : colors.accent.green;

  const statusLabel = game.error ? "Unavailable"
    : state?.game?.status === "ended" ? "Ended"
    : state?.game?.status === "paused" ? "Paused"
    : "Active";

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: space[3],
        padding: space[3], marginBottom: space[2],
        background: hovered ? colors.bg.surface : colors.bg.raised,
        border: `1px solid ${hovered ? colors.accent.blue + "40" : colors.border.subtle}`,
        borderRadius: radius.lg, cursor: "pointer",
        transition: `all ${animation.normal} ${animation.easeOut}`,
      }}
    >
      {/* Actor badge */}
      <div style={{
        width: 40, height: 40, borderRadius: radius.md,
        background: colors.accent.blue + "15",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: typography.heading.md, fontWeight: typography.weight.bold,
        color: colors.accent.blue, flexShrink: 0,
      }}>
        {(game.actorName || "?")[0].toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: typography.body.md, fontWeight: typography.weight.semibold,
          color: colors.text.primary, marginBottom: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {state?.game?.name || game.gameId}
        </div>
        <div style={{ display: "flex", gap: space[2], alignItems: "center", fontSize: typography.body.xs, color: colors.text.muted }}>
          <span>Playing as {game.actorName}</span>
          {state?.game?.turn && <span>Turn {state.game.turn}</span>}
          {status?.iSubmitted && <Badge color={colors.accent.green}>Orders Sealed</Badge>}
          {status && !status.iSubmitted && status.turn && <Badge color={colors.accent.amber}>Orders Needed</Badge>}
        </div>
      </div>

      {/* Status */}
      <Badge color={statusColor}>{statusLabel}</Badge>

      {/* Remove button */}
      <div
        onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{
          padding: "4px 8px", borderRadius: radius.sm, cursor: "pointer",
          color: colors.text.muted, fontSize: typography.body.xs,
          opacity: hovered ? 0.8 : 0,
          transition: `opacity ${animation.fast}`,
        }}
        title="Remove from list"
      >
        x
      </div>
    </div>
  );
}

// ── Game Detail View ─────────────────────────────────────────

function GameDetail({ game, onBack, onRefresh, onPlay }) {
  const [gameState, setGameState] = useState(game.state);
  const [gameStatus, setGameStatus] = useState(game.status);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(game.error);

  // Order submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  // Decision state
  const [decision, setDecision] = useState(null);
  const [challengeText, setChallengeText] = useState("");
  const [decidingResult, setDecidingResult] = useState(null);

  // Turn results
  const [turnResults, setTurnResults] = useState(null);

  const token = game.sessionToken;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, status] = await Promise.all([
        apiFetch("/game/state", token),
        apiFetch("/game/status", token),
      ]);
      setGameState(state);
      setGameStatus(status);

      // If we have results for the current turn, fetch them
      if (state.game.turn > 1) {
        try {
          const results = await apiFetch(`/game/results/${state.game.turn - 1}`, token);
          setTurnResults(results);
        } catch { setTurnResults(null); }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Submit Decision (accept/challenge) ─────────────────────

  const handleDecision = useCallback(async (dec) => {
    setDecision(dec);
    try {
      const result = await apiFetch("/game/decision", token, {
        method: "POST",
        body: JSON.stringify({
          decision: dec,
          challengeText: dec === "challenge" ? challengeText : "",
        }),
      });
      setDecidingResult(result);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [token, challengeText, refresh]);

  if (error && !gameState) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: space[3],
        fontFamily: typography.fontFamily, color: colors.text.primary,
      }}>
        <div style={{ color: colors.accent.red, fontSize: typography.body.md }}>{error}</div>
        <div style={{ display: "flex", gap: space[2] }}>
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button onClick={refresh}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: typography.fontFamily, color: colors.text.muted,
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{
      height: "100%", overflow: "auto",
      background: colors.bg.base, color: colors.text.primary,
      fontFamily: typography.fontFamily,
      display: "flex", justifyContent: "center",
      padding: `${space[6]}px ${space[4]}px`,
    }}>
      <div style={{ width: "100%", maxWidth: 700 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: space[3], marginBottom: space[6] }}>
          <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: typography.heading.lg, fontWeight: typography.weight.bold }}>
              {gameState.game.name || game.gameId}
            </div>
            <div style={{ fontSize: typography.body.sm, color: colors.text.muted }}>
              Playing as {game.actorName} — Turn {gameState.game.turn}
              {gameState.game.currentDate && ` — ${gameState.game.currentDate}`}
            </div>
          </div>
          <Button onClick={() => onPlay(game)}>Play</Button>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>

        {error && (
          <div style={{
            padding: space[3], marginBottom: space[4],
            background: colors.accent.red + "15", border: `1px solid ${colors.accent.red}40`,
            borderRadius: radius.md, color: colors.accent.red, fontSize: typography.body.sm,
          }}>
            {error}
          </div>
        )}

        {/* Game Status */}
        <Card accent={colors.accent.blue} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.blue}>Game Status</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[3] }}>
            <StatusItem label="Phase" value={gameState.game.phase || "planning"} />
            <StatusItem label="Turn" value={gameState.game.turn} />
            <StatusItem label="Players Submitted" value={`${gameStatus?.submittedCount || 0} / ${gameStatus?.totalPlayers || "?"}`} />
            <StatusItem label="Your Orders" value={gameState.ordersSubmitted ? "Sealed" : "Not submitted"} accent={gameState.ordersSubmitted ? colors.accent.green : colors.accent.amber} />
          </div>
          {gameState.ordersHash && (
            <div style={{ marginTop: space[2], fontSize: typography.body.xs, color: colors.text.muted, fontFamily: typography.monoFamily }}>
              Order hash: {gameState.ordersHash.slice(0, 16)}...
            </div>
          )}
        </Card>

        {/* Your Units */}
        <Card accent={colors.accent.green} style={{ marginBottom: space[4] }}>
          <SectionHeader accent={colors.accent.green}>
            Your Forces ({gameState.myUnits?.length || 0} units)
          </SectionHeader>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {(gameState.myUnits || []).map(unit => (
              <div key={unit.id} style={{
                display: "flex", alignItems: "center", gap: space[2],
                padding: `${space[1]}px 0`,
                borderBottom: `1px solid ${colors.border.subtle}`,
                fontSize: typography.body.sm,
              }}>
                <span style={{ color: colors.text.primary, fontWeight: typography.weight.medium, flex: 1 }}>
                  {unit.name}
                </span>
                <Badge color={colors.text.muted}>{unit.type}</Badge>
                <span style={{ color: colors.text.muted, fontFamily: typography.monoFamily, fontSize: typography.body.xs }}>
                  {unit.position}
                </span>
                {unit.strength != null && (
                  <span style={{ color: unit.strength > 70 ? colors.accent.green : unit.strength > 30 ? colors.accent.amber : colors.accent.red, fontSize: typography.body.xs }}>
                    {unit.strength}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Known Enemy Units */}
        {gameState.knownEnemyUnits?.length > 0 && (
          <Card accent={colors.accent.red} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.red}>
              Detected Enemy Forces ({gameState.knownEnemyUnits.length})
            </SectionHeader>
            <div style={{ maxHeight: 150, overflow: "auto" }}>
              {gameState.knownEnemyUnits.map(unit => (
                <div key={unit.id} style={{
                  display: "flex", alignItems: "center", gap: space[2],
                  padding: `${space[1]}px 0`,
                  borderBottom: `1px solid ${colors.border.subtle}`,
                  fontSize: typography.body.sm,
                }}>
                  <span style={{ color: colors.text.primary, flex: 1 }}>{unit.name}</span>
                  <Badge color={colors.text.muted}>{unit.type}</Badge>
                  <Badge color={unit.detectionTier === "contact" ? colors.accent.amber : colors.accent.red}>
                    {unit.detectionTier || "detected"}
                  </Badge>
                  <span style={{ color: colors.text.muted, fontFamily: typography.monoFamily, fontSize: typography.body.xs }}>
                    {unit.position}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Turn Results (previous turn) */}
        {turnResults?.adjudication && (
          <Card accent={colors.accent.purple} style={{ marginBottom: space[4] }}>
            <SectionHeader accent={colors.accent.purple}>
              Turn {turnResults.turn} Results
            </SectionHeader>
            {turnResults.adjudication.outcome_determination?.narrative && (
              <div style={{
                fontSize: typography.body.sm, color: colors.text.secondary,
                lineHeight: 1.6, whiteSpace: "pre-wrap",
                maxHeight: 300, overflow: "auto",
                padding: space[2], background: colors.bg.base,
                borderRadius: radius.md, border: `1px solid ${colors.border.subtle}`,
              }}>
                {turnResults.adjudication.outcome_determination.narrative}
              </div>
            )}

            {/* Accept / Challenge buttons */}
            {!decidingResult && (
              <div style={{ marginTop: space[3] }}>
                <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[2] }}>
                  Review the results and accept or challenge the adjudication.
                </div>
                <div style={{ display: "flex", gap: space[2], alignItems: "flex-start" }}>
                  <Button variant="success" size="sm" onClick={() => handleDecision("accept")}>
                    Accept Results
                  </Button>
                  <div style={{ flex: 1 }}>
                    <Input
                      value={challengeText}
                      onChange={setChallengeText}
                      placeholder="Explain your challenge (optional)..."
                      style={{ fontSize: typography.body.xs }}
                    />
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleDecision("challenge")}>
                    Challenge
                  </Button>
                </div>
              </div>
            )}
            {decidingResult && (
              <div style={{ marginTop: space[2], fontSize: typography.body.sm, color: colors.accent.green }}>
                Decision recorded. {decidingResult.allDecided ? "All players have decided." : "Waiting for other players..."}
              </div>
            )}
          </Card>
        )}

        {/* Scenario Info */}
        {gameState.scenario && (
          <Card style={{ marginBottom: space[4] }}>
            <SectionHeader>Scenario</SectionHeader>
            <div style={{ fontSize: typography.body.sm, color: colors.text.secondary }}>
              <div>{gameState.scenario.name}</div>
              {gameState.scenario.era && <div style={{ color: colors.text.muted }}>Era: {gameState.scenario.era}</div>}
              {gameState.scenario.actors && (
                <div style={{ marginTop: space[2], display: "flex", gap: space[2], flexWrap: "wrap" }}>
                  {gameState.scenario.actors.map(a => (
                    <Badge key={a.id} color={a.id === game.actorId ? colors.accent.blue : colors.text.muted}>
                      {a.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}

// ── Moderate Section (moderator token input) ──────────────────

function ModerateSection({ onModerate }) {
  const [modToken, setModToken] = useState("");
  const [modGameId, setModGameId] = useState("");
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <div style={{ marginBottom: space[4], textAlign: "right" }}>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} style={{ fontSize: typography.body.xs }}>
          Moderate a Game
        </Button>
      </div>
    );
  }

  return (
    <Card accent={colors.accent.purple} style={{ marginBottom: space[6] }}>
      <SectionHeader accent={colors.accent.purple}>Moderate a Game</SectionHeader>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: space[3] }}>
        Enter the game ID and moderator token to access the admin panel.
      </div>
      <div style={{ display: "flex", gap: space[2], alignItems: "flex-start", marginBottom: space[2] }}>
        <div style={{ flex: "0 0 140px" }}>
          <Input value={modGameId} onChange={setModGameId} placeholder="Game ID" style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }} />
        </div>
        <div style={{ flex: 1 }}>
          <Input value={modToken} onChange={setModToken} placeholder="Moderator token" style={{ fontFamily: typography.monoFamily, fontSize: typography.body.xs }} />
        </div>
        <Button onClick={() => { if (modGameId.trim() && modToken.trim()) onModerate({ gameId: modGameId.trim(), moderatorToken: modToken.trim() }); }} disabled={!modGameId.trim() || !modToken.trim()}>
          Open
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} style={{ fontSize: typography.body.xs }}>Cancel</Button>
    </Card>
  );
}

// ── Status Item ──────────────────────────────────────────────

function StatusItem({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: typography.body.xs, color: colors.text.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: typography.body.md, fontWeight: typography.weight.medium, color: accent || colors.text.primary }}>
        {value}
      </div>
    </div>
  );
}
