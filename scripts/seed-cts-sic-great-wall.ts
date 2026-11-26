/**
 * 一次性：在 CTS 的 tailor-made 板块新建「SIC-04 长城一日游」草稿。
 *
 * 默认只演练（打印将写入的内容，不写库）；加 --apply 才真写。
 * 用法：npx tsx --env-file=.env.local scripts/seed-cts-sic-great-wall.ts [--apply]
 */
import { createItinerary, nextQuoteRef, saveItinerary } from '../src/lib/tailor-made/store'
import { buildGreatWallSic } from '../src/lib/tailor-made/sic-great-wall'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

async function main() {
  const apply = process.argv.includes('--apply')
  const quoteRef = await nextQuoteRef(CTS_CLIENT_ID)
  const payload = buildGreatWallSic(quoteRef)

  if (!apply) {
    console.log(`[dry-run] 将新建草稿 ${quoteRef}: ${payload.trip.title} (type=${payload.trip.productType})`)
    return
  }

  const created = await createItinerary(CTS_CLIENT_ID)
  const saved = await saveItinerary(CTS_CLIENT_ID, created.id, { ...payload, meta: { ...payload.meta, quoteRef: created.quote_ref } })
  console.log(`已新建 ${saved.quote_ref} id=${saved.id}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
