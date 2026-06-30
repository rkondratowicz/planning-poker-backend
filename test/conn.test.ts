import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  _testResetConnections,
  closeConnection,
  createRateLimiter,
  dispatchMessage,
  openConnection,
  processMessage,
  roomAtCapacity,
} from "../src/conn.js";
import type { StateMessage } from "../src/messages.js";
import { _testReset, getRoom, type Room } from "../src/room.js";

const silentLogger = pino({ level: "silent" });

function makeWs() {
  const sent: string[] = [];
  return {
    sent,
    send: (data: string) => {
      sent.push(data);
    },
  };
}

function lastSent(ws: { sent: string[] }): StateMessage {
  const last = ws.sent[ws.sent.length - 1];
  if (last === undefined) throw new Error("no message sent");
  return JSON.parse(last) as StateMessage;
}

function lastParsed(ws: { sent: string[] }): { type: string; message?: string } {
  const last = ws.sent[ws.sent.length - 1];
  if (last === undefined) throw new Error("no message sent");
  return JSON.parse(last) as { type: string; message?: string };
}

function makeConfig() {
  return {
    port: 3000,
    logLevel: "silent",
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000,
    maxPayloadBytes: 4096,
    maxRoomIdLength: 128,
    maxNameLength: 32,
    maxVoteLength: 64,
    shutdownGraceMs: 20000,
    maxRoomUsers: 50,
    messageRateWindowMs: 1000,
    messageRateBurst: 3,
  };
}

describe("createRateLimiter", () => {
  it("allows up to `burst` messages within the window", () => {
    const limiter = createRateLimiter(1000, 3);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(100)).toBe(true);
    expect(limiter.allow(500)).toBe(true);
    expect(limiter.allow(600)).toBe(false);
  });

  it("refills the bucket after the window elapses", () => {
    const limiter = createRateLimiter(1000, 3);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(10)).toBe(true);
    expect(limiter.allow(20)).toBe(true);
    expect(limiter.allow(1001)).toBe(true);
    expect(limiter.allow(1002)).toBe(true);
  });

  it("treats the first message as the start of a window", () => {
    const limiter = createRateLimiter(1000, 2);
    expect(limiter.allow(10_000)).toBe(true);
    expect(limiter.allow(10_500)).toBe(true);
    expect(limiter.allow(10_900)).toBe(false);
    expect(limiter.allow(11_001)).toBe(true);
  });
});

describe("roomAtCapacity", () => {
  it("returns false for a room that does not exist yet", () => {
    _testReset();
    _testResetConnections();
    expect(roomAtCapacity("new-room", 50)).toBe(false);
  });

  it("returns false while the room is below the cap", () => {
    _testReset();
    _testResetConnections();
    openConnection({
      roomId: "room-a",
      name: "Alice",
      ws: makeWs(),
      config: makeConfig(),
      logger: silentLogger,
    });
    expect(roomAtCapacity("room-a", 2)).toBe(false);
  });

  it("returns true once the room reaches the cap", () => {
    _testReset();
    _testResetConnections();
    openConnection({
      roomId: "room-b",
      name: "Alice",
      ws: makeWs(),
      config: makeConfig(),
      logger: silentLogger,
    });
    openConnection({
      roomId: "room-b",
      name: "Bob",
      ws: makeWs(),
      config: makeConfig(),
      logger: silentLogger,
    });
    expect(roomAtCapacity("room-b", 2)).toBe(true);
  });
});

describe("dispatchMessage", () => {
  function makeRoomWithHost(roomId = "room-a", hostId = "user-1"): Room {
    const room: Room = {
      roomId,
      hostId,
      revealed: false,
      users: new Map(),
      nextSeq: 1,
    };
    room.users.set(hostId, { id: hostId, name: "Alice", seq: 1, vote: null });
    room.nextSeq = 2;
    return room;
  }

  it("vote mutates the room and broadcasts the resulting state", () => {
    const room = makeRoomWithHost();
    const broadcast = vi.fn<(r: Room) => void>();
    dispatchMessage({ type: "vote", value: "5" }, { room, userId: "user-1", broadcast });
    expect(room.users.get("user-1")?.vote).toBe("5");
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(room);
  });

  it("reveal by host sets revealed and broadcasts", () => {
    const room = makeRoomWithHost();
    const broadcast = vi.fn<(r: Room) => void>();
    dispatchMessage({ type: "reveal" }, { room, userId: "user-1", broadcast });
    expect(room.revealed).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("reveal by non-host throws RoomError and does NOT broadcast", () => {
    const room = makeRoomWithHost();
    room.users.set("user-2", { id: "user-2", name: "Bob", seq: 2, vote: null });
    const broadcast = vi.fn<(r: Room) => void>();
    expect(() =>
      dispatchMessage({ type: "reveal" }, { room, userId: "user-2", broadcast }),
    ).toThrow("Only the host can reveal votes");
    expect(room.revealed).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("vote while revealed throws and does not broadcast", () => {
    const room = makeRoomWithHost();
    room.revealed = true;
    const broadcast = vi.fn<(r: Room) => void>();
    expect(() =>
      dispatchMessage({ type: "vote", value: "5" }, { room, userId: "user-1", broadcast }),
    ).toThrow("Voting is locked until reset");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("reset by host clears votes and broadcasts", () => {
    const room = makeRoomWithHost();
    const host = room.users.get("user-1");
    if (host === undefined) throw new Error("host missing");
    host.vote = "5";
    room.revealed = true;
    const broadcast = vi.fn<(r: Room) => void>();
    dispatchMessage({ type: "reset" }, { room, userId: "user-1", broadcast });
    expect(room.revealed).toBe(false);
    expect(room.users.get("user-1")?.vote).toBeNull();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("reset by non-host throws and does not broadcast", () => {
    const room = makeRoomWithHost();
    room.users.set("user-2", { id: "user-2", name: "Bob", seq: 2, vote: null });
    const broadcast = vi.fn<(r: Room) => void>();
    expect(() => dispatchMessage({ type: "reset" }, { room, userId: "user-2", broadcast })).toThrow(
      "Only the host can reset votes",
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe("openConnection", () => {
  it("sends welcome then state to the joiner and creates the room", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-x",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    expect(getRoom("room-x")).toBeDefined();
    expect(conn.room.hostId).toBe(conn.userId);

    const messages = ws.sent.map((s) => JSON.parse(s));
    expect(messages[0]).toEqual({ type: "welcome", userId: conn.userId });
    expect(messages[1]?.type).toBe("state");
    expect((messages[1] as StateMessage).users).toHaveLength(1);
  });

  it("second joiner becomes non-host and both receive state", () => {
    _testReset();
    _testResetConnections();
    const ws1 = makeWs();
    const ws2 = makeWs();
    const conn1 = openConnection({
      roomId: "room-y",
      name: "Alice",
      ws: ws1,
      config: makeConfig(),
      logger: silentLogger,
    });
    const conn2 = openConnection({
      roomId: "room-y",
      name: "Bob",
      ws: ws2,
      config: makeConfig(),
      logger: silentLogger,
    });
    expect(conn1.userId).not.toBe(conn2.userId);
    expect(conn2.room.hostId).toBe(conn1.userId);

    const state2 = lastSent(ws2);
    expect(state2.users).toHaveLength(2);
    expect(state2.hostId).toBe(conn1.userId);

    // host also received the roster-change broadcast
    const state1 = lastSent(ws1);
    expect(state1.users).toHaveLength(2);
  });
});

describe("processMessage", () => {
  it("broadcasts state for a valid vote", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-v",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    ws.sent.length = 0;
    processMessage(conn, JSON.stringify({ type: "vote", value: "5" }), silentLogger);
    expect(conn.room.users.get(conn.userId)?.vote).toBe("5");
    // the last message broadcast to the joiner is state
    const last = lastSent(ws);
    expect(last.type).toBe("state");
    expect(last.users[0]?.hasVoted).toBe(true);
    expect(last.votes).toBeNull();
  });

  it("sends an error for a malformed message and keeps the socket open (no state change)", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-m",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    ws.sent.length = 0;
    processMessage(conn, "not json", silentLogger);
    const last = lastParsed(ws);
    expect(last).toEqual({ type: "error", message: "Malformed message" });
  });

  it("sends an error for a rule violation and does not broadcast state", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-r",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    conn.room.revealed = true;
    ws.sent.length = 0;
    processMessage(conn, JSON.stringify({ type: "vote", value: "5" }), silentLogger);
    const last = lastParsed(ws);
    expect(last).toEqual({ type: "error", message: "Voting is locked until reset" });
  });

  it("rejects messages past the rate limit with Rate limit exceeded", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-rl",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    ws.sent.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 5; i++) {
      processMessage(conn, JSON.stringify({ type: "vote", value: "5" }), silentLogger);
    }
    vi.useRealTimers();

    const errors = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "error") as {
      type: string;
      message: string;
    }[];
    expect(errors.some((e) => e.message === "Rate limit exceeded")).toBe(true);
    // only `burst` (3) votes actually landed on the room
    expect(conn.room.users.get(conn.userId)?.vote).toBe("5");
  });
});

describe("closeConnection", () => {
  it("is idempotent — calling twice cleans up once", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-c",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    const userId = conn.userId;
    closeConnection(conn, silentLogger);
    closeConnection(conn, silentLogger);
    expect(conn.closed).toBe(true);
    // room discarded when empty
    expect(getRoom("room-c")).toBeUndefined();
    void userId;
  });

  it("promotes the next host and broadcasts to remaining users", () => {
    _testReset();
    _testResetConnections();
    const ws1 = makeWs();
    const ws2 = makeWs();
    const host = openConnection({
      roomId: "room-h",
      name: "Alice",
      ws: ws1,
      config: makeConfig(),
      logger: silentLogger,
    });
    const bob = openConnection({
      roomId: "room-h",
      name: "Bob",
      ws: ws2,
      config: makeConfig(),
      logger: silentLogger,
    });
    ws1.sent.length = 0;
    ws2.sent.length = 0;
    closeConnection(host, silentLogger);

    expect(getRoom("room-h")?.hostId).toBe(bob.userId);
    const bobState = lastSent(ws2);
    expect(bobState.hostId).toBe(bob.userId);
    expect(bobState.users).toHaveLength(1);
    // the disconnecting host does not receive a final broadcast
    expect(ws1.sent).toHaveLength(0);
  });

  it("discards the room immediately when the last user leaves", () => {
    _testReset();
    _testResetConnections();
    const ws = makeWs();
    const conn = openConnection({
      roomId: "room-d",
      name: "Alice",
      ws,
      config: makeConfig(),
      logger: silentLogger,
    });
    closeConnection(conn, silentLogger);
    expect(getRoom("room-d")).toBeUndefined();
  });
});
