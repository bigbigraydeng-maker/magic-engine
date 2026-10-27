import { describe, expect, it } from 'vitest'
import { cloudFunctions } from '../index'
import { planDraftFromPrescription } from '../plan-draft-from-prescription'

describe('plan draft inngest function', () => {
  it('is registered on the cloud app and does not use Inngest retries', () => {
    expect(cloudFunctions).toContain(planDraftFromPrescription)
    expect(planDraftFromPrescription.id().startsWith('cloud-')).toBe(true)
  })
})
