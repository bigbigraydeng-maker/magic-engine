/**
 * Reel 批量渲染工作流（先小样后全渲）。
 *
 * 流程：
 *   1. 提交所有 Reel 的小样渲染（270×480）
 *   2. 轮询等所有小样完成
 *   3. 等 PM 人工审批（waitForEvent `reel/batch.preview.approved`，超时 48h）
 *   4. 提交所有 Reel 的全尺寸渲染（1080×1920）
 *   5. 轮询等全尺寸完成
 *   6. 下载 + 上传 Supabase Storage + 写 client_assets
 *
 * 🔴 retries: 0——提交渲染是付费步骤，Inngest 默认重试会把同一条 Reel 渲两次。
 * 🔴 callout：轮询是在 step.run 内部循环，不是用 step.sleep + 多个 step——
 *    这条 Reel 批次通常 < 5 条，轮询不会撑爆 step 上限。
 */
import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRunId, cronRunHandle } from '@/lib/cron/run-logger'
import {
  submitInlineRender,
  buildReelSource,
  pollUntilDone,
  type ReelSpec,
  type ReelTemplate,
} from '@/lib/creatomate/inline-render'

export const REEL_BATCH_RENDER_STARTED_EVENT = 'reel/batch.render.started' as const
export const REEL_BATCH_PREVIEW_APPROVED_EVENT = 'reel/batch.preview.approved' as const

const ReelSpecSchema = z.object({
  tag: z.string().min(1),
  sourceUrl: z.string().url(),
  serviceName: z.string().min(1),
  durationS: z.number().positive(),
})

const ReelTemplateSchema = z.object({
  brandName: z.string().min(1),
  tagline: z.string().min(1),
  cta: z.string().min(1),
})

export const ReelBatchStartedSchema = z.object({
  batch_id: z.string().min(1),
  client_id: z.string().uuid(),
  reels: z.array(ReelSpecSchema).min(1).max(20),
  template: ReelTemplateSchema,
})

export type ReelBatchStartedData = z.infer<typeof ReelBatchStartedSchema>

interface RenderedItem {
  tag: string
  renderId: string
  outputUrl: string
  serviceName: string
}

const PREVIEW_W = 270
const PREVIEW_H = 480
const FULL_W = 1080
const FULL_H = 1920

const BUCKET = 'visual-assets'

async function uploadAndInsertAsset(
  clientId: string,
  item: RenderedItem,
): Promise<{ assetId: string; storageUrl: string }> {
  // 下载 Creatomate 输出
  const res = await fetch(item.outputUrl)
  if (!res.ok) throw new Error(`下载渲染结果失败 ${item.tag}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  // 上传到 Supabase Storage
  const storagePath = `${clientId}/assets/reel-${item.tag}-branded.mp4`
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'video/mp4',
    upsert: true,
  })
  if (upErr) throw new Error(`上传 ${item.tag} 到 Storage 失败: ${upErr.message}`)

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)

  // 写 client_assets
  const { data: asset, error: dbErr } = await supabaseAdmin
    .from('client_assets')
    .insert({
      client_id: clientId,
      asset_type: 'reel',
      storage_url: publicUrl,
      mime_type: 'video/mp4',
      file_size_bytes: buf.length,
      tags: ['reel', 'branded', item.serviceName.toLowerCase().replace(/\s+/g, '-')],
      metadata: {
        service: item.serviceName,
        source: 'creatomate-batch',
        batch_tag: item.tag,
        creatomate_render_id: item.renderId,
      },
    })
    .select('id')
    .single()

  if (dbErr) throw new Error(`写 client_assets ${item.tag} 失败: ${dbErr.message}`)
  return { assetId: asset.id as string, storageUrl: publicUrl }
}

export function createReelBatchRender() {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}reel-batch-render`,
      name: 'Reel: 批量渲染（先小样后全渲）',
      retries: 0,
    },
    { event: REEL_BATCH_RENDER_STARTED_EVENT },
    async ({ event, step }) => {
      const parsed = ReelBatchStartedSchema.safeParse(event.data)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_payload', errors: parsed.error.flatten() }
      }
      const { batch_id: batchId, client_id: clientId, reels, template } = parsed.data

      const runId = await step.run('start-receipt', () =>
        startCronRunId('reel-batch-render'),
      )
      const startedAt = Date.now()

      // ── 第一步：提交小样渲染 ───────────────────────────────────────
      const previewIds = await step.run('submit-previews', async () => {
        const results: Array<{ tag: string; renderId: string }> = []
        for (const reel of reels) {
          const source = buildReelSource(reel as ReelSpec, template as ReelTemplate)
          const { renderId } = await submitInlineRender({ source, width: PREVIEW_W, height: PREVIEW_H })
          results.push({ tag: reel.tag, renderId })
        }
        return results
      })

      // ── 第二步：等所有小样完成 ────────────────────────────────────
      const previews = await step.run('poll-previews', async () => {
        const results: Array<{ tag: string; renderId: string; url: string }> = []
        for (const { tag, renderId } of previewIds) {
          const render = await pollUntilDone(renderId, { maxAttempts: 20, intervalMs: 15_000 })
          if (render.status !== 'succeeded' || !render.url) {
            throw new Error(`小样渲染失败 ${tag}: ${render.status} ${render.errorMessage ?? ''}`)
          }
          results.push({ tag, renderId, url: render.url })
        }
        return results
      })

      // 记录小样 URL——Claude Code 会把这些发给 PM 看
      await step.run('log-preview-urls', () =>
        cronRunHandle('reel-batch-render', runId, startedAt).finish({
          completed: previews.length,
          summary: {
            request_id: runId,
            client_id: clientId,
            source_record_id: batchId,
            status: 'awaiting_preview_approval',
            preview_urls: Object.fromEntries(previews.map((p) => [p.tag, p.url])),
            no_publish: true,
          },
        }),
      )

      // ── 第三步：等 PM 审批 ────────────────────────────────────────
      const approval = await step.waitForEvent(`await-approval-${batchId}`, {
        event: REEL_BATCH_PREVIEW_APPROVED_EVENT,
        match: 'data.batch_id',
        timeout: '48h',
      })

      if (!approval) {
        return { ok: false, reason: 'preview_approval_timeout', batchId, previews }
      }

      // ── 第四步：提交全尺寸渲染 ────────────────────────────────────
      const fullIds = await step.run('submit-full-renders', async () => {
        const results: Array<{ tag: string; renderId: string; serviceName: string }> = []
        for (const reel of reels) {
          const source = buildReelSource(reel as ReelSpec, template as ReelTemplate)
          const { renderId } = await submitInlineRender({ source, width: FULL_W, height: FULL_H })
          results.push({ tag: reel.tag, renderId, serviceName: reel.serviceName })
        }
        return results
      })

      // ── 第五步：等全尺寸完成 ────────────────────────────────────
      const fullRenders = await step.run('poll-full-renders', async () => {
        const results: Array<{ tag: string; renderId: string; outputUrl: string; serviceName: string }> = []
        for (const { tag, renderId, serviceName } of fullIds) {
          const render = await pollUntilDone(renderId, { maxAttempts: 30, intervalMs: 20_000 })
          if (render.status !== 'succeeded' || !render.url) {
            throw new Error(`全尺寸渲染失败 ${tag}: ${render.status} ${render.errorMessage ?? ''}`)
          }
          results.push({ tag, renderId, outputUrl: render.url, serviceName })
        }
        return results
      })

      // ── 第六步：下载 + 上传 Supabase + 写 client_assets ────────
      const assetRecords = await step.run('store-assets', async () => {
        const results: Array<{ tag: string; assetId: string; storageUrl: string }> = []
        for (const item of fullRenders) {
          const { assetId, storageUrl } = await uploadAndInsertAsset(clientId, item as RenderedItem)
          results.push({ tag: item.tag, assetId, storageUrl })
        }
        return results
      })

      const runId2 = await step.run('finish-receipt', () =>
        startCronRunId('reel-batch-render'),
      )
      await step.run('log-completion', () =>
        cronRunHandle('reel-batch-render', runId2, startedAt).finish({
          completed: assetRecords.length,
          summary: {
            request_id: runId2,
            client_id: clientId,
            source_record_id: batchId,
            status: 'completed',
            asset_ids: assetRecords.map((r) => r.assetId),
            storage_urls: Object.fromEntries(assetRecords.map((r) => [r.tag, r.storageUrl])),
            no_publish: true,
          },
        }),
      )

      return { ok: true, batchId, assetRecords }
    },
  )
}

export const reelBatchRender = createReelBatchRender()
