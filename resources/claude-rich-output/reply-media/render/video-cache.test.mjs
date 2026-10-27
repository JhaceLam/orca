import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'video-cache-test-')))
after(() => rmSync(root, { recursive: true, force: true }))
const clip = join(root, 'clip.mp4')
const made = spawnSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc=duration=1:size=64x48:rate=10',
  clip
])
assert.equal(made.status, 0, made.stderr?.toString())

const cacheRoot = () => mkdtempSync(join(root, 'cache-'))
const invoke = (cache, ...nodeArgs) =>
  spawnSync(process.execPath, [...nodeArgs, join(import.meta.dirname, 'video.mjs'), 'frames'], {
    input: clip,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: cache, TMP: cache, TEMP: cache, LOCALAPPDATA: cache }
  })
const framesOf = (run) => {
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

for (const [name, broken] of [
  ['truncated JSON', () => '{"dir":'],
  ['null', () => 'null'],
  ['wrong directory', (frames) => JSON.stringify({ ...frames, dir: join(root, 'elsewhere') })],
  ['string frame count', (frames) => JSON.stringify({ ...frames, count: String(frames.count) })],
  ['zero frame rate', (frames) => JSON.stringify({ ...frames, fps: 0 })]
]) {
  test(`a ${String(name)} frame cache is regenerated without changing the clip`, () => {
    const cache = cacheRoot()
    const first = framesOf(invoke(cache))
    writeFileSync(join(first.dir, 'frames.json'), broken(first))
    const restored = framesOf(invoke(cache))
    assert.deepEqual(restored, first)
    assert.deepEqual(JSON.parse(readFileSync(join(first.dir, 'frames.json'), 'utf8')), first)
  })
}

test('an interrupted metadata write never publishes a partial cache entry', () => {
  const cache = cacheRoot()
  const first = framesOf(invoke(cache))
  const kept = join(first.dir, 'frames.json')
  const original = readFileSync(kept, 'utf8')
  rmSync(join(first.dir, `f${String(first.count).padStart(5, '0')}.png`))
  const preload = join(cache, 'interrupt-metadata.cjs')
  writeFileSync(
    preload,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const write = fs.writeFileSync;
    fs.writeFileSync = function (file, data, ...args) {
      if (typeof file === 'string' && path.dirname(file) === ${JSON.stringify(first.dir)}
          && path.basename(file).startsWith('frames.json')) {
        write(file, '{', ...args);
        throw new Error('simulated interrupted metadata write');
      }
      return write(file, data, ...args);
    };
    require('node:module').syncBuiltinESMExports();
  `
  )
  const interrupted = invoke(cache, '--require', preload)
  assert.notEqual(interrupted.status, 0)
  assert.match(interrupted.stderr, /simulated interrupted metadata write/)
  assert.equal(readFileSync(kept, 'utf8'), original)
  assert.deepEqual(framesOf(invoke(cache)), first)
})
