import { describe, expect, it } from 'vitest'
import { bodyTextToBlocks } from '../body-blocks'

describe('bodyTextToBlocks', () => {
  it('returns nothing for empty input', () => {
    expect(bodyTextToBlocks(null)).toEqual([])
    expect(bodyTextToBlocks(undefined)).toEqual([])
    expect(bodyTextToBlocks('')).toEqual([])
    expect(bodyTextToBlocks('  \n\n  ')).toEqual([])
  })

  it('splits on blank lines; a greeting ending with a comma stays a paragraph', () => {
    const blocks = bodyTextToBlocks('Kia ora Alex,\n\nYour trip is three months away.')
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Kia ora Alex,' },
      { kind: 'paragraph', text: 'Your trip is three months away.' },
    ])
  })

  it('treats a short single line without final punctuation as a heading', () => {
    const blocks = bodyTextToBlocks('What March will feel like\n\nPack a warm jacket.\n\nGood to know')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'heading'])
    expect(blocks[0].text).toBe('What March will feel like')
  })

  it('markdown-style hash headings lose the marker', () => {
    expect(bodyTextToBlocks('## One thing to do at home')).toEqual([{ kind: 'heading', text: 'One thing to do at home' }])
  })

  it('a block where every line is a list item becomes bullets (any common marker)', () => {
    const blocks = bodyTextToBlocks('- City one: cool\n• City two: wet\n* City three: dry\n1. City four: warm')
    expect(blocks).toEqual([
      { kind: 'bullet', text: 'City one: cool' },
      { kind: 'bullet', text: 'City two: wet' },
      { kind: 'bullet', text: 'City three: dry' },
      { kind: 'bullet', text: 'City four: warm' },
    ])
  })

  it('keeps line breaks inside a paragraph (sign-off, address lines)', () => {
    expect(bodyTextToBlocks('Warm regards,\nThe Sample Team')).toEqual([
      { kind: 'paragraph', text: 'Warm regards,\nThe Sample Team' },
    ])
  })

  it('a long single line is a paragraph, and so is a line holding a placeholder', () => {
    const long = 'x'.repeat(80)
    expect(bodyTextToBlocks(long)).toEqual([{ kind: 'paragraph', text: long }])
    expect(bodyTextToBlocks('Hello {{first_name}}')).toEqual([{ kind: 'paragraph', text: 'Hello {{first_name}}' }])
  })

  it('handles Windows line endings and extra blank lines', () => {
    const blocks = bodyTextToBlocks('First line here.\r\n\r\n\r\n\r\nSecond line here.')
    expect(blocks.map((b) => b.text)).toEqual(['First line here.', 'Second line here.'])
  })

  it('a mixed list and text chunk stays one paragraph rather than losing lines', () => {
    const blocks = bodyTextToBlocks('Things to bring:\n- passport\n- adapter')
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'Things to bring:\n- passport\n- adapter' }])
  })
})
