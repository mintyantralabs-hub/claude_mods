import type { ErrorEntry, FileOp, FileTouch, Live, Stats, ToolStat, Tokens } from '../types'

export const MAX_FILES = 50
export const MAX_ERRORS = 20

export const EMPTY_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const EMPTY_LIVE: Live = { phase: 'idle', running: [], turnStartedAt: null, now: 0 }

export const EMPTY_STATS: Stats = {
  turns: 0,
  lastTurnMs: null,
  lastTurnReason: null,
  model: null,
  tools: {},
  files: [],
  errors: [],
  tokens: EMPTY_TOKENS,
}

const EMPTY_TOOL: ToolStat = { calls: 0, errors: 0, denies: 0, totalMs: 0 }

export type Outcome = 'ok' | 'error' | 'deny'

export function recordTool(stats: Stats, tool: string, outcome: Outcome, ms: number): Stats {
  const prev = stats.tools[tool] ?? EMPTY_TOOL
  const next: ToolStat = {
    calls: prev.calls + 1,
    errors: prev.errors + (outcome === 'error' ? 1 : 0),
    denies: prev.denies + (outcome === 'deny' ? 1 : 0),
    totalMs: prev.totalMs + ms,
  }

  return { ...stats, tools: { ...stats.tools, [tool]: next } }
}

/** Most recent first, one row per path, capped at MAX_FILES. */
export function recordFile(stats: Stats, path: string, op: FileOp): Stats {
  const prev = stats.files.find(f => f.path === path)
  const rank: Record<FileOp, number> = { read: 0, edit: 1, write: 2 }
  const keptOp = prev && rank[prev.op] > rank[op] ? prev.op : op
  const touch: FileTouch = { path, op: keptOp, count: (prev?.count ?? 0) + 1 }
  const rest = stats.files.filter(f => f.path !== path)

  return { ...stats, files: [touch, ...rest].slice(0, MAX_FILES) }
}

export function recordError(stats: Stats, entry: ErrorEntry): Stats {
  return { ...stats, errors: [entry, ...stats.errors].slice(0, MAX_ERRORS) }
}

export function addTokens(a: Tokens, u: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}): Tokens {
  return {
    input: a.input + u.input_tokens,
    output: a.output + u.output_tokens,
    cacheRead: a.cacheRead + (u.cache_read_input_tokens ?? 0),
    cacheWrite: a.cacheWrite + (u.cache_creation_input_tokens ?? 0),
  }
}

/** Share of prompt tokens served from cache, 0..100, or null with no input yet. */
export function cacheHitPct(t: Tokens): number | null {
  const prompt = t.input + t.cacheRead + t.cacheWrite

  return prompt === 0 ? null : Math.round((t.cacheRead / prompt) * 100)
}

export function fmtMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)

  return m < 60
    ? `${m}m${String(s % 60).padStart(2, '0')}s`
    : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function fmtCount(n: number): string {
  if (n < 1000) {
    return String(n)
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  }

  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Path relative to `root` when it lies under it. */
export function shortPath(path: string, root: string | null): string {
  if (root && path.startsWith(root.endsWith('/') ? root : `${root}/`)) {
    return path.slice(root.length).replace(/^\/+/, '')
  }

  return path
}

export function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Busiest tools first. */
export function toolRows(stats: Stats): [string, ToolStat][] {
  return Object.entries(stats.tools).sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
}
