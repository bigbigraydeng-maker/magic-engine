import { createHash } from 'node:crypto'

/**
 * RFC 4122 URL namespace. Salt for verdict request ids only.
 * Not a client id, page id, or account id.
 */
export const VERDICT_REQUEST_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

export const SOCIAL_VERIFICATION_RECORD_TYPES = [
  'c1_fidelity',
  'c2_performance',
  'c3_goal_pace',
  'story_dm_count',
  'boost_check',
] as const

export type SocialVerificationRecordType = (typeof SOCIAL_VERIFICATION_RECORD_TYPES)[number]

function namespaceBytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('uuidVersion5: namespace is not a uuid')
  }
  return Buffer.from(hex, 'hex')
}

/** RFC 4122 UUID version 5 (SHA-1). */
export function uuidVersion5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(namespaceBytes(namespace)).update(Buffer.from(name, 'utf8')).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function isSocialVerificationRecordType(value: string): value is SocialVerificationRecordType {
  return (SOCIAL_VERIFICATION_RECORD_TYPES as readonly string[]).includes(value)
}

/** Same Inngest event id + record type always yields the same request id. */
export function socialVerificationRequestId(eventId: string, recordType: string): string {
  if (eventId.length === 0) {
    throw new Error('socialVerificationRequestId: eventId is required')
  }
  if (!isSocialVerificationRecordType(recordType)) {
    throw new Error('socialVerificationRequestId: recordType is not a verdict record type')
  }
  return uuidVersion5(VERDICT_REQUEST_NAMESPACE, `${eventId}:${recordType}`)
}
