/**
 * Templates whose key starts with `auto-` are written for ME's own automated letters (the welcome letter, the countdown
 * letters). Staff never pick or send them by hand: the post-call picker leaves them out and the manual send path refuses
 * them, because the request's template key comes from the browser. The automated sender reads them through the template
 * store as usual. Template keys are lower-case by rule (`TEMPLATE_KEY_RE`); the check lower-cases anyway, so a request
 * key in another case cannot slip past it.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §9-4.
 */

export const AUTOMATED_TEMPLATE_KEY_PREFIX = 'auto-'

export function isAutomatedTemplateKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.trim().toLowerCase().startsWith(AUTOMATED_TEMPLATE_KEY_PREFIX)
}
