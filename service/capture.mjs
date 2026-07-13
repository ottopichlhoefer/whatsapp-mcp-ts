// Capture-only daemon: WhatsApp connection + SQLite archiving, NO MCP surface.
// Local addition to the pinned upstream (see service/README-local.md).
// Reads happen through service/reader.mjs; sends go through OpenClaw.
import { pino } from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../src/database.ts";
import { startWhatsAppConnection } from "../src/whatsapp.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const logger = pino(
  { level: process.env.LOG_LEVEL || "info", timestamp: pino.stdTimeFunctions.isoTime },
  pino.destination(path.join(HERE, "..", "wa-logs.txt"))
);

// Upstream leaks unhandled rejections from Baileys internals (e.g. sendPassiveIq
// "Timed Out"), which kill the process. For a long-running archiver: log and live;
// whatsapp.ts's connection.update handler owns socket recovery.
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection (kept alive)"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException (kept alive)"));

initializeDatabase();
await startWhatsAppConnection(logger);
logger.info("capture-only mode: archiving; no MCP on stdio.");
setInterval(() => {}, 1 << 30);
