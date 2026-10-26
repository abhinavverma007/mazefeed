import { Player } from '../models/game.models';

// Mirrors server/src/gameLogic.js#buildRanking: standard competition ranking
// (equal standing shares a rank), finishers ordered by arrival ahead of
// everyone still in the maze, who are ordered by how few steps from the
// exit they've gotten. Used live (a fun, non-authoritative in-progress
// leaderboard) and is exactly what the server itself sends once a round
// actually ends - the computation is just duplicated client-side so the
// leaderboard can update instantly between server messages too.
export function buildRanking(players: Player[]): Player[] {
  const finished = [...players]
    .filter((p) => p.finished)
    .sort((a, b) => (a.finishOrder ?? 0) - (b.finishOrder ?? 0));
  const unfinished = [...players]
    .filter((p) => !p.finished)
    .sort((a, b) => a.distanceToExit - b.distanceToExit);
  const ordered = [...finished, ...unfinished];

  let rank = 0;
  let prevKey: string | null = null;
  return ordered.map((p, i) => {
    const key = p.finished ? `f-${p.finishOrder}` : `d-${p.distanceToExit}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    return { ...p, rank };
  });
}
