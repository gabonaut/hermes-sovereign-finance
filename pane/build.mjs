// Builds the Hermes Desktop half of the plugin.
//
//   node build.mjs            write ../desktop/plugin.js
//   node build.mjs --check    fail unless ../desktop/plugin.js is exactly what the sources build to
//   node build.mjs --dev      write dev/dist/harness.js (the pane with the SDK stubbed, for a browser)
//   node build.mjs --dev --serve [--port=4173]   the same, rebuilt on change and served from dev/
//
// The plugin is one unminified ESM file. Hermes Desktop resolves exactly three imports at load time,
// so those are the only externals.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'desktop', 'plugin.js')
const EXTERNAL = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const option = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]

/**
 * Checked line by line on the raw output, comments and strings included. The first group is what the
 * Desktop admission lint (hermes_cli/plugin_validate_desktop.py) and the plugin contract refuse. The
 * second is what the install scanner (tools/skills_guard.py) would list for this file, so the build
 * keeps its scan empty.
 */
const FORBIDDEN = [
  ['dynamic code evaluation', /(?<![\w$.])eval\(|\bnew\s+Function\(/],
  ['dynamic import', /\bimport\(/],
  ['URL import', /\bimport\s+(?:[^;'"]*?\bfrom\s*)?['"][a-zA-Z][\w+.-]*:/],
  ['script element', /createElement\(\s*['"]script['"]\s*\)|<script\b/i],
  ['app markup selector', /\[data-(?:slot|tour|sidebar|testid|tree-[\w-]+|pane-host|titlebar-cluster)\b/],
  ['document.body observer', /\.observe\(\s*document\.body\b/],
  ['webview access', /\bwebview\b/i],
  ['raw desktop bridge', /\bhermesDesktop\b/],
  ['direct network call', /\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/],
  ['new window', /\bwindow\.open\(|_blank/],
  ['non-ASCII byte', /[^\x00-\x7F]/],

  ['scanner: secret-shaped assignment', /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}/i],
  ['scanner: character code construction', /String\.fromCharCode|charCodeAt/],
  ['scanner: base64 call', /\batob\s*\(|\bbtoa\s*\(/],
  ['scanner: run of unicode escapes', /\\u[0-9a-fA-F]{4}.*\\u[0-9a-fA-F]{4}.*\\u[0-9a-fA-F]{4}/],
  ['scanner: run of hex escapes', /\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}/]
]

/**
 * uqr turns a string into bytes with a charCodeAt loop, which the install scanner lists as possible
 * obfuscation. The pane hands uqr bytes, so that helper never runs here. This swaps its body for the
 * TextEncoder equivalent, and fails the build if uqr changes and the swap no longer applies.
 */
const uqrBytes = {
  name: 'uqr-bytes',
  setup(build) {
    build.onLoad({ filter: /[\\/]node_modules[\\/]uqr[\\/]dist[\\/]index\.mjs$/ }, async file => {
      const source = await readFile(file.path, 'utf8')
      const helper = /function toUtf8ByteArray\(str\) \{\n[\s\S]*?\n\}\n/
      if (!helper.test(source)) throw new Error('uqr changed: toUtf8ByteArray was not found, update the swap in build.mjs')
      const contents = source.replace(helper, 'function toUtf8ByteArray(str) {\n  return Array.from(new TextEncoder().encode(str));\n}\n')
      return { contents, loader: 'js' }
    })
  }
}

function inspect(code) {
  const problems = []
  const lines = code.split('\n')
  for (const [rule, pattern] of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (pattern.test(line)) problems.push(`${rule} (line ${i + 1}): ${line.trim().slice(0, 100)}`)
    })
  }
  const imports = [...code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?$/gm)].map(m => m[1])
  for (const spec of imports) {
    if (!EXTERNAL.includes(spec)) problems.push(`unexpected import: ${spec}`)
  }
  if (!/^export\s*\{\s*plugin_default as default\s*\};?$/m.test(code)) problems.push('default export not found')
  return problems
}

async function bundlePlugin() {
  const result = await esbuild.build({
    absWorkingDir: here,
    entryPoints: ['src/plugin.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    charset: 'ascii',
    minify: false,
    legalComments: 'none',
    external: EXTERNAL,
    banner: {
      js: [
        '// Sovereign Finance pane for Hermes Desktop. Built from pane/src by pane/build.mjs: edit the',
        '// sources, not this file.',
        '// Bundles uqr 0.1.3 (MIT), Copyright (c) Project Nayuki, Copyright (c) 2023 Anthony Fu, with its',
        '// string-to-bytes helper swapped for TextEncoder (see build.mjs).'
      ].join('\n')
    },
    plugins: [uqrBytes],
    outfile: 'out.js',
    write: false,
    logLevel: 'warning'
  })
  const code = result.outputFiles[0].text
  const problems = inspect(code)
  if (problems.length > 0) {
    throw new Error(`desktop/plugin.js would break the plugin rules:\n  ${problems.join('\n  ')}`)
  }
  return code
}

const devOptions = {
  plugins: [uqrBytes],
  absWorkingDir: here,
  entryPoints: ['dev/harness.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  charset: 'ascii',
  sourcemap: 'inline',
  alias: { '@hermes/plugin-sdk': './dev/sdk-stub.tsx' },
  define: { 'process.env.NODE_ENV': '"development"' },
  outfile: 'dev/dist/harness.js',
  logLevel: 'info'
}

async function main() {
  if (flag('dev')) {
    if (!flag('serve')) {
      await esbuild.build(devOptions)
      return
    }
    const ctx = await esbuild.context(devOptions)
    await ctx.watch()
    const port = Number(option('port') ?? 4173)
    const server = await ctx.serve({ servedir: path.join(here, 'dev'), host: '127.0.0.1', port })
    console.log(`harness: http://localhost:${server.port}/`)
    return
  }

  const code = await bundlePlugin()

  if (flag('check')) {
    const committed = await readFile(OUT, 'utf8').catch(() => null)
    if (committed !== code) {
      console.error('desktop/plugin.js is out of date: run `node pane/build.mjs` and commit the result.')
      process.exit(1)
    }
    console.log('desktop/plugin.js matches the sources.')
    return
  }

  await writeFile(OUT, code)
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${code.length} bytes)`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
