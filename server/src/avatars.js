// The maze renders every rat with the same emoji, so distinct players are
// told apart by a colored ring drawn behind it instead - a pool bigger than
// MAX_PLAYERS (10) so a full room always gets 10 distinct colors, with some
// left over for variety between games.
const PLAYER_COLORS = [
  '#ff5a5f',
  '#2ecc71',
  '#3498db',
  '#f1c40f',
  '#e67e22',
  '#9b59b6',
  '#1abc9c',
  '#e84393',
  '#00cec9',
  '#fab1a0',
  '#74b9ff',
  '#55efc4',
];

// Picks a random color not already in use in this room, so no two players
// ever share one. Falls back to any color if the pool is somehow exhausted
// (can't happen while MAX_PLAYERS <= PLAYER_COLORS.length, but a graceful
// fallback beats a crash if that ever changes).
function pickColor(usedColors = []) {
  const used = new Set(usedColors);
  const available = PLAYER_COLORS.filter((c) => !used.has(c));
  const pool = available.length > 0 ? available : PLAYER_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { PLAYER_COLORS, pickColor };
