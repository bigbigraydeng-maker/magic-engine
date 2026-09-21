// Creatomate inline source 渲染（不依赖模板 ID）。
// 与 render.ts 的 submitRender（模板 + modifications）是两种提交方式，共用同一个 creatomateFetch。
// 用于"先小样后全渲"场景：同一份 source JSON，只改 width/height，跑两遍。
import { creatomateFetch } from './client'
import type { CreatomateRender } from './types'
import { getRender } from './render'

export interface ReelEndingScreen {
  address: string
  hours: string
  phone: string
  logoUrl?: string  // public URL to brand logo; upload to client_assets first
}

export interface ReelTemplate {
  brandName: string
  tagline: string
  cta: string
  endingScreen?: ReelEndingScreen
  musicUrl?: string  // optional background music; must be a public URL (mp3/m4a)
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

const CLIP_DURATION_S = 12   // max clip length; ≤15 s total with ending
const ENDING_DURATION_S = 3
const HOOK_S = 4             // scene 1: 0–4 s
const MIDDLE_S = 5           // scene 2: 4–9 s
const CTA_CLIP_S = 3         // scene 3: 9–12 s (HOOK_S + MIDDLE_S + CTA_CLIP_S = 12)
const FADE_S = 0.4           // cross-scene video fade duration

export function buildReelSource(
  reel: ReelSpec,
  template: ReelTemplate,
): Record<string, unknown> {
  const hasEnding = !!template.endingScreen
  // Cap clip at CLIP_DURATION_S; source must be at least this long
  const clipDuration = Math.min(reel.durationS, CLIP_DURATION_S)
  const totalDuration = hasEnding ? clipDuration + ENDING_DURATION_S : clipDuration
  const ending = template.endingScreen

  const MIDDLE_START = HOOK_S            // 4
  const CTA_START = HOOK_S + MIDDLE_S    // 9

  // 安全区：1080×1920 Reel 关键内容必须在 y=14%~65%（y=270~1248px）
  // Animation time values are RELATIVE to each element's own start (not absolute timeline).
  // e.g. CTA video starts at time:9 — its fade-out uses time:1.5 (= 1.5s after element start),
  //      NOT time:10.5 (absolute), which would never fire within the 3s clip duration.
  const mainElements: Record<string, unknown>[] = [
    // Black base layer — full duration, so fade-outs reveal black not white
    {
      type: 'shape',
      shape: 'rectangle',
      track: 0,
      time: 0,
      duration: totalDuration,
      x: '50%', y: '50%',
      x_anchor: '50%', y_anchor: '50%',
      width: '100%', height: '100%',
      fill_color: '#000000',
    },
    // Scene 1 — Hook (0–4 s): fade out last 0.4s (relative: 3.6)
    {
      type: 'video',
      track: 1,
      time: 0,
      duration: HOOK_S,
      source: reel.sourceUrl,
      trim_start: 0,
      trim_duration: HOOK_S,
      fit: 'cover',
      brightness: 0.3,
      animations: [
        { time: HOOK_S - FADE_S, duration: FADE_S, type: 'fade', fade: false, easing: 'quadratic-in' },
      ],
    },
    // Scene 2 — Middle (4–9 s): fade in first 0.4s (relative: 0), fade out last 0.4s (relative: 4.6)
    {
      type: 'video',
      track: 2,
      time: MIDDLE_START,
      duration: MIDDLE_S,
      source: reel.sourceUrl,
      trim_start: MIDDLE_START,
      trim_duration: MIDDLE_S,
      fit: 'cover',
      brightness: 0.2,
      animations: [
        { time: 0, duration: FADE_S, type: 'fade', easing: 'quadratic-out' },
        { time: MIDDLE_S - FADE_S, duration: FADE_S, type: 'fade', fade: false, easing: 'quadratic-in' },
      ],
    },
    // Scene 3 — CTA (9–12 s): fade in (relative: 0), audio+visual fade out last 1.5s (relative: 1.5)
    {
      type: 'video',
      track: 3,
      time: CTA_START,
      duration: CTA_CLIP_S,
      source: reel.sourceUrl,
      trim_start: CTA_START,
      trim_duration: CTA_CLIP_S,
      fit: 'cover',
      brightness: 0.3,
      audio_fade_out: 1.5,
      animations: [
        { time: 0, duration: FADE_S, type: 'fade', easing: 'quadratic-out' },
        { time: CTA_CLIP_S - 1.5, duration: 1.5, type: 'fade', fade: false, easing: 'quadratic-in' },
      ],
    },
    // Brand name — persistent across all scenes
    {
      type: 'text',
      track: 4,
      time: 0,
      duration: clipDuration,
      text: template.brandName,
      x: '92%', y: '16%',
      x_anchor: '100%', y_anchor: '0%',
      font_family: 'Cormorant Garamond',
      font_size: '3.5 vmin',
      font_weight: '300',
      fill_color: 'rgba(255,220,168,0.85)',
      shadow_color: 'rgba(0,0,0,0.5)',
      shadow_blur: 6,
    },
    // Hook text (0–4 s): slide up from element start (relative: 0)
    {
      type: 'text',
      track: 5,
      time: 0,
      duration: HOOK_S,
      text: reel.serviceName,
      x: '8%', y: '38%',
      width: '84%',
      x_anchor: '0%', y_anchor: '0%',
      font_family: 'Cormorant Garamond',
      font_size: '11 vmin',
      font_weight: '300',
      fill_color: '#FFFFFF',
      shadow_color: 'rgba(0,0,0,0.7)',
      shadow_blur: 8,
      animations: [
        { time: 0, duration: 0.5, type: 'slide', direction: 'up', easing: 'cubic-out' },
      ],
    },
    // Middle text (4–9 s): fade in from element start (relative: 0)
    {
      type: 'text',
      track: 6,
      time: MIDDLE_START,
      duration: MIDDLE_S,
      text: template.tagline,
      x: '8%', y: '42%',
      width: '84%',
      x_anchor: '0%', y_anchor: '0%',
      font_family: 'Cormorant Garamond',
      font_size: '4.5 vmin',
      font_weight: '300',
      fill_color: 'rgba(255,255,255,0.9)',
      shadow_color: 'rgba(0,0,0,0.6)',
      shadow_blur: 6,
      animations: [
        { time: 0, duration: 0.5, type: 'fade', easing: 'quadratic-out' },
      ],
    },
    // CTA text (9–12 s): slide up from element start (relative: 0)
    {
      type: 'text',
      track: 7,
      time: CTA_START,
      duration: CTA_CLIP_S,
      text: template.cta,
      x: '50%', y: '42%',
      width: '84%',
      x_anchor: '50%', y_anchor: '0%',
      font_family: 'Cormorant Garamond',
      font_size: '8 vmin',
      font_weight: '300',
      fill_color: '#FFFFFF',
      text_align: 'center',
      shadow_color: 'rgba(0,0,0,0.7)',
      shadow_blur: 8,
      animations: [
        { time: 0, duration: 0.5, type: 'slide', direction: 'up', easing: 'cubic-out' },
      ],
    },
  ]

  // Optional background music — loops for full clip duration, fades in/out
  if (template.musicUrl) {
    mainElements.push({
      type: 'audio',
      track: 20,
      time: 0,
      duration: totalDuration,
      source: template.musicUrl,
      volume: '30%',
      loop: true,
      audio_fade_in: 1,
      audio_fade_out: 1.5,
    })
  }

  if (!hasEnding || !ending) {
    return { output_format: 'mp4', duration: totalDuration, elements: mainElements }
  }

  // Ending screen: dark background + brand name + contact info
  // All elements confined to y=14%~65% safe zone, starting at clipDuration
  // animations use relative time (0 = element start = clipDuration on the timeline)
  const endingElements: Record<string, unknown>[] = [
    {
      type: 'shape',
      shape: 'rectangle',
      track: 8,
      time: clipDuration,
      duration: ENDING_DURATION_S,
      x: '50%', y: '50%',
      x_anchor: '50%', y_anchor: '50%',
      width: '100%', height: '100%',
      fill_color: '#1A1614',
      animations: [
        { time: 0, duration: 0.8, type: 'fade', easing: 'quadratic-out' },
      ],
    },
    ...(ending.logoUrl
      ? [{
          type: 'image',
          track: 9,
          time: clipDuration,
          duration: ENDING_DURATION_S,
          source: ending.logoUrl,
          x: '50%', y: '20%',
          x_anchor: '50%', y_anchor: '50%',
          width: '40%',
          fit: 'contain',
        }]
      : []),
    {
      type: 'text',
      track: ending.logoUrl ? 10 : 9,
      time: clipDuration,
      duration: ENDING_DURATION_S,
      text: template.brandName,
      x: '50%', y: ending.logoUrl ? '32%' : '22%',
      x_anchor: '50%', y_anchor: '50%',
      width: '84%',
      font_family: 'Cormorant Garamond',
      font_size: '7 vmin',
      font_weight: '300',
      fill_color: '#C8A97E',
      text_align: 'center',
    },
    {
      type: 'text',
      track: ending.logoUrl ? 11 : 10,
      time: clipDuration,
      duration: ENDING_DURATION_S,
      text: template.tagline,
      x: '50%', y: ending.logoUrl ? '40%' : '31%',
      x_anchor: '50%', y_anchor: '50%',
      width: '84%',
      font_family: 'Cormorant Garamond',
      font_size: '3 vmin',
      font_weight: '300',
      fill_color: 'rgba(255,255,255,0.6)',
      text_align: 'center',
    },
    {
      type: 'shape',
      shape: 'rectangle',
      track: ending.logoUrl ? 12 : 11,
      time: clipDuration,
      duration: ENDING_DURATION_S,
      x: '50%', y: ending.logoUrl ? '46%' : '37%',
      x_anchor: '50%', y_anchor: '50%',
      width: '60%', height: '0.5%',
      fill_color: 'rgba(200,169,126,0.4)',
    },
    // Contact info — font size increased from 2.8 vmin to 5 vmin for legibility
    {
      type: 'text',
      track: ending.logoUrl ? 13 : 12,
      time: clipDuration,
      duration: ENDING_DURATION_S,
      text: `${ending.address}\n${ending.hours}  ·  ${ending.phone}`,
      x: '50%', y: ending.logoUrl ? '52%' : '44%',
      x_anchor: '50%', y_anchor: '0%',
      width: '80%',
      font_family: 'Cormorant Garamond',
      font_size: '5 vmin',
      font_weight: '300',
      fill_color: 'rgba(255,255,255,0.8)',
      text_align: 'center',
      line_height: '160%',
    },
  ]

  return {
    output_format: 'mp4',
    duration: totalDuration,
    elements: [...mainElements, ...endingElements],
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
