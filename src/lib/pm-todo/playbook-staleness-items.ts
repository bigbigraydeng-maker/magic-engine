/**
 * 今日待办里的「经验手册疑似过期」栏。
 *
 * 7 本跨客户经验手册存在 Claude 持久记忆里（不在这个仓库），每周由一个独立的
 * Claude scheduled task（`~/.claude/scheduled-tasks/playbook-staleness-weekly/`，
 * 仓库外的本地任务，只有本地环境同时摸得到手册文件和这个代码仓库）读手册原文、
 * grep 这个仓库核实手册里点名的函数/路径/表名还在不在，把「疑似过期」的线索
 * POST 给 `/api/cron/playbook-staleness-weekly` 落库到 `playbook_staleness_findings`。
 *
 * 全量替换设计：那个接口每次写入前先清空整张表，再插入本周查到的结果——一条引用
 * 如果这周被人改好了，巡检就不会再点它的名，它自己从表里消失，不需要任何人手动
 * 把它标记成「已处理」（设计审 2026-09-24：子牙 + 魏征两轮独立审查都点名要求这条，
 * 缺了会导致这一栏只增不减、最终被系统性忽略）。
 *
 * 这个 kind 归进 `daily-todo.ts` 的 `DEV_OWNED_KINDS`——「手册这句话要不要改」是
 * 技术判断，不是 PM 该做的业务决策，how 字段照抄现有「回我一句我去查」的话术。
 *
 * href 留空：手册本身不在仓库里也没有可公开访问的网址，构造一个「看起来能点」的
 * 链接（比如 GitHub 代码搜索）反而会因为搜不准而误导人（设计审 2026-09-24 定论）。
 * 具体怎么核实的步骤放进 `how_to_verify`（由巡检任务写好，落进 `how` 字段），
 * 跟 `ai_alerting_broken` 等 `href: ''` 的现有条目走同一套惯例。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { fetchAll } from '@/lib/supabase-paginate'

/**
 * 7 本手册的登记表——巡检任务（SKILL.md）和写入接口（route.ts）共用同一份，
 * 三处都必须保持一致：这里 / SKILL.md 里的清单 / MEMORY.md 索引。
 * 刻意写死清单，不用目录通配符：新增第 8 本手册或改名，任何一处漏更新都应该
 * 报出「不认识这个 playbook_path」而不是静默漏扫或静默接受垃圾数据。
 */
export const PLAYBOOK_REGISTRY: readonly { path: string; name: string }[] = [
  { path: 'playbook-ads-meta-general.md', name: 'Meta广告投放通用经验手册' },
  { path: 'playbook-seo-general.md', name: 'SEO通用经验手册' },
  { path: 'playbook-geo-general.md', name: 'AI可见度(GEO)通用经验手册' },
  { path: 'playbook-social-general.md', name: '社媒/内容视频工厂通用经验手册' },
  { path: 'playbook-reputation-general.md', name: '口碑(GBP)通用经验手册' },
  { path: 'playbook-ads-industry-travel.md', name: '旅游行业广告打法' },
  { path: 'playbook-geo-industry-realestate.md', name: '地产中介AI可见度打法' },
]

export const PLAYBOOK_PATHS: ReadonlySet<string> = new Set(PLAYBOOK_REGISTRY.map((p) => p.path))

interface FindingRow {
  playbook_name: string
  playbook_path: string
  quoted_line: string
  reference_text: string
  suspected_reason: string
  how_to_verify: string
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export async function pushPlaybookStalenessItems(
  supabase: SupabaseClient,
  items: ManualItem[],
): Promise<void> {
  const rows = await fetchAll<FindingRow>((from, to) =>
    supabase
      .from('playbook_staleness_findings')
      .select('playbook_name, playbook_path, quoted_line, reference_text, suspected_reason, how_to_verify')
      .order('playbook_path', { ascending: true })
      .order('reference_text', { ascending: true })
      .range(from, to),
  )

  for (const f of rows) {
    items.push({
      kind: 'playbook_reference_stale',
      client_id: 'infra',
      client_name: 'Magic Engine 平台治理',
      what: `《${f.playbook_name}》里这句话疑似过期："${truncate(f.quoted_line, 140)}"——${f.suspected_reason}`,
      how: f.how_to_verify,
      href: '',
    })
  }
}
