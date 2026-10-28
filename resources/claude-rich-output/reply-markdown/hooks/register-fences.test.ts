import { expect, test } from 'claude-code/testing'

for (const [name, fence] of [
  ['mermaid', '```mermaid\nflowchart LR\n  A["~~literal~~"] --> B\n```'],
  ['math', '```math\n\\text{~~literal~~}\n```'],
  ['formula', '$$\n\\text{~~literal~~}\n$$'],
  ['streaming', '```mermaid\nflowchart LR\n  A["~~literal~~"] --> B']
]) {
  test(`deletion prose stays styled beside a ${name} fence`, async ($, on) => {
    const drawn: string[] = []
    on('settings.read', () => ({ value: {} }))
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    const after = name === 'streaming' ? '' : '\n\n~~after~~'
    const ui = await $.ui.mount({
      plugin: 'reply-markdown',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: `~~before~~\n\n${fence}${after}`, isFirstOfReply: true }
    })
    try {
      for (const text of after ? ['before', 'after'] : ['before']) {
        expect(
          (await ui.findAll({ type: 'Text', text: new RegExp(`^${text}$`) })).some(
            (node) => node.props.strikethrough === true
          )
        ).toBe(true)
      }
      expect(drawn).toEqual([fence])
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^literal$/ })).toBeUndefined()
    } finally {
      await ui.unmount()
    }
  })
}

test(
  'deletion prose stays styled when code cards are disabled',
  { options: { codeCards: false } },
  async ($, on) => {
    const fence = '```text\n~~literal~~\n```'
    const drawn: string[] = []
    on('settings.read', () => ({ value: {} }))
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    const ui = await $.ui.mount({
      plugin: 'reply-markdown',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: `~~before~~\n\n${fence}\n\n~~after~~`, isFirstOfReply: true }
    })
    try {
      for (const text of ['before', 'after']) {
        expect(
          (await ui.findAll({ type: 'Text', text: new RegExp(`^${text}$`) })).some(
            (node) => node.props.strikethrough === true
          )
        ).toBe(true)
      }
      expect(drawn).toEqual([fence])
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^literal$/ })).toBeUndefined()
    } finally {
      await ui.unmount()
    }
  }
)

for (const fence of ['```', '````', '~~~']) {
  test(`an unmatched dollar line preserves a ${fence} code card and later styled prose`, async ($, on) => {
    const source = '$$\n\\text{~~literal~~}\n$$'
    const drawn: string[] = []
    on('settings.read', () => ({ value: {} }))
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    const ui = await $.ui.mount({
      plugin: 'reply-markdown',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: {
        text: `~~before~~\n\n$$\n\n${fence}latex\n${source}\n${fence}\n\n~~after~~`,
        isFirstOfReply: true
      }
    })
    try {
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(source)
      expect(drawn).toEqual(['~~before~~\n\n$$'])
      expect(
        (await ui.findAll({ type: 'Text', text: /^after$/ })).some(
          (node) => node.props.strikethrough === true
        )
      ).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^literal$/ })).toBeUndefined()
    } finally {
      await ui.unmount()
    }
  })
}

for (const fence of ['```', '````', '~~~']) {
  test(`unmatched dollars preserve native CJK bold around a ${fence} code card`, async ($, on) => {
    const source = '**literal。**word\n$$'
    const drawn: string[] = []
    on('settings.read', () => ({ value: {} }))
    on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
      drawn.push(e.props.text)
      return { type: 'engine', ref: 0 }
    })
    const ui = await $.ui.mount({
      plugin: 'reply-markdown',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: {
        text: `$$\n**收斂。**記憶\n\n${fence}latex\n${source}\n${fence}\n\n**最後。**段落`,
        isFirstOfReply: true
      }
    })
    try {
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(source)
      expect(drawn).toEqual(['$$\n**收斂**。記憶', '**最後**。段落'])
    } finally {
      await ui.unmount()
    }
  })
}
