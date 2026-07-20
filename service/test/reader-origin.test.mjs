import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureOriginDir } from "../lib/outbox-migrate.mjs";

test("ensureOriginDir adds the column once, idempotently", () => {
  const p = join(mkdtempSync(join(tmpdir(), "ob-")), "outbox.db");
  const db = new DatabaseSync(p);
  db.exec("CREATE TABLE outbox (id INTEGER PRIMARY KEY, recipient_jid TEXT, content TEXT, status TEXT, created_at INTEGER)");
  ensureOriginDir(db);
  ensureOriginDir(db); // second call must not throw
  const cols = db.prepare("PRAGMA table_info(outbox)").all().map((c) => c.name);
  assert.ok(cols.includes("origin_dir"));
});
