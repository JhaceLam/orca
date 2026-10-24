import { build } from 'esbuild'
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  statSync
} from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcessSync } from '@orca/process-host'
import { computeClaudeRichOutputSourceHash } from './claude-rich-output-source-hash.mjs'
import { claudeRichOutputAssetFilenames } from '../../src/shared/claude-rich-output-artifacts.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = join(root, 'out', 'claude-rich-output')
const marker = join(output, '.source-hash')
const key = computeClaudeRichOutputSourceHash(root)
if (!existsSync(marker) || readFileSync(marker, 'utf8') !== key) {
  const result = runProcessSync({
    program: 'pnpm',
    args: [
      '--filter',
      '@orca/claude-rich-output',
      'deploy',
      '--prod',
      '--legacy',
      '--force',
      '--config.allowUnusedPatches=true',
      '--config.nodeLinker=hoisted',
      output
    ],
    cwd: root,
    stdio: 'inherit',
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    process.exit(result.code ?? 1)
  }
  const mathjax = join(output, 'node_modules', '@mathjax', 'src')
  for (const directory of ['ts', 'cjs', 'mjs', 'components', 'tsconfig']) {
    rmSync(join(mathjax, directory), { recursive: true, force: true })
  }
  const font = join(realpathSync(mathjax), '..', 'mathjax-newcm-font')
  // The component loader uses the bundled SVG font, not its development sources or HTML fonts.
  for (const directory of ['mjs', 'cjs', 'chtml', 'def', 'tsconfig', 'examples']) {
    rmSync(join(font, directory), { recursive: true, force: true })
  }
  for (const metadata of ['.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.bin']) {
    rmSync(join(output, 'node_modules', metadata), { recursive: true, force: true })
  }
  writeFileSync(marker, key)
}

await build({
  entryPoints: [join(root, 'resources/claude-rich-output/reply-media/render/process.mjs')],
  outfile: join(output, 'reply-media/render/process.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  },
  logLevel: 'error'
})

const assets = []
function collect(directory, relative = 'claude-rich-output') {
  for (const name of readdirSync(directory).sort()) {
    if (relative === 'claude-rich-output' && name === 'manifest.json') {
      continue
    }
    const file = join(directory, name)
    if (!realpathSync(file).startsWith(`${realpathSync(output)}${sep}`)) {
      throw new Error(`Rich output asset escapes its bundle: ${file}`)
    }
    if (statSync(file).isDirectory()) {
      collect(file, `${relative}/${name}`)
    } else {
      assets.push(`${relative}/${name}`)
    }
  }
}
collect(output)
const manifestText = JSON.stringify({ assets: assets.sort() })
claudeRichOutputAssetFilenames(manifestText)
writeFileSync(join(output, 'manifest.json'), manifestText)
