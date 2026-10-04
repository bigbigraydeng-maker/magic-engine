/**
 * One-off, dated PM task: confirm the CTS personal ad account's payment method
 * during the 10/5–10/8 observation window (ledger 2026-10-05-cts-meta-ads-review-payment-stall).
 * Ledger cards in `decided` status are not surfaced before verify_by, so the
 * what/how/href are delivered here. The account id lives in the audit doc, not the ledger card.
 */

import type { ManualItem } from './manual-item-types'

const WINDOW_START = '2026-10-05'
const WINDOW_END = '2026-10-08'
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const BILLING_HREF = 'https://business.facebook.com/billing_hub/payment_settings?asset_id=2775766642787274'

export function pushAdsPaymentCheckItems(items: ManualItem[], now: Date): void {
  const day = now.toISOString().slice(0, 10)
  if (day < WINDOW_START || day > WINDOW_END) return
  items.push({
    kind: 'ads_payment_check',
    client_id: CTS_CLIENT_ID,
    client_name: 'CTS Tours NZ',
    what: '广告账号 10/1 因付款失败停投约 2 天，少收约 20 条线索；10/2 已扣款恢复，但付款方式若再失败会重演',
    how: '打开链接看「付款状态」：有欠款点「立即付款」；付款方式失败或将过期就「添加/更换付款方式」换一张有额度的卡；都正常就确认付款方式有效，并在台账卡回一句「付款正常」',
    href: BILLING_HREF,
  })
}
