/**
 * Marketing Plan Task Dispatcher
 *
 * Plan 批准时调用：把 plan_data.tasks 批量插入到 execution_items 表。
 * 这些任务出现在 Luban 执行看板上，和诊断处方任务并存（用 source 字段区分）。
 *
 * 设计要点：
 *   - 任务的 dimension 由 kind 推导（social_* → social, blog_article → seo）
 *   - phase 由 due_date 相对今天的天数推导：本周→1，下两周→2，更远→3
 *   - source='marketing_plan'，marketing_plan_id 设置为 Plan ID
 *   - prescription_id 保持 NULL（受 check 约束保护）
 *   - fix_type 全部 'fde_manual'（人工生产内容）
 */

import { supabaseAdmin } from '@/lib/supabase'
import type {
  DispatchResult,
  MarketingPlan,
  PlanTask,
  PlanTaskKind,
  PlanTaskRequires,
} from './types'

// ─── 推导 dimension ────────────────────────────────────────────────────────────

function kindToDimension(kind: PlanTaskKind): 'social' | 'seo' {
  return kind === 'blog_article' ? 'seo' : 'social'
}

// ─── 推导 requires（Phase 20.D 素材依赖标注）──────────────────────────────────────
//
// 默认规则（可被 task.requires 显式覆盖）：
//   social_reel / social_story → client_video（需要视频素材）
//   social_post                → client_photo（需要图片素材）
//   blog_article               → none（ME 可全自动生成）

function kindToRequires(kind: PlanTaskKind): PlanTaskRequires {
  if (kind === 'social_reel' || kind === 'social_story') return 'client_video'
  if (kind === 'social_post') return 'client_photo'
  return 'none'  // blog_article
}

// ─── 推导 phase ────────────────────────────────────────────────────────────────

/**
 * 根据 due_date 相对今天的天数计算 phase：
 *   ≤ 7 天 → Phase 1（即时修复）
 *   ≤ 21 天 → Phase 2（结构改善）
 *   更远 → Phase 3（长期增长）
 */
function dueDateToPhase(dueDate: string): number {
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  const days = (due - now) / (1000 * 60 * 60 * 24)
  if (days <= 7)  return 1
  if (days <= 21) return 2
  return 3
}

// ─── 推导 steps_json（写到 execution_items.steps_json）──────────────────────────
//
// 让"内容工作台"知道这是个 Marketing Plan 任务，并可以推导出正确的生成模式。

function buildStepsJson(task: PlanTask): Record<string, unknown> {
  const requires = task.requires ?? kindToRequires(task.kind)

  // P21.8 fix — 同时写 platforms 数组（供量产扇出用）和兼容旧 platform 单字符串
  // platform 单值保留供旧代码读，platforms 数组是新的多平台扇出来源
  const platformSingle = task.platform ?? null
  const platformsArray: string[] = platformSingle
    ? [platformSingle]
    : ['facebook', 'instagram', 'tiktok']   // 社媒任务无指定平台时默认 3 个

  return {
    source: 'marketing_plan',
    kind: task.kind,
    platform: platformSingle,         // 兼容旧字段
    platforms: platformsArray,        // 新：量产扇出用
    topic: task.topic ?? null,
    source_blog_topic_index: task.source_blog_topic_index ?? null,
    source_strategy_item_id: task.source_strategy_item_id ?? null,
    requires,                  // Phase 20.D: 素材依赖标注
    // FDE meta（供执行看板 FdeMetaRow 显示）
    estimated_hours: task.kind === 'blog_article' ? 4 : 1,
    required_skills:
      task.kind === 'blog_article'
        ? ['blog writing', 'SEO optimisation']
        : task.kind === 'social_reel'
          ? ['video direction', 'social copywriting']
          : ['social copywriting'],
  }
}

// ─── execution_target — 让 FDE 点"在内容工作台执行"时跳到正确入口 ──────────────

function buildExecutionTarget(task: PlanTask): {
  mode: string
  flywheel?: string
  module?: string
} {
  // social_* → social_matrix（社媒矩阵 / Reels Studio）
  // blog_article → seo_engine（博客工作台）
  return task.kind === 'blog_article'
    ? { mode: 'in_house', flywheel: 'seo',    module: 'seo_engine' }
    : { mode: 'in_house', flywheel: 'social', module: 'social_matrix' }
}

// ─── 维度标签（用于自动生产包标题）──────────────────────────────────────────────

const DIMENSION_LABEL: Record<string, string> = {
  social: '社媒内容',
  seo:    '博客内容',
}

// ─── 自动建生产包（按维度分组）────────────────────────────────────────────────────

async function createProductionPackagesFromPlan(
  plan: MarketingPlan,
  tasks: PlanTask[],
  executionItemIds: string[],
): Promise<{ packages_created: number; package_ids: string[] }> {
  // Resolve master_brief_id — required NOT NULL on production_packages
  let masterBriefId = plan.master_brief_id
  if (!masterBriefId) {
    const { data } = await supabaseAdmin
      .from('master_briefs')
      .select('id')
      .eq('client_id', plan.client_id)
      .limit(1)
      .maybeSingle()
    masterBriefId = data?.id ?? null
  }
  if (!masterBriefId) {
    console.warn('[task-dispatcher] No master_brief found for client, skipping package creation')
    return { packages_created: 0, package_ids: [] }
  }

  // Group execution_item ids by dimension
  const grouped: Record<string, string[]> = {}
  tasks.forEach((task, i) => {
    const dim = kindToDimension(task.kind)
    if (!grouped[dim]) grouped[dim] = []
    grouped[dim].push(executionItemIds[i])
  })

  const inserts = Object.entries(grouped).map(([dim, itemIds]) => ({
    client_id:                   plan.client_id,
    master_brief_id:             masterBriefId as string,
    marketing_plan_id:           plan.id,
    campaign_id:                 plan.campaign_id,
    dimension:                   dim,
    title:                       `${plan.title} — ${DIMENSION_LABEL[dim] ?? dim}`,
    brief:                       null,
    status:                      'draft',
    source_payload:              { marketing_plan_id: plan.id, execution_item_ids: itemIds },
    generation_context_snapshot: {},
  }))

  const { data, error } = await supabaseAdmin
    .from('production_packages')
    .insert(inserts)
    .select('id')

  if (error) {
    console.error('[task-dispatcher] Failed to create production packages:', error)
    return { packages_created: 0, package_ids: [] }
  }

  const packageIds = (data ?? []).map(r => r.id as string)
  return { packages_created: packageIds.length, package_ids: packageIds }
}

// ─── 主派发函数 ────────────────────────────────────────────────────────────────

export async function dispatchPlanTasks(plan: MarketingPlan): Promise<DispatchResult> {
  const tasks = plan.plan_data?.tasks ?? []

  if (tasks.length === 0) {
    return { marketing_plan_id: plan.id, tasks_created: 0, task_ids: [], packages_created: 0, package_ids: [] }
  }

  const rows = tasks.map((task, idx) => ({
    client_id:         plan.client_id,
    prescription_id:   null,
    marketing_plan_id: plan.id,
    source:            'marketing_plan',
    finding_id:        null,
    dimension:         kindToDimension(task.kind),
    phase:             dueDateToPhase(task.due_date),
    title:             task.title,
    description:       task.description,
    fix_type:          'fde_manual',
    status:            'pending',
    steps_json:        buildStepsJson(task),
    execution_target:  buildExecutionTarget(task),
    sort_order:        idx,
    due_date:          task.due_date,
  }))

  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .insert(rows)
    .select('id')

  if (error) {
    throw new Error(`Failed to dispatch plan tasks: ${error.message}`)
  }

  const ids = (data ?? []).map(r => r.id as string)

  const { packages_created, package_ids } = await createProductionPackagesFromPlan(plan, tasks, ids)

  return {
    marketing_plan_id: plan.id,
    tasks_created:     ids.length,
    task_ids:          ids,
    packages_created,
    package_ids,
  }
}

// ─── 反向操作：删除某 Plan 派发的所有未完成任务（用于"撤回审批"场景）─────────

export async function revokePlanTasks(planId: string): Promise<{ revoked: number }> {
  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .delete()
    .eq('marketing_plan_id', planId)
    .in('status', ['pending'])      // 只删未开始的任务，已开工的保留
    .select('id')

  if (error) {
    throw new Error(`Failed to revoke plan tasks: ${error.message}`)
  }
  return { revoked: (data ?? []).length }
}
