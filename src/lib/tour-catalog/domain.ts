/** Pure domain helper for the tour catalog. No imports. */

/** "https://www.Example.co.nz/tours" -> "example.co.nz"; the feed source registry is keyed by bare hostname. */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
}
