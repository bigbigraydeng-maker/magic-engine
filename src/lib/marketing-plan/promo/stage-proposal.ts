import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketingPlan, MarketingPlanData } from '../types'
import { buildScaleDraft } from './stage-switch'
import { loadDeliveryView } from './stage-evidence'
import { parsePromoSpec, readPromoSpec, type PromoSpec } from './spec'

export interface StageProposalRow {
  client_id: string
  campaign_id: null
  master_brief_id: null
  initiative_id: null
  title: string
  status: 'draft'
  start_date: string | null
  end_date: string | null
  plan_data: MarketingPlanData & { promo: PromoSpec }
  generation_meta: {
    stage_proposal: { source_plan_id: string; from_stage: 'test'; to_stage: 'scale'; proposed_at: string }
  }
  approved_at: null
}

export function stageProposalRow(source: MarketingPlan, draft: PromoSpec, at: string): StageProposalRow {
  const base = source.plan_data
  return {
    client_id: source.client_id,
    campaign_id: null,
    master_brief_id: null,
    initiative_id: null,
    title: `${source.title}（放量草稿）`.slice(0, 120),
    status: 'draft',
    start_date: source.start_date,
    end_date: source.end_date,
    plan_data: { ...base, tasks: [], promo: draft },
    generation_meta: {
      stage_proposal: { source_plan_id: source.id, from_stage: 'test', to_stage: 'scale', proposed_at: at },
    },
    approved_at: null,
  }
}

interface Existing { id?: unknown; generation_meta?: unknown }

function sourceIdOf(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const row = (meta as { stage_proposal?: { source_plan_id?: unknown } }).stage_proposal
  return typeof row?.source_plan_id === 'string' ? row.source_plan_id : ''
}

async function existingDraft(supabase: SupabaseClient, clientId: string, sourceId: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from('marketing_plans')
    .select('id, generation_meta')
    .eq('client_id', clientId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return undefined
  const rows = (data ?? []) as Existing[]
  if (rows.length >= 30) return undefined
  const hit = rows.find(row => sourceIdOf(row.generation_meta) === sourceId)
  if (!hit) return null
  return typeof hit.id === 'string' ? hit.id : undefined
}

export type ProposalResult =
  | { ok: true; planId: string; already: boolean }
  | { ok: false; status: number; error: string }

export async function createStageProposal(
  supabase: SupabaseClient, clientId: string, source: MarketingPlan, today: string, now: Date = new Date(),
): Promise<ProposalResult> {
  if (source.client_id !== clientId) return { ok: false, status: 404, error: '找不到这份计划' }
  if (source.status !== 'approved') return { ok: false, status: 409, error: '只有正在执行的计划才会另起一份草稿。这份还没批准，直接改草稿就行。' }
  const spec = readPromoSpec(source.plan_data)
  if (!spec) return { ok: false, status: 400, error: '这份计划的推广内容读不出来，没有新建。' }
  const view = await loadDeliveryView(supabase, clientId, spec, today, now)
  if (!view.can_propose) return { ok: false, status: 409, error: view.switch_text }
  const found = await existingDraft(supabase, clientId, source.id)
  if (found === undefined) return { ok: false, status: 500, error: '读不到已有草稿，这次没有新建，以免重复。' }
  if (found) return { ok: true, planId: found, already: true }
  const built = buildScaleDraft(spec, today)
  const parsed = parsePromoSpec(built.spec)
  if (!parsed.ok) return { ok: false, status: 500, error: '新草稿没通过计划校验，没有保存。' }
  const row = stageProposalRow(source, parsed.spec, now.toISOString())
  const { data, error } = await supabase.from('marketing_plans').insert(row).select('id').single()
  if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
    return { ok: false, status: 500, error: '新草稿没有保存成功。正在跑的计划没有改。' }
  }
  return { ok: true, planId: (data as { id: string }).id, already: false }
}
