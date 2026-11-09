export class DistributorTimeError extends Error {}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/

/** Parses an ISO instant. Rejects strings without an explicit offset so server timezone never leaks in. */
export function toMs(iso: string): number {
  if (!OFFSET_SUFFIX.test(iso)) throw new DistributorTimeError(`timestamp without offset: ${iso}`)
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new DistributorTimeError(`invalid timestamp: ${iso}`)
  return ms
}

/** Calendar month (YYYY-MM) of an instant in the given IANA timezone. */
export function monthKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(toMs(iso)))
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  if (!year || !month) throw new DistributorTimeError(`cannot derive month for ${iso}`)
  return `${year}-${month}`
}
