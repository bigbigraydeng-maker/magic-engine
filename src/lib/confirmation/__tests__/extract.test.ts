// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callExtractModel, mergeExtracted, preferTourCode, ExtractError } from '@/lib/confirmation/extract'
import { emptyConfirmation, sampleConfirmation } from '@/lib/confirmation/defaults'

const sample = sampleConfirmation()
const rawFromSample = {
  tourCode: ' demo 123456 ',
  groundOperator: sample.groundOperator,
  operatorTel: sample.operatorTel,
  departureDate: sample.departureDate,
  paxCount: 2,
  rooms: sample.rooms,
  guideNote: sample.guideNote,
  pickupCardNames: sample.pickupCardNames,
  emergencyContacts: sample.emergencyContacts,
  flights: sample.flights.map((f) => f.text),
  days: sample.days,
  itineraryNote: sample.itineraryNote,
  hotels: sample.hotels,
  inclusions: sample.inclusions,
  exclusions: sample.exclusions,
  warnings: ['Two different tour codes appear'],
}

describe('mergeExtracted', () => {
  it('fills the form from the model answer and cleans the tour code (spaces/case)', () => {
    const { data, notes } = mergeExtracted(rawFromSample)
    expect(data.tourCode).toBe('DEMO123456')
    expect(data.days).toHaveLength(3)
    expect(data.hotels[0].name).toBe('Example Grand Hotel Beijing')
    expect(data.flights).toHaveLength(2)
    expect(notes.join()).toContain('Two different tour codes')
  })

  it('keeps the staff settings (tips, cover) but never fills file fields from the template', () => {
    const { data, notes } = mergeExtracted({ tourCode: 'ABC1234', days: [{ date: '1 May', route: 'X', highlights: 'y', overnight: '' }], inclusions: [] })
    expect(data.tips).toHaveLength(emptyConfirmation().tips.length)
    expect(data.cover).toEqual(emptyConfirmation().cover)
    // not in the file -> blank and flagged, not "2 pax" / generic inclusions
    expect(data.paxCount).toBe(0)
    expect(data.inclusions).toEqual([])
    expect(data.exclusions).toEqual([])
    for (const word of ['人数', '「包含」', '「不包含」']) expect(notes.join()).toContain(word)
  })

  it('tells staff what was missing instead of silently leaving blanks', () => {
    const { notes } = mergeExtracted({})
    expect(notes.join()).toContain('团号')
    expect(notes.join()).toContain('每天行程')
  })

  it.each([null, 'text', 42, [], { days: 'x', hotels: 7, flights: { a: 1 }, paxCount: 'many' }])('never throws on garbage: %j', (raw) => {
    expect(() => mergeExtracted(raw)).not.toThrow()
  })

  it('an unread or invalid star rating stays unknown (0, not shown) and is flagged, never guessed as 4-star', () => {
    const { data, notes } = mergeExtracted({ tourCode: 'ABC1234', paxCount: 0, hotels: [{ name: 'H', stars: 9 }, { name: 'G' }], days: [{ date: 'd', route: 'r' }] })
    expect(data.paxCount).toBe(0)
    expect(data.hotels.map((h) => h.stars)).toEqual([0, 0])
    expect(notes.join()).toContain('星级')
  })
})

describe('callExtractModel', () => {
  const OLD = process.env.ANTHROPIC_API_KEY
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = OLD
  })

  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

  it('forces the submit tool and sends the document as data (text)', async () => {
    const f = ok({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_confirmation', input: { tourCode: 'X' } }] })
    expect(await callExtractModel({ kind: 'text', text: 'hello itinerary' }, f)).toEqual({ tourCode: 'X' })
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_confirmation' })
    expect(body.messages[0].content[0].text).toContain('hello itinerary')
    expect(body.system).toContain('DATA')
  })

  it('refuses an over-long text instead of silently cutting off the last days', async () => {
    const f = ok({})
    await expect(callExtractModel({ kind: 'text', text: 'x'.repeat(60_001) }, f)).rejects.toThrow('太多')
    expect(f).not.toHaveBeenCalled()
  })

  it('sends a PDF as a document block', async () => {
    const f = ok({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_confirmation', input: {} }] })
    await callExtractModel({ kind: 'pdf', base64: 'QUJD' }, f)
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf', data: 'QUJD' } })
  })

  it('refuses a half-read answer (max_tokens) instead of returning a partial itinerary', async () => {
    const f = ok({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'submit_confirmation', input: { days: [] } }] })
    await expect(callExtractModel({ kind: 'text', text: 'x' }, f)).rejects.toThrow(ExtractError)
  })

  it('errors clearly when the model skips the tool, the API fails, or the key is missing', async () => {
    await expect(callExtractModel({ kind: 'text', text: 'x' }, ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }))).rejects.toThrow('没有返回结果')
    await expect(callExtractModel({ kind: 'text', text: 'x' }, vi.fn(async () => new Response('no', { status: 529 })) as unknown as typeof fetch)).rejects.toThrow('529')
    delete process.env.ANTHROPIC_API_KEY
    await expect(callExtractModel({ kind: 'text', text: 'x' }, ok({}))).rejects.toThrow('密钥')
  })
})

describe('real CTS4270729 upload findings (2026-11-19)', () => {
  const text = 'Your Tour Code: CTS4270429  Dept: 29-Jul-2027\nCTS4270729   pre-confirmation itinerary'

  it('file name CTS4270729 wins over the header code the model picked, and staff are told', () => {
    const r = preferTourCode('CTS4270429', 'CTS4270729 confirmation(1).docx', text)
    expect(r.code).toBe('CTS4270729')
    expect(r.note).toContain('CTS4270429')
  })

  it('keeps the model choice when the file name has no code, or a code not printed in the document', () => {
    expect(preferTourCode('CTS4270429', 'confirmation.docx', text)).toEqual({ code: 'CTS4270429', note: null })
    expect(preferTourCode('CTS4270429', 'CTS9999999.docx', text)).toEqual({ code: 'CTS4270429', note: null })
    expect(preferTourCode('CTS4270729', 'CTS4270729.docx', text)).toEqual({ code: 'CTS4270729', note: null })
  })

  it('a departure date without a year is flagged (model returned "29 Jul" for "29-Jul-2027")', () => {
    expect(mergeExtracted({ tourCode: 'A1234567', departureDate: '29 Jul', days: [{ date: 'd', route: 'r' }] }).notes.join()).toContain('没有年份')
    expect(mergeExtracted({ tourCode: 'A1234567', departureDate: '29-Jul-2027', days: [{ date: 'd', route: 'r' }] }).notes.join()).not.toContain('年份')
  })

  it('asks the model for the full dated departure and tells it the file name', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    const f = vi.fn(async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_confirmation', input: {} }] }), { status: 200 })) as unknown as typeof fetch
    await callExtractModel({ kind: 'text', text: 'x', filename: 'CTS4270729.docx' }, f)
    const body = JSON.parse((vi.mocked(f).mock.calls[0][1] as RequestInit).body as string)
    expect(body.system).toContain('including the year')
    expect(body.messages[0].content[0].text).toContain('CTS4270729.docx')
  })
})
