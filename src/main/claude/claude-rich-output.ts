import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { restoreOrStripOverlayEnv } from '../../shared/agent-overlay-env'
import type { BuildPtyHostEnvOptions } from '../ipc/pty/host-env/types'

const overlay = {
  primary: 'CLAUDE_CODE_PLUGIN_DIRS',
  overlay: 'ORCA_CLAUDE_PLUGIN_DIRS',
  source: 'ORCA_CLAUDE_SOURCE_PLUGIN_DIRS',
  preserveExplicitPrimary: true
}

function bundledRoots(options: BuildPtyHostEnvOptions): string[] {
  const roots = options.resourcesPath ? [join(options.resourcesPath, 'claude-rich-output')] : []
  if (hasAppEnvironment()) {
    const appPath = getAppEnvironment().getAppPath()
    roots.push(
      join(appPath, options.isPackaged ? 'claude-rich-output' : 'resources/claude-rich-output')
    )
  }
  return roots
}

export function applyClaudeRichOutputEnv(
  env: Record<string, string>,
  options: BuildPtyHostEnvOptions,
  roots: readonly string[] = bundledRoots(options)
): void {
  const enabled = env.ORCA_CLAUDE_RICH_OUTPUT === '1'
  // The launch intent must not leak into a nested Orca process after this host consumes it.
  delete env.ORCA_CLAUDE_RICH_OUTPUT
  restoreOrStripOverlayEnv(env, overlay)
  if (options.launchAgent !== 'claude' || !enabled || options.isWsl) {
    return
  }
  const root = roots.find((candidate) =>
    ['reply-markdown', 'reply-media'].every((name) =>
      existsSync(join(candidate, name, '.claude-plugin', 'plugin.json'))
    )
  )
  if (!root) {
    console.warn('[claude-rich-output] Bundled modules unavailable on this execution host')
    return
  }
  const source = env.CLAUDE_CODE_PLUGIN_DIRS ?? ''
  const dirs = new Set(source.split(delimiter).filter(Boolean))
  const installed = new Set<string>()
  for (const directory of dirs) {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(directory, '.claude-plugin', 'plugin.json'), 'utf8')
      )
      if (
        manifest &&
        typeof manifest === 'object' &&
        'name' in manifest &&
        typeof manifest.name === 'string'
      ) {
        installed.add(manifest.name)
      }
    } catch {
      /* Claude owns validation of explicitly configured user plugins. */
    }
  }
  for (const name of ['reply-markdown', 'reply-media']) {
    if (!installed.has(name)) {
      dirs.add(join(root, name))
    }
  }
  env.CLAUDE_CODE_PLUGIN_DIRS = [...dirs].join(delimiter)
  env.ORCA_CLAUDE_PLUGIN_DIRS = env.CLAUDE_CODE_PLUGIN_DIRS
  if (source) {
    env.ORCA_CLAUDE_SOURCE_PLUGIN_DIRS = source
  }
}
