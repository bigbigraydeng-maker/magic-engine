/**
 * Reels Studio — prompt generator
 *
 * Uses Claude (Strategy Engine) to produce four pieces of content from a
 * Master Brief + optional Campaign Brief:
 *
 *   1. opening_frame_prompt  — AI image-gen prompt for the opening frame
 *   2. closing_frame_prompt  — AI image-gen prompt for the closing frame
 *   3. i2v_video_prompt      — Image-to-Video prompt (Opening / Middle / Closing sections)
 *   4. fb_caption            — Facebook Reels caption with hashtags
 *
 * Reference: ROADMAP.md P8.R.3
 */

import {
  callClaudeWithDocs,
  callClaudeChat,
  MODEL_SONNET,
} from '@/lib/anthropic/client'

// ─── Robust JSON parser ───────────────────────────────────────────────────────

/**
 * Extract and parse the first complete JSON object from Claude's response.
 *
 * Why not use the shared parseJsonResponse?
 * It relies on lastIndexOf('}') which breaks when field values contain '}'.
 * For example, fb_caption might contain "Use our service {today}!" — which
 * causes lastIndexOf to land inside the string, producing invalid JSON.
 *
 * This implementation uses balanced-brace counting with in-string awareness,
 * then sanitises literal control characters before JSON.parse.
 */
function parseReelsJson(raw: string): ReelsContent {
  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  // 2. Find the first complete JSON object using balanced-brace counting.
  //    We track whether we're inside a string to avoid counting braces inside values.
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]

    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === '{') {
      if (start === -1) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) { end = i; break }
    }
  }

  if (start === -1 || end === -1) {
    throw new Error(
      `No complete JSON object found in Claude response. Preview: ${raw.slice(0, 300)}`
    )
  }

  const jsonStr = stripped.slice(start, end + 1)

  // 3. Sanitise literal control characters inside string values
  //    (real \n / \r / \t that Claude sometimes emits instead of \\n etc.)
  const sanitized = sanitiseControlChars(jsonStr)

  let parsed: unknown
  try {
    parsed = JSON.parse(sanitized)
  } catch (e) {
    throw new Error(
      `JSON.parse failed after sanitisation. Error: ${e}. Excerpt: ${sanitized.slice(0, 400)}`
    )
  }

  // 4. Normalise wrapper shapes Claude sometimes emits instead of the flat object.
  //    e.g. { "reels": [{ ... }] } or { "content": { ... } }
  return normalizeReelsShape(parsed)
}

/**
 * Unwrap Claude's occasionally-wrong envelope shapes to the flat ReelsContent we expect.
 *   { reels: [ { opening_frame_prompt, ... } ] }  → inner object
 *   { content: { opening_frame_prompt, ... } }     → inner object
 *   { opening_frame_prompt, ... }                  → as-is
 */
function normalizeReelsShape(parsed: unknown): ReelsContent {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Parsed JSON is not an object')
  }
  const obj = parsed as Record<string, unknown>

  // Array wrapper: { reels: [{ ... }] }
  if (Array.isArray(obj.reels) && obj.reels.length > 0) {
    return obj.reels[0] as ReelsContent
  }

  // Single-key wrapper: { content: {...} } | { result: {...} } | { data: {...} }
  for (const key of ['content', 'result', 'output', 'data']) {
    const val = obj[key]
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const inner = val as Record<string, unknown>
      if (inner.opening_frame_prompt) return inner as unknown as ReelsContent
    }
  }

  // Already the flat shape we want
  return obj as unknown as ReelsContent
}

/** Replace literal control characters inside JSON string values with escape sequences. */
function sanitiseControlChars(str: string): string {
  let inString = false
  let escaped = false
  let result = ''

  for (const char of str) {
    if (escaped) { result += char; escaped = false; continue }
    if (char === '\\' && inString) { escaped = true; result += char; continue }
    if (char === '"') { inString = !inString; result += char; continue }

    if (inString) {
      if (char === '\n') { result += '\\n'; continue }
      if (char === '\r') { result += '\\r'; continue }
      if (char === '\t') { result += '\\t'; continue }
      // Unicode line/paragraph separators
      if (char === ' ') { result += '\\u2028'; continue }
      if (char === ' ') { result += '\\u2029'; continue }
    }

    result += char
  }

  return result
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReelsContent {
  opening_frame_prompt: string
  closing_frame_prompt: string
  i2v_video_prompt: string
  fb_caption: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── System prompts ───────────────────────────────────────────────────────────

const SYSTEM_GENERATE = `You are a Reels content strategist for AU/NZ markets.
Given a brand brief and optional campaign context, generate four pieces of content for a Facebook Reels.

CRITICAL OUTPUT RULES:
- Respond with ONLY a single flat JSON object — no markdown, no code fences, no explanation.
- The JSON must have exactly these four keys at the top level: opening_frame_prompt, closing_frame_prompt, i2v_video_prompt, fb_caption.
- Do NOT wrap the object in an array. Do NOT add any wrapper keys like "reels", "content", "result", or "data".
- Do NOT use ` + '```' + ` code fences. Output raw JSON only.`

const SYSTEM_REFINE = `You are a Reels content strategist helping refine specific fields.
The user will ask to change one or more fields. Return ONLY the updated JSON object with ALL four fields
(even unchanged ones). No markdown, no explanation.`

// ─── Initial generation ───────────────────────────────────────────────────────

/**
 * Generate the four Reels content pieces from briefs.
 *
 * @param masterBriefText   Serialised master brief (plain text or JSON string)
 * @param campaignContext   Optional campaign brief context (plain text)
 * @param brandName         Client brand name, injected into system prompt
 */
export async function generateReelsContent(params: {
  masterBriefText: string
  campaignContext?: string
  brandName: string
  qualityHint?: string
  viralStyleHint?: string
}): Promise<ReelsContent> {
  const { masterBriefText, campaignContext, brandName, qualityHint, viralStyleHint } = params

  const campaignSection = campaignContext
    ? `\n\n## Campaign Brief\n${campaignContext}`
    : ''

  const viralSection = viralStyleHint
    ? `\n\n${viralStyleHint}`
    : ''

  const qualitySection = qualityHint
    ? `\n\n## Quality Improvement Notes (address these in the new version)\n${qualityHint}`
    : ''

  const userMessage = `## Master Brief for ${brandName}\n${masterBriefText}${campaignSection}${viralSection}${qualitySection}

Generate four pieces of Reels content in this exact JSON format:
{
  "opening_frame_prompt": "<detailed AI image generation prompt for the opening frame — vivid, cinematic, platform-optimised for 9:16>",
  "closing_frame_prompt": "<detailed AI image generation prompt for the closing/CTA frame>",
  "i2v_video_prompt": "Opening: <describe motion in opening frame> | Middle: <describe the visual journey, transitions, mood> | Closing: <describe final moments and CTA>",
  "fb_caption": "<compelling Facebook Reels caption in AU/NZ English, 2-3 short paragraphs, 5-8 relevant hashtags>"
}`

  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_GENERATE,
    userMessage,
    maxOutputTokens: 4096,
  })

  return parseReelsJson(result.text)
}

// ─── Chat refinement ──────────────────────────────────────────────────────────

/**
 * Apply a user's chat instruction to refine one or more fields.
 * Returns the full updated ReelsContent (all four fields).
 *
 * @param current      Current state of the four fields
 * @param history      Prior conversation turns (excluding the new user message)
 * @param userMessage  The new user instruction (e.g. "Change opening frame to Great Wall sunrise")
 */
export async function refineReelsContent(params: {
  current: ReelsContent
  history: ChatMessage[]
  userMessage: string
}): Promise<{ updated: ReelsContent; assistantReply: string }> {
  const { current, history, userMessage } = params

  // Build message thread: inject current state as system context, then prior turns
  const contextBlock = `Current Reels content:
${JSON.stringify(current, null, 2)}`

  const messages: ChatMessage[] = [
    // Synthetic assistant turn so Claude has current state in context
    { role: 'assistant', content: contextBlock },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const result = await callClaudeChat({
    systemPrompt: SYSTEM_REFINE,
    messages,
    maxOutputTokens: 4096,
  })

  const updated = parseReelsJson(result.text)

  // Build a human-readable summary of what changed
  const changed = (Object.keys(updated) as Array<keyof ReelsContent>).filter(
    k => updated[k] !== current[k]
  )

  const assistantReply =
    changed.length === 0
      ? 'No changes detected — the content looks the same.'
      : `Updated ${changed.join(', ')}.`

  return { updated, assistantReply }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialise a master_brief row to a readable text block for prompt injection.
 */
export function formatMasterBriefForPrompt(brief: Record<string, unknown>): string {
  const lines: string[] = []

  if (brief.brand_name)      lines.push(`Brand: ${brief.brand_name}`)
  if (brief.tagline)         lines.push(`Tagline: ${brief.tagline}`)
  if (brief.primary_audience) lines.push(`Audience: ${brief.primary_audience}`)
  if (brief.tone)            lines.push(`Tone: ${brief.tone}`)
  if (brief.visual_style)    lines.push(`Visual Style: ${brief.visual_style}`)

  if (brief.vi_color_palette) {
    const palette = typeof brief.vi_color_palette === 'string'
      ? brief.vi_color_palette
      : JSON.stringify(brief.vi_color_palette)
    lines.push(`Color Palette: ${palette}`)
  }
  if (brief.vi_typography) lines.push(`Typography: ${brief.vi_typography}`)
  if (Array.isArray(brief.vi_dos) && (brief.vi_dos as string[]).length > 0) {
    lines.push(`Visual Dos: ${(brief.vi_dos as string[]).join('; ')}`)
  }
  if (Array.isArray(brief.vi_donts) && (brief.vi_donts as string[]).length > 0) {
    lines.push(`Visual Don'ts: ${(brief.vi_donts as string[]).join('; ')}`)
  }

  if (Array.isArray(brief.pain_points) && brief.pain_points.length > 0) {
    lines.push(`Pain Points: ${(brief.pain_points as string[]).join('; ')}`)
  }

  if (brief.products && typeof brief.products === 'object') {
    try {
      const products = Array.isArray(brief.products)
        ? brief.products
        : [brief.products]
      const productSummary = products
        .map((p: Record<string, unknown>) => p.name ?? p.description ?? JSON.stringify(p))
        .join(', ')
      lines.push(`Products/Services: ${productSummary}`)
    } catch {
      // Skip products if they can't be serialised
    }
  }

  if (Array.isArray(brief.content_topics) && brief.content_topics.length > 0) {
    lines.push(`Content Topics: ${(brief.content_topics as string[]).join(', ')}`)
  }

  if (Array.isArray(brief.avoid_words) && brief.avoid_words.length > 0) {
    lines.push(`Avoid: ${(brief.avoid_words as string[]).join(', ')}`)
  }

  return lines.join('\n')
}

export { MODEL_SONNET }
export type { ReelsContent, ChatMessage }
