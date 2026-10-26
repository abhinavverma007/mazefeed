const { pickColor } = require('./avatars');

const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const MAX_PLAYERS = 10;
const MIN_PLAYERS_TO_START = 2;

const rooms = {};

function generateRoomId() {
  let id;
  do {
    id = Array.from(
      { length: 5 },
      () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)],
    ).join('');
  } while (rooms[id]);
  return id;
}

// `sessionId` is a client-generated id that survives a reconnect even though
// `socketId` doesn't - it's how a dropped player reclaims their seat (maze
// position, progress, host status) instead of a network blip silently
// ending their run. `color` is picked by the caller (createRoom/joinRoom) so
// it can be checked against everyone else already in the room - no two
// players in the same room ever get the same color.
function newPlayer(name, sessionId, color) {
  return {
    name,
    color,
    row: 0,
    col: 0,
    distanceToExit: 0,
    finished: false,
    finishOrder: null,
    finishTimeMs: null,
    lastMoveAt: 0,
    sessionId,
    pendingRecovery: false,
    recoveryTimeout: null,
  };
}

function createRoom(hostSocketId, hostName, isSolo = false, sessionId) {
  const roomId = generateRoomId();
  rooms[roomId] = {
    id: roomId,
    hostId: hostSocketId,
    isSolo: !!isSolo,
    players: {
      [hostSocketId]: newPlayer(hostName, sessionId, pickColor()),
    },
    gameState: 'waiting', // waiting | playing | finished
    maze: null,
    mazeSize: null,
    durationSeconds: 90,
    timeLeft: 90,
    timerInterval: null,
    startedAt: 0,
    finishCounter: 0,
  };
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId];
}

function joinRoom(roomId, socketId, name, sessionId) {
  const room = rooms[roomId];
  if (!room) return { error: 'Room not found' };
  if (room.isSolo) return { error: 'Room not found' };
  if (room.gameState !== 'waiting') return { error: 'Game already in progress' };
  if (Object.keys(room.players).length >= MAX_PLAYERS) return { error: 'Room is full' };

  const usedColors = Object.values(room.players).map((p) => p.color);
  room.players[socketId] = newPlayer(name, sessionId, pickColor(usedColors));
  return { room };
}

// Every room this socket currently has a player entry in - normally exactly
// one. Used instead of trusting a single cached roomId so a stray
// double-membership is never silently missed.
function findRoomsForSocket(socketId) {
  return Object.keys(rooms)
    .map((roomId) => ({ roomId, room: rooms[roomId] }))
    .filter(({ room }) => !!room.players[socketId]);
}

// Reclaims a seat held open for reconnection: finds the stale player entry
// (still keyed by their old, now-dead socket id) by sessionId, re-keys it to
// the new connection, and cancels the pending removal. Maze position,
// progress, and host status all survive the gap untouched.
function recoverPlayerSession(room, sessionId, newSocketId) {
  const oldSocketId = Object.keys(room.players).find(
    (id) => room.players[id].sessionId === sessionId && room.players[id].pendingRecovery,
  );
  if (!oldSocketId) return null;

  const player = room.players[oldSocketId];
  clearTimeout(player.recoveryTimeout);
  player.recoveryTimeout = null;
  player.pendingRecovery = false;

  delete room.players[oldSocketId];
  room.players[newSocketId] = player;
  if (room.hostId === oldSocketId) room.hostId = newSocketId;

  return { player, oldSocketId };
}

// A socket should only ever be a player in one room, but this scans and
// cleans up *every* room it's found in (not just the first) so a stray
// double-membership can never leak a room - and its running timer - forever.
function removePlayer(socketId) {
  const affected = [];

  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (!room.players[socketId]) continue;

    if (room.players[socketId].recoveryTimeout)
      clearTimeout(room.players[socketId].recoveryTimeout);
    delete room.players[socketId];

    if (Object.keys(room.players).length === 0) {
      clearRoomIntervals(room);
      delete rooms[roomId];
      affected.push({ roomId, roomDeleted: true });
      continue;
    }

    if (room.hostId === socketId) {
      room.hostId = Object.keys(room.players)[0];
    }
    affected.push({ roomId, roomDeleted: false, room });
  }

  return affected;
}

// "Play Again" reuses the same room instead of tearing it down: everyone's
// maze progress resets and the room goes back to 'waiting' so the host can
// tweak settings and start a fresh maze, without players having to re-share
// the room code.
function resetRoomForNewRound(room) {
  clearRoomIntervals(room);
  room.maze = null;
  for (const player of Object.values(room.players)) {
    player.row = 0;
    player.col = 0;
    player.distanceToExit = 0;
    player.finished = false;
    player.finishOrder = null;
    player.finishTimeMs = null;
    player.lastMoveAt = 0;
  }
  room.gameState = 'waiting';
}

function clearRoomIntervals(room) {
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = null;
}

function percentFor(room, player) {
  const start = room.maze?.startDistance ?? 0;
  if (start <= 0) return player.finished ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - player.distanceToExit / start))));
}

function serializePlayers(room) {
  return Object.entries(room.players).map(([socketId, p]) => ({
    socketId,
    name: p.name,
    color: p.color,
    isHost: socketId === room.hostId,
    row: p.row,
    col: p.col,
    distanceToExit: p.distanceToExit,
    percent: percentFor(room, p),
    finished: p.finished,
    finishOrder: p.finishOrder,
    finishTimeMs: p.finishTimeMs,
  }));
}

module.exports = {
  rooms,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  findRoomsForSocket,
  recoverPlayerSession,
  clearRoomIntervals,
  resetRoomForNewRound,
  serializePlayers,
};
