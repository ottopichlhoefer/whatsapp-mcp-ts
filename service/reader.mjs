// Read-only MCP server over the archive SQLite. Stateless: safe to spawn one
// per MCP client concurrently (DB is WAL; opened read-only). No WhatsApp
// socket, no send capability. Local addition to the pinned upstream.
import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(HERE, "..", "data", "whatsapp.db");
const db = new DatabaseSync(DB_PATH, { readOnly: true });

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

await server.connect(new StdioServerTransport());
