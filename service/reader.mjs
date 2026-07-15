// MCP server over the archive SQLite. Reads are stateless and open the archive
// db read-only (WAL; safe to spawn one per client concurrently). No WhatsApp
// socket lives here: send_message only ENQUEUES to data/outbox.db; the capture
// daemon (sole socket owner) delivers. Local addition to the pinned upstream.
import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(HERE, "..", "data", "whatsapp.db");
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Outbound outbox (local addition): a SEPARATE db file, opened read-write, so
// the archive db above stays strictly read-only from the reader. send_message
// only enqueues here; the capture daemon owns the socket and does delivery.
const OUTBOX_PATH = path.join(HERE, "..", "data", "outbox.db");
const outbox = new DatabaseSync(OUTBOX_PATH);
outbox.exec("PRAGMA journal_mode = WAL");
outbox.exec("PRAGMA busy_timeout = 5000");
outbox.exec(`
  CREATE TABLE IF NOT EXISTS outbox (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_jid TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    sent_at       INTEGER,
    error         TEXT,
    wa_msg_id     TEXT
  );
`);

function toRecipientJid(recipient) {
  const r = String(recipient).trim();
  if (r.includes("@")) return r;
  const digits = r.replace(/[^0-9]/g, "");
  return digits + "@s.whatsapp.net";
}

const server = new McpServer({ name: "whatsapp-archive-reader", version: "1.0.0" });

server.tool(
  "list_chats",
  "List chats in the WhatsApp archive, newest activity first.",
  { limit: z.number().int().min(1).max(200).default(30) },
  async ({ limit }) => {
    const rows = db
      .prepare(
        `SELECT c.jid, COALESCE(c.name, ct.name, ct.notify, ct.phone_number) AS name,
                c.last_message_time,
                (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid) AS message_count
         FROM chats c LEFT JOIN contacts ct ON ct.jid = c.jid
         ORDER BY c.last_message_time DESC LIMIT ?`
      )
      .all(limit);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
  }
);

server.tool(
  "list_messages",
  "Read messages of one chat (by jid), newest first.",
  {
    chat_jid: z.string(),
    limit: z.number().int().min(1).max(200).default(30),
    offset: z.number().int().min(0).default(0),
  },
  async ({ chat_jid, limit, offset }) => {
    const rows = db
      .prepare(
        `SELECT id, sender, content, timestamp, is_from_me FROM messages
         WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(chat_jid, limit, offset);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
  }
);

server.tool(
  "search_messages",
  "Full-text LIKE search over message content across all chats.",
  {
    query: z.string().min(2),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ query, limit }) => {
    const rows = db
      .prepare(
        `SELECT m.chat_jid, COALESCE(c.name, m.chat_jid) AS chat, m.sender,
                m.content, m.timestamp, m.is_from_me
         FROM messages m LEFT JOIN chats c ON c.jid = m.chat_jid
         WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT ?`
      )
      .all(`%${query}%`, limit);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
  }
);

server.tool(
  "search_contacts",
  "Search contacts/chats by name or phone number fragment.",
  { query: z.string().min(2), limit: z.number().int().min(1).max(100).default(25) },
  async ({ query, limit }) => {
    const q = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT jid, name, notify, phone_number FROM contacts
         WHERE name LIKE ? OR notify LIKE ? OR phone_number LIKE ? OR jid LIKE ?
         LIMIT ?`
      )
      .all(q, q, q, q, limit);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
  }
);

server.tool(
  "send_message",
  "Queue a WhatsApp text message for delivery. Enqueues to the local outbox; the capture daemon (sole owner of the WhatsApp connection) delivers it within a few seconds. 'recipient' is a phone number (digits, optional + or spaces) or a full JID (e.g. 2547XXXXXXXX@s.whatsapp.net). Confirm delivery with outbox_status.",
  { recipient: z.string().min(3), message: z.string().min(1) },
  async ({ recipient, message }) => {
    const jid = toRecipientJid(recipient);
    const info = outbox
      .prepare(
        "INSERT INTO outbox (recipient_jid, content, status, created_at) VALUES (?, ?, 'pending', ?)"
      )
      .run(jid, message, Date.now());
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { queued: true, id: Number(info.lastInsertRowid), recipient_jid: jid },
            null,
            1
          ),
        },
      ],
    };
  }
);

server.tool(
  "outbox_status",
  "Delivery status of queued outbound messages (newest first).",
  { limit: z.number().int().min(1).max(50).default(10) },
  async ({ limit }) => {
    const rows = outbox
      .prepare(
        `SELECT id, recipient_jid, substr(content,1,60) AS preview, status,
                created_at, sent_at, error, wa_msg_id
         FROM outbox ORDER BY id DESC LIMIT ?`
      )
      .all(limit);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 1) }] };
  }
);

await server.connect(new StdioServerTransport());
