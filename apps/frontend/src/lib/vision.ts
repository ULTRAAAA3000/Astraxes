import { request } from './api'
import type { Block } from './blocks'

interface VisionResponse {
  description: string
  skipped: boolean
  cached: boolean
  neurons: number
}

export interface DescribeResult {
  text: string
  recognized: number
  skipped: number
  failed: number
  stopped: string | null
}

const CONCURRENCY = 3

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export async function describeBlocks(blocks: Block[], onProgress: (done: number, total: number) => void): Promise<DescribeResult> {
  const unique = new Map<string, string>()
  for (const block of blocks) {
    if (block.type === 'image' && !unique.has(block.image.key)) unique.set(block.image.key, block.image.base64)
  }

  const entries = [...unique.entries()]
  const descriptions = new Map<string, string>()
  let done = 0
  let failed = 0
  let skipped = 0
  let stopped: string | null = null
  let next = 0
  onProgress(0, entries.length)

  const worker = async () => {
    while (next < entries.length && !stopped) {
      const [key, image] = entries[next++]
      try {
        const data = await request<VisionResponse>('/api/vision', { method: 'POST', body: JSON.stringify({ image }) })
        if (data.skipped) skipped++
        else descriptions.set(key, collapse(data.description))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не вдалося розпізнати зображення'
        if (/ліміт|квот/i.test(message)) stopped = message
        else failed++
      }
      done++
      onProgress(done, entries.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker))

  const parts: string[] = []
  const placed = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
    else if (!placed.has(block.image.key)) {
      placed.add(block.image.key)
      const description = descriptions.get(block.image.key)
      if (description) parts.push(`[Зображення: ${description}]`)
    }
  }

  const unresolved = entries.length - descriptions.size - skipped - failed
  return {
    text: parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    recognized: descriptions.size,
    skipped,
    failed: failed + Math.max(0, unresolved),
    stopped
  }
}
