/**
 * Host half of dsh-terminal-ui.
 *
 * Registers one HTTP upgrade route (default `/plugins/dsh-terminal-ui/ws`)
 * through `ctx.webServer`. Each WebSocket connection that upgrades on that
 * path is handed exactly one PTY session allocated via
 * `ctx.subprocess.spawnTerminal`, and the two are wired together:
 *
 *   client -> host   JSON messages: { type: 'input', data } |
 *                                   { type: 'signal', signal }
 *   host   -> client JSON messages: { type: 'output', data } |
 *                                   { type: 'exit', exitCode, signal } |
 *                                   { type: 'error', message }
 *
 * Closing either side terminates the PTY session. All PTYs are terminated
 * when the plugin fiber disposes.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalHandle, SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

export const name = 'dsh-terminal-ui'
export const inject = ['webServer', 'subprocess']

export interface Config {
  /** Shell executable argv[0]; defaults to $SHELL / %COMSPEC% / /bin/sh. */
  shell?: string
  /** Terminal type to advertise as $TERM; defaults to xterm-256color. */
  term?: string
  /** Default terminal width in columns. */
  cols?: number
  /** Default terminal height in rows. */
  rows?: number
  /** TERM-to-KILL cleanup grace in milliseconds. */
  graceMs?: number
  /** Upgrade route pathname. */
  path?: string
}

const SIGNALS: readonly SubprocessTerminalSignal[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP']

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/sh'
}

/**
 * Build the argv that starts the interactive shell with a real $TERM.
 *
 * The subprocess seam hardcodes node-pty's `name: 'dumb'`, which node-pty
 * turns into `$TERM=dumb` (it overwrites any `env.TERM` the caller passes).
 * `dumb` disables clear-screen, color, and readline line editing, so a
 * user-facing terminal must re-set $TERM before the shell initializes. On
 * POSIX we exec the shell through `env` (which applies TERM and then replaces
 * itself with the shell — same pid, so process tracking/signalling is intact);
 * Windows TERM is irrelevant, so the shell runs directly.
 */
function shellArgv(shell: string, term: string): readonly string[] {
  if (process.platform === 'win32') return [shell]
  return ['/usr/bin/env', `TERM=${term}`, shell]
}

function decode(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return Buffer.from(raw).toString('utf8')
}

export function apply(ctx: Context, config: Config = {}): void {
  const shell = config.shell ?? defaultShell()
  const term = config.term ?? 'xterm-256color'
  const cols = config.cols ?? 100
  const rows = config.rows ?? 30
  const graceMs = config.graceMs ?? 5000
  const path = config.path ?? '/plugins/dsh-terminal-ui/ws'

  const wss = new WebSocketServer({ noServer: true })
  const live = new Map<WebSocket, SubprocessTerminalHandle>()

  async function attach(ws: WebSocket, spec: { cwd: string; cols: number; rows: number }): Promise<void> {
    let handle: SubprocessTerminalHandle
    try {
      handle = await ctx.subprocess.spawnTerminal({
        argv: shellArgv(shell, term),
        cwd: spec.cwd,
        cols: spec.cols,
        rows: spec.rows,
        graceMs,
      })
    } catch (error: unknown) {
      ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
      ws.close()
      return
    }
    live.set(ws, handle)

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'output', data: text }))
    }
    handle.output.on('data', onData)

    ws.on('message', (raw: RawData) => {
      let msg: { type?: unknown; data?: unknown; signal?: unknown }
      try {
        msg = JSON.parse(decode(raw))
      } catch {
        return
      }
      if (msg.type === 'input' && typeof msg.data === 'string') {
        void handle.write(msg.data).catch(() => {})
      } else if (msg.type === 'signal' && typeof msg.signal === 'string' && SIGNALS.includes(msg.signal as SubprocessTerminalSignal)) {
        void handle.signalForeground(msg.signal as SubprocessTerminalSignal).catch(() => {})
      }
    })

    void handle.done.then((outcome) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode: outcome.exitCode, signal: outcome.signal }))
      }
      ws.close()
    }).catch(() => {})

    ws.on('close', () => {
      live.delete(ws)
      handle.output.off('data', onData)
      void handle.terminate().catch(() => {})
    })
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.registerUpgrade({
      path,
      handler: (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const spec = {
          cwd: url.searchParams.get('cwd') ?? process.cwd(),
          cols: Number(url.searchParams.get('cols')) || cols,
          rows: Number(url.searchParams.get('rows')) || rows,
        }
        wss.handleUpgrade(req, socket, head, (ws) => { void attach(ws, spec) })
      },
    })
    return () => {
      disposeRoute()
      for (const [ws, handle] of live) {
        ws.terminate()
        void handle.terminate().catch(() => {})
      }
      live.clear()
      wss.close()
    }
  }, 'dsh-terminal-ui: terminal upgrade route')
}
