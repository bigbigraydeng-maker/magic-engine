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
 * `magicengine.com.au` is a verified sending domain, so notifications sent from
 * it reach any recipient. Override with ME_MAIL_FROM if the address changes.
 */

/** Verified-domain address every internal notification is sent from. */
export const ME_MAIL_FROM_ADDRESS =
  process.env.ME_MAIL_FROM ?? 'notifications@magicengine.com.au'

/**
 * Build a From header with a human label, e.g.
 * `meMailFrom('Magic Engine 广告自检')` → `Magic Engine 广告自检 <notifications@magicengine.com.au>`
 */
export function meMailFrom(label: string): string {
  return `${label} <${ME_MAIL_FROM_ADDRESS}>`
}
