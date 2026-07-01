import { z } from "zod";
import type { ErrorMessage } from "./errors.js";
import { errors } from "./errors.js";

const voteSchema = z.object({
  type: z.literal("vote"),
  value: z.string().min(1).max(64),
});

const revealSchema = z.object({
  type: z.literal("reveal"),
});

const resetSchema = z.object({
  type: z.literal("reset"),
});

export type ClientType = "vote" | "reveal" | "reset";

export type VoteMessage = z.infer<typeof voteSchema>;
export type RevealMessage = z.infer<typeof revealSchema>;
export type ResetMessage = z.infer<typeof resetSchema>;
export type ClientToServer = VoteMessage | RevealMessage | ResetMessage;

export type WelcomeMessage = {
  type: "welcome";
  userId: string;
};

export type StateUser = {
  id: string;
  name: string;
  hasVoted: boolean;
};

export type StateMessage = {
  type: "state";
  hostId: string;
  revealed: boolean;
  users: StateUser[];
  votes: null | Record<string, string>;
};

export type ServerError = {
  type: "error";
  message: ErrorMessage;
};

export type ServerToClient = WelcomeMessage | StateMessage | ServerError;

export type ParseResult =
  | { ok: true; message: ClientToServer }
  | { ok: false; error: ErrorMessage; detail?: unknown };

const knownTypes = new Set<string>(["vote", "reveal", "reset"]);

function schemaFor(type: ClientType, maxVoteLength: number) {
  if (type === "vote") {
    return z.object({ type: z.literal("vote"), value: z.string().min(1).max(maxVoteLength) });
  }
  return type === "reveal" ? revealSchema : resetSchema;
}

export function parseClientMessage(raw: string, maxVoteLength = 64): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: errors.malformedMessage };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: errors.unknownMessageType };
  }

  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !knownTypes.has(type)) {
    return { ok: false, error: errors.unknownMessageType };
  }

  const typed = type as ClientType;
  const result = schemaFor(typed, maxVoteLength).safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: errors.invalidMessage(typed), detail: result.error.issues };
  }
  return { ok: true, message: result.data };
}
