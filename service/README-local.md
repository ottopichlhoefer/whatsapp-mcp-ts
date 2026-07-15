# Local additions to pinned upstream (ce9b144)

This clone is the `ke` instance of the WhatsApp archive layer (spec:
~/.doom.d/docs/superpowers/specs/2026-07-11-whatsapp-mcp-two-numbers-design.md).

Deviations from upstream:

1. src/whatsapp.ts — QR rendered in terminal via qrcode-terminal instead of
   auto-opening quickchart.io (pairing payload must not transit third parties).
   Dep added: qrcode-terminal. Also exports `getCurrentSock()` and tracks the
   live socket in a module var (2026-07-14): the socket is recreated on
   reconnect, so a one-time return value goes stale; the outbox drain sends
   through `getCurrentSock()`.
2. service/capture.mjs — capture-only daemon (WhatsApp socket + SQLite
   archiving, no MCP). Adds unhandledRejection/uncaughtException keep-alive
   (upstream leaks Baileys promise rejections). Run by Scheduled Task
   "WhatsApp Archive ke" via start.vbs -> start.cmd (restart loop).
   start.cmd's backoff uses `ping -n 16 127.0.0.1` NOT `timeout` — under a
   non-interactive Scheduled Task `timeout` has no console stdin, errors
   instantly, and the restart loop hot-spins (observed 2026-07-11). Keep the
   ping form when replicating for `at`.
   Outbox drain (2026-07-14): this daemon owns the single Baileys socket, so it
   is the ONLY sender. Every 3s it drains `pending` rows from `data/outbox.db`
   via `sendWhatsAppMessage(getCurrentSock(), …)`, marking each `sent`
   (+wa_msg_id) or `failed`; it skips draining while the socket isn't ready
   (`sock.user` falsy), leaving rows pending to retry.
3. service/reader.mjs — mostly-read MCP stdio server over data/whatsapp.db
   (WAL, opened read-only). This is what MCP clients spawn — one per client is
   safe. NEVER register src/main.ts in a client: a second Baileys socket on
   this auth session causes WA 440 conflicts. Send addition (2026-07-14):
   `send_message` / `outbox_status` tools operate on a SEPARATE db,
   `data/outbox.db` (opened read-write) — the archive db stays strictly
   read-only from the reader. `send_message` only ENQUEUES; it never touches a
   socket, so the reader still cannot connect to WA or auto-reply.

Outbound path (revised 2026-07-14): sends now go through this instance's
outbox (reader enqueues → capture daemon delivers), which is why it needs no
second socket and does not use the OpenClaw bridge for arbitrary targets.
`data/outbox.db` is local per clone (gitignored like `data/`, `auth_info/`).
Replicate this whole service/ dir + the whatsapp.ts patch when creating the
`at` clone.
