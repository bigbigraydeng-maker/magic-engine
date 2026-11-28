/**
 * How a letter names a tour, and whether a text names it. One home for both the writer (links) and its checks.
 */

/** "China Discovery — Best of China" → "Best of China": the name a letter and a link label use. */
export function shortTourName(name: string): string {
  const parts = name.split(/\s[—–-]\s/)
  const last = parts[parts.length - 1] ?? name
  return last.trim() === '' ? name.trim() : last.trim()
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Curly quotes and apostrophes to straight ones, so "Xi’an" in a letter matches "Xi'an" in the catalogue. */
function plainQuotes(v: string): string {
  return v.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}

/**
 * Does the text name this tour? A short name of one ordinary word ("Highlights", "Explorer", "Panorama") is also an
 * everyday word: "highlights like the Great Wall" is not the tour called Highlights. So a one-word name never counts.
 * `exactCase` true = the name must appear with its own capital letters (used to ADD a link: be sure);
 * false = any capitalisation (used to CATCH an off-sale tour: better one false alarm than a miss).
 * Found 2026-11-28: a China follow-up letter got a link to a Japan tour named "Highlights".
 */
export function namesTour(text: string, shortName: string, exactCase = true): boolean {
  const name = plainQuotes(shortName.trim())
  if (name.split(/\s+/).length < 2) return false
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(name)}(?![A-Za-z0-9])`, exactCase ? '' : 'i').test(plainQuotes(text))
}
