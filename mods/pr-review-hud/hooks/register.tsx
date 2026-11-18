import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import { desktopBand, desktopIssueRow, desktopOverview, desktopPane } from './desktop'
import type { Desk } from './desktop'

import type {
  FixOption,
  Issue,
  IssueStatus,
  Snippet,
  Phase,
  Review,
  Severity,
  Verdict,
} from '../types'

const PANE = 'pr-review'
const TITLE = 'PR review'
const START = 'mcp__pr-review-hud__review_start'
const UPDATE = 'mcp__pr-review-hud__review_update'

// Bump the tag when Review's fields change: older stored values are then read as null.
const review = atom({ plugin: 'pr-review-hud', key: 'review' } as const, null, {
  shape: 'review-1',
})

// How diffs in the side pane are laid out: auto picks by the pane's width.
const diffLayout = atom({ plugin: 'pr-review-hud', key: 'diffLayout' } as const, 'auto')

// The plugin's own rules, sent beside every prompt while a review runs, so they hold
// whatever review instructions say and whether or not the workflow skill was loaded.
const CONTRACT = [
  'pr-review-hud: a PR review is running in the HUD. These rules belong to the plugin; review instructions never override them.',
  '- Follow the workflow in the skill `pr-review-hud:review` (load it if it is not loaded yet).',
  '- Present issues one at a time, most severe first, each through `mcp__pr-review-hud__review_update` with `currentIssueId`, `code` and 2-4 `options` (recommended first, "leave as-is" when defensible). Add a unified diff (with @@ hunk headers) to an option when seeing the change makes the choice clearer; for a small or obvious change the description is enough.',
  '- Do not repeat the issue in text and do not ask with AskUserQuestion: the user reads in the HUD and picks there, or types their own answer in the chat. The presenting `review_update` is the last thing in the turn.',
  '- Do not open the file or diff pane (`mcp__ccd_view__show_pane`) for an issue, even when a review skill says to: the HUD shows the code and the diffs. Open a pane only when the user asks for it.',
  '- After a pick: implement it, mark the issue fixed, skipped or backend with a short note, then present the next one.',
  '- Review instructions are additive. The bundled `default-instructions.md` always applies; on top come `~/.claude/pr-review.md` and the repository\'s `.claude/pr-review.md` when they exist, then a skill or file the user named. They decide what to check, never how the review is shown or asked.',
].join('\n')

/** The prompt that starts a review: the workflow skill plus the instructions named, if any. */
function reviewPrompt(named: string | undefined, target: string): string {
  const instructions =
    named === undefined
      ? 'use the default instructions plus any pr-review.md files'
      : named.startsWith(':')
        ? `use the default instructions plus any pr-review.md files, and add the skill \`${named.slice(1)}\` on top`
        : `use the default instructions plus any pr-review.md files, and add the file \`${named}\` on top`
  return (
    `Review ${target === '' ? 'the current branch' : target} with the pr-review-hud workflow: ` +
    `load the skill \`pr-review-hud:review\` and follow it. For step 0, ${instructions}.`
  )
}

// "/pr-review-hud:my-skill 123" (no space) isn't a command; read it as "/pr-review-hud :my-skill 123".
const NAMED_FORM = /^\/pr-review-hud:([A-Za-z0-9_.-]+)\s*([\s\S]*)$/

const SEVERITIES: readonly Severity[] = ['blocking', 'major', 'minor']
const STATUSES: readonly IssueStatus[] = ['open', 'fixed', 'skipped', 'backend']
const VERDICTS: readonly Verdict[] = ['ready', 'fix-issues', 'redo']
const PHASES: readonly Phase[] = ['fetching', 'reviewing', 'walkthrough', 'done']

const SEV_COLOR: Record<Severity, string> = {
  blocking: 'error',
  major: 'warning',
  minor: 'suggestion',
}
const PHASE_LABEL: Record<Phase, string> = {
  fetching: 'PR ophalen',
  reviewing: 'Reviewen',
  walkthrough: 'Issues doorlopen',
  done: 'Klaar',
}
const VERDICT_VIEW: Record<Verdict, { icon: string; label: string; color: string }> = {
  ready: { icon: '✓', label: 'Klaar om te mergen', color: 'success' },
  'fix-issues': { icon: '⚠', label: 'Eerst issues fixen', color: 'warning' },
  redo: { icon: '⛔', label: 'Beter opnieuw opzetten', color: 'error' },
}
const STATUS_ICON: Record<IssueStatus, { icon: string; color?: string }> = {
  open: { icon: '●' },
  fixed: { icon: '✓', color: 'success' },
  skipped: { icon: '–', color: 'subtle' },
  backend: { icon: '↗', color: 'permission' },
}

// ---------- tool input parsing ----------

type Raw = Record<string, unknown>

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined

function parseSnippet(raw: unknown): Snippet | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Raw
  const source = str(r.source)
  if (source === undefined) return undefined
  const startLine =
    typeof r.startLine === 'number' && Number.isFinite(r.startLine) ? r.startLine : undefined
  return { source, path: str(r.path), startLine }
}

function parseOptions(raw: unknown): FixOption[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const options = raw
    .map((o): FixOption | undefined => {
      if (typeof o !== 'object' || o === null) return undefined
      const r = o as Raw
      const label = str(r.label)
      if (label === undefined) return undefined
      return {
        label,
        description: str(r.description),
        diff: str(r.diff),
        isRecommended: r.isRecommended === true ? true : undefined,
      }
    })
    .filter((o): o is FixOption => o !== undefined)
    .slice(0, 6)
  return options.length > 0 ? options : undefined
}

function parseIssue(raw: unknown, index: number, prev?: Issue): Issue | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Raw
  const severity = pick(r.severity, SEVERITIES) ?? prev?.severity
  const title = str(r.title) ?? prev?.title
  if (severity === undefined || title === undefined) return undefined
  const line = typeof r.line === 'number' && Number.isFinite(r.line) ? r.line : prev?.line

  return {
    id: str(r.id) ?? prev?.id ?? String(index + 1),
    severity,
    title,
    file: str(r.file) ?? prev?.file,
    line,
    what: str(r.what) ?? prev?.what ?? '',
    fix: str(r.fix) ?? prev?.fix ?? '',
    status: pick(r.status, STATUSES) ?? prev?.status ?? 'open',
    note: str(r.note) ?? prev?.note,
    code: parseSnippet(r.code) ?? prev?.code,
    options: parseOptions(r.options) ?? prev?.options,
    decision: prev?.decision,
    presentedIn: prev?.presentedIn,
  }
}

const bySeverity = (a: Issue, b: Issue) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)

function tally(r: Review) {
  const counts = SEVERITIES.map(sev => {
    const all = r.issues.filter(i => i.severity === sev)
    return { sev, total: all.length, handled: all.filter(i => i.status !== 'open').length }
  })
  const handled = r.issues.filter(i => i.status !== 'open').length
  const currentIndex = r.issues.findIndex(i => i.id === r.currentId)
  return { counts, handled, total: r.issues.length, currentIndex }
}

function summary(r: Review): string {
  const { counts, handled, total } = tally(r)
  const parts = counts.map(c => `${c.total} ${c.sev}`).join(', ')
  return (
    `HUD: PR ${r.pr} · ${PHASE_LABEL[r.phase]} · ${total} issues (${parts}) · ` +
    `${handled}/${total} afgehandeld` +
    (r.verdict ? ` · verdict ${r.verdict}` : '') +
    (r.currentId ? ` · huidig ${r.currentId}` : '')
  )
}

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable id, e.g. "1", "2"… in presentation order.' },
    severity: { type: 'string', enum: SEVERITIES },
    title: { type: 'string', description: 'One short line naming the issue.' },
    file: { type: 'string', description: 'Repo-relative path.' },
    line: { type: 'number' },
    what: {
      type: 'string',
      description: 'What exactly is wrong and why it matters (markdown, 1-3 sentences).',
    },
    fix: {
      type: 'string',
      description: 'How to fix it: the recommended option in 1-3 sentences (markdown).',
    },
    status: { type: 'string', enum: STATUSES },
  },
  required: ['severity', 'title', 'what', 'fix'],
}

const SNIPPET_SCHEMA = {
  type: 'object',
  description:
    'The code the issue is about, as it stands in the PR: ~5-20 lines around the problem.',
  properties: {
    path: { type: 'string' },
    startLine: { type: 'number', description: '1-based line number of the first line.' },
    source: { type: 'string' },
  },
  required: ['source'],
}

const OPTIONS_SCHEMA = {
  type: 'array',
  description:
    'The fix options the user picks from in the HUD (2-4, recommended one first, include ' +
    '"leave as-is" when defensible). Add a diff when seeing the change helps the choice; a sentence is enough for small or obvious changes.',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Short button label, 2-6 words.' },
      description: { type: 'string', description: 'One sentence: what this option does and its trade-off.' },
      diff: {
        type: 'string',
        description:
          'Unified diff of the change, with ---/+++ and @@ -a,b +c,d @@ hunk headers. Omit for non-code options.',
      },
      isRecommended: { type: 'boolean' },
    },
    required: ['label'],
  },
}

// ---------- drawing helpers ----------

// A pick is stored once and sent to the chat as the user's own message.
async function choose($: EngineInterface, issueId: string, label: string) {
  let isNew = false
  await update($, review, prev => {
    isNew = false
    if (prev === null) return prev
    const issue = prev.issues.find(i => i.id === issueId)
    if (issue === undefined || issue.decision !== undefined) return prev
    isNew = true
    return {
      ...prev,
      issues: prev.issues.map(i => (i.id === issueId ? { ...i, decision: label } : i)),
    }
  })
  if (isNew) await $.prompt.submit({ text: `Issue ${issueId}: ${label}`, asUser: true })
}

const fileRef = (i: Issue) =>
  i.file ? `${i.file}${i.line !== undefined ? `:${i.line}` : ''}` : ''

// Severity dots, a strip of one mark per issue, and a progress bar.
const statusBlock = (E: ElementTable, r: Review) => {
  const { Box, Text, Progress } = E
  const { counts, handled, total } = tally(r)
  if (total === 0) return <Text color="success">Geen issues gevonden</Text>
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {counts.map(c => (
          <Text color={c.total > 0 ? SEV_COLOR[c.sev] : 'subtle'}>
            ● {c.total} {c.sev}
            {c.total > 0 && c.handled > 0 ? ` (${c.handled}✓)` : ''}
          </Text>
        ))}
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        {r.issues.map(i => {
          const s = STATUS_ICON[i.status]
          const isCurrent = i.id === r.currentId && i.status === 'open'
          return (
            <Text color={s.color ?? SEV_COLOR[i.severity]} bold={isCurrent} inverse={isCurrent}>
              {isCurrent ? '▶' : s.icon}
            </Text>
          )
        })}
      </Box>
      <Progress label="Afgehandeld" value={handled} max={total} valueText={`${handled} van ${total}`} />
    </Box>
  )
}

const verdictBox = (E: ElementTable, r: Review) => {
  const { Box, Text } = E
  if (!r.verdict) return null
  const v = VERDICT_VIEW[r.verdict]
  return (
    <Box
      flexDirection="column"
      borderStyle={r.verdict === 'redo' ? 'double' : 'round'}
      borderColor={v.color}
      paddingX={1}
    >
      <Text color={v.color} bold>
        {v.icon} Advies: {v.label}
      </Text>
      {r.verdictReason && <Text>{r.verdictReason}</Text>}
    </Box>
  )
}

// The PR overview, drawn in the chat at the review_start call that carried it.
const overviewCard = (E: ElementTable, r: Review) => {
  const { Box, Text, Markdown } = E
  return (
    <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="claude" paddingX={1}>
      <Text bold size="heading">
        PR {r.pr} — {r.title}
      </Text>
      {r.problem && (
        <Box flexDirection="column">
          <Text bold dimColor>
            Wat lost deze PR op
          </Text>
          <Markdown text={r.problem} />
        </Box>
      )}
      {r.approach && (
        <Box flexDirection="column">
          <Text bold dimColor>
            Hoe
          </Text>
          <Markdown text={r.approach} />
        </Box>
      )}
      {verdictBox(E, r)}
      {statusBlock(E, r)}
    </Box>
  )
}

// One issue, drawn in the chat at the review_update call that presented it.
function issueCard($: EngineInterface, E: ElementTable, r: Review, issue: Issue) {
  const { Box, Text, Markdown, Code, Button, Input } = E
  const index = r.issues.findIndex(i => i.id === issue.id)
  const color = SEV_COLOR[issue.severity]
  const isOpen = issue.status === 'open'

  return (
    <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor={color} paddingX={1}>
      <Box flexDirection="column">
        <Text color={color} bold>
          Issue {index + 1}/{r.issues.length} · {issue.severity.toUpperCase()}
          {issue.file ? ` · ${fileRef(issue)}` : ''}
        </Text>
        <Text bold>{issue.title}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold dimColor>
          Wat is er mis
        </Text>
        <Markdown text={issue.what || '—'} />
      </Box>
      {issue.code && (
        <Code
          source={issue.code.source}
          path={issue.code.path ?? issue.file}
          startLine={issue.code.startLine ?? issue.line}
        />
      )}
      <Box flexDirection="column">
        <Text bold dimColor>
          Hoe lossen we het op
        </Text>
        <Markdown text={issue.fix || '—'} />
      </Box>

      {issue.decision !== undefined || !isOpen ? (
        <Text color={isOpen ? 'claude' : (STATUS_ICON[issue.status].color ?? 'success')} bold>
          {isOpen ? '✓ Gekozen' : `${STATUS_ICON[issue.status].icon} Afgehandeld`}
          {issue.decision ? `: ${issue.decision}` : ''}
          {!isOpen && issue.note ? ` — ${issue.note}` : ''}
        </Text>
      ) : (
        issue.options && (
          <Box flexDirection="column" rowGap={1}>
            <Text bold dimColor>
              Kies een optie
            </Text>
            {issue.options.map((o, n) => (
              <Box
                key={`opt-${issue.id}-${n}`}
                flexDirection="column"
                borderStyle="round"
                borderColor={o.isRecommended ? 'claude' : 'subtle'}
                paddingX={1}
              >
                <Box flexDirection="row" columnGap={1} alignItems="center">
                  <Button
                    key={`pick-${issue.id}-${n}`}
                    label={o.label}
                    hotkey={n < 9 ? String(n + 1) : undefined}
                    variant={o.isRecommended ? 'primary' : 'secondary'}
                    onPress={() => void choose($, issue.id, o.label)}
                  />
                  {o.isRecommended && <Text color="claude">aanbevolen</Text>}
                </Box>
                {o.description && <Text dimColor>{o.description}</Text>}
                {o.diff && <Code source={o.diff} format="diff" path={issue.file} />}
              </Box>
            ))}
            <Input
              key={`own-${issue.id}`}
              placeholder="Of typ een eigen antwoord…"
              submitLabel="Versturen"
              onSubmit={value => {
                if (value.trim() !== '') void choose($, issue.id, value.trim())
              }}
            />
          </Box>
        )
      )}
    </Box>
  )
}

// A quiet line for HUD calls that carry no card of their own.
const quietLine = (E: ElementTable, r: Review, tool: string, input: Raw) => {
  const { Box, Text } = E
  const parts: { text: string; color?: string }[] = []
  if (tool === START) parts.push({ text: `PR ${str(input.pr) ?? r.pr} · ${PHASE_LABEL[pick(input.phase, PHASES) ?? r.phase]}` })
  if (Array.isArray(input.statuses)) {
    for (const raw of input.statuses) {
      const s = (raw ?? {}) as Raw
      const issue = r.issues.find(i => i.id === str(s.id))
      const status = pick(s.status, STATUSES)
      if (issue === undefined || status === undefined) continue
      parts.push({
        text: `${STATUS_ICON[status].icon} ${issue.title}${str(s.note) ? ` — ${str(s.note)}` : ''}`,
        color: STATUS_ICON[status].color ?? SEV_COLOR[issue.severity],
      })
    }
  }
  if (pick(input.phase, PHASES) === 'done') parts.push({ text: '✓ Review klaar', color: 'success' })
  if (parts.length === 0) parts.push({ text: 'HUD bijgewerkt' })
  return (
    <Box flexDirection="column">
      {parts.map(p => (
        <Text color={p.color} dimColor={p.color === undefined}>
          {p.text}
        </Text>
      ))}
    </Box>
  )
}


// ---------- the mod ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'review_start',
      isDeferred: false,
      description:
        'pr-review-hud: start or replace the review shown in the floating PR review HUD. ' +
        'Call once when the target PR is resolved (phase "fetching", just pr + title), and again ' +
        'after reviewing with problem, approach, verdict, verdictReason and ALL issues sorted ' +
        'blocking → major → minor (phase "walkthrough"). Issues with an id already shown keep their status.',
      inputSchema: {
        type: 'object',
        properties: {
          pr: { type: 'string', description: 'PR number or branch, e.g. "#123".' },
          title: { type: 'string', description: 'PR title.' },
          url: { type: 'string' },
          phase: { type: 'string', enum: PHASES },
          problem: {
            type: 'string',
            description: 'What problem the PR addresses, in 1-2 sentences.',
          },
          approach: {
            type: 'string',
            description: 'How the PR solves it, in 1-2 sentences.',
          },
          verdict: {
            type: 'string',
            enum: VERDICTS,
            description:
              '"ready": mergeable as is or with minor nits. "fix-issues": salvageable, fix first. ' +
              '"redo": the PR does not solve the problem or introduces more problems than it fixes.',
          },
          verdictReason: { type: 'string', description: 'One line explaining the verdict.' },
          issues: { type: 'array', items: ISSUE_SCHEMA },
          currentIssueId: { type: 'string' },
        },
        required: ['pr', 'title'],
      },
    })
    await $.tool.register({
      name: 'review_update',
      isDeferred: false,
      description:
        'pr-review-hud: update the HUD during the walkthrough. To present an issue, set ' +
        'currentIssueId together with `code` (the snippet in question) and `options` (fix ' +
        'options with diffs): the user reads and picks in the HUD, and the pick arrives as their next ' +
        'message ("Issue <id>: <label>"). Set an issue status to fixed/skipped/backend once it ' +
        'is done; set phase "done" at the end. Use addIssues for issues found later.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: { type: 'string', enum: PHASES },
          currentIssueId: { type: 'string' },
          code: SNIPPET_SCHEMA,
          options: OPTIONS_SCHEMA,
          verdict: { type: 'string', enum: VERDICTS },
          verdictReason: { type: 'string' },
          statuses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string', enum: STATUSES },
                note: { type: 'string', description: 'What was done, a few words.' },
              },
              required: ['id', 'status'],
            },
          },
          addIssues: { type: 'array', items: ISSUE_SCHEMA },
        },
      },
    })
    await $.command.register({
      name: 'pr-review-hud',
      description:
        'Review a PR with the HUD: /pr-review-hud [:skill | instructions.md] [PR]. `open` shows the HUD, `clear` resets it',
      argumentHint: '[:skill] [PR]',
    })

    const current = await read($, review)
    if (current !== null && current.phase !== 'done') {
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  // /pr-review-hud [:skill | path.md] [PR]: queue the review for the model, with the
  // instructions it names (a skill, a .md file) or the bundled default.
  on('command.run', { command: 'pr-review-hud' }, async ($, e) => {
    const args = String(e.args ?? '').trim()
    if (args === 'clear') {
      await update($, review, () => null)
      await $.ui.close({ id: PANE })
      return { text: 'PR review HUD gewist.' }
    }
    if (args === 'open') {
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: 'PR review HUD geopend.' }
    }

    const words = args.split(/\s+/).filter(w => w !== '')
    const named = words.find(w => w.startsWith(':') || w.endsWith('.md'))
    const target = words.filter(w => w !== named).join(' ')
    const text = reviewPrompt(named, target)
    // Not from inside this hook: the prompt would wait on the turn the command holds.
    $.clock.after(50, () => void $.prompt.submit({ text }))
    await $.ui.open({ id: PANE, title: TITLE })
    return {
      text: `PR review gestart${target === '' ? '' : ` voor ${target}`}, met ${
        named === undefined ? 'de standaard-instructies' : named.replace(/^:/, '')
      }.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const named = e.command === undefined ? NAMED_FORM.exec(e.text.trim()) : null
    const text =
      named !== null && named[1] !== 'review' ? reviewPrompt(`:${named[1]}`, (named[2] ?? '').trim()) : e.text
    const r = await read($, review)
    const isRunning = r !== null && r.phase !== 'done'
    const isStarting = text.includes('`pr-review-hud:review`')
    if (!isRunning && !isStarting) return text === e.text ? next(e) : next({ ...e, text })
    return next({ ...e, text, context: [...(e.context ?? []), CONTRACT] })
  })

  on('tool.call', { tool: START }, async ($, e) => {
    const r = e as unknown as Raw
    const pr = str(r.pr)
    const title = str(r.title)
    if (pr === undefined || title === undefined) return { deny: 'pr and title are required.' }

    const next = await update($, review, prev => {
      const same = prev !== null && prev.pr === pr ? prev : null
      const rawIssues = Array.isArray(r.issues) ? r.issues : undefined
      const issues =
        rawIssues === undefined
          ? (same?.issues ?? [])
          : rawIssues
              .map((raw, i) => {
                const id = str((raw as Raw | null)?.id)
                return parseIssue(raw, i, same?.issues.find(old => old.id === id))
              })
              .filter((i): i is Issue => i !== undefined)
              .sort(bySeverity)
      const phase =
        pick(r.phase, PHASES) ?? (issues.length > 0 || r.verdict ? 'walkthrough' : 'fetching')

      return {
        pr,
        title,
        url: str(r.url) ?? same?.url,
        phase,
        problem: str(r.problem) ?? same?.problem,
        approach: str(r.approach) ?? same?.approach,
        verdict: pick(r.verdict, VERDICTS) ?? same?.verdict,
        verdictReason: str(r.verdictReason) ?? same?.verdictReason,
        issues,
        currentId: str(r.currentIssueId) ?? same?.currentId,
        overviewIn:
          phase !== 'fetching' && (issues.length > 0 || r.verdict !== undefined)
            ? (e.tool_use_id ?? same?.overviewIn)
            : same?.overviewIn,
      }
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return { result: next === null ? 'HUD updated.' : summary(next) }
  })

  on('tool.call', { tool: UPDATE }, async ($, e) => {
    const r = e as unknown as Raw
    const existing = await read($, review)
    if (existing === null) return { deny: 'No review in the HUD yet: call review_start first.' }

    // One question at a time is the plugin's core: an open issue is only presented with choices.
    const presenting = str(r.currentIssueId)
    const target = existing.issues.find(i => i.id === presenting)
    const settles = Array.isArray(r.statuses) && r.statuses.some(x => str((x as Raw | null)?.id) === presenting)
    const given = parseOptions(r.options)
    if (given !== undefined && given.length < 2) {
      return { deny: 'Give at least 2 options, for example the fix and "leave as-is".' }
    }
    if (target !== undefined && target.status === 'open' && !settles) {
      const options = given ?? target.options
      if (options === undefined || options.length < 2) {
        return {
          deny:
            `Present issue ${presenting} with \`code\` and 2-4 \`options\` (recommended first; add a diff ` +
            'where it helps the choice). The user picks one in the HUD.',
        }
      }
    }

    const unknownIds: string[] = []
    const next = await update($, review, prev => {
      if (prev === null) return prev
      let issues = prev.issues
      if (Array.isArray(r.statuses)) {
        for (const raw of r.statuses) {
          const s = (raw ?? {}) as Raw
          const id = str(s.id)
          const status = pick(s.status, STATUSES)
          if (id === undefined || status === undefined) continue
          if (!issues.some(i => i.id === id)) unknownIds.push(id)
          issues = issues.map(i =>
            i.id === id ? { ...i, status, note: str(s.note) ?? i.note } : i,
          )
        }
      }
      if (Array.isArray(r.addIssues)) {
        const added = r.addIssues
          .map((raw, i) => parseIssue(raw, issues.length + i))
          .filter((i): i is Issue => i !== undefined)
          .filter(i => !issues.some(old => old.id === i.id))
        issues = [...issues, ...added].sort(bySeverity)
      }
      const currentId = str(r.currentIssueId) ?? prev.currentId
      const code = parseSnippet(r.code)
      const options = parseOptions(r.options)
      if (currentId !== undefined && (code !== undefined || options !== undefined)) {
        issues = issues.map(i =>
          i.id === currentId
            ? {
                ...i,
                code: code ?? i.code,
                options: options ?? i.options,
                // New options mean a new question: clear an earlier pick.
                decision: options !== undefined ? undefined : i.decision,
                presentedIn: options !== undefined ? (e.tool_use_id ?? i.presentedIn) : i.presentedIn,
              }
            : i,
        )
      }

      return {
        ...prev,
        issues,
        phase: pick(r.phase, PHASES) ?? prev.phase,
        currentId,
        verdict: pick(r.verdict, VERDICTS) ?? prev.verdict,
        verdictReason: str(r.verdictReason) ?? prev.verdictReason,
      }
    })
    void $.ui.open({ id: PANE, title: TITLE })

    const warn = unknownIds.length > 0 ? ` (unknown ids: ${unknownIds.join(', ')})` : ''
    return { result: (next === null ? 'HUD updated.' : summary(next)) + warn }
  })

  // ---------- drawing ----------

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const tool = e.props.tool
    if ((tool !== START && tool !== UPDATE) || e.props.isErrored) return next(e)
    const r = await read($, review)
    if (r === null) return next(e)
    const E = $.ui.resolve(e)
    const input = (e.props.input ?? {}) as Raw
    const id = e.props.tool_use_id

    const isDesk = e.surface === 'desktop'

    if (tool === START && r.overviewIn === id) {
      return isDesk ? desktopOverview(E as Desk, r) : overviewCard(E, r)
    }
    if (tool === UPDATE) {
      const issue = r.issues.find(i => i.presentedIn === id)
      if (issue !== undefined) {
        return isDesk
          ? desktopIssueRow(E as Desk, r, issue)
          : issueCard($, E, r, issue)
      }
    }
    return quietLine(E, r, tool, input)
  })

  // Above the prompt: the open question stays in view while the chat scrolls.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const r = await read($, review)
    const issue = r?.issues.find(
      i => i.id === r.currentId && i.status === 'open' && i.decision === undefined && i.options,
    )
    if (r === null || r === undefined || issue === undefined || r.phase !== 'walkthrough') return next(e)
    const pick = (label: string) => void choose($, issue.id, label)
    if (e.surface === 'desktop') return desktopBand($.ui.resolve(e) as Desk, r, issue, pick)

    const { Box, Text, Button } = $.ui.resolve(e)
    const index = r.issues.findIndex(i => i.id === issue.id)
    return (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text color={SEV_COLOR[issue.severity]} bold>
          Issue {index + 1}/{r.issues.length}:
        </Text>
        <Text wrap="truncate-end">{issue.title}</Text>
        {(issue.options ?? []).map((o, n) => (
          <Button
            key={`band-${issue.id}-${n}`}
            label={o.label}
            hotkey={n < 9 ? String(n + 1) : undefined}
            onPress={() => pick(o.label)}
          />
        ))}
      </Box>
    )
  })

  // The floating HUD: a status board. Issues themselves are read in the chat.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const E = $.ui.resolve(e)
    const { Box, Text } = E
    const r = await read($, review)

    if (r === null) {
      return (
        <Box flexDirection="column">
          <Text bold>PR review</Text>
          <Text dimColor>Nog geen review actief. Start er een met /pr-review-hud.</Text>
        </Box>
      )
    }

    if (e.surface === 'desktop') {
      // Auto: side by side when the pane is wide enough; the toggle pins the user's choice.
      const chosen = await read($, diffLayout)
      const layout = chosen === 'auto' ? (e.props.bodyColumns >= 64 ? 'split' : 'unified') : chosen
      const toggleLayout = () => void update($, diffLayout, () => (layout === 'split' ? 'unified' : 'split'))
      return desktopPane(E as Desk, r, e.props.placement === 'widget', layout, toggleLayout)
    }

    const { total, currentIndex } = tally(r)
    const current = r.issues[currentIndex]
    const verdict = r.verdict ? VERDICT_VIEW[r.verdict] : undefined
    const position = r.phase === 'walkthrough' && current ? ` · ${currentIndex + 1}/${total}` : ''

    const header = (
      <Text bold wrap="truncate-end">
        PR {r.pr} · {PHASE_LABEL[r.phase]}
        {position}
      </Text>
    )
    const verdictLine = verdict ? (
      <Text color={verdict.color} bold>
        {verdict.icon} {verdict.label}
      </Text>
    ) : null
    const currentLine = current ? (
      <Box flexDirection="row" columnGap={1}>
        <Text color={SEV_COLOR[current.severity]}>Nu:</Text>
        <Text wrap="truncate-end">{current.title}</Text>
      </Box>
    ) : null

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          {header}
          {verdictLine}
          {r.phase !== 'fetching' && statusBlock(E, r)}
          {currentLine}
        </Box>
      )
    }

    const at = PHASES.indexOf(r.phase)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Text bold>
            PR {r.pr} — {r.title}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {PHASES.map((p, i) => {
              const isPast = i < at || r.phase === 'done'
              const isNow = i === at && r.phase !== 'done'
              return (
                <Text color={isNow ? 'claude' : isPast ? 'success' : 'subtle'} bold={isNow}>
                  {isPast ? '●' : isNow ? '◉' : '○'} {PHASE_LABEL[p]}
                  {i < PHASES.length - 1 ? ' ─' : ''}
                </Text>
              )
            })}
          </Box>
        </Box>
        {verdictLine}
        {r.phase !== 'fetching' && statusBlock(E, r)}
        {total > 0 && (
          <Box flexDirection="column">
            {r.issues.map(i => {
              const s = STATUS_ICON[i.status]
              const isCurrent = i.id === r.currentId && i.status === 'open'
              return (
                <Box flexDirection="row" columnGap={1}>
                  <Text color={s.color ?? SEV_COLOR[i.severity]}>{isCurrent ? '▶' : s.icon}</Text>
                  <Text color={SEV_COLOR[i.severity]}>{i.severity.padEnd(8)}</Text>
                  <Text
                    bold={isCurrent}
                    dimColor={i.status !== 'open'}
                    strikethrough={i.status === 'fixed'}
                    wrap="truncate-end"
                  >
                    {i.title}
                    {i.note ? ` — ${i.note}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
        {current?.options && current.decision === undefined && (
          <Text dimColor>Kies in de chat.</Text>
        )}
      </Box>
    )
  })
}
