/**
 * 鲁班 Lǔ Bān — 工具层（P8.12.S3.1 / S3.2）
 *
 * buildLubanTools(ctx) 返回 Anthropic 工具定义 + handler 映射，注入 callClaudeWithTools。
 *
 * 工具清单：
 *   - add_work_log      鲁班自主把对话结论写进 execution_logs（S3.1）
 *   - generate_content  根据执行项的 module 字段调用对应模块的内容生成能力，
 *                       直接产出内容并落库（S3.2）——目前直连「SEO 内容引擎」。
 *
 * 后续 connector/skill（check_local_compliance 等）在此扩展。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { ExecutionItem, ExecutionLogKind } from '@/types/diagnostic'
import type { BlogPost } from '@/types/magic-engine'
import { generateBlogPost } from '@/lib/blog/generator'

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

// ─── buildLubanTools ─────────────────────────────────────────────────────────

/**
 * 构建鲁班工具集 — handler 闭包捕获 ctx（supabase / itemId / clientId / item）。
 */
export function buildLubanTools(ctx: LubanToolContext): LubanToolset {
  return {
    tools: [ADD_WORK_LOG_TOOL, GENERATE_CONTENT_TOOL],
    handlers: {
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
    },
  }
}
