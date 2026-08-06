/**
 * 自动执行这条线的「发现不许死在日志里」出口。
 *
 * 机器每天挑一批动作自己跑。两种情况必须让人看见，否则它们只会活在
 * cron 的运行记录里 —— 而运行记录没人天天翻：
 *
 *   ① **拦下来了**：动作本来是机器能做的类型，但方案过期 / 没人认领 /
 *      客户没开周更 …… 于是这件事今天没人做，看板上也不会有任何变化。
 *   ② **试了三次还是不行**：已经停手了。不说的话，这条动作从此永远躺着。
 *
 * 🔴 拦下来的按客户**汇总成一条**，不是一条动作一条待办。
 *    库里 281 件待办，全塞进去 = 刷屏 = PM 直接不看，那比不做更糟
 *    （占了注意力还不产生行动）。这条经验来自体检发现那一栏：
 *    光 critical+high 就有 98 条，最后只能一个客户一条。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  selectAutoRunCandidates,
  MAX_ATTEMPTS,
  type JudgedCandidate,
} from '@/lib/execution/auto-run'
import {
  ENDORSEMENT_FRESH_DAYS,
  PRESCRIPTION_FRESH_DAYS,
  type Endorsement,
} from '@/lib/execution/auto-run-policy'

export interface AutoRunTodo {
  client_id: string
  what: string
  how: string
  href: string
  /** 停手的那种单独出一条；拦下来的按客户汇总 */
  stuck: boolean
}

const boardHref = (clientId: string) =>
  `https://app.magicengine.com.au/dashboard/clients/${clientId}/execution`

/**
 * 背书本身是不是拦下这条的原因 —— 跟 `judgeAutoRun` 里背书那一段判断顺序对齐。
 *
 * 🔴 背书新鲜（挂着当前生效的方案/营销计划、没过保鲜期）时，`judgeAutoRun`
 *    还会往下走白名单/`pinnedTopic`/`fix_type` 几道闸，任何一道都可能才是真正
 *    拦下这条的原因。这里必须跟那边的判断顺序算出同一个答案，否则「方案批下来
 *    太久没复核」这种话会说给一个方案根本不老的客户听 —— 见下面 `summariseReasons`。
 */
function endorsementIsBlocker(e: Endorsement): boolean {
  if (e.kind === 'stale_prescription' || e.kind === 'stale_marketing_plan' || e.kind === 'unendorsed') {
    return true
  }
  if (e.kind === 'recent_analysis') return e.ageDays > ENDORSEMENT_FRESH_DAYS
  return e.ageDays > PRESCRIPTION_FRESH_DAYS // current_prescription / current_marketing_plan
}

/** 把一堆拦下来的原因归成几类说人话 —— 逐条列原因等于把日志贴给 PM 看。 */
function summariseReasons(blocked: JudgedCandidate[]): string {
  const buckets = new Map<string, number>()
  for (const b of blocked) {
    let label: string
    if (endorsementIsBlocker(b.endorsement)) {
      const k = b.endorsement.kind
      label =
        k === 'stale_prescription' ? '挂的方案已经被换掉'
        : k === 'stale_marketing_plan' ? '挂的营销计划已经结束'
        : k === 'unendorsed' ? '没有任何一轮分析在认它'
        : k === 'recent_analysis' ? '分析结论已经过期'
        : '方案批下来太久没复核' // current_prescription / current_marketing_plan 过保鲜期
    } else {
      // 背书是新鲜的，拦下的另有原因（点名了关键词 / 对外类型 / 标了要人工处理 /
      // 不在白名单里……）—— 不能套用背书的标签，那是给一个没问题的方案扣错帽子。
      label = '别的原因（非方案问题，详见原文）'
    }
    buckets.set(label, (buckets.get(label) ?? 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} 件${label}`)
    .join('、')
}

/**
 * 三次都没成功、已经停手的动作 —— 一条一条报，因为每条的原因都不一样。
 *
 * 判据是 `auto_run_attempts >= MAX_ATTEMPTS`：这是**机器自己**试过的痕迹，
 * 跟人手拖到「进行中」的卡完全无关（那些两个开工时间列都是空的，不归这里管）。
 */
async function fetchStuckTodos(supabase: SupabaseClient): Promise<AutoRunTodo[]> {
  const { data, error } = await supabase
    .from('execution_items')
    .select('id, client_id, title, auto_run_attempts, auto_run_error')
    .gte('auto_run_attempts', MAX_ATTEMPTS)
    .eq('status', 'pending')
    .limit(50)
  if (error) {
    console.warn('[auto-run-todo] 停手动作查询失败:', error.message)
    return []
  }

  return ((data ?? []) as Array<{
    id: string
    client_id: string
    title: string | null
    auto_run_attempts: number | null
    auto_run_error: string | null
  }>).map((r) => ({
    client_id: r.client_id,
    stuck: true,
    what:
      `「${r.title ?? r.id}」我试了 ${r.auto_run_attempts ?? MAX_ATTEMPTS} 次都没做成，已经停手 —— ` +
      `这条动作现在没人在做。最后一次的原因：${r.auto_run_error ?? '未知'}`,
    how:
      '不用你查原因 —— 回我一句「查一下这条」我去看。' +
      '如果这件事本来就不该做了，在看板上把它划掉就行',
    href: boardHref(r.client_id),
  }))
}

/**
 * 今日待办要展示的自动执行相关条目。
 *
 * 选候选走**跟 cron 同一个函数**（纯读，不写），所以待办上说的
 * 「今天这几件没做、因为什么」跟机器真实的判定永远一致 ——
 * 各写一份判定逻辑的话，两边迟早会说出不同的话。
 */
export async function fetchAutoRunTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<AutoRunTodo[]> {
  const todos = await fetchStuckTodos(supabase)

  const { judged } = await selectAutoRunCandidates(supabase, now)
  const blocked = judged.filter((j) => !j.verdict.run)
  if (blocked.length === 0) return todos

  const byClient = new Map<string, JudgedCandidate[]>()
  for (const b of blocked) {
    const list = byClient.get(b.client_id) ?? []
    list.push(b)
    byClient.set(b.client_id, list)
  }

  for (const [clientId, list] of Array.from(byClient.entries())) {
    // 第一条的原因原文最有代表性（候选按最老的排在前面）
    const sample = list[0].verdict.run ? '' : list[0].verdict.reason
    todos.push({
      client_id: clientId,
      stuck: false,
      what:
        `有 ${list.length} 件本来我可以自己做的动作（写文章草稿）今天没做：` +
        `${summariseReasons(list)}。也就是说这几件事这周没人往前推`,
      how:
        '多数情况下不用你动手 —— 周二新一轮方案落地后会自动重新判断。' +
        `如果这几件你现在就想要，回我一句我手工跑。（第一条的原文：${sample}）`,
      href: boardHref(clientId),
    })
  }

  return todos
}
