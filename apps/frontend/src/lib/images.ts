import type { PreparedImage } from './blocks'

const MAX_SIDE = 1120
const MIN_SIDE = 96
const MIN_AREA = 14000
const MAX_BASE64 = 1_500_000
const FLAT_DIFFERENCE = 35
const FLAT_SHARE = 0.0008

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isFlat(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const step = Math.max(1, Math.floor(data.length / 4 / 60000)) * 4
  let sum = 0
  let count = 0
  for (let index = 0; index < data.length; index += step) {
    sum += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    count++
  }
  const mean = sum / count
  let different = 0
  for (let index = 0; index < data.length; index += step) {
    const luma = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    if (Math.abs(luma - mean) > FLAT_DIFFERENCE) different++
  }
  return different / count < FLAT_SHARE
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function encodeCanvas(source: HTMLCanvasElement, options: { strict: boolean }): Promise<PreparedImage | null> {
  const { width, height } = source
  if (options.strict && (Math.min(width, height) < MIN_SIDE || width * height < MIN_AREA)) return null
  if (width < 16 || height < 16) return null

  let scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  for (const quality of [0.82, 0.65, 0.5]) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    if (options.strict && isFlat(canvas)) return null
    const blob = await toBlob(canvas, quality)
    if (!blob) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const base64 = toBase64(bytes)
    if (base64.length <= MAX_BASE64) {
      return { base64, key: await sha256(bytes), width: canvas.width, height: canvas.height }
    }
    scale *= 0.75
  }
  return null
}

export async function prepareBlob(blob: Blob, options: { strict: boolean } = { strict: true }): Promise<PreparedImage | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    return await encodeCanvas(canvas, options)
  } finally {
    bitmap.close()
  }
}

export async function prepareRegion(
  source: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number }
): Promise<PreparedImage | null> {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.min(source.width - x, Math.ceil(rect.width))
  const height = Math.min(source.height - y, Math.ceil(rect.height))
  if (width < 1 || height < 1) return null
  const crop = document.createElement('canvas')
  crop.width = width
  crop.height = height
  const context = crop.getContext('2d')
  if (!context) return null
  context.drawImage(source, x, y, width, height, 0, 0, width, height)
  return encodeCanvas(crop, { strict: true })
}

export function mimeFromName(name: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'webp') return 'image/webp'
  return ''
}
