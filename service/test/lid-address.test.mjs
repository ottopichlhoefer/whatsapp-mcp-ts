import { test } from "node:test";
import assert from "node:assert/strict";
import { toLidAddress } from "../lib/lid-address.mjs";

const PN = "254700000001@s.whatsapp.net";
const LID = "203600000000001@lid";

function sockAnswering(result) {
  const asked = [];
  return {
    asked,
    onWhatsApp: async (jid) => {
      asked.push(jid);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test("returns the @lid address WhatsApp reports for a phone-number JID", async () => {
  const sock = sockAnswering([{ jid: PN, exists: true, lid: LID }]);
  assert.equal(await toLidAddress(sock, PN), LID);
  assert.deepEqual(sock.asked, [PN]);
});

test("keeps group and @lid JIDs unchanged without asking WhatsApp", async () => {
  const sock = sockAnswering(new Error("must not be asked"));
  assert.equal(await toLidAddress(sock, "120363000000000001@g.us"), "120363000000000001@g.us");
  assert.equal(await toLidAddress(sock, LID), LID);
  assert.deepEqual(sock.asked, []);
});

test("falls back to the phone-number JID when WhatsApp reports no @lid", async () => {
  assert.equal(await toLidAddress(sockAnswering([]), PN), PN);
  assert.equal(await toLidAddress(sockAnswering(undefined), PN), PN);
  assert.equal(await toLidAddress(sockAnswering([{ jid: PN, exists: true }]), PN), PN);
  assert.equal(await toLidAddress(sockAnswering([{ jid: PN, exists: true, lid: "garbage" }]), PN), PN);
});

test("falls back to the phone-number JID and warns when the lookup fails", async () => {
  const warned = [];
  const logger = { info: () => {}, warn: (obj, msg) => warned.push({ jid: obj.jid, msg }) };
  assert.equal(await toLidAddress(sockAnswering(new Error("Timed Out")), PN, logger), PN);
  assert.deepEqual(warned, [{ jid: PN, msg: "outbox: @lid lookup failed, sending to phone-number address" }]);
});

test("logs the address it switched to", async () => {
  const logged = [];
  const logger = { info: (obj, msg) => logged.push({ ...obj, msg }), warn: () => {} };
  await toLidAddress(sockAnswering([{ jid: PN, exists: true, lid: LID }]), PN, logger);
  assert.deepEqual(logged, [{ from: PN, to: LID, msg: "outbox: resolved phone number to @lid" }]);
});
