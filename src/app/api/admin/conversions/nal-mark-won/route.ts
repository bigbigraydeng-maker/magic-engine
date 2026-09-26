/**
 * POST /api/admin/conversions/nal-mark-won —— NAL 客户管理工作台"标已成交"
 * （承接 CTS/NAL CAPI 项目，2026-09-15）。
 *
 * 只服务 New Asian Logistics 一个客户——**不碰**共享的
 * `.../crm/contacts/[cid]/stage` 路由本身（CTS 也在用同一套工作台，走的是另一条
 * 独立的成交回传通道 Google 表格同步，两条通道混在一起会让 CTS 的同一笔真实成交
 * 被算成两笔发给 Meta。见设计文档 `nal-crm-won-to-capi-design-v1.md`）。
 *
 * 复用 `advanceContactStage()`（进程内直接调用，不是对内发 HTTP 请求——那样会因为
 * 没有浏览器 session cookie 直接 401）推进阶段，再走跟 CTS/NAL lead 那两条已验证过的
 * 同一套 `buildIntakeRow` → `me_sale_outcomes` 通道写一条成交记录。
 *
 * 鉴权用 `guardAdmin` + `guardConversionRoute`——跟"审核/发送成交记录"那几个既有接口
 * 同一个级别，不是共享 stage 路由那种"能看仪表盘就能操作"的日常级别（魏征评审：
 * 这是"写一条会走 CAPI 的永久成交事实"，权限级别必须对齐，不能各自决定）。
 *
 * `idempotencyKey` 由前端每次弹窗确认时生成一个新 UUID，双击/网络重试复用同一个值——
 * 防的是"同一次点击被处理两遍"；一个联系人**再次**成交（新的一次点击）会带一个新的
 * key，天然产生一条新记录，不需要"先把阶段推离 won 再推回来"这种隐藏流程。
 */

import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { supabaseAdmin } from '@/lib/supabase'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { buildIntakeRow, type IntakeInput } from '@/lib/conversions/intake'

export const dynamic = 'force-dynamic'

/** New Asian Logistics（跨境集运物流代理）。 */
const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
/**
 * NAL 工作台里"已成交"那一档——今天配置阶段时定的 stage_key。
 *
 * 🔴 魏征评审：这里写死的 stage_key 跟前端触发条件（`crm/all/page.tsx` 只看
 * `marketingAction === 'won'`，不看 stageKey）是两套各自独立的判断。Settings
 * 页面（`PipelineStagesPanel.tsx`）目前允许任意编辑哪个阶段带 `marketing_action:
 * 'won'`，且没有唯一性约束——如果以后 NAL 的阶段配置改了（例如把 'won' 这个
 * marketing_action 挪到另一个 stage_key，或同时出现两个"已成交"档），前端弹窗和
 * 这里推进的阶段会对不上，要么这个金额面板不再弹出，要么弹出了但推进的是错的
 * 阶段——没有任何代码层面的报错。改 NAL 的阶段配置前，先确认这两处还对得上。
 */
const WON_STAGE_KEY = 'won'

interface Body {
  contactId?: unknown
  amountMajor?: unknown
  occurredAt?: unknown
  note?: unknown
  idempotencyKey?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const g = await guardConversionRoute(request, NAL_CLIENT_ID)
  if (!g.ok) return g.response

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : ''
  const amountMajor = typeof body.amountMajor === 'number' ? body.amountMajor : Number(body.amountMajor)
  const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt.trim() : ''
  const note = typeof body.note === 'string' ? body.note.trim() || null : null
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''

  if (!contactId) return NextResponse.json({ error: '缺少 contactId' }, { status: 400 })
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    return NextResponse.json({ error: 'amountMajor 必须是大于 0 的数字' }, { status: 400 })
  }
  if (!occurredAt) return NextResponse.json({ error: '缺少 occurredAt（钱到账的日期）' }, { status: 400 })
  if (!idempotencyKey) return NextResponse.json({ error: '缺少 idempotencyKey' }, { status: 400 })

  // ── 1. 先取匹配键、先做校验——都通过了才去动阶段（魏征复审揪出的坑：阶段一旦
  //    推进就是"已成交"的既成事实，如果反过来先推阶段、后面 buildIntakeRow 才
  //    发现这个人邮箱/电话/私信身份一个都没有而拒收，会留下一个永久标记"已成交"
  //    但压根没有成交记录、也没人知道要去修的联系人）──────────────────────
  // 私信身份优先，邮箱/电话兜底（子牙评审：只认 PSID 会让非私信进线的真实成交
  // 静默拒收）。
  const [{ data: contact, error: contactErr }, { data: conversation, error: convErr }] = await Promise.all([
    supabaseAdmin
      .from('contacts')
      .select('id, primary_email, primary_phone, do_not_contact')
      .eq('id', contactId)
      .eq('client_id', NAL_CLIENT_ID)
      .maybeSingle(),
    supabaseAdmin
      .from('conversations')
      .select('participant_psid')
      .eq('contact_id', contactId)
      .eq('client_id', NAL_CLIENT_ID)
      .not('participant_psid', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (contactErr) return NextResponse.json({ error: `读取联系人失败：${contactErr.message}` }, { status: 500 })
  if (convErr) return NextResponse.json({ error: `读取对话失败：${convErr.message}` }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const contactRow = contact as {
    id: string
    primary_email: string | null
    primary_phone: string | null
    do_not_contact: boolean
  }
  const psid = (conversation as { participant_psid: string | null } | null)?.participant_psid ?? null

  const input: IntakeInput = {
    clientId: NAL_CLIENT_ID,
    contactId,
    outcomeKind: 'purchase',
    customerEmail: contactRow.primary_email,
    customerPhone: contactRow.primary_phone,
    pageScopedUserId: psid,
    amount: amountMajor,
    currency: 'NZD',
    occurredAt,
    sourceKind: 'crm_stage_manual',
    sourceRef: `nal_crm_won:${contactId}:${idempotencyKey}`,
    createdBy: g.ctx.actor,
  }

  const built = buildIntakeRow(input, { defaultPhoneCountry: '64', now: new Date() })
  if (!built.ok) {
    return NextResponse.json({ error: built.errors.join('; ') }, { status: 400 })
  }

  // ── 2. 写 CAPI 记录（先写这个，再推阶段——魏征第二轮复审揪出的坑：如果反过来
  //    先推阶段、这一步才失败，会跟原 BLOCKER 一样留下"永久标成已成交、但一条
  //    CAPI 记录都没有"的孤儿联系人，只是触发条件从"校验不过"换成了"写库失败"。
  //    幂等键命中（23505）说明这次点击此前已经成功处理过一遍，money 记录本来就
  //    在，不算错误；除此之外的写库失败必须在推阶段之前拦下来）──────────────
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .insert(built.row)
    .select('id')
    .single()

  let outcomeId: string | null = null
  let alreadyRecorded = false

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      alreadyRecorded = true
    } else {
      return NextResponse.json({ error: `写入失败：${insertErr.message}` }, { status: 500 })
    }
  } else {
    outcomeId = (inserted as { id: string }).id
    await supabaseAdmin.from('me_conversion_audit').insert({
      outcome_id: outcomeId,
      action: 'created',
      actor: g.ctx.actor,
      ip: g.ctx.ip,
      ua: g.ctx.ua,
      request_id: g.ctx.requestId,
      detail: { source_kind: input.sourceKind, source_ref: input.sourceRef, amount_minor: built.row.amount_minor },
    })
  }

  // ── 3. CAPI 记录已经落库（或者确认此前已经落库过），这时候才推进阶段（复用
  //    既有逻辑，不重新发明）。changed:false 只代表"这个人已经在 won 档，阶段
  //    这一步没有新东西要记"——不代表这次点击无效，money 记录已经写完了。────
  const stageResult = await advanceContactStage(
    supabaseAdmin,
    NAL_CLIENT_ID,
    contactId,
    WON_STAGE_KEY,
    note,
    g.ctx.actor,
  )
  if (!stageResult.ok) {
    // CAPI 记录已经是既成事实（钱不会丢），只是阶段没推——如实说清楚，别让人以为
    // 这笔成交整个都没记上。
    return NextResponse.json(
      {
        error: stageResult.error,
        outcomeId,
        alreadyRecorded,
        message: `钱已经记下了，但联系人阶段没能推进到"已成交"：${stageResult.error}`,
      },
      { status: stageResult.status },
    )
  }

  if (alreadyRecorded) {
    return NextResponse.json({
      stageChanged: stageResult.changed,
      alreadyRecorded: true,
      message: '这笔已经记过了（重复提交），没有再插入一条',
    })
  }

  // ── 4. 拒联检查（魏征评审：只回"标记成功"会让人以为整条链路都走完了）──────
  const { data: touchRows, error: touchErr } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('occurred_at, metadata')
    .eq('contact_id', contactId)
    .eq('client_id', NAL_CLIENT_ID)

  let doNotContact = contactRow.do_not_contact
  if (!touchErr) {
    const touches: DncTouch[] = ((touchRows ?? []) as { occurred_at: string; metadata: unknown }[]).map((t) => {
      const meta =
        t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata)
          ? (t.metadata as Record<string, unknown>)
          : null
      return {
        outcome: (meta?.outcome as string | undefined) ?? null,
        flagged: meta?.do_not_contact === true,
        occurredAt: t.occurred_at,
      }
    })
    doNotContact = isDoNotContact(contactRow.do_not_contact, touches)
  }

  return NextResponse.json({
    outcomeId,
    stageChanged: stageResult.changed,
    alreadyRecorded: false,
    doNotContact,
    message: doNotContact
      ? '钱记下了，但这位客人是拒联名单，不会发给广告平台'
      : '记下了，等审核页面确认后再发给广告平台',
  })
}
