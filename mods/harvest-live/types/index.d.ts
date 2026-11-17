export type HarvestTimer = { id: string; project: string; task: string; notes: string; startedAt: number }
export type Option = { value: string; label: string }
export type Draft = { project: string; task: string; notes: string }

declare module 'claude-code' {
  interface PluginState {
    'harvest-live': {
      timer: HarvestTimer | null
      tick: number
      log: string[]
      projects: Option[]
      tasks: Option[]
      draft: Draft
      status: string
      day: string
      edited: boolean
      busy: '' | 'suggest' | 'start'
      frame: number
      editField: '' | 'project' | 'task' | 'notes'
      phase: 'edit' | 'done'
      isOpen: boolean
    }
  }
}
