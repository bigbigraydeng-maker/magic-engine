/**
 * Creatomate 渲染工作流（spec docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4）。
 *
 * 🔴 函数级 `retries: 0`——Inngest 3.54 的 retries 只能在函数级配置（`createFunction()`
 *    的选项，不是 per-step），对这条函数的所有 step 一起生效，跟 `flywheel-seo-weekly.ts`
 *    处理"provider 的钱在函数内部花掉"这类问题的既有写法一致。第二轮复审（子牙+魏征交叉
 *    实测）抓出 v1 只在注释里写了这句话、`createFunction()` 配置里没真的加——已修正。
 *    幂等辅助靠"先查 job 行有没有已经做过"，两层一起兜底，不是只靠不重试。
 *
 * 🔴 webhook 不可信：无法验证来源（官方文档没给签名机制，spec §3.3/§6.1）。events.ts 里
 *    webhook 事件类型上就不带 status/url，物理上不给"直接采信"的机会——不管是被 webhook
 *    唤醒还是等满超时，下一步永远是独立调 GET /v2/renders/{id} 拿真实状态。
 *
 * 🔴 卡死回收：旧 ffmpeg 路径的 `reapStale()` 随 2026-09-02 退役一起死了（子牙 ❌B4）。
 *    这条新路径不依赖它，超时后有限次数轮询兜底，仍未到终态就转人工待办
 *    （`src/lib/pm-todo/manual-items.ts`），不会安静卡在 `rendering` 里没人知道。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRunId, cronRunHandle } from '@/lib/cron/run-logger'
import {
  CREATOMATE_RENDER_REQUESTED_EVENT,
  CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT,
  CreatomateRenderRequestedSchema,
} from '@/lib/creatomate/events'
import { prepareSceneAssets, type PreparedScene } from '@/lib/creatomate/scene-assets'
import { buildModifications } from '@/lib/creatomate/modifications'
import { resolveOfferFacts, resolvePostFields } from '@/lib/creatomate/post-fields'
import { submitRender, getRender } from '@/lib/creatomate/render'
import { isTerminalStatus, type CreatomateRender, type CreatomateTemplateContract } from '@/lib/creatomate/types'
import { storeCreatomateResult } from '@/lib/creatomate/store-result'
import { estimateCreatomateCostUsd } from '@/lib/creatomate/cost'
import { projectFactoryConfig } from '@/lib/factory/client-config'

const REPOLL_ATTEMPTS = 10
const REPOLL_INTERVAL = '2m'

interface JobRow {
  id: string
  client_id: string
  content_post_id: string
  status: string
  scenes: PreparedScene[] | null
  creatomate_render_id: string | null
}

async function patchJob(supabase: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('content_factory_render_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw new Error(`patchJob(${jobId}) 失败: ${error.message}`)
}

/** `content_factory_render_jobs.scenes` 是同一列，旧 ffmpeg 路径写的形状是 `Scene[]`
 *  （render-pipeline.ts，字段是 imagePrompt/motionPrompt/voText，没有 visualUrl）。
 *  第二轮复审 ⚠️6 指出：旧形状的行如果被当成 PreparedScene[] 直接用，`buildModifications`
 *  会拿到一堆 undefined，Creatomate 渲出空模板却仍标 ready_for_review——"假成功"。
 *  这里做运行时形状校验，不是简单 `as` 断言：不是这个形状就当没准备过，重新走一遍。 */
function isPreparedSceneArray(v: unknown): v is PreparedScene[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        s && typeof s === 'object' && typeof (s as Record<string, unknown>).visualUrl === 'string' &&
        typeof (s as Record<string, unknown>).costUsd === 'number',
    )
  )
}

async function readJob(supabase: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await supabase
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id, status, scenes, creatomate_render_id')
    .eq('id', jobId)
    .single()
  if (error || !data) throw new Error(`render job not found: ${jobId}`)
  const row = data as { id: string; client_id: string; content_post_id: string; status: string; scenes: unknown; creatomate_render_id: string | null }
  return {
    ...row,
    scenes: isPreparedSceneArray(row.scenes) ? row.scenes : null,
  }
}

/** 只读一次 factory_config，原样传下去——不拼凑/强转出第二份假形状（避免接口跟真实
 *  生产者对不上，见 memory feedback-as-unknown-as-hides-shape-mismatch）。 */
async function readFactoryConfig(supabase: SupabaseClient, clientId: string): Promise<unknown> {
  const { data } = await supabase.from('clients').select('factory_config').eq('id', clientId).single()
  return data?.factory_config ?? null
}

/** 复用 client-config.ts::projectFactoryConfig 同一份解析逻辑（Settings UI 的 GET 端点
 *  也走它）——两处各写一份容易在字段名（snake_case 存储 vs camelCase 内存）上悄悄岔开。 */
function extractTemplateContract(factoryConfig: unknown, clientId: string): CreatomateTemplateContract {
  const c = projectFactoryConfig(factoryConfig).render?.creatomate
  if (!c) {
    throw new Error(`该客户未配置 Creatomate 模板（clients.factory_config.render.creatomate，client=${clientId}）`)
  }
  // 🔴 子牙设计复审 5(a)：sceneFieldMap 的 caption 槽位和 requiredPostFields 如果撞了同一个
  // 元素名，buildModifications 里谁覆盖谁完全取决于调用顺序，是隐藏 bug 温床——运行时
  // 直接拦，不指望配模板的人自己记得这条约束。
  const sceneCaptions = new Set(c.sceneFieldMap.map((s) => s.caption).filter((x): x is string => !!x))
  const overlap = (c.requiredPostFields ?? []).filter((f) => sceneCaptions.has(f))
  if (overlap.length > 0) {
    throw new Error(
      `模板配置冲突：${overlap.join('、')} 同时出现在 sceneFieldMap 的镜头字幕槽位和 requiredPostFields 里，两条路径会抢着写同一个元素（client=${clientId}）`,
    )
  }
  return c
}

async function readPostFields(
  supabase: SupabaseClient,
  postId: string,
): Promise<{ title: string; script: string }> {
  const { data, error } = await supabase.from('content_posts').select('title, script').eq('id', postId).single()
  if (error || !data) throw new Error(`content_posts not found: ${postId}`)
  if (!data.script?.trim()) throw new Error('选题没有逐字稿，无法做片')
  return { title: data.title ?? '', script: data.script }
}

/** 校验 Record<string,string>——脏数据(非对象/含非字符串值)一律拒绝，跟
 *  client-config.ts::isStringRecord 同一套原则（这里不 import 那个私有函数，
 *  两处各自维护同一份简单校验比跨模块导出一个内部 helper 更省心）。 */
function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
}

/** 这条视频专属的文字覆盖——读自 `content_posts.generation_context_snapshot.endcard`
 *  （子牙+魏征复审后的设计，2026-09-13）。`endcard` 这个 key 名是历史命名，装的不只是
 *  片尾卡片——只要是"这条视频必须自己给值、不能用模板默认内容"的元素（片尾团名/
 *  路线/价格/日期，以及往后可能加入的开场钩子/CTA），都走这同一个 key，不为此另开
 *  一个子 key。`generation_context_snapshot` 这一列同时被别的功能用（如发布失败原因），
 *  写入时必须只动 `endcard` 这个子 key，不能整列覆盖——写入侧见 `ensurePostFieldsWritten`
 *  （2026-09-13 新增，替代了这里此前"设计上要求人填、但没有代码真的去写"的缺口）。
 *  这里只负责读+校验。
 *
 *  `requiredPostFields` 声明了哪些元素名这条视频必须自己提供值——一个都不能少，缺了直接
 *  抛错（外层 handleCreatomateRenderRequested 会把 job 标 failed，不会静默套用模板作者
 *  写的示例内容当真发布，魏征复审 ②）。没声明 `requiredPostFields`（该客户模板没有需要
 *  逐视频变化的文字）时，也不要求 snapshot 里有 endcard，返回空对象即可。 */
export function resolvePostEndcardOverrides(
  snapshot: unknown,
  requiredPostFields: string[] | undefined,
): Record<string, string> {
  if (!requiredPostFields || requiredPostFields.length === 0) return {}

  const root = (snapshot ?? null) as Record<string, unknown> | null
  const endcard = root?.endcard
  if (!isStringRecord(endcard)) {
    throw new Error(
      `该视频缺少 EndCard 内容（content_posts.generation_context_snapshot.endcard），模板要求填：${requiredPostFields.join('/')}`,
    )
  }

  const missing = requiredPostFields.filter((key) => !endcard[key]?.trim())
  if (missing.length > 0) {
    throw new Error(`该视频 EndCard 缺字段：${missing.join('/')}——不允许静默套用模板默认内容发布`)
  }
  return endcard
}

async function readPostEndcardSnapshot(supabase: SupabaseClient, postId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('id', postId)
    .single()
  if (error || !data) throw new Error(`content_posts not found: ${postId}`)
  return data.generation_context_snapshot
}

/** 这条视频指定用哪个团/档位的真实事实（如 "best_of_china"）——跟 endcard 同一列的
 *  兄弟 key，选题/审核阶段人工标注。客户只配了一个档位时可以不标，见 post-fields.ts
 *  ::resolveOfferFacts 的兜底规则。 */
async function readPostOfferKey(supabase: SupabaseClient, postId: string): Promise<string | null> {
  const snapshot = await readPostEndcardSnapshot(supabase, postId)
  const key = (snapshot as Record<string, unknown> | null)?.offer_key
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

/**
 * 自动把这条视频该填的真实事实（团名/路线/价格/出发日期……）算出来、写回
 * `content_posts.generation_context_snapshot.endcard`——2026-09-13 子牙+魏征设计复审后
 * 新增，取代此前"设计上要求人填、但从没有代码真的去写"的缺口（此前全靠人工跑脚本
 * 代填，撞了 CLAUDE.md「FDE/PM 要填的字段必须连 Settings UI 一起做完」这条红线）。
 *
 * 只做**有边界的合并**：只读、只改 `.endcard` 这个子 key，`generation_context_snapshot`
 * 上别的子 key（如发布失败原因）原样保留，不整列覆盖。
 *
 * 幂等：resolveOfferFacts/resolvePostFields 都是纯函数，同样的 offer_key + 客户配置
 * 永远算出同样的值——Inngest 这一步重跑多少次，结果都一样，不会漂移（子牙复审 4）。
 * requiredPostFields 为空（客户模板没有"每条视频必须自己给值"的字段）时整段跳过，
 * 不产生任何写入。
 */
async function ensurePostFieldsWritten(
  supabase: SupabaseClient,
  postId: string,
  contract: CreatomateTemplateContract,
): Promise<void> {
  if (!contract.requiredPostFields || contract.requiredPostFields.length === 0) return

  const offerKey = await readPostOfferKey(supabase, postId)
  const offerFacts = resolveOfferFacts({ offers: contract.offers, offerKey })
  const postFields = resolvePostFields({
    requiredPostFields: contract.requiredPostFields,
    postFieldSources: contract.postFieldSources,
    offerFacts,
  })

  const current = (await readPostEndcardSnapshot(supabase, postId)) as Record<string, unknown> | null
  const currentEndcard = isStringRecord(current?.endcard) ? current!.endcard : {}
  const merged = { ...(current ?? {}), endcard: { ...currentEndcard, ...postFields } }

  const { error } = await supabase
    .from('content_posts')
    .update({ generation_context_snapshot: merged })
    .eq('id', postId)
  if (error) throw new Error(`写入 postFields 到 generation_context_snapshot.endcard 失败: ${error.message}`)
}

async function finalizeSuccess(
  supabase: SupabaseClient,
  job: JobRow,
  render: CreatomateRender,
  totalCostUsd: number,
): Promise<void> {
  if (!render.url) throw new Error(`Creatomate 状态 succeeded 但没有 url（render_id=${render.id}）`)
  const { storageUrl } = await storeCreatomateResult({
    resultUrl: render.url,
    clientId: job.client_id,
    jobId: job.id,
  })
  await patchJob(supabase, job.id, { status: 'ready_for_review', output_url: storageUrl, cost_usd: totalCostUsd })
  await supabase.from('content_posts').update({ source_video_url: storageUrl }).eq('id', job.content_post_id)
}

async function finalizeFailure(supabase: SupabaseClient, job: JobRow, reason: string, costUsd: number): Promise<void> {
  await patchJob(supabase, job.id, { status: 'failed', error: reason, cost_usd: costUsd })
  // 人工待办见 src/lib/pm-todo/manual-items.ts::pushCreatomateRenderItems（读这张表的
  // failed 行，不在这里直接写待办表——同一份"扫失败行"逻辑复用，不建第二条通道）。
}

/** 处理一条 `CREATOMATE_RENDER_REQUESTED_EVENT` 事件——单独导出以便直接单测（不需要
 *  经过 Inngest 的 createFunction 包装/真实调度），是第二轮复审揪出 ❌1/❌2 之后补的
 *  测试接缝，同一模式见 flywheel-seo-weekly.ts 的 create*Function 注入写法。 */
export async function handleCreatomateRenderRequested(
  supabase: SupabaseClient,
  event: { data?: unknown },
  step: StepTools,
): Promise<{ ok: boolean; reason?: string }> {
  const parsed = CreatomateRenderRequestedSchema.safeParse(event.data)
  if (!parsed.success) return { ok: false, reason: 'invalid_payload' }
  const { job_id: jobId } = parsed.data

  // job_name 必须是静态字面量（不能拼 jobId 进去）——registry.test.ts 用 AST 静态扫描
  // startCronRun(Id) 的入参来认领监控清单，动态值会读不出来、也会让 job_name 无限增殖，
  // 这套回执机制是给"稳定命名的任务"用的，具体是哪条 render 由 summary.source_record_id 区分。
  const runId = await step.run('start-receipt', () => startCronRunId('creatomate-render'))
  const startedAt = Date.now()

  try {
    const result = await runWorkflow(supabase, jobId, step)
    await step.run('finish-receipt', () =>
      cronRunHandle('creatomate-render', runId, startedAt).finish({
        completed: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        summary: {
          request_id: runId,
          client_id: result.clientId,
          source_record_id: jobId,
          cost_usd: result.costUsd,
          no_publish: true,
        },
        error: result.ok ? undefined : result.reason,
      }),
    )
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 🔴 第二轮复审（子牙 ❌2）抓出：提交前抛出的任何异常（客户没配模板/没配声音/
    //    选题没逐字稿/分镜超槽位/402 额度用完⋯）此前一条都不会把 job 标 failed，
    //    job 永远停在 queued/rendering，manual-items.ts 只扫 status='failed'，
    //    这类失败因此对人工待办永远不可见。这里兜底：不管失败发生在哪一步，
    //    job 行必须落终态，failed 之外没有第三种可能。
    await step.run('finalize-failure-outer', () =>
      patchJob(supabase, jobId, { status: 'failed', error: message }).catch((patchErr) =>
        console.error(`[factory-creatomate-render] job ${jobId} 标 failed 也失败了，彻底孤儿:`, patchErr),
      ),
    )
    await step.run('finish-receipt-error', () =>
      cronRunHandle('creatomate-render', runId, startedAt).finish({ failed: 1, error: message }),
    )
    throw e
  }
}

export function createFactoryCreatomateRender(deps: { supabase: SupabaseClient }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}factory-creatomate-render`,
      name: 'Factory: Creatomate template render',
      concurrency: { limit: 3, key: 'event.data.client_id' },
      // 见文件头注：函数级 retries:0，跟 flywheel-seo-weekly.ts 处理付费 provider 调用
      // 的既有写法一致——这条函数从 prepare-assets 到 submit 全程在花真钱，Inngest 默认
      // 重试会把已经花过的钱再花一遍。
      retries: 0,
    },
    { event: CREATOMATE_RENDER_REQUESTED_EVENT },
    ({ event, step }) => handleCreatomateRenderRequested(deps.supabase, event, step),
  )
}

type StepTools = GetStepTools<typeof inngest>

async function runWorkflow(
  supabase: SupabaseClient,
  jobId: string,
  step: StepTools,
): Promise<{ ok: boolean; reason?: string; clientId: string; costUsd: number }> {
  const job = await step.run('check-existing', () => readJob(supabase, jobId))

  const scenes = job.scenes ?? (await ensureSceneAssets(supabase, step, job))
  const costUsd = scenes.reduce((sum, s) => sum + s.costUsd, 0)

  const renderId = job.creatomate_render_id ?? (await ensureSubmitted(supabase, step, job, scenes))

  await step.waitForEvent(`wait-webhook-${jobId}`, {
    event: CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT,
    timeout: '15m',
    match: 'data.job_id',
  })

  const render = await resolveTerminal(step, renderId)
  if (!render) {
    await step.run('finalize-timeout', () => finalizeFailure(supabase, job, 'Creatomate 渲染超时未完成', costUsd))
    return { ok: false, reason: 'timeout', clientId: job.client_id, costUsd }
  }
  if (render.status === 'succeeded') {
    // Creatomate 自己这次渲染花的 credits，此前从不记账（第二轮复审 ⚠️4）——按模板声明的
    // 输出维度 + 镜头数估算，不是精确值（cost.ts::estimateCreatomateCostUsd 头注）。
    const contract = await step.run('read-contract-for-cost', async () =>
      extractTemplateContract(await readFactoryConfig(supabase, job.client_id), job.client_id),
    )
    const totalCostUsd = costUsd + estimateCreatomateCostUsd(contract, scenes.length)
    await step.run('finalize-success', () => finalizeSuccess(supabase, job, render, totalCostUsd))
    return { ok: true, clientId: job.client_id, costUsd: totalCostUsd }
  }

  const reason = render.errorMessage ?? `Creatomate 渲染失败（状态：${render.status}）`
  await step.run('finalize-failure', () => finalizeFailure(supabase, job, reason, costUsd))
  return { ok: false, reason, clientId: job.client_id, costUsd }
}

async function ensureSceneAssets(
  supabase: SupabaseClient,
  step: StepTools,
  job: JobRow,
): Promise<PreparedScene[]> {
  return step.run('prepare-assets', async () => {
    const { title, script } = await readPostFields(supabase, job.content_post_id)
    const factoryConfig = await readFactoryConfig(supabase, job.client_id)

    // 🔴 必须在花钱生成分镜素材之前做，且必须在 patchJob 写 job.scenes 之前做——
    // 外层 runWorkflow 用 `job.scenes ?? (await ensureSceneAssets(...))` 判断要不要
    // 重跑这一步：如果这段校验排在 patchJob 之后，一旦它抛错（如客户没配这个团的
    // 事实字典），job.scenes 已经非空，之后哪怕把配置改对了重新触发，也会因为
    // job.scenes 非空而永远跳过这一步、跳过这段校验，只会在 submit 步骤被
    // resolvePostEndcardOverrides 拦第二次——又变回"只能人工改数据库才能救"，
    // 正是这条改动本来要消灭的操作（复审 acf8139a 抓出）。排在最前面，失败时
    // job.scenes 还是空的，下次重跑会从头再来一遍，配置改对了就能自愈。
    const contract = extractTemplateContract(factoryConfig, job.client_id)
    await ensurePostFieldsWritten(supabase, job.content_post_id, contract)

    const scenes = await prepareSceneAssets({
      clientId: job.client_id,
      jobId: job.id,
      title,
      script,
      factoryConfig,
    })
    const sceneCostUsd = scenes.reduce((sum, s) => sum + s.costUsd, 0)
    await patchJob(supabase, job.id, { status: 'rendering', scenes, cost_usd: sceneCostUsd })

    return scenes
  })
}

async function ensureSubmitted(
  supabase: SupabaseClient,
  step: StepTools,
  job: JobRow,
  scenes: PreparedScene[],
): Promise<string> {
  const renderId = await step.run('submit', async () => {
    const factoryConfig = await readFactoryConfig(supabase, job.client_id)
    const contract = extractTemplateContract(factoryConfig, job.client_id)

    // 这条视频专属的 EndCard 覆盖，合并进 staticOverrides 之上——buildModifications 本身
    // 不用感知"客户级 vs 单视频"这两层来源，调用它之前就拼成一份（子牙复审：避免
    // buildModifications 内部再背一层新的优先级心智负担）。
    const endcardSnapshot = await readPostEndcardSnapshot(supabase, job.content_post_id)
    const postOverrides = resolvePostEndcardOverrides(endcardSnapshot, contract.requiredPostFields)
    const effectiveContract: CreatomateTemplateContract = {
      ...contract,
      staticOverrides: { ...contract.staticOverrides, ...postOverrides },
    }

    const modifications = buildModifications(scenes, effectiveContract)
    const webhookUrl = `${requireBaseUrl()}/api/webhooks/creatomate`
    const { renderId } = await submitRender({ templateId: contract.templateId, modifications, webhookUrl })
    return renderId
  })
  await step.run('persist-render-id', () => patchJob(supabase, job.id, { creatomate_render_id: renderId }))
  return renderId
}

async function resolveTerminal(step: StepTools, renderId: string): Promise<CreatomateRender | null> {
  let render = await step.run('confirm-status', () => getRender(renderId))
  for (let attempt = 0; attempt < REPOLL_ATTEMPTS && !isTerminalStatus(render.status); attempt++) {
    await step.sleep(`repoll-wait-${attempt}`, REPOLL_INTERVAL)
    render = await step.run(`repoll-${attempt}`, () => getRender(renderId))
  }
  return isTerminalStatus(render.status) ? render : null
}

function requireBaseUrl(): string {
  // APP_URL 优先于 NEXT_PUBLIC_APP_URL —— 沿用 gbp/start/route.ts 等既有路由的同款惯例。
  const url = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('缺少 APP_URL / NEXT_PUBLIC_APP_URL，webhook_url 拼不出来')
  return url
}

export const factoryCreatomateRender = createFactoryCreatomateRender({ supabase: supabaseAdmin })
