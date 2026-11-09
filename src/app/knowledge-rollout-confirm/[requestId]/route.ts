/**
 * GET  /knowledge-rollout-confirm/<requestId>?token=<raw>
 * POST /knowledge-rollout-confirm/<requestId>   (form body: token, nonce)
 *
 * 客户「阶段切换」确认页（issue #1648，design doc §7.3 / §9.10 / §9.14 A.D，
 * 板桥客户体验复审："阶段号别裸给客户看"）。
 *
 * 结构逐字照抄 `src/app/knowledge-confirm/[requestId]/route.ts`（issue #1646）
 * 的安全姿态——同源 + CSRF nonce + GET 只读、POST 才写——不重新发明：
 *
 *   - GET 只读、只渲染，不消费令牌、不写任何一个字段。邮件安全扫描器和链接
 *     预览机器人会把邮件里每个 URL 都 GET 一遍；如果打开就算确认，等于让
 *     扫描器替客户把阶段切换签了。
 *   - 只有 POST 会写，而且必须同时满足：同源请求 + 页面自己发的一次性
 *     nonce cookie 对得上 + 令牌哈希对得上（这两层都在
 *     `consumeRolloutAdvanceRequest` 内部再核一遍，路由这里的 nonce 是
 *     CSRF 闸，不是身份闸）。
 *
 * 跟 #1646 的确认页不同的地方：这里没有「停止 AI 回复」的次要按钮——阶段
 * 切换本身就是单一动作（同意/不点），不像事实确认那样还有一个独立于确认
 * 状态之外的紧急停用入口；`kill-switch.ts` 那条路径走的是知识库确认页，
 * 不是这条阶段切换页，两者职责不重叠。
 *
 * 🔴 这条路由 `force-dynamic`：它依赖查询参数和 cookie，绝不能被静态化或被
 *    任何中间缓存留下一份带令牌的副本。
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID, timingSafeEqual } from 'crypto'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import {
  consumeRolloutAdvanceRequest,
  describeRolloutLinkProblem,
  loadRolloutAdvanceRequest,
  ROLLOUT_STAGE_LABELS,
  type RolloutAdvanceLinkView,
} from '@/lib/knowledge/rollout'

export const dynamic = 'force-dynamic'

const NONCE_COOKIE = 'me-knowledge-rollout-confirm-nonce'
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
      // 'no-referrer'（issue #1822）：Fetch 规范规定 referrer policy 是
      // no-referrer 时，浏览器对同页表单自己发出的 POST 也会把 Origin 头
      // 置成字符串 "null"，不区分是不是同源提交。这正是下面 POST 处理里
      // 那道「同源」CSRF 闸在真实浏览器点击下必然判定失败的原因——不是
      // Cloudflare 丢头，是这页自己的安全头把浏览器自己的安全头顶掉了。
      // 'same-origin' 两头都要：跨域请求（唯一可能泄露给第三方的路径）
      // Referer 仍然整段不发；真正同源提交时 Origin 不会被置空，闸能正常判。
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
  return `/knowledge-rollout-confirm/${requestId}`
}

// ── 页面外壳 ────────────────────────────────────────────────────────────────

const PAGE_CSS = `
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f6f3;margin:0;color:#2a2a2a;line-height:1.6}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 8px}
.lede{color:#555;font-size:15px;margin:0 0 20px}
.block{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.stage-line{font-size:18px;font-weight:600;text-align:center;padding:12px 0}
.stage-line .arrow{color:#B8863A;margin:0 10px}
.sample-check{background:#faf6ef;border-left:3px solid #B8863A;padding:10px 12px;font-size:14px;margin:16px 0}
.sample-check div{margin:2px 0}
button.primary{width:100%;padding:14px;border:none;border-radius:10px;background:#B8863A;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
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

/** §9.10 板桥："阶段号别裸给客户看"——页面只用大白话名字，不出现原始数字。 */
function sampleCheckBlock(check: RolloutAdvanceLinkView['sampleCheck']): string {
  if (!check) return ''
  return `<div class="sample-check">
  <div><strong>我们抽查了 ${check.sampleSize} 条对话</strong></div>
  <div>价格说错的：${check.priceErrors} 条</div>
  <div>其他说法准确率：${check.otherAccuracyPct}%</div>
</div>`
}

function confirmPage(view: RolloutAdvanceLinkView, nonce: string, rawToken: string): string {
  const who = view.clientName ? view.clientName : '你的账户'
  const fromLabel = ROLLOUT_STAGE_LABELS[view.fromStage]
  const toLabel = ROLLOUT_STAGE_LABELS[view.toStage]
  return shell(
    `确认 ${who} 的阶段切换`,
    `<h1>请你确认一下</h1>
<p class="lede">我们想把 <strong>${escapeHtml(who)}</strong> 的 AI 客服往下推进一段。</p>
<div class="block">
  <div class="stage-line">${escapeHtml(fromLabel)}<span class="arrow">→</span>${escapeHtml(toLabel)}</div>
  ${sampleCheckBlock(view.sampleCheck)}
</div>
<form method="POST">
<input type="hidden" name="token" value="${escapeHtml(rawToken)}"/>
<input type="hidden" name="nonce" value="${escapeHtml(nonce)}"/>
<button class="primary" type="submit">我确认，往下走</button>
</form>
<p class="foot">这个页面是发给 ${escapeHtml(view.confirmerEmail)} 的，链接只能用一次。</p>`,
  )
}

// ── GET：只看，不改任何东西 ─────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const origin = getPublicOrigin(request)
  const rawToken = new URL(request.url).searchParams.get('token') ?? ''
  if (!rawToken) {
    return htmlResponse(messagePage('链接不完整', describeRolloutLinkProblem('bad_token')), 400)
  }

  let result
  try {
    result = await loadRolloutAdvanceRequest(knowledgeWriteClient(), {
      requestId: params.requestId,
      rawToken,
    })
  } catch {
    // 读库出问题绝不渲染成一张空白的「没有要确认的内容」——那会让客户以为
    // 事情已经办完了。
    return htmlResponse(
      messagePage('暂时打不开', '我们这边出了点问题，暂时读不到这次切换。过几分钟再点一次这个链接；还是不行就回邮件告诉我们。'),
      500,
    )
  }

  if (!result.ok) {
    return htmlResponse(messagePage('这个链接用不了', describeRolloutLinkProblem(result.problem)), 200)
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
    return burn(htmlResponse(messagePage('链接不完整', describeRolloutLinkProblem('bad_token')), 400))
  }

  const sb = knowledgeWriteClient()

  let result
  try {
    result = await consumeRolloutAdvanceRequest(sb, { requestId: params.requestId, rawToken })
  } catch {
    return burn(
      htmlResponse(
        messagePage('没有保存成功', '我们这边出了点问题，你刚才的确认没有保存。请回到邮件里重新点开链接再试一次。'),
        500,
      ),
    )
  }

  if (!result.ok) {
    return burn(htmlResponse(messagePage('这个链接用不了', describeRolloutLinkProblem(result.problem)), 200))
  }

  return burn(
    htmlResponse(
      messagePage(
        '收到了，谢谢',
        `已经确认，AI 客服现在进入「${ROLLOUT_STAGE_LABELS[result.newStage]}」。`,
      ),
      200,
    ),
  )
}
