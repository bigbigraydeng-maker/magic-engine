/** Price font size (px) for the price card. Long price strings shrink so the box stays inside the safe width. */
export function priceFontSizeFor(currencyPrefix: string, amount: number, fit: boolean): number {
  // 9 chars or fewer keep the base size (legacy); with `fit` (list reels) 8 chars already shrink slightly so the
  // padded box stays within 900px (an 8-character price at 170px measured ~945px wide).
  const priceChars = currencyPrefix.length + amount.toLocaleString('en-US').length
  const full = (fit ? 7.5 : 9) / priceChars
  return Math.floor((amount >= 10000 ? 146 : 170) * Math.min(1, full))
}
