/**
 * reviews-to-reels — convert GBP customer reviews into FB Reels scripts.
 *
 * Angle: social_proof — each Reel spotlights a real customer testimonial,
 * turning authentic reviews into 15-second story arcs that build trust and
 * drive bookings.
 *
 * Generation model: Claude Sonnet (Strategy Engine) — chosen over GPT-4o-mini
 * because testimonial-driven storytelling needs emotional nuance and the ability
 * to honour both the reviewer's voice AND the brand's visual DNA.
 *
 * Output: ReelsFromReviewsResult — a Seedance-ready script per review, plus
 * a pre-assembled FB caption embedding the review quote.
 */

import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'
import type { GBPReview } from '@/lib/places/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewReelScript {
  /** The source review that inspired this Reel. */
  source_review: {
    author_name: string
    rating: number
    text: string
    relative_time_description: string
  }

  /** Short title for this Reel concept (max 8 words). */
  title: string

  /** Opening hook — should surface or tease the review insight (max 15 words). */
  hook_line: string

  /**
   * 9-panel scene structure — same format as ReelsScript.scene_structure.
   * Panels 1–8 build the customer story arc; Panel 9 is always the brand card.
   * Format: "Thumbnail: 9:16 vertical — [...] | STORY: [...] | CAMERA: [...] | MOOD: [...]"
   */
  scene_structure: string[]

  /** 8 short panel titles for Panels 1–8 (Panel 9 is always "Brand Card"). */
  scene_names: string[]

  /** Visual style direction (same 4-key shape as ReelsScript.style_guide). */
  style_guide: {
    overall_look: string
    color_grade: string
    lighting: string
    atmosphere: string
  }

  /**
   * Complete Seedance 2.0 v2.0 Standard prompt (450–700 words).
   * The testimonial_start opening hook is used: authentic real-world setting,
   * eye-level direct, slight handheld authenticity — genuine, unscripted, real.
   */
  seedance_i2v_prompt: string

  /**
   * Facebook Reels caption with the review quote embedded.
   * AU/NZ English. 2–3 short paragraphs. CTA at end. 5–8 hashtags.
   */
  fb_caption: string

  /** Hashtag array (5–8 tags). */
  hashtags: string[]
}

export interface ReelsFromReviewsResult {
  reels: ReviewReelScript[]
  /** ISO timestamp when generation ran. */
  generated_at: string
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(brandName: string, industry: string): string {
  return `You are a senior Facebook Reels director and social proof storyteller for AU/NZ brands in the ${industry} industry.

Your job is to transform real Google Business Profile customer reviews into compelling 15-second Facebook Reels scripts that feel authentic, emotional, and trustworthy — NOT like typical ad creative.

The brand is: ${brandName}

Each Reel follows the "testimonial_start" opening hook style:
- Scene 1: authentic real-environment framing, unpolished feel, eye-level direct
- The review's key insight or emotion drives the visual arc
- No glossy cinematic open — start raw and real, then build to resolution
- The brand card at Scene 9 feels EARNED, not inserted

Core rules:
- ALL text fields must be in English only — zero Chinese characters
- NO human faces or bodies in any visual description (silhouettes / hands / empty scenes only)
- NO phone numbers, websites, or contact info inside the video (go in caption only)
- scene_names: EXACTLY 8 strings
- scene_structure: EXACTLY 9 strings (Panels 1–8 + Brand Panel)
- seedance_i2v_prompt: 450–700 words following the v2.0 standard template exactly
- Timing must total EXACTLY 15.0 seconds
- All text overlays are bottom subtitles (lower 20% of screen), one line only — never centre-screen
- The review quote appears as a subtitle overlay in the hero scene (typically Scene 4–5)

Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`
}

// ─── User prompt ──────────────────────────────────────────────────────────────

function buildUserPrompt(
  reviews: GBPReview[],
  brandName: string,
  industry: string,
  city: string,
): string {
  const reviewsBlock = reviews.map((r, i) => `
REVIEW ${i + 1} — ${r.author_name} (${r.rating}/5 stars, ${r.relative_time_description})
"${r.text}"
`).join('\n')

  return `## Brand: ${brandName}
Industry: ${industry}
Location: ${city}

## Customer Reviews to Transform into Reels

${reviewsBlock}

## Task

For EACH of the ${reviews.length} review${reviews.length > 1 ? 's' : ''} above, produce one Reel script as a JSON object in an array.

Each object must have ALL of these keys:

1. source_review: { author_name, rating, text, relative_time_description }

2. title: string — short concept title referencing the review theme (max 8 words)

3. hook_line: string — opening hook (max 15 words). Must create immediate curiosity based on what the reviewer experienced. Examples: "What made Sarah book her second trip in 3 months…", "5 stars 3 months in a row — here's why"

4. scene_names: string[] — EXACTLY 8 strings. Short panel titles telling the customer journey arc.
   Suggested arc: ["The Question", "The Decision Moment", "First Impression", "The Experience", "The Moment That Mattered", "The Proof", "The Transformation", "Your Turn"]
   Adapt to the specific review's emotional journey.

5. scene_structure: string[] — EXACTLY 9 strings.
   Format for Panels 1–8: "Thumbnail: 9:16 vertical — [vivid environment description, NO human faces] | STORY: [text overlay — first 3 panels tease, Panel 4-5 embed review quote fragment, final panels CTA] | CAMERA: [camera action] | MOOD: [emotional tone]"
   Panel 9: "BRAND PANEL: [brand color hex] background. ${brandName} in large serif. [key benefit 1]. [key benefit 2]. No faces."
   Panel 4 or 5 MUST embed a short direct quote from the review as the STORY overlay (e.g. "STORY: \\"Best experience I've had in years\\" — ${city} customer").

6. style_guide: { overall_look, color_grade, lighting, atmosphere }
   - Lean warm, authentic, slightly documentary — NOT polished ad aesthetic
   - Color grade should feel like the destination or experience (e.g. "warm amber-gold for tourism, soft morning light with cool shadows")

7. seedance_i2v_prompt: string — Complete Seedance 2.0 v2.0 Standard (450–700 words).
   MUST follow this EXACT structure:

   SEEDANCE 2.0 VIDEO GENERATION PROMPT (v2.0 STANDARD)
   ==============================================================

   PROJECT METADATA:
   - Brand: ${brandName}
   - Campaign: [reel title]
   - Duration: EXACTLY 15 seconds.
   - Format: 9:16 vertical (Reels)
   - Style: authentic social proof, testimonial-driven, warm and real

   GLOBAL SPECIFICATIONS:
   Color Grade: [specific warm documentary color with emotional reasoning]
   Lighting: [authentic, slightly imperfect — real-world light, not studio]
   Music: [emotional arc: starts curious/intimate → builds hope → peaks at review reveal → resolves warmly and confidently]
   Pacing: [starts measured and authentic, accelerates at the review reveal, settles warmly at brand card]

   ⚠️ CRITICAL START INSTRUCTION:
   The video MUST BEGIN with Scene 1 — [exact authentic opening from scene_structure[0]].
   Frame 1 of the video = [precise first-frame description matching the review's emotional context].
   Do NOT start with storyboard preview, showroom, or polished cinematic sweep.

   =====================================

   SCENE 1 (0.0–Xs) | [scene_names[0]]
   Visual: [authentic real-world environment — no faces, no studio feel]
   Action: [slight handheld, eye-level, intimate framing at 0.0s]
   Audio: [subtle ambient sound + understated music intro]
   Text Overlay: "[hook_line]" — white sans-serif SUBTITLE at VERY BOTTOM, appears at 0.0s. One line only.
   Color Grade: [documentary warm with emotional reasoning]
   Mood: curious, real, unpolished

   [SCENES 2–8 following the same structure, with review quote appearing as subtitle in Scene 4 or 5]

   BRAND PANEL (12.0–15.0s) | Brand End Card
   Visual: [${brandName} brand colors, logo, tagline — clean and premium]
   Action: Hold static for 3 seconds.
   Audio: Music resolves warmly and fades.
   Text Overlay: "[brand tagline]" — white sans-serif SUBTITLE at VERY BOTTOM. One line only.
   Color Grade: Clean, premium, on-brand.
   Mood: Confident, warm, resolved.

   =====================================

   TIMING VERIFICATION (MUST ADD TO EXACTLY 15.0s):
   [Scene 1 through Scene 8 timings + Brand Panel 3.0s = 15.0s ✓]

   =====================================

   FINAL CHECKLIST:
   ☑ Video starts at 0.0s with authentic testimonial-style opening
   ☑ Review quote appears as subtitle in Scene 4 or 5
   ☑ ALL text overlays are subtitles at the very bottom of screen (lower 20%)
   ☑ Total duration is exactly 15.0 seconds
   ☑ No storyboard preview frame at beginning
   ☑ No phone numbers, websites, or contact details in video
   ☑ Music emotional arc maps to review story progression
   ☑ Color grading supports authentic documentary feel
   ==============================================================

8. fb_caption: string — Facebook Reels caption.
   - AU/NZ English
   - 2–3 short paragraphs
   - Paragraph 1: open with a question or the emotional insight from the review
   - Paragraph 2: embed the review quote in quotation marks with attribution (first name + "— ${city} customer")
   - Paragraph 3: CTA connecting to what the viewer can experience
   - End with 5–8 relevant hashtags

9. hashtags: string[] — 5–8 hashtags (standalone array). AU/NZ relevant.

Return a JSON array of ${reviews.length} objects following the schema above.`
}

// ─── Generator ────────────────────────────────────────────────────────────────

export interface ReviewsToReelsOptions {
  brandName: string
  industry: string
  city: string
}

export async function generateReelsFromReviews(
  reviews: GBPReview[],
  options: ReviewsToReelsOptions,
): Promise<ReelsFromReviewsResult> {
  const { brandName, industry, city } = options

  // Filter to reviews that have meaningful text (≥20 chars)
  const usable = reviews.filter(r => r.text && r.text.trim().length >= 20)
  if (usable.length === 0) {
    return { reels: [], generated_at: new Date().toISOString() }
  }

  const result = await callClaudeWithDocs({
    systemPrompt: buildSystemPrompt(brandName, industry),
    userMessage: buildUserPrompt(usable, brandName, industry, city),
    maxOutputTokens: Math.min(8000, usable.length * 2500),
  })

  const reels = parseJsonResponse<ReviewReelScript[]>(result.text)

  // Patch scene_structure / scene_names to always have correct lengths
  const normalised = reels.map(reel => {
    const sceneStructure = Array.isArray(reel.scene_structure) ? reel.scene_structure : []
    while (sceneStructure.length < 9) sceneStructure.push('')
    const sceneNames = Array.isArray(reel.scene_names) ? reel.scene_names.slice(0, 8) : []
    while (sceneNames.length < 8) sceneNames.push(`Scene ${sceneNames.length + 1}`)

    return {
      ...reel,
      scene_structure: sceneStructure.slice(0, 9),
      scene_names: sceneNames,
    }
  })

  return {
    reels: normalised,
    generated_at: new Date().toISOString(),
  }
}
