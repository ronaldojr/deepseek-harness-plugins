/**
 * Build config for dsh-terminal-ui.
 *
 * Two faces:
 *  1. Node half  — `src/index.ts` bundled to `lib/index.js` (ESM). `ws` and
 *     every `@deepseek-ai/*` import stays external (resolved from the profile
 *     node_modules at runtime).
 *  2. Browser half — `src/client/index.ts` bundled to `lib/client.js`, a CJS
 *     closure that calls `window.__ModuleLoader__.load({ id, factory })` (the
 *     client module-table contract). Platform seed modules stay external;
 *     everything else (@xterm/xterm, @xterm/addon-fit) is inlined.
 *
 * Plain `.css` imports are inlined by a small plugin that injects a global
 * `<style data-plugin="dsh-terminal-ui">` tag at factory execution.
 */
import { readFileSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type Plugin } from 'tsdown'

/** The module specifiers the shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Documented runtime exemption: the snapshot-store engine stays a table entry. */
const RUNTIME_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_EXEMPTION]

const CSS_PREFIX = '\0dsh-terminal-css:'
/** tsdown's css-guard matches ids ending in `.css`, so the virtual id must not. */
const CSS_SUFFIX = '.mjs'

/** Inline plain `.css` (global, unhashed) as a `<style>` tag. */
function cssInline(): Plugin {
  return {
    name: 'dsh-terminal-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      const abs = importer === undefined ? resolvePath(source) : resolvePath(dirname(importer), source)
      return CSS_PREFIX + abs + CSS_SUFFIX
    },
    load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      const css = readFileSync(file, 'utf8')
      const tagId = `dsh-terminal-ui/${basename(file)}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = 'dsh-terminal-ui';`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
        `export default {};`,
      ].join('\n')
    },
  }
}

export default defineConfig([
  // Node half (host loader entry).
  {
    name: 'dsh-terminal-ui',
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Bundle ws so the host half is self-contained and does not depend on the
    // profile (or plugin checkout) providing `ws` at runtime. The optional
    // native ws peers stay external: ws probes them in a try/catch at runtime.
    noExternal: ['ws'],
    external: (id: string) => id.startsWith('@deepseek-ai/') || id === 'bufferutil' || id === 'utf-8-validate',
  },
  // Browser half (client module bundle).
  {
    name: 'dsh-terminal-ui/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [cssInline()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-terminal-ui", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
