import type { Register, RenderChildren } from 'claude-code'

import type { HarvestTimer, Option } from '../types'

// Shown in the band above the prompt (not a pane), so it sits beside other mods' panes instead of in a tab.
const isOpen = { plugin: 'harvest-live', key: 'isOpen' } as const
const API = 'https://api.harvestapp.com/v2'
const timer = { plugin: 'harvest-live', key: 'timer' } as const
const tick = { plugin: 'harvest-live', key: 'tick' } as const
const log = { plugin: 'harvest-live', key: 'log' } as const
const projects = { plugin: 'harvest-live', key: 'projects' } as const
const tasks = { plugin: 'harvest-live', key: 'tasks' } as const
const draft = { plugin: 'harvest-live', key: 'draft' } as const
const status = { plugin: 'harvest-live', key: 'status' } as const
const phase = { plugin: 'harvest-live', key: 'phase' } as const
const day = { plugin: 'harvest-live', key: 'day' } as const
const edited = { plugin: 'harvest-live', key: 'edited' } as const

const busy = { plugin: 'harvest-live', key: 'busy' } as const
// Which field shows its control; the rest show as text with a Change/Edit button.
const editing = { plugin: 'harvest-live', key: 'editField' } as const
// While busy the header draws one text spinner (the desktop band drew neither Svg nor Progress).
const frame = { plugin: 'harvest-live', key: 'frame' } as const
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let stopSpinner: (() => void) | undefined
async function setBusy($: any, value: '' | 'suggest' | 'start') {
  await $.state.set(busy, value)
  stopSpinner?.()
  stopSpinner = undefined
  if (!value) return
  const ticker = $.clock.every(120, async () => {
    try {
      const { value: f = 0 } = await $.state.get(frame)
      await $.state.set(frame, (f + 1) % SPINNER.length)
    } catch {
      ticker.cancel() // the module was unloaded under a running ticker: stop quietly
    }
  })
  stopSpinner = () => ticker.cancel()
}

const TOOL = 'set_work_context'
const TOOL_ID = 'mcp__harvest-live__set_work_context'
const HINT =
  'A Harvest time-tracking panel was just opened for the user and suggests a timer from their prompt. ' +
  `As soon as you know what the work is (for example after reading a linked ticket or issue), call ${TOOL_ID} once with its title and a one-line summary so the suggestion is accurate. ` +
  'Do not ask the user anything about Harvest, do not wait for the panel, and do not mention it.'

let cancelTick: (() => void) | undefined
// ponytail: the newest suggestion run owns the panel; an older, slower one must not write over it.
let generation = 0
let isStarting = false

const clock = (s: number) =>
  [s / 3600, (s % 3600) / 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':')

// ponytail: Harvest replies are JSON text; anything else -> {} and the panel stays as it was.
const parse = (text?: string): any => {
  try {
    return JSON.parse(text ?? '{}')
  } catch {
    return {}
  }
}
// Mirrors a start/stop/get result into the panel state; used by the buttons and by the model's own Harvest calls.
async function track($: any, tool: string, text?: string) {
  const body = parse(text)
  const t = body.running_timer ?? (body.time_entry?.is_running ? body.time_entry : null)
  const isStop = tool.endsWith('stop_timer')
  if (!t && !isStop && !tool.endsWith('get_running_timer')) return

  // The REST API nests project and task; the Harvest MCP server flattens them.
  const value: HarvestTimer | null = t
    ? {
        id: t.id ? String(t.id) : '',
        project: t.project?.name ?? t.project_name,
        task: t.task?.name ?? t.task_name,
        notes: t.notes ?? '',
        startedAt: Date.parse(t.timer_started_at ?? t.started_at ?? '') || Date.now(),
      }
    : null
  const at = new Date(await $.clock.now()).toTimeString().slice(0, 5)
  const { value: old = [] } = await $.state.get(log)
  await $.state.set(timer, value)
  await $.state.set(log, [`${at} ${value ? `▶ ${value.notes || value.task}` : 'stopped'}`, ...old].slice(0, 6))
  cancelTick?.()
  cancelTick = value
    ? $.clock.every(30000, async () => {
        const { value: n = 0 } = await $.state.get(tick)
        await $.state.set(tick, n + 1)
      })
    : undefined
}

// Your Harvest credentials, from the mod's settings (the token is kept in the system keychain).
let creds = { token: '', accountId: '' }
const NOT_CONNECTED = 'Harvest is not connected yet'
const TOKEN_PAGE = 'https://id.getharvest.com/developers'
const connected = { plugin: 'harvest-live', key: 'connected' } as const
const connectNote = { plugin: 'harvest-live', key: 'connectNote' } as const
const accounts = { plugin: 'harvest-live', key: 'accounts' } as const
// A pasted token waiting for the person to pick one of several Harvest accounts.
let pendingToken = ''

// Checks a pasted token with Harvest, finds its account, and keeps both.
async function connect($: any, pasted: string) {
  const token = pasted.trim()
  if (!token) return
  await $.state.set(connectNote, 'Checking your token…')
  try {
    const r = await $.http.fetch('https://id.getharvest.com/api/v2/accounts', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'harvest-live Claude Code mod' },
    })
    if (r.status === 401) return $.state.set(connectNote, "Harvest didn't accept that token. Copy it again from the token page.")
    if (!r.ok) return $.state.set(connectNote, `Harvest answered ${r.status}. Try again in a moment.`)
    const body = parse(r.text)
    const list: Option[] = (body.accounts ?? [])
      .filter((a: any) => !a.product || a.product === 'harvest')
      .map((a: any) => ({ value: String(a.id), label: String(a.name) }))
    if (list.length === 0) return $.state.set(connectNote, 'That token has no Harvest account.')
    const who = [body.user?.first_name, body.user?.last_name].filter(Boolean).join(' ')
    if (list.length > 1) {
      pendingToken = token
      await $.state.set(accounts, list)
      return $.state.set(connectNote, `Hi${who ? ` ${who}` : ''}, which Harvest account?`)
    }
    await save($, token, list[0]!, who)
  } catch (err) {
    await $.state.set(connectNote, `Couldn't reach Harvest: ${(err as Error).message}`)
  }
}

async function save($: any, token: string, account: Option, who = '') {
  creds = { token, accountId: account.value }
  pendingToken = ''
  await $.state.set(accounts, [])
  // Keep it for later sessions: the token goes to Claude Code's secure storage, like a value set at install.
  const values = JSON.stringify({ harvestToken: token, harvestAccountId: account.value })
  let isSaved = false
  for (const id of [`${$.plugin.name}@agent-tools`, $.plugin.name]) {
    try {
      const r = await $.process.run(['claude', 'plugin', 'configure', id, '--values-stdin'], { stdin: values, timeoutMs: 20000 })
      if (r.exitCode === 0) {
        isSaved = true
        break
      }
    } catch {
      // No claude on PATH, or no host commands here: fall through to "this session only".
    }
  }
  await $.state.set(connectNote, `Connected${who ? ` as ${who}` : ''} · ${account.label}${isSaved ? '' : ' (for this session only)'}`)
  await $.state.set(connected, true)
  void loadRunning($)
  void seed($)
}

async function api($: any, method: string, path: string, body?: unknown) {
  if (!creds.token) throw new Error(NOT_CONNECTED)
  if (!creds.accountId) {
    // A token set from the shell without an account ID: use its first Harvest account.
    const r = await $.http.fetch('https://id.getharvest.com/api/v2/accounts', {
      headers: { Authorization: `Bearer ${creds.token}`, 'User-Agent': 'harvest-live Claude Code mod' },
    })
    const first = (parse(r.text).accounts ?? []).find((a: any) => !a.product || a.product === 'harvest')
    if (!r.ok || !first) throw new Error('Harvest refused your token')
    creds = { ...creds, accountId: String(first.id) }
  }
  const r = await $.http.fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Harvest-Account-Id': creds.accountId,
      'User-Agent': 'harvest-live Claude Code mod',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (r.status === 401 || r.status === 403) throw new Error('Harvest refused your token or account ID')
  if (!r.ok) throw new Error(`Harvest answered ${r.status}`)
  return parse(r.text)
}

// Projects and task lists barely change: kept in $.store (survives across chats) and refetched once a day.
// One call gives both: the projects you are assigned to, each with its tasks.
// ponytail: a project added mid-day shows up tomorrow, or after /harvest refresh.
type Catalog = { day: string; projects: Option[]; tasks: Record<string, Option[]> }
async function catalog($: any): Promise<Catalog> {
  const today = new Date(await $.clock.now()).toDateString()
  const hit = (await $.store.get('catalog')) as Catalog | undefined
  if (hit?.day === today && hit.projects.length) return hit
  const body = await api($, 'GET', '/users/me/project_assignments?is_active=true&per_page=2000')
  const rows: any[] = body.project_assignments ?? []
  const fresh: Catalog = {
    day: today,
    projects: rows.map(a => ({
      value: String(a.project.id),
      label: a.client?.name && a.client.name !== a.project.name ? `${a.project.name} · ${a.client.name}` : String(a.project.name),
    })),
    tasks: Object.fromEntries(
      rows.map(a => [
        String(a.project.id),
        (a.task_assignments ?? []).filter((t: any) => t.is_active !== false).map((t: any) => ({ value: String(t.task.id), label: String(t.task.name) })),
      ]),
    ),
  }
  if (fresh.projects.length) await $.store.set('catalog', fresh)
  return fresh
}

async function loadProjects($: any): Promise<Option[]> {
  const { value: cached = [] } = await $.state.get(projects)
  if (cached.length) return cached
  const list = (await catalog($)).projects
  await $.state.set(projects, list)
  return list
}

async function loadTasks($: any, projectId: string): Promise<Option[]> {
  const list = (await catalog($)).tasks[projectId] ?? []
  await $.state.set(tasks, list)
  return list
}

// What is running now, so the band can offer Switch and show the clock.
async function loadRunning($: any) {
  try {
    const body = await api($, 'GET', `/time_entries?is_running=true&user_id=${(await me($)).id}`)
    const running = (body.time_entries ?? [])[0]
    await track($, running ? 'start_timer' : 'stop_timer', JSON.stringify(running ? { time_entry: running } : {}))
  } catch {
    // The band still works without it; Start just won't stop an unknown timer first.
  }
}
async function me($: any): Promise<{ id: number }> {
  const hit = (await $.store.get('me')) as { id: number } | undefined
  if (hit?.id) return hit
  const body = await api($, 'GET', '/users/me')
  await $.store.set('me', { id: body.id })
  return { id: body.id }
}

const errorText = (err: unknown) => {
  const m = (err as Error).message
  return m.startsWith('Harvest') ? m : `Harvest error: ${m}`
}

// The person's own change to a field: merged into the current draft (not a stale copy), and it wins over a late suggestion.
async function patch($: any, fields: Record<string, string>) {
  const { value: d = { project: '', task: '', notes: '' } } = await $.state.get(draft)
  await $.state.set(edited, true)
  await $.state.set(draft, { ...d, ...fields })
}

// Manual open: clear any old message, and select the first project + task so Start works at once.
async function seed($: any) {
  try {
    await setBusy($, 'suggest')
    await $.state.set(status, 'Loading your Harvest projects…')
    const list = await loadProjects($)
    const { value: d = { project: '', task: '', notes: '' } } = await $.state.get(draft)
    const first = list[0]
    if (d.project || !first) return
    const taskList = await loadTasks($, first.value)
    await $.state.set(draft, { ...d, project: first.value, task: taskList[0]?.value ?? '' })
  } catch (err) {
    await $.state.set(status, errorText(err))
  } finally {
    const { value: s = '' } = await $.state.get(status)
    if (s.startsWith('Loading')) await $.state.set(status, '')
    await setBusy($, '')
  }
}

// Background pre-fill: pick project, task and a short description for the prompt. Never blocks the turn.
async function prefill($: any, prompt: string) {
  const mine = ++generation
  try {
    await setBusy($, 'suggest')
    await $.state.set(edited, false)
    await $.state.set(status, 'Reading your Harvest projects…')
    const list = await loadProjects($)
    if (list.length === 0) await $.state.set(status, 'No Harvest projects found')
    if (list.length === 0) throw new Error('no projects')

    // What the old hook had for free: where the work happens (folder/repo names match project names) and what is running now.
    const cwd = await $.session.cwd()
    const { value: running = null } = await $.state.get(timer)
    const context = [
      `Task: ${prompt.slice(0, 1500)}`,
      `Working directory: ${cwd}`,
      running ? `Timer running now: ${running.project} / ${running.task} - ${running.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    // ponytail: no silent "first option" fallback; an unclear answer leaves the field empty for the person to choose.
    const pick = async (what: string, options: Option[]) => {
      const r = await $.model.complete({
        model: 'sonnet',
        system: 'You file time entries in Harvest. Match the work to the most specific fitting option. Reply with the option id only, or 0 if none clearly fits.',
        prompt: `${what}\n\n${options.map(o => `${o.value}: ${o.label}`).join('\n')}\n\n${context}`,
        maxTokens: 20,
      })
      const id = r.isAnswered ? r.text.match(/\d+/)?.[0] : undefined
      return options.find(o => o.value === id)?.value ?? ''
    }

    await $.state.set(status, 'Picking a project…')
    const project = await pick('Which Harvest project does this work belong to?', list)
    await $.state.set(status, 'Picking a task…')
    const taskOptions = project ? await loadTasks($, project) : []
    const task = taskOptions.length ? await pick('Which task (discipline) fits this work?', taskOptions) : ''
    await $.state.set(status, 'Writing a description…')
    const note = await $.model.complete({
      model: 'haiku',
      system: 'Reply with the description only. If the work is unclear, reply with exactly: -',
      prompt: `Write a Harvest time-entry description for this work: max 8 words, imperative, no fluff, no quotes.\n\n${context}`,
      maxTokens: 30,
    })
    if (mine !== generation) return
    const { value: isEdited = false } = await $.state.get(edited)
    if (!isEdited) await $.state.set(draft, { project, task, notes: note.isAnswered ? cleanNote(note.text) : '' })
    await $.state.set(status, isEdited ? 'Kept your edits' : project ? 'Suggested from your prompt' : "Couldn't tell which project, please pick one")
  } catch (err) {
    if (mine === generation) await $.state.set(status, errorText(err))
  } finally {
    if (mine === generation) await setBusy($, '')
  }
}

// A refusal or a ramble ("I don't have the details of…") is not a description: leave the field empty.
const cleanNote = (text: string) => {
  const t = text.trim().replace(/^["'“]|["'”.]$/g, '').trim()
  const words = t.split(/\s+/).filter(Boolean).length
  if (!t || t === '-' || words > 10 || /^(i |i'm |i’m |sorry|unfortunately|i don|i can|without |there (is|are) no)/i.test(t)) return ''
  return t
}

async function start($: any) {
  if (isStarting) return
  isStarting = true
  try {
    const { value: d } = await $.state.get(draft)
    if (!d || !d.project || !d.task) return $.state.set(status, 'Pick a project and a task first')
    await setBusy($, 'start')
    const { value: running = null } = await $.state.get(timer)
    if (running?.id) await track($, 'stop_timer', JSON.stringify(await api($, 'PATCH', `/time_entries/${running.id}/stop`)))
    const now = new Date(await $.clock.now())
    // Your local date, not UTC: an evening entry west of UTC stays on today.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    // No hours and no end time: Harvest starts it as a running timer.
    const entry = await api($, 'POST', '/time_entries', { project_id: Number(d.project), task_id: Number(d.task), spent_date: today, notes: d.notes })
    await track($, 'start_timer', JSON.stringify({ time_entry: entry }))
    await $.state.set(phase, 'done')
    $.clock.after(2000, () => void $.state.set(isOpen, false))
  } catch (err) {
    await $.state.set(status, errorText(err))
  } finally {
    isStarting = false
    await setBusy($, '')
  }
}

// When the band opens by itself, from the mod's settings (shown in /config). /harvest works any time.
const minutes = (hhmm: unknown, fallback: number) => {
  const m = String(hhmm ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/)
  return m ? Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2] ?? 0)) : fallback
}
const DAYS: Record<string, number[]> = {
  'Monday to Friday': [1, 2, 3, 4, 5],
  'Monday to Saturday': [1, 2, 3, 4, 5, 6],
  'Every day': [0, 1, 2, 3, 4, 5, 6],
  Never: [],
}
const workingHours = (options: Record<string, unknown>) => ({
  start: minutes(options.workStart, 9 * 60),
  end: minutes(options.workEnd, 18 * 60),
  days: DAYS[String(options.workDays ?? '')] ?? DAYS['Monday to Friday']!,
})
let hours = workingHours({})
const isWorkTime = (now: Date) => {
  const m = now.getHours() * 60 + now.getMinutes()
  return hours.days.includes(now.getDay()) && m >= hours.start && m < hours.end
}

// Glyph icons on every surface: an Svg drew nothing in the desktop band.
const ICONS = {
  track: { glyph: '◷', color: 'claude' },
  running: { glyph: '●', color: 'success' },
  done: { glyph: '✓', color: 'success' },
  error: { glyph: '!', color: 'warning' },
} as const

export const register: Register = (on, options) => {
  creds = { token: String(options.harvestToken ?? '').trim(), accountId: String(options.harvestAccountId ?? '').trim() }
  hours = workingHours(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'harvest', description: 'Open the Harvest band (/harvest refresh: refetch projects and tasks)' })
    await $.tool.register({
      name: TOOL,
      description:
        'Tells the Harvest time-tracking panel what the work is, so its suggestion (project, task, description) is accurate. ' +
        'Call once, as soon as you know the work: after reading the linked ticket/issue, or right away if the prompt is already clear. ' +
        'Only when a Harvest panel was announced for this chat; never ask the user anything about Harvest.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The ticket or task title, as written' },
          summary: { type: 'string', description: 'One or two lines on what the work is' },
          reference: { type: 'string', description: 'Ticket or issue id/URL, if any (#123, ABC-42)' },
        },
        required: ['title'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  // The model reports the real title (e.g. after reading the ticket); redo the suggestion from it, unless the person already edited.
  on('tool.call', { tool: TOOL_ID }, async ($, e) => {
    const input = e as unknown as { title?: string; summary?: string; reference?: string }
    const { value: isEdited = false } = await $.state.get(edited)
    const { value: step = 'edit' } = await $.state.get(phase)
    if (isEdited || step === 'done' || !input.title) return { result: 'Noted. The person already filled in the panel; carry on.' }

    void prefill($, [input.reference, input.title, input.summary].filter(Boolean).join('\n'))
    return { result: 'Harvest panel updated. Carry on with the task; do not mention Harvest.' }
  })

  // /harvest alone seeds the first project; /harvest <what you are doing> gets a real suggestion for that text.
  on('command.run', { command: 'harvest' }, async ($, e) => {
    if (e.args.trim() === 'refresh') {
      for (const key of await $.store.keys()) if (key === 'catalog' || key === 'me') await $.store.delete(key)
      await $.state.set(projects, [])
      await $.state.set(tasks, [])
      return { text: 'Harvest projects and tasks will be fetched fresh.' }
    }
    await $.state.set(phase, 'edit')
    await $.state.set(editing, '')
    await $.state.set(isOpen, true)
    if (!creds.token) return { text: 'Harvest panel opened. Connect your account in it.' }
    void loadRunning($)
    if (e.args.trim()) void prefill($, e.args)
    else void seed($)
    return { text: 'Harvest panel opened.' }
  })

  // Mirror what the model's own Harvest calls change.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool.startsWith('mcp__harvest__') && ran.deny === undefined && !ran.isError) await track($, e.tool, ran.text)
    return ran
  })

  // First prompt of a session, and the first one on a later day (a resumed chat), within the working hours set, unless --no-harvest.
  // Opens the panel and pre-fills in the background, never waits.
  on('prompt.submit', async ($, e, next) => {
    const now = new Date(await $.clock.now())
    const isWork = isWorkTime(now)
    const today = now.toDateString()
    const { value: lastDay = '' } = await $.state.get(day)
    if (isWork && lastDay !== today && !e.text.includes('--no-harvest')) {
      await $.state.set(day, today)
      await $.state.set(isOpen, true)
      if (!creds.token) return next(e)
      void loadRunning($)
      void prefill($, e.text)
      // Only point Claude at the tool when this session really has it.
      const hasTool = (await $.tool.list()).some((t: { name: string }) => t.name === TOOL_ID)
      return hasTool ? next({ ...e, context: [...(e.context ?? []), HINT] }) : next(e)
    }
    return next(e)
  })


  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: open = false } = await $.state.get(isOpen)
    if (!open || e.props.hasSurvey) return next(e)
    const { Box, Text, Button, Select, Input, Link } = $.ui.resolve(e)
    const icon = (name: keyof typeof ICONS) => <Text color={ICONS[name].color}>{ICONS[name].glyph}</Text>
    const close = () => $.state.set(isOpen, false)

    // Set at install (creds), or just now in this band (the state write redraws it).
    const { value: hasJustConnected = false } = await $.state.get(connected)
    const isConnected = !!creds.token || hasJustConnected
    if (!isConnected) {
      const { value: hello = '' } = await $.state.get(connectNote)
      const { value: choices = [] } = await $.state.get(accounts)
      const isBad = /^(Harvest didn't|Harvest answered|That token|Couldn't)/.test(hello)
      return (
        <Box flexDirection="column" gap={1}>
          <Box gap={1} alignItems="center">
            {icon('track')}
            <Box flexGrow={1}>
              <Text bold>Connect Harvest</Text>
            </Box>
            <Button key="ignore" role="dismiss" variant="secondary" hotkey="x" label="Ignore" onPress={close} />
          </Box>
          <Text dimColor wrap="wrap">
            Track time from here. Create a personal access token on Harvest's token page, then paste it below. It's saved in Claude Code's secure storage.
          </Text>
          <Link href={TOKEN_PAGE} label="Open Harvest's token page ↗" />
          {choices.length ? (
            <Select
              key="account"
              autoFocus
              options={[{ value: '', label: 'Choose an account' }, ...choices]}
              value=""
              onSelect={v => {
                const pick = choices.find(c => c.value === v)
                if (pick && pendingToken) return save($, pendingToken, pick)
              }}
            />
          ) : (
            <Input key="token" autoFocus placeholder="Paste your token here" submitLabel="connect" onSubmit={v => connect($, v)} />
          )}
          {hello ? (
            <Text color={isBad ? 'warning' : undefined} dimColor={!isBad} wrap="wrap">{hello}</Text>
          ) : null}
        </Box>
      )
    }
    const { value: t = null } = await $.state.get(timer)
    await $.state.get(tick) // redraws the running clock every 30 s
    const { value: projectList = [] } = await $.state.get(projects)
    const { value: taskList = [] } = await $.state.get(tasks)
    const { value: d = { project: '', task: '', notes: '' } } = await $.state.get(draft)
    const { value: note = '' } = await $.state.get(status)
    const { value: step = 'edit' } = await $.state.get(phase)
    const { value: work = '' } = await $.state.get(busy)
    const seconds = t ? Math.max(0, Math.floor((await $.clock.now() - t.startedAt) / 1000)) : 0
    const isError = /^(Harvest |No Harvest|Pick a project)/.test(note)

    if (step === 'done' && t) {
      return (
        <Box gap={1} alignItems="center">
          {icon('done')}
          <Text bold>Timer started</Text>
          <Text dimColor wrap="truncate-end">{t.project} / {t.task}{t.notes ? ` · ${t.notes}` : ''}</Text>
        </Box>
      )
    }

    const taskName = taskList.find(o => o.value === d.task)?.label ?? ''
    const startLabel = t ? 'Switch' : 'Start'

    const { value: open_ = '' } = await $.state.get(editing)
    const field = typeof open_ === 'string' ? open_ : '' // an older session stored a boolean here
    const hint = note || (d.project ? '' : 'Pick a project, or type a prompt for a suggestion')
    const { value: f = 0 } = await $.state.get(frame)
    const edit = (name: 'project' | 'task' | 'notes') => () => $.state.set(editing, field === name ? '' : name)

    // One row per field: label, then the value as text (or a loader, or the control), then its button.
    const row = (name: 'project' | 'task' | 'notes', label: string, value: string, empty: string, control: RenderChildren) => (
      <Box gap={1} alignItems={field === name ? 'flex-start' : 'center'}>
        <Box width={12}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexGrow={1}>
          {field === name ? (
            control
          ) : (
            // The value itself is the control: no separate button column at the right edge.
            <Button key={`edit-${name}`} plain hover={{ scope: `field-${name}`, underline: true }} onPress={edit(name)}>
              <Text dimColor={!value}>{value || empty}</Text>
              <Text dimColor>{name === 'notes' ? '  ✎' : '  ▾'}</Text>
            </Button>
          )}
        </Box>
      </Box>
    )

    const projectLabel = projectList.find(p => p.value === d.project)?.label ?? ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1} alignItems="center">
          {work ? <Text color="claude">{SPINNER[f % SPINNER.length]}</Text> : icon(isError ? 'error' : 'track')}
          <Box flexGrow={1}>
            <Text bold>Harvest</Text>
          </Box>
          {t && (
            <Box gap={1} alignItems="center">
              {icon('running')}
              <Text>{clock(seconds)}</Text>
              <Text dimColor wrap="truncate-end">{t.project} / {t.task}</Text>
            </Box>
          )}
          <Button key="ignore" role="dismiss" variant="secondary" hotkey="x" label="Ignore" onPress={close} />
        </Box>

        {!work && row(
          'project',
          'Project',
          projectLabel,
          'No project yet',
          <Select
            key="project"
            autoFocus
            options={
              projectList.length
                ? d.project ? projectList : [{ value: '', label: 'Choose a project' }, ...projectList]
                : [{ value: '', label: 'Loading projects…' }]
            }
            value={d.project}
            onSelect={async v => {
              await patch($, { project: v, task: '' })
              await $.state.set(editing, '')
              const list = await loadTasks($, v)
              await patch($, { task: list[0]?.value ?? '' })
            }}
          />,
        )}

        {!work && row(
          'task',
          'Task',
          taskName,
          d.project ? 'No task yet' : 'Pick a project first',
          <Select
            key="task"
            autoFocus
            options={taskList.length ? taskList : [{ value: '', label: 'Pick a project first' }]}
            value={d.task}
            onSelect={async v => {
              await patch($, { task: v })
              await $.state.set(editing, '')
            }}
          />,
        )}

        {!work && row(
          'notes',
          'Description',
          d.notes,
          'No description yet',
          <Input
            key="notes"
            rows={3}
            autoFocus
            placeholder="What are you working on?"
            value={d.notes}
            submitLabel="done"
            onInput={v => patch($, { notes: v })}
            onSubmit={async v => {
              await patch($, { notes: v })
              await $.state.set(editing, '')
            }}
          />,
        )}

        {!work && (
          <Box gap={2} alignItems="center">
            <Box flexGrow={1}>
              <Text color={isError ? 'warning' : undefined} dimColor={!isError} wrap="truncate-end">{hint}</Text>
            </Box>
            <Button key="start" variant="primary" hotkey="s" label={startLabel} onPress={() => start($)} />
          </Box>
        )}
      </Box>
    )
  })
}
