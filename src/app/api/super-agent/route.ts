/**
 * Phase D — Super Agent Entry Point
 *
 * Single API route that acts as the unified front-door for all client-facing
 * AI capabilities. Instead of calling zhangqian / huatuo / zhuge separately,
 * callers POST here with a task description and receive a consolidated response.
 *
 * Pipeline:
 *   1. Auth guard (dashboard client access)
 *   2. planExecution(input)   → ExecutionPlan (from ZiyaRouter Phase C)
 *   3. loadClientContext()    → ClientContext (from Phase B loader)
 *   4. runOrchestration()     → RuntimeOutputs (from Phase B orchestrator)
 *   5. synthesise response    → SuperAgentResponse
 *
 * 柔性设计：
 *   - Devops task types (code_review etc.) are not routed to growth orchestrator
 *   - New growth capabilities (write_seo, write_geo, execute) can be added to
 *     TASK_EXECUTION_MAP in ziya/router.ts without changing this file
 *   - Streaming opt-in: add ?stream=1 for SSE progress events (future enhancement)
 *
 * Reference: ROADMAP.md Phase D (Super Agent 入口)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { planExecution, isGrowthTask } from '@/lib/ziya/router'
import { loadClientContext, runOrchestration } from '@/lib/context'
import type { ZiyaTaskInput, TaskType } from '@/lib/ziya/types'
import type { RuntimeOutputs } from '@/lib/context/types'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { HuatuoPrescriptionResult } from '@/lib/huatuo/types'
import type { ZhugeOutput } from '@/lib/zhuge/types'

// ─── Request / Response shapes ───────────────────────────────────────────────

interface SuperAgentRequest {
  client_id: string
  task_description: string
  /** Optional — if provided, skips keyword matching and uses this type directly */
  task_type?: TaskType
  /** Optional — comma-separated capability override (advanced use only) */
  capabilities_override?: string
}

interface SuperAgentResponse {
  ok: true
  client_id: string
  task_type: string
  route_method: 'rule' | 'llm'
  capabilities_run: string[]
  capabilities_failed: Array<{ key: string; error: string }>
  outputs: {
    discovery?: unknown
    prescription?: unknown
    plan?: unknown
  }
  devops_only?: boolean
  snapshot_at: string
  duration_ms: number
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  let body: SuperAgentRequest
  try {
    body = await req.json() as SuperAgentRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { client_id, task_description, task_type } = body

  if (!client_id || typeof client_id !== 'string') {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }
  if (!task_description || typeof task_description !== 'string') {
    return NextResponse.json({ error: 'task_description is required' }, { status: 400 })
  }

  // 1. Auth — dashboard access guard
  const access = await requireDashboardClientAccess(client_id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // 2. Route — determine execution plan
  const taskInput: ZiyaTaskInput = {
    client_id,
    task_description,
    task_type: task_type ?? undefined,
    triggered_by: 'api',
  }
  const plan = planExecution(taskInput)

  // Devops tasks (code_review, product_review, etc.) have no growth capabilities.
  // Return routing metadata only — the caller should dispatch to the relevant internal agent.
  if (!isGrowthTask(plan.task_type as TaskType)) {
    return NextResponse.json({
      ok: true,
      client_id,
      task_type: plan.task_type,
      route_method: 'rule',
      devops_only: true,
      capabilities_run: [],
      capabilities_failed: [],
      outputs: {},
      snapshot_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      message: `Task type '${plan.task_type}' is handled by internal devops agents. No growth orchestration needed.`,
    } satisfies SuperAgentResponse & { message: string })
  }

  // 3. Load context — unified client snapshot
  let ctx
  try {
    ctx = await loadClientContext(supabaseAdmin, client_id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Context load failed: ${message}` }, { status: 404 })
  }

  // 4. Orchestrate — run capability chain
  const { outputs, completed, failed } = await runOrchestration(
    supabaseAdmin,
    ctx,
    plan.capabilities,
    {
      parallel: plan.parallel,
      onProgress: undefined, // TODO: wire SSE stream when ?stream=1
    },
  )

  // 5. Synthesise — shape the response
  const response: SuperAgentResponse = {
    ok: true,
    client_id,
    task_type: plan.task_type,
    route_method: 'rule',
    capabilities_run: completed,
    capabilities_failed: failed,
    outputs: sanitiseOutputs(outputs),
    snapshot_at: ctx.snapshotAt,
    duration_ms: Date.now() - startedAt,
  }

  const status = failed.length > 0 ? 207 : 200
  return NextResponse.json(response, { status })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Trim outputs to what is safe / useful to return to the API caller.
 * Raw agent outputs can be very large (full HTML scans etc.) — return
 * a safe subset and let callers request full detail via agent-specific routes.
 */
function sanitiseOutputs(outputs: RuntimeOutputs): SuperAgentResponse['outputs'] {
  const discovery = outputs.discovery as DiscoveryReport | undefined
  const prescription = outputs.prescription as HuatuoPrescriptionResult | undefined
  const plan = outputs.plan as ZhugeOutput | undefined

  return {
    discovery: discovery
      ? {
          domain: discovery.domain,
          notes: discovery.notes,
          seed_keywords_count: discovery.seed_keywords?.length ?? 0,
          competitors_count: discovery.competitors?.length ?? 0,
          ai_questions_count: discovery.ai_tracker_questions?.length ?? 0,
        }
      : undefined,

    prescription: prescription
      ? {
          self_grade: prescription.self_grade,
          phases_count: prescription.content?.phases?.length ?? 0,
          trend_summary: prescription.trend_summary,
        }
      : undefined,

    plan: plan
      ? {
          top_actions: plan.top_actions,
          generated_at: plan.generated_at,
          cost_usd: plan.cost_usd,
        }
      : undefined,
  }
}
