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

/**
 * Exactly 9 panel strings for a Reels storyboard.
 *
 * Panels 1–8 format:
 *   "Thumbnail: 9:16 vertical — [vivid description, no faces] | STORY: [overlay text] | CAMERA: [camera direction] | MOOD: [mood/emotion]"
 *
 * Panel 9 (brand close) format:
 *   "BRAND PANEL: [brand color] background. [Brand name] in large serif. [Key anchor 1]. [Key anchor 2]. Minimal."
 *
 * All English. No human faces. No Chinese.
 */
export type SceneStructure = [
  string, string, string, string,
  string, string, string, string,
  string
]

export interface ReelsScript {
  title: string
  hook: string
  scene_structure: SceneStructure
  caption: string
  hashtags: string[]
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

const SYSTEM_REELS = `You are a Facebook Reels scriptwriter for AU/NZ brands.
Produce 3 Reels scripts as a JSON array.

scene_structure MUST be EXACTLY 9 strings:
  Panels 1–8: "Thumbnail: 9:16 vertical — [vivid visual description, no faces] | STORY: [on-screen text] | CAMERA: [camera direction] | MOOD: [mood/emotion]"
  Panel 9: "BRAND PANEL: [brand color] background. [Brand name] in large serif. [Key anchor 1]. [Key anchor 2]. Minimal."

Rules: all English, no human faces, no Chinese text.
Return ONLY a raw JSON array — no markdown, no code fences.`

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
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 3 Reels scripts as a JSON array. Each script must have:
  title (string), hook (string), scene_structure (EXACTLY 9 strings), caption (≤2200 chars, AU/NZ English), hashtags (string[])

scene_structure format:
  Panels 1–8: "Thumbnail: 9:16 vertical — [vivid description, no faces] | STORY: [overlay text] | CAMERA: [camera action] | MOOD: [mood]"
  Panel 9: "BRAND PANEL: [brand color] background. [Brand name] in large serif. [Anchor 1]. [Anchor 2]. Minimal."`
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
): Promise<ReelsScript[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_REELS },
      { role: 'user', content: buildReelsPrompt(strategy, briefText, campaignText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  const scripts = parseOpenAIJson<ReelsScript[]>(raw)

  return scripts.map(s => ({
    ...s,
    scene_structure: normaliseSceneStructure(s.scene_structure),
  }))
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

function normaliseSceneStructure(raw: unknown): SceneStructure {
  const arr = Array.isArray(raw) ? raw.map(String) : []
  while (arr.length < 9) arr.push('')
  return arr.slice(0, 9) as SceneStructure
}
