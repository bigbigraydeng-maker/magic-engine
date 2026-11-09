/**
 * 表单新线索建档的当下就标成「新线索」。
 *
 * 之前新建的人没有阶段，要等每小时一次的「读往来记录填阶段」才被补成「新线索」，
 * 这段时间列表和抽屉里显示「还没标」（2026-10-28 PM 发现 Tracy Morgan）。
 * 表单线索这一刻除了表单本身没有任何往来可读，补出来的阶段就是「新线索」，所以直接标。
 *
 * 只给**这个客户的阶段配置里有 `new`** 的客户标；写库带「阶段仍为空」条件，留痕写不上就退回。
 * 任何失败都只记一笔、绝不挡表单入库。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { NEW_LEAD_ACTOR } from './actors'

const NEW_STAGE = 'new'

export async function markNewLeadStage(clientId: string, contactId: string): Promise<void> {
  try {
    const { data: cfg, error: cErr } = await supabaseAdmin
      .from('client_pipeline_stages')
      .select('stage_key')
      .eq('client_id', clientId)
      .eq('stage_key', NEW_STAGE)
      .limit(1)
    if (cErr || !cfg || cfg.length === 0) return

    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update({ stage: NEW_STAGE, stage_updated_at: nowIso, updated_at: nowIso })
      .eq('id', contactId)
      .eq('client_id', clientId)
      .is('stage', null)
      .select('id')
    if (error || !data || data.length === 0) return

    const { error: aErr } = await supabaseAdmin.from('contact_stage_events').insert({
      client_id: clientId,
      contact_id: contactId,
      from_stage: null,
      to_stage: NEW_STAGE,
      changed_by: NEW_LEAD_ACTOR,
      note: '表单新线索进来，建档时自动标为新线索',
    })
    if (aErr) {
      await supabaseAdmin
        .from('contacts')
        .update({ stage: null, stage_updated_at: null })
        .eq('id', contactId)
        .eq('client_id', clientId)
        .eq('stage', NEW_STAGE)
        .eq('stage_updated_at', nowIso)
      console.warn('[crm/new-lead-stage] 留痕失败，已把阶段退回:', aErr.message)
    }
  } catch (err) {
    console.warn('[crm/new-lead-stage] 标新线索失败（不影响入库）:', err instanceof Error ? err.message : err)
  }
}
