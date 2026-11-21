import { MnConfigError, roundDiv } from './money'

export interface FxRate {
  yearMonth: string
  currency: string
  /** Micro-USD per 1.00 of `currency`. 0.60 USD per NZD is 600_000. Example rates are not a market price. */
  usdPerUnitMicros: number
  source: string
}

export interface FxTable {
  rates: readonly FxRate[]
}

/** Labelled example used only by tests and the plan's tables. Not a locked rate. */
export const EXAMPLE_FX_NZD_060: FxRate = {
  yearMonth: 'example',
  currency: 'NZD',
  usdPerUnitMicros: 600_000,
  source: 'example-not-a-market-rate',
}

export function requireFx(table: FxTable, yearMonth: string, currency: string): FxRate {
  const rate = table.rates.find((row) => row.yearMonth === yearMonth && row.currency === currency)
  if (!rate) throw new MnConfigError(`no locked exchange rate for ${currency} in ${yearMonth}`)
  if (!Number.isInteger(rate.usdPerUnitMicros) || rate.usdPerUnitMicros <= 0) {
    throw new MnConfigError(`exchange rate for ${currency} in ${yearMonth} is not usable`)
  }
  return rate
}

/** Net price cents → USD cents at a locked rate. Half-up to the cent. */
export function usdCents(amountNetCents: number, usdPerUnitMicros: number): number {
  if (!Number.isInteger(amountNetCents)) throw new MnConfigError('price must be integer cents')
  return Number(roundDiv(BigInt(amountNetCents) * BigInt(usdPerUnitMicros), 1_000_000n))
}

/** USD cents × distributor cap → MU cents. 1 MU cent = 1 USD cent. */
export function muCentsFromUsd(usdAmountCents: number, distributorCapBp: number): number {
  return Number(roundDiv(BigInt(usdAmountCents) * BigInt(distributorCapBp), 10_000n))
}

/** MU cents back to a local-currency cent amount at the payout month's locked rate. */
export function localCentsFromMu(muAmountCents: number, usdPerUnitMicros: number): number {
  if (usdPerUnitMicros <= 0) throw new MnConfigError('exchange rate is not usable')
  return Number(roundDiv(BigInt(muAmountCents) * 1_000_000n, BigInt(usdPerUnitMicros)))
}
