import { describe, expect, it } from 'vitest'
import { readLimitedBody } from './read-limited-body'

describe('readLimitedBody', () => {
  it('returns the concatenated body when it stays within the limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })

    expect(await readLimitedBody(body, 3)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('cancels and rejects a body that exceeds the limit', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
      },
      cancel() {
        cancelled = true
      },
    })

    expect(await readLimitedBody(body, 2)).toBeNull()
    expect(cancelled).toBe(true)
  })
})
