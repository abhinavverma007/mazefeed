export type Direction = 'N' | 'E' | 'S' | 'W';

// Walls present on each side of a cell. The exact same shape the server
// generates and serializes - the client never recomputes a maze, only walks
// the one it was given.
export interface MazeCell {
  N: boolean;
  E: boolean;
  S: boolean;
  W: boolean;
}

export interface MazePosition {
  r: number;
  c: number;
}

export interface MazeState {
  cells: MazeCell[][];
  cols: number;
  rows: number;
  exit: MazePosition;
  startDistance: number;
}

export interface Player {
  socketId: string;
  name: string;
  color: string;
  isHost: boolean;
  row: number;
  col: number;
  distanceToExit: number;
  percent: number;
  finished: boolean;
  finishOrder: number | null;
  finishTimeMs: number | null;
  rank?: number;
}

export type GamePhase = 'home' | 'waiting' | 'playing' | 'finished';

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 10;

// Mirrors server/src/gameSettings.js and server/src/maze.js - must match
// their allowed values and defaults. The server silently falls back to its
// own default for any value not in its own allow-list.
export interface MazeSizeOption {
  value: 'small' | 'medium' | 'large';
  label: string;
  cols: number;
  rows: number;
}
export const MAZE_SIZE_OPTIONS: MazeSizeOption[] = [
  { value: 'small', label: 'Small', cols: 11, rows: 11 },
  { value: 'medium', label: 'Medium', cols: 15, rows: 15 },
  { value: 'large', label: 'Large', cols: 19, rows: 19 },
];
export const DEFAULT_MAZE_SIZE: MazeSizeOption['value'] = 'medium';

export const DEFAULT_DURATION_SECONDS = 90;
export const DURATION_OPTIONS = [60, 90, 120, 180];
