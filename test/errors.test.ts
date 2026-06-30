import { describe, expect, it } from "vitest";
import { errors } from "../src/errors.js";

describe("errors", () => {
  it("exposes stable message strings", () => {
    expect(errors.malformedMessage).toBe("Malformed message");
    expect(errors.unknownMessageType).toBe("Unknown message type");
    expect(errors.votingLocked).toBe("Voting is locked until reset");
    expect(errors.onlyHostCanReveal).toBe("Only the host can reveal votes");
    expect(errors.onlyHostCanReset).toBe("Only the host can reset votes");
    expect(errors.alreadyRevealed).toBe("Votes are already revealed");
    expect(errors.alreadyReset).toBe("Votes are already reset");
    expect(errors.rateLimitExceeded).toBe("Rate limit exceeded");
    expect(errors.internalError).toBe("Internal error");
  });

  it("formats invalid-type messages", () => {
    expect(errors.invalidMessage("vote")).toBe("Invalid vote message");
    expect(errors.invalidMessage("reveal")).toBe("Invalid reveal message");
    expect(errors.invalidMessage("reset")).toBe("Invalid reset message");
  });
});
