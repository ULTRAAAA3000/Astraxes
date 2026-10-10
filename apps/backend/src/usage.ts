export interface UsageTracker {
  promptTokens: number
  completionTokens: number
  calls: number
}

export interface QuotaSnapshot {
  day: string
  device: { used: number; limit: number; tokens: number }
  global: { used: number; limit: number }
}

export const INPUT_NEURONS_PER_TOKEN = 4119 / 1_000_000
export const OUTPUT_NEURONS_PER_TOKEN = 34868 / 1_000_000
export const DEFAULT_DEVICE_LIMIT = 2500
export const DEFAULT_GLOBAL_LIMIT = 9000
export const GLOBAL_OWNER = '*'

export function createTracker(): UsageTracker {
  return { promptTokens: 0, completionTokens: 0, calls: 0 }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.4)
}

export function neuronsOf(tracker: UsageTracker): number {
  return tracker.promptTokens * INPUT_NEURONS_PER_TOKEN + tracker.completionTokens * OUTPUT_NEURONS_PER_TOKEN
}

export function recordUsage(tracker: UsageTracker | undefined, result: unknown, inputText: string, outputText: string): void {
  if (!tracker) return
  const usage = (result as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage
  const prompt = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : estimateTokens(inputText)
  const completion = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : estimateTokens(outputText)
  tracker.promptTokens += prompt
  tracker.completionTokens += completion
  tracker.calls += 1
}

export function currentDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function nextResetAt(date: Date = new Date()): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
  return next.toISOString()
}

export function limitFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export async function readQuota(
  db: D1Database,
  owner: string,
  deviceLimit: number,
  globalLimit: number
): Promise<QuotaSnapshot> {
  const day = currentDay()
  const { results } = await db
    .prepare('SELECT owner_id, tokens, neurons FROM usage_daily WHERE day = ? AND owner_id IN (?, ?)')
    .bind(day, owner, GLOBAL_OWNER)
    .all<{ owner_id: string; tokens: number; neurons: number }>()

  const device = results.find((row) => row.owner_id === owner)
  const global = results.find((row) => row.owner_id === GLOBAL_OWNER)
  return {
    day,
    device: { used: device?.neurons ?? 0, limit: deviceLimit, tokens: device?.tokens ?? 0 },
    global: { used: global?.neurons ?? 0, limit: globalLimit }
  }
}

export function usageStatements(db: D1Database, owner: string, tracker: UsageTracker): D1PreparedStatement[] {
  const day = currentDay()
  const tokens = tracker.promptTokens + tracker.completionTokens
  const neurons = neuronsOf(tracker)
  const sql = `INSERT INTO usage_daily (owner_id, day, tokens, neurons, requests) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(owner_id, day) DO UPDATE SET tokens = tokens + excluded.tokens, neurons = neurons + excluded.neurons, requests = requests + 1`
  return [db.prepare(sql).bind(owner, day, tokens, neurons), db.prepare(sql).bind(GLOBAL_OWNER, day, tokens, neurons)]
}
