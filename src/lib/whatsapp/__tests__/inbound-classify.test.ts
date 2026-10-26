import { describe, it, expect } from 'vitest'
import { classifyInboundChanges } from '../inbound-classify'

/** Wrap a single change in the entry/changes envelope. */
function wrap(change: unknown): unknown {
  return { entry: [{ changes: [change] }] }
}

/** A change with a valid phone_number_id and the given field/value. */
function change(field: string | undefined, value: unknown): unknown {
  const base: Record<string, unknown> = { value }
  if (field !== undefined) base.field = field
  return base
}

const VALID_ID = '1234567890'

describe('classifyInboundChanges — top-level tolerance', () => {
  it('returns [] for null', () => {
    expect(classifyInboundChanges(null)).toEqual([])
  })

  it('returns [] for a string', () => {
    expect(classifyInboundChanges('nope')).toEqual([])
  })

  it('returns [] for {}', () => {
    expect(classifyInboundChanges({})).toEqual([])
  })

  it('returns [] when entry is not an array', () => {
    expect(classifyInboundChanges({ entry: 'x' })).toEqual([])
  })

  it('returns [] when entry is an array of non-objects', () => {
    expect(classifyInboundChanges({ entry: [1, 'a', null] })).toEqual([])
  })

  it('returns [] when changes is not an array', () => {
    expect(classifyInboundChanges({ entry: [{ changes: 'x' }] })).toEqual([])
  })
})

describe('classifyInboundChanges — legacy payload with no field', () => {
  it('treats a missing field as messages and emits customer_messages', () => {
    const payload = wrap({
      value: {
        metadata: { phone_number_id: VALID_ID, display_phone_number: '+15551234567' },
        contacts: [{ wa_id: '15550001111', profile: { name: 'Ada Lovelace' } }],
        messages: [
          {
            id: 'wamid.1',
            from: '15550001111',
            timestamp: '1700000000',
            type: 'text',
            text: { body: 'hello' },
          },
        ],
      },
    })
    expect(classifyInboundChanges(payload)).toEqual([
      {
        kind: 'customer_messages',
        phoneNumberId: VALID_ID,
        contactName: 'Ada Lovelace',
        messages: [
          {
            id: 'wamid.1',
            from: '15550001111',
            timestamp: '1700000000',
            type: 'text',
            text: { body: 'hello' },
          },
        ],
      },
    ])
  })
})

describe('classifyInboundChanges — messages field', () => {
  it('emits customer_messages and statuses independently from the same value', () => {
    const payload = wrap(
      change('messages', {
        metadata: { phone_number_id: VALID_ID },
        contacts: [{ profile: { name: 'Grace' } }],
        messages: [{ id: 'm1', from: '1', type: 'text', text: { body: 'hi' } }],
        statuses: [{ id: 's1', status: 'delivered', recipient_id: '1' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      {
        kind: 'customer_messages',
        phoneNumberId: VALID_ID,
        contactName: 'Grace',
        messages: [{ id: 'm1', from: '1', type: 'text', text: { body: 'hi' } }],
      },
      {
        kind: 'statuses',
        phoneNumberId: VALID_ID,
        statuses: [{ id: 's1', status: 'delivered', recipient_id: '1' }],
      },
    ])
  })

  it('emits statuses only when there are no messages', () => {
    const payload = wrap(
      change('messages', {
        metadata: { phone_number_id: VALID_ID },
        statuses: [{ id: 's1', status: 'read' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'statuses', phoneNumberId: VALID_ID, statuses: [{ id: 's1', status: 'read' }] },
    ])
  })

  it('emits malformed wrong_array_for_field when message_echoes is present', () => {
    const payload = wrap(
      change('messages', {
        metadata: { phone_number_id: VALID_ID },
        message_echoes: [{ id: 'e1' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'malformed', field: 'messages', reason: 'wrong_array_for_field' },
    ])
  })

  it('emits malformed wrong_array_for_field when history is present', () => {
    const payload = wrap(
      change('messages', {
        metadata: { phone_number_id: VALID_ID },
        history: [{ id: 'h1' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'malformed', field: 'messages', reason: 'wrong_array_for_field' },
    ])
  })

  it('emits nothing for empty arrays', () => {
    const payload = wrap(
      change('messages', {
        metadata: { phone_number_id: VALID_ID },
        messages: [],
        statuses: [],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([])
  })
})

describe('classifyInboundChanges — smb_message_echoes field', () => {
  it('emits echoes with displayNumber', () => {
    const payload = wrap(
      change('smb_message_echoes', {
        metadata: { phone_number_id: VALID_ID, display_phone_number: '+15550000000' },
        message_echoes: [{ id: 'e1', to: '15550001111', type: 'text', text: { body: 'ok' } }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      {
        kind: 'echoes',
        phoneNumberId: VALID_ID,
        displayNumber: '+15550000000',
        echoes: [{ id: 'e1', to: '15550001111', type: 'text', text: { body: 'ok' } }],
      },
    ])
  })

  it('emits malformed and NO customer_messages when messages[] is present', () => {
    const payload = wrap(
      change('smb_message_echoes', {
        metadata: { phone_number_id: VALID_ID },
        messages: [{ id: 'm1', from: '1', type: 'text', text: { body: 'hi' } }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'malformed', field: 'smb_message_echoes', reason: 'wrong_array_for_field' },
    ])
  })

  it('emits malformed when statuses[] is present', () => {
    const payload = wrap(
      change('smb_message_echoes', {
        metadata: { phone_number_id: VALID_ID },
        statuses: [{ id: 's1', status: 'delivered' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'malformed', field: 'smb_message_echoes', reason: 'wrong_array_for_field' },
    ])
  })
})

describe('classifyInboundChanges — history field', () => {
  it('emits history with itemCount from history[]', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID, display_phone_number: '+15550000000' },
        history: [{ id: 'h1' }, { id: 'h2' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      {
        kind: 'history',
        phoneNumberId: VALID_ID,
        displayNumber: '+15550000000',
        itemCount: 2,
        // Unrecognised chunk shapes (no `threads`) are counted but NOT forwarded: the route refuses
        // them loudly instead of acknowledging data it cannot read.
        chunks: [],
        mediaFollowUps: 0,
      },
    ])
  })

  it('emits history (never customer_messages) for a media follow-up with messages[]', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID },
        messages: [{ id: 'm1', from: '1', type: 'image', image: { id: 'media1' } }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'history', phoneNumberId: VALID_ID, itemCount: 1, chunks: [], mediaFollowUps: 1 },
    ])
  })

  it('returns chunks with thread data intact', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID },
        history: [
          {
            metadata: { phase: 1, chunk_order: 0, progress: 50 },
            threads: [
              {
                id: 't1',
                messages: [
                  { id: 'hm1', from: '1', to: '2', type: 'text', history_context: { status: 'read' } },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      {
        kind: 'history',
        phoneNumberId: VALID_ID,
        itemCount: 1,
        chunks: [
          {
            metadata: { phase: 1, chunk_order: 0, progress: 50 },
            threads: [
              {
                id: 't1',
                messages: [
                  { id: 'hm1', from: '1', to: '2', type: 'text', history_context: { status: 'read' } },
                ],
              },
            ],
          },
        ],
        mediaFollowUps: 0,
      },
    ])
  })

  it('counts media follow-ups and returns no chunks', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID },
        messages: [
          { id: 'm1', from: '1', type: 'image', image: { id: 'media1' } },
          { id: 'm2', from: '1', type: 'video', video: { id: 'media2' } },
        ],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'history', phoneNumberId: VALID_ID, itemCount: 2, chunks: [], mediaFollowUps: 2 },
    ])
  })

  it('a chunk without threads and without errors is unrecognised: counted, not forwarded (so it is refused, never silently acknowledged)', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID },
        history: [{ metadata: { phase: 1 } }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'history', phoneNumberId: VALID_ID, itemCount: 1, chunks: [], mediaFollowUps: 0 },
    ])
  })

  it('emits nothing when both arrays are empty', () => {
    const payload = wrap(
      change('history', {
        metadata: { phone_number_id: VALID_ID },
        history: [],
        messages: [],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([])
  })
})

describe('classifyInboundChanges — other fields', () => {
  it('ignores smb_app_state_sync', () => {
    const payload = wrap(
      change('smb_app_state_sync', {
        metadata: { phone_number_id: VALID_ID },
        state_sync: [{ type: 'contact' }],
      }),
    )
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'ignored', field: 'smb_app_state_sync' },
    ])
  })

  it('ignores a non-string field with a typeof marker', () => {
    const payload = wrap({ field: 42, value: { metadata: { phone_number_id: VALID_ID } } })
    expect(classifyInboundChanges(payload)).toEqual([{ kind: 'ignored', field: 'number' }])
  })
})

describe('classifyInboundChanges — bad phone_number_id', () => {
  const cases: Array<[string, unknown]> = [
    ['a number', 1234567890],
    ['missing', undefined],
    ['non-numeric string', 'abc'],
    ['empty string', ''],
    ['33 digits', '1'.repeat(33)],
  ]

  for (const [label, id] of cases) {
    it(`emits malformed bad_phone_number_id for ${label}`, () => {
      const metadata: Record<string, unknown> = {}
      if (id !== undefined) metadata.phone_number_id = id
      const payload = wrap(change('messages', { metadata, messages: [{ id: 'm1' }] }))
      expect(classifyInboundChanges(payload)).toEqual([
        { kind: 'malformed', field: 'messages', reason: 'bad_phone_number_id' },
      ])
    })
  }

  it('emits malformed when metadata is missing entirely', () => {
    const payload = wrap(change('messages', { messages: [{ id: 'm1' }] }))
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'malformed', field: 'messages', reason: 'bad_phone_number_id' },
    ])
  })
})

describe('classifyInboundChanges — ordering across entries and changes', () => {
  it('preserves encounter order across two entries with two changes each', () => {
    const payload = {
      entry: [
        {
          changes: [
            change('messages', {
              metadata: { phone_number_id: '111' },
              messages: [{ id: 'a' }],
            }),
            change('smb_app_state_sync', { metadata: { phone_number_id: '111' } }),
          ],
        },
        {
          changes: [
            change('history', {
              metadata: { phone_number_id: '222' },
              history: [{ id: 'h' }],
            }),
            change('messages', {
              metadata: { phone_number_id: '222' },
              statuses: [{ id: 's' }],
            }),
          ],
        },
      ],
    }
    expect(classifyInboundChanges(payload)).toEqual([
      { kind: 'customer_messages', phoneNumberId: '111', messages: [{ id: 'a' }] },
      { kind: 'ignored', field: 'smb_app_state_sync' },
      { kind: 'history', phoneNumberId: '222', itemCount: 1, chunks: [], mediaFollowUps: 0 },
      { kind: 'statuses', phoneNumberId: '222', statuses: [{ id: 's' }] },
    ])
  })
})

describe('declined history sharing', () => {
  it('history:[{errors}] with no threads is ignored, not refused', () => {
    const payload = {
      entry: [{ changes: [{ field: 'history', value: { metadata: { phone_number_id: '123' }, history: [{ errors: [{ code: 2593109 }] }] } }] }],
    }
    expect(classifyInboundChanges(payload)).toEqual([{ kind: 'ignored', field: 'history_declined' }])
  })
})

