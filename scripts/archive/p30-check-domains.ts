async function main() {
  const creds = Buffer.from(
    (process.env.DATAFORSEO_LOGIN ?? '') + ':' + (process.env.DATAFORSEO_PASSWORD ?? '')
  ).toString('base64')

  for (const keyword of ['carpet court brisbane', 'carpet call brisbane']) {
    await new Promise(r => setTimeout(r, 800))
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, location_code: 2036, language_code: 'en', depth: 5 }]),
    })
    const json = await res.json() as any
    const items: any[] = json.tasks?.[0]?.result?.[0]?.items ?? []
    console.log(`\n[${keyword}]`)
    items.filter((i: any) => i.type === 'organic').slice(0, 3).forEach((i: any) =>
      console.log(`  ${i.rank_absolute}. ${i.domain}`)
    )
  }
}
main().catch(console.error)
