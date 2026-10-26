const { canStep, stepTo } = require('./maze');

// Mutates `player` (row/col) in place if the step is legal, and reports
// whether it reached the exit. The server never trusts a client's claimed
// position - only its requested direction - so a tampered client can't warp
// anywhere a wall doesn't actually open into.
function applyMove(player, maze, direction) {
  if (!canStep(maze.cells, player.row, player.col, direction)) {
    return { moved: false, finished: false };
  }

  const { row, col } = stepTo(player.row, player.col, direction);
  player.row = row;
  player.col = col;
  player.distanceToExit = maze.distances[row][col];

  const finished = row === maze.exit.r && col === maze.exit.c;
  return { moved: true, finished };
}

// Standard competition ranking (equal standing shares a rank): everyone who
// reached the exit ranks ahead of everyone who didn't, ordered by arrival;
// everyone still stuck in the maze when time runs out is ordered by how few
// steps from the exit they got.
function buildRanking(players) {
  const finished = players.filter((p) => p.finished).sort((a, b) => a.finishOrder - b.finishOrder);
  const unfinished = players
    .filter((p) => !p.finished)
    .sort((a, b) => a.distanceToExit - b.distanceToExit);
  const ordered = [...finished, ...unfinished];

  let rank = 0;
  let prevKey = null;
  return ordered.map((p, i) => {
    const key = p.finished ? `f-${p.finishOrder}` : `d-${p.distanceToExit}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    return { ...p, rank };
  });
}

module.exports = { applyMove, buildRanking };
