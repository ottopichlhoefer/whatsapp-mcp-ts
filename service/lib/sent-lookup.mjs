// Lookup for Baileys' getMessage: a device that could not decrypt one of our
// sends asks for a resend, and Baileys needs the original content back. Only
// messages this daemon sent can be asked for, and those are all in the outbox.
export function makeSentMessageLookup(outbox, logger) {
  const byWaMsgId = outbox.prepare("SELECT content FROM outbox WHERE wa_msg_id = ?");
  return (key) => {
    if (!key || !key.id) return undefined;
    const row = byWaMsgId.get(key.id);
    logger?.info(
      { msgId: key.id, remoteJid: key.remoteJid, participant: key.participant, found: !!row },
      "outbox: resend lookup"
    );
    return row ? { extendedTextMessage: { text: row.content } } : undefined;
  };
}
