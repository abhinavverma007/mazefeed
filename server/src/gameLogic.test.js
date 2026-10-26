const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyMove, buildRanking } = require('./gameLogic');

function simpleMaze() {
  // A single open row of 3 cells: (0,0) <-> (0,1) <-> (0,2)=exit.
  const cells = [
    [
      { N: true, E: false, S: true, W: true },
      { N: true, E: false, S: true, W: false },
      { N: true, E: true, S: true, W: false },
    ],
  ];
  const distances = [[2, 1, 0]];
  return { cells, distances, exit: { r: 0, c: 2 } };
}

test('applyMove rejects a step through a wall', () => {
  const maze = simpleMaze();
  const player = { row: 0, col: 0, distanceToExit: 2 };
  const result = applyMove(player, maze, 'N');
  assert.equal(result.moved, false);
  assert.equal(result.finished, false);
  assert.equal(player.row, 0);
  assert.equal(player.col, 0);
});

test('applyMove advances position and updates distanceToExit on a legal step', () => {
  const maze = simpleMaze();
  const player = { row: 0, col: 0, distanceToExit: 2 };
  const result = applyMove(player, maze, 'E');
  assert.equal(result.moved, true);
  assert.equal(result.finished, false);
  assert.equal(player.col, 1);
  assert.equal(player.distanceToExit, 1);
});

test('applyMove reports finished once the player reaches the exit cell', () => {
  const maze = simpleMaze();
  const player = { row: 0, col: 1, distanceToExit: 1 };
  const result = applyMove(player, maze, 'E');
  assert.equal(result.moved, true);
  assert.equal(result.finished, true);
  assert.equal(player.col, 2);
});

test('buildRanking ranks finishers ahead of runners-in-progress, by arrival order', () => {
  const players = [
    { socketId: 'a', finished: true, finishOrder: 2, distanceToExit: 0 },
    { socketId: 'b', finished: true, finishOrder: 1, distanceToExit: 0 },
    { socketId: 'c', finished: false, distanceToExit: 5 },
  ];
  const ranked = buildRanking(players);
  assert.deepEqual(
    ranked.map((p) => p.socketId),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    ranked.map((p) => p.rank),
    [1, 2, 3],
  );
});

test('buildRanking gives equal-distance runners the same (skipped) rank', () => {
  const players = [
    { socketId: 'a', finished: false, distanceToExit: 4 },
    { socketId: 'b', finished: false, distanceToExit: 4 },
    { socketId: 'c', finished: false, distanceToExit: 9 },
  ];
  const ranked = buildRanking(players);
  const byId = Object.fromEntries(ranked.map((p) => [p.socketId, p.rank]));
  assert.equal(byId.a, byId.b);
  assert.equal(byId.c, 3);
});
