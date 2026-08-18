# dsh-vision-fallback

Vision-as-a-service host plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
keeps a **text-only** default model (e.g. `deepseek-v4-pro`) while pasted screenshots are described by a
**vision-capable fallback** (e.g. `kimi-k2.6` via `opencode-go`). The text model stays in charge and answers;
the vision model only supplies the "eyes".

```
screenshot ──► vision model describes it (per-image, cached) ──► text description ──► main model answers
```

The fallback fires **only when the main model does not advertise image input**: models with native
vision receive images directly and the vision route is never called.

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
  fallbackProvider: opencode-go   # vision route used for descriptions
  fallbackModel: kimi-k2.6        # vision model id on that route
  # textProviders: [deepseek-official]   # optional route allowlist; omit = every route
```

- `textProviders` is optional: omitted (or `[]`) covers every current and future
  provider route; set it to narrow handling to specific routes.
- The exact fallback pair (`fallbackProvider` + `fallbackModel`) is exempt from
  transformation, so its own description calls cannot recurse.

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

- Capability detection reads the provider's advertised `inputModalities`: a model
  that reports image support sees images directly, anything else gets a fallback
  description. Providers that report nothing are treated as text-only.
- Descriptions are cached in memory per server run by attachment id.
