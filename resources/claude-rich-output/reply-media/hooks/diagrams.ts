import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Diagram } from '../types'
import { splitBlocks, classify } from './blocks'
import type { Script } from './blocks'
import { run } from './render-process'

// This address is also declared by register.tsx so each module can be scanned.
const diagrams = atom({ plugin: 'reply-media', key: 'diagrams' } as const, {})

// Node/MathJax cold starts on a shared devbox can outlast five seconds.
// Keep a finite bound and retry only a killed, transient timeout once.
const RENDER_TIMEOUT_MS = 30_000
const pendingRenders = new Map<string, Promise<void>>()

export function scheduleRender(
  $: EngineInterface,
  text: string,
  drawn: ReadonlySet<Script>,
  isForced = false,
  onFailure?: () => void
) {
  $.clock.after(0, async () => {
    try {
      await render($, text, drawn, isForced)
    } catch (error) {
      onFailure?.()
      $.ui.toast(`Media preview failed: ${String(error)}`)
    }
  })
}

/**
 * Renders each block of `text` that has no outcome yet, and records it;
 * `isForced` renders the ones that have an outcome too.
 */
export async function render(
  $: EngineInterface,
  text: string,
  drawn: ReadonlySet<Script>,
  isForced = false
) {
  const cwd = await $.session.cwd()

  for (const [index, block] of splitBlocks(text).entries()) {
    if (index % 2 === 0) {
      continue
    }
    const job = classify(block, drawn)
    // An image or a video is read again each time it is shown: the file
    // behind an unchanged path may be a new one.
    const isFile = job?.script === 'picture' || job?.script === 'video'
    const known = await read($, diagrams)
    if (job === undefined || (!isFile && !isForced && known[block] && !('error' in known[block]))) {
      continue
    }

    // Append, resume and a retry button may request the same block together.
    // Share that render instead of racing writers or multiplying cold starts.
    const key = JSON.stringify([cwd, block])
    const pending = pendingRenders.get(key)
    if (pending) {
      await pending
      continue
    }
    const task = (async () => {
      const init = { stdin: job.source, timeoutMs: RENDER_TIMEOUT_MS, cwd }
      let outcome = await run<Diagram>($, [job.script], init)
      if ('error' in outcome && /aborted: still running after \d+ms/.test(outcome.error)) {
        outcome = await run<Diagram>($, [job.script], init)
      }
      await update($, diagrams, (all) => ({ ...all, [block]: outcome }))
    })()
    pendingRenders.set(key, task)
    try {
      await task
    } finally {
      pendingRenders.delete(key)
    }
  }
}
