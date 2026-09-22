/**
 * 「批准一条成交/咨询 → 发给广告平台 → 记下结果」的状态机（Issue #1397 PR3）。
 *
 * 同步：一次请求里发完。CTS 一天不到 6 条（每周 1-2 笔成交 + 10-40 个咨询），
 * 用不上队列 —— 而队列的重放语义正是这套设计前三轮反复出双发 bug 的根源。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 防重复发送靠三道闸，缺一不可
 * ────────────────────────────────────────────────────────────────────────
 *
 *   1. 数据库唯一约束 `(destination, event_id)` —— 一个事实对一个平台只允许一条发送记录。
 *   2. 状态的**条件更新**（CAS）—— 每次状态迁移都写 `AND status = ANY(期望的起始状态)`，
 *      只有影响到 1 行才算成功。应用层"先读再写"必然有并发窗口，数据库没有。
 *   3. `post_started_at` —— 真正发 HTTP **之前**把它从 NULL 抢成 now()，抢不到就不发。
 *      这道闸挡的是"同一条被发两次"：按钮连点、请求重试、进程中途崩了重来。
 *
 * 🔴 为什么这么较真：Meta 的转化 API **服务端事件之间没有去重**，也**没有删除端点**。
 *    重发一次就是永久多记一笔成交，撤不回。
 *    PM 2026-09-05 明令："定金算成交，坚决不能记成 2 笔。"
 *
 * 🔴 结果不确定时（超时、网关错误）一律停在 `in_doubt`，**永不自动重发** ——
 *    交人去平台后台核对，人说了算。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { actionSourceForSourceKind, type SourceKind } from './intake'
import type {
  ClientSendConfig,
  DestinationWriter,
  OutcomeForSend,
} from './destination-writer'

/** 终态：任何自动路径都不许再改。 */
const TERMINAL = [
  'confirmed',
  'failed_permanent',
  'expired_no_send',
  'redacted',
  'dry_run',
  'in_doubt',
] as const

export type WritebackStatus =
  | 'queued'
  | 'sending'
  | (typeof TERMINAL)[number]
  | 'failed'

/**
 * 一条 `sending` 卡多久才算"没下文"。
 * 太短会把正在飞的请求误判成断线（见下方 sending 分支的事故说明）；
 * 太长会让真断线的条目迟迟不进人工核对。5 分钟远大于一次 CAPI 往返（~1 秒）。
 */
const STUCK_SENDING_MS = 5 * 60_000

export type SendOutcomeResult = {
  status: WritebackStatus
  /** 说人话的一句话，直接能显示给 PM。 */
  message: string
  writebackId: string | null
  receipt?: Record<string, unknown>
  preview?: Record<string, unknown>
}

type OutcomeRow = {
  id: string
  client_id: string
  contact_id: string | null
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_email: string | null
  customer_phone: string | null
  customer_first: string | null
  customer_last: string | null
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  review_status: string
  redacted_at: string | null
  page_scoped_user_id: string | null
  source_kind: SourceKind
}

function toOutcomeForSend(row: OutcomeRow): OutcomeForSend {
  return {
    id: row.id,
    clientId: row.client_id,
    contactId: row.contact_id,
    outcomeKind: row.outcome_kind,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    customerFirst: row.customer_first,
    customerLast: row.customer_last,
    orderRef: row.order_ref,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredAt: row.occurred_at,
    pageScopedUserId: row.page_scoped_user_id,
    actionSource: actionSourceForSourceKind(row.source_kind),
  }
}

export type SendDeps = {
  supabase: SupabaseClient
  writer: DestinationWriter<unknown>
  fetcher: typeof fetch
  now?: Date
}

/**
 * 发送一条已批准的事实。**幂等**：重复调用不会重复发送。
 *
 * 调用方（路由）负责鉴权与审计；这里只管状态机与发送。
 */
export async function sendApprovedOutcome(
  outcomeId: string,
  deps: SendDeps,
): Promise<SendOutcomeResult> {
  // 可被重复调用：批准时调一次，之后人在页面上点「再试一次」/「重新发送」还会调。
  // 幂等由下面四道闸保证，不靠调用方克制。
  const { supabase, writer, fetcher } = deps
  const now = deps.now ?? new Date()
  const destination = writer.kind

  // ── 1. 取事实，确认它该被发 ────────────────────────────────────────
  const { data: outcomeData, error: outcomeErr } = await supabase
    .from('me_sale_outcomes')
    .select(
      'id, client_id, contact_id, outcome_kind, customer_email, customer_phone, ' +
        'customer_first, customer_last, order_ref, amount_minor, currency, ' +
        'occurred_at, review_status, redacted_at, page_scoped_user_id, source_kind',
    )
    .eq('id', outcomeId)
    .maybeSingle()

  if (outcomeErr) throw new Error(`读取成交记录失败：${outcomeErr.message}`)
  if (!outcomeData) throw new Error('成交记录不存在')

  const outcome = outcomeData as unknown as OutcomeRow

  if (outcome.review_status !== 'approved') {
    return { status: 'queued', message: '这条还没有被批准，不会发送', writebackId: null }
  }
  if (outcome.redacted_at) {
    return { status: 'redacted', message: '这条已按客人要求删除个人信息，不再发送', writebackId: null }
  }

  // ── 2. 客人说过「别再联系我」就不发 ────────────────────────────────
  // 🔴 真相源是不可变触点，不是 contacts.do_not_contact 那一列（见
  // src/lib/crm/dnc.ts 顶部说明：那一列是尽力维护的反规范化，写失败过）。
  // 入站私信刚出现拒联信号时，那一列还没来得及被人工确认写上——这段窗口里
  // 只查那一列会把明确拒联的人的数据发出去。跟今日名单/受众导出同一套判据，
  // 不能各查各的。
  if (outcome.contact_id) {
    const [contactRes, touchRes] = await Promise.all([
      supabase.from('contacts').select('do_not_contact').eq('id', outcome.contact_id).maybeSingle(),
      supabase
        .from('contact_touchpoints')
        .select('occurred_at, metadata')
        .eq('contact_id', outcome.contact_id)
        .eq('client_id', outcome.client_id),
    ])
    // 查不出来就当「不知道」，绝不能悄悄当成「这个人没说过别联系」——
    // 这条判断守的是全文件唯一撤不回的动作，查询失败不能变成「放行发送」。
    if (contactRes.error) throw new Error(`读取联系人拒联标记失败：${contactRes.error.message}`)
    if (touchRes.error) throw new Error(`读取联系人触点失败：${touchRes.error.message}`)
    const contactFlag =
      (contactRes.data as { do_not_contact?: boolean } | null)?.do_not_contact ?? false
    const touches: DncTouch[] = ((touchRes.data ?? []) as { occurred_at: string; metadata: unknown }[]).map(
      (t) => {
        const meta =
          t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata)
            ? (t.metadata as Record<string, unknown>)
            : null
        return {
          outcome: (meta?.outcome as string | undefined) ?? null,
          flagged: meta?.do_not_contact === true,
          occurredAt: t.occurred_at,
        }
      },
    )
    if (isDoNotContact(contactFlag, touches)) {
      return {
        status: 'redacted',
        message: '这位客人已标记「别再联系」，不把他的数据发给广告平台',
        writebackId: null,
      }
    }
  }

  // ── 3. 读客户配置 ──────────────────────────────────────────────────
  const { data: clientData, error: clientErr } = await supabase
    .from('clients')
    .select('id, default_phone_country, conversion_stage, facebook_page_id')
    .eq('id', outcome.client_id)
    .maybeSingle()

  if (clientErr) throw new Error(`读取客户配置失败：${clientErr.message}`)
  if (!clientData) throw new Error('客户不存在')

  const client = clientData as {
    default_phone_country: string | null
    conversion_stage: string | null
    facebook_page_id: string | null
  }
  const config: ClientSendConfig = {
    clientId: outcome.client_id,
    defaultPhoneCountry: client.default_phone_country,
    facebookPageId: client.facebook_page_id,
  }

  // ── 4. 抢发送记录（数据库唯一约束是第一道闸）────────────────────────
  const { error: insertErr } = await supabase.from('me_conversion_writebacks').insert({
    outcome_id: outcome.id,
    destination,
    event_id: outcome.id,
    status: 'queued',
  })
  // 冲突说明已经有人建过了 —— 正常，往下读回它当前的状态。
  // 🔴 认错误码 23505（unique_violation），不认错误文案：文案会随版本和语言变，
  //    认错了会把一次正常的并发当成故障，让这条永久卡在"发送时出错"且无法重试。
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    throw new Error(`创建发送记录失败：${insertErr.message}`)
  }

  const { data: wbData, error: wbErr } = await supabase
    .from('me_conversion_writebacks')
    .select('id, status, receipt, attempts, last_attempt_at')
    .eq('destination', destination)
    .eq('event_id', outcome.id)
    .maybeSingle()

  if (wbErr) throw new Error(`读取发送记录失败：${wbErr.message}`)
  if (!wbData) throw new Error('发送记录不存在')

  const wb = wbData as {
    id: string
    status: string
    receipt: unknown
    attempts: number
    last_attempt_at: string | null
  }

  // 已经是终态就到此为止 —— 包括 in_doubt（那一档只能由人来解）。
  if ((TERMINAL as readonly string[]).includes(wb.status)) {
    return {
      status: wb.status as WritebackStatus,
      message: terminalMessage(wb.status),
      writebackId: wb.id,
      receipt: (wb.receipt as Record<string, unknown>) ?? undefined,
    }
  }

  // 上一次发到一半没了下文：不重发。
  //
  // 🔴 但**必须先看它卡了多久**。魏征 2026-09-05 实测出的真双发路径：
  //    连点两次 → 第二个请求看到第一个刚置的 `sending` → 若立刻判成"断线了"，
  //    而第一个请求随后成功 → 行被改成 in_doubt、receipt 丢失 →
  //    人去平台后台核对（平台有 ~20 分钟延迟）看不到 → 点"重新发送" → **永久多记一笔**。
  //    所以正在发的（未超阈值）如实回"正在发送中"，一个字段都不改。
  if (wb.status === 'sending') {
    const startedAt = wb.last_attempt_at ? new Date(wb.last_attempt_at).getTime() : null
    const stuckMs = startedAt == null ? Infinity : now.getTime() - startedAt

    if (stuckMs < STUCK_SENDING_MS) {
      return {
        status: 'sending',
        message: '这条正在发送中，请过几秒再看 —— 不会重复发送',
        writebackId: wb.id,
      }
    }

    await casUpdate(supabase, wb.id, ['sending'], {
      status: 'in_doubt',
      last_error: `发送开始后 ${Math.round(stuckMs / 60_000)} 分钟没有结果，状态未知`,
    })
    return {
      status: 'in_doubt',
      message: '上一次发送中途断了，不确定平台收没收 —— 需要人去核对，不会自动重发',
      writebackId: wb.id,
    }
  }

  // ── 5. 超过平台时间窗口就别发了 ────────────────────────────────────
  const ageDays = (now.getTime() - new Date(outcome.occurred_at).getTime()) / 86_400_000
  if (ageDays > writer.maxEventAgeDays) {
    await casUpdate(supabase, wb.id, ['queued', 'failed'], {
      status: 'expired_no_send',
      last_error: `事件已过去 ${Math.floor(ageDays)} 天，超过 ${writer.maxEventAgeDays} 天窗口`,
    })
    return {
      status: 'expired_no_send',
      message: `早了 ${Math.floor(ageDays)} 天 —— 广告平台只收 ${writer.maxEventAgeDays} 天内的，这条发不出去`,
      writebackId: wb.id,
    }
  }

  const forSend = toOutcomeForSend(outcome)

  // ── 6. 试运行：只构造、只预检，不真发 ──────────────────────────────
  if (client.conversion_stage !== 'live') {
    let preview: Record<string, unknown>
    try {
      writer.build(forSend, config) // 构造不出来要当场知道
      preview = writer.preview(forSend, config)
    } catch (e) {
      await casUpdate(supabase, wb.id, ['queued', 'failed'], {
        status: 'failed_permanent',
        last_error: e instanceof Error ? e.message : String(e),
      })
      return {
        status: 'failed_permanent',
        message: `这条组装不出来：${e instanceof Error ? e.message : String(e)}`,
        writebackId: wb.id,
      }
    }

    // 顺带只读探活：令牌活着吗、目标账户对不对。切正式之前就该发现问题。
    const pre = await writer.preflight(config, { fetcher })
    const payloadPreview = { ...preview, 预检: pre.detail, 预检通过: pre.ok }

    await casUpdate(supabase, wb.id, ['queued', 'failed'], {
      status: 'dry_run',
      payload_preview: payloadPreview,
    })
    return {
      status: 'dry_run',
      message: pre.ok
        ? '试运行：内容已生成，没有真的发给平台。核对无误后切到正式模式再发。'
        : '试运行：内容能生成，但连接平台的预检没过 —— 切正式之前要先解决。',
      writebackId: wb.id,
      preview: payloadPreview,
    }
  }

  // ── 7. 正式发送 ────────────────────────────────────────────────────
  let payload: unknown
  try {
    payload = writer.build(forSend, config)
  } catch (e) {
    await casUpdate(supabase, wb.id, ['queued', 'failed'], {
      status: 'failed_permanent',
      last_error: e instanceof Error ? e.message : String(e),
    })
    return {
      status: 'failed_permanent',
      message: `这条组装不出来：${e instanceof Error ? e.message : String(e)}`,
      writebackId: wb.id,
    }
  }

  // 标记为发送中；同一条 CAS 里写上尝试时间与次数。
  const marked = await casUpdate(supabase, wb.id, ['queued', 'failed'], {
    status: 'sending',
    post_started_at: null,
    last_attempt_at: now.toISOString(),
    attempts: wb.attempts + 1,
  })
  if (!marked) {
    // 别人抢先了。读回真值，不猜。
    return await currentState(supabase, wb.id)
  }

  // 🔴 发 HTTP **之前**抢 post_started_at。抢不到 = 已经有人发过或正在发 → 绝不再发。
  const claimed = await claimPost(supabase, wb.id)
  if (!claimed) {
    await casUpdate(supabase, wb.id, ['sending'], {
      status: 'in_doubt',
      last_error: '发送标记已被占用，无法确认是否已发出',
    })
    return {
      status: 'in_doubt',
      message: '这条可能已经发过了 —— 需要人去平台后台核对，不会自动重发',
      writebackId: wb.id,
    }
  }

  const rawResult = await writer.send(payload, config, { fetcher })
  const verdict = writer.accept(rawResult)

  /**
   * 落终态。
   * 🔴 必须看 CAS 有没有真的改到行：抢输了还照样返回"已确认"，
   *    就是**服务对调用方撒谎** —— 界面显示成功、库里却是别的状态，
   *    人据此去做下一步判断（比如"重新发送"）就会出事。
   */
  async function settle(
    to: WritebackStatus,
    patch: Record<string, unknown>,
    okResult: SendOutcomeResult,
  ): Promise<SendOutcomeResult> {
    const applied = await casUpdate(supabase, wb.id, ['sending'], { status: to, ...patch })
    if (applied) return okResult
    // 别人先落了终态。如实回它的真状态，不报我们这次的结果。
    return await currentState(supabase, wb.id)
  }

  switch (verdict.kind) {
    case 'accepted':
      return await settle(
        'confirmed',
        { receipt: verdict.receipt, latency_ms: rawResult.latencyMs, last_error: null },
        {
          status: 'confirmed',
          message: '已发给广告平台并收到确认',
          writebackId: wb.id,
          receipt: verdict.receipt,
        },
      )

    case 'expired':
      return await settle(
        'expired_no_send',
        { last_error: verdict.detail },
        { status: 'expired_no_send', message: '平台说这条太旧了，不收', writebackId: wb.id },
      )

    case 'auth':
      return await settle(
        'failed_permanent',
        { last_error: verdict.detail, last_error_code: 'auth' },
        {
          status: 'failed_permanent',
          message: '连接广告平台的授权失效了 —— 需要重新连接一次才能继续',
          writebackId: wb.id,
        },
      )

    case 'retry':
      // 同步模式下不自己等：记下"多久之后可以再来"，由人在页面上点「再试一次」。
      return await settle(
        'failed',
        {
          last_error: verdict.detail,
          last_error_code: 'retry',
          next_attempt_at: new Date(
            now.getTime() + (verdict.retryAfterMs ?? 10 * 60_000),
          ).toISOString(),
        },
        {
          status: 'failed',
          message: `平台暂时忙，稍后可以在页面上点「再试一次」（约 ${Math.ceil((verdict.retryAfterMs ?? 600_000) / 60_000)} 分钟后）`,
          writebackId: wb.id,
        },
      )

    case 'in_doubt':
      // 🔴 这一档是整套设计的要害：不知道对方收没收，就停在这里等人。
      return await settle(
        'in_doubt',
        { last_error: verdict.detail, last_error_code: 'in_doubt' },
        {
          status: 'in_doubt',
          message: '发出去了但没收到明确回应 —— 需要人去平台后台确认收没收，不会自动重发',
          writebackId: wb.id,
        },
      )

    case 'permanent':
    default:
      return await settle(
        'failed_permanent',
        { last_error: verdict.detail, last_error_code: 'permanent' },
        {
          status: 'failed_permanent',
          message: `平台拒绝了这条：${verdict.detail}`,
          writebackId: wb.id,
        },
      )
  }
}

/**
 * 人工裁决「不确定」的那一档。这是**唯一**允许以 `in_doubt` 为起点的路径。
 *
 * `confirmed` = 人去平台后台看到了，认定已收；
 * `resend`    = 人确认没收到，放回队列允许再发一次。
 */
export async function resolveDoubt(
  writebackId: string,
  resolution: 'confirmed' | 'resend',
  actor: string | null,
  supabase: SupabaseClient,
): Promise<{ ok: boolean; status: WritebackStatus; message: string }> {
  if (resolution === 'confirmed') {
    const ok = await casUpdate(supabase, writebackId, ['in_doubt'], {
      status: 'confirmed',
      receipt: { manual: true, resolved_by: actor, resolved_at: new Date().toISOString() },
      last_error: null,
    })
    return ok
      ? { ok: true, status: 'confirmed', message: '已按人工核对结果记为「平台已收到」' }
      : { ok: false, status: 'in_doubt', message: '这条不在「不确定」状态，没有改动' }
  }

  const ok = await casUpdate(supabase, writebackId, ['in_doubt'], {
    status: 'queued',
    post_started_at: null,
    last_error: null,
  })
  return ok
    ? { ok: true, status: 'queued', message: '已放回队列，可以再发一次' }
    : { ok: false, status: 'in_doubt', message: '这条不在「不确定」状态，没有改动' }
}

// ── 内部工具 ────────────────────────────────────────────────────────────

/**
 * 条件更新：只有当前状态在 `from` 里才改。
 * 返回是否真的改到了（`false` = 别人抢先了，本次放弃）。
 */
async function casUpdate(
  supabase: SupabaseClient,
  writebackId: string,
  from: string[],
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', writebackId)
    .in('status', from)
    .select('id')

  if (error) throw new Error(`更新发送状态失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * 抢发送标记：`post_started_at` 从 NULL 变成 now()。
 * 抢不到说明已经有人发过或正在发 —— 绝不再发一次。
 */
async function claimPost(supabase: SupabaseClient, writebackId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .update({ post_started_at: new Date().toISOString() })
    .eq('id', writebackId)
    .eq('status', 'sending')
    .is('post_started_at', null)
    .select('id')

  if (error) throw new Error(`占用发送标记失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

async function currentState(
  supabase: SupabaseClient,
  writebackId: string,
): Promise<SendOutcomeResult> {
  const { data } = await supabase
    .from('me_conversion_writebacks')
    .select('id, status, receipt')
    .eq('id', writebackId)
    .maybeSingle()
  const row = data as { id: string; status: string; receipt: unknown } | null
  return {
    status: (row?.status ?? 'queued') as WritebackStatus,
    message: terminalMessage(row?.status ?? 'queued'),
    writebackId: writebackId,
    receipt: (row?.receipt as Record<string, unknown>) ?? undefined,
  }
}

function terminalMessage(status: string): string {
  switch (status) {
    case 'confirmed':
      return '这条已经发过并收到确认了，不会重复发送'
    case 'dry_run':
      return '这条在试运行时生成过内容，没有真发。切正式模式后新批准的才会真发'
    case 'expired_no_send':
      return '这条超过了平台的时间窗口，发不出去'
    case 'failed_permanent':
      return '这条发送失败且重试无用，需要人处理'
    case 'in_doubt':
      return '这条发出去了但结果不确定，等人核对，不会自动重发'
    case 'redacted':
      return '这条已按客人要求删除个人信息，不再发送'
    case 'sending':
      return '正在发送中'
    case 'failed':
      return '上次发送失败，可以再试'
    default:
      return '等待发送'
  }
}
