/**
 * 评论自动回复读不到评论 → 下发给人。
 *
 * 🔴 2026-08-15 实测：CTS 的评论 cron 每半小时扫 149 个帖子，其中一批固定回
 *    Meta 的 400 —— 最要命的一类是 `(#10) 需要 pages_read_user_content 权限`：
 *    **令牌没有「读别人写的评论」这项权限**。于是客人在帖子下面提的问题，
 *    系统一条都看不见，而那一轮 cron 照样记成 `ok: true, new_comments: 0`。
 *
 *    这正是「发现死在日志里」：唯一的痕迹是 Render 日志里一行 console.error，
 *    没有任何人会去翻。权限只有人能补（要拿管理员账号点授权），所以必须下发。
 *
 * 另一类是令牌整个被拒（#190 过期 / 被撤销）—— 同样只有人能换。
 *
 * 判据取自 cron 自己写进运行记录的那份 summary（跟 `ad_readback_blocker` 同一
 * 个套路）：说的话跟机器真做的事永远一致，也不用再查一遍 Meta。
 *
 * 「帖子不存在」「老式端点已下线」那两类**不下发** —— 人做不了什么，
 * 机器已经把它们记进跳过名单不再重试了。下发等于制造噪音。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 运行记录多旧就不能用了 —— 这个 cron 每 30 分钟一轮，两天足够宽松。 */
const RUN_STALE_DAYS = 2

/** Meta 的令牌工具首页 —— 登录类站点，稳定入口不是深链。 */
const GRAPH_EXPLORER_URL = 'https://developers.facebook.com/tools/explorer/'

/** 只声明这条读得到的字段：这是**已经落库的旧数据**，当外部输入处理。 */
export interface CommentRunResult {
  client_id: string
  page_id?: string
  posts_scanned?: number
  permission_denied_count?: number
  permission_denied_sample?: string[]
  token_invalid?: string
}

interface CommentRunSummary {
  results?: CommentRunResult[]
}

export type CommentScopeTodoKind = 'comment_scope_missing' | 'comment_token_invalid'

export interface CommentScopeTodo {
  kind: CommentScopeTodoKind
  client_id: string
  what: string
  how: string
  href: string
}

/**
 * Render 后台里那条环境变量叫什么，取决于当初是按域名配的还是用的公共那条。
 * 与其猜一个名字让人白找，不如说清怎么认出它。
 */
const REPLACE_TOKEN_STEPS =
  '复制生成的令牌 → 打开 Render 后台的 crazycontent 服务 → Environment → ' +
  '找到名字以 META_SYSTEM_USER_TOKEN 开头的那一条（可能带客户后缀，比如 ' +
  '..._CTSTOURS_CO_NZ；只有一条就是它）→ 把值换成新令牌 → Save。' +
  '换完不用管，最多半小时这条待办会自己消失。'

/**
 * 一个客户的一轮结果 → 最多一条待办。
 *
 * 令牌整个被拒时只报令牌那条：权限不够是令牌能用的前提下才谈得上的事，
 * 两条一起摆出来只会让人不知道先做哪个。
 */
export function buildCommentScopeTodo(r: CommentRunResult): CommentScopeTodo | null {
  const page = r.page_id ? `（${r.page_id}）` : ''

  if (r.token_invalid) {
    return {
      kind: 'comment_token_invalid',
      client_id: r.client_id,
      what:
        `这个客户的 Facebook 令牌${page}被 Meta 拒了，评论自动回复整个停了 —— ` +
        `客人在帖子下面问什么，系统现在一条都看不见。Meta 的原话：${r.token_invalid.slice(0, 120)}`,
      how:
        '打开链接（Meta 的令牌工具）→ 右上角选我们的 Facebook 应用 → ' +
        '用能管理这个主页的账号点 Generate Access Token 重新授权 → ' +
        REPLACE_TOKEN_STEPS,
      href: GRAPH_EXPLORER_URL,
    }
  }

  const denied = r.permission_denied_count ?? 0
  if (denied <= 0) return null

  const scanned = r.posts_scanned
  // 带上分母：「12 个」和「149 个里的 12 个」是两件事
  const scale = typeof scanned === 'number' && scanned > 0 ? `${scanned} 个帖子里有 ${denied} 个` : `${denied} 个帖子`
  const sample = (r.permission_denied_sample ?? []).slice(0, 3)
  const sampleText = sample.length > 0 ? `（比如 ${sample.join('、')}）` : ''

  return {
    kind: 'comment_scope_missing',
    client_id: r.client_id,
    what:
      `这个客户的 Facebook 主页${page}上，${scale}读不到评论${sampleText} —— ` +
      'Meta 说我们的令牌少了「读别人写的评论」这项权限（pages_read_user_content）。' +
      '这些帖子下面客人的提问，系统看不见，也就不会有人回。',
    how:
      '打开链接（Meta 的令牌工具）→ 右上角选我们的 Facebook 应用 → ' +
      '点 Add a Permission，勾上 pages_read_user_content → ' +
      '用能管理这个主页的账号点 Generate Access Token 确认 → ' +
      REPLACE_TOKEN_STEPS,
    href: GRAPH_EXPLORER_URL,
  }
}

/** 上一轮跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

export async function fetchCommentScopeTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<CommentScopeTodo[]> {
  // 🔴 只认真正写下了 summary 的那一轮 —— 不是最新那一行，也不是「最新几行里」的
  // 某一行。
  //
  // startCronRun 一开跑就先插一行 status='running'（summary 还是空的），summary
  // 要 finish() 才写。所以最新那一行随时可能是「正在跑 / 超时卡死没 finish / 失败
  // 没带 summary」——这几种都**不代表没问题**，只代表这一轮还没给出结果。若照
  // `rows[0]?.summary` 取最新一行，那一刻这道本该报警的待办会自己闭嘴，昨天已知的
  // 「评论读不到 / 令牌被拒」被静默抹掉 —— 正是这个功能存在的意义要消灭的事。
  //
  // 早先版本改成「往回翻几行找一条有 summary 的」，但这个 cron 每 30 分钟一轮，
  // 5 行只盖 2.5 小时：连续 5 轮超时/失败不带 summary（约 2.5 小时内就可能发生）
  // 会把查询窗口外、仍在 RUN_STALE_DAYS 两天有效期内的上一条好结果也漏掉，待办
  // 照样静默消失 —— 跟只看最新一行是同一种 fail-open，只是需要更久触发。所以改
  // 在查询端直接过滤，取真正的最近一条，不受回看行数限制
  // （mailbox-run.ts 文件头 + meta-auth-health-items.ts 记着同一个坑）。
  //
  // 过滤条件是 summary->>results 非空，而不是只看 summary 非空：finish() 写 summary
  // 也不保证带 results —— kill 开关那轮写 `{ killed: true }`（route.ts），非空却没有
  // results。只判「summary 非空」会取到它、loop 空 results 出 0 条待办，kill 开关一
  // 开着（可长时间）就把仍有效的上一条「评论读不到 / 令牌被拒」静默盖掉，又是同一
  // 种 fail-open。按 results 是否存在过滤，running/失败(summary=null)、kill(无 results)
  // 全排除；无配置成功轮写 `{ results: [] }`（route.ts），results 存在故保留，正确识别
  // 为「已确认无问题」而不回落到更早的旧报错。
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'social-comment-autoreply')
    .not('summary->>results', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)

  const run = (data?.[0] ?? null) as {
    finished_at: string | null
    summary: CommentRunSummary | null
  } | null
  if (!run?.summary) return []

  // 「该跑没跑」有 pushCronHealthItems 在管，这里不重复报，只在结果够新时说话
  const age = daysSince(run.finished_at, now)
  if (age === null || age > RUN_STALE_DAYS) return []

  const todos: CommentScopeTodo[] = []
  for (const r of run.summary.results ?? []) {
    if (!r || typeof r.client_id !== 'string') continue
    const todo = buildCommentScopeTodo(r)
    if (todo) todos.push(todo)
  }
  return todos
}
