/**
 * 开投前追踪检查的「客户配置」（L4）—— 这个目录里唯一允许写客户名 / 客户 ID / 域名 / 编号的文件。
 *
 * 写法照 src/lib/ga4/landing-class-config.ts：共享代码（judge / readers / collect / 函数）
 * 从不点名任何客户，只接收这里给出的配置；没有配置的客户 = 这套检查对它不适用，
 * 绝不替它猜（推广计划看板上也不会出现追踪那几道门）。
 * 守卫测试 client-config-guard.test.ts 会扫共享文件，里头出现这里的编号 / 域名就红。
 *
 * 换客户 / 换行业：在下面加一条就行，函数和门一行不用改。
 * 落地页和盯盘窗口 / 系列是「每次开投一份」的配置：下一次开投前记得换成新的（旧的会一直被探，探到下线的页面会变红）。
 * 落地页还决定「线索进 CRM」那道门认哪一页的表单线索：官网表单线索必须有从这些页面提交的，那道门才对广告这条路判绿
 * （联系页等其它表单的线索进得来，只算「只验证了其它表单」）。所以这里写的必须是广告真正点进去的那些页面。
 */

import type { TrackingClientConfig } from './types'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

const BY_CLIENT: Readonly<Record<string, TrackingClientConfig>> = {
  // CTS Tours（新西兰）· 中国团广告（2026-10-20 15:25 新西兰时间已发布并启用）
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
    // 🔴 预算数字不再写死（2026-10-21）：这里曾写「计划日预算 NZ$101 / 官方日上限 NZ$110」（10-18 那版），
    // 而库里官方账户上限早已是 NZ$150、实际在投合计 NZ$134——预算门拿这两个旧常量互相比，
    // 「预算在上限内」成了假绿。写死的数字会天天过期（计划重排期间尤其），所以留 null：
    // 预算门如实判黄「没配置计划日预算或官方日上限，没法核对」，不再假绿。
    // 根本修复 = 这道门读库读线上（上限读 client_meta_ad_accounts / ad_strategy_configs，在投日预算现读 Meta），
    // 上线之前不要在这里再填数字。
    planned_daily_budget_cents: null,
    official_daily_cap_cents: null,
    currency: 'NZD',
    // 开投后盯盘（launch_watch）：本期不适用（2026-10-21）。
    // 上一期「官网点击」系列（编号 52558131445673）于 10-20 15:25（新西兰）开投，当晚 22:24 起按 PM「全停并重排」暂停；
    // 本期新系列的目标是播放量 / WhatsApp 对话（系列 52558359035473 / 52558367358873），
    // 现有的开投后读回判的是点击 / 落地页浏览 / 留资，对它们会天天误报，要按目标另设计「该看什么数」后再配。
    // 留着旧系列的配置只会让 T+24h 读回去读一个已暂停的系列、出没意义的待办，所以整段拿掉；
    // 下一次开投时再配：窗口（from / days）、系列编号和名字关键词、预计开投日（expected_launch_on）。
    //
    // 按目标盯盘（2026-10-21）：本期两个新系列各看各的数。每小时盯盘只读、只出提醒，从不动广告；
    // 系列暂停了或里面没有在投的广告，会自动不盯（所以不用在系列停掉时回来改这里）。
    //   · 播放量系列：完整播放 / 触达 / 频次，按视频拆开，频次默认 >3 黄 >4 红；
    //   · WhatsApp 系列：开始聊天数 / 单个成本，按受众和视频拆开，并核对 ME 有没有收到这些 WhatsApp 会话；
    //   · 两个系列都盯「最近一次改动后一直没花钱」（默认 6 小时黄、24 小时红）。
    // 上一期「官网点击」系列（52558131445673）已暂停，不在这里。新一期的系列要把编号加到下面。
    objective_watch: {
      series: [
        { campaign_id: '52558359035473', kind: 'awareness', label: '播放量系列' },
        { campaign_id: '52558367358873', kind: 'whatsapp', label: 'WhatsApp 系列' },
      ],
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
