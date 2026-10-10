import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { ALL_TYPES, HARD_LIMIT, MIN_CHARS, QUESTION_OPTIONS, SOFT_LIMIT, TYPE_LABELS, availableTabs, countWords, estimateTokens, formatDate, request } from './lib/api'
import type { Doc, GenType, GenerateResponse, HistoryDetail, HistoryItem, UsageInfo } from './lib/api'
import { SAMPLE_TEXT } from './lib/sample'
import { ACCEPT, extractFileText } from './lib/files'
import { Icon } from './components/Icons'
import type { IconName } from './components/Icons'
import SummaryView from './components/SummaryView'
import QuizView from './components/QuizView'
import TermsView from './components/TermsView'
import RetellingView from './components/RetellingView'

type Theme = 'light' | 'dark'

interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const DRAFT_KEY = 'astraxes:draft'
const THEME_KEY = 'astraxes:theme'
const TYPE_ICONS: Record<GenType, IconName> = { summary: 'doc', retelling: 'lines', test: 'check-list', terms: 'tag' }
const STEP_LABELS: Record<GenType, string> = {
  summary: 'Складаю конспект',
  retelling: 'Пишу переказ',
  test: 'Готую тест',
  terms: 'Виділяю терміни'
}

function loadDraft(): { title: string; text: string; questionCount: number } {
  const empty = { title: '', text: '', questionCount: QUESTION_OPTIONS[0] }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return empty
    const data = JSON.parse(raw)
    return {
      title: typeof data.title === 'string' ? data.title : '',
      text: typeof data.text === 'string' ? data.text : '',
      questionCount: QUESTION_OPTIONS.includes(data.questionCount) ? data.questionCount : QUESTION_OPTIONS[0]
    }
  } catch {
    return empty
  }
}

function initialTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'konspekt'
}

function LoadingCard({ label, step, total }: { label: string; step: number; total: number }) {
  return (
    <div className="card reveal p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="spinner" />
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted">
            Крок {step + 1} з {total} · зазвичай 10–30 секунд
          </p>
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <div className="shimmer h-7 w-2/3" />
        <div className="shimmer h-4 w-full" />
        <div className="shimmer h-4 w-11/12" />
        <div className="shimmer h-4 w-4/5" />
        <div className="shimmer mt-6 h-5 w-1/3" />
        <div className="shimmer h-4 w-full" />
        <div className="shimmer h-4 w-3/4" />
      </div>
    </div>
  )
}

export default function App() {
  const draft = useMemo(loadDraft, [])
  const [title, setTitle] = useState(draft.title)
  const [text, setText] = useState(draft.text)
  const [questionCount, setQuestionCount] = useState(draft.questionCount)
  const [menuOpen, setMenuOpen] = useState(false)
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null)
  const [selected, setSelected] = useState<Record<GenType, boolean>>({ summary: true, retelling: true, test: true, terms: true })
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Doc | null>(null)
  const [tab, setTab] = useState<GenType>('summary')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const resultRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const toastId = useRef(0)

  const chosenTypes = ALL_TYPES.filter((type) => selected[type])
  const chars = text.trim().length
  const words = countWords(text)
  const canSubmit = !loading && chars >= MIN_CHARS && chosenTypes.length > 0
  const isLong = chars > SOFT_LIMIT
  const steps = useMemo(
    () => ['Аналізую текст', ...(isLong ? ['Стискаю великий текст по частинах'] : []), ...chosenTypes.map((type) => STEP_LABELS[type])],
    [selected, isLong]
  )

  const notify = useCallback((message: string, action?: Toast['action']) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev.slice(-2), { id, text: message, action }])
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), action || message.length > 60 ? 5000 : 3200)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#08080a' : '#fafafa')
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      return
    }
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, text, questionCount }))
    } catch {
      return
    }
  }, [title, text, questionCount])

  useEffect(() => {
    if (!loading) return
    const timer = setInterval(() => setStep((prev) => Math.min(prev + 1, steps.length - 1)), 3500)
    return () => clearInterval(timer)
  }, [loading, steps.length])

  useEffect(() => {
    if (confirmId === null) return
    const timer = setTimeout(() => setConfirmId(null), 3000)
    return () => clearTimeout(timer)
  }, [confirmId])

  const loadHistory = useCallback(async () => {
    try {
      const data = await request<{ items: HistoryItem[] }>('/api/history?limit=50')
      setHistory(data.items)
      setHistoryError(null)
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Не вдалося завантажити історію')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const loadUsage = useCallback(async () => {
    try {
      setUsageInfo(await request<UsageInfo>('/api/usage'))
    } catch {
      setUsageInfo(null)
    }
  }, [])

  useEffect(() => {
    loadUsage()
  }, [loadUsage])

  const showDoc = (doc: Doc) => {
    const tabs = availableTabs(doc.results)
    setCurrent(doc)
    setTab(tabs[0] ?? 'summary')
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const handleGenerate = async () => {
    if (!canSubmit) return
    setLoading(true)
    setStep(0)
    setError(null)
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    try {
      const data = await request<GenerateResponse>('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() || undefined, text, types: chosenTypes, questionCount: selected.test ? questionCount : undefined })
      })
      showDoc({
        id: data.documentId,
        title: data.title,
        results: data.results,
        errors: data.errors,
        condensed: data.condensed,
        chunks: data.chunks,
        usage: data.usage
      })
      loadHistory()
      loadUsage()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося виконати генерацію')
      loadUsage()
    } finally {
      setLoading(false)
    }
  }

  const clearInput = () => {
    const previous = { title, text }
    setTitle('')
    setText('')
    setError(null)
    textareaRef.current?.focus()
    notify('Поле очищено', {
      label: 'Скасувати',
      run: () => {
        setTitle(previous.title)
        setText(previous.text)
      }
    })
  }

  const pasteText = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (!value.trim()) {
        notify('Буфер обміну порожній')
        return
      }
      setText(value.slice(0, HARD_LIMIT))
      notify('Текст вставлено')
    } catch {
      notify('Немає доступу до буфера обміну')
    }
  }

  const readFile = async (file: File) => {
    setReading(true)
    try {
      const { text: content, note } = await extractFileText(file)
      if (!content) {
        notify('У файлі не знайдено тексту. Якщо там лише зображення, обробити їх неможливо')
        return
      }
      setText(content.slice(0, HARD_LIMIT))
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 120))
      const parts = [`Завантажено: ${file.name}`]
      if (content.length > HARD_LIMIT) parts.push(`використано перші ${HARD_LIMIT} символів`)
      if (note) parts.push(note)
      notify(parts.join(' · '))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не вдалося прочитати файл')
    } finally {
      setReading(false)
    }
  }

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await readFile(file)
  }

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      await readFile(file)
      return
    }
    const dropped = event.dataTransfer.getData('text')
    if (dropped.trim()) setText(dropped.slice(0, HARD_LIMIT))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      handleGenerate()
    }
  }

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value)
      notify(message)
    } catch {
      notify('Не вдалося скопіювати')
    }
  }

  const downloadSummary = () => {
    if (!current?.results.summary) return
    const blob = new Blob([current.results.summary], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugify(current.title)}.md`
    link.click()
    URL.revokeObjectURL(url)
    notify('Файл збережено')
  }

  const openHistory = async (id: number) => {
    setOpeningId(id)
    try {
      const data = await request<HistoryDetail>(`/api/history/${id}`)
      showDoc({ id: data.id, title: data.title, results: data.results })
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Не вдалося відкрити запис')
    } finally {
      setOpeningId(null)
    }
  }

  const removeHistory = async (id: number) => {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    setConfirmId(null)
    try {
      await request<{ deleted: number }>(`/api/history/${id}`, { method: 'DELETE' })
      setHistory((prev) => prev.filter((item) => item.id !== id))
      setCurrent((prev) => (prev && prev.id === id ? null : prev))
      notify('Запис видалено')
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Не вдалося видалити запис')
    }
  }

  const toggleType = (type: GenType) => setSelected((prev) => ({ ...prev, [type]: !prev[type] }))

  const tabs = current ? availableTabs(current.results) : []
  const failed = current?.errors ? (Object.entries(current.errors) as [GenType, string][]) : []
  const visibleHistory = history.filter((item) => item.title.toLowerCase().includes(query.trim().toLowerCase()))
  const progress = Math.min(100, (chars / HARD_LIMIT) * 100)
  const usagePercent = usageInfo ? Math.min(100, Math.round((usageInfo.used / usageInfo.limit) * 100)) : 0

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-inv text-sm font-bold text-inv-fg">A</span>
            Astraxes AI
          </a>
          <nav className="flex items-center gap-1">
            <a href="#workspace" className="nav-link hidden sm:inline-flex">
              Кабінет
            </a>
            <a href="#history" className="nav-link hidden sm:inline-flex">
              Історія
            </a>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className="icon-btn ml-1"
              aria-label={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="icon-btn sm:hidden"
              aria-label="Меню"
              aria-expanded={menuOpen}
            >
              <Icon name={menuOpen ? 'x' : 'menu'} className="h-5 w-5" />
            </button>
          </nav>
        </div>
        {menuOpen && (
          <div className="reveal border-t border-line sm:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col px-3 py-2">
              {[
                ['#workspace', 'Кабінет'],
                ['#history', 'Історія']
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-3.5 text-base font-medium text-muted transition hover:bg-surface2 hover:text-fg"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main>
        <section id="top" className="relative overflow-hidden">
          <div className="grid-bg absolute inset-0" />
          <div className="aurora" />
          <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-12 text-center sm:pb-28 sm:pt-24">
            <span className="pill reveal">
              <span className="pill-dot" />
              Astraxes — AI Study Assistant
            </span>
            <h1 className="reveal mt-7 text-[2.35rem] font-semibold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl" style={{ animationDelay: '80ms' }}>
              Конспекти, тести
              <br />й терміни <span className="font-display font-normal italic">за секунди</span>
            </h1>
            <p className="reveal mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg" style={{ animationDelay: '160ms' }}>
              Вставте текст параграфа чи лекції, і Astraxes складе чіткий конспект, тест для самоперевірки та словник ключових термінів. Без реєстрації.
            </p>
            <div className="reveal mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '240ms' }}>
              <a href="#workspace" className="btn btn-primary">
                Почати роботу
                <Icon name="arrow" />
              </a>
            </div>

            <div className="reveal mx-auto mt-16 max-w-2xl text-left" style={{ animationDelay: '340ms' }}>
              <div className="rounded-3xl bg-inv p-6 text-inv-fg shadow-lg-soft ring-1 ring-inv-line sm:p-8">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-inv-muted/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-inv-muted/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-inv-muted/25" />
                </div>
                <div className="mt-5 space-y-2.5 text-sm leading-relaxed">
                  <p className="text-xl font-semibold tracking-tight">Фотосинтез</p>
                  <p className="pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-inv-muted">Ключові поняття</p>
                  <p className="font-semibold">Визначення</p>
                  <p className="text-inv-muted">— Процес утворення органічних речовин на світлі.</p>
                  <p className="text-inv-muted">
                    — Відбувається в хлоропластах клітин рослин
                    <span className="cursor" />
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workspace" className="mx-auto max-w-4xl scroll-mt-20 px-5 pb-16 sm:pb-24">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Кабінет</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Вставте текст, <span className="font-display font-normal italic">решту зробить Astraxes</span>
          </h2>

          <div
            className={`input-shell mt-8 ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="px-6 pt-6 sm:px-8 sm:pt-7">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Назва (необов’язково)"
                aria-label="Назва"
                className="shell-input text-lg font-medium tracking-tight"
              />
            </div>
            <div className="mx-6 mt-4 h-px bg-inv-line sm:mx-8" />
            <div className="px-6 pt-4 sm:px-8">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                maxLength={HARD_LIMIT}
                rows={8}
                aria-label="Вихідний текст"
                placeholder="Вставте сюди текст параграфа, статті або лекції. Також можна перетягнути файл: PDF, Word, презентацію (.pptx), .txt чи .md"
                className="shell-input resize-none text-base leading-relaxed sm:min-h-[15rem] sm:text-[15px]"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={reading} className="tool" aria-label="Завантажити файл" title="Завантажити файл">
                  {reading ? <span className="spinner" /> : <Icon name="upload" />}
                  <span className={reading ? '' : 'hidden sm:inline'}>{reading ? 'Читаю файл…' : 'Файл'}</span>
                </button>
                <button type="button" onClick={pasteText} className="tool" aria-label="Вставити з буфера обміну" title="Вставити з буфера обміну">
                  <Icon name="paste" />
                  <span className="hidden sm:inline">Вставити</span>
                </button>
                <button type="button" onClick={() => setText(SAMPLE_TEXT)} className="tool" aria-label="Вставити приклад" title="Вставити приклад">
                  <Icon name="sparkles" />
                  <span className="hidden sm:inline">Приклад</span>
                </button>
                <button type="button" onClick={clearInput} disabled={!text && !title} className="tool" aria-label="Очистити поле" title="Очистити поле">
                  <Icon name="trash" />
                  <span className="hidden sm:inline">Очистити</span>
                </button>
                <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFileChange} className="hidden" />
              </div>
              <p className="text-xs text-inv-muted">
                {words} слів · {chars} символів · ≈ {estimateTokens(chars).toLocaleString('uk-UA')} токенів
                {chars > 0 && chars < MIN_CHARS && <span> · ще {MIN_CHARS - chars}</span>}
                {isLong && <span> · великий текст: буде стиснуто по частинах</span>}
              </p>
            </div>
            <div className="shell-bar">
              <div style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex flex-wrap gap-2">
                {ALL_TYPES.map((type) => (
                  <button key={type} type="button" aria-pressed={selected[type]} onClick={() => toggleType(type)} className="chip">
                    <Icon name={selected[type] ? 'check' : TYPE_ICONS[type]} className="h-3.5 w-3.5" />
                    {TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
              {selected.test && (
                <div className="reveal flex items-center gap-2.5">
                  <span className="text-xs text-muted">Питань у тесті</span>
                  <div role="radiogroup" aria-label="Кількість питань у тесті" className="seg">
                    {QUESTION_OPTIONS.map((count) => (
                      <button key={count} type="button" role="radio" aria-checked={questionCount === count} onClick={() => setQuestionCount(count)}>
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-4">
              <button type="button" onClick={handleGenerate} disabled={!canSubmit} className="btn btn-primary w-full sm:w-auto">
                {loading ? <span className="spinner" /> : <Icon name="sparkles" />}
                {loading ? 'Генерація…' : 'Згенерувати'}
              </button>
            </div>
            {usageInfo && (
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted">
                <span>Ліміт AI на сьогодні</span>
                <div className="bar w-28 sm:w-40" role="progressbar" aria-valuenow={usagePercent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="bar-fill" style={{ width: `${usagePercent}%` }} />
                </div>
                <span>
                  {usagePercent}% · {usageInfo.tokens.toLocaleString('uk-UA')} токенів
                </span>
                {!usageInfo.serviceAvailable && <span className="w-full text-right text-bad">Сервіс вичерпав добову квоту AI, спробуйте пізніше</span>}
              </div>
            )}
          </div>

          {error && (
            <p className="notice-bad reveal mt-5 whitespace-pre-line rounded-2xl px-4 py-3 text-sm">{error}</p>
          )}

          <div ref={resultRef} className="mt-10 scroll-mt-24">
            {loading && <LoadingCard label={steps[Math.min(step, steps.length - 1)]} step={Math.min(step, steps.length - 1)} total={steps.length} />}

            {!loading && current && (
              <div className="card reveal p-4 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Результат</p>
                    <h3 className="mt-1.5 text-2xl font-semibold tracking-tight">{current.title}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tab === 'summary' && current.results.summary !== undefined && (
                      <>
                        <button type="button" onClick={() => copyText(current.results.summary ?? '', 'Конспект скопійовано')} className="btn btn-ghost btn-sm">
                          <Icon name="copy" className="h-3.5 w-3.5" />
                          Копіювати
                        </button>
                        <button type="button" onClick={downloadSummary} className="btn btn-ghost btn-sm">
                          <Icon name="download" className="h-3.5 w-3.5" />
                          .md
                        </button>
                      </>
                    )}
                    {tab === 'retelling' && current.results.retelling !== undefined && (
                      <button type="button" onClick={() => copyText(current.results.retelling ?? '', 'Переказ скопійовано')} className="btn btn-ghost btn-sm">
                        <Icon name="copy" className="h-3.5 w-3.5" />
                        Копіювати
                      </button>
                    )}
                    {tab === 'terms' && current.results.terms !== undefined && (
                      <button
                        type="button"
                        onClick={() => copyText((current.results.terms ?? []).map((item) => `${item.term} — ${item.definition}`).join('\n'), 'Терміни скопійовано')}
                        className="btn btn-ghost btn-sm"
                      >
                        <Icon name="copy" className="h-3.5 w-3.5" />
                        Копіювати все
                      </button>
                    )}
                  </div>
                </div>

                {current.condensed && (
                  <p className="notice-warn mt-5 rounded-2xl px-4 py-3 text-sm text-muted">
                    Великий текст оброблено по частинах ({current.chunks}), а результат побудовано за стислими нотатками. Так витрачається менше токенів.
                  </p>
                )}
                {failed.length > 0 && (
                  <div className="notice-warn mt-5 whitespace-pre-line rounded-2xl px-4 py-3 text-sm">
                    <p>Не вдалося отримати: {failed.map(([type]) => TYPE_LABELS[type]).join(', ')}. Спробуйте згенерувати ще раз.</p>
                    {failed.map(([type, message]) => (
                      <p key={type} className="mt-2 text-xs text-muted">
                        {TYPE_LABELS[type]}: {message}
                      </p>
                    ))}
                  </div>
                )}

                <div className="mt-6 overflow-x-auto">
                  <div role="tablist" className="seg seg-block">
                    {tabs.map((type) => (
                      <button key={type} type="button" role="tab" aria-selected={tab === type} onClick={() => setTab(type)}>
                        <Icon name={TYPE_ICONS[type]} className="h-3.5 w-3.5" />
                        {TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>

                <div key={tab} className="reveal mt-7">
                  {tab === 'summary' && current.results.summary !== undefined && <SummaryView markdown={current.results.summary} />}
                  {tab === 'retelling' && current.results.retelling !== undefined && <RetellingView text={current.results.retelling} />}
                  {tab === 'test' && current.results.test !== undefined && <QuizView key={current.id} questions={current.results.test} />}
                  {tab === 'terms' && current.results.terms !== undefined && <TermsView terms={current.results.terms} />}
                </div>

                {current.usage && (
                  <p className="mt-8 border-t border-line pt-4 text-xs text-muted">
                    Використано ≈ {current.usage.totalTokens.toLocaleString('uk-UA')} токенів (вхід {current.usage.promptTokens.toLocaleString('uk-UA')}, вихід{' '}
                    {current.usage.completionTokens.toLocaleString('uk-UA')}) · {current.usage.modelCalls} запитів до моделі
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section id="history" className="mx-auto max-w-4xl scroll-mt-20 px-5 pb-20 sm:pb-28">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Історія</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Ваші <span className="font-display font-normal italic">матеріали</span>
              </h2>
            </div>
            {history.length > 4 && (
              <label className="relative block w-full sm:w-64">
                <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Пошук за назвою"
                  className="w-full rounded-full border border-line-strong bg-surface py-2.5 pl-10 pr-4 text-base outline-none transition focus:border-fg sm:text-sm"
                />
              </label>
            )}
          </div>

          <div className="mt-8 space-y-3">
            {historyLoading && (
              <>
                <div className="shimmer h-[74px] w-full rounded-2xl" />
                <div className="shimmer h-[74px] w-full rounded-2xl" />
              </>
            )}
            {historyError && <p className="notice-bad whitespace-pre-line rounded-2xl px-4 py-3 text-sm">{historyError}</p>}
            {!historyLoading && !historyError && history.length === 0 && (
              <div className="rounded-3xl border border-dashed border-line-strong px-6 py-14 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-surface2 text-muted">
                  <Icon name="clock" className="h-5 w-5" />
                </span>
                <p className="mt-4 font-semibold tracking-tight">Поки що порожньо</p>
                <p className="mt-1 text-sm text-muted">Згенеровані конспекти й тести з’являться тут.</p>
              </div>
            )}
            {!historyLoading && history.length > 0 && visibleHistory.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">Нічого не знайдено за запитом «{query}»</p>
            )}
            {visibleHistory.map((item, index) => (
              <div
                key={item.id}
                className="card card-hover reveal flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold tracking-tight">{item.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted">{formatDate(item.createdAt)}</span>
                    {item.types.map((type) => (
                      <span key={type} className="tag">
                        {TYPE_LABELS[type] ?? type}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <button type="button" onClick={() => openHistory(item.id)} disabled={openingId === item.id} className="btn btn-ghost btn-sm">
                    {openingId === item.id ? <span className="spinner" /> : null}
                    Відкрити
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistory(item.id)}
                    className={confirmId === item.id ? 'btn btn-danger btn-sm' : 'icon-btn'}
                    aria-label="Видалити запис"
                  >
                    {confirmId === item.id ? 'Підтвердити' : <Icon name="trash" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4">
        {toasts.map((item) => (
          <div key={item.id} className="toast pointer-events-auto flex items-center gap-3 rounded-full bg-inv py-2.5 pl-5 pr-3 text-sm text-inv-fg shadow-lg-soft">
            <span>{item.text}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.run()
                  setToasts((prev) => prev.filter((entry) => entry.id !== item.id))
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-inv-fg/15 px-3 py-1 text-xs font-semibold transition hover:bg-inv-fg/25"
              >
                <Icon name="undo" className="h-3 w-3" />
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
