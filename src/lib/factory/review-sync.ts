// P21.J M2 — Factory Review 双向同步核(spec §7.2,被 factory-review-sweeper cron 调用)
// 独立内部 base `ME Factory Ops`(魏征 F5:「通过」= 花钱按钮,授权三闸):
//   ①base 协作者白名单(物理面) ②审核人 ∈ FACTORY_REVIEWER_EMAILS(sweeper 校验,fail-closed)
//   ③$50 绝对硬顶(FACTORY_PUBLISH_BUDGET_HARD_CAP_USD)
// 列名 = 同步契约,与 Airtable base app6EUitwQEv8Oukk 两张表一一对应,改列名必须同步这里。

import { supabaseAdmin } from '@/lib/supabase'
import { FACTORY_PUBLISH_BUDGET_HARD_CAP_USD } from './constants'

const AIRTABLE_API = 'https://api.airtable.com/v0'

export const FACTORY_OPS_BASE_ID = process.env.FACTORY_OPS_BASE_ID ?? 'app6EUitwQEv8Oukk'
export const FACTORY_REVIEW_TABLE_ID = process.env.FACTORY_REVIEW_TABLE_ID ?? 'tblAjJn4fDKGL7RPN'
export const WINNER_INTAKE_TABLE_ID = process.env.WINNER_INTAKE_TABLE_ID ?? 'tbl7MrlWX7RuaXS16'

// 🎬 Factory Review 列名契约
const F = {
  woId: '工单 ID',
  client: '客户',
  video: '成片',
  rationale: '人话理由',
  genNote: '生成段标注',
  cost: '成本 USD',
  action: '审核动作',
  feedback: '打回意见',
  newBudget: '新预算 USD',
  receipt: '系统回执',
  submittedAt: '提交时间',
  reviewer: '审核人', // Last-modified-by(审核动作) 字段,PM 在 Airtable UI 手动添加(API 建不了该类型)
} as const

// 🏆 Winner Intake 列名契约
const W = {
  adName: '广告名称',
  client: '客户',
  hook: 'Hook 段描述',
  middle: 'Middle 段描述',
  cta: 'CTA 段描述',
  tags: '赢因标签',
  cpt: 'Cost per ThruPlay USD',
  perfNote: '表现数据备注',
  syncStatus: '同步状态',
  meSyncId: 'ME 同步 ID',
} as const

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

function nzNow(): string {
  return new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour12: false })
}

async function airtableFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.AIRTABLE_API_KEY
  if (!apiKey) throw new Error('AIRTABLE_API_KEY not configured')
  return fetch(`${AIRTABLE_API}/${FACTORY_OPS_BASE_ID}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function listRecords(tableId: string, filterByFormula: string): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ filterByFormula, pageSize: '100' })
    if (offset) qs.set('offset', offset)
    const res = await airtableFetch(`${tableId}?${qs}`)
    if (!res.ok) throw new Error(`airtable list ${tableId} failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { records: AirtableRecord[]; offset?: string }
    out.push(...json.records)
    offset = json.offset
  } while (offset)
  return out
}

async function patchRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await airtableFetch(`${tableId}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(`airtable patch ${recordId} failed: ${res.status} ${await res.text()}`)
}

/** 审核人白名单(魏征 F5 ②闸)。fail-closed:env 未配置 → 无人被信任,一律不执行 */
function reviewerAllowed(rec: AirtableRecord): boolean {
  const raw = process.env.FACTORY_REVIEWER_EMAILS
  if (!raw) return false
  const whitelist = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const reviewer = rec.fields[F.reviewer] as { email?: string } | undefined
  const email = reviewer?.email?.toLowerCase()
  return !!email && whitelist.includes(email)
}

/** 公开 bucket URL(migration §4.7:content-factory 公开读) */
function publicVideoUrl(bucketPath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/content-factory/${bucketPath}`
}

// ── 方向 A:ME rendered 工单 → Airtable 审核卡 ────────────────────────────────

interface PushResult {
  pushed: string[]
  errors: string[]
}

function buildGenNote(brief: Record<string, unknown>, redlineHits: string[]): string {
  const segments = Array.isArray(brief['segments'])
    ? (brief['segments'] as Array<Record<string, unknown>>)
    : []
  const lines = segments.map((s) => {
    const generated = !Array.isArray(s['clip_ids']) || (s['clip_ids'] as unknown[]).length === 0
    return `${String(s['role'])}: ${generated ? '🤖 AI 生成 (B 轨)' : '🎥 库内素材'} — ${String(s['description'] ?? '')}`
  })
  if (redlineHits.length > 0) {
    lines.unshift(`⚠️ 红线复扫命中: ${redlineHits.join(' / ')} —— 请重点核对文案`)
  }
  return lines.join('\n')
}

export async function pushRenderedToAirtable(): Promise<PushResult> {
  const result: PushResult = { pushed: [], errors: [] }
  const { data: orders, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, client_id, status, brief, output, actual_cost_usd, rationale_one_liner, review_ref')
    .eq('status', 'rendered')
  if (error) throw new Error(`rendered orders query failed: ${error.message}`)

  for (const wo of orders ?? []) {
    try {
      // 幂等:review_ref 已有 record id,或 Airtable 已存在同工单 ID 的卡(create 后崩溃的补救)
      const ref = (wo.review_ref ?? {}) as Record<string, unknown>
      let recordId = typeof ref['airtable_record_id'] === 'string' ? (ref['airtable_record_id'] as string) : null
      if (!recordId) {
        const existing = await listRecords(
          FACTORY_REVIEW_TABLE_ID,
          `{${F.woId}} = '${wo.id}'`,
        )
        recordId = existing[0]?.id ?? null
      }
      if (!recordId) {
        const { data: client } = await supabaseAdmin
          .from('clients').select('name').eq('id', wo.client_id).maybeSingle()
        const output = (wo.output ?? {}) as Record<string, unknown>
        const videoPath = String(output['video_path'] ?? '')
        const redlineHits = Array.isArray(output['redline_hits']) ? (output['redline_hits'] as string[]) : []
        const res = await airtableFetch(FACTORY_REVIEW_TABLE_ID, {
          method: 'POST',
          body: JSON.stringify({
            fields: {
              [F.woId]: wo.id,
              [F.client]: client?.name ?? wo.client_id,
              [F.video]: videoPath ? [{ url: publicVideoUrl(videoPath) }] : [],
              [F.rationale]: wo.rationale_one_liner,
              [F.genNote]: buildGenNote((wo.brief ?? {}) as Record<string, unknown>, redlineHits),
              [F.cost]: Number(wo.actual_cost_usd),
              [F.action]: '待审',
              [F.submittedAt]: new Date().toISOString(),
            },
            typecast: true,
          }),
        })
        if (!res.ok) throw new Error(`airtable create failed: ${res.status} ${await res.text()}`)
        recordId = ((await res.json()) as AirtableRecord).id
      }

      const { data: upd, error: upErr } = await supabaseAdmin
        .from('content_work_orders')
        .update({
          status: 'in_review',
          review_ref: { ...ref, airtable_record_id: recordId, pushed_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq('id', wo.id)
        .eq('status', 'rendered')
        .select('id')
      if (upErr) throw new Error(upErr.message)
      if (upd && upd.length > 0) result.pushed.push(wo.id)
    } catch (err) {
      result.errors.push(`${wo.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

// ── 方向 B:Airtable 审核动作 → ME 工单状态 ──────────────────────────────────

interface PullResult {
  approved: string[]
  rejected: string[]
  budgetUpdated: string[]
  refused: string[]
  errors: string[]
}

async function applyApprove(wo: Record<string, unknown>, rec: AirtableRecord): Promise<boolean> {
  const ref = (wo.review_ref ?? {}) as Record<string, unknown>
  const reviewer = (rec.fields[F.reviewer] as { email?: string } | undefined)?.email ?? 'unknown'
  const { data: upd, error } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'approved',
      review_ref: { ...ref, approved_by: reviewer, approved_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', wo.id as string)
    .eq('status', 'in_review')
    .select('id')
  if (error) throw new Error(error.message)
  return !!upd && upd.length > 0
}

/** 打回·画面质量:老单 review_rejected + 重开新单,打回意见进新单 brief(M2 验收②) */
async function applyQualityReject(
  wo: Record<string, unknown>,
  feedback: string,
  reviewer: string,
): Promise<boolean> {
  const { data: upd, error } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'review_rejected',
      reject_category: 'quality',
      reject_reason: feedback,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wo.id as string)
    .eq('status', 'in_review')
    .select('id')
  if (error) throw new Error(error.message)
  if (!upd || upd.length === 0) return false

  const brief = (wo.brief ?? {}) as Record<string, unknown>
  const { error: insErr } = await supabaseAdmin.from('content_work_orders').insert({
    client_id: wo.client_id,
    signal_id: wo.signal_id,
    goal_id: wo.goal_id,
    master_brief_id: wo.master_brief_id,
    winner_structure_id: wo.winner_structure_id,
    order_type: wo.order_type,
    angle: wo.angle,
    angle_source: wo.angle_source,
    rationale_one_liner: wo.rationale_one_liner,
    brief: {
      ...brief,
      review_feedback: feedback,
      review_feedback_by: reviewer,
      reopened_from: wo.id,
    },
    budget_cap_usd: wo.budget_cap_usd,
    source_ad_id: wo.source_ad_id,
    status: 'queued',
  })
  if (insErr) throw new Error(`reopen insert failed: ${insErr.message}`)
  return true
}

/** 打回·预算不对:只改投放预算回 in_review 二次确认,不重生产、不消耗 attempt(板桥 #9) */
async function applyBudgetUpdate(wo: Record<string, unknown>, newBudget: number): Promise<boolean> {
  const ref = (wo.review_ref ?? {}) as Record<string, unknown>
  const { data: upd, error } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      review_ref: { ...ref, publish_budget_usd: newBudget, budget_updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', wo.id as string)
    .eq('status', 'in_review')
    .select('id')
  if (error) throw new Error(error.message)
  return !!upd && upd.length > 0
}

export async function pullReviewActions(): Promise<PullResult> {
  const result: PullResult = { approved: [], rejected: [], budgetUpdated: [], refused: [], errors: [] }
  const pending = await listRecords(
    FACTORY_REVIEW_TABLE_ID,
    `AND({${F.action}} != '待审', {${F.action}} != '', {${F.receipt}} = '')`,
  )

  for (const rec of pending) {
    const woId = String(rec.fields[F.woId] ?? '')
    try {
      // 白名单闸(fail-closed):审核人字段缺失(PM 未加 Last-modified-by 列)= 无法验证 = 不执行
      if (!reviewerAllowed(rec)) {
        result.refused.push(woId)
        await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
          [F.receipt]: `⚠️ 审核人不在白名单(或缺「审核人」列),未执行 ${nzNow()}`,
        })
        console.warn(`[factory-review-sweeper] review action refused (reviewer not whitelisted): wo=${woId}`)
        continue
      }
      const { data: wo, error } = await supabaseAdmin
        .from('content_work_orders')
        .select('*')
        .eq('id', woId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!wo) {
        await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, { [F.receipt]: `❌ 找不到工单 ${nzNow()}` })
        continue
      }

      const action = String(rec.fields[F.action] ?? '')
      const reviewer = (rec.fields[F.reviewer] as { email?: string } | undefined)?.email ?? 'unknown'
      if (action === '通过') {
        const ok = await applyApprove(wo, rec)
        await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
          [F.receipt]: ok ? `系统已收到 ✅ 通过 ${nzNow()}` : `❌ 工单已不在待审状态,未执行 ${nzNow()}`,
        })
        if (ok) result.approved.push(woId)
      } else if (action === '打回·画面质量') {
        const feedback = String(rec.fields[F.feedback] ?? '').trim()
        if (!feedback) {
          await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
            [F.receipt]: `❌ 请先填「打回意见」再选打回·画面质量 ${nzNow()}`,
          })
          continue
        }
        const ok = await applyQualityReject(wo, feedback, reviewer)
        await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
          [F.receipt]: ok ? `系统已收到 ✅ 已打回并重开工单 ${nzNow()}` : `❌ 工单已不在待审状态,未执行 ${nzNow()}`,
        })
        if (ok) result.rejected.push(woId)
      } else if (action === '打回·预算不对') {
        const newBudget = Number(rec.fields[F.newBudget])
        if (!Number.isFinite(newBudget) || newBudget <= 0 || newBudget > FACTORY_PUBLISH_BUDGET_HARD_CAP_USD) {
          await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
            [F.receipt]: `❌ 新预算需在 $0–$${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD} 之间 ${nzNow()}`,
          })
          continue
        }
        const ok = await applyBudgetUpdate(wo, newBudget)
        // 回 待审 让 PM 二次确认(不重生产,板桥 #9)
        await patchRecord(FACTORY_REVIEW_TABLE_ID, rec.id, {
          [F.receipt]: ok
            ? `系统已收到 ✅ 预算已更新为 $${newBudget},请核对后再点通过 ${nzNow()}`
            : `❌ 工单已不在待审状态,未执行 ${nzNow()}`,
          ...(ok ? { [F.action]: '待审' } : {}),
        })
        if (ok) result.budgetUpdated.push(woId)
      }
    } catch (err) {
      result.errors.push(`${woId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

// ── 方向 C:Winner Intake → winner_structures(manual_intake,魏征 F11/板桥 #2)──

interface IntakeResult {
  imported: string[]
  failed: string[]
  errors: string[]
}

export async function pullWinnerIntake(): Promise<IntakeResult> {
  const result: IntakeResult = { imported: [], failed: [], errors: [] }
  const rows = await listRecords(
    WINNER_INTAKE_TABLE_ID,
    `AND({${W.meSyncId}} = '', OR({${W.syncStatus}} = '', {${W.syncStatus}} = '待入库'))`,
  )

  for (const rec of rows) {
    const adName = String(rec.fields[W.adName] ?? '').trim()
    try {
      const clientName = String(rec.fields[W.client] ?? '').trim()
      const hook = String(rec.fields[W.hook] ?? '').trim()
      if (!adName || !clientName || !hook) {
        // 三必填缺一不入库,不标失败(FDE 可能还在填)
        continue
      }
      const { data: client, error: cErr } = await supabaseAdmin
        .from('clients')
        .select('id')
        .ilike('name', `%${clientName}%`)
        .limit(1)
        .maybeSingle()
      if (cErr) throw new Error(cErr.message)
      if (!client) {
        await patchRecord(WINNER_INTAKE_TABLE_ID, rec.id, { [W.syncStatus]: '入库失败' })
        result.failed.push(adName)
        console.warn(`[factory-review-sweeper] winner intake client not found: "${clientName}"`)
        continue
      }
      const cpt = Number(rec.fields[W.cpt])
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('winner_structures')
        .insert({
          client_id: client.id,
          entry_channel: 'manual_intake',
          source_ad_id: adName,
          hook_segment: { description: hook },
          middle_segment: { description: String(rec.fields[W.middle] ?? '').trim() },
          cta_segment: { description: String(rec.fields[W.cta] ?? '').trim() },
          win_reason_tags: Array.isArray(rec.fields[W.tags]) ? (rec.fields[W.tags] as string[]) : [],
          cost_per_thruplay: Number.isFinite(cpt) && cpt > 0 ? cpt : null,
          performance: {
            notes: String(rec.fields[W.perfNote] ?? '').trim(),
            source: 'winner_intake_airtable',
          },
          status: 'active',
        })
        .select('id')
        .single()
      if (insErr) throw new Error(insErr.message)
      await patchRecord(WINNER_INTAKE_TABLE_ID, rec.id, {
        [W.syncStatus]: '已入库',
        [W.meSyncId]: ins.id,
      })
      result.imported.push(adName)
    } catch (err) {
      result.errors.push(`${adName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
