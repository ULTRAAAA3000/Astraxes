import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { request, setToken } from '../lib/api'
import type { Account } from '../lib/api'
import { Icon } from './Icons'

type Mode = 'login' | 'register'

interface Props {
  initialMode: Mode
  onClose: () => void
  onAuthed: (user: Account) => void
}

const FIELD = 'w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-base outline-none transition focus:border-fg'

export default function AuthModal({ initialMode, onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await request<{ token: string; user: Account }>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      setToken(data.token)
      onAuthed(data.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося виконати запит')
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={isRegister ? 'Створити акаунт' : 'Вхід'} className="card reveal w-full max-w-sm p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Акаунт</p>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">{isRegister ? 'Створити акаунт' : 'Вхід'}</h2>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Закрити">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <div role="tablist" className="seg seg-block mt-5">
          <button type="button" role="tab" aria-selected={!isRegister} onClick={() => setMode('login')}>
            Вхід
          </button>
          <button type="button" role="tab" aria-selected={isRegister} onClick={() => setMode('register')}>
            Реєстрація
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            autoFocus
            required
            className={FIELD}
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isRegister ? 'Пароль (від 8 символів)' : 'Пароль'}
            aria-label="Пароль"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
            className={FIELD}
          />
          {error && <p className="notice-bad whitespace-pre-line rounded-xl px-3.5 py-2.5 text-sm">{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy && <span className="spinner" />}
            {isRegister ? 'Створити акаунт' : 'Увійти'}
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          {isRegister
            ? 'З акаунтом більший денний ліміт AI, а історія зберігається на всіх ваших пристроях. Матеріали, створені на цьому пристрої до входу, перейдуть до акаунта.'
            : 'Після входу історія й ліміт прив’язуються до вашого акаунта.'}
        </p>
      </div>
    </div>
  )
}
