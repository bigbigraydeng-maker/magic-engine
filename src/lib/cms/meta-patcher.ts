/**
 * Meta-patcher: find a TypeScript data-file object by its `slug` field
 * and replace one named metadata field within that object.
 *
 * Strategy: slug-windowed text replacement (no AST required).
 *
 * Algorithm:
 *  1. Find `slug: '<targetSlug>'` in the file.
 *  2. Identify the text window from that position to the next `slug:` occurrence
 *     (or end of file if there is none).
 *  3. Within that window, find the exact string `field: '<oldValue>'`.
 *  4. Replace it with `field: '<newValue>'` — escaping single quotes.
 *  5. Return the full updated content.
 *
 * Supports both single- and double-quoted string literals. The replacement
 * preserves the original quote style.
 *
 * This file is intentionally pure (no I/O, no imports from external modules)
 * so it can be unit-tested independently.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PatchResult =
  | { ok: true;  content: string }
  | { ok: false; reason: string }

// ─── patchMetaField ──────────────────────────────────────────────────────────

/**
 * Patch one metadata field inside a slug-identified TypeScript object.
 *
 * @param source    Full UTF-8 source of the TypeScript data file.
 * @param slug      The value of the `slug` property that identifies the object.
 * @param field     The property name to update (e.g. "metaTitle").
 * @param oldValue  The current value — used for exact-match verification.
 * @param newValue  The replacement value.
 */
export function patchMetaField(
  source:   string,
  slug:     string,
  field:    string,
  oldValue: string,
  newValue: string,
): PatchResult {
  // ── 1. Locate the slug anchor ───────────────────────────────────────────────
  const slugIndex = findSlugPosition(source, slug)
  if (slugIndex === -1) {
    return { ok: false, reason: `Slug "${slug}" not found in file.` }
  }

  // ── 2. Define the search window (slug position → next slug) ────────────────
  const windowStart = slugIndex
  const nextSlugIndex = findNextSlug(source, slugIndex + 1)
  const windowEnd = nextSlugIndex === -1 ? source.length : nextSlugIndex
  const window = source.slice(windowStart, windowEnd)

  // ── 3. Find the field + oldValue within the window ─────────────────────────
  // Pattern captures: (field_and_colon)(quote)(oldValue) with backreference to quote.
  const escapedField = escapeRegex(field)
  const escapedValue = escapeRegex(oldValue)
  const pattern = new RegExp(
    `(${escapedField}\\s*:\\s*)(['"])(${escapedValue})\\2`
  )

  if (!pattern.test(window)) {
    return {
      ok: false,
      reason:
        `Field "${field}" with value "${oldValue}" not found in slug "${slug}" object. ` +
        `The file may have been modified since the fix was queued.`,
    }
  }

  // ── 4. Replace — preserve the original quote style ───────────────────────
  const updatedWindow = window.replace(
    pattern,
    (_match, prefix: string, quote: string) => {
      const escapedNew = escapeForQuote(newValue, quote)
      return `${prefix}${quote}${escapedNew}${quote}`
    },
  )

  const updatedSource = source.slice(0, windowStart) + updatedWindow + source.slice(windowEnd)
  return { ok: true, content: updatedSource }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Find the character index of `slug: '<target>'` or `slug: "<target>"`.
 * Handles optional whitespace around the colon.
 */
function findSlugPosition(source: string, slug: string): number {
  const escapedSlug = escapeRegex(slug)
  // Match: slug: 'value' or slug: "value"
  const re = new RegExp(`slug\\s*:\\s*(['"])${escapedSlug}\\1`)
  const m  = re.exec(source)
  return m ? m.index : -1
}

/**
 * Find the index of the next `slug:` property after `startFrom`.
 * Used to bound the search window for multi-object files.
 */
function findNextSlug(source: string, startFrom: number): number {
  const re = /\bslug\s*:/g
  re.lastIndex = startFrom
  const m = re.exec(source)
  return m ? m.index : -1
}

/** Escape single or double quotes in the replacement value. */
function escapeForQuote(value: string, quote: string): string {
  if (quote === "'") return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Escape a string for use as a literal inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
