export const errors = {
  malformedMessage: "Malformed message",
  unknownMessageType: "Unknown message type",
  invalidMessage: (type: string) => `Invalid ${type} message`,
  votingLocked: "Voting is locked until reset",
  onlyHostCanReveal: "Only the host can reveal votes",
  onlyHostCanReset: "Only the host can reset votes",
  alreadyRevealed: "Votes are already revealed",
  alreadyReset: "Votes are already reset",
  rateLimitExceeded: "Rate limit exceeded",
  internalError: "Internal error",
} as const;

export type ErrorMessage = string;
