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
    // 卡点 2：系统用户令牌缺这个权限，查不到 phone_number_id，只有能登 Meta Business
    // 后台的人能做，之前只写进文档等于没下发（Codex 复审抓到）。
    // 2026-09-21 Codex 复审第 2 轮又抓到两处：①原文案让操作者把新生成的长期 token
    // 直接「发给子牙」——这个 token 能操作 WhatsApp 和广告资产，粘进对话/日志就是长期
    // 泄露，跟 docs/sops/server-migration-secrets-handover.md:9-11 的密钥交接规矩正面冲突，
    // 已改成让操作者自己写入 Render 或走密码管理器一次性链接。②原文案说「代码和数据库都
    // 已就绪」，但 docs/ROADMAP.md 同一节第 1 条记录 `whatsapp_phone_number_id` 这一列
    // migration 从未在生产数据库真正执行过（查询会报「字段不存在」），不是「就绪」，
    // 已改成明确列为另一个独立、还没做的前置项，避免操作者做完这条就误以为线路能通。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: 'NAL 的 WhatsApp 消息线卡住收不到消息——当前系统用户令牌缺 whatsapp_business_management 权限，查不到 NAL 那个 WhatsApp 号码的技术编号（phone_number_id）。注意这只是其中一个卡点：生产数据库 clients 表的 whatsapp_phone_number_id 这一列还没真正建（migration 代码已合并但从未对生产执行），这条待办做完也还接不通，两件事都要做完才行',
    how: '打开 Business Settings → 左侧「用户」→「系统用户」→ 选中给 Magic Engine 用的那个系统用户 → Generate New Token → 权限清单里额外勾上 whatsapp_business_management（其余已勾的权限保持不变）→ 生成后不要粘贴发给任何人或任何聊天/agent：自己有 Render 权限就直接登录 Render 后台把新 token 更新进这个服务 Environment 里的系统用户令牌那一项；没有 Render 权限就用 1Password 或 Bitwarden 建一条会自动过期的一次性安全分享链接，发给有 Render 权限的人去更新',
    href: 'https://business.facebook.com/settings/system-users',
    expiresAt: '2026-10-21T09:00:00+13:00',
  },
  {
    // 卡点：即使权限和迁移都补上，Meta App 后台的 webhook 订阅没打开，Meta 照样不推送消息；
    // 这一步只有能登 Meta App 后台的人能核实，开发机验证不了。
    // 2026-09-21 Codex 复审第 2 轮抓到：生产 META_VERIFY_TOKEN 还没配（docs/ENV.md:171），
    // route.ts:66-68 缺这个变量时订阅握手直接返回 500——原文案让操作者直接点 Subscribe，
    // 握手必然失败。已改成把「先在 Render 配好验证字符串」列为同一条待办的前置步骤，
    // 并给出匹配的 callback URL，不再只下发订阅动作本身。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: '就算权限和数据库字段都补上了，生产环境现在还没配 META_VERIFY_TOKEN，Meta 那边订阅握手会直接失败（拿不到消息不是「没打开开关」，是握手过不去）；这一步只有能登 Meta App 后台+Render 后台的人能核实和操作，开发机验证不了',
    how: '① 想一个只用于这条 webhook 的随机验证字符串，记下来；② 登录 Render 后台，把这个服务 Environment 里新增变量 META_VERIFY_TOKEN，值填①那串字符串，保存生效；③ 打开 Meta App 后台 → 选中给 NAL 用的那个 App → 左侧「WhatsApp」→「Configuration」→ Callback URL 填 https://app.magicengine.com.au/api/webhooks/whatsapp，Verify Token 填跟②完全相同的字符串 → 点 Verify and Save；④ 确认订阅了 messages 事件，没订阅就勾 Subscribe。注意：这一步只解决「订阅握手」，实际收消息还需要另配 META_APP_SECRET（签名验证，同样在 docs/ENV.md 标待配），不在这条待办范围内',
    href: 'https://developers.facebook.com/apps/',
    expiresAt: '2026-10-21T09:00:00+13:00',
  },
  {
    // 见 docs/ROADMAP.md「NAL 广告预算止血 + WhatsApp 对话接入排查」第一件事（2026-09-21）。
    // 2026-09-21 Codex 复审第 2 轮抓到：加完预算后「观察 1-2 天确认咨询量回升」这个复查
    // 只写进了 ROADMAP，没有任何执行管道会主动提醒——没有自动检查也没有带截止时间的
    // 待办，广告可能继续多花却没人去核实咨询量有没有回来。做不到自动检查（咨询量判定
    // 依赖人读对话记录，不是一个能可靠自动跑的规则）时，先下发一条带明确截止时间的
    // 今日待办兜底，铁律 3 下半「管道不许断头」。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: '9 月 21 日为了救回被暂停的 Messenger 广告组，把主系列「新亚8月广告系列-物流」（52589907084125）预算从 $62/天加到了 $92/天——这笔多花的预算需要确认咨询量真的回到暂停前的每周 30-50 条水平，没人盯着可能白烧两天预算才被发现',
    how: '打开 ME 后台 NAL 的广告健康页,看「物流潜在客户广告组」(52589967398925)最近 1-2 天的每日咨询数,跟暂停前每周 30-50 条(约每天 4-7 条)比;已经回升就回一句「已回升」,没回升就发给顾问窗口进一步排查',
    href: 'https://app.magicengine.com.au/dashboard/clients/4ae76381-cd45-43bd-85cd-98cfd7604007/ads-health',
    expiresAt: '2026-09-23T09:00:00+13:00',
  },
]
