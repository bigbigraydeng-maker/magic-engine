/**
 * Shared Tailwind class strings for the CRM "订单与付款" feature.
 *
 * Only exported string constants live here so that every booking component
 * renders buttons, inputs and notices with the same look and feel.
 */

export const INPUT_CLASS =
  'min-h-[44px] w-full rounded-lg border border-me-charcoal/25 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre'

export const LABEL_CLASS = 'block text-sm font-semibold text-me-charcoal'

export const BUTTON_BASE =
  'inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 py-2 text-sm font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40'

export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-me-charcoal text-white hover:bg-me-charcoal/90`

export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-me-charcoal/25 bg-white text-me-charcoal hover:bg-me-ivory`

export const DANGER_BUTTON = `${BUTTON_BASE} border border-[#C2453A]/50 bg-white text-[#9B2C22] hover:bg-[#C2453A]/10`

export const ERROR_TEXT = 'text-sm font-semibold text-[#9B2C22]'

export const NOTICE_CLASS =
  'rounded-lg border border-me-ochre/40 bg-me-ochre/10 px-3 py-2 text-sm font-semibold text-me-charcoal'

export const WARNING_CLASS =
  'rounded-lg border border-[#B45309]/40 bg-[#B45309]/10 px-3 py-2 text-sm font-semibold text-[#7C3A06]'

export const CARD_CLASS = 'rounded-xl border border-me-charcoal/15 bg-white p-3'

export const MUTED_TEXT = 'text-xs text-me-charcoal/70'
