const MAZE_SIZE_OPTIONS = {
  small: { cols: 11, rows: 11 },
  medium: { cols: 15, rows: 15 },
  large: { cols: 19, rows: 19 },
};

// N/E/S/W: true means a wall is present on that side of the cell.
const DIRS = [
  { dir: 'N', dr: -1, dc: 0, opposite: 'S' },
  { dir: 'E', dr: 0, dc: 1, opposite: 'W' },
  { dir: 'S', dr: 1, dc: 0, opposite: 'N' },
  { dir: 'W', dr: 0, dc: -1, opposite: 'E' },
];

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Randomized depth-first "recursive backtracker" carve: every cell starts
// fully walled off, and the walk knocks down exactly one wall per step into
// an unvisited neighbor. This always produces a "perfect" maze - exactly one
// path between any two cells, no loops, no isolated pockets - which is what
// makes a single BFS distance-from-exit pass (see computeDistances) a valid
// stand-in for "how far from winning is this player" everywhere in the maze.
function generateMaze(cols, rows) {
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ N: true, E: true, S: true, W: true })),
  );
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

  const stack = [{ r: 0, c: 0 }];
  visited[0][0] = true;

  while (stack.length > 0) {
    const { r, c } = stack[stack.length - 1];
    const next = shuffle(DIRS)
      .map((d) => ({ ...d, nr: r + d.dr, nc: c + d.dc }))
      .find((d) => d.nr >= 0 && d.nr < rows && d.nc >= 0 && d.nc < cols && !visited[d.nr][d.nc]);

    if (!next) {
      stack.pop();
      continue;
    }

    cells[r][c][next.dir] = false;
    cells[next.nr][next.nc][next.opposite] = false;
    visited[next.nr][next.nc] = true;
    stack.push({ r: next.nr, c: next.nc });
  }

  return cells;
}

// BFS from the exit over the maze's wall graph, giving every cell its exact
// step-distance to the exit in one pass. This is what turns "has this player
// gotten closer to winning" into a plain number comparison, both for the
// live leaderboard (see gameLogic.buildRanking) and for ranking whoever
// doesn't reach the exit before time runs out.
function computeDistances(cells, cols, rows, exit) {
  const distances = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  distances[exit.r][exit.c] = 0;
  const queue = [exit];

  while (queue.length > 0) {
    const { r, c } = queue.shift();
    const cell = cells[r][c];
    const neighbors = [];
    if (!cell.N && r > 0) neighbors.push({ r: r - 1, c });
    if (!cell.S && r < rows - 1) neighbors.push({ r: r + 1, c });
    if (!cell.E && c < cols - 1) neighbors.push({ r, c: c + 1 });
    if (!cell.W && c > 0) neighbors.push({ r, c: c - 1 });

    for (const n of neighbors) {
      if (distances[n.r][n.c] === -1) {
        distances[n.r][n.c] = distances[r][c] + 1;
        queue.push(n);
      }
    }
  }

  return distances;
}

function stepDelta(direction) {
  return DIRS.find((d) => d.dir === direction);
}

// The only source of truth for "is this move legal" - used both when a move
// request comes in over the socket, and (indirectly, via the identical
// constants) by the client's own optimistic local prediction. A wall blocks
// the step regardless of what a tampered client claims its own position is.
function canStep(cells, row, col, direction) {
  const delta = stepDelta(direction);
  if (!delta) return false;
  if (cells[row][col][direction]) return false;

  const nr = row + delta.dr;
  const nc = col + delta.dc;
  return nr >= 0 && nr < cells.length && nc >= 0 && nc < cells[0].length;
}

function stepTo(row, col, direction) {
  const delta = stepDelta(direction);
  return { row: row + delta.dr, col: col + delta.dc };
}

module.exports = { MAZE_SIZE_OPTIONS, generateMaze, computeDistances, canStep, stepTo };
