import { describe, expect, it } from 'vitest'
import { toCardPayload } from '../card-list'

describe('toCardPayload', () => {
  it('drops a row that is not plain text', () => {
    expect(toCardPayload({ what: { raw: true } })).toBeNull()
    expect(toCardPayload(null)).toBeNull()
  })
})
