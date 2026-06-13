import { describe, expect, it } from 'vitest'
import { sanitizeInternalLinks } from '../internal-links-sanitize'

describe('sanitizeInternalLinks', () => {
  it('passes well-formed rows through verbatim', () => {
    const input = [
      { anchor: 'engineered timber', target_slug: '/products/engineered-timber', resolved: true  },
      { anchor: 'spc flooring',      target_slug: '/products/spc',               resolved: false },
    ]
    expect(sanitizeInternalLinks(input)).toEqual(input)
  })

  it('returns [] for any non-array input', () => {
    expect(sanitizeInternalLinks(null)).toEqual([])
    expect(sanitizeInternalLinks(undefined)).toEqual([])
    expect(sanitizeInternalLinks('not-an-array')).toEqual([])
    expect(sanitizeInternalLinks({})).toEqual([])
    expect(sanitizeInternalLinks(42)).toEqual([])
  })

  it('coerces non-string anchor / target_slug into empty string', () => {
    const out = sanitizeInternalLinks([
      { anchor: 123,        target_slug: { nested: 'evil' }, resolved: true },
      { anchor: undefined,  target_slug: null,               resolved: false },
    ])
    expect(out).toEqual([
      { anchor: '', target_slug: '', resolved: true  },
      { anchor: '', target_slug: '', resolved: false },
    ])
  })

  it('truncates anchor at 200 chars and target_slug at 200 chars', () => {
    const long = 'a'.repeat(500)
    const out  = sanitizeInternalLinks([
      { anchor: long, target_slug: long, resolved: true },
    ])
    expect(out[0].anchor).toHaveLength(200)
    expect(out[0].target_slug).toHaveLength(200)
  })

  it('treats resolved with STRICT === true; truthy values do not sneak in', () => {
    const out = sanitizeInternalLinks([
      { anchor: 'a', target_slug: 's', resolved: 'true'  as unknown as boolean },
      { anchor: 'a', target_slug: 's', resolved: 1       as unknown as boolean },
      { anchor: 'a', target_slug: 's', resolved: {}      as unknown as boolean },
      { anchor: 'a', target_slug: 's', resolved: ['1']   as unknown as boolean },
      { anchor: 'a', target_slug: 's', resolved: 'yes'   as unknown as boolean },
      { anchor: 'a', target_slug: 's', resolved: true                          },
    ])
    expect(out.map(r => r.resolved)).toEqual([false, false, false, false, false, true])
  })

  it('skips silent fields — only anchor / target_slug / resolved survive', () => {
    const out = sanitizeInternalLinks([
      {
        anchor:        'a',
        target_slug:   's',
        resolved:      true,
        evil_field:    'xss',
        __proto__:     { bad: 1 },
        nested:        { deep: { thing: 'x' } },
      } as Record<string, unknown>,
    ])
    // Whatever the sanitizer returns, it must NOT carry extra fields.
    expect(Object.keys(out[0]).sort()).toEqual(['anchor', 'resolved', 'target_slug'])
  })

  it('tolerates null entries inside the array (treats them as empty rows)', () => {
    const out = sanitizeInternalLinks([null, undefined, { anchor: 'a', target_slug: 's', resolved: true }])
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ anchor: '', target_slug: '', resolved: false })
    expect(out[1]).toEqual({ anchor: '', target_slug: '', resolved: false })
    expect(out[2]).toEqual({ anchor: 'a', target_slug: 's', resolved: true })
  })
})
