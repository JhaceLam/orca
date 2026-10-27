import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import { describe, expect, it, vi } from 'vitest'

import {
  changedFileScope,
  countFindings,
  listChangedFiles
} from './check-flaky-test-pattern-ratchet.mjs'

describe('countFindings', () => {
  it('counts each rule per file, folding TSX twins and Windows separators', () => {
    const counts = countFindings(
      [
        { ruleId: 'test-no-wall-clock', file: 'src/a.test.ts' },
        { ruleId: 'test-no-wall-clock', file: 'src\\a.test.ts' },
        { ruleId: 'test-no-wall-clock-tsx', file: 'src/b.test.tsx' },
        { ruleId: 'test-no-real-time-wait', file: 'src/a.test.ts' },
        { ruleId: 'test-no-real-time-wait', file: 'scratch.test.ts' }
      ],
      (file) => file !== 'scratch.test.ts'
    )

    expect([...counts]).toEqual([
      ['test-no-wall-clock:src/a.test.ts', 2],
      ['test-no-wall-clock:src/b.test.tsx', 1],
      ['test-no-real-time-wait:src/a.test.ts', 1]
    ])
  })
})

describe('changedFileScope', () => {
  it('limits enforcement to findings in changed files', () => {
    const inScope = changedFileScope(new Set(['src/a.test.ts']))

    expect(inScope('test-no-wall-clock:src/a.test.ts')).toBe(true)
    expect(inScope('test-no-wall-clock:src/b.test.ts')).toBe(false)
    expect(changedFileScope(null)).toBeUndefined()
  })
})

describe('listChangedFiles with real Git', () => {
  it.each([false, true])('selects the actual base when configured=%s', (configured) => {
    const root = mkdtempSync(join(tmpdir(), 'orca-flaky-ratchet-base-'))
    try {
      const config = join(root, 'empty.gitconfig')
      writeFileSync(config, '')
      for (const key of Object.keys(process.env).filter((key) =>
        key.toUpperCase().startsWith('GIT_')
      )) {
        vi.stubEnv(key, undefined)
      }
      vi.stubEnv('GIT_CONFIG_GLOBAL', config)
      vi.stubEnv('GIT_CONFIG_SYSTEM', config)
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
      vi.stubEnv('GITHUB_EVENT_NAME', undefined)
      vi.stubEnv('ORCA_FLAKY_TEST_RATCHET_ALL', undefined)
      const git = (...args) => {
        const result = runProcessSync({ program: 'git', args, cwd: root })
        expect(result.code, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      const commit = (message) =>
        git(
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-qm',
          message
        )
      git('init', '--quiet')
      git('symbolic-ref', 'HEAD', 'refs/heads/main')
      expect(realpathSync.native(git('rev-parse', '--absolute-git-dir'))).toBe(
        realpathSync.native(join(root, '.git'))
      )
      writeFileSync(join(root, 'upstream.test.ts'), 'export const upstream = 0\n')
      git('add', 'upstream.test.ts')
      commit('fork baseline')
      git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      writeFileSync(join(root, 'upstream.test.ts'), 'export const upstream = 1\n')
      git('add', 'upstream.test.ts')
      commit('actual main')
      const actualMain = git('rev-parse', 'HEAD')
      writeFileSync(join(root, 'feature.test.ts'), 'export const feature = 1\n')
      git('add', 'feature.test.ts')
      commit('feature')
      vi.stubEnv('ORCA_CODE_QUALITY_BASE', configured ? actualMain : undefined)

      expect([...listChangedFiles(root)].sort()).toEqual(
        configured ? ['feature.test.ts'] : ['feature.test.ts', 'upstream.test.ts']
      )
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
