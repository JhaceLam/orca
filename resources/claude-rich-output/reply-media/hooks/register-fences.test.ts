import { expect, mock, test } from 'claude-code/testing'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII='

for (const sample of [
  {
    name: 'long backtick example',
    lines: ['````md', '```math', 'example-formula', '```', '````']
  },
  {
    name: 'tilde example',
    lines: ['~~~md', '```math', 'example-formula', '```', '~~~']
  },
  {
    name: 'formula delimiters inside a tilde example',
    lines: ['~~~md', '$$', 'example-formula', '$$', '~~~']
  },
  {
    name: 'image inside a long tilde example',
    lines: ['~~~~md', '![example](example.png)', '~~~', '~~~~']
  }
]) {
  test(`a ${sample.name} stays literal without hiding the next formula`, async ($, on) => {
    const clock = mock.clock(on)
    const converted: (string | undefined)[] = []
    const drawn: string[] = []
    const example = sample.lines.join('\n')
    const text = `Before\n\n${example}\n\n\`\`\`math\nreal-formula\n\`\`\`\n\nAfter`
    on('session.cwd', () => ({ value: '/work' }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('fs.read', () => ({ value: { base64: PNG } }))
    on('fs.stat', () => ({ value: { kind: 'file' as const, size: 68, mtimeMs: 0, isLink: false } }))
    on('process.run', (_, e) => {
      converted.push(e.init?.stdin)
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ file: '/tmp/formula.png', width: 100, height: 40 }),
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false
        }
      }
    })
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    const stored = await $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'test' },
      uuid: sample.name,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }
    })
    await clock.settle()
    expect(stored.message?.content?.[0]?.text).toBe(text)
    expect(converted).toEqual(['real-formula'])
    const ui = await $.ui.mount({
      plugin: 'reply-media',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text, isFirstOfReply: true }
    })
    try {
      expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('real-formula')
      expect(drawn).toEqual([`Before\n\n${example}`, 'After'])
    } finally {
      await ui.unmount()
    }
  })
}
