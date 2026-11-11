import type JSZip from 'jszip'
import { MAX_IMAGES, mergeText, visibleChars } from './blocks'
import type { Block, FileBlocks, PreparedImage } from './blocks'
import { mimeFromName, prepareBlob } from './images'

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

type SlideItem = { kind: 'text'; text: string } | { kind: 'image'; rid: string }

function parseSlide(xml: string): { items: SlideItem[]; pictures: number } {
  const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
  const title: string[] = []
  const items: SlideItem[] = []
  let pictures = 0

  for (const [block] of body.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<a:tbl\b[\s\S]*?<\/a:tbl>|<p:pic\b[\s\S]*?<\/p:pic>/g)) {
    if (block.startsWith('<p:pic')) {
      pictures++
      const rid = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(block)?.[1]
      if (rid) items.push({ kind: 'image', rid })
      continue
    }
    if (block.startsWith('<a:tbl')) {
      for (const [row] of block.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
        const cells = [...row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => shapeParagraphs(cell[0]).join(' ')).filter(Boolean)
        if (cells.length) items.push({ kind: 'text', text: cells.join(' | ') })
      }
      continue
    }
    const type = /<p:ph\b[^>]*\btype="([^"]+)"/.exec(block)?.[1]
    if (type && SKIPPED_PLACEHOLDERS.has(type)) continue
    const paragraphs = shapeParagraphs(block)
    if (type && TITLE_PLACEHOLDERS.has(type)) title.push(...paragraphs)
    else for (const paragraph of paragraphs) items.push({ kind: 'text', text: paragraph })
  }

  return { items: [...title.map((text) => ({ kind: 'text' as const, text })), ...items], pictures }
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

const MAX_REUSE = 2

async function slideRelations(zip: JSZip, slidePath: string): Promise<Map<string, string>> {
  const name = slidePath.split('/').pop() ?? ''
  const rels = await zip.file(`ppt/slides/_rels/${name}.rels`)?.async('string')
  const targets = new Map<string, string>()
  if (!rels) return targets
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
    if (!id || !target || /TargetMode="External"/.test(tag)) continue
    const parts = (target.startsWith('/') ? target.slice(1) : `ppt/slides/${target}`).split('/')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else if (part !== '.') resolved.push(part)
    }
    targets.set(id, resolved.join('/'))
  }
  return targets
}

export async function parsePptx(zip: JSZip, withImages: boolean): Promise<FileBlocks> {
  const paths = (await slideOrder(zip)).slice(0, MAX_SLIDES)
  if (!paths.length) {
    throw new PptxTextError('Не вдалося знайти слайди. Файл пошкоджений або це не презентація .pptx')
  }

  const blocks: Block[] = []
  const media = new Map<string, PreparedImage | null>()
  const reuse = new Map<string, number>()
  let total = 0
  let imageOnly = 0
  let pictures = 0
  let images = 0
  let dropped = 0

  for (const path of paths) {
    const xml = (await zip.file(path)?.async('string')) ?? ''
    if (/<p:sld\b[^>]*\bshow="0"/.test(xml)) continue
    total++
    const slide = parseSlide(xml)
    pictures += slide.pictures
    const relations = withImages ? await slideRelations(zip, path) : new Map<string, string>()
    const slideBlocks: Block[] = []

    for (const item of slide.items) {
      if (item.kind === 'text') {
        slideBlocks.push({ type: 'text', text: item.text })
        continue
      }
      if (!withImages) continue
      const target = relations.get(item.rid)
      if (!target || !mimeFromName(target)) continue
      const uses = (reuse.get(target) ?? 0) + 1
      reuse.set(target, uses)
      if (uses > MAX_REUSE) continue
      if (images >= MAX_IMAGES) {
        dropped++
        continue
      }
      if (!media.has(target)) {
        const bytes = await zip.file(target)?.async('uint8array')
        media.set(target, bytes ? await prepareBlob(new Blob([bytes as BlobPart], { type: mimeFromName(target) })) : null)
      }
      const image = media.get(target)
      if (image && uses === 1) {
        slideBlocks.push({ type: 'image', image })
        images++
      }
    }

    const slideChars = visibleChars(slideBlocks)
    const hasImage = slideBlocks.some((block) => block.type === 'image')
    if (slideChars < MIN_SLIDE_CHARS && !hasImage) {
      if (slide.pictures > 0) imageOnly++
      continue
    }
    blocks.push(...mergeText(slideBlocks))
  }

  const hasContent = visibleChars(blocks) >= MIN_SLIDE_CHARS || blocks.some((block) => block.type === 'image')
  if (!hasContent) {
    throw new PptxTextError(
      withImages
        ? 'У презентації не знайдено тексту й зображень, які можна обробити'
        : 'У презентації немає тексту: слайди складаються із зображень. Увімкніть розпізнавання зображень, щоб обробити її'
    )
  }

  if (withImages) {
    return dropped > 0 ? { blocks, note: `розпізнано перші ${MAX_IMAGES} зображень, решту пропущено` } : { blocks }
  }
  if (imageOnly > 0) return { blocks, note: `${imageOnly} з ${total} слайдів без тексту (зображення) пропущено` }
  if (pictures > 0) return { blocks, note: 'зображення на слайдах проігноровано' }
  return { blocks }
}
