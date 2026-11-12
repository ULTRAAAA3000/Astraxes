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
export const MAX_RETELLING_WORDS = 180
export const MAX_THESIS_WORDS = 25
export const MAX_FORMULA_WORDS = 45
export const QUIZ_QUESTION_COUNT = 4
export const MIN_QUESTIONS = 4
export const MAX_QUESTIONS = 10
export const MAX_ATTEMPTS = 2
export const MIN_TERMS = 3
export const MAX_TERMS = 12

export type Mode = 'low' | 'medium' | 'high'
export const MODES: Mode[] = ['low', 'medium', 'high']

interface Level {
  summaryVolume: string
  thesisWords: number
  minBullets: number
  summaryTokens: number
  retellingSentences: string
  retellingWords: number
  retellingTokens: number
  termsRange: string
  minTerms: number
  maxTerms: number
  termWords: number
  termsTokens: number
  quizStyle: string
  explanation: string
  questionTokens: number
  questionBase: number
  quizCap: number
}

const LEVELS: Record<Mode, Level> = {
  low: {
    summaryVolume:
      'СТИСЛИЙ конспект: лише найголовніше. 2–3 розділи, у кожному 2–3 короткі тези до 15 слів. Підрозділи не створюй (окрім "### Формули", якщо вони є). Приклади й другорядне пропускай.',
    thesisWords: 16,
    minBullets: 3,
    summaryTokens: 900,
    retellingSentences: '2–3 речення',
    retellingWords: 70,
    retellingTokens: 350,
    termsRange: '3–6 об\'єктів лише найголовніших понять',
    minTerms: 3,
    maxTerms: 6,
    termWords: 15,
    termsTokens: 1200,
    quizStyle: 'Питання прості: перевіряють розуміння основних понять і фактів.',
    explanation: 'одне коротке речення',
    questionTokens: 300,
    questionBase: 700,
    quizCap: 4096
  },
  medium: {
    summaryVolume:
      'ЗБАЛАНСОВАНИЙ конспект: кілька змістовних розділів, у кожному зазвичай 3–6 тез до 20 слів. Підрозділи за потреби.',
    thesisWords: 25,
    minBullets: 3,
    summaryTokens: 2500,
    retellingSentences: '4–8 речень',
    retellingWords: 180,
    retellingTokens: 900,
    termsRange: '5–12 об\'єктів, кількість обери залежно від насиченості тексту',
    minTerms: 3,
    maxTerms: 12,
    termWords: 25,
    termsTokens: 4096,
    quizStyle: 'Питання різної складності: від визначень до застосування понять.',
    explanation: 'одне-два короткі речення',
    questionTokens: 420,
    questionBase: 1200,
    quizCap: 6144
  },
  high: {
    summaryVolume:
      'ДЕТАЛЬНИЙ конспект: розгорнутий і повний. 5–10 розділів, підрозділи "### " там, де вони структурують матеріал, у кожному 4–8 тез до 35 слів. Включай визначення, причини й наслідки, умови застосування формул, винятки, порівняння, хронологію та ілюстративні приклади. Важливе не скорочуй.',
    thesisWords: 35,
    minBullets: 6,
    summaryTokens: 4096,
    retellingSentences: '8–14 речень у кількох абзацах',
    retellingWords: 320,
    retellingTokens: 1500,
    termsRange: '10–20 об\'єктів, охопи всі значущі поняття, імена, дати й формули',
    minTerms: 5,
    maxTerms: 20,
    termWords: 35,
    termsTokens: 5500,
    quizStyle: 'Питання від простих до складних: включай застосування понять, порівняння, причинно-наслідкові зв\'язки й міркування.',
    explanation: 'два-три речення: чому правильна відповідь вірна й у чому типова помилка',
    questionTokens: 560,
    questionBase: 1400,
    quizCap: 7168
  }
}

export function levelOf(mode: Mode): Level {
  return LEVELS[mode]
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GenerationError'
  }
}

const BASE_RULES = `Ти — академічний асистент "Astraxes — AI Study Assistant".
Спирайся лише на вихідний текст: не вигадуй фактів, дат, імен і чисел, яких там немає.
Сам вирішуй, що в тексті головне, як це краще структурувати і яку глибину обрати. Підлаштовуйся під тип тексту: визначення, хронологія, формули, опис процесу чи аргументація.
ВАЖЛИВІСТЬ: уважно оціни, що в тексті найважливіше для розуміння теми: закони, правила, формули, визначення, ключові дати та причинно-наслідкові зв'язки. Їм приділяй найбільше уваги й місця. Другорядні подробиці, приклади й відступи скорочуй або пропускай.
ФОРМУЛИ: якщо в тексті є формули, рівняння, закони чи обчислення, обов'язково включай їх у результат точно так, як у тексті, нічого не змінюючи й не округлюючи. Біля формули коротко поясни, що означають її величини й коли її застосовують. Записуй формули звичайним текстом і символами Unicode (наприклад: E = mc², a² + b² = c², v = s / t, x₁ + x₂ = −b / a). Не використовуй LaTeX, символ "\\" і знак "$".
Пиши природно й по суті, як уважний викладач. Не копіюй речення з тексту дослівно без потреби.
Фрагменти у квадратних дужках "[Зображення: …]" — це описи ілюстрацій, схем, таблиць і фото з документа в тому місці, де вони стоять. Вважай їх повноцінною частиною тексту: використовуй дані з них, формули й підписи, але не згадуй слова "зображення" без потреби.
Мова відповіді збігається з мовою вихідного тексту.
Не пиши вступів, привітань і зайвих пояснень. Видай лише результат у потрібному форматі.`

function summaryRules(mode: Mode): string {
  return `${BASE_RULES}

ЗАВДАННЯ: скласти академічний конспект.

СТРУКТУРА:
# Тема: один заголовок із назвою теми.
## Розділи: кілька змістовних розділів за підтемами тексту. Якщо доречно, перший розділ — "Ключові поняття".
### Підрозділи: за потреби, з назвами, що підходять до змісту (наприклад Визначення, Хронологія, Формули, Причини та наслідки, Етапи). Не створюй порожніх підрозділів.

ОБСЯГ: ${LEVELS[mode].summaryVolume}

ПРАВИЛА:
1. Рівно один заголовок "# " і щонайменше один "## ".
2. Під заголовками — марковані тези з префіксом "- ", кожна з нового рядка.
3. Теза — одна завершена думка, до ${LEVELS[mode].thesisWords} слів. Краще чітке речення, ніж обірване.
4. Залишай головне: визначення, факти, дати, формули, причини та наслідки, важливі зв'язки між поняттями. Прибирай воду й повтори.
5. Розташовуй матеріал за важливістю: найважливіше вище, на нього віддай більше тез. Другорядне стисни до однієї тези або пропусти.
6. Кожну формулу з тексту винеси в окрему тезу у вигляді "- Формула: E = mc² — пояснення величин і сенсу" (до 40 слів). Якщо формул кілька, зроби підрозділ "### Формули". Жодну формулу не пропускай.
7. Короткий приклад чи порівняння можна залишити, якщо він допомагає зрозуміти суть.
8. Не використовуй таблиці, нумеровані списки, жирний шрифт і блоки коду.`
}

function retellingRules(mode: Mode): string {
  return `${BASE_RULES}

ЗАВДАННЯ: скласти стислий переказ тексту.

ПРАВИЛА:
1. Зв'язний текст із ${LEVELS[mode].retellingSentences}, не більше ${LEVELS[mode].retellingWords} слів.
2. Передай головну думку, ключові факти та висновок у логічному порядку, своїми словами. Найважливішому дай більше місця, другорядне опусти.
3. Якщо в тексті є ключова формула чи закон, наведи її в переказі точно, із коротким поясненням.
4. Без заголовків, списків, таблиць і жирного шрифту.
5. Не додавай власних оцінок і фактів, яких немає у вихідному тексті.
6. Стиль нейтральний, живий, зрозумілий учневі.`
}

function testRules(count: number, mode: Mode): string {
  return `${BASE_RULES}

ЗАВДАННЯ: скласти тест для самоперевірки.

ФОРМАТ ВІДПОВІДІ: строго валідний JSON-масив рівно з ${count} об'єктів. Жодного тексту до або після масиву, жодних блоків коду та markdown.

ЗМІСТ ПИТАНЬ:
- Перевіряй розуміння найважливішого в тексті, а не дрібниць. Чим важливіша тема, тим більше питань про неї.
- Якщо в тексті є формули, обов'язково додай питання на формули: яка формула описує закон, що означає величина, який результат за підстановки чисел, як виразити одну величину через іншу. Формули в питаннях і варіантах записуй точно за текстом, звичайним текстом із символами Unicode, без LaTeX і без символу "\\".
- ${LEVELS[mode].quizStyle}
- Різноманіть типи: визначення, причини й наслідки, факти (дати, числа, імена), порівняння, застосування понять. Розподіл обирай сам залежно від тексту.
- Формулюй питання по-різному, не починай усі однаково.

ПОЛЯ КОЖНОГО ОБ'ЄКТА:
- "question": рядок з текстом питання.
- "options": масив рівно з 4 різних рядків. Без префіксів "А)", "1." тощо.
- "correctIndex": ціле число від 0 до 3, індекс правильного варіанта в "options".
- "explanation": ${LEVELS[mode].explanation}, чому відповідь правильна.

ПРАВИЛА:
1. Правильний варіант лише один, решта правдоподібні (типові помилки учня), але неправильні згідно з текстом.
2. Позицію правильного варіанта змінюй від питання до питання.
3. Усі питання лише за змістом вихідного тексту.
4. Питання не повторюються і не дублюють одне одного.
5. У "explanation" для питань про формули наведи формулу та коротке пояснення, як вона застосована.

ЗРАЗОК ФОРМИ (значення заміни своїми):
[{"question":"Текст питання","options":["Варіант 1","Варіант 2","Варіант 3","Варіант 4"],"correctIndex":2,"explanation":"Коротке пояснення"}]`
}

function termsRules(mode: Mode): string {
  return `${BASE_RULES}

ЗАВДАННЯ: виділити ключові терміни.

ФОРМАТ ВІДПОВІДІ: строго валідний JSON-масив із ${LEVELS[mode].termsRange}. Жодного тексту до або після масиву, жодних блоків коду та markdown.

ПОЛЯ КОЖНОГО ОБ'ЄКТА:
- "term": рядок, сам термін, поняття або ім'я.
- "definition": рядок, пояснення за змістом тексту, одне-два речення, до ${LEVELS[mode].termWords} слів. Для формули чи закону запиши саму формулу точно за текстом, звичайним текстом із символами Unicode, і коротко поясни величини (до ${MAX_FORMULA_WORDS} слів).

ПРАВИЛА:
1. Лише те, що важливе для розуміння теми й є у вихідному тексті. Спершу найважливіші поняття.
2. Якщо в тексті є важливі формули чи закони, додай їх як окремі елементи: "term" — назва формули або закону, "definition" — формула й пояснення.
3. Пояснення своїми словами, без води.
4. Терміни не повторюються.

ЗРАЗОК ФОРМИ (значення заміни своїми):
[{"term":"Термін","definition":"Коротке визначення"}]`
}

export function normalizeInput(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function prepareSource(text: string): string {
  const cleaned = normalizeInput(text)
  return cleaned.length > MAX_SOURCE_CHARS ? cleaned.slice(0, MAX_SOURCE_CHARS) : cleaned
}

export type Material = 'source' | 'summary'

function userPrompt(source: string, material: Material = 'source'): ChatMessage {
  const label = material === 'summary' ? 'Конспект тексту (містить усі важливі факти й формули)' : 'Вихідний текст'
  return {
    role: 'user',
    content: `${label}:\n"""\n${source}\n"""\n\nВиконай завдання строго за шаблоном.`
  }
}

export function buildSummaryMessages(text: string, mode: Mode = 'medium'): ChatMessage[] {
  return [{ role: 'system', content: summaryRules(mode) }, userPrompt(prepareSource(text))]
}

export function buildTestMessages(
  text: string,
  count: number = QUIZ_QUESTION_COUNT,
  material: Material = 'source',
  mode: Mode = 'medium'
): ChatMessage[] {
  return [{ role: 'system', content: testRules(count, mode) }, userPrompt(prepareSource(text), material)]
}

export function buildRetellingMessages(text: string, material: Material = 'source', mode: Mode = 'medium'): ChatMessage[] {
  return [{ role: 'system', content: retellingRules(mode) }, userPrompt(prepareSource(text), material)]
}

export function buildTermsMessages(text: string, material: Material = 'source', mode: Mode = 'medium'): ChatMessage[] {
  return [{ role: 'system', content: termsRules(mode) }, userPrompt(prepareSource(text), material)]
}

export function buildMessages(
  type: GenerationType,
  text: string,
  count: number = QUIZ_QUESTION_COUNT,
  material: Material = 'source',
  mode: Mode = 'medium'
): ChatMessage[] {
  if (type === 'summary') return buildSummaryMessages(text, mode)
  if (type === 'retelling') return buildRetellingMessages(text, material, mode)
  if (type === 'test') return buildTestMessages(text, count, material, mode)
  return buildTermsMessages(text, material, mode)
}

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```[a-zA-Z]*\s*$/gm, '')
    .trim()
}

const FORMULA_PATTERN = /[=≈≠≤≥±×÷√∑∫∆^²³⁴°]|\d\s*[+\-*/]\s*[\d\p{L}]/u

function wordLimitFor(value: string, max: number): number {
  return FORMULA_PATTERN.test(value) ? Math.max(max, MAX_FORMULA_WORDS) : max
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

export function parseSummary(raw: string, limits: { thesisWords: number; minBullets: number } = LEVELS.medium): string {
  const lines = stripFences(raw).split('\n')
  const out: string[] = []
  let h1 = 0
  let h2 = 0
  let bullets = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (trimmed.startsWith('### ')) {
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
      out.push(`- ${limitWords(body, wordLimitFor(body, limits.thesisWords))}`)
    }
  }

  if (h1 !== 1) throw new GenerationError('Конспект має містити рівно один заголовок "# "')
  if (h2 < 1) throw new GenerationError('Конспект має містити розділ "## Ключові поняття"')
  if (bullets < limits.minBullets) throw new GenerationError('Конспект містить замало тез')

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

export function parseRetelling(raw: string, maxWords: number = MAX_RETELLING_WORDS): string {
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
  if (words.length <= maxWords) return cleaned

  const clipped = words.slice(0, maxWords).join(' ')
  const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '))
  return lastStop > clipped.length * 0.5 ? clipped.slice(0, lastStop + 1) : `${clipped}…`
}

function collectQuiz(raw: string, count: number): { questions: QuizQuestion[]; problem: string } {
  const data = extractJsonArray(raw)
  if (!Array.isArray(data)) {
    throw new GenerationError('Відповідь не містить JSON-масив')
  }

  const questions: QuizQuestion[] = []
  const seen = new Set<string>()
  let problem = ''

  data.forEach((item, index) => {
    if (questions.length >= count) return
    try {
      const question = readQuestion(item, index + 1)
      const key = question.question.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      questions.push(question)
    } catch (error) {
      if (!problem && error instanceof Error) problem = error.message
    }
  })

  return { questions, problem }
}

export function parseQuiz(raw: string, count: number = QUIZ_QUESTION_COUNT): QuizQuestion[] {
  const { questions, problem } = collectQuiz(raw, count)
  if (questions.length < count) {
    const detail = problem ? `. ${problem}` : ''
    throw new GenerationError(`Тест має містити ${count} коректних питань, отримано ${questions.length}${detail}`)
  }
  return questions
}

export function parseTerms(raw: string, level: { minTerms: number; maxTerms: number; termWords: number } = LEVELS.medium): KeyTerm[] {
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
    terms.push({ term: term.trim(), definition: limitWords(definition, wordLimitFor(definition, level.termWords)) })
    if (terms.length === level.maxTerms) break
  }

  if (terms.length < level.minTerms) {
    throw new GenerationError(`Список термінів має містити щонайменше ${level.minTerms} коректні елементи`)
  }
  return terms
}

function validate(type: GenerationType, raw: string, count: number, mode: Mode): string {
  const level = LEVELS[mode]
  if (type === 'summary') return parseSummary(raw, level)
  if (type === 'retelling') return parseRetelling(raw, level.retellingWords + Math.ceil(level.retellingWords * 0.1))
  if (type === 'test') return JSON.stringify(parseQuiz(raw, count))
  return JSON.stringify(parseTerms(raw, level))
}

function maxTokensFor(type: GenerationType, count: number, mode: Mode = 'medium'): number {
  const level = LEVELS[mode]
  if (type === 'summary') return level.summaryTokens
  if (type === 'retelling') return level.retellingTokens
  if (type === 'test') return Math.min(level.quizCap, level.questionBase + count * level.questionTokens)
  return level.termsTokens
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

async function generateQuiz(
  ai: Ai,
  text: string,
  count: number,
  material: Material,
  mode: Mode,
  tracker?: UsageTracker
): Promise<string> {
  const kept: QuizQuestion[] = []
  const known = new Set<string>()
  let lastError = 'Невідома помилка'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const missing = count - kept.length
    const messages = buildTestMessages(text, missing, material, mode)
    if (kept.length) {
      const list = kept.map((item) => `- ${item.question}`).join('\n')
      messages[1].content += `\n\nЦі питання вже складені, не повторюй їх і не дублюй їхню тему:\n${list}`
    }
    let raw = ''
    try {
      raw = await callModel(ai, messages, maxTokensFor('test', missing, mode), attempt === 1 ? 0.35 : 0.2, tracker)
      const { questions, problem } = collectQuiz(raw, missing)
      for (const question of questions) {
        const key = question.question.toLowerCase()
        if (known.has(key)) continue
        known.add(key)
        kept.push(question)
      }
      if (kept.length >= count) return JSON.stringify(kept.slice(0, count))
      lastError = `Тест має містити ${count} коректних питань, отримано ${kept.length}${problem ? `. ${problem}` : ''}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    console.error(`generate test attempt ${attempt} failed: ${lastError}`, raw.slice(0, 400))
  }

  throw new GenerationError(`Не вдалося отримати коректну відповідь моделі: ${lastError}`)
}

export async function generateContent(
  ai: Ai,
  type: GenerationType,
  text: string,
  options: { questionCount?: number; tracker?: UsageTracker; material?: Material; mode?: Mode } = {}
): Promise<string> {
  const count = options.questionCount ?? QUIZ_QUESTION_COUNT
  const material = options.material ?? 'source'
  const mode = options.mode ?? 'medium'
  if (type === 'test') return generateQuiz(ai, text, count, material, mode, options.tracker)

  const messages = buildMessages(type, text, count, material, mode)
  let lastError = 'Невідома помилка'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw = ''
    try {
      raw = await callModel(ai, messages, maxTokensFor(type, count, mode), attempt === 1 ? 0.35 : 0.2, options.tracker)
      return validate(type, raw, count, mode)
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

export type Direction = 'shorter' | 'longer'

export function countBullets(markdown: string): number {
  return markdown.split('\n').filter((line) => line.startsWith('- ')).length
}

const SHORTER_RULES = `${BASE_RULES}

ЗАВДАННЯ: скоротити готовий конспект приблизно на третину-половину, зберігши структуру й найважливіше.

ПРАВИЛА:
1. Збережи формат: рівно один заголовок "# ", розділи "## ", за потреби "### ", тези з префіксом "- ", кожна з нового рядка.
2. Прибери другорядні тези, приклади й повтори, об'єднай близькі тези. Залиш найважливіше.
3. Усі формули збережи точно як є.
4. Не додавай нових фактів. Теза — до 20 слів.
5. Не використовуй таблиці, нумеровані списки, жирний шрифт і блоки коду.`

const LONGER_RULES = `${BASE_RULES}

ЗАВДАННЯ: розширити готовий конспект, доповнивши його деталями з вихідного тексту, приблизно в 1,5–2 рази більше.

ПРАВИЛА:
1. Збережи формат: рівно один заголовок "# ", розділи "## ", за потреби "### ", тези з префіксом "- ", кожна з нового рядка.
2. Збережи наявні тези й формули. Додай пропущене важливе: визначення, причини й наслідки, умови застосування, винятки, пояснення формул, хронологію, короткі приклади.
3. Додавай лише те, що є у вихідному тексті.
4. Теза — до 35 слів.
5. Не використовуй таблиці, нумеровані списки, жирний шрифт і блоки коду.`

export async function adjustSummary(
  ai: Ai,
  direction: Direction,
  summary: string,
  source: string,
  tracker: UsageTracker
): Promise<string> {
  const before = countBullets(summary)
  const shorter = direction === 'shorter'
  const messages: ChatMessage[] = [
    { role: 'system', content: shorter ? SHORTER_RULES : LONGER_RULES },
    {
      role: 'user',
      content: shorter
        ? `Конспект:\n"""\n${summary}\n"""\n\nСкороти конспект за правилами.`
        : `Вихідний текст:\n"""\n${prepareSource(source)}\n"""\n\nПоточний конспект:\n"""\n${summary}\n"""\n\nРозшир конспект за правилами.`
    }
  ]
  const limits = shorter ? LEVELS.medium : LEVELS.high
  let lastError = 'Невідома помилка'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw = ''
    try {
      raw = await callModel(ai, messages, shorter ? LEVELS.medium.summaryTokens : LEVELS.high.summaryTokens, attempt === 1 ? 0.3 : 0.2, tracker)
      const result = parseSummary(raw, { thesisWords: limits.thesisWords, minBullets: 3 })
      const after = countBullets(result)
      if (shorter && after >= before) throw new GenerationError('Модель не скоротила конспект')
      if (!shorter && after <= before) throw new GenerationError('Модель не розширила конспект')
      return result
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.error(`adjust ${direction} attempt ${attempt} failed: ${lastError}`, raw.slice(0, 400))
      if (raw) messages.push({ role: 'assistant', content: raw })
      messages.push({ role: 'user', content: `Відповідь не підійшла: ${lastError}. Повтори завдання, дотримуючись правил.` })
    }
  }

  throw new GenerationError(`Не вдалося змінити конспект: ${lastError}`)
}
