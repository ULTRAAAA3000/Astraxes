export type GenType = 'summary' | 'retelling' | 'test' | 'terms'

export interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface KeyTerm {
  term: string
  definition: string
}

export interface Results {
  summary?: string
  retelling?: string
  test?: QuizQuestion[]
  terms?: KeyTerm[]
}

export interface Doc {
  id: number
  title: string
  results: Results
  errors?: Partial<Record<GenType, string>>
  condensed?: boolean
  chunks?: number
  usage?: Usage
}

export interface HistoryItem {
  id: number
  title: string
  createdAt: string
  types: GenType[]
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  modelCalls: number
  neurons: number
}

export interface UsageInfo {
  used: number
  limit: number
  tokens: number
  resetsAt: string
  serviceAvailable: boolean
}

export interface GenerateResponse {
  documentId: number
  title: string
  condensed: boolean
  chunks: number
  usage: Usage
  results: Results
  errors: Partial<Record<GenType, string>>
}

export interface HistoryDetail {
  id: number
  title: string
  sourceText: string
  createdAt: string
  results: Results
}

export const API_URL = (import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '')
export const ALL_TYPES: GenType[] = ['summary', 'retelling', 'test', 'terms']
export const TYPE_LABELS: Record<GenType, string> = { summary: 'Конспект', retelling: 'Переказ', test: 'Тест', terms: 'Терміни' }
export const MIN_CHARS = 80
export const SOFT_LIMIT = 14000
export const HARD_LIMIT = 90000
export const QUESTION_OPTIONS = [4, 6, 8, 10]

const CLIENT_KEY = 'astraxes:client'
const CLIENT_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
let memoryClientId: string | null = null

function createClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function getClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_KEY)
    if (saved && CLIENT_PATTERN.test(saved)) return saved
    const created = createClientId()
    localStorage.setItem(CLIENT_KEY, created)
    return created
  } catch {
    memoryClientId ??= createClientId()
    return memoryClientId
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId(), ...(init?.headers ?? {}) }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const details = data?.errors
      ? Object.entries(data.errors as Record<string, string>)
          .map(([type, message]) => `${TYPE_LABELS[type as GenType] ?? type}: ${message}`)
          .join('\n')
      : ''
    throw new Error([data?.error ?? `Помилка запиту (${response.status})`, details].filter(Boolean).join('\n'))
  }
  return data as T
}

export function formatDate(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })
}

export function availableTabs(results: Results): GenType[] {
  return ALL_TYPES.filter((type) => results[type] !== undefined)
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2.4)
}
