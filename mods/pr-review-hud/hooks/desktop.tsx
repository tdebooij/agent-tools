// Desktop-only drawing: SVG graphics in Claude's palette and a side-by-side diff.
// Everything here is pure: it takes the desktop element table and plain data.
// Only fixed strings and numbers go into SVG markup, never PR content.

import type { Elements } from 'claude-code'

import type { FixOption, Issue, IssueStatus, Phase, Review, Severity, Verdict } from '../types'

export type Desk = Elements['desktop']

const C = {
  claude: '#D97757',
  blocking: '#C2503E',
  major: '#C98A2B',
  minor: '#5B8DBE',
  fixed: '#6F9A65',
  skipped: '#A39E93',
  backend: '#8C7DC4',
  track: 'rgba(140,132,120,0.22)',
}
const SEV: Record<Severity, string> = { blocking: C.blocking, major: C.major, minor: C.minor }
const FONT = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
// Text colours follow the light/dark scheme; fills stay mid-tone so they read on both.
const STYLE =
  `<style>.t{font-family:${FONT};fill:#6b665e;font-size:12px}.b{font-weight:600;fill:#3d3929}` +
  `.w{font-family:${FONT};fill:#fff;font-weight:600}` +
  `@media (prefers-color-scheme: dark){.t{fill:#b7b1a7}.b{fill:#f0ede6}}</style>`

/** An SVG with its own pixel size, spread onto <Svg> so it never scales with the pane. */
export type Pic = { source: string; width: number; height: number }
const svg = (w: number, h: number, body: string): Pic => ({
  source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${STYLE}${body}</svg>`,
  width: w,
  height: h,
})

// ---------- graphics ----------

const PHASE_LABEL: Record<Phase, string> = {
  fetching: 'PR ophalen',
  reviewing: 'Reviewen',
  walkthrough: 'Issues doorlopen',
  done: 'Klaar',
}
const PHASES: readonly Phase[] = ['fetching', 'reviewing', 'walkthrough', 'done']

/** Four connected steps; the current one ringed in Claude orange. */
export function stepperSvg(phase: Phase): Pic {
  const W = 640
  const H = 38
  const at = PHASES.indexOf(phase)
  const isDone = phase === 'done'
  const xs = PHASES.map((_, i) => 10 + (i * (W - 20)) / (PHASES.length - 1))
  let body = ''
  for (let i = 0; i < xs.length - 1; i++) {
    const isPast = isDone || i < at
    body += `<line x1="${xs[i]}" y1="12" x2="${xs[i + 1]}" y2="12" stroke="${isPast ? C.claude : C.track}" stroke-width="2.5" stroke-linecap="round"/>`
  }
  PHASES.forEach((p, i) => {
    const x = xs[i] ?? 0
    const isPast = isDone || i < at
    const isNow = !isDone && i === at
    body += isNow
      ? `<circle cx="${x}" cy="12" r="8" fill="none" stroke="${C.claude}" stroke-width="2" opacity="0.45"/><circle cx="${x}" cy="12" r="5" fill="${C.claude}"/>`
      : `<circle cx="${x}" cy="12" r="5" fill="${isPast ? C.claude : 'none'}" stroke="${isPast ? C.claude : C.skipped}" stroke-width="1.5"/>`
    const anchor = i === 0 ? 'start' : i === PHASES.length - 1 ? 'end' : 'middle'
    const lx = i === 0 ? 2 : i === PHASES.length - 1 ? W - 2 : x
    body += `<text x="${lx}" y="33" text-anchor="${anchor}" class="t${isNow ? ' b' : ''}" style="font-size:11px">${PHASE_LABEL[p]}</text>`
  })
  return svg(W, H, body)
}

const VERDICT: Record<Verdict, { label: string; fill: string; icon: string }> = {
  ready: {
    label: 'Klaar om te mergen',
    fill: '#5E8B57',
    icon: '<path d="M 15 24 l 5 5 l 10 -11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'fix-issues': {
    label: 'Eerst issues fixen',
    fill: '#B9792A',
    icon: '<path d="M 22 13 L 32 31 L 12 31 Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><line x1="22" y1="19.5" x2="22" y2="25" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="28.2" r="1.4" fill="#fff"/>',
  },
  redo: {
    label: 'Beter opnieuw opzetten',
    fill: '#B0473A',
    icon: '<path d="M 30.5 17.5 A 9.5 9.5 0 1 0 31.5 26" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M 31.5 11.5 L 31.5 18.5 L 24.5 18.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
}

/** A tinted banner: coloured icon and label on a soft wash of the verdict's colour. */
export function verdictSvg(verdict: Verdict): Pic {
  const v = VERDICT[verdict]
  const icon = v.icon.replace(/#fff/g, v.fill)
  return svg(
    640,
    40,
    `<rect x="1" y="1" width="638" height="38" rx="9" fill="${v.fill}" fill-opacity="0.12" stroke="${v.fill}" stroke-opacity="0.35"/>` +
      `<g transform="translate(0 -2)">${icon}</g>` +
      `<text x="44" y="25" style="font-family:${FONT};font-size:14px;font-weight:600;fill:${v.fill}">Advies: ${v.label}</text>`,
  )
}

/** A small filled chip: severity, or "aanbevolen". */
export function chipSvg(text: string, fill: string): Pic {
  const w = Math.round(text.length * 7.2 + 18)
  return svg(
    w,
    20,
    `<rect x="0" y="0" width="${w}" height="20" rx="10" fill="${fill}"/>` +
      `<text x="${w / 2}" y="14" text-anchor="middle" class="w" style="font-size:10.5px;letter-spacing:.06em">${text}</text>`,
  )
}

export const sevChip = (s: Severity) => chipSvg(s.toUpperCase(), SEV[s])

/** A quiet severity label for lists: small, tinted, not a filled badge. */
export function sevTag(sev: Severity): Pic {
  const text = sev.toUpperCase()
  const w = Math.round(text.length * 6 + 12)
  return svg(
    w,
    16,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="15" rx="4" fill="${SEV[sev]}" fill-opacity="0.16" stroke="${SEV[sev]}" stroke-opacity="0.45"/>` +
      `<text x="${w / 2}" y="11.5" text-anchor="middle" style="font-family:${FONT};font-size:9px;font-weight:600;letter-spacing:.05em;fill:${SEV[sev]}">${text}</text>`,
  )
}

/** One 14px status mark per issue row: a soft tint with a coloured glyph. */
export function statusIcon(status: IssueStatus, sev: Severity, isCurrent: boolean): Pic {
  const tint = (c: string) => `<circle cx="7" cy="7" r="6.5" fill="${c}" fill-opacity="0.18"/>`
  let body: string
  if (isCurrent) {
    body = `<circle cx="7" cy="7" r="6" fill="none" stroke="${C.claude}" stroke-width="1.5"/><circle cx="7" cy="7" r="2.8" fill="${C.claude}"/>`
  } else if (status === 'fixed') {
    body = tint(C.fixed) + `<path d="M 4.2 7.2 l 1.9 1.9 l 3.7 -4" fill="none" stroke="${C.fixed}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  } else if (status === 'skipped') {
    body = tint(C.skipped) + `<line x1="4.5" y1="7" x2="9.5" y2="7" stroke="${C.skipped}" stroke-width="1.6" stroke-linecap="round"/>`
  } else if (status === 'backend') {
    body = tint(C.backend) + `<path d="M 4.8 9.2 L 9.2 4.8 M 6.2 4.8 L 9.2 4.8 L 9.2 7.8" fill="none" stroke="${C.backend}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  } else {
    body = `<circle cx="7" cy="7" r="5.5" fill="none" stroke="${SEV[sev]}" stroke-width="1.5" stroke-opacity="0.8"/>`
  }
  return svg(14, 14, body)
}

/** A dot for the phase stepper: done, now, or still to come. */
function phaseDot(state: 'done' | 'now' | 'todo'): Pic {
  const body =
    state === 'done'
      ? `<circle cx="6" cy="6" r="5" fill="${C.claude}"/>`
      : state === 'now'
        ? `<circle cx="6" cy="6" r="5" fill="none" stroke="${C.claude}" stroke-width="1.5"/><circle cx="6" cy="6" r="2.4" fill="${C.claude}"/>`
        : `<circle cx="6" cy="6" r="4.5" fill="none" stroke="${C.skipped}" stroke-width="1.2"/>`
  return svg(12, 12, body)
}

/** Thin bar, one rounded segment per issue in its status colour. */
export function segBar(r: Review): Pic {
  const W = 168
  const H = 6
  const n = Math.max(1, r.issues.length)
  const gap = 3
  const w = (W - gap * (n - 1)) / n
  const body = r.issues
    .map((i, k) => {
      const isNow = i.id === r.currentId && i.status === 'open'
      const fill =
        i.status === 'fixed' ? C.fixed : i.status === 'skipped' ? C.skipped : i.status === 'backend' ? C.backend : isNow ? C.claude : C.track
      return `<rect x="${(k * (w + gap)).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" rx="3" fill="${fill}"/>`
    })
    .join('')
  return svg(W, H, body || `<rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="${C.track}"/>`)
}

/** The four phases as a compact row: small dots, caption labels. */
export function stepperRow(D: Desk, phase: Phase) {
  const { Box, Text, Svg } = D
  const at = PHASES.indexOf(phase)
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
      {PHASES.map((p, i) => {
        const state = phase === 'done' || i < at ? 'done' : i === at ? 'now' : 'todo'
        return (
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Svg {...phaseDot(state)} alt={PHASE_LABEL[p]} />
            <Text size="caption" weight={state === 'now' ? 'semibold' : 'regular'} dimColor={state === 'todo'}>
              {PHASE_LABEL[p]}
            </Text>
            {i < PHASES.length - 1 && (
              <Text size="caption" color="subtle">
                ─
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** Progress as a thin segmented bar with its figure beside it. */
export function progressRow(D: Desk, r: Review) {
  const { Box, Text, Svg } = D
  const handled = r.issues.filter(i => i.status !== 'open').length
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Svg {...segBar(r)} alt={`${handled} van ${r.issues.length} afgehandeld`} />
      <Text size="caption" dimColor>
        {handled} van {r.issues.length} afgehandeld
      </Text>
    </Box>
  )
}

export const RECOMMENDED = chipSvg('AANBEVOLEN', C.claude)

// ---------- side-by-side diff ----------

type Side = { n: number; text: string; kind: 'ctx' | 'del' | 'add' }
type Row = { hunk: string } | { left?: Side; right?: Side }
type DiffFile = { name: string; rows: Row[] }

/** Parses a unified diff into rows that pair removed and added lines. */
export function parseUnified(src: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let oldN = 0
  let newN = 0
  let dels: Side[] = []
  let adds: Side[] = []
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) file?.rows.push({ left: dels[i], right: adds[i] })
    dels = []
    adds = []
  }
  for (const line of src.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('--- ')) {
      flush()
      file = { name: line.slice(4).replace(/^a\//, ''), rows: [] }
      files.push(file)
      continue
    }
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^b\//, '')
      if (file && name !== '/dev/null') file.name = name
      continue
    }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (m) {
      flush()
      if (file === undefined) {
        file = { name: '', rows: [] }
        files.push(file)
      }
      oldN = Number(m[1])
      newN = Number(m[2])
      file.rows.push({ hunk: line })
      continue
    }
    if (file === undefined || line.startsWith('\\')) continue
    if (line.startsWith('-')) dels.push({ n: oldN++, text: line.slice(1), kind: 'del' })
    else if (line.startsWith('+')) adds.push({ n: newN++, text: line.slice(1), kind: 'add' })
    else {
      flush()
      const text = line.startsWith(' ') ? line.slice(1) : line
      file.rows.push({
        left: { n: oldN++, text, kind: 'ctx' },
        right: { n: newN++, text, kind: 'ctx' },
      })
    }
  }
  flush()
  return files.filter(f => f.rows.some(r => !('hunk' in r)))
}

// Keep indentation: leading spaces and tabs as non-breaking spaces.
const keepIndent = (s: string) =>
  s.replace(/^[ \t]+/, m => m.replace(/\t/g, '  ').replace(/ /g, ' ')) || ' '

const lead = (t: string) => (t.trim() === '' ? Infinity : (/^[ \t]*/.exec(t)?.[0].replace(/\t/g, '  ').length ?? 0))

/**
 * Side by side when every line fits half the width (after the shared indent is
 * dropped); otherwise the app's own unified diff, which reads better when narrow.
 */
export type DiffLayout = 'split' | 'unified'

const NBSP3 = '\u00A0\u00A0\u00A0'
const num = (n: number | undefined) => (n === undefined ? NBSP3 : String(n).padStart(3, '\u00A0'))
const shade = (k: Side['kind'] | undefined) =>
  k === 'del' ? 'diffRemovedDimmed' : k === 'add' ? 'diffAddedDimmed' : undefined
const mark = (k: Side['kind'] | undefined) => (k === 'del' ? '−' : k === 'add' ? '+' : '\u00A0')
const markColor = (k: Side['kind'] | undefined) => (k === 'del' ? 'error' : k === 'add' ? 'success' : 'subtle')

/**
 * A diff in small mono type. Split: old left, new right, long lines wrapping in
 * their own column. Unified: one column, removed lines above added ones.
 */
export function diffView(D: Desk, diff: string, layout: DiffLayout) {
  const { Box, Text } = D
  const files = parseUnified(diff)
  if (files.length === 0) return null

  const sides = (f: DiffFile) =>
    f.rows.flatMap(r => ('hunk' in r ? [] : [r.left, r.right])).filter((x): x is Side => x !== undefined)
  const indentOf = (f: DiffFile) => {
    const n = Math.min(...sides(f).map(x => lead(x.text)))
    return Number.isFinite(n) ? n : 0
  }
  const body = (x: Side, n: number) => keepIndent(x.text.replace(/\t/g, '  ').slice(n))

  const line = (x: Side | undefined, n: number, numbers: string) => (
    <Box flexDirection="row" columnGap={1} paddingX={1} flexGrow={1} backgroundColor={shade(x?.kind)}>
      <Text mono tabular size="caption" dimColor>
        {numbers}
      </Text>
      <Text mono size="caption" color={markColor(x?.kind)}>
        {mark(x?.kind)}
      </Text>
      <Box flexShrink={1}>
        <Text mono size="caption">
          {x ? body(x, n) : ''}
        </Text>
      </Box>
    </Box>
  )

  const separator = (
    <Box paddingX={1}>
      <Text mono size="caption" dimColor>
        ⋯
      </Text>
    </Box>
  )

  const fileBlock = (f: DiffFile) => {
    const n = indentOf(f)
    const out: ReturnType<typeof line>[] = []
    let hunks = 0
    // Unified: within a run of changes, every removed line before the added ones.
    let dels: Side[] = []
    let adds: Side[] = []
    const flush = () => {
      for (const d of dels) out.push(line(d, n, num(d.n)))
      for (const a of adds) out.push(line(a, n, num(a.n)))
      dels = []
      adds = []
    }
    for (const row of f.rows) {
      if ('hunk' in row) {
        flush()
        hunks += 1
        if (hunks > 1) out.push(separator)
        continue
      }
      if (layout === 'split') {
        out.push(
          <Box flexDirection="row">
            <Box width="50%" flexDirection="row">
              {line(row.left, n, num(row.left?.n))}
            </Box>
            <Box width="50%" flexDirection="row">
              {line(row.right, n, num(row.right?.n))}
            </Box>
          </Box>,
        )
        continue
      }
      if (row.left?.kind === 'ctx') {
        flush()
        out.push(line(row.right, n, num(row.right?.n)))
        continue
      }
      if (row.left) dels.push(row.left)
      if (row.right) adds.push(row.right)
    }
    flush()
    return out
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle">
      {files.map(f => (
        <Box flexDirection="column">
          {(files.length > 1 || f.name !== '') && (
            <Box paddingX={1}>
              <Text mono size="caption" dimColor>
                {f.name}
              </Text>
            </Box>
          )}
          {fileBlock(f)}
        </Box>
      ))}
    </Box>
  )
}

/** The code in question, in the same small mono type as the diffs. */
export function snippetView(D: Desk, source: string, startLine: number | undefined) {
  const { Box, Text } = D
  const lines = source.replace(/\n$/, '').split('\n')
  const n = Math.min(...lines.map(lead))
  const cut = Number.isFinite(n) ? n : 0
  const first = startLine ?? 1
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingY={1}>
      {lines.map((l, i) => (
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          <Text mono tabular size="caption" dimColor>
            {startLine === undefined ? NBSP3 : num(first + i)}
          </Text>
          <Box flexShrink={1}>
            <Text mono size="caption">
              {keepIndent(l.replace(/\t/g, '  ').slice(cut))}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Short prose with `code` and **bold** spans, at a given size. */
export function inlineText(D: Desk, text: string, size: 'caption' | 'footnote', dim = false) {
  const { Text } = D
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(p => p !== '')
  return (
    <Text size={size} dimColor={dim}>
      {parts.map(p =>
        p.startsWith('`') ? (
          <Text mono size={size}>
            {p.slice(1, -1)}
          </Text>
        ) : p.startsWith('**') ? (
          <Text size={size} weight="semibold">
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  )
}

// ---------- cards ----------

const fileRef = (i: Issue) => (i.file ? `${i.file}${i.line !== undefined ? `:${i.line}` : ''}` : '')

export function desktopOverview(D: Desk, r: Review) {
  const { Box, Text, Markdown, Svg } = D
  const counts = (['blocking', 'major', 'minor'] as const).map(s => ({
    s,
    n: r.issues.filter(i => i.severity === s).length,
  }))
  return (
    <Box flexDirection="column" rowGap={1} borderStyle="round" borderColor="subtle" padding={1}>
      <Box flexDirection="column">
        <Text size="caption" dimColor>
          PR review · {r.pr}
        </Text>
        <Text size="title" weight="semibold">
          {r.title}
        </Text>
      </Box>
      {stepperRow(D, r.phase)}
      {r.problem && (
        <Box flexDirection="column">
          <Text weight="semibold">Wat lost deze PR op</Text>
          <Markdown text={r.problem} />
        </Box>
      )}
      {r.approach && (
        <Box flexDirection="column">
          <Text weight="semibold">Hoe</Text>
          <Markdown text={r.approach} />
        </Box>
      )}
      {r.verdict && (
        <Box flexDirection="column">
          <Svg {...verdictSvg(r.verdict)} alt={`Advies: ${VERDICT[r.verdict].label}`} />
          {r.verdictReason && <Text dimColor>{r.verdictReason}</Text>}
        </Box>
      )}
      {r.issues.length > 0 ? (
        <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
            {counts.map(c => (c.n > 0 ? <Svg {...sevTag(c.s)} alt={c.s} /> : null))}
            <Text size="footnote" dimColor>
              {counts.filter(c => c.n > 0).map(c => `${c.n} ${c.s}`).join(' · ')}
            </Text>
          </Box>
          {issueList(D, r)}
        </Box>
      ) : (
        <Text color="success">Geen issues gevonden</Text>
      )}
    </Box>
  )
}

/** The chat's record of an issue: one line, the issue itself lives in the band. */
export function desktopIssueRow(D: Desk, r: Review, issue: Issue) {
  const { Box, Text, Svg } = D
  const index = r.issues.findIndex(i => i.id === issue.id)
  const isOpen = issue.status === 'open'
  const state = !isOpen
    ? `${statusWord(issue.status)}${issue.note ? ` — ${issue.note}` : ''}`
    : issue.decision !== undefined
      ? `gekozen: ${issue.decision}`
      : 'open, staat in het paneel rechts'
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
      <Svg {...statusIcon(issue.status, issue.severity, isOpen && issue.decision === undefined)} alt={statusWord(issue.status)} />
      <Svg {...sevTag(issue.severity)} alt={issue.severity} />
      <Text size="footnote" weight="medium">
        Issue {index + 1}/{r.issues.length}: {issue.title}
      </Text>
      <Text size="footnote" dimColor>
        · {state}
      </Text>
    </Box>
  )
}

/** The open issue in full, for reading in the side pane. Picking happens in the band. */
function issueDetail(D: Desk, r: Review, issue: Issue, layout: DiffLayout, toggleLayout: () => void) {
  const { Box, Text, Svg, Button } = D
  const index = r.issues.findIndex(i => i.id === issue.id)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
          <Svg {...sevTag(issue.severity)} alt={issue.severity} />
          <Text size="caption" dimColor>
            Issue {index + 1} van {r.issues.length}
          </Text>
          {issue.file && (
            <Text mono size="caption" dimColor>
              {fileRef(issue)}
            </Text>
          )}
        </Box>
        <Text size="body" weight="semibold">
          {issue.title}
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text size="footnote" weight="semibold">
          Wat is er mis
        </Text>
        {inlineText(D, issue.what || '—', 'footnote')}
      </Box>
      {issue.code && snippetView(D, issue.code.source, issue.code.startLine ?? issue.line)}
      <Box flexDirection="column">
        <Text size="footnote" weight="semibold">
          Hoe lossen we het op
        </Text>
        {inlineText(D, issue.fix || '—', 'footnote')}
      </Box>
      {issue.decision !== undefined ? (
        <Text size="footnote" color="claude" weight="semibold">
          ✓ Gekozen: {issue.decision}
        </Text>
      ) : (
        issue.options && (
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text size="footnote" weight="semibold">
                Opties
              </Text>
              {issue.options.some(o => o.diff) && (
                <Button
                  key="layout-toggle"
                  label={layout === 'split' ? 'Onder elkaar' : 'Naast elkaar'}
                  plain
                  onPress={toggleLayout}
                />
              )}
            </Box>
            {issue.options.map((o, n) => (
              <Box flexDirection="column" rowGap={0}>
                <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
                  <Text size="footnote" weight="semibold" color={o.isRecommended ? 'claude' : undefined}>
                    {n + 1} · {o.label}
                  </Text>
                  {o.isRecommended && <Svg {...RECOMMENDED} alt="aanbevolen" />}
                </Box>
                {o.description && inlineText(D, o.description, 'caption', true)}
                {o.diff && diffView(D, o.diff, layout)}
              </Box>
            ))}
            <Text size="caption" dimColor>
              Kies onderaan bij de prompt, of typ een eigen antwoord in de chat.
            </Text>
          </Box>
        )
      )}
    </Box>
  )
}

const statusWord = (s: IssueStatus) =>
  s === 'fixed' ? 'opgelost' : s === 'skipped' ? 'overgeslagen' : s === 'backend' ? 'naar backend' : 'open'

/** Every issue on one aligned row: status mark, severity tag, title, note under it. */
function issueList(D: Desk, r: Review) {
  const { Box, Text, Svg } = D
  const currentId = r.issues.find(i => i.id === r.currentId && i.status === 'open')?.id
  return (
    <Box flexDirection="column" rowGap={1}>
      {r.issues.map(i => {
        const isNow = i.id === currentId
        return (
          <Box flexDirection="row" columnGap={1} alignItems="flex-start">
            <Svg {...statusIcon(i.status, i.severity, isNow)} alt={statusWord(i.status)} />
            <Box flexDirection="column" flexShrink={1}>
              <Box flexDirection="row" columnGap={1} alignItems="center">
                <Svg {...sevTag(i.severity)} alt={i.severity} />
                <Text
                  size="caption"
                  weight={isNow ? 'semibold' : 'regular'}
                  color={isNow ? 'claude' : undefined}
                  dimColor={i.status !== 'open'}
                  wrap="truncate-end"
                >
                  {i.title}
                </Text>
              </Box>
              {i.note && (
                <Text size="caption" dimColor>
                  {i.note}
                </Text>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** The side pane on desktop: status on top, then the open issue to read, then every issue. */
export function desktopPane(
  D: Desk,
  r: Review,
  isWidget: boolean,
  layout: DiffLayout,
  toggleLayout: () => void,
) {
  const { Box, Text, Svg, Progress } = D
  const total = r.issues.length
  const handled = r.issues.filter(i => i.status !== 'open').length
  const current = r.issues.find(i => i.id === r.currentId && i.status === 'open')
  const progress = total > 0 ? progressRow(D, r) : null

  if (isWidget) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text size="footnote" weight="semibold" wrap="truncate-end">
          PR {r.pr} · {PHASE_LABEL[r.phase]}
        </Text>
        {progress}
        {current && (
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Svg {...statusIcon(current.status, current.severity, true)} alt="huidig" />
            <Text size="footnote" wrap="truncate-end">
              {current.title}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  const isReading = r.phase === 'walkthrough' && current !== undefined
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text size="caption" dimColor wrap="truncate-end">
          PR {r.pr} · {PHASE_LABEL[r.phase]}
        </Text>
        <Text weight="semibold">{r.title}</Text>
      </Box>
      {!isReading && stepperRow(D, r.phase)}
      {progress}
      {isReading && current && issueDetail(D, r, current, layout, toggleLayout)}
      {total > 0 && (
        <Box flexDirection="column" rowGap={1}>
          {isReading && (
            <Text size="footnote" weight="semibold" dimColor>
              Alle issues
            </Text>
          )}
          {issueList(D, r)}
        </Box>
      )}
    </Box>
  )
}

/** The band above the prompt: one row to decide the open issue, next to where you type. */
export function desktopBand(D: Desk, r: Review, issue: Issue, pick: (label: string) => void) {
  const { Box, Text, Button, Svg } = D
  const index = r.issues.findIndex(i => i.id === issue.id)
  return (
    <Box flexDirection="row" columnGap={1} rowGap={1} alignItems="center" flexWrap="wrap">
      <Svg {...sevTag(issue.severity)} alt={issue.severity} />
      <Text size="footnote" weight="semibold" wrap="truncate-end">
        {index + 1}/{r.issues.length} {issue.title}
      </Text>
      {(issue.options ?? []).map((o, n) => (
        <Button
          key={`band-${issue.id}-${n}`}
          label={o.label}
          hotkey={n < 9 ? String(n + 1) : undefined}
          variant={o.isRecommended ? 'primary' : 'secondary'}
          onPress={() => pick(o.label)}
        />
      ))}
    </Box>
  )
}
