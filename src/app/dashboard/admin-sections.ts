import type { NavSection } from './shell/nav-types'

export const ADMIN_SECTIONS: NavSection[] = [
  {
    items: [
      { key: 'overview', label: 'Overview', mark: 'OV', href: '/dashboard' },
      { key: 'today', label: '今日待办', mark: 'TD', href: '/dashboard/today' },
      { key: 'learning', label: 'Agent 学习库', mark: 'LB', href: '/dashboard/learning' },
      { key: 'ad-approval', label: '等你点头的广告', mark: 'OK', href: '/dashboard/ad-approval' },
      { key: 'kernel-approvals', label: '等你点头的动作', mark: 'KA', href: '/dashboard/kernel-approvals' },
      { key: 'launch-signoff', label: '上线签字', mark: 'SG', href: '/dashboard/launch-signoff' },
      { key: 'clients', label: 'Clients', mark: 'CL', href: '/dashboard/clients' },
    ],
  },
  {
    title: '出片与内容',
    items: [
      { key: 'factory', label: '视频工厂', mark: 'VF', href: '/dashboard/factory' },
    ],
  },
  {
    title: '广告与客人',
    items: [
      { key: 'ad-engine', label: '广告', mark: 'AE', href: '/dashboard/ad-engine' },
      { key: 'voice', label: '电话', mark: 'VO', href: '/dashboard/voice' },
      { key: 'conversions', label: '转化', mark: 'CV', href: '/dashboard/conversions' },
      { key: 'reports', label: 'Reports', mark: 'RP', href: '/dashboard/reports' },
    ],
  },
  {
    title: '账务与客户管理',
    collapsed: true,
    items: [
      { key: 'mtc-overview', label: 'MTC Overview', mark: 'MC', href: '/dashboard/admin/mtc-overview' },
      { key: 'distributors', label: 'Magic Network', mark: 'MN', href: '/dashboard/admin/distributors' },
      { key: 'prospecting', label: 'Prospecting', mark: 'PS', href: '/dashboard/admin/prospecting' },
      { key: 'user-console', label: 'User Console', mark: 'UC', href: '/dashboard/admin/users' },
      { key: 'commerce', label: '选品工作台', mark: 'PI', href: '/dashboard/commerce' },
    ],
  },
  {
    title: '系统与诊断',
    collapsed: true,
    items: [
      { key: 'workflows-health', label: '自动任务健康', mark: 'WH', href: '/dashboard/workflows-health' },
      { key: 'cron-health', label: 'Cron Health', mark: 'CH', href: '/dashboard/admin/cron-health' },
      { key: 'ai-gateway', label: 'AI Gateway', mark: 'AG', href: '/dashboard/admin/ai-gateway' },
      { key: 'mcp-keys', label: 'MCP Keys', mark: 'MK', href: '/dashboard/admin/mcp-keys' },
      { key: 'flywheel', label: 'Flywheel', mark: 'FW', href: '/dashboard/admin/flywheel' },
      { key: 'industry-baselines', label: 'Industry Baselines', mark: 'IB', href: '/dashboard/industry-baselines' },
      { key: 'viral-references', label: 'Viral References', mark: 'VR', href: '/dashboard/admin/viral-references' },
      { key: 'team-memory', label: '团队工作记忆', mark: 'TM', href: '/dashboard/team-memory' },
      { key: 'product-map', label: 'ME2 产品地图', mark: 'PM', href: '/dashboard/me2/product-map' },
      { key: 'agents-docs', label: 'Agent 与手册', mark: 'AD', href: '/dashboard/admin/agents' },
    ],
  },
]
