import { useCallback, useEffect, useState } from 'react'
import { formatDate, request } from '../lib/api'
import type { AdminUser } from '../lib/api'

interface Props {
  currentId: number
  notify: (message: string) => void
}

export default function AdminSection({ currentId, notify }: Props) {
  const [items, setItems] = useState<AdminUser[]>([])
  const [defaultLimit, setDefaultLimit] = useState(0)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await request<{ defaultLimit: number; items: AdminUser[] }>('/api/admin/users')
      setItems(data.items)
      setDefaultLimit(data.defaultLimit)
      setDrafts({})
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити користувачів')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (user: AdminUser, quota: number | null) => {
    setSaving(user.id)
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ dailyQuota: quota }) })
      notify(quota === null ? `Квоту ${user.email} скинуто до стандартної` : `Квоту ${user.email}: ${quota}`)
      await load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не вдалося зберегти квоту')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section id="admin" className="mx-auto max-w-4xl scroll-mt-20 px-5 pb-20 sm:pb-28">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Адмін</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Користувачі <span className="font-display font-normal italic">і квоти</span>
          </h2>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn btn-ghost btn-sm">
          {loading && <span className="spinner" />}
          Оновити
        </button>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
        Квота — денний ліміт AI. Стандартна для акаунта: {defaultLimit}. Приблизно 100–200 одиниць коштує одна генерація всіх чотирьох форматів.
        Лічильник скидається щодня опівночі за UTC.
      </p>

      {error && <p className="notice-bad mt-5 whitespace-pre-line rounded-2xl px-4 py-3 text-sm">{error}</p>}

      <div className="mt-6 space-y-3">
        {loading && items.length === 0 && (
          <>
            <div className="shimmer h-[116px] w-full rounded-2xl" />
            <div className="shimmer h-[116px] w-full rounded-2xl" />
          </>
        )}
        {items.map((user) => {
          const draft = drafts[user.id] ?? String(user.quota)
          const parsed = Number(draft)
          const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 10000
          const changed = valid && Math.round(parsed) !== user.quota
          const percent = user.quota > 0 ? Math.min(100, Math.round((user.used / user.quota) * 100)) : 100
          return (
            <div key={user.id} className="card px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="min-w-0 truncate font-semibold tracking-tight">{user.email}</p>
                {user.role === 'admin' && <span className="tag">Адмін</span>}
                {user.id === currentId && <span className="tag">Це ви</span>}
                {user.customQuota && <span className="tag">Своя квота</span>}
              </div>
              <p className="mt-1 text-xs text-muted">
                Створено {formatDate(user.createdAt)} · Останній вхід {user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'} · Матеріалів: {user.documents}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <div className="bar w-32 sm:w-44" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="bar-fill" style={{ width: `${percent}%` }} />
                </div>
                <span>
                  Сьогодні: {user.used} із {user.quota} · {user.tokens.toLocaleString('uk-UA')} токенів
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10000}
                  step={50}
                  value={draft}
                  onChange={(event) => setDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                  aria-label={`Квота для ${user.email}`}
                  className="w-28 rounded-xl border border-line-strong bg-surface px-3 py-2 text-base outline-none transition focus:border-fg sm:text-sm"
                />
                <button type="button" onClick={() => save(user, Math.round(parsed))} disabled={!changed || saving === user.id} className="btn btn-primary btn-sm">
                  {saving === user.id && <span className="spinner" />}
                  Зберегти
                </button>
                {user.customQuota && (
                  <button type="button" onClick={() => save(user, null)} disabled={saving === user.id} className="btn btn-ghost btn-sm">
                    Стандартна
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
