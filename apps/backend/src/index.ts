import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { GenerationError, MAX_QUESTIONS, MIN_QUESTIONS, QUIZ_QUESTION_COUNT, generateContent, normalizeInput, prepareSource } from './prompts'
import { LONG_TEXT_CHARS, condenseText } from './condense'
import {
  MAX_PASSWORD,
  MAX_QUOTA,
  MIN_PASSWORD,
  bearerToken,
  bootstrapAdmin,
  clearFailures,
  createSession,
  destroySession,
  ensureAuthSchema,
  hashPassword,
  normalizeEmail,
  publicUser,
  recordFailure,
  tooManyFailures,
  userFromToken,
  validPassword,
  verifyPassword
} from './auth'
import type { UserRow } from './auth'
import {
  DEFAULT_GLOBAL_LIMIT,
  DEFAULT_GUEST_LIMIT,
  DEFAULT_USER_LIMIT,
  createTracker,
  currentDay,
  limitFrom,
  neuronsOf,
  nextResetAt,
  readQuota,
  usageStatements
} from './usage'
import type { GenerationType, KeyTerm, QuizQuestion } from './prompts'

interface Env {
  AI: Ai
  DB: D1Database
  ALLOWED_ORIGIN: string
  APP_NAME: string
  GUEST_DAILY_NEURONS?: string
  USER_DAILY_NEURONS?: string
  GLOBAL_DAILY_NEURONS?: string
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD?: string
}

interface Identity {
  owner: string
  limit: number
  user: UserRow | null
}

type AppContext = Context<{ Bindings: Env }>

interface GenerationRow {
  type: GenerationType
  content: string
  created_at: string
}

const ALL_TYPES: GenerationType[] = ['summary', 'retelling', 'test', 'terms']
const MIN_TEXT_CHARS = 80
const MAX_INPUT_CHARS = 90000
const MAX_TITLE_CHARS = 120
const DEFAULT_HISTORY_LIMIT = 30
const MAX_HISTORY_LIMIT = 100

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

let schemaReady: Promise<void> | null = null
let adminReady: Promise<void> | null = null

const app = new Hono<{ Bindings: Env }>()

async function ensureSchema(db: D1Database): Promise<void> {
  const { results } = await db.prepare('PRAGMA table_info(documents)').all<{ name: string }>()
  if (!results.some((column) => column.name === 'owner_id')) {
    await db.prepare('ALTER TABLE documents ADD COLUMN owner_id TEXT').run()
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id, id DESC)').run()

  const table = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generations'")
    .first<{ sql: string }>()
  if (table && !table.sql.includes("'retelling'")) {
    await db.batch([
      db.prepare('ALTER TABLE generations RENAME TO generations_old'),
      db.prepare(
        `CREATE TABLE generations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('summary', 'retelling', 'test', 'terms')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )`
      ),
      db.prepare('INSERT INTO generations (id, document_id, type, content, created_at) SELECT id, document_id, type, content, created_at FROM generations_old'),
      db.prepare('DROP TABLE generations_old'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_generations_document ON generations(document_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC)')
    ])
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS usage_daily (
        owner_id TEXT NOT NULL,
        day TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        neurons REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, day)
      )`
    )
    .run()

  await ensureAuthSchema(db)
}

async function resolveOwner(header: string | undefined): Promise<string | null> {
  if (!header || !CLIENT_ID_PATTERN.test(header)) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed: string = c.env.ALLOWED_ORIGIN || '*'
      if (allowed === '*') return '*'
      const list = allowed.split(',').map((item) => item.trim())
      return list.includes(origin) ? origin : list[0]
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Client-Id', 'Authorization'],
    maxAge: 86400
  })
)

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') {
    schemaReady ??= ensureSchema(c.env.DB).catch((error) => {
      schemaReady = null
      console.error('schema check failed', error)
    })
    await schemaReady
    adminReady ??= bootstrapAdmin(c.env.DB, c.env.ADMIN_EMAIL, c.env.ADMIN_PASSWORD).catch((error) => {
      adminReady = null
      console.error('admin bootstrap failed', error)
    })
    await adminReady
  }
  await next()
})

async function identify(c: AppContext): Promise<Identity> {
  const token = bearerToken(c.req.header('Authorization'))
  if (token) {
    const user = await userFromToken(c.env.DB, token)
    if (!user) throw new HTTPException(401, { res: c.json({ error: 'Сесію завершено. Увійдіть знову' }, 401) })
    return { owner: `u:${user.id}`, limit: user.daily_quota ?? limitFrom(c.env.USER_DAILY_NEURONS, DEFAULT_USER_LIMIT), user }
  }
  const owner = await resolveOwner(c.req.header('X-Client-Id'))
  if (!owner) throw new HTTPException(400, { res: c.json({ error: 'Не вказано ідентифікатор клієнта' }, 400) })
  return { owner, limit: limitFrom(c.env.GUEST_DAILY_NEURONS, DEFAULT_GUEST_LIMIT), user: null }
}

async function requireAdmin(c: AppContext): Promise<Identity> {
  const identity = await identify(c)
  if (identity.user?.role !== 'admin') throw new HTTPException(403, { res: c.json({ error: 'Недостатньо прав' }, 403) })
  return identity
}

async function adoptGuestHistory(c: AppContext, userId: number): Promise<void> {
  const guest = await resolveOwner(c.req.header('X-Client-Id'))
  if (guest) await c.env.DB.prepare('UPDATE documents SET owner_id = ? WHERE owner_id = ?').bind(`u:${userId}`, guest).run()
}

function decode(type: GenerationType, content: string): string | QuizQuestion[] | KeyTerm[] | null {
  if (type === 'summary' || type === 'retelling') return content
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim()) ?? text
  const clean = firstLine.replace(/^#+\s*/, '').trim()
  return clean.length > 80 ? `${clean.slice(0, 80).trim()}…` : clean
}

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

app.get('/', (c) => c.json({ name: c.env.APP_NAME, status: 'ok' }))

app.get('/api/health', (c) => c.json({ name: c.env.APP_NAME, status: 'ok' }))

app.post('/api/generate', async (c) => {
  const { owner, limit, user } = await identify(c)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Тіло запиту має бути валідним JSON' }, 400)
  }

  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'Тіло запиту має бути JSON-об’єктом' }, 400)
  }

  const { text, title, types, questionCount } = body as Record<string, unknown>

  if (typeof text !== 'string' || text.trim().length < MIN_TEXT_CHARS) {
    return c.json({ error: `Поле text обов’язкове і має містити не менше ${MIN_TEXT_CHARS} символів` }, 400)
  }
  if (text.length > MAX_INPUT_CHARS) {
    return c.json({ error: `Поле text не має перевищувати ${MAX_INPUT_CHARS} символів` }, 400)
  }
  if (title !== undefined && typeof title !== 'string') {
    return c.json({ error: 'Поле title має бути рядком' }, 400)
  }

  let requested: GenerationType[] = ALL_TYPES
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0 || !types.every((t) => ALL_TYPES.includes(t as GenerationType))) {
      return c.json({ error: 'Поле types має бути непорожнім масивом із: summary, retelling, test, terms' }, 400)
    }
    requested = [...new Set(types as GenerationType[])]
  }

  let quizCount = QUIZ_QUESTION_COUNT
  if (questionCount !== undefined) {
    if (typeof questionCount !== 'number' || !Number.isInteger(questionCount) || questionCount < MIN_QUESTIONS || questionCount > MAX_QUESTIONS) {
      return c.json({ error: `Поле questionCount має бути цілим числом від ${MIN_QUESTIONS} до ${MAX_QUESTIONS}` }, 400)
    }
    quizCount = questionCount
  }

  const normalized = normalizeInput(text)
  const documentTitle = (title?.trim() || deriveTitle(normalized)).slice(0, MAX_TITLE_CHARS)

  const globalLimit = limitFrom(c.env.GLOBAL_DAILY_NEURONS, DEFAULT_GLOBAL_LIMIT)
  const quota = await readQuota(c.env.DB, owner, limit, globalLimit)
  if (quota.device.used >= limit) {
    const error = user
      ? 'Денний ліміт AI для вашого акаунта вичерпано. Він оновиться опівночі за UTC'
      : 'Гостьовий ліміт AI вичерпано. Увійдіть або створіть акаунт, щоб отримати більше. Ліміт оновиться опівночі за UTC'
    return c.json({ error, resetsAt: nextResetAt(), guest: !user }, 429)
  }
  if (quota.global.used >= globalLimit) {
    return c.json({ error: 'Сервіс вичерпав денну квоту AI. Спробуйте пізніше, вона оновиться опівночі за UTC', resetsAt: nextResetAt() }, 429)
  }

  const tracker = createTracker()
  let source = prepareSource(normalized)
  let chunks = 0
  if (normalized.length > LONG_TEXT_CHARS) {
    const condensed = await condenseText(c.env.AI, normalized, tracker)
    source = prepareSource(condensed.text)
    chunks = condensed.chunks
  }

  const outcomes = await Promise.all(
    requested.map(async (type) => {
      try {
        const content = await generateContent(c.env.AI, type, source, { questionCount: quizCount, tracker })
        return { type, content, error: null as string | null }
      } catch (error) {
        console.error(`generation failed [${type}]`, error)
        const message = error instanceof GenerationError ? error.message : 'Помилка під час звернення до моделі'
        return { type, content: null as string | null, error: message }
      }
    })
  )

  const results: Partial<Record<GenerationType, string | QuizQuestion[] | KeyTerm[]>> = {}
  const errors: Partial<Record<GenerationType, string>> = {}
  const stored: { type: GenerationType; content: string }[] = []

  for (const outcome of outcomes) {
    if (outcome.content !== null) {
      stored.push({ type: outcome.type, content: outcome.content })
      results[outcome.type] = decode(outcome.type, outcome.content) ?? undefined
    } else if (outcome.error) {
      errors[outcome.type] = outcome.error
    }
  }

  const spent = neuronsOf(tracker)
  const usage = {
    promptTokens: tracker.promptTokens,
    completionTokens: tracker.completionTokens,
    totalTokens: tracker.promptTokens + tracker.completionTokens,
    modelCalls: tracker.calls,
    neurons: Math.round(spent * 100) / 100
  }

  if (stored.length === 0) {
    await c.env.DB.batch(usageStatements(c.env.DB, owner, tracker))
    return c.json({ error: 'Не вдалося згенерувати жодного результату', errors, usage }, 502)
  }

  const inserted = await c.env.DB.prepare('INSERT INTO documents (title, source_text, owner_id) VALUES (?, ?, ?)')
    .bind(documentTitle, normalized, owner)
    .run()
  const documentId = inserted.meta.last_row_id

  await c.env.DB.batch([
    ...stored.map((item) =>
      c.env.DB.prepare('INSERT INTO generations (document_id, type, content) VALUES (?, ?, ?)').bind(
        documentId,
        item.type,
        item.content
      )
    ),
    ...usageStatements(c.env.DB, owner, tracker)
  ])

  return c.json(
    {
      documentId,
      title: documentTitle,
      condensed: chunks > 0,
      chunks,
      results,
      errors,
      usage,
      quota: { used: Math.round((quota.device.used + spent) * 100) / 100, limit, resetsAt: nextResetAt() }
    },
    201
  )
})

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  if (!email) return c.json({ error: 'Вкажіть коректний email' }, 400)
  if (!validPassword(body?.password)) {
    return c.json({ error: `Пароль має містити від ${MIN_PASSWORD} до ${MAX_PASSWORD} символів` }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: 'Акаунт із таким email уже існує. Увійдіть' }, 409)

  const inserted = await c.env.DB.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')")
    .bind(email, await hashPassword(body.password))
    .run()
  const id = Number(inserted.meta.last_row_id)

  await adoptGuestHistory(c, id)
  const token = await createSession(c.env.DB, id)
  return c.json({ token, user: publicUser({ id, email, role: 'user' }) }, 201)
})

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  if (!email || typeof body?.password !== 'string' || !body.password) {
    return c.json({ error: 'Вкажіть email і пароль' }, 400)
  }
  if (await tooManyFailures(c.env.DB, email)) {
    return c.json({ error: 'Забагато невдалих спроб. Спробуйте за 15 хвилин' }, 429)
  }

  const user = await c.env.DB.prepare('SELECT id, email, role, daily_quota, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>()
  const valid = user ? await verifyPassword(body.password, user.password_hash) : false
  if (!user || !valid) {
    await recordFailure(c.env.DB, email)
    return c.json({ error: 'Невірний email або пароль' }, 401)
  }

  await clearFailures(c.env.DB, email)
  await adoptGuestHistory(c, user.id)
  const token = await createSession(c.env.DB, user.id)
  return c.json({ token, user: publicUser(user) })
})

app.post('/api/auth/logout', async (c) => {
  const token = bearerToken(c.req.header('Authorization'))
  if (token) await destroySession(c.env.DB, token)
  return c.json({ ok: true })
})

app.get('/api/admin/users', async (c) => {
  await requireAdmin(c)
  const defaultLimit = limitFrom(c.env.USER_DAILY_NEURONS, DEFAULT_USER_LIMIT)

  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.daily_quota, u.created_at, u.last_login_at,
            COALESCE(d.neurons, 0) AS neurons, COALESCE(d.tokens, 0) AS tokens,
            (SELECT COUNT(*) FROM documents WHERE owner_id = 'u:' || u.id) AS documents
     FROM users u
     LEFT JOIN usage_daily d ON d.owner_id = 'u:' || u.id AND d.day = ?
     ORDER BY u.id`
  )
    .bind(currentDay())
    .all<{
      id: number
      email: string
      role: string
      daily_quota: number | null
      created_at: string
      last_login_at: string | null
      neurons: number
      tokens: number
      documents: number
    }>()

  return c.json({
    defaultLimit,
    items: results.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      quota: row.daily_quota ?? defaultLimit,
      customQuota: row.daily_quota !== null,
      used: Math.round(row.neurons * 100) / 100,
      tokens: row.tokens,
      documents: row.documents,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at
    }))
  })
})

app.patch('/api/admin/users/:id', async (c) => {
  await requireAdmin(c)
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Некоректний id' }, 400)

  const body = await c.req.json().catch(() => null)
  const quota = body?.dailyQuota
  const valid = quota === null || (typeof quota === 'number' && Number.isFinite(quota) && quota >= 0 && quota <= MAX_QUOTA)
  if (!valid) return c.json({ error: `Квота має бути числом від 0 до ${MAX_QUOTA} або null` }, 400)

  const updated = await c.env.DB.prepare('UPDATE users SET daily_quota = ? WHERE id = ?')
    .bind(quota === null ? null : Math.round(quota), id)
    .run()
  if (!updated.meta.changes) return c.json({ error: 'Користувача не знайдено' }, 404)
  return c.json({ id, dailyQuota: quota === null ? null : Math.round(quota) })
})

app.get('/api/usage', async (c) => {
  const { owner, limit, user } = await identify(c)

  const globalLimit = limitFrom(c.env.GLOBAL_DAILY_NEURONS, DEFAULT_GLOBAL_LIMIT)
  const quota = await readQuota(c.env.DB, owner, limit, globalLimit)

  return c.json({
    used: Math.round(quota.device.used * 100) / 100,
    limit,
    tokens: quota.device.tokens,
    resetsAt: nextResetAt(),
    serviceAvailable: quota.global.used < globalLimit,
    account: user ? publicUser(user) : null
  })
})

app.get('/api/history', async (c) => {
  const { owner } = await identify(c)

  const requested = Number(c.req.query('limit') ?? DEFAULT_HISTORY_LIMIT)
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_HISTORY_LIMIT) : DEFAULT_HISTORY_LIMIT

  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.created_at, GROUP_CONCAT(DISTINCT g.type) AS types
     FROM documents d
     LEFT JOIN generations g ON g.document_id = d.id
     WHERE d.owner_id = ?
     GROUP BY d.id
     ORDER BY d.id DESC
     LIMIT ?`
  )
    .bind(owner, limit)
    .all<{ id: number; title: string; created_at: string; types: string | null }>()

  return c.json({
    items: results.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      types: row.types ? row.types.split(',') : []
    }))
  })
})

app.get('/api/history/:id', async (c) => {
  const { owner } = await identify(c)

  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Некоректний id' }, 400)

  const document = await c.env.DB.prepare('SELECT id, title, source_text, created_at FROM documents WHERE id = ? AND owner_id = ?')
    .bind(id, owner)
    .first<{ id: number; title: string; source_text: string; created_at: string }>()

  if (!document) return c.json({ error: 'Запис не знайдено' }, 404)

  const { results: rows } = await c.env.DB.prepare(
    'SELECT type, content, created_at FROM generations WHERE document_id = ? ORDER BY id DESC'
  )
    .bind(id)
    .all<GenerationRow>()

  const results: Partial<Record<GenerationType, string | QuizQuestion[] | KeyTerm[]>> = {}
  for (const row of rows) {
    if (results[row.type] !== undefined) continue
    const value = decode(row.type, row.content)
    if (value !== null) results[row.type] = value
  }

  return c.json({
    id: document.id,
    title: document.title,
    sourceText: document.source_text,
    createdAt: document.created_at,
    results
  })
})

app.delete('/api/history/:id', async (c) => {
  const { owner } = await identify(c)

  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'Некоректний id' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM documents WHERE id = ? AND owner_id = ?').bind(id, owner).first()
  if (!existing) return c.json({ error: 'Запис не знайдено' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM generations WHERE document_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id)
  ])

  return c.json({ deleted: id })
})

app.notFound((c) => c.json({ error: 'Маршрут не знайдено' }, 404))

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('unhandled error', error)
  return c.json({ error: 'Внутрішня помилка сервера' }, 500)
})

export default app
