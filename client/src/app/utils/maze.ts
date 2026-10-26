import { Direction, MazeCell } from '../models/game.models';

const DELTAS: Record<Direction, { dr: number; dc: number }> = {
  N: { dr: -1, dc: 0 },
  E: { dr: 0, dc: 1 },
  S: { dr: 1, dc: 0 },
  W: { dr: 0, dc: -1 },
};

// Mirrors server/src/maze.js#canStep exactly, so the client can predict a
// move locally (instant feedback, and a silent "bump" for an illegal one)
// without waiting on a round trip. The server re-validates every move
// itself and is the only one that actually advances a player's position -
// this is a prediction, never a substitute for that authority.
export function canStep(
  cells: MazeCell[][],
  row: number,
  col: number,
  direction: Direction,
): boolean {
  const delta = DELTAS[direction];
  if (cells[row][col][direction]) return false;

  const nr = row + delta.dr;
  const nc = col + delta.dc;
  return nr >= 0 && nr < cells.length && nc >= 0 && nc < cells[0].length;
}

export function stepTo(
  row: number,
  col: number,
  direction: Direction,
): { row: number; col: number } {
  const delta = DELTAS[direction];
  return { row: row + delta.dr, col: col + delta.dc };
}
