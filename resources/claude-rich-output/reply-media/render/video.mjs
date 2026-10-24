// Usage: node video.mjs < path.txt          the clip's first frame
//        node video.mjs frames < path.txt   every frame, to play it
// The path is absolute, under ~/ or relative to the working directory. The
// frames are the private per-user cache/<sha1>/f00001.png and on, cut by
// `ffmpeg` (brew install ffmpeg). The first prints {"file","width","height",
// "clip"}: the first frame, its size in px and the clip's absolute path. The
// second prints {"dir","count","fps"}.
import { runRendererProcess as spawnSync } from './process.mjs'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { mediaCacheDirectory, privateMediaDirectory } from './media-cache-directory.mjs'
import { join, resolve } from 'node:path'

// shortcut: the whole clip is cut at its first play, into at most MAX_FRAMES
// frames no wider than WIDTH px, so a long clip plays at a lower rate and one
// past MAX_FRAMES seconds loses its end. Cut it in chunks as it plays if long
// clips start to matter.
const MAX_FRAMES = 600
const MAX_FPS = 12
const WIDTH = 960
const scale = `scale='min(${WIDTH},iw)':-2`

const clip = resolve(
  readFileSync(0, 'utf8')
    .trim()
    .replace(/^~(?=\/)/, homedir())
)
const stat = statSync(clip)
if (!stat.isFile()) {
  throw new Error(`not a regular file: ${clip}`)
}

// Named by path and mtime, so an edited clip is cut again.
const name = createHash('sha1').update(`${clip}${stat.mtimeMs}`).digest('hex')
const dir = privateMediaDirectory(join(mediaCacheDirectory(), name))
const frame = (number) => join(dir, `f${String(number).padStart(5, '0')}.png`)

const run = (command, args) => {
  const ran = spawnSync(command, args, { encoding: 'utf8' })
  if (ran.status !== 0) {
    throw new Error(String(ran.stderr || ran.error).trim())
  }
  return ran.stdout
}

if (process.argv[2] === 'frames') {
  const kept = join(dir, 'frames.json')
  let frames
  try {
    const cached = JSON.parse(readFileSync(kept, 'utf8'))
    if (
      cached?.dir === dir &&
      Number.isInteger(cached.count) &&
      cached.count > 0 &&
      cached.count <= MAX_FRAMES &&
      Number.isInteger(cached.fps) &&
      cached.fps > 0 &&
      cached.fps <= MAX_FPS
    ) {
      frames = { dir, count: cached.count, fps: cached.fps }
    }
  } catch {
    // Missing, unreadable or interrupted cache entries must be regenerated.
  }
  // The temp folder is swept file by file: a cut that lost its end is made again.
  if (!frames || !existsSync(frame(frames.count))) {
    // A recording may carry no duration (a MediaRecorder webm): the top rate.
    const duration = Number(
      run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip])
    )
    const fps =
      duration > 0 ? Math.max(1, Math.min(MAX_FPS, Math.floor(MAX_FRAMES / duration))) : MAX_FPS
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      clip,
      '-vf',
      `fps=${fps},${scale}`,
      '-frames:v',
      String(MAX_FRAMES),
      '-compression_level',
      '1',
      join(dir, 'f%05d.png')
    ])
    const count = readdirSync(dir).filter((file) => /^f\d{5}\.png$/.test(file)).length
    frames = { dir, count, fps }
    const temporary = `${kept}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(frames), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, kept)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  console.log(JSON.stringify(frames))
} else {
  if (!existsSync(frame(1))) {
    run('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf', scale, '-frames:v', '1', frame(1)])
  }
  // A PNG's size is in the chunk that follows its signature.
  const ihdr = Buffer.alloc(24)
  const fd = openSync(frame(1))
  readSync(fd, ihdr)
  closeSync(fd)
  console.log(
    JSON.stringify({
      file: frame(1),
      width: ihdr.readUInt32BE(16),
      height: ihdr.readUInt32BE(20),
      clip
    })
  )
}
