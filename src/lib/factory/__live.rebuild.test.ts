// @vitest-environment node
/** 临时执行器:重建 CTS 素材池(不是测试,跑完即删) */
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const CTS = 'c0000000-0000-0000-0000-000000000000'

describe('live', () => {
  it('rebuild pool', async () => {
    const { transformStockImages } = await import('./stock-pipeline')
    const { buildBusinessContext } = await import('./stock-scheduler')
    const ctx = buildBusinessContext(
      'China travel scenery',
      'Small-group escorted tours inside mainland China for New Zealand travellers, operated on the ground by China Travel Service.',
      {
        stock_off_topic: [
          'paris', 'italia', 'italy', 'positano', 'amalfi', 'santorini', 'greek', 'greece',
          'bali', 'maldives', 'dubai', 'iceland', 'switzerland', 'norway',
          'taiwan', 'jiufen', 'hong kong', 'japan', 'korea', 'vietnam', 'thailand',
        ],
      },
    )
    console.log('CONTEXT:', ctx)
    const r = await transformStockImages(CTS, { max: 12, businessContext: ctx })
    console.log('RESULT:', JSON.stringify(r, null, 2))
  }, 900_000)
})
