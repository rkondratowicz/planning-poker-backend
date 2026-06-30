import { beforeEach, describe, expect, it } from "vitest";
import type { StateMessage } from "../src/messages.js";
import {
  _testReset,
  buildStateSnapshot,
  castVote,
  createRoom,
  getRoom,
  joinRoom,
  promoteNextHost,
  type Room,
  RoomError,
  removeUser,
  removeUserFromRoom,
  resetVotes,
  revealVotes,
  roomSize,
} from "../src/room.js";

function makeRoom(hostId = "user-1", roomId = "room-a"): Room {
  const room: Room = {
    roomId,
    hostId,
    revealed: false,
    users: new Map(),
    nextSeq: 1,
  };
  return room;
}

function addUser(room: Room, id: string, name = id, seq: number | null = null): void {
  const s = seq ?? room.nextSeq;
  room.users.set(id, { id, name, seq: s, vote: null });
  if (seq === null) {
    room.nextSeq += 1;
  }
}

function setVote(room: Room, id: string, value: string): void {
  const user = room.users.get(id);
  if (!user) throw new Error(`unknown user ${id}`);
  user.vote = value;
}

describe("createRoom / joinRoom / seq", () => {
  beforeEach(() => _testReset());

  it("creates a room with the first user as host and seq 1", () => {
    const room = createRoom("room-a", "user-1", "Alice");
    expect(room.hostId).toBe("user-1");
    expect(room.revealed).toBe(false);
    expect(roomSize(room)).toBe(1);
    expect(room.users.get("user-1")).toEqual({
      id: "user-1",
      name: "Alice",
      seq: 1,
      vote: null,
    });
    expect(room.nextSeq).toBe(2);
    expect(getRoom("room-a")).toBe(room);
  });

  it("joinRoom assigns monotonic seqs at the back of the line", () => {
    const room = createRoom("room-a", "user-1", "Alice");
    joinRoom(room, "user-2", "Bob");
    joinRoom(room, "user-3", "Carol");
    expect(room.users.get("user-1")?.seq).toBe(1);
    expect(room.users.get("user-2")?.seq).toBe(2);
    expect(room.users.get("user-3")?.seq).toBe(3);
    expect(room.nextSeq).toBe(4);
  });

  it("reconnects do not reuse an abandoned seq", () => {
    const room = createRoom("room-a", "user-1", "Alice");
    joinRoom(room, "user-2", "Bob");
    removeUser(room, "user-2");
    joinRoom(room, "user-3", "Bob-again");
    expect(room.users.get("user-3")?.seq).toBe(3);
  });
});

describe("buildStateSnapshot", () => {
  it("returns users ordered by seq with hasVoted flags", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    addUser(room, "user-2", "Bob");
    addUser(room, "user-3", "Carol");
    setVote(room, "user-2", "5");
    setVote(room, "user-3", "8");

    const snap = buildStateSnapshot(room);
    expect(snap.type).toBe("state");
    expect(snap.hostId).toBe("user-1");
    expect(snap.revealed).toBe(false);
    expect(snap.users).toEqual([
      { id: "user-1", name: "Alice", hasVoted: false },
      { id: "user-2", name: "Bob", hasVoted: true },
      { id: "user-3", name: "Carol", hasVoted: true },
    ]);
  });

  it("redacts votes (null) while revealed === false — no early leak", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    setVote(room, "user-1", "5");
    const snap = buildStateSnapshot(room);
    expect(snap.revealed).toBe(false);
    expect(snap.votes).toBeNull();
  });

  it("emits the votes map verbatim once revealed", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    addUser(room, "user-2", "Bob");
    setVote(room, "user-1", "5");
    setVote(room, "user-2", "☕");
    room.revealed = true;

    const snap = buildStateSnapshot(room);
    expect(snap.revealed).toBe(true);
    expect(snap.votes).toEqual({ "user-1": "5", "user-2": "☕" });
  });

  it("revealed with zero votes yields an empty object, not null", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    room.revealed = true;
    const snap = buildStateSnapshot(room);
    expect(snap.revealed).toBe(true);
    expect(snap.votes).toEqual({});
  });

  it("a user without a vote is omitted from the revealed votes map", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    addUser(room, "user-2", "Bob");
    setVote(room, "user-1", "5");
    room.revealed = true;
    const snap = buildStateSnapshot(room);
    expect(snap.votes).toEqual({ "user-1": "5" });
    expect(snap.users[1]).toEqual({ id: "user-2", name: "Bob", hasVoted: false });
  });

  it("returns a fresh object every call (no caching/aliasing)", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    const a = buildStateSnapshot(room) as StateMessage & { users: unknown[] };
    const b = buildStateSnapshot(room) as StateMessage & { users: unknown[] };
    expect(a).not.toBe(b);
    expect(a.users).not.toBe(b.users);
  });
});

describe("promoteNextHost", () => {
  it("promotes the remaining user with the smallest seq", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice", 1);
    addUser(room, "user-2", "Bob", 3);
    addUser(room, "user-3", "Carol", 2);
    removeUser(room, "user-1");
    expect(promoteNextHost(room)).toBe("user-3");
    expect(room.hostId).toBe("user-3");
  });

  it("returns null when the room is empty (no one to promote)", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice", 1);
    removeUser(room, "user-1");
    expect(promoteNextHost(room)).toBeNull();
  });

  it("is a no-op on the hostId when the smallest-seq user is already host", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice", 1);
    addUser(room, "user-2", "Bob", 2);
    expect(promoteNextHost(room)).toBe("user-1");
    expect(room.hostId).toBe("user-1");
  });

  it("breaks no ties — seqs are unique per room", () => {
    const room = makeRoom("user-1");
    for (let i = 1; i <= 5; i++) addUser(room, `user-${i}`, `n${i}`, i);
    removeUser(room, "user-1");
    expect(promoteNextHost(room)).toBe("user-2");
  });
});

describe("removeUser / removeUserFromRoom cleanup", () => {
  beforeEach(() => _testReset());

  it("is idempotent — removing an absent user is a no-op", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice");
    expect(removeUser(room, "user-999")).toEqual({
      removed: false,
      discarded: false,
      promoted: null,
    });
    expect(roomSize(room)).toBe(1);
  });

  it("removes a non-host without promoting", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice", 1);
    addUser(room, "user-2", "Bob", 2);
    const result = removeUser(room, "user-2");
    expect(result).toEqual({ removed: true, discarded: false, promoted: null });
    expect(room.hostId).toBe("user-1");
    expect(room.users.has("user-2")).toBe(false);
  });

  it("discards their vote on leave (no auto-reveal)", () => {
    const room = makeRoom("user-1");
    addUser(room, "user-1", "Alice", 1);
    addUser(room, "user-2", "Bob", 2);
    setVote(room, "user-2", "5");
    removeUser(room, "user-2");
    expect(room.users.has("user-2")).toBe(false);
    expect(room.revealed).toBe(false);
  });

  it("discards the room immediately when the last user leaves", () => {
    createRoom("room-a", "user-1", "Alice");
    const result = removeUserFromRoom("room-a", "user-1");
    expect(result).toEqual({ removed: true, discarded: true, promoted: null });
    expect(getRoom("room-a")).toBeUndefined();
  });

  it("promotes the smallest-seq user when the host leaves", () => {
    createRoom("room-a", "user-1", "Alice");
    const room = getRoom("room-a");
    if (!room) throw new Error("room missing");
    joinRoom(room, "user-2", "Bob");
    joinRoom(room, "user-3", "Carol");
    const result = removeUserFromRoom("room-a", "user-1");
    expect(result).toEqual({ removed: true, discarded: false, promoted: "user-2" });
    expect(room.hostId).toBe("user-2");
  });

  it("removeUserFromRoom is a no-op when the room is already gone", () => {
    expect(removeUserFromRoom("missing", "user-1")).toEqual({
      removed: false,
      discarded: false,
      promoted: null,
    });
  });
});

describe("voting state machine", () => {
  describe("castVote", () => {
    it("sets the user's vote pre-reveal", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      castVote(room, "user-1", "5");
      expect(room.users.get("user-1")?.vote).toBe("5");
    });

    it("overwrites a previous vote before reveal (re-vote)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      castVote(room, "user-1", "5");
      castVote(room, "user-1", "8");
      expect(room.users.get("user-1")?.vote).toBe("8");
    });

    it("stores the value verbatim (no trim, unicode ok)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      castVote(room, "user-1", "  ☕ ");
      expect(room.users.get("user-1")?.vote).toBe("  ☕ ");
    });

    it("is rejected with Voting is locked until reset once revealed", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      room.revealed = true;
      expect(() => castVote(room, "user-1", "5")).toThrow(RoomError);
      expect(() => castVote(room, "user-1", "5")).toThrow("Voting is locked until reset");
      expect(room.users.get("user-1")?.vote).toBeNull();
    });
  });

  describe("revealVotes", () => {
    it("host sets revealed = true", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      revealVotes(room, "user-1");
      expect(room.revealed).toBe(true);
    });

    it("allows revealing with zero votes", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      expect(() => revealVotes(room, "user-1")).not.toThrow();
      expect(room.revealed).toBe(true);
      expect(buildStateSnapshot(room).votes).toEqual({});
    });

    it("non-host reveal is rejected with Only the host can reveal votes", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice", 1);
      addUser(room, "user-2", "Bob", 2);
      expect(() => revealVotes(room, "user-2")).toThrow(RoomError);
      expect(() => revealVotes(room, "user-2")).toThrow("Only the host can reveal votes");
      expect(room.revealed).toBe(false);
    });

    it("idempotent reveal when already revealed is rejected (not a silent no-op)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      revealVotes(room, "user-1");
      expect(() => revealVotes(room, "user-1")).toThrow("Votes are already revealed");
    });
  });

  describe("resetVotes", () => {
    it("host clears all votes and sets revealed = false", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      addUser(room, "user-2", "Bob");
      castVote(room, "user-1", "5");
      castVote(room, "user-2", "8");
      room.revealed = true;

      resetVotes(room, "user-1");
      expect(room.revealed).toBe(false);
      expect(room.users.get("user-1")?.vote).toBeNull();
      expect(room.users.get("user-2")?.vote).toBeNull();
    });

    it("non-host reset is rejected with Only the host can reset votes", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice", 1);
      addUser(room, "user-2", "Bob", 2);
      castVote(room, "user-1", "5");
      expect(() => resetVotes(room, "user-2")).toThrow(RoomError);
      expect(() => resetVotes(room, "user-2")).toThrow("Only the host can reset votes");
      expect(room.users.get("user-1")?.vote).toBe("5");
    });

    it("reset when already unrevealed with no votes is rejected (not a no-op)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      expect(() => resetVotes(room, "user-1")).toThrow("Votes are already reset");
    });

    it("reset proceeds even when unrevealed if there are votes", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      castVote(room, "user-1", "5");
      expect(() => resetVotes(room, "user-1")).not.toThrow();
      expect(room.users.get("user-1")?.vote).toBeNull();
      expect(room.revealed).toBe(false);
    });

    it("reset proceeds when revealed with zero votes (clears revealed flag)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice");
      revealVotes(room, "user-1");
      expect(() => resetVotes(room, "user-1")).not.toThrow();
      expect(room.revealed).toBe(false);
    });

    it("auth check beats the idempotent-state check (non-host on already-reset still gets auth error)", () => {
      const room = makeRoom("user-1");
      addUser(room, "user-1", "Alice", 1);
      addUser(room, "user-2", "Bob", 2);
      expect(() => resetVotes(room, "user-2")).toThrow("Only the host can reset votes");
    });
  });
});
