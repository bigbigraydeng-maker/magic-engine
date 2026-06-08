/**
 * 项目级鲁班工具层
 *
 * 工具清单：
 *   - list_items_by_filter   按条件筛选执行项，返回 ID（供后续工具引用）
 *   - update_item_status     批量更新执行项状态
 *   - update_item_content    更新执行项标题 / 描述
 *
 * 使用原则：鲁班必须先 list_items_by_filter 确认范围 → 展示给 FDE 确认 → 再执行写操作。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { ExecutionItemStatus, DiagnosticDimension, ExecutionLogKind } from '@/types/diagnostic'

export interface ProjectLubanToolContext {
  supabase: SupabaseClient
  clientId: string
}

export interface ProjectLubanToolset {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
}

// ─── list_items_by_filter ─────────────────────────────────────────────────────

const LIST_ITEMS_TOOL: Anthropic.Tool = {
  name: 'list_items_by_filter',
  description:
    '按条件筛选执行项，返回匹配项的 ID、标题、状态等信息。' +
    '在调用 update_item_status 或 update_item_content 之前，先用这个工具确认操作范围，' +
    '把结果展示给 FDE 确认后再执行更新。',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'array',
        items: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'skipped'] },
        description: '按状态过滤，可多选。不填则不限状态。',
      },
      dimension: {
        type: 'string',
        enum: ['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'],
        description: '按维度过滤。',
      },
      phase: {
        type: 'number',
        description: '按 Phase（1 / 2 / 3）过滤。',
      },
      title_contains: {
        type: 'string',
        description: '标题关键词模糊搜索（不区分大小写），如 "TikTok"、"Facebook"、"blog"。',
      },
    },
    required: [],
  },
}

// ─── update_item_status ───────────────────────────────────────────────────────

const UPDATE_STATUS_TOOL: Anthropic.Tool = {
  name: 'update_item_status',
  description:
    '批量更新执行项状态。调用前必须先用 list_items_by_filter 确认 item_ids 范围，' +
    '并向 FDE 展示将要修改的项目列表确认——除非 FDE 已在对话中明确授权执行。',
  input_schema: {
    type: 'object' as const,
    properties: {
      item_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '要更新的执行项 ID 列表（来自 list_items_by_filter 的结果）。',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'skipped'],
        description: '目标状态。',
      },
      reason: {
        type: 'string',
        description: '可选：变更原因，会写入工作日志供后续追溯（如"暂停 TikTok 渠道"）。',
      },
    },
    required: ['item_ids', 'status'],
  },
}

// ─── update_item_content ──────────────────────────────────────────────────────

const UPDATE_CONTENT_TOOL: Anthropic.Tool = {
  name: 'update_item_content',
  description: '更新单个执行项的标题或描述。用于修正内容表述、补充说明等。',
  input_schema: {
    type: 'object' as const,
    properties: {
      item_id: {
        type: 'string',
        description: '执行项 ID（来自 list_items_by_filter 的结果）。',
      },
      title: {
        type: 'string',
        description: '新标题，不填则不修改。',
      },
      description: {
        type: 'string',
        description: '新描述，不填则不修改。',
      },
    },
    required: ['item_id'],
  },
}

// ─── 类型守卫 + 常量 ──────────────────────────────────────────────────────────

interface ListItemsInput {
  status?: ExecutionItemStatus[]
  dimension?: DiagnosticDimension
  phase?: number
  title_contains?: string
}

interface UpdateStatusInput {
  item_ids: string[]
  status: ExecutionItemStatus
  reason?: string
}

interface UpdateContentInput {
  item_id: string
  title?: string
  description?: string
}

function isListItemsInput(v: unknown): v is ListItemsInput {
  return typeof v === 'object' && v !== null
}

function isUpdateStatusInput(v: unknown): v is UpdateStatusInput {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.item_ids) && typeof o.status === 'string'
}

function isUpdateContentInput(v: unknown): v is UpdateContentInput {
  if (typeof v !== 'object' || v === null) return false
  return typeof (v as Record<string, unknown>).item_id === 'string'
}

const VALID_STATUSES = new Set<string>(['pending', 'in_progress', 'completed', 'skipped'])
const VALID_DIMENSIONS = new Set<string>(['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'])

const DIMENSION_CN: Record<string, string> = {
  seo: 'SEO', ai_visibility: 'AI 可见度', ads: '广告',
  social: '社媒', reputation: '口碑', competitor: '竞争',
}
const STATUS_CN: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', completed: '已完成', skipped: '已跳过',
  // 系统态 — DAPE W5 写入；鲁班不会写入此值，但列表渲染可能命中
  superseded: '已取代',
}

// ─── buildProjectLubanTools ───────────────────────────────────────────────────

export function buildProjectLubanTools(ctx: ProjectLubanToolContext): ProjectLubanToolset {
  return {
    tools: [LIST_ITEMS_TOOL, UPDATE_STATUS_TOOL, UPDATE_CONTENT_TOOL],
    handlers: {

      list_items_by_filter: async (input: unknown): Promise<string> => {
        if (!isListItemsInput(input)) return 'list_items_by_filter: 参数格式错误。'

        let query = ctx.supabase
          .from('execution_items')
          .select('id, title, phase, dimension, status')
          .eq('client_id', ctx.clientId)
          .order('phase', { ascending: true })
          .order('sort_order', { ascending: true })

        if (input.status && input.status.length > 0) {
          query = query.in('status', input.status)
        }
        if (input.dimension && VALID_DIMENSIONS.has(input.dimension)) {
          query = query.eq('dimension', input.dimension)
        }
        if (typeof input.phase === 'number') {
          query = query.eq('phase', input.phase)
        }
        if (input.title_contains) {
          query = query.ilike('title', `%${input.title_contains}%`)
        }

        const { data, error } = await query
        if (error) return `list_items_by_filter 查询失败：${error.message}`

        const rows = (data ?? []) as Array<{
          id: string; title: string; phase: number
          dimension: string; status: string
        }>

        if (rows.length === 0) return '没有找到符合条件的执行项。'

        const lines = rows.map(r =>
          `- ID: \`${r.id}\`\n  [P${r.phase} · ${DIMENSION_CN[r.dimension] ?? r.dimension} · ${STATUS_CN[r.status] ?? r.status}] ${r.title}`
        )
        return `找到 ${rows.length} 个执行项：\n\n${lines.join('\n')}`
      },

      update_item_status: async (input: unknown): Promise<string> => {
        if (!isUpdateStatusInput(input)) {
          return 'update_item_status: 需要 { item_ids: string[], status: string }。'
        }
        const { item_ids, status, reason } = input

        if (!VALID_STATUSES.has(status)) return `update_item_status: 无效状态 "${status}"。`
        if (item_ids.length === 0) return 'update_item_status: item_ids 不能为空。'
        if (item_ids.length > 50) return 'update_item_status: 单次最多更新 50 个执行项。'

        // 验证所有 ID 都属于该客户
        const { data: owned, error: checkErr } = await ctx.supabase
          .from('execution_items')
          .select('id, title')
          .eq('client_id', ctx.clientId)
          .in('id', item_ids)

        if (checkErr) return `update_item_status 权限验证失败：${checkErr.message}`

        const ownedRows = (owned ?? []) as Array<{ id: string; title: string }>
        const ownedIds = ownedRows.map(r => r.id)
        const unauthorized = item_ids.filter(id => !ownedIds.includes(id))
        if (unauthorized.length > 0) {
          return `update_item_status: 以下 ID 不属于该客户或不存在：${unauthorized.join(', ')}`
        }

        const now = new Date().toISOString()
        const patch: Record<string, unknown> = { status, updated_at: now }
        if (status === 'completed') patch.completed_at = now
        if (status === 'in_progress') patch.started_at = now

        const { error } = await ctx.supabase
          .from('execution_items')
          .update(patch)
          .eq('client_id', ctx.clientId)
          .in('id', ownedIds)

        if (error) return `update_item_status 更新失败：${error.message}`

        // 写工作日志（静默失败，不阻塞主流程）
        const logContent = reason
          ? `鲁班批量将状态更新为「${STATUS_CN[status]}」。原因：${reason}`
          : `鲁班批量将状态更新为「${STATUS_CN[status]}」。`

        void ctx.supabase
          .from('execution_logs')
          .insert(
            ownedIds.map(id => ({
              execution_item_id: id,
              client_id: ctx.clientId,
              author: 'luban' as const,
              kind: 'ai_assist' satisfies ExecutionLogKind,
              content: logContent,
              meta: { tool: 'update_item_status', status, reason: reason ?? null },
            }))
          )
          .then(({ error: le }) => {
            if (le) console.error('[project-luban/update_item_status] log write failed:', le)
          })

        const titles = ownedRows.map(r => r.title)
        const titlePreview = titles.length > 5
          ? `${titles.slice(0, 5).join('、')}……等 ${titles.length} 项`
          : titles.join('、')

        return `✅ 已将 ${ownedIds.length} 个执行项状态更新为「${STATUS_CN[status]}」：${titlePreview}`
      },

      update_item_content: async (input: unknown): Promise<string> => {
        if (!isUpdateContentInput(input)) {
          return 'update_item_content: 需要 { item_id: string }。'
        }
        const { item_id, title, description } = input

        if (!title && description === undefined) {
          return 'update_item_content: title 和 description 至少提供一个。'
        }

        // 验证归属
        const { data: owned, error: checkErr } = await ctx.supabase
          .from('execution_items')
          .select('id, title')
          .eq('client_id', ctx.clientId)
          .eq('id', item_id)
          .maybeSingle<{ id: string; title: string }>()

        if (checkErr) return `update_item_content 权限验证失败：${checkErr.message}`
        if (!owned) return `update_item_content: 执行项 ${item_id} 不存在或不属于该客户。`

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (title) patch.title = title.trim()
        if (description !== undefined) patch.description = description.trim()

        const { error } = await ctx.supabase
          .from('execution_items')
          .update(patch)
          .eq('id', item_id)
          .eq('client_id', ctx.clientId)

        if (error) return `update_item_content 更新失败：${error.message}`

        const parts: string[] = []
        if (title) parts.push(`标题改为「${title}」`)
        if (description !== undefined) parts.push('描述已更新')

        return `✅ 执行项「${owned.title}」已更新：${parts.join('、')}。`
      },
    },
  }
}
