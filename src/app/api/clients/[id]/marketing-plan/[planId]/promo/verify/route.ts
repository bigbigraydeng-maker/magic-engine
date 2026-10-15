/**
 * POST /api/clients/[id]/marketing-plan/[planId]/promo/verify
 * FDE 把一项「读不到、只能人工核实」的检查点成已核实（落地页真实存在 / 客户已同意措辞）。
 *
 * 记录写在 generation_meta.promo_checks（服务端写入、保存接口不接受），
 * 所以计划批准、内容被锁之后，后面阶段仍然可以补核实。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { MANUAL_GATE_KEYS } from '@/lib/marketing-plan/promo/gates'
import { readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'
import type { MarketingPlan, PromoManualCheckRecord } from '@/lib/marketing-plan/types'

export async function POST(req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  try {
    const body = (await req.json().catch(() => ({}))) as { phase_id?: string; check_key?: string; note?: string }
    const phaseId = body.phase_id ?? ''
    const checkKey = body.check_key ?? ''
    if (!(MANUAL_GATE_KEYS as readonly string[]).includes(checkKey)) {
      return NextResponse.json({ success: false, error: '这一项不需要人工核实' }, { status: 400 })
    }

    const { data: plan } = await supabaseAdmin
      .from('marketing_plans').select('*')
      .eq('id', params.planId).eq('client_id', params.id)
      .maybeSingle<MarketingPlan>()
    if (!plan) return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    if (plan.status === 'archived') return NextResponse.json({ success: false, error: '已归档的计划不能核实' }, { status: 409 })

    const spec = readPromoSpec(plan.plan_data)
    if (!spec || !spec.phases.some(p => p.id === phaseId)) {
      return NextResponse.json({ success: false, error: '阶段不存在' }, { status: 400 })
    }

    // 只有含广告步骤的阶段才需要人工核实（落地页 / 措辞都是广告相关）
    const phase = spec.phases.find(p => p.id === phaseId)
    if (!phase || !phase.steps.some(s => s.kind === 'ads_campaign')) {
      return NextResponse.json({ success: false, error: '这个阶段没有广告步骤，不需要人工核实' }, { status: 400 })
    }

    const record: PromoManualCheckRecord = {
      phase_id: phaseId, check_key: checkKey,
      verified_by: access.user.email ?? 'unknown',
      verified_at: new Date().toISOString(),
      note: (body.note ?? '').slice(0, 500),
      content_hash: promoContentHash(spec),
    }
    const meta = { ...(plan.generation_meta ?? {}), promo_checks: [...(plan.generation_meta?.promo_checks ?? []), record] }
    const { data, error } = await supabaseAdmin
      .from('marketing_plans').update({ generation_meta: meta })
      .eq('id', params.planId).eq('client_id', params.id)
      .eq('updated_at', plan.updated_at) // 读完到写入之间被别处改过 → 不覆盖
      .select('id').maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, error: '这份计划刚刚在别处被改过，核实没有记录。请刷新页面后再点一次。' }, { status: 409 })
    }
    return NextResponse.json({ success: true, record })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
