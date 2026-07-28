/**
 * 客户阶段模型配置 —— GET 列表(带每档人数) / PATCH 增改 + 排序。
 *
 * 删除单独走 DELETE /pipeline-stages/[stageKey](带守卫 + 一键改派),
 * 不在 PATCH 里做全列表 diff 删除 —— diff 删除易误删、且难保证客户隔离。
 *
 * 安全:GET/PATCH 都过 requirePaidClientAccess;所有读写按 client_id 收口。
 *   · 既有阶段 upsert = UPDATE 模式(onConflict client_id,stage_key,不 ignoreDuplicates),
 *     否则改中文名 / 拖排序会被 ON CONFLICT DO NOTHING 静默吞掉。
 *   · payload 里 stageKey 非空但不属于本客户 → 400,防跨客户注入 key。
 *   · 新增阶段(stageKey==null)服务端生成 custom_<hex>,运营永不见 / 填 slug。
 *
 * Responses: 200 { stages } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { isMarketingAction, type PipelineStage } from '@/lib/crm/pipeline'

interface StageRow {
  stage_key: string
  label: string
  sort_order: number
  marketing_action: string
  is_terminal: boolean
}

/** 读该客户全部阶段 + 每档当前人数。GET 和 PATCH 成功后都用它返回。 */
async function loadStages(clientId: string): Promise<PipelineStage[]> {
  const [{ data: stages }, { data: contacts }] = await Promise.all([
    supabaseAdmin
      .from('client_pipeline_stages')
      .select('stage_key, label, sort_order, marketing_action, is_terminal')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('contacts')
      .select('stage')
      .eq('client_id', clientId)
      .not('stage', 'is', null)
      .limit(50000),
  ])

  const counts = new Map<string, number>()
  for (const c of (contacts ?? []) as { stage: string | null }[]) {
    if (c.stage) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1)
  }

  return ((stages ?? []) as StageRow[]).map((s) => ({
    stageKey: s.stage_key,
    label: s.label,
    sortOrder: s.sort_order,
    marketingAction: isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress',
    isTerminal: s.is_terminal,
    contactCount: counts.get(s.stage_key) ?? 0,
  }))
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  return NextResponse.json({ stages: await loadStages(clientId) })
}

interface PatchStage {
  stageKey?: unknown
  label?: unknown
  sortOrder?: unknown
  marketingAction?: unknown
  isTerminal?: unknown
}

function genStageKey(): string {
  return `custom_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { stages?: unknown }
  try {
    body = (await req.json()) as { stages?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.stages) || body.stages.length === 0) {
    return NextResponse.json({ error: '至少保留一个阶段' }, { status: 400 })
  }

  // 逐条校验(运营输入 → 严格挡)。
  const rows: {
    stageKey: string | null
    label: string
    sortOrder: number
    marketingAction: string
    isTerminal: boolean
  }[] = []
  for (const raw of body.stages as PatchStage[]) {
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!label) {
      return NextResponse.json({ error: '每个阶段都要有名字' }, { status: 400 })
    }
    if (!isMarketingAction(raw.marketingAction)) {
      return NextResponse.json({ error: `「${label}」的处理方式不合法` }, { status: 400 })
    }
    // 上限挡住 int4 溢出（溢出会变成 500 带原始英文报错，运营看不懂）。
    const sortOrder = Number(raw.sortOrder)
    if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 100_000) {
      return NextResponse.json({ error: `「${label}」的排序值不合法` }, { status: 400 })
    }
    rows.push({
      stageKey: typeof raw.stageKey === 'string' && raw.stageKey.trim() ? raw.stageKey.trim() : null,
      label,
      sortOrder: Math.trunc(sortOrder),
      marketingAction: raw.marketingAction,
      isTerminal: raw.isTerminal === true,
    })
  }

  // 既有 stage_key 必须真属于本客户 —— 防跨客户注入 / 拿旧数据乱改。
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 })
  }
  const existingKeys = new Set((existing ?? []).map((r) => r.stage_key as string))

  const updates = rows.filter((r) => r.stageKey !== null)
  const seenKeys = new Set<string>()
  for (const u of updates) {
    if (!existingKeys.has(u.stageKey as string)) {
      return NextResponse.json({ error: '有阶段已被改动，请刷新后重试' }, { status: 400 })
    }
    // 同一个 key 在一个 upsert 里出现两次 → Postgres 直接报错。挡在这里给人话。
    if (seenKeys.has(u.stageKey as string)) {
      return NextResponse.json({ error: '同一个阶段重复了，请刷新后重试' }, { status: 400 })
    }
    seenKeys.add(u.stageKey as string)
  }
  const inserts = rows.filter((r) => r.stageKey === null)

  // 1) 既有阶段:UPDATE 模式 upsert(会真正改 label / sort_order / action / terminal)。
  if (updates.length > 0) {
    const nowIso = new Date().toISOString()
    const { error: upErr } = await supabaseAdmin.from('client_pipeline_stages').upsert(
      updates.map((u) => ({
        client_id: clientId,
        stage_key: u.stageKey as string,
        label: u.label,
        sort_order: u.sortOrder,
        marketing_action: u.marketingAction,
        is_terminal: u.isTerminal,
        updated_at: nowIso,
      })),
      { onConflict: 'client_id,stage_key' },
    )
    if (upErr) {
      return NextResponse.json({ error: `保存失败: ${upErr.message}` }, { status: 500 })
    }
  }

  // 2) 新增阶段:独立 plain insert,服务端生成 key。撞车(23505)极罕见,重生成重试一次。
  for (const ins of inserts) {
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const stageKey = genStageKey()
      const { error: insErr } = await supabaseAdmin.from('client_pipeline_stages').insert({
        client_id: clientId,
        stage_key: stageKey,
        label: ins.label,
        sort_order: ins.sortOrder,
        marketing_action: ins.marketingAction,
        is_terminal: ins.isTerminal,
      })
      if (!insErr) break
      // 23505 = 唯一约束撞车,换个 key 再试;其它错误直接抛。
      if (insErr.code === '23505' && attempt < 3) {
        attempt++
        continue
      }
      return NextResponse.json({ error: `新增阶段失败: ${insErr.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ stages: await loadStages(clientId) })
}
