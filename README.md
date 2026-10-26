# 🧀 Mazefeed

**A real-time multiplayer maze-racing game built with Angular, Node.js, and Socket.io — supporting up to 10 concurrent players in a single room.**

![Angular](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Pino](https://img.shields.io/badge/Pino-structured%20logging-687634?logo=pino&logoColor=white)

Every player drops into their own copy of the exact same maze. Swipe or use arrow keys / WASD to steer your rat to the cheese before the timer runs out — first one there wins, and a live sidebar shows everyone's progress as it happens.

---

## Gameplay

- **Same maze, separate boards.** The server generates one maze per round and sends an identical copy to every player; each player races it on their own screen, so there's never a shared tile or cell to fight over.
- **Race to the cheese.** First rat to reach the exit wins. Everyone else is ranked by arrival order, and anyone still in the maze when the timer runs out is ranked by how close they got.
- **Live leaderboard.** A progress bar per player updates in real time as everyone moves, so the race feels live even though every board is private.
- **Host-configurable runs.** Maze size (Small 11×11 → Large 19×19) and time limit (60–180s), picked by the host before each round.
- **Swipe or keyboard.** Arrow keys / WASD on desktop, swipe gestures on mobile/tablet — each input is one grid step.
- **Solo mode** for practicing alone, and **Play Again** that regenerates a fresh maze in the same room without re-sharing the room code.
- **2–10 players per room**, joined via a short shareable room code, with automatic host handoff if the host leaves mid-round, and a 60-second reconnection grace window if a player's connection drops.

## Technical highlights

- **Server-authoritative movement.** The client predicts its own step locally for instant visual feedback, but the server is the only one that actually validates a move against the maze's wall data and advances a player's real position — a modified client can't warp through a wall or skip to the exit.
- **Perfect-maze generation.** A randomized recursive-backtracker carve guarantees exactly one path between any two cells — no loops, no isolated pockets — verified by a test that checks every cell is reachable from the exit.
- **One BFS pass powers the whole leaderboard.** A single breadth-first search from the exit, computed once per maze, gives every cell its exact step-distance — that's what turns "who's closest to winning" into a plain number comparison, both for the live progress bars and for ranking whoever doesn't finish in time.
- **Standard competition ranking.** Finishers rank ahead of everyone still running, ordered by arrival; equal standing (e.g. two players tied on distance remaining) shares a rank, the same logic duplicated and tested on both the server (authoritative) and the client (for an instant in-progress leaderboard between server messages).
- **Structured, environment-aware production logging.** Every room, join, departure, host handoff, and move gets a `roomId`-tagged `pino` log line (pretty-printed locally, JSON in production).
- **Signal-based reactive frontend.** Angular 22 signals and `computed()` drive the whole UI — the live leaderboard, rank calculation, canvas redraws — with no manual change-detection wiring.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 22 (standalone components, signals), TypeScript, HTML canvas rendering |
| Backend | Node.js, Express, Socket.io |
| Real-time transport | WebSockets via Socket.io |
| Logging | Pino (structured JSON in production, pretty-printed locally) |
| Styling | Hand-rolled neo-brutalist CSS (no framework) |
| Testing | Vitest (client unit tests via Angular's test runner), Node's built-in test runner (server) |
| Deployment | Vercel (frontend) + Render (backend) |

## Architecture

**Client (Angular)**
- `Home` — create/join a room
- `GameRoom` — waiting room, canvas maze + HUD + live leaderboard, results screen
- `Socket` service — thin socket.io-client wrapper, normalizes server events into app state
- `GameState` service — signal-based single source of truth for the UI
- `utils/maze.ts` / `utils/ranking.ts` — client-side mirrors of the server's wall-check and ranking logic, used for optimistic local prediction and an instantly-updating in-progress leaderboard

**Server (Node + Socket.io)**
- `index.js` — Express + Socket.io wiring, the authoritative game loop, structured logging
- `rooms.js` — room and player lifecycle, host tracking, reconnection grace period
- `maze.js` — maze generation (recursive backtracker), BFS distance map, wall-check/move validation
- `gameSettings.js` — validates host-chosen match settings against allow-lists
- `gameLogic.js` — move application, finish detection, final ranking
- `avatars.js` — per-player color assignment
- `logger.js` — Pino setup, switches transport based on environment

**Event flow:** `createRoom` / `joinRoom` → `startGame` (host picks maze size + duration) → the server generates one maze, sends an identical copy to every player, and starts the round timer → the client predicts each step locally and sends a `move` → the server validates it against the maze's wall data, confirms the authoritative position back to that player, and broadcasts everyone's updated progress to the room → `playerFinished` as each rat reaches the exit → `gameOver` once everyone's finished or the timer runs out, with the final standard-competition ranking.

## Getting started

### Prerequisites

- Node.js 20.19+ (developed and tested on Node 24)
- npm

### Run the backend

```bash
cd server
npm install
npm start          # listens on http://localhost:3000
```

### Run the frontend

```bash
cd client
npm install
npm start           # serves on http://localhost:4200
```

Open `http://localhost:4200` in two or more browser tabs/devices to play against yourself locally — create a room in one tab, join it with the room code in the others.

## Testing

```bash
cd client
npm test            # client unit tests (Vitest, via Angular's test runner)

cd server
npm test            # server unit tests (Node's built-in test runner) - maze generation, move validation, ranking, settings validation
```

## Project structure

```
client/src/app/
├── components/
│   ├── home/              # lobby: create/join/solo
│   └── game-room/         # waiting room, canvas maze + live race, results
├── services/
│   ├── game-state.ts      # signal-based single source of truth
│   ├── socket.ts          # socket.io-client wrapper
│   ├── audio.ts            # synthesized bump/finish/tick sound effects
│   └── fullscreen.ts        # Fullscreen API wrapper, iOS-aware
├── models/
│   └── game.models.ts      # shared types + constants
└── utils/
    ├── maze.ts              # client-side wall-check mirror (optimistic local prediction)
    ├── ranking.ts             # client-side ranking mirror (live leaderboard)
    └── ordinal.ts              # 1st/2nd/3rd formatting

server/src/
├── index.js               # Express + Socket.io wiring, the game loop
├── rooms.js                # room & player lifecycle, reconnection handling
├── maze.js                   # maze generation, BFS distances, move validation
├── gameLogic.js                # move application, finish detection, ranking
├── gameSettings.js                # host-chosen settings, validated
├── avatars.js                       # per-player color assignment
└── logger.js                          # Pino setup
```

## Deployment

**Backend → Render** (deploy this first, you'll need its URL for the frontend):
1. New **Web Service**, root directory `server/`.
2. Build command: `npm install`. Start command: `npm start`.
3. Once deployed, note the Render URL (e.g. `https://mazefeed-server.onrender.com`).

**Frontend → Vercel**:
1. Before building, set `serverUrl` in `client/src/environments/environment.prod.ts` to the Render URL from above.
2. New Vercel project, root directory `client/`. A `vercel.json` is already checked in — it points Vercel at Angular's actual build output (`dist/client/browser`) and adds the SPA rewrite rule client-side routes like `/room/ABCDE` need to survive a page refresh.
3. Deploy, then note the Vercel URL.

**Close the loop:** back on Render, set the `CLIENT_ORIGIN` environment variable to the Vercel URL and redeploy, so CORS is locked to your actual frontend instead of the `*` wildcard default.

## Roadmap

- Proper app icons (PNG favicon, Open Graph preview image) in place of the default Angular favicon
- Match history / best-time tracking per player
- Power-ups (speed boost, reveal-a-wall) along the maze path
