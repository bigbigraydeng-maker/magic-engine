import type { StyleDifference } from '@/lib/factory/template-library/types'

const ROWS = [
  ['转场', 'transition'],
  ['文字', 'textMotion'],
  ['节奏', 'rhythm'],
  ['字幕', 'caption'],
] as const

/** Four lines a person can compare without playing every clip. */
export function DifferenceList({ difference }: { difference: StyleDifference }) {
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {ROWS.map(([label, key]) => (
        <div key={key}>
          <dt className="text-[13px] leading-5 text-me-charcoal/60">{label}</dt>
          <dd className="text-[15px] leading-6">{difference[key]}</dd>
        </div>
      ))}
    </dl>
  )
}
