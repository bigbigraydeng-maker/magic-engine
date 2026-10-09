import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  buildCatalogIndex,
  checkProposal,
  normaliseDeparturePatchKeys,
  normaliseNewDepartureKeys,
  normalisePatchKeys,
  runAssistant,
  tourDetail,
} from '../assistant'
import type { AssistantDeps } from '../assistant'
import type { CatalogSnapshot } from '../store'
import type { CatalogDeparture, CatalogTour } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'china-panorama',
    destination: 'China',
    tier: 'signature',
    name: 'China Panorama',
    title: 'China Panorama 2027',
    shortDescription: 'A grand tour of China.',
    durationText: '20 days',
    displayPriceText: 'From NZD $4,999 per person',
    highlights: ['Great Wall'],
    itinerary: [
      { day: 1, title: 'Arrive Beijing', description: 'Arrival.' },
      { day: 2, title: 'Forbidden City', description: 'Tour.' },
    ],
    inclusions: ['Flights'],
    exclusions: ['Tips'],
    tourCities: ['Beijing'],
    singleSupplement: 'NZD $1,200',
    maxGroupSize: 20,
    isActive: true,
    managesDepartures: true,
    sortOrder: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeDeparture(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'dep-1',
    tourId: 'tour-1',
    clientId: 'client-1',
    departOn: '2027-03-01',
    returnOn: '2027-03-20',
    priceTextOverride: null,
    status: 'open',
    internal: { airline: 'Air NZ', capacity: 20 },
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSnapshot(): CatalogSnapshot {
  return {
    tours: [makeTour()],
    departures: [makeDeparture()],
    aliases: [],
  }
}

/** Build a tour whose itinerary has `n` consecutive days with distinct titles. */
function makeItinerary(n: number): CatalogTour['itinerary'] {
  return Array.from({ length: n }, (_, i) => ({
    day: i + 1,
    title: `Day ${i + 1}`,
    description: `Desc ${i + 1}`,
  }))
}

// ---------------------------------------------------------------------------
// buildCatalogIndex / tourDetail
// ---------------------------------------------------------------------------

describe('buildCatalogIndex', () => {
  it('never includes internal fields', () => {
    const index = buildCatalogIndex(makeSnapshot())
    expect(index).not.toContain('internal')
    expect(index).not.toContain('Air NZ')
    expect(index).toContain('China Panorama')
    expect(index).toContain('1. Arrive Beijing')
    expect(index).toContain('dep-1')
  })
})

describe('tourDetail', () => {
  it('returns full tour JSON without clientId', () => {
    const detail = tourDetail(makeSnapshot(), 'tour-1')
    expect(detail).not.toBeNull()
    const parsed = JSON.parse(detail as string) as Record<string, unknown>
    expect(parsed.clientId).toBeUndefined()
    expect(parsed.name).toBe('China Panorama')
    expect(parsed.itinerary).toBeDefined()
  })

  it('returns null for an unknown tour', () => {
    expect(tourDetail(makeSnapshot(), 'nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// normalisePatchKeys
// ---------------------------------------------------------------------------

describe('normalisePatchKeys', () => {
  it('maps price aliases to displayPriceText', () => {
    expect(normalisePatchKeys({ price: 'NZD $1' })).toEqual({ displayPriceText: 'NZD $1' })
    expect(normalisePatchKeys({ display_price: 'x' })).toEqual({ displayPriceText: 'x' })
    expect(normalisePatchKeys({ display_price_text: 'x' })).toEqual({ displayPriceText: 'x' })
    expect(normalisePatchKeys({ displayPrice: 'x' })).toEqual({ displayPriceText: 'x' })
  })

  it('maps duration aliases to durationText', () => {
    expect(normalisePatchKeys({ duration: '10 days' })).toEqual({ durationText: '10 days' })
    expect(normalisePatchKeys({ duration_text: '10 days' })).toEqual({ durationText: '10 days' })
    expect(normalisePatchKeys({ days: '10 days' })).toEqual({ durationText: '10 days' })
  })

  it('maps other documented aliases', () => {
    expect(normalisePatchKeys({ short_description: 'x' })).toEqual({ shortDescription: 'x' })
    expect(normalisePatchKeys({ description: 'x' })).toEqual({ shortDescription: 'x' })
    expect(normalisePatchKeys({ single_supplement: 'x' })).toEqual({ singleSupplement: 'x' })
    expect(normalisePatchKeys({ singleRoomSupplement: 'x' })).toEqual({ singleSupplement: 'x' })
    expect(normalisePatchKeys({ max_group_size: 10 })).toEqual({ maxGroupSize: 10 })
    expect(normalisePatchKeys({ maxGroup: 10 })).toEqual({ maxGroupSize: 10 })
    expect(normalisePatchKeys({ groupSize: 10 })).toEqual({ maxGroupSize: 10 })
    expect(normalisePatchKeys({ is_active: true })).toEqual({ isActive: true })
    expect(normalisePatchKeys({ active: true })).toEqual({ isActive: true })
    expect(normalisePatchKeys({ manages_departures: true })).toEqual({ managesDepartures: true })
    expect(normalisePatchKeys({ tour_cities: ['Beijing'] })).toEqual({ tourCities: ['Beijing'] })
    expect(normalisePatchKeys({ cities: ['Beijing'] })).toEqual({ tourCities: ['Beijing'] })
  })

  it('leaves unknown keys untouched', () => {
    expect(normalisePatchKeys({ colour: 'red' })).toEqual({ colour: 'red' })
  })

  it('keeps canonical keys as-is', () => {
    expect(normalisePatchKeys({ name: 'X', displayPriceText: 'y' })).toEqual({
      name: 'X',
      displayPriceText: 'y',
    })
  })
})

describe('normaliseDeparturePatchKeys', () => {
  it('maps return_on and price aliases', () => {
    expect(normaliseDeparturePatchKeys({ return_on: '2027-01-01' })).toEqual({
      returnOn: '2027-01-01',
    })
    expect(normaliseDeparturePatchKeys({ price: 'NZD $1' })).toEqual({
      priceTextOverride: 'NZD $1',
    })
    expect(normaliseDeparturePatchKeys({ price_text_override: 'NZD $1' })).toEqual({
      priceTextOverride: 'NZD $1',
    })
  })
})

describe('normaliseNewDepartureKeys', () => {
  it('maps depart_on and return_on', () => {
    expect(normaliseNewDepartureKeys({ depart_on: '2027-01-01' })).toEqual({
      departOn: '2027-01-01',
    })
    expect(normaliseNewDepartureKeys({ return_on: '2027-01-02' })).toEqual({
      returnOn: '2027-01-02',
    })
  })
})

// ---------------------------------------------------------------------------
// checkProposal
// ---------------------------------------------------------------------------

describe('checkProposal', () => {
  it('accepts a valid tour patch', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改名字',
      patch: { name: 'China Panorama Deluxe' },
    })
    expect(result).not.toBeNull()
    expect(result?.check.ok).toBe(true)
    expect(result?.proposal.kind).toBe('update_tour')
  })

  it('normalises { price } to displayPriceText and validates ok', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改价格',
      patch: { price: 'From NZD $8,599 per person' },
    })
    expect(result?.check.ok).toBe(true)
    if (result && result.proposal.kind === 'update_tour') {
      expect(result.proposal.patch.displayPriceText).toBe('From NZD $8,599 per person')
    }
  })

  it('normalises { return_on } for a departure patch', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_departure',
      tourId: 'tour-1',
      departureId: 'dep-1',
      summary: '改回程日',
      patch: { return_on: '2027-01-01' },
    })
    expect(result?.check.ok).toBe(true)
    if (result && result.proposal.kind === 'update_departure') {
      expect(result.proposal.patch.returnOn).toBe('2027-01-01')
    }
  })

  it('still rejects an unknown key like colour', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改颜色',
      patch: { colour: 'red' },
    })
    expect(result?.check.ok).toBe(false)
    if (result && !result.check.ok) {
      expect(result.check.errors.some((e) => e.field === 'colour')).toBe(true)
    }
  })

  it('rejects an invalid price', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改价格',
      patch: { displayPriceText: 'cheap' },
    })
    expect(result?.check.ok).toBe(false)
    if (result && !result.check.ok) {
      expect(result.check.errors[0].field).toBe('displayPriceText')
    }
  })

  it('reports an unknown tour', () => {
    const result = checkProposal(makeSnapshot(), {
      kind: 'update_tour',
      tourId: 'nope',
      summary: 'x',
      patch: { name: 'X' },
    })
    expect(result?.check.ok).toBe(false)
    if (result && !result.check.ok) {
      expect(result.check.errors[0]).toEqual({ field: 'tourId', code: 'tour_not_found' })
    }
  })

  it('reports a departure belonging to another tour', () => {
    const snapshot = makeSnapshot()
    snapshot.tours.push(makeTour({ id: 'tour-2', name: 'Other' }))
    const result = checkProposal(snapshot, {
      kind: 'update_departure',
      tourId: 'tour-2',
      departureId: 'dep-1',
      summary: 'x',
      patch: { status: 'closed' },
    })
    expect(result?.check.ok).toBe(false)
    if (result && !result.check.ok) {
      expect(result.check.errors[0]).toEqual({ field: 'departureId', code: 'departure_not_found' })
    }
  })

  it('returns null for an unknown kind', () => {
    expect(checkProposal(makeSnapshot(), { kind: 'delete_tour', tourId: 'tour-1' })).toBeNull()
  })

  it('returns null for a non-object', () => {
    expect(checkProposal(makeSnapshot(), 'nope')).toBeNull()
  })

  it('warns when the itinerary shrinks', () => {
    const snapshot = makeSnapshot()
    snapshot.tours[0] = makeTour({ itinerary: makeItinerary(10) })
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '缩短行程',
      patch: { itinerary: makeItinerary(5) },
    })
    expect(result?.check.ok).toBe(true)
    if (result && result.check.ok) {
      expect(result.check.warnings).toEqual([
        { code: 'itinerary_shrinks', from: 10, to: 5 },
      ])
    }
  })

  it('warns when most itinerary titles change at the same length', () => {
    const snapshot = makeSnapshot()
    snapshot.tours[0] = makeTour({ itinerary: makeItinerary(4) })
    const next = makeItinerary(4).map((d, i) =>
      i < 3 ? { ...d, title: `New ${d.day}` } : d,
    )
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改标题',
      patch: { itinerary: next },
    })
    expect(result?.check.ok).toBe(true)
    if (result && result.check.ok) {
      expect(result.check.warnings).toEqual([
        { code: 'itinerary_mostly_changed', changed: 3, total: 4 },
      ])
    }
  })

  it('emits no warning when only one of four titles changes', () => {
    const snapshot = makeSnapshot()
    snapshot.tours[0] = makeTour({ itinerary: makeItinerary(4) })
    const next = makeItinerary(4).map((d, i) =>
      i === 0 ? { ...d, title: `New ${d.day}` } : d,
    )
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: '改一天标题',
      patch: { itinerary: next },
    })
    expect(result?.check.ok).toBe(true)
    if (result && result.check.ok) {
      expect(result.check.warnings).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// runAssistant
// ---------------------------------------------------------------------------

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
  } as Anthropic.Message
}

function toolMessage(
  name: string,
  input: unknown,
  stopReason: Anthropic.Message['stop_reason'] = 'tool_use',
): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'tool_use', id: 'tu-1', name, input }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 500 },
  } as Anthropic.Message
}

function depsFrom(responses: Anthropic.Message[]): {
  deps: AssistantDeps
  calls: Anthropic.MessageCreateParamsNonStreaming[]
} {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
  let i = 0
  const createMessage = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params)
    const response = responses[i]
    i++
    if (!response) throw new Error('no more canned responses')
    return response
  })
  return { deps: { createMessage }, calls }
}

const baseInput = {
  snapshot: makeSnapshot(),
  history: [],
  message: '把团名改成 China Panorama Deluxe',
  today: '2026-10-09',
}

describe('runAssistant', () => {
  it('returns a text-only reply', async () => {
    const { deps } = depsFrom([textMessage('请问是哪个团？')])
    const result = await runAssistant(baseInput, deps)
    expect(result.reply).toBe('请问是哪个团？')
    expect(result.proposals).toEqual([])
    expect(result.ignoredCount).toBe(0)
  })

  it('resolves get_tour_detail then returns validated proposals', async () => {
    const { deps, calls } = depsFrom([
      toolMessage('get_tour_detail', { tourId: 'tour-1' }),
      toolMessage('propose_changes', {
        reply: '已提交两条改动',
        proposals: [
          {
            kind: 'update_tour',
            tourId: 'tour-1',
            summary: '改名字',
            patch: { name: 'China Panorama Deluxe' },
          },
          {
            kind: 'update_tour',
            tourId: 'tour-1',
            summary: '改价格',
            patch: { displayPriceText: 'cheap' },
          },
        ],
      }),
    ])

    const result = await runAssistant(baseInput, deps)

    expect(result.reply).toBe('已提交两条改动')
    expect(result.proposals).toHaveLength(2)
    expect(result.proposals[0].check.ok).toBe(true)
    expect(result.proposals[1].check.ok).toBe(false)
    expect(result.ignoredCount).toBe(0)

    // Second call must carry the tool_result with the tour JSON.
    const secondMessages = calls[1].messages
    const toolResult = secondMessages.find(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
    )
    expect(toolResult).toBeDefined()
    const blocks = toolResult?.content as Anthropic.ToolResultBlockParam[]
    expect(blocks[0].content).toContain('China Panorama')
  })

  it('counts unrecognisable proposals as ignoredCount', async () => {
    const { deps } = depsFrom([
      toolMessage('propose_changes', {
        reply: '已提交',
        proposals: [
          {
            kind: 'update_tour',
            tourId: 'tour-1',
            summary: '改名字',
            patch: { name: 'China Panorama Deluxe' },
          },
          { kind: 'delete_tour', tourId: 'tour-1', summary: '删团' },
        ],
      }),
    ])

    const result = await runAssistant(baseInput, deps)

    expect(result.proposals).toHaveLength(1)
    expect(result.ignoredCount).toBe(1)
  })

  it('throws on max_tokens truncation', async () => {
    const { deps } = depsFrom([toolMessage('propose_changes', {}, 'max_tokens')])
    await expect(runAssistant(baseInput, deps)).rejects.toThrow('assistant_truncated')
  })

  it('throws when no final result after 4 iterations', async () => {
    const { deps } = depsFrom([
      toolMessage('get_tour_detail', { tourId: 'tour-1' }),
      toolMessage('get_tour_detail', { tourId: 'tour-1' }),
      toolMessage('get_tour_detail', { tourId: 'tour-1' }),
      toolMessage('get_tour_detail', { tourId: 'tour-1' }),
    ])
    await expect(runAssistant(baseInput, deps)).rejects.toThrow('assistant_no_result')
  })

  it('computes costUsd from token usage', async () => {
    const { deps } = depsFrom([textMessage('好的')])
    const result = await runAssistant(baseInput, deps)
    // 1000 input * 3 + 500 output * 15 = 3000 + 7500 = 10500 / 1e6
    expect(result.costUsd).toBeCloseTo(0.0105, 6)
  })

  it('sends a system prompt that says 准备把 and forbids 已把', async () => {
    const { deps, calls } = depsFrom([textMessage('好的')])
    await runAssistant(baseInput, deps)
    const system = calls[0].system as string
    expect(system).toContain('准备把')
    expect(system).toContain('已把')
  })

  it('sends a propose_changes schema that documents displayPriceText', async () => {
    const { deps, calls } = depsFrom([textMessage('好的')])
    await runAssistant(baseInput, deps)
    const tools = calls[0].tools as Anthropic.Tool[]
    const propose = tools.find((t) => t.name === 'propose_changes')
    expect(propose).toBeDefined()
    expect(JSON.stringify(propose)).toContain('displayPriceText')
  })
})

function makeMessage(content: Anthropic.ContentBlock[]): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Anthropic.Message
}

describe('runAssistant — two tour detail requests in one reply', () => {
  it('answers every tool call before the next round', async () => {
    const snapshot = makeSnapshot()
    const tourA = snapshot.tours[0]
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
    const createMessage = async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
      calls.push(params)
      if (calls.length === 1) {
        return makeMessage([
          { type: 'tool_use', id: 'u1', name: 'get_tour_detail', input: { tourId: tourA.id } },
          { type: 'tool_use', id: 'u2', name: 'get_tour_detail', input: { tourId: 'missing' } },
        ])
      }
      return makeMessage([{ type: 'tool_use', id: 'u3', name: 'propose_changes', input: { reply: '好', proposals: [] } }])
    }
    const result = await runAssistant({ snapshot, history: [], message: '两个团', today: '2026-10-10' }, { createMessage })
    expect(result.reply).toBe('好')
    const last = calls[1].messages[calls[1].messages.length - 1]
    const content = last.content as Anthropic.ToolResultBlockParam[]
    expect(content.map((c) => c.tool_use_id)).toEqual(['u1', 'u2'])
    expect(String(content[1].content)).toContain('tour_not_found')
  })
})
