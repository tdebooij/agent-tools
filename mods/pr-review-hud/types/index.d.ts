export type Severity = 'blocking' | 'major' | 'minor'
export type IssueStatus = 'open' | 'fixed' | 'skipped' | 'backend'
export type Verdict = 'ready' | 'fix-issues' | 'redo'
export type Phase = 'fetching' | 'reviewing' | 'walkthrough' | 'done'

export type Snippet = { path?: string; startLine?: number; source: string }

export type FixOption = {
  label: string
  description?: string
  /** A unified diff (with @@ hunk headers) of the change this option makes. */
  diff?: string
  isRecommended?: boolean
}

export type Issue = {
  id: string
  severity: Severity
  title: string
  file?: string
  line?: number
  what: string
  fix: string
  status: IssueStatus
  note?: string
  code?: Snippet
  options?: FixOption[]
  /** What the user picked in the HUD, sent to the chat. */
  decision?: string
  /** The review_update call whose chat row draws this issue's card. */
  presentedIn?: string
}

export type Review = {
  pr: string
  title: string
  url?: string
  phase: Phase
  problem?: string
  approach?: string
  verdict?: Verdict
  verdictReason?: string
  issues: Issue[]
  currentId?: string
  /** The review_start call whose chat row draws the PR overview card. */
  overviewIn?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-hud': { review: Shaped<Review | null>; diffLayout: 'auto' | 'split' | 'unified' }
  }
}
