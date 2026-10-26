import { Routes } from '@angular/router';
import { Home } from './components/home/home';
import { GameRoom } from './components/game-room/game-room';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'room/:roomId', component: GameRoom },
  { path: '**', redirectTo: '' },
];
