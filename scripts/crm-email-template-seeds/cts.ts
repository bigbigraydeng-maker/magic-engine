/**
 * CTS 的两份「通话后跟进信」种子模板（客户私有内容：品牌名、措辞都在这里，不在共享代码里）。
 * 设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §12
 * 逐句来源表：docs/clients/cts/2026-10-28-post-call-email-template-sources.md
 *
 * 🔴 写入时就是**停用**状态；PM / Lisa 确认后才在「邮件模板」页启用（启用 = 新版本）。
 * 🔴 团名、价格、班期、链接一律是占位符——运行时只读已发布的团目录，这里一个事实都不写死。
 */

import type { TemplateFields } from '@/lib/crm/email-templates/template-input'

export interface SeedTemplate {
  templateKey: string
  fields: TemplateFields
}

const SIGN_OFF = 'Warm regards,\n{{sender_name}}\nCTS Tours'
const SEED_NOTE = '种子模板：写入时停用，等 PM / Lisa 确认后再启用'

export const CTS_SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    templateKey: 'post-call-single-tour',
    fields: {
      name: '通话后跟进信 · 单团详情',
      subject: '{{tour_name}}: your itinerary and price',
      body: [
        'Kia ora {{first_name}},',
        '',
        'Thank you for talking with me {{call_when}}. It was a real pleasure.',
        'As promised, here are the details of the {{tour_name}} ({{tour_duration}}), departing {{departure_date}}.',
        '',
        'Why you will love this tour',
        '{{tour_highlights:7}}',
        '',
        'What is included',
        '{{tour_price}}',
        '{{tour_inclusions}}',
        '',
        'You can see the full day-by-day itinerary here: {{tour_url}}',
        '',
        'If you have any questions, or would like to go ahead, just reply to this email and I will take care of the rest.',
        '',
        SIGN_OFF,
      ].join('\n'),
      factSource: 'published_tours',
      pickMode: 'one',
      pickFilter: {},
      status: 'disabled',
      changeNote: SEED_NOTE,
    },
  },
  {
    templateKey: 'spring-2027-follow-up',
    fields: {
      name: '春季团通用跟进信 · 3 月 / 5 月',
      subject: 'Our March and May 2027 departures',
      body: [
        'Kia ora {{first_name}},',
        '',
        'Thank you for talking with me {{call_when}}. It was a real pleasure.',
        '',
        'Here are our tours with departures in March and May 2027:',
        '',
        '{{tour_cards}}',
        '',
        'You can see all of our tours here: {{all_tours_url}}',
        '',
        'If you have any questions, or would like to go ahead, just reply to this email and I will take care of the rest.',
        '',
        SIGN_OFF,
      ].join('\n'),
      factSource: 'published_tours',
      pickMode: 'many',
      pickFilter: { departureMonths: [3, 5] },
      status: 'disabled',
      changeNote: SEED_NOTE,
    },
  },
]

/**
 * CTS 初始文字红线（参考：PM 在「发信设置」页里填；**本脚本不写设置**）。
 * 干跑时拿它检查种子模板，证明这两份模板不会一启用就被自己的红线拦下。
 * 严重度由 PM 审；短语要具体，不能用单个常见词。
 */
export const CTS_GUARDRAIL_REFERENCE = {
  allowedLinkHosts: ['www.ctstours.co.nz', 'ctstours.co.nz'],
  rules: [
    {
      id: 'no-sales-deadline',
      severity: 'block' as const,
      message: '不能写销售截止 / 倒计时（CTS 的团没有销售截止，售完为止）',
      phrases: ['hurry up', 'last chance', 'limited time', 'limited seats', 'seats left', 'book before', 'countdown'],
    },
    {
      id: 'no-visa-free-claim',
      severity: 'block' as const,
      message: '签证相关只写「以 CTS 确认为准」，不能写免签',
      phrases: ['visa-free', 'visa free', 'no visa required'],
    },
    {
      id: 'no-call-invite',
      severity: 'warn' as const,
      message: '这封信不要邀请对方再约电话 / 会议',
      phrases: ['give me a call', 'call me', 'schedule a call', 'book a call', 'zoom'],
    },
  ],
}
