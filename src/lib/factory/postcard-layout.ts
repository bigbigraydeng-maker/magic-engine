// Queued postcard orders used to pin the title card and leave the logo on for the
// whole film. The template now dodges the subject unless the order opts in.

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** True when the order asked for a fixed card zone or an explicit layout. */
export function postcardManualLayout(cardZone: unknown, layoutOverride: unknown): boolean {
  if (typeof cardZone === 'string' && cardZone.trim().length > 0) return true
  return layoutOverride === true || layoutOverride === 'true'
}

/**
 * Drop a bare card height and a full-time logo from a postcard brief.
 * A manual layout (layoutOverride) is left as written. Other templates are untouched.
 */
export function releasePinnedPostcardLayout<T>(brief: T): T {
  if (!isRecord(brief)) return brief
  const remotion = brief.remotion
  if (!isRecord(remotion) || remotion.template !== 'postcard') return brief
  const props = remotion.props
  if (!isRecord(props) || props.layoutOverride === true) return brief
  if (!('cardTop' in props) && props.logoMode !== 'always') return brief
  const nextProps = { ...props }
  delete nextProps.cardTop
  if (nextProps.logoMode === 'always') delete nextProps.logoMode
  return { ...brief, remotion: { ...remotion, props: nextProps } } as T
}
