/**
 * 开投前追踪检查的「客户配置」（L4）—— 这个目录里唯一允许写客户名 / 客户 ID / 域名 / 编号的文件。
 *
 * 写法照 src/lib/ga4/landing-class-config.ts：共享代码（judge / readers / collect / 函数）
 * 从不点名任何客户，只接收这里给出的配置；没有配置的客户 = 这套检查对它不适用，
 * 绝不替它猜（推广计划看板上也不会出现追踪那几道门）。
 * 守卫测试 client-config-guard.test.ts 会扫共享文件，里头出现这里的编号 / 域名就红。
 *
 * 换客户 / 换行业：在下面加一条就行，函数和门一行不用改。
 * 落地页是「每次开投一份」的配置：下一次开投前记得换成新的投放页（旧的会一直被探，探到下线的页面会变红）。
 */

import type { TrackingClientConfig } from './types'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

const BY_CLIENT: Readonly<Record<string, TrackingClientConfig>> = {
  // CTS Tours（新西兰）· 2026-10-22 起投的中国团广告
  [CTS_CLIENT_ID]: {
    ad_account_id: 'act_2202695063810470',
    site_url: 'https://www.ctstours.co.nz',
    landing_targets: [
      {
        label: '落地页 A（nc_a2_web_20261022）',
        url: 'https://www.ctstours.co.nz/tours/china/signature/landscapes?utm_content=nc_a2_web_20261022',
      },
      {
        label: '落地页 B（nc_b3_web_20261022）',
        url: 'https://www.ctstours.co.nz/tours/china/signature/landscapes?utm_content=nc_b3_web_20261022',
      },
    ],
    // 官网的统一询盘事件叫 enquiry_thank_you（见 ga4/landing-class-config.ts），表单提交时另有 generate_lead
    ga4_lead_events: ['generate_lead', 'enquiry_thank_you'],
    web_form_to_crm: true,
    // 计划日预算 NZ$101；官方日上限 NZ$110（单位：分）
    planned_daily_budget_cents: 10100,
    official_daily_cap_cents: 11000,
    currency: 'NZD',
    // 10-22 起投：开投后每小时看一眼本次投放的广告系列，一开始花钱、满 1 小时就自动补排 T+1h / T+24h 读回（盯 4 天）。
    // 花费只按本次投放的广告系列算——官方账户里别的系列早就在花钱，按整个账户算会把「开投」误判在第一天。
    // 认系列有两条（任意一条对上就算）：编号（A 系列·官网点击），或名字里同时含「官网点击」和「20261022」。
    // 第二条是保险：这个系列现在还是未发布的草稿，发布之后编号会不会变没法事先验证，名字不会变。
    // 名字里不含「官网点击」的两个表单系列（拉新 / 收割）不算——它们的留资走 Meta 表单，不走官网像素。
    // 下一次开投换日期时，系列编号和名字关键词也要一起换。
    launch_watch: {
      from: '2026-10-22',
      days: 4,
      timezone: 'Pacific/Auckland',
      campaign_ids: ['52558131445673'],
      campaign_name_contains: ['官网点击', '20261022'],
    },
  },
}

/** 该客户的追踪检查配置；没配置 = 不适用，返回 null。 */
export function getTrackingClientConfig(clientId: string): TrackingClientConfig | null {
  return BY_CLIENT[clientId] ?? null
}

/** 所有配置了追踪检查的客户（每日检查会逐个跑）。 */
export function listTrackingClientIds(): string[] {
  return Object.keys(BY_CLIENT)
}
