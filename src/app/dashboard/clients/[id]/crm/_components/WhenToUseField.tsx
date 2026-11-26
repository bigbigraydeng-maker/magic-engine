/**
 * Editor field for the colleague-facing "when to use" note.
 * The hint is a placeholder, so it disappears once someone types.
 */

import { WHEN_TO_USE_EMPTY_HINT, WHEN_TO_USE_MAX_LENGTH } from '@/lib/crm/email-templates/when-to-use'

export function WhenToUseField(props: { value: string; onChange: (value: string) => void }): JSX.Element {
  const { value, onChange } = props
  return (
    <label className="block md:col-span-2">
      <span className="mb-1.5 block text-[13px] font-bold text-me-charcoal">什么时候用</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="什么时候用"
        placeholder={WHEN_TO_USE_EMPTY_HINT}
        maxLength={WHEN_TO_USE_MAX_LENGTH}
        className="w-full rounded-[10px] border border-me-stone bg-white px-3.5 py-3 text-[15px] text-me-charcoal placeholder:text-status-attn"
      />
    </label>
  )
}
