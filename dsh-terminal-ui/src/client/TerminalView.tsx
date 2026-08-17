/**
 * One PTY session rendered as an xterm.js terminal. Owns the terminal instance
 * and its WebSocket for the lifetime of the tab, re-fitting the viewport when
 * the tab becomes active or the panel is resized.
 */
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalTab } from './store.ts'

interface ServerMessage {
  type?: string
  data?: string
  message?: string
  exitCode?: number | null
  signal?: string | null
}

export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
      theme: {
        background: 'transparent',
        foreground: 'var(--dsw-alias-label-primary, #e6e6e6)',
        cursor: 'var(--dsw-alias-label-primary, #e6e6e6)',
        selectionBackground: 'var(--dsw-alias-interactive-bg-hover, #3a3a3a)',
      },
      allowProposedApi: false,
    })
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(container)

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${proto}//${window.location.host}/plugins/dsh-terminal-ui/ws`)
    url.searchParams.set('cwd', tab.cwd)
    url.searchParams.set('cols', String(tab.cols))
    url.searchParams.set('rows', String(tab.rows))
    const ws = new WebSocket(url.toString())

    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
    })
    ws.onmessage = (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.type === 'output' && typeof msg.data === 'string') term.write(msg.data)
      else if (msg.type === 'error') term.write(`\r\n\x1b[31m[terminal error: ${msg.message ?? 'unknown'}]\x1b[0m\r\n`)
      else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[process exited${typeof msg.exitCode === 'number' ? ` with code ${msg.exitCode}` : ''}]\x1b[0m\r\n`)
    }
    ws.onclose = () => { term.write('\r\n\x1b[90m[connection closed]\x1b[0m\r\n') }

    const fitNow = (): void => {
      try { fit.fit() } catch { /* zero-size while hidden */ }
    }
    const observer = new ResizeObserver(() => { if (active) fitNow() })
    observer.observe(container)
    fitNow()

    return () => {
      observer.disconnect()
      fitRef.current = null
      ws.close()
      term.dispose()
    }
  }, [tab.id])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => { try { fitRef.current?.fit() } catch { /* hidden */ } })
    return () => cancelAnimationFrame(id)
  }, [active])

  return <div ref={containerRef} className="dsh-term-container" />
}
