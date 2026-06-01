// 探针：查 CTS Tours / Wendy Wu NZ / Flight Centre NZ 的排名情况
// 以及确认这三个域名是否在 NZ SERP 上出现
async function probe() {
  const creds = Buffer.from(
    (process.env.DATAFORSEO_LOGIN ?? '') + ':' + (process.env.DATAFORSEO_PASSWORD ?? '')
  ).toString('base64')

  const LOCATION_NZ = 2554
  const LOCATION_AU = 2036

  // 先查 CTS 相关关键词（NZ 旅游运营商）
  const keywords = [
    'tours new zealand',            // 高流量通用词
    'nz guided tours',
    'ctstours new zealand',
    'coach tours new zealand',      // CTS 擅长的品类
    'luxury tours new zealand',
    'wendy wu tours nz',
    'flight centre nz tours',
  ]

  // 也直接用 DataForSEO domain analytics 查这几个域名的有机流量关键词
  const targetDomains = [
    'ctstours.com',
    'ctstours.co.nz',
    'wendywutours.co.nz',
    'flightcentre.co.nz',
    'flightcenter.co.nz',  // 拼写变体
  ]

  console.log('=== Part 1: SERP 关键词排名检查 ===\n')
  for (const keyword of keywords) {
    await new Promise(r => setTimeout(r, 800))
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, location_code: LOCATION_NZ, language_code: 'en', depth: 20 }]),
    })
    const json = await res.json() as any
    const items: any[] = json.tasks?.[0]?.result?.[0]?.items ?? []
    const organic = items.filter(i => i.type === 'organic')
    console.log(`[NZ] "${keyword}" → ${organic.length} organic`)
    organic.slice(0, 10).forEach((i: any) => {
      const domain = i.domain?.toLowerCase().replace(/^www\./, '') ?? ''
      const flag = ['ctstours', 'wendywu', 'flightcentre', 'flightcenter'].some(t => domain.includes(t)) ? ' ⭐' : ''
      console.log(`  ${String(i.rank_absolute).padEnd(3)} ${domain}${flag}`)
    })
  }

  console.log('\n=== Part 2: 域名有机关键词检查（DataForSEO Labs）===\n')
  for (const domain of targetDomains) {
    await new Promise(r => setTimeout(r, 800))
    const res = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        target: domain,
        location_code: LOCATION_NZ,
        language_code: 'en',
        limit: 5,
      }]),
    })
    const json = await res.json() as any
    const task = json.tasks?.[0]
    const items: any[] = task?.result?.[0]?.items ?? []
    const totalCount = task?.result?.[0]?.total_count ?? 0
    if (items.length === 0) {
      console.log(`${domain} → ❌ 无数据（total_count=${totalCount}）status: ${task?.status_message}`)
    } else {
      console.log(`${domain} → ✅ 有机关键词 ${totalCount} 个，top 5:`)
      items.slice(0, 5).forEach((i: any) => {
        console.log(`  "${i.keyword_data?.keyword}"  rank: ${i.ranked_serp_element?.serp_item?.rank_absolute}`)
      })
    }
  }
}

probe().catch(console.error)
