export interface PreparedImage {
  base64: string
  key: string
  width: number
  height: number
}

export type Block = { type: 'text'; text: string } | { type: 'image'; image: PreparedImage }

export interface FileBlocks {
  blocks: Block[]
  note?: string
}

export const MAX_IMAGES = 12

export function textBlocks(text: string): Block[] {
  return text.trim() ? [{ type: 'text', text }] : []
}

export function countImages(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + (block.type === 'image' ? 1 : 0), 0)
}

export function visibleChars(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + (block.type === 'text' ? block.text.replace(/\s+/g, '').length : 0), 0)
}

export function mergeText(blocks: Block[]): Block[] {
  const merged: Block[] = []
  for (const block of blocks) {
    const last = merged[merged.length - 1]
    if (block.type === 'text' && last?.type === 'text') last.text = `${last.text}\n${block.text}`
    else merged.push(block.type === 'text' ? { type: 'text', text: block.text } : block)
  }
  return merged
}

export function plainText(blocks: Block[]): string {
  return blocks
    .filter((block): block is Extract<Block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
}
