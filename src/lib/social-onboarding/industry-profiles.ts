/** Industry question sets for the shared Facebook launch workflow. */

export const INDUSTRY_PROFILES = {
  general: {
    label: '通用服务 / 其他',
    context: 'Ask for the specific buying journey and avoid assuming an industry benchmark.',
    prompt: 'Use only the client evidence and stated goals. If the buying journey is unclear, flag it as a question.',
  },
  travel: {
    label: '旅游 / 旅行社',
    context: 'Clarify departure dates, trip availability, price range, booking lead time, and enquiry follow-up capacity.',
    prompt: 'Separate video reach and audience building from trip enquiries. Never invent itinerary, price, seat availability, or booking urgency.',
  },
  real_estate: {
    label: '地产',
    context: 'Clarify service area, property/listing availability, seller or buyer focus, and enquiry qualification.',
    prompt: 'Separate local trust and listing discovery from qualified buyer/seller enquiries. Never invent property facts or market claims.',
  },
  ecommerce: {
    label: '电商 / 零售',
    context: 'Clarify product range, fulfilment region, offer, product page, and purchase measurement.',
    prompt: 'Separate product discovery and engagement from measurable purchases. Do not invent pricing, discounts, stock, or shipping promises.',
  },
  local_service: {
    label: '本地服务',
    context: 'Clarify locations served, capacity, service availability, booking method, and lead response time.',
    prompt: 'Separate local awareness from qualified enquiries or bookings. Do not invent service coverage or availability.',
  },
  b2b: {
    label: 'B2B / 专业服务',
    context: 'Clarify decision-maker, sales cycle, qualification signals, proof, and follow-up ownership.',
    prompt: 'Separate trust and education from qualified conversations. Do not assume a short sales cycle or consumer-style purchase.',
  },
  regulated: {
    label: '受监管行业',
    context: 'Clarify approved claims, required disclosures, audience limits, and review owner before proposing content.',
    prompt: 'Flag compliance review as a prerequisite. Do not generate medical, financial, legal, or guaranteed-outcome claims.',
  },
} as const

export type IndustryProfileId = keyof typeof INDUSTRY_PROFILES

export function resolveIndustryProfile(value: string | null | undefined): IndustryProfileId {
  const normalized = (value ?? '').toLowerCase()
  if (/travel|tour|tourism/.test(normalized)) return 'travel'
  if (/real[\s_-]?estate|property/.test(normalized)) return 'real_estate'
  if (/e.?commerce|retail|shop/.test(normalized)) return 'ecommerce'
  if (/medical|healthcare|health|clinic|hospital|finance|financial|legal|law|insurance|pharma/.test(normalized)) return 'regulated'
  if (/local|hospitality|restaurant|health|beauty|service/.test(normalized)) return 'local_service'
  if (/b2b|professional|saas|software|logistics/.test(normalized)) return 'b2b'
  return 'general'
}
