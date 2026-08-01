/**
 * Attribution Action Classifier
 *
 * Decides whether a logged flywheel_action is a REAL WEBSITE CHANGE — the only
 * kind of action that may be scored against Google Search Console data.
 *
 * Why this exists
 * ---------------
 * `flywheel_actions` is an append-only log that everything writes into: the
 * 诸葛亮 / 华佗 recommendation engine, FDE session notes, data-pull jobs, even
 * developer housekeeping. Before this classifier, the GSC attribution bridge
 * scored *every* row with flywheel='seo', which produced verdicts like
 * "codex_worktree_cleanup_wave2 → SEO failed" (a git branch cleanup) and scored
 * AI recommendation cards that were never executed on any website.
 *
 * Two-layer design (provenance first, naming second)
 * --------------------------------------------------
 * Layer 1 — PROVENANCE (payload shape). Strongest and most future-proof signal:
 *   • recommendation cards carry `discovery_id` / `why_now` / `zhuge_session_key`
 *     and never carry a live artifact → they are a PRESCRIPTION, not an execution
 *   • real executions carry a live artifact (`url`, `wp_post_id`, `blog_post_id`,
 *     `prUrl`, …) → something demonstrably changed on the site
 *   This layer keeps working for action types that do not exist yet, and it can
 *   split a single action_type correctly (e.g. `seo.publish_blog` is logged both
 *   as a recommendation and as a real publish).
 *
 * Layer 2 — NAMING (ordered rule table). Fallback for rows with neither
 *   signature. First match wins, so specific exclusions precede broad inclusion.
 *
 * Extending it
 * ------------
 * Add a row to RECOMMENDATION_KEYS / LIVE_ARTIFACT_KEYS / ACTION_NAME_RULES.
 * No control flow changes — the rule table is data.
 *
 * Anything that matches nothing is `unclassified` and is NOT scored, but it is
 * reported by the caller so an unrecognised action type surfaces instead of
 * silently disappearing.
 */

// ── Categories ────────────────────────────────────────────────────────────────

export type ActionCategory =
  /** A change was made to the client's website → eligible for GSC scoring */
  | 'site_change'
  /** AI/FDE proposed it; nothing was executed */
  | 'recommendation'
  /** Content drafted but not published */
  | 'draft'
  /** Magic Engine internal engineering work — never touches a client site */
  | 'dev_chore'
  /** Data pull / audit / research — reads the world, changes nothing */
  | 'analysis'
  /** A document, strategy, brief or plan was produced */
  | 'document'
  /** Real work, but on a channel GSC cannot measure (GBP, reviews, email, social) */
  | 'off_site'
  /** No rule matched — excluded, but reported so it can be triaged */
  | 'unclassified'

export interface ActionClassification {
  category: ActionCategory
  /** True only for `site_change` — the single category GSC attribution scores. */
  eligible: boolean
  /** Which rule decided this, for logging and debugging. */
  rule: string
}

export interface ClassifiableAction {
  action_type: string
  payload?: Record<string, unknown> | null
}

// ── Layer 1: provenance signals ───────────────────────────────────────────────

/**
 * Payload keys written by the recommendation engines (华佗 discovery → 诸葛亮
 * prescription). Their presence means the row records ADVICE, not execution.
 */
const RECOMMENDATION_KEYS = [
  'discovery_id',
  'why_now',
  'zhuge_session_key',
  'diagnostic_run_id',
  'executable_by',
  'expected_impact',
]

/** How many recommendation keys must co-occur before we call it a card. */
const RECOMMENDATION_MIN_HITS = 2

/**
 * Payload keys that prove something is live on the site. Compared after
 * normalising case and underscores, so `wp_post_id`, `blogPostId` and
 * `blog_post_id` all match.
 */
const LIVE_ARTIFACT_KEYS = [
  'url',
  'posturl',
  'pageurl',
  'liveurl',
  'permalink',
  'slug',
  'prurl',
  'postid',
  'wppostid',
  'blogpostid',
]

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, '')
}

function payloadKeys(payload?: Record<string, unknown> | null): Set<string> {
  if (!payload || typeof payload !== 'object') return new Set()
  return new Set(Object.keys(payload).map(normaliseKey))
}

function countRecommendationSignals(keys: Set<string>): number {
  return RECOMMENDATION_KEYS.filter(k => keys.has(normaliseKey(k))).length
}

function hasLiveArtifact(keys: Set<string>): boolean {
  return LIVE_ARTIFACT_KEYS.some(k => keys.has(k))
}

// ── Layer 2: ordered name rules ───────────────────────────────────────────────

interface NameRule {
  id: string
  pattern: RegExp
  category: ActionCategory
}

/**
 * Evaluated top to bottom, FIRST MATCH WINS.
 *
 * Exclusions come first on purpose: `page_rewrite_drafted` contains both
 * "rewrite" (looks like a site change) and "drafted" (proves it is not live),
 * and `six_city_audit_and_tailor_made_strategy` contains "audit" and "strategy".
 * The narrow, disqualifying signal has to be checked before the broad one.
 */
export const ACTION_NAME_RULES: NameRule[] = [
  // — Disqualifying signals, most specific first —
  {
    id: 'draft/not-live',
    pattern: /(^|[._])(draft|drafted|drafts|pending|proposed)([._]|$)/,
    category: 'draft',
  },
  {
    id: 'dev-chore/magic-engine-internal',
    pattern: /(codex|worktree|branch_cleanup|cleanup|refactor|migration|lint|typecheck|build_fix|engineering_debt)/,
    category: 'dev_chore',
  },
  {
    id: 'analysis/read-only',
    pattern: /(snapshot|audit|research|analysis|diagnos|projection|forecast|benchmark|monitoring|tracking_only)/,
    category: 'analysis',
  },
  {
    id: 'document/deliverable-not-site',
    pattern: /(strategy|brief|sop|playbook|roadmap|proposal|recommend|finding|_plan(_|$)|^plan[._]|package)/,
    category: 'document',
  },
  {
    id: 'off-site/other-channel',
    pattern: /(gbp|google_business|review|newsletter|email|mailchimp|social|whatsapp|messenger|publer|[._]ads?([._]|$)|^ads?[._])/,
    category: 'off_site',
  },

  // — Inclusion: verbs and nouns that mean the website itself changed —
  {
    id: 'site-change/verb',
    pattern: /(publish|launch|deploy|insert|rewrite|fix|expand|expansion|sweep|boost|consolidat|rescue|module|indexing|noindex|redirect|sitemap|canonical|schema|blog|page|content|hub|link)/,
    category: 'site_change',
  },
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify one action. Pure function — no DB, no clock.
 *
 * Order of decision:
 *   1. recommendation-card payload  → recommendation (never executed)
 *   2. disqualifying name rule      → draft / dev_chore / analysis / document / off_site
 *   3. live artifact in payload     → site_change (proof beats naming)
 *   4. inclusive name rule          → site_change
 *   5. nothing matched              → unclassified (excluded, but reported)
 */
export function classifyAction(action: ClassifiableAction): ActionClassification {
  const name = (action.action_type ?? '').toLowerCase()
  const keys = payloadKeys(action.payload)

  // 1. Recommendation cards: advice, not execution.
  if (
    countRecommendationSignals(keys) >= RECOMMENDATION_MIN_HITS &&
    !hasLiveArtifact(keys)
  ) {
    return {
      category: 'recommendation',
      eligible: false,
      rule: 'payload/recommendation-card',
    }
  }

  // 2. Disqualifying name rules — must run before the artifact check so that a
  //    GBP or audit action carrying a URL is still kept out of website scoring.
  for (const rule of ACTION_NAME_RULES) {
    if (rule.category === 'site_change') break // inclusion rules handled in step 4
    if (rule.pattern.test(name)) {
      return { category: rule.category, eligible: false, rule: rule.id }
    }
  }

  // 3. Proof of a live artifact.
  if (hasLiveArtifact(keys)) {
    return {
      category: 'site_change',
      eligible: true,
      rule: 'payload/live-artifact',
    }
  }

  // 4. Inclusive name rules.
  for (const rule of ACTION_NAME_RULES) {
    if (rule.category !== 'site_change') continue
    if (rule.pattern.test(name)) {
      return { category: 'site_change', eligible: true, rule: rule.id }
    }
  }

  // 5. Unknown — excluded, and surfaced by the caller.
  return { category: 'unclassified', eligible: false, rule: 'default/no-match' }
}

/** Convenience predicate. */
export function isSiteChangeAction(action: ClassifiableAction): boolean {
  return classifyAction(action).eligible
}
