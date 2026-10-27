import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcessSync } from '@orca/process-host'
import ts from 'typescript-api'
import { expect, it } from 'vitest'
import { discoverUnitFiles } from './ci-unit-files.mjs'
import { getNodeRuntimeInclude } from './vitest-node-runtime-files.mjs'

it('runs Node runtime contracts in Node even when the coordinator uses Bun', () => {
  expect(process.versions.bun).toBeUndefined()
  expect(process.release.name).toBe('node')
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(24)
})

function isGlobalThis(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isGlobalThis(expression.expression)
  }
  return ts.isIdentifier(expression) && expression.text === 'globalThis'
}

it('keeps exposed-GC heap measurements in the Node runtime project', () => {
  const root = process.cwd()
  const nodeFiles = new Set(globSync(getNodeRuntimeInclude()).map((file) => resolve(root, file)))
  const missing: string[] = []
  for (const file of discoverUnitFiles(root)) {
    if (nodeFiles.has(resolve(root, file))) {
      continue
    }
    const source = readFileSync(resolve(root, file), 'utf8')
    if (!source.includes('heapUsed') || !source.includes('gc')) {
      continue
    }
    const module = ts.createSourceFile(file, source, ts.ScriptTarget.Latest)
    let usesGlobalGc = false
    const visit = (node: ts.Node): void => {
      if (
        (ts.isPropertyAccessExpression(node) &&
          node.name.text === 'gc' &&
          isGlobalThis(node.expression)) ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteral(node.argumentExpression) &&
          node.argumentExpression.text === 'gc' &&
          isGlobalThis(node.expression))
      ) {
        usesGlobalGc = true
      }
      ts.forEachChild(node, visit)
    }
    visit(module)
    if (usesGlobalGc) {
      missing.push(file)
    }
  }
  expect(missing).toEqual([])
})

it('collects the indirect native PTY shell fixture exactly once in the Node project', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-runtime-list-'))
  try {
    const output = join(directory, 'files.json')
    const result = runProcessSync({
      program: process.execPath,
      args: [
        'config/scripts/run-vitest.mjs',
        'list',
        '--config',
        'config/vitest.config.ts',
        'src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts',
        '--filesOnly',
        `--json=${output}`
      ],
      cwd: process.cwd(),
      timeoutMs: 20_000
    })
    expect(result.code, result.stderr).toBe(0)
    const collected: unknown = JSON.parse(readFileSync(output, 'utf8'))
    expect(collected).toEqual([
      expect.objectContaining({
        file: expect.stringMatching(
          /[/\\]src[/\\]main[/\\]daemon[/\\]repro-13767-shell-ready-marker-lost-to-exec\.test\.ts$/
        ),
        projectName: 'node-runtime'
      })
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
