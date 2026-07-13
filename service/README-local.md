# Local additions to pinned upstream (ce9b144)

This clone is the `ke` instance of the WhatsApp archive layer (spec:
~/.doom.d/docs/superpowers/specs/2026-07-11-whatsapp-mcp-two-numbers-design.md).

Deviations from upstream:

1. src/whatsapp.ts — QR rendered in terminal via qrcode-terminal instead of
   auto-opening quickchart.io (pairing payload must not transit third parties).
   Dep added: qrcode-terminal.
2. service/capture.mjs — capture-only daemon (WhatsApp socket + SQLite
   archiving, no MCP). Adds unhandledRejection/uncaughtException keep-alive
   (upstream leaks Baileys promise rejections). Run by Scheduled Task
   "WhatsApp Archive ke" via start.vbs -> start.cmd (restart loop).
   start.cmd's backoff uses `ping -n 16 127.0.0.1` NOT `timeout` — under a
   non-interactive Scheduled Task `timeout` has no console stdin, errors
   instantly, and the restart loop hot-spins (observed 2026-07-11). Keep the
   ping form when replicating for `at`.
3. service/reader.mjs — stateless read-only MCP stdio server over
   data/whatsapp.db (WAL). This is what MCP clients spawn — one per client is
   safe. NEVER register src/main.ts in a client: a second Baileys socket on
   this auth session causes WA 440 conflicts.

Sends are not done through this instance at all — outbound goes through the
OpenClaw bridge. Replicate this whole service/ dir + the whatsapp.ts patch
when creating the `at` clone.
