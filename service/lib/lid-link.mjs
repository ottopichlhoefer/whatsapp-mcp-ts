// Link @lid JIDs in the archive to a phone number and a name.
//
// WhatsApp now addresses many chats by an @lid JID that carries no phone
// number. The capture daemon stores those JIDs as they arrive, usually without
// a name, so search_contacts cannot find them (observed 2026-11-23: Nicole
// Rosenberg's current chat 244018734747741@lid had no contacts row at all).
//
// The mapping lid -> phone number is held locally by the WhatsApp desktop app
// (LID.sqlite, ContactsV2.sqlite). An @lid is a per-user identifier, not one
// per viewing account, so the desktop app's mapping is valid for both archive
// instances (verified 2026-11-23: the at archive and the desktop app, which
// runs the ke account, agree on Nicole Rosenberg's @lid).

export function digitsOnly(value) {
  if (value == null) return null;
  const d = String(value).split("@")[0].split(":")[0].replace(/\D/g, "");
  return d.length ? d : null;
}

// Strip the device part: "13319146610933:21@lid" -> "13319146610933@lid".
export function bareLid(jid) {
  if (typeof jid !== "string" || !jid.endsWith("@lid")) return null;
  return `${jid.split("@")[0].split(":")[0]}@lid`;
}

/**
 * Plan the contacts upserts. Pure: no I/O.
 *
 * @param {object} p
 * @param {string[]} p.lidJids        every @lid JID seen in the archive
 * @param {Map<string,string>} p.lidToPn   bare @lid -> phone digits
 * @param {Map<string,string>} p.bookNames phone digits -> address-book name
 * @param {Map<string,{name:?string,notify:?string}>} p.pnContacts
 *        phone digits -> archive contact row of the phone-number JID
 * @param {Map<string,{name:?string,notify:?string,phone_number:?string}>} p.lidContacts
 *        bare @lid -> existing archive contact row
 * @returns {{updates: object[], unresolved: string[], unchanged: number}}
 *   Each update only fills fields that are empty today; it never overwrites.
 */
export function planLinks({ lidJids, lidToPn, bookNames, pnContacts, lidContacts }) {
  const updates = [];
  const unresolved = [];
  let unchanged = 0;
  const seen = new Set();

  for (const raw of lidJids) {
    const jid = bareLid(raw);
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);

    const existing = lidContacts.get(jid) ?? null;
    const pn = lidToPn.get(jid) ?? digitsOnly(existing?.phone_number);
    if (!pn) {
      if (!existing?.name && !existing?.notify) unresolved.push(jid);
      else unchanged++;
      continue;
    }

    const pnRow = pnContacts.get(pn) ?? null;
    const name = bookNames.get(pn) ?? pnRow?.name ?? pnRow?.notify ?? null;
    const notify = pnRow?.notify ?? null;

    const fill = {
      jid,
      name: existing?.name ? null : name,
      notify: existing?.notify ? null : notify,
      phone_number: existing?.phone_number ? null : pn,
    };
    if (!existing || fill.name || fill.notify || fill.phone_number) {
      updates.push({ ...fill, isNew: !existing, display: existing?.name ?? name ?? existing?.notify ?? notify });
    } else {
      unchanged++;
    }
  }
  return { updates, unresolved, unchanged };
}
