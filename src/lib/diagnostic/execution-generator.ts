/**
 * Execution Generator (§5 — P8.5.17)
 *
 * generateExecutionItems(supabase, prescriptionId, clientId)
 *   1. Idempotency check — return existing items if already generated
 *   2. Fetch prescription content from DB
 *   3. Map each PrescriptionAction → ExecutionItem with steps_json
 *   4. Bulk-insert into execution_items
 *   5. Return created items
 *
 * steps_json structure per fix_type (§5.2):
 *   me_auto    → { type, deeplink, steps[] }
 *   fde_manual → { type, steps[] }
 *   third_party → { type, steps[], verification }
 *
 * Owner-tool naming rules (CLAUDE.md):
 *   - ME features: "SEO 内容引擎", "GEO Composer", "社媒内容矩阵"
 *   - SEMrush → "Keyword Intelligence"
 *   - Google → real name ("Google Business Profile")
 *   - Meta → real name ("Meta Ads Manager")
 *   - CMS → "客户网站后台"
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ExecutionItem,
  ExecutionTarget,
  PrescriptionAction,
  PrescriptionContent,
  DiagnosticDimension,
  FixType,
} from '@/types/diagnostic'
import { deriveExecutionTarget } from '@/lib/flywheel/execution-target'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateExecutionItems(
  supabase: SupabaseClient,
  prescriptionId: string,
  clientId: string,
): Promise<ExecutionItem[]> {
  // ── Idempotency check ────────────────────────────────────────────────────
  const existingCheck = await supabase
    .from('execution_items')
    .select('id')
    .eq('prescription_id', prescriptionId)
    .limit(1)

  if (existingCheck.data && existingCheck.data.length > 0) {
    // Already generated — return all existing items
    const { data } = await supabase
      .from('execution_items')
      .select('*')
      .eq('prescription_id', prescriptionId)
      .order('sort_order', { ascending: true })
    return (data ?? []) as ExecutionItem[]
  }

  // ── Fetch prescription ───────────────────────────────────────────────────
  const { data: prescription, error } = await supabase
    .from('prescriptions')
    .select('content, client_id')
    .eq('id', prescriptionId)
    .single()

  if (error || !prescription) {
    throw new Error(`Prescription not found: ${prescriptionId}`)
  }

  const content = prescription.content as PrescriptionContent

  // ── Map actions → execution items ────────────────────────────────────────
  const rows = buildExecutionRows(content, prescriptionId, clientId)

  // ── Bulk insert ──────────────────────────────────────────────────────────
  const { data: inserted, error: insertError } = await supabase
    .from('execution_items')
    .insert(rows)
    .select('*')

  if (insertError) {
    throw new Error(`Failed to create execution items: ${insertError.message}`)
  }

  return (inserted ?? []) as ExecutionItem[]
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------

interface ExecutionRow {
  prescription_id: string
  client_id:       string
  finding_id:      string | null
  dimension:       DiagnosticDimension
  phase:           number
  title:           string
  description:     string
  fix_type:        FixType
  status:          'pending'
  steps_json:      Record<string, unknown>
  execution_target: ExecutionTarget
  sort_order:      number
}

// execution_items.finding_id 是 UUID 列。但华佗处方的 finding_ids 是
// 张骞诊断里的字符串标识符（如 "gbp-missing"），不是真 UUID。
// 只有合法 UUID 才填入 finding_id，否则置 null，原始字符串存到 steps_json 留溯源。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asUuidOrNull(v: string | undefined): string | null {
  return v && UUID_RE.test(v) ? v : null
}

function buildExecutionRows(
  content: PrescriptionContent,
  prescriptionId: string,
  clientId: string,
): ExecutionRow[] {
  const rows: ExecutionRow[] = []

  for (const phase of content.phases) {
    phase.actions.forEach((action, idx) => {
      const findingIds = Array.isArray(action.finding_ids) ? action.finding_ids : []
      rows.push({
        prescription_id: prescriptionId,
        client_id:       clientId,
        finding_id:      asUuidOrNull(findingIds[0]),
        dimension:       action.dimension,
        phase:           phase.phase_number,
        title:           action.title,
        description:     action.description,
        fix_type:        action.fix_type,
        status:          'pending',
        execution_target: action.execution_target
          ?? deriveExecutionTarget(action.dimension, action.fix_type),
        sort_order:      (phase.phase_number - 1) * 100 + idx,
        // 原始 finding_ids 字符串 + 华佗 FDE 字段存进 steps_json 留溯源
        steps_json: {
          ...buildStepsJson(action),
          source_finding_ids: findingIds,
          ...(action.estimated_hours != null    ? { estimated_hours: action.estimated_hours } : {}),
          ...(action.required_skills?.length    ? { required_skills: action.required_skills } : {}),
          ...(action.measurement_method         ? { measurement_method: action.measurement_method } : {}),
          ...(action.dependencies?.length       ? { dependencies: action.dependencies } : {}),
          ...(action.module                     ? { module: action.module } : {}),
        },
      })
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// steps_json builders (§5.2)
// ---------------------------------------------------------------------------

function buildStepsJson(action: PrescriptionAction): Record<string, unknown> {
  if (action.fix_type === 'me_auto')    return buildMeAutoSteps(action)
  if (action.fix_type === 'fde_manual') return buildFdeManualSteps(action)
  return buildThirdPartySteps(action)
}

function buildMeAutoSteps(action: PrescriptionAction): Record<string, unknown> {
  const ownerTool = dimensionToMeTool(action.dimension)
  const deeplink  = buildMeDeeplink(action)

  return {
    type:     'me_auto',
    deeplink,
    steps:    [`在 ${ownerTool} 中自动执行：${action.title}`],
    owner_tool: ownerTool,
  }
}

function buildFdeManualSteps(action: PrescriptionAction): Record<string, unknown> {
  const ownerTool = dimensionToFdeTool(action.dimension)

  return {
    type:  'fde_manual',
    steps: [
      `第 1 步：登录 ${ownerTool}`,
      `第 2 步：${action.description}`,
      `第 3 步：保存更改并截图存档`,
    ],
    owner_tool: ownerTool,
  }
}

function buildThirdPartySteps(action: PrescriptionAction): Record<string, unknown> {
  const ownerTool = dimensionToThirdPartyTool(action.dimension)

  return {
    type:  'third_party',
    steps: [
      `第 1 步：访问 ${ownerTool} 或联系相关平台`,
      `第 2 步：${action.description}`,
      `第 3 步：完成后在执行看板标记完成，并附上截图或链接`,
    ],
    verification: `验证 "${action.title}" 已生效：检查平台数据或截图确认`,
    owner_tool: ownerTool,
  }
}

// ---------------------------------------------------------------------------
// Deeplink builder — routes into ME features by dimension
// ---------------------------------------------------------------------------

function buildMeDeeplink(action: PrescriptionAction): string {
  const dim = action.dimension

  if (dim === 'seo')           return `/dashboard/clients/{clientId}/site-audit/pages`
  if (dim === 'ai_visibility') return `/dashboard/clients/{clientId}/geo`
  if (dim === 'social')        return `/dashboard/clients/{clientId}?tab=reels`
  if (dim === 'ads')           return `/dashboard/clients/{clientId}?tab=campaigns`
  return `/dashboard/clients/{clientId}`
}

// ---------------------------------------------------------------------------
// Tool name mappers (CLAUDE.md naming rules)
// ---------------------------------------------------------------------------

function dimensionToMeTool(dim: DiagnosticDimension): string {
  if (dim === 'seo')           return 'SEO 内容引擎'
  if (dim === 'ai_visibility') return 'GEO Composer'
  if (dim === 'social')        return '社媒内容矩阵'
  if (dim === 'ads')           return '社媒内容矩阵'
  return 'Magic Engine'
}

function dimensionToFdeTool(dim: DiagnosticDimension): string {
  if (dim === 'reputation')    return 'Google Business Profile'
  if (dim === 'seo')           return '客户网站后台'
  if (dim === 'ads')           return 'Meta Ads Manager'
  if (dim === 'ai_visibility') return 'GEO Composer'
  return '客户网站后台'
}

function dimensionToThirdPartyTool(dim: DiagnosticDimension): string {
  if (dim === 'seo')           return 'Keyword Intelligence'
  if (dim === 'ads')           return 'Meta Ads Manager'
  if (dim === 'reputation')    return 'Google Business Profile'
  return '相关第三方平台'
}
