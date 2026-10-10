/**
 * Character rules shared by every editable text field of the tour catalog. Pure, no imports.
 *
 * Forbidden everywhere: C0 control characters and DEL, zero-width characters (U+200B–U+200F),
 * bidirectional overrides (U+202A–U+202E), invisible formatting (U+2060–U+2069), the byte-order
 * mark — invisible in the admin page but they change what customers see — and the angle brackets
 * `<` `>`: the website serialises these texts straight into a structured-data script block, where
 * an angle bracket can end the script (design §6.11.1 item 5).
 */
const FORBIDDEN_CHARS_RE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿<>]/
/** Same set, except that multi-line fields may contain line breaks and tabs. */
const FORBIDDEN_CHARS_MULTILINE_RE = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁠-⁩﻿<>]/

export function hasForbiddenChars(text: string, multiline = false): boolean {
  return (multiline ? FORBIDDEN_CHARS_MULTILINE_RE : FORBIDDEN_CHARS_RE).test(text)
}

export type FieldError = { field: string; code: string }
