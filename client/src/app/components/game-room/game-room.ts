import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import { Audio } from '../../services/audio';
import { Fullscreen } from '../../services/fullscreen';
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_MAZE_SIZE,
  Direction,
  DURATION_OPTIONS,
  MAX_PLAYERS,
  MazeState,
  MAZE_SIZE_OPTIONS,
  Player,
} from '../../models/game.models';
import { ordinal } from '../../utils/ordinal';
import { canStep, stepTo } from '../../utils/maze';

// Rapid repeat keydowns or back-to-back swipes faster than this are dropped
// client-side before they're even sent - a scripted/modified client is also
// rate-limited server-side (see server/src/index.js#MIN_MOVE_INTERVAL_MS),
// but a legitimate human mashing keys shouldn't flood the socket either.
const MIN_MOVE_INTERVAL_MS = 90;
const STEP_REPEAT_MS = 150;
const SWIPE_THRESHOLD_PX = 24;

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'N',
  w: 'N',
  W: 'N',
  ArrowRight: 'E',
  d: 'E',
  D: 'E',
  ArrowDown: 'S',
  s: 'S',
  S: 'S',
  ArrowLeft: 'W',
  a: 'W',
  A: 'W',
};

@Component({
  imports: [FormsModule, DecimalPipe],
  selector: 'app-game-room',
  styleUrl: './game-room.css',
  templateUrl: './game-room.html',
})
export class GameRoom implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly socketService = inject(Socket);
  private readonly audio = inject(Audio);
  readonly fullscreen = inject(Fullscreen);
  readonly gameState = inject(GameState);

  @ViewChild('mazeCanvas') private canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mazeViewport') private viewportRef?: ElementRef<HTMLDivElement>;

  readonly maxPlayers = MAX_PLAYERS;
  readonly mazeSizeOptions = MAZE_SIZE_OPTIONS;
  readonly durationOptions = DURATION_OPTIONS;

  // Host-only draft settings, picked before starting; default to the standard run.
  readonly selectedMazeSize = signal(DEFAULT_MAZE_SIZE);
  readonly selectedDurationSeconds = signal(DEFAULT_DURATION_SECONDS);

  readonly statusCallout = signal<{ text: string; color: string } | null>(null);
  private statusCalloutTimeout?: ReturnType<typeof setTimeout>;

  // Same forced look-time as Don't Touch Purple: mashing "Play Again" or
  // "Leave" the instant a run ends (before anyone's actually seen the
  // standings) is cheap to do by accident, and since any player can trigger
  // "Play Again", one trigger-happy click wipes the board for the whole room.
  private static readonly PLAY_AGAIN_DELAY_SECONDS = 4;
  readonly playAgainUnlockIn = signal(0);
  private playAgainInterval?: ReturnType<typeof setInterval>;

  // A fresh page load (e.g. a reload mid-run) starts with phase() at its
  // default 'home' value while the async session-resume check in ngOnInit is
  // still in flight - this guard keeps the "redirect home" effect below from
  // firing on that transient value and racing ahead of the resume attempt.
  private readonly sessionChecked = signal(false);

  readonly roomId = computed(() => this.gameState.roomId());
  readonly players = this.gameState.players;
  readonly connectionStatus = this.gameState.connectionStatus;
  readonly disconnectedPlayerIds = this.gameState.disconnectedPlayerIds;
  readonly leaderboard = this.gameState.leaderboard;
  readonly maze = this.gameState.maze;
  readonly timeLeft = this.gameState.timeLeft;
  readonly phase = this.gameState.phase;
  readonly me = this.gameState.me;
  readonly isHost = this.gameState.isHost;
  readonly canStart = this.gameState.canStart;
  readonly isSolo = this.gameState.isSolo;

  readonly isTimeUrgent = computed(() => this.timeLeft() <= 10 && this.timeLeft() > 0);
  readonly amIFinished = computed(() => this.me()?.finished ?? false);

  readonly myRank = computed(
    () => this.leaderboard().find((p) => p.socketId === this.gameState.mySocketId())?.rank ?? null,
  );
  readonly myRankLabel = computed(() => {
    const rank = this.myRank();
    return rank === null ? '' : ordinal(rank);
  });
  readonly didIWin = computed(() => this.myRank() === 1);

  // Directions currently held down, most-recently-pressed last - the repeat
  // loop always steps toward the end of this list, so pressing a second key
  // while the first is still held takes over immediately (same feel as most
  // arcade-style grid games), and releasing it falls back to whichever
  // direction is still held.
  private heldDirections: Direction[] = [];
  private moveRepeatInterval?: ReturnType<typeof setInterval>;
  private lastMoveSentAt = 0;
  private touchStart: { x: number; y: number } | null = null;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Redraws the canvas whenever the maze itself, my position, or the
    // current phase changes - queued as a microtask so it runs after this
    // same tick's signal writes have all settled.
    effect(() => {
      this.maze();
      this.me();
      this.phase();
      queueMicrotask(() => this.draw());
    });

    effect(() => {
      const finish = this.gameState.lastFinish();
      if (!finish) return;
      const isMe = finish.socketId === this.gameState.mySocketId();
      const player = this.players().find((p) => p.socketId === finish.socketId);
      const label = isMe ? 'YOU' : (player?.name ?? 'Someone').toUpperCase();

      this.statusCallout.set({
        text: `${label} REACHED THE CHEESE — ${ordinal(finish.rank).toUpperCase()}!`,
        color: 'var(--neon-green)',
      });
      if (isMe) this.audio.playFinish(finish.rank);

      clearTimeout(this.statusCalloutTimeout);
      this.statusCalloutTimeout = setTimeout(() => this.statusCallout.set(null), 2200);
    });

    // One tick per second during the final countdown, synced to the same
    // server-driven timeLeft signal that drives the visual urgency state.
    effect(() => {
      const seconds = this.timeLeft();
      if (this.phase() === 'playing' && seconds <= 10 && seconds > 0) {
        this.audio.playTick(seconds);
      }
    });

    effect(() => {
      if (this.phase() === 'finished') {
        this.startPlayAgainCountdown();
      } else {
        this.clearPlayAgainCountdown();
      }
    });

    // A failed resync after reconnecting (session expired, run already over)
    // resets gameState.phase to 'home' out from under this still-mounted
    // component - without this, the player would just stare at a dead,
    // frozen maze instead of landing back at the home screen.
    effect(() => {
      if (this.sessionChecked() && this.phase() === 'home') {
        this.router.navigate(['/']);
      }
    });
  }

  private startPlayAgainCountdown() {
    this.clearPlayAgainCountdown();
    this.playAgainUnlockIn.set(GameRoom.PLAY_AGAIN_DELAY_SECONDS);
    this.playAgainInterval = setInterval(() => {
      const next = this.playAgainUnlockIn() - 1;
      if (next <= 0) {
        this.clearPlayAgainCountdown();
      } else {
        this.playAgainUnlockIn.set(next);
      }
    }, 1000);
  }

  private clearPlayAgainCountdown() {
    clearInterval(this.playAgainInterval);
    this.playAgainInterval = undefined;
    this.playAgainUnlockIn.set(0);
  }

  async ngOnInit() {
    const routeRoomId = this.route.snapshot.paramMap.get('roomId');
    if (!routeRoomId) {
      this.router.navigate(['/']);
      return;
    }
    if (this.gameState.roomId() === routeRoomId) {
      this.sessionChecked.set(true); // live state already matches - normal in-app navigation into this room
      return;
    }

    // No live state for this room - most likely a reload mid-run, which wipes
    // every Angular signal. The room id survives in the URL itself, so try to
    // resume the session (the server holds a dropped seat open for a grace
    // window, same as a network drop) before giving up on it.
    await this.socketService.resumeSession(routeRoomId);
    this.sessionChecked.set(true);
  }

  ngAfterViewInit() {
    if (typeof ResizeObserver !== 'undefined' && this.viewportRef) {
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(this.viewportRef.nativeElement);
    }
    this.draw();
  }

  ngOnDestroy() {
    clearTimeout(this.statusCalloutTimeout);
    clearInterval(this.playAgainInterval);
    clearInterval(this.moveRepeatInterval);
    this.resizeObserver?.disconnect();

    // Navigating away any way other than the explicit Leave button - browser
    // back/forward, typing a new URL - never called disconnect(), so the
    // player stayed fully connected and fully counted server-side (even
    // still the host, silently blocking everyone else from starting the
    // run) while their own screen had already moved on with no way back.
    // This is treated as a deliberate departure (immediate, no reconnection
    // grace period) same as the Leave button.
    if (this.gameState.roomId()) {
      this.socketService.disconnect();
      this.gameState.reset();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    const direction = KEY_DIRECTIONS[e.key];
    if (!direction || this.phase() !== 'playing') return;
    e.preventDefault();

    if (!this.heldDirections.includes(direction)) this.heldDirections.push(direction);
    this.attemptMove(direction);
    this.ensureMoveRepeatLoop();
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    const direction = KEY_DIRECTIONS[e.key];
    if (!direction) return;
    this.heldDirections = this.heldDirections.filter((d) => d !== direction);
    if (this.heldDirections.length === 0) this.stopMoveRepeatLoop();
  }

  private ensureMoveRepeatLoop() {
    if (this.moveRepeatInterval) return;
    this.moveRepeatInterval = setInterval(() => {
      const current = this.heldDirections[this.heldDirections.length - 1];
      if (current) this.attemptMove(current);
    }, STEP_REPEAT_MS);
  }

  private stopMoveRepeatLoop() {
    clearInterval(this.moveRepeatInterval);
    this.moveRepeatInterval = undefined;
  }

  // Swipe-to-move on touch devices: each individual swipe gesture is exactly
  // one grid step, same as a single arrow-key press - there's no persistent
  // "heading" to hold on touch, since you can't hold a swipe down.
  onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY };
  }

  onTouchEnd(e: TouchEvent) {
    if (!this.touchStart || this.phase() !== 'playing') {
      this.touchStart = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    this.touchStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return;
    const direction: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    this.attemptMove(direction);
  }

  private attemptMove(direction: Direction) {
    if (this.phase() !== 'playing') return;
    const me = this.me();
    const maze = this.maze();
    if (!me || me.finished || !maze) return;

    const now = performance.now();
    if (now - this.lastMoveSentAt < MIN_MOVE_INTERVAL_MS) return;

    if (!canStep(maze.cells, me.row, me.col, direction)) {
      this.audio.playBump();
      return;
    }

    this.lastMoveSentAt = now;
    const { row, col } = stepTo(me.row, me.col, direction);
    this.gameState.predictMyStep(row, col); // instant visual feedback
    this.socketService.move(this.roomId(), direction); // server reconciles distance/percent moments later
  }

  startGame() {
    this.socketService.startGame(
      this.roomId(),
      this.selectedMazeSize(),
      this.selectedDurationSeconds(),
    );
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId());
  }

  playAgain() {
    if (this.playAgainUnlockIn() > 0) return;
    this.fullscreen.enter();
    this.socketService.playAgain(this.roomId());
  }

  leaveRoom() {
    if (this.playAgainUnlockIn() > 0) return;
    this.socketService.disconnect();
    this.gameState.reset();
    this.router.navigate(['/']);
  }

  // --- Canvas rendering -----------------------------------------------

  private draw() {
    const canvas = this.canvasRef?.nativeElement;
    const viewport = this.viewportRef?.nativeElement;
    const maze = this.maze();
    if (!canvas || !viewport || !maze) return;

    const dpr = window.devicePixelRatio || 1;
    const maxWidth = Math.min(viewport.clientWidth, 560);
    const cellSize = Math.max(8, Math.floor(maxWidth / maze.cols));
    const width = cellSize * maze.cols;
    const height = cellSize * maze.rows;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderMaze(ctx, maze, width, height, cellSize);
  }

  private renderMaze(
    ctx: CanvasRenderingContext2D,
    maze: MazeState,
    width: number,
    height: number,
    cellSize: number,
  ) {
    const floor =
      getComputedStyle(document.documentElement).getPropertyValue('--maze-floor').trim() ||
      '#17120c';
    const wallColor =
      getComputedStyle(document.documentElement).getPropertyValue('--wall-color').trim() ||
      '#c77d2e';

    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = wallColor;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, cellSize * 0.12);

    ctx.beginPath();
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const cell = maze.cells[r][c];
        const x0 = c * cellSize;
        const y0 = r * cellSize;
        const x1 = x0 + cellSize;
        const y1 = y0 + cellSize;

        if (cell.N) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y0);
        }
        if (cell.W) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0, y1);
        }
        // Only the last row/column needs its S/E border drawn explicitly -
        // every interior S/E wall is already drawn as the N/W wall of the
        // cell on the other side of it.
        if (cell.S && r === maze.rows - 1) {
          ctx.moveTo(x0, y1);
          ctx.lineTo(x1, y1);
        }
        if (cell.E && c === maze.cols - 1) {
          ctx.moveTo(x1, y0);
          ctx.lineTo(x1, y1);
        }
      }
    }
    ctx.stroke();

    // Cheese at the exit.
    const exitX = maze.exit.c * cellSize + cellSize / 2;
    const exitY = maze.exit.r * cellSize + cellSize / 2;
    ctx.font = `${Math.floor(cellSize * 0.72)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F9C0}', exitX, exitY);

    // My own rat only - opponents run their own identical maze on their own
    // screen, so there's nothing of theirs to draw here.
    const me = this.me();
    if (me) {
      const ratX = me.col * cellSize + cellSize / 2;
      const ratY = me.row * cellSize + cellSize / 2;

      ctx.beginPath();
      ctx.fillStyle = me.color;
      ctx.arc(ratX, ratY, cellSize * 0.42, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `${Math.floor(cellSize * 0.62)}px serif`;
      ctx.fillText('\u{1F42D}', ratX, ratY);
    }
  }
}
