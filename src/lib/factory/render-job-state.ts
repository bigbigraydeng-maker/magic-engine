// 做片任务状态更新 —— 讲课式引擎和边走边录自动剪辑共用同一套「防复活守卫」。
//
// 🔴 防复活守卫是安全关键逻辑，只维护一份：任务若已被卡死回收(watchdog 标 failed)，
// 绝不能再被当前 worker 改回活状态 —— 否则被回收后 PM 重排的新任务和原 worker 会
// 重复做片、双倍花钱(魏征 M3)。`.neq('status', 'failed')` 是唯一防线，两个渲染器
// 必须共用这份实现，漏改一份就是真实的重复消费隐患。

import { supabaseAdmin } from '@/lib/supabase'

/** 更新任务(带防复活守卫)。被回收时抛错，让当前 worker 停手。 */
export async function patchJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  // 写状态失败不该让整单白干:网络抖一下重试两次
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .from('content_factory_render_jobs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .neq('status', 'failed')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('任务已被回收(超时标失败)，本次做片作废')
      return
    } catch (e) {
      if (e instanceof Error && e.message.includes('已被回收')) throw e
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  throw new Error(`更新任务状态失败(重试 3 次): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/** 心跳：长阶段期间定期 touch updated_at，防被卡死回收误杀。 */
export async function heartbeat(jobId: string, status: string): Promise<void> {
  await patchJob(jobId, { status })
}

/** 分步日志:做片是长活，出问题必须一眼看出死在哪一步(Render 日志里直接可读)。 */
export function stepLog(tag: string, jobId: string, msg: string): void {
  console.log(`[${tag} ${jobId.slice(0, 8)}] ${new Date().toISOString()} ${msg}`)
}
