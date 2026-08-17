/**
 * Session-header action that opens the terminal panel. The session's
 * workspace root (`byId[sessionId].cwd`) seeds the first terminal's working
 * directory, and the injected `openDetails` opens the details column it lives in.
 */
import { useCallback } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { terminalStore } from './store.ts'

export interface TerminalHeaderActionInjected {
  openDetails: () => void
}

export type TerminalHeaderActionProps = PropsRuntime<'conversation.session.header.actions'> & TerminalHeaderActionInjected

export function TerminalHeaderAction({ sessionId, useSessions, openDetails }: TerminalHeaderActionProps) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd ?? '')
  const onClick = useCallback(() => {
    terminalStore.open(cwd)
    openDetails()
  }, [cwd, openDetails])

  return (
    <button type="button" className="dsh-term-action" onClick={onClick} aria-label="Open terminal" title="Open terminal">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <rect x="2" y="3.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.6 6.3l1.8 1.2-1.8 1.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  )
}
