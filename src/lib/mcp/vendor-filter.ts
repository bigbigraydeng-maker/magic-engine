/**
 * Vendor-name scrub for MCP payloads (Phase 34 / P34.5).
 *
 * Belt-and-braces: scoped-queries already selects column subsets that exclude
 * vendor-bearing fields (model_used, etc.), but anything we serialise to a
 * client is a 客户交付物 and CLAUDE.md forbids real third-party vendor names
 * in client-facing output. This is the final pass that runs on every tool
 * payload before it leaves the server — if a future query adds a column that
 * leaks "openai" / "semrush" / etc., this catches it.
 *
 * Maps internal vendor names → 封装名 (PRODUCT_OVERVIEW packaging). Matching is
 * case-insensitive and whole-word-ish (word boundaries) to avoid mangling
 * unrelated substrings.
 */

// Order matters: longer / more specific patterns first so e.g. "gpt-4o-mini"
// is replaced before a bare "gpt" rule would partially touch it.
const VENDOR_MAP: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /gpt-4o-mini|gpt-4o|gpt-4|gpt-3\.5|\bgpt\b/gi, replacement: 'Content Engine' },
  { pattern: /openai/gi, replacement: 'Content Engine' },
  { pattern: /claude-[\w.-]+|anthropic claude|\banthropic\b/gi, replacement: 'Strategy Engine' },
  { pattern: /dataforseo|semrush/gi, replacement: 'Keyword Intelligence' },
  { pattern: /jina\.?ai|jina reader|\bjina\b/gi, replacement: 'Site Analyzer' },
  { pattern: /wavespeed|flux-dev/gi, replacement: 'Visual Studio' },
  { pattern: /seedance/gi, replacement: 'Video Studio' },
  { pattern: /heygen/gi, replacement: 'Avatar Studio' },
  { pattern: /\bairtable\b/gi, replacement: 'Content Workspace' },
  { pattern: /\bpubler\b/gi, replacement: 'Publishing Hub' },
]

/** Packaged names — used to collapse accidental duplicates after scrubbing. */
const PACKAGED_NAMES = [
  'Content Engine', 'Strategy Engine', 'Keyword Intelligence', 'Site Analyzer',
  'Visual Studio', 'Video Studio', 'Avatar Studio', 'Content Workspace', 'Publishing Hub',
]

/** Scrub vendor names from a single string. */
export function scrubString(input: string): string {
  let out = input
  for (const { pattern, replacement } of VENDOR_MAP) {
    out = out.replace(pattern, replacement)
  }
  // Collapse consecutive duplicate packaged names that arise when two vendor
  // tokens in a phrase map to the same 封装名 (e.g. "OpenAI GPT-4o-mini" first
  // becomes "Content Engine Content Engine"). 狄仁杰 review — cosmetic only,
  // the security contract (no real vendor name) already held without this.
  for (const name of PACKAGED_NAMES) {
    out = out.replace(new RegExp(`${name}(?:\\s+${name})+`, 'g'), name)
  }
  return out
}

/**
 * Recursively scrub vendor names from any JSON-serialisable value. Object keys
 * are left intact (they're our own schema, not free-text); only string VALUES
 * are scrubbed. Returns a new structure; the input is not mutated.
 */
export function scrubVendorNames<T>(value: T): T {
  if (typeof value === 'string') {
    return scrubString(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubVendorNames(v)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubVendorNames(v)
    }
    return out as unknown as T
  }
  return value
}
