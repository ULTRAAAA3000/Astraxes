import { IMAGE_TOKEN_ESTIMATE, VISION_RATES, recordUsage } from './usage'
import type { UsageTracker } from './usage'

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
export const MAX_IMAGE_BASE64 = 2_000_000
const MAX_DESCRIPTION_CHARS = 1800
const JPEG_PREFIX = '/9j/'

const VISION_PROMPT = `Ти — академічний асистент "Astraxes — AI Study Assistant". Опиши зображення з навчального документа так, щоб його зміст можна було використати в конспекті без самої картинки.

ПРАВИЛА:
1. Якщо є текст — перепиши його повністю й точно, нічого не виправляючи.
2. Формули й рівняння запиши точно звичайним текстом із символами Unicode (E = mc², a² + b² = c²), без LaTeX.
3. Для схеми, графіка, таблиці чи діаграми коротко опиши структуру, підписи, числа й головний висновок.
4. Якщо це декор, логотип, фон або фото без навчального змісту — відповідай рівно одним словом: ПРОПУСТИТИ.
5. Лише те, що видно на зображенні. Нічого не вигадуй, без вступів і оцінок.
6. Мова відповіді збігається з мовою тексту на зображенні, а без тексту — українська. Не більше 200 слів.`

export function validImage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 200 &&
    value.length <= MAX_IMAGE_BASE64 &&
    value.startsWith(JPEG_PREFIX) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

type Runner = (model: string, input: unknown) => Promise<unknown>

let licenseAccepted = false

function cleanDescription(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text || /^[\s"'«]*ПРОПУСТИТИ(?![\p{L}])/iu.test(text)) return ''
  return text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS).trim()}…` : text
}

export async function describeImage(ai: Ai, base64: string, tracker: UsageTracker): Promise<string> {
  const run = ((ai as unknown as { run: Runner }).run).bind(ai) as Runner
  const input = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ],
    max_tokens: 450,
    temperature: 0.1
  }

  let result: unknown
  try {
    result = await run(VISION_MODEL, input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (licenseAccepted || !/agree|licen|5016/i.test(message)) throw error
    await run(VISION_MODEL, { prompt: 'agree' })
    licenseAccepted = true
    result = await run(VISION_MODEL, input)
  }

  const raw = (result as { response?: unknown } | null)?.response
  const text = raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : typeof raw === 'string' ? raw : ''
  recordUsage(tracker, result, VISION_PROMPT, text, VISION_RATES, IMAGE_TOKEN_ESTIMATE)
  if (!text.trim()) throw new Error('Модель повернула порожню відповідь')
  return cleanDescription(text)
}
