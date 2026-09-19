// Pre-publish content guard thresholds.
// Platform-level defaults; env vars override per deployment. No client- or
// industry-specific values belong here — per-post language intent comes from
// the caller (brief/campaign metadata), not from this file.

export type GuardLanguage = 'en' | 'zh'

export interface ContentGuardConfig {
  /** Copy Judge probability (0–1) at or above which a cliché opener fails. */
  clicheThreshold: number
  /** In a Chinese-target text, the longest run of consecutive Latin words allowed
   *  inside a Chinese sentence (covers brand / product names like "NAL Express"). */
  maxEmbeddedLatinWords: number
  /** In an English-target text, the number of CJK characters tolerated inside an
   *  English sentence before it counts as an untranslated fragment. */
  maxEmbeddedCjkChars: number
  /** Copy Judge request timeout. */
  judgeTimeoutMs: number
}

export const DEFAULT_CONTENT_GUARD_CONFIG: ContentGuardConfig = {
  clicheThreshold: 0.8,
  maxEmbeddedLatinWords: 3,
  maxEmbeddedCjkChars: 0,
  judgeTimeoutMs: 8000,
}

function readNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[content-guard] ignoring out-of-range config value "${raw}" (allowed ${min}–${max})`)
    return fallback
  }
  return n
}

/** Resolve config from env (read at call time, not module load). */
export function resolveContentGuardConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<ContentGuardConfig> = {},
): ContentGuardConfig {
  const d = DEFAULT_CONTENT_GUARD_CONFIG
  return {
    clicheThreshold:       readNumber(env.CONTENT_GUARD_CLICHE_THRESHOLD, d.clicheThreshold, 0, 1),
    maxEmbeddedLatinWords: readNumber(env.CONTENT_GUARD_MAX_EMBEDDED_LATIN_WORDS, d.maxEmbeddedLatinWords, 0, 50),
    maxEmbeddedCjkChars:   readNumber(env.CONTENT_GUARD_MAX_EMBEDDED_CJK_CHARS, d.maxEmbeddedCjkChars, 0, 50),
    judgeTimeoutMs:        readNumber(env.CONTENT_GUARD_JUDGE_TIMEOUT_MS, d.judgeTimeoutMs, 500, 60000),
    ...overrides,
  }
}
