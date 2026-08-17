# dsh-vision-fallback

Vision-as-a-service host plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
keeps a **text-only** default model (e.g. `deepseek-v4-pro`) while pasted screenshots are described by a
**vision-capable fallback** (e.g. `kimi-k2.6` via `opencode-go`). The text model stays in charge and answers;
the vision model only supplies the "eyes".

```
screenshot ──► vision model describes it (per-image, cached) ──► text description ──► main model answers
```

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin source (`name`, `inject`, `Config`, `apply`). |
| `lib/` | Built output (`index.js` + `index.d.ts`) via `npm run build`. |
| `install.sh` | Idempotent dev installer: copies source + wires the patch entry. |
| `package.json` | `main`/`types`/`exports`/`peerDependencies` for npm publishing. |

## Prerequisites (per VM)

1. Install DeepSeek Harness and initialize the `web` profile.
2. Configure the vision route in `~/.dsh/settings.yaml`:
   ```yaml
   llm-pi-ai:
     providers:
       opencode-go:
         apiKeyEnv: OPENCODE_GO_API_KEY
   ```
3. Store the credential (never commit this) in `~/.dsh/.credentials.yaml`:
   ```yaml
   OPENCODE_GO_API_KEY: <your key>
   ```

## Install / update

```bash
./install.sh            # copies src/index.ts + wires the patch
# restart dsh
```

Propagate by keeping this repo in git: `git pull && ./install.sh` on each VM.

## Configuration

Edit `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
config:
  fallbackProvider: opencode-go   # vision route
  fallbackModel: kimi-k2.6        # vision model id
  textProviders: [deepseek-official]
```

## Standard package / publish

Build and publish as a standard npm package (loaded by name):

```bash
npm install && npm run build
npm publish
```

```yaml
# then, in cordis.patch.yml:
- insert:
    - id: vision-fallback
      name: 'dsh-vision-fallback'
```

## Notes

- Routing is provider-based (`textProviders`); keep the list to genuinely text-only routes.
- Descriptions are cached in memory per server run by attachment id.
