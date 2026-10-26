const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const logger = require('./logger');
const { MAZE_SIZE_OPTIONS, generateMaze, computeDistances } = require('./maze');
const { applyMove, buildRanking } = require('./gameLogic');
const { resolveGameSettings } = require('./gameSettings');
const {
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  findRoomsForSocket,
  recoverPlayerSession,
  clearRoomIntervals,
  resetRoomForNewRound,
  serializePlayers,
  MIN_PLAYERS_TO_START,
} = require('./rooms');

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

// Render's health checker hits this every few seconds - logging it would
// drown out everything else, so it's deliberately excluded below.
app.use((req, res, next) => {
  if (req.path !== '/health') {
    logger.debug({ method: req.method, path: req.path }, 'http request');
  }
  next();
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.use((req, res) => {
  logger.warn({ method: req.method, path: req.path }, 'unhandled http route');
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error(
    { err, method: req.method, path: req.path },
    'express error handler caught an exception',
  );
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// Surfaces low-level transport failures (handshake timeouts, bad origin,
// etc.) that never reach a 'connection' event at all - easy to miss
// otherwise, and a likely place for Render free-tier cold-start symptoms
// to show up.
io.engine.on('connection_error', (err) => {
  logger.warn(
    { code: err.code, message: err.message, context: err.context },
    'socket.io connection error',
  );
});

function endGame(io, room) {
  if (room.gameState === 'finished') return;
  clearRoomIntervals(room);
  room.gameState = 'finished';

  const players = buildRanking(serializePlayers(room));
  logger.info(
    { roomId: room.id, playerCount: players.length, isSolo: room.isSolo },
    'maze run ended',
  );
  io.to(room.id).emit('gameOver', { players, isSolo: room.isSolo });
}

function notifyRoomPlayerLeft(io, room, roomId, leftSocketId) {
  const players = serializePlayers(room);
  logger.info({ roomId, socketId: leftSocketId, remaining: players.length }, 'player left room');
  io.to(roomId).emit('playerLeft', { players });
  if (room.gameState === 'playing' && players.length < MIN_PLAYERS_TO_START) {
    logger.info({ roomId, remaining: players.length }, 'ending run early: too few players remain');
    endGame(io, room);
  }
}

// Every `removePlayer` result - whether the room survives or gets torn down
// entirely - gets a roomId-tagged log line, so filtering logs by a single
// roomId gives a complete, gapless story of that room from creation to
// teardown, with nothing resolvable only by cross-referencing a socketId.
function logAndNotifyRoomDeparture(io, socket, result) {
  if (result.roomDeleted) {
    logger.info({ roomId: result.roomId, socketId: socket.id }, 'room emptied and removed');
    return;
  }
  notifyRoomPlayerLeft(io, result.room, result.roomId, socket.id);
}

// A socket should only ever be a player in one room at a time. Evicting it
// from anything stale before it creates/joins a new one keeps that
// invariant true, instead of just hoping disconnect eventually cleans up
// after it.
function leaveAllRooms(io, socket) {
  for (const result of removePlayer(socket.id)) {
    socket.leave(result.roomId);
    logger.debug(
      { socketId: socket.id, roomId: result.roomId },
      'evicted from stale room before create/join',
    );
    logAndNotifyRoomDeparture(io, socket, result);
  }
}

// A dropped wifi/mobile connection and a deliberate "Leave" click produce the
// same 'disconnect' event, but should NOT be treated the same way: without
// this, a few seconds of bad signal mid-run permanently evicts the player
// (and can even end a 2-player run early) with no way back in, because a
// reconnect gets a brand-new socket id the server has never seen before. For
// a recoverable-looking reason, the seat is held open instead of freed.
const RECONNECT_GRACE_MS = 60_000;
const RECOVERABLE_DISCONNECT_REASONS = new Set([
  'transport close',
  'transport error',
  'ping timeout',
]);

function beginDisconnectGracePeriod(io, socket, reason) {
  if (!RECOVERABLE_DISCONNECT_REASONS.has(reason)) return false;

  const matches = findRoomsForSocket(socket.id);
  if (matches.length !== 1) return false; // not in exactly one room - nothing sane to hold open

  const { roomId, room } = matches[0];
  const player = room.players[socket.id];
  const socketId = socket.id;

  player.pendingRecovery = true;

  logger.info(
    { roomId, socketId, sessionId: player.sessionId },
    'player disconnected, holding seat open for reconnection',
  );
  io.to(roomId).emit('playerConnectionLost', { socketId, name: player.name });

  player.recoveryTimeout = setTimeout(() => {
    logger.info({ roomId, socketId }, 'reconnection grace period expired, removing player');
    for (const result of removePlayer(socketId)) {
      logAndNotifyRoomDeparture(io, { id: socketId }, result);
    }
  }, RECONNECT_GRACE_MS);

  return true;
}

// The server never trusts a client's own move pace - a scripted or modified
// client could otherwise fire moves far faster than any real keypress or
// swipe, racing ahead of what a human could legitimately achieve.
const MIN_MOVE_INTERVAL_MS = 60;

function startGameLoop(io, room, settings) {
  const { cols, rows } = MAZE_SIZE_OPTIONS[settings.mazeSize];
  const cells = generateMaze(cols, rows);
  const exit = { r: rows - 1, c: cols - 1 };
  const distances = computeDistances(cells, cols, rows, exit);
  const startDistance = distances[0][0];

  room.gameState = 'playing';
  room.maze = { cells, cols, rows, exit, distances, startDistance };
  room.mazeSize = settings.mazeSize;
  room.durationSeconds = settings.durationSeconds;
  room.timeLeft = settings.durationSeconds;
  room.startedAt = Date.now();
  room.finishCounter = 0;

  for (const player of Object.values(room.players)) {
    player.row = 0;
    player.col = 0;
    player.distanceToExit = startDistance;
    player.finished = false;
    player.finishOrder = null;
    player.finishTimeMs = null;
    player.lastMoveAt = 0;
  }

  logger.info(
    {
      roomId: room.id,
      mazeSize: room.mazeSize,
      cols,
      rows,
      durationSeconds: room.durationSeconds,
      playerCount: Object.keys(room.players).length,
      isSolo: room.isSolo,
    },
    'maze run started',
  );

  io.to(room.id).emit('gameStarted', {
    cells,
    cols,
    rows,
    exit,
    startDistance,
    timeLeft: room.timeLeft,
    durationSeconds: room.durationSeconds,
    mazeSize: room.mazeSize,
    isSolo: room.isSolo,
    players: serializePlayers(room),
  });

  room.timerInterval = setInterval(() => {
    room.timeLeft -= 1;
    io.to(room.id).emit('timerUpdate', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      endGame(io, room);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'socket connected');

  socket.on('createRoom', ({ name, solo, sessionId }, callback) => {
    leaveAllRooms(io, socket);
    const room = createRoom(socket.id, name || 'Player 1', !!solo, sessionId);
    socket.join(room.id);
    logger.info({ roomId: room.id, socketId: socket.id, isSolo: room.isSolo }, 'room created');
    callback?.({ roomId: room.id, players: serializePlayers(room), isSolo: room.isSolo });
  });

  socket.on('joinRoom', ({ roomId, name, sessionId }, callback) => {
    leaveAllRooms(io, socket);
    const result = joinRoom(roomId, socket.id, name || 'Player 2', sessionId);
    if (result.error) {
      logger.warn({ roomId, socketId: socket.id, reason: result.error }, 'join room rejected');
      callback?.({ error: result.error });
      return;
    }

    socket.join(roomId);
    const players = serializePlayers(result.room);
    logger.info({ roomId, socketId: socket.id, playerCount: players.length }, 'player joined room');
    callback?.({ roomId, players });
    socket.to(roomId).emit('playerJoined', { players });
  });

  // A reconnecting client proactively asks to reclaim its seat (rather than
  // relying solely on Socket.io's own low-level transport recovery) so the
  // app's own grace-period logic - position/progress/host preservation -
  // stays in full, easily-testable control instead of depending on engine
  // internals.
  socket.on('resync', ({ roomId, sessionId }, callback) => {
    const room = getRoom(roomId);
    const recovered = room && recoverPlayerSession(room, sessionId, socket.id);
    if (!recovered) {
      callback?.({ error: 'Session not recoverable' });
      return;
    }

    socket.join(roomId);
    const { oldSocketId } = recovered;
    logger.info(
      { roomId, socketId: socket.id, oldSocketId, sessionId },
      'player session recovered after reconnect',
    );

    io.to(roomId).emit('playerReconnected', {
      previousSocketId: oldSocketId,
      players: serializePlayers(room),
    });

    callback?.({
      gameState: room.gameState,
      players: serializePlayers(room),
      cells: room.maze?.cells,
      cols: room.maze?.cols,
      rows: room.maze?.rows,
      exit: room.maze?.exit,
      startDistance: room.maze?.startDistance,
      timeLeft: room.timeLeft,
      durationSeconds: room.durationSeconds,
      mazeSize: room.mazeSize,
      isSolo: room.isSolo,
    });
  });

  socket.on('startGame', ({ roomId, mazeSize, durationSeconds }) => {
    const room = getRoom(roomId);
    if (!room) {
      logger.warn({ roomId, socketId: socket.id }, 'startGame ignored: room not found');
      return;
    }
    if (socket.id !== room.hostId) {
      logger.warn(
        { roomId, socketId: socket.id, hostId: room.hostId },
        'startGame ignored: not the host',
      );
      return;
    }
    if (room.gameState !== 'waiting') {
      logger.warn(
        { roomId, socketId: socket.id, gameState: room.gameState },
        'startGame ignored: not in waiting state',
      );
      return;
    }
    if (!room.isSolo && Object.keys(room.players).length < MIN_PLAYERS_TO_START) {
      logger.warn({ roomId, socketId: socket.id }, 'startGame ignored: not enough players');
      return;
    }

    startGameLoop(io, room, resolveGameSettings({ mazeSize, durationSeconds }));
  });

  socket.on('playAgain', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;
    if (!room.players[socket.id]) return;
    if (room.gameState !== 'finished') return;

    logger.info({ roomId, socketId: socket.id }, 'room reset for a new round');
    resetRoomForNewRound(room);
    io.to(roomId).emit('roomReset', { players: serializePlayers(room) });
  });

  socket.on('move', ({ roomId, direction }) => {
    const room = getRoom(roomId);
    if (!room || room.gameState !== 'playing' || !room.maze) return;
    const player = room.players[socket.id];
    if (!player || player.finished) return;
    if (!['N', 'E', 'S', 'W'].includes(direction)) return;

    const now = Date.now();
    if (now - player.lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
    player.lastMoveAt = now;

    const result = applyMove(player, room.maze, direction);
    if (!result.moved) return; // blocked by a wall - nothing changed

    socket.emit('moved', {
      row: player.row,
      col: player.col,
      distanceToExit: player.distanceToExit,
    });
    io.to(roomId).emit('progressUpdate', { players: serializePlayers(room) });

    if (result.finished) {
      player.finished = true;
      player.finishOrder = ++room.finishCounter;
      player.finishTimeMs = now - room.startedAt;

      logger.info(
        { roomId, socketId: socket.id, rank: player.finishOrder, timeMs: player.finishTimeMs },
        'player reached the exit',
      );
      io.to(roomId).emit('playerFinished', {
        socketId: socket.id,
        rank: player.finishOrder,
        timeMs: player.finishTimeMs,
        players: serializePlayers(room),
      });

      const stillRunning = Object.values(room.players).some((p) => !p.finished);
      if (!stillRunning) endGame(io, room);
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info({ socketId: socket.id, reason }, 'socket disconnected');
    if (beginDisconnectGracePeriod(io, socket, reason)) return;
    for (const result of removePlayer(socket.id)) {
      logAndNotifyRoomDeparture(io, socket, result);
    }
  });
});

// A crash here would otherwise be an undiagnosable silent restart on Render.
// Logging first means the cause survives even though the process can't
// safely continue past an uncaught exception.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception - exiting');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

server.listen(PORT, () => {
  logger.info({ port: PORT, clientOrigin: CLIENT_ORIGIN }, 'Mazefeed server listening');
});
