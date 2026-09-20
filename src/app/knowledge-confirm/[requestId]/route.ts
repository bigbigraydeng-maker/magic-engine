/**
 * GET  /knowledge-confirm/<requestId>?token=<raw>
 * POST /knowledge-confirm/<requestId>   (form body: token, nonce, choice:<factId>, note:<factId>, intent)
 *
 * 客户确认页（issue #1646，design doc §9.4 / §9.10 / §9.14 A.D）。
 *
 * 收件人是客户公司的老板或经理，没有 dashboard 账号，也不该为了点一次「对」
 * 去注册一个。所以这条路由**不走登录态**：身份来自链接里那个一次性令牌绑定
 * 的邮箱，不接受页面上手填的任何名字。
 *
 * 🔴 打开链接不等于确认（§9.14 A.D，照抄 `src/app/auth/invite-landing/route.ts`
 * 的结构）：
 *   - GET 只读、只渲染，不消费令牌、不写任何一个字段。邮件安全扫描器和链接
 *     预览机器人会把邮件里每个 URL 都 GET 一遍；如果打开就算确认，等于让扫
 *     描器替客户把价格签了。
 *   - 只有 POST 会写，而且必须同时满足：同源请求 + 页面自己发的一次性
 *     nonce cookie 对得上 + 令牌哈希对得上。
 *
 * 🔴 这条路由 `force-dynamic`：它依赖查询参数和 cookie，绝不能被静态化或被
 *    任何中间缓存留下一份带令牌的副本。
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID, timingSafeEqual } from 'crypto'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { supabaseAdmin } from '@/lib/supabase'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import {
  CONFIRMATION_BATCH_BLOCK_SIZE,
  consumeConfirmationRequest,
  describeLinkProblem,
  hashConfirmationToken,
  loadConfirmationRequest,
  type ConfirmationFactView,
  type ConfirmationLinkView,
  type FactChoice,
} from '@/lib/knowledge/confirmation-requests'
import { getRegisteredConfirmerEmails } from '@/lib/knowledge/confirmers'
import { checkConfirmerIdentity } from '@/lib/knowledge/dual-sign'
import { stopAiRepliesForClient } from '@/lib/knowledge/kill-switch'
import { asRows } from '@/lib/knowledge/write-client'
import {
  CONFIRMATION_CHANGE_LEAD_TIME_NOTE,
  CONFIRMATION_QUALITY_ASSURANCE_NOTE,
  CONFIRMATION_RESPONSIBILITY_NOTE,
  sendKnowledgeConfirmationReceipt,
} from '@/lib/email/knowledge-confirmation'

export const dynamic = 'force-dynamic'

const NONCE_COOKIE = 'me-knowledge-confirm-nonce'
const NONCE_MAX_AGE_SECONDS = 3600 // 一小时 —— 客户可能要打电话问一下老板再点

type Params = { params: { requestId: string } }

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 页面 URL 里带着一次性令牌，任何一层缓存留副本都是泄露。
      'cache-control': 'no-store, no-cache, must-revalidate',
      // URL 本身就是密钥，绝不能跟着 Referer 头发给任何第三方——但不能用
      // 'no-referrer'（issue #1822，同一套安全姿态在 knowledge-rollout-confirm
      // 复现过）：Fetch 规范规定 referrer policy 是 no-referrer 时，浏览器
      // 对同页表单自己发出的 POST 也会把 Origin 头置成字符串 "null"，不
      // 区分是不是同源提交——下面 POST 处理里那道「同源」CSRF 闸因此在真实
      // 浏览器点击下必然判定失败。'same-origin' 两头都要：跨域请求（唯一
      // 可能泄露给第三方的路径）Referer 仍然整段不发；真正同源提交时
      // Origin 不会被置空，闸能正常判。
      'referrer-policy': 'same-origin',
    },
  })
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  )
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function cookiePathFor(requestId: string): string {
  return `/knowledge-confirm/${requestId}`
}

// ── 页面外壳 ────────────────────────────────────────────────────────────────

const PAGE_CSS = `
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f6f3;margin:0;color:#2a2a2a;line-height:1.6}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 8px}
.lede{color:#555;font-size:15px;margin:0 0 20px}
.block{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.block h2{font-size:14px;color:#8a8577;margin:0 0 12px}
.row{border-top:1px solid #eee;padding:14px 0}
.row:first-of-type{border-top:none}
.say{font-size:16px;font-weight:600;margin:0 0 10px}
.say span{font-weight:400;color:#8a8577;font-size:13px;display:block}
.choices label{display:inline-block;margin-right:16px;font-size:15px;cursor:pointer}
textarea{width:100%;box-sizing:border-box;margin-top:8px;border:1px solid #ddd;border-radius:8px;padding:8px;font-family:inherit;font-size:14px}
.note{background:#faf6ef;border-left:3px solid #B8863A;padding:10px 12px;font-size:14px;margin:16px 0}
.stale{background:#f3f3f3;color:#777;font-size:14px;border-radius:8px;padding:10px 12px}
.conflict{background:#fff6f5;border-left:3px solid #C2453A;padding:10px 12px;font-size:14px;margin-bottom:12px}
button.primary{width:100%;padding:14px;border:none;border-radius:10px;background:#B8863A;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button.stop{width:100%;margin-top:12px;padding:12px;border:1px solid #C2453A;border-radius:10px;background:#fff;color:#C2453A;font-size:15px;font-weight:600;cursor:pointer}
.foot{color:#999;font-size:12px;text-align:center;margin-top:24px}
`

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style></head>
<body><div class="wrap">${inner}</div></body></html>`
}

function messagePage(title: string, message: string): string {
  return shell(title, `<div class="block"><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(message)}</p></div>`)
}

/**
 * §9.10：一组 ≤5 行 —— 但同一个 conflict_group_id 的几条必须落在同一组里，
 * 否则客户根本看不到两个版本摆在一起，"这几条是同一件事的不同说法"这句
 * 提示就是废话（板桥客户体验复审 2026-09-14 抓到：原来的 chunk() 只管数量、
 * 不管分组，纯粹按顺序切，冲突组号在第 5/6 条边界就可能被切开）。
 *
 * 先把同一个冲突组的条目聚成一簇，再按簇（不拆簇）装进 ≤size 的组；单簇本
 * 身超过 size 时只能让这一组超一点点——"看到完整的两个版本"比"严格 5 条
 * 一组"更重要。
 */
function groupFactsByConflict(facts: ConfirmationFactView[]): ConfirmationFactView[][] {
  const clusters: ConfirmationFactView[][] = []
  const clusterIndexByGroup = new Map<string, number>()
  for (const fact of facts) {
    if (fact.conflictGroupId) {
      const existingIndex = clusterIndexByGroup.get(fact.conflictGroupId)
      if (existingIndex !== undefined) {
        clusters[existingIndex].push(fact)
        continue
      }
      clusterIndexByGroup.set(fact.conflictGroupId, clusters.length)
    }
    clusters.push([fact])
  }
  return clusters
}

function chunkClusters<T>(clusters: T[][], size: number): T[][] {
  const out: T[][] = []
  let current: T[] = []
  for (const cluster of clusters) {
    if (current.length > 0 && current.length + cluster.length > size) {
      out.push(current)
      current = []
    }
    current.push(...cluster)
    if (current.length >= size) {
      out.push(current)
      current = []
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

function factRow(fact: ConfirmationFactView): string {
  if (fact.changedSinceSent) {
    // 🔴 §9.5：发链接之后我们改过这条，客户现在看到的和他要签的不是同一版。
    // 不摆出来让他点——摆出来点了也不会生效，那是在骗他。
    return `<div class="row"><div class="stale">这一条我们刚做过改动，为了不让你确认到你没看过的版本，这次先不收。我们会重发一条新的给你。</div></div>`
  }
  const id = escapeHtml(fact.factId)
  const until = fact.validUntil
    ? `<span>有效期到 ${escapeHtml(new Date(fact.validUntil).toLocaleDateString('zh-CN'))}</span>`
    : ''
  return `<div class="row">
  <p class="say">AI 以后会这样回复顾客：${escapeHtml(fact.statement)}${until}</p>
  <div class="choices">
    <label><input type="radio" name="choice:${id}" value="confirm"/> 对，就这么说</label>
    <label><input type="radio" name="choice:${id}" value="reject"/> 需要修改</label>
  </div>
  <textarea name="note:${id}" rows="2" placeholder="需要修改的话，写一句正确的说法（选填）"></textarea>
</div>`
}

function confirmPage(view: ConfirmationLinkView, nonce: string, rawToken: string): string {
  const who = view.clientName ? `${view.clientName}` : '你的账户'
  const blocks = chunkClusters(groupFactsByConflict(view.facts), CONFIRMATION_BATCH_BLOCK_SIZE)
  // 一个冲突组号在这一批里出现两次以上，才说明客户真的在这页上看到了两种
  // 互相矛盾的说法；只出现一次的组号（另一条不在这批里）提示了也没用。
  const groupCounts = new Map<string, number>()
  for (const fact of view.facts) {
    if (fact.conflictGroupId) groupCounts.set(fact.conflictGroupId, (groupCounts.get(fact.conflictGroupId) ?? 0) + 1)
  }
  const conflictIds = new Set(Array.from(groupCounts.entries()).filter(([, n]) => n > 1).map(([g]) => g))

  const blockHtml = blocks
    .map((block, index) => {
      const hasConflict = block.some((f) => f.conflictGroupId && conflictIds.has(f.conflictGroupId))
      const conflictNote = hasConflict
        ? `<div class="conflict">这一组里有同一件事的几种不同说法 —— 你们的同事在不同时间对顾客说过不一样的版本。请只确认正确的那一条，其余点「需要修改」并写一句为什么（比如：这是空运价 / 这是旧价 / 这是另一条线路）。</div>`
        : ''
      const heading = blocks.length > 1 ? `<h2>第 ${index + 1} 组 · 共 ${blocks.length} 组</h2>` : ''
      return `<div class="block">${heading}${conflictNote}${block.map(factRow).join('')}</div>`
    })
    .join('')

  return shell(
    `确认 ${who} 的 AI 回复说法`,
    `<h1>请你确认一下</h1>
<p class="lede">下面每一句，都是 AI 以后回复顾客时会用的说法。<strong>你点「对」的那几条，AI 才会说；没点的，AI 遇到会转给你们的人。</strong></p>
<form method="POST">
<input type="hidden" name="token" value="${escapeHtml(rawToken)}"/>
<input type="hidden" name="nonce" value="${escapeHtml(nonce)}"/>
${blockHtml}
<div class="note">${escapeHtml(CONFIRMATION_RESPONSIBILITY_NOTE)}<br/>${escapeHtml(CONFIRMATION_CHANGE_LEAD_TIME_NOTE)}<br/>${escapeHtml(CONFIRMATION_QUALITY_ASSURANCE_NOTE)}</div>
<button class="primary" type="submit" name="intent" value="confirm">提交我的确认</button>
<button class="stop" type="submit" name="intent" value="stop_ai" formnovalidate>先别让 AI 回复顾客（立刻停掉）</button>
</form>
<p class="foot">这个页面是发给 ${escapeHtml(view.confirmerEmail)} 的，链接只能用一次。</p>`,
  )
}

/**
 * 已经用过的链接 —— 板桥客户体验复审 2026-09-14 抓到：以前这种情况只渲染
 * 一句"这批内容已经确认过了"就完了，客户想反悔叫停 AI 却根本找不到按钮，
 * 跟设计稿"客户也有停止 AI 回复按钮，不只 ME 能按"（§9.10）直接矛盾。
 * `handleStopAi` 本身从来就不检查链接是否已用过（见其函数注释），缺的只是
 * 这张页面——现在补上停止表单，跟 confirmPage 用同一套 nonce/CSRF 机制。
 */
function alreadyUsedPage(nonce: string, rawToken: string): string {
  return shell(
    '这批内容已经确认过了',
    `<div class="block">
<h1>这批内容已经确认过了</h1>
<p class="lede">不用再点一次。如果你改主意了，想让我们先别让 AI 自动回复顾客，可以随时点下面这个按钮——跟这批内容是否已经确认过没关系。</p>
<form method="POST">
<input type="hidden" name="token" value="${escapeHtml(rawToken)}"/>
<input type="hidden" name="nonce" value="${escapeHtml(nonce)}"/>
<button class="stop" type="submit" name="intent" value="stop_ai" formnovalidate>先别让 AI 回复顾客（立刻停掉）</button>
</form>
</div>`,
  )
}

// ── GET：只看，不改任何东西 ─────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const origin = getPublicOrigin(request)
  const rawToken = new URL(request.url).searchParams.get('token') ?? ''
  if (!rawToken) {
    return htmlResponse(messagePage('链接不完整', describeLinkProblem('bad_token')), 400)
  }

  let result
  try {
    result = await loadConfirmationRequest(knowledgeWriteClient(), {
      requestId: params.requestId,
      rawToken,
    })
  } catch {
    // 读库出问题绝不渲染成一张空白的「没有要确认的内容」——那会让客户以为
    // 事情已经办完了。
    return htmlResponse(
      messagePage('暂时打不开', '我们这边出了点问题，暂时读不到这批内容。过几分钟再点一次这个链接；还是不行就回邮件告诉我们。'),
      500,
    )
  }

  if (!result.ok) {
    // 🔴 已经用过的链接仍要让客户能按到"停止 AI 回复"——那个按钮不要求
    //    链接还没被用过（见 handleStopAi 的注释），缺的只是这张页面本身。
    //    其余问题（令牌不对/过期/身份不对）没有可信身份可用，维持原样。
    if (result.problem === 'already_used') {
      const nonce = randomUUID()
      const response = htmlResponse(alreadyUsedPage(nonce, rawToken))
      setNonceCookie(response, nonce, origin, params.requestId)
      return response
    }
    return htmlResponse(messagePage('这个链接用不了', describeLinkProblem(result.problem)), 200)
  }

  // 🔴 只在这里发 nonce，不做任何写入。扫描器把这个 URL 预取一遍，最多拿到
  //    一张 HTML 和一个它无法跨源转发到 POST 的 cookie。
  const nonce = randomUUID()
  const response = htmlResponse(confirmPage(result, nonce, rawToken))
  setNonceCookie(response, nonce, origin, params.requestId)
  return response
}

function setNonceCookie(response: NextResponse, nonce: string, origin: string, requestId: string): void {
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'strict',
    secure: origin.startsWith('https://'),
    path: cookiePathFor(requestId),
    maxAge: NONCE_MAX_AGE_SECONDS,
  })
}

// ── POST：唯一会写东西的路径 ────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Params) {
  const origin = getPublicOrigin(request)
  const form = await request.formData()
  const rawToken = form.get('token')
  const submittedNonce = form.get('nonce')
  const intent = form.get('intent')

  const burn = (res: NextResponse) => {
    res.cookies.delete({ name: NONCE_COOKIE, path: cookiePathFor(params.requestId) })
    return res
  }

  // CSRF 闸 1：同源。现代浏览器 POST 一定带 Origin；没有就是不安全，拒绝。
  const canonical = origin.replace(/\/$/, '')
  const requestOrigin = request.headers.get('origin')
  if (!requestOrigin || requestOrigin.replace(/\/$/, '') !== canonical) {
    return burn(htmlResponse(messagePage('提交没有成功', '请回到邮件里重新点开链接再试一次。'), 403))
  }

  // CSRF 闸 2：GET 发下来的一次性 nonce，常量时间比较。
  const cookieNonce = cookies().get(NONCE_COOKIE)?.value
  if (
    typeof submittedNonce !== 'string' ||
    !submittedNonce ||
    !cookieNonce ||
    !timingSafeEqualStrings(submittedNonce, cookieNonce)
  ) {
    return burn(htmlResponse(messagePage('提交没有成功', '这个页面停留太久了。请回到邮件里重新点开链接再试一次。'), 403))
  }

  if (typeof rawToken !== 'string' || !rawToken) {
    return burn(htmlResponse(messagePage('链接不完整', describeLinkProblem('bad_token')), 400))
  }

  const sb = knowledgeWriteClient()

  if (intent === 'stop_ai') {
    return burn(await handleStopAi(sb, params.requestId, rawToken))
  }

  const { choices, notes } = parseChoices(form)

  let result
  try {
    result = await consumeConfirmationRequest(sb, { requestId: params.requestId, rawToken, choices, notes })
  } catch {
    return burn(
      htmlResponse(
        messagePage('没有保存成功', '我们这边出了点问题，你刚才的选择没有保存。请回到邮件里重新点开链接再试一次。'),
        500,
      ),
    )
  }

  if (!result.ok) {
    return burn(htmlResponse(messagePage('这个链接用不了', describeLinkProblem(result.problem)), 200))
  }

  await sendReceipt(result.clientId, result.confirmerEmail, result.confirmedFactIds, result.rejectedFactIds, result.staleFactIds)

  // 🔴 板桥客户体验复审 2026-09-14 抓到：一条都没确认时说"你确认了 0
  //    条，AI 从现在起会按这些说法回复顾客"，指代的"这些说法"是空集合，
  //    自相矛盾。0 条和 ≥1 条要用两句不同的话，不能只是把数字代进模板。
  const parts =
    result.confirmedFactIds.length > 0
      ? [`你确认了 ${result.confirmedFactIds.length} 条，AI 从现在起会按这些说法回复顾客。`]
      : ['这次你没有确认任何一条，AI 遇到这些问题会转给你们的人，不会自己乱答。']
  if (result.rejectedFactIds.length > 0) {
    parts.push(`有 ${result.rejectedFactIds.length} 条你说要改 —— 这几条 AI 不会说，遇到会转给你们的人。${CONFIRMATION_CHANGE_LEAD_TIME_NOTE}`)
  }
  if (result.staleFactIds.length > 0) {
    parts.push(`有 ${result.staleFactIds.length} 条我们刚改动过，这次没收进去，我们会重发一条新链接给你。`)
  }
  parts.push('回执已经发到你的邮箱了。')

  return burn(htmlResponse(messagePage('收到了，谢谢', parts.join(' ')), 200))
}

/** `choice:<factId>` / `note:<factId>` —— 用前缀而不是索引，避免表单顺序变了就对错行。 */
function parseChoices(form: FormData): { choices: Record<string, FactChoice>; notes: Record<string, string> } {
  const choices: Record<string, FactChoice> = {}
  const notes: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue
    if (key.startsWith('choice:')) {
      const factId = key.slice('choice:'.length)
      if (value === 'confirm' || value === 'reject') choices[factId] = value
    } else if (key.startsWith('note:')) {
      notes[key.slice('note:'.length)] = value
    }
  }
  return { choices, notes }
}

/**
 * 「先别让 AI 回复顾客」（§9.10）。
 *
 * 跟确认不同，它**不要求链接还没被用过**：客户可能昨天刚确认完，今天发现
 * 报价说错了要立刻叫停。只要令牌对得上、链接没过期、按的人确实还是登记在
 * 案的确认人，就让他停。停不是一个撤不回的对外动作，它是**收回**一个对外
 * 动作——门槛高于必要只会害人。
 */
async function handleStopAi(
  sb: ReturnType<typeof knowledgeWriteClient>,
  requestId: string,
  rawToken: string,
): Promise<NextResponse> {
  // 🔴 走 sb（knowledgeWriteClient()），不直接用 supabaseAdmin —— admin-client.ts
  // 的注释写明"整个代码库里只有那一行需要被审计"，这里绕开会让以后任何在
  // 那一行做拦截/审计/换客户端的人漏看这个调用点（魏征复审 2026-09-14）。
  const queryResult = await sb
    .from('client_knowledge_confirmation_requests')
    .select('id, client_id, confirmer_email, token_hash, expires_at')
    .eq('id', requestId)
  const rows = asRows<{ client_id: string; confirmer_email: string; token_hash: string; expires_at: string }>(
    queryResult.data,
  )
  if (queryResult.error || rows.length === 0) {
    return htmlResponse(messagePage('这个链接用不了', describeLinkProblem('not_found')), 200)
  }
  const row = rows[0]

  // 🔴 常量时间比较，跟本文件其余令牌比较（timingSafeEqualStrings）、以及
  // confirmation-requests.ts 的 hashesMatch 保持一致的写法（魏征复审
  // 2026-09-14：这里之前是裸 `!==`。核实过 SHA256 的雪崩效应让这条时序侧
  // 信道即使被完美利用也拿不到可用的原始令牌，不构成真实漏洞，但统一写法
  // 经得住下一次静态扫描或复审追问，不留一个看着不一致的比较）。
  if (!timingSafeEqualStrings(row.token_hash, hashConfirmationToken(rawToken))) {
    return htmlResponse(messagePage('这个链接用不了', describeLinkProblem('bad_token')), 200)
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    return htmlResponse(messagePage('这个链接已经过期', describeLinkProblem('expired')), 200)
  }

  const registered = await getRegisteredConfirmerEmails(row.client_id, sb)
  const problem = checkConfirmerIdentity({
    confirmerEmail: row.confirmer_email,
    approverEmail: null,
    registeredConfirmerEmails: registered,
  })
  if (problem) {
    return htmlResponse(messagePage('没能停下来', describeLinkProblem(problem)), 200)
  }

  try {
    const result = await stopAiRepliesForClient(sb, {
      clientId: row.client_id,
      actorEmail: row.confirmer_email,
      reason: '客户在确认页上点了「先别让 AI 回复顾客」',
      source: 'knowledge_confirmation_page',
    })
    // 日志没记上不影响「已经停了」这个事实，但要如实说出来，别让客户以为
    // 一切都完美无缺。
    const tail = result.auditWarning ? '（这次操作没能记进我们的日志，我们会人工补上。）' : ''
    return htmlResponse(
      messagePage(
        '已经停了',
        `AI 现在不会再自动回复顾客了。要重新打开，请联系 Magic Engine 团队 —— 这一步我们不会自己做主。${tail}`,
      ),
      200,
    )
  } catch {
    return htmlResponse(
      messagePage(
        '没能停下来',
        '我们这边出了点问题，没能停掉。请立刻回邮件或打电话给 Magic Engine 团队，我们手动帮你停。',
      ),
      500,
    )
  }
}

async function sendReceipt(
  clientId: string,
  to: string,
  confirmedIds: string[],
  rejectedIds: string[],
  staleIds: string[],
): Promise<void> {
  const ids = [...confirmedIds, ...rejectedIds]
  const statementById = new Map<string, string>()
  if (ids.length > 0) {
    const { data } = await supabaseAdmin
      .from('client_knowledge_facts')
      .select('id, statement')
      .eq('client_id', clientId)
      .in('id', ids)
    for (const row of (data ?? []) as Array<{ id: string; statement: string }>) {
      statementById.set(row.id, row.statement)
    }
  }
  const { data: clientRow } = await supabaseAdmin.from('clients').select('name').eq('id', clientId).maybeSingle()

  // 回执是尽力而为：发不出去不该让客户看到一个「确认失败」的页面——他的
  // 确认已经真的落库了。
  await sendKnowledgeConfirmationReceipt({
    to,
    clientName: (clientRow as { name?: string } | null)?.name ?? '你的账户',
    confirmedStatements: confirmedIds.map((id) => statementById.get(id) ?? '(这一条的内容已更新)'),
    changeRequestedStatements: rejectedIds.map((id) => statementById.get(id) ?? '(这一条的内容已更新)'),
    needsFreshLinkCount: staleIds.length,
    confirmedAt: new Date().toISOString(),
  }).catch(() => undefined)
}
