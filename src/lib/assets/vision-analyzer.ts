/**
 * Phase 21.B.3 — Vision Analysis Engine
 *
 * Analyses a single client asset image via GPT-4o-mini Vision,
 * returns structured VisionMetadata + Hook/Middle/CTA scores.
 *
 * Uses gpt-4o-mini (vision-capable, ~8x cheaper than gpt-4o).
 * Routed via Cloudflare AI Gateway (OPENAI_BASE_URL env var picked up by SDK).
 */

import OpenAI from 'openai'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisionMetadata {
  objects: string[]
  scene: string
  emotion: string
  has_people: boolean
  is_indoor: boolean
  brand_elements: string[]
  quality_score: number
  ai_notes: string
}

export interface AssetScores {
  hook_score: number
  middle_score: number
  cta_score: number
  recommended_use: 'hook' | 'middle' | 'cta' | 'skip'
}

// ─── Vision prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a video production specialist analysing business photos for Australian and New Zealand marketing clients.
Analyse the image and return ONLY a valid JSON object — no markdown, no explanation.

Required JSON shape:
{
  "objects": string[],        // main visible subjects or objects (max 5 items)
  "scene": string,            // one of: interior | exterior | product | warehouse | team | aerial | event | retail | food | landscape | other
  "emotion": string,          // single word that best describes the image mood: premium | warm | energetic | professional | authentic | dramatic | clean | vibrant | industrial | cosy | other
  "has_people": boolean,
  "is_indoor": boolean,
  "brand_elements": string[], // any visible logos, brand colours, signage, uniforms (empty array if none)
  "quality_score": number,    // 0–10 for overall visual quality: lighting, sharpness, composition
  "ai_notes": string          // one sentence: what makes this image useful or special for video production
}`

// ─── Vision analysis ──────────────────────────────────────────────────────────

export async function analyseImage(imageUrl: string): Promise<VisionMetadata> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl, detail: 'low' },
          },
          {
            type: 'text',
            text: 'Analyse this image for video production use.',
          },
        ],
      },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(raw) as Partial<VisionMetadata>

  return {
    objects: Array.isArray(parsed.objects) ? parsed.objects.slice(0, 5) : [],
    scene: typeof parsed.scene === 'string' ? parsed.scene : 'other',
    emotion: typeof parsed.emotion === 'string' ? parsed.emotion : 'other',
    has_people: Boolean(parsed.has_people),
    is_indoor: Boolean(parsed.is_indoor),
    brand_elements: Array.isArray(parsed.brand_elements) ? parsed.brand_elements : [],
    quality_score: typeof parsed.quality_score === 'number'
      ? Math.min(10, Math.max(0, parsed.quality_score))
      : 5,
    ai_notes: typeof parsed.ai_notes === 'string' ? parsed.ai_notes : '',
  }
}

// ─── Score computation (pure, no AI) ─────────────────────────────────────────

const HIGH_EMOTION_WORDS = ['energetic', 'dramatic', 'vibrant', 'bold', 'exciting']
const STORY_EMOTION_WORDS = ['warm', 'authentic', 'cosy', 'friendly', 'natural']
const CLEAN_EMOTION_WORDS = ['clean', 'premium', 'professional', 'minimal', 'elegant']
const OUTDOOR_SCENES    = ['exterior', 'aerial', 'landscape', 'event']
const STORY_SCENES      = ['warehouse', 'team', 'interior', 'food', 'other']
const PRODUCT_SCENES    = ['product', 'retail']

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function computeScores(vm: VisionMetadata): AssetScores {
  const q          = vm.quality_score        // 0–10
  const emotion    = vm.emotion.toLowerCase()
  const scene      = vm.scene.toLowerCase()
  const hasPeople  = vm.has_people
  const isIndoor   = vm.is_indoor
  const hasBrand   = vm.brand_elements.length > 0
  const objCount   = vm.objects.length

  // ── Hook (opening frame): visual impact, outdoor/action, human connection
  let hook = (q / 10) * 4                                          // 0–4  quality
  if (HIGH_EMOTION_WORDS.includes(emotion))     hook += 2
  if (OUTDOOR_SCENES.includes(scene))           hook += 1.5
  if (hasPeople)                                hook += 1.5
  if (!isIndoor)                                hook += 0.5
  if (!hasBrand)                                hook += 0.5        // hooks don't want hard sells

  // ── Middle (story/process): complexity, team, authenticity
  let middle = (q / 10) * 3                                        // 0–3
  if (objCount >= 3)                            middle += 2
  if (STORY_SCENES.includes(scene))             middle += 2
  if (STORY_EMOTION_WORDS.includes(emotion))    middle += 1.5
  if (hasPeople && isIndoor)                    middle += 1.5

  // ── CTA (closing frame): brand presence, clean product, professional
  let cta = (q / 10) * 3                                           // 0–3
  if (hasBrand)                                 cta += 3.5
  if (PRODUCT_SCENES.includes(scene))           cta += 2
  if (CLEAN_EMOTION_WORDS.includes(emotion))    cta += 1.5
  if (isIndoor)                                 cta += 0.5

  hook   = round1(Math.min(10, hook))
  middle = round1(Math.min(10, middle))
  cta    = round1(Math.min(10, cta))

  const maxScore = Math.max(hook, middle, cta)
  let recommended_use: AssetScores['recommended_use'] = 'skip'
  if (maxScore >= 5) {
    if (hook === maxScore)   recommended_use = 'hook'
    else if (middle === maxScore) recommended_use = 'middle'
    else                     recommended_use = 'cta'
  }

  return { hook_score: hook, middle_score: middle, cta_score: cta, recommended_use }
}
