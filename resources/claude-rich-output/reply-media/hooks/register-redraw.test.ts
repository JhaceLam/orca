import { expect, mock, test } from 'claude-code/testing'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII='

for (const mode of ['swept picture', 'retry button']) {
  test(`${mode} reports failed background metadata without rejecting the UI`, async ($, on) => {
    const clock = mock.clock(on)
    const text = '```math\nx^2\n```'
    const toasts: string[] = []
    const drawn: string[] = []
    let unavailable = false
    on('session.cwd', () =>
      unavailable ? { deny: 'context metadata unavailable' } : { value: '/work' }
    )
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('fs.stat', () =>
      unavailable
        ? { deny: 'ENOENT: image was swept' }
        : { value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }
    )
    on('fs.read', () => ({ value: { base64: PNG } }))
    on('process.run', () => ({
      value: {
        exitCode: mode === 'retry button' ? 1 : 0,
        stdout: JSON.stringify({ file: '/tmp/redraw.png', width: 100, height: 40 }),
        stderr: mode === 'retry button' ? 'initial render unavailable' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false
      }
    }))
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    await $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: mode,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }
    })
    await clock.settle()
    const mount = () =>
      $.ui.mount({
        plugin: 'reply-media',
        surface: 'terminal',
        component: 'AssistantMessage',
        props: { text, isFirstOfReply: true }
      })
    const first = await mount()
    if (mode === 'swept picture') {
      expect(await first.find({ type: 'Image' })).toBeDefined()
      await first.unmount()
      unavailable = true
      const restored = await mount()
      try {
        await clock.settle()
        expect(await restored.find({ type: 'Image' })).toBeUndefined()
        expect(drawn).toContain(text)
      } finally {
        await restored.unmount()
      }
    } else {
      try {
        const retry = await first.find({ type: 'Button', text: 'retry' })
        expect(retry).toBeDefined()
        unavailable = true
        await first.press({ key: String(retry?.props.key) })
        await clock.settle()
        expect(await first.find({ type: 'Text', text: 'initial render unavailable' })).toBeDefined()
      } finally {
        await first.unmount()
      }
    }
    expect(toasts).toEqual([expect.stringContaining('Media preview failed:')])
    expect(toasts[0]).toContain('context metadata unavailable')
  })
}
