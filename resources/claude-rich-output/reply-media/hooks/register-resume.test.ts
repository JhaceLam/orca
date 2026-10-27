import { expect, mock, test } from 'claude-code/testing'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII='
const RAN = {
  exitCode: 0,
  stdout: JSON.stringify({ file: '/tmp/resumed.png', width: 100, height: 40 }),
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false
}
const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const formula = (source: string) => `\`\`\`math\n${source}\n\`\`\``

for (const [kind, text] of [
  ['formula', formula('x^2')],
  ['diagram', '```mermaid\nflowchart LR\n  A --> B\n```']
]) {
  test(`resume refreshes a successful ${kind} preview for the current render environment`, async ($, on) => {
    const clock = mock.clock(on)
    const rendered: string[] = []
    const reads: string[] = []
    let theme = 'dark'
    on('session.cwd', () => ({ value: '/work' }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('session.messages', () => ({
      value: [{ role: 'assistant' as const, text, toolUses: [] }]
    }))
    on('session.start', () => ({ cwd: '/native-result' }))
    on('fs.stat', () => ({ value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }))
    on('fs.read', (_, e) => {
      reads.push(e.path)
      return { value: { base64: PNG } }
    })
    on('process.run', () => {
      const file = `/tmp/${kind}-${theme}.png`
      rendered.push(file)
      return { value: { ...RAN, stdout: JSON.stringify({ file, width: 100, height: 40 }) } }
    })
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
    await $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: `theme-${kind}`,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }
    })
    await clock.settle()
    expect(rendered).toEqual([`/tmp/${kind}-dark.png`])
    theme = 'light'
    expect(await $.session.start(START)).toEqual({ cwd: '/native-result' })
    expect(rendered).toEqual([`/tmp/${kind}-dark.png`, `/tmp/${kind}-light.png`])
    const ui = await $.ui.mount({
      plugin: 'reply-media',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text, isFirstOfReply: true }
    })
    try {
      expect(await ui.find({ type: 'Image' })).toBeDefined()
      expect(reads).toContain(`/tmp/${kind}-light.png`)
      expect(reads).not.toContain(`/tmp/${kind}-dark.png`)
    } finally {
      await ui.unmount()
    }
  })
}

for (const [empty, visible] of [
  ['$$\n$$', '$$\n$$'],
  ['$$ \t\r\n$$ \r', '$$ \t\r\n$$'],
  ['![empty](   )', '![empty](   )']
] as const) {
  test(`non-renderable block ${JSON.stringify(empty)} remains text beside a valid preview`, async ($, on) => {
    const clock = mock.clock(on)
    const converted: (string | undefined)[] = []
    const drawn: string[] = []
    const text = `Before\n\n${empty}\n\n${formula('real-formula')}\n\nAfter`
    on('session.cwd', () => ({ value: '/work' }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('fs.read', () => ({ value: { base64: PNG } }))
    on('fs.stat', () => ({ value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }))
    on('process.run', (_, e) => {
      converted.push(e.init?.stdin)
      return { value: RAN }
    })
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    await $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: 'empty-formula',
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }
    })
    await clock.settle()
    expect(converted).toEqual(['real-formula'])
    const ui = await $.ui.mount({
      plugin: 'reply-media',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text, isFirstOfReply: true }
    })
    try {
      expect((await ui.findAll({ type: 'Image' })).map((image) => image.props.alt)).toEqual([
        'real-formula'
      ])
      expect(drawn).toEqual([`Before\n\n${visible}`, 'After'])
    } finally {
      await ui.unmount()
    }
  })
}

for (const failure of ['stop', 'messages', 'first render']) {
  test(`resume forwards the native event after a ${failure} failure`, async ($, on) => {
    const converted: (string | undefined)[] = []
    const forwarded: unknown[] = []
    const toasts: string[] = []
    let cwdCalls = 0
    on('session.cwd', () => {
      cwdCalls++
      return failure === 'first render' && cwdCalls === 1
        ? { deny: 'first preview cwd unavailable' }
        : { value: '/work' }
    })
    on('session.messages', () =>
      failure === 'messages'
        ? { deny: 'resume transcript unavailable' }
        : {
            value: ['first', 'second'].map((source) => ({
              role: 'assistant' as const,
              text: formula(source),
              toolUses: []
            }))
          }
    )
    if (failure === 'stop') {
      on('state.get', { plugin: 'reply-media', key: 'playing' }, () => ({
        deny: 'playback state unavailable'
      }))
    }
    on('process.run', (_, e) => {
      converted.push(e.init?.stdin)
      return { value: RAN }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.start', (_, e) => {
      forwarded.push(e)
      return { cwd: '/native-result' }
    })
    on('fs.read', () => ({ value: { base64: PNG } }))
    on('fs.stat', () => ({ value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }))
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine', ref: 0 }))
    expect(await $.session.start(START)).toEqual({ cwd: '/native-result' })
    expect(forwarded).toEqual([START])
    expect(converted).toEqual(failure === 'first render' ? ['second'] : [])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('Media preview failed:')
    expect(toasts[0]).toContain('unavailable')
    if (failure === 'first render') {
      const ui = await $.ui.mount({
        plugin: 'reply-media',
        surface: 'terminal',
        component: 'AssistantMessage',
        props: { text: formula('second'), isFirstOfReply: true }
      })
      try {
        expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('second')
      } finally {
        await ui.unmount()
      }
    }
  })
}

test('resume does not report downstream session-start failures as media failures', async ($, on) => {
  let forwarded = 0
  const toasts: string[] = []
  on('session.messages', () => ({ value: [] }))
  on('session.start', () => {
    forwarded++
    throw new Error('native session-start failure')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await expect($.session.start(START)).rejects.toThrow('no implementation for session.start')
  expect(forwarded).toBe(1)
  expect(toasts).toEqual([])
})
