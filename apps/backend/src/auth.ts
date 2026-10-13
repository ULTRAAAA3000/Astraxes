export type Role = 'user' | 'admin'

export interface UserRow {
  id: number
  email: string
  role: Role
  daily_quota: number | null
  password_hash: string
}

export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 128
export const MAX_QUOTA = 10000

const HASH_ITERATIONS = 20000
const SESSION_DAYS = 30
const MAX_FAILURES = 8
const FAILURE_WINDOW_MINUTES = 15
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD
}

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/.exec(header ?? '')
  return match ? match[1] : null
}

export function publicUser(user: Pick<UserRow, 'id' | 'email' | 'role'>) {
  return { id: user.id, email: user.email, role: user.role }
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index]
  return diff === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, HASH_ITERATIONS)
  return `pbkdf2$${HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterations, salt, hash] = stored.split('$')
    if (scheme !== 'pbkdf2') return false
    const actual = await derive(password, fromBase64(salt), Number(iterations))
    return sameBytes(actual, fromBase64(hash))
  } catch {
    return false
  }
}

export async function ensureAuthSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        daily_quota REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_login_at TEXT
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS login_failures (
        email TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_login_failures_email ON login_failures(email, at)')
  ])
}

export async function bootstrapAdmin(db: D1Database, email: string | undefined, password: string | undefined): Promise<void> {
  const adminEmail = normalizeEmail(email)
  if (!adminEmail || !password) return

  const existing = await db
    .prepare('SELECT id, role, password_hash FROM users WHERE email = ?')
    .bind(adminEmail)
    .first<{ id: number; role: Role; password_hash: string }>()

  if (!existing) {
    await db
      .prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')")
      .bind(adminEmail, await hashPassword(password))
      .run()
    return
  }

  if (existing.role !== 'admin') {
    await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(existing.id).run()
  }
  if (!(await verifyPassword(password, existing.password_hash))) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), existing.id).run()
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(existing.id).run()
  }
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    db
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
      .bind(await sha256Hex(token), userId, `+${SESSION_DAYS} days`),
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(userId)
  ])
  return token
}

export async function userFromToken(db: D1Database, token: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.role, u.daily_quota, u.password_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .bind(await sha256Hex(token))
    .first<UserRow>()
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
}

export async function tooManyFailures(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at > datetime('now', ?)")
    .bind(email, `-${FAILURE_WINDOW_MINUTES} minutes`)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= MAX_FAILURES
}

export async function recordFailure(db: D1Database, email: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM login_failures WHERE at < datetime('now', '-1 day')"),
    db.prepare('INSERT INTO login_failures (email) VALUES (?)').bind(email)
  ])
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(email).run()
}
