/**
 * 鲁班 Lǔ Bān — 工具层（P8.12.S3.1 / S3.2 / S3.4 / S3.5）
 *
 * buildLubanTools(ctx) 返回 Anthropic 工具定义 + handler 映射，注入 callClaudeWithTools。
 *
 * 工具清单：
 *   - add_work_log               鲁班自主把对话结论写进 execution_logs（S3.1）
 *   - generate_content           根据执行项的 module 字段调用对应模块的内容生成能力，
 *                                直接产出内容并落库（S3.2）——目前直连「SEO 内容引擎」。
 *   - publish_to_gbp             发布 GBP 本地贴子；无写权限时降级为草稿 + 人工发布（S3.4）。
 *   - discover_local_competitors 从 Yellow Pages AU / Localsearch 抓本地竞品列表（S3.5）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { ExecutionItem, ExecutionLogKind } from '@/types/diagnostic'
import type { BlogPost } from '@/types/magic-engine'
import { generateBlogPost } from '@/lib/blog/generator'
import { publishToGbp, type GbpPostInput } from '@/lib/gbp/publisher'
import {
  discoverLocalCompetitors,
  buildYellowPagesUrl,
  buildLocalsearchUrl,
} from '@/lib/local-directory/client'

export interface LubanToolContext {
  supabase: SupabaseClient
  itemId: string
  clientId: string
  /** 当前执行项 — generate_content 需要它的 module / title / description */
  item: ExecutionItem
}

export interface LubanToolset {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
}

// ─── add_work_log（S3.1）──────────────────────────────────────────────────────

// add_work_log 可写的日志类型 — 与 /execution/[itemId]/log route 的 ALLOWED_KINDS 保持一致
// （status_change / adjustment 由系统写，不开放给鲁班）
const ADD_WORK_LOG_KINDS: ExecutionLogKind[] = ['note', 'blocker', 'ai_assist']

const ADD_WORK_LOG_TOOL: Anthropic.Tool = {
  name: 'add_work_log',
  description:
    '把一条工作记录写入当前执行项的工作日志。当你和 FDE 达成一个明确结论、产出可落地的草稿、或 FDE 报告了一个卡点时，主动调用它沉淀下来——不用等 FDE 开口。content 用中文，简洁记录「做了什么 / 结论是什么 / 卡点是什么」。',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: {
        type: 'string',
        enum: ['note', 'blocker', 'ai_assist'],
        description: 'note=进度记录或结论；blocker=FDE 报告的卡点；ai_assist=你产出的可用草稿。',
      },
      content: {
        type: 'string',
        description: '工作记录正文，中文，简洁。',
      },
    },
    required: ['kind', 'content'],
  },
}

function isAddWorkLogInput(input: unknown): input is { kind: string; content: string } {
  if (typeof input !== 'object' || input === null) return false
  const o = input as Record<string, unknown>
  return typeof o.kind === 'string' && typeof o.content === 'string'
}

// ─── generate_content（S3.2）─────────────────────────────────────────────────

const GENERATE_CONTENT_TOOL: Anthropic.Tool = {
  name: 'generate_content',
  description:
    '根据当前执行项对应的 Magic Engine 模块，调用该模块的内容生成能力，直接产出内容并落库为草稿——而不是只在对话里贴文本。' +
    '何时用：执行项是「内容产出类」任务（写博客、写 SEO 文章等），FDE 让你「直接生成」「出一篇」「落进系统」时。' +
    '目前直连「SEO 内容引擎」（执行项 module = seo_engine）；其他模块暂未接入，会返回提示。' +
    '生成成功后内容会进入对应模块的草稿列表，等 FDE 审核。',
  input_schema: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: '内容主题 / 标题方向。留空则用执行项标题。',
      },
      instructions: {
        type: 'string',
        description: '可选，给生成器的额外要求（角度、重点、字数倾向等），中文。',
      },
    },
    required: [],
  },
}

function isGenerateContentInput(input: unknown): input is { topic?: string; instructions?: string } {
  if (typeof input !== 'object' || input === null) return true   // 全部可选
  const o = input as Record<string, unknown>
  return (
    (o.topic === undefined || typeof o.topic === 'string') &&
    (o.instructions === undefined || typeof o.instructions === 'string')
  )
}

/** 执行项的 module 字段存在 steps_json 里（见 execution-generator） */
function getItemModule(item: ExecutionItem): string {
  const steps = item.steps_json ?? {}
  const m = (steps as Record<string, unknown>).module
  return typeof m === 'string' ? m : 'manual'
}

/**
 * seo_engine 模块：用「SEO 内容引擎」生成一篇博客草稿并落库到 blog_posts。
 * 复用 src/lib/blog/generator.ts 的 generateBlogPost — 不重新实现生成逻辑。
 */
async function generateSeoBlogForItem(
  ctx: LubanToolContext,
  topic: string,
  instructions: string | null,
): Promise<string> {
  const sourceText = instructions ? `${topic} —— ${instructions}` : topic

  const result = await generateBlogPost({
    mode:              'geo_only',
    topic,
    source_query_text: sourceText,
    client_id:         ctx.clientId,
    skip_audit:        true,   // 鲁班是 FDE 主动触发，跳过去重审计
  })

  const { data: post, error } = await ctx.supabase
    .from('blog_posts')
    .insert({
      client_id:             ctx.clientId,
      mode:                  'geo_only',
      topic:                 topic.slice(0, 400),
      source_query_text:     sourceText.slice(0, 400),
      title:                 result.title,
      meta_title:            result.meta_title,
      meta_description:      result.meta_description,
      slug:                  result.slug,
      html_body:             result.html_body,
      word_count:            result.word_count,
      geo_directive_id:      result.geo_directive_id,
      geo_html_snapshot:     result.geo_html_snapshot,
      featured_image_prompt: result.featured_image_prompt,
      cost_usd:              result.cost_usd,
      model_used:            result.model_used,
      status:                'draft',
    })
    .select('id, title, word_count')
    .single<Pick<BlogPost, 'id' | 'title' | 'word_count'>>()

  if (error || !post) {
    return `generate_content 落库失败：${error?.message ?? '未知错误'}。内容已生成但未保存，请重试。`
  }

  // 同步写一条工作日志，让执行看板能看到这次产出
  await ctx.supabase
    .from('execution_logs')
    .insert({
      execution_item_id: ctx.itemId,
      client_id:         ctx.clientId,
      author:            'luban',
      kind:              'ai_assist' satisfies ExecutionLogKind,
      content:           `用 SEO 内容引擎生成了博客草稿《${post.title}》（约 ${post.word_count} 字），已进入草稿列表待审核。`,
      meta:              { tool: 'generate_content', module: 'seo_engine', blog_post_id: post.id },
    })

  return (
    `已用「SEO 内容引擎」生成博客草稿并落库：\n` +
    `- 标题：《${post.title}》\n` +
    `- 字数：约 ${post.word_count} 字\n` +
    `- 状态：草稿（已进入 SEO 内容引擎草稿列表，等 FDE 审核）\n` +
    `在回复里把标题告诉 FDE，并说明可以去 SEO 内容引擎里查看 / 编辑这篇草稿。`
  )
}

/**
 * generate_content handler — 按执行项 module 路由到对应模块的生成能力。
 */
async function handleGenerateContent(
  ctx: LubanToolContext,
  input: unknown,
): Promise<string> {
  if (!isGenerateContentInput(input)) {
    return 'generate_content 调用失败：topic / instructions 必须是字符串。'
  }
  const topic = (input.topic ?? '').trim() || ctx.item.title.trim()
  if (!topic) {
    return 'generate_content 调用失败：缺少内容主题，且执行项没有标题。'
  }
  const instructions = (input.instructions ?? '').trim() || null

  const moduleKey = getItemModule(ctx.item)
  switch (moduleKey) {
    case 'seo_engine':
      return generateSeoBlogForItem(ctx, topic, instructions)
    default:
      return (
        `这个执行项对应的模块是「${moduleKey}」，generate_content 目前只直连「SEO 内容引擎」（module = seo_engine）。` +
        `请直接在对话里给 FDE 起草内容，并建议 FDE 到对应的工作台里落地。`
      )
  }
}

// ─── publish_to_gbp（S3.4）───────────────────────────────────────────────────

const PUBLISH_TO_GBP_TOOL: Anthropic.Tool = {
  name: 'publish_to_gbp',
  description:
    '向客户的 Google Business Profile 发布一条本地贴子（动态/优惠/活动）。' +
    '若 GBP API 写权限尚未配置，自动降级为「生成草稿 + 人工发布」模式——' +
    '降级时鲁班会把格式化草稿写进工作日志，并告知 FDE 登录 GBP 后台手动发布。' +
    '何时用：执行项要求发布或更新 GBP 贴子，FDE 让你「发到 GBP」「更新 Google 主页」时。',
  input_schema: {
    type: 'object' as const,
    properties: {
      post_text: {
        type: 'string',
        description: '贴子正文，建议 150–500 字，使用 AU/NZ 英语。',
      },
      post_type: {
        type: 'string',
        enum: ['STANDARD', 'OFFER'],
        description: 'STANDARD = 普通动态；OFFER = 优惠贴（需要标题和日期）。默认 STANDARD。',
      },
      cta_type: {
        type: 'string',
        enum: ['CALL', 'BOOK', 'SHOP', 'SIGN_UP', 'ORDER', 'LEARN_MORE'],
        description: '可选：行动按钮类型。',
      },
      cta_url: {
        type: 'string',
        description: '可选：行动按钮跳转 URL（cta_type 有值时填写）。',
      },
      location_name: {
        type: 'string',
        description:
          '可选：GBP 位置资源名称，格式 accounts/{accountId}/locations/{locationId}。' +
          '若未提供或 API 权限未申请，工具自动降级为草稿模式。',
      },
    },
    required: ['post_text'],
  },
}

function isPublishToGbpInput(input: unknown): input is GbpPostInput {
  if (typeof input !== 'object' || input === null) return false
  const o = input as Record<string, unknown>
  return typeof o.post_text === 'string' && o.post_text.trim().length > 0
}

// ─── discover_local_competitors（S3.5）──────────────────────────────────────

const DISCOVER_LOCAL_COMPETITORS_TOOL: Anthropic.Tool = {
  name: 'discover_local_competitors',
  description:
    '从 Yellow Pages AU 和 Localsearch.com.au 搜索本地同行竞品列表，获取名称、电话、地址、评分等信息。' +
    '数据通过 Jina Reader 从公开目录抓取，无需额外 API key；被反爬时优雅降级，只返回能拿到的数据。' +
    '何时用：FDE 要了解客户所在地区的竞争格局，或执行项需要竞品调研时。',
  input_schema: {
    type: 'object' as const,
    properties: {
      industry: {
        type: 'string',
        description: '行业/职业类别，英文（如 "travel agent"、"plumber"、"dentist"）。',
      },
      location: {
        type: 'string',
        description: '地点，英文（如 "Sydney NSW"、"Melbourne VIC"、"Auckland NZ"）。',
      },
      limit: {
        type: 'number',
        description: '最多返回几家，默认 8，最多 20。',
      },
    },
    required: ['industry', 'location'],
  },
}

interface DiscoverLocalCompetitorsInput {
  industry: string
  location: string
  limit?: number
}

function isDiscoverLocalCompetitorsInput(
  input: unknown,
): input is DiscoverLocalCompetitorsInput {
  if (typeof input !== 'object' || input === null) return false
  const o = input as Record<string, unknown>
  return (
    typeof o.industry === 'string' &&
    o.industry.trim().length > 0 &&
    typeof o.location === 'string' &&
    o.location.trim().length > 0 &&
    (o.limit === undefined || typeof o.limit === 'number')
  )
}

// ─── buildLubanTools ─────────────────────────────────────────────────────────

/**
 * 构建鲁班工具集 — handler 闭包捕获 ctx（supabase / itemId / clientId / item）。
 */
export function buildLubanTools(ctx: LubanToolContext): LubanToolset {
  return {
    tools: [ADD_WORK_LOG_TOOL, GENERATE_CONTENT_TOOL, PUBLISH_TO_GBP_TOOL, DISCOVER_LOCAL_COMPETITORS_TOOL],
    handlers: {
      publish_to_gbp: async (input: unknown): Promise<string> => {
        if (!isPublishToGbpInput(input)) {
          return 'publish_to_gbp 调用失败：post_text 不能为空。'
        }
        const gbpInput: GbpPostInput = {
          post_text: (input as GbpPostInput).post_text.trim(),
          post_type: (input as GbpPostInput).post_type,
          cta_type: (input as GbpPostInput).cta_type,
          cta_url: (input as GbpPostInput).cta_url,
          location_name: (input as GbpPostInput).location_name,
        }
        const result = await publishToGbp(gbpInput)

        if (result.mode === 'live') {
          const postRef = result.post_name ?? '（ID 不可用）'
          await ctx.supabase
            .from('execution_logs')
            .insert({
              execution_item_id: ctx.itemId,
              client_id:         ctx.clientId,
              author:            'luban',
              kind:              'ai_assist' satisfies ExecutionLogKind,
              content:           `GBP 贴子已成功发布：${postRef}`,
              meta:              { tool: 'publish_to_gbp', post_name: result.post_name },
            })
          return (
            `✅ GBP 贴子已实时发布。\n` +
            `- 资源名称：${postRef}\n` +
            `贴子已在 Google Business Profile 上线，请告知 FDE 可登录 GBP 后台查看。`
          )
        }

        // 草稿降级模式 — 写进工作日志供 FDE 手动发布
        const draftContent = result.draft_text ?? ''
        await ctx.supabase
          .from('execution_logs')
          .insert({
            execution_item_id: ctx.itemId,
            client_id:         ctx.clientId,
            author:            'luban',
            kind:              'ai_assist' satisfies ExecutionLogKind,
            content:           `GBP 贴子草稿（人工发布）：\n${draftContent}`,
            meta:              {
              tool: 'publish_to_gbp',
              mode: 'draft',
              degradation_reason: result.degradation_reason,
            },
          })
          .catch(err => console.error('[luban/publish_to_gbp] log write failed:', err))

        return (
          `📋 GBP 直接发布条件未满足（${result.degradation_reason ?? '权限未配置'}），` +
          `已生成草稿并写入工作日志。\n\n` +
          `${draftContent}\n\n` +
          `请告知 FDE：按上方草稿登录 business.google.com → 选择地点 → 发帖 → 新建帖子，完成发布。`
        )
      },

      add_work_log: async (input: unknown): Promise<string> => {
        if (!isAddWorkLogInput(input)) {
          return 'add_work_log 调用失败：需要 { kind: string, content: string }。'
        }
        const kind: ExecutionLogKind = ADD_WORK_LOG_KINDS.includes(input.kind as ExecutionLogKind)
          ? (input.kind as ExecutionLogKind)
          : 'note'
        const content = input.content.trim()
        if (!content) {
          return 'add_work_log 调用失败：content 不能为空。'
        }

        const { error } = await ctx.supabase
          .from('execution_logs')
          .insert({
            execution_item_id: ctx.itemId,
            client_id:         ctx.clientId,
            author:            'luban',
            kind,
            content,
            meta:              null,
          })

        if (error) {
          return `add_work_log 写入失败：${error.message}`
        }
        const preview = content.length > 40 ? `${content.slice(0, 40)}…` : content
        return `已写入工作日志（类型：${kind}）：${preview}`
      },

      generate_content: (input: unknown): Promise<string> => handleGenerateContent(ctx, input),

      discover_local_competitors: async (input: unknown): Promise<string> => {
        if (!isDiscoverLocalCompetitorsInput(input)) {
          return 'discover_local_competitors 调用失败：需要 { industry: string, location: string }。'
        }
        const { industry, location, limit = 8 } = input

        const result = await discoverLocalCompetitors(industry, location, limit)

        if (result.entries.length === 0) {
          return (
            `在 Yellow Pages AU 和 Localsearch.com.au 搜索「${industry}」（${location}）未能抓到数据` +
            `（可能被反爬拦截，或该地区无结果）。\n\n` +
            `可以手动访问以下 URL 查看：\n` +
            `- Yellow Pages AU：${buildYellowPagesUrl(industry, location)}\n` +
            `- Localsearch：${buildLocalsearchUrl(industry, location)}`
          )
        }

        const lines = result.entries.map((e, i) => {
          const rating = e.rating !== null ? ` ⭐ ${e.rating}` : ''
          const reviews = e.reviewCount !== null ? `（${e.reviewCount} 评价）` : ''
          const phone = e.phone ? ` | 📞 ${e.phone}` : ''
          const addr = e.address ? ` | 📍 ${e.address}` : ''
          const src = e.source === 'yellowpages_au' ? 'YP' : 'LS'
          return `${i + 1}. **${e.name}**${rating}${reviews}${phone}${addr} [${src}]`
        })

        void (ctx.supabase
          .from('execution_logs')
          .insert({
            execution_item_id: ctx.itemId,
            client_id:         ctx.clientId,
            author:            'luban',
            kind:              'ai_assist' satisfies ExecutionLogKind,
            content:           `竞品调研：${industry}（${location}）共 ${result.entries.length} 家`,
            meta:              {
              tool: 'discover_local_competitors',
              industry,
              location,
              count: result.entries.length,
            },
          })
          .then(
            () => undefined,
            (err: unknown) => console.error('[luban/discover_local_competitors] log write failed:', err),
          ))

        return (
          `找到 **${result.entries.length}** 家本地竞品（${industry}，${location}）：\n\n` +
          lines.join('\n') +
          `\n\n数据来源：${result.sources.map(s => s.url).join('、')}`
        )
      },
    },
  }
}
