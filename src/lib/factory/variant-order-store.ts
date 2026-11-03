// DB layer for "order one variant of an existing video" in the video factory.
// Pure brief-building logic lives in ./variant-order; this file only reads bases,
// enforces the per-client daily cap, and inserts the fresh queued work order.

import type { SupabaseClient } from '@supabase/supabase-js'
import { remotionMusicChoices, type RemotionMusicChoice } from './remotion-music-options.mjs'
import {
  MAX_HOOK_LINE_CHARS,
  MAX_VARIANT_ORDERS_PER_DAY,
  VARIANT_BASE_STATUSES,
  VARIANT_ORDER_SOURCE,
  buildVariantBrief,
  type VariantChange,
} from './variant-order'

export interface VariantBase {
  id: string
  client_id: string
  client_name: string
  status: string
  angle: string | null
  created_at: string
  template: string | null
  hook_lines: unknown
  video_url: string | null
}

export interface VariantBaseDetail {
  id: string
  client_id: string
  template: string | null
  hook_lines: unknown
  current_music: string | null
  music_choices: RemotionMusicChoice[]
  max_hook_chars: number
}

export type StoreResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function publicVideoUrl(path: string | null): string | null {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/content-factory/${path.replace(/^\/+/, '')}`
}

const isBaseStatus = (s: unknown): boolean =>
  typeof s === 'string' && (VARIANT_BASE_STATUSES as readonly string[]).includes(s)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

async function clientNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (ids.length === 0) return names
  const { data, error } = await supabase.from('clients').select('id, name').in('id', ids)
  if (error) return names
  for (const row of data ?? []) {
    if (isPlainObject(row) && typeof row.id === 'string' && typeof row.name === 'string') {
      names.set(row.id, row.name)
    }
  }
  return names
}

export async function listVariantBases(
  supabase: SupabaseClient,
  clientId: string | null,
): Promise<StoreResult<VariantBase[]>> {
  let query = supabase
    .from('content_work_orders')
    .select(
      'id, client_id, status, angle, created_at, video_path:output->>video_path, template:brief->remotion->>template, hook_lines:brief->remotion->props->hook->lines',
    )
    .in('status', [...VARIANT_BASE_STATUSES])
    .not('brief->remotion', 'is', null)
    .eq('brief->>engine', 'remotion')
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(80)
  if (error) return { ok: false, status: 500, error: error.message }

  const rows: Record<string, unknown>[] = []
  for (const row of data ?? []) {
    if (isPlainObject(row) && typeof row.video_path === 'string' && row.video_path.length > 0) rows.push(row)
  }
  const kept = rows.slice(0, 40)
  const ids = Array.from(
    new Set(
      kept
        .map(row => (typeof row.client_id === 'string' ? row.client_id : null))
        .filter((id): id is string => id !== null),
    ),
  )
  const names = await clientNames(supabase, ids)

  const bases: VariantBase[] = kept.map(row => {
    const cid = typeof row.client_id === 'string' ? row.client_id : ''
    return {
      id: typeof row.id === 'string' ? row.id : '',
      client_id: cid,
      client_name: names.get(cid) ?? cid,
      status: typeof row.status === 'string' ? row.status : '',
      angle: asString(row.angle),
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
      template: asString(row.template),
      hook_lines: row.hook_lines ?? null,
      video_url: publicVideoUrl(typeof row.video_path === 'string' ? row.video_path : null),
    }
  })
  return { ok: true, data: bases }
}

export async function getVariantBaseDetail(
  supabase: SupabaseClient,
  baseId: string,
): Promise<StoreResult<VariantBaseDetail>> {
  const { data: row, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, brief, video_path:output->>video_path')
    .eq('id', baseId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!row) return { ok: false, status: 404, error: '找不到这条视频' }
  const status = isPlainObject(row) ? row.status : null
  const videoPath = isPlainObject(row) ? row.video_path : null
  if (!isBaseStatus(status) || typeof videoPath !== 'string' || videoPath.length === 0) {
    return { ok: false, status: 409, error: '这条视频还没出成片，不能当底稿' }
  }
  const brief = isPlainObject(row) && isPlainObject(row.brief) ? row.brief : {}
  const remotion = isPlainObject(brief.remotion) ? brief.remotion : null
  const props = remotion && isPlainObject(remotion.props) ? remotion.props : null
  const hook = props && isPlainObject(props.hook) ? props.hook : null
  return {
    ok: true,
    data: {
      id: typeof row.id === 'string' ? row.id : baseId,
      client_id: typeof row.client_id === 'string' ? row.client_id : '',
      template: remotion ? asString(remotion.template) : null,
      hook_lines: hook ? hook.lines ?? null : null,
      current_music: props ? asString(props.musicFile) : null,
      music_choices: remotion ? remotionMusicChoices(remotion) : [],
      max_hook_chars: MAX_HOOK_LINE_CHARS,
    },
  }
}

interface BaseRow {
  id: string
  client_id: string
  goal_id: string | null
  master_brief_id: string | null
  order_type: string | null
  budget_cap_usd: number | null
  brief: unknown
}

async function loadBase(
  supabase: SupabaseClient,
  baseId: string,
): Promise<StoreResult<BaseRow>> {
  const { data: row, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, goal_id, master_brief_id, order_type, budget_cap_usd, status, brief, video_path:output->>video_path')
    .eq('id', baseId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!row) return { ok: false, status: 404, error: '找不到这条视频' }
  const status = isPlainObject(row) ? row.status : null
  const videoPath = isPlainObject(row) ? row.video_path : null
  if (!isBaseStatus(status) || typeof videoPath !== 'string' || videoPath.length === 0) {
    return { ok: false, status: 409, error: '这条视频还没出成片，不能当底稿' }
  }
  return {
    ok: true,
    data: {
      id: typeof row.id === 'string' ? row.id : baseId,
      client_id: typeof row.client_id === 'string' ? row.client_id : '',
      goal_id: asString(row.goal_id),
      master_brief_id: asString(row.master_brief_id),
      order_type: asString(row.order_type),
      budget_cap_usd: typeof row.budget_cap_usd === 'number' ? row.budget_cap_usd : null,
      brief: row.brief,
    },
  }
}

async function countRecentVariants(
  supabase: SupabaseClient,
  clientId: string,
): Promise<StoreResult<number>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('content_work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('angle_source->>source', VARIANT_ORDER_SOURCE)
    .gte('created_at', since)
  if (error) return { ok: false, status: 500, error: error.message }
  return { ok: true, data: count ?? 0 }
}

export async function createVariantOrder(
  supabase: SupabaseClient,
  req: { baseId: string; change: VariantChange; note: string; actor: string },
): Promise<StoreResult<{ id: string; status: string; summary: string }>> {
  const loaded = await loadBase(supabase, req.baseId)
  if (!loaded.ok) return loaded
  const base = loaded.data

  const counted = await countRecentVariants(supabase, base.client_id)
  if (!counted.ok) return counted
  if (counted.data >= MAX_VARIANT_ORDERS_PER_DAY) {
    return {
      ok: false,
      status: 429,
      error: `同一个客户 24 小时内最多下 ${MAX_VARIANT_ORDERS_PER_DAY} 单，明天再来`,
    }
  }

  const built = buildVariantBrief(base.brief, base.id, req.change)
  if (!built.ok) return { ok: false, status: 422, error: built.error }

  const short = String(base.id).slice(0, 8)
  const { data: inserted, error } = await supabase
    .from('content_work_orders')
    .insert({
      client_id: base.client_id,
      goal_id: base.goal_id ?? null,
      master_brief_id: base.master_brief_id ?? null,
      order_type: base.order_type,
      angle: `变体（底稿 ${short}）：${built.summary}`,
      angle_source: {
        source: VARIANT_ORDER_SOURCE,
        base_work_order_id: base.id,
        change: built.summary,
        note: req.note || null,
        ordered_by: req.actor,
        ordered_at: new Date().toISOString(),
        stops_at: 'in_review',
      },
      rationale_one_liner: req.note ? `${built.summary} · ${req.note}` : built.summary,
      brief: built.brief,
      budget_cap_usd: typeof base.budget_cap_usd === 'number' ? base.budget_cap_usd : 0.5,
      status: 'queued',
    })
    .select('id, status')
    .single()
  if (error) return { ok: false, status: 500, error: `下单失败：${error.message}` }
  if (!inserted || typeof inserted.id !== 'string') {
    return { ok: false, status: 500, error: '下单失败：未返回工单 id' }
  }
  return {
    ok: true,
    data: {
      id: inserted.id,
      status: typeof inserted.status === 'string' ? inserted.status : 'queued',
      summary: built.summary,
    },
  }
}
