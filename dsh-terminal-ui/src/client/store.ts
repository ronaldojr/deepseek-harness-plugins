/**
 * Module-local store shared by the header toggle button and the details-slot
 * panel. A tiny observable (subscribe/getSnapshot) consumed through
 * useSyncExternalStore, so both slot entries stay in sync without a shared
 * React tree. The `details` column's open/closed geometry is owned by
 * `ctx.layout`, so this store only tracks tabs — not panel visibility.
 */
import { useSyncExternalStore } from 'react'

export interface TerminalTab {
  id: string
  title: string
  cwd: string
  cols: number
  rows: number
}

export interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  cwd: string
}

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

let state: TerminalState = { tabs: [], activeId: null, cwd: '' }
const listeners = new Set<() => void>()
let tabSeq = 0

function emit(): void {
  for (const listener of listeners) listener()
}

function setState(patch: Partial<TerminalState>): void {
  state = { ...state, ...patch }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): TerminalState {
  return state
}

function newTab(cwd: string): TerminalTab {
  tabSeq += 1
  return { id: `t${tabSeq}`, title: `Terminal ${tabSeq}`, cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
}

export const terminalStore = {
  subscribe,
  getSnapshot,
  /** Spawn the first tab when none exist; otherwise just adopt the current cwd. */
  open(cwd?: string): void {
    const c = cwd ?? state.cwd
    const tabs = state.tabs.length === 0 ? [newTab(c)] : state.tabs
    setState({ tabs, activeId: state.activeId ?? tabs[0].id, cwd: c })
  },
  addTab(cwd?: string): void {
    const c = cwd ?? state.cwd
    const tab = newTab(c)
    setState({ tabs: [...state.tabs, tab], activeId: tab.id, cwd: c })
  },
  removeTab(id: string): void {
    const tabs = state.tabs.filter(tab => tab.id !== id)
    const activeId = state.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeId
    setState({ tabs, activeId })
  },
  setActive(id: string): void {
    if (state.activeId === id) return
    setState({ activeId: id })
  },
}

export function useTerminalStore(): TerminalState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
