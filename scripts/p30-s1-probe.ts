// Quick probe: check DataForSEO SERP results for AU + NZ tourism keywords
async function probe() {
const creds = Buffer.from(
  (process.env.DATAFORSEO_LOGIN ?? '') + ':' + (process.env.DATAFORSEO_PASSWORD ?? '')
).toString('base64')

const testKeywords = [
  'tour operator australia',
  'australia travel packages',
  'nz tour operator',
  'tours new zealand',
  'travel company australia',
]

const body = testKeywords.map(keyword => ({
  keyword,
  location_code: 2036,
  language_code: 'en',
  depth: 10,
}))

const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
  method: 'POST',
  headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const json = await res.json() as any

for (const task of (json.tasks ?? [])) {
  const kw = task.data?.keyword ?? '?'
  const items: any[] = task.result?.[0]?.items ?? []
  const organic = items.filter((i: any) => i.type === 'organic')
  console.log(`[${kw}] → ${organic.length} organic`)
  if (organic.length > 0) {
    organic.slice(0, 5).forEach((i: any) => {
      console.log(`  ${i.rank_absolute}. ${i.domain}`)
    })
  }
  if (task.status_message && task.status_message !== '20000 Ok.') {
    console.log(`  ⚠️ status: ${task.status_message}`)
  }
}
}

probe().catch(console.error)
