# WebSearch connector — B2B NZ channel discovery spike

Date: 2026-08-11
Method: Claude's built-in `WebSearch` tool only (no WebFetch — page content came entirely from
search-result titles/snippets). All contact details, phone numbers, and emails below are
copy-pasted verbatim from what the search snippets returned, not inferred or guessed.

## Queries run

Required Chinese buckets (all run):
- 新西兰定制游 旅行社
- 新西兰私家团 定制
- 新西兰小团 包车 旅游
- 新西兰亲子游 定制 旅行社
- 新西兰蜜月 定制游
- 新西兰高端定制游
- 新西兰南北岛 跟团
- 新西兰地接 旅行社
- 澳新定制 旅行社
- 澳新专线 批发 *(returned freight/logistics results — "专线" collides with the cargo-shipping industry term; not useful, see below)*
- 澳新旅游批发商 *(better phrasing than "澳新专线 批发")*
- 皇后镇定制游

Extra queries I added beyond the required list, because the required set under-covered "who sells NZ product" and "who is the named individual":
- 澳新产品经理 招聘 旅游 / 新西兰产品经理 旅游 招聘 / 澳新计调 / 澳新 OP 旅游 计调 招聘 (all four required-bucket recruiting queries)
- linkedin 新西兰产品经理 旅游
- China New Zealand tour wholesaler (English)
- China ANZ product manager travel company (English)
- 众信旅游 澳新 产品经理 / 众信旅游 新西兰 产品线 / utourworld.com 商务合作 联系电话 邮箱
- 新域假期 澳新 批发 中青旅遨游 / 中青旅遨游国际旅游有限公司 联系方式 供应商合作
- 凯撒旅游 澳新 产品 / 凯撒旅游 新西兰 产品经理 招聘
- 康辉旅游 澳新 产品
- 无二之旅 新西兰 定制 / 无二之旅 uniqueway 联系方式 客服电话
- 6人游 新西兰 / 6人游 新西兰旅游局 合作 负责人 / 6renyou.com 6人游 联系方式 商务合作
- 走着瞧 新西兰 定制游 / 大鱼定制游 新西兰 *(both dead ends — no such brand found)*
- 佰悦会 100.travel 公司简介 联系方式
- 零时差定制旅行 公司 新西兰 联系 *(dead end — company not confirmed to exist under that name)*
- 未来时光triphour 新西兰 定制 联系方式 *(WebSearch tool returned "unavailable" — transient error, not retried since 未来时光 was a minor lead)*
- 新西兰旅游局 中国 代理 合作旅行社 名单 (found a 2013 "Preferred Partner" list — see caveats)
- traveltrade.newzealand.com 中国 合作伙伴 认证旅行社 / 新西兰旅游专家计划 认证旅行社 2026 (tried to find a *current* official partner list — no luck, Tourism NZ's trade site isn't well indexed)
- utourworld.com 合作伙伴 澳新 / 飞猪 新西兰 商家 招商 合作
- 广东中旅 gdcts 新西兰 产品 / 广东中旅 gdcts.com 联系电话 商务合作
- 开元周游 新西兰 产品经理 / 途风旅游网 toursforfun 公司 总部

## What worked

- **Finding companies that clearly sell NZ product**: easy. Nearly every Chinese-language query
  surfaced multiple named agencies with dedicated NZ itinerary pages. The signal is abundant —
  China's outbound-travel content ecosystem (agency blogs, SEO landing pages) is optimized for
  exactly these search terms.
- **Distinguishing China-side sellers from NZ-side inbound DMCs**: this was the single biggest
  quality trap. A huge fraction of "新西兰定制游/私家团/地接" results are NZ-based Chinese-owned
  DMCs (新西兰中国旅行社/nznznz.cn, 万国旅行社, NZ Delight, Pacific Delight, 新乐途, NZEX, etc.) —
  i.e. companies on the *same side of the market* as our client, not China-side buyers. Per the
  brief these are excluded unless they explicitly resell/wholesale into China, which none of the
  ones I found do. I dropped all of them from leads.json even though they dominated raw hit
  counts.
- **Official Tourism NZ partnership signals** were a good high-confidence anchor: found explicit
  mentions of 6人游, 凯撒旅游, and 飞猪 as named Tourism NZ partners, plus a 2013 news article
  listing 5 "首选合作伙伴" (Preferred Partners) agencies in Guangdong/Shenzhen. These give real
  verifiable NZ-selling intent even without fresh product pages.
- **Finding current, live NZ product listings**: 广东中旅 (GDCTS) was the standout — its mobile
  site returned 7+ distinct, dated, still-live NZ tour product URLs directly in search results
  (South Island/North Island combos, ANZ combo tours), which is about as strong as WebSearch-only
  evidence gets without WebFetch.
- **Finding a real business-cooperation contact channel** (not just a named person, but at least
  a partnership-specific email/phone distinct from general customer service): worked for 3 of 14
  — 佰悦会 (bianca.sui@baitravel.com), 无二之旅 (partnership@uniqueway.com /
  marketing@uniqueway.com), 众信旅游 (ucc@Utourworld.com, business-cooperation subsidiary).

## What did not work / limits

- **Named individual decision-makers**: this was the weakest dimension by far. All "产品经理
  招聘"/"计调"/"OP" recruiting-style queries returned generic job-board noise (BOSS直聘/猎聘
  category pages, unrelated NZ visa/welding-job listings) rather than a specific person's name at
  a specific company. Zero named individuals (Lead type D) were found. The only "name" in the
  whole dataset is an inferred first/last name from an email local-part
  (bianca.sui@baitravel.com) at 佰悦会 — flagged in the record as unverified/inferred, not a
  confirmed job title.
- **WeChat IDs**: zero found across all 14 leads. WeChat business contact info basically never
  surfaces in search snippets (it lives behind QR codes on landing pages, not indexed text).
- **Phone/email for the biggest players** (中青旅遨游, 凯撒旅游, 飞猪, 途风网, 开元周游): general
  switchboard numbers were sometimes findable, but partnership-specific channels were not — you'd
  need to click into a "商务合作/招商入驻" page, which requires WebFetch/browsing, not WebSearch.
- **"澳新专线 批发"** as a literal query bucket is close to useless — "专线" is overwhelmingly a
  cargo-shipping/logistics term (China→Australia parcel freight), not a travel-wholesale term.
  "澳新旅游批发商" or "澳新批发" phrasing works much better for the travel-wholesale meaning.
- **Verifying "still active today" for older signals**: the 2013 Tourism NZ Preferred Partner
  list (广东中旅, 深圳中国国际旅行社, 深圳市中侨国际旅行社, 深圳市康辉旅行社, 港中旅深圳招商国际旅游)
  is 13 years old. I could re-confirm current NZ activity for GDCTS only (via live product URLs);
  the other 4 got downgraded to low confidence (0.25–0.4) rather than dropped, since the company
  names themselves are real and checkable — just the "currently selling NZ" claim is stale.
- Two named boutique-brand guesses (走着瞧, 大鱼定制游) turned out to not exist under those names
  in China's NZ-custom-travel space — dead ends, correctly not included.
- One query ("未来时光triphour...") hit a transient "Web search tool unavailable" error.

## Honest 1–5 ratings

| Dimension | Score | Notes |
|---|---|---|
| Ease of finding real companies selling NZ | 5/5 | Overwhelming supply; every bucket query returned multiple hits. Hard part is filtering NZ-side DMCs out, not finding candidates. |
| Ease of finding the company name | 5/5 | Company names come straight out of search titles/snippets, no ambiguity. |
| Ease of finding a named decision-maker | 1/5 | Zero confirmed named individuals in 14 leads across ~35 queries. Recruiting-style queries don't surface people, they surface job-board category pages. |
| Ease of finding public contact info (phone/email/wechat) | 2.5/5 | General switchboard phone/email found for ~6/14 (mostly via a company's own "商务合作/联系我们" page snippet). Partnership-specific channel found for only 3/14. WeChat: 0/14. |
| Evidence quality | 3.5/5 | Strong for companies with dedicated live product pages (GDCTS) or an explicit named Tourism NZ partnership (6人游, 凯撒, 飞猪). Weak/stale for the 2013 Preferred Partner list entries — had to mark those low-confidence rather than pretend they're current. |
| Automatable for a recurring pipeline | 3/5 | The query patterns are repeatable and cheap (WebSearch only, no scraping/auth needed), so a scheduled job re-running this bucket list would keep surfacing fresh product pages and news mentions. But WebSearch-only can't reliably get past switchboard-level contact info or find named people — a recurring pipeline would need a WebFetch/crawl step into each company's own "招商合作/加入我们" page, plus a business-directory or LinkedIn-style connector, to meaningfully improve the contact-completeness numbers above. |

## Bottom line for whoever picks this up next

WebSearch alone is a good **discovery** connector (finds real companies + real NZ-selling
evidence fast) but a weak **contact-enrichment** connector (can't reliably get past the front
door — no named people, almost no direct emails/phones beyond general switchboards, zero WeChat).
If this pipeline gets built for real, pair WebSearch discovery with a WebFetch/crawl pass into
each company's own contact/BD page, and treat named-decision-maker discovery as a separate,
harder problem (LinkedIn-style connector or manual BD outreach), not something WebSearch will
solve.
