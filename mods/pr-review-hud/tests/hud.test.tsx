import { expect, mock, test } from 'claude-code/testing'

const START = 'mcp__pr-review-hud__review_start'
const UPDATE = 'mcp__pr-review-hud__review_update'

const pane = (placement: 'widget' | 'dock') =>
  ({
    plugin: 'pr-review-hud',
    component: 'Pane',
    requestId: 'pr-review',
    props: {
      title: 'PR review',
      isFocused: false,
      bodyColumns: 50,
      placement,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

const row = (tool: string, id: string, input: Record<string, unknown>) =>
  ({
    plugin: 'pr-review-hud',
    component: 'ToolUse',
    requestId: id,
    props: {
      tool_use_id: id,
      tool,
      input,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  }) as const

const BAND = {
  plugin: 'pr-review-hud',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const START_INPUT = {
  pr: '#42',
  title: 'Add map filter',
  problem: 'Users cannot filter the map.',
  approach: 'Adds a filter store.',
  verdict: 'redo',
  verdictReason: 'Filters the wrong dataset.',
  issues: [
    { id: '2', severity: 'minor', title: 'Naming', what: 'w', fix: 'f' },
    { id: '1', severity: 'blocking', title: 'Wrong dataset', file: 'a.ts', line: 3, what: 'Filters `pins`', fix: 'Filter `alerts`' },
    { id: '3', severity: 'major', title: 'Global store', what: 'w', fix: 'f' },
  ],
  currentIssueId: '1',
}

const PRESENT = {
  currentIssueId: '3',
  code: { source: 'const a = 1\nconst b = a', startLine: 1 },
  options: [
    { label: 'Fix it', isRecommended: true, diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = a\n+const b = a + 1\n' },
    { label: 'Leave as-is' },
  ],
}

type Body = Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>

function engine(on: Parameters<Body>[1], sent: string[] = [], contexts: (readonly string[] | undefined)[] = []) {
  on('command.register', () => ({ value: { command: 'pr-review-hud' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pr-review-hud__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
}

test('terminal: chat cards and status pane stay text', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const started = await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT })
  expect(String(started.result)).toContain('3 issues')
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u1', statuses: [{ id: '1', status: 'fixed', note: 'done' }] })
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u2', ...PRESENT })
  const surface = 'terminal' as const

  const overview = await $.ui.mount({ ...row(START, 's1', START_INPUT), surface })
  expect(await overview.find({ type: 'Text', text: /Verdict: Better redone/ })).toBeDefined()
  await overview.unmount()

  const quiet = await $.ui.mount({ ...row(UPDATE, 'u1', { statuses: [{ id: '1', status: 'fixed', note: 'done' }] }), surface })
  expect((await quiet.find({ type: 'Text', text: /Wrong dataset/ }))?.text).toBe('✓ Wrong dataset — done')
  await quiet.unmount()

  const card = await $.ui.mount({ ...row(UPDATE, 'u2', PRESENT), surface })
  expect(await card.find({ type: 'Text', text: /Issue 2\/3 · MAJOR/ })).toBeDefined()
  await card.unmount()

  const widget = await $.ui.mount({ ...pane('widget'), surface })
  expect((await widget.find({ type: 'Text', text: /blocking/ }))?.text).toBe('● 1 blocking (1✓)')
  await widget.unmount()

  const band = await $.ui.mount({ ...BAND, surface })
  expect(await band.find({ type: 'Text', text: /Global store/ })).toBeDefined()
  await band.unmount()
})

test('desktop: read in the pane, decide in the band, history in the chat', async ($, on) => {
  const sent: string[] = []
  engine(on, sent)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT })
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u1', statuses: [{ id: '1', status: 'fixed', note: 'done' }] })
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u2', ...PRESENT })
  const surface = 'desktop' as const

  const overview = await $.ui.mount({ ...row(START, 's1', START_INPUT), surface })
  expect(await overview.find({ type: 'Text', text: /What this PR solves/ })).toBeDefined()
  await overview.unmount()

  const line = await $.ui.mount({ ...row(UPDATE, 'u2', PRESENT), surface })
  expect(await line.find({ type: 'Text', text: /in the side pane/ })).toBeDefined()
  expect(await line.find({ type: 'Text', text: /What's wrong/ })).toBeUndefined()
  await line.unmount()

  const dock = await $.ui.mount({ ...pane('dock'), surface })
  expect(await dock.find({ type: 'Text', text: /What's wrong/ })).toBeDefined()
  expect((await dock.find({ type: 'Text', text: /const b = a \+ 1/ }))?.text).toBe('const b = a + 1')
  // The PR on top (numbered dots, what's next), the issue in its own card below.
  expect(await dock.find({ type: 'Text', text: /^Issue 2 of 3$/ })).toBeDefined()
  expect((await dock.find({ type: 'Text', text: /^3 · Naming$/ }))?.text).toBe('3 · Naming')
  expect(await dock.find({ type: 'Text', text: /1 of 3 handled/ })).toBeDefined()
  await dock.unmount()

  const band = await $.ui.mount({ ...BAND, surface })
  expect(await band.find({ type: 'Text', text: /2\/3 Global store/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /What's wrong/ })).toBeUndefined()
  await band.press({ key: 'band-3-1' })
  expect(sent).toEqual(['Issue 3: Leave as-is'])
  // Picked: the band steps aside while Claude works on it.
  expect(await band.find({ type: 'Text', text: /Global store/ })).toBeUndefined()
  await band.unmount()

  const after = await $.ui.mount({ ...pane('dock'), surface })
  expect(await after.find({ type: 'Text', text: /Picked: Leave as-is/ })).toBeDefined()
  await after.unmount()
})

test('desktop pane: inline code, split diff when wide, toggle to unified', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT, currentIssueId: '1' })
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u3', ...PRESENT, currentIssueId: '1' })

  const wide = { ...pane('dock'), props: { ...pane('dock').props, bodyColumns: 90 } }
  const ui = await $.ui.mount({ ...wide, surface: 'desktop' })
  // "Filters `pins`": the code span is its own mono Text inside the sentence.
  expect((await ui.find({ type: 'Text', text: /^pins$/ }))?.text).toBe('pins')
  // The snippet shows the line once; split shows it again in both columns.
  expect((await ui.findAll({ type: 'Text', text: /^const a = 1$/ })).length).toBe(3)
  await ui.press({ key: 'layout-toggle' })
  expect((await ui.findAll({ type: 'Text', text: /^const a = 1$/ })).length).toBe(2)
  await ui.unmount()
})

test('other tool rows are left to the engine', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT })

  const other = await $.ui.mount({ ...row('Bash', 'b1', { command: 'ls' }), surface: 'desktop' })
  expect((await other.find({ type: 'Text' }))?.text).toBe('engine')
  await other.unmount()
})

test('/pr-review-hud queues the review with the named instructions', async ($, on) => {
  const sent: string[] = []
  engine(on, sent)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const withSkill = await $.command.run({ command: 'pr-review-hud', args: ':team-review 194' } as never)
  expect(withSkill.text).toContain('team-review')
  await clock.advance(100)
  expect(sent[0]).toContain('Review 194')
  expect(sent[0]).toContain('`pr-review-hud:review`')
  expect(sent[0]).toContain('add the skill `team-review` on top')

  await $.command.run({ command: 'pr-review-hud', args: '' } as never)
  await clock.advance(100)
  expect(sent[1]).toContain('the current branch')
  expect(sent[1]).toContain('default instructions plus any pr-review.md files')

  const opened = await $.command.run({ command: 'pr-review-hud', args: 'open' } as never)
  await clock.advance(100)
  expect(opened.text).toBe('PR review HUD opened.')
  expect(sent.length).toBe(2)
})

test('while a review runs, every prompt carries the plugin rules', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  engine(on, [], seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'hello' } as never)
  await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT })
  await $.prompt.submit({ text: 'Issue 1: Fix it' } as never)
  await $.tool.call({ tool: UPDATE, tool_use_id: 'u9', phase: 'done' })
  await $.prompt.submit({ text: 'thanks' } as never)

  expect(seen[0] ?? []).not.toContainEqual(expect.stringContaining('pr-review-hud: a PR review is running'))
  expect(seen[1] ?? []).toContainEqual(expect.stringContaining('one at a time'))
  expect(seen[2] ?? []).not.toContainEqual(expect.stringContaining('pr-review-hud: a PR review is running'))
})

test('an issue is only presented with at least two options', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: START, tool_use_id: 's1', ...START_INPUT })

  const bare = await $.tool.call({ tool: UPDATE, currentIssueId: '3' })
  expect(bare.deny).toContain('2-4')
  const one = await $.tool.call({ tool: UPDATE, currentIssueId: '3', options: [{ label: 'Fix it' }] })
  expect(one.deny).toContain('at least 2')
  const ok = await $.tool.call({ tool: UPDATE, ...PRESENT })
  expect(ok.deny).toBeUndefined()
  // Settling an issue needs no options.
  const settle = await $.tool.call({ tool: UPDATE, statuses: [{ id: '2', status: 'skipped' }] })
  expect(settle.deny).toBeUndefined()
})

test('"/pr-review-hud:skill" without a space starts a review with that skill', async ($, on) => {
  const sent: string[] = []
  const contexts: (readonly string[] | undefined)[] = []
  engine(on, sent, contexts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: '/pr-review-hud:team-review the latest PR' } as never)
  expect(sent[0]).toContain('Review the latest PR')
  expect(sent[0]).toContain('add the skill `team-review` on top')
  expect(contexts[0] ?? []).toContainEqual(expect.stringContaining('Do not open the file or diff pane'))
})

test('update before start is refused', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const res = await $.tool.call({ tool: UPDATE, phase: 'done' })
  expect(res.deny).toContain('review_start')
})
