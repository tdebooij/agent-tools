import type { RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  // ponytail: scroll/view left out; the band never reads them
  props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 80 } as unknown as RenderPropsOf['AbovePrompt'],
} as const

const CONNECTED = { options: { harvestToken: 'test-token', harvestAccountId: '123' } }

// Stands in for the Harvest REST API: one project with one task, no running timer.
const harvestStub = (on: any, calls: string[]) =>
  on('http.fetch', (_$: unknown, e: { url: string; init?: { method?: string } }) => {
    const path = e.url.replace('https://api.harvestapp.com/v2', '')
    calls.push(`${e.init?.method ?? 'GET'} ${path.split('?')[0]}`)
    if (e.url.startsWith('https://id.getharvest.com/'))
      calls.push(`GET ${e.url}`)
    const body = e.url.startsWith('https://id.getharvest.com/api/v2/accounts')
      ? { user: { first_name: 'Sam' }, accounts: [{ id: 123, name: 'Example Company', product: 'harvest' }] }
      : path.startsWith('/users/me/project_assignments')
      ? {
          project_assignments: [
            { project: { id: 1, name: 'Website' }, client: { name: 'Example Client' }, task_assignments: [{ task: { id: 7, name: 'Development' } }] },
          ],
        }
      : path.startsWith('/users/me')
        ? { id: 42 }
        : path.startsWith('/time_entries?')
          ? { time_entries: [] }
          : {}
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as never
  })

test('band draws its header and fields on every surface, and Ignore clears it', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  harvestStub(on, [])
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000) // let the project load (spinner only) finish
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'harvest-live', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /^Harvest$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Website · Example Client/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  await ui.press({ key: 'ignore' })
  expect(await ui.find({ type: 'Text', text: /^Harvest$/ })).toBeUndefined()
  await ui.unmount()
})

test('without a token the band says how to connect, and calls nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  harvestStub(on, calls)
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Connect Harvest/ })).toBeDefined()
  expect(calls.length).toBe(0)
  await ui.unmount()
})

test('pasting a token in the band connects, finds the account and shows the fields', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  harvestStub(on, calls)
  await $.command.run({ command: 'harvest', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  await ui.input({ key: 'token', text: 'pasted-token' })
  await clock.advance(1000)
  expect(calls).toContain('GET https://id.getharvest.com/api/v2/accounts')
  expect(await ui.find({ type: 'Text', text: /Connect Harvest/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Website · Example Client/ })).toBeDefined()
  await ui.unmount()
})

test('after a suggestion the spinner is gone and the fields show, and a refusal never lands in the description', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  harvestStub(on, [])
  on('model.complete', () => ({ value: { isAnswered: true, text: "I don't have the details of this task" } }) as never)
  await $.command.run({ command: 'harvest', args: 'fix the login redirect' } as never)
  await clock.advance(20000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Project$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /don't have the details/ })).toBeUndefined()
  await ui.unmount()
})

test('projects come from the daily cache when it is from today', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  const today = new Date(clock.now()).toDateString()
  mock.store(on, { catalog: { day: today, projects: [{ value: '1', label: 'Website · Example Client' }], tasks: { '1': [{ value: '7', label: 'Development' }] } } })
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  harvestStub(on, calls)
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  expect(calls.filter(c => c === 'GET /users/me/project_assignments').length).toBe(0)
  await $.command.run({ command: 'harvest', args: 'refresh' } as never)
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  expect(calls.filter(c => c === 'GET /users/me/project_assignments').length).toBe(1)
})

test('Start posts a running time entry for the chosen project and task', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  harvestStub(on, calls)
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  await ui.press({ key: 'start' })
  expect(calls).toContain('POST /time_entries')
  await ui.unmount()
})

test('project and task show as text until Change is pressed', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  harvestStub(on, [])
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'edit-project' })
  expect(await ui.find({ type: 'Select' })).toBeDefined()
  await ui.unmount()
})


test('Switch stops a running timer and starts the new one', CONNECTED, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  const running = { id: 99, is_running: true, timer_started_at: '2026-11-16T08:00:00Z', project: { name: 'Website' }, task: { name: 'Development' }, notes: '' }
  on('http.fetch', (_$: unknown, e: { url: string; init?: { method?: string } }) => {
    const path = e.url.replace('https://api.harvestapp.com/v2', '')
    const method = e.init?.method ?? 'GET'
    calls.push(`${method} ${path.split('?')[0]}`)
    const body =
      path.startsWith('/users/me/project_assignments')
        ? { project_assignments: [{ project: { id: 1, name: 'Website' }, client: { name: 'Example Client' }, task_assignments: [{ task: { id: 7, name: 'Development' } }] }] }
        : path.startsWith('/users/me')
          ? { id: 42 }
          : path.startsWith('/time_entries?')
            ? { time_entries: [running] }
            : method === 'PATCH'
              ? { ...running, is_running: false }
              : { ...running, id: 100 }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as never
  })
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  await ui.press({ key: 'start' })
  expect(calls).toContain('PATCH /time_entries/99/stop')
  expect(calls).toContain('POST /time_entries')
  expect(await ui.find({ type: 'Text', text: /Harvest error/ })).toBeUndefined()
  await ui.unmount()
})

test('demo mode shows made-up projects and starts a timer without calling Harvest', { options: { demo: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  const calls: string[] = []
  harvestStub(on, calls)
  await $.command.run({ command: 'harvest', args: '' } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'harvest-live', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Website relaunch · Example Client/ })).toBeDefined()
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: /Timer started/ })).toBeDefined()
  expect(calls.length).toBe(0)
  await ui.unmount()
})
