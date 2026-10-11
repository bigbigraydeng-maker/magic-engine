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

/** A `slug:` property whose value is a quoted string (type annotations like `slug: string` do not count). */
const ANCHOR_ANY = /\bslug\s*:\s*['"]/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Bracket depth ({ [ ( ) at every position that begins a `slug:` property. Skips strings, templates, comments. */
function depthsAtSlugProperties(source: string): { depthAt: Map<number, number>; sound: boolean } {
  const depthAt = new Map<number, number>()
  const starts = new Set<number>()
  ANCHOR_ANY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ANCHOR_ANY.exec(source)) !== null) starts.add(m.index)

  let depth = 0
  let sound = true
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
      if (end === -1) { sound = false; break }
      i = end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1
      if (i >= source.length) { sound = false; break } // unterminated string: the scan lost track
      i++
      continue
    }
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') {
      depth--
      if (depth < 0) sound = false
    }
    i++
  }
  // the scan only counts as reliable when every bracket was closed again
  return { depthAt, sound: sound && depth === 0 }
}

export type SlugAnchorStyle = 'default' | 'guide'

/**
 * True when the page the patcher would edit is NOT reliably the entry named by `slug`:
 *  - the FIRST `slug: '<slug>'` is nested deeper than the file's shallowest quoted `slug:` property, or
 *  - the scan cannot be trusted (unbalanced brackets / unterminated string or comment, e.g. a regex literal
 *    containing a quote) or the anchor was not seen by the scan.
 * Fail-closed on purpose: every "cannot tell" answer is `true`.
 *
 * `style` picks the same anchor the editor uses: `guide` files (guides.ts) anchor on a two-space-indented
 * `slug:` line only, so earlier nested mentions are ignored there; everything else anchors on the first match.
 * False when the slug is not found at all (callers report that separately).
 */
export function firstSlugAnchorIsNested(source: string, slug: string, style: SlugAnchorStyle = 'default'): boolean {
  const body = `slug\\s*:\\s*(['"])${escapeRegex(slug)}\\1`
  const re = style === 'guide' ? new RegExp(`\\n {2}${body}`) : new RegExp(body)
  const hit = re.exec(source)
  if (!hit) return false
  const anchorIdx = style === 'guide' ? hit.index + 3 : hit.index
  const { depthAt, sound } = depthsAtSlugProperties(source)
  if (!sound) return true
  const firstDepth = depthAt.get(anchorIdx)
  if (firstDepth === undefined) return true
  let min = firstDepth
  for (const d of depthAt.values()) if (d < min) min = d
  return firstDepth > min
}
