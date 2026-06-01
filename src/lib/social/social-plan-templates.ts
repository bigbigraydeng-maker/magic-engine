/**
 * Facebook Social Plan — Phase A
 * TypeScript interfaces, prompt builders, and content generators.
 *
 * generateChannelStrategy → Anthropic Claude Sonnet  (strategy reasoning)
 * generateReelsScripts / generatePosts / generateStories → OpenAI GPT-4o-mini
 *
 * All SDK clients are initialised inside functions — never at module top-level.
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'

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

/** Content angle for Posts — drives copy focus AND image_subject direction. */
export type PostAngleTag =
  | 'price_attack'
  | 'trust_attack'
  | 'education'
  | 'social_proof'
  | 'aspirational'
  | 'scarcity'
  | 'seasonal'
  | 'storytelling'

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

/**
 * Facebook Post image aspect ratio.
 * - '1:1' square — default for standard FB feed posts
 * - '4:5' portrait — when subject is vertically oriented (tall buildings, portrait composition)
 * Never 9:16 — that is Story/Reel format, not Post.
 */
export type PostImageFormat = '1:1' | '4:5'

/**
 * Facebook Post — generated as part of a Marketing Plan.
 *
 * Image prompt assembly is deterministic (mirrors Reels storyboard pattern):
 *   1. AI generates structured creative inputs (image_subject, image_composition, …)
 *   2. buildPostImagePrompt() assembles the final image_prompt programmatically,
 *      layering MB vi_* + Campaign vi_* + AI creative on top of brand DNA rules.
 *
 * Older records (created before SP-VI.1) only have `image_prompt`; the new
 * creative fields are optional for backward compatibility.
 */
export interface Post {
  content_type: PostType
  copy: string
  hashtags: string[]

  /** Final assembled image prompt — published as-is to image generators. */
  image_prompt: string

  // === Structured creative inputs (AI-generated, SP-VI.1+) ===
  /** Exact location + specific named foreground element + scene depth (20–35 words). */
  image_subject?: string
  /** Camera angle + lens character + composition principle + depth (15–25 words). */
  image_composition?: string
  /** Light source, quality, direction (10–20 words). */
  image_lighting?: string
  /** 2–3 mood words drawn from brand vi_style_keywords. */
  image_mood_words?: string[]
  /** Aspect ratio — defaults to '1:1' for FB feed. */
  image_format?: PostImageFormat
  /** Content angle — primary differentiator; drives copy focus and image creative direction. */
  angle_tag?: PostAngleTag
}

/**
 * Facebook Story — generated as part of a Marketing Plan.
 *
 * Same deterministic-builder pattern as Post, but format is always 9:16 vertical.
 * The new creative fields are optional for backward compatibility with pre-SP-VI.1 records.
 */
export interface Story {
  copy: string
  cta: string

  /** Final assembled image prompt — published as-is to image generators. */
  visual_prompt: string

  // === Structured creative inputs (AI-generated, SP-VI.1+) ===
  /** Exact location + specific named foreground element + scene depth (20–35 words). */
  story_subject?: string
  /** Camera angle + lens character + composition principle + depth (15–25 words). */
  story_composition?: string
  /** Light source, quality, direction (10–20 words). */
  story_lighting?: string
  /** 2–3 mood words drawn from brand vi_style_keywords. */
  story_mood_words?: string[]
}

export interface SocialPlanOutput {
  strategy: ChannelStrategy
  reels: ReelsScript[]
  posts: Post[]
  stories: Story[]
}

// ─── Brand & Campaign Visual DNA ───────────────────────────────────────────────

/**
 * Brand-level visual DNA, extracted from the active Master Brief.
 * This is the NON-NEGOTIABLE constraint layer — every Post/Story image prompt
 * must respect these rules. Campaign visual direction can narrow or extend these,
 * but must never contradict them.
 */
export interface VisualBrandDNA {
  brandName: string
  /** vi_style_keywords joined — photography style language for prompt header. */
  photographyStyle: string
  /** Comma-separated brand colors from vi_colors (primary / secondary / accent / background). */
  colorPalette: string
  /** vi_dos joined — what every image MUST contain or honour. */
  visualDos: string
  /** vi_donts joined — what no image may ever contain. */
  visualDonts: string
}

/**
 * Campaign-level visual direction, extracted from the campaign brief.
 * Layered on top of VisualBrandDNA. All fields are optional — if a campaign
 * doesn't specify a vi_* field, the brand DNA value carries through unchanged.
 */
export interface CampaignVisualDirection {
  campaignTitle: string
  /** Campaign mood tone — overrides/refines brand mood for the duration of the campaign. */
  mood?: string
  /** Campaign-specific accent color (e.g. "warm amber for October Discovery"). */
  colorAccent?: string
  /** Additional visual rules specific to this campaign. */
  specificDos?: string
  /** Additional visual exclusions specific to this campaign. */
  specificDonts?: string
  /** Free-text reference note (composition, mood-board direction). */
  referenceNote?: string
}

/** Extracts the visual DNA struct from a Master Brief row. */
export function extractBrandVisualDNA(brief: MasterBrief): VisualBrandDNA {
  const photographyStyle = brief.vi_style_keywords?.join(', ')
    || brief.visual_style
    || 'Cinematic editorial photography'

  const colorPalette = (() => {
    if (brief.vi_colors) {
      const { primary, secondary, accent, background } = brief.vi_colors
      return [primary, secondary, accent, background].filter(Boolean).join(', ')
    }
    return brief.color_palette?.join(', ') || ''
  })()

  const visualDos = brief.vi_dos?.join('; ') || ''
  const visualDonts = brief.vi_donts?.join('; ') || brief.image_preference || ''

  return {
    brandName: brief.brand_name || 'Brand',
    photographyStyle,
    colorPalette,
    visualDos,
    visualDonts,
  }
}

/** Extracts the campaign visual direction struct from a Campaign Brief row. */
export function extractCampaignVisualDirection(campaign: CampaignBrief): CampaignVisualDirection {
  return {
    campaignTitle: campaign.title,
    ...(campaign.vi_mood          ? { mood:          campaign.vi_mood }          : {}),
    ...(campaign.vi_color_accent  ? { colorAccent:   campaign.vi_color_accent }  : {}),
    ...(campaign.vi_specific_dos?.length   ? { specificDos:   campaign.vi_specific_dos.join('; ') }   : {}),
    ...(campaign.vi_specific_donts?.length ? { specificDonts: campaign.vi_specific_donts.join('; ') } : {}),
    ...(campaign.vi_reference_note ? { referenceNote: campaign.vi_reference_note } : {}),
  }
}

// ─── Post & Story image prompt builders ────────────────────────────────────────

interface PostImageBuilderParams {
  brand:    VisualBrandDNA
  campaign: CampaignVisualDirection
  post: {
    contentType: PostType
    subject:     string
    composition: string
    lighting:    string
    moodWords:   string[]
    format:      PostImageFormat
  }
}

interface StoryImageBuilderParams {
  brand:    VisualBrandDNA
  campaign: CampaignVisualDirection
  story: {
    subject:     string
    composition: string
    lighting:    string
    moodWords:   string[]
  }
}

/**
 * Deterministically assembles the final image prompt for a Facebook Post.
 *
 * Layers in order:
 *   1. Brand photography style (from MB vi_style_keywords)
 *   2. AI-generated subject + composition + lighting
 *   3. Brand color palette + campaign color accent
 *   4. AI mood words + campaign mood
 *   5. MUST DO rules (MB vi_dos + campaign vi_specific_dos)
 *   6. EXCLUSIONS (MB vi_donts + campaign vi_specific_donts + standard exclusions)
 *   7. Format spec + technical requirements
 *
 * Output is copy-paste ready for ChatGPT Image / Visual Studio.
 */
export function buildPostImagePrompt(p: PostImageBuilderParams): string {
  const formatLabel = p.post.format === '4:5' ? '4:5 portrait' : '1:1 square'
  const moodPhrase = p.post.moodWords.join(', ')

  const colorLine = p.campaign.colorAccent
    ? `Color palette: ${p.brand.colorPalette || 'brand standard'}, with ${p.campaign.colorAccent} as the campaign accent.`
    : p.brand.colorPalette
      ? `Color palette: ${p.brand.colorPalette}.`
      : ''

  const moodLine = p.campaign.mood
    ? `Mood: ${moodPhrase} — ${p.campaign.mood}.`
    : `Mood: ${moodPhrase}.`

  const mustDoLines: string[] = []
  if (p.brand.visualDos)         mustDoLines.push(`Brand rules: ${p.brand.visualDos}.`)
  if (p.campaign.specificDos)    mustDoLines.push(`Campaign rules: ${p.campaign.specificDos}.`)
  if (p.campaign.referenceNote)  mustDoLines.push(`Reference: ${p.campaign.referenceNote}.`)

  const exclusionLines: string[] = []
  if (p.brand.visualDonts)       exclusionLines.push(`Brand exclusions: ${p.brand.visualDonts}.`)
  if (p.campaign.specificDonts)  exclusionLines.push(`Campaign exclusions: ${p.campaign.specificDonts}.`)
  exclusionLines.push('No people, no tourist crowds, no human faces. No text, no signs, no watermarks, no logos.')

  return [
    `${p.brand.photographyStyle} photography.`,
    `${p.post.subject}`,
    `${p.post.composition}`,
    `${p.post.lighting}`,
    colorLine,
    moodLine,
    mustDoLines.length ? `\nVISUAL RULES (MUST follow):\n${mustDoLines.join('\n')}` : '',
    `\nEXCLUSIONS:\n${exclusionLines.join('\n')}`,
    `\n${formatLabel} format. Ultra-high resolution. Photorealistic. Cinematic color grade.`,
  ].filter(Boolean).join('\n').trim()
}

/**
 * Deterministically assembles the final image prompt for a Facebook Story.
 * Same layering as Post, but format is locked to 9:16 vertical.
 */
export function buildStoryImagePrompt(p: StoryImageBuilderParams): string {
  const moodPhrase = p.story.moodWords.join(', ')

  const colorLine = p.campaign.colorAccent
    ? `Color palette: ${p.brand.colorPalette || 'brand standard'}, with ${p.campaign.colorAccent} as the campaign accent.`
    : p.brand.colorPalette
      ? `Color palette: ${p.brand.colorPalette}.`
      : ''

  const moodLine = p.campaign.mood
    ? `Mood: ${moodPhrase} — ${p.campaign.mood}.`
    : `Mood: ${moodPhrase}.`

  const mustDoLines: string[] = []
  if (p.brand.visualDos)         mustDoLines.push(`Brand rules: ${p.brand.visualDos}.`)
  if (p.campaign.specificDos)    mustDoLines.push(`Campaign rules: ${p.campaign.specificDos}.`)
  if (p.campaign.referenceNote)  mustDoLines.push(`Reference: ${p.campaign.referenceNote}.`)

  const exclusionLines: string[] = []
  if (p.brand.visualDonts)       exclusionLines.push(`Brand exclusions: ${p.brand.visualDonts}.`)
  if (p.campaign.specificDonts)  exclusionLines.push(`Campaign exclusions: ${p.campaign.specificDonts}.`)
  exclusionLines.push('No people, no tourist crowds, no human faces. No text, no signs, no watermarks, no logos.')
  exclusionLines.push('Leave clean upper 20% and lower 20% margins for Story overlay text.')

  return [
    `${p.brand.photographyStyle} photography.`,
    `${p.story.subject}`,
    `${p.story.composition}`,
    `${p.story.lighting}`,
    colorLine,
    moodLine,
    mustDoLines.length ? `\nVISUAL RULES (MUST follow):\n${mustDoLines.join('\n')}` : '',
    `\nEXCLUSIONS:\n${exclusionLines.join('\n')}`,
    `\n9:16 vertical format. Ultra-high resolution. Photorealistic. Cinematic color grade.`,
  ].filter(Boolean).join('\n').trim()
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

   opening_hook → DUAL TARGET: apply to BOTH scene_structure[0] (Panel 1) AND seedance_i2v_prompt Scene 1.
   ⚡ ALIGNMENT RULE: Seedance animates the storyboard Panel 1 image — both must describe the SAME visual moment.
      scene_structure[0] Thumbnail sets WHAT is on screen; Seedance Scene 1 Action sets HOW it moves.
      If they contradict each other, Seedance will mis-animate Panel 1.
   (When "Opening Hook" appears in VIRAL REFERENCE INSIGHTS, mirror its type across BOTH outputs)

     "visual_shock"
       scene_structure[0]: Thumbnail — extreme close-up or unexpected angle that creates visual surprise (dramatic, unexpected subject);
                           CAMERA — static locked-off (shock comes from subject, not camera movement); MOOD — jarring, arresting
       seedance_i2v_prompt Scene 1 Action: hard cut pattern interrupt at 0.0s, no lead-in
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST begin with the dramatic unexpected close-up — no gentle pan-in, straight cut at 0.0s"

     "ugc_selfie"
       scene_structure[0]: Thumbnail — intimate scene with minimal production feel, suggesting creator POV (real environment, not studio);
                           CAMERA — slight handheld tilt, eye-level direct; MOOD — raw, authentic, unpolished
       seedance_i2v_prompt Scene 1 Action: handheld, slightly shaky, intimate close framing at 0.0s
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST begin with authentic direct-to-camera moment — no cinematic sweeping open"

     "text_overlay_question"
       scene_structure[0]: Thumbnail — clean visual with generous open space (top or center) for text to dominate;
                           STORY — write the hook question itself as the STORY overlay text;
                           CAMERA — static locked-off, question is the hero; MOOD — provocative, curious
       seedance_i2v_prompt Scene 1 Text Overlay: bold question/statement at VERY BOTTOM, appears at exactly 0.0s before any motion
       ⚠️ CRITICAL START INSTRUCTION: "Text question overlay must render at frame 1 — visual is static background for the text"

     "product_reveal"
       scene_structure[0]: Thumbnail — extreme close-up of the product detail, isolated or minimal background, no wide shot;
                           CAMERA — macro/tight, subject fills most of the frame; MOOD — precise, premium, immediate
       seedance_i2v_prompt Scene 1 Action: immediate product close-up at 0.0s — skip establishing shot entirely
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST begin with tight product detail — no environment reveal before the product"

     "testimonial_start"
       scene_structure[0]: Thumbnail — authentic real-world setting (home, workspace, outdoors — no polished studio);
                           CAMERA — eye-level direct, slight handheld authenticity; MOOD — genuine, unscripted, real
       seedance_i2v_prompt Scene 1 Action: authentic real-environment framing at 0.0s, unpolished feel
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST open with authentic testimonial-style moment — no glossy cinematic open"

     "sound_cue"
       scene_structure[0]: Thumbnail — visually anticipatory moment just before the expected audio hit (tension, pre-beat stillness);
                           CAMERA — static, held still, waiting for the beat drop; MOOD — anticipatory, electric
       seedance_i2v_prompt Scene 1 Audio: music drop or distinctive sound fires at exactly 0.0s, first visual cut driven by audio
       ⚠️ CRITICAL START INSTRUCTION: "Audio hook fires at frame 1 — Seedance must sync first visual cut to the sound beat"

     "problem_statement"
       scene_structure[0]: Thumbnail — the problem environment clearly visible (damaged, worn, broken, or pain-point scene);
                           CAMERA — wide establishing the problem context; MOOD — frustration, recognition, empathy
       seedance_i2v_prompt Scene 1 Visual: pain point environment at 0.0s, no solution teased yet
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST open with viewer's pain point — solution is revealed later, NOT in Scene 1"

     "scenic_beauty"
       scene_structure[0]: Thumbnail — wide landscape or environment with strong visual depth and natural splendor;
                           CAMERA — slow sweeping or held wide, grand scale; MOOD — awe, wonder, aspirational
       seedance_i2v_prompt Scene 1 Action: slow cinematic wide reveal at 0.0s, no abrupt cuts in opening 2s
       ⚠️ CRITICAL START INSTRUCTION: "Video MUST begin with stunning environment wide-shot — hold the beauty, no rush"

   opening_hook feel → BOTH Panel 1 CAMERA and Seedance Scene 1 Action modifier:
     "abrupt-cut"    → Panel 1 CAMERA: "static locked-off / snap-to-subject — no gradual motion"
                       Seedance Scene 1 Action: hard cut / jump-cut — no smooth pan or fade in
     "smooth-reveal" → Panel 1 CAMERA: "slow push-in / gentle pan / gradual reveal motion"
                       Seedance Scene 1 Action: gradual reveal, slow push-in, or cinematic slide — no jump-cuts

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
  return `You are a senior ${pl} content creator and visual director for AU/NZ brands.
Produce ${n} ${pl} post${n > 1 ? 's' : ''} as a JSON array. These posts are PUBLISHED DIRECTLY without
manual visual review — every image must be brand-compliant from the first token.

IMAGES ARE ASSEMBLED PROGRAMMATICALLY. You output STRUCTURED CREATIVE INPUTS (image_subject,
image_composition, image_lighting, image_mood_words, image_format). Do NOT output an image_prompt
field — it is built deterministically by the system from your inputs + brand vi_* + campaign vi_*.

Each JSON object MUST have ALL of these keys (no omissions):

1. content_type: "educational" | "promotional" | "storytelling" | "engagement"
   Cover variety across the ${n} post${n > 1 ? 's' : ''}.

2. copy: string — ${pl} post copy
   - AU/NZ English (travelling, colour, organise, etc.)
   - 80–300 words
   - Must include a clear, specific CTA at the end
   - Tone must match the brand's tone from the Master Brief
   - Must respect the brief's avoid_words list — zero violations
   - Must reflect the active campaign's offer and primary_cta

3. hashtags: string[] — 5–8 relevant, on-brand hashtags

4. image_format: "1:1" | "4:5"
   - DEFAULT "1:1" (square) — standard Facebook feed post
   - Use "4:5" (portrait) ONLY when the subject is vertically oriented (tall building, vertical artefact, portrait composition)
   - NEVER use "9:16" — that is Story / Reel format, not Post

5. image_subject: string — 20–35 words
   - Name the EXACT location (not "China" or "ancient city" — name it precisely:
     "Xi'an's 14th-century South Gate at dusk", "Yangshuo karst peaks above the Li River at Xingping bend")
   - Name ONE specific tactile foreground element (not "textiles" — "hand-thrown clay tea bowl with hairline celadon glaze")
   - Add scene depth (background context that gives it dimension)
   - Must align with the campaign's vi_mood and vi_reference_note if provided in the brief

6. image_composition: string — 15–25 words
   - Camera angle: ground-level / low-angle / eye-level / slight elevation / overhead
   - Lens character: 24mm wide (grand scale), 35mm normal (intimate), 85mm (compressed detail)
   - Composition principle: rule of thirds / symmetrical / leading lines / frame within frame
   - Depth field: sharp foreground with blurred background / full sharpness / layered planes

7. image_lighting: string — 10–20 words
   - Name the exact light condition (NOT "warm light" alone):
     pre-dawn cool blue-grey / golden hour amber raking / overcast dramatic diffuse /
     lantern firelight / mid-morning crisp high-contrast
   - Quality + direction (backlit / side-lit / top-down / soft fill)

8. image_mood_words: string[] — EXACTLY 2–3 mood words
   - MUST be drawn from or consistent with the brand's vi_style_keywords in the brief
   - Each word earns its place — no generic atmospheric fluff
   - Examples (only if brand-aligned): private, vast, ancient, intimate, earned, serene, alive, unhurried

9. angle_tag: one of "price_attack"|"trust_attack"|"education"|"social_proof"|"aspirational"|"scarcity"|"seasonal"|"storytelling"
   This is the PRIMARY differentiator — copy AND image_subject MUST both reflect the assigned angle:
   - price_attack  → copy: value/price emphasis, ROI; image: clean product or value-signaling composition
   - trust_attack  → copy: proof points, reviews, certifications; image: authentic un-staged real-world scene
   - education     → copy: teach a specific useful fact or process; image: process step, technique, or close-up detail
   - social_proof  → copy: real results, community, shared experience; image: intimate authentic moment
   - aspirational  → copy: dream outcome, lifestyle vision; image: wide, grand, premium lifestyle scene
   - scarcity      → copy: urgency, limited time/spots/stock; image: exclusive or near-sold-out visual cue
   - seasonal      → copy: season/event/moment tie-in, timely relevance; image: strong seasonal visual markers
   - storytelling  → copy: narrative journey or transformation arc; image: evocative moment-in-time scene

   MANDATORY: use the EXACT angle_tag assigned for your post number in the user message.
   Each post's angle_tag MUST differ from every other post in this batch.

VISUAL COMPLIANCE — read the brief's "视觉品牌 DNA" section and the campaign's "活动视觉指令" section.
Every image_subject / composition / lighting / mood field MUST:
  - Be consistent with the brand's vi_style_keywords (photography style)
  - Honour the brand's vi_dos (must-do list)
  - Avoid everything in the brand's vi_donts (must-not list)
  - Apply the campaign's vi_mood, vi_color_accent, vi_specific_dos / vi_specific_donts on top
  - If campaign vi_* contradicts brand vi_* — FOLLOW THE BRAND. Campaign refines, never contradicts.

CRITICAL RULES (violations will fail brand review and block publication):
- All image-related fields in English only — zero Chinese characters
- FORBIDDEN words in image_subject / composition / lighting: "picturesque", "showcasing", "vibrant"
  used alone, "bustling", "stunning". These produce generic stock-photo output.
- No human faces or bodies anywhere in image_subject (silhouettes from behind / hands only / empty scenes)
- No text, signs, banners, watermarks, logos, or UI elements in any image_subject
- Generic descriptions ("a market scene", "a beautiful temple") will FAIL — be specific or rewrite
- Could this image_subject describe a competitor's content? If yes → rewrite until it can only be this brand

OVERUSED LANDMARK BAN — applies to ALL travel / tourism brands:
The #1 most-famous landmark of any destination is BANNED. It exists in millions of stock libraries
and cannot differentiate a premium brand.
  China/Asia BANNED: Great Wall, Forbidden City, Tiananmen Square, Temple of Heaven,
    Terracotta Warriors, Potala Palace, generic Bund skyline panorama, panda with bamboo.
  New Zealand BANNED: generic Milford Sound panorama, Sky Tower exterior, Hobbiton wide.
  Australia BANNED: Sydney Opera House exterior, generic Uluru at sunset, Bondi Beach wide.
Instead choose a SPECIFIC lesser-known but photogenic alternative that earns brand differentiation:
  China alternatives: a specific hutong tea house courtyard with weathered timber lattice,
    the named Xingping bend of the Li River with karst peaks reflected in still water,
    Xi'an's South Gate wall-top walkway at pre-dawn before tourists arrive,
    Chengdu Jinli alley cobblestones with dew at 6am, Zhangjiajie walkway level with cloud.
SELF-CHECK before finalising image_subject: "Does this exact photo exist in Getty for under $50?"
  — if yes, make it 3× more specific (exact location + exact time + exact foreground detail).

Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`
}

function buildStoriesSystemPrompt(config: GenerationConfig): string {
  const pl = platformLabel(config.platform)
  const n  = config.stories_count
  return `You are a senior ${pl} Stories creator and visual director for AU/NZ brands.
Produce ${n} ${pl} Stories as a JSON array. These Stories are PUBLISHED DIRECTLY without
manual visual review — every image must be brand-compliant from the first token.

IMAGES ARE ASSEMBLED PROGRAMMATICALLY. You output STRUCTURED CREATIVE INPUTS (story_subject,
story_composition, story_lighting, story_mood_words). Do NOT output a visual_prompt field —
it is built deterministically by the system from your inputs + brand vi_* + campaign vi_*.

Each JSON object MUST have ALL of these keys (no omissions):

1. copy: string — Story overlay text
   - AU/NZ English
   - ≤30 words, short and punchy
   - Designed to be readable at a glance over the image (no fine print)
   - Must respect the brief's avoid_words list

2. cta: string — Story CTA
   - ≤10 words
   - Must start with an action verb (Tap / Swipe / See / Discover / Book / Learn)
   - Tied to the active campaign's primary_cta where possible

3. story_subject: string — 20–35 words
   - Name the EXACT location precisely (not generic — "Mutianyu Great Wall watchtower in pre-dawn mist",
     not "Great Wall scene")
   - Name ONE specific tactile foreground element
   - Add scene depth — Stories work best with strong vertical depth
   - Must align with the campaign's vi_mood and vi_reference_note if provided

4. story_composition: string — 15–25 words
   - Camera angle suited to 9:16 vertical: low-angle vertical, ground-level looking up, overhead
   - Lens: 24mm wide (vertical scale), 35mm normal (immersive), 85mm (compressed detail)
   - Composition: strong vertical leading lines / vertical thirds / frame within frame
   - Depth: layered planes (Stories reward depth in vertical composition)

5. story_lighting: string — 10–20 words
   - Name the exact light condition (NOT "warm light" alone)
   - Quality + direction
   - Stories often benefit from dramatic backlighting or rim light for stop-scroll power

6. story_mood_words: string[] — EXACTLY 2–3 mood words
   - MUST align with brand vi_style_keywords
   - Stories can lean slightly more dramatic / kinetic than Posts

VISUAL COMPLIANCE — read the brief's "视觉品牌 DNA" section and the campaign's "活动视觉指令" section.
Every story_subject / composition / lighting / mood field MUST:
  - Be consistent with the brand's vi_style_keywords
  - Honour the brand's vi_dos
  - Avoid everything in the brand's vi_donts
  - Apply the campaign's vi_mood, vi_color_accent, vi_specific_dos / vi_specific_donts on top
  - If campaign vi_* contradicts brand vi_* — FOLLOW THE BRAND.

CRITICAL RULES (violations will fail brand review and block publication):
- All image-related fields in English only — zero Chinese characters
- FORBIDDEN words in story_subject / composition / lighting: "picturesque", "showcasing",
  "vibrant" used alone, "bustling", "stunning"
- No human faces or bodies in any story_subject (silhouettes / hands only / empty scenes)
- No text, signs, watermarks, logos in any story_subject
- Format is locked to 9:16 vertical — leave clean upper 20% and lower 20% margins for overlay text
- Generic descriptions will FAIL — be specific or rewrite

OVERUSED LANDMARK BAN (same rules as Posts — Stories travel even faster):
  China/Asia BANNED: Great Wall, Forbidden City, Tiananmen, Temple of Heaven, Terracotta Warriors,
    Potala Palace, generic Bund skyline, panda with bamboo.
  NZ BANNED: generic Milford Sound, Sky Tower exterior, Hobbiton wide shot.
  AU BANNED: Opera House exterior, Uluru at sunset, Bondi wide.
Stories must STOP SCROLL — a landmark everyone has seen cannot do that. Choose unexpected,
hyper-specific, brand-differentiated locations. 9:16 vertical rewards depth and drama over
famous-landmark recognition — use it.

Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`
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

/** Fixed rotation of angles for Posts — guarantees variety when cycling through N posts. */
const POST_ANGLE_SEQUENCE: PostAngleTag[] = [
  'aspirational',
  'education',
  'social_proof',
  'price_attack',
  'trust_attack',
  'storytelling',
  'scarcity',
  'seasonal',
]

export function buildPostPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): string {
  const pl = platformLabel(config.platform)
  const n  = config.posts_count
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''

  const pillars = strategy.content_pillars.length > 0
    ? strategy.content_pillars
    : ['Brand Awareness', 'Product Value', 'Customer Stories']

  const angleFocusHint = config.angle_focus
    ? `\nFDE FOCUS HINT: "${config.angle_focus}" — weave this theme into all posts' copy while maintaining distinct angles per post.\n`
    : ''

  const assignments = Array.from({ length: n }, (_, i) => {
    const pillar = pillars[i % pillars.length]
    const angle  = POST_ANGLE_SEQUENCE[i % POST_ANGLE_SEQUENCE.length]
    return `  Post ${i + 1}: Content Pillar = "${pillar}" | angle_tag = "${angle}"`
  }).join('\n')

  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}
${angleFocusHint}
## POST ASSIGNMENTS (MANDATORY — each post MUST follow its assigned pillar and angle_tag exactly)
${assignments}

Produce ${n} ${pl} post${n > 1 ? 's' : ''} following the assignments above.
Each post MUST be GENUINELY DIFFERENT from every other post in:
- copy topic and persuasion angle (driven by assigned content_pillar + angle_tag)
- image_subject (different location, different foreground element, different depth context)
- image_composition (different camera angle and lens choice)
- image_lighting (different light condition and time of day)

REQUIRED FIELDS per post:
- content_type, copy (80–300 words AU/NZ English, clear CTA), hashtags (5–8)
- angle_tag (MUST match your assigned angle_tag above — no substitutions)
- image_format: "1:1" (default) or "4:5" — NEVER "9:16"
- image_subject (20–35 words, exact location + specific foreground + scene depth)
- image_composition (15–25 words, angle + lens + composition + depth)
- image_lighting (10–20 words, specific light condition + quality + direction)
- image_mood_words (2–3 mood words aligned with brand vi_style_keywords)

DO NOT output an image_prompt field — it is assembled programmatically from your inputs.
Every image field MUST be consistent with the brand's vi_* DNA and the campaign's 活动视觉指令.

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

Produce ${n} ${pl} Stories.

REQUIRED FIELDS per story:
- copy (≤30 words AU/NZ English, punchy overlay)
- cta (≤10 words, action verb start)
- story_subject (20–35 words, exact vertical-friendly location + specific foreground + scene depth)
- story_composition (15–25 words, vertical-suited angle + lens + composition + depth)
- story_lighting (10–20 words, specific light condition + quality + direction)
- story_mood_words (2–3 mood words aligned with brand vi_style_keywords)

DO NOT output a visual_prompt field — it is assembled programmatically (locked to 9:16 vertical).
Every image field MUST be consistent with the brand's vi_* DNA and the campaign's 活动视觉指令.

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
  const openai = getOpenAIClient()

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

/** Raw shape returned by the AI for Posts — image_prompt is assembled programmatically after. */
type PostRaw = Omit<Post, 'image_prompt'> & Required<Pick<Post,
  'image_subject' | 'image_composition' | 'image_lighting' | 'image_mood_words' | 'image_format'
>>

const VALID_POST_TYPES: readonly PostType[] = ['educational', 'promotional', 'storytelling', 'engagement'] as const

/**
 * Maps any AI-returned content_type string to one of the 4 valid PostType values.
 * Guards against hallucinations where the AI returns a content pillar name
 * (e.g. "destination_inspiration") instead of a valid type.
 */
function normaliseContentType(raw: string): PostType {
  if ((VALID_POST_TYPES as readonly string[]).includes(raw)) return raw as PostType
  const l = raw.toLowerCase().replace(/[_\s-]+/g, '')
  if (l.includes('edu') || l.includes('info') || l.includes('learn') || l.includes('how')) return 'educational'
  if (l.includes('promo') || l.includes('sale') || l.includes('offer') || l.includes('price') || l.includes('scarc') || l.includes('limit')) return 'promotional'
  if (l.includes('story') || l.includes('narr') || l.includes('journey') || l.includes('inspir') || l.includes('aspir') || l.includes('destination')) return 'storytelling'
  return 'engagement'
}

export async function generatePosts(
  strategy: ChannelStrategy,
  brand: VisualBrandDNA,
  campaign: CampaignVisualDirection,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<Post[]> {
  const openai = getOpenAIClient()

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    // Posts now carry 5 structured visual fields per item → bump per-post budget.
    max_tokens: Math.max(3000, config.posts_count * 1000),
    messages: [
      { role: 'system', content: buildPostsSystemPrompt(config) },
      { role: 'user', content: buildPostPrompt(strategy, briefText, campaignText, config) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  const rawPosts = parseOpenAIJson<PostRaw[]>(raw)

  return rawPosts.map(p => {
    const image_format: PostImageFormat = p.image_format === '4:5' ? '4:5' : '1:1'
    const moodWords = Array.isArray(p.image_mood_words) ? p.image_mood_words.slice(0, 3) : []
    const image_prompt = buildPostImagePrompt({
      brand,
      campaign,
      post: {
        contentType: p.content_type,
        subject:     p.image_subject     ?? '',
        composition: p.image_composition ?? '',
        lighting:    p.image_lighting    ?? '',
        moodWords,
        format:      image_format,
      },
    })
    return {
      content_type:      normaliseContentType(p.content_type),
      copy:              p.copy,
      hashtags:          p.hashtags,
      image_subject:     p.image_subject,
      image_composition: p.image_composition,
      image_lighting:    p.image_lighting,
      image_mood_words:  moodWords,
      image_format,
      image_prompt,
      ...(p.angle_tag ? { angle_tag: p.angle_tag } : {}),
    }
  })
}

/** Raw shape returned by the AI for Stories — visual_prompt is assembled programmatically after. */
type StoryRaw = Omit<Story, 'visual_prompt'> & Required<Pick<Story,
  'story_subject' | 'story_composition' | 'story_lighting' | 'story_mood_words'
>>

export async function generateStories(
  strategy: ChannelStrategy,
  brand: VisualBrandDNA,
  campaign: CampaignVisualDirection,
  briefText: string,
  campaignText?: string,
  config: GenerationConfig = DEFAULT_CONFIG,
): Promise<Story[]> {
  const openai = getOpenAIClient()

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    // Stories now carry 4 structured visual fields per item → bump per-story budget.
    max_tokens: Math.max(1500, config.stories_count * 700),
    messages: [
      { role: 'system', content: buildStoriesSystemPrompt(config) },
      { role: 'user', content: buildStoryPrompt(strategy, briefText, campaignText, config) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  const rawStories = parseOpenAIJson<StoryRaw[]>(raw)

  return rawStories.map(s => {
    const moodWords = Array.isArray(s.story_mood_words) ? s.story_mood_words.slice(0, 3) : []
    const visual_prompt = buildStoryImagePrompt({
      brand,
      campaign,
      story: {
        subject:     s.story_subject     ?? '',
        composition: s.story_composition ?? '',
        lighting:    s.story_lighting    ?? '',
        moodWords,
      },
    })
    return {
      copy:              s.copy,
      cta:               s.cta,
      story_subject:     s.story_subject,
      story_composition: s.story_composition,
      story_lighting:    s.story_lighting,
      story_mood_words:  moodWords,
      visual_prompt,
    }
  })
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Ensure scene_structure is always exactly 9 non-empty-padded strings. */
function normaliseSceneStructure(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.map(String) : []
  while (arr.length < 9) arr.push('')
  return arr.slice(0, 9)
}

