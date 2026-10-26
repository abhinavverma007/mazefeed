const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveGameSettings,
  DEFAULT_MAZE_SIZE,
  DEFAULT_DURATION_SECONDS,
} = require('./gameSettings');

test('resolveGameSettings accepts values from the allow-list', () => {
  const settings = resolveGameSettings({ mazeSize: 'large', durationSeconds: 180 });
  assert.equal(settings.mazeSize, 'large');
  assert.equal(settings.durationSeconds, 180);
});

test('resolveGameSettings falls back to defaults for an out-of-range value', () => {
  const settings = resolveGameSettings({ mazeSize: 'gigantic', durationSeconds: 999 });
  assert.equal(settings.mazeSize, DEFAULT_MAZE_SIZE);
  assert.equal(settings.durationSeconds, DEFAULT_DURATION_SECONDS);
});

test('resolveGameSettings falls back to defaults when nothing is passed', () => {
  const settings = resolveGameSettings();
  assert.equal(settings.mazeSize, DEFAULT_MAZE_SIZE);
  assert.equal(settings.durationSeconds, DEFAULT_DURATION_SECONDS);
});
