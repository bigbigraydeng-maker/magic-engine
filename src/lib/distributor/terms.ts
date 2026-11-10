/**
 * Version of the rules an applicant agrees to on /partner/apply. The rules themselves are rendered by
 * src/app/partner/apply/rules.tsx and simulator.tsx straight from the rule set, so the page can never
 * promise a rate the engine does not pay. Changing any of that wording means a new version: each
 * application stores the version the applicant actually saw.
 */
export const DISTRIBUTOR_TERMS_VERSION = 'distributor-terms-2026-11-10c'

export const PRIVACY_CONTACT_EMAIL = 'hello@magicengine.cloud'
