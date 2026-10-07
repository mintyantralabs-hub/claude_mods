import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'clear-view',
  component: 'Pane',
  requestId: 'clear-view',
  props: {
    title: 'Clear View',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

test('tool calls show up as tool stats, files and errors', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })

  on('tool.call', async (_$, e) => {
    await clock.advance(250)
    if (e.tool === 'Bash') {
      return { result: {}, text: 'exit 1: make: *** [all] Error 2', isError: true }
    }

    return { result: {}, text: 'ok' }
  })

  await $.tool.call({ tool: 'Read', tool_use_id: 't1', file_path: '/repo/src/main.c' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 't2', file_path: '/repo/src/main.c', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', tool_use_id: 't3', file_path: '/repo/include/board.h', content: '' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 't4', command: 'make' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ text: 'Idle' })).toBeDefined()
    expect(await ui.find({ key: 'tool-Read' })).toBeDefined()
    expect(await ui.find({ key: 'tool-Bash', text: /✗1/ })).toBeDefined()
    expect(await ui.find({ text: 'Files (2)' })).toBeDefined()
    expect((await ui.find({ key: 'file-/repo/src/main.c' }))?.text).toMatch(/^M /)
    expect((await ui.find({ key: 'file-/repo/include/board.h' }))?.text).toMatch(/^W /)
    expect(await ui.find({ text: 'Errors (1)' })).toBeDefined()
    expect(await ui.find({ key: 'err-0', text: /Error 2/ })).toBeDefined()

    await ui.unmount()
  }
})

test('turns count, tokens add up and reset clears everything', async ($, on) => {
  mock.clock(on, { now: 5_000 })

  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  await $.turn.start({ text: 'build it', turnId: 'turn-1' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: 'Thinking' })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'done',
    durationMs: 12_400,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: {
      model: 'claude-test',
      input_tokens: 1_000,
      output_tokens: 2_500,
      cache_read_input_tokens: 9_000,
      cache_creation_input_tokens: 0,
    },
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ text: 'Idle' })).toBeDefined()
    expect(await ui.find({ text: /1 turns · last 12\.4s/ })).toBeDefined()
    expect(await ui.find({ text: /tokens in 10k · out 2\.5k · cache 90%/ })).toBeDefined()

    await ui.unmount()
  }

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await terminal.press({ key: 'reset' })
  await terminal.unmount()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ text: /0 turns/ })).toBeDefined()
    expect(await ui.find({ text: /cache/ })).toBeUndefined()

    await ui.unmount()
  }
})
