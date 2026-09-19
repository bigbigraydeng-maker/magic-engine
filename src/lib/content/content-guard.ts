// Pre-publish content guard — two checks the rubric's brand-fit score never catches:
//   1. language-consistency (deterministic): untranslated fragments of another
//      script inside a sentence, or whole sentences off the target language.
//   2. cliche-opener (Copy Judge): generic marketing clichés instead of concrete copy.
//
// Fail-closed: any Copy Judge error ⇒ `needsHumanReview`, never a silent pass.
// Pure function + one outbound read; no side effects, so no Inngest step needed.

import { askCopyJudge } from '@/lib/ai/copy-judge-client'
import { resolveContentGuardConfig } from '@/lib/content/content-guard-config'
import type { ContentGuardConfig, GuardLanguage } from '@/lib/content/content-guard-config'
import type { DimensionScore, RubricResult } from '@/lib/content/quality-rubric'

export type { GuardLanguage } from '@/lib/content/content-guard-config'

export const LANGUAGE_DIMENSION = 'language-consistency'
export const CLICHE_DIMENSION = 'cliche-opener'

export interface LanguageFinding {
  kind: 'embedded_fragment' | 'off_target_sentence'
  sentence: string
  fragment: string
}

export interface ContentGuardResult {
  /** fail = a check failed · unavailable = only the judge errored · pass = all clear */
  status: 'pass' | 'fail' | 'unavailable'
  needsHumanReview: boolean
  targetLanguage: GuardLanguage
  languageFindings: LanguageFinding[]
  clicheProbability: number | null
  judgeError: string | null
  dimensions: DimensionScore[]
  config: ContentGuardConfig
}

const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
const LATIN_WORD_RE = /[A-Za-z][A-Za-z'’-]*/g
const MAX_REPORTED_FINDINGS = 5
const JUDGE_SNIPPET_CHARS = 1500

const CLICHE_INSTRUCTIONS =
  'The post opens with or leans on generic marketing clichés (e.g. "Unlock the power of", ' +
  '"Elevate your", "Discover the magic", "Your gateway to success", "开启…新篇章", "赋能", "一站式解决方案") ' +
  'instead of saying something concrete.'

// ─── Language consistency (deterministic) ────────────────────────────────────

/** Strip markup and tokens that legitimately carry another script (URLs, tags, mentions). */
export function normaliseForLanguageCheck(text: string): string {
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&[a-z]+;/gi, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/[#@][^\s#@]+/g, ' ')
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[。！？!?\n；;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function countCjk(s: string): number {
  return (s.match(CJK_RUN_RE) ?? []).reduce((n, run) => n + run.length, 0)
}

function countLatinWords(s: string): number {
  return (s.match(LATIN_WORD_RE) ?? []).length
}

/** Longest run of Latin words not interrupted by CJK characters. */
function longestLatinRun(sentence: string): string[] {
  return sentence
    .split(CJK_RUN_RE)
    .map(seg => seg.match(LATIN_WORD_RE) ?? [])
    .reduce<string[]>((best, run) => (run.length > best.length ? run : best), [])
}

export function inferTargetLanguage(text: string): GuardLanguage {
  // ~2 CJK characters carry roughly one Latin word of meaning.
  return countCjk(text) / 2 > countLatinWords(text) ? 'zh' : 'en'
}

export function checkLanguageConsistency(
  content: string,
  config: ContentGuardConfig,
  targetLanguage?: GuardLanguage | null,
): { target: GuardLanguage; findings: LanguageFinding[] } {
  const text = normaliseForLanguageCheck(content)
  const target = targetLanguage ?? inferTargetLanguage(text)
  const findings: LanguageFinding[] = []

  for (const sentence of splitSentences(text)) {
    const cjk = countCjk(sentence)
    const latin = countLatinWords(sentence)
    if (target === 'en') {
      if (cjk <= config.maxEmbeddedCjkChars) continue
      const fragment = (sentence.match(CJK_RUN_RE) ?? []).join(' … ')
      findings.push({ kind: latin > 0 ? 'embedded_fragment' : 'off_target_sentence', sentence, fragment })
    } else if (cjk > 0) {
      const run = longestLatinRun(sentence)
      if (run.length > config.maxEmbeddedLatinWords) {
        findings.push({ kind: 'embedded_fragment', sentence, fragment: run.join(' ') })
      }
    } else if (latin > config.maxEmbeddedLatinWords) {
      findings.push({ kind: 'off_target_sentence', sentence, fragment: sentence })
    }
  }
  return { target, findings }
}

function languageDimension(target: GuardLanguage, findings: LanguageFinding[]): DimensionScore {
  if (findings.length === 0) {
    return { dimension: LANGUAGE_DIMENSION, score: 9, pass: true, method: 'rule',
      reason: `Copy stays in one language (${target}).` }
  }
  const examples = findings.slice(0, MAX_REPORTED_FINDINGS).map(f => `"${f.fragment}"`).join(', ')
  return { dimension: LANGUAGE_DIMENSION, score: 2, pass: false, method: 'rule',
    reason: `Mixed-language copy: target is ${target} but found untranslated text ${examples}. ` +
      `Rewrite fully in ${target === 'en' ? 'English' : 'Chinese'}.` }
}

// ─── Cliché opener (Copy Judge) ──────────────────────────────────────────────

async function judgeCliche(
  text: string,
  config: ContentGuardConfig,
): Promise<{ probability: number | null; error: string | null }> {
  try {
    const answers = await askCopyJudge(
      { post: text.slice(0, JUDGE_SNIPPET_CHARS) },
      { cliche: { instructions: CLICHE_INSTRUCTIONS } },
      { timeoutMs: config.judgeTimeoutMs },
    )
    return { probability: answers.cliche, error: null }
  } catch (err) {
    return { probability: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function clicheDimension(probability: number | null, error: string | null, config: ContentGuardConfig): DimensionScore {
  if (probability === null) {
    return { dimension: CLICHE_DIMENSION, score: 0, pass: false, method: 'llm',
      reason: `Cliché check unavailable (${error ?? 'unknown error'}) — needs human review.` }
  }
  const pass = probability < config.clicheThreshold
  return { dimension: CLICHE_DIMENSION, score: Math.round((1 - probability) * 10), pass, method: 'llm',
    reason: pass
      ? 'Opening avoids generic marketing clichés.'
      : 'Leans on generic marketing clichés (e.g. "Unlock the power of…"). Open with a concrete fact, offer, or detail instead.' }
}

// ─── Main export ─────────────────────────────────────────────────────────────

/** Never throws. Any internal failure resolves to needsHumanReview = true. */
export async function runContentGuard(
  content: string,
  options: { targetLanguage?: GuardLanguage | null; config?: ContentGuardConfig } = {},
): Promise<ContentGuardResult> {
  const config = options.config ?? resolveContentGuardConfig()
  const { target, findings } = checkLanguageConsistency(content, config, options.targetLanguage)
  const { probability, error } = await judgeCliche(normaliseForLanguageCheck(content), config)

  const dimensions = [languageDimension(target, findings), clicheDimension(probability, error, config)]
  const checksFailed = findings.length > 0 || (probability !== null && probability >= config.clicheThreshold)
  const status = checksFailed ? 'fail' : error ? 'unavailable' : 'pass'

  return {
    status,
    needsHumanReview: status !== 'pass',
    targetLanguage: target,
    languageFindings: findings.slice(0, MAX_REPORTED_FINDINGS),
    clicheProbability: probability,
    judgeError: error,
    dimensions,
    config,
  }
}

/** Stand-in rubric when the rubric LLM is unavailable; the guard still decides pass. */
export const SKIPPED_RUBRIC: RubricResult = { overallScore: 0, pass: true, dimensions: [] }

/**
 * Append guard dimensions to a rubric result. The guard is a gate, not a score:
 * overallScore always stays the rubric's (0 when the rubric was skipped — see
 * snapshot.rubric_skipped), while any guard failure — including an unavailable
 * judge — forces pass = false.
 */
export function mergeGuardIntoRubric(rubric: RubricResult, guard: ContentGuardResult): RubricResult {
  return {
    overallScore: rubric.overallScore,
    pass: rubric.pass && !guard.needsHumanReview,
    dimensions: [...rubric.dimensions, ...guard.dimensions],
  }
}

/**
 * True when regenerating could fix a failure. Takes the PRE-merge rubric so an
 * unavailable judge (not fixable by rewriting) never triggers a retry, and
 * advisory rubric dimensions keep their non-blocking meaning.
 */
export function hasRetryableFailure(rubric: RubricResult, guard: ContentGuardResult): boolean {
  return !rubric.pass || guard.status === 'fail'
}

/** Machine-readable receipt persisted into generation_context_snapshot.content_guard. */
export function contentGuardSnapshot(guard: ContentGuardResult): Record<string, unknown> {
  return {
    status:             guard.status,
    needs_human_review: guard.needsHumanReview,
    target_language:    guard.targetLanguage,
    language_findings:  guard.languageFindings,
    cliche_probability: guard.clicheProbability,
    judge_error:        guard.judgeError,
    cliche_threshold:   guard.config.clicheThreshold,
    checked_at:         new Date().toISOString(),
  }
}
