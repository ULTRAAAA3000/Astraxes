type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

export interface PdfResult {
  text: string
  note?: string
}

export class PdfTextError extends Error {}

const MAX_PAGES = 300
const MAX_CHARS = 90000
const MIN_PAGE_CHARS = 10
const MIN_TOTAL_CHARS = 30

function visibleLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

export async function parsePdf(pdfjs: PdfJs, data: Uint8Array): Promise<PdfResult> {
  const task = pdfjs.getDocument({ data })
  let doc: Awaited<typeof task.promise>
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

  const pages: string[] = []
  let processed = 0
  let emptyPages = 0
  let total = 0

  try {
    const pageCount = Math.min(doc.numPages, MAX_PAGES)
    for (let number = 1; number <= pageCount && total < MAX_CHARS; number++) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      let out = ''
      let lastY: number | null = null
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = item.transform[5]
        if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n'
        out += item.str
        if (item.hasEOL) out += '\n'
        lastY = y
      }
      processed++
      const length = visibleLength(out)
      if (length < MIN_PAGE_CHARS) emptyPages++
      else pages.push(out.trim())
      total += length
      page.cleanup()
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }

  if (total < MIN_TOTAL_CHARS) {
    throw new PdfTextError('У PDF немає тексту: схоже, це скан або зображення. Обробити зображення неможливо')
  }

  const text = pages.join('\n\n')
  if (emptyPages > 0) {
    return { text, note: `${emptyPages} з ${processed} стор. без тексту (зображення) пропущено` }
  }
  return { text }
}
