export function ensureOriginDir(db) {
  const cols = db.prepare("PRAGMA table_info(outbox)").all().map((c) => c.name);
  if (!cols.includes("origin_dir")) db.exec("ALTER TABLE outbox ADD COLUMN origin_dir TEXT");
}
