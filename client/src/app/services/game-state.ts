import { Service, signal, computed } from '@angular/core';
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_MAZE_SIZE,
  GamePhase,
  MazeState,
  MIN_PLAYERS_TO_START,
  Player,
} from '../models/game.models';
import { buildRanking } from '../utils/ranking';

@Service()
export class GameState {
  readonly playerName = signal('');
  readonly roomId = signal('');
  readonly mySocketId = signal('');

  readonly phase = signal<GamePhase>('home');
  readonly connectionStatus = signal<'online' | 'reconnecting'>('online');
  readonly players = signal<Player[]>([]);
  // Players the server has reported as connection-dropped but still within
  // their reconnection grace window - lets other players' UI show "waiting
  // for them" instead of just going quiet with no explanation.
  readonly disconnectedPlayerIds = signal<Set<string>>(new Set());
  readonly maze = signal<MazeState | null>(null);
  readonly timeLeft = signal(DEFAULT_DURATION_SECONDS);
  readonly durationSeconds = signal(DEFAULT_DURATION_SECONDS);
  readonly mazeSize = signal(DEFAULT_MAZE_SIZE);
  readonly isSolo = signal(false);
  // A one-shot "X finished 3rd!" celebration event - distinct from the
  // continuously-updated `players` state, the same way a toast is distinct
  // from the data it's reporting.
  readonly lastFinish = signal<{ socketId: string; rank: number; timeMs: number } | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly me = computed(
    () => this.players().find((p) => p.socketId === this.mySocketId()) ?? null,
  );
  readonly isHost = computed(() => this.me()?.isHost ?? false);
  readonly canStart = computed(
    () =>
      this.isHost() &&
      (this.isSolo() || this.players().length >= MIN_PLAYERS_TO_START) &&
      this.phase() === 'waiting',
  );
  readonly leaderboard = computed(() => buildRanking(this.players()));

  // Optimistic local step, applied the instant a move is requested so the
  // rat feels responsive on screen. Only row/col move - distanceToExit and
  // percent (which require the server's own BFS distance map, never sent to
  // the client) stay whatever they were until confirmMyPosition reconciles
  // them moments later from the server's authoritative 'moved' event.
  predictMyStep(row: number, col: number) {
    const myId = this.mySocketId();
    this.players.update((list) => list.map((p) => (p.socketId === myId ? { ...p, row, col } : p)));
  }

  confirmMyPosition(row: number, col: number, distanceToExit: number) {
    const myId = this.mySocketId();
    const maze = this.maze();
    const start = maze?.startDistance ?? 0;
    const percent =
      start > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - distanceToExit / start)))) : 0;
    this.players.update((list) =>
      list.map((p) => (p.socketId === myId ? { ...p, row, col, distanceToExit, percent } : p)),
    );
  }

  reset() {
    this.roomId.set('');
    this.phase.set('home');
    this.connectionStatus.set('online');
    this.players.set([]);
    this.disconnectedPlayerIds.set(new Set());
    this.maze.set(null);
    this.timeLeft.set(DEFAULT_DURATION_SECONDS);
    this.durationSeconds.set(DEFAULT_DURATION_SECONDS);
    this.mazeSize.set(DEFAULT_MAZE_SIZE);
    this.isSolo.set(false);
    this.lastFinish.set(null);
    this.errorMessage.set(null);
  }
}
