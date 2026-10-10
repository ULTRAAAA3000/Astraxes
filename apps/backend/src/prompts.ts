import { recordUsage } from './usage'
import type { UsageTracker } from './usage'

export type GenerationType = 'summary' | 'retelling' | 'test' | 'terms'

export interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface KeyTerm {
  term: string
  definition: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast' as const
export const MAX_SOURCE_CHARS = 30000
export const MAX_RETELLING_WORDS = 150
export const MAX_THESIS_WORDS = 15
export const QUIZ_QUESTION_COUNT = 4
export const MIN_QUESTIONS = 4
export const MAX_QUESTIONS = 10
export const MAX_ATTEMPTS = 3
export const MIN_TERMS = 3
export const MAX_TERMS = 10

export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}

const BASE_RULES = `Ти — академічний асистент "Astraxes — AI Study Assistant".
Ти не імпровізуєш і працюєш строго за шаблоном.
Використовуй лише інформацію з вихідного тексту. Нічого не вигадуй і не додавай від себе.
Мова відповіді збігається з мовою вихідного тексту.
Не пиши вступів, привітань, пояснень і висновків. Видай лише результат за шаблоном.`

const SUMMARY_RULES = `${BASE_RULES}

ЗАВДАННЯ: скласти академічний конспект.

СУВОРА ІЄРАРХІЯ ЗАГОЛОВКІВ:
# Тема
## Ключові поняття
### Визначення
### Факти та дати
### Формули
### Причини та наслідки

ПРАВИЛА:
1. Рівно один заголовок першого рівня "# " з назвою теми.
2. Заголовок "## Ключові поняття" обов'язковий. Можна додавати інші "## " розділи за великими підтемами тексту.
3. Усередині кожного "## " розділу використовуй підзаголовки "### " зі списку: Визначення, Факти та дати, Формули, Причини та наслідки. Порожні підзаголовки не виводь.
4. Під кожним "### " виводь лише марковані тези, кожну з нового рядка та з префіксом "- ".
5. Довжина кожної тези — не більше ${MAX_THESIS_WORDS} слів.
6. ФІЛЬТРАЦІЯ: прибирай вступні слова, приклади, порівняння, оцінні судження та «воду». Залишай лише факти, визначення, дати, формули, причини та наслідки.
7. Не використовуй таблиці, нумеровані списки, жирний шрифт і блоки коду.`

const RETELLING_RULES = `${BASE_RULES}

ЗАВДАННЯ: скласти стислий переказ тексту.

ПРАВИЛА:
1. Переказ — зв'язний текст з 4–6 речень, не більше 120 слів.
2. Передай головну думку, ключові факти та висновок у логічному порядку.
3. Не використовуй заголовки, списки, таблиці та жирний шрифт.
4. Не додавай власних оцінок і фактів, яких немає у вихідному тексті.
5. Пиши нейтральним академічним стилем.`

function quizDistribution(count: number): { definitions: number; causal: number; facts: number } {
  const definitions = Math.round(count * 0.25)
  const facts = Math.round(count * 0.25)
  return { definitions, facts, causal: count - definitions - facts }
}

function testRules(count: number): string {
  const { definitions, causal, facts } = quizDistribution(count)
  return `${BASE_RULES}

ЗАВДАННЯ: скласти тест для самоперевірки.

ФОРМАТ ВІДПОВІДІ: строго валідний JSON-масив рівно з ${count} об'єктів. Жодного тексту до або після масиву, жодних блоків коду та markdown.

СТРУКТУРА ПИТАНЬ (кількість кожного типу, у цьому порядку):
1. Питання на визначення поняття: ${definitions}.
2. Питання на причинно-наслідковий зв'язок (чому сталося, від чого залежить, до чого призводить): ${causal}.
3. Фактичні питання (дата, число, ім'я, місце, назва): ${facts}.
Разом: ${count} питань.

ПОЛЯ КОЖНОГО ОБ'ЄКТА:
- "question": рядок з текстом питання.
- "options": масив рівно з 4 різних рядків. Без префіксів "А)", "1." тощо.
- "correctIndex": ціле число від 0 до 3, індекс правильного варіанта в "options".
- "explanation": одне коротке речення, чому відповідь правильна.

ПРАВИЛА:
1. Правильний варіант лише один, решта правдоподібні, але неправильні згідно з текстом.
2. Позицію правильного варіанта змінюй від питання до питання.
3. Усі питання лише за змістом вихідного тексту.
4. Питання не повторюються і не дублюють одне одного.

ЗРАЗОК ФОРМИ (значення заміни своїми):
[{"question":"Текст питання","options":["Варіант 1","Варіант 2","Варіант 3","Варіант 4"],"correctIndex":2,"explanation":"Коротке пояснення"}]`
}

const TERMS_RULES = `${BASE_RULES}

ЗАВДАННЯ: виділити ключові терміни.

ФОРМАТ ВІДПОВІДІ: строго валідний JSON-масив із 6–10 об'єктів. Жодного тексту до або після масиву, жодних блоків коду та markdown.

ПОЛЯ КОЖНОГО ОБ'ЄКТА:
- "term": рядок, сам термін.
- "definition": рядок, визначення терміна з тексту, не більше ${MAX_THESIS_WORDS} слів.

ПРАВИЛА:
1. Лише терміни, які є у вихідному тексті.
2. Визначення — лише факт із тексту, без прикладів і «води».
3. Терміни не повторюються.

ЗРАЗОК ФОРМИ (значення заміни своїми):
[{"term":"Термін","definition":"Коротке визначення"}]`

export function normalizeInput(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function prepareSource(text: string): string {
  const cleaned = normalizeInput(text)
  return cleaned.length > MAX_SOURCE_CHARS ? cleaned.slice(0, MAX_SOURCE_CHARS) : cleaned
}

function userPrompt(source: string): ChatMessage {
  return {
    role: 'user',
    content: `Вихідний текст:\n"""\n${source}\n"""\n\nВиконай завдання строго за шаблоном.`
  }
}

export function buildSummaryMessages(text: string): ChatMessage[] {
  return [{ role: 'system', content: SUMMARY_RULES }, userPrompt(prepareSource(text))]
}

export function buildTestMessages(text: string, count: number = QUIZ_QUESTION_COUNT): ChatMessage[] {
  return [{ role: 'system', content: testRules(count) }, userPrompt(prepareSource(text))]
}

export function buildRetellingMessages(text: string): ChatMessage[] {
  return [{ role: 'system', content: RETELLING_RULES }, userPrompt(prepareSource(text))]
}

export function buildTermsMessages(text: string): ChatMessage[] {
  return [{ role: 'system', content: TERMS_RULES }, userPrompt(prepareSource(text))]
}

export function buildMessages(type: GenerationType, text: string, count: number = QUIZ_QUESTION_COUNT): ChatMessage[] {
  if (type === 'summary') return buildSummaryMessages(text)
  if (type === 'retelling') return buildRetellingMessages(text)
  if (type === 'test') return buildTestMessages(text, count)
  return buildTermsMessages(text)
}

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```[a-zA-Z]*\s*$/gm, '')
    .trim()
}

function limitWords(value: string, max: number): string {
  const words = value.trim().split(/\s+/)
  return words.length > max ? words.slice(0, max).join(' ') : words.join(' ')
}

function extractJsonArray(raw: string): unknown {
  const cleaned = stripFences(raw).replace(/[\r\n]+/g, ' ')
  const match = /\[\s*\{/.exec(cleaned)
  if (!match) {
    throw new GenerationError('Відповідь не містить JSON-масив')
  }
  const closing = cleaned.lastIndexOf(']')
  const candidate = closing > match.index ? cleaned.slice(match.index, closing + 1) : cleaned.slice(match.index)
  const attempts = [candidate, candidate.replace(/,\s*([\]}])/g, '$1')]
  const lastBrace = candidate.lastIndexOf('}')
  if (lastBrace > 0) {
    attempts.push(`${candidate.slice(0, lastBrace + 1).replace(/,\s*$/, '')}]`)
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      continue
    }
  }
  throw new GenerationError('Відповідь містить невалідний JSON')
}

export function parseSummary(raw: string): string {
  const lines = stripFences(raw).split('\n')
  const out: string[] = []
  let h1 = 0
  let h2 = 0
  let h3 = 0
  let bullets = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (trimmed.startsWith('### ')) {
      h3++
      out.push(`### ${trimmed.slice(4).trim()}`)
    } else if (trimmed.startsWith('## ')) {
      h2++
      out.push(`## ${trimmed.slice(3).trim()}`)
    } else if (trimmed.startsWith('# ')) {
      h1++
      out.push(`# ${trimmed.slice(2).trim()}`)
    } else {
      const body = trimmed.replace(/^([-*•]\s*)+/, '').replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, '')
      if (!body) continue
      bullets++
      out.push(`- ${limitWords(body, MAX_THESIS_WORDS)}`)
    }
  }

  if (h1 !== 1) throw new GenerationError('Конспект має містити рівно один заголовок "# "')
  if (h2 < 1) throw new GenerationError('Конспект має містити розділ "## Ключові поняття"')
  if (h3 < 1) throw new GenerationError('Конспект має містити підзаголовки "### "')
  if (bullets < 3) throw new GenerationError('Конспект містить замало тез')

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function readQuestion(item: unknown, number: number): QuizQuestion {
  const label = `Питання ${number}`
  if (typeof item !== 'object' || item === null) throw new GenerationError(`${label}: неправильна структура`)
  const { question, options, correctIndex, explanation } = item as Record<string, unknown>

  if (typeof question !== 'string' || !question.trim()) throw new GenerationError(`${label}: немає поля question`)
  if (!Array.isArray(options) || options.length !== 4) throw new GenerationError(`${label}: потрібно рівно 4 варіанти`)
  if (!options.every((o) => typeof o === 'string' && o.trim())) throw new GenerationError(`${label}: варіанти мають бути непорожніми рядками`)

  const cleanOptions = (options as string[]).map((o) => o.trim())
  if (new Set(cleanOptions.map((o) => o.toLowerCase())).size !== 4) throw new GenerationError(`${label}: варіанти повторюються`)

  const index0 = typeof correctIndex === 'string' && /^[0-3]$/.test(correctIndex) ? Number(correctIndex) : correctIndex
  if (typeof index0 !== 'number' || !Number.isInteger(index0) || index0 < 0 || index0 > 3) {
    throw new GenerationError(`${label}: correctIndex має бути числом від 0 до 3`)
  }
  if (typeof explanation !== 'string' || !explanation.trim()) throw new GenerationError(`${label}: немає поля explanation`)

  return {
    question: question.trim(),
    options: cleanOptions,
    correctIndex: index0,
    explanation: explanation.trim()
  }
}

export function parseRetelling(raw: string): string {
  const cleaned = stripFences(raw)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length < 40) {
    throw new GenerationError('Переказ занадто короткий')
  }

  const words = cleaned.split(' ')
  if (words.length <= MAX_RETELLING_WORDS) return cleaned

  const clipped = words.slice(0, MAX_RETELLING_WORDS).join(' ')
  const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '))
  return lastStop > clipped.length * 0.5 ? clipped.slice(0, lastStop + 1) : `${clipped}…`
}

export function parseQuiz(raw: string, count: number = QUIZ_QUESTION_COUNT): QuizQuestion[] {
  const data = extractJsonArray(raw)
  if (!Array.isArray(data)) {
    throw new GenerationError('Відповідь не містить JSON-масив')
  }

  const questions: QuizQuestion[] = []
  const seen = new Set<string>()
  let firstProblem = ''

  data.forEach((item, index) => {
    if (questions.length >= count) return
    try {
      const question = readQuestion(item, index + 1)
      const key = question.question.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      questions.push(question)
    } catch (error) {
      if (!firstProblem && error instanceof Error) firstProblem = error.message
    }
  })

  if (questions.length < count) {
    const detail = firstProblem ? `. ${firstProblem}` : ''
    throw new GenerationError(`Тест має містити ${count} коректних питань, отримано ${questions.length}${detail}`)
  }
  return questions
}

export function parseTerms(raw: string): KeyTerm[] {
  const data = extractJsonArray(raw)
  if (!Array.isArray(data)) {
    throw new GenerationError('Відповідь не містить JSON-масив')
  }

  const seen = new Set<string>()
  const terms: KeyTerm[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const { term, definition } = item as Record<string, unknown>
    if (typeof term !== 'string' || typeof definition !== 'string' || !term.trim() || !definition.trim()) continue
    const key = term.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push({ term: term.trim(), definition: limitWords(definition, MAX_THESIS_WORDS) })
    if (terms.length === MAX_TERMS) break
  }

  if (terms.length < MIN_TERMS) {
    throw new GenerationError(`Список термінів має містити щонайменше ${MIN_TERMS} коректні елементи`)
  }
  return terms
}

function validate(type: GenerationType, raw: string, count: number): string {
  if (type === 'summary') return parseSummary(raw)
  if (type === 'retelling') return parseRetelling(raw)
  if (type === 'test') return JSON.stringify(parseQuiz(raw, count))
  return JSON.stringify(parseTerms(raw))
}

function maxTokensFor(type: GenerationType, count: number): number {
  if (type === 'summary') return 2048
  if (type === 'retelling') return 700
  if (type === 'test') return Math.min(6144, 1200 + count * 400)
  return 4096
}

export async function callModel(
  ai: Ai,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  tracker?: UsageTracker
): Promise<string> {
  const result = (await ai.run(MODEL, {
    messages,
    max_tokens: maxTokens,
    temperature
  })) as unknown as { response?: unknown }
  const raw = result?.response
  const text = raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : typeof raw === 'string' ? raw : ''
  recordUsage(tracker, result, messages.map((message) => message.content).join('\n'), text)
  if (!text.trim()) throw new GenerationError('Модель повернула порожню відповідь')
  return text
}

export async function generateContent(
  ai: Ai,
  type: GenerationType,
  text: string,
  options: { questionCount?: number; tracker?: UsageTracker } = {}
): Promise<string> {
  const count = options.questionCount ?? QUIZ_QUESTION_COUNT
  const messages = buildMessages(type, text, count)
  let lastError = 'Невідома помилка'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw = ''
    try {
      raw = await callModel(ai, messages, maxTokensFor(type, count), attempt === 1 ? 0.1 : 0.3, options.tracker)
      return validate(type, raw, count)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.error(`generate ${type} attempt ${attempt} failed: ${lastError}`, raw.slice(0, 400))
      if (raw) messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: `Попередня відповідь не пройшла перевірку: ${lastError}. Повтори відповідь строго за шаблоном, без пояснень.`
      })
    }
  }

  throw new GenerationError(`Не вдалося отримати коректну відповідь моделі: ${lastError}`)
}
