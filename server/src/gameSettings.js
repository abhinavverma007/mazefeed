const { MAZE_SIZE_OPTIONS } = require('./maze');

const MAZE_SIZE_VALUES = Object.keys(MAZE_SIZE_OPTIONS); // ['small', 'medium', 'large']
const DEFAULT_MAZE_SIZE = 'medium';

const DURATION_OPTIONS = [60, 90, 120, 180]; // seconds
const DEFAULT_DURATION_SECONDS = 90;

// Host-chosen settings are untrusted input; fall back to defaults for anything
// outside the fixed allowed sets instead of trusting arbitrary client values.
function resolveGameSettings({ mazeSize, durationSeconds } = {}) {
  return {
    mazeSize: MAZE_SIZE_VALUES.includes(mazeSize) ? mazeSize : DEFAULT_MAZE_SIZE,
    durationSeconds: DURATION_OPTIONS.includes(durationSeconds)
      ? durationSeconds
      : DEFAULT_DURATION_SECONDS,
  };
}

module.exports = {
  MAZE_SIZE_VALUES,
  DEFAULT_MAZE_SIZE,
  DURATION_OPTIONS,
  DEFAULT_DURATION_SECONDS,
  resolveGameSettings,
};
