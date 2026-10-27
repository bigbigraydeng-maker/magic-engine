/**
 * Infrastructure monitoring manual items (from manual-items.ts, Round 2).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgo, type ManualItem, type ManualItemKind } from './manual-item-types'
import { daysSinceLatest, makeSupabaseOutageReader, readRecentOutages, streakDays, utcDate, type OutageQuery } from '@/lib/ai/outage-ledger'
import { shouldRemindToday, streakPhrase } from './remind-cadence'
import { checkCronHealth } from '@/lib/cron/health'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'

/**
 * `ad-readback-sweep` 写进运行记录的那份 summary 的形状。
 *
 * 刻意在这里重新声明、只声明用得到的字段，不 import 那边的类型：这是一份**已经
 * 落库的旧数据**，字段随时可能是上个版本写的。当成外部输入处理，比假装它一定
 * 跟今天的代码同构安全。
 */
interface AdSweepSummary {
  results?: {
    clientId: string
    clientName: string
    adAccountId: string
    adSets?: {
      adSetId: string
      adSetName: string
      hasBlocker: boolean
      findings: { severity: string; message: string }[]
      buyerWillSee: { adName: string; lines: string[] }[]
    }[]
  }[]
}

/** 官方稳定后台入口；登录后从 Billing → Add Funds 充值。 */
const DATAFORSEO_DASHBOARD_URL = 'https://app.dataforseo.com/'

/** Keyword Intelligence 余额告罄只认供应商的明确 40210，不猜其它错误。 */
export async function pushDataForSeoCreditsItem(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('client_discovery')
    .select('id')
    .gte('generated_at', since)
    // JSONB containment matches a warning object even when it also has stage/message.
    .contains('payload', { meta: { warnings: [{ error_code: 40210 }] } })
    .limit(1)

  if (error) throw new Error(`client_discovery warning query failed: ${error.message}`)
  if (!data?.length) return

  items.push({
    kind: 'dataforseo_credits_out',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: 'Keyword Intelligence 余额用完了 —— 新的客户发现、SEO 竞品分析和内容选题会缺少关键词量数据',
    how: '打开后台 → Billing → Add Funds 充值；充完回我一句，我把最近受影响的发现任务重跑',
    href: DATAFORSEO_DASHBOARD_URL,
  })
}


/**
 * AI 账户断电 —— 只有人能充值 / 换钥匙，必须当天摆到眼前。
 *
 * 真实事故（2026-09-20）：ME 全站只有一把 OpenAI 钥匙，它背后的账户当天
 * 18:01~19:11 (UTC) 余额耗尽，约 35 个调用点一起死，**三天没人知道**。
 * 当时全仓只有市场情报那一条链路会喊出来，其余十几处都是 catch {} 静默吞掉。
 *
 * 判据用「最近几天有没有落地的断电记录」，**不是**「现在还坏着」——
 * 后者会让 9/20 那种只持续 70 分钟的断电在充值后彻底消失（今日待办一天才跑一次，
 * 而且只有周日到周四）。见 outage-ledger.ts 顶部那段。
 */
const AI_ACCOUNT_GUIDE: Record<
  string,
  { kind: ManualItemKind; what: string; how: string; href: string }
> = {
  account_exhausted: {
    kind: 'ai_provider_exhausted',
    what: 'AI 文字账户的钱用完了 —— 这把钥匙全站在用：写内容、判客户到哪一步了、读通话记录、做 AI 可见度体检，全都会安静地跳过，看上去像「今天没什么发现」',
    how: '打开链接 →「Add to credit balance」→ 充值（这是我们生成文字用的账户，跟出片那个不是同一个）。不确定充多少就回我一句「算一下烧了多少」，我按最近 30 天的真实用量给你一个数再充。充完也回我一句，我把这几天被跳过的活儿重跑一遍',
    href: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  credential_invalid: {
    kind: 'ai_provider_exhausted',
    what: 'AI 文字账户的那把钥匙不认了（被撤销或过期）—— 全站用到 AI 的地方都在安静地跳过，跟没钱时的表现一模一样',
    how: '打开链接 →「Create new secret key」→ 名字随便填 → 复制。**别把它贴在聊天里**，直接去 Render 后台（dashboard.render.com → 服务 → Environment）把 OPENAI_API_KEY 这一项的值换成新的 → Save。换完回我一句，我把这几天被跳过的活儿重跑一遍',
    href: 'https://platform.openai.com/api-keys',
  },
  gateway_auth_failed: {
    kind: 'ai_gateway_broken',
    what: 'AI 调用卡在中间那道 Cloudflare 关口上了 —— **不是 OpenAI 的问题，你去 OpenAI 后台查不出任何东西**。全站用到 AI 的地方都在安静地跳过',
    how: '这条不用你动手 —— 是我们这边的网关令牌过期了。回我一句「换网关令牌」我就去换；不说的话它会一直这么空着',
    href: 'https://dash.cloudflare.com',
  },
}

/**
 * 备用 AI（Claude / DeepSeek）自己断电时的指引。
 *
 * 🔴 为什么必须单独写：上面那份 `AI_ACCOUNT_GUIDE` 的文案和链接全是 OpenAI 的
 * （「打开 OpenAI 充值页」「把 OPENAI_API_KEY 换成新的」）。切换层现在会把 Claude / DeepSeek 的
 * 账户级失败也写进台账；不单独写的话，Claude 没钱时你会收到一条「去 OpenAI 充值」的待办 ——
 * 下发了但没法照做（CLAUDE.md 铁律 3）。
 */
const BACKUP_PROVIDER_GUIDE: Record<string, { name: string; billing: string; keys: string; envVar: string }> = {
  anthropic: {
    name: 'Claude（备用 AI）',
    billing: 'https://console.anthropic.com/settings/billing',
    keys: 'https://console.anthropic.com/settings/keys',
    envVar: 'ANTHROPIC_API_KEY',
  },
  deepseek: {
    name: 'DeepSeek（备用 AI）',
    billing: 'https://platform.deepseek.com/top_up',
    keys: 'https://platform.deepseek.com/api_keys',
    envVar: 'DEEPSEEK_API_KEY',
  },
}

function backupProviderGuide(provider: string, reason: string) {
  const g = BACKUP_PROVIDER_GUIDE[provider]
  if (!g) return null
  const noMoney = reason === 'account_exhausted'
  return {
    kind: 'ai_provider_exhausted' as const,
    what: `${g.name}的${noMoney ? '钱用完了' : '钥匙不认了'} —— 它平时不被用到，所以现在没有症状；但主力 OpenAI 一旦也断，简报就没有备用可换，会跟以前一样整片停摆`,
    how: noMoney
      ? `打开链接 → 充值。充完回我一句即可（这条不紧急，但别拖到 OpenAI 也断的那天）`
      : `打开链接 → 新建一把钥匙 → **别贴在聊天里**，直接去 Render 后台把 ${g.envVar} 换成新的 → Save。换完回我一句`,
    href: noMoney ? g.billing : g.keys,
  }
}

/**
 * 今天（UTC）有多少张简报卡是备用模型答的。查不出来就当 0 —— 这只是并进文案的一句补充，
 * 绝不能因为它挂了而丢掉「该充值了」那条本身。
 *
 * 判据是 `model` 列以 claude / deepseek 开头。这一列刀 2 起才记真实答题的模型，
 * 此前是凭环境变量猜的，所以只有刀 2 上线之后的卡才数得准。
 */
async function countDegradedCardsToday(supabase: SupabaseClient, now: Date): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('conversation_briefs')
      .select('*', { count: 'exact', head: true })
      .gte('generated_at', `${utcDate(now)}T00:00:00.000Z`)
      .or('model.like.claude%,model.like.deepseek%')
    return error ? 0 : (count ?? 0)
  } catch {
    return 0
  }
}

export async function pushProviderOutageItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const query = await readRecentOutages(makeSupabaseOutageReader(supabase), now)
  items.push(...buildProviderOutageItems(query, now, await countDegradedCardsToday(supabase, now)))
}

/**
 * 从断电记录造待办 —— 纯函数，可完全单测（这是验收条件 1 的落点）。
 */
export function buildProviderOutageItems(
  query: OutageQuery,
  now: Date,
  /** 今天由备用模型答的简报卡张数。有的话并进 OpenAI 那条「该充值了」，不另起一条（告知不是待办）。 */
  degradedCardsToday = 0,
): ManualItem[] {
  const items: ManualItem[] = []
  const { rows, error } = query

  // 🔴 「查不了」绝不能长得跟「一切正常」一样 —— 那正是这张卡存在的原因。
  //    表没建 / 权限不对 / 查询挂了，都必须有人看见，否则这套告警瞎了也没人知道
  //    （memory: monitoring-writer-silent-failure-inverts-health-check）。
  if (error) {
    items.push({
      kind: 'ai_alerting_broken',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「AI 账户断电」的告警自己读不出来了（${error.slice(0, 160)}）—— 现在不报警**不等于**没事，等于这只眼睛瞎了`,
      how: '这条不用你动手 —— 是我们这边的欠账（记录表没建好或权限不对）。回我一句「修一下断电告警」我就去修',
      href: '',
    })
    return items
  }

  const today = utcDate(now)
  const byReason = new Map<string, { dates: string[]; detail: string | null }>()
  for (const r of rows) {
    const key = `${r.provider}::${r.reason}`
    const g = byReason.get(key) ?? { dates: [], detail: null }
    g.dates.push(r.outage_date)
    if (r.outage_date === today || g.detail === null) g.detail = r.detail
    byReason.set(key, g)
  }

  for (const [key, g] of byReason) {
    const streak = streakDays(g.dates, today)
    const sinceLatest = daysSinceLatest(g.dates, today)
    if (!shouldRemindToday(streak, sinceLatest, now)) continue
    const [provider = '', reason = ''] = key.split('::')
    const guide = provider === 'openai' || !BACKUP_PROVIDER_GUIDE[provider]
      ? AI_ACCOUNT_GUIDE[reason]
      : backupProviderGuide(provider, reason) ?? undefined
    // 认不出来的新失败形态照样下发 —— 说不清楚也好过不说。
    // 供应商原话一起带上（截断），否则 PM 只看到一个代号，连问我第二遍都没法问。
    const raw = (g.detail ?? '').trim()
    const what =
      guide?.what ??
      `AI 供应商报了一个我们还没见过的账户级问题（${reason}）—— 全站用到 AI 的地方可能在安静地跳过${raw ? `。供应商原话：${raw.slice(0, 160)}` : ''}`
    // 已经好了的那种（最近一次不是今天）要说清是哪天，别让人以为现在还坏着
    const when =
      sinceLatest !== null && sinceLatest > 0
        ? `${sinceLatest} 天前断过一次（现在看起来已经恢复）`
        : streakPhrase(streak)
    // 只并进 OpenAI 这一条：备用模型自己的断电提示不该再说「有卡是备用答的」。
    const degraded =
      provider === 'openai' && degradedCardsToday > 0
        ? `。**简报已自动改用备用 AI**：今天有 ${degradedCardsToday} 张客人卡是 Claude/DeepSeek 答的，语言和细节可能比平时粗，有报价、付款、投诉的客人请多看一眼原始对话`
        : ''
    items.push({
      kind: guide?.kind ?? 'ai_provider_exhausted',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${when}：${what}${degraded}`,
      how: guide?.how ?? '回我一句「查一下 AI 账户」，我去看供应商后台具体报的是什么',
      href: guide?.href ?? '',
    })
  }
  return items
}

/** Render 后台首页 —— 稳定入口，登录后一定打得开（不是会 404 的深链）。 */
const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'
/** 「跑成了但没写出东西」那张详情页 —— 每条都写了下游表最后一行是什么时候写的。 */
const WORKFLOWS_HEALTH_URL = 'https://app.magicengine.com.au/dashboard/workflows-health'

/**
 * 「任务该跑没跑」按调度方给不同的动手指引。
 *
 * 三件套里的 how / href 必须**对得上真实系统**：让人去 Render 找一个由 GitHub 或
 * Inngest 调度的任务，他会翻半天再回来问 —— 等于这条待办没下发好。
 */
const CRON_STOPPED_GUIDE = {
  render: {
    how: '打开链接 → 找到这几个服务 → 看 Events 里最后一次运行是什么结果。多半是 Environment 里没关联 me-shared-cron-secret，勾上再选「Link and apply on next run」即可',
    href: RENDER_DASHBOARD_URL,
  },
  'github-actions': {
    how: '打开链接 → Actions 页找到同名的工作流 → 看最近几次是不是被跳过或报错。GitHub 的免费定时任务经常延迟几小时，但连着几天没有记录就是真停了；可以先点 Run workflow 手动跑一次确认',
    href: 'https://github.com/bigbigraydeng-maker/magic-engine/actions',
  },
  inngest: {
    how: '打开链接 → 进 Production 环境 → Apps → 找到 magic-engine-web，点 Sync 一次（地址是 https://app.magicengine.com.au/api/inngest）。新增函数或改了触发时间之后必须手动同步一次，否则它安静地不跑；同步完在 Functions 里能看到就对了',
    href: 'https://app.inngest.com',
  },
  external: {
    how: '这几个的定时器**不在我们代码仓库里**，是有人在 Render 后台手工建的 —— 打开链接 → 在服务列表里按名字找 → 看它还在不在、Events 里最后一次跑成什么样。如果整条被删了，回我一句我把它接回代码里管',
    href: RENDER_DASHBOARD_URL,
  },
} as const

/**
 * 自动任务该跑没跑 → 下发。
 *
 * 现有 daily-cron-digest 只报「跑了但失败」。**「压根没跑」没有任何记录**，
 * 在 digest 眼里跟一切正常完全一样 —— 工厂排产停摆 8 天、digest 自己哑 51 天，
 * 都是死在这个盲区。这里补上。
 *
 * 逾期和从没跑过合成一条，别把待办刷屏：一条说清楚有几个、分别是谁。
 */
export async function pushCronHealthItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  // 🔴 体检整体挂掉时**不能什么都不报**。原来是 `.catch(() => null); if (!r) return` ——
  //    于是「40 个自动任务的体检自己坏了」跟「40 个全部正常」长得一模一样，
  //    正是这个文件存在要消灭的那种静默。
  const r = await checkCronHealth(supabase, now).catch((e: unknown) => {
    items.push({
      kind: 'ai_alerting_broken',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `自动任务的体检自己跑挂了（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天**没有任何**「任务停了/卡死/报错」的检查结果，不报警不等于一切正常`,
      how: '这条不用你动手 —— 是我们这边的查询挂了。回我一句「修一下任务体检」我就去修',
      href: '',
    })
    return null
  })
  if (!r) return

  const stopped = [...r.neverRan, ...r.overdue]

  if (stopped.length > 0) {
    // 🔴 按**谁在调度它**分组下发。原来一律写「打开 Render → 找到这几个服务」，
    //    但清单里已经有不是 Render 调度的任务（GitHub Actions / Render 后台手工建 /
    //    Inngest 自带定时器）—— 照着那条指引去 Render 找一个根本不存在的服务，
    //    等于把人支到错的系统里，正是 CLAUDE.md 说的「下发了但没法照做」。
    const bySvc = new Map(CRON_REGISTRY.map((e) => [e.service, e.scheduler ?? 'render']))
    const groups = new Map<string, string[]>()
    for (const h of stopped) {
      const who = bySvc.get(h.service) ?? 'render'
      groups.set(who, [...(groups.get(who) ?? []), h.service])
    }
    for (const [who, names] of groups) {
      const guide = CRON_STOPPED_GUIDE[who as keyof typeof CRON_STOPPED_GUIDE] ?? CRON_STOPPED_GUIDE.render
      items.push({
        kind: 'cron_not_running',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what: `${names.length} 个自动任务该跑没跑：${names.join('、')} —— 它们负责的活儿现在没人干，而且不会自己好`,
        how: guide.how,
        href: guide.href,
      })
    }
  }

  // 卡死跟「该跑没跑」是两件事，不能合成一条：那边是**没开始**（多半是 Render 侧配置），
  // 这边是**开始了没结束**（进程被杀 / 卡在某个外部调用上），下一步动作完全不同。
  // 两边都接不住它：failing 只认 status='failed'，可容器被杀时路由的 catch 根本没机会跑；
  // overdue 看 started_at，而卡死的任务开跑记录是有的。所以跑死的任务在体检里等于健康。
  if (r.stuck.length > 0) {
    // 🔴 `r.stuck` 已经在 health.ts 里**按服务聚合过**，所以 `.length` 说的是
    //    「几个任务」而不是「几条记录」。不聚合的话 attribution-cron 一家 4 条孤儿行
    //    会被渲染成「4 个自动任务卡死」，是个会骗人的数（魏征 2026-09-23 复审）。
    const names = r.stuck
      .map((s) => {
        const dur = s.minutesRunning >= 120 ? `${Math.round(s.minutesRunning / 60)} 小时` : `${s.minutesRunning} 分钟`
        const rounds = s.rounds > 1 ? `，48 小时里卡了 ${s.rounds} 轮` : ''
        return `${s.service}（已卡 ${dur}${rounds}）`
      })
      .join('、')
    items.push({
      kind: 'cron_stuck',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.stuck.length} 个自动任务开跑了但一直没结束：${names} —— 这类不会报错，它就那么挂着，那一轮该干的活儿等于没干`,
      how: '这条不用你动手 —— 是我们代码里的欠账（某段外部调用没有超时保护）。回我一句「查一下卡死的那几个」我就去看 Logs 停在哪一步、补上超时',
      href: RENDER_DASHBOARD_URL,
    })
  }

  // 「跑成了但没写出东西」—— 2026-09-23 事故的形态。它必须进待办，不能只躺在
  // /dashboard/workflows-health 那张页面上：这条判据存在的全部理由就是「状态位说没坏、
  // 产出说坏了」，而只有产出这一侧是客户真正看得见的东西。
  // 停在一个要人主动去开的看板上 = 跟停在日志里没区别（CLAUDE.md 铁律 3：发现不许死在日志里）。
  if (r.silentSuccess.length > 0) {
    const names = r.silentSuccess.map((s) => `${s.service} → ${s.table}`).join('、')
    items.push({
      kind: 'cron_silent_success',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.silentSuccess.length} 个自动任务「显示跑成了，但该写的东西一行没写」：${names} —— 状态位是绿的，产出是空的，先信产出`,
      how: '打开链接看这几条的详情（每条都写了最后一行是什么时候写的）。最常见两种原因：它依赖的外部服务断了（余额用光 / 授权过期），或者写库那一步被跳过了。回我一句「查一下」我就去定位',
      href: WORKFLOWS_HEALTH_URL,
    })
  }

  // 最近一次是**报错**结束的。`health.ts` 从 2026-09-06 就算出了这一类，
  // 但 `pushCronHealthItems` 里一次都没用过 —— 算完只去了一个没人天天开的看板页
  // 和一封每天没人细看的邮件。这条把它接上（铁律 3 下半：发现不许死在日志里）。
  //
  // 合成一条，不是一个任务一条：9-22 那天今日待办一共 170 条，
  // 真告警就是这么被淹死的。
  if (r.failing.length > 0) {
    const names = r.failing.map((f) => f.service).join('、')
    // 🔴 不把原始报错贴进来：它可能带客户 id 和一长串英文技术串，
    //    跟隔壁那封日报的头注（"no client_ids, no raw error strings"）守同一条线。
    //    具体错误在链接里那个页面上，要看的人点进去看。
    items.push({
      kind: 'cron_failing',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.failing.length} 个自动任务最近一次是报错结束的：${names} —— 它们负责的活儿这一轮没干成`,
      how: '这条不用你动手 —— 多数是我们代码或某个外部账号的问题。回我一句「查一下报错的那几个」我就逐个看是代码要改、还是哪个账号要你去续费/重新授权',
      href: 'https://app.magicengine.com.au/dashboard/admin/cron-health',
    })
  }

  // 「查不出跑没跑」是我们自己的代码欠账，不该天天催 PM ——
  // 但也不能不说，否则它会永远躺在暗处。合成一条，说清楚这是开发要补的。
  if (r.blind.length > 0) {
    items.push({
      kind: 'cron_blind',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.blind.length} 个自动任务不写运行记录，跑没跑查不出来：${r.blind.map((h) => h.service).join('、')}`,
      how: '这条不用你动手 —— 是我们代码里的欠账（接口没接运行记录）。回我一句「补记录」我就去补，补完它们才进得了这套监控',
      href: RENDER_DASHBOARD_URL,
    })
  }
}


/** 广告闸门的扫描结果多久算过期 —— 每天跑一次，超过两天就是它自己也停了。 */
const AD_SWEEP_STALE_DAYS = 2

/**
 * 每天扫在投广告的结果里，凡是 blocker 就下发。
 *
 * 为什么必须落到待办（管道不许断头）：
 *   这套闸门唯一的价值就是「有人看见并去改」。停在 cron 的运行记录里 = 只有开发
 *   翻库才看得到 = 跟没扫一样。2026-08-04 那次得罪 5 个买家，事后复盘的结论不是
 *   「没查出来」，是「没人被告知」。
 *
 * 只发 blocker 不发 warn：warn 每天都有一堆，全推等于全不看。
 */
export async function pushAdReadbackItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'ad-readback-sweep')
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: AdSweepSummary | null }
    | undefined
  // 没跑过 / 过期都不在这里报 —— `pushCronHealthItems` 已经在管「该跑没跑」，
  // 两处都报会让同一件事在待办上出现两遍。
  if (!run?.summary) return
  const age = daysAgo(run.finished_at, now)
  if (age !== null && age > AD_SWEEP_STALE_DAYS) return

  for (const r of run.summary.results ?? []) {
    const bad = (r.adSets ?? []).filter((s) => s.hasBlocker)
    if (bad.length === 0) continue

    for (const s of bad) {
      const why = s.findings
        .filter((f) => f.severity === 'blocker')
        .map((f) => f.message)
        .join('　')
      // 买家实际会看到的话直接印在待办上 —— 让人当场判断，不用再登后台翻。
      const sample = s.buyerWillSee
        .flatMap((b) => b.lines)
        .slice(0, 3)
        .map((l) => `「${l}」`)
        .join('　')

      items.push({
        kind: 'ad_readback_blocker',
        client_id: r.clientId,
        client_name: r.clientName,
        what: `广告组「${s.adSetName}」正在花钱，而且撞上了已知会出事的设置：${why}${
          sample ? ` 买家现在看到的是：${sample}` : ''
        }`,
        how: '打开链接 → 找到这个广告组 → 按上面那句话改（多半是按语言拆开，或把「允许投给名单以外的人」关掉）。改完当天不用管，第二天早上这条会自己消失',
        href: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${r.adAccountId.replace(
          /^act_/,
          '',
        )}&selected_adset_ids=${s.adSetId}`,
      })
    }
  }
}

/** meta-leads-sync 跑得多稀 —— 超过这个窗口就是这条最新记录已经过期，别再报旧问题。 */
const MAILCHIMP_EXPORT_STALE_HOURS = 6

/** 只挑「非预期」失败：配置读不出来 / API key 失效 / audience 找不到 / 限流 / provider 5xx。 */
function isMailchimpExportFailureKey(key: string): boolean {
  return (
    key.startsWith('failed:') ||
    key === 'skipped:client_config_read_failed' ||
    key === 'skipped:source_tag_read_failed' ||
    // 人进了名单但来源标签没补上 —— 会员关系是真的，广告归因证据却没落地。
    // 不报的话，这一整类失败又只剩「看起来一切正常」。
    key.startsWith('already_member:tag_failed:')
  )
}

/**
 * Mailchimp 出口在 `meta-leads-sync` 每小时的 tally 里非预期失败 → 下发。
 *
 * 为什么必须下发：`lib/meta/leads-sync.ts` 把每条 lead 的 Mailchimp 结果压进
 * `results[].mailchimp` tally，但 tally 从不写进 `results[].error`——
 * `summariseFailures`（`lib/meta/leads-sync-alert.ts`）读不到它，cron 整体
 * 照样标 completed。真实事故：`clients.mailchimp_audience_id` 那一列没 apply
 * 到生产，出口每小时都因为 `client_config_read_failed` 静默 skip 掉，连着
 * 一个月没人发现（见 `lib/mailchimp/audience-config.ts` 文件头）。
 *
 * 只报 `failed:*` 和 `client_config_read_failed`：`no_audience_config` /
 * `no_email` / `no_api_key` 是客户压根没配 Mailchimp 的正常状态，报了等于
 * 天天骚扰不用管的人。
 *
 * 🔴 **不能只挑 `status = 'completed'`**：`meta-leads-sync/route.ts` 只要有
 * 任一客户 Meta 取数报错，就会把 `summariseFailures` 的结果传给 `finish()`
 * 的 `error`，`run-logger.ts` 因此把这一整轮标成 `failed` —— 但同一轮里其他
 * 客户的 `results[].mailchimp` 完全可能是真实的出口故障。只查 `completed`
 * 会让这些故障在 Meta 取数一出错的那些轮次里彻底消失。排除运行中记录该看
 * `finished_at` 是否非空，而不是硬编码某一个终态。
 */
export async function pushMailchimpExportItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'meta-leads-sync')
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const run = (data ?? [])[0] as
    | {
        finished_at: string | null
        summary: {
          results?: Array<{ clientId: string; clientName: string | null; mailchimp?: Record<string, number> }>
        } | null
      }
    | undefined
  if (!run?.summary) return

  const hoursOld = run.finished_at ? (now.getTime() - Date.parse(run.finished_at)) / 3_600_000 : null
  if (hoursOld !== null && hoursOld > MAILCHIMP_EXPORT_STALE_HOURS) return

  for (const r of run.summary.results ?? []) {
    const badKeys = Object.entries(r.mailchimp ?? {}).filter(([k]) => isMailchimpExportFailureKey(k))
    if (badKeys.length === 0) continue

    const total = badKeys.reduce((n, [, count]) => n + count, 0)
    const detail = badKeys.map(([k, count]) => `${k.replace(/^(failed|skipped):/, '')} ×${count}`).join('、')

    items.push({
      kind: 'mailchimp_export_broken',
      client_id: r.clientId,
      client_name: r.clientName ?? '未知客户',
      what: `这个客户有 ${total} 条 lead 本该进 Mailchimp 邮件名单，但出口坏了没进去：${detail}。不会自己好，客户的邮件名单会一直缺这些人`,
      how: '点链接进设置页，看「Meta 广告线索送进哪个 Mailchimp 名单」那一栏 —— 空了就把 Mailchimp 里的 Audience ID 填回去（Mailchimp → Audience → Settings → Audience name and defaults 最下面那串）；那一栏是对的话就不是配置问题，回我一句我去查授权和限流',
      href: `https://app.magicengine.com.au/dashboard/clients/${r.clientId}/settings`,
    })
  }
}

/** 报错原话摘一段进 PM 邮件：去掉路由拼的前缀和任何 uuid，不把客户 id 带进去。 */
function redactConfigReadError(raw: string): string {
  return raw
    .replace(/^.*?for this client:\s*/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .slice(0, 120)
}

/** google-data-pullback-daily 每天一轮；超过这个窗口的记录算旧账，不再报。 */
const ADS_CONFIG_READ_STALE_HOURS = 30

/**
 * 广告每日回拉读不出广告配置 → 下发到「系统欠账」。
 *
 * 为什么单独一条、不靠 `cron_failing`：这个任务常年挂着几条客户 Meta 报错，
 * 在 `cron_failing` 里永远是「报错」状态 —— 2026-09-25 读配置每次 400、所有客户的
 * 诊断和经营状态一起停了一天，混在老报错里没人看出来。这条只认 `ad_config` 这一种来源。
 *
 * 跟 `pushMailchimpExportItems` 同理：不只挑 completed —— 这类错误本身就会把那一轮标成 failed。
 */
export async function pushAdsConfigReadItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'google-data-pullback-daily')
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'failed'])
    .order('finished_at', { ascending: false })
    // 多拿几轮：提前结束的那种运行（没客户 / 读客户表失败）summary 里没有 errors，
    // 只看最新一条会让前一轮的配置读失败被它盖掉（魏征复审）。
    .limit(3)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  type Run = { finished_at: string | null; summary: { errors?: Array<{ client_id?: string; source?: string; error?: string }> } | null }
  const run = ((data ?? []) as Run[]).find((r) => Array.isArray(r.summary?.errors))
  if (!run?.summary?.errors) return

  const hoursOld = run.finished_at ? (now.getTime() - Date.parse(run.finished_at)) / 3_600_000 : null
  if (hoursOld !== null && hoursOld > ADS_CONFIG_READ_STALE_HOURS) return

  const configErrors = run.summary.errors.filter((e) => e.source === 'ad_config')
  const affected = new Set(configErrors.map((e) => e.client_id ?? '?'))
  if (affected.size === 0) return

  // 原始报错摘一段：「字段没加上」不会自己好，「一次超时」明天自己消失 —— 只有看报错才分得清
  //（子牙 / 魏征复审）。去掉路由拼的前缀和任何 uuid，不把客户 id 带进 PM 邮件。
  const detail = redactConfigReadError(configErrors[0]?.error ?? '')

  items.push({
    kind: 'ads_config_unreadable',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `广告每日回拉读不出 ${affected.size} 个客户的广告设置 —— 这些客户今天的广告诊断、经营状态、内部日报**和坏广告自动暂停**全部跳过了（广告数据本身照常在拉，钱照常在花）${detail ? `。报错原话：${detail}` : ''}。如果是数据库字段没加上，不会自己好；如果只是一次临时读取失败，明天这条会自己消失`,
    how: '这条不用你动手 —— 是我们这边的欠账。回我一句「查一下广告配置」我就去看是字段没对齐还是临时故障，并把漏掉的诊断补跑',
    href:'https://app.magicengine.com.au/dashboard/admin/cron-health',
  })
}

/**
 * 坏广告自动暂停那一步自己读不出广告设置 → 同一类系统欠账。
 *
 * 上面那条只看每日回拉的读取；回拉读成功、几分钟后自动暂停再读却失败时，唯一的痕迹是
 * `ads-d3-auto-pause` 写进 flywheel_actions 的 failed 回执（带 config_read_error）。
 * 两条不会同时出现：回拉读失败时诊断整段跳过，自动暂停根本不会被触发。
 */
export async function pushAdsAutoPauseConfigReadItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - ADS_CONFIG_READ_STALE_HOURS * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('client_id, payload')
    .eq('action_type', ADS_AUTO_PAUSE_ACTION_KEY)
    .gte('created_at', since)
    .not('payload->>config_read_error', 'is', null)
    .limit(200)

  if (error) throw new Error(`flywheel_actions query failed: ${error.message}`)

  type Row = { client_id: string; payload: { config_read_error?: unknown } | null }
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return

  const affected = new Set(rows.map((r) => r.client_id))
  const first = rows[0].payload?.config_read_error
  const detail = redactConfigReadError(typeof first === 'string' ? first : '')

  items.push({
    kind: 'ads_config_unreadable',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `过去 30 小时里，坏广告自动暂停有 ${affected.size} 个客户读不出广告设置 —— 这些客户那一轮「花钱没结果」的广告组没判要不要停（没停、也没提交审批，钱照常在花；其中可能有本来就没开自动暂停的客户）${detail ? `。报错原话：${detail}` : ''}。只是一次临时读取失败的话，过一天这条会自己消失`,
    how: '这条不用你动手 —— 是我们这边的欠账。回我一句「查一下广告配置」我就去看是字段没对齐还是临时故障',
    href: 'https://app.magicengine.com.au/dashboard/admin/cron-health',
  })
}
