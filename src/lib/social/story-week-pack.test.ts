import { describe, expect, it } from 'vitest'

import { draftStoryWeekPack } from './story-week-pack'

const NOW = new Date('2026-11-12T00:00:00.000Z')
const SHA = 'ab'.repeat(32)

describe('draftStoryWeekPack', () => {
  it('does not insert a pack when no 9:16 still is ready', async () => {
    const inserts: string[] = []
    const receipt = await draftStoryWeekPack('c1', { social_week: { story_per_week: 2 } }, NOW, fake(inserts, '12345', []))
    expect(receipt).toMatchObject({ drafted: 0, packId: null, skipped: 'no_factory_still' })
    expect(inserts).toEqual([])
  })

  it('inserts an unauthorized pack from a ready still and does not insert again', async () => {
    const inserts: string[] = []
    const db = fake(inserts, '1234567890', [readyStill('2026-11-16')])
    const first = await draftStoryWeekPack('c1', { social_week: { story_per_week: 2 } }, NOW, db)
    expect(first.drafted).toBe(1)
    expect(first.packId).toBeTruthy()
    expect(inserts).toEqual(['story_packs', 'story_items'])
    const second = await draftStoryWeekPack('c1', { social_week: { story_per_week: 2 } }, NOW, db)
    expect(second).toMatchObject({ drafted: 0, skipped: 'story_pack_exists', packId: first.packId })
    expect(second.lines).toHaveLength(1)
    expect(inserts).toEqual(['story_packs', 'story_items'])
  })

  it('does not use a still that has no review pass', async () => {
    const inserts: string[] = []
    const still = readyStill('2026-11-16')
    delete (still.vision_metadata.factory_still as { review?: unknown }).review
    const receipt = await draftStoryWeekPack('c1', { social_week: { story_per_week: 1 } }, NOW, fake(inserts, '12345', [still]))
    expect(receipt).toMatchObject({ drafted: 0, skipped: 'no_factory_still' })
    expect(inserts).toEqual([])
  })

  it('does not insert when the page id is not a number', async () => {
    const inserts: string[] = []
    const receipt = await draftStoryWeekPack('c1', { social_week: { story_per_week: 1 } }, NOW, fake(inserts, 'page', [readyStill('2026-11-16')]))
    expect(receipt.skipped).toBe('no_story_page')
    expect(inserts).toEqual([])
  })
})

function readyStill(date: string) {
  return {
    id: `still-${date}`,
    storage_url: `https://cdn.example/${date}.jpg`,
    vision_metadata: {
      kind: 'factory_still',
      factory_still: {
        aspect: '9:16', role: 'story', slot_date: date, sha256: SHA,
        text_line: 'Harbour Walk', source_ref: 'https://example.com/tours', work_order_id: 'wo-1',
        review: { verdict: 'pass', reviewer: 'system:still-review' },
      },
    },
  }
}

function fake(inserts: string[], pageId: string, stills: unknown[]) {
  const packs: Array<{ id: string; title: string }> = []
  const items: Array<{ item_id: string; slot_at: string; pack_id: string }> = []
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({
        data: table === 'clients' ? [{ facebook_page_id: pageId }]
          : table === 'story_packs' ? packs
          : table === 'client_assets' ? stills
          : table === 'story_items' ? items
          : [],
        error: null,
      }),
      insert: (row: { id?: string; title?: string; item_id?: string; slot_at?: string; pack_id?: string } | Array<{ item_id?: string; slot_at?: string; pack_id?: string }>) => {
        inserts.push(table)
        if (table === 'story_packs' && !Array.isArray(row) && row.id && row.title) packs.push({ id: row.id, title: row.title })
        if (table === 'story_items' && Array.isArray(row)) {
          for (const item of row) {
            if (item.item_id && item.slot_at && item.pack_id) items.push({ item_id: item.item_id, slot_at: item.slot_at, pack_id: item.pack_id })
          }
        }
        return Promise.resolve({ error: null })
      },
    }
    return chain
  }
  return { from } as never
}
