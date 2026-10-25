import { runProcessSync } from '@orca/process-host'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const scripts = import.meta.dirname
const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rich-output-cache-'))
  directories.push(root)
  const put = (name, source) => {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
  }
  for (const name of ['build-claude-rich-output.mjs', 'claude-rich-output-source-hash.mjs']) {
    put(`config/scripts/${name}`, readFileSync(join(scripts, name)))
  }
  put(
    'src/shared/claude-rich-output-artifacts.ts',
    readFileSync(join(scripts, '../../src/shared/claude-rich-output-artifacts.ts'))
  )
  put('pnpm-lock.yaml', 'fixture lock')
  put('resources/claude-rich-output/foo', 'barvalue')
  put(
    'node_modules/esbuild/package.json',
    JSON.stringify({ type: 'module', exports: './index.js' })
  )
  put('node_modules/esbuild/index.js', 'export async function build() {}')
  put(
    'node_modules/@orca/process-host/package.json',
    JSON.stringify({ type: 'module', exports: './index.js' })
  )
  put(
    'node_modules/@orca/process-host/index.js',
    `import { appendFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
export function runProcessSync({ args }) {
  const root = process.cwd();
  const output = args.at(-1);
  rmSync(output, { recursive: true, force: true });
  cpSync(join(root, 'resources/claude-rich-output'), output, { recursive: true });
  mkdirSync(join(output, 'node_modules/@mathjax/src'), { recursive: true });
  mkdirSync(join(output, 'node_modules/@mathjax/mathjax-newcm-font'), { recursive: true });
  appendFileSync(join(root, 'deploy.log'), 'deploy\\n');
  return { code: 0 };
}`
  )
  const runBuild = () =>
    runProcessSync({
      program: process.execPath,
      args: [join(root, 'config/scripts/build-claude-rich-output.mjs')],
      cwd: root,
      timeoutMs: 30_000
    })
  const build = () => {
    const result = runBuild()
    expect(result.code, result.stderr).toBe(0)
  }
  const deployments = () => readFileSync(join(root, 'deploy.log'), 'utf8').trim().split('\n').length
  return { root, put, build, runBuild, deployments }
}

test('a cached workspace package build still refreshes changed rich-output resources', () => {
  const { root, put, deployments } = fixture()
  put(
    'config/scripts/build-workspace-packages.mjs',
    readFileSync(join(scripts, 'build-workspace-packages.mjs'))
  )
  put('src/packages/process-host/package.json', '{"name":"@orca/process-host"}')
  put('src/packages/process-host/source.ts', 'export const fixture = true')
  for (const name of ['typescript', 'tsx', '@types/node']) {
    put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '0.0.0' }))
  }
  put(
    'package-builder.cjs',
    `const { mkdirSync, writeFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const root = process.cwd();
const dist = join(root, 'src/packages/process-host/dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.js'), 'export const built = true');
appendFileSync(join(root, 'package-build.log'), 'build\\n');`
  )
  const build = () => {
    const result = runProcessSync({
      program: process.execPath,
      args: [join(root, 'config/scripts/build-workspace-packages.mjs')],
      cwd: root,
      env: { ...process.env, npm_execpath: join(root, 'package-builder.cjs') },
      timeoutMs: 30_000
    })
    expect(result.code, result.stderr).toBe(0)
  }
  build()
  expect(existsSync(join(root, 'out/claude-rich-output/manifest.json'))).toBe(true)
  put('resources/claude-rich-output/foo', 'updated')
  build()
  expect(readFileSync(join(root, 'package-build.log'), 'utf8')).toBe('build\n')
  expect(deployments()).toBe(2)
  expect(readFileSync(join(root, 'out/claude-rich-output/foo'), 'utf8')).toBe('updated')
})

test('the build rejects an unsafe dependency filename before publishing its manifest', () => {
  const { root, put, runBuild } = fixture()
  put('resources/claude-rich-output/notes with spaces.txt', 'dependency asset')
  const result = runBuild()
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('Unsafe Claude rich output asset path')
  expect(result.stderr).toContain('notes with spaces.txt')
  expect(existsSync(join(root, 'out/claude-rich-output/manifest.json'))).toBe(false)
})

test('a filename/content boundary collision deploys the new files instead of retaining stale output', () => {
  const { root, put, build, deployments } = fixture()
  build()
  expect(readFileSync(join(root, 'out/claude-rich-output/foo'), 'utf8')).toBe('barvalue')
  rmSync(join(root, 'resources/claude-rich-output/foo'))
  put('resources/claude-rich-output/foobar', 'value')
  build()
  expect(deployments()).toBe(2)
  expect(existsSync(join(root, 'out/claude-rich-output/foo'))).toBe(false)
  expect(readFileSync(join(root, 'out/claude-rich-output/foobar'), 'utf8')).toBe('value')
})

test('unchanged inputs reuse the deployment, while changed content refreshes it', () => {
  const { root, put, build, deployments } = fixture()
  build()
  build()
  expect(deployments()).toBe(1)
  put('resources/claude-rich-output/foo', 'updated')
  build()
  expect(deployments()).toBe(2)
  expect(readFileSync(join(root, 'out/claude-rich-output/foo'), 'utf8')).toBe('updated')
})

for (const name of [
  'pnpm-lock.yaml',
  'config/scripts/build-claude-rich-output.mjs',
  'config/scripts/claude-rich-output-source-hash.mjs'
]) {
  test(`changing deployment input ${name} refreshes the bundle`, () => {
    const { root, build, deployments } = fixture()
    build()
    appendFileSync(join(root, name), '\n// fixture change\n')
    build()
    expect(deployments()).toBe(2)
  })
}
