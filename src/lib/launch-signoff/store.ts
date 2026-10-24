/**
 * 上线签字 —— 事件表读写。只读 + 只追加，没有任何 UPDATE/DELETE。
 * Supabase 客户端由调用方传入（模块里不 import 客户端）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ActorRole, EventType, LaunchEvent, ResultStatus } from './types'

const COLUMNS =
  'id, feature_key, event_type, item_key, status, evidence_ref, evidence_snapshot, ref_event_id, actor, actor_role, commit_sha, checklist_hash, note, created_at'
const TABLE = 'launch_signoff_events'

interface Row {
  id: number
  feature_key: string
  event_type: EventType
  item_key: string | null
  status: ResultStatus | null
  evidence_ref: Record<string, unknown> | null
  evidence_snapshot: Record<string, unknown> | null
  ref_event_id: number | null
  actor: string
  actor_role: ActorRole
  commit_sha: string | null
  checklist_hash: string
  note: string | null
  created_at: string
}

function toEvent(r: Row): LaunchEvent {
  return {
    id: Number(r.id),
    featureKey: r.feature_key,
    eventType: r.event_type,
    itemKey: r.item_key,
    status: r.status,
    evidenceRef: r.evidence_ref,
    evidenceSnapshot: r.evidence_snapshot,
    refEventId: r.ref_event_id === null ? null : Number(r.ref_event_id),
    actor: r.actor,
    actorRole: r.actor_role,
    commitSha: r.commit_sha,
    checklistHash: r.checklist_hash,
    note: r.note,
    createdAt: r.created_at,
  }
}

/** 读某功能的全部事件（按 id 升序）。读失败直接抛 —— 调用方必须 fail-closed，不得当成“没测”。 */
export async function loadEvents(db: SupabaseClient, featureKey: string): Promise<LaunchEvent[]> {
  const rows = await fetchAll<Row>(
    (from, to) =>
      db
        .from(TABLE)
        .select(COLUMNS)
        .eq('feature_key', featureKey)
        .order('id', { ascending: true })
        .range(from, to),
    20_000,
  )
  return rows.map(toEvent)
}

export interface NewEvent {
  readonly featureKey: string
  readonly eventType: EventType
  readonly itemKey?: string | null
  readonly status?: ResultStatus | null
  readonly evidenceRef?: Record<string, unknown> | null
  readonly evidenceSnapshot?: Record<string, unknown> | null
  readonly refEventId?: number | null
  readonly actor: string
  readonly actorRole: ActorRole
  readonly commitSha?: string | null
  readonly checklistHash: string
  readonly note?: string | null
}

/** 追加一条事件并返回写入后的行。 */
export async function appendEvent(db: SupabaseClient, e: NewEvent): Promise<LaunchEvent> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      feature_key: e.featureKey,
      event_type: e.eventType,
      item_key: e.itemKey ?? null,
      status: e.status ?? null,
      evidence_ref: e.evidenceRef ?? null,
      evidence_snapshot: e.evidenceSnapshot ?? null,
      ref_event_id: e.refEventId ?? null,
      actor: e.actor,
      actor_role: e.actorRole,
      commit_sha: e.commitSha ?? null,
      checklist_hash: e.checklistHash,
      note: e.note ?? null,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) throw new Error('could not append launch signoff event')
  return toEvent(data as Row)
}
