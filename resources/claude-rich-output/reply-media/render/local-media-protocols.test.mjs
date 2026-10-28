import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runProcess } from '@orca/process-host'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'local-media-protocols-')))
after(() => rmSync(root, { recursive: true, force: true }))
const segment = join(root, 'clip.ts')
const made = await runProcess({
  program: 'ffmpeg',
  args: [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x48:r=25:d=2',
    '-c:v',
    'mpeg2video',
    '-f',
    'mpegts',
    segment
  ],
  timeoutMs: 20_000,
  terminationBarrier: true
})
assert.equal(made.code, 0, made.stderr)

const picture = join(import.meta.dirname, 'picture.mjs')
const video = join(import.meta.dirname, 'video.mjs')
const pictureArgs =
  process.platform === 'darwin'
    ? [
        '--input-type=module',
        '-e',
        `Object.defineProperty(process, 'platform', { value: 'linux' }); await import(${JSON.stringify(pathToFileURL(picture).href)});`
      ]
    : [picture]

async function renderer(args, path, directory) {
  return runProcess({
    program: process.execPath,
    args,
    input: path,
    cwd: directory,
    env: {
      ...process.env,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
      ORCA_BACKGROUND_LAUNCH: '1'
    },
    timeoutMs: 20_000,
    terminationBarrier: true
  })
}

for (const { name, args } of [
  { name: 'picture converter (dispatch simulated on macOS)', args: pictureArgs },
  { name: 'video poster', args: [video] },
  { name: 'video frame probe', args: [video, 'frames'] }
]) {
  test(`${name} refuses HTTP segments inside a local playlist`, async (t) => {
    const directory = realpathSync(mkdtempSync(join(root, 'case-')))
    const requests = []
    const server = createServer((request, response) => {
      requests.push(request.url)
      response.writeHead(200, { 'Content-Type': 'video/mp2t' })
      response.end(readFileSync(segment))
    })
    t.after(async () => {
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const playlist = join(directory, 'playlist.m3u8')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    writeFileSync(
      playlist,
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:1',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:1,',
        `http://127.0.0.1:${String(address.port)}/clip.ts`,
        '#EXT-X-ENDLIST',
        ''
      ].join('\n')
    )
    const result = await renderer(args, playlist, directory)
    assert.deepEqual(requests, [], 'renderer fetched an HTTP segment')
    assert.notEqual(result.code, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /not on whitelist/i)
  })
}

test('the FFmpeg picture path still converts an ordinary local JPEG', async () => {
  const directory = realpathSync(mkdtempSync(join(root, 'local-')))
  const jpeg = join(directory, 'image.jpg')
  const made = await runProcess({
    program: 'ffmpeg',
    args: [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=64x48',
      '-frames:v',
      '1',
      '-threads',
      '1',
      jpeg
    ],
    timeoutMs: 20_000,
    terminationBarrier: true
  })
  assert.equal(made.code, 0, made.stderr)
  const result = await renderer(pictureArgs, jpeg, directory)
  assert.equal(result.code, 0, result.stderr)
  const converted = JSON.parse(result.stdout)
  const png = readFileSync(converted.file)
  assert.equal(png.toString('latin1', 1, 4), 'PNG')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [64, 48])
})
