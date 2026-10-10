import type JSZip from 'jszip'

export interface PptxResult {
  text: string
  note?: string
}

export class PptxTextError extends Error {}

const MAX_SLIDES = 300
const MIN_SLIDE_CHARS = 3
const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'ftr', 'dt', 'hdr'])
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle'])

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  })
}

function visibleLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

function paragraphText(xml: string): string {
  const cleaned = xml.replace(/<a:fld\b[^>]*\btype="(?:slidenum|datetime[^"]*)"[^>]*>[\s\S]*?<\/a:fld>/g, '')
  let out = ''
  for (const token of cleaned.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/?>/g)) {
    out += token[1] !== undefined ? decodeEntities(token[1]) : '\n'
  }
  return out
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function shapeParagraphs(xml: string): string[] {
  return [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map((match) => paragraphText(match[1])).filter(Boolean)
}

function parseSlide(xml: string): { lines: string[]; pictures: number } {
  const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
  const title: string[] = []
  const lines: string[] = []

  for (const [block] of body.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<a:tbl\b[\s\S]*?<\/a:tbl>/g)) {
    if (block.startsWith('<a:tbl')) {
      for (const [row] of block.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
        const cells = [...row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => shapeParagraphs(cell[0]).join(' ')).filter(Boolean)
        if (cells.length) lines.push(cells.join(' | '))
      }
      continue
    }
    const type = /<p:ph\b[^>]*\btype="([^"]+)"/.exec(block)?.[1]
    if (type && SKIPPED_PLACEHOLDERS.has(type)) continue
    const paragraphs = shapeParagraphs(block)
    if (type && TITLE_PLACEHOLDERS.has(type)) title.push(...paragraphs)
    else lines.push(...paragraphs)
  }

  return { lines: [...title, ...lines], pictures: (body.match(/<p:pic\b/g) ?? []).length }
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0)
}

async function slideOrder(zip: JSZip): Promise<string[]> {
  const files = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const presentation = await zip.file('ppt/presentation.xml')?.async('string')
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string')

  if (presentation && rels) {
    const targets = new Map<string, string>()
    for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(tag)?.[1]
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
      if (id && target) targets.set(id, target)
    }
    const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
      .map((match) => targets.get(match[1]))
      .filter((target): target is string => Boolean(target))
      .map((target) => (target.startsWith('/') ? target.slice(1) : `ppt/${target}`))
      .filter((path) => zip.file(path) !== null)
    if (ordered.length) return ordered
  }

  return files.sort((a, b) => slideNumber(a) - slideNumber(b))
}

export async function parsePptx(zip: JSZip): Promise<PptxResult> {
  const paths = (await slideOrder(zip)).slice(0, MAX_SLIDES)
  if (!paths.length) {
    throw new PptxTextError('Не вдалося знайти слайди. Файл пошкоджений або це не презентація .pptx')
  }

  const slides: string[] = []
  let total = 0
  let imageOnly = 0
  let pictures = 0

  for (const path of paths) {
    const xml = (await zip.file(path)?.async('string')) ?? ''
    if (/<p:sld\b[^>]*\bshow="0"/.test(xml)) continue
    total++
    const slide = parseSlide(xml)
    pictures += slide.pictures
    const text = slide.lines.join('\n')
    if (visibleLength(text) < MIN_SLIDE_CHARS) {
      if (slide.pictures > 0) imageOnly++
      continue
    }
    slides.push(text)
  }

  if (!slides.length) {
    throw new PptxTextError('У презентації немає тексту: слайди складаються із зображень. Обробити зображення неможливо')
  }

  if (imageOnly > 0) {
    return { text: slides.join('\n\n'), note: `${imageOnly} з ${total} слайдів без тексту (зображення) пропущено` }
  }
  if (pictures > 0) {
    return { text: slides.join('\n\n'), note: 'зображення на слайдах проігноровано' }
  }
  return { text: slides.join('\n\n') }
}
