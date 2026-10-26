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
import type { PmKind } from './five-kinds'

export interface ClientDocManualTask {
  clientId: string
  clientName: string
  what: string
  how: string
  href: string
  /** ISO instant，过了这个时间点不再下发。 */
  expiresAt: string
  /**
   * ISO instant，早于这个时间点不下发——避免"事情还没到能做的那一刻"就摆上今日待办，
   * 操作者点开却找不到东西做（比如视频还没发布，首评链接没地方贴）。不填等于现在就能下发。
   */
  startsAt?: string
  /**
   * 这件事属于 PM 五类里的哪一类（默认「点一次」）。比如「要不要对生产库执行」
   * 是拍板，不是点一次 —— 写在这里，今日待办就会把它放进「要你拍板的」那一栏。
   */
  pmKind?: PmKind
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
    // 见 docs/ROADMAP.md「NAL 广告预算止血 + WhatsApp 对话接入排查」第二件事第 1 条（2026-09-21）
    // 卡点 1：`20260902000002_whatsapp_phone_number_id.sql` 半个月前就合并进主分支，但从没对
    // 生产数据库真正执行过——生产 clients 表没有 whatsapp_phone_number_id 这一列。这是纯新增
    // 字段（4 个 ADD COLUMN + 1 个唯一索引，无 RLS 改动），按铁律不可逆操作需 PM 显式
    // `go apply`，但此前只写进 ROADMAP.md 当一个待勾选项，没有任何执行管道会主动提醒 PM 去看，
    // 违反铁律 3 下半「管道不许断头」——不下发这条待办，WhatsApp 接入会一直卡在这一步，
    // 且没人知道要去翻文档。2026-09-21 Codex 复审第 3 轮抓到，已改成同数组里独立一条今日待办。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    // 「要不要对生产数据库执行」是撤不回的拍板，不是点一次
    pmKind: 'decide',
    what: 'NAL 的 WhatsApp 接入卡在第一步：生产数据库 clients 表还没有 whatsapp_phone_number_id 这一列，migration 代码半个月前已合并但从未对生产执行——这是纯新增字段（4 个 ADD COLUMN + 1 个唯一索引，不改 RLS），风险很低，但按铁律必须 PM 明确拍板才能对生产数据库执行',
    how: '点右边链接看一眼这个 migration 具体改了什么（很短，4 段加字段说明）；确认可以执行就回一句 `go apply`，这里就会去跑；暂时不想动就回 `暂不`，之后想清楚了再说',
    href: 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/supabase/migrations/20260902000002_whatsapp_phone_number_id.sql',
    // PM 2026-09-26 定「先不花」钱走 360dialog，WhatsApp 进 CRM 暂停；这三步做完也收不到消息（NAL 号码在 WhatsApp Business App 上，要走服务商托管的并存开户），提前撤下，恢复时再重发。
    expiresAt: '2026-09-26T00:00:00+12:00',
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
    // PM 2026-09-26 定「先不花」钱走 360dialog，WhatsApp 进 CRM 暂停；这三步做完也收不到消息（NAL 号码在 WhatsApp Business App 上，要走服务商托管的并存开户），提前撤下，恢复时再重发。
    expiresAt: '2026-09-26T00:00:00+12:00',
  },
  {
    // 卡点：即使权限和迁移都补上，Meta App 后台的 webhook 订阅没打开，Meta 照样不推送消息；
    // 这一步只有能登 Meta App 后台的人能核实，开发机验证不了。
    // 2026-09-21 Codex 复审第 2 轮抓到：生产 META_VERIFY_TOKEN 还没配（docs/ENV.md:171），
    // route.ts:66-68 缺这个变量时订阅握手直接返回 500——原文案让操作者直接点 Subscribe，
    // 握手必然失败。已改成把「先在 Render 配好验证字符串」列为同一条待办的前置步骤，
    // 并给出匹配的 callback URL，不再只下发订阅动作本身。
    // 2026-09-21 Codex 复审第 3 轮又抓到：上一版把 META_APP_SECRET 明确排除在这条待办之外，
    // 但数组里没有另一条任务负责配置它——route.ts:487-489 缺这个变量时收消息直接返回 500，
    // 结果就算这条待办全部做完、握手也通过了，消息还是全部收不到。META_APP_SECRET 跟
    // META_VERIFY_TOKEN 是同一个人、同一次登录 Render+Meta App 后台就能顺手配完的两个变量，
    // 拆成两条待办没有意义，已并入同一条的步骤里，不再排除。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: '就算权限和数据库字段都补上了，生产环境现在还没配 META_VERIFY_TOKEN 和 META_APP_SECRET 这两个变量，前者缺了订阅握手直接失败，后者缺了就算握手成功、消息也会被签名校验直接拒收返回 500（不是「没打开开关」，是这条线现在物理上收不到消息）；这一步只有能登 Meta App 后台+Render 后台的人能核实和操作，开发机验证不了',
    how: '① 想一个只用于这条 webhook 的随机验证字符串，记下来；② 登录 Render 后台，把这个服务 Environment 里新增变量 META_VERIFY_TOKEN，值填①那串字符串；③ 打开 Meta App 后台 → 选中给 NAL 用的那个 App → 左侧「设置」→「基本资料」→ App Secret 一栏点 Show 复制出来 → 回 Render 同一个 Environment 页面新增变量 META_APP_SECRET，值填这串密钥；两个变量都填完后保存生效；④ 回 Meta App 后台左侧「WhatsApp」→「Configuration」→ Callback URL 填 https://app.magicengine.com.au/api/webhooks/whatsapp，Verify Token 填跟②完全相同的字符串 → 点 Verify and Save；⑤ 确认订阅了 messages 事件，没订阅就勾 Subscribe',
    href: 'https://developers.facebook.com/apps/',
    // PM 2026-09-26 定「先不花」钱走 360dialog，WhatsApp 进 CRM 暂停；这三步做完也收不到消息（NAL 号码在 WhatsApp Business App 上，要走服务商托管的并存开户），提前撤下，恢复时再重发。
    expiresAt: '2026-09-26T00:00:00+12:00',
  },
  {
    // 见 docs/ROADMAP.md「NAL 广告预算止血 + WhatsApp 对话接入排查」第一件事（2026-09-21）。
    // 2026-09-21 Codex 复审第 2 轮抓到：加完预算后「观察 1-2 天确认咨询量回升」这个复查
    // 只写进了 ROADMAP，没有任何执行管道会主动提醒——没有自动检查也没有带截止时间的
    // 待办，广告可能继续多花却没人去核实咨询量有没有回来。做不到自动检查（咨询量判定
    // 依赖人读对话记录，不是一个能可靠自动跑的规则）时，先下发一条带明确截止时间的
    // 今日待办兜底，铁律 3 下半「管道不许断头」。
    // 2026-09-21 Codex 复审第 3 轮抓到：原文案让操作者去 ME 的「广告健康」页面查——实测
    // 那个页面（src/app/dashboard/clients/[id]/ads-health/page.tsx:38-47,443-445）只按
    // campaign 汇总近 7 天累计咨询数，既没有 ad set 维度也没有逐日数字，指定的广告组在
    // 那页根本看不到，操作者没法照着走。核实过 ME 系统内其他页面（CRM 全部客人页、成交
    // 审核队列）也都没有「按天统计某个广告组咨询数」这个维度，不是漏看，是这个能力还没
    // 建。做不到自动检查、ME 也没有现成页面时，改成指向 Meta Ads Manager 本尊查这个广告组
    // 自己的原生每日数据——不是最终判据但能先做粗判，比一个查不到东西的链接强。
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics (NAL)',
    what: '9 月 21 日为了救回被暂停的 Messenger 广告组，把主系列「新亚8月广告系列-物流」（52589907084125）预算从 $62/天加到了 $92/天——这笔多花的预算需要确认咨询量真的回到暂停前的每周 30-50 条水平，没人盯着可能白烧两天预算才被发现。注意：ME 后台目前没有能直接看这个广告组每日咨询数的页面（「广告健康」页只按整个系列汇总近 7 天，不到广告组、也不到天），所以这一步只能先去 Meta 广告管理工具本身查',
    how: '打开 Meta Ads Manager → 选中 NAL 的广告账户 → 搜索框输入广告组编号 52589967398925（或名字「物流潜在客户广告组」）→ 右上角 Breakdown → By Time → Day → 看恢复投放后每天的「Messaging conversations started」（开始的私信对话数，Meta 原生指标，跟人工判定的「有效咨询」不完全是一回事，但能先做粗判）有没有回到接近暂停前每天 4-7 条的水平；已经回升就回一句「已回升」，看不懂这项指标或数字不对就发给顾问窗口进一步排查',
    href: 'https://adsmanager.facebook.com/adsmanager/manage/adsets',
    expiresAt: '2026-09-23T09:00:00+13:00',
  },
  {
    // 见 issue #1299（2026-09-01 查实 Meta 应用 business_verification_passes=false）。
    // 它同时卡住三件事：WhatsApp 消息进 CRM、CTS Messenger 自动回复上线、给客户一键授权；
    // 只能 PM 本人上传公司文件，开发做不了。可 25 天里它只躺在 issue 里，没进任何待办 ——
    // 铁律 3 下半「管道不许断头」。2026-09-26 CRM 冲刺核实 WhatsApp 卡点时补发。
    // 法定主体按 #1061 / #1049 冻结值：Magic Engine AI Technology Limited（新西兰注册）。
    clientId: 'infra',
    clientName: 'Magic Engine（平台）',
    what: 'ME 在 Meta 的企业认证从 9 月 1 日查到就没通过，一直没人动。它同时卡着三件事：WhatsApp 消息进 CRM、CTS 的 Messenger 自动回复上线、以后给客户一键授权。这一步只能你本人上传公司文件，开发这边做不了',
    how: '点链接打开 Meta 商务管理平台，先确认左上角选的是 Magic Engine 这个商务组合 → 「企业信息」里找到「企业验证」点开始 → 公司名称填 Magic Engine AI Technology Limited（Limited 不要写成 Ltd），地址按公司注册文件原样填，两处都要跟文件逐字一致 → 上传新西兰公司注册证书（Certificate of Incorporation，在新西兰 Companies Office 网站上能下载）→ 提交。Meta 一般几天到一周用邮件回复；被退回就把那封邮件转给 CRM 构建窗口',
    href: 'https://business.facebook.com/settings/info',
    expiresAt: '2026-10-26T09:00:00+13:00',
  },
  {
    // 见 docs/ledger/2026-09-28-eastinter-reels-sep29-oct5.md「阻塞」。
    // Muapi 余额不足是本地 scratchpad 脚本触发的，不经过 content_work_orders，
    // pushVideoCreditsItem（manual-content-items.ts）按 content_work_orders.reject_reason
    // 判断余额告警，这条命中不了它——台账卡写了阻塞原因，但没有任何今日待办真正下发充值
    // 这件事，剩下 5 条 Oct 1–5 的 Reels 会因为没人充值而按期发不出（Codex 2026-09-28
    // 复审第 3 轮抓到 PR #2173）。改成显式今日待办条目，过期时间覆盖到最后一条 Oct 5
    // 发布窗口，同台账卡里的 verify_by 一起兜底。
    clientId: 'infra',
    clientName: 'Magic Engine 后台',
    what: 'East International Facebook Reels 排期用的 Muapi 出片余额不足（低于约 $0.50 的最低阈值），剩下 5 条（Oct 1–5，每天 10:00 AEST/AEDT 发布）脚本已写好但提交不了新任务，不充值这 5 条会按期发不出',
    how: '打开链接充值约 $1–2（这是我们生成 East International Reels 画面用的账户）。充完回我一句，我立即续跑剩下的 5 条',
    href: 'https://muapi.ai/topup',
    expiresAt: '2026-10-05T09:00:00+11:00',
  },
  {
    // 见 docs/ledger/2026-09-28-eastinter-meta-nz-ad-account-slot-full.md。
    // 台账卡只写了结论（需 PM 联系 Meta 客服），没有对应的今日待办条目——写进台账卡不等于
    // 下发（CLAUDE.md 铁律 3 下半：管道不许断头）。ledger 卡本身当时也没有 verify_by，
    // 单靠 decided 状态默认 7 天才会被夜巡拎出来，太慢（Codex 2026-09-28 复审第 3 轮抓到
    // PR #2173）。
    clientId: 'east-international',
    clientName: 'East International',
    what: 'East International 建不出新西兰元 Meta 广告账户——所属 Business Manager 广告账户数已满 5/5，其中一个已关闭的澳元账号占着名额没释放，必须联系 Meta 客服处理才能解除，不然新西兰这条投放起不来',
    how: '打开链接进 Business Settings 广告账户列表，确认已关闭的澳元账号还占着名额 → 通过 Meta 官方客服/帮助中心提交「Increase ad account limit」或说明已关闭账号要释放名额 → 客服处理完回我一句，我立即建新西兰元账号',
    href: 'https://business.facebook.com/settings/ad-accounts',
    expiresAt: '2026-10-28T09:00:00+11:00',
  },
  ...eastinterReelsFirstCommentTasks(),
]

/**
 * East International 7 条 Facebook Reels（docs/ledger/2026-09-28-eastinter-reels-sep29-oct5.md）
 * 每条发布后都要人工在第一条评论粘贴带 UTM 的 CTA 链接，Reels 本身用 API 排期但这一步
 * API 做不到（Facebook 没有「发布时自动加首评」的接口）。
 *
 * 之前这 7 条操作只写在台账卡正文里——decided 卡默认要闲置超过 7 天（2026-10-06）
 * 才会被今日待办拎出来，届时全部发布时间早就过了，等于没人在发布当天被提醒去加首评
 * （Codex 2026-09-28 复审 PR #2173 抓到）。改成每条各自一条今日待办，发布当天出现，
 * 过期自动消失，不依赖台账的「闲置超期」兜底。
 *
 * 2026-09-28 Codex 复审第 3 轮又抓到：只给 expiresAt 没给 startsAt，7 条从部署那一刻
 * 起就会全部出现在今日待办里——Sep 29 那条还没关系（本来就该马上看到），但 Oct 1–5
 * 那几条视频当时还没发布，操作者点开待办去 Facebook 找不到对应的 Reel，等于白提醒。
 * 现在每条都带 startsAt = 该条视频的排期发布时间，发布前不下发。
 *
 * clientId 用 'east-international' 占位：这个客户的真实生产 client_id 不在仓库里，
 * 本次修复不查生产库确认，先用非 UUID 占位（同 'infra' 的写法），不影响待办展示——
 * pushClientDocManualTaskItems 不按 clientId 反查 clients 表。以后核实到真实 id 时
 * 顺手换掉。
 *
 * href 统一指向台账卡本身（session:e12e5606 里的视频 ID / BM ID 不进仓库，没有更精确
 * 的直达链接可以确认），how 里说清楚去 Facebook 哪个标签页找哪条视频。
 */
function eastinterReelsFirstCommentTasks(): ClientDocManualTask[] {
  const LEDGER_HREF =
    'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/ledger/2026-09-28-eastinter-reels-sep29-oct5.md'
  const clientId = 'east-international'
  const clientName = 'East International'
  const rows: Array<{ date: string; ctaUrl: string; startsAt: string; expiresAt: string }> = [
    {
      date: 'Sep 29',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=sea-freight-sep29',
      startsAt: '2026-09-29T10:00:00+10:00',
      expiresAt: '2026-09-30T09:00:00+10:00',
    },
    {
      date: 'Sep 30',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=4steps-sep30',
      startsAt: '2026-09-30T10:00:00+10:00',
      expiresAt: '2026-10-01T09:00:00+10:00',
    },
    {
      date: 'Oct 1（周四）',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=air-freight-oct1',
      startsAt: '2026-10-01T10:00:00+10:00',
      expiresAt: '2026-10-02T09:00:00+10:00',
    },
    {
      date: 'Oct 2（周五）',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=lcl-vs-fcl-oct2',
      startsAt: '2026-10-02T10:00:00+10:00',
      expiresAt: '2026-10-03T09:00:00+10:00',
    },
    {
      date: 'Oct 3（周六）',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=4steps-oct3',
      startsAt: '2026-10-03T10:00:00+10:00',
      expiresAt: '2026-10-04T09:00:00+11:00',
    },
    {
      date: 'Oct 4（周日）',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=cities-oct4',
      // Oct 4 2026 02:00 AEST 起 AU 东部进入夏令时(AEDT, UTC+11)，这条发布时间已在切换之后。
      startsAt: '2026-10-04T10:00:00+11:00',
      expiresAt: '2026-10-05T09:00:00+11:00',
    },
    {
      date: 'Oct 5（周一）',
      ctaUrl:
        'https://eastinter.com.au/eastinter-pricing-calculator?utm_source=facebook&utm_medium=reel&utm_campaign=one-partner-oct5',
      startsAt: '2026-10-05T10:00:00+11:00',
      expiresAt: '2026-10-06T09:00:00+11:00',
    },
  ]
  return rows.map((r) => ({
    clientId,
    clientName,
    what: `East International ${r.date} 10:00 AEST/AEDT 排期发布的 Facebook Reel 需要人工加首评——发布本身走 API 排期，但「发布后在第一条评论粘贴带 UTM 的 CTA 链接」这步 Facebook 没有排期接口能做，漏了这条视频就没有可追踪的落地页流量`,
    how: `打开 East International 管理的 Facebook 主页 → Reels/视频标签，找到 ${r.date} 发布的这条 → 在第一条评论原样粘贴：${r.ctaUrl}`,
    href: LEDGER_HREF,
    startsAt: r.startsAt,
    expiresAt: r.expiresAt,
  }))
}
