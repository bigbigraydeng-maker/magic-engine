// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cleanText, isUuid, parsePatch, parseUploadFields } from '../input'

const UUID = '11111111-1111-4111-8111-111111111111'

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('isUuid / cleanText', () => {
  it('recognises UUIDs only', () => {
    expect(isUuid(UUID)).toBe(true)
    expect(isUuid('cts-client')).toBe(false)
    expect(isUuid(`${UUID}/../x`)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })

  it('trims, strips control characters and turns empty into null', () => {
    expect(cleanText('  hi\u0000there ')).toBe('hi there')
    expect(cleanText('   ')).toBeNull()
    expect(cleanText(42)).toBeNull()
    expect(cleanText('a\nb', true)).toBe('a\nb')
    expect(cleanText('a\nb')).toBe('a b')
    expect(cleanText('a\u0007b', true)).toBe('ab')
  })
})

describe('parseUploadFields', () => {
  it('uses safe defaults: other category, internal only, no version, no replacement', () => {
    const result = parseUploadFields(form({}), 'My file')
    expect(result).toEqual({
      ok: true,
      value: { title: 'My file', category: 'other', visibility: 'internal', versionLabel: null, description: null, replaceId: null },
    })
  })

  it('reads every field when given', () => {
    const result = parseUploadFields(form({
      title: ' Brochure ',
      category: 'brochure',
      visibility: 'client',
      versionLabel: 'v11',
      description: 'line 1\nline 2',
      replaceId: UUID,
    }), 'ignored')
    expect(result).toEqual({
      ok: true,
      value: { title: 'Brochure', category: 'brochure', visibility: 'client', versionLabel: 'v11', description: 'line 1\nline 2', replaceId: UUID },
    })
  })

  it('refuses values it does not know instead of guessing', () => {
    expect(parseUploadFields(form({ category: 'secret' }), 't')).toMatchObject({ ok: false })
    expect(parseUploadFields(form({ visibility: 'public' }), 't')).toMatchObject({ ok: false })
    expect(parseUploadFields(form({ replaceId: 'not-a-uuid' }), 't')).toMatchObject({ ok: false })
    expect(parseUploadFields(form({ title: 'x'.repeat(201) }), 't')).toMatchObject({ ok: false })
    expect(parseUploadFields(form({ versionLabel: 'v'.repeat(41) }), 't')).toMatchObject({ ok: false })
    expect(parseUploadFields(form({ description: 'd'.repeat(1001) }), 't')).toMatchObject({ ok: false })
  })

  it('needs some title, and ignores a file sent where text was expected', () => {
    expect(parseUploadFields(form({}), '   ')).toMatchObject({ ok: false })
    const sneaky = form({ visibility: new File(['client'], 'client.txt') })
    expect(parseUploadFields(sneaky, 't')).toMatchObject({ ok: true, value: { visibility: 'internal' } })
  })
})

describe('parsePatch', () => {
  it('accepts a partial edit and keeps only what was sent', () => {
    expect(parsePatch({ title: ' New ', visibility: 'client' })).toEqual({
      ok: true,
      value: { title: 'New', visibility: 'client' },
    })
  })

  it('can clear the optional text fields with null or empty text', () => {
    expect(parsePatch({ versionLabel: null, description: '' })).toEqual({
      ok: true,
      value: { versionLabel: null, description: null },
    })
  })

  it('accepts archive and restore', () => {
    expect(parsePatch({ status: 'archived' })).toEqual({ ok: true, value: { status: 'archived' } })
    expect(parsePatch({ status: 'current' })).toEqual({ ok: true, value: { status: 'current' } })
  })

  it('refuses anything else', () => {
    for (const body of [null, 'x', [], {}, { status: 'deleted' }, { category: 'nope' }, { visibility: 'all' }, { title: '' }, { title: 'x'.repeat(201) }]) {
      expect(parsePatch(body)).toMatchObject({ ok: false })
    }
  })

  it('ignores fields it does not own (no mass assignment)', () => {
    const result = parsePatch({ title: 'ok', client_id: 'other', storage_path: 'x', uploaded_by: 'someone', sha256: 'y' })
    expect(result).toEqual({ ok: true, value: { title: 'ok' } })
  })
})
