import { MAX_IMAGES, countImages, visibleChars } from './blocks'
import type { Block, FileBlocks, PreparedImage } from './blocks'
import { prepareRegion } from './images'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>

export class PdfTextError extends Error {}

interface Line {
  y: number
  text: string
}

interface Placed {
  top: number
  image: PreparedImage
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
  top: number
}

const MAX_PAGES = 300
const MAX_CHARS = 90000
const MIN_PAGE_CHARS = 10
const MIN_TOTAL_CHARS = 30
const TARGET_WIDTH = 1400
const MIN_RECT_SIDE = 80
const MIN_RECT_SHARE = 0.02

function visibleLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

function pageLines(items: Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>): Line[] {
  const lines: Line[] = []
  let current: Line | null = null
  let lastY: number | null = null
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.transform) continue
    const y = item.transform[5]
    if (!current || lastY === null || Math.abs(y - lastY) > 2) {
      current = { y, text: '' }
      lines.push(current)
    }
    current.text += item.str
    lastY = y
    if (item.hasEOL) {
      current = null
      lastY = null
    }
  }
  return lines.map((line) => ({ y: line.y, text: line.text.trim() })).filter((line) => line.text)
}

function imageRects(pdfjs: PdfJs, operators: { fnArray: number[]; argsArray: unknown[] }, viewport: { transform: number[]; width: number; height: number }): Rect[] {
  const { OPS, Util } = pdfjs
  let matrix = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  const found: Rect[] = []
  const pageArea = viewport.width * viewport.height

  operators.fnArray.forEach((op, index) => {
    const args = operators.argsArray[index] as unknown[] | null
    if (op === OPS.save) stack.push(matrix)
    else if (op === OPS.restore) matrix = stack.pop() ?? matrix
    else if (op === OPS.transform && Array.isArray(args)) matrix = Util.transform(matrix, args as number[])
    else if (op === OPS.paintFormXObjectBegin) {
      stack.push(matrix)
      if (Array.isArray(args) && Array.isArray(args[0])) matrix = Util.transform(matrix, args[0] as number[])
    } else if (op === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? matrix
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      const view = Util.transform(viewport.transform, matrix)
      const xs: number[] = []
      const ys: number[] = []
      let top = -Infinity
      for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        xs.push(view[0] * cx + view[2] * cy + view[4])
        ys.push(view[1] * cx + view[3] * cy + view[5])
        top = Math.max(top, matrix[1] * cx + matrix[3] * cy + matrix[5])
      }
      const x = Math.max(0, Math.min(...xs))
      const y = Math.max(0, Math.min(...ys))
      const width = Math.min(viewport.width, Math.max(...xs)) - x
      const height = Math.min(viewport.height, Math.max(...ys)) - y
      if (width >= MIN_RECT_SIDE && height >= MIN_RECT_SIDE && width * height >= pageArea * MIN_RECT_SHARE) {
        found.push({ x, y, width, height, top })
      }
    }
  })

  const sorted = found.sort((a, b) => b.width * b.height - a.width * a.height)
  const kept: Rect[] = []
  for (const rect of sorted) {
    const covered = kept.some((other) => {
      const overlapX = Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x)
      const overlapY = Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y)
      return overlapX > 0 && overlapY > 0 && (overlapX * overlapY) / (rect.width * rect.height) > 0.85
    })
    if (!covered) kept.push(rect)
  }
  return kept.sort((a, b) => b.top - a.top)
}

async function pageImages(pdfjs: PdfJs, page: PdfPage, hasText: boolean, room: number): Promise<{ placed: Placed[]; dropped: number }> {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(2, TARGET_WIDTH / base.width) })
  const operators = await page.getOperatorList()
  let rects = imageRects(
    pdfjs,
    operators as unknown as { fnArray: number[]; argsArray: unknown[] },
    viewport as unknown as { transform: number[]; width: number; height: number }
  )
  if (!rects.length && !hasText) {
    rects = [{ x: 0, y: 0, width: viewport.width, height: viewport.height, top: base.height }]
  }
  if (!rects.length || room <= 0) return { placed: [], dropped: rects.length }

  const dropped = Math.max(0, rects.length - room)
  rects = rects.slice(0, room)

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) return { placed: [], dropped: rects.length }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const placed: Placed[] = []
  try {
    await page.render({ canvasContext: context, canvas, viewport }).promise
    for (const rect of rects) {
      const image = await prepareRegion(canvas, rect)
      if (image) placed.push({ top: rect.top, image })
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
  return { placed, dropped }
}

function assemble(lines: Line[], placed: Placed[]): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []
  const flush = () => {
    if (buffer.length) blocks.push({ type: 'text', text: buffer.join('\n') })
    buffer = []
  }
  const pending = [...placed].sort((a, b) => b.top - a.top)
  for (const line of lines) {
    while (pending.length && pending[0].top >= line.y) {
      flush()
      blocks.push({ type: 'image', image: (pending.shift() as Placed).image })
    }
    buffer.push(line.text)
  }
  flush()
  for (const item of pending) blocks.push({ type: 'image', image: item.image })
  return blocks
}

export async function parsePdf(pdfjs: PdfJs, data: Uint8Array, withImages: boolean): Promise<FileBlocks> {
  const task = pdfjs.getDocument({ data })
  let doc: PdfDocument
  try {
    doc = await task.promise
  } catch (error) {
    await task.destroy().catch(() => undefined)
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') {
      throw new PdfTextError('PDF захищений паролем. Зніміть захист і спробуйте ще раз')
    }
    throw new PdfTextError('Не вдалося прочитати PDF. Файл пошкоджений або має непідтримуваний формат')
  }

  const blocks: Block[] = []
  let processed = 0
  let emptyPages = 0
  let total = 0
  let images = 0
  let dropped = 0

  try {
    const pageCount = Math.min(doc.numPages, MAX_PAGES)
    for (let number = 1; number <= pageCount && total < MAX_CHARS; number++) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      const lines = pageLines(content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>)
      const length = lines.reduce((sum, line) => sum + visibleLength(line.text), 0)
      processed++
      if (length < MIN_PAGE_CHARS) emptyPages++
      total += length

      let placed: Placed[] = []
      if (withImages) {
        try {
          const result = await pageImages(pdfjs, page, length >= MIN_PAGE_CHARS, MAX_IMAGES - images)
          placed = result.placed
          dropped += result.dropped
          images += placed.length
        } catch (error) {
          console.error('pdf images failed', error)
        }
      }
      blocks.push(...assemble(length >= MIN_PAGE_CHARS ? lines : [], placed))
      page.cleanup()
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }

  if (visibleChars(blocks) < MIN_TOTAL_CHARS && countImages(blocks) === 0) {
    throw new PdfTextError(
      withImages
        ? 'У PDF не знайдено ні тексту, ні зображень, які можна обробити'
        : 'У PDF немає тексту: схоже, це скан або зображення. Увімкніть розпізнавання зображень, щоб обробити його'
    )
  }

  if (!withImages && emptyPages > 0) {
    return { blocks, note: `${emptyPages} з ${processed} стор. без тексту (зображення) пропущено` }
  }
  if (dropped > 0) {
    return { blocks, note: `розпізнано перші ${MAX_IMAGES} зображень, решту пропущено` }
  }
  return { blocks }
}
