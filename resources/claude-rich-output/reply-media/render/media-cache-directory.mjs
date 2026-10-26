import { lstatSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export function privateMediaDirectory(directory) {
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error
    }
  }
  const stat = lstatSync(directory)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === 'function' &&
      (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
  ) {
    throw new Error(`Unsafe reply-media cache directory: ${directory}`)
  }
  return directory
}

export function mediaCacheDirectory() {
  const directory =
    typeof process.getuid === 'function'
      ? join(tmpdir(), `claude-reply-media-${process.getuid()}`)
      : join(process.env.LOCALAPPDATA || homedir(), 'claude-reply-media')
  return privateMediaDirectory(directory)
}
