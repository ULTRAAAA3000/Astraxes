import { MAX_IMAGES, countImages, mergeText, plainText, textBlocks } from './blocks'
import type { Block, FileBlocks } from './blocks'
import { mimeFromName, prepareBlob } from './images'
import { PdfTextError, parsePdf } from './pdf'
import { PptxTextError, parsePptx } from './pptx'

export const ACCEPT =
  '.pdf,.docx,.pptx,.ppsx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation'

const MAX_TEXT_FILE = 2_000_000
const MAX_DOCX_FILE = 15_000_000
const MAX_PDF_FILE = 30_000_000
const MAX_PPTX_FILE = 80_000_000
const MAX_IMAGE_FILE = 25_000_000

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeDataUrl(src: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(src)
  if (!match || !mimeFromName(`x.${match[1].split('/')[1] ?? ''}`)) return null
  try {
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: match[1] })
  } catch {
    return null
  }
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'DIV', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE'])

type RawItem = string | { src: string }

function walkHtml(html: string): RawItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items: RawItem[] = []
  let buffer = ''

  const flush = () => {
    const text = buffer
      .replace(/[ \t ]+/g, ' ')
      .replace(/ ?\| ?\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
    if (text) items.push(text)
    buffer = ''
  }

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ''
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'IMG') {
      flush()
      const src = node.getAttribute('src') ?? ''
      if (src) items.push({ src })
      return
    }
    if (node.tagName === 'BR') {
      buffer += '\n'
      return
    }
    node.childNodes.forEach(walk)
    if (node.tagName === 'TD' || node.tagName === 'TH') buffer += ' | '
    if (BLOCK_TAGS.has(node.tagName)) buffer += '\n'
  }

  doc.body.childNodes.forEach(walk)
  flush()
  return items
}

async function readDocx(file: File, withImages: boolean): Promise<FileBlocks> {
  if (file.size > MAX_DOCX_FILE) {
    throw new Error('Файл завеликий (максимум 15 МБ)')
  }
  try {
    const module = await import('mammoth/mammoth.browser')
    const mammoth = module.default ?? (module as unknown as typeof module.default)
    const arrayBuffer = await file.arrayBuffer()
    if (!withImages) {
      const result = await mammoth.extractRawText({ arrayBuffer })
      return { blocks: textBlocks(normalize(result.value)) }
    }

    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const data = await image.read('base64')
          return { src: `data:${image.contentType};base64,${data}` }
        })
      }
    )

    const blocks: Block[] = []
    const seen = new Set<string>()
    let dropped = 0
    for (const item of walkHtml(result.value)) {
      if (typeof item === 'string') {
        blocks.push({ type: 'text', text: item })
        continue
      }
      const blob = decodeDataUrl(item.src)
      if (!blob) continue
      if (countImages(blocks) >= MAX_IMAGES) {
        dropped++
        continue
      }
      const image = await prepareBlob(blob)
      if (image && !seen.has(image.key)) {
        seen.add(image.key)
        blocks.push({ type: 'image', image })
      }
    }
    const note = dropped > 0 ? `розпізнано перші ${MAX_IMAGES} зображень, решту пропущено` : undefined
    return { blocks: mergeText(blocks), note }
  } catch {
    throw new Error('Не вдалося прочитати .docx. Файл пошкоджений або захищений паролем')
  }
}

async function readPdf(file: File, withImages: boolean): Promise<FileBlocks> {
  if (file.size > MAX_PDF_FILE) {
    throw new Error('Файл завеликий (максимум 30 МБ)')
  }
  try {
    const [pdfjs, workerModule] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker')
    ])
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new workerModule.default()
    }
    const result = await parsePdf(pdfjs, new Uint8Array(await file.arrayBuffer()), withImages)
    return { blocks: result.blocks.map((block) => (block.type === 'text' ? { type: 'text', text: normalize(block.text) } : block)), note: result.note }
  } catch (error) {
    if (error instanceof PdfTextError) throw error
    throw new Error('Не вдалося прочитати PDF. Спробуйте інший файл')
  }
}

async function readPptx(file: File, withImages: boolean): Promise<FileBlocks> {
  if (file.size > MAX_PPTX_FILE) {
    throw new Error('Файл завеликий (максимум 80 МБ)')
  }
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    return await parsePptx(zip, withImages)
  } catch (error) {
    if (error instanceof PptxTextError) throw error
    throw new Error('Не вдалося прочитати презентацію. Файл пошкоджений або захищений паролем')
  }
}

async function readImage(file: File, withImages: boolean): Promise<FileBlocks> {
  if (!withImages) {
    throw new Error('Увімкніть розпізнавання зображень, щоб обробити фото чи скан')
  }
  if (file.size > MAX_IMAGE_FILE) {
    throw new Error('Зображення завелике (максимум 25 МБ)')
  }
  const image = await prepareBlob(file, { strict: false })
  if (!image) throw new Error('Не вдалося прочитати зображення. Спробуйте PNG або JPEG')
  return { blocks: [{ type: 'image', image }] }
}

export async function extractFile(file: File, withImages: boolean): Promise<FileBlocks> {
  if (/\.doc$/i.test(file.name)) {
    throw new Error('Формат .doc не підтримується. Збережіть файл як .docx')
  }
  if (/\.ppt$/i.test(file.name)) {
    throw new Error('Формат .ppt не підтримується. Збережіть презентацію як .pptx')
  }
  if (/\.(pptx|ppsx)$/i.test(file.name)) {
    return readPptx(file, withImages)
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    return readPdf(file, withImages)
  }
  if (/\.docx$/i.test(file.name)) {
    return readDocx(file, withImages)
  }
  if (/\.(png|jpe?g|webp)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/.test(file.type)) {
    return readImage(file, withImages)
  }
  if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith('text/')) {
    if (file.size > MAX_TEXT_FILE) {
      throw new Error('Файл завеликий (максимум 2 МБ)')
    }
    return { blocks: textBlocks(normalize(await file.text())) }
  }
  throw new Error('Підтримуються файли .pdf, .docx, .pptx, .txt, .md та зображення .png, .jpg, .webp')
}

export function blocksToText(blocks: Block[]): string {
  return normalize(plainText(blocks))
}
