export const EXTERNAL_UPLOAD_ENGINE = 'external_upload'

export type ConsentUse = 'facebook_organic' | 'meta_ads' | 'tiktok_organic'

export interface TalentConsent {
  status: 'granted' | 'not_needed'
  scope: ConsentUse[]
  subject: string
  confirmed_by: string
  confirmed_at: string
  evidence: string
}

export type ConsentBlockReason =
  | 'consent_missing'
  | 'consent_invalid'
  | 'consent_scope'
  | 'faces_unchecked'
  | 'face_consent_missing'
  | 'consent_conflict'

export type ConsentVerdict = { ok: true } | { ok: false; reason: ConsentBlockReason }

const CONSENT_USES: readonly ConsentUse[] = ['facebook_organic', 'meta_ads', 'tiktok_organic']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isConsentUse(v: unknown): v is ConsentUse {
  return CONSENT_USES.some((use) => use === v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** True when the brief is an external upload work order. */
export function isExternalUpload(brief: unknown): boolean {
  return isRecord(brief) && brief.engine === EXTERNAL_UPLOAD_ENGINE
}

/** Read and validate the talent consent record from a brief; null when absent, 'invalid' when malformed. */
export function readTalentConsent(brief: unknown): TalentConsent | null | 'invalid' {
  if (!isRecord(brief)) return null
  const raw = brief.talent_consent
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) return 'invalid'

  const status = raw.status
  if (status !== 'granted' && status !== 'not_needed') return 'invalid'

  const rawScope = raw.scope
  if (!Array.isArray(rawScope)) return 'invalid'
  const scope: ConsentUse[] = []
  for (const entry of rawScope) {
    if (!isConsentUse(entry)) return 'invalid'
    if (!scope.includes(entry)) scope.push(entry)
  }
  if (status === 'not_needed' && scope.length > 0) return 'invalid'
  if (status === 'granted' && scope.length === 0) return 'invalid'

  const subject = raw.subject
  const confirmedBy = raw.confirmed_by
  const confirmedAt = raw.confirmed_at
  const evidence = raw.evidence
  if (!isNonEmptyString(subject)) return 'invalid'
  if (!isNonEmptyString(confirmedBy)) return 'invalid'
  if (!isNonEmptyString(confirmedAt)) return 'invalid'
  if (!isNonEmptyString(evidence)) return 'invalid'
  if (!Number.isFinite(Date.parse(confirmedAt))) return 'invalid'

  return {
    status,
    scope,
    subject: subject.trim(),
    confirmed_by: confirmedBy.trim(),
    confirmed_at: confirmedAt.trim(),
    evidence: evidence.trim(),
  }
}

/** Count identifiable faces from a v2 maliang check; null means faces were not checked. */
export function identifiableFaceCount(output: unknown): number | null {
  if (!isRecord(output)) return null
  const check = output.maliang_check
  if (!isRecord(check)) return null
  if (check.check_version !== 'v2') return null
  if (check.status !== 'pass' && check.status !== 'fail') return null
  const faces = check.identifiable_faces
  if (!Array.isArray(faces)) return null

  let total = 0
  for (const entry of faces) {
    if (!isRecord(entry)) return null
    const count = entry.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null
    total += count
  }
  return total
}

/** Fail-closed verdict on whether a work order may be used publicly for the given use. */
export function consentVerdict(input: { brief: unknown; output: unknown; use: ConsentUse }): ConsentVerdict {
  const consent = readTalentConsent(input.brief)
  if (consent === 'invalid') return { ok: false, reason: 'consent_invalid' }

  const external = isExternalUpload(input.brief)
  const faces = identifiableFaceCount(input.output)

  // Factory videos are not gated yet: they have no consent entry point, and the weekly 马良 backfill
  // (v2) would block every factory reel showing tourists or stock people with no way to clear it.
  // Known gap, ledger 2026-11-04-consent-gate-known-gaps.
  if (!external) return { ok: true }

  if (consent === null) return { ok: false, reason: 'consent_missing' }
  if (faces === null) return { ok: false, reason: 'faces_unchecked' }
  if (faces > 0 && consent.status === 'not_needed') return { ok: false, reason: 'consent_conflict' }
  if (consent.status === 'granted' && !consent.scope.includes(input.use)) {
    return { ok: false, reason: 'consent_scope' }
  }
  return { ok: true }
}

/** Plain-language Chinese label for each block reason (for to-do text and receipts). */
export const CONSENT_REASON_ZH: Record<ConsentBlockReason, string> = {
  consent_missing: '外部成片没有登记出镜授权',
  consent_invalid: '出镜授权记录格式不对',
  consent_scope: '出镜授权不包括这个用途',
  faces_unchecked: '马良还没看清片里有没有可辨认的人',
  face_consent_missing: '片里有可辨认的人，但没有登记出镜授权',
  consent_conflict: '登记了「片里没有人」，但马良看到了可辨认的人',
}
