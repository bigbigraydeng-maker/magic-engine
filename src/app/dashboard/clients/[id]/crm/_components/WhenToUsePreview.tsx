/**
 * List-card line from the template page design: label plus the note.
 * An empty note renders nothing.
 */

export function WhenToUsePreview({ text }: { text?: string | null }): JSX.Element | null {
  const value = (text ?? '').trim()
  if (value === '') return null
  return (
    <p data-testid="when-to-use-preview" className="mt-1 flex gap-1 text-xs leading-normal">
      <span className="shrink-0 font-medium text-me-charcoal">什么时候用：</span>
      <span className="text-status-attn">{value}</span>
    </p>
  )
}
