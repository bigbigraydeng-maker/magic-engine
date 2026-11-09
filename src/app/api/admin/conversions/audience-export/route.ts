/**
 * GET /api/admin/conversions/audience-export?client_id=...&format=csv|stats
 *   —— 导出「名单 A」：可传 Meta 客户名单的终端客户（Issue #1397）
 *
 * 为什么是这个接口而不是我在本地导 CSV：客户 PII 从**生产库直接进授权管理员的
 * 浏览器下载**，不落地到任何中间文件。这也绕开了"把个人信息导成文件"的安全闸。
 *
 * 口径与"今日名单"完全同源：同一套 contacts + contact_touchpoints，
 * 同一个 isDoNotContact（真相源触点，不是 contacts 那一列），
 * 同一个 contactKindOf（按邮箱域名分终端/同行/员工）。
 * 只多加一条"来自广告=有同意"的筛。逻辑全在 lib/conversions/audience-export（已测）。
 *
 * `format=stats`（默认）只返回数字，不含任何 PII —— 让人先看池子多大、够不够门槛，
 * 再决定要不要真下载。`format=csv` 才吐明文。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { guardAdmin } from '@/lib/auth/require-admin'
import { assertClientScope } from '@/lib/conversions/route-guard'
import { requireAdmin } from '@/lib/auth/require-admin'
import { fetchAll } from '@/lib/supabase-paginate'
import { isDoNotContact } from '@/lib/crm/dnc'
import { contactKindOf, readDomainRules } from '@/lib/crm/contact-kind'
import {
  audienceToCsv,
  buildMetaAudienceA,
  type AudienceContact,
} from '@/lib/conversions/audience-export'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ContactRow = {
  id: string
  display_name: string | null
  primary_email: string | null
  primary_phone: string | null
  do_not_contact: boolean
  attr_platform: string | null
  attr_ad_id: string | null
}
type IdentityRow = { contact_id: string; value: string }
type TouchRow = {
  contact_id: string
  occurred_at: string
  metadata: { outcome?: string | null; do_not_contact?: boolean } | null
}

export async function GET(request: Request) {
  // 🔴 顶层保险：任何漏网的抛都返回 JSON，**绝不出 HTML 报错页** ——
  //    前端拿 HTML 去 res.json() 会炸「Unexpected token '<'」（2026-09-06 线上）。
  try {
    return await handleGet(request)
  } catch (e) {
    console.error('[audience-export] 未捕获异常:', e)
    return NextResponse.json(
      { error: `服务端出错：${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }
}

async function handleGet(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id') ?? ''
  const agentDenied = await rejectAgentAdsBearer(request, { clientId, action: 'upload_audience' })
  if (agentDenied) return agentDenied

  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const format = searchParams.get('format') ?? 'stats'

  if (!clientId || !UUID_RE.test(clientId)) {
    return NextResponse.json({ error: 'client_id 必填且必须是 uuid' }, { status: 400 })
  }
  const denied = assertClientScope(admin.user.email ?? null, clientId)
  if (denied) return denied

  // source 参数：newsletter/combined 已于 2026-09-07 下线（见下方说明）。
  // 旧页面/书签/脚本若还带着这两个值来请求，必须明确拒绝，不能悄悄换成
  // fbleads 的数据回 200 —— 调用方会把语义完全不同、体量也更小的名单
  // 误当成原来要的那份去用（狄仁杰红线：数据来源被静默替换=数据完整性事故）。
  const source = (searchParams.get('source') ?? 'fbleads').toLowerCase()
  if (source !== 'fbleads') {
    return NextResponse.json(
      {
        error: `source=${source} 已下线（2026-09-07）：newsletter/combined 名单不再提供，只保留 fbleads（广告来源，Issue #1397）。请改走「导出 CSV → Meta 后台上传」这条路。`,
      },
      { status: 410 },
    )
  }

  // 读库：跟今日名单同源的三张表 + 客户配置。
  let contacts: ContactRow[]
  let identities: IdentityRow[]
  let touches: TouchRow[]
  let clientRow: { leads_config: unknown; default_phone_country: string | null } | null
  try {
    ;[contacts, identities, touches, clientRow] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select(
            'id, display_name, primary_email, primary_phone, do_not_contact, attr_platform, attr_ad_id',
          )
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<IdentityRow>((from, to) =>
        supabaseAdmin
          .from('contact_identities')
          .select('contact_id, value')
          .eq('client_id', clientId)
          .eq('kind', 'email')
          .order('contact_id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id, occurred_at, metadata')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
          .range(from, to),
      ),
      supabaseAdmin
        .from('clients')
        .select('leads_config, default_phone_country')
        .eq('id', clientId)
        .maybeSingle()
        .then((r) => r.data as { leads_config: unknown; default_phone_country: string | null } | null),
    ])
  } catch (e) {
    return NextResponse.json(
      { error: `读取失败：${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // 每个人的邮箱（判 kind 要看全部邮箱，同行常用私人 Gmail 来问）。
  const emailsByContact = new Map<string, string[]>()
  for (const c of contacts) if (c.primary_email) emailsByContact.set(c.id, [c.primary_email])
  for (const i of identities) {
    const list = emailsByContact.get(i.contact_id) ?? []
    if (!list.includes(i.value)) list.push(i.value)
    emailsByContact.set(i.contact_id, list)
  }

  // 每个人的触点（判 DNC）。
  const touchesByContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = touchesByContact.get(t.contact_id) ?? []
    list.push(t)
    touchesByContact.set(t.contact_id, list)
  }

  const rules = readDomainRules(clientRow?.leads_config)

  const audienceContacts: AudienceContact[] = contacts.map((c) => ({
    displayName: c.display_name,
    email: c.primary_email,
    phone: c.primary_phone,
    kind: contactKindOf(emailsByContact.get(c.id) ?? [], rules),
    fromAd: c.attr_platform === 'meta' || c.attr_ad_id != null,
    doNotContact: isDoNotContact(
      c.do_not_contact,
      (touchesByContact.get(c.id) ?? []).map((t) => ({
        outcome: t.metadata?.outcome ?? null,
        flagged: t.metadata?.do_not_contact === true,
        occurredAt: t.occurred_at,
      })),
    ),
  }))

  const phoneCountry = clientRow?.default_phone_country ?? null
  const fbleads = buildMetaAudienceA(audienceContacts, phoneCountry)

  // 只导「广告来源」名单（fbleads）。非 fbleads 的 source 在上面已 410 拒绝，走到这里必是 fbleads。
  // newsletter/combined（拉 Mailchimp 合并）2026-09-07 移除：prod 网页请求访问 Mailchimp
  // 会 502（源日志拿不到、未确诊），且实际名单已改由「导出 CSV → Meta 后台上传」这条路做成。

  // ── 只看数字（不含 PII）：让人先看池子够不够 100 门槛 ──────────────────
  if (format !== 'csv') {
    return NextResponse.json({
      source: 'fbleads',
      ...fbleads.stats,
      lookalike_threshold: 100,
      note: thresholdNote(fbleads.stats.kept),
    })
  }

  // 🔴 谁导出了这份 PII，必须留痕（狄仁杰红线：对外交客户联系方式却无审计=硬伤）。
  //    结构化日志（Render 可搜 [audience-export]），只记数量与操作者，不记一个客户字节。
  const fwd = request.headers.get('x-forwarded-for') ?? ''
  console.log(
    '[audience-export]',
    JSON.stringify({
      action: 'download_csv',
      source: 'fbleads',
      client_id: clientId,
      actor: admin.user.email ?? null,
      ip: fwd.split(',')[0]?.trim() || null,
      ua: request.headers.get('user-agent') || null,
      kept: fbleads.rows.length,
      at: new Date().toISOString(),
    }),
  )

  // 真下载：明文 CSV，直接进浏览器，不落地服务器。
  const csv = audienceToCsv(fbleads.rows)
  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="meta-audience-fbleads-${today}.csv"`,
      // 别让浏览器/CDN 缓存这份 PII。
      'cache-control': 'no-store',
    },
  })
}

function thresholdNote(kept: number): string {
  return kept >= 100
    ? '池子够 lookalike 的 100 门槛（注意那是「匹配上」100，实际要看上传后匹配率）'
    : `池子只有 ${kept} 人，可能不够 lookalike 的 100 门槛 —— 建议先上传看匹配数`
}
