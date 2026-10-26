/**
 * Regression tests for parseRanking grounding (2026-09-20 audit).
 *
 * Each fixture is a condensed excerpt of a real ai_visibility_runs row whose
 * client_brand_rank was wrong in production; row ids are kept for traceability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BrandMention } from '@/types/magic-engine'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: vi.fn(() => ({ chat: { completions: { create: mocks.create } } })),
}))

import { parseRanking } from '../parser'

function modelReturns(brands: BrandMention[]): void {
  mocks.create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ brands }) } }],
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
  })
}

function sentUserMessage(): string {
  const args = mocks.create.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }
  return args.messages.find(m => m.role === 'user')?.content ?? ''
}

beforeEach(() => mocks.create.mockReset())

describe('parseRanking — false positives (rank set without evidence)', () => {
  it('36674281: parser echoed the injected client name into an answer that never mentions it', async () => {
    const raw =
      'Shipping products from China to New Zealand for your small business involves ' +
      'understanding shipping methods, costs and customs. Major carriers include DHL, UPS, ' +
      'and FedEx. GST is calculated on the total of cost, freight and insurance.'
    modelReturns([
      { brand: 'DHL', rank: 1, snippet: 'Major carriers include DHL, UPS, and FedEx.' },
      { brand: 'UPS', rank: 2, snippet: 'Major carriers include DHL, UPS, and FedEx.' },
      { brand: 'FedEx', rank: 3, snippet: 'Major carriers include DHL, UPS, and FedEx.' },
      { brand: 'Newasian Logistics', rank: 4, snippet: 'Client brand to look for Newasian Logistics' },
    ])

    const out = await parseRanking({
      rawResponse: raw,
      clientBrandName: 'Newasian Logistics',
      clientDomain: 'nalexpress.com',
      clientAliases: ['New Asian Logistics', 'NAL Express', 'nalexpress'],
    })

    expect(out.client_brand_rank).toBeNull()
    expect(out.brands.map(b => b.brand)).toEqual(['DHL', 'UPS', 'FedEx'])
  })

  it('6881dbee: "Ray White" must not claim composite client name "Roman Hu — Ray White Mission Bay"', async () => {
    const raw =
      'Here are a few Ray White agents who cover Mission Bay and the surrounding Eastern Bays ' +
      'suburbs in Auckland. These agents are part of the Ray White Five AM Bayside team. ' +
      '([raywhite.co.nz](https://www.raywhite.co.nz/office/missionbay.nz))'
    modelReturns([
      { brand: 'Ray White', rank: 1, snippet: 'part of the Ray White Five AM Bayside team', url: 'https://www.raywhite.co.nz/office/missionbay.nz' },
    ])

    const out = await parseRanking({
      rawResponse: raw,
      clientBrandName: 'Roman Hu — Ray White Mission Bay',
      clientDomain: 'romanhu.com',
      clientAliases: [],
    })

    expect(out.client_brand_rank).toBeNull()
    expect(out.brands).toHaveLength(1)
  })

  it('does not send the client brand name to the model', async () => {
    modelReturns([])
    await parseRanking({
      rawResponse: 'A long enough answer that mentions nobody in particular at all, really.',
      clientBrandName: 'Newasian Logistics',
    })
    const msg = sentUserMessage()
    expect(msg).not.toContain('Newasian Logistics')
    expect(msg).not.toContain('Client brand to look for')
  })
})

describe('parseRanking — false negatives (client present, rank null)', () => {
  it('680862a7: client cited only via its domain links', async () => {
    const raw =
      'Beijing is the home of dynasties ([eastasiaexplorer.com](https://eastasiaexplorer.com/b)). ' +
      'Shanghai is modern and fast-moving ([go2-china.com](https://go2-china.com/blog/x)). ' +
      'Always double-check official sources ([ctstours.co.nz](https://www.ctstours.co.nz/blog/first-trip-china)). ' +
      'Many tours combine both ([ctstours.co.nz](https://www.ctstours.co.nz/blog/first-trip-china)).'
    modelReturns([
      { brand: 'eastasiaexplorer.com', rank: 1, snippet: 'home of dynasties' },
      { brand: 'go2-china.com', rank: 2, snippet: 'modern and fast-moving' },
      { brand: 'ctstours.co.nz', rank: 3, snippet: 'Always double-check official sources', url: 'https://www.ctstours.co.nz/blog/first-trip-china' },
    ])

    const out = await parseRanking({
      rawResponse: raw,
      clientBrandName: 'CTS Tours',
      clientDomain: 'ctstours.co.nz',
      clientAliases: ['cts', 'cts tours', 'china travel service'],
    })

    expect(out.client_brand_rank).toBe(3)
  })

  it('56d9067f: client listed in a table with different punctuation than the configured name', async () => {
    const raw =
      '| Agent | Why |\n|---|---|\n' +
      '| **Barfoot & Thompson** | Largest local market share. |\n' +
      '| **Lesley Harris (Ray White St Heliers)** | Deep local roots. |\n' +
      '| **Roman Hu (Ray White Mission Bay)** | Trilingual skills ([romanhu.com](https://romanhu.com/blog/x)) |'
    modelReturns([
      { brand: 'Barfoot & Thompson', rank: 1, snippet: 'Largest local market share.' },
      { brand: 'Lesley Harris (Ray White St Heliers)', rank: 2, snippet: 'Deep local roots.' },
      { brand: 'Roman Hu (Ray White Mission Bay)', rank: 3, snippet: 'Trilingual skills' },
    ])

    const out = await parseRanking({
      rawResponse: raw,
      clientBrandName: 'Roman Hu — Ray White Mission Bay',
      clientDomain: 'romanhu.com',
      clientAliases: [],
    })

    expect(out.client_brand_rank).toBe(3)
  })

  it('client in text but missed by the parser is inserted at its textual position', async () => {
    const raw =
      'Top picks: Barfoot & Thompson for market share, then Roman Hu for trilingual service, ' +
      'and finally Bayleys for premium marketing.'
    modelReturns([
      { brand: 'Barfoot & Thompson', rank: 1, snippet: 'Barfoot & Thompson for market share' },
      { brand: 'Bayleys', rank: 2, snippet: 'Bayleys for premium marketing' },
    ])

    const out = await parseRanking({
      rawResponse: raw,
      clientBrandName: 'Roman Hu — Ray White Mission Bay',
      clientDomain: 'romanhu.com',
    })

    expect(out.client_brand_rank).toBe(2)
    expect(out.brands.map(b => [b.brand, b.rank])).toEqual([
      ['Barfoot & Thompson', 1],
      ['Roman Hu — Ray White Mission Bay', 2],
      ['Bayleys', 3],
    ])
  })
})

describe('parseRanking — no-client mode', () => {
  it('empty clientBrandName never sets a rank and keeps all brands', async () => {
    modelReturns([{ brand: 'None Travel', rank: 1, snippet: 'None Travel is great' }])
    const out = await parseRanking({
      rawResponse: 'None Travel is great for none of the reasons you think, honestly.',
      clientBrandName: '',
    })
    expect(out.client_brand_rank).toBeNull()
    expect(out.brands).toHaveLength(1)
  })
})

describe('parseRanking — an answer too short to score', () => {
  // A refused or truncated completion reaches here as '' with the runner's
  // error_message still null. Returning an empty ranking would store it as
  // "the AI named nobody" — a real zero — and it would land in the
  // mention-rate denominator. Throwing routes it to parse_error_message
  // instead, where run-conclusive.ts can reject it.
  it('throws on an empty response instead of returning an empty ranking', async () => {
    await expect(
      parseRanking({ rawResponse: '', clientBrandName: 'CTS Tours' })
    ).rejects.toThrow(/too short to parse/)
  })

  it('throws on a response under the 30-character floor', async () => {
    await expect(
      parseRanking({ rawResponse: 'I cannot help.', clientBrandName: 'CTS Tours' })
    ).rejects.toThrow(/nothing was measured/)
  })

  it('still parses an answer that clears the floor', async () => {
    modelReturns([{ brand: 'CTS Tours', rank: 1, snippet: 'CTS Tours runs NZ coach tours' }])
    const out = await parseRanking({
      rawResponse: 'CTS Tours runs guided coach tours all over New Zealand.',
      clientBrandName: 'CTS Tours',
    })
    expect(out.client_brand_rank).toBe(1)
  })
})
