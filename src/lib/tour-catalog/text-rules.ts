/**
 * Character rules shared by every editable text field of the tour catalog. Pure, no imports.
 *
 * Forbidden everywhere: C0 control characters and DEL, zero-width characters (U+200B–U+200F),
 * bidirectional overrides (U+202A–U+202E), invisible formatting (U+2060–U+2069), the byte-order
 * mark — invisible in the admin page but they change what customers see — the line separators
 * U+2028, U+2029 and U+0085 (they break a line inside a script block or a one-line field, in
 * single-line and multi-line fields alike) — and the angle brackets
 * `<` `>`: the website serialises these texts straight into a structured-data script block, where
 * an angle bracket can end the script (design §6.11.1 item 5).
 */
const FORBIDDEN_CHARS_RE = /[\u0000-\u001f\u007f\u0085\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>]/
/** Same set, except that multi-line fields may contain line breaks and tabs. */
const FORBIDDEN_CHARS_MULTILINE_RE = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>]/

export function hasForbiddenChars(text: string, multiline = false): boolean {
  return (multiline ? FORBIDDEN_CHARS_MULTILINE_RE : FORBIDDEN_CHARS_RE).test(text)
}

export type FieldError = { field: string; code: string }
