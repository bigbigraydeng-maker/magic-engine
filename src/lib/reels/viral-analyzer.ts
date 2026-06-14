/**
 * Viral Reference Analyzer — Phase 11.0-R
 *
 * Downloads and analyzes viral marketing videos using Gemini 2.0 Flash.
 * Scores each video on 7 style dimensions and extracts key techniques.
 *
 * YouTube: URL passed directly to Gemini (no download needed).
 * Facebook/other: yt-dlp download → Gemini Files API upload → analyze → cleanup.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { unlink, access } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchYouTubeMetadata } from './youtube-metadata'

const execAsync = promisify(exec)
const ANALYSIS_MODEL = 'gemini-2.5-flash'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StyleScores {
  energy: number
  luxury: number
  authenticity: number
  emotional: number
  humor: number
  urgency: number
  offer_signal: number
}

export interface OpeningHook {
  type: string    // e.g. "visual_shock" | "ugc_selfie" | "text_overlay_question" | ...
  script: string  // verbatim text or voiceover in first 1.5s (empty string if none)
  feel: string    // "abrupt-cut" | "smooth-reveal"
}

export interface ViralAnalysisResult {
  style_scores: StyleScores
  style_tags: string[]
  style_description: string
  persona_fit: string[]
  key_techniques: string[]
  detected_content_goal: 'brand' | 'sales' | 'ugc' | 'education'
  detected_industry: string
  opening_hook: OpeningHook
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const ANALYSIS_PROMPT = `Analyze this marketing video and score it on 7 style dimensions.

Rate each dimension 0–10:
- energy: editing pace/dynamism (3=slow cinematic, 8=fast cuts)
- luxury: premium production feel (1=rough UGC, 9=high-end studio)
- authenticity: realness (0=polished hard-sell, 10=raw UGC)
- emotional: emotional resonance (1=flat informational, 9=deeply moving)
- humor: lightness/fun (0=serious, 8=highly comedic)
- urgency: CTA pressure (0=pure brand, 8+=scarcity/limited-time)
- offer_signal: product offer strength (0=pure lifestyle, 10=strong explicit offer)

Also provide:
- style_tags: 3–6 short descriptive tags (e.g. "fast-cut", "outdoor", "luxury-resort")
- style_description: 1–2 sentences describing the video's style and why it works
- persona_fit: which buyer personas this targets (choose from: "Luxury Aspirational", "Calm Explorer", "Practical Buyer - Planner", "Practical Buyer - Converter")
- key_techniques: 2–4 specific production/editing techniques (e.g. "drone-aerial-opening", "testimonial-overlay", "ugc-selfie-style")
- detected_content_goal: classify the video's PRIMARY marketing intent. Choose ONE:
    * "brand"     — pure brand/inspiration content, no specific offer or CTA, builds desire
    * "sales"     — pushes a specific product/tour/package with clear CTA (book/buy/reserve), often urgency or pricing
    * "ugc"       — user-generated style content, authentic testimonial-like, social proof
    * "education" — how-to/tips/explainer content that teaches viewers
- detected_industry: identify the PRIMARY industry of this video. Use lowercase snake_case.
    Common values: "travel", "flooring", "real_estate", "food", "fashion", "fitness", "tech", "beauty".
    If none fit, use a short descriptive label (e.g. "home_improvement", "finance").
- opening_hook: analyze what happens in the FIRST 1.5 SECONDS of this video (the scroll-stop moment).
    * type: choose ONE: "visual_shock" (dramatic unexpected visuals), "ugc_selfie" (creator speaks direct to camera),
             "text_overlay_question" (bold on-screen question or statement), "product_reveal" (immediate product close-up),
             "testimonial_start" (real person speaking), "sound_cue" (audio hook like music drop or voice),
             "problem_statement" (surfaces a pain point), "scenic_beauty" (stunning landscape/environment reveal)
    * script: the verbatim text overlay or first spoken words in those 1.5s (empty string "" if none)
    * feel: "abrupt-cut" (jump-cut, pattern interrupt) OR "smooth-reveal" (gradual, cinematic open)

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "style_scores": { "energy": 0, "luxury": 0, "authenticity": 0, "emotional": 0, "humor": 0, "urgency": 0, "offer_signal": 0 },
  "style_tags": [],
  "style_description": "",
  "persona_fit": [],
  "key_techniques": [],
  "detected_content_goal": "brand",
  "detected_industry": "",
  "opening_hook": { "type": "", "script": "", "feel": "" }
}`

// ─── Platform detection ───────────────────────────────────────────────────────

export function detectPlatform(url: string): 'youtube' | 'facebook' | 'tiktok' | 'instagram' | 'unknown' {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube'
  if (/facebook\.com|fb\.com|fb\.watch/.test(url)) return 'facebook'
  if (/tiktok\.com/.test(url)) return 'tiktok'
  if (/instagram\.com/.test(url)) return 'instagram'
  return 'unknown'
}

// ─── YouTube: direct URL (no download) ───────────────────────────────────────

const GEMINI_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ])
}

async function analyzeYouTubeVideo(url: string, apiKey: string): Promise<ViralAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: ANALYSIS_MODEL })

  const result = await withTimeout(
    model.generateContent([
      { fileData: { fileUri: url, mimeType: 'video/*' } },
      { text: ANALYSIS_PROMPT },
    ]),
    GEMINI_TIMEOUT_MS,
    'analyzeYouTubeVideo',
  )

  return parseAnalysisResponse(result.response.text())
}

// ─── Local file → Gemini Files API (used by yt-dlp download AND direct upload) ─

export async function analyzeLocalVideoFile(
  filePath: string,
  apiKey: string,
  mimeType: string = 'video/mp4',
): Promise<ViralAnalysisResult> {
  const fileManager = new GoogleAIFileManager(apiKey)
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: `viral_ref_${Date.now()}`,
  })

  // Gemini Files API: file may need a moment to transition from PROCESSING to ACTIVE
  let fileInfo = uploadResult.file
  let attempts = 0
  while (fileInfo.state === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000))
    fileInfo = await fileManager.getFile(fileInfo.name)
    attempts++
  }
  if (fileInfo.state !== 'ACTIVE') {
    throw new Error(`Gemini file did not become ACTIVE (state: ${fileInfo.state})`)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: ANALYSIS_MODEL })

  const result = await withTimeout(
    model.generateContent([
      { fileData: { fileUri: fileInfo.uri, mimeType } },
      { text: ANALYSIS_PROMPT },
    ]),
    GEMINI_TIMEOUT_MS,
    'analyzeLocalVideoFile',
  )

  // Clean up uploaded file (non-blocking, best-effort)
  fileManager.deleteFile(fileInfo.name).catch(() => {})

  return parseAnalysisResponse(result.response.text())
}

// ─── Non-YouTube URL: yt-dlp download → analyzeLocalVideoFile ────────────────

async function downloadAndAnalyzeVideo(url: string, apiKey: string): Promise<ViralAnalysisResult> {
  const tmpFile = path.join(tmpdir(), `viral_ref_${Date.now()}.mp4`)

  // yt-dlp lives in project root on Render (downloaded by build command).
  // Falls back to system PATH for local dev where yt-dlp is installed globally.
  const ytDlpBin = path.join(process.cwd(), 'yt-dlp')
  let cmd = 'yt-dlp'
  try {
    await access(ytDlpBin)
    cmd = `"${ytDlpBin}"`
  } catch {
    // local binary missing — fall back to PATH
  }

  try {
    await execAsync(
      `${cmd} -f "best[height<=720][ext=mp4]/best[height<=720]/best" -o "${tmpFile}" "${url}"`,
      { timeout: 180_000 }
    )

    return await analyzeLocalVideoFile(tmpFile, apiKey, 'video/mp4')
  } finally {
    unlink(tmpFile).catch(() => {})
  }
}

// ─── Direct upload entry: analyze a video file already on disk ───────────────

/**
 * Analyze a video that was uploaded directly (not via URL).
 * Caller saves the file to disk first, then calls this with the path.
 * The file is NOT deleted by this function — caller manages cleanup.
 */
export async function analyzeUploadedReference(
  referenceId: string,
  filePath: string,
  mimeType: string = 'video/mp4',
): Promise<void> {
  const saveError = async (msg: string) => {
    try {
      await supabaseAdmin
        .from('viral_reference_library')
        .update({ analysis_status: 'error', analysis_error: msg })
        .eq('id', referenceId)
    } catch {
      // best-effort status update
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    await saveError('GEMINI_API_KEY not configured on server')
    return
  }

  await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'analyzing' })
    .eq('id', referenceId)

  try {
    const result = await analyzeLocalVideoFile(filePath, apiKey, mimeType)

    // Uploaded files have no YouTube metadata
    await finalizeAnalysis(referenceId, result, {
      view_count: null,
      like_count: null,
      published_at: null,
      video_title: null,
      channel_title: null,
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[viral-analyzer/upload] ${referenceId} failed:`, errorMsg)
    await saveError(errorMsg)
  }
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseAnalysisResponse(raw: string): ViralAnalysisResult {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  const parsed = JSON.parse(stripped)
  const s = parsed.style_scores ?? {}

  const clamp = (v: unknown) => Math.min(10, Math.max(0, Number(v) || 0))

  const validGoals = ['brand', 'sales', 'ugc', 'education'] as const
  const rawGoal = String(parsed.detected_content_goal ?? '').toLowerCase()
  const detected_content_goal = (validGoals as readonly string[]).includes(rawGoal)
    ? (rawGoal as 'brand' | 'sales' | 'ugc' | 'education')
    : 'brand'

  const rawIndustry = typeof parsed.detected_industry === 'string'
    ? parsed.detected_industry.toLowerCase().trim()
    : ''

  const rawHook = parsed.opening_hook && typeof parsed.opening_hook === 'object'
    ? parsed.opening_hook as Record<string, unknown>
    : {}
  const opening_hook: OpeningHook = {
    type:   typeof rawHook.type   === 'string' ? rawHook.type.trim()   : '',
    script: typeof rawHook.script === 'string' ? rawHook.script.trim() : '',
    feel:   typeof rawHook.feel   === 'string' ? rawHook.feel.trim()   : '',
  }

  return {
    style_scores: {
      energy: clamp(s.energy),
      luxury: clamp(s.luxury),
      authenticity: clamp(s.authenticity),
      emotional: clamp(s.emotional),
      humor: clamp(s.humor),
      urgency: clamp(s.urgency),
      offer_signal: clamp(s.offer_signal),
    },
    style_tags: Array.isArray(parsed.style_tags) ? parsed.style_tags : [],
    style_description: typeof parsed.style_description === 'string' ? parsed.style_description : '',
    persona_fit: Array.isArray(parsed.persona_fit) ? parsed.persona_fit : [],
    key_techniques: Array.isArray(parsed.key_techniques) ? parsed.key_techniques : [],
    detected_content_goal,
    detected_industry: rawIndustry,
    opening_hook,
  }
}

// ─── Shared finalize: compute derived fields + save analysis to DB ──────────

const DEFAULT_VIEW_THRESHOLD = 5000

/**
 * Save analysis results to DB with derived fields:
 * - content_goal: keep user override if provided, else use detected
 * - is_learnable: false if our_video OR (view_count known AND < threshold)
 */
async function finalizeAnalysis(
  referenceId: string,
  result: ViralAnalysisResult,
  metadata: { view_count: number | null; like_count: number | null; published_at: string | null; video_title: string | null; channel_title: string | null },
): Promise<void> {
  // Read existing row to honor user-set fields (content_goal override, is_our_video)
  const { data: existing } = await supabaseAdmin
    .from('viral_reference_library')
    .select('content_goal, is_our_video, view_threshold_min')
    .eq('id', referenceId)
    .maybeSingle()

  const isOurVideo = existing?.is_our_video ?? false
  const userGoal = existing?.content_goal as string | null
  const threshold = (existing?.view_threshold_min ?? DEFAULT_VIEW_THRESHOLD) as number

  // content_goal: use detected unless user explicitly picked something other than 'brand' (the default)
  // (if user picked 'brand' it might just be the default — we trust Gemini)
  const finalGoal = userGoal && userGoal !== 'brand' ? userGoal : result.detected_content_goal

  // is_learnable: our own videos NEVER, low-view videos NEVER
  const viewCountKnown = metadata.view_count !== null
  const isLearnable = !isOurVideo && (!viewCountKnown || (metadata.view_count ?? 0) >= threshold)

  await supabaseAdmin
    .from('viral_reference_library')
    .update({
      style_scores: result.style_scores,
      style_tags: result.style_tags,
      style_description: result.style_description,
      persona_fit: result.persona_fit,
      key_techniques: result.key_techniques,
      detected_content_goal: result.detected_content_goal,
      detected_industry: result.detected_industry || null,
      opening_hook: (result.opening_hook.type) ? result.opening_hook : null,
      content_goal: finalGoal,
      is_learnable: isLearnable,
      view_count:    metadata.view_count,
      like_count:    metadata.like_count,
      published_at:  metadata.published_at,
      video_title:   metadata.video_title,
      channel_title: metadata.channel_title,
      analysis_status: 'done',
      analyzed_at: new Date().toISOString(),
    })
    .eq('id', referenceId)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyze a single viral video reference.
 * Updates `viral_reference_library` row with results (or error).
 */
export async function analyzeViralReference(referenceId: string, url: string): Promise<void> {
  // Helper: always persist errors to DB so UI reflects actual state
  const saveError = async (msg: string) => {
    try {
      await supabaseAdmin
        .from('viral_reference_library')
        .update({ analysis_status: 'error', analysis_error: msg })
        .eq('id', referenceId)
    } catch {
      // best-effort status update
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    await saveError('GEMINI_API_KEY not configured on server')
    return
  }

  await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'analyzing' })
    .eq('id', referenceId)

  try {
    const platform = detectPlatform(url)
    const result = platform === 'youtube'
      ? await analyzeYouTubeVideo(url, apiKey)
      : await downloadAndAnalyzeVideo(url, apiKey)

    // Fetch YouTube metadata (returns nulls for non-YouTube or no API key)
    const metadata = await fetchYouTubeMetadata(url)

    await finalizeAnalysis(referenceId, result, metadata)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[viral-analyzer] ${referenceId} failed:`, errorMsg)
    await saveError(errorMsg)
  }
}
