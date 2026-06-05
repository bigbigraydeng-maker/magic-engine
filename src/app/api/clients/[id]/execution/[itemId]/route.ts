/**
 * GET /api/clients/[id]/execution/[itemId]
 *   Read a single execution item (used by kanban for "is this still
 *   the current DB state?" checks before optimistic updates).
 *
 * PATCH /api/clients/[id]/execution/[itemId]
 *   Update an execution item — supports status / title / description /
 *   content_post_id / sort_order / generation lifecycle fields.
 *   All meaningful changes are mirrored to execution_logs.
 *
 *   Body (at least one field required): {
 *     status?:                'pending' | 'in_progress' | 'completed' | 'skipped'
 *     title?:                 string
 *     description?:           string
 *     note?:                  string                    — optional FDE note
 *     content_post_id?:       string | null
 *     sort_order?:            number
 *     generation_started_at?: string | null             — ISO timestamp; null clears
 *     generation_error?:      string | null             — error message; null clears
 *   }
 *
 * DELETE /api/clients/[id]/execution/[itemId]
 *   Soft-revocable removal — pending items only.
 *
 * Security: dashboard session via requirePaidClientAccess.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { ExecutionItem, ExecutionItemStatus } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: ExecutionItemStatus[] = ['pending', 'in_progress', 'completed', 'skipped']

const STATUS_LABEL: Record<ExecutionItemStatus, string> = {
  pending:     '待处理',
  in_progress: '进行中',
  completed:   '已完成',
  skipped:     '已跳过',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId, itemId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .select('*')
    .eq('id', itemId)
    .eq('client_id', clientId)
    .single<ExecutionItem>()
  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true, item: data })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { itemId } = params
    const body = (await req.json()) as {
      status?: ExecutionItemStatus
      title?: string
      description?: string
      note?: string
      content_post_id?: string | null // 内容飞轮闭环：关联/解除关联 content_post
      sort_order?: number             // Phase 20.D：拖拽排序
      // Generation lifecycle (kanban "制作中 / 失败" tracking)
      generation_started_at?: string | null
      generation_error?:      string | null
    }

    const newTitle = typeof body.title === 'string' ? body.title.trim() : undefined
    const newDesc = typeof body.description === 'string' ? body.description.trim() : undefined
    const hasStatus = body.status != null
    const hasEdit = newTitle !== undefined || newDesc !== undefined
    const hasContentLink = body.content_post_id !== undefined // null 表示解除关联
    const hasSort = typeof body.sort_order === 'number'
    const hasGenStart = body.generation_started_at !== undefined // null = clear
    const hasGenError = body.generation_error !== undefined       // null = clear

    if (!hasStatus && !hasEdit && !hasContentLink && !hasSort && !hasGenStart && !hasGenError) {
      return NextResponse.json(
        { success: false, error: 'status / title / description / content_post_id / sort_order / generation_* 至少要有一项' },
        { status: 400 },
      )
    }
    if (hasStatus && !VALID_STATUSES.includes(body.status!)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // 先读当前记录（status_change / 编辑前后对比）
    const { data: current, error: readErr } = await supabaseAdmin
      .from('execution_items')
      .select('status, started_at, title, description, content_post_id')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{
        status: ExecutionItemStatus; started_at: string | null
        title: string; description: string
        content_post_id: string | null
      }>()

    if (readErr || !current) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}
    const nowIso = new Date().toISOString()
    if (hasStatus) {
      patch.status = body.status
      if (body.status === 'completed') patch.completed_at = nowIso
      // 从"已完成"退回其他状态 → 清空 completed_at（误点可改回）
      else if (current.status === 'completed') patch.completed_at = null
      if (body.status === 'in_progress' && !current.started_at) patch.started_at = nowIso
    }
    if (newTitle !== undefined && newTitle) patch.title = newTitle
    if (newDesc !== undefined && newDesc) patch.description = newDesc
    if (hasContentLink) {
      // 校验 content_post 归属于同一客户（防止跨客户挂载）
      if (body.content_post_id) {
        const { data: post } = await supabaseAdmin
          .from('content_posts')
          .select('id')
          .eq('id', body.content_post_id)
          .eq('client_id', clientId)
          .maybeSingle<{ id: string }>()
        if (!post) {
          return NextResponse.json(
            { success: false, error: '内容帖子不存在或不属于该客户' },
            { status: 400 },
          )
        }
      }
      patch.content_post_id = body.content_post_id
    }
    // Phase 20.D: sort_order update (drag-reorder, no log entry)
    if (hasSort) patch.sort_order = body.sort_order

    // Generation lifecycle — kanban "制作中 / 失败 [重试]" UI driver
    if (hasGenStart) patch.generation_started_at = body.generation_started_at
    if (hasGenError) patch.generation_error      = body.generation_error

    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .update(patch)
      .eq('id', itemId)
      .eq('client_id', clientId)
      .select('*')
      .single<ExecutionItem>()

    if (error || !data) {
      console.error('[execution/:itemId PATCH] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update execution item' },
        { status: 500 },
      )
    }

    // ── 写工作日志（execution_logs）──────────────────────────────────────
    const logs: Array<Record<string, unknown>> = []
    // 状态变更日志（仅当真的变了）
    if (hasStatus && current.status !== body.status) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'system',
        kind:              'status_change',
        content:           `状态：${STATUS_LABEL[current.status]} → ${STATUS_LABEL[body.status!]}`,
        meta:              { from: current.status, to: body.status },
      })
    }
    // 内容关联变更 → adjustment 日志
    if (hasContentLink && body.content_post_id !== current.content_post_id) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind:              'adjustment',
        content:           body.content_post_id
          ? `关联内容帖子 ${body.content_post_id}`
          : '解除内容关联',
        meta:              { adjustment: 'link_content', content_post_id: body.content_post_id },
      })
    }
    // 编辑标题/说明 → adjustment 日志
    const editedFields: string[] = []
    if (newTitle !== undefined && newTitle && newTitle !== current.title) editedFields.push('标题')
    if (newDesc !== undefined && newDesc && newDesc !== current.description) editedFields.push('说明')
    if (editedFields.length > 0) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind:              'adjustment',
        content:           `FDE 修改了执行项的${editedFields.join('、')}`,
        meta:              { adjustment: 'edit', fields: editedFields },
      })
    }
    // 可选 FDE 备注
    if (body.note && body.note.trim()) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind:              'note',
        content:           body.note.trim(),
        meta:              null,
      })
    }
    if (logs.length > 0) {
      // 日志写失败不阻塞主流程
      await supabaseAdmin.from('execution_logs').insert(logs)
        .then(({ error: logErr }) => {
          if (logErr) console.error('[execution/:itemId PATCH] log insert failed:', logErr)
        })
    }

    return NextResponse.json({ success: true, item: data })
  } catch (err: unknown) {
    console.error('[execution/:itemId PATCH] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// DELETE /api/clients/[id]/execution/[itemId]
// 移除执行项 — 仅限 pending 状态（未开工的任务才可撤销）
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { itemId } = params

    const { data: current, error: readErr } = await supabaseAdmin
      .from('execution_items')
      .select('status, title')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{ status: ExecutionItemStatus; title: string }>()

    if (readErr || !current) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }
    if (current.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `只能移除待处理任务，当前状态：${STATUS_LABEL[current.status]}` },
        { status: 400 },
      )
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('execution_items')
      .delete()
      .eq('id', itemId)
      .eq('client_id', clientId)

    if (deleteErr) {
      console.error('[execution/:itemId DELETE] Supabase error:', deleteErr)
      return NextResponse.json({ success: false, error: 'Failed to delete execution item' }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted_id: itemId })
  } catch (err: unknown) {
    console.error('[execution/:itemId DELETE] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
