/**
 * 账户级日预算上限 —— 改这一列的唯一入口（v2.1 §3.9 / §11.11）。
 *
 * `accountId` 是 Meta 的广告账户号（`client_meta_ad_accounts.ad_account_id`，
 * 形如 `act_123`），不是这张表的行 `id`——跟 `envelope-facts.ts`
 * 按 `input.ad_account_id` 查这一列时用的是同一个键，两处对不上就会出现
 * "面板填了、判据读不到"这种看不见的错位。
 *
 * ── 为什么只许内部员工改（`requireGlobalAdmin`）──────────────────────
 * 这一列直接决定广告自治的"能不能动、动多少"，判据同 `facebook-page` PATCH
 * （AD-SEC-4）：客户成员自己填会让"被约束者自报约束"，那就没有约束。
 *
 * ── 为什么要校验 sum(账户上限) ≤ 客户总闸 ────────────────────────────
 * 客户级总闸（`ad_strategy_configs.daily_budget_cap_cents`）的意义是
 * "这个客户所有账户加起来一天最多花这么多"。账户级上限如果加起来能超过
 * 总闸，总闸就只是纸面数字——账户级各自守着自己的额度，合计却能冲破总闸。
 *
 * 🔴 **这道校验只在配置时把关，不是运行时强制**（欠账，见 ROADMAP 那条
 *    "运行时跨账户日上限强制"）：`envelope-facts.ts` 单账户动作只比对该账户
 *    自己的上限，不会去查"其它账户今天已经花了多少"。这里挡的是"一开始就配
 *    超了"，挡不住"账户各自守规矩、但赶在同一天各花到了各自上限"的情形。
 *
 * ── 客户总闸还没配的情况 ──────────────────────────────────────────────
 * 没有总闸可比时不拒——没有基准就没法说"超没超"。但这不等于没有保护：
 * `envelope-facts.ts` 的规则是"客户绑了 ≥2 个账户、这个账户没配自己的上限
 * → 拒"，账户上限本身仍然必填才能让该账户的自治动起来。
 *
 * ── 币种闸（子牙+魏征审出的 BLOCKER，2026-09-28 补）─────────────────────
 * `client_meta_ad_accounts` 本身没有 `currency` 列——migration
 * `20260927000003` 的表注释早就写明"这一列 PATCH 校验必须做币种检查"，
 * 但第一版实现漏了，会把不同币种的账户上限直接相加去比总闸。
 * 今天不出事纯因为 CTS/NAL 全是纽币；下一个接澳币账户的客户会拿到一个假的
 * "没超"结论。判据（跟熔断 #2 币种闸同源，migration 注释 §3.9 原文）：
 *   ① 参与合计的账户里任一个读不到币种（`ad_entity_snapshots` 没有账户级
 *      快照，或读取本身失败）→ 拒，不猜
 *   ② 参与合计的账户币种不一致 → 拒，不默默相加
 * "参与合计"＝这次改动后 `daily_budget_cap_cents` 非 null 的那些账户
 *   （包括本账户，如果这次写的是非 null 的值）。清空上限（写 null）的账户
 *   不再贡献金额，币种跟它无关。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'

interface PatchBody {
  readonly daily_budget_cap_cents?: unknown
}

function readCapCents(value: unknown): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, cents: null }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: 'daily_budget_cap_cents 必须是整数分，或者 null（清空这个账户的上限）' }
  }
  if (value <= 0) {
    return { ok: false, error: 'daily_budget_cap_cents 必须大于 0' }
  }
  return { ok: true, cents: value }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
): Promise<NextResponse> {
  const { id: clientId, accountId } = await params

  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || !('daily_budget_cap_cents' in body)) {
    return NextResponse.json(
      { error: '缺少 daily_budget_cap_cents（要清空上限请明确传 null）' },
      { status: 400 },
    )
  }

  const parsed = readCapCents(body.daily_budget_cap_cents)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const nextCents = parsed.cents

  // 这个账户必须先在 client_meta_ad_accounts 里挂过号——不允许凭空给一个
  // 没绑定过的账户号写上限，那样面板会显示一个查不到主体的孤儿配置。
  const { data: account, error: accountErr } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('id, ad_account_id')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .maybeSingle()
  if (accountErr) {
    return NextResponse.json({ error: `查账户绑定失败：${accountErr.message}` }, { status: 500 })
  }
  if (!account) {
    return NextResponse.json({ error: `这个客户没有绑定账户 ${accountId}` }, { status: 404 })
  }

  // 校验 sum(账户上限) ≤ 客户总闸：查这个客户名下**其它**账户的上限，
  // 加上即将写入的这个账户的新值，跟客户总闸比。
  const [{ data: siblingRows, error: siblingErr }, { data: cfg, error: cfgErr }] = await Promise.all([
    supabaseAdmin
      .from('client_meta_ad_accounts')
      .select('ad_account_id, daily_budget_cap_cents')
      .eq('client_id', clientId),
    supabaseAdmin
      .from('ad_strategy_configs')
      .select('daily_budget_cap_cents')
      .eq('client_id', clientId)
      .maybeSingle<{ daily_budget_cap_cents: number | null }>(),
  ])
  if (siblingErr) {
    return NextResponse.json({ error: `查账户上限失败：${siblingErr.message}` }, { status: 500 })
  }
  if (cfgErr) {
    return NextResponse.json({ error: `查客户总闸失败：${cfgErr.message}` }, { status: 500 })
  }

  const totalCapCents = typeof cfg?.daily_budget_cap_cents === 'number' ? cfg.daily_budget_cap_cents : null

  if (totalCapCents !== null) {
    const rows = (siblingRows ?? []) as Array<{
      ad_account_id: string
      daily_budget_cap_cents: number | null
    }>
    const sumOthers = rows
      .filter((r) => r.ad_account_id !== accountId)
      .reduce((sum, r) => sum + (typeof r.daily_budget_cap_cents === 'number' ? r.daily_budget_cap_cents : 0), 0)
    const sumWithThis = sumOthers + (nextCents ?? 0)

    // 币种闸：只看这次改动后会"参与合计"的账户——上限非 null 的那些
    // （含本账户，如果这次写的是非 null 值）。清空上限的账户不再贡献金额，
    // 币种跟它无关，不需要拉进来判。
    const contributingIds = rows
      .filter((r) => r.ad_account_id !== accountId && typeof r.daily_budget_cap_cents === 'number')
      .map((r) => r.ad_account_id)
    if (typeof nextCents === 'number') contributingIds.push(accountId)

    if (contributingIds.length > 0) {
      const { data: snapRows, error: snapErr } = await supabaseAdmin
        .from('ad_entity_snapshots')
        .select('ad_account_id, currency, captured_at')
        .eq('client_id', clientId)
        .eq('level', 'account')
        .in('ad_account_id', contributingIds)
        .order('captured_at', { ascending: false })
      if (snapErr) {
        return NextResponse.json({ error: `查账户币种失败：${snapErr.message}` }, { status: 500 })
      }

      // 按 captured_at 倒序，每个账户第一次出现就是它最新那条。
      const latestCurrency = new Map<string, string | null>()
      for (const row of (snapRows ?? []) as Array<{ ad_account_id: string; currency: string | null }>) {
        if (!latestCurrency.has(row.ad_account_id)) latestCurrency.set(row.ad_account_id, row.currency)
      }

      const missing = contributingIds.filter(
        (id) => !latestCurrency.has(id) || latestCurrency.get(id) === null,
      )
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `账户 ${missing.join('、')} 读不到币种，判不了能不能跨账户相加，没有写入` },
          { status: 409 },
        )
      }

      const distinctCurrencies = new Set(latestCurrency.values())
      if (distinctCurrencies.size > 1) {
        return NextResponse.json(
          {
            error:
              `参与合计的账户币种不一致（${[...distinctCurrencies].join('、')}），` +
              '不能直接相加去比客户总闸，没有写入',
          },
          { status: 409 },
        )
      }
    }

    if (sumWithThis > totalCapCents) {
      return NextResponse.json(
        {
          error:
            `这个客户所有账户的日上限加起来会变成 ${sumWithThis} 分，` +
            `超过客户总闸 ${totalCapCents} 分（其它账户合计 ${sumOthers} 分）。` +
            '先降低这个账户或其它账户的上限，或者先把客户总闸调大。',
        },
        { status: 400 },
      )
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .update({ daily_budget_cap_cents: nextCents })
    .eq('id', account.id)
  if (updateErr) {
    return NextResponse.json({ error: `写入失败：${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ad_account_id: accountId, daily_budget_cap_cents: nextCents })
}
