# DeepSeek Harness Plugins

My personal collection of DeepSeek Harness **host plugins**. Each subdirectory is
one self-contained plugin, installable into any DSH profile.

## Layout

```
plugins/
  vision-fallback/   # vision-as-a-service: describes pasted images for a text-only main model
  dsh-terminal-ui/   # tabbed PTY terminal panel for the web GUI (client bundle, installed via `dsh plugin`)
  <future-plugin>/   # one folder per plugin
setup.sh             # one-line installer (curl | bash): clones this repo and runs bootstrap.sh
bootstrap.sh         # one-shot VM setup: harness checkout + build + all plugins
update.sh            # pull + rebuild + reinstall on an existing VM
templates/
  settings.yaml      # machine-local settings seed (no secrets)
  dsh-web.service    # optional systemd user unit for `dsh web`
```

## Per-plugin convention

Every plugin folder contains:

| File | Purpose |
|------|---------|
| `index.ts` | The Cordis plugin source (a host plugin with `export const name` and `export function apply`). |
| `package.json` | Plugin name + peer dependencies on the harness packages. |
| `install.sh` | Idempotent installer: copies `index.ts` under the profile dir and wires the `cordis.patch.yml` entry. |
| `README.md` | What it does, prerequisites, and configuration. |

`dsh-terminal-ui` is a npm-style bundle instead: it has no `install.sh`; the
bootstrap installs it with `dsh plugin --profile web add link:<path>`.

## New VM install

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/ronaldojr/deepseek-harness-plugins/main/setup.sh | bash
```

The installer clones this repo into `~/deepseek-harness-plugins`, then runs
`bootstrap.sh`, which clones the harness branch (`sabiaMain` by default) into
`~/deepseek-harness`, runs `pnpm install && pnpm run build` there, installs
both plugins into the `web` profile, and seeds `~/.dsh/settings.yaml`. It only
needs `git`, Node ≥ 22.19, and pnpm (activated through corepack). It is
idempotent and safe to re-run.

After the first run, create `~/deepseek-harness/.env` with `DEEPSEEK_API_KEY`
and export the provider keys the settings seed references
(`OPENCODE_GO_API_KEY`, `GOOGLE_API_KEY`, `GITHUB_COPILOT_API_KEY`), then:

```bash
cd ~/deepseek-harness && pnpm dsh web
```

For auto-start, adapt `templates/dsh-web.service` (pnpm path and env file) and
install it as a user unit:

```bash
mkdir -p ~/.config/systemd/user
cp templates/dsh-web.service ~/.config/systemd/user/dsh.service
systemctl --user daemon-reload && systemctl --user enable --now dsh
```

## Update a VM

```bash
cd dsh-plugins && git pull && ./update.sh
# restart dsh (or: systemctl --user restart dsh)
```

`update.sh` pulls both repos, rebuilds the harness and `dsh-terminal-ui` only
when their commits moved, and re-runs the idempotent installers.

## Troubleshooting

- **`ssh` rejects the system config** (`Bad owner or permissions on
  /etc/ssh/ssh_config.d/...`): some VM images ship that drop-in with wrong
  ownership. Fix it (`sudo chown root:root <file>`) or prefix git calls with
  `GIT_SSH_COMMAND="ssh -F ~/.ssh/config"`.
- **First `pnpm dsh web` says the frontend dist is missing**: re-run
  `./bootstrap.sh` — the build stamp lives in `~/.cache/dsh-bootstrap`.
