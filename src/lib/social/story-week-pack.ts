/**
 * Unauthorized story pack for one week, from factory 9:16 stills only.
 * Does not set authorized_at and does not send.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { loadFactoryStills, storyReady, type FactoryStill } from '@/lib/factory/still-library'
import { SupabaseLiteStore } from '@/lib/social/story-lite/supabase-store'
import type { NewLiteItem } from '@/lib/social/story-lite/types'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import { planStoryWeekDraft, type StoryWeekDraftReceipt } from './story-week-draft'

const PAGE_ID = /^[0-9]{5,25}$/

export async function draftStoryWeekPack(
  clientId: string,
  config: unknown,
  now: Date,
  supabase: SupabaseClient,
): Promise<StoryWeekDraftReceipt> {
  const planned = planStoryWeekDraft(config)
  if (planned.skipped) return planned
  const week = targetWeek(now)
  const title = `Story stills ${week.weekStart}`
  const existing = await findPack(supabase, clientId, title)
  if (existing === 'unreadable') return { ...planned, skipped: 'story_pack_unreadable', note: '已有 Story 周包读不到，没有再新建。' }
  if (existing) {
    const lines = await packLines(supabase, existing)
    if (lines === 'unreadable') return { ...planned, packId: existing, skipped: 'story_pack_unreadable', note: '已有 Story 周包的条目读不到，没有再新建。' }
    return { ...planned, packId: existing, drafted: 0, lines, skipped: 'story_pack_exists', note: '这一周的 Story 草稿已经有了。' }
  }
  const pageId = await readPageId(supabase, clientId)
  if (pageId === 'unreadable') return { ...planned, skipped: 'story_page_unreadable', note: '主页编号读不到，没有新建周包。' }
  if (!pageId) return { ...planned, skipped: 'no_story_page', note: '没有可用的主页编号，没有新建周包。' }
  const stills = await loadFactoryStills(supabase, clientId)
  if (stills === 'unreadable') return { ...planned, skipped: 'factory_stills_unreadable', note: '静图成片读不到，没有新建周包。' }
  const ready = stills.filter(storyReady)
    .filter((still) => still.slotDate >= week.weekStart && still.slotDate <= week.weekEnd)
    .sort((a, b) => a.slotDate.localeCompare(b.slotDate))
    .slice(0, planned.requested ?? 0)
  if (ready.length === 0) return { ...planned, skipped: 'no_factory_still', note: '没有可用的 9:16 静图成片，没有新建周包。' }
  const packId = crypto.randomUUID()
  const items = ready.map((still) => itemFromStill(still, pageId))
  await new SupabaseLiteStore(supabase).insertPack({ id: packId, client_id: clientId, title, now }, items)
  return {
    ...planned,
    packId,
    drafted: items.length,
    lines: ready.map((still) => ({ date: still.slotDate, ref: still.id })),
    note: `Story 草稿 ${items.length} 条，未授权。`,
  }
}

function itemFromStill(
  still: FactoryStill & { sha256: string; textLine: string; sourceRef: string },
  pageId: string,
): NewLiteItem {
  return {
    item_id: crypto.randomUUID(),
    channel: 'facebook_story',
    slot_at: `${still.slotDate}T01:00:00.000Z`,
    media_kind: 'image',
    media_url: still.storageUrl,
    media_sha256: still.sha256,
    text_line: still.textLine,
    account_id: pageId,
    source_ref: still.sourceRef,
  }
}

async function findPack(supabase: SupabaseClient, clientId: string, title: string): Promise<string | null | 'unreadable'> {
  const { data, error } = await supabase.from('story_packs').select('id').eq('client_id', clientId).eq('title', title).limit(1)
  if (error) return 'unreadable'
  const id = (data?.[0] as { id?: unknown } | undefined)?.id
  return typeof id === 'string' ? id : null
}

async function packLines(supabase: SupabaseClient, packId: string) {
  const { data, error } = await supabase.from('story_items').select('item_id, slot_at').eq('pack_id', packId).limit(40)
  if (error) return 'unreadable' as const
  return (data ?? []).flatMap((row) => {
    const rec = row as { item_id?: unknown; slot_at?: unknown }
    if (typeof rec.item_id !== 'string' || typeof rec.slot_at !== 'string') return []
    return [{ date: rec.slot_at.slice(0, 10), ref: rec.item_id }]
  })
}

async function readPageId(supabase: SupabaseClient, clientId: string): Promise<string | null | 'unreadable'> {
  const { data, error } = await supabase.from('clients').select('facebook_page_id').eq('id', clientId).limit(1)
  if (error) return 'unreadable'
  const page = (data?.[0] as { facebook_page_id?: unknown } | undefined)?.facebook_page_id
  return typeof page === 'string' && PAGE_ID.test(page) ? page : null
}
