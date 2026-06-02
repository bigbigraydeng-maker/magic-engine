/**
 * Zhangqian Discovery - DOCX Report Generator
 *
 * Converts a DiscoveryReport into a customer-ready Magic Engine document.
 * Keep this deliverable free of internal vendor names.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { DiscoveryReport } from './types'

const BRAND_COLOR = '020617'
const ACCENT_COLOR = '0E7490'
const MUTED_COLOR = '64748B'
const HEADER_FILL = 'ECFEFF'
const PAGE_WIDTH = 9360
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }

export async function generateZhangqianDocx(
  report: DiscoveryReport,
  clientName: string,
  reportDate: string = new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' }),
): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        ...cover(clientName, report, reportDate),
        ...businessSection(report),
        ...diagnosisSection(report),
        ...keywordsSection(report),
        ...competitorsSection(report),
        ...aiVisibilitySection(report),
        ...serpResultsSection(report),
        ...socialSection(report),
        ...gbpSection(report),
        ...reviewPlatformsSection(report),
        ...paidSocialSection(report),
        ...advancedSection(report),
        ...techStackSection(report),
        ...domainWhoisSection(report),
        ...onpageAuditSection(report),
        ...actionPlanSection(report),
        ...(report.notes ? notesSection(report.notes) : []),
      ],
    }],
  })
  const buf = await Packer.toBuffer(doc)
  return Buffer.from(buf)
}

function cover(clientName: string, report: DiscoveryReport, date: string): Paragraph[] {
  const business = report.business
  const overallScore = report.diagnosis?.scores.overall ?? null
  const location = [business.location.city, business.location.region, business.location.country]
    .filter(Boolean)
    .join(', ')

  return [
    label('MAGIC ENGINE'),
    h1('Discovery Report'),
    h1(clientName),
    bodyBold(report.domain),
    body(date),
    spacer(),
    ...(overallScore !== null ? [statLine('Overall score', `${overallScore} / 100`)] : []),
    ...(business.industry.length ? [statLine('Industry', business.industry.join(' / '))] : []),
    ...(location ? [statLine('Market', location)] : []),
    statLine('Competitors mapped', String(report.competitors.length)),
    statLine('Keyword opportunities', String(report.seed_keywords.length)),
    spacer(),
    body('This report summarises public brand, search, social, reputation, and AI visibility signals. It is designed to support prioritised execution, not to replace human commercial judgement.'),
    pageBreak(),
  ]
}

function businessSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const business = report.business
  const items: (Paragraph | Table)[] = [h2('Business Overview')]

  if (business.description) {
    items.push(body(business.description))
    items.push(spacer())
  }

  const infoRows: string[][] = []
  if (business.target_audience.length) {
    infoRows.push(['Target audience', business.target_audience.join(', ')])
  }
  if (business.unique_selling_points.length) {
    infoRows.push(['Unique selling points', business.unique_selling_points.join('; ')])
  }
  if (business.registration) {
    const reg = business.registration
    infoRows.push([
      `${reg.identifier_type}`,
      `${reg.identifier} — ${reg.entity_type ?? reg.entity_name ?? '-'} (${reg.status})`,
    ])
    if (reg.registered_since) {
      infoRows.push(['Registered since', reg.registered_since])
    }
  }
  if (business.phone_numbers?.length) {
    infoRows.push(['Phone', business.phone_numbers.join(', ')])
  }
  if (business.emails?.length) {
    infoRows.push(['Email', business.emails.join(', ')])
  }

  if (infoRows.length) {
    items.push(table(['Field', 'Detail'], infoRows))
  }

  items.push(pageBreak())
  return items
}

function diagnosisSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const diagnosis = report.diagnosis
  if (!diagnosis) return []

  const rows: string[][] = [
    ['SEO', String(diagnosis.scores.seo)],
    ['Social', String(diagnosis.scores.social)],
    ['Reputation', String(diagnosis.scores.reputation)],
    ['AI visibility', String(diagnosis.scores.ai_visibility)],
    ['Overall', String(diagnosis.scores.overall)],
  ]

  return [
    h2('Executive Diagnosis'),
    ...(diagnosis.crisis_type ? [statLine('Primary diagnosis', diagnosis.crisis_type)] : []),
    body(diagnosis.executive_summary),
    spacer(),
    bodyBold(`Key finding: ${diagnosis.key_finding}`),
    bodyBold('Where money is leaking'),
    body(diagnosis.money_flow),
    spacer(),
    h3('Health scores'),
    table(['Dimension', 'Score'], rows),
    pageBreak(),
  ]
}

function keywordsSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const keywords = report.seed_keywords
  if (!keywords.length) return []

  const rows = keywords.map(keyword => [
    keyword.keyword,
    keyword.type,
    keyword.semrush_volume != null ? String(keyword.semrush_volume) : (keyword.estimated_volume != null ? `~${keyword.estimated_volume}` : '-'),
    keyword.semrush_kd != null ? String(keyword.semrush_kd) : '-',
    keyword.semrush_rank != null ? `#${keyword.semrush_rank}` : '-',
    keyword.semrush_cpc != null ? `$${keyword.semrush_cpc.toFixed(2)}` : '-',
    keyword.rationale,
  ])

  const snap = report.semrush_snapshot
  const snapItems: Paragraph[] = snap ? [
    h3('Keyword Intelligence snapshot'),
    ...(snap.monthly_traffic != null ? [statLine('Estimated monthly traffic', snap.monthly_traffic.toLocaleString())] : []),
    ...(snap.keyword_count != null ? [statLine('Ranking keywords', snap.keyword_count.toLocaleString())] : []),
    ...(snap.trust_score != null ? [statLine('Authority score', String(snap.trust_score))] : []),
    spacer(),
  ] : []

  return [
    h2('Search Opportunities'),
    ...snapItems,
    h3('Seed keyword set'),
    table(['Keyword', 'Type', 'Volume', 'Difficulty', 'Rank', 'CPC', 'Rationale'], rows),
    pageBreak(),
  ]
}

function competitorsSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const competitors = report.competitors
  if (!competitors.length) return []

  const rows = competitors.map(competitor => [
    competitor.name,
    competitor.domain,
    competitor.relevance,
    competitor.monthly_traffic != null ? competitor.monthly_traffic.toLocaleString() : '-',
    competitor.trust_score != null ? String(competitor.trust_score) : '-',
    competitor.rationale,
  ])

  return [
    h2('Competitor Landscape'),
    table(['Brand', 'Domain', 'Relationship', 'Monthly traffic', 'Authority', 'Why it matters'], rows),
    pageBreak(),
  ]
}

function aiVisibilitySection(report: DiscoveryReport): (Paragraph | Table)[] {
  const questions = report.ai_tracker_questions ?? []
  const results = report.ai_visibility_results ?? []
  if (!questions.length && !results.length) return []

  const items: (Paragraph | Table)[] = [h2('AI Visibility')]

  if (results.length) {
    const rows = results.map(result => [
      result.question,
      result.client_mentioned ? 'Visible' : 'Not visible',
      result.top_brands.slice(0, 3).join(', ') || '-',
    ])
    items.push(h3('Observed AI answer visibility'))
    items.push(table(['Question', 'Client visibility', 'Brands surfaced'], rows))
    items.push(spacer())
  }

  if (questions.length) {
    const rows = questions.map(question => [
      question.question,
      question.category,
      question.market,
      question.rationale,
    ])
    items.push(h3('Recommended tracking questions'))
    items.push(table(['Question', 'Category', 'Market', 'Reason'], rows))
  }

  items.push(pageBreak())
  return items
}

function serpResultsSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const results = report.serp_results
  if (!results?.length) return []

  const items: (Paragraph | Table)[] = [h2('SERP Snapshots')]

  for (const serp of results) {
    items.push(h3(`Query: "${serp.query}"`))

    if (serp.organic_results.length) {
      const rows = serp.organic_results.map(r => [
        String(r.position),
        r.title,
        r.url,
        r.description,
      ])
      items.push(table(['#', 'Title', 'URL', 'Description'], rows))
      items.push(spacer())
    }

    if (serp.paid_advertiser_domains.length) {
      items.push(bodyBold(`Paid advertisers: ${serp.paid_advertiser_domains.join(', ')}`))
    }

    if (serp.ai_overview_text) {
      items.push(h3('Google AI Mode answer'))
      items.push(body(serp.ai_overview_text))
      if (serp.ai_overview_sources.length) {
        items.push(bodyBold(`Sources: ${serp.ai_overview_sources.join(', ')}`))
      }
      items.push(spacer())
    }
  }

  items.push(pageBreak())
  return items
}

function socialSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const socials = report.social_profiles
  if (!socials.length) return []

  const rows = socials.map(social => [
    social.platform,
    social.handle ?? '-',
    social.followers_count != null ? social.followers_count.toLocaleString() : '-',
    social.posts_last_30d != null ? String(social.posts_last_30d) : '-',
    social.engagement_rate != null ? `${(social.engagement_rate * 100).toFixed(1)}%` : '-',
    social.url,
  ])

  return [
    h2('Social Footprint'),
    table(['Platform', 'Handle', 'Followers', 'Posts 30d', 'Engagement', 'URL'], rows),
    pageBreak(),
  ]
}

function gbpSection(report: DiscoveryReport): Paragraph[] {
  const profile = report.gbp
  if (!profile) return []

  return [
    h2('Business Profile'),
    statLine('Business name', profile.business_name),
    statLine('Address', profile.address),
    ...(profile.rating != null ? [statLine('Rating', `${profile.rating} / 5`)] : []),
    ...(profile.review_count != null ? [statLine('Review count', profile.review_count.toLocaleString())] : []),
    ...(profile.google_maps_url ? [statLine('Maps listing', profile.google_maps_url)] : []),
    pageBreak(),
  ]
}

function reviewPlatformsSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const platforms = report.review_platforms
  if (!platforms.length) return []

  const summaryRows = platforms.map(platform => [
    platform.platform,
    platform.rating != null ? String(platform.rating) : '-',
    platform.review_count != null ? platform.review_count.toLocaleString() : '-',
    platform.response_rate != null ? `${(platform.response_rate * 100).toFixed(0)}%` : '-',
    platform.url,
  ])

  const items: (Paragraph | Table)[] = [
    h2('Review Footprint'),
    table(['Platform', 'Rating', 'Reviews', 'Response rate', 'URL'], summaryRows),
  ]

  // Include negative review samples if present
  const negativeSamples = platforms.flatMap(p =>
    (p.recent_negative_samples ?? []).map(s => ({
      platform: p.platform,
      ...s,
    })),
  )
  if (negativeSamples.length) {
    items.push(spacer())
    items.push(h3('Sample low-rated reviews'))
    const sampleRows = negativeSamples.map(s => [
      s.platform,
      String(s.rating),
      s.author ?? '-',
      s.date ?? '-',
      s.text.slice(0, 200),
    ])
    items.push(table(['Platform', 'Stars', 'Author', 'Date', 'Review'], sampleRows))
  }

  items.push(pageBreak())
  return items
}

function paidSocialSection(report: DiscoveryReport): Paragraph[] {
  // Advanced meta_ads takes priority over basic (same as UI)
  const ads = report.advanced?.meta_ads ?? report.meta_ads
  if (!ads) return []

  return [
    h2('Paid Social Activity'),
    statLine('Active ads found', String(ads.active_ads_count)),
    statLine('Creative formats', ads.ad_types.join(', ') || '-'),
    statLine('Estimated spend signal', ads.estimated_spend),
    ...(ads.top_ad_copy.length ? [
      spacer(),
      h3('Ad copy samples'),
      ...ads.top_ad_copy.map(copy => bullet(copy)),
    ] : []),
    pageBreak(),
  ]
}

function advancedSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const adv = report.advanced
  if (!adv) return []

  const items: (Paragraph | Table)[] = []

  // GSC data
  if (adv.gsc_data?.rows.length) {
    const gsc = adv.gsc_data
    const rows = gsc.rows.map(r => [
      r.query,
      r.impressions.toLocaleString(),
      r.clicks.toLocaleString(),
      `${(r.ctr * 100).toFixed(1)}%`,
      r.position.toFixed(1),
    ])
    items.push(h2('Search Console Performance'))
    items.push(statLine('Site', gsc.site_url))
    items.push(statLine('Period', `${gsc.date_range_days} days`))
    items.push(spacer())
    items.push(table(['Query', 'Impressions', 'Clicks', 'CTR', 'Position'], rows))
    items.push(pageBreak())
  }

  // Google Ads (Transparency Center)
  if (adv.google_ads_data) {
    const gads = adv.google_ads_data
    items.push(h2('Google Ads Activity'))
    items.push(statLine('Advertiser', gads.advertiser))
    items.push(statLine('Active ads', String(gads.active_ads_count)))
    items.push(statLine('Formats', gads.ad_formats.join(', ') || '-'))
    items.push(statLine('Regions', gads.regions.join(', ') || '-'))
    if (gads.top_ad_previews.length) {
      items.push(spacer())
      items.push(h3('Ad previews'))
      for (const preview of gads.top_ad_previews) {
        items.push(bullet(preview))
      }
    }
    items.push(pageBreak())
  }

  // Facebook profiles (advanced)
  if (adv.facebook_profiles.length) {
    const rows = adv.facebook_profiles.map(p => [
      p.page_name,
      p.followers_count.toLocaleString(),
      String(p.posts_last_30d),
      `${(p.engagement_rate * 100).toFixed(1)}%`,
      p.url,
    ])
    items.push(h2('Facebook Page Metrics'))
    items.push(table(['Page', 'Followers', 'Posts 30d', 'Engagement', 'URL'], rows))
    items.push(pageBreak())
  }

  return items
}

function techStackSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const tech = report.technology_stack
  if (!tech) return []

  const rows: string[][] = []
  if (tech.cms) rows.push(['CMS', tech.cms])
  if (tech.ecommerce) rows.push(['E-commerce', tech.ecommerce])
  if (tech.analytics.length) rows.push(['Analytics', tech.analytics.join(', ')])
  if (tech.crm_marketing.length) rows.push(['CRM / Marketing', tech.crm_marketing.join(', ')])
  if (tech.chat) rows.push(['Chat', tech.chat])
  if (tech.domain_rank != null) rows.push(['Domain rank', String(tech.domain_rank)])
  if (tech.phone_numbers.length) rows.push(['Phone numbers', tech.phone_numbers.join(', ')])
  if (tech.emails.length) rows.push(['Emails', tech.emails.join(', ')])

  if (!rows.length) return []

  return [
    h2('Technology Stack'),
    table(['Category', 'Detail'], rows),
    pageBreak(),
  ]
}

function domainWhoisSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const whois = report.domain_whois
  if (!whois) return []

  const rows: string[][] = []
  if (whois.registered_at) rows.push(['Registered', whois.registered_at])
  if (whois.expires_at) rows.push(['Expires', whois.expires_at])
  if (whois.registrar) rows.push(['Registrar', whois.registrar])
  if (whois.domain_age_years != null) rows.push(['Domain age', `${whois.domain_age_years} years`])
  if (whois.referring_domains != null) rows.push(['Referring domains', whois.referring_domains.toLocaleString()])
  if (whois.backlinks != null) rows.push(['Backlinks', whois.backlinks.toLocaleString()])
  if (whois.organic_etv != null) rows.push(['Organic ETV (est.)', whois.organic_etv.toLocaleString()])
  if (whois.organic_keywords_top10 != null) rows.push(['Top-10 keywords', whois.organic_keywords_top10.toLocaleString()])

  if (!rows.length) return []

  return [
    h2('Domain Intelligence'),
    table(['Metric', 'Value'], rows),
    pageBreak(),
  ]
}

function onpageAuditSection(report: DiscoveryReport): (Paragraph | Table)[] {
  const audit = report.onpage_audit
  if (!audit) return []

  const items: (Paragraph | Table)[] = [h2('On-Page SEO Audit')]

  const metaRows: string[][] = []
  if (audit.status_code != null) metaRows.push(['HTTP status', String(audit.status_code)])
  if (audit.title) metaRows.push(['Title tag', audit.title])
  if (audit.description) metaRows.push(['Meta description', audit.description])
  if (audit.canonical) metaRows.push(['Canonical', audit.canonical])
  if (audit.h1) metaRows.push(['H1', audit.h1])
  if (audit.word_count != null) metaRows.push(['Word count', audit.word_count.toLocaleString()])
  if (audit.internal_links != null) metaRows.push(['Internal links', audit.internal_links.toLocaleString()])
  if (audit.external_links != null) metaRows.push(['External links', audit.external_links.toLocaleString()])
  if (audit.images_total != null) metaRows.push(['Images', audit.images_total.toLocaleString()])
  if (audit.images_no_alt != null) metaRows.push(['Images missing alt', audit.images_no_alt.toLocaleString()])

  if (metaRows.length) {
    items.push(table(['Field', 'Value'], metaRows))
    items.push(spacer())
  }

  if (audit.core_web_vitals) {
    const cwv = audit.core_web_vitals
    const cwvRows: string[][] = []
    if (cwv.lcp != null) cwvRows.push(['LCP (ms)', String(cwv.lcp)])
    if (cwv.cls != null) cwvRows.push(['CLS', String(cwv.cls)])
    if (cwv.tbt != null) cwvRows.push(['TBT (ms)', String(cwv.tbt)])
    if (cwvRows.length) {
      items.push(h3('Core Web Vitals'))
      items.push(table(['Metric', 'Value'], cwvRows))
      items.push(spacer())
    }
  }

  const failedChecks = Object.entries(audit.checks)
    .filter(([, failed]) => failed)
    .map(([key]) => key.replace(/_/g, ' '))
  if (failedChecks.length) {
    items.push(h3('Issues detected'))
    for (const check of failedChecks) {
      items.push(bullet(check))
    }
  }

  items.push(pageBreak())
  return items
}

function actionPlanSection(report: DiscoveryReport): Paragraph[] {
  const actions = report.diagnosis?.actions
  if (!actions) return []

  return [
    h2('Priority Action Plan'),
    ...(actions.quick_fix.length ? [
      h3('Immediate fixes'),
      ...actions.quick_fix.map(action => bullet(action)),
      spacer(),
    ] : []),
    ...(actions.important.length ? [
      h3('Important builds'),
      ...actions.important.map(action => bullet(action)),
      spacer(),
    ] : []),
    ...(actions.talk_to_us.length ? [
      h3('Strategy support'),
      ...actions.talk_to_us.map(action => bullet(action)),
    ] : []),
  ]
}

function notesSection(notes: string): Paragraph[] {
  return [
    pageBreak(),
    h2('Research Notes'),
    body(notes),
  ]
}

function label(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 18, color: ACCENT_COLOR, allCaps: true })],
    spacing: { before: 120, after: 120 },
  })
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 42, color: BRAND_COLOR })],
    spacing: { before: 180, after: 220 },
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 32, color: BRAND_COLOR })],
    spacing: { before: 300, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_COLOR, space: 4 } },
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 25, color: ACCENT_COLOR })],
    spacing: { before: 220, after: 120 },
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 23, color: BRAND_COLOR })],
    spacing: { after: 120 },
  })
}

function bodyBold(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 24, color: BRAND_COLOR })],
    spacing: { after: 120 },
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `- ${text}`, font: 'Arial', size: 23, color: BRAND_COLOR })],
    indent: { left: 360 },
    spacing: { after: 80 },
  })
}

function statLine(labelText: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${labelText}: `, bold: true, font: 'Arial', size: 23, color: BRAND_COLOR }),
      new TextRun({ text: value, font: 'Arial', size: 23, color: MUTED_COLOR }),
    ],
    spacing: { after: 80 },
  })
}

function spacer(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: ' ', font: 'Arial', size: 8 })], spacing: { after: 80 } })
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] })
}

function table(headers: string[], rows: string[][]): Table {
  const colCount = headers.length
  const colWidth = Math.floor(PAGE_WIDTH / colCount)
  const colWidths = Array(colCount).fill(colWidth)

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((header, index) =>
      new TableCell({
        borders: CELL_BORDERS,
        width: { size: colWidths[index], type: WidthType.DXA },
        shading: { fill: HEADER_FILL, type: ShadingType.CLEAR },
        margins: { top: 90, bottom: 90, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: header, bold: true, font: 'Arial', size: 21, color: BRAND_COLOR })],
        })],
      }),
    ),
  })

  const bodyRows = rows.map(row =>
    new TableRow({
      children: Array.from({ length: colCount }, (_, index) =>
        new TableCell({
          borders: CELL_BORDERS,
          width: { size: colWidths[index], type: WidthType.DXA },
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: row[index] ?? '', font: 'Arial', size: 20, color: BRAND_COLOR })],
          })],
        }),
      ),
    }),
  )

  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  })
}
