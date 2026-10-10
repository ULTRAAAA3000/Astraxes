import type { KeyTerm } from '../lib/api'

export default function TermsView({ terms }: { terms: KeyTerm[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {terms.map((item, index) => (
        <div key={index} className="card card-hover reveal p-5" style={{ animationDelay: `${index * 40}ms` }}>
          <p className="text-xs font-medium text-soft">{String(index + 1).padStart(2, '0')}</p>
          <p className="mt-2 text-lg font-semibold tracking-tight">{item.term}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.definition}</p>
        </div>
      ))}
    </div>
  )
}
