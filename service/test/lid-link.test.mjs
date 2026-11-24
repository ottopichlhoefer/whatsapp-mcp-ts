import { test } from "node:test";
import assert from "node:assert/strict";
import { bareLid, digitsOnly, planLinks } from "../lib/lid-link.mjs";

const LID = "203600000000001@lid";
const PN = "436600000001";

function plan(overrides = {}) {
  return planLinks({
    lidJids: [LID],
    lidToPn: new Map([[LID, PN]]),
    bookNames: new Map(),
    pnContacts: new Map(),
    lidContacts: new Map(),
    ...overrides,
  });
}

test("bareLid strips the device part and rejects non-lid JIDs", () => {
  assert.equal(bareLid("13319146610933:21@lid"), "13319146610933@lid");
  assert.equal(bareLid("436600000001@s.whatsapp.net"), null);
});

test("digitsOnly reduces JIDs and formatted numbers to digits", () => {
  assert.equal(digitsOnly("436600000001:3@s.whatsapp.net"), PN);
  assert.equal(digitsOnly("+43 660 0000001"), PN);
  assert.equal(digitsOnly(null), null);
});

test("creates a missing @lid row with address-book name and phone number", () => {
  const { updates } = plan({ bookNames: new Map([[PN, "Dr. Test Person"]]) });
  assert.equal(updates.length, 1);
  assert.deepEqual(
    { jid: updates[0].jid, name: updates[0].name, phone_number: updates[0].phone_number, isNew: updates[0].isNew },
    { jid: LID, name: "Dr. Test Person", phone_number: PN, isNew: true },
  );
});

test("falls back to the phone-number contact's push name", () => {
  const { updates } = plan({ pnContacts: new Map([[PN, { name: null, notify: "Test" }]]) });
  assert.equal(updates[0].name, "Test");
  assert.equal(updates[0].notify, "Test");
});

test("never overwrites fields that are already set", () => {
  const { updates, unchanged } = plan({
    bookNames: new Map([[PN, "Other Name"]]),
    lidContacts: new Map([[LID, { name: "Kept", notify: "Kept", phone_number: PN }]]),
  });
  assert.equal(updates.length, 0);
  assert.equal(unchanged, 1);
});

test("fills only the empty field of an existing row", () => {
  const { updates } = plan({
    bookNames: new Map([[PN, "Book Name"]]),
    lidContacts: new Map([[LID, { name: null, notify: "Push", phone_number: null }]]),
  });
  assert.equal(updates[0].name, "Book Name");
  assert.equal(updates[0].notify, null);
  assert.equal(updates[0].phone_number, PN);
});

test("reports @lid JIDs without mapping and without any name as unresolved", () => {
  const { updates, unresolved } = plan({ lidToPn: new Map() });
  assert.equal(updates.length, 0);
  assert.deepEqual(unresolved, [LID]);
});

test("deduplicates device variants of the same @lid", () => {
  const { updates } = plan({ lidJids: [LID, "203600000000001:5@lid"] });
  assert.equal(updates.length, 1);
});
