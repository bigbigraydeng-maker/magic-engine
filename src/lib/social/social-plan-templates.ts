/**
 * Facebook Social Plan — Phase A
 * TypeScript interfaces, prompt builders, and content generators.
 *
 * generateChannelStrategy → Anthropic Claude Sonnet  (strategy reasoning)
 * generateReelsScripts / generatePosts / generateStories → OpenAI GPT-4o-mini
 *
 * All SDK clients are initialised inside functions — never at module top-level.
 */

import OpenAI from 'openai'
import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChannelStrategy {
  platform: string
  theme: string
  content_pillars: string[]
  posting_frequency: string
  tone_guidance: string
  campaign_focus: string
  content_mix: {
    reels_pct: number
    posts_pct: number
    stories_pct: number
  }
}

/** Content angle — drives visual style and messaging for each Reel. */
export type AngleTag =
  | 'price_attack'
  | 'speed_attack'
  | 'trust_attack'
  | 'pet_floor'
  | 'scarcity'
  | 'seasonal'

/**
 * One Facebook Reel script — 9-panel storyboard format.
 *
 * Production flow:
 *   1. FDE copies storyboard_image_prompt → ChatGPT Image → generates 9-panel storyboard image
 *   2. FDE uploads storyboard image + copies seedance_i2v_prompt → Seedance 2.0 → 15-second Reel video
 *
 * scene_names:    8 short titles for Panels 1–8 (AI generated)
 * scene_structure: exactly 9 strings (Panels 1–8 + Brand Panel) (AI generated)
 * style_guide:    visual direction for the whole piece (AI generated)
 * storyboard_image_prompt: assembled programmatically by buildStoryboardImagePrompt()
 * seedance_i2v_prompt: complete Seedance I2V prompt (200–350 words, 8 sections)
 */
export interface ReelsScript {
  title: string
  hook_line: string
  scene_names: string[]
  scene_structure: string[]
  style_guide: {
    overall_look: string
    color_grade: string
    lighting: string
    atmosphere: string
  }
  storyboard_image_prompt: string
  seedance_i2v_prompt: string
  caption: string
  hashtags: string[]
  angle_tag: AngleTag
}

/** Shape returned by the AI — storyboard_image_prompt is assembled programmatically after. */
type ReelsScriptRaw = Omit<ReelsScript, 'storyboard_image_prompt'>

// ─── Storyboard prompt builder ─────────────────────────────────────────────────

interface StoryboardBuilderParams {
  brandName: string
  campaignTitle: string
  sceneNames: string[]
  sceneStructure: string[]
  styleGuide: {
    overall_look: string
    color_grade: string
    lighting: string
    atmosphere: string
  }
}

/**
 * Programmatically assembles the complete ChatGPT Image prompt for the 9-panel storyboard.
 * Deterministic — no AI involved. Matches storyboard skill v2 document structure.
 */
export function buildStoryboardImagePrompt(p: StoryboardBuilderParams): string {
  function expandScene(raw: string): string {
    return raw.split(' | ').map(part => part.trim()).join('\n')
  }

  const sceneSections = p.sceneNames.map((name, i) => {
    const raw = p.sceneStructure[i] ?? ''
    return `SCENE ${i + 1} — "${name}"\n${expandScene(raw)}`
  }).join('\n\n')

  const brandPanel = `PANEL 9 — BRAND LOGO PANEL (bottom-right, final panel — always fixed)\n${p.sceneStructure[8] ?? ''}`

  return `Create a professional video production storyboard document as a single image.
This is for ${p.brandName}'s "${p.campaignTitle}" social media Reels (15 seconds).

DOCUMENT LAYOUT:
- Portrait (tall) format document, dark charcoal background (#1a1a1a), white and gold typography
- Title bar at top: "${p.brandName.toUpperCase()} | ${p.campaignTitle} | 15s Reels Storyboard"
- 9 panels in a 3x3 grid
- Each panel thumbnail must be in 9:16 VERTICAL portrait orientation — tall, not wide
- Style guide bar at the very bottom

${sceneSections}

${brandPanel}

BOTTOM STYLE GUIDE BAR (spans full width):
OVERALL LOOK: ${p.styleGuide.overall_look}
COLOR GRADE: ${p.styleGuide.color_grade}
LIGHTING: ${p.styleGuide.lighting}
ATMOSPHERE: ${p.styleGuide.atmosphere}

RENDERING REQUIREMENTS:
- All text annotations in English only — no Chinese characters anywhere
- Each thumbnail must be 9:16 vertical portrait orientation within its panel cell
- No real human faces visible in any thumbnail
- Photorealistic quality in every thumbnail
- Thin gold divider lines between all panels
- Document should look like a professional film production storyboard
- Total document image: portrait (tall) format, high resolution`.trim()
}

export type PostType = 'educational' | 'promotional' | 'storytelling' | 'engagement'

export interface Post {
  content_type: PostType
  copy: string
  image_prompt: string
  hashtags: string[]
}

export interface Story {
  copy: string
  cta: string
  visual_prompt: string
}

export interface SocialPlanOutput {
  strategy: ChannelStrategy
  reels: ReelsScript[]
  posts: Post[]
  stories: Story[]
}

// ─── JSON parse helpers ────────────────────────────────────────────────────────

/**
 * Parse JSON from an OpenAI response — strips code fences, finds the first
 * complete [ ] or { } block, then JSON.parses it.
 */
function parseOpenAIJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  const bracket = stripped.indexOf('[')
  const brace = stripped.indexOf('{')

  let start: number
  let endChar: string

  if (bracket === -1 && brace === -1) {
    throw new Error(`No JSON found in OpenAI response: ${raw.slice(0, 200)}`)
  } else if (bracket === -1) {
    start = brace; endChar = '}'
  } else if (brace === -1) {
    start = bracket; endChar = ']'
  } else {
    if (bracket < brace) { start = bracket; endChar = ']' }
    else { start = brace; endChar = '}' }
  }

  const end = stripped.lastIndexOf(endChar)
  if (end <= start) {
    throw new Error(`Malformed JSON in OpenAI response: ${raw.slice(0, 200)}`)
  }

  return JSON.parse(stripped.slice(start, end + 1)) as T
}

// ─── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_STRATEGY = `You are a senior social media strategist specialising in AU/NZ markets.
Analyse the brand brief and produce a Facebook channel strategy as a single JSON object.
Return ONLY raw JSON — no markdown, no code fences, no explanation.`

const SYSTEM_REELS = `You are a senior Facebook Reels director and storyboard artist for AU/NZ brands.
Produce 3 Reels scripts as a JSON array. Each targets a 15-second Facebook Reel.

Each JSON object MUST have ALL of these keys (no omissions):

1. title: string — short descriptive concept title (max 8 words)

2. hook_line: string — opening hook for first 1.5 seconds (max 15 words).
   MUST start with a number OR create immediate curiosity/surprise.
   Examples: "7 signs your lawn needs help now", "Most homeowners never know this trick…"

3. scene_names: string[] — EXACTLY 8 strings. Short evocative title for each of the 8 story panels.
   Examples: ["The Problem Revealed", "Moment of Doubt", "Discovery", "The Solution", "Transformation", "Social Proof", "The Result", "The Invitation"]
   All English. No Chinese.

4. scene_structure: string[] — EXACTLY 9 strings.
   Panels 1–8: "Thumbnail: 9:16 vertical — [vivid environment, NO human faces] | STORY: [overlay text] | CAMERA: [camera action] | MOOD: [emotional tone]"
   Panel 9: "BRAND PANEL: [hex color] background. [Brand name] in large serif. [Benefit anchor 1]. [Benefit anchor 2]. No faces."
   All English. No Chinese. No human faces or bodies anywhere.

5. style_guide: object with exactly these 4 keys:
   {
     "overall_look": "<2–3 sentences on the complete visual aesthetic — colour palette, textures, composition style>",
     "color_grade": "<specific LUT or grade: e.g. 'warm golden hour, desaturated shadows, cream highlights'>",
     "lighting": "<quality and direction: e.g. 'soft natural window light from camera-left, warm diffused'>",
     "atmosphere": "<emotional tone of the visual world: e.g. 'aspirational calm, quiet luxury, energetic optimism'>"
   }

6. seedance_i2v_prompt: string — A COMPLETE Seedance 2.0 Image-to-Video prompt (200–350 words).
   Used AFTER the storyboard image is generated to animate it into a 15-second video.
   MUST include all 8 sections with these exact labels:
   OVERALL NARRATIVE ARC: [2–3 sentences on the emotional journey from panel 1 to panel 9.]
   PACING AND TIMING: [Precise timing: "0–2s: ... 2–4s: ... 4–7s: ... 7–10s: ... 10–12s: ... 12–15s: ..." Total = 15s.]
   CAMERA MOVEMENT STYLE: [Specific moves per scene: "Scene 1: slow push-in. Scene 2: gentle pan right." etc.]
   COLOR GRADE: [Overall color treatment and LUT style.]
   LIGHTING: [Quality and direction of light across the video.]
   TRANSITIONS: [How scenes cut or flow: dissolves, hard cuts, zoom transitions, etc.]
   BRAND PANEL: Hold final brand panel for 3 seconds. [Describe brand panel appearance.]
   TECHNICAL REQUIREMENTS: 9:16 vertical. 15 seconds total. Facebook Reels silent autoplay optimised. No human faces. English only.

7. caption: string — Facebook Reels caption. AU/NZ English. 2–3 short paragraphs. Clear CTA. 5–8 hashtags at end.

8. hashtags: string[] — standalone array of 5–8 hashtags.

9. angle_tag: one of "price_attack"|"speed_attack"|"trust_attack"|"pet_floor"|"scarcity"|"seasonal"
   Choose 3 different angle_tags across the 3 reels.

CRITICAL RULES:
- All text fields in English only — zero Chinese characters
- scene_names MUST be EXACTLY 8 strings
- scene_structure MUST be EXACTLY 9 strings
- seedance_i2v_prompt MUST be 200–350 words with all 8 labelled sections
- No human faces or bodies in any visual description
Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`

const SYSTEM_POSTS = `You are a Facebook copywriter for AU/NZ brands.
Produce 5 Facebook posts as a JSON array. Each post object must have:
  content_type: "educational"|"promotional"|"storytelling"|"engagement"
  copy: Facebook post copy (AU/NZ English, 80–300 words, include a clear CTA)
  image_prompt: detailed AI image-generation prompt (9:16 vertical, no human faces, vivid, cinematic)
  hashtags: array of 5–8 relevant hashtags
Return ONLY a raw JSON array — no markdown, no code fences.`

const SYSTEM_STORIES = `You are a Facebook Stories copywriter for AU/NZ brands.
Produce 3 Stories as a JSON array. Each story object must have:
  copy: short punchy overlay text (≤30 words, AU/NZ English)
  cta: swipe-up or tap call-to-action text (≤10 words)
  visual_prompt: AI image-generation prompt (9:16 portrait, no human faces, vivid)
Return ONLY a raw JSON array — no markdown, no code fences.`

// ─── Prompt builders ───────────────────────────────────────────────────────────

export function buildChannelStrategyPrompt(briefText: string, campaignText?: string): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

Produce a Facebook channel strategy JSON object with exactly these keys:
{
  "platform": "facebook",
  "theme": "<one-sentence content theme for this period>",
  "content_pillars": ["<pillar 1>", "<pillar 2>", "<pillar 3>"],
  "posting_frequency": "<e.g. 5 posts/week + 3 stories + 2 reels>",
  "tone_guidance": "<2–3 sentences on voice and tone for this brand on Facebook>",
  "campaign_focus": "<what this period's content should emphasise>",
  "content_mix": {
    "reels_pct": <number 0-100>,
    "posts_pct": <number 0-100>,
    "stories_pct": <number 0-100>
  }
}`
}

export function buildReelsPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  viralInsightsText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  const viral = viralInsightsText ? `\n\n${viralInsightsText}` : ''
  return `## Brand Brief
${briefText}${campaign}${viral}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Generate 3 Facebook Reels scripts with ALL required fields.

IMPORTANT:
- scene_names: exactly 8 short evocative titles for Panels 1–8 (Panel 9 is always the brand panel).
- scene_structure MUST be exactly 9 strings; index 8 MUST be the brand panel.
- style_guide: fill all 4 keys with specific, concrete visual direction (not generic).
- seedance_i2v_prompt: write exactly 200–350 words covering all 8 required sections (OVERALL NARRATIVE ARC, PACING AND TIMING, CAMERA MOVEMENT STYLE, COLOR GRADE, LIGHTING, TRANSITIONS, BRAND PANEL, TECHNICAL REQUIREMENTS).
- Choose 3 distinct angle_tags across the 3 reels.`
}

export function buildPostPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 5 Facebook posts covering a variety of content types (educational, promotional, storytelling, engagement).
Each post must have copy (AU/NZ English, 80–300 words, with a clear CTA), image_prompt (9:16 vertical, no faces), and 5–8 hashtags.

Return a JSON array of 5 Post objects.`
}

export function buildStoryPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 3 Facebook Stories. Each must have copy (≤30 words, AU/NZ English), cta (≤10 words), and visual_prompt (9:16 portrait, no faces).

Return a JSON array of 3 Story objects.`
}

// ─── Content generators ────────────────────────────────────────────────────────

export async function generateChannelStrategy(
  briefText: string,
  campaignText?: string,
): Promise<ChannelStrategy> {
  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_STRATEGY,
    userMessage: buildChannelStrategyPrompt(briefText, campaignText),
    maxOutputTokens: 1024,
  })
  return parseJsonResponse<ChannelStrategy>(result.text)
}

export async function generateReelsScripts(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  viralInsightsText?: string,
): Promise<ReelsScript[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.75,
    max_tokens: 8000,  // storyboard + seedance prompts are verbose (3 reels × ~900 words each)
    messages: [
      { role: 'system', content: SYSTEM_REELS },
      { role: 'user', content: buildReelsPrompt(strategy, briefText, campaignText, viralInsightsText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  const rawScripts = parseOpenAIJson<ReelsScriptRaw[]>(raw)

  // Extract brand name and campaign title for the storyboard prompt builder
  const brandName = briefText.match(/品牌名称：(.+)/)?.[1]?.trim()
    ?? briefText.match(/Brand(?:\s+Name)?:\s*(.+)/i)?.[1]?.trim()
    ?? 'Brand'
  const campaignTitleBase = campaignText?.match(/推广主题：(.+)/)?.[1]?.trim()
    ?? campaignText?.match(/Campaign(?:\s+Title)?:\s*(.+)/i)?.[1]?.trim()
    ?? ''

  return rawScripts.map(reel => {
    const sceneStructure = normaliseSceneStructure(reel.scene_structure)
    const sceneNames = Array.isArray(reel.scene_names)
      ? reel.scene_names.slice(0, 8)
      : Array.from({ length: 8 }, (_, i) => `Scene ${i + 1}`)
    while (sceneNames.length < 8) sceneNames.push(`Scene ${sceneNames.length + 1}`)

    const storyboard_image_prompt = buildStoryboardImagePrompt({
      brandName,
      campaignTitle: campaignTitleBase || reel.title,
      sceneNames,
      sceneStructure,
      styleGuide: reel.style_guide ?? {
        overall_look: 'Clean, modern, aspirational',
        color_grade: 'Neutral with warm highlights',
        lighting: 'Soft natural diffused light',
        atmosphere: 'Calm and professional',
      },
    })

    return {
      ...reel,
      scene_names: sceneNames,
      scene_structure: sceneStructure,
      storyboard_image_prompt,
    }
  })
}

export async function generatePosts(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): Promise<Post[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 3500,
    messages: [
      { role: 'system', content: SYSTEM_POSTS },
      { role: 'user', content: buildPostPrompt(strategy, briefText, campaignText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<Post[]>(raw)
}

export async function generateStories(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): Promise<Story[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM_STORIES },
      { role: 'user', content: buildStoryPrompt(strategy, briefText, campaignText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<Story[]>(raw)
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Ensure scene_structure is always exactly 9 non-empty-padded strings. */
function normaliseSceneStructure(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.map(String) : []
  while (arr.length < 9) arr.push('')
  return arr.slice(0, 9)
}

