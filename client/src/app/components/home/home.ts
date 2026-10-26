import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import { Fullscreen } from '../../services/fullscreen';

type Mode = 'menu' | 'create' | 'join';

@Component({
  imports: [FormsModule],
  selector: 'app-home',
  styleUrl: './home.css',
  templateUrl: './home.html',
})
export class Home {
  private readonly socketService = inject(Socket);
  private readonly gameState = inject(GameState);
  private readonly router = inject(Router);
  private readonly fullscreen = inject(Fullscreen);

  readonly mode = signal<Mode>('menu');
  readonly name = signal('');
  readonly joinRoomId = signal('');
  // Seeded from a failed reconnect-resync (e.g. "your run ended while you
  // were disconnected") - a one-shot message, cleared immediately so it
  // doesn't linger across unrelated visits to this screen.
  readonly error = signal<string | null>(this.gameState.errorMessage());
  readonly busy = signal(false);

  constructor() {
    this.gameState.errorMessage.set(null);
  }

  showCreate() {
    this.error.set(null);
    this.mode.set('create');
  }

  showJoin() {
    this.error.set(null);
    this.mode.set('join');
  }

  backToMenu() {
    this.error.set(null);
    this.mode.set('menu');
  }

  async createRoom() {
    // The username field is styled uppercase while typing (.brutal-input); without
    // this, the actual stored name keeps its typed case and looks inconsistent
    // everywhere it's rendered without that CSS, e.g. the waiting room list.
    const name = this.name().trim().toUpperCase();
    if (!name) {
      this.error.set('Enter a username first.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const res = await this.socketService.createRoom(name);
    this.busy.set(false);

    if (res.error) {
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.gameState.phase.set('waiting');
    this.fullscreen.enter();
    this.router.navigate(['/room', res.roomId]);
  }

  async joinRoom() {
    const name = this.name().trim().toUpperCase();
    const roomId = this.joinRoomId().trim().toUpperCase();
    if (!name) {
      this.error.set('Enter a username first.');
      return;
    }
    if (!roomId) {
      this.error.set('Enter a room ID.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const res = await this.socketService.joinRoom(roomId, name);
    this.busy.set(false);

    if (res.error) {
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.gameState.phase.set('waiting');
    this.fullscreen.enter();
    this.router.navigate(['/room', res.roomId]);
  }

  async playSolo() {
    this.busy.set(true);
    this.error.set(null);
    const name = this.name().trim().toUpperCase() || 'PLAYER 1';
    const res = await this.socketService.createRoom(name, true);

    if (res.error) {
      this.busy.set(false);
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.gameState.isSolo.set(true);
    this.gameState.phase.set('waiting');
    this.busy.set(false);
    this.fullscreen.enter();
    this.router.navigate(['/room', res.roomId]);
  }
}
