/** Shared fixtures for the template tests that need a realistic published tour, settings and gate data. */
import { vi } from 'vitest'
import { effectiveFromSettings, type EffectiveEmailConfig } from '@/lib/crm/email-templates/effective-config'
import type { PublishedTourFact } from '@/lib/crm/email-templates/facts/types'
import type { FrequencySources, OutboundItem } from '@/lib/crm/email-templates/gates/types'
import type { SendGateData } from '@/lib/crm/email-templates/send-gates'
import type { EmailSettings, EmailTemplateVersion, StoredReceipt } from '@/lib/crm/email-templates/types'

export function tour(over: Partial<PublishedTourFact> = {}): PublishedTourFact {
  return {
    id: 't1',
    slug: 'essentials',
    destination: 'china',
    tier: 'discovery',
    name: 'China Discovery — Best of China',
    title: null,
    durationText: '15 Days',
    displayPriceText: 'From NZD $4,080 per person',
    highlights: ['Great Wall', 'Terracotta Warriors'],
    inclusions: ['4-star hotels'],
    exclusions: [],
    singleSupplement: null,
    soldOut: false,
    managesDepartures: true,
    isActive: true,
    departures: [{ departOn: '2027-03-11', displayDate: '11 March 2027', status: 'open', priceTextOverride: null }],
    ...over,
  }
}

export function settingsObj(over: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    sendMailbox: 'info@example.com',
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 },
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: {
      allowedLinkHosts: ['www.example.com', 'example.com'],
      rules: [
        { id: 'no-visa-free', phrases: ['visa-free'], message: 'no visa-free', severity: 'block' },
        { id: 'no-call', phrases: ['give me a call'], message: 'no calls', severity: 'warn' },
      ],
    },
    providers: {
      publishedTours: {
        urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
        allToursUrl: 'https://www.example.com/tours',
      },
    },
    ...over,
  }
}

export function config(over: Partial<EmailSettings> = {}): EffectiveEmailConfig {
  return effectiveFromSettings(settingsObj(over), 1)
}

export function template(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 'tpl-1',
    clientId: 'client-a',
    templateKey: 'post-call-single-tour',
    version: 3,
    name: 'Post-call single tour',
    subject: '{{tour_name}}: your itinerary',
    body:
      'Kia ora {{first_name}},\n\nThank you for our call {{call_when}}. Here are the details of {{tour_name}} ({{tour_duration}}), departing {{departure_date}}.\n\n{{tour_price}}\n\n{{tour_url}}\n\nWarm regards,\n{{sender_name}}',
    factSource: 'published_tours',
    pickMode: 'one',
    pickFilter: {},
    status: 'active',
    changeNote: null,
    createdBy: 'lisa@client.co.nz',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  }
}

export function emptySources(): FrequencySources {
  const empty = async () => ({ ok: true as const, items: [] as OutboundItem[] })
  return { sentItems: vi.fn(empty), audit: vi.fn(empty), touchpoints: vi.fn(empty), mailchimp: vi.fn(empty) }
}

export function makeData(over: Partial<SendGateData> = {}): SendGateData {
  return {
    loadTemplate: vi.fn(async () => template()),
    loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour()] })),
    loadContactView: vi.fn(async () => ({
      displayName: 'Amy Lee',
      addresses: ['amy@gmail.com', 'amy.lee@work.com'],
      callEvidenceAt: null,
    })),
    loadSenderName: vi.fn(async () => 'Lisa Zhang'),
    sentTemplateReceiptsSince: vi.fn(async () => [] as StoredReceipt[]),
    frequencySources: emptySources(),
    ...over,
  }
}
