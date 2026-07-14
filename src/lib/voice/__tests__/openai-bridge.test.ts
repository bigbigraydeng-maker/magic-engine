import { describe, it, expect } from 'vitest'
import {
  mapRealtimeEvent, buildFunctionOutputFrame, buildResponseCreateFrame, greetingInstruction,
} from '../realtime/openai-bridge'

describe('mapRealtimeEvent (spec §8.5, pure + total)', () => {
  it('session.created', () => {
    expect(mapRealtimeEvent({ type: 'session.created' })).toEqual([{ type: 'session.created' }])
  })

  it('user speech transcription completed → user_transcript', () => {
    const out = mapRealtimeEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'I want flooring', event_id: 'e1',
    })
    expect(out).toEqual([{ type: 'user_transcript', text: 'I want flooring', sourceEventId: 'e1' }])
  })

  it('empty user transcript → dropped', () => {
    expect(mapRealtimeEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: '' })).toEqual([])
  })

  it('assistant audio transcript done → assistant_transcript', () => {
    const out = mapRealtimeEvent({ type: 'response.audio_transcript.done', transcript: 'Sure, happy to help' })
    expect(out).toEqual([{ type: 'assistant_transcript', text: 'Sure, happy to help', sourceEventId: undefined }])
  })

  it('alternate assistant transcript event name is handled', () => {
    const out = mapRealtimeEvent({ type: 'response.output_audio_transcript.done', transcript: 'x' })
    expect(out[0]).toMatchObject({ type: 'assistant_transcript', text: 'x' })
  })

  it('response.text.done → assistant_transcript', () => {
    expect(mapRealtimeEvent({ type: 'response.text.done', text: 'hello' })[0]).toMatchObject({ type: 'assistant_transcript', text: 'hello' })
  })

  it('response.done with a function_call → function_call event with parsed args', () => {
    const out = mapRealtimeEvent({
      type: 'response.done',
      response: { output: [{ type: 'function_call', name: 'create_or_update_lead', arguments: '{"intent_level":"high"}', call_id: 'fc_1' }] },
    })
    expect(out).toEqual([{ type: 'function_call', name: 'create_or_update_lead', arguments: { intent_level: 'high' }, callId: 'fc_1' }])
  })

  it('response.done with multiple function_calls → multiple events', () => {
    const out = mapRealtimeEvent({
      type: 'response.done',
      response: { output: [
        { type: 'function_call', name: 'a', arguments: '{}', call_id: 'c1' },
        { type: 'message', content: [] },
        { type: 'function_call', name: 'b', arguments: '{}', call_id: 'c2' },
      ] },
    })
    expect(out.map((o) => (o as { name: string }).name)).toEqual(['a', 'b'])
  })

  it('malformed function_call arguments → {} (never throws)', () => {
    const out = mapRealtimeEvent({
      type: 'response.done',
      response: { output: [{ type: 'function_call', name: 'x', arguments: 'not json', call_id: 'c' }] },
    })
    expect((out[0] as { arguments: unknown }).arguments).toEqual({})
  })

  it('response.done with no output → []', () => {
    expect(mapRealtimeEvent({ type: 'response.done', response: {} })).toEqual([])
  })

  it('error event → error normalized', () => {
    expect(mapRealtimeEvent({ type: 'error', error: { message: 'rate limited' } })).toEqual([{ type: 'error', message: 'rate limited' }])
  })

  it('rate_limits.updated → rate_limits', () => {
    expect(mapRealtimeEvent({ type: 'rate_limits.updated', rate_limits: [] })[0]).toMatchObject({ type: 'rate_limits' })
  })

  it('unknown event type → []', () => {
    expect(mapRealtimeEvent({ type: 'response.audio.delta' })).toEqual([])
  })

  it('garbage inputs never throw', () => {
    expect(mapRealtimeEvent(null)).toEqual([])
    expect(mapRealtimeEvent(undefined)).toEqual([])
    expect(mapRealtimeEvent('string')).toEqual([])
    expect(mapRealtimeEvent(42)).toEqual([])
    expect(mapRealtimeEvent({})).toEqual([])
  })
})

describe('client→server frames', () => {
  it('function output frame', () => {
    expect(buildFunctionOutputFrame('fc_1', '{"ok":true}')).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'fc_1', output: '{"ok":true}' },
    })
  })
  it('response.create without instructions', () => {
    expect(buildResponseCreateFrame()).toEqual({ type: 'response.create' })
  })
  it('response.create with instructions', () => {
    expect(buildResponseCreateFrame('say hi')).toEqual({ type: 'response.create', response: { instructions: 'say hi' } })
  })
  it('greeting instruction forces verbatim disclosure line (板桥 #1)', () => {
    const g = 'This is Mia, the AI assistant for Magic Engine.'
    expect(greetingInstruction(g)).toContain(g)
    expect(greetingInstruction(g)).toMatch(/verbatim/i)
  })
})
