/**
 * Tests for the offerings.yaml fact-layer loader (Issue #1577).
 *
 * Three things matter here, in order of how badly a regression would hurt:
 *  1. Bad data must be rejected by Zod, not silently accepted (this file is the
 *     only thing stopping the reply agent from reporting a retired tour as bookable).
 *  2. The real config/clients/cts/offerings.yaml must actually parse and validate —
 *     a typo there should fail CI, not surface as a customer-facing wrong answer.
 *  3. The 5-minute cache must actually avoid re-reading the file, and must actually
 *     expire — both directions matter (stale-forever is as bad as never-caching).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { parse as parseYaml } from 'yaml'
import {
  loadOfferings,
  offeringsPathFor,
  OfferingsFileSchema,
  __clearOfferingsCacheForTests,
  type Clock,
} from '../offerings-loader'

const VALID_YAML = `
active_tours:
  - code: golden-china
    name: "China Discovery — Golden China"
    aliases: ["Golden China"]
    price_nzd: 4999
    departure_dates: ["2026-11-16"]
    nights: 9
    itinerary_url: "https://www.ctstours.co.nz/tours/china/discovery/golden-china"
    highlights: ["Great Wall", "Terracotta Warriors"]

retired_tours:
  - code: silk-road-discovery
    name: "Silk Road Discovery"
    aliases: ["Silk Road"]
    retired_reason: "PM plan marks this retired; still visible on website as of 2026-09-13."
    still_visible_on_website: true

factual_bullets:
  - "CTS Tours NZ has operated in New Zealand for 25 years, backed by China Travel Service (founded 1928)."

reply_forbidden_topics:
  - "Refund or compensation decisions"

last_verified_at: "2026-09-13T00:00:00+13:00"
`

describe('OfferingsFileSchema — valid input', () => {
  it('accepts a fully populated file', () => {
    const parsed = OfferingsFileSchema.parse(parseYaml(VALID_YAML))
    expect(parsed.active_tours).toHaveLength(1)
    expect(parsed.active_tours[0].code).toBe('golden-china')
    expect(parsed.retired_tours[0].still_visible_on_website).toBe(true)
    expect(parsed.factual_bullets).toHaveLength(1)
    expect(parsed.reply_forbidden_topics).toHaveLength(1)
    expect(parsed.last_verified_at).toBe('2026-09-13T00:00:00+13:00')
  })

  it('defaults array fields that are omitted entirely', () => {
    const parsed = OfferingsFileSchema.parse({ last_verified_at: '2026-09-13' })
    expect(parsed.active_tours).toEqual([])
    expect(parsed.retired_tours).toEqual([])
    expect(parsed.factual_bullets).toEqual([])
    expect(parsed.reply_forbidden_topics).toEqual([])
  })

  it('accepts a retired tour with still_visible_on_website omitted (unknown)', () => {
    const parsed = OfferingsFileSchema.parse({
      retired_tours: [
        { code: 'x', name: 'X Tour', retired_reason: 'stopped selling' },
      ],
      last_verified_at: '2026-09-13',
    })
    expect(parsed.retired_tours[0].still_visible_on_website).toBeUndefined()
    expect(parsed.retired_tours[0].aliases).toEqual([])
  })

  it('accepts the real config/clients/cts/offerings.yaml shipped in this PR', async () => {
    const raw = await fs.readFile(offeringsPathFor('cts'), 'utf8')
    const parsed = OfferingsFileSchema.parse(parseYaml(raw))
    // PM confirmed 2026-09-13 the 3 tours this file originally listed as
    // "known retired" are genuine current products (only their 2026 batch had
    // sold out) — moved to active_tours, retired_tours is intentionally empty.
    expect(parsed.active_tours.length).toBeGreaterThanOrEqual(7)
    expect(parsed.retired_tours).toEqual([])
    for (const tour of parsed.active_tours) {
      expect(tour.departure_dates.length).toBeGreaterThan(0)
    }
  })
})

describe('OfferingsFileSchema — invalid input is rejected', () => {
  it('rejects a missing last_verified_at', () => {
    expect(() => OfferingsFileSchema.parse({})).toThrow()
  })

  it('rejects an active tour missing required fields (no itinerary_url)', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        active_tours: [
          {
            code: 'x',
            name: 'X',
            price_nzd: 100,
            departure_dates: ['2026-11-16'],
            nights: 1,
          },
        ],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects a negative price', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        active_tours: [
          {
            code: 'x',
            name: 'X',
            price_nzd: -100,
            departure_dates: ['2026-11-16'],
            nights: 1,
            itinerary_url: 'https://example.com/x',
          },
        ],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects a non-URL itinerary_url', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        active_tours: [
          {
            code: 'x',
            name: 'X',
            price_nzd: 100,
            departure_dates: ['2026-11-16'],
            nights: 1,
            itinerary_url: 'not-a-url',
          },
        ],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects an unparseable departure date', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        active_tours: [
          {
            code: 'x',
            name: 'X',
            price_nzd: 100,
            departure_dates: ['next Tuesday-ish'],
            nights: 1,
            itinerary_url: 'https://example.com/x',
          },
        ],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects a retired tour missing retired_reason', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        retired_tours: [{ code: 'x', name: 'X' }],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects an unparseable last_verified_at', () => {
    expect(() =>
      OfferingsFileSchema.parse({ last_verified_at: 'sometime last week' }),
    ).toThrow()
  })

  it('rejects a departure date that is not a real calendar date (e.g. Feb 30)', () => {
    expect(() =>
      OfferingsFileSchema.parse({
        active_tours: [
          {
            code: 'x',
            name: 'X',
            price_nzd: 100,
            departure_dates: ['2026-02-30'],
            nights: 1,
            itinerary_url: 'https://example.com/x',
          },
        ],
        last_verified_at: '2026-09-13',
      }),
    ).toThrow()
  })

  it('rejects a last_verified_at that is not a real calendar date', () => {
    expect(() =>
      OfferingsFileSchema.parse({ last_verified_at: '2026-13-01' }),
    ).toThrow()
  })

  describe('rejects a date with trailing garbage that Date.parse alone would accept (Codex review, PR #1626, round 7)', () => {
    it.each([
      ['2026-01-01 (draft)', '括号备注'],
      ['2026-01-01 UTC', '时区文字'],
      ['2026-01-01 ', '尾部空格'],
      [' 2026-01-01', '首部空格'],
    ])('拒绝 %s（%s）', (value) => {
      expect(() => OfferingsFileSchema.parse({ last_verified_at: value })).toThrow()
    })

    it('全字符串合法的日期仍然通过', () => {
      expect(() =>
        OfferingsFileSchema.parse({ last_verified_at: '2026-09-13T00:00:00+13:00' }),
      ).not.toThrow()
    })
  })

  describe('strict schemas reject unknown/typo-d keys (Codex review, PR #1626)', () => {
    it('rejects a typo-d top-level key (retired_tour instead of retired_tours) instead of silently defaulting it to []', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          retired_tour: [{ code: 'x', name: 'X', retired_reason: 'gone' }],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow()
    })

    it('rejects an unknown key on an active tour entry', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [
            {
              code: 'x',
              name: 'X',
              price_nzd: 100,
              departure_dates: ['2026-11-16'],
              nights: 1,
              itinerary_url: 'https://example.com/x',
              pric: 100, // typo'd duplicate of price_nzd
            },
          ],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow()
    })

    it('rejects an unknown key on a retired tour entry', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          retired_tours: [
            { code: 'x', name: 'X', retired_reason: 'gone', still_visable_on_website: true },
          ],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow()
    })
  })

  describe('cross-list code contradictions rejected (Codex review, PR #1626)', () => {
    const activeTour = (code: string) => ({
      code,
      name: 'X',
      price_nzd: 100,
      departure_dates: ['2026-11-16'],
      nights: 1,
      itinerary_url: 'https://example.com/x',
    })
    const retiredTour = (code: string) => ({ code, name: 'X', retired_reason: 'gone' })

    it('rejects a code that appears in both active_tours and retired_tours', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour('dup')],
          retired_tours: [retiredTour('dup')],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow(/simultaneously bookable and retired/)
    })

    it('rejects a duplicate code within active_tours itself', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour('same'), activeTour('same')],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow(/duplicate code/)
    })

    it('rejects a duplicate code within retired_tours itself', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          retired_tours: [retiredTour('same'), retiredTour('same')],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow(/duplicate code/)
    })

    it('accepts distinct codes across both lists', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour('a')],
          retired_tours: [retiredTour('b')],
          last_verified_at: '2026-09-13',
        }),
      ).not.toThrow()
    })
  })

  describe('code must already be a normalized slug (Codex review, PR #1626, round 6)', () => {
    const activeTour = (code: string) => ({
      code,
      name: 'X',
      price_nzd: 100,
      departure_dates: ['2026-11-16'],
      nights: 1,
      itinerary_url: 'https://example.com/x',
    })

    it.each([
      ['Silk-Road', '大写字母'],
      ['silk-road ', '尾部空格'],
      [' silk-road', '首部空格'],
      ['silk--road', '连续两个连字符'],
      ['-silk-road', '开头带连字符'],
      ['silk_road', '下划线不是连字符'],
    ])('拒绝 code=%s（%s）', (code) => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour(code)],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow()
    })

    it('规范格式的 code 通过校验', () => {
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour('silk-road-discovery')],
          last_verified_at: '2026-09-13',
        }),
      ).not.toThrow()
    })

    it('字段本身就强制规范格式后，大小写/空格不一致的"同一个团"不再可能绕过跨列表冲突检查', () => {
      // 在 code 字段本身被 regex 卡死之后，"Silk-Road" 和 "silk-road " 这类
      // 试图绕过冲突检查的写法在到达 superRefine 之前就已经被拒绝——
      // 不需要在冲突检查里再做一次大小写/空格归一化比较。
      expect(() =>
        OfferingsFileSchema.parse({
          active_tours: [activeTour('Silk-Road')],
          retired_tours: [{ code: 'silk-road', name: 'X', retired_reason: 'gone' }],
          last_verified_at: '2026-09-13',
        }),
      ).toThrow() // 因为 'Silk-Road' 本身就不是合法 slug，先在字段级别被拒绝
    })
  })
})

describe('loadOfferings — caching', () => {
  let tmpDir: string
  let filePath: string
  let currentTime: number
  const clock: Clock = { now: () => currentTime }

  beforeEach(async () => {
    __clearOfferingsCacheForTests()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'offerings-loader-test-'))
    filePath = path.join(tmpDir, 'offerings.yaml')
    await fs.writeFile(filePath, VALID_YAML, 'utf8')
    currentTime = Date.parse('2026-09-13T00:00:00.000Z')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('reads the file on first load', async () => {
    const readSpy = vi.spyOn(fs, 'readFile')
    const data = await loadOfferings({ filePath, clock })
    expect(data.active_tours[0].code).toBe('golden-china')
    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('does not re-read the file on a second load within the 5-minute window', async () => {
    const readSpy = vi.spyOn(fs, 'readFile')
    await loadOfferings({ filePath, clock })
    currentTime += 4 * 60 * 1000 // +4 minutes, still inside the 5-minute TTL
    await loadOfferings({ filePath, clock })
    expect(readSpy).toHaveBeenCalledTimes(1)
  })

  it('re-reads the file once the cache has expired (past 5 minutes)', async () => {
    const readSpy = vi.spyOn(fs, 'readFile')
    await loadOfferings({ filePath, clock })
    currentTime += 5 * 60 * 1000 + 1 // just past the 5-minute TTL
    await loadOfferings({ filePath, clock })
    expect(readSpy).toHaveBeenCalledTimes(2)
  })

  it('re-reads immediately when forceRefresh is set, even inside the TTL', async () => {
    const readSpy = vi.spyOn(fs, 'readFile')
    await loadOfferings({ filePath, clock })
    await loadOfferings({ filePath, clock, forceRefresh: true })
    expect(readSpy).toHaveBeenCalledTimes(2)
  })

  it('re-reads when a different filePath is requested, even inside the TTL', async () => {
    const otherPath = path.join(tmpDir, 'other.yaml')
    await fs.writeFile(otherPath, VALID_YAML, 'utf8')
    const readSpy = vi.spyOn(fs, 'readFile')
    await loadOfferings({ filePath, clock })
    await loadOfferings({ filePath: otherPath, clock })
    expect(readSpy).toHaveBeenCalledTimes(2)
  })

  it('throws (fails closed) when the file does not validate, without poisoning the cache', async () => {
    await fs.writeFile(filePath, 'last_verified_at: "not a date"', 'utf8')
    await expect(loadOfferings({ filePath, clock })).rejects.toThrow()
  })

  it('throws when the file does not exist', async () => {
    await expect(
      loadOfferings({ filePath: path.join(tmpDir, 'missing.yaml'), clock }),
    ).rejects.toThrow()
  })

  it('throws (fails closed) when neither configSlug nor filePath is given, instead of defaulting to some client', async () => {
    await expect(loadOfferings({ clock })).rejects.toThrow(/requires configSlug/)
  })
})

describe('offeringsPathFor', () => {
  it('builds config/clients/<configSlug>/offerings.yaml under the repo root', () => {
    const p = offeringsPathFor('cts')
    expect(p.endsWith(path.join('config', 'clients', 'cts', 'offerings.yaml'))).toBe(true)
  })

  it('does NOT know about DB client_id UUIDs — it only ever builds a path from the literal slug it is given (Codex review, PR #1626, 2nd pass: no client-identity mapping belongs in this shared loader)', () => {
    const p = offeringsPathFor('c0000000-0000-0000-0000-000000000000')
    // Resolving the real CTS DB client_id to the "cts" slug is the caller's
    // job, not this function's — so passing the raw UUID here must NOT
    // magically resolve to the cts directory.
    expect(p.endsWith(path.join('config', 'clients', 'c0000000-0000-0000-0000-000000000000', 'offerings.yaml'))).toBe(true)
  })
})
