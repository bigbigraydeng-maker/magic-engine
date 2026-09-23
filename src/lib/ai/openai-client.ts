/**
 * OpenAI client factory — routes through Cloudflare AI Gateway for observability.
 * Use getOpenAIClient() inside request handlers only (per CLAUDE.md convention).
 *
 * CF Gateway URL: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai
 * All requests are logged in the AI Gateway dashboard automatically.
 *
 * 这里还是**全站唯一能一次盖住所有 OpenAI 调用点的位置** —— 所以
 * 「账户断电了要有人知道」这件事就装在这一层（见下面的 instrumentedFetch）。
 */

import OpenAI from 'openai'
import { classifyOpenAIFailure, needsHuman } from './provider-failure'
import { isRecordable, makeSupabaseOutageWriter, recordProviderOutage, shouldWriteNow } from './outage-ledger'

const CF_ACCOUNT_ID = 'bbd84393da8e5707ba617749dc17117c'
const CF_GATEWAY_ID = 'magic-engine'
const CF_GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`

const PROVIDER = 'openai'

/** 错误响应体最多读这么多 —— 网关挂掉时 5xx 可能吐一整页 HTML。 */
const MAX_ERROR_BODY = 4096

export interface OpenAIClientOptions {
  /**
   * 用这把钥匙，而不是 `process.env.OPENAI_API_KEY`。
   *
   * 给 voice 那三处用（它们读的是 `cfg.env.OPENAI_API_KEY`）。现状两边其实是同一个值
   * （`getVoiceConfig()` 的 env 默认就是 `process.env`），但**别把「现在相同」
   * 当成「永远相同」**写进代码 —— 显式传进来，收编到同一个拦截点。
   */
  apiKey?: string
  /**
   * 不走 Cloudflare AI Gateway，直连 OpenAI。
   *
   * 🔴 这不是「可选的性能开关」，是**证据边界**：全仓现有 40+ 个走网关的调用方
   *    100% 用的是 `chat.completions`，而 `responses.create` 的 7 处**从来没有
   *    一次经过这个网关**（2026-09-23 核对：两组文件零交集）。
   *    「网关代不代理 /v1/responses」在这个仓库里是零证据的，
   *    把它们顺手切到网关上 = 用一次没验证过的路由换掉七条在跑的链路，
   *    而其中 6 处的失败是被 catch 吞掉的 —— 等于一次造出 7 个新的静默失败点，
   *    正是这次要消灭的东西（魏征复审 M2）。
   *    所以它们只拿拦截、不换路由；等哪天真验通了再去掉这个开关。
   */
  bypassGateway?: boolean
}

/**
 * 包一层 fetch：正常放行，失败时顺手判一下「这是账户级的事还是这一次的事」。
 *
 * 🔴 三条硬约束，缺一条这层就会从「告警」变成「新的故障源」：
 *    1. **绝不向调用方抛**。告警写不进去不能把业务调用也弄挂。
 *    2. **只在 `!res.ok` 时 clone**。成功响应可能是流式的，clone 了再整体读会把它缓冲住。
 *    3. **原样返回第一手 `res`**，body 一口都不能替调用方喝掉。
 */
function instrumentedFetch(viaGateway: boolean): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await fetch(input, init)
    if (res.ok) return res

    // clone 必须在把 res 交回 SDK 之前同步拿到
    let probe: Response | null = null
    try {
      probe = res.clone()
    } catch {
      probe = null
    }

    if (probe) void inspectFailure(probe, viaGateway)
    return res
  }
}

async function inspectFailure(probe: Response, viaGateway: boolean): Promise<void> {
  try {
    const body = (await probe.text()).slice(0, MAX_ERROR_BODY)
    const headers: Record<string, string> = {}
    probe.headers.forEach((v, k) => {
      headers[k] = v
    })

    const kind = classifyOpenAIFailure({ status: probe.status, body, headers })

    if (!needsHuman(kind)) {
      // 不惊动人，但**留一行日志**：新出现的失败形态不能永远进不了视野。
      // （限流是常态，不刷屏；其余的记下来。）
      if (kind !== 'rate_limited') {
        console.warn(`[openai-client] 未分类的调用失败 status=${probe.status} 走网关=${viaGateway}`)
      }
      return
    }
    if (!isRecordable(kind)) return

    const now = new Date()
    if (!shouldWriteNow(PROVIDER, kind, now)) return

    // 🔴 函数内动态引入：`@/lib/supabase` 在**模块加载时**就 createClient，缺 env 直接 throw。
    //    而本文件被 40+ 个模块 import（含一堆单测），顶层引进来会让那些单测在
    //    import 阶段就炸，报错还跟 OpenAI 毫无关系。也符合 CLAUDE.md §7。
    const { supabaseAdmin } = await import('@/lib/supabase')
    await recordProviderOutage(makeSupabaseOutageWriter(supabaseAdmin), {
      provider: PROVIDER,
      reason: kind,
      detail: `HTTP ${probe.status}${viaGateway ? '（经 Cloudflare 网关）' : '（直连）'}：${body.slice(0, 300)}`,
      now,
    })
  } catch (e) {
    // 吞掉，但**不静默** —— 这条路自己坏了，读的那一侧还有
    // `ai_alerting_broken` 那条待办兜底（见 pm-todo/manual-items.ts）
    console.error('[openai-client] 记录账户级失效时出错:', e instanceof Error ? e.message : String(e))
  }
}

export function getOpenAIClient(opts: OpenAIClientOptions = {}): OpenAI {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  // CF AI Gateway Authenticated mode requires a cf-aig-authorization header —
  // without it the gateway 401s outright (confirmed 2026-07-14). So a missing
  // token means "skip the gateway", not "gateway must be unauthenticated".
  const aigToken = process.env.CF_AIG_TOKEN
  if (opts.bypassGateway || !aigToken) {
    if (!opts.bypassGateway) {
      console.warn('[openai-client] CF_AIG_TOKEN not set — bypassing CF AI Gateway, calls go direct to OpenAI (no gateway logging/caching)')
    }
    return new OpenAI({ apiKey, fetch: instrumentedFetch(false) })
  }
  return new OpenAI({
    apiKey,
    baseURL: CF_GATEWAY_BASE,
    defaultHeaders: { 'cf-aig-authorization': `Bearer ${aigToken}` },
    fetch: instrumentedFetch(true),
  })
}
