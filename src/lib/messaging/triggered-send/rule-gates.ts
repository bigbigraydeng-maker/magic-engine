/**
 * The switchable gates of a rule (`rule.gates`, design 2026-11-17 §4.2, §7.2). Pure and without Node imports, so the
 * dashboard (the rule summary) can use the same default as the sender.
 */

/**
 * The switchable gates. Every other gate (address, allow-list, do not contact, unsubscribed, complained, bounced,
 * Mailchimp suppressed, excluded tag, consent) is always judged.
 *  - `sales_email`: skip a guest a salesperson already wrote to (the e-mail is still COUNTED toward the cap either way);
 *  - `legacy_welcomed`: skip a guest the old daily batch already welcomed (and read the batch at all);
 *  - `stale`: skip a lead older than `audience.max_age_days`;
 *  - `count_legacy_batch`: count the old batch's campaigns toward the cap (the welcome letter takes them out, because
 *    it replaces that batch; any other letter must count them: the guest really got them).
 */
export interface RuleGates {
  sales_email: boolean
  legacy_welcomed: boolean
  stale: boolean
  count_legacy_batch: boolean
}

/** The gates of a rule without a `gates` block: the welcome letter's, unchanged. */
export const WELCOME_GATES: Readonly<RuleGates> = Object.freeze({ sales_email: true, legacy_welcomed: true, stale: true, count_legacy_batch: false })

export function gatesOf(rule: { gates?: RuleGates }): RuleGates {
  return rule.gates ?? { ...WELCOME_GATES }
}

