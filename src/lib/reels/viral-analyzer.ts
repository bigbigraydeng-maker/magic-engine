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
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { supabaseAdmin } from '@/lib/supabase'

const execAsync = promisify(exec)
const ANALYSIS_MODEL = 'gemini-2.0-flash'

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

export interface ViralAnalysisResult {
  style_scores: StyleScores
  style_tags: string[]
  style_description: string
  persona_fit: string[]
  key_techniques: string[]
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

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "style_scores": { "energy": 0, "luxury": 0, "authenticity": 0, "emotional": 0, "humor": 0, "urgency": 0, "offer_signal": 0 },
  "style_tags": [],
  "style_description": "",
  "persona_fit": [],
  "key_techniques": []
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

async function analyzeYouTubeVideo(url: string, apiKey: string): Promise<ViralAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: ANALYSIS_MODEL })

  const result = await model.generateContent([
    {
      fileData: {
        fileUri: url,
        mimeType: 'video/*',
      },
    },
    { text: ANALYSIS_PROMPT },
  ])

  return parseAnalysisResponse(result.response.text())
}

// ─── Non-YouTube: yt-dlp download → Gemini Files API ─────────────────────────

async function downloadAndAnalyzeVideo(url: string, apiKey: string): Promise<ViralAnalysisResult> {
  const tmpFile = path.join(tmpdir(), `viral_ref_${Date.now()}.mp4`)

  try {
    await execAsync(
      `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]/best" -o "${tmpFile}" "${url}"`,
      { timeout: 120_000 }
    )

    const fileManager = new GoogleAIFileManager(apiKey)
    const uploadResult = await fileManager.uploadFile(tmpFile, {
      mimeType: 'video/mp4',
      displayName: `viral_ref_${Date.now()}`,
    })

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: ANALYSIS_MODEL })

    const result = await model.generateContent([
      {
        fileData: {
          fileUri: uploadResult.file.uri,
          mimeType: 'video/mp4',
        },
      },
      { text: ANALYSIS_PROMPT },
    ])

    // Clean up uploaded file (non-blocking, best-effort)
    fileManager.deleteFile(uploadResult.file.name).catch(() => {})

    return parseAnalysisResponse(result.response.text())
  } finally {
    unlink(tmpFile).catch(() => {})
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
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyze a single viral video reference.
 * Updates `viral_reference_library` row with results (or error).
 */
export async function analyzeViralReference(referenceId: string, url: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  await supabaseAdmin
    .from('viral_reference_library')
    .update({ analysis_status: 'analyzing' })
    .eq('id', referenceId)

  try {
    const platform = detectPlatform(url)
    const result = platform === 'youtube'
      ? await analyzeYouTubeVideo(url, apiKey)
      : await downloadAndAnalyzeVideo(url, apiKey)

    await supabaseAdmin
      .from('viral_reference_library')
      .update({
        style_scores: result.style_scores,
        style_tags: result.style_tags,
        style_description: result.style_description,
        persona_fit: result.persona_fit,
        key_techniques: result.key_techniques,
        analysis_status: 'done',
        analyzed_at: new Date().toISOString(),
      })
      .eq('id', referenceId)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('viral_reference_library')
      .update({ analysis_status: 'error', analysis_error: errorMsg })
      .eq('id', referenceId)
    throw err
  }
}
