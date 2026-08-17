/**
 * The tabbed terminal panel, registered as the `details` slot occupant. A tab
 * bar (one tab per PTY session, plus add/close) sits over a body that keeps
 * every terminal mounted but shows only the active one — so hidden tabs keep
 * their scrollback and their PTY processes stay alive. Column width and
 * open/close are owned by the layout (ctx.layout); this panel just fills the
 * track it is given.
 */
import { terminalStore, useTerminalStore } from './store.ts'
import { TerminalView } from './TerminalView.tsx'

export interface TerminalPanelInjected {
  closeDetails: () => void
}

export function TerminalPanel({ closeDetails }: TerminalPanelInjected) {
  const { tabs, activeId } = useTerminalStore()

  return (
    <div className="dsh-term-panel">
      <div className="dsh-term-tabs" role="tablist">
        {tabs.map(tab => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={tab.id === activeId ? 'dsh-term-tab dsh-term-tab-active' : 'dsh-term-tab'}
            onClick={() => { terminalStore.setActive(tab.id) }}
          >
            <span className="dsh-term-tab-title">{tab.title}</span>
            <button
              type="button"
              className="dsh-term-tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(event) => { event.stopPropagation(); terminalStore.removeTab(tab.id) }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="dsh-term-add" aria-label="New terminal" onClick={() => { terminalStore.addTab() }}>+</button>
        <button type="button" className="dsh-term-collapse" aria-label="Close terminal panel" onClick={closeDetails}>✕</button>
      </div>
      <div className="dsh-term-body">
        {tabs.length === 0
          ? <div className="dsh-term-empty">No terminal sessions yet. Click the terminal icon in the conversation header to open one.</div>
          : tabs.map(tab => (
            <div key={tab.id} className="dsh-term-view" style={{ display: tab.id === activeId ? 'block' : 'none' }}>
              <TerminalView tab={tab} active={tab.id === activeId} />
            </div>
          ))}
      </div>
    </div>
  )
}
