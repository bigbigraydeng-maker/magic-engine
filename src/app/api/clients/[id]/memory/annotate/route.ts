/**
 * POST /api/clients/[id]/memory/annotate
 *
 * FDE 手动标注接口 — 将执行结果写入 L3 记忆层三张表之一：
 *   annotation_type = 'pattern'    → client_proven_patterns
 *   annotation_type = 'failure'    → client_failed_experiments
 *   annotation_type = 'preference' → client_learned_preferences
 *
 * Body:
 *   annotation_type: 'pattern' | 'failure' | 'preference'
 *   execution_item_id?: string          — 来源追踪（可选）
 *   dimension?: DiagnosticDimension     — 关联诊断维度
 *   flywheel?: 'seo' | 'geo' | 'ads' | 'social'
 *
 *   // pattern fields:
 *   pattern_type?: PatternType
 *   pattern_content?: string
 *   performance_metric?: string
 *
 *   // failure fields:
 *   experiment_description?: string
 *   failure_reason?: string
 *
 *   // preference fields:
 *   preference_type?: PreferenceType
 *   content?: string
 *
 * Responses:
 *   200  { success: true, id: string, annotation_type: string }
 *   400  validation error
 *   404  client not found
 *   500  DB error
 *
 * Reference: ROADMAP.md Phase 23.B
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  savePreference,
  saveProvenPattern,
  saveFailedExperiment,
} from '@/lib/memory'
import type {
  PreferenceType,
  PatternType,
  FlywheelName,
} from '@/lib/memory/types'
import type { DiagnosticDimension } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

const VALID_ANNOTATION_TYPES = ['pattern', 'failure', 'preference'] as const
const VALID_PATTERN_TYPES: PatternType[] = ['hook', 'cta', 'angle', 'format', 'headline', 'structure']
const VALID_PREFERENCE_TYPES: PreferenceType[] = ['style', 'topic', 'format', 'tone', 'audience', 'other']
const VALID_FLYWHEELS: FlywheelName[] = ['seo', 'geo', 'ads', 'social']
const VALID_DIMENSIONS: DiagnosticDimension[] = ['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor']

interface AnnotateBody {
  annotation_type: string
  execution_item_id?: string
  dimension?: string
  flywheel?: string
  // pattern
  pattern_type?: string
  pattern_content?: string
  performance_metric?: string
  // failure
  experiment_description?: string
  failure_reason?: string
  // preference
  preference_type?: string
  content?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: AnnotateBody
  try {
    body = (await req.json()) as AnnotateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { annotation_type } = body
  if (!(VALID_ANNOTATION_TYPES as readonly string[]).includes(annotation_type)) {
    return NextResponse.json(
      { error: `annotation_type must be one of: ${VALID_ANNOTATION_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const flywheel = (VALID_FLYWHEELS as string[]).includes(body.flywheel ?? '')
    ? (body.flywheel as FlywheelName)
    : undefined

  const dimension = (VALID_DIMENSIONS as string[]).includes(body.dimension ?? '')
    ? (body.dimension as DiagnosticDimension)
    : undefined

  // ── pattern ───────────────────────────────────────────────────────────────
  if (annotation_type === 'pattern') {
    const pattern_type = (VALID_PATTERN_TYPES as string[]).includes(body.pattern_type ?? '')
      ? (body.pattern_type as PatternType)
      : null
    const pattern_content = body.pattern_content?.trim()

    if (!pattern_type) {
      return NextResponse.json(
        { error: `pattern_type must be one of: ${VALID_PATTERN_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!pattern_content) {
      return NextResponse.json({ error: 'pattern_content is required' }, { status: 400 })
    }

    const saved = await saveProvenPattern(supabaseAdmin, {
      client_id: clientId,
      pattern_type,
      pattern_content,
      performance_metric: body.performance_metric?.trim() || undefined,
      flywheel,
      source_table: body.execution_item_id ? 'execution_items' : undefined,
      source_id: body.execution_item_id || undefined,
    })

    if (!saved) {
      return NextResponse.json({ error: 'Failed to save pattern' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: saved.id, annotation_type })
  }

  // ── failure ───────────────────────────────────────────────────────────────
  if (annotation_type === 'failure') {
    const experiment_description = body.experiment_description?.trim()
    const failure_reason = body.failure_reason?.trim()

    if (!experiment_description) {
      return NextResponse.json({ error: 'experiment_description is required' }, { status: 400 })
    }
    if (!failure_reason) {
      return NextResponse.json({ error: 'failure_reason is required' }, { status: 400 })
    }

    const saved = await saveFailedExperiment(supabaseAdmin, {
      client_id: clientId,
      experiment_description,
      failure_reason,
      dimension,
      source_table: body.execution_item_id ? 'execution_items' : undefined,
      source_id: body.execution_item_id || undefined,
    })

    if (!saved) {
      return NextResponse.json({ error: 'Failed to save experiment' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: saved.id, annotation_type })
  }

  // ── preference ────────────────────────────────────────────────────────────
  if (annotation_type === 'preference') {
    const preference_type = (VALID_PREFERENCE_TYPES as string[]).includes(body.preference_type ?? '')
      ? (body.preference_type as PreferenceType)
      : null
    const content = body.content?.trim()

    if (!preference_type) {
      return NextResponse.json(
        { error: `preference_type must be one of: ${VALID_PREFERENCE_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const saved = await savePreference(supabaseAdmin, {
      client_id: clientId,
      preference_type,
      content,
      source: 'fde_annotation',
      flywheel,
      extracted_from_table: body.execution_item_id ? 'execution_items' : undefined,
      extracted_from_id: body.execution_item_id || undefined,
    })

    if (!saved) {
      return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: saved.id, annotation_type })
  }

  return NextResponse.json({ error: 'Unhandled annotation_type' }, { status: 400 })
}
