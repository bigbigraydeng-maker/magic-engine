/**
 * POST /api/clients/[id]/crm/contacts
 *
 * 新客人快速录入。销售最高频动作之一:「刚有个新客人打进来,先记一下」。没有这个
 * 入口,纯电话新 lead 就只能继续记在 Excel 里 —— Sheet 永远死不了。
 *
 * 复用 identity.resolveContact:靠电话 / 邮箱合并,不靠姓名。同一个人重复录入
 * (双击 / 又打来一次)不会产生两条,命中既有身份即复用 —— 天然幂等,无需 clientRef。
 * 新建的联系人零触点,segments 会把他排进「新进线，没人碰过」,当天名单里立刻能看到。
 *
 * Body: { name?, phone?, email? }  (phone / email 至少一个能规范化)
 * Responses: 200 { contactId, created } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact, AmbiguousIdentityError } from '@/lib/crm/identity'
import { EMPTY_ATTRIBUTION } from '@/lib/crm/attribution'
import {
  segmentContact,
  SEGMENT_ACTION_META,
  type ContactLike,
  engagementFromMetadata,
} from '@/lib/crm/segments'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  extractCustomColumns,
  visibleCustomColumns,
  type CustomColumnKey,
  type TouchpointForColumn,
} from '@/lib/crm/table-columns'

interface ContactRow {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean
  stage: string | null
  first_seen_at: string
}

interface TouchRow {
  id: string
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

interface StageRow {
  stage_key: string
  label: string
  marketing_action: string
  is_terminal: boolean
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * GET /api/clients/[id]/crm/contacts
 *
 * 「全部客人」横表的读模型。一次拉这个客户的人 + 触点 + 阶段模型，在内存里
 * 逐人组装 —— 冷热分级复用 lib/crm/segments 的纯函数，自定义列复用
 * lib/crm/table-columns。335 人 / ~640 触点量级下比 SQL 窗口函数简单，到几千人
 * 再换物化视图（跟 today 路由同一个天花板）。
 *
 * 隔离：requirePaidClientAccess + 所有读按 client_id 收口。admin 也从 URL 收口。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // 必须分页拉全 —— Supabase 单次查询硬顶 1000 行，`.limit(20000)` 会被静默
  // 砍掉且不报错。实测 CTS：库里 1271 条触点只回 1000 条；配合 order desc，
  // 丢掉的是最老的记录，于是「最后接触」「往来次数」这些列全是错的。
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  try {
    ;[contacts, touches, stageRows] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select('id, display_name, primary_phone, primary_email, do_not_contact, stage, first_seen_at')
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('id, contact_id, channel, direction, occurred_at, summary, metadata')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
          // 同一时刻的多条（导入数据里表单与通话常共用一个时间戳）需要一个
          // 确定的次序，否则每次刷新顺序都可能不同。
          .order('id', { ascending: false })
          .range(from, to),
      ),
      fetchAll<StageRow>((from, to) =>
        supabaseAdmin
          .from('client_pipeline_stages')
          .select('stage_key, label, marketing_action, is_terminal')
          .eq('client_id', clientId)
          .order('sort_order', { ascending: true })
          .range(from, to),
      ),
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  // 阶段 map：label 给「跟进到哪步」列，suppressed 决定这个人算不算已结论（影响冷热）。
  const stageMeta = new Map<string, { label: string; suppressed: boolean }>()
  for (const s of stageRows) {
    stageMeta.set(s.stage_key, {
      label: s.label,
      suppressed: stageSuppressesWorklist(
        isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress',
        s.is_terminal,
      ),
    })
  }

  const now = new Date()
  const rows = contacts

  // 逐人组装。custom 存起来供数据驱动的「显不显示这列」判断。
  const customPerContact: Array<Record<CustomColumnKey, string | null>> = []
  const out = rows.map((c) => {
    const tps = byContact.get(c.id) ?? []
    const stage = c.stage ? stageMeta.get(c.stage) : undefined

    const model: ContactLike = {
      id: c.id,
      displayName: c.display_name,
      // 「别再联系」真相源是不可变触点（contacts 列写失败过 / 历史导入只写 outcome）。
      doNotContact:
        c.do_not_contact ||
        tps.some(
          (t) => t.metadata?.do_not_contact === true || t.metadata?.outcome === 'do_not_contact',
        ),
      stageSuppressed: stage?.suppressed ?? false,
      stageLabel: stage?.label ?? null,
      // 时间线按时间正序：最早的在最上，一条条往下读，跟人回忆一段关系的
      // 顺序一致。原先是倒序（最新在最上），于是「填了表单」出现在它引发的
      // 那条留言下面 —— 因果被倒过来，读起来是乱的。
      // 查询本身仍是倒序（上面的 min/max 与分段逻辑与顺序无关），只在
      // 输出时翻转，避免影响其它依赖该顺序的调用方。
      touchpoints: [...tps].reverse().map((t) => ({
        channel: t.channel,
        direction: t.direction,
        occurredAt: t.occurred_at,
        outcome: (t.metadata?.outcome as string) ?? null,
        travelWindow: (t.metadata?.travel_window as string) ?? null,
        callbackAt: (t.metadata?.callback_at as string) ?? null,
        // 邮件被打开 / 链接被点 = 行为信号，不是真人消息。分段逻辑必须区分，
        // 否则「打开了邮件」会冒充「客户回话了」挤进最高优先桶。
        engagement: engagementFromMetadata(t.metadata),
      })),
    }
    const seg = segmentContact(model, now)

    // 进线时间 = 真实最早一条触点（不是导入日期）；没触点退回 first_seen_at。
    // 最近联系 = 最晚一条触点；0 触点显式 null —— 绝不 fallback last_seen_at
    // （它默认 = 建档时的 NOW()，会假装有过一次根本没发生的沟通）。
    let firstTouch = 0
    let lastTouch = 0
    for (const t of tps) {
      const v = ts(t.occurred_at)
      if (v > 0) {
        if (firstTouch === 0 || v < firstTouch) firstTouch = v
        if (v > lastTouch) lastTouch = v
      }
    }

    const forColumns: TouchpointForColumn[] = tps.map((t) => ({
      channel: t.channel,
      occurredAt: t.occurred_at,
      metadata: t.metadata,
    }))
    const custom = extractCustomColumns(forColumns)
    customPerContact.push(custom)

    return {
      contactId: c.id,
      name: c.display_name || '未留姓名',
      firstSeenAt: firstTouch > 0 ? new Date(firstTouch).toISOString() : c.first_seen_at,
      lastTouchAt: lastTouch > 0 ? new Date(lastTouch).toISOString() : null,
      phone: c.primary_phone,
      email: c.primary_email,
      // 电话邮箱都没有时，页面据此显示「仅 FB 私信」而不是「没留联系方式」。
      hasMessenger: tps.some((t) => t.channel === 'messenger'),
      stage: c.stage,
      // 认不出的 stage_key（配置里删了）显示原值，别留空白。
      stageLabel: c.stage ? (stageMeta.get(c.stage)?.label ?? c.stage) : null,
      segment: seg.segment,
      segmentLabel: SEGMENT_ACTION_META[seg.segment].label,
      temperature: seg.temperature,
      custom,
    }
  })

  return NextResponse.json({
    totalContacts: out.length,
    columns: visibleCustomColumns(customPerContact),
    contacts: out,
  })
}

interface Body {
  name?: unknown
  phone?: unknown
  email?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone : null
  const email = typeof body.email === 'string' ? body.email : null

  // 市场决定本地号码怎么补国码(CTS=NZ / Oztop=AU)。
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('semrush_db, country')
    .eq('id', clientId)
    .maybeSingle()
  const defaultCountry: 'NZ' | 'AU' =
    client?.country === 'NZ' || client?.semrush_db === 'nz' ? 'NZ' : 'AU'

  const identities = buildIdentities({ phone, email, defaultCountry })
  if (identities.length === 0) {
    return NextResponse.json(
      { error: '至少要填一个能用的电话或邮箱' },
      { status: 400 },
    )
  }

  try {
    const result = await resolveContact({
      clientId,
      identities,
      displayName: name || null,
      source: 'me_manual',
      // 手工录入:电话打错一位就可能撞上另一个老客户。自动合并会把两个真人的
      // 全部历史搅在一起且不可逆,所以交给人看一眼;也不拿新名字盖掉老客户的名字。
      mergeStrategy: 'reject',
      overwriteDisplayName: false,
      // 员工手工录进来的人:平台就是 'manual',广告层级一律 NULL —— 我们**不知道**
      // 他从哪来(线下认识 / 电话打进来 / 朋友介绍),编一个 platform 会污染
      // 「哪条广告有效」的分母。留 manual 是如实标注「这条没有广告归因」。
      attribution: { ...EMPTY_ATTRIBUTION, platform: 'manual' },
    })
    return NextResponse.json({ contactId: result.contactId, created: result.created })
  } catch (err) {
    if (err instanceof AmbiguousIdentityError) {
      // 电话和邮箱分别属于两个已存在的人 —— 多半是打错了。把两边摆出来让人看。
      const { data: rows } = await supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email')
        .in('id', err.contactIds)
        .eq('client_id', clientId)

      return NextResponse.json(
        {
          error: '这个电话和邮箱分别属于两位已有的客人，请确认是不是填错了',
          reason: 'ambiguous',
          candidates: (rows ?? []).map((r) => ({
            contactId: r.id,
            name: r.display_name ?? '未留姓名',
            phone: r.primary_phone,
            email: r.primary_email,
          })),
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '录入失败' },
      { status: 500 },
    )
  }
}
