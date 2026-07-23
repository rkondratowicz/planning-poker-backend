export type Config = {
  port: number;
  logLevel: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxPayloadBytes: number;
  maxRoomIdLength: number;
  maxNameLength: number;
  maxVoteLength: number;
  maxDeckLength: number;
  shutdownGraceMs: number;
  maxRoomUsers: number;
  messageRateWindowMs: number;
  messageRateBurst: number;
};

type Bound = { min: number; max: number };

const intBounds: Record<string, Bound> = {
  port: { min: 1, max: 65535 },
  heartbeatIntervalMs: { min: 1000, max: 3_600_000 },
  heartbeatTimeoutMs: { min: 1000, max: 3_600_000 },
  maxPayloadBytes: { min: 256, max: 1_048_576 },
  maxRoomIdLength: { min: 16, max: 1024 },
  maxNameLength: { min: 1, max: 256 },
  maxVoteLength: { min: 1, max: 1024 },
  maxDeckLength: { min: 1, max: 256 },
  shutdownGraceMs: { min: 1000, max: 300_000 },
  maxRoomUsers: { min: 2, max: 10_000 },
  messageRateWindowMs: { min: 100, max: 60_000 },
  messageRateBurst: { min: 1, max: 10_000 },
};

const validLogLevels = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function parseBoundedInt(name: string, raw: string | undefined, fallback: number): number {
  const source = raw ?? String(fallback);
  if (/^[0-9]+$/.test(source)) {
    const value = Number.parseInt(source, 10);
    const bound = intBounds[name];
    if (!bound || value < bound.min || value > bound.max) {
      throw new ConfigError(
        `${name}=${source} is out of bounds [${bound?.min ?? "?"}, ${bound?.max ?? "?"}]`,
      );
    }
    return value;
  }
  throw new ConfigError(`${name}=${JSON.stringify(raw)} is not a non-negative integer`);
}

function parseString(name: string, raw: string | undefined, fallback: string): string {
  const value = raw ?? fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`${name}=${JSON.stringify(raw)} is not a non-empty string`);
  }
  return value;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const logLevel = parseString("LOG_LEVEL", env.LOG_LEVEL, "info");
  if (!validLogLevels.has(logLevel)) {
    throw new ConfigError(`LOG_LEVEL=${JSON.stringify(logLevel)} is not a valid pino level`);
  }
  return {
    port: parseBoundedInt("port", env.PORT, 3000),
    logLevel,
    heartbeatIntervalMs: parseBoundedInt("heartbeatIntervalMs", env.HEARTBEAT_INTERVAL_MS, 30000),
    heartbeatTimeoutMs: parseBoundedInt("heartbeatTimeoutMs", env.HEARTBEAT_TIMEOUT_MS, 10000),
    maxPayloadBytes: parseBoundedInt("maxPayloadBytes", env.MAX_PAYLOAD_BYTES, 4096),
    maxRoomIdLength: parseBoundedInt("maxRoomIdLength", env.MAX_ROOM_ID_LENGTH, 128),
    maxNameLength: parseBoundedInt("maxNameLength", env.MAX_NAME_LENGTH, 32),
    maxVoteLength: parseBoundedInt("maxVoteLength", env.MAX_VOTE_LENGTH, 64),
    maxDeckLength: parseBoundedInt("maxDeckLength", env.MAX_DECK_LENGTH, 32),
    shutdownGraceMs: parseBoundedInt("shutdownGraceMs", env.SHUTDOWN_GRACE_MS, 20000),
    maxRoomUsers: parseBoundedInt("maxRoomUsers", env.MAX_ROOM_USERS, 50),
    messageRateWindowMs: parseBoundedInt("messageRateWindowMs", env.MESSAGE_RATE_WINDOW_MS, 1000),
    messageRateBurst: parseBoundedInt("messageRateBurst", env.MESSAGE_RATE_BURST, 20),
  };
}
