import { describe, expect, it } from "vitest";
import type {
  ClientToServer,
  ResetMessage,
  RevealMessage,
  ServerToClient,
  VoteMessage,
} from "../src/messages.js";
import { parseClientMessage } from "../src/messages.js";

describe("parseClientMessage", () => {
  describe("valid messages", () => {
    it("parses a vote message", () => {
      const result = parseClientMessage(JSON.stringify({ type: "vote", value: "5" }));
      expect(result).toEqual({ ok: true, message: { type: "vote", value: "5" } });
      if (result.ok && result.message.type === "vote") {
        const _check: VoteMessage = result.message;
        const _union: ClientToServer = result.message;
        void _check;
        void _union;
      }
    });

    it("accepts the full 64-char value bound", () => {
      const value = "x".repeat(64);
      const result = parseClientMessage(JSON.stringify({ type: "vote", value }));
      expect(result).toEqual({ ok: true, message: { type: "vote", value } });
    });

    it("accepts arbitrary unicode value strings (any deck)", () => {
      const result = parseClientMessage(JSON.stringify({ type: "vote", value: "☕" }));
      expect(result).toEqual({ ok: true, message: { type: "vote", value: "☕" } });
    });

    it("does not trim the vote value (verbatim echo)", () => {
      const result = parseClientMessage(JSON.stringify({ type: "vote", value: "  5  " }));
      expect(result).toEqual({ ok: true, message: { type: "vote", value: "  5  " } });
    });

    it("parses a reveal message", () => {
      const result = parseClientMessage(JSON.stringify({ type: "reveal" }));
      expect(result).toEqual({ ok: true, message: { type: "reveal" } });
      if (result.ok && result.message.type === "reveal") {
        const _check: RevealMessage = result.message;
        void _check;
      }
    });

    it("parses a reset message", () => {
      const result = parseClientMessage(JSON.stringify({ type: "reset" }));
      expect(result).toEqual({ ok: true, message: { type: "reset" } });
      if (result.ok && result.message.type === "reset") {
        const _check: ResetMessage = result.message;
        void _check;
      }
    });

    it("ignores extra fields (Zod strips unknown keys by default for objects)", () => {
      const result = parseClientMessage(JSON.stringify({ type: "reveal", extra: "ignored" }));
      expect(result).toEqual({ ok: true, message: { type: "reveal" } });
    });
  });

  describe("Malformed message — JSON parse failure", () => {
    it("rejects non-JSON input", () => {
      expect(parseClientMessage("not json")).toEqual({ ok: false, error: "Malformed message" });
    });

    it("rejects incomplete JSON", () => {
      expect(parseClientMessage('{"type":"vote"')).toEqual({
        ok: false,
        error: "Malformed message",
      });
    });

    it("rejects trailing junk after a valid JSON value", () => {
      expect(parseClientMessage('{"type":"vote"} garbage')).toEqual({
        ok: false,
        error: "Malformed message",
      });
    });
  });

  describe("Unknown message type", () => {
    it("rejects a JSON array", () => {
      expect(parseClientMessage("[]")).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects a JSON null", () => {
      expect(parseClientMessage("null")).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects a JSON number", () => {
      expect(parseClientMessage("5")).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects a bare string", () => {
      expect(parseClientMessage('"hello"')).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects an object with no type field", () => {
      expect(parseClientMessage(JSON.stringify({ value: "5" }))).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects a non-string type", () => {
      expect(parseClientMessage(JSON.stringify({ type: 5 }))).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects an unknown type string", () => {
      expect(parseClientMessage(JSON.stringify({ type: "frobnicate" }))).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects the absent `leave` message type", () => {
      expect(parseClientMessage(JSON.stringify({ type: "leave" }))).toEqual({
        ok: false,
        error: "Unknown message type",
      });
    });

    it("rejects a server-only type (`state`) sent by client", () => {
      expect(
        parseClientMessage(
          JSON.stringify({ type: "state", hostId: "x", revealed: false, users: [], votes: null }),
        ),
      ).toEqual({ ok: false, error: "Unknown message type" });
    });
  });

  describe("Invalid <type> message — known type, bad shape", () => {
    it("normalizes a vote missing required `value`", () => {
      expect(parseClientMessage(JSON.stringify({ type: "vote" }))).toEqual({
        ok: false,
        error: "Invalid vote message",
      });
    });

    it("normalizes a vote with a non-string value (number)", () => {
      expect(parseClientMessage(JSON.stringify({ type: "vote", value: 5 }))).toEqual({
        ok: false,
        error: "Invalid vote message",
      });
    });

    it("normalizes a vote with a non-string value (null)", () => {
      expect(parseClientMessage(JSON.stringify({ type: "vote", value: null }))).toEqual({
        ok: false,
        error: "Invalid vote message",
      });
    });

    it("normalizes an empty vote value (min length 1)", () => {
      expect(parseClientMessage(JSON.stringify({ type: "vote", value: "" }))).toEqual({
        ok: false,
        error: "Invalid vote message",
      });
    });

    it("normalizes a vote value exceeding 64 chars", () => {
      const result = parseClientMessage(JSON.stringify({ type: "vote", value: "x".repeat(65) }));
      expect(result).toEqual({ ok: false, error: "Invalid vote message" });
    });

    it("uses the known type name verbatim in the normalized error", () => {
      expect(parseClientMessage(JSON.stringify({ type: "vote", value: 5 }))).toEqual({
        ok: false,
        error: "Invalid vote message",
      });
    });

    it("does not leak zod issue text in the normalized error", () => {
      const result = parseClientMessage(JSON.stringify({ type: "vote", value: 5 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Invalid vote message");
      }
    });
  });

  describe("ServerToClient type contract (compile-time only)", () => {
    it("shapes compile without error", () => {
      const welcome: ServerToClient = { type: "welcome", userId: "user-abc" };
      const state: ServerToClient = {
        type: "state",
        hostId: "user-abc",
        revealed: false,
        users: [{ id: "user-abc", name: "Alice", hasVoted: true }],
        votes: null,
      };
      const revealedState: ServerToClient = {
        type: "state",
        hostId: "user-abc",
        revealed: true,
        users: [{ id: "user-abc", name: "Alice", hasVoted: true }],
        votes: { "user-abc": "5" },
      };
      const err: ServerToClient = {
        type: "error",
        message: "Only the host can reveal votes",
      };
      void welcome;
      void state;
      void revealedState;
      void err;
      expect(true).toBe(true);
    });
  });
});
