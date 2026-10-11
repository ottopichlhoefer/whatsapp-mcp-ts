// A send addressed to a phone-number JID cannot be decrypted by the account's
// own devices (observed 2026-10-11); the same send to the chat's @lid JID can.
// So ask WhatsApp for the @lid of a phone number and send there. Anything that
// goes wrong keeps the phone-number address, i.e. the old behaviour.
export async function toLidAddress(sock, jid, logger) {
  if (!jid.endsWith("@s.whatsapp.net")) return jid;
  let lid;
  try {
    lid = (await sock.onWhatsApp(jid))?.[0]?.lid;
  } catch (err) {
    logger?.warn({ err, jid }, "outbox: @lid lookup failed, sending to phone-number address");
    return jid;
  }
  if (typeof lid !== "string" || !lid.endsWith("@lid")) return jid;
  logger?.info({ from: jid, to: lid }, "outbox: resolved phone number to @lid");
  return lid;
}
