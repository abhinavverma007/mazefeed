const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateMaze, computeDistances, canStep, stepTo } = require('./maze');

test('generateMaze produces a fully connected (perfect) maze', () => {
  const cols = 13;
  const rows = 13;
  const cells = generateMaze(cols, rows);
  const exit = { r: rows - 1, c: cols - 1 };
  const distances = computeDistances(cells, cols, rows, exit);

  // Every cell must be reachable from the exit - a recursive-backtracker
  // carve can never leave an isolated pocket, so no -1 should ever appear.
  for (const row of distances) {
    for (const d of row) {
      assert.notEqual(d, -1);
    }
  }
  assert.equal(distances[rows - 1][cols - 1], 0);
  assert.ok(distances[0][0] > 0, 'start cell should not be the exit itself');
});

test('generateMaze keeps the outer boundary fully walled', () => {
  const cols = 9;
  const rows = 9;
  const cells = generateMaze(cols, rows);

  for (let c = 0; c < cols; c++) {
    assert.equal(cells[0][c].N, true);
    assert.equal(cells[rows - 1][c].S, true);
  }
  for (let r = 0; r < rows; r++) {
    assert.equal(cells[r][0].W, true);
    assert.equal(cells[r][cols - 1].E, true);
  }
});

test('canStep blocks a move through a wall and off the grid', () => {
  const cells = [[{ N: true, E: true, S: true, W: true }]];
  assert.equal(canStep(cells, 0, 0, 'N'), false);
  assert.equal(canStep(cells, 0, 0, 'E'), false);
});

test('canStep allows a move through an open side within bounds', () => {
  const cells = [
    [
      { N: true, E: false, S: true, W: true },
      { N: true, E: true, S: true, W: false },
    ],
  ];
  assert.equal(canStep(cells, 0, 0, 'E'), true);
  assert.deepEqual(stepTo(0, 0, 'E'), { row: 0, col: 1 });
});
