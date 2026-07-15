// Capture-only daemon: WhatsApp connection + SQLite archiving, NO MCP surface.
// Local addition to the pinned upstream (see service/README-local.md).
// Reads happen through service/reader.mjs. Outbound: this daemon owns the
// single Baileys socket, so it is the ONLY process allowed to send (a second
// socket on this auth → WA 440). service/reader.mjs enqueues sends into
// data/outbox.db; the drain loop below delivers them.
import { pino } from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/database.ts";
import {
  startWhatsAppConnection,
  sendWhatsAppMessage,
  getCurrentSock,
} from "../src/whatsapp.ts";

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

// --- Outbound outbox drain (local addition) -------------------------------
// Separate DB file so the read-only archive (data/whatsapp.db) is never
// written from the reader; reader inserts 'pending' rows here, we deliver them.
const OUTBOX_PATH = path.join(HERE, "..", "data", "outbox.db");
const outbox = new DatabaseSync(OUTBOX_PATH);
outbox.exec("PRAGMA journal_mode = WAL");
outbox.exec("PRAGMA busy_timeout = 5000");
outbox.exec(`
  CREATE TABLE IF NOT EXISTS outbox (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_jid TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending', -- pending | sent | failed
    created_at    INTEGER NOT NULL,
    sent_at       INTEGER,
    error         TEXT,
    wa_msg_id     TEXT
  );
`);

let draining = false;
async function drainOutbox() {
  if (draining) return;
  const sock = getCurrentSock();
  if (!sock || !sock.user) return; // socket not ready — leave rows pending, retry next tick
  draining = true;
  try {
    const rows = outbox
      .prepare("SELECT id, recipient_jid, content FROM outbox WHERE status='pending' ORDER BY id LIMIT 5")
      .all();
    for (const row of rows) {
      try {
        const res = await sendWhatsAppMessage(logger, sock, row.recipient_jid, row.content);
        if (res && res.key && res.key.id) {
          outbox
            .prepare("UPDATE outbox SET status='sent', sent_at=?, wa_msg_id=? WHERE id=?")
            .run(Date.now(), res.key.id, row.id);
          logger.info({ id: row.id, to: row.recipient_jid, msgId: res.key.id }, "outbox: sent");
        } else {
          outbox
            .prepare("UPDATE outbox SET status='failed', error=? WHERE id=?")
            .run("send returned no result", row.id);
          logger.warn({ id: row.id, to: row.recipient_jid }, "outbox: send returned no result");
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        outbox.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(msg, row.id);
        logger.error({ err, id: row.id }, "outbox: send threw");
      }
    }
  } finally {
    draining = false;
  }
}
setInterval(drainOutbox, 3000);

logger.info("capture-only mode: archiving + outbox drain; no MCP on stdio.");
setInterval(() => {}, 1 << 30);
