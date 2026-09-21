/**
 * One-off client ops requests written into a client plan doc under
 * docs/clients/<client>/ (e.g. "明早 09:00 前扫一眼 xx") — only writing it
 * into the doc is not dispatch (CLAUDE.md 铁律 3 下半: 管道不许断头).
 *
 * This file is deliberately kept separate from the generic loader in
 * manual-items.ts, mirroring platform-candidate-reviews.ts: the loader
 * (`pushClientDocManualTaskItems`) is shared platform code, this array is
 * per-client configuration data. Adding a new client's one-off task means
 * appending here, not editing the shared loader path.
 */
export interface ClientDocManualTask {
  clientId: string
  clientName: string
  what: string
  how: string
  href: string
  /** ISO instant，过了这个时间点不再下发。 */
  expiresAt: string
}

export const CLIENT_DOC_MANUAL_TASKS: ClientDocManualTask[] = [
  {
    // 见 docs/clients/cts/2026-09-07-golden-china-surge-plan.md「已知数据缺口」
    clientId: 'c0000000-0000-0000-0000-000000000000',
    clientName: 'CTS Tours NZ',
    what: 'Golden China 冲量方案的视频素材改造清单只从广告账户 Media Library 反查得到——纯自然发帖(没投过广告)的爆款不在这个库里,清单可能漏掉真正的高热素材',
    how: '手机登录 facebook.com/CTSToursNZ/videos 扫一眼,找有没有观看数 >10k 的自然视频不在改造清单的 5 条里;有就发给顾问窗口补进去,没有就回一句「没有」',
    href: 'https://www.facebook.com/CTSToursNZ/videos',
    // render.yaml 的 pm-daily-todo 每个工作日只在 19:00 UTC(08:00 NZDT)发一次;
    // 原定 2026-09-08T09:00 NZDT 只比那次运行晚 1 小时,PR review/merge/部署
    // 只要晚一点就整条错过、且当天 20:00 UTC 后连看板也不再生成(Codex P2)。
    // 往后放到 09-11,保证即便合并/部署拖两天,工作日 digest 也至少跑到它一次。
    expiresAt: '2026-09-11T09:00:00+13:00',
  },
  {
    // 见 docs/ROADMAP.md「NAL 广告预算止血 + WhatsApp 对话接入排查」（2026-09-21）
    // 卡点 2：webhook/数据库都已就绪，但系统用户令牌缺这个权限，查不到 phone_number_id，
    // 只有能登 Meta Business 后台的人能做，之前只写进文档等于没下发（Codex 复审抓到）。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: 'NAL 的 WhatsApp 消息线卡住收不到消息——代码和数据库都已就绪，但当前系统用户令牌缺 whatsapp_business_management 权限，查不到 NAL 那个 WhatsApp 号码的技术编号（phone_number_id），这一步不做后面全部白搭',
    how: '打开 Business Settings → 左侧「用户」→「系统用户」→ 选中给 Magic Engine 用的那个系统用户 → Generate New Token → 权限清单里额外勾上 whatsapp_business_management（其余已勾的权限保持不变）→ 生成后把新 token 发给子牙，我会更新到 Render 并自动查出号码编号接上',
    href: 'https://business.facebook.com/settings/system-users',
    expiresAt: '2026-10-21T09:00:00+13:00',
  },
  {
    // 卡点：即使权限和迁移都补上，Meta App 后台的 webhook 订阅没打开，Meta 照样不推送消息；
    // 这一步只有能登 Meta App 后台的人能核实，开发机验证不了。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: '就算权限和数据库字段都补上了，Meta App 后台如果没把 NAL 这个 WhatsApp 号码的 webhook 订阅打开，Meta 照样不会把消息推过来——这一步只有能登录 Meta App 后台的人能核实，开发机验证不了',
    how: '打开 Meta App 后台 → 选中给 NAL 用的那个 App → 左侧「WhatsApp」→「Configuration」→ 确认 Webhook callback URL 和 Verify Token 已填、且订阅了 messages 事件；没订阅就点 Subscribe',
    href: 'https://developers.facebook.com/apps/',
    expiresAt: '2026-10-21T09:00:00+13:00',
  },
]
