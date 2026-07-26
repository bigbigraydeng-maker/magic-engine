/**
 * Regression tests for stripUnpairedServerToolUse().
 *
 * Production incident 2026-07-21 (Carrington Estate, job
 * c6ed8821-45de-4e47-a3ec-42811704c8d8): 张骞 ran 362 s and then died with
 *
 *   400 messages.1: `web_search` tool use with id `srvtoolu_...` was found
 *   without a corresponding `web_search_tool_result` block
 *
 * Anthropic validates server-tool pairing across the whole message history on
 * every request. When a turn is cut short mid-search the assistant message ends
 * with a `server_tool_use` whose `web_search_tool_result` never arrived; pushing
 * that message into history poisons every subsequent call in the loop.
 *
 * Confirmed against the live API: history with the orphan → 400 (exact message
 * above); same history with the orphan stripped → 200.
 */

import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { stripUnpairedServerToolUse } from '../agent'

type Block = Anthropic.Messages.ContentBlock

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block
const serverToolUse = (id: string) =>
  ({ type: 'server_tool_use', id, name: 'web_search', input: { query: 'x' } }) as unknown as Block
const searchResult = (toolUseId: string) =>
  ({ type: 'web_search_tool_result', tool_use_id: toolUseId, content: [] }) as unknown as Block
const clientToolUse = (id: string) =>
  ({ type: 'tool_use', id, name: 'fetch_url', input: { url: 'https://x' } }) as unknown as Block

describe('stripUnpairedServerToolUse', () => {
  it('drops a server_tool_use whose result never arrived (the 2026-07-21 bug)', () => {
    const content = [serverToolUse('srvtoolu_orphan'), text('partial answer')]

    const result = stripUnpairedServerToolUse(content)

    expect(result.map(b => b.type)).toEqual(['text'])
  })

  it('keeps a server_tool_use that has its matching result', () => {
    const content = [
      serverToolUse('srvtoolu_ok'),
      searchResult('srvtoolu_ok'),
      text('answer'),
    ]

    expect(stripUnpairedServerToolUse(content)).toEqual(content)
  })

  it('strips only the unpaired block when a turn holds both', () => {
    const content = [
      serverToolUse('srvtoolu_ok'),
      searchResult('srvtoolu_ok'),
      serverToolUse('srvtoolu_orphan'),
      text('answer'),
    ]

    const result = stripUnpairedServerToolUse(content)

    expect(result.map(b => (b as { id?: string }).id ?? b.type)).toEqual([
      'srvtoolu_ok',
      'web_search_tool_result',
      'text',
    ])
  })

  it('matches results by id, not by position', () => {
    // Two searches whose results come back interleaved / out of order.
    const content = [
      serverToolUse('srvtoolu_a'),
      serverToolUse('srvtoolu_b'),
      searchResult('srvtoolu_b'),
      searchResult('srvtoolu_a'),
    ]

    expect(stripUnpairedServerToolUse(content)).toEqual(content)
  })

  it('never touches client-side tool_use blocks — the tool loop still needs them', () => {
    const content = [clientToolUse('toolu_fetch'), text('calling fetch_url')]

    expect(stripUnpairedServerToolUse(content)).toEqual(content)
  })

  it('leaves ordinary text-only turns untouched', () => {
    const content = [text('just prose')]

    expect(stripUnpairedServerToolUse(content)).toEqual(content)
  })

  it('handles an empty content array', () => {
    expect(stripUnpairedServerToolUse([])).toEqual([])
  })
})
