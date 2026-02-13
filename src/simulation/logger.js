// ═══════════════════════════════════════════════════════════════
// LOGGER — Session logging for prompts, adjudications, and state
// ═══════════════════════════════════════════════════════════════

/**
 * Log entry types:
 * - action_submitted: Player submitted an action
 * - prompt_sent: Full prompt sent to LLM
 * - response_received: Raw LLM response received
 * - validation_result: Validation pass/fail
 * - state_update: Game state was modified
 * - moderator_action: Moderator override, pause, note
 * - error: System error
 */

export function createLogger() {
  const entries = [];

  function log(turn, type, data) {
    entries.push({
      timestamp: new Date().toISOString(),
      turn,
      type,
      data
    });
  }

  /**
   * Flush accumulated log entries to the server.
   */
  async function flush(gameId) {
    if (entries.length === 0) return;
    try {
      await fetch("/api/game/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, entries: [...entries] })
      });
    } catch (e) {
      console.error("Failed to flush log:", e);
    }
  }

  /**
   * Export the full log as a downloadable JSON file.
   */
  function exportLog(gameName) {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.download = `${gameName || "game"}_log_${new Date().toISOString().slice(0, 10)}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Get all entries (read-only).
   */
  function getEntries() {
    return [...entries];
  }

  /**
   * Get entries filtered by turn and/or type.
   */
  function query({ turn, type } = {}) {
    return entries.filter(e =>
      (turn === undefined || e.turn === turn) &&
      (type === undefined || e.type === type)
    );
  }

  return { log, flush, exportLog, getEntries, query };
}
