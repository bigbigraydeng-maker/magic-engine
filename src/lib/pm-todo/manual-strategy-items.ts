/**
 * Strategy / diagnostic / prescription manual items (from manual-items.ts, Round 2).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { fetchGa4KeyEventBreakdown } from '@/lib/ga4/client'
import { judgeLeadsSanity } from '@/lib/strategy/leads-sanity'
import { AUTO_LANDED_AGENT } from '@/lib/diagnostic/auto-prescribe'
import { isHandAddedItem } from '@/lib/diagnostic/prescription-landing'

export async function pushLeadsSanityItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data: goals } = await supabase
    .from('goals')
    .select('id, client_id, title, current_value')
    .eq('status', 'active')
    .eq('primary_metric_key', 'leads_count')
  const rows = (goals ?? []) as Array<{
    id: string
    client_id: string
    title: string
    current_value: number | null
  }>
  if (rows.length === 0) return

  // 一个客户查一次就够 —— 同客户多个客资目标共用同一份统计数据
  const checked = new Map<string, Awaited<ReturnType<typeof checkClientLeads>>>()
  for (const g of rows) {
    if (!checked.has(g.client_id)) {
      checked.set(g.client_id, await checkClientLeads(supabase, g.client_id))
    }
    const verdict = checked.get(g.client_id)
    if (!verdict || verdict.trustworthy) continue

    items.push({
      kind: 'leads_metric_untrusted',
      client_id: g.client_id,
      client_name: nameOf(g.client_id),
      what:
        `目标「${g.title}」现在显示 ${g.current_value ?? '—'}，但这个数不能信 —— ${verdict.humanReason}`,
      how:
        '这个要在客户的网站统计后台改（把「产生线索」的触发条件收窄到真的提交了表单），' +
        '我改不了。你确认一下该找谁改；在那之前别拿这个数判断这个目标做得好不好',
      href: `https://app.magicengine.com.au/dashboard/clients/${g.client_id}/goal/${g.id}`,
    })
  }
}

/** 拉一个客户的关键事件构成并判定。任何一步拿不到就返回 null（不误报）。 */
async function checkClientLeads(supabase: SupabaseClient, clientId: string) {
  const { data: conn } = await supabase
    .from('client_connectors')
    .select('config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .eq('status', 'connected')
    .maybeSingle<{ config: { property_id?: string } | null }>()
  const propertyId = conn?.config?.property_id
  if (!propertyId) return null

  const breakdown = await fetchGa4KeyEventBreakdown(propertyId, clientId).catch(() => null)
  if (!breakdown) return null
  return judgeLeadsSanity(breakdown)
}


/** 新诊断出的问题多久内算「新」—— 周更任务，给一周多一点余量。 */
const DIAGNOSTIC_FRESH_DAYS = 8

/**
 * 本周新诊断出的严重问题 → 下发。
 *
 * PM 2026-08-03 拍板：诊断结果进今日待办逐条看。
 *
 * 🔴 **每个客户只出一条汇总，不是每个发现出一条。**
 *    库里光 critical + high 就有 98 条。全塞进待办 = 刷屏 = PM 直接不看 ——
 *    那跟没做一样，而且比没做更糟（占了注意力还不产生行动）。
 *    一条说清楚「几个严重问题 + 最要紧的是哪个 + 去哪看全部」。
 */
export async function pushDiagnosticItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  /** 客户名查表 —— 待办上要显示客户名，显示 uuid 等于没显示。 */
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - DIAGNOSTIC_FRESH_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('diagnostic_findings')
    .select('client_id, severity, title, priority_score, created_at')
    .in('severity', ['critical', 'high'])
    .gte('created_at', since)
    .order('priority_score', { ascending: false })
    .limit(300)

  const rows = (data ?? []) as Array<{
    client_id: string
    severity: string
    title: string
  }>
  if (rows.length === 0) return

  // 按客户归堆；因为已按 priority_score 倒序取回，每堆第一条就是最要紧的
  const byClient = new Map<string, { critical: number; high: number; top: string }>()
  for (const r of rows) {
    const cur = byClient.get(r.client_id) ?? { critical: 0, high: 0, top: r.title }
    if (r.severity === 'critical') cur.critical += 1
    else cur.high += 1
    byClient.set(r.client_id, cur)
  }

  for (const [clientId, v] of Array.from(byClient.entries())) {
    const counts = [
      v.critical > 0 ? `${v.critical} 个严重` : null,
      v.high > 0 ? `${v.high} 个高优先` : null,
    ].filter(Boolean).join('、')
    items.push({
      kind: 'diagnostic_findings',
      client_id: clientId,
      client_name: nameOf(clientId),
      // 🔴 别再让人去体检页「挑要处理的」——那页是只读报告，一个可执行按钮都没有
      //    （2026-08-04 PM 实测：「点击到健康体检页面，出现的页面我不知道应该做什么」）。
      //    体检查出的问题现在由每周方案自动排成看板上的动作，所以这条只报「查到了什么」，
      //    并把人送到**真的能动手的地方**（执行看板），不是送到报告里。
      what: `本周体检查出 ${counts}问题。最要紧的一条：${v.top}`,
      how: '不用你挑 —— 每周方案会把这些自动排成看板上的动作。点开是执行看板，看方向对不对；觉得漏了哪条回我一句，我单独加',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/execution`,
    })
  }
}


/** 方案多新算「本周的」—— 跟体检同一个窗口。 */
const PRESCRIPTION_FRESH_DAYS = 8

/**
 * 本周自动落地的方案 → 通知一声。
 *
 * PM 2026-08-04 拍板：方案自动落地，不等他一份份点头。所以这条**不是要他干活**，
 * 是让他知道「这周客户的方向被改了、改成什么」——
 * 自动落地如果连告知都没有，就成了系统背着人改客户的方向。
 *
 * 🔴 只报数得出来的：新增几个动作、挂在哪个目标。
 *    不写「去掉了几个」之类需要跟上一版比对才知道的数 —— 没算过就不能写，
 *    错的数字比没有数字更危险（2026-08-03 目标口径事故就是这么来的）。
 */
export async function pushPrescriptionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - PRESCRIPTION_FRESH_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('prescriptions')
    .select('id, client_id, goal_id, approved_at, agent_name, supersedes_id')
    .eq('status', 'approved')
    .eq('agent_name', AUTO_LANDED_AGENT)
    .gte('approved_at', since)
    .order('approved_at', { ascending: false })
    .limit(50)

  const rows = (data ?? []) as Array<{
    id: string
    client_id: string
    goal_id: string | null
    approved_at: string
    supersedes_id: string | null
  }>
  if (rows.length === 0) return

  // 一个客户只出最新一条 —— 同一周落地两份方案时，刷屏没有意义
  const seen = new Set<string>()
  for (const p of rows) {
    if (seen.has(p.client_id)) continue
    seen.add(p.client_id)

    // 🔴 两个数分开数：动作总数，和其中**真的挂到了目标下**的。
    //    首版只数了总数，却在文案里说「照着目标 X 排的」——
    //    而当时的开方提示词根本不产出挂载信息，等于每周对 PM 说一句假话。
    // 🔴 三个数都必须带 `source='diagnostic'`，跟清理那一侧的口径**逐字一致**。
    //    诸葛亮的看板推荐卡也挂同一个方案号（那是归属标记），每跑一次挂一批。
    //    不过滤的话：①「新增 N 个动作」会一天比一天大 —— 同一个日期、同一份方案，
    //    数字却在涨，比不带日期更让人糊涂；②诸葛亮的卡不走战线派生，会全落进
    //    「还没归类」那一堆，PM 按提示切到「全部」看到的是一批日常建议，
    //    不是这份方案的动作；③「收起了 N 个」会把清理逻辑压根没碰的行算进去。
    //    写侧和读侧是一对，条件必须永远一致 —— 上一轮就是只补了写侧、
    //    读侧照数不误，堵上的那句谎从报数这边原样漏了回来。
    // 一次取回来自己数，不发两条 count —— 两条 count 就是两处要维护的过滤条件，
    // 而这条链三轮里有三次缺陷都是「两边口径分家」。手工加的那道排除
    // 直接复用清理侧导出的 `isHandAddedItem`，同一份代码，想分家都难。
    const { data: itemRows } = await supabase
      .from('execution_items')
      .select('id, initiative_id, steps_json')
      .eq('prescription_id', p.id)
      .eq('source', 'diagnostic')
    const ownItems = ((itemRows ?? []) as Array<{
      id: string
      initiative_id: string | null
      steps_json: Record<string, unknown> | null
    }>).filter((r) => !isHandAddedItem(r))
    const total = ownItems.length
    const hung = ownItems.filter((r) => r.initiative_id != null).length

    let goalTitle: string | null = null
    if (p.goal_id) {
      const { data: g } = await supabase
        .from('goals')
        .select('title')
        .eq('id', p.goal_id)
        .maybeSingle<{ title: string }>()
      goalTitle = g?.title ?? null
    }

    // 上一版有多少条被这次接管时收起来了 —— 只报「新增了多少」不报「收起了多少」，
    // 跟只报好消息是一回事。
    //
    // 🔴 必须按**因果**数（这批动作属于被替代的那一版），不能按时间窗数。
    //    首版写的是「这个客户 8 天内变成 superseded 的」，两头都错：
    //    ① 收起旧动作发生在写批准时间**之前**，所以 `updated_at >= approved_at`
    //       对这批动作正好是 false —— 数不数得到全看两边时钟差几毫秒；
    //    ② 每日巡逻任务会把诸葛亮过期的推荐卡整批标成同一个状态、同一个客户，
    //       于是这个数一天比一天大，同一份方案周二说 0 个、周日说 60 个。
    let dropped = 0
    if (p.supersedes_id) {
      const { data: droppedRows } = await supabase
        .from('execution_items')
        .select('id, steps_json')
        .eq('prescription_id', p.supersedes_id)
        .eq('client_id', p.client_id)
        .eq('source', 'diagnostic')
        .eq('status', 'superseded')
      dropped = ((droppedRows ?? []) as Array<{ steps_json: Record<string, unknown> | null }>)
        .filter((r) => !isHandAddedItem(r)).length
    }

    const n = total
    const onGoal = hung
    // 中文日期不带前导零 —— 「08 月 04 日」一眼就是机器拼的
    const [mm, dd] = p.approved_at.slice(5, 10).split('-')
    const day = `${Number(mm)} 月 ${Number(dd)} 日`

    // 一个动作都没排出来 → 这是「这周空转了」，不是「更新成功」，得分开说
    if (n === 0) {
      items.push({
        kind: 'prescription_updated',
        client_id: p.client_id,
        client_name: nameOf(p.client_id),
        // ⚠️ 开头：这条挂在「系统替你做了什么」这个报喜标题下，
        // 是唯一一条坏消息，不自己抢眼一点会被连标题一起扫过去
        what: `⚠️ ${day}出的新方案一个可执行动作都没排出来 —— 等于这周没往前推`,
        how: '这是我们这边的毛病，不用你动手。回我一句我去查是哪一步卡住的',
        href: `https://app.magicengine.com.au/dashboard/clients/${p.client_id}/execution`,
      })
      continue
    }

    // 「收起来」不是「删掉」—— 事实上也确实没删，只是换了个状态。
    // 括号那句必须留着：PM 看到「清掉」的第一反应是「FDE 做了一半的活会不会没了」，
    // 而这恰恰是代码里防得最严的地方（进行中/已完成/主动跳过/等着重跑/留过记录的
    // 一条都不动）。为一个已经解决的问题让他叫停整条自动落地，太亏。
    // 独立成一句（不是逗号接在后面）：前半句讲这次新增，后半句讲上一版怎么处理。
    // 挤在一句里时，「其余 4 个还没归类」和「还没开始做的 5 个」两个「还没」贴着，
    // 说的却是完全不相干的两件事，PM 很容易把两个数当成一回事。
    const cleaned =
      dropped > 0
        ? `。上一版还没开始做的 ${dropped} 个已经收起来了（做了一半的、已完成的、还有等着重跑的都留着）`
        : ''
    let tail: string
    let how: string
    if (goalTitle && onGoal === n) {
      tail = `，全部排在目标《${goalTitle}》下`
      how = '不用你操作，动作已经在看板里排队了。点开扫一眼方向对不对，觉得排错了回我一句，我这周重排'
    } else if (goalTitle && onGoal > 0) {
      tail = `，其中 ${onGoal} 个排在目标《${goalTitle}》下，其余 ${n - onGoal} 个还没归类`
      how = '打开看板后把顶上的目标筛选切到「全部」，才看得到没归类的那几个。方向不对回我一句，我重排'
    } else if (goalTitle) {
      tail = `，本该排在目标《${goalTitle}》下，但一个都没归类上`
      how = '打开看板后把顶上的目标筛选切到「全部」才看得到这批动作。没归类上是我们这边的毛病，回我一句我去修，不用你动手'
    } else {
      tail = '，没挂到任何目标上'
      // 别说「这个客户还没定目标」—— 那是猜的，而且会让他去建个重复的。
      // 开方流程强制要有目标才会跑（没目标直接跳过），所以走到这一支只有一种可能：
      // 方案挂的那个目标后来被删了。
      how = '打开看板后把顶上的目标筛选切到「全部」才看得到。这份方案原本挂的目标已经不在了 —— 要不要重新定一个你说了算'
    }

    items.push({
      kind: 'prescription_updated',
      client_id: p.client_id,
      client_name: nameOf(p.client_id),
      // 带上日期：这条会连着几天出现在待办里，不带日期 PM 会以为方案被改了好几次
      what: `${day}出的新方案已经排进执行看板 —— 新增 ${n} 个动作${tail}${cleaned}`,
      how,
      href: `https://app.magicengine.com.au/dashboard/clients/${p.client_id}/execution`,
    })
  }
}
