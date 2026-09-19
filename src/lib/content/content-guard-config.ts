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
  if (!/^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    console.warn(`[content-guard] ignoring non-decimal config value "${raw}"`)
    return fallback
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[content-guard] ignoring out-of-range config value "${raw}" (allowed ${min}–${max})`)
    return fallback
  }
  return n
}

const BOUNDS: Record<keyof ContentGuardConfig, [number, number]> = {
  clicheThreshold:       [0.5, 1],
  maxEmbeddedLatinWords: [0, 50],
  maxEmbeddedCjkChars:   [0, 50],
  judgeTimeoutMs:        [500, 60000],
}

const ENV_KEYS: Record<keyof ContentGuardConfig, string> = {
  clicheThreshold:       'CONTENT_GUARD_CLICHE_THRESHOLD',
  maxEmbeddedLatinWords: 'CONTENT_GUARD_MAX_EMBEDDED_LATIN_WORDS',
  maxEmbeddedCjkChars:   'CONTENT_GUARD_MAX_EMBEDDED_CJK_CHARS',
  judgeTimeoutMs:        'CONTENT_GUARD_JUDGE_TIMEOUT_MS',
}

/**
 * Resolve config from env (read at call time, not module load). Env values and
 * code overrides go through the same bounds check — a NaN / out-of-range value
 * falls back to the default instead of silently disabling a check.
 */
export function resolveContentGuardConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<ContentGuardConfig> = {},
): ContentGuardConfig {
  const out = { ...DEFAULT_CONTENT_GUARD_CONFIG }
  for (const key of Object.keys(BOUNDS) as Array<keyof ContentGuardConfig>) {
    const [min, max] = BOUNDS[key]
    const override = overrides[key]
    const raw = override !== undefined ? String(override) : env[ENV_KEYS[key]]
    out[key] = readNumber(raw, out[key], min, max)
  }
  return out
}
