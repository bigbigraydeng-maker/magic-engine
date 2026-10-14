import { describe, it, expect } from 'vitest'
import {
  CHANGE_SOURCE_LABELS,
  CHANGE_SOURCES,
  parseChangeActor,
} from '../change-source'

describe('CHANGE_SOURCE_LABELS', () => {
  it('has a non-empty label for every change source', () => {
    for (const source of CHANGE_SOURCES) {
      expect(CHANGE_SOURCE_LABELS[source].length).toBeGreaterThan(0)
    }
  })
})

describe('parseChangeActor', () => {
  it('parses an assistant edit', () => {
    expect(parseChangeActor('edit by amy@example.test (AI 助手)')).toEqual({
      who: 'amy@example.test',
      source: 'assistant',
    })
  })

  it('never leaves the assistant suffix in who', () => {
    const parsed = parseChangeActor('edit by amy@example.test (AI 助手)')
    expect(parsed.who.includes('(AI 助手)')).toBe(false)
  })

  it('parses a manual edit', () => {
    expect(parseChangeActor('edit by amy@example.test')).toEqual({
      who: 'amy@example.test',
      source: 'manual',
    })
  })

  it('parses an import with an actor', () => {
    expect(parseChangeActor('import:batch-1 by amy@example.test')).toEqual({
      who: 'amy@example.test',
      source: 'import',
    })
  })

  it('parses an import without an actor', () => {
    expect(parseChangeActor('import:batch-1')).toEqual({
      who: '',
      source: 'import',
    })
  })

  it('parses a rollback with an actor', () => {
    expect(parseChangeActor('rollback:batch-1 by amy@example.test')).toEqual({
      who: 'amy@example.test',
      source: 'rollback',
    })
  })

  it('parses a rollback without an actor', () => {
    expect(parseChangeActor('rollback:batch-1')).toEqual({
      who: '',
      source: 'rollback',
    })
  })

  it('treats empty, null and undefined as system', () => {
    expect(parseChangeActor('')).toEqual({ who: '系统', source: 'system' })
    expect(parseChangeActor(null)).toEqual({ who: '系统', source: 'system' })
    expect(parseChangeActor(undefined)).toEqual({ who: '系统', source: 'system' })
  })

  it('treats the literal system actor as system', () => {
    expect(parseChangeActor('system')).toEqual({ who: '系统', source: 'system' })
  })

  it('falls back to system for unknown text', () => {
    expect(parseChangeActor('something else')).toEqual({
      who: 'something else',
      source: 'system',
    })
  })
})
