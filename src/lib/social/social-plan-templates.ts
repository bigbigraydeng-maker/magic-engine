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

// ─── Generation config ─────────────────────────────────────────────────────────

/** FDE-configurable params sent from the UI before hitting Generate. */
export interface GenerationConfig {
  platform:      'facebook' | 'instagram' | 'tiktok'
  reels_count:   number   // 1–5
  posts_count:   number   // 0–10
  stories_count: number   // 0–5
  angle_focus?:  string   // optional free-text hint, e.g. "seasonal promotion"
}

export const DEFAULT_CONFIG: GenerationConfig = {
  platform:      'facebook',
  reels_count:   3,
  posts_count:   5,
  stories_count: 3,
}

/** Content angle — drives visual style and messaging for each Reel. */
export type AngleTag =
  | 'price_attack'
  | 'speed_attack'
  | 'trust_attack'
  | 'scarcity'
  | 'seasonal'
  | 'education'
  | 'social_proof'
  | 'aspirational'

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
 * seedance_i2v_prompt: complete Seedance I2V prompt (450–700 words, v2.0 standard)
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

// ─── System prompt builders (dynamic per GenerationConfig) ────────────────────

function platformLabel(p: GenerationConfig['platform']): string {
  return p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : 'TikTok'
}

function buildStrategySystemPrompt(config: GenerationConfig): string {
  const pl = platformLabel(config.platform)
  return `You are a senior social media strategist specialising in AU/NZ markets.
Analyse the brand brief and produce a ${pl} channel strategy as a single JSON object.
Return ONLY raw JSON — no markdown, no code fences, no explanation.`
}

function buildReelsSystemPrompt(config: GenerationConfig): string {
  const pl   = platformLabel(config.platform)
  const n    = config.reels_count
  const hint = config.angle_focus
    ? `\nCONTENT FOCUS HINT from FDE: "${config.angle_focus}" — let this guide your angle selection.`
    : ''

  const angleTags = `"price_attack"|"speed_attack"|"trust_attack"|"scarcity"|"seasonal"|"education"|"social_proof"|"aspirational"`

  return `You are a senior ${pl} Reels director and storyboard artist for AU/NZ brands.
Produce ${n} Reels script${n > 1 ? 's' : ''} as a JSON array. Each targets a 15-second ${pl} Reel.${hint}

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

6. seedance_i2v_prompt: string — A COMPLETE Seedance 2.0 v2.0 Standard Video Generation Prompt (450–700 words).
   Used AFTER the storyboard image is generated to animate it into a 15-second video.
   MUST follow this EXACT v2.0 template structure (copy the structure, fill in brand-specific content):

   SEEDANCE 2.0 VIDEO GENERATION PROMPT (v2.0 STANDARD)
   ==============================================================

   PROJECT METADATA:
   - Brand: [brand name]
   - Campaign: [campaign title from reel title]
   - Duration: EXACTLY 15 seconds. Do not shorten. Do not cut scenes early.
   - Format: 9:16 vertical (Reels)
   - Style: [1-sentence tone — e.g. "warm, aspirational, problem-to-solution"]

   GLOBAL SPECIFICATIONS:
   Color Grade: [specific color strategy with emotional reasoning — e.g. "slightly desaturated warm tones, amber-brown with cooler shadows — frustration feels real but not depressing"]
   Lighting: [quality and direction throughout — e.g. "soft natural window light, warm diffused"]
   Music: [full emotional arc — e.g. "starts sad and empathetic (minor key) → builds confidence → peaks at triumph → resolves warmly. Arc: defeated → curious → impressed → triumphant → warm"]
   Pacing: [rhythm — e.g. "slow and heavy at open, accelerates at solution reveal, settles at brand card"]

   ⚠️ CRITICAL START INSTRUCTION:
   The video MUST BEGIN with Scene 1 — [exact opening visual from scene_structure[0]].
   Frame 1 of the video = [precise first-frame description]. This is non-negotiable.
   Do NOT start with storyboard preview, showroom, or text card.

   =====================================

   SCENE 1 (0.0–[end]s) | [scene_names[0]]
   Visual: [detailed description of exactly what is on screen — environment, subject, no human faces]
   Action: [camera move: e.g. "slow push-in" / "static wide" / "gentle pan right". What physically happens.]
   Audio: [music cue and mood. No voiceover unless essential.]
   Text Overlay: "[hook text]" — white sans-serif SUBTITLE at VERY BOTTOM of screen, appears at 0.0s. One line only.
   Color Grade: [per-scene color with emotional reasoning]
   Mood: [1–3 words]

   SCENE 2 ([start]–[end]s) | [scene_names[1]]
   Visual: [...]
   Action: [...]
   Audio: [...]
   Text Overlay: "[text]" — white sans-serif SUBTITLE at VERY BOTTOM of screen, appears at [X]s. One line only.
   Color Grade: [...]
   Mood: [...]

   [Repeat SCENE 3 through SCENE 8 with the same structure, using scene_names[2–7] and timing that totals to 12.0s across all 8 scenes]

   BRAND PANEL (12.0–15.0s) | Brand End Card
   Visual: [brand colors, logo centered, tagline. No contact details — phone/website go to Instagram/Facebook caption only.]
   Action: Hold static for 3 seconds.
   Audio: Music resolves warmly and fades.
   Text Overlay: "[brand tagline]" — white sans-serif SUBTITLE at VERY BOTTOM. One line only.
   Color Grade: Clean, premium, on-brand.
   Mood: Confident, warm, resolved.

   =====================================

   TIMING VERIFICATION (MUST ADD TO EXACTLY 15.0s):
   Scene 1: [X.X]s
   Scene 2: [X.X]s
   Scene 3: [X.X]s
   Scene 4: [X.X]s
   Scene 5: [X.X]s
   Scene 6: [X.X]s
   Scene 7: [X.X]s
   Scene 8: [X.X]s
   Brand Panel: 3.0s
   TOTAL: 15.0s ✓

   =====================================

   FINAL CHECKLIST:
   ☑ Video starts at 0.0s with [opening scene one-line description]
   ☑ ALL text overlays are subtitles at the very bottom of screen (lower 20%)
   ☑ Total duration is exactly 15.0 seconds
   ☑ [scene-specific visual physics check — e.g. "product detail is clearly visible in hero scene"]
   ☑ No storyboard preview frame at beginning
   ☑ No phone numbers, websites, or contact details in video
   ☑ Music emotional arc maps to visual progression
   ☑ Color grading supports emotional storytelling
   ==============================================================

   CRITICAL RULES for seedance_i2v_prompt (violations will cause Seedance rendering failures):
   - Text overlays: ALWAYS bottom subtitles, lower 20% of screen, one line only — NEVER centre-screen
   - Contact info (phone, website, email): NEVER inside video — goes in caption field only
   - Timing: MUST total exactly 15.0 seconds — no "around 15s", no approximation
   - Color grade: per-scene with emotional reasoning — NEVER generic phrases like "warm lighting"
   - Music: MUST include full emotional arc mapped to scenes — not a genre label only
   - Visual physics: be specific — "droplets bead up and roll sideways" not "water beads up"
   - Opening: MUST include ⚠️ CRITICAL START INSTRUCTION block

   VIRAL REFERENCE INTEGRATION — when "VIRAL REFERENCE INSIGHTS" appear in the user message,
   map Style Scores (0–10) directly into seedance_i2v_prompt fields using these translation rules:

   energy score:
     ≥ 7  → Pacing: "fast cuts, rapid scene changes, high-energy editing — each scene ≤1.5s"
     4–6  → Pacing: "medium pace, purposeful transitions, confident rhythm"
     ≤ 3  → Pacing: "slow cinematic, held shots, deliberate flow — hero scene 3+ seconds"

   emotional score:
     ≥ 7  → Music: "strong emotional arc — opens minor key, builds confidently, peaks at hero scene, resolves warmly"
     4–6  → Music: "moderate emotional build — noticeable lift at solution reveal, gentle resolution"
     ≤ 3  → Music: "subtle consistent mood, understated background texture, no dramatic swings"

   urgency score:
     ≥ 6  → Text Overlays: use action verbs (e.g. "Book now", "Limited spots"); Pacing accelerates in final 3 scenes
     ≤ 3  → Text Overlays: calm and aspirational language; no rush in pacing

   luxury score:
     ≥ 7  → Color Grade: "slightly desaturated, premium cool-warm contrast, cinematic feel — avoid oversaturation"
     4–6  → Color Grade: "balanced warm tones, clean midtones, aspirational but accessible"
     ≤ 3  → Color Grade: "bright, warm, saturated, approachable and friendly"

   key_techniques → mirror in CAMERA MOVEMENT STYLE and per-scene Action fields:
     "drone-aerial-opening"   → Scene 1 Action: slow aerial drone descent
     "ugc-selfie-style"       → Action: handheld slightly shaky, intimate close framing
     "testimonial-overlay"    → hero scene Text Overlay carries a direct quote-style statement
     "fast-cut"               → Action: hard cuts every 0.8–1.2s through transformation sequence
     "before-after-reveal"    → dedicate scenes 3–5 to explicit before/after transition

   persona_fit → shape emotional arc tone:
     "Luxury Aspirational"         → aspirational slow build, premium color grade, restrained text
     "Calm Explorer"               → peaceful pacing, nature/landscape visual cues, discovery arc
     "Practical Buyer - Planner"   → clear problem-to-solution arc, benefit-forward text overlays
     "Practical Buyer - Converter" → fast pace, explicit offer in scene 6–7, urgent CTA at scene 8

7. caption: string — Facebook Reels caption. AU/NZ English. 2–3 short paragraphs. Clear CTA. 5–8 hashtags at end.

8. hashtags: string[] — standalone array of 5–8 hashtags.

9. angle_tag: one of ${angleTags}
   Choose ${n} different angle_tag${n > 1 ? 's' : ''} across the ${n} reel${n > 1 ? 's' : ''}.

CRITICAL RULES:
- All text fields in English only — zero Chinese characters
- scene_names MUST be EXACTLY 8 strings
- scene_structure MUST be EXACTLY 9 strings
- seedance_i2v_prompt MUST be 450–700 words following the v2.0 standard template (PROJECT METADATA / GLOBAL SPECIFICATIONS / ⚠️ CRITICAL START INSTRUCTION / SCENE 1–8 / TIMING VERIFICATION / FINAL CHECKLIST)
- No human faces or bodies in any visual description
Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`
}

function buildPostsSystemPrompt(config: GenerationConfig): string {
  const pl = platformLabel(config.platform)
  const n  = config.posts_count
  return `You are a ${pl} copywriter for AU/NZ brands.
Produce ${n} ${pl} post${n > 1 ? 's' : ''} as a JSON array. Each post object must have:
  content_type: "educational"|"promotional"|"storytelling"|"engagement"
  copy: ${pl} post copy (AU/NZ English, 80–300 words, include a clear CTA)
  image_prompt: detailed AI image-generation prompt (9:16 vertical, no human faces, vivid, cinematic)
  hashtags: array of 5–8 relevant hashtags
Cover a variety of content types across the ${n} post${n > 1 ? 's' : ''}.
Return ONLY a raw JSON array — no markdown, no code fences.`
}

function buildStoriesSystemPrompt(config: GenerationConfig): string {
  const pl = platformLabel(config.platform)
  const n  = config.stories_count
  return `You are a ${pl} Stories copywriter for AU/NZ brands.
Produce ${n} ${pl} Stories as a JSON array. Each story object must have:
  copy: short punchy overlay text (≤30 words, AU/NZ English)
  cta: swipe-up or tap call-to-action text (≤10 words)
  visual_prompt: AI image-generation prompt (9:16 portrait, no human faces, vivid)
Return ONLY a raw JSON array — no markdown, no code fences.`
}

// ─── Prompt builders ───────────────────────────────────────────────────────────

export function buildChannelStrategyPrompt(briefText: string, campaignText?: string, config: GenerationConfig = DEFAULT_CONFIG): string {
  const pl = platformLabel(config.platform)
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

Produce a ${pl} channel strategy JSON object with exactly these keys:
{
  "platform": "${config.platform}",
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
  config: GenerationConfig = DEFAULT_CONFIG,
): string {
  const pl = platformLabel(config.platform)
  const n  = config.reels_count
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  const viral = viralInsightsText ? `\n\n${viralInsightsText}` : ''
  return `## Brand Brief
${briefText}${campaign}${viral}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Generate ${n} ${pl} Reel${n > 1 ? 's' : ''} script${n > 1 ? 's' : ''} with ALL required fields.

IMPORTANT:
- scene_names: exactly 8 short evocative titles for Panels 1–8 (Panel 9 is always the brand panel).
- scene_structure MUST be exactly 9 strings; index 8 MUST be the brand panel.
- style_guide: fill all 4 keys with specific, concrete visual direction (not generic).
- seedance_i2v_prompt: write 450–700 words following the v2.0 standard template exactly: PROJECT METADATA → GLOBAL SPECIFICATIONS (Color Grade/Lighting/Music arc/Pacing) → ⚠️ CRITICAL START INSTRUCTION → SCENE 1–8 each with (Visual/Action/Audio/Text Overlay/Color Grade/Mood) → TIMING VERIFICATION (must total 15.0s ✓) → FINAL CHECKLIST. All text overlays must be bottom subtitles. No contact info in video. Per-scene color grade with emotional reasoning. Music must include full arc.
- Choose ${n} distinct angle_tag${n > 1 ? 's' : ''} across the ${n} reel${n > 1 ? 's' : ''}.`
}

export function buildPostPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): string {
  const pl = platformLabel(config.platform)
  const n  = config.posts_count
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce ${n} ${pl} post${n > 1 ? 's' : ''} covering a variety of content types (educational, promotional, storytelling, engagement).
Each post must have copy (AU/NZ English, 80–300 words, with a clear CTA), image_prompt (9:16 vertical, no faces), and 5–8 hashtags.

Return a JSON array of ${n} Post object${n > 1 ? 's' : ''}.`
}

export function buildStoryPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): string {
  const pl = platformLabel(config.platform)
  const n  = config.stories_count
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce ${n} ${pl} Stories. Each must have copy (≤30 words, AU/NZ English), cta (≤10 words), and visual_prompt (9:16 portrait, no faces).

Return a JSON array of ${n} Story object${n > 1 ? 's' : ''}.`
}

// ─── Content generators ────────────────────────────────────────────────────────

export async function generateChannelStrategy(
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<ChannelStrategy> {
  const result = await callClaudeWithDocs({
    systemPrompt: buildStrategySystemPrompt(config),
    userMessage: buildChannelStrategyPrompt(briefText, campaignText, config),
    maxOutputTokens: 1024,
  })
  return parseJsonResponse<ChannelStrategy>(result.text)
}

export async function generateReelsScripts(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  viralInsightsText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<ReelsScript[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.75,
    max_tokens: Math.min(16000, Math.max(5000, config.reels_count * 3500)),  // v2.0: seedance_i2v_prompt 450–700 words per reel
    messages: [
      { role: 'system', content: buildReelsSystemPrompt(config) },
      { role: 'user', content: buildReelsPrompt(strategy, briefText, campaignText, viralInsightsText, config) },
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
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<Post[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: Math.max(2000, config.posts_count * 700),
    messages: [
      { role: 'system', content: buildPostsSystemPrompt(config) },
      { role: 'user', content: buildPostPrompt(strategy, briefText, campaignText, config) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<Post[]>(raw)
}

export async function generateStories(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<Story[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: Math.max(1000, config.stories_count * 400),
    messages: [
      { role: 'system', content: buildStoriesSystemPrompt(config) },
      { role: 'user', content: buildStoryPrompt(strategy, briefText, campaignText, config) },
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

