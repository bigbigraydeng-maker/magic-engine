/**
 * The one place that decides what address Magic Engine sends mail FROM.
 *
 * Why this exists (2026-07-24 incident): every notification path in the app was
 * hard-coded to `onboarding@resend.dev`. That is the provider's SANDBOX sender,
 * and the provider only lets a sandbox sender deliver to the account owner's own
 * address — anything else is rejected with HTTP 403. So the ad-health alert, the
 * cron failure digest AND the public contact form were all failing silently,
 * while the one path that used a verified domain sender kept working.
 *
 * `hello@magicengine.cloud` is the address that path used, on a verified sending
 * domain — PM's call to standardise on it rather than introduce a second sender,
 * so every outbound mail comes from one already-proven address. Override with
 * ME_MAIL_FROM if it ever changes.
 */

/** Verified-domain address every internal notification is sent from. */
export const ME_MAIL_FROM_ADDRESS =
  process.env.ME_MAIL_FROM ?? 'hello@magicengine.cloud'

/**
 * Build a From header with a human label, e.g.
 * `meMailFrom('Magic Engine 广告自检')` → `Magic Engine 广告自检 <hello@magicengine.cloud>`
 */
export function meMailFrom(label: string): string {
  return `${label} <${ME_MAIL_FROM_ADDRESS}>`
}

/**
 * The default inbox every internal notification is delivered TO — the ad-health
 * digest, the cron-failure digest, and the public contact form. Kept on the same
 * verified domain as the sender so a sandbox-only account (which may only deliver
 * to its own owner address) still reaches it. Override with ME_MAIL_TO.
 *
 * This is only the FALLBACK: a client that configures its own digest recipients
 * still wins over this address.
 */
export const ME_MAIL_TO_ADDRESS =
  process.env.ME_MAIL_TO ?? 'hello@magicengine.cloud'
