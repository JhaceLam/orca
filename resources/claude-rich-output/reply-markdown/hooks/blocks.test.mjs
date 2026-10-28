import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from './blocks.ts'

const source = Array.from({ length: 3000 }, (_, line) => `line ${line}: **literal** \`sss\``).join(
  '\n'
)

test('a long closed code fence keeps all its literal lines', () => {
  assert.deepEqual(parse(`\`\`\`text\n${source}\n\`\`\``), [
    { kind: 'code', language: 'text', source, hasGapAbove: false }
  ])
})

test('a long incomplete fence stays raw even with a shorter closing run', () => {
  const text = `\`\`\`\`md\n${source}\n\`\`\``
  assert.deepEqual(parse(`## Title\n${text}`), [
    { kind: 'heading', level: 2, text: 'Title', hasGapAbove: false },
    { kind: 'raw', text, hasGapAbove: false }
  ])
})

for (const fence of ['```', '````', '~~~']) {
  test(`a dollar line does not close inside a ${fence} code example`, () => {
    const source = '$$\nx\n$$'
    assert.deepEqual(parse(`Before\n\n$$\n\n${fence}latex\n${source}\n${fence}\n\n## After`), [
      { kind: 'raw', text: 'Before\n\n$$', hasGapAbove: false },
      { kind: 'code', language: 'latex', source, hasGapAbove: true },
      { kind: 'heading', level: 2, text: 'After', hasGapAbove: true }
    ])
  })
}
