import { describe, expect, it } from 'vitest'
import { parsePreviewRequest, parseTemplateRequest } from '@/lib/crm/email-templates/request'

const valid = {
  key: 'post-call-single-tour',
  version: 3,
  catalogVersion: 7,
  picks: [{ tourId: 'tour-1', departOn: '2027-03-11' }],
  inputs: { destination: 'China' },
  callBasis: 'staff_attested',
}

describe('parseTemplateRequest', () => {
  it('no template field means a free-written email', () => {
    expect(parseTemplateRequest(undefined)).toEqual({ ok: true, template: null })
    expect(parseTemplateRequest(null)).toEqual({ ok: true, template: null })
  })

  it('accepts a complete request unchanged', () => {
    expect(parseTemplateRequest(valid)).toEqual({ ok: true, template: valid })
  })

  it('fills the optional parts with their neutral values', () => {
    expect(parseTemplateRequest({ key: 'spring-2027-follow-up', version: 1 })).toEqual({
      ok: true,
      template: { key: 'spring-2027-follow-up', version: 1, catalogVersion: null, picks: [], inputs: {}, callBasis: 'none' },
    })
    const res = parseTemplateRequest({ ...valid, picks: [{ tourId: 'tour-1' }], catalogVersion: null })
    expect(res.ok && res.template?.picks).toEqual([{ tourId: 'tour-1', departOn: null }])
    expect(res.ok && res.template?.catalogVersion).toBeNull()
  })

  it.each([
    ['a string', 'post-call'],
    ['an array', []],
    ['an unknown field', { ...valid, subject: 'sneaky' }],
    ['a bad key', { ...valid, key: 'Bad Key!' }],
    ['a missing key', { ...valid, key: undefined }],
    ['version 0', { ...valid, version: 0 }],
    ['a fractional version', { ...valid, version: 1.5 }],
    ['a string version', { ...valid, version: '3' }],
    ['a negative catalog version', { ...valid, catalogVersion: -1 }],
    ['picks that are not a list', { ...valid, picks: 'tour-1' }],
    ['too many picks', { ...valid, picks: Array.from({ length: 11 }, (_, i) => ({ tourId: `t${i}` })) }],
    ['a pick without a tour id', { ...valid, picks: [{ departOn: '2027-03-11' }] }],
    ['a malformed departure date', { ...valid, picks: [{ tourId: 'tour-1', departOn: '11/03/2027' }] }],
    ['inputs that are not an object', { ...valid, inputs: ['x'] }],
    ['an input with a bad name', { ...valid, inputs: { 'Bad-Name': 'x' } }],
    ['a non-string input', { ...valid, inputs: { destination: 5 } }],
    ['an over-long input', { ...valid, inputs: { destination: 'x'.repeat(2001) } }],
    ['too many inputs', { ...valid, inputs: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) }],
    ['an unknown call basis', { ...valid, callBasis: 'trust_me' }],
  ])('rejects %s', (_name, input) => {
    const res = parseTemplateRequest(input)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.length).toBeGreaterThan(0)
  })
})

describe('parsePreviewRequest', () => {
  it('accepts a key alone and fills the neutral defaults', () => {
    expect(parsePreviewRequest({ key: 'post-call-single-tour' })).toEqual({
      ok: true,
      request: { key: 'post-call-single-tour', picks: [], inputs: {}, callBasis: 'none' },
    })
  })

  it('carries the picks, the typed inputs, the call claim and the edited text', () => {
    const res = parsePreviewRequest({
      key: 'post-call-single-tour',
      picks: [{ tourId: 't1', departOn: '2027-03-11' }],
      inputs: { destination: 'China' },
      callBasis: 'staff_attested',
      subject: 'Edited subject',
      body: 'Edited body',
    })
    expect(res).toEqual({
      ok: true,
      request: {
        key: 'post-call-single-tour',
        picks: [{ tourId: 't1', departOn: '2027-03-11' }],
        inputs: { destination: 'China' },
        callBasis: 'staff_attested',
        subject: 'Edited subject',
        body: 'Edited body',
      },
    })
  })

  it.each([
    ['not an object', 'x'],
    ['an unknown field', { key: 'post-call', version: 3 }],
    ['a bad key', { key: 'Bad Key' }],
    ['bad picks', { key: 'post-call', picks: 'x' }],
    ['bad inputs', { key: 'post-call', inputs: { 'Bad-Name': 'x' } }],
    ['a bad call basis', { key: 'post-call', callBasis: 'trust_me' }],
    ['a numeric subject', { key: 'post-call', subject: 5 }],
    ['an over-long subject', { key: 'post-call', subject: 'x'.repeat(401) }],
    ['an over-long body', { key: 'post-call', body: 'x'.repeat(20001) }],
  ])('rejects %s', (_name, input) => {
    expect(parsePreviewRequest(input).ok).toBe(false)
  })
})
