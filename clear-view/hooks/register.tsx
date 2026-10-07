import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, ToolCallInput } from 'claude-code'

import type { FileOp, Live, Running, Stats } from '../types'
import {
  EMPTY_LIVE,
  EMPTY_STATS,
  addTokens,
  cacheHitPct,
  fmtCount,
  fmtMs,
  oneLine,
  recordError,
  recordFile,
  recordTool,
  shortPath,
  toolRows,
} from './lib'
import type { Outcome } from './lib'

const PANE = 'clear-view'
const TITLE = 'Clear View'

const live = atom({ plugin: 'clear-view', key: 'live' } as const, EMPTY_LIVE)
const stats = atom({ plugin: 'clear-view', key: 'stats' } as const, EMPTY_STATS)

const SHOW_TOOLS = 10
const SHOW_FILES = 8
const SHOW_ERRORS = 4

const OP_MARK: Record<FileOp, string> = { read: 'R', edit: 'M', write: 'W' }

function fileOf(e: ToolCallInput): { path: string; op: FileOp } | null {
  switch (e.tool) {
    case 'Read':
      return { path: e.file_path, op: 'read' }
    case 'Edit':
      return { path: e.file_path, op: 'edit' }
    case 'Write':
      return { path: e.file_path, op: 'write' }
    case 'NotebookEdit':
      return { path: e.notebook_path, op: 'edit' }
    default:
      return null
  }
}

function phaseAfter(l: Live, running: Running[]): Live {
  const mainBusy = running.some(r => !r.isSubagent)
  const phase = mainBusy ? 'tool' : l.turnStartedAt === null ? 'idle' : 'thinking'

  return { ...l, running, phase }
}

let root: string | null = null
let ticker: Timer | null = null

function startTick($: EngineInterface): void {
  ticker?.cancel()
  ticker = $.clock.every(1000, () => {
    void $.clock.now().then(now => update($, live, l => ({ ...l, now })))
  })
}

function endTick(): void {
  ticker?.cancel()
  ticker = null
}

function reset($: EngineInterface) {
  return update($, stats, () => EMPTY_STATS)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = await $.session.cwd()
    await $.command.register({
      name: 'clearview',
      description: 'Open the Clear View session dashboard (args: reset | close)',
      argumentHint: '[reset|close]',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    endTick()
    $.ui.status(undefined)

    return next(e)
  })

  on('command.run', { command: 'clearview' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await reset($)

      return { text: 'Clear View stats reset.' }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'Clear View closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Clear View opened.' }
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, live, (l): Live => ({ ...l, phase: 'thinking', turnStartedAt: now, now }))
    startTick($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const usage = e.usage ?? done.usage

    await update($, stats, s => ({
      ...s,
      tokens: usage ? addTokens(s.tokens, usage) : s.tokens,
      model: usage?.model ?? s.model,
      ...(e.agentId === undefined
        ? { turns: s.turns + 1, lastTurnMs: e.durationMs, lastTurnReason: e.reason }
        : {}),
    }))

    if (e.agentId === undefined) {
      endTick()
      const now = await $.clock.now()
      await update($, live, (l): Live => ({
        ...l,
        phase: 'idle',
        turnStartedAt: null,
        running: l.running.filter(r => r.isSubagent),
        now,
      }))
      const s = await read($, stats)
      const calls = Object.values(s.tools).reduce((n, t) => n + t.calls, 0)
      $.ui.status(`${e.reason === 'answer' ? '✓' : '✗'} ${fmtMs(e.durationMs)} · ${calls} tools · ${s.files.length} files`)
    }

    return done
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `${e.tool}-${Math.random().toString(36).slice(2)}`
    const startedAt = await $.clock.now()
    const entry: Running = { id, tool: String(e.tool), isSubagent: e.agentId !== undefined, startedAt }

    await update($, live, l => phaseAfter(l, [...l.running, entry]))

    let outcome: Outcome = 'error'
    try {
      const ran = await next(e)
      outcome = ran.deny !== undefined ? 'deny' : ran.isError === true ? 'error' : 'ok'

      if (outcome !== 'ok') {
        const text = ran.deny ?? ran.text ?? 'failed'
        await update($, stats, s => recordError(s, { tool: entry.tool, text: oneLine(text), at: startedAt }))
      } else {
        const touched = fileOf(e)
        if (touched) {
          await update($, stats, s => recordFile(s, touched.path, touched.op))
        }
      }

      return ran
    } finally {
      const ms = (await $.clock.now()) - startedAt
      await update($, stats, s => recordTool(s, entry.tool, outcome, ms))
      await update($, live, l => phaseAfter(l, l.running.filter(r => r.id !== id)))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, live)
    const s = await read($, stats)
    const width = e.props.bodyColumns
    const nameCol = Math.min(16, Math.max(8, Math.floor(width / 3)))

    const elapsed = l.turnStartedAt === null ? null : Math.max(0, l.now - l.turnStartedAt)
    const main = l.running.filter(r => !r.isSubagent)
    const subs = l.running.filter(r => r.isSubagent)

    const head =
      l.phase === 'idle'
        ? { mark: '○', color: 'subtle', text: 'Idle' }
        : l.phase === 'thinking'
          ? { mark: '●', color: 'claude', text: 'Thinking' }
          : { mark: '●', color: 'warning', text: `Running ${main.map(r => r.tool).join(', ')}` }

    const hit = cacheHitPct(s.tokens)
    const tools = toolRows(s).slice(0, SHOW_TOOLS)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={head.color} bold>
            {head.mark} {head.text}
          </Text>
          {elapsed !== null && <Text dimColor> · {fmtMs(elapsed)}</Text>}
          {subs.length > 0 && <Text dimColor> · {subs.length} in subagents</Text>}
        </Box>

        <Text dimColor wrap="truncate-end">
          {s.turns} turns
          {s.lastTurnMs !== null ? ` · last ${fmtMs(s.lastTurnMs)}` : ''}
          {s.lastTurnReason !== null && s.lastTurnReason !== 'answer' ? ` (${s.lastTurnReason})` : ''}
        </Text>
        <Text dimColor wrap="truncate-end">
          tokens in {fmtCount(s.tokens.input + s.tokens.cacheRead + s.tokens.cacheWrite)} · out{' '}
          {fmtCount(s.tokens.output)}
          {hit !== null ? ` · cache ${hit}%` : ''}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Tools</Text>
          {tools.length === 0 && <Text dimColor>none yet</Text>}
          {tools.map(([name, t]) => (
            <Box key={`tool-${name}`}>
              <Text wrap="truncate-end">{name.padEnd(nameCol).slice(0, nameCol)}</Text>
              <Text>{String(t.calls).padStart(4)}</Text>
              <Text dimColor> {fmtMs(t.totalMs / t.calls).padStart(7)} avg</Text>
              {t.errors > 0 && <Text color="error"> ✗{t.errors}</Text>}
              {t.denies > 0 && <Text color="warning"> ⊘{t.denies}</Text>}
            </Box>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Files {s.files.length > 0 ? <Text dimColor>({s.files.length})</Text> : null}</Text>
          {s.files.length === 0 && <Text dimColor>none yet</Text>}
          {s.files.slice(0, SHOW_FILES).map(f => (
            <Box key={`file-${f.path}`}>
              <Text color={f.op === 'read' ? 'subtle' : f.op === 'write' ? 'success' : 'warning'}>
                {OP_MARK[f.op]}{' '}
              </Text>
              <Text wrap="truncate-start">{shortPath(f.path, root)}</Text>
            </Box>
          ))}
        </Box>

        {s.errors.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color="error">
              Errors ({s.errors.length})
            </Text>
            {s.errors.slice(0, SHOW_ERRORS).map((err, i) => (
              <Box key={`err-${i}`}>
                <Text wrap="truncate-end">
                  <Text color="error">{err.tool}</Text>
                  <Text dimColor> {err.text}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Button key="reset" label="Reset" hotkey="r" onPress={() => reset($)} />
        </Box>
      </Box>
    )
  })
}
