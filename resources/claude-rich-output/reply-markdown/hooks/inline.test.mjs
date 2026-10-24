import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inline } from './inline.ts'

const punctuation = Array.from({ length: 94 }, (_, index) =>
  String.fromCharCode(index + 33)
).filter((value) => /[^a-z0-9]/i.test(value))
for (const character of punctuation) {
  test(`deletion prose unescapes ASCII punctuation ${JSON.stringify(character)}`, () => {
    assert.deepEqual(inline(`~~old~~ \\${character}`), [
      { mark: 'strike', children: [{ text: 'old' }] },
      { text: ` ${character}` }
    ])
  })
}

test('ordinary backslashes and inline code stay literal in deletion prose', () => {
  const code = '`\\# \\$`'
  assert.deepEqual(inline(`${String.raw`~~old~~ \alpha \1 \中 `}${code}`), [
    { mark: 'strike', children: [{ text: 'old' }] },
    { text: String.raw` \alpha \1 \中 ` },
    { code: String.raw`\# \$` }
  ])
})

for (const delimiter of ['*', '_']) {
  for (const trailing of [' c', '']) {
    test(`italic ${delimiter} retains its nested bold pair with trailing ${JSON.stringify(trailing)}`, () => {
      assert.deepEqual(
        inline(
          `~~x~~ ${delimiter}a ${delimiter.repeat(2)}b${delimiter.repeat(2)}${trailing}${delimiter}`
        ),
        [
          { mark: 'strike', children: [{ text: 'x' }] },
          { text: ' ' },
          {
            mark: 'italic',
            children: [
              { text: 'a ' },
              { mark: 'bold', children: [{ text: 'b' }] },
              ...(trailing ? [{ text: trailing }] : [])
            ]
          }
        ]
      )
    })
  }
}
