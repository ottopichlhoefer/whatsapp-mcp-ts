#!/usr/bin/env node
// Fill name and phone number for @lid contacts in the archive, from the
// WhatsApp desktop app's local databases. No network, no WhatsApp socket.
//
// Usage:
//   node service/link-lids.mjs            dry run: print what would change
//   node service/link-lids.mjs --apply    write to data/whatsapp.db
// Options:
//   --archive <path>   archive db (default: ../data/whatsapp.db next to this file)
//   --wa-dir <path>    WhatsApp desktop group container
//                      (default: ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared)
//
// Only empty fields are filled; existing names are never overwritten. Safe to
// run while the capture daemon is running (single short write transaction).
// See lib/lid-link.mjs for why the desktop mapping is valid for both instances.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bareLid, digitsOnly, planLinks } from "./lib/lid-link.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes("--apply");
const ARCHIVE = arg("--archive", path.join(HERE, "..", "data", "whatsapp.db"));
const WA_DIR = arg(
  "--wa-dir",
  path.join(os.homedir(), "Library", "Group Containers", "group.net.whatsapp.WhatsApp.shared"),
);

function openRo(file) {
  if (!existsSync(file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

// --- mapping sources (WhatsApp desktop) -----------------------------------
const lidToPn = new Map();
const bookNames = new Map();
let fromLidDb = 0;
let fromBook = 0;

const lidDb = openRo(path.join(WA_DIR, "LID.sqlite"));
if (lidDb) {
  for (const r of lidDb.prepare("SELECT ZIDENTIFIER AS lid, ZPHONENUMBER AS pn FROM ZWAZACCOUNT").all()) {
    const lid = bareLid(r.lid);
    const pn = digitsOnly(r.pn);
    if (lid && pn) { lidToPn.set(lid, pn); fromLidDb++; }
  }
  lidDb.close();
}

const bookDb = openRo(path.join(WA_DIR, "ContactsV2.sqlite"));
if (bookDb) {
  const rows = bookDb
    .prepare("SELECT ZLID AS lid, ZWHATSAPPID AS wid, ZPHONENUMBER AS pn, ZFULLNAME AS name FROM ZWAADDRESSBOOKCONTACT")
    .all();
  for (const r of rows) {
    const pn = digitsOnly(r.wid) ?? digitsOnly(r.pn);
    const lid = bareLid(r.lid);
    if (lid && pn && !lidToPn.has(lid)) { lidToPn.set(lid, pn); fromBook++; }
    if (pn && r.name && r.name.trim()) bookNames.set(pn, r.name.trim());
  }
  bookDb.close();
}

if (!lidDb && !bookDb) {
  console.error(`No WhatsApp desktop databases found in ${WA_DIR}.`);
  process.exit(1);
}

// --- archive --------------------------------------------------------------
const db = new DatabaseSync(ARCHIVE, { readOnly: !APPLY });
if (APPLY) db.exec("PRAGMA busy_timeout = 5000");

const lidJids = db
  .prepare(
    `SELECT jid FROM contacts WHERE jid LIKE '%@lid'
     UNION SELECT jid FROM chats WHERE jid LIKE '%@lid'
     UNION SELECT DISTINCT sender FROM messages WHERE sender LIKE '%@lid'`,
  )
  .all()
  .map((r) => r.jid);

const pnContacts = new Map();
const lidContacts = new Map();
for (const r of db.prepare("SELECT jid, name, notify, phone_number FROM contacts").all()) {
  if (r.jid.endsWith("@s.whatsapp.net")) pnContacts.set(digitsOnly(r.jid), r);
  else if (r.jid.endsWith("@lid")) lidContacts.set(bareLid(r.jid), r);
}

const { updates, unresolved, unchanged } = planLinks({ lidJids, lidToPn, bookNames, pnContacts, lidContacts });

console.log(`Mapping: ${lidToPn.size} @lid → phone (LID.sqlite ${fromLidDb}, address book ${fromBook}); ${bookNames.size} address-book names`);
console.log(`Archive: ${new Set(lidJids.map(bareLid)).size} distinct @lid JIDs`);
for (const u of updates) {
  const fields = ["name", "notify", "phone_number"].filter((f) => u[f]).join(", ");
  console.log(`  ${u.isNew ? "new " : "fill"}  ${u.jid}  ${u.display ?? "(no name)"}  +${u.phone_number ?? ""}  [${fields || "row only"}]`);
}
console.log(`To change: ${updates.length} · already complete: ${unchanged} · no mapping: ${unresolved.length}`);

if (!APPLY) {
  console.log("Dry run. Run again with --apply to write.");
  process.exit(0);
}

const stmt = db.prepare(`
  INSERT INTO contacts (jid, name, notify, phone_number)
  VALUES (@jid, @name, @notify, @phone_number)
  ON CONFLICT(jid) DO UPDATE SET
    name = COALESCE(name, excluded.name),
    notify = COALESCE(notify, excluded.notify),
    phone_number = COALESCE(phone_number, excluded.phone_number)
`);
db.exec("BEGIN");
try {
  for (const u of updates) stmt.run({ jid: u.jid, name: u.name, notify: u.notify, phone_number: u.phone_number });
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
db.close();
console.log(`Written: ${updates.length} rows.`);
