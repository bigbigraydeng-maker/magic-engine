/**
 * CTS Next.js repository metadata source adapter.
 *
 * Pure and side-effect free: no GitHub, database, model, env, or clock access.
 * It is intentionally narrow because CTS metadata lives in TypeScript data
 * entries rather than WordPress or standalone HTML files.
 */

export const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

function escapeSingle(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'/

export interface CtsMetaSourceSnapshot {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly descriptionField: 'description' | 'excerpt'
}

export interface MetaReplacement extends CtsMetaSourceSnapshot {
  readonly updated: string
  readonly oldTitle: string
  readonly oldDesc: string
}

export interface CtsIntentSourceSnapshot extends CtsMetaSourceSnapshot {
  readonly h1: string
}

export interface IntentReplacement extends CtsIntentSourceSnapshot {
  readonly updated: string
  readonly oldTitle: string
  readonly oldDesc: string
  readonly oldH1: string
}

interface TargetWindow {
  readonly start: number
  readonly end: number
  readonly indent: string
  readonly value: string
}

/** Marks positions that are ordinary TypeScript code, excluding comments and literals. */
function lexicalCodeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length)
  let state: 'code' | 'single' | 'double' | 'template' | 'line_comment' | 'block_comment' = 'code'
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    if (state === 'code') {
      if (current === '/' && next === '/') {
        state = 'line_comment'
        index += 1
      } else if (current === '/' && next === '*') {
        state = 'block_comment'
        index += 1
      } else if (current === "'") {
        state = 'single'
        escaped = false
      } else if (current === '"') {
        state = 'double'
        escaped = false
      } else if (current === '`') {
        state = 'template'
        escaped = false
      } else {
        mask[index] = 1
      }
      continue
    }
    if (state === 'line_comment') {
      if (current === '\n') state = 'code'
      continue
    }
    if (state === 'block_comment') {
      if (current === '*' && next === '/') {
        state = 'code'
        index += 1
      }
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (current === '\\') {
      escaped = true
      continue
    }
    if (
      (state === 'single' && current === "'") ||
      (state === 'double' && current === '"') ||
      (state === 'template' && current === '`')
    ) {
      state = 'code'
    }
  }
  return mask
}

function slugEntries(source: string): Array<{ slug: string; start: number; indent: string }> {
  const entries: Array<{ slug: string; start: number; indent: string }> = []
  const mask = lexicalCodeMask(source)
  const slugRe = /^([ \t]*)slug:[ \t]*'([a-z0-9][a-z0-9-]*)'[ \t]*,?/gm
  let match: RegExpExecArray | null
  while ((match = slugRe.exec(source)) !== null) {
    if (mask[match.index] !== 1) continue
    entries.push({ slug: match[2], start: match.index, indent: match[1] })
  }
  return entries
}

function targetWindow(source: string, slug: string): TargetWindow | null {
  const entries = slugEntries(source)
  const matches = entries.filter((entry) => entry.slug === slug)
  if (matches.length !== 1) return null
  const [{ start, indent }] = matches
  const nextSlug = entries.find((entry) => entry.start > start)?.start ?? -1
  const bounds = [nextSlug, source.indexOf('\nexport const', start)].filter((index) => index !== -1)
  const end = bounds.length > 0 ? Math.min(...bounds) : source.length
  return { start, end, indent, value: source.slice(start, end) }
}

function targetFields(target: TargetWindow): {
  title: RegExpExecArray
  description: RegExpExecArray
  descriptionField: 'description' | 'excerpt'
} | null {
  const escapedIndent = target.indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const titleRe = new RegExp(`^(${escapedIndent}title:\\s*)${STRING_LITERAL.source}`, 'gm')
  const descriptionRe = new RegExp(`^(${escapedIndent}(description|excerpt):\\s*)${STRING_LITERAL.source}`, 'gm')
  const mask = lexicalCodeMask(target.value)
  const titleMatches = Array.from(target.value.matchAll(titleRe)).filter(
    (match) => mask[match.index ?? -1] === 1,
  )
  const descriptionMatches = Array.from(target.value.matchAll(descriptionRe)).filter(
    (match) => mask[match.index ?? -1] === 1,
  )
  if (titleMatches.length !== 1 || descriptionMatches.length !== 1) return null
  return {
    title: titleMatches[0],
    description: descriptionMatches[0],
    descriptionField: descriptionMatches[0][2] as 'description' | 'excerpt',
  }
}

function targetHeadline(target: TargetWindow): RegExpExecArray | null {
  const escapedIndent = target.indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headlineRe = new RegExp(`^(${escapedIndent}h1:\\s*)${STRING_LITERAL.source}`, 'gm')
  const mask = lexicalCodeMask(target.value)
  const matches = Array.from(target.value.matchAll(headlineRe)).filter(
    (match) => mask[match.index ?? -1] === 1,
  )
  return matches.length === 1 ? matches[0] : null
}

function unquote(match: string): string {
  return match.replace(/^[^']*'/, '').replace(/'$/, '').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

/** Reads one exact slug entry. Missing/ambiguous fields fail closed as null. */
export function inspectCtsMetaForSlug(source: string, slug: string): CtsMetaSourceSnapshot | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null
  const target = targetWindow(source, slug)
  if (!target) return null
  const fields = targetFields(target)
  if (!fields) return null
  return {
    slug,
    title: unquote(fields.title[0].slice(fields.title[1].length)),
    description: unquote(fields.description[0].slice(fields.description[1].length)),
    descriptionField: fields.descriptionField,
  }
}

/** Reads the three CTS fields governed by intent differentiation. */
export function inspectCtsIntentForSlug(
  source: string,
  slug: string,
): CtsIntentSourceSnapshot | null {
  const meta = inspectCtsMetaForSlug(source, slug)
  const target = targetWindow(source, slug)
  if (!meta || !target) return null
  const headline = targetHeadline(target)
  if (!headline) return null
  return {
    ...meta,
    h1: unquote(headline[0].slice(headline[1].length)),
  }
}

/**
 * Replaces only the exact target entry. Neighbouring entries remain untouched;
 * if either governed field is unavailable, no edit is produced.
 */
export function replaceMetaForSlug(
  source: string,
  slug: string,
  newTitle: string,
  newDesc: string,
): MetaReplacement | null {
  const before = inspectCtsMetaForSlug(source, slug)
  const target = targetWindow(source, slug)
  if (!before || !target || !newTitle.trim() || !newDesc.trim()) return null
  const fields = targetFields(target)
  if (!fields) return null
  const edits = [
    { match: fields.title, value: newTitle },
    { match: fields.description, value: newDesc },
  ].sort((left, right) => (right.match.index ?? 0) - (left.match.index ?? 0))
  let nextWindow = target.value
  for (const { match, value } of edits) {
    const start = match.index ?? -1
    if (start < 0) return null
    const replacement = `${match[1]}'${escapeSingle(value)}'`
    nextWindow = nextWindow.slice(0, start) + replacement + nextWindow.slice(start + match[0].length)
  }

  return {
    ...before,
    updated: source.slice(0, target.start) + nextWindow + source.slice(target.end),
    oldTitle: before.title,
    oldDesc: before.description,
  }
}

/** Replaces only title, description/excerpt and H1 in one exact CTS entry. */
export function replaceIntentForSlug(
  source: string,
  slug: string,
  newTitle: string,
  newDesc: string,
  newH1: string,
): IntentReplacement | null {
  const before = inspectCtsIntentForSlug(source, slug)
  const target = targetWindow(source, slug)
  if (!before || !target || !newTitle.trim() || !newDesc.trim() || !newH1.trim()) return null
  const fields = targetFields(target)
  const headline = targetHeadline(target)
  if (!fields || !headline) return null
  const edits = [
    { match: fields.title, value: newTitle },
    { match: fields.description, value: newDesc },
    { match: headline, value: newH1 },
  ].sort((left, right) => (right.match.index ?? 0) - (left.match.index ?? 0))
  let nextWindow = target.value
  for (const { match, value } of edits) {
    const start = match.index ?? -1
    if (start < 0) return null
    const replacement = `${match[1]}'${escapeSingle(value)}'`
    nextWindow = nextWindow.slice(0, start) + replacement + nextWindow.slice(start + match[0].length)
  }
  return {
    ...before,
    updated: source.slice(0, target.start) + nextWindow + source.slice(target.end),
    oldTitle: before.title,
    oldDesc: before.description,
    oldH1: before.h1,
  }
}

/** Builds a deterministic slug → source-file index from repository content. */
export function buildSlugIndex(
  files: readonly { readonly path: string; readonly source: string }[],
): Map<string, string> {
  const index = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const file of files) {
    for (const { slug } of slugEntries(file.source)) {
      if (ambiguous.has(slug)) continue
      if (index.has(slug)) {
        index.delete(slug)
        ambiguous.add(slug)
      } else {
        index.set(slug, file.path)
      }
    }
  }
  return index
}
