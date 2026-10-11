import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeSentMessageLookup } from "../lib/sent-lookup.mjs";

function outboxWith(rows) {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "ob-")), "outbox.db"));
  db.exec(
    "CREATE TABLE outbox (id INTEGER PRIMARY KEY, recipient_jid TEXT, content TEXT, status TEXT, created_at INTEGER, wa_msg_id TEXT)"
  );
  const ins = db.prepare(
    "INSERT INTO outbox (recipient_jid, content, status, created_at, wa_msg_id) VALUES (?, ?, ?, 0, ?)"
  );
  for (const r of rows) ins.run(r.to, r.content, r.status, r.waMsgId ?? null);
  return db;
}

test("returns the text of a message this daemon sent, as Baileys sent it", () => {
  const lookup = makeSentMessageLookup(
    outboxWith([{ to: "1@s.whatsapp.net", content: "Fiti pia 😘", status: "sent", waMsgId: "3EB0AAA" }])
  );
  assert.deepEqual(lookup({ id: "3EB0AAA", remoteJid: "1@s.whatsapp.net", fromMe: true }), {
    extendedTextMessage: { text: "Fiti pia 😘" },
  });
});

test("returns undefined for a message id the daemon never sent", () => {
  const lookup = makeSentMessageLookup(
    outboxWith([{ to: "1@s.whatsapp.net", content: "hello", status: "sent", waMsgId: "3EB0AAA" }])
  );
  assert.equal(lookup({ id: "3EB0BBB", remoteJid: "1@s.whatsapp.net", fromMe: true }), undefined);
});

test("returns undefined when the key carries no message id", () => {
  const lookup = makeSentMessageLookup(
    outboxWith([{ to: "1@s.whatsapp.net", content: "never delivered", status: "failed" }])
  );
  assert.equal(lookup({ id: null, remoteJid: "1@s.whatsapp.net" }), undefined);
  assert.equal(lookup({ id: "", remoteJid: "1@s.whatsapp.net" }), undefined);
  assert.equal(lookup(undefined), undefined);
});

test("logs each resend request with the requesting device and the outcome", () => {
  const logged = [];
  const logger = { info: (obj, msg) => logged.push({ ...obj, msg }) };
  const lookup = makeSentMessageLookup(
    outboxWith([{ to: "1@s.whatsapp.net", content: "hello", status: "sent", waMsgId: "3EB0AAA" }]),
    logger
  );
  lookup({ id: "3EB0AAA", remoteJid: "1@s.whatsapp.net", participant: "9:20@lid", fromMe: true });
  lookup({ id: "3EB0BBB", remoteJid: "1@s.whatsapp.net", participant: "9:20@lid", fromMe: true });
  assert.deepEqual(logged, [
    { msgId: "3EB0AAA", remoteJid: "1@s.whatsapp.net", participant: "9:20@lid", found: true, msg: "outbox: resend lookup" },
    { msgId: "3EB0BBB", remoteJid: "1@s.whatsapp.net", participant: "9:20@lid", found: false, msg: "outbox: resend lookup" },
  ]);
});
