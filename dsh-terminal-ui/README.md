# dsh-terminal-ui

A tabbed, PTY-backed terminal panel for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. It installs as an official out-of-tree plugin bundle and adds:

- a **Terminal** toggle in each conversation's header action row,
- a **right-docked, resizable panel** with a tab bar — one tab per shell
  session, a `+` button to open more, and per-tab close,
- real shell sessions (your `$SHELL`, or `%COMSPEC%`/`powershell.exe` on
  Windows) that survive collapsing the panel and keep running while hidden.

## How it works

The plugin is one npm package with two halves:

| Half | Entry | Role |
| --- | --- | --- |
| Host | `lib/index.js` (`main`) | Registers an HTTP upgrade route (`/plugins/dsh-terminal-ui/ws`) through `ctx.webServer`; each WebSocket connection gets one PTY from `ctx.subprocess.spawnTerminal`. |
| Browser | `lib/client.js` (`./client`) | Registers a header toggle (`conversation.session.header.actions`) and the tabbed panel (`shell.overlay`); each tab renders an [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) terminal wired to a WebSocket. |

It uses only public seams — `ctx.webServer.registerUpgrade`, `ctx.subprocess.spawnTerminal`, and the additive `conversation.session.header.actions` / `shell.overlay` slots — so it composes beside the shipped UI without replacing anything.

## Install

From a built checkout of this plugin:

```sh
dsh plugin --profile web add /path/to/dsh-terminal-ui
```

`dsh plugin add` forwards to pnpm in the profile directory, installs this
package's dependencies (`@xterm/xterm`, `@xterm/addon-fit`, `ws`), and
reconciles `dsh.profile.bundles` so the bundle's `cordis.patch.yml` joins the
layer stack. Restart `dsh web` to pick it up.

Install from Git (sources build via `prepare`; pnpm ≥ 10 will ask you to allow
its build script the first time):

```sh
dsh plugin --profile web add github:your-user/dsh-terminal-ui
```

## Build

```sh
pnpm install
pnpm run build     # tsdown -> lib/index.js (host) + lib/client.js (browser)
pnpm run typecheck # tsc --noEmit
```

## Configuration

The bundle patch (`cordis.patch.yml`) mounts the plugin with no required
config. Optional overrides (all defaulted in code):

```yaml
- id: terminal-ui
  name: 'dsh-terminal-ui'
  config:
    shell: '/bin/zsh'   # shell executable
    cols: 100           # default terminal width in columns
    rows: 30            # default terminal height in rows
    graceMs: 5000       # TERM-to-KILL cleanup grace
    path: '/plugins/dsh-terminal-ui/ws'  # upgrade route pathname
```

## Known limitations

- **No live resize of the PTY** — `ctx.subprocess.spawnTerminal` allocates a
  fixed-size terminal (default 100×30) and the seam exposes no resize method.
  xterm fits the viewport; a tab opened at a much larger size should be
  re-opened to pick up new dimensions. This is a limitation of the current
  subprocess seam, not the plugin.
- **Panels are process-local** — terminal state and raw bytes live only while
  the `dsh web` process runs; closing the server terminates every session.
