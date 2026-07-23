import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("returns defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({
      port: 3000,
      logLevel: "info",
      heartbeatIntervalMs: 30000,
      heartbeatTimeoutMs: 10000,
      maxPayloadBytes: 4096,
      maxRoomIdLength: 128,
      maxNameLength: 32,
      maxVoteLength: 64,
      maxDeckLength: 32,
      shutdownGraceMs: 20000,
      maxRoomUsers: 50,
      messageRateWindowMs: 1000,
      messageRateBurst: 20,
    });
  });

  it("uses provided env values", () => {
    const cfg = loadConfig({
      PORT: "8080",
      LOG_LEVEL: "debug",
      HEARTBEAT_INTERVAL_MS: "5000",
      MAX_ROOM_USERS: "5",
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe("debug");
    expect(cfg.heartbeatIntervalMs).toBe(5000);
    expect(cfg.maxRoomUsers).toBe(5);
  });

  it("rejects non-numeric integers", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "12.5" })).toThrow(ConfigError);
  });

  it("rejects integers out of bounds", () => {
    expect(() => loadConfig({ PORT: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(ConfigError);
    expect(() => loadConfig({ MAX_ROOM_USERS: "1" })).toThrow(ConfigError);
  });

  it("rejects invalid log levels", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(ConfigError);
    expect(() => loadConfig({ LOG_LEVEL: "" })).toThrow(ConfigError);
  });

  it("accepts all valid pino levels", () => {
    for (const level of ["fatal", "error", "warn", "info", "debug", "trace", "silent"]) {
      expect(loadConfig({ LOG_LEVEL: level }).logLevel).toBe(level);
    }
  });

  it("parses MAX_DECK_LENGTH from env", () => {
    expect(loadConfig({ MAX_DECK_LENGTH: "64" }).maxDeckLength).toBe(64);
  });

  it("defaults MAX_DECK_LENGTH to 32 when unset", () => {
    expect(loadConfig({}).maxDeckLength).toBe(32);
  });

  it("rejects MAX_DECK_LENGTH out of bounds", () => {
    expect(() => loadConfig({ MAX_DECK_LENGTH: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ MAX_DECK_LENGTH: "300" })).toThrow(ConfigError);
  });
});
