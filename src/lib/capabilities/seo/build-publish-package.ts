/**
 * Safe Capability · `seo.build_publish_package`
 *
 * 把一篇已经写好的博客草稿，连同它的 meta / schema / GEO 块 / 上下文快照，
 * 固化成一个 versioned production package。**停在 `draft` 态，不发布任何东西。**
 *
 * 为什么用它验证 Kernel v1（ADR-004 要求「真实执行但无客户外部副作用」）：
 *
 *   · **真的在干活**：读一篇真稿子、算内容指纹、组装、落库、回读校验。
 *     任何一步都能真失败 —— 不是 no-op 冒充闭环。
 *   · **零对外副作用**：不碰客户网站 / 商家页 / 社媒 / 广告，不调任何外部写接口。
 *     `production_packages` 的发布钩子只在 `status='published'` 上触发，
 *     这里永远写 `draft`。
 *   · **验证不是同义反复**：回读 + 指纹比对 + 必填断言 + 外键可解析断言，
 *     而不是「断言 status 变了」那种拿写入当验证的做法。
 *   · **回滚干净**：未发布的 package 没有下游消费者，按 kernel 标记一条 SQL 删干净。
 *
 * 🔴 污染缓解（必须一起看）：
 *   · 永远写 `status='draft'`。后台首页的「待审」计数只数 `ready_for_review`，
 *     所以这些行不会混进 PM 的待审数字（已逐个核对现有消费方）。
 *   · 每一行都带 `source_payload.produced_by='execution_kernel'` + `kernel_run_id`，
 *     一条 SQL 就能全部认出来并清掉。
 */

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepResult,
  VerificationResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'

/** 认出 Kernel 造出来的行 —— 清理和排查都靠它。 */
export const KERNEL_PRODUCER = 'execution_kernel'

/** Kernel 造的包永远停在这个状态。改这个常量 = 改这个动作的副作用等级。 */
export const KERNEL_PACKAGE_STATUS = 'draft'

export interface BlogDraftRow {
  id: string
  client_id: string
  title: string | null
  meta_title: string | null
  meta_description: string | null
  slug: string | null
  html_body: string | null
  word_count: number | null
  schema_json: Record<string, unknown> | null
  geo_html_snapshot: string | null
  status: string
}

/** 允许被固化的草稿状态。`published` 的稿子没有再做包的意义。 */
const PACKAGEABLE_STATUSES = new Set(['draft', 'approved'])

/**
 * 内容指纹。
 *
 * 🔴 它同时是幂等键的一半：同一篇稿子改过之后指纹会变，
 *    那是**另一件事**，该有另一个包 —— 不是「重复执行」。
 */
export function computeBlogContentHash(post: BlogDraftRow): string {
  const canonical = JSON.stringify({
    title: post.title ?? '',
    meta_title: post.meta_title ?? '',
    meta_description: post.meta_description ?? '',
    slug: post.slug ?? '',
    html_body: post.html_body ?? '',
    schema_json: post.schema_json ?? null,
    geo_html_snapshot: post.geo_html_snapshot ?? '',
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 40)
}

async function loadDraft(
  sb: SupabaseClient,
  clientId: string,
  blogPostId: string,
): Promise<BlogDraftRow> {
  // 🔴 客户身份由 Kernel 服务端注入并在这里再过滤一次。
  //    只按 id 查会让一个填错的 blog_post_id 把别的客户的稿子做成这个客户的包。
  const { data, error } = await sb
    .from('blog_posts')
    .select(
      'id, client_id, title, meta_title, meta_description, slug, html_body, ' +
        'word_count, schema_json, geo_html_snapshot, status',
    )
    .eq('id', blogPostId)
    .eq('client_id', clientId)
    .limit(1)
  if (error) {
    // 读失败换个时间还有救；读到空是事实，重试一万次也一样。两者必须分开。
    throw new RetryableCapabilityError(`读取博客草稿失败：${error.message}`)
  }
  const row = (data ?? [])[0] as unknown as BlogDraftRow | undefined
  if (!row) {
    throw new KernelError(
      'INVALID_INPUT',
      `这个客户名下找不到编号 ${blogPostId} 的博客草稿`,
      { detail: { blogPostId, clientId } },
    )
  }
  return row
}

async function resolveMasterBriefId(sb: SupabaseClient, clientId: string): Promise<string> {
  const { data, error } = await sb
    .from('master_briefs')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)
  if (error) throw new RetryableCapabilityError(`读取客户品牌底稿失败：${error.message}`)
  const row = (data ?? [])[0] as unknown as { id: string } | undefined
  if (!row) {
    throw new KernelError(
      'INVALID_INPUT',
      '这个客户还没有品牌底稿，做不了发布包 —— 得先把底稿建起来',
    )
  }
  return row.id
}

/**
 * 提交前把输入备齐。
 *
 * `content_hash` 必须在**提交时**就算出来，因为幂等键建在 action_runs 上。
 * 这条约束反过来逼调用方说清「这次到底要固化哪一份稿子」—— 模糊的提交没有幂等性可言。
 */
export async function prepareBuildPublishPackageInput(
  sb: SupabaseClient,
  clientId: string,
  blogPostId: string,
): Promise<{ blog_post_id: string; content_hash: string }> {
  const post = await loadDraft(sb, clientId, blogPostId)
  return { blog_post_id: post.id, content_hash: computeBlogContentHash(post) }
}

// ── capability 实现 ──────────────────────────────────────────────────────────

export function createBuildPublishPackageCapability(
  sb: SupabaseClient,
): CapabilityImplementation {
  return {
    actionKey: 'seo.build_publish_package',
    version: 1,
    steps: {
      /** ① 组装：读真稿子、比对指纹、取品牌底稿、拼出包的内容。 */
      async build({ ctx }): Promise<CapabilityStepResult> {
        const input = await requireInput(sb, ctx.runId)
        const post = await loadDraft(sb, ctx.clientId, input.blog_post_id)

        if (!PACKAGEABLE_STATUSES.has(post.status)) {
          throw new KernelError(
            'INVALID_INPUT',
            `这篇稿子现在是「${post.status}」，不是能做发布包的状态`,
          )
        }

        const hash = computeBlogContentHash(post)
        if (hash !== input.content_hash) {
          // 🔴 稿子在「排这件事」和「真去做」之间被改过了。
          //    照旧做完等于把一份**已经不是那份**的稿子固化下来，
          //    而幂等键还挂着旧指纹 —— 以后永远不会再为新版本做一次。
          throw new KernelError(
            'INVALID_INPUT',
            '这篇稿子在排上之后又被改过了，现在做出来的包对不上当初排的那一份 —— 重新排一次',
            { detail: { expected: input.content_hash, actual: hash } },
          )
        }

        const masterBriefId = await resolveMasterBriefId(sb, ctx.clientId)

        return {
          costActualUsd: 0,
          output: {
            blog_post_id: post.id,
            content_hash: hash,
            master_brief_id: masterBriefId,
            title: post.title ?? '(未命名)',
            word_count: post.word_count ?? 0,
            payload: {
              title: post.title ?? '',
              meta_title: post.meta_title ?? '',
              meta_description: post.meta_description ?? '',
              slug: post.slug ?? '',
              html_body: post.html_body ?? '',
              schema_json: post.schema_json ?? null,
              geo_html_snapshot: post.geo_html_snapshot ?? '',
            },
          },
        }
      },

      /** ② 落库：写 production_packages，永远 draft，永远带 kernel 标记。 */
      async persist({ ctx, priorOutputs }): Promise<CapabilityStepResult> {
        const built = priorOutputs.build
        if (!built) {
          throw new KernelError('INVALID_STATE', '组装这一步的产物不见了，没法落库')
        }

        // 上一次尝试可能已经写进去了才崩的 —— 重试前先认一下自己的行
        const existing = await findKernelPackage(sb, ctx.clientId, ctx.runId)
        if (existing) {
          return {
            costActualUsd: 0,
            output: { package_id: existing, content_hash: String(built.content_hash) },
          }
        }

        const { data, error } = await sb
          .from('production_packages')
          .insert({
            client_id: ctx.clientId,
            master_brief_id: built.master_brief_id,
            dimension: 'seo',
            title: String(built.title ?? '(未命名)'),
            brief: null,
            status: KERNEL_PACKAGE_STATUS,
            source_payload: {
              produced_by: KERNEL_PRODUCER,
              kernel_run_id: ctx.runId,
              authorization_decision_id: ctx.decisionId,
              action_key: ctx.actionKey,
              action_version: ctx.actionVersion,
              blog_post_id: built.blog_post_id,
              content_hash: built.content_hash,
            },
            generation_context_snapshot: built.payload ?? {},
          })
          .select('id')
        if (error) throw new RetryableCapabilityError(`写入发布包失败：${error.message}`)

        const created = (data ?? [])[0] as unknown as { id: string } | undefined
        if (!created) throw new RetryableCapabilityError('写入发布包后没拿回行')

        return {
          costActualUsd: 0,
          output: { package_id: created.id, content_hash: String(built.content_hash) },
        }
      },

      /**
       * ③ 验证：回读 + 指纹比对 + 必填断言 + 外键可解析断言。
       *
       * 🔴 这四条任何一条不过就是**没做成**。不重试 —— 重试改变不了
       *    「写进去的东西跟该写的对不上」这件事。
       */
      async verify({ ctx, priorOutputs }): Promise<CapabilityStepResult> {
        const built = priorOutputs.build
        const persisted = priorOutputs.persist
        if (!built || !persisted) {
          throw new KernelError('INVALID_STATE', '前面步骤的产物不见了，没法验证')
        }
        const packageId = String(persisted.package_id)

        const { data, error } = await sb
          .from('production_packages')
          .select('id, client_id, master_brief_id, dimension, title, status, source_payload')
          .eq('id', packageId)
          .limit(1)
        if (error) throw new RetryableCapabilityError(`回读发布包失败：${error.message}`)
        const row = (data ?? [])[0] as
          | {
              id: string
              client_id: string
              master_brief_id: string
              dimension: string
              title: string | null
              status: string
              source_payload: Record<string, unknown> | null
            }
          | undefined

        const checks: VerificationResult['checks'] = []
        const check = (name: string, passed: boolean, detail?: string) =>
          checks.push({ name, passed, ...(detail ? { detail } : {}) })

        check('包能回读到', Boolean(row), row ? undefined : `找不到 ${packageId}`)
        check('归属客户正确', row?.client_id === ctx.clientId,
          row ? `期望 ${ctx.clientId}，实际 ${row.client_id}` : undefined)
        check('内容指纹一致',
          String((row?.source_payload as Record<string, unknown> | null)?.content_hash ?? '') ===
            String(built.content_hash))
        check('停在内部草稿态', row?.status === KERNEL_PACKAGE_STATUS,
          row ? `实际是 ${row.status}` : undefined)
        check('必填字段齐全', Boolean(row?.title && row.title.trim() && row.master_brief_id))
        check('带着可追溯的执行标记',
          (row?.source_payload as Record<string, unknown> | null)?.kernel_run_id === ctx.runId)

        // 外键可解析性：品牌底稿这条边真的指得到东西
        let briefResolvable = false
        if (row?.master_brief_id) {
          const { data: mb, error: mbErr } = await sb
            .from('master_briefs')
            .select('id')
            .eq('id', row.master_brief_id)
            .limit(1)
          if (mbErr) throw new RetryableCapabilityError(`校验品牌底稿引用失败：${mbErr.message}`)
          briefResolvable = ((mb ?? []) as unknown as Array<{ id: string }>).length === 1
        }
        check('品牌底稿引用可解析', briefResolvable)

        const failed = checks.filter((c) => !c.passed)
        const verification: VerificationResult = {
          method: 'package_integrity',
          passed: failed.length === 0,
          checks,
          ...(failed.length > 0
            ? { failure_reason: failed.map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`).join('；') }
            : {}),
        }

        return {
          costActualUsd: 0,
          verification,
          output: {
            package_id: packageId,
            content_hash: String(built.content_hash),
            title: String(built.title ?? ''),
            word_count: Number(built.word_count ?? 0),
          },
        }
      },
    },
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

/** 从 run 上把提交时的输入读回来 —— capability 不接受调用方现场递参数。 */
async function requireInput(
  sb: SupabaseClient,
  runId: string,
): Promise<{ blog_post_id: string; content_hash: string }> {
  const { data, error } = await sb.from('action_runs').select('input').eq('id', runId).limit(1)
  if (error) throw new RetryableCapabilityError(`读取执行输入失败：${error.message}`)
  const row = (data ?? [])[0] as unknown as { input: Record<string, unknown> } | undefined
  if (!row) throw new KernelError('INVALID_STATE', `找不到执行实例 ${runId}`)
  const blogPostId = row.input?.blog_post_id
  const contentHash = row.input?.content_hash
  if (typeof blogPostId !== 'string' || typeof contentHash !== 'string') {
    throw new KernelError('INVALID_INPUT', '这次执行的输入里缺少稿子编号或内容指纹')
  }
  return { blog_post_id: blogPostId, content_hash: contentHash }
}

/** 本次 run 是不是已经写过一个包了（重试前的自我识别）。 */
async function findKernelPackage(
  sb: SupabaseClient,
  clientId: string,
  runId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('production_packages')
    .select('id')
    .eq('client_id', clientId)
    .eq('source_payload->>kernel_run_id', runId)
    .limit(1)
  if (error) throw new RetryableCapabilityError(`查已有发布包失败：${error.message}`)
  return ((data ?? [])[0] as unknown as { id: string } | undefined)?.id ?? null
}
