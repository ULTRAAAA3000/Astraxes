import { useEffect } from 'react'
import { Icon } from './Icons'

interface Props {
  estimate: number
  medium: number
  low: number
  limit: number | null
  used: number | null
  onConfirm: () => void
  onSwitch: () => void
  onCancel: () => void
}

function format(value: number): string {
  return value.toLocaleString('uk-UA')
}

function times(value: number, base: number): string {
  if (base <= 0) return '—'
  const ratio = value / base
  return `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace('.', ',')}`
}

export default function ModeWarning({ estimate, medium, low, limit, used, onConfirm, onSwitch, onCancel }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null
  const share = limit ? Math.round((estimate / limit) * 100) : null
  const tooMuch = remaining !== null && estimate > remaining

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="mode-warning-title" className="card reveal w-full max-w-md border-2 border-bad p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-bad text-white">
            <Icon name="alert" className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bad">Увага</p>
            <h2 id="mode-warning-title" className="mt-1 text-2xl font-semibold leading-tight tracking-tight">
              Високий режим витрачає значно більше токенів
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted">
          Конспект, пересказ і терміни будуть набагато докладнішими, а тому модель напише набагато більше тексту. Витрата токенів суттєво зросте порівняно з іншими режимами, оцінку наведено нижче.
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-line-strong text-sm">
          <div className="flex items-center justify-between bg-bad/10 px-4 py-3 font-semibold">
            <span>Високий (цей запит)</span>
            <span>
              ≈ {format(estimate)} од.
              {share !== null && <span className="ml-1 text-bad">({share}% дня)</span>}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-muted">
            <span>Середній</span>
            <span>
              ≈ {format(medium)} од. · високий {times(estimate, medium)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-muted">
            <span>Низький</span>
            <span>
              ≈ {format(low)} од. · високий {times(estimate, low)}
            </span>
          </div>
        </div>

        {remaining !== null && (
          <p className={`mt-4 rounded-xl px-3.5 py-2.5 text-sm ${tooMuch ? 'notice-bad' : 'notice-warn'}`}>
            {tooMuch
              ? `Сьогодні залишилось ≈ ${format(remaining)} од. Цього не вистачить на весь запит, тож генерація може не завершитися.`
              : `Сьогодні залишилось ≈ ${format(remaining)} од. ліміту.`}
          </p>
        )}

        <p className="mt-3 text-xs text-soft">Оцінка орієнтовна: фактичну витрату буде показано після генерації.</p>

        <div className="mt-6 flex flex-col gap-2.5">
          <button type="button" onClick={onSwitch} autoFocus className="btn btn-primary w-full">
            Перейти на середній
          </button>
          <button type="button" onClick={onConfirm} className="btn btn-danger w-full">
            Все одно генерувати
          </button>
          <button type="button" onClick={onCancel} className="btn btn-ghost w-full">
            Скасувати
          </button>
        </div>
      </div>
    </div>
  )
}
