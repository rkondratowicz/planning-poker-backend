import type { ErrorMessage } from "./errors.js";
import { errors } from "./errors.js";
import type { StateMessage, StateUser } from "./messages.js";

export type User = {
  id: string;
  name: string;
  seq: number;
  vote: string | null;
};

export type Room = {
  roomId: string;
  hostId: string;
  revealed: boolean;
  users: Map<string, User>;
  nextSeq: number;
};

export type CleanupResult = {
  removed: boolean;
  discarded: boolean;
  promoted: string | null;
};

export class RoomError extends Error {
  readonly code: ErrorMessage;
  constructor(code: ErrorMessage) {
    super(code);
    this.name = "RoomError";
    this.code = code;
  }
}

const rooms = new Map<string, Room>();

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function roomSize(room: Room): number {
  return room.users.size;
}

export function createRoom(roomId: string, userId: string, name: string): Room {
  const room: Room = {
    roomId,
    hostId: userId,
    revealed: false,
    users: new Map(),
    nextSeq: 2,
  };
  room.users.set(userId, { id: userId, name, seq: 1, vote: null });
  rooms.set(roomId, room);
  return room;
}

export function joinRoom(room: Room, userId: string, name: string): void {
  room.users.set(userId, { id: userId, name, seq: room.nextSeq, vote: null });
  room.nextSeq += 1;
}

export function buildStateSnapshot(room: Room): StateMessage {
  const sorted = [...room.users.values()].sort((a, b) => a.seq - b.seq);
  const users: StateUser[] = sorted.map((u) => ({
    id: u.id,
    name: u.name,
    hasVoted: u.vote !== null,
  }));

  const votes = room.revealed
    ? Object.fromEntries(
        sorted.filter((u) => u.vote !== null).map((u) => [u.id, u.vote] as [string, string]),
      )
    : null;

  return {
    type: "state",
    hostId: room.hostId,
    revealed: room.revealed,
    users,
    votes,
  };
}

export function promoteNextHost(room: Room): string | null {
  const users = [...room.users.values()];
  if (users.length === 0) return null;
  const smallest = users.reduce((a, b) => (a.seq < b.seq ? a : b));
  room.hostId = smallest.id;
  return smallest.id;
}

export function removeUser(room: Room, userId: string): CleanupResult {
  const user = room.users.get(userId);
  if (user === undefined) {
    return { removed: false, discarded: false, promoted: null };
  }
  const wasHost = userId === room.hostId;
  room.users.delete(userId);

  if (room.users.size === 0) {
    return { removed: true, discarded: true, promoted: null };
  }

  if (wasHost) {
    const newHost = promoteNextHost(room);
    return { removed: true, discarded: false, promoted: newHost };
  }

  return { removed: true, discarded: false, promoted: null };
}

export function removeUserFromRoom(roomId: string, userId: string): CleanupResult {
  const room = rooms.get(roomId);
  if (room === undefined) {
    return { removed: false, discarded: false, promoted: null };
  }
  const result = removeUser(room, userId);
  if (result.discarded) {
    rooms.delete(roomId);
  }
  return result;
}

function hasAnyVotes(room: Room): boolean {
  return [...room.users.values()].some((u) => u.vote !== null);
}

export function castVote(room: Room, userId: string, value: string): void {
  if (room.revealed) {
    throw new RoomError(errors.votingLocked);
  }
  const user = room.users.get(userId);
  if (user === undefined) {
    throw new RoomError(errors.internalError);
  }
  user.vote = value;
}

export function revealVotes(room: Room, userId: string): void {
  if (userId !== room.hostId) {
    throw new RoomError(errors.onlyHostCanReveal);
  }
  if (room.revealed) {
    throw new RoomError(errors.alreadyRevealed);
  }
  room.revealed = true;
}

export function resetVotes(room: Room, userId: string): void {
  if (userId !== room.hostId) {
    throw new RoomError(errors.onlyHostCanReset);
  }
  if (!room.revealed && !hasAnyVotes(room)) {
    throw new RoomError(errors.alreadyReset);
  }
  room.users.forEach((u) => {
    u.vote = null;
  });
  room.revealed = false;
}

export function _testReset(): void {
  rooms.clear();
}
