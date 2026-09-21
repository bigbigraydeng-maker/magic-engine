// Creatomate inline source 渲染（不依赖模板 ID）。
// 与 render.ts 的 submitRender（模板 + modifications）是两种提交方式，共用同一个 creatomateFetch。
// 用于"先小样后全渲"场景：同一份 source JSON，只改 width/height，跑两遍。
import { creatomateFetch } from './client'
import type { CreatomateRender } from './types'
import { getRender } from './render'

export interface ReelTemplate {
  brandName: string
  tagline: string
  cta: string
}

export interface ReelSpec {
  tag: string
  sourceUrl: string
  serviceName: string
  durationS: number
}

export interface InlineRenderParams {
  source: Record<string, unknown>
  width: number
  height: number
  outputFormat?: 'mp4'
}

export async function submitInlineRender(params: InlineRenderParams): Promise<{ renderId: string }> {
  const body = await creatomateFetch('/renders', {
    method: 'POST',
    body: {
      output_format: params.outputFormat ?? 'mp4',
      width: params.width,
      height: params.height,
      source: params.source,
    },
  })
  const raw = Array.isArray(body) ? body[0] : body
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Creatomate 响应不是预期形状')
  }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') {
    throw new Error(`缺少 render id: ${JSON.stringify(r).slice(0, 200)}`)
  }
  return { renderId: r.id }
}

export function buildReelSource(
  reel: ReelSpec,
  template: ReelTemplate,
): Record<string, unknown> {
  return {
    duration: reel.durationS,
    elements: [
      {
        type: 'video',
        track: 1,
        source: reel.sourceUrl,
        fit: 'cover',
        trim_duration: reel.durationS,
        brightness: 0.25,
      },
      // 安全区：1080×1920 Reel 关键内容必须在 y=14%~65%（y=270~1248px）
      // 顶部死区 0~14%：状态栏+导航；底部死区 65%~100%：点赞/评论/分享栏
      // CTA 不放进画面，交给发帖 caption 处理
      {
        type: 'text',
        track: 2,
        text: template.brandName,
        x: '92%', y: '16%',
        x_anchor: '100%', y_anchor: '0%',
        font_family: 'Cormorant Garamond',
        font_size: '3.5 vmin',
        font_weight: '300',
        fill_color: 'rgba(255,220,168,0.85)',
      },
      {
        type: 'text',
        track: 3,
        text: reel.serviceName,
        x: '8%', y: '42%',
        width: '84%',
        x_anchor: '0%', y_anchor: '0%',
        font_family: 'Cormorant Garamond',
        font_size: '9 vmin',
        font_weight: '300',
        fill_color: '#FFFFFF',
      },
      {
        type: 'text',
        track: 4,
        text: template.tagline,
        x: '8%', y: '58%',
        width: '84%',
        x_anchor: '0%', y_anchor: '0%',
        font_family: 'Cormorant Garamond',
        font_size: '3.5 vmin',
        font_weight: '300',
        fill_color: 'rgba(255,255,255,0.75)',
      },
    ],
  }
}

// 轮询单条渲染直到终态或超时（最多 maxAttempts × intervalMs）
export async function pollUntilDone(
  renderId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<CreatomateRender> {
  const maxAttempts = opts.maxAttempts ?? 20
  const intervalMs = opts.intervalMs ?? 30_000
  for (let i = 0; i < maxAttempts; i++) {
    const render = await getRender(renderId)
    if (render.status === 'succeeded' || render.status === 'failed' || render.status === 'cancelled') {
      return render
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  // 超时返回最后一次查到的状态
  return getRender(renderId)
}
