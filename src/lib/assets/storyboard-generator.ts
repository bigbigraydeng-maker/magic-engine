/**
 * Phase 21.B.5+6 — Theme-based Asset Selection + Storyboard Generator
 *
 * selectAssetsForTheme(): pure score-based selection — no extra AI call,
 *   picks best Hook / Middle(×2) / CTA from analyzed client_assets.
 *
 * generateStoryboard(): Claude Sonnet generates scene descriptions +
 *   Seedance / Kling / Runway prompts, injecting Brand Brief + NZ/AU signals.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getClientLocale, formatLocaleForPrompt } from '@/lib/locale/client-locale'
import type { VisionMetadata } from './vision-analyzer'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalyzedAsset {
  id: string
  storage_url: string
  original_filename: string | null
  hook_score: number
  middle_score: number
  cta_score: number
  recommended_use: string | null
  vision_metadata: VisionMetadata
}

export interface AssetSelection {
  hook: AnalyzedAsset
  middle: AnalyzedAsset[]    // 1–2 images
  cta: AnalyzedAsset
}

export interface StoryboardScene {
  scene: number
  role: 'hook' | 'middle' | 'cta'
  asset_id: string
  description: string
}

export interface StoryboardResult {
  scenes: StoryboardScene[]
  market_context: string
  brand_voice: string
  seedance_prompt: string
  kling_prompt: string
  runway_prompt: string
}

// ─── P21.B.5 — Selection ──────────────────────────────────────────────────────

export async function selectAssetsForTheme(
  clientId: string,
  options?: {
    hook_asset_id?: string
    middle_asset_ids?: string[]
    cta_asset_id?: string
  }
): Promise<AssetSelection> {
  const { data: assets, error } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url, original_filename, hook_score, middle_score, cta_score, recommended_use, vision_metadata')
    .eq('client_id', clientId)
    .eq('status', 'analyzed')
    // 视频入库时被标成 analyzed(为了让 vision-analyzer 跳过,它只认图片),但分数恒为 0、
    // vision_metadata 里也没有 scene/objects。不排掉的话选片会把 mp4 当合格图片选进分镜,
    // 拿着视频 URL 和空描述去生成提示词。
    .not('vision_metadata->>kind', 'eq', 'video')
    .is('archived_at', null)

  if (error) throw new Error(`Failed to load assets: ${error.message}`)
  if (!assets || assets.length === 0) {
    throw new Error('No analyzed assets found. Please upload images and wait for Vision analysis to complete.')
  }

  const all = assets as AnalyzedAsset[]

  // If caller supplied manual IDs, use them; otherwise auto-select by score
  const findById = (id: string): AnalyzedAsset => {
    const found = all.find(a => a.id === id)
    if (!found) throw new Error(`Asset ${id} not found or not analyzed`)
    return found
  }

  const hook = options?.hook_asset_id
    ? findById(options.hook_asset_id)
    : [...all].sort((a, b) => b.hook_score - a.hook_score)[0]

  const cta = options?.cta_asset_id
    ? findById(options.cta_asset_id)
    : [...all].sort((a, b) => b.cta_score - a.cta_score)[0]

  const middle: AnalyzedAsset[] = options?.middle_asset_ids?.length
    ? options.middle_asset_ids.map(findById)
    : [...all]
        .sort((a, b) => b.middle_score - a.middle_score)
        .filter(a => a.id !== hook.id && a.id !== cta.id)
        .slice(0, 2)

  // Guarantee at least 1 middle frame
  if (middle.length === 0) {
    const fallback = all.find(a => a.id !== hook.id && a.id !== cta.id) ?? hook
    middle.push(fallback)
  }

  return { hook, middle, cta }
}

// ─── P21.B.6 — Storyboard generation ─────────────────────────────────────────

function describeAsset(a: AnalyzedAsset): string {
  const vm = a.vision_metadata
  const parts = [
    vm.scene ? `scene: ${vm.scene}` : null,
    vm.emotion ? `mood: ${vm.emotion}` : null,
    vm.objects?.length ? `contains: ${vm.objects.slice(0, 3).join(', ')}` : null,
    vm.has_people ? 'people visible' : null,
    vm.ai_notes ? `note: ${vm.ai_notes}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

const STORYBOARD_SYSTEM = `You are a video production strategist for Australian and New Zealand businesses.
Given a campaign theme, brand brief, and selected images (described by their Vision AI metadata),
generate a complete video storyboard with production-ready prompts.

Return ONLY valid JSON — no markdown, no code fences.
Required shape:
{
  "scenes": [
    { "scene": 1, "role": "hook",   "asset_id": "<uuid>", "description": "<1 sentence: what happens in this scene, camera movement, mood>" },
    { "scene": 2, "role": "middle", "asset_id": "<uuid>", "description": "..." },
    { "scene": 3, "role": "middle", "asset_id": "<uuid>", "description": "..." },
    { "scene": 4, "role": "cta",    "asset_id": "<uuid>", "description": "..." }
  ],
  "market_context": "<NZ/AU audience targeting, location, demographics>",
  "brand_voice": "<2-3 words summarising the brand's visual and copy tone>",
  "seedance_prompt": "<Seedance Image2Video prompt: Opening: … | Middle: … | Closing: …>",
  "kling_prompt": "<Kling AI prompt: describe motion style, camera movement, atmosphere>",
  "runway_prompt": "<Runway Gen-3 prompt: cinematic style, camera, lighting, motion>"
}

Rules:
- AU/NZ English spelling (colour, realise, etc.)
- Inject the brand's market context and audience signals into every prompt
- Seedance prompt must follow the Opening/Middle/Closing pipe-separated format
- Keep scene descriptions under 25 words each
- Prompts should be cinematic, specific, and ready to paste into the video engine`

export async function generateStoryboard(params: {
  clientId: string
  theme: string
  selection: AssetSelection
}): Promise<StoryboardResult> {
  const { clientId, theme, selection } = params

  const [brief, locale] = await Promise.all([
    getActiveBrief(clientId),
    getClientLocale(clientId).catch(() => null),
  ])
  const briefText = brief
    ? formatBriefForPrompt(brief)
    : '(No brand brief available — use general professional AU/NZ business tone)'
  const localeText = locale
    ? formatLocaleForPrompt(locale)
    : 'Market: Australia · Season: current · AU/NZ English spelling'

  const { hook, middle, cta } = selection

  const allSceneAssets = [
    { role: 'HOOK (opening frame)', asset: hook },
    ...middle.map((a, i) => ({ role: `MIDDLE ${i + 1} (story scene)`, asset: a })),
    { role: 'CTA (closing frame)', asset: cta },
  ]

  const assetDescriptions = allSceneAssets
    .map(({ role, asset }) => `[${role}] id=${asset.id}\n  ${describeAsset(asset)}`)
    .join('\n')

  const userMessage = `## Campaign Theme
${theme}

## Brand Brief
${briefText}

## Market & Locale Context
${localeText}

## Selected Images (in order)
${assetDescriptions}

Generate the storyboard JSON now. Use the exact asset UUIDs shown above in the "asset_id" fields.
Include all middle assets as separate scenes.`

  const result = await callClaudeWithDocs({
    systemPrompt: STORYBOARD_SYSTEM,
    userMessage,
    maxOutputTokens: 1500,
  })

  // Parse with balanced-brace extraction (same pattern as reels/generator.ts)
  const text = result.text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  let start = -1, depth = 0, inStr = false, esc = false, end = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\' && inStr) { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') { if (start === -1) start = i; depth++ }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) { end = i; break } }
  }
  if (start === -1 || end === -1) {
    throw new Error(`Storyboard JSON not found in Claude response: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text.slice(start, end + 1)) as StoryboardResult
}
