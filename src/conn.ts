import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import { errors } from "./errors.js";
import type { ClientToServer, ServerToClient } from "./messages.js";
import { parseClientMessage } from "./messages.js";
import {
  buildStateSnapshot,
  type CleanupResult,
  castVote,
  createRoom,
  getRoom,
  joinRoom,
  type Room,
  RoomError,
  removeUserFromRoom,
  resetVotes,
  revealVotes,
  roomSize,
} from "./room.js";

export type WsLike = { send: (data: string) => void };

export type Sender = (msg: ServerToClient) => void;

export type Connection = {
  roomId: string;
  userId: string;
  room: Room;
  rateLimiter: RateLimiter;
  closed: boolean;
  maxVoteLength: number;
  logger: Logger;
};

export type RateLimiter = {
  allow(now: number): boolean;
};

const connections = new Map<string, Map<string, Sender>>();
const roomLoggers = new Map<string, Logger>();

export function _testResetConnections(): void {
  connections.clear();
  roomLoggers.clear();
}

export function createRateLimiter(windowMs: number, burst: number): RateLimiter {
  let count = 0;
  let windowStart = 0;
  return {
    allow(now) {
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= burst;
    },
  };
}

export function roomAtCapacity(roomId: string, max: number): boolean {
  const room = getRoom(roomId);
  if (room === undefined) return false;
  return roomSize(room) >= max;
}

function registerSender(roomId: string, userId: string, sender: Sender): void {
  let room = connections.get(roomId);
  if (room === undefined) {
    room = new Map();
    connections.set(roomId, room);
  }
  room.set(userId, sender);
}

function unregisterSender(roomId: string, userId: string): boolean {
  const room = connections.get(roomId);
  if (room === undefined) return false;
  const removed = room.delete(userId);
  if (room.size === 0) connections.delete(roomId);
  return removed;
}

function broadcastState(room: Room): void {
  const snap = buildStateSnapshot(room);
  const conns = connections.get(room.roomId);
  if (conns === undefined) return;
  for (const sender of conns.values()) {
    try {
      sender(snap);
    } catch {
      // D11.3: per-socket send failures are swallowed; onClose is authoritative.
    }
  }
}

function send(conn: Connection, msg: ServerToClient): void {
  const conns = connections.get(conn.roomId);
  const sender = conns?.get(conn.userId);
  if (sender === undefined) return;
  try {
    sender(msg);
  } catch {
    // Swallowed; onClose will clean up.
  }
}

export type DispatchDeps = {
  room: Room;
  userId: string;
  broadcast: (room: Room) => void;
};

export function dispatchMessage(msg: ClientToServer, deps: DispatchDeps): void {
  switch (msg.type) {
    case "vote":
      castVote(deps.room, deps.userId, msg.value);
      break;
    case "reveal":
      revealVotes(deps.room, deps.userId);
      break;
    case "reset":
      resetVotes(deps.room, deps.userId);
      break;
  }
  deps.broadcast(deps.room);
}

export function openConnection(opts: {
  roomId: string;
  name: string;
  ws: WsLike;
  config: Config;
  logger: Logger;
}): Connection {
  const { roomId, name, config, logger, ws } = opts;
  const userId = `user-${randomUUID()}`;
  const existing = getRoom(roomId);
  let room: Room;
  let roomLogger = roomLoggers.get(roomId);
  if (existing === undefined) {
    room = createRoom(roomId, userId, name);
    roomLogger = logger.child({ roomId });
    roomLoggers.set(roomId, roomLogger);
    roomLogger.info({ userId }, "room created");
  } else {
    room = existing;
    if (roomLogger === undefined) {
      roomLogger = logger.child({ roomId });
      roomLoggers.set(roomId, roomLogger);
    }
    joinRoom(room, userId, name);
  }

  const conn: Connection = {
    roomId,
    userId,
    room,
    closed: false,
    rateLimiter: createRateLimiter(config.messageRateWindowMs, config.messageRateBurst),
    maxVoteLength: config.maxVoteLength,
    logger: roomLogger,
  };
  registerSender(roomId, userId, (msg) => {
    ws.send(JSON.stringify(msg));
  });

  // D6.3: welcome to the joiner first, then state broadcast to all (incl. joiner).
  send(conn, { type: "welcome", userId });
  roomLogger.info({ userId, name }, "user joined");
  broadcastState(room);
  return conn;
}

export function processMessage(conn: Connection, raw: string): void {
  if (conn.closed) return;
  if (!conn.rateLimiter.allow(Date.now())) {
    send(conn, { type: "error", message: errors.rateLimitExceeded });
    conn.logger.warn({ userId: conn.userId }, "rate limit exceeded");
    return;
  }

  const parsed = parseClientMessage(raw, conn.maxVoteLength);
  if (!parsed.ok) {
    send(conn, { type: "error", message: parsed.error });
    conn.logger.warn(
      { userId: conn.userId, error: parsed.error, detail: parsed.detail },
      "inbound message rejected",
    );
    return;
  }

  try {
    dispatchMessage(parsed.message, {
      room: conn.room,
      userId: conn.userId,
      broadcast: broadcastState,
    });
  } catch (e) {
    if (e instanceof RoomError) {
      send(conn, { type: "error", message: e.code });
      conn.logger.warn({ userId: conn.userId, error: e.code }, "rule violation");
      return;
    }
    throw e;
  }
}

export function closeConnection(conn: Connection): CleanupResult {
  if (conn.closed) {
    return { removed: false, discarded: false, promoted: null };
  }
  conn.closed = true;

  const removed = unregisterSender(conn.roomId, conn.userId);
  if (!removed) {
    return { removed: false, discarded: false, promoted: null };
  }

  const result = removeUserFromRoom(conn.roomId, conn.userId);
  conn.logger.info({ userId: conn.userId }, "user left");
  if (result.discarded) {
    conn.logger.info("room discarded");
    roomLoggers.delete(conn.roomId);
    return result;
  }
  if (result.promoted !== null) {
    conn.logger.info({ hostId: result.promoted }, "host promoted");
  }
  const room = getRoom(conn.roomId);
  if (room !== undefined) {
    broadcastState(room);
  }
  return result;
}

export function sendToClient(conn: Connection, msg: ServerToClient): void {
  send(conn, msg);
}
