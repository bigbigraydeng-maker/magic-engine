/**
 * 李白 · 文案溯源工作流（agent 自治计划 B2）。
 *
 * 收到 `me/libai.copy.generated`（content-factory/generate 写完一条 content_posts 后发）
 * → 读逐字稿与钩子 → 读客户官网正文（Site Analyzer 封装 fetchUrlAsMarkdown）与 master_brief
 * → 逐句标溯源 → 有边界地写回 `content_posts.generation_context_snapshot.libai_provenance`
 * （只动这一个子 key）→ 回执写 cron_run_logs（job_name 恒为 'libai-copy-provenance'，
 * 非周期任务，summary.source_record_id 区分哪条）。
 *
 * 🔴 retries 0：花 LLM 钱；任何一步读不到 = 记 unverifiable，不给默认值，不发布。
 *
 * 🔴 一事件一主：`me/libai.copy.generated` 是云端专属事件，本机 factory-worker 不监听
 *    （见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { callClaudeChat } from '@/lib/anthropic/client'
import {
  LIBAI_COPY_GENERATED_EVENT,
  LibaiCopyGeneratedSchema,
  labelProvenance,
  mergeProvenanceIntoSnapshot,
  type CopyField,
  type ProvenanceLlm,
  type ProvenanceSnapshot,
} from '@/lib/content/libai-provenance'

export const LIBAI_PROVENANCE_JOB = 'libai-copy-provenance'

export interface LibaiDeps {
  supabase: SupabaseClient
  llm: ProvenanceLlm
  fetchPage: (url: string) => Promise<{ markdown: string }>
  loadBrief: typeof getActiveBrief
}

export interface LibaiSources {
  websiteUrl: string | null
  websiteText: string | null
  briefText: string | null
  briefId: string | null
  brandName: string
  reason: string | null
}

export interface LibaiReceipt {
  request_id: string
  client_id: string
  source_record_id: string
  status: 'labelled' | 'unverifiable' | 'invalid_payload' | 'post_not_found'
  unverified_count: number | null
  cost_usd: number
  no_publish: true
  reason: string | null
}

interface PostCopy {
  ok: true
  fields: CopyField[]
  snapshot: unknown
  title: string
}

interface PostCopyMissing {
  ok: false
  reason: string
}

interface ClientRow {
  name: string | null
  domain: string | null
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 读一条 content_posts 的文案字段 + 现有 snapshot。读不到 → ok false（不判）。 */
export async function readPostCopy(
  supabase: SupabaseClient,
  postId: string,
): Promise<PostCopy | PostCopyMissing> {
  const { data, error } = await supabase
    .from('content_posts')
    .select('title, script, caption, generation_context_snapshot')
    .eq('id', postId)
    .maybeSingle()
  if (error) return { ok: false, reason: `读 content_posts 失败：${error.message}` }
  if (!data) return { ok: false, reason: 'content_posts 里找不到这条记录' }
  const row = data as Record<string, unknown>
  const fields: CopyField[] = []
  if (typeof row.caption === 'string' && row.caption.trim().length > 0) {
    fields.push({ field: 'caption', text: row.caption })
  }
  if (typeof row.script === 'string' && row.script.trim().length > 0) {
    fields.push({ field: 'script', text: row.script })
  }
  return {
    ok: true,
    fields,
    snapshot: row.generation_context_snapshot,
    title: typeof row.title === 'string' ? row.title : '',
  }
}

/** 官网网址优先级：brief.website_urls[0] → brief.website → clients.domain → null。 */
export function pickWebsiteUrl(
  brief: { website_urls?: string[] | null; website?: string | null } | null,
  domain: string | null,
): string | null {
  const first = brief?.website_urls?.[0]
  if (typeof first === 'string' && first.trim().length > 0) return first.trim()
  const site = brief?.website
  if (typeof site === 'string' && site.trim().length > 0) return site.trim()
  if (typeof domain === 'string' && domain.trim().length > 0) return `https://${domain.trim()}`
  return null
}

/** 读客户名/域名 + master_brief + 官网正文。任何读不到都记进 reason，不给默认值。 */
export async function loadSources(deps: LibaiDeps, clientId: string): Promise<LibaiSources> {
  const { data: clientData } = await deps.supabase
    .from('clients')
    .select('name, domain')
    .eq('id', clientId)
    .maybeSingle()
  const client = (clientData ?? null) as ClientRow | null
  // 直接用 getActiveBrief 的真实返回类型（MasterBrief | null），不另造一份影子形状——
  // 影子形状跟 formatBriefForPrompt 的入参对不上，tsc 会拦。
  const brief = await deps.loadBrief(clientId)
  const url = pickWebsiteUrl(brief, client?.domain ?? null)
  const briefText = brief ? formatBriefForPrompt(brief) : null
  const briefId = brief?.id ?? null
  const brandName = brief?.brand_name ?? client?.name ?? '(unknown brand)'
  if (!url) {
    return {
      websiteUrl: null,
      websiteText: null,
      briefText,
      briefId,
      brandName,
      reason: '客户没配官网网址（master_brief.website_urls / clients.domain 都为空）',
    }
  }
  try {
    const page = await deps.fetchPage(url)
    return { websiteUrl: url, websiteText: page.markdown, briefText, briefId, brandName, reason: null }
  } catch (e) {
    return {
      websiteUrl: url,
      websiteText: null,
      briefText,
      briefId,
      brandName,
      reason: `官网读不到：${errMessage(e)}`,
    }
  }
}

/** 有界写回：只动 generation_context_snapshot.libai_provenance，其它子 key 原样保留。 */
export async function writeProvenance(
  supabase: SupabaseClient,
  postId: string,
  current: unknown,
  snap: ProvenanceSnapshot,
): Promise<void> {
  const merged = mergeProvenanceIntoSnapshot(current, snap)
  const { error } = await supabase
    .from('content_posts')
    .update({ generation_context_snapshot: merged })
    .eq('id', postId)
  if (error) throw new Error(`写回溯源结果失败：${error.message}`)
}

/** 溯源主逻辑：官网读不到 / LLM 抛错 → unverifiable（不给默认值）。 */
async function labelOrUnverifiable(
  deps: LibaiDeps,
  post: PostCopy,
  sources: LibaiSources,
): Promise<ProvenanceSnapshot> {
  const checkedAt = new Date().toISOString()
  if (sources.websiteText === null) {
    return { status: 'unverifiable', checked_at: checkedAt, reason: sources.reason ?? '官网正文读不到' }
  }
  try {
    return await labelProvenance(
      {
        fields: post.fields,
        websiteText: sources.websiteText,
        websiteUrl: sources.websiteUrl,
        briefText: sources.briefText,
        briefId: sources.briefId,
        brandName: sources.brandName,
      },
      deps.llm,
    )
  } catch (e) {
    return { status: 'unverifiable', checked_at: checkedAt, reason: `溯源失败：${errMessage(e)}` }
  }
}

/** 依赖注入版：便于集成测试注入假 supabase / 假 llm / 假抓取。 */
export function createLibaiCopyProvenanceFunction(deps: LibaiDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}libai-copy-provenance`,
      name: 'Libai copy provenance: label every sentence website/brief/unverified (never publishes)',
      // 同一客户串行（limit 2 允许不同客户并行），防同一客户两条文案同时打 LLM。
      concurrency: { limit: 2, key: 'event.data.client_id' },
      // 不重试：LLM 的钱已经花掉，失败回执如实记下即可。
      retries: 0,
    },
    { event: LIBAI_COPY_GENERATED_EVENT },
    async ({ event, step }): Promise<LibaiReceipt> => {
      const parsed = LibaiCopyGeneratedSchema.safeParse(event.data)
      if (!parsed.success) {
        return {
          request_id: event.id ?? '',
          client_id: '',
          source_record_id: '',
          status: 'invalid_payload',
          unverified_count: null,
          cost_usd: 0,
          no_publish: true,
          reason: 'payload 校验失败',
        }
      }
      const { client_id, post_id } = parsed.data
      const started = await step.run('start-receipt', async () => ({
        runId: await startCronRunId(LIBAI_PROVENANCE_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(LIBAI_PROVENANCE_JOB, started.runId, started.startedAt)
      const base = { request_id: started.runId, client_id, source_record_id: post_id, no_publish: true as const }

      const post = await step.run('read-post', async () => readPostCopy(deps.supabase, post_id))
      if (!post.ok) {
        await step.run('finish-receipt-not-found', async () => {
          await run.finish({ failed: 1, error: post.reason })
          return null
        })
        return { ...base, status: 'post_not_found', unverified_count: null, cost_usd: 0, reason: post.reason }
      }

      const sources = await step.run('load-sources', async () => loadSources(deps, client_id))
      const snap = await step.run('label', async () => labelOrUnverifiable(deps, post, sources))
      await step.run('write-snapshot', async () => {
        await writeProvenance(deps.supabase, post_id, post.snapshot, snap)
        return null
      })

      const unverifiedCount = snap.status === 'labelled' ? snap.unverified_count : null
      const costUsd = snap.status === 'labelled' ? snap.cost_usd : 0
      const status = snap.status === 'labelled' ? 'labelled' : 'unverifiable'
      const reason = snap.status === 'unverifiable' ? snap.reason : null
      await step.run('finish-receipt', async () => {
        // 跟 creatomate-render 同口径：判不了（unverifiable）记 failed，不冒充完成。
        await run.finish({
          completed: status === 'labelled' ? 1 : 0,
          failed: status === 'labelled' ? 0 : 1,
          error: reason ?? undefined,
          summary: {
            request_id: started.runId,
            client_id,
            source_record_id: post_id,
            status,
            unverified_count: unverifiedCount,
            cost_usd: costUsd,
            no_publish: true,
          },
        })
        return null
      })
      return { ...base, status, unverified_count: unverifiedCount, cost_usd: costUsd, reason }
    },
  )
}

/** 生产实例。 */
export const libaiCopyProvenance = createLibaiCopyProvenanceFunction({
  supabase: supabaseAdmin,
  llm: callClaudeChat,
  fetchPage: fetchUrlAsMarkdown,
  loadBrief: getActiveBrief,
})
