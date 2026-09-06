/**
 * Meta 授权坏了 → 下发给人。
 *
 * 判据来自 `meta-auth-health` 这条 cron 自己写进运行记录的 summary
 * （跟 `comment-scope-items` 同一个套路），所以待办上说的话跟机器真做的事一致，
 * 也不用在生成清单时再问一遍 Meta。
 *
 * 🔴 为什么必须下发：Meta 授权只有人能修 —— 要拿能管理这个主页的账号去点一次
 *    授权，机器做不了。而它坏掉时系统内部一点声音都没有：
 *    `platform-oauth/token-manager.ts` 的刷新逻辑对 meta 直接抛
 *    「not yet implemented」，所以失效连库里都不留痕迹。
 *    2026-08-21 起 4 个客户线索断供 9 天、CTS 漏 45 条，就是这么没人知道的。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  META_AUTH_HEALTH_JOB,
  type MetaAuthHealth,
  type MetaAuthState,
} from '@/lib/meta/auth-health'

/** 运行记录多旧就不能用了 —— 这条 cron 每天一轮，两天足够宽松。 */
const RUN_STALE_DAYS = 2


export type MetaAuthTodoKind =
  | 'meta_auth_no_token'
  | 'meta_auth_rejected'
  | 'meta_auth_scope_missing'
  | 'meta_auth_unknown'

export interface MetaAuthTodo {
  kind: MetaAuthTodoKind
  client_id: string
  what: string
  how: string
  href: string
}

const KIND_OF: Partial<Record<MetaAuthState, MetaAuthTodoKind>> = {
  no_token: 'meta_auth_no_token',
  rejected: 'meta_auth_rejected',
  scope_missing: 'meta_auth_scope_missing',
  unknown: 'meta_auth_unknown',
}

/**
 * 重新授权就在客户设置页的「平台连接」那一栏。
 *
 * `?settings=platform` 是既有的深链参数（OAuth 回跳用的就是它，见
 * `dashboard/clients/[id]/page.tsx`），所以这个链接点开直接是那个抽屉。
 * `action-link.ts` 把 app.magicengine.com.au 列在登录类站点里，不会被链接闸拦掉。
 */
function reauthHref(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/clients/${clientId}?settings=platform`
}

/**
 * 统一的动手步骤。
 *
 * 一律指向「连接 Meta」而不是「去 Render 换环境变量」：手工令牌是 60 天到期的
 * 用户令牌，换一次只能再撑 60 天；点一次「连接 Meta」把这个客户搬到存下来的
 * 主页授权上，才是把「每 60 天必挂一次」这件事根治掉。
 *
 * 链接闸只保证链接能开，不保证有人看得懂 —— 所以步骤必须自带文字，
 * 不能只写「点链接」（见 `action-link.ts`）。
 */
const REAUTH_STEPS =
  '点链接打开这个客户的设置 →「平台连接」那一栏 → 用能管理这个 Facebook 主页的' +
  '账号点一次「连接 Meta」，授权页面上把要的权限全部勾上（尤其是发帖和读客资那几项）→ ' +
  '回来刷新一下，这条待办第二天体检时会自己消失。'

function pageSuffix(pageId: string | null): string {
  return pageId ? `（主页 ${pageId}）` : ''
}

/** 一个客户的一次体检结果 → 最多一条待办。健康的、没登记主页的都不下发。 */
export function buildMetaAuthTodo(h: MetaAuthHealth): MetaAuthTodo | null {
  const kind = KIND_OF[h.state]
  if (!kind) return null

  const page = pageSuffix(h.page_id)
  const metaSays = h.provider_error ? ` Meta 的原话：${h.provider_error}` : ''

  if (h.state === 'rejected') {
    return {
      kind,
      client_id: h.client_id,
      what:
        `这个客户的 Facebook 授权${page}已经失效了 —— Meta 现在拒绝我们用它。` +
        '受影响的不只一处：发帖发不出去、客人的私信和评论读不进来、即时表单里的' +
        `客资也拿不回来，而这几件事在界面上都会显示成「今天没有」。${metaSays}`,
      how: REAUTH_STEPS,
      href: reauthHref(h.client_id),
    }
  }

  if (h.state === 'no_token') {
    return {
      kind,
      client_id: h.client_id,
      what:
        `这个客户登记了 Facebook 主页${page}，但系统里找不到它自己的授权 —— ` +
        '所有跟这个主页有关的功能（发帖、私信、评论、客资）现在都是空的，' +
        `而不是「没有内容」。${metaSays}`,
      how: REAUTH_STEPS,
      href: reauthHref(h.client_id),
    }
  }

  if (h.state === 'scope_missing') {
    const missing = h.missing_scopes.join('、')
    return {
      kind,
      client_id: h.client_id,
      what:
        `这个客户的 Facebook 授权${page}还能用，但少了几项权限：${missing}。` +
        '少哪项就哑哪块，而且是静默的 —— 2026-08 少了读客资那一项，' +
        '4 个客户的线索断供 9 天，CTS 一家漏了 45 条才有人发现。',
      how: REAUTH_STEPS,
      href: reauthHref(h.client_id),
    }
  }

  // unknown —— 问不到 Meta。不许当成没问题（见 auth-health.ts 文件头规矩 1）。
  return {
    kind,
    client_id: h.client_id,
    what:
      `这个客户的 Facebook 授权${page}今天问不出状态 —— 不是「没问题」，是我们没能` +
      `确认它到底还能不能用。${metaSays}`,
    how:
      '先按下面这步走一遍，看设置页上「平台连接」那一栏显示什么：' +
      REAUTH_STEPS +
      ' 如果那一栏看起来正常，回我一句「Meta 体检问不到」，我去查是不是我们这边的问题。',
    href: reauthHref(h.client_id),
  }
}

/** 上一轮跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

interface MetaAuthRunSummary {
  results?: MetaAuthHealth[]
}

export async function fetchMetaAuthTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<MetaAuthTodo[]> {
  // 🔴 只认最近一条**真正写下了 summary** 的运行 —— 不是最新那一行。
  //
  // startCronRun 一开跑就先插一行 status='running'（summary 还是空的），summary
  // 要 finish() 才写；失败兜底调 finish 也不带 summary。所以最新那一行随时可能是
  // 「正在跑 / 超时卡死 / 失败没结果」——这几种都**不代表没问题**，只代表这一轮还
  // 没给出结果。用 `.not('summary','is',null)` 让数据库直接跳过它们、只回带结果的
  // 完成轮，取其中最新一条。这样不管前面堆了多少行没结果的（同一天超时后被反复
  // 手动重跑，会堆很多），都撑不爆、也漏不掉昨天那条 CTS 失效。若改回「取最新一行
  // 再看有没有 summary」，那一刻这道本该报警的待办就会自己闭嘴，昨天已知的失效被
  // 静默抹掉 —— 正是这个功能存在的意义要消灭的事（mailbox-run.ts 文件头记着同一个
  // 坑；comment-scope-items 那个模板没防住）。「该跑没跑」另有 pushCronHealthItems
  // 负责（本 cron 已登记进 CRON_REGISTRY），这里不重复报。
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', META_AUTH_HEALTH_JOB)
    .not('summary', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: MetaAuthRunSummary | null }
    | undefined
  if (!run?.summary) return []

  // 「该跑没跑」有 pushCronHealthItems 在管，这里不重复报，只在结果够新时说话。
  const age = daysSince(run.finished_at, now)
  if (age === null || age > RUN_STALE_DAYS) return []

  const todos: MetaAuthTodo[] = []
  for (const h of run.summary.results ?? []) {
    // 这是**已经落库的旧数据**，当外部输入处理：client_id 不是字符串就整条丢掉，
    // 绝不让一条形状不对的记录把待办挂到别的客户名下。
    if (!h || typeof h.client_id !== 'string' || h.client_id.length === 0) continue
    const todo = buildMetaAuthTodo(h)
    if (todo) todos.push(todo)
  }
  return todos
}
