/**
 * Magic Engine design tokens — single source of truth.
 * Mirrors tailwind.config.ts `me.*` and `status.*` colors.
 */

export const ME = {
  ivory:    '#FBF8F3',
  stone:    '#EAE6DF',
  ochre:    '#C4912E',
  gold:     '#EBCB8B',
  charcoal: '#1A1A1A',
  black:    '#0D0D0D',
  taupe:    '#B7B1A5',
} as const

export const GOLD_GRADIENT = 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)'

export const STATUS = {
  track: { fg: '#5C8A4A', bg: 'rgba(92,138,74,.12)' },
  exec:  { fg: '#C4912E', bg: 'rgba(196,145,46,.14)' },
  attn:  { fg: '#8A8276', bg: 'rgba(183,177,165,.20)' },
  sched: { fg: '#3E6E8C', bg: 'rgba(62,110,140,.14)' },
  rej:   { fg: '#C2453A', bg: 'rgba(194,69,58,.12)' },
} as const

export type StatusTone = keyof typeof STATUS

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
