/**
 * Meta 转化 API（Conversions API）的回写实现（Issue #1397 · L3 Connector）。
 *
 * 实现 `DestinationWriter`。所有 Meta 特有的知识都关在这个文件里：
 * 事件名映射、7 天窗口、错误码、限流头。状态机不认识它们。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 三条从官方文档核实过、且直接决定设计的事实（2026-09-05 查证）
 * ────────────────────────────────────────────────────────────────────────
 *
 * 1. **7 天硬顶，且整批拒**
 *    "The event_time can be up to 7 days before you send an event to Meta.
 *     If any event_time in data is greater than 7 days in the past, we return
 *     an error for the entire request and process no events."
 *    ⇒ 一条超期会拖死同批的其它条 ⇒ **一次只发一条**。
 *
 * 2. **服务端事件之间没有去重**
 *    "If you send us two consecutive server events with the same information,
 *     we do not discard either."
 *    `event_id` 的去重只在「浏览器 pixel ↔ 服务器」之间生效。
 *    ⇒ 重发一次 = Meta 永久多记一笔成交。
 *
 * 3. **没有删除端点**
 *    ⇒ 上面那一笔撤不回。客人要求删除时我们只能删自己这边。
 *
 * 这三条合起来就是为什么 `send` 不抛异常、`accept` 有 `in_doubt` 这一档：
 * 宁可停下来让人去 Events Manager 核对，也不赌。
 */

import type {
  ClientSendConfig,
  DestinationWriter,
  OutcomeForSend,
  RawSendResult,
  SendVerdict,
} from '@/lib/conversions/destination-writer'
import { hashEmail, hashName, hashPhone } from '@/lib/pii/hasher'
import { maskForPreview } from './preview'
import { resolveCapiConfig, type CapiCredentials } from './config'
import { capiEventNameForKind } from '@/lib/conversions/capi-client-config'
import { CONVERSION_CRM_NAME, CONVERSION_EVENT_SOURCE, NO_META_LEAD_MESSAGE } from '@/lib/conversions/conversion-lead'
import { toMajorUnits } from '@/lib/conversions/money'

const GRAPH_VERSION = process.env.META_CAPI_VERSION ?? 'v19.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export type MetaCapiPayload = {
  data: Array<{
    event_name: string
    event_time: number
    event_id: string
    action_source: string
    /** Required by Meta when action_source is business_messaging. Absent on email and stage sends. */
    messaging_channel?: 'messenger'
    user_data: Record<string, string[] | string>
    custom_data?: Record<string, unknown>
  }>
}

/** 请求头里挑出诊断用的几个，其余丢掉（别把整包头存进库）。 */
const KEEP_HEADERS = ['x-business-use-case-usage', 'x-fb-trace-id']

function pickHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of KEEP_HEADERS) {
    const v = h.get(k)
    if (v) out[k] = v
  }
  return out
}

/**
 * 从限流头里取"多久之后可以再来"。
 *
 * Meta 把它放在 `X-Business-Use-Case-Usage` 里，单位是**分钟**，
 * 而且这个配额是跟 insights / ads-manager 那些定时任务**共享**的 ——
 * 所以这里被限流，很可能是别的地方在跑量。老老实实按它说的等。
 */
export function parseRetryAfterMs(headers: Record<string, string>): number | undefined {
  const buc = headers['x-business-use-case-usage']
  if (!buc) return undefined
  try {
    const parsed = JSON.parse(buc) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>
    let maxMinutes = 0
    for (const entries of Object.values(parsed)) {
      for (const e of entries ?? []) {
        const m = e?.estimated_time_to_regain_access
        if (typeof m === 'number' && m > maxMinutes) maxMinutes = m
      }
    }
    return maxMinutes > 0 ? maxMinutes * 60_000 : undefined
  } catch {
    // 头的格式变了不该让整条流程崩 —— 拿不到就用调用方的默认退避。
    return undefined
  }
}

/**
 * 授权类错误码：重试多少次都一样，要人去重新授权。
 * 只列官方文档写明的三个 —— 190 令牌失效 / 102 会话过期 / 200 权限不足。
 * 猜的码不进这张表：猜错会把一条本可重试的判成永久失败。
 */
const AUTH_CODES = new Set([190, 102, 200])
/** 限流：8000x 一族。官方没写死转化 API 归哪个桶，所以按前缀认。 */
function isThrottleCode(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 80000 && code < 90000
}

function eventNameFor(outcome: OutcomeForSend): string {
  if (!outcome.conversionLeadEventName) return capiEventNameForKind(outcome.outcomeKind)
  if (!outcome.metaLeadId || !/^\d{15,17}$/.test(outcome.metaLeadId)) {
    throw new Error(NO_META_LEAD_MESSAGE)
  }
  return outcome.conversionLeadEventName
}

function userDataFor(outcome: OutcomeForSend, config: ClientSendConfig): Record<string, string[] | string> {
  const userData: Record<string, string[] | string> = {}
  const em = hashEmail(outcome.customerEmail)
  const ph = hashPhone(outcome.customerPhone, config.defaultPhoneCountry)
  const fn = hashName(outcome.customerFirst)
  const ln = hashName(outcome.customerLast)
  // 只放真有的。空字符串的哈希人人相同，会降低匹配质量。
  if (em) userData.em = [em]
  if (ph) userData.ph = [ph]
  if (fn) userData.fn = [fn]
  if (ln) userData.ln = [ln]
  // PSID 与主页 id 官方要求不哈希。
  if (outcome.pageScopedUserId) {
    userData.page_scoped_user_id = outcome.pageScopedUserId
    if (config.facebookPageId) userData.page_id = config.facebookPageId
  }
  // lead_id 不哈希。普通事件里它只是匹配键；线索阶段回传里它是这条线索的编号。
  if (outcome.metaLeadId && /^\d{15,17}$/.test(outcome.metaLeadId)) {
    userData.lead_id = outcome.metaLeadId
  }
  return userData
}

function messagingChannelFor(
  converting: boolean,
  actionSource: OutcomeForSend['actionSource'],
): { messaging_channel: 'messenger' } | Record<string, never> {
  if (converting || actionSource !== 'business_messaging') return {}
  return { messaging_channel: 'messenger' }
}

function customDataFor(outcome: OutcomeForSend): Record<string, unknown> | undefined {
  const money = moneyData(outcome)
  if (!outcome.conversionLeadEventName) return money
  return { event_source: CONVERSION_EVENT_SOURCE, lead_event_source: CONVERSION_CRM_NAME, ...(money ?? {}) }
}

function moneyData(outcome: OutcomeForSend): Record<string, unknown> | undefined {
  if (outcome.outcomeKind === 'lead' || outcome.amountMinor == null || !outcome.currency) return undefined
  const value = toMajorUnits(outcome.amountMinor, outcome.currency)
  // 不认识的币种不按 2 位小数猜。猜错就是差 100 倍，而且撤不回。
  if (value == null) {
    throw new Error(`不支持的币种 ${outcome.currency} —— 请先在 src/lib/conversions/money.ts 里补上它的小数位`)
  }
  return { currency: outcome.currency, value, ...(outcome.orderRef ? { order_id: outcome.orderRef } : {}) }
}

export class MetaCapiWriter implements DestinationWriter<MetaCapiPayload> {
  readonly kind = 'meta_capi' as const

  /** 官方硬限制。超过这个天数就别发了 —— 发了是整批被拒，不是这一条被忽略。 */
  readonly maxEventAgeDays = 7

  build(outcome: OutcomeForSend, config: ClientSendConfig): MetaCapiPayload {
    const eventName = eventNameFor(outcome)
    const converting = Boolean(outcome.conversionLeadEventName)
    const event: MetaCapiPayload['data'][number] = {
      event_name: eventName,
      event_time: Math.floor(new Date(outcome.occurredAt).getTime() / 1000),
      // 幂等键默认是事实行的 uuid。同一笔的阶段那条用另一个键，避免两条合成一条。
      // Meta 只在 pixel↔server 之间用它去重，服务端之间不去重。
      event_id: outcome.platformEventId ?? outcome.id,
      // 普通事件沿用来源渠道。线索阶段回传按官方要求用 system_generated。
      action_source: converting ? 'system_generated' : outcome.actionSource,
      user_data: userDataFor(outcome, config),
      ...messagingChannelFor(converting, outcome.actionSource),
    }
    const custom = customDataFor(outcome)
    if (custom) event.custom_data = custom
    return { data: [event] }
  }

  preview(outcome: OutcomeForSend, config: ClientSendConfig): Record<string, unknown> {
    return maskForPreview(outcome, config, {
      eventName: eventNameFor(outcome),
      maxEventAgeDays: this.maxEventAgeDays,
    })
  }

  async preflight(
    config: ClientSendConfig,
    opts: { fetcher: typeof fetch },
  ): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
    let creds: CapiCredentials
    try {
      creds = await resolveCapiConfig(config.clientId)
    } catch (e) {
      return { ok: false, detail: { stage: 'config', error: e instanceof Error ? e.message : String(e) } }
    }

    // 只读两枪：令牌还活着吗、这个 pixel 拿这把令牌看得见吗。
    // 都不写任何东西，所以试运行时跑它是安全的。
    const detail: Record<string, unknown> = { pixel_id: creds.pixelId, graph_version: GRAPH_VERSION }

    try {
      const tokenRes = await opts.fetcher(
        `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(creds.accessToken)}&access_token=${encodeURIComponent(creds.accessToken)}`,
      )
      const tokenBody = (await tokenRes.json()) as {
        data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number }
        error?: { message?: string }
      }
      const isValid = tokenBody?.data?.is_valid === true
      detail.token_valid = isValid
      detail.token_scopes = tokenBody?.data?.scopes ?? []
      if (!isValid) {
        detail.token_error = tokenBody?.error?.message ?? '令牌已失效'
        return { ok: false, detail }
      }
      // 回写转化只需要 ads_management，不需要更大的权限。
      detail.has_ads_management = (tokenBody.data?.scopes ?? []).includes('ads_management')
    } catch (e) {
      detail.token_error = e instanceof Error ? e.message : String(e)
      return { ok: false, detail }
    }

    try {
      const pixelRes = await opts.fetcher(
        `${GRAPH_BASE}/${creds.pixelId}?fields=id,name&access_token=${encodeURIComponent(creds.accessToken)}`,
      )
      const pixelBody = (await pixelRes.json()) as { id?: string; name?: string; error?: { message?: string } }
      const visible = pixelBody?.id === creds.pixelId
      detail.pixel_visible = visible
      detail.pixel_name = pixelBody?.name ?? null
      if (!visible) {
        detail.pixel_error = pixelBody?.error?.message ?? '这把令牌看不到该 pixel'
        return { ok: false, detail }
      }
    } catch (e) {
      detail.pixel_error = e instanceof Error ? e.message : String(e)
      return { ok: false, detail }
    }

    return { ok: true, detail }
  }

  async send(
    payload: MetaCapiPayload,
    config: ClientSendConfig,
    opts: { fetcher: typeof fetch },
  ): Promise<RawSendResult> {
    const startedAt = Date.now()

    let creds: CapiCredentials
    try {
      creds = await resolveCapiConfig(config.clientId)
    } catch (e) {
      return {
        ok: false,
        errorName: 'ConfigError',
        errorMessage: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - startedAt,
      }
    }

    // 🔴 一切异常都变成返回值，绝不抛出。
    //    抛出的话调用方分不清"请求根本没发出去"和"发出去了但没接住回应"，
    //    而这两者的正确处置完全相反（前者可以重发，后者绝不能）。
    try {
      const res = await opts.fetcher(`${GRAPH_BASE}/${creds.pixelId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, access_token: creds.accessToken }),
      })
      const bodyText = await res.text()
      return {
        ok: true,
        status: res.status,
        headers: pickHeaders(res.headers),
        bodyText,
        latencyMs: Date.now() - startedAt,
      }
    } catch (e) {
      return {
        ok: false,
        errorName: e instanceof Error ? e.name : 'UnknownError',
        errorMessage: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - startedAt,
      }
    }
  }

  accept(raw: RawSendResult): SendVerdict {
    // ── 连接层面就没成 ────────────────────────────────────────────────
    if (!raw.ok) {
      if (raw.errorName === 'ConfigError') {
        return { kind: 'permanent', detail: raw.errorMessage }
      }
      // 🔴 超时 / 连接中断：请求**可能已经到了 Meta**。不知道就是不知道。
      return { kind: 'in_doubt', detail: `${raw.errorName}: ${raw.errorMessage}` }
    }

    // ── 网关层错误：请求可能到了后端也可能没到 ────────────────────────
    if (raw.status === 502 || raw.status === 504) {
      return { kind: 'in_doubt', detail: `HTTP ${raw.status}（网关层，无法确定 Meta 是否已收）` }
    }

    let body: {
      events_received?: number
      messages?: unknown[]
      fbtrace_id?: string
      error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string }
    }
    try {
      body = JSON.parse(raw.bodyText) as typeof body
    } catch {
      // 200 但不是 JSON —— 说不清楚，别猜。
      return { kind: 'in_doubt', detail: `响应不是合法 JSON（HTTP ${raw.status}）` }
    }

    const err = body.error
    const code = err?.code
    const detail = err?.error_user_msg || err?.message || `HTTP ${raw.status}`

    // ── 成功 ──────────────────────────────────────────────────────────
    // 🔴 只看 HTTP 200 不够：Graph API 会 200 里夹 error 对象。
    //    也必须看 events_received —— "收到 0 条"是最常见的静默失败。
    if (raw.status === 200 && !err) {
      if (body.events_received === 1) {
        return {
          kind: 'accepted',
          receipt: {
            // 只留白名单字段。原样存整个响应会把 Meta 回显的用户数据一起沉淀下来。
            events_received: body.events_received,
            fbtrace_id: body.fbtrace_id ?? null,
            messages: body.messages ?? [],
            http_status: raw.status,
            latency_ms: raw.latencyMs,
          },
        }
      }
      return {
        kind: 'permanent',
        detail: `Meta 回了 200，但 events_received=${body.events_received ?? 'undefined'}（期望 1）`,
      }
    }

    // ── 事件太旧 ──────────────────────────────────────────────────────
    // 这不是"错误"，是"来晚了"。分开是为了让待办说人话：
    // "早了 X 天，Meta 不收" 比 "HTTP 400" 有用得多。
    if (/event_time|too old|7 days/i.test(detail)) {
      return { kind: 'expired', detail }
    }

    // ── 授权 ──────────────────────────────────────────────────────────
    if (raw.status === 401 || raw.status === 403 || (code != null && AUTH_CODES.has(code))) {
      return { kind: 'auth', detail }
    }

    // ── 限流 ──────────────────────────────────────────────────────────
    if (raw.status === 429 || isThrottleCode(code)) {
      return { kind: 'retry', detail, retryAfterMs: parseRetryAfterMs(raw.headers) }
    }

    // ── Meta 自己出问题 ───────────────────────────────────────────────
    if (raw.status >= 500) {
      return { kind: 'retry', detail, retryAfterMs: parseRetryAfterMs(raw.headers) }
    }

    // ── 剩下的都是我们发错了，重试没意义 ──────────────────────────────
    return { kind: 'permanent', detail }
  }
}

export const metaCapiWriter = new MetaCapiWriter()
