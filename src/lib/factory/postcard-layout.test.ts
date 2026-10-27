import { describe, expect, it } from 'vitest'
import { postcardManualLayout, releasePinnedPostcardLayout } from './postcard-layout'

const pinned = {
  remotion: {
    template: 'postcard',
    props: { cardTop: 870, logoMode: 'always', hook: { lines: ['A'] } },
  },
}

describe('releasePinnedPostcardLayout', () => {
  it('drops a pinned height and a full-time logo so the template can dodge the subject', () => {
    const next = releasePinnedPostcardLayout(pinned)
    const props = (next.remotion as { props: Record<string, unknown> }).props
    expect(props.cardTop).toBeUndefined()
    expect(props.logoMode).toBeUndefined()
    expect(props.hook).toEqual({ lines: ['A'] })
    expect(pinned.remotion.props.cardTop).toBe(870)
  })

  it('keeps a layout someone marked as manual', () => {
    const manual = {
      remotion: { template: 'postcard', props: { cardTop: 800, logoMode: 'always', layoutOverride: true } },
    }
    expect(releasePinnedPostcardLayout(manual)).toBe(manual)
  })

  it('leaves other templates alone', () => {
    const list = { remotion: { template: 'list', props: { logoMode: 'always' } } }
    expect(releasePinnedPostcardLayout(list)).toBe(list)
  })
})

describe('postcardManualLayout', () => {
  it('flags a zone or an explicit override, not a bare height', () => {
    expect(postcardManualLayout('lower', undefined)).toBe(true)
    expect(postcardManualLayout(undefined, 'true')).toBe(true)
    expect(postcardManualLayout(undefined, undefined)).toBe(false)
    expect(postcardManualLayout('', false)).toBe(false)
  })
})
