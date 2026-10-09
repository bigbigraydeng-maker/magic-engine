const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

interface IsoParts {
  year: number;
  month: number;
  day: number;
}

/** Parse a strict YYYY-MM-DD string into numeric parts, or null if invalid. */
function parseIsoParts(value: string): IsoParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Reject dates that roll over (e.g. 2027-02-30) via UTC round-trip.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Convert ISO parts to a UTC-midnight timestamp in milliseconds. */
function toUtcMillis(parts: IsoParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/** True only for real calendar dates in strict YYYY-MM-DD form. */
export function isValidIsoDate(value: string): boolean {
  return parseIsoParts(value) !== null;
}

/** Format a valid ISO date as "D Month YYYY" (e.g. "13 May 2027"). */
export function formatDepartureDisplay(iso: string): string {
  const parts = parseIsoParts(iso);
  if (parts === null) {
    throw new Error('invalid ISO date: ' + iso);
  }

  const monthName = MONTH_NAMES[parts.month - 1];
  return `${parts.day} ${monthName} ${parts.year}`;
}

/** Absolute whole number of calendar days between two valid ISO dates. */
export function daysBetween(isoA: string, isoB: string): number {
  const partsA = parseIsoParts(isoA);
  const partsB = parseIsoParts(isoB);
  if (partsA === null) {
    throw new Error('invalid ISO date: ' + isoA);
  }
  if (partsB === null) {
    throw new Error('invalid ISO date: ' + isoB);
  }

  const millisPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.abs(toUtcMillis(partsA) - toUtcMillis(partsB));
  return Math.round(diff / millisPerDay);
}

/** Calendar date of `now` in the given IANA time zone, as YYYY-MM-DD. */
export function todayIso(now: Date, timeZone: string = 'Pacific/Auckland'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('unable to resolve date parts for time zone: ' + timeZone);
  }

  return `${year}-${month}-${day}`;
}

const MONTH_NAMES_LOWER = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/**
 * Parse a display departure string like "13 May 2027" into an ISO date.
 * Returns null when the text is not exactly "D Month YYYY" or is not a real date.
 */
export function parseDepartureDisplay(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/)
  if (!match) return null
  const month = MONTH_NAMES_LOWER.indexOf(match[2].toLowerCase()) + 1
  if (month === 0) return null
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return isValidIsoDate(iso) ? iso : null
}
