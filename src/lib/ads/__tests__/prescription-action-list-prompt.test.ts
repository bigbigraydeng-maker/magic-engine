import { describe, expect, it } from 'vitest'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { HUATUO_GENERATION_SYSTEM_PROMPT } from '@/lib/huatuo/prompts'
import {
  prescriptionActionListPromptSection,
  prescriptionActionListSchemaExample,
} from '../prescription-action-list-prompt'

describe('prescriptionActionListPromptSection', () => {
  it('is injected into Huatuo generation system prompt', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(prescriptionActionListPromptSection())
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(prescriptionActionListSchemaExample())
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain('"action_list"')
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(ADS_ACTION_TYPE.PAUSE_AD_SET)
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toContain(ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET)
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/不要写顶层.*pause_ad_set/s)
  })
})
