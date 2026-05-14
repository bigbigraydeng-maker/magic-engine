/**
 * 华佗季节日历 — AU/NZ 本地营销节点静态数据
 *
 * Reference: ROADMAP.md P8.12.S1.3
 *
 * 提供"未来 90 天内的本地营销机会"，按行业分类 × 当前月份编组。
 * 数据来源：AU/NZ 公共假日、电商大促（Prime Day、Black Friday）、产业季节峰值。
 * 无外部依赖，纯静态查表。
 */

export type IndustryCategory = string
export type Market = 'AU' | 'NZ'

export interface SeasonalEvent {
  /** 事件日期（YYYY-MM-DD） */
  date: string
  /** 事件名称 */
  name: string
  /** 影响范围：是否全澳/全新西兰，还是特定地区 */
  scope: 'national' | 'regional'
  /** 市场相关度（0-1） */
  relevance: number
  /** 适用行业分类（多行业时用数组；空数组表示全行业） */
  industries: string[]
  /** 营销建议简述 */
  marketing_hint: string
}

export interface SeasonalCalendarEntry {
  month: string
  events: SeasonalEvent[]
}

export interface SeasonalCalendarData {
  market: Market
  year: number
  entries: SeasonalCalendarEntry[]
}

/**
 * 返回指定市场、当前月份起 90 天内的事件日历。
 * 如果 current_month 为空，则不进行日期过滤，返回全年数据。
 */
export function getSeasonalCalendar(
  market: Market = 'AU',
  current_month?: string,
): SeasonalCalendarData {
  const year = new Date().getFullYear()

  // 如果没指定当前月，返回全年数据
  if (!current_month) {
    return { market, year, entries: buildFullCalendar(market, year) }
  }

  // 指定当前月时，构建当前年 + 次年日历，以支持跨年的 90 天窗口
  const twoYearCalendar = [
    ...buildFullCalendar(market, year),
    ...buildFullCalendar(market, year + 1),
  ]
  const nextNinetyDays = filterNext90Days(twoYearCalendar, current_month)
  return { market, year, entries: nextNinetyDays }
}

/**
 * 返回指定市场的全年季节日历（无日期过滤）。
 */
function buildFullCalendar(market: Market, year: number): SeasonalCalendarEntry[] {
  if (market === 'NZ') {
    return buildNZCalendar(year)
  }
  return buildAUCalendar(year)
}

/**
 * 澳大利亚年度日历（含公假、电商、行业峰值）
 */
function buildAUCalendar(year: number): SeasonalCalendarEntry[] {
  return [
    {
      month: `${year}-01`,
      events: [
        {
          date: `${year}-01-01`,
          name: '元日（New Year Day）',
          scope: 'national',
          relevance: 0.4,
          industries: [],
          marketing_hint: '休闲娱乐、旅游、零售返利活动',
        },
        {
          date: `${year}-01-26`,
          name: '澳大利亚国庆（Australia Day）',
          scope: 'national',
          relevance: 0.6,
          industries: ['retail', 'hospitality', 'tourism'],
          marketing_hint: '爱国主题内容、限时促销、户外活动推广',
        },
      ],
    },
    {
      month: `${year}-02`,
      events: [
        {
          date: `${year}-02-14`,
          name: '情人节（Valentine\'s Day）',
          scope: 'national',
          relevance: 0.8,
          industries: ['retail', 'hospitality', 'beauty', 'jewelry'],
          marketing_hint: '礼物推荐、浪漫话题、促销配对',
        },
      ],
    },
    {
      month: `${year}-03`,
      events: [
        {
          date: `${year}-03-08`,
          name: '国际妇女节（International Women\'s Day）',
          scope: 'national',
          relevance: 0.6,
          industries: ['retail', 'beauty', 'health', 'education'],
          marketing_hint: '性别平权话题、女性赋权内容、特惠套餐',
        },
      ],
    },
    {
      month: `${year}-04`,
      events: [
        {
          date: `${year}-04-25`,
          name: '澳大利亚回忆日（Anzac Day）',
          scope: 'national',
          relevance: 0.5,
          industries: ['retail', 'hospitality', 'media'],
          marketing_hint: '致敬主题、历史叙述、社区活动',
        },
      ],
    },
    {
      month: `${year}-05`,
      events: [
        {
          date: `${year}-05-01`,
          name: '秋季开始（Autumn）',
          scope: 'national',
          relevance: 0.5,
          industries: ['fashion', 'home_garden', 'health'],
          marketing_hint: '秋装上新、家居整修、健康养护主题',
        },
      ],
    },
    {
      month: `${year}-06`,
      events: [
        {
          date: `${year}-06-09`,
          name: '皇后生日（Queen\'s Birthday） [NSW/NT/SA/QLD]',
          scope: 'regional',
          relevance: 0.5,
          industries: ['retail', 'hospitality', 'events'],
          marketing_hint: '区域假期推广、家庭活动、电商促销',
        },
        {
          date: `${year}-06-30`,
          name: '财务年度末（EOFY）',
          scope: 'national',
          relevance: 0.9,
          industries: ['accounting', 'finance', 'software', 'consulting'],
          marketing_hint: '财务整理服务、年末优惠、税务规划内容',
        },
      ],
    },
    {
      month: `${year}-07`,
      events: [
        {
          date: `${year}-07-01`,
          name: '冬季开始（Winter）',
          scope: 'national',
          relevance: 0.5,
          industries: ['heating', 'health', 'tourism', 'fashion'],
          marketing_hint: '冬装热卖、室内活动、健康保暖主题',
        },
      ],
    },
    {
      month: `${year}-08`,
      events: [
        {
          date: `${year}-08-01`,
          name: '父亲节（Father\'s Day）',
          scope: 'national',
          relevance: 0.7,
          industries: ['retail', 'sports', 'tech', 'hobby'],
          marketing_hint: '礼物推荐、男性兴趣内容、限时专场',
        },
      ],
    },
    {
      month: `${year}-09`,
      events: [
        {
          date: `${year}-09-01`,
          name: '春季开始（Spring）',
          scope: 'national',
          relevance: 0.6,
          industries: ['tourism', 'gardening', 'fashion', 'events'],
          marketing_hint: '春游推广、花卉园艺、春装上新',
        },
      ],
    },
    {
      month: `${year}-10`,
      events: [
        {
          date: `${year}-10-31`,
          name: '万圣节（Halloween）',
          scope: 'national',
          relevance: 0.5,
          industries: ['retail', 'hospitality', 'entertainment', 'events'],
          marketing_hint: '主题派对、装扮用品、限时活动',
        },
      ],
    },
    {
      month: `${year}-11`,
      events: [
        {
          date: `${year}-11-01`,
          name: '夏季开始（Summer）',
          scope: 'national',
          relevance: 0.6,
          industries: ['tourism', 'hospitality', 'beach', 'fashion'],
          marketing_hint: '度假推广、夏装热卖、户外活动',
        },
        {
          date: `${year}-11-29`,
          name: '黑五（Black Friday）',
          scope: 'national',
          relevance: 0.95,
          industries: [],
          marketing_hint: '年度最大促销节，所有零售类必须参与；提前 1-2 周预热库存',
        },
      ],
    },
    {
      month: `${year}-12`,
      events: [
        {
          date: `${year}-12-25`,
          name: '圣诞节（Christmas）',
          scope: 'national',
          relevance: 0.95,
          industries: ['retail', 'hospitality', 'entertainment', 'media'],
          marketing_hint: '年末最后冲刺，礼物推荐、家庭聚餐、节日氛围内容',
        },
      ],
    },
  ]
}

/**
 * 新西兰年度日历（含公假、电商、行业峰值）
 */
function buildNZCalendar(year: number): SeasonalCalendarEntry[] {
  return [
    {
      month: `${year}-01`,
      events: [
        {
          date: `${year}-01-01`,
          name: '元日（New Year Day）',
          scope: 'national',
          relevance: 0.4,
          industries: [],
          marketing_hint: '休闲娱乐、新年目标、健身计划推广',
        },
        {
          date: `${year}-01-02`,
          name: '元旦假期后日（Day After New Year）',
          scope: 'national',
          relevance: 0.4,
          industries: [],
          marketing_hint: '长周末活动、旅游促销',
        },
      ],
    },
    {
      month: `${year}-02`,
      events: [
        {
          date: `${year}-02-06`,
          name: '待命日（Waitangi Day）',
          scope: 'national',
          relevance: 0.6,
          industries: ['media', 'education', 'retail'],
          marketing_hint: '毛利文化、国家认同感、社区活动',
        },
        {
          date: `${year}-02-14`,
          name: '情人节（Valentine\'s Day）',
          scope: 'national',
          relevance: 0.8,
          industries: ['retail', 'hospitality', 'beauty'],
          marketing_hint: '礼物推荐、约会促销、浪漫主题',
        },
      ],
    },
    {
      month: `${year}-03`,
      events: [
        {
          date: `${year}-03-08`,
          name: '国际妇女节（International Women\'s Day）',
          scope: 'national',
          relevance: 0.6,
          industries: ['retail', 'health', 'education'],
          marketing_hint: '女性赋权、性别平权话题、特惠活动',
        },
      ],
    },
    {
      month: `${year}-04`,
      events: [
        {
          date: `${year}-04-25`,
          name: '澳新兵团日（Anzac Day）',
          scope: 'national',
          relevance: 0.5,
          industries: ['media', 'hospitality', 'retail'],
          marketing_hint: '致敬祭典、历史叙述、社区纪念活动',
        },
      ],
    },
    {
      month: `${year}-05`,
      events: [
        {
          date: `${year}-05-01`,
          name: '秋季开始（Autumn）',
          scope: 'national',
          relevance: 0.5,
          industries: ['fashion', 'home_garden', 'health'],
          marketing_hint: '秋装上新、家居装修、养生健康主题',
        },
      ],
    },
    {
      month: `${year}-06`,
      events: [
        {
          date: `${year}-06-01`,
          name: '女王生日（Queen\'s Birthday）',
          scope: 'national',
          relevance: 0.5,
          industries: ['retail', 'hospitality', 'events'],
          marketing_hint: '假期促销、家庭活动、电商专场',
        },
        {
          date: `${year}-06-30`,
          name: '财务年度末（EOFY）',
          scope: 'national',
          relevance: 0.9,
          industries: ['accounting', 'finance', 'software'],
          marketing_hint: '财务服务、年末优惠、税务规划',
        },
      ],
    },
    {
      month: `${year}-07`,
      events: [
        {
          date: `${year}-07-01`,
          name: '冬季开始（Winter）',
          scope: 'national',
          relevance: 0.5,
          industries: ['heating', 'health', 'fashion', 'tourism'],
          marketing_hint: '冬装热销、室内活动、旅游度假',
        },
      ],
    },
    {
      month: `${year}-08`,
      events: [
        {
          date: `${year}-08-01`,
          name: '父亲节（Father\'s Day）',
          scope: 'national',
          relevance: 0.7,
          industries: ['retail', 'sports', 'tech'],
          marketing_hint: '礼物推荐、男性兴趣内容、限时专场',
        },
      ],
    },
    {
      month: `${year}-09`,
      events: [
        {
          date: `${year}-09-01`,
          name: '春季开始（Spring）',
          scope: 'national',
          relevance: 0.6,
          industries: ['tourism', 'gardening', 'fashion'],
          marketing_hint: '春游推广、花卉园艺、春装上新、户外活动',
        },
      ],
    },
    {
      month: `${year}-10`,
      events: [
        {
          date: `${year}-10-28`,
          name: '夏令时开始（Daylight Saving Starts）',
          scope: 'national',
          relevance: 0.3,
          industries: [],
          marketing_hint: '技术提醒内容、时间相关服务推广',
        },
      ],
    },
    {
      month: `${year}-11`,
      events: [
        {
          date: `${year}-11-01`,
          name: '夏季开始（Summer）',
          scope: 'national',
          relevance: 0.6,
          industries: ['tourism', 'hospitality', 'beach', 'fashion'],
          marketing_hint: '度假推广、夏装热卖、户外运动',
        },
        {
          date: `${year}-11-29`,
          name: '黑五（Black Friday）',
          scope: 'national',
          relevance: 0.95,
          industries: [],
          marketing_hint: '年度最大促销节；NZ 通常晚于 AU 一周举办；必须参与',
        },
      ],
    },
    {
      month: `${year}-12`,
      events: [
        {
          date: `${year}-12-25`,
          name: '圣诞节（Christmas）',
          scope: 'national',
          relevance: 0.95,
          industries: ['retail', 'hospitality', 'entertainment'],
          marketing_hint: '年末冲刺、礼物推荐、家庭聚餐、节日氛围',
        },
        {
          date: `${year}-12-26`,
          name: '节礼日（Boxing Day）',
          scope: 'national',
          relevance: 0.7,
          industries: ['retail', 'hospitality', 'sports'],
          marketing_hint: '促销延续、体育赛事、休闲活动',
        },
      ],
    },
  ]
}

/**
 * 从日历中过滤出"当前月份"起约 90 天（≈3 个月窗口）内的事件。
 * current_month 格式：YYYY-MM（如 "2026-05"）。
 * 用绝对月份索引（year * 12 + monthIdx）比较，正确处理跨年。
 */
function filterNext90Days(
  calendar: SeasonalCalendarEntry[],
  current_month: string,
): SeasonalCalendarEntry[] {
  const startAbs = toAbsoluteMonth(current_month)
  const endAbs = startAbs + 3

  return calendar.filter((entry) => {
    const entryAbs = toAbsoluteMonth(entry.month)
    return entryAbs >= startAbs && entryAbs <= endAbs
  })
}

/** 把 YYYY-MM 转成绝对月份索引（year * 12 + (month - 1)）。 */
function toAbsoluteMonth(month: string): number {
  const [yearStr, monthStr] = month.split('-')
  return parseInt(yearStr) * 12 + (parseInt(monthStr) - 1)
}

/**
 * 将季节日历格式化为 Claude prompt 中嵌入的中文段落。
 */
export function formatSeasonalCalendarForPrompt(calendar: SeasonalCalendarData): string {
  const lines: string[] = [
    `## 未来 90 天本地营销节点（${calendar.market} 季节日历）`,
    '',
  ]

  for (const entry of calendar.entries) {
    lines.push(`### ${entry.month}`)
    for (const event of entry.events) {
      const scopeLabel = event.scope === 'national' ? '全国' : '区域'
      const industryLabel = event.industries.length === 0 ? '全行业' : event.industries.join(', ')
      lines.push(
        `- **${event.date}** — ${event.name} [${scopeLabel}，关联度 ${(event.relevance * 100).toFixed(0)}%]`,
      )
      lines.push(`  - 适用: ${industryLabel}`)
      lines.push(`  - 建议: ${event.marketing_hint}`)
    }
    lines.push('')
  }

  lines.push('**使用建议**：')
  lines.push(
    '1. 根据客户所属行业，挑选相关节点作为内容 / 促销主题的钉子时间。',
  )
  lines.push(
    '2. 黑五（Black Friday）、圣诞节（Christmas）为全行业必参与节点，应在处方中单独强调。',
  )
  lines.push(
    '3. 季节交替时，对应行业（如冬装、旅游、家居）应提前 2-4 周启动营销。',
  )
  lines.push('')

  return lines.join('\n')
}
