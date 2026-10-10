import { callModel } from './prompts'
import type { ChatMessage } from './prompts'
import type { UsageTracker } from './usage'

export const LONG_TEXT_CHARS = 14000
export const CHUNK_CHARS = 9000
export const MAX_CHUNKS = 10
const CONCURRENCY = 5
const FALLBACK_CHARS = 900

const CONDENSE_RULES = `Ти — академічний асистент "Astraxes — AI Study Assistant".
ЗАВДАННЯ: стисни фрагмент тексту у короткі робочі нотатки для подальшого конспекту.

ПРАВИЛА:
1. Лише факти, визначення, дати, імена, числа, причини й наслідки з фрагмента. Нічого не вигадуй.
2. Не більше 150 слів. Марковані пункти з префіксом "- ", кожен пункт не довший за 20 слів.
3. Мова відповіді збігається з мовою фрагмента.
4. Без вступів, пояснень і висновків.`

export function splitIntoChunks(text: string): string[] {
  const size = Math.max(CHUNK_CHARS, Math.ceil(text.length / MAX_CHUNKS) + 500)
  const chunks: string[] = []
  let current = ''

  const push = (piece: string) => {
    if (current && current.length + piece.length + 1 > size) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n${piece}` : piece
  }

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) continue
    if (paragraph.length <= size) {
      push(paragraph)
      continue
    }
    for (let start = 0; start < paragraph.length; start += size) {
      push(paragraph.slice(start, start + size))
    }
  }
  if (current) chunks.push(current)

  while (chunks.length > MAX_CHUNKS) {
    const last = chunks.pop() as string
    chunks[chunks.length - 1] += `\n${last}`
  }
  return chunks
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export async function condenseText(
  ai: Ai,
  text: string,
  tracker: UsageTracker
): Promise<{ text: string; chunks: number }> {
  const chunks = splitIntoChunks(text)

  const notes = await mapLimit(chunks, CONCURRENCY, async (chunk, index) => {
    const messages: ChatMessage[] = [
      { role: 'system', content: CONDENSE_RULES },
      { role: 'user', content: `Фрагмент ${index + 1} з ${chunks.length}:\n"""\n${chunk}\n"""\n\nВиконай завдання строго за правилами.` }
    ]
    try {
      const raw = await callModel(ai, messages, 500, 0.1, tracker)
      const cleaned = raw.replace(/^\s*```[a-zA-Z]*\s*$/gm, '').trim()
      return cleaned || chunk.slice(0, FALLBACK_CHARS)
    } catch (error) {
      console.error(`condense chunk ${index + 1} failed`, error)
      return chunk.slice(0, FALLBACK_CHARS)
    }
  })

  return { text: notes.join('\n\n'), chunks: chunks.length }
}
