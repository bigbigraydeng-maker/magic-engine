/**
 * 往一条触点的 `metadata` 里**合并**几个键，且不冲掉别人同时写进去的东西。
 *
 * ## 为什么不直接 update
 *
 * `contact_touchpoints.metadata` 是一整块 jsonb，好几处会写它（通话结束回写结果、分析标记、
 * 员工的操作）。直接「读出来 → 改 → 整块写回」，两处同时写时后写的会把先写的冲掉，而且不报错。
 * 原子合并本来该用数据库函数（像 `telephony_mark_touchpoint` 那样 `metadata || jsonb`），
 * 但新加一个数据库函数要改库结构，这一刀不做。
 *
 * ## 这里的做法：带前提条件的写（乐观锁）
 *
 * 写的时候在 WHERE 里再要求「metadata 还是我刚才读到的那一份」（jsonb 按内容比较，不看键的顺序）。
 * 中间有人改过 → 一行都没更新上 → 重新读一遍再试一次；还不行就记日志放弃。
 * 放弃的代价只是这一个附加键没写上，CRM 其余功能照常（读的一侧对缺这个键有默认行为）。
 */

import { supabaseAdmin } from '@/lib/supabase'

/** 第一次 + 重试一次。 */
const MAX_ATTEMPTS = 2

export type MetadataMergeOutcome =
  | 'written'   // 写上了
  | 'skipped'   // decide 判断不用写（前提不满足 / 已经是这个值）
  | 'missing'   // 这条触点不存在（或不属于这个客户）
  | 'conflict'  // 两次都被别人抢先改了，放弃

export interface MergeTouchpointMetadataInput {
  touchpointId: string
  clientId: string
  /** 看着当前 metadata 决定要合并哪些键；返回 null = 不写。 */
  decide: (metadata: Record<string, unknown>) => Record<string, unknown> | null
}

async function readMetadata(
  touchpointId: string,
  clientId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id, metadata')
    .eq('id', touchpointId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`读触点失败: ${error.message}`)
  if (!data) return null
  return ((data as { metadata: unknown }).metadata ?? {}) as Record<string, unknown>
}

/** 只有 metadata 仍等于 `seen` 时才写；返回是否真的更新了一行。 */
async function writeIfUnchanged(
  input: MergeTouchpointMetadataInput,
  seen: Record<string, unknown>,
  next: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .update({ metadata: next })
    .eq('id', input.touchpointId)
    .eq('client_id', input.clientId)
    .eq('metadata', JSON.stringify(seen))
    .select('id')
  if (error) throw new Error(`写触点失败: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

export async function mergeTouchpointMetadata(input: MergeTouchpointMetadataInput): Promise<MetadataMergeOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seen = await readMetadata(input.touchpointId, input.clientId)
    if (!seen) return 'missing'
    const patch = input.decide(seen)
    if (!patch) return 'skipped'
    if (await writeIfUnchanged(input, seen, { ...seen, ...patch })) return 'written'
  }
  console.warn('[crm/touchpoint-metadata] 触点 metadata 两次都被并发改动，放弃这次附加写入', input.touchpointId)
  return 'conflict'
}
