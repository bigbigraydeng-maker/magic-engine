/**
 * Pure constants shared between the comment-autoreply engine, its pm-todo
 * detector, and the client-side settings UI.
 *
 * Deliberately zero other imports (Codex round 5 复审 P2): `comment-autoreply-
 * engine.ts` and `comment-autoreply-stuck-items.ts` both transitively import
 * `page-sync-authorization.ts` → `token-selection.ts` → `crypto.ts`, which
 * imports Node's built-in `crypto` — fine on the server, but
 * `CommentAuditList.tsx` is a client component and needs these same values
 * to keep its "mark reviewed" button in sync with the backend's stuck
 * criteria. Importing either of those modules from client code risks a
 * broken client bundle; this file can never grow that risk because it has
 * nothing to import.
 */

/** Max send attempts before a 'failed' row stops being retried. */
export const MAX_ATTEMPTS = 3

/**
 * A `processing` row stuck longer than this is treated as abandoned
 * (interrupted between `claimComment` and `finalise`), not "still being
 * worked on by this run". `social-comment-autoreply` runs at least every 30
 * minutes; 24 hours is a wide margin over any real single-run duration.
 */
export const STALE_PROCESSING_MS = 24 * 60 * 60 * 1000

/**
 * `social_comment_config` DEFAULTS.lookback_days（comment-autoreply-config/
 * route.ts）. Used wherever a client's configured value couldn't be read, to
 * decide whether a not-yet-exhausted `failed` row has aged out of the
 * engine's lookback window (Codex round 12/13 复审 P1) — the pm-todo
 * detector and the audit list's own `?stuck=1` query both need the same
 * fallback, or a row "stuck" by one and not the other loses its only
 * closing action.
 */
export const DEFAULT_LOOKBACK_DAYS = 7
