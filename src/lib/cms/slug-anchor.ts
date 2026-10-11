/**
 * Where does `slug: '<x>'` sit in a TypeScript data file — as an ENTRY of the top-level list, or nested inside
 * another entry (e.g. `related: [{ slug: 'x' }]`)?
 *
 * Why it matters: the data-file patchers (meta-patcher.ts, cts-meta-pr.ts) are text-window based. They anchor on
 * the FIRST `slug: 'x'` in the file and edit up to the next `slug:`. If that first anchor is a nested reference
 * inside some other entry, the edit lands in THAT entry — so "which page is being edited" is not the page the
 * caller named, and the protected-page gate would be checking the wrong page.
 *
 * Pure (no I/O). Bracket depth is counted with a string/comment-aware scan; an anchor is "nested" when it sits
 * deeper than the shallowest `slug:` property of the file.
 */

const ANCHOR_ANY = /\bslug\s*:/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Bracket depth ({ [ ( ) at every position that begins a `slug:` property. Skips strings, templates, comments. */
function depthsAtSlugProperties(source: string): Map<number, number> {
  const depthAt = new Map<number, number>()
  const starts = new Set<number>()
  ANCHOR_ANY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ANCHOR_ANY.exec(source)) !== null) starts.add(m.index)

  let depth = 0
  let i = 0
  while (i < source.length) {
    if (starts.has(i)) depthAt.set(i, depth)
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    i++
  }
  return depthAt
}

/**
 * True when the FIRST `slug: '<slug>'` in the file is nested deeper than the file's shallowest `slug:` property.
 * False when the slug is not found at all (callers report that separately) or the first anchor is an entry.
 */
export function firstSlugAnchorIsNested(source: string, slug: string): boolean {
  const re = new RegExp(`slug\\s*:\\s*(['"])${escapeRegex(slug)}\\1`)
  const first = re.exec(source)
  if (!first) return false
  const depths = depthsAtSlugProperties(source)
  const firstDepth = depths.get(first.index)
  if (firstDepth === undefined) return false
  let min = firstDepth
  for (const d of depths.values()) if (d < min) min = d
  return firstDepth > min
}
