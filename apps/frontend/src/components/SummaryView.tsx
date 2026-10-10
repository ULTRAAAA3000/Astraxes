type Block = { kind: 'h1' | 'h2' | 'h3'; text: string } | { kind: 'list'; items: string[] }

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('### ')) blocks.push({ kind: 'h3', text: line.slice(4) })
    else if (line.startsWith('## ')) blocks.push({ kind: 'h2', text: line.slice(3) })
    else if (line.startsWith('# ')) blocks.push({ kind: 'h1', text: line.slice(2) })
    else {
      const item = line.replace(/^([-*•]\s*)+/, '')
      const last = blocks[blocks.length - 1]
      if (last && last.kind === 'list') last.items.push(item)
      else blocks.push({ kind: 'list', items: [item] })
    }
  }
  return blocks
}

export default function SummaryView({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown)

  return (
    <div className="prose-summary">
      {blocks.map((block, index) => {
        if (block.kind === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'h1') return <h1 key={index}>{block.text}</h1>
        if (block.kind === 'h2') return <h2 key={index}>{block.text}</h2>
        return <h3 key={index}>{block.text}</h3>
      })}
    </div>
  )
}
