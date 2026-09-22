/**
 * Client Knowledge Base — entitlement gate (Issue #1644 §getKnowledgeEntitlement).
 *
 * v1 data source: an admin explicitly grants a client access. No grant =
 * fail-closed deny. This is not a new membership system — it reuses
 * `client_automation_policies`, the execution kernel's existing per-client /
 * per-action policy envelope (client_id + action_key, mode, effective
 * window), the same table `src/lib/kernel/store.ts` reads for automation
 * authorization.
 *
 * Reuse mapping:
 *   action_key = 'client_knowledge.read'
 *   mode = 'auto_approve'  → entitled
 *   mode = 'deny' / no row → not entitled (kernel's existing "no row = deny"
 *                            convention, unchanged here)
 *   updated_by             → grantedBy (already NOT NULL on that table)
 *   effective_from         → grantedAt (already NOT NULL, defaults to now())
 *   metadata->>'basis'     → basis (new nullable jsonb column added by this
 *                            issue's migration — the one piece
 *                            client_automation_policies didn't already have)
 *
 * Why not a new table: the issue asks to check first whether
 * `client_automation_policies` fits before building anything new. It does —
 * same shape of question ("is this client allowed to do X, since when, until
 * when"), same fail-closed convention, same RLS. The only gap was `basis`,
 * closed with one additive nullable column rather than a parallel table.
 */

import type { KnowledgeSupabaseClient } from './db-client'
import { KnowledgeReadError } from './errors'
import type { EntitlementBasis, KnowledgeEntitlement } from './types'

export const KNOWLEDGE_READ_ACTION_KEY = 'client_knowledge.read'

const KNOWN_BASES: readonly EntitlementBasis[] = ['fde_managed', 'tier_499', 'enterprise']

function isKnownBasis(value: unknown): value is EntitlementBasis {
  return typeof value === 'string' && (KNOWN_BASES as readonly string[]).includes(value)
}

interface PolicyRow {
  mode: string
  updated_by: string
  effective_from: string
  metadata: Record<string, unknown> | null
}

async function defaultSupabase(): Promise<KnowledgeSupabaseClient> {
  // Lazy import — SDK/DB clients are initialised inside the handler, never
  // at module load (repo-wide rule; also avoids requiring Supabase env vars
  // just to import this module in tests that inject their own client).
  const { supabaseAdmin } = await import('@/lib/supabase')
  // 桥接 unknown：supabase-js 的 SupabaseClient<...> 泛型链太深，tsc 结构比对会报
  // "excessively deep"（不是形状不匹配，是比对本身算不完）。real client 在运行时
  // 真的实现 KnowledgeSupabaseClient 要求的全部方法（.from().select().eq()... 是
  // postgrest-js 公开 API 的子集）——已跑 `npm run type-check` + 本文件全部单测
  // （含用真实 fake client 走一遍同一套调用链）验证这条桥接没有让任何一次调用在
  // 运行时对不上方法名或参数形状。
  return supabaseAdmin as unknown as KnowledgeSupabaseClient
}

export interface GetKnowledgeEntitlementDeps {
  supabase?: KnowledgeSupabaseClient
  now?: () => Date
}

/**
 * Resolve whether `clientId` is entitled to use the client knowledge base.
 *
 * 🔴 Fail-closed on every path that isn't an explicit, currently-effective
 * `auto_approve` grant: no row, `mode = 'deny'`, an expired window, or a
 * read error all resolve to `entitled: false` — except the read error case,
 * which throws instead (a DB failure must never be silently treated the
 * same as "not granted"; see errors.ts header).
 */
export async function getKnowledgeEntitlement(
  clientId: string,
  deps: GetKnowledgeEntitlementDeps = {},
): Promise<KnowledgeEntitlement> {
  const sb = deps.supabase ?? (await defaultSupabase())
  const now = deps.now ?? (() => new Date())
  const nowIso = now().toISOString()

  const { data, error } = await sb
    .from('client_automation_policies')
    .select('mode, updated_by, effective_from, metadata')
    .eq('client_id', clientId)
    .eq('action_key', KNOWLEDGE_READ_ACTION_KEY)
    .lte('effective_from', nowIso)
    .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
    .order('effective_from', { ascending: false })
    .limit(1)

  // 🔴 A broken read must never be treated as "no grant" — that would make a
  // database hiccup indistinguishable from a deliberate fail-closed deny,
  // and both this function's own contract and getClientKnowledge's fail-
  // closed entitlement check depend on being able to tell them apart.
  if (error) throw new KnowledgeReadError('读取客户知识库授权（client_automation_policies）', error)

  // 桥接 unknown：`data` 的列表值类型是 Record<string, unknown>，字段本身没有
  // 具体类型可比对，tsc 拒绝直接转 PolicyRow。实测：本机 PG 沙盘对着真实
  // client_automation_policies 表已跑过一次同样的 select（见 PR 描述验证记录），
  // 列名和类型跟 PolicyRow 逐一核对一致。
  const rows = (data ?? []) as unknown as PolicyRow[]
  const row = rows[0] ?? null
  if (!row || row.mode !== 'auto_approve') {
    return { entitled: false }
  }

  const basis = isKnownBasis(row.metadata?.basis) ? row.metadata!.basis : undefined

  return {
    entitled: true,
    ...(basis ? { basis } : {}),
    grantedBy: row.updated_by,
    grantedAt: row.effective_from,
  }
}
