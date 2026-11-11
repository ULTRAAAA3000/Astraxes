const MAX_AGE_DAYS = 60

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function ensureCacheSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS result_cache (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS image_cache (
        hash TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
  ])
}

export function resultKey(type: string, count: number, text: string): Promise<string> {
  return sha256Hex(`${type}|${type === 'test' ? count : 0}|${text}`)
}

export async function readResult(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT content FROM result_cache WHERE key = ?').bind(key).first<{ content: string }>()
  return row?.content ?? null
}

export function writeResult(db: D1Database, key: string, content: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO result_cache (key, content) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET content = excluded.content, created_at = datetime(\'now\')')
    .bind(key, content)
}

export async function readImage(db: D1Database, hash: string): Promise<string | null> {
  const row = await db.prepare('SELECT description FROM image_cache WHERE hash = ?').bind(hash).first<{ description: string }>()
  return row?.description ?? null
}

export function writeImage(db: D1Database, hash: string, description: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO image_cache (hash, description) VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET description = excluded.description')
    .bind(hash, description)
}

export async function pruneCache(db: D1Database): Promise<void> {
  if (Math.random() > 0.02) return
  await db.batch([
    db.prepare(`DELETE FROM result_cache WHERE created_at < datetime('now', '-${MAX_AGE_DAYS} days')`),
    db.prepare(`DELETE FROM image_cache WHERE created_at < datetime('now', '-${MAX_AGE_DAYS} days')`)
  ]).catch(() => undefined)
}
