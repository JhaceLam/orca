import { expect, mock, test } from 'claude-code/testing'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII='
const TEXT = 'Before\n\n![clip](clip.mp4)\n\nAfter'
const POSTER = '/tmp/cache-video-poster.png'
const OLD = '/tmp/cache-video-old'
const FRESH = '/tmp/cache-video-fresh'
const RAN = {
  exitCode: 0,
  stdout: '',
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false
}

for (const missing of ['first', 'last', 'neither']) {
  test(`replay with ${missing} cached frame missing keeps the poster and recuts only when needed`, async ($, on) => {
    const clock = mock.clock(on)
    let swept = false
    let cuts = 0
    let blits = 0
    const reads: string[] = []
    const stats: string[] = []
    const missingPath = `${OLD}/${missing === 'first' ? 'f00001.png' : 'f00003.png'}`
    on('session.cwd', () => ({ value: '/work' }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
    on('ui.toast', () => ({ value: undefined }))
    on('fs.stat', (_, e) => {
      stats.push(e.path)
      return swept && missing !== 'neither' && e.path === missingPath
        ? { deny: 'ENOENT: cached frame was swept' }
        : { value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }
    })
    on('fs.read', (_, e) => {
      reads.push(e.path)
      return { value: { base64: PNG } }
    })
    on('ui.blit', () => {
      blits++
      return { value: {} }
    })
    on('process.run', (_, e) => {
      const output =
        e.argv[2] === 'frames'
          ? { dir: ++cuts === 1 ? OLD : FRESH, count: 3, fps: 10 }
          : { file: POSTER, width: 100, height: 40, clip: '/work/clip.mp4' }
      return { value: { ...RAN, stdout: JSON.stringify(output) } }
    })
    await $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: 'video-cache-replay',
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: TEXT }] }
    })
    await clock.settle()
    const mount = () =>
      $.ui.mount({
        plugin: 'reply-media',
        surface: 'terminal',
        component: 'AssistantMessage',
        props: { text: TEXT, isFirstOfReply: true }
      })
    const first = await mount()
    const key = String((await first.find({ type: 'Button', text: '▶ play' }))?.props.key)
    await first.press({ key })
    await clock.settle()
    await clock.advance(300)
    expect(cuts).toBe(1)
    expect(blits).toBe(3)
    await first.unmount()
    swept = true
    reads.length = 0
    stats.length = 0
    blits = 0
    const restored = await mount()
    try {
      expect(await restored.find({ type: 'Image' })).toBeDefined()
      expect(stats).toContain(POSTER)
      await restored.press({ key })
      await clock.settle()
      expect(cuts).toBe(missing === 'neither' ? 1 : 2)
      expect(await restored.find({ type: 'Button', text: '❚❚ pause' })).toBeDefined()
      reads.length = 0
      await clock.advance(300)
      const dir = missing === 'neither' ? OLD : FRESH
      expect(reads).toEqual(
        expect.arrayContaining([`${dir}/f00001.png`, `${dir}/f00002.png`, `${dir}/f00003.png`])
      )
      expect(reads.filter((path) => path.startsWith(`${dir === OLD ? FRESH : OLD}/`))).toEqual([])
      expect(blits).toBe(3)
      expect(await restored.find({ type: 'Button', text: '▶ play' })).toBeDefined()
    } finally {
      await restored.unmount()
    }
  })
}

test('cancelling during a missing-frame probe does not start another extraction', async ($, on) => {
  const clock = mock.clock(on)
  let swept = false
  let cuts = 0
  on('session.cwd', () => ({ value: '/work' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('fs.stat', async (_, e) => {
    if (swept && e.path === `${OLD}/f00001.png`) {
      await clock.sleep(1_000)
      return { deny: 'ENOENT: cached frame was swept' }
    }
    return { value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_, e) => {
    const output =
      e.argv[2] === 'frames'
        ? { dir: ++cuts === 1 ? OLD : FRESH, count: 3, fps: 10 }
        : { file: POSTER, width: 100, height: 40, clip: '/work/clip.mp4' }
    return { value: { ...RAN, stdout: JSON.stringify(output) } }
  })
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'test' },
    uuid: 'video-cache-cancel',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: TEXT }] }
  })
  await clock.settle()
  const ui = await $.ui.mount({
    plugin: 'reply-media',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: TEXT, isFirstOfReply: true }
  })
  try {
    const key = String((await ui.find({ type: 'Button', text: '▶ play' }))?.props.key)
    await ui.press({ key })
    await clock.settle()
    await clock.advance(300)
    swept = true
    await ui.press({ key })
    await clock.settle()
    await ui.press({ key })
    await clock.advance(1_000)
    expect(cuts).toBe(1)
    expect(await ui.find({ type: 'Button', text: '▶ play' })).toBeDefined()
  } finally {
    await ui.unmount()
  }
})
