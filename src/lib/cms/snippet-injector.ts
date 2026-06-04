/**
 * GEO snippet injector (B2 of GEO-B+ Stage 1).
 *
 * Given a template file's current contents + the snippet ME wants to inject +
 * the template's syntax (html | php), returns a new file body with the snippet
 * sitting inside an idempotent ME-GEO marker block right before </head>.
 *
 * Guarantees:
 *   - Idempotent: a second call replaces the marker block in place rather than
 *     duplicating it.
 *   - Pure: no IO, no Date.now(), no randomness. Easy to test, replay-safe.
 *   - Drift-aware: returns the SHA-256 of the *current* snippet so callers can
 *     compare against the hash of what ME wrote last time (stored in
 *     geo_deployments.injected_hash).
 *   - Honest about failures: throws HeadTagNotFoundError when the template
 *     doesn't have a </head> we can latch onto, so the route surfaces a clean
 *     422 instead of corrupting the file.
 *
 * NOT supported (魏征 review on Q2):
 *   - JSX / Vue SFC / Astro / .erb / .liquid — those need AST-aware injection.
 *     The route guards against non-{html|php} syntax before reaching here, so
 *     this lib never sees them.
 */

import { createHash } from 'crypto'

import type { CmsContentTargetSyntax } from './vocabulary'

// ─── Marker contract ─────────────────────────────────────────────────────────
//
// The marker pair MUST stay stable across releases — geo_deployments rows
// remember which block ME owns by this exact prefix/suffix. Renaming would
// orphan every existing injection.

export const ME_GEO_START_MARKER = '<!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->'
export const ME_GEO_END_MARKER   = '<!-- ME-GEO-END -->'

// ─── Errors ──────────────────────────────────────────────────────────────────

export class HeadTagNotFoundError extends Error {
  constructor(targetPath: string) {
    super(`Template ${targetPath} does not contain a </head> tag — cannot inject GEO snippet`)
    this.name = 'HeadTagNotFoundError'
  }
}

/**
 * Thrown when the snippet payload itself contains one of our marker strings.
 * Letting that through would lead to the second-injection lookup latching on
 * to the spurious marker inside user-supplied content, splitting the file at
 * the wrong byte offset, and corrupting the live template. We refuse the
 * publish at the injector boundary so the route can surface a clean 422.
 */
export class SnippetContainsMarkerError extends Error {
  constructor(targetPath: string) {
    super(
      `GEO snippet for ${targetPath} contains a reserved ME-GEO marker string — ` +
      `rewrite the directive so its rendered HTML does not include the literal markers.`,
    )
    this.name = 'SnippetContainsMarkerError'
  }
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface InjectionResult {
  /** Full file body with the marker block written into place. */
  newContent: string
  /**
   * SHA-256 hex of the snippet that lives between the markers in `newContent`.
   * Stored in geo_deployments.injected_hash and used to detect human edits on
   * the next publish.
   */
  injectedHash: string
  /**
   * Hash of the marker block that was already in the file BEFORE this call,
   * or null when no prior block existed. Caller compares this against the
   * geo_deployments row hash to decide "external drift vs. ME-written" — if
   * the live hash doesn't match what ME last wrote, the route prompts the
   * FDE to force-overwrite instead of silently clobbering.
   */
  previousHash: string | null
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Inject (or replace) the ME-GEO marker block in `fileContent`.
 *
 * - If a marker block already exists, its inner snippet is replaced and the
 *   surrounding template is untouched.
 * - Otherwise, the marker block is inserted on its own line just before
 *   `</head>`. We preserve whatever indentation the existing `</head>` line
 *   used so the injected snippet matches house style.
 */
export function injectGeoSnippet(
  fileContent: string,
  snippet:     string,
  syntax:      CmsContentTargetSyntax,
  targetPath:  string,
): InjectionResult {
  // syntax is currently used only to keep the public API ready for divergent
  // injectors (e.g. PHP-specific escaping). For html/php today the marker pair
  // is HTML-comment based — valid in both contexts.
  void syntax

  const trimmedSnippet = snippet.trim()

  // Reject snippets that would smuggle marker literals through the injector.
  // The boundary check must happen before any byte offset math — once the
  // marker string lives inside the wrapped block, our indexOf-based parser
  // would split the file at the user-controlled offset on the next publish.
  if (
    trimmedSnippet.includes(ME_GEO_START_MARKER) ||
    trimmedSnippet.includes(ME_GEO_END_MARKER)
  ) {
    throw new SnippetContainsMarkerError(targetPath)
  }

  const injectedHash   = sha256Hex(trimmedSnippet)

  // ── Case 1: existing block — replace inner snippet in place ──────────────
  const existing = findExistingBlock(fileContent)
  if (existing) {
    const before  = fileContent.slice(0, existing.innerStart)
    const after   = fileContent.slice(existing.innerEnd)
    const newBody = before + '\n' + trimmedSnippet + '\n' + after
    return {
      newContent:   newBody,
      injectedHash,
      previousHash: sha256Hex(existing.innerContent.trim()),
    }
  }

  // ── Case 2: first injection — splice marker block in before </head> ──────
  //
  // Match the LAST occurrence of </head> in the file (rare but possible to
  // have multiple, e.g. in HTML comments — we want the real one before <body>).
  // Capture any leading whitespace on the same line so we can mirror the
  // template's indentation style.
  const headRegex = /([ \t]*)<\/head>/gi
  let match: RegExpExecArray | null
  let lastMatch: RegExpExecArray | null = null
  while ((match = headRegex.exec(fileContent)) !== null) {
    lastMatch = match
  }
  if (!lastMatch) {
    throw new HeadTagNotFoundError(targetPath)
  }

  const indent       = lastMatch[1] ?? ''
  const splitIdx     = lastMatch.index + indent.length
  const beforeHead   = fileContent.slice(0, splitIdx)
  const afterHead    = fileContent.slice(splitIdx)
  const block        = renderMarkerBlock(trimmedSnippet, indent)
  const needsLeadingNewline = beforeHead.length > 0 && !beforeHead.endsWith('\n')
  const prefix       = needsLeadingNewline ? '\n' : ''
  const newContent   = beforeHead + prefix + block + '\n' + afterHead

  return {
    newContent,
    injectedHash,
    previousHash: null,
  }
}

/**
 * Pull the snippet currently sitting between the markers, without modifying
 * the file. Used by the publish route to compute the hash *before* deciding
 * whether to overwrite — so we can detect drift without doing any work.
 *
 * Returns null when no marker block exists yet.
 */
export function readExistingInjectedHash(fileContent: string): string | null {
  const existing = findExistingBlock(fileContent)
  if (!existing) return null
  return sha256Hex(existing.innerContent.trim())
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface ExistingBlock {
  /** Byte offset where the inner content begins (right after START + newline). */
  innerStart:   number
  /** Byte offset where the inner content ends (right before END marker). */
  innerEnd:     number
  /** The raw text between the markers (untrimmed). */
  innerContent: string
}

function findExistingBlock(fileContent: string): ExistingBlock | null {
  const startIdx = fileContent.indexOf(ME_GEO_START_MARKER)
  if (startIdx === -1) return null
  const endIdx = fileContent.indexOf(ME_GEO_END_MARKER, startIdx + ME_GEO_START_MARKER.length)
  if (endIdx === -1) return null

  const innerStart   = startIdx + ME_GEO_START_MARKER.length
  const innerEnd     = endIdx
  const innerContent = fileContent.slice(innerStart, innerEnd)
  return { innerStart, innerEnd, innerContent }
}

function renderMarkerBlock(snippet: string, indent: string): string {
  return [
    `${indent}${ME_GEO_START_MARKER}`,
    snippet,
    `${indent}${ME_GEO_END_MARKER}`,
  ].join('\n')
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
