import { PdfTextError, parsePdf } from './pdf'
import { PptxTextError, parsePptx } from './pptx'

export interface FileText {
  text: string
  note?: string
}

export const ACCEPT =
  '.pdf,.docx,.pptx,.ppsx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation'

const MAX_TEXT_FILE = 2_000_000
const MAX_DOCX_FILE = 15_000_000
const MAX_PDF_FILE = 30_000_000
const MAX_PPTX_FILE = 80_000_000

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readDocx(file: File): Promise<FileText> {
  if (file.size > MAX_DOCX_FILE) {
    throw new Error('Файл завеликий (максимум 15 МБ)')
  }
  try {
    const module = await import('mammoth/mammoth.browser')
    const mammoth = module.default ?? (module as unknown as typeof module.default)
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { text: normalize(result.value) }
  } catch {
    throw new Error('Не вдалося прочитати .docx. Файл пошкоджений або захищений паролем')
  }
}

async function readPdf(file: File): Promise<FileText> {
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
    const result = await parsePdf(pdfjs, new Uint8Array(await file.arrayBuffer()))
    return { text: normalize(result.text), note: result.note }
  } catch (error) {
    if (error instanceof PdfTextError) throw error
    throw new Error('Не вдалося прочитати PDF. Спробуйте інший файл')
  }
}

async function readPptx(file: File): Promise<FileText> {
  if (file.size > MAX_PPTX_FILE) {
    throw new Error('Файл завеликий (максимум 80 МБ)')
  }
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const result = await parsePptx(zip)
    return { text: normalize(result.text), note: result.note }
  } catch (error) {
    if (error instanceof PptxTextError) throw error
    throw new Error('Не вдалося прочитати презентацію. Файл пошкоджений або захищений паролем')
  }
}

export async function extractFileText(file: File): Promise<FileText> {
  if (/\.doc$/i.test(file.name)) {
    throw new Error('Формат .doc не підтримується. Збережіть файл як .docx')
  }
  if (/\.ppt$/i.test(file.name)) {
    throw new Error('Формат .ppt не підтримується. Збережіть презентацію як .pptx')
  }
  if (/\.(pptx|ppsx)$/i.test(file.name)) {
    return readPptx(file)
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    return readPdf(file)
  }
  if (/\.docx$/i.test(file.name)) {
    return readDocx(file)
  }
  if (/\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith('text/')) {
    if (file.size > MAX_TEXT_FILE) {
      throw new Error('Файл завеликий (максимум 2 МБ)')
    }
    return { text: normalize(await file.text()) }
  }
  throw new Error('Підтримуються файли .pdf, .docx, .pptx, .txt і .md')
}
