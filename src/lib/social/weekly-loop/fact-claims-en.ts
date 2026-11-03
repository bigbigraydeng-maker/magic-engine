export interface DurationClaim {
  kind: 'duration_days';
  days: number;
  text: string;
}

export interface StarClaim {
  kind: 'hotel_stars';
  stars: number[];
  text: string;
}

export interface MoneyClaim {
  kind: 'money';
  amount: number;
  text: string;
}

export interface MaskedPriceClaim {
  kind: 'masked_price';
  text: string;
}

export interface DateClaim {
  kind: 'date';
  iso: string | null;
  monthDay: string;
  text: string;
}

export interface CruiseClaim {
  kind: 'cruise_name';
  name: string;
  text: string;
}

export type FactClaim =
  | DurationClaim
  | StarClaim
  | MoneyClaim
  | MaskedPriceClaim
  | DateClaim
  | CruiseClaim;

interface IndexedClaim {
  index: number;
  claim: FactClaim;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
};

const TENS_WORDS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
};

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const CRUISE_STOPLIST: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'our',
  'your',
  'this',
  'that',
  'night',
  'evening',
  'day',
  'sunset',
  'scenic',
  'river',
  'yangtze',
  'boat',
  'star',
  'stars',
  'luxury',
  'overnight',
  'deluxe',
]);

const DURATION_REGEX =
  /(?<!\d\s?[-–]\s?)(?<![\d.,])(?:\d+|(?:twenty|thirty)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[-\s]?days?\b/gi;

const STAR_REGEX = /(?<![\d,.$])(\d)(?:\s*[-–—]\s*(\d))?[\s-]*stars?\b/gi;

const MONEY_REGEX =
  /(?:NZD|NZ|AUD|AU|USD|US)?\s?\$\s?(\d[\d,]*(?:\.\d{1,2})?)(X+)?/gi;

const DATE_REGEX =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?\b/gi;

const YEAR_SHARING_REGEX =
  /^(?:\s*(?:,|and|&)\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9})*\s+(20\d{2})\b/i;

const CRUISE_REGEX =
  /\b([A-Za-z]+)\s+(?:Yangtze\s+River\s+Cruise|Yangtze\s+Cruise|River\s+Cruise|Cruise)s?\b/gi;

function parseDurationNumber(raw: string): number | null {
  const lower = raw.toLowerCase().trim();
  if (/^\d+$/.test(lower)) {
    return parseInt(lower, 10);
  }
  const parts = lower.split(/[-\s]+/).filter((p) => p.length > 0);
  if (parts.length === 1) {
    const single = NUMBER_WORDS[parts[0]];
    return single === undefined ? null : single;
  }
  if (parts.length === 2) {
    const tens = TENS_WORDS[parts[0]];
    const ones = NUMBER_WORDS[parts[1]];
    if (tens !== undefined && ones !== undefined && ones < 10) {
      return tens + ones;
    }
  }
  return null;
}

function collectDurations(text: string): IndexedClaim[] {
  const out: IndexedClaim[] = [];
  for (const match of text.matchAll(DURATION_REGEX)) {
    const matched = match[0];
    const index = match.index ?? 0;
    const numberPart = matched.replace(/[-\s]?days?$/i, '');
    const days = parseDurationNumber(numberPart);
    if (days === null) continue;
    out.push({
      index,
      claim: { kind: 'duration_days', days, text: matched },
    });
  }
  return out;
}

function collectStars(text: string): IndexedClaim[] {
  const out: IndexedClaim[] = [];
  for (const match of text.matchAll(STAR_REGEX)) {
    const matched = match[0];
    const index = match.index ?? 0;
    const low = parseInt(match[1], 10);
    const highRaw = match[2];
    const high = highRaw === undefined ? low : parseInt(highRaw, 10);
    if (Number.isNaN(low) || Number.isNaN(high)) continue;
    const min = Math.min(low, high);
    const max = Math.max(low, high);
    const stars: number[] = [];
    for (let s = min; s <= max; s += 1) {
      stars.push(s);
    }
    out.push({
      index,
      claim: { kind: 'hotel_stars', stars, text: matched },
    });
  }
  return out;
}

function collectMoney(text: string): IndexedClaim[] {
  const out: IndexedClaim[] = [];
  for (const match of text.matchAll(MONEY_REGEX)) {
    const matched = match[0];
    const index = match.index ?? 0;
    const masked = match[2];
    if (masked !== undefined && masked.length > 0) {
      out.push({
        index,
        claim: { kind: 'masked_price', text: matched },
      });
      continue;
    }
    const numeric = match[1].replace(/,/g, '');
    const amount = parseFloat(numeric);
    if (Number.isNaN(amount)) continue;
    out.push({
      index,
      claim: { kind: 'money', amount, text: matched },
    });
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function findSharedYear(text: string, fromIndex: number): string | null {
  const rest = text.slice(fromIndex);
  const m = YEAR_SHARING_REGEX.exec(rest);
  if (m === null) return null;
  return m[1];
}

function collectDates(text: string): IndexedClaim[] {
  const out: IndexedClaim[] = [];
  for (const match of text.matchAll(DATE_REGEX)) {
    const matched = match[0];
    const index = match.index ?? 0;
    const day = parseInt(match[1], 10);
    const monthWord = match[2].toLowerCase();
    const month = MONTHS[monthWord];
    if (month === undefined) continue;
    if (day < 1 || day > 31) continue;
    const ownYear = match[3];
    const endIndex = index + matched.length;
    const year = ownYear !== undefined ? ownYear : findSharedYear(text, endIndex);
    const iso = year === null ? null : `${year}-${pad2(month)}-${pad2(day)}`;
    const monthDay = `${pad2(month)}-${pad2(day)}`;
    out.push({
      index,
      claim: { kind: 'date', iso, monthDay, text: matched },
    });
  }
  return out;
}

function isGenericCruiseWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (CRUISE_STOPLIST.has(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  return false;
}

function collectCruises(text: string): IndexedClaim[] {
  const out: IndexedClaim[] = [];
  for (const match of text.matchAll(CRUISE_REGEX)) {
    const matched = match[0];
    const index = match.index ?? 0;
    const name = match[1];
    if (isGenericCruiseWord(name)) continue;
    out.push({
      index,
      claim: { kind: 'cruise_name', name, text: matched },
    });
  }
  return out;
}

export function extractFactClaims(text: string): FactClaim[] {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }
  const all: IndexedClaim[] = [
    ...collectDurations(text),
    ...collectStars(text),
    ...collectMoney(text),
    ...collectDates(text),
    ...collectCruises(text),
  ];
  all.sort((a, b) => a.index - b.index);
  return all.map((entry) => entry.claim);
}
