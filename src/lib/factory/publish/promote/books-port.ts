// 转公开成功后的回执类写入(生产实现):执行事项标 completed + 工作日志「已公开」。
// 字段/作者沿用 publish-worker.ts writeThreeBooks 真公开路径(不改 writeThreeBooks)。
//
// 为什么两条路:PR 2817 之前草稿期就会建执行事项(已是 completed),之后草稿期不建。
// 所以转公开时看流量记录上的 execution_item_id:有 -> 标 completed;没有 -> 新建 completed 并回挂。

import { supabaseAdmin } from '@/lib/supabase'
import type { PromoteBooks } from './types'

const FACTORY_AUTHOR = 'factory@magicengine.com.au'

async function completeExecutionItem(a: Parameters<PromoteBooks['completeExecutionItem']>[0]): Promise<void> {
  const nowIso = new Date().toISOString()
  if (a.existingItemId) {
    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .update({ status: 'completed', completed_at: nowIso, updated_at: nowIso })
      .eq('id', a.existingItemId)
      .eq('client_id', a.clientId)
      .select('id')
    if (error) throw error
    if (!Array.isArray(data) || data.length < 1) throw new Error('执行事项更新没有命中任何行')
    return
  }
  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .insert({
      client_id: a.clientId, title: a.title.slice(0, 200), description: a.description,
      dimension: 'social', status: 'completed', fix_type: 'me_auto',
      source: 'proactive_signal', // 与 writeThreeBooks 一致;'factory_auto' 会撞 CHECK
      completed_at: nowIso, created_at: nowIso, updated_at: nowIso,
    })
    .select('id')
    .maybeSingle()
  if (error) throw error
  const itemId = typeof data?.id === 'string' ? data.id : null
  if (!itemId) throw new Error('执行事项创建后没有返回 id')
  const link = await supabaseAdmin
    .from('flywheel_actions')
    .update({ execution_item_id: itemId })
    .eq('id', a.rowId)
    .eq('client_id', a.clientId)
    .is('execution_item_id', null)
    .select('id')
  if (link.error) throw link.error
  if (!Array.isArray(link.data) || link.data.length < 1) throw new Error('执行事项回挂流量记录没有命中任何行')
}

async function writeWorkLog(a: Parameters<PromoteBooks['writeWorkLog']>[0]): Promise<void> {
  const { error } = await supabaseAdmin.from('fde_work_logs').insert({
    client_id: a.clientId,
    log_date: new Date().toISOString().slice(0, 10),
    summary: a.summary,
    author_email: FACTORY_AUTHOR,
  })
  if (error) throw error
}

export function createPromoteBooks(): PromoteBooks {
  return { completeExecutionItem, writeWorkLog }
}
