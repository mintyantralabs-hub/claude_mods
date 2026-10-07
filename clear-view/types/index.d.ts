export type Phase = 'idle' | 'thinking' | 'tool'

export type ToolStat = { calls: number; errors: number; denies: number; totalMs: number }

export type FileOp = 'read' | 'edit' | 'write'

export type FileTouch = { path: string; op: FileOp; count: number }

export type ErrorEntry = { tool: string; text: string; at: number }

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Running = { id: string; tool: string; isSubagent: boolean; startedAt: number }

export type Live = {
  phase: Phase
  running: Running[]
  turnStartedAt: number | null
  now: number
}

export type Stats = {
  turns: number
  lastTurnMs: number | null
  lastTurnReason: string | null
  model: string | null
  tools: Record<string, ToolStat>
  files: FileTouch[]
  errors: ErrorEntry[]
  tokens: Tokens
}

declare module 'claude-code' {
  interface PluginState {
    'clear-view': { live: Live; stats: Stats }
  }
}
