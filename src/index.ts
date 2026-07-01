import { readFileSync } from "node:fs";
import { exit } from "node:process";
import {
  serve,
  upgradeWebSocket,
  type WebSocketLike,
  type WebSocketServerLike,
} from "@hono/node-server";
import { Hono } from "hono";
import type { WSEvents } from "hono/ws";
import type { Logger } from "pino";
import pino from "pino";
import { type WebSocket, WebSocketServer } from "ws";
import { type Config, loadConfig } from "./config.js";
import {
  type Connection,
  closeConnection,
  openConnection,
  processMessage,
  roomAtCapacity,
  sendToClient,
} from "./conn.js";
import { errors } from "./errors.js";
import { validateName, validateRoomId } from "./validation.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const contractMarkdown = readFileSync(
  new URL("../docs/planning-poker-api-contract.md", import.meta.url),
  "utf8",
);

export type ServerDeps = {
  config: Config;
  logger: Logger;
  wss: WebSocketServer;
  shuttingDown: () => boolean;
};

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.text("ok"));

  app.get("/", (c) =>
    c.json({
      name: "planning-poker-backend",
      version: packageJson.version,
      endpoints: {
        health: "/health",
        ws: "/ws",
        contract: "/contract",
      },
    }),
  );

  app.get("/contract", (c) =>
    c.text(contractMarkdown, 200, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
  );

  app.get("/ws", (c) => {
    if (deps.shuttingDown()) {
      return c.json({ error: "Server is shutting down" }, 503);
    }
    const roomId = c.req.query("room") ?? "";
    const rawName = c.req.query("name") ?? "";

    const roomErr = validateRoomId(roomId, deps.config.maxRoomIdLength);
    if (roomErr !== null) {
      return c.json({ error: roomErr }, 400);
    }
    const nameErr = validateName(rawName, deps.config.maxNameLength);
    if (nameErr !== null) {
      return c.json({ error: nameErr }, 400);
    }
    if (roomAtCapacity(roomId, deps.config.maxRoomUsers)) {
      return c.json({ error: "Room is full" }, 403);
    }

    const name = rawName.trim();
    const events: WSEvents<WebSocketLike> = {
      onError: (_evt) => deps.logger.error({ err: _evt }, "ws upgrade error"),
      onOpen: (_evt, ws) => {
        try {
          if (deps.shuttingDown()) {
            ws.close(1001, "server_shutdown");
            return;
          }
          const raw = ws.raw as unknown as WebSocket;
          const conn = openConnection({
            roomId,
            name,
            ws: { send: (data) => ws.send(data) },
            config: deps.config,
            logger: deps.logger,
          });
          connsByWs.set(raw, conn);
        } catch (e) {
          deps.logger.error({ err: e }, "ws onOpen failure");
          try {
            ws.close(1011);
          } catch {
            // best-effort
          }
        }
      },
      onMessage: (evt, ws) => {
        const raw = ws.raw as unknown as WebSocket;
        const conn = connsByWs.get(raw);
        if (conn === undefined) {
          return;
        }
        const data = typeof evt.data === "string" ? evt.data : String(evt.data);
        try {
          processMessage(conn, data);
        } catch (e) {
          deps.logger.error(
            { roomId: conn.roomId, userId: conn.userId, err: e },
            "unhandled onMessage",
          );
          try {
            sendToClient(conn, { type: "error", message: errors.internalError });
          } catch {
            // best-effort
          }
        }
      },
      onClose: (_evt, ws) => {
        const raw = ws.raw as unknown as WebSocket;
        const conn = connsByWs.get(raw);
        connsByWs.delete(raw);
        try {
          if (conn !== undefined) {
            closeConnection(conn);
          }
        } catch (e) {
          deps.logger.error(
            { roomId: conn?.roomId, userId: conn?.userId, err: e },
            "unhandled onClose",
          );
          try {
            ws.close(1011);
          } catch {
            // best-effort
          }
        }
      },
    };
    return upgradeWebSocket(c, events, {
      onError: (err: unknown) => deps.logger.error({ err }, "ws upgrade error"),
    });
  });

  return app;
}

const connsByWs = new WeakMap<WebSocket, Connection>();

export type Runtime = {
  server: ReturnType<typeof serve>;
  shutdown: () => Promise<void>;
};

export function startRuntime(deps: ServerDeps): Runtime {
  const app = createApp(deps);
  const server = serve(
    {
      fetch: app.fetch,
      port: deps.config.port,
      websocket: { server: deps.wss as unknown as WebSocketServerLike },
    },
    (info) => {
      deps.logger.info({ port: info.port }, "listening");
    },
  );
  server.on("error", (err) => {
    deps.logger.error({ err }, "server error");
  });

  let shuttingDown = false;

  return {
    server,
    async shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      deps.logger.info("shutting down");
      try {
        server.close();
      } catch {
        // best-effort
      }
      try {
        deps.wss.close();
      } catch {
        // best-effort
      }
      for (const ws of deps.wss.clients) {
        if (ws.readyState === ws.OPEN) {
          try {
            ws.close(1001, "server_shutdown");
          } catch {
            // best-effort
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, deps.config.shutdownGraceMs));
    },
  };
}

export function startHeartbeat(deps: ServerDeps): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    const deadline = deps.config.heartbeatIntervalMs + deps.config.heartbeatTimeoutMs;
    for (const ws of deps.wss.clients) {
      const hbWs = ws as WebSocket & { lastPongAt?: number };
      if (hbWs.lastPongAt === undefined) {
        hbWs.lastPongAt = now;
      }
      if (now - hbWs.lastPongAt > deadline) {
        try {
          ws.close(1011);
        } catch {
          // best-effort
        }
        continue;
      }
      try {
        ws.ping();
      } catch {
        // best-effort
      }
    }
  }, deps.config.heartbeatIntervalMs);
}

export function attachPongHandler(wss: WebSocketServer): void {
  wss.on("connection", (ws) => {
    const hbWs = ws as WebSocket & { lastPongAt?: number };
    hbWs.lastPongAt = Date.now();
    ws.on("pong", () => {
      hbWs.lastPongAt = Date.now();
    });
  });
}

export function main(): void {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayloadBytes,
  });
  attachPongHandler(wss);
  let shuttingDown = false;
  const deps: ServerDeps = {
    config,
    logger,
    wss,
    shuttingDown: () => shuttingDown,
  };
  const heartbeat = startHeartbeat(deps);
  const runtime = startRuntime(deps);

  const onSignal = (sig: string) => {
    logger.info({ signal: sig }, "received signal");
    shuttingDown = true;
    runtime.shutdown().finally(() => {
      clearInterval(heartbeat);
      exit(0);
    });
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

main();
