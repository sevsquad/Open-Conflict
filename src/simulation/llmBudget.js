export function getTurnBudgetKey(gameState) {
  const rawGameId = gameState?.game?.id ?? gameState?.game?.folder ?? "unknown-game";
  const gameId = String(rawGameId).trim() || "unknown-game";
  const parsedTurn = Number.parseInt(String(gameState?.game?.turn ?? 0), 10);
  const turn = Number.isFinite(parsedTurn) ? parsedTurn : 0;
  return `${gameId}:turn:${turn}`;
}
