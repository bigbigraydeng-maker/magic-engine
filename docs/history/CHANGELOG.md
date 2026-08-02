# Magic Engine — 功能完成日志

> 从 `ROADMAP.md § 9` 拆出（2026-07-25 文档整理）。**只记已上线的事**，倒序。
> 未完成事项见 [ROADMAP.md](../ROADMAP.md) · 全量历史底稿见 [archive/ROADMAP-full-2026-07-25.md](../archive/ROADMAP-full-2026-07-25.md)

---

### 2026-08-02（邮件阶段 1b：信落成人 + 每小时同步 + 管理员批准这道墙）

**做完了什么**：客人发到公司邮箱的信，现在会自动变成 CRM 里的人、对话和触点，接进「今天该联系谁」；每小时自动跑一次（`mailbox-sync`，每小时第 25 分，跟私信第 10 分错开）。这是四条获客管道里唯一一条在往外漏的 —— 库里那 20 条是人手敲进去的，7/29 之后就停了。

**四条判断，每一条错了都会安静地毁掉销售早上那一页**：
- **一条线程只有一个「对方」，由最早那封定** —— 逐封重算会把同一串来回拆成两个人（线程中途转给同事时，它会「变成同事的」）
- **客人自己开过口才建人** —— 我们主动发的询价 / 通知不配在「今天该联系谁」里多一张卡。纯出站线程照存、能接上已有的人就接，**绝不新建**
- **判成机器人的线程整条丢**，连我们在里面回给真人的那封一起 —— 只丢一半会留下一条挂着机器人主题的幽灵对话，而且因为它有出站消息，看起来像我们主动联系过这个客人
- **自动回执不算「有人跟过他」** —— 「Automatic reply / 我不在办公室」躺在已发送里，跟一封真回信长得一模一样

最后一条是 8/2 修过的那个错换了件衣服又来一次（Mailchimp 群发把整页标成已跟进）。顺手把那条判断抽成 `lib/crm/automated-touch`，两个读路径共用一处，并让它**同时**认「按来源」和「按标记」。

**连接邮箱时踩到的两个真问题**：
- **`连上了，但读不到邮箱地址`** —— Graph 的 `/me` 认 `User.Read`，不认 `Mail.Read`。少了它换令牌会成功、读地址却 403，而信明明已经能读了。补上该权限，并加一条只用 `Mail.Read` 的退路（从已发送里取一封的发件人）
- **`需要管理员批准`** —— 有些公司的 Microsoft 365 关掉了「员工可以自己给外部软件授权」（CTS 就是关的）。加了一条管理员专用链接替全公司批准一次。**刻意用 `adminconsent` 端点而不是 `prompt=admin_consent`**：前者不回授权码。走这条路的是 IT 管理员，如果它同时回授权码，我们就会把管理员自己的邮箱存成客户的收信箱 —— 那是这条管道最贵的错误。批准和连接必须是两步

**Codex 复审提了 5 条，全部核实属实、全部改掉**（这一段是这次最有价值的收获）：
1. **邮件会串进「Facebook 私信」页面** —— `conversations` 是四渠道共用表，但私信那几条读写路径**一条都没筛 channel**。邮件一落库就会出现在明确写着「私信」的页面上并配一个走 Meta 的回复框；`messenger-brief-hourly` 还会把邮件当私信写 AI 卡。六处全部焊上 `channel = 'messenger'`（列表 / 单条消息 / CRM 卡片的「在这里回私信」/ 私信 AI 卡 cron / 补挂扫描两处），`sendReply` 再加一道拦截并给它独立的失败原因 `wrong_channel`（原来会报成「窗口关了」，把渠道用错说成时间问题）
2. **一个客户连两个邮箱时，较早那个一封信都读不到** —— 同步单位从「客户」改成「邮箱」，令牌按连接取。水位线也按邮箱算，归属写进 `conversations.page_id`（私信那边它存「哪个主页收到的」，邮件这边存「哪个邮箱收到的」，同一个角色，不用加列）
3. **水位线会永久越过处理失败的线程** —— 原来失败只写 `console.error` 就跳过，而水位线取「已存对话里最新那封信的时间」，下一轮直接跨过失败那条，那几个人再也不会进 CRM 而 cron 还记成功。改成**从旧到新处理 + 一条失败就停**，中途停下报进 cron 汇总
4. **Microsoft 轮换的刷新令牌没存回去** —— 不存新的，连接迟早变成 `invalid_grant` 安静停摆，只能让客户重新授权
5. **线程消息数会倒退** —— 每批只带回看窗口内的几封，拿它当总数，一条十封来回的线程会倒退成 2

**验证**：新增 44 + 8 条测试；对 11 条判断做了变异测试（纯出站也建人 / 机器人线程只丢半条 / 自动回执改成包含匹配 / 客人的自动回复也标机器 / 不按时间排序 / 线程身份逐封重算 / 拿掉 `User.Read` / `/me` 通了也走退路 / 管理员批准后继续存连接 / 失败后继续处理更新的线程 / 停了不上报）—— 逐条改坏都被测试抓住，其中「机器人线程整条丢」第一轮**没被抓住**（两封信的对方是同一个机器人，重判一次仍会丢），补了一条「机器人开的头、我们回给真人」的用例才抓住。645 个相关测试全绿，`npm run build` 通过，`tsc` 零新增错误。**无 migration** —— `conversations` 建表时就留好了 `channel` / `subject` / `contact_id`，`contact_touchpoints.channel` 的 CHECK 里也已经有 `email`。

**还没做**：从 CRM 里**回**邮件（权限已经要了 `Mail.Send`，适配器还没写）· 邮件线程接进多渠道总线。

### 2026-08-02（邮件阶段 1a：从客户邮箱读信 + 「谁算客人」的闸）

**为什么这两件要一起做**：接邮箱最大的风险不是技术，是**公司邮箱里大部分邮件不是客人发的** —— 供应商对账、系统通知、订阅推送、垃圾邮件、同事转发。全灌进 CRM，销售第二天早上会看到几百个 `noreply@` 和 `accounts@` 躺在今天的名单上，那一页当场作废。8/2 已经有过一次小规模预演（4 个假冒 Meta 的钓鱼私信被当成真实客人），邮箱的量级比私信大得多。

**`mail-sender.ts`（谁算客人）**：三条保守判据 —— 地址不成形 / 公司自己的域名（内部同事）/ `noreply` `mailer-daemon` `invoices` 一类开头的系统发件人。用**开头匹配**不用包含匹配（真名叫 Newsletter 的人不该被误伤）。判据刻意不做更聪明的推断：**漏判一个真客人只是少一次便利（他还会再来一封，信也照存），误判一个机器人是让整页不可信**。这一层**只决定要不要建人，不决定要不要存信** —— 邮箱是完整的。

**`mail-graph.ts`（读信）**：只读，不标已读、不移动、不删除。**分开读「收件箱」和「已发送」**，方向由文件夹决定 —— 用 `/me/messages` 一次读全部再靠比对发件人猜方向，遇到别名 / 转发 / 代发就会错，而方向错了整条时间线读不通（客人的话被排成我们说的）。

**三个会安静出错的地方都钉了测试**：不翻页会在忙的那天悄悄漏掉最新的信 · 只取 `bodyPreview` 不拉全文（一封带引用历史的正文几十 KB，几百封就是几十兆）· 水位线用 `receivedDateTime` 而不是 `sentDateTime`（晚到的邮件按发送时间算会直接跳过水位线，永远读不到）。翻页到上限时**如实标注截断**，不假装读全了。

**写测试时撞出一个真问题**：`URLSearchParams` 把空格编成 `+`，而 OData 的 `$filter` / `$orderby` 里 `+` 不保证被当成空格 —— 筛选可能整个失效，**而且不会报错**（要么把整个邮箱拉回来，要么一封都不给）。改成 `%20`，不赌服务器怎么解。

39 个新测试，相关 63 个测试全过，`npm run build` 通过；做过 6 次变异测试（不翻页 / 已发送取错对方 / 水位线用发送时间 / 截断不说 / noreply 也建人 / 内部同事也建人），6 次全部被逮住。**无 migration。**

### 2026-08-02（多渠道总线第一块：不挑渠道的发送出口 + Messenger 适配器）

**产品方向**（PM 2026-08-02）：CRM 要做成集邮件 / WhatsApp / Messenger / 电话于一体的 leads 营销中心，给**所有** ME 客户用，定位与内容工厂同级。

**为什么先修总线，而不是一条条接渠道**：每接一条就在页面和 CRM 里各写一套收发，最后是五个互不相通的半成品 —— 今天那个「点了链接的 33 人整段从页面上消失」就是这类问题的小型预演（段位、文案、优先级全写好了，唯独漏配一行）。

**新增 `lib/messaging/channels.ts`** —— 上层只说「给这个人发这句话」，不关心走哪条线；每条渠道写一个适配器注册进来。三条不能破的规矩：没接的渠道**明确失败**（假装成功会让销售干等一个永远不来的回复）· **窗口先问再发**（不然人打完一段字才被平台拒）· 适配器炸了**变成一句人话**，不把异常抛给页面。这一层不碰数据库 —— 写不写触点、算不算「今天跟过」的规则在 lib/crm 里，不该被各适配器复制一份。

**`adapters/messenger.ts`** 是第一条线，也是后续 WhatsApp / 邮件 / 短信适配器的样板。**不新增任何发送能力** —— 底下走的还是已上线、带隔离复核和发送前审计的 `lib/messenger/send`。选 Messenger 打头是因为它是唯一在跑的渠道（515 条会话），拿它验证总线形状比拿一条没接通的线去猜要稳。

**顺带查明**：`conversations` 表**早就为多渠道设计好了** —— 已有 `channel` / `subject`（邮件主题）/ `status` / **`owner_email`（归属）** / `snooze_until`，只是从没人用（515 条会话全是 messenger、归属 0 条）。所以总线**不需要任何 migration**，后面做「归属 / 转派」也不用加表。

24 个新测试，相关 456 个测试全过，`npm run build` 通过；做过 5 次变异测试（没接的渠道假装成功 / 不先问窗口 / 异常不兜住 / 算窗口不限定客人发来的 / 查会话不带 client_id），5 次全部被逮住。**无 migration。**

### 2026-08-02（点开一个人之后，按钮从十几个收到两个）

**PM 看着「新客人，还没打过」点开后说：「按钮是不是太多了！」** 数了一下确实：9 个阶段快捷键 + 一个 10 项的下拉 + 方向切换 + 输入框 + 私信框。而**一个从没被联系过的人只有两种结果：打通了，或者没打通**。其余全是噪音，而噪音的代价是销售不用这一页。

**新增 `lib/crm/drawer-actions.ts`**，两个纯函数：

`drawerActions(segment, channel)` —— 这一刻最多两个按钮，措辞按他**实际能被联系到的渠道**走：
- 有电话：`打通了，记一笔` / `没打通`（一键，自带那句话，不用打字）
- 只有私信：`回了他，记一笔` / `发出去了，等他回` —— **绝不出现「没打通」**，他没有号码可打，点下去等于往记录里写一句假话，而那句话还会让他明天落进「打过没人接」那一批
- 只有邮箱：措辞改成「发了邮件」
- 三样都没有 / 结论已定：只剩「记一笔」
- 已经聊上的人：主按钮从「打通了」改成「聊完了」

`nextStageChoices(stages, current)` —— 阶段只给**下一步 + 一个「谈崩了」的出口**，其余折进「其他 N 个…」。出口判据只认 `marketingAction === 'suppress'`，**不能用 `isTerminal`** —— 「已付全款」也是终态，但那是成交；把它当出口，销售会在「已报价」的人旁边看到一个「已付全款」快捷键。折起来不是删掉，剩下的一个不少。

顺带修一处丢数据：页面把阶段的 `sortOrder` / `marketingAction` / `isTerminal` 在取回时丢掉了，没有它们「下一步」和「出口」都算不出来。

19 个新测试，CRM 相关 365 个测试全过，`npm run build` 通过；做过 5 次变异测试（没电话也给「没打通」/ 一键动作不带那句话 / 出口判据用 isTerminal / 折起来的其实被丢掉 / 结论已定的人也给联系按钮），5 次全部被逮住。**无 migration。**

### 2026-08-02（看板改成三层 + 跟进标记 —— 顺手挖出两个会骗人的计数 bug）

**PM 的判断**：现在的看板把两种完全不同的东西铺在一起 ——「今天要跟进」「快出行了」是**要人做的事**（30 人），而「新客人」「打过没人接」「聊过没下文」是**积压的人堆**（354 人）。把库存铺在「今天该联系谁」上，等于每天早上给销售看一座山。

**改成三层**，这一页只回答一个问题：现在轮到人做什么。
1. **客人在等你** —— 回话了 / 约了今天打 / 快出行了。做完这一层今天就算过关。
2. **他刚有动作** —— 点了我们发的链接，系统自动抬上来。
3. **先放着的人** —— 默认折起来，人数照旧显示。有动作会自动跳到上面两层。

层的先后是产品判断，不是优先级数字能表达的（`clicked_link` 优先级 5 排在 `new_untouched` 4 前面），所以 `worklist-groups` 的顺序不变量从「全局按优先级」改成「先按层、层内按优先级」，并加了「每一列都必须属于某一层」「每层不许为空」。

**跟进标记**（PM：「便于每日上班来查看和跟进」）：新增 `followUpMarks()` —— 今天已经跟过（整张卡变浅 + 打勾）、上次谁跟的、上次聊了什么、他多少天前打开过邮件。打开**只做提示，绝不进桶也绝不排序**（Apple 会替用户自动打开邮件，8/2 那次 P0 正是把「打开」当成「回话了」）。

**「谁跟的」以前根本没存** —— 1938 条触点里 0 条留下记录人，这就是「早上不知道昨天谁跟的」的根源。`recordManualTouchpoint` 补上 `logged_by`。

**顺手挖出两个会骗人的计数 bug**：
- **时区**：服务器跑 UTC，销售在纽西兰（UTC+12）。他上午做完的活在 UTC 里还算昨天；等纽西兰到中午 UTC 跨日，「今天已联系 N 人」会**集体清零**，销售以为系统把他一早的活弄丢了。改成按客户所在地（`clients.country` → NZ/AU）算自然日。
- **群发充数**：Mailchimp 群发是 outbound、又不带打开/点击标记，跟销售亲手打的电话在数据上一模一样。一封群发能把整块看板标成「今天已经跟过」。现在按来源区分机器发的和人做的。

22 个新测试，CRM 相关 346 个测试全过，`npm run build` 通过；`followUpMarks` 做过 4 次变异测试（按服务器时区算 / 群发算成人跟的 / 打开算成人跟的 / 跟过之后仍挂提示），4 次全部被逮住。**无 migration。**

### 2026-08-02（看板两处可读性：长列折起来 · 「未留姓名」改成他说的第一句话）

**长列折起来**：CTS 的「新客人，还没打过」有 140 人，整列一路拉到底 —— 销售翻到第 30 张就没有「今天能做完」的感觉，那正是他要逃离的 Excel 的感觉。改成每列默认铺 12 张，下面一行「还有 128 人 —— 展开」。**不是截断是折叠**：列头人数照旧是真实总数，点一下全出来；后端封顶（每列 300）没发过来的那些，展开后也照实说明，不让「展开」看起来像给全了。渲染抽成 `BucketColumn`，每列各自记住自己展开没有。

**「未留姓名」改成他说的第一句话**：13 个人显示「未留姓名」，全是从私信进来的 —— Meta 那边就没给名字，不是我们弄丢的。但他们说过话，一句「有没有长城的团」比「未留姓名」有用得多。新增 `contactCardTitle()`：没名字时取**客人自己发的第一条**消息（不是我们的自动欢迎语，否则十几张卡长得一模一样），去掉链接和零宽字符，截到 18 字，前面挂一个**不可省的「问：」标记** —— 拿一句话冒充人名，比不知道名字更糟。只发了表情或链接的退回「未留姓名」。只为没名字的那几个人查（485 人里 13 个），查不到就照旧，坏了不拖垮整页。

11 个新测试，CRM 相关 344 个测试全过，`npm run build` 通过；`contactCardTitle` 做过 4 次变异测试（去掉「问：」标记 / 只发表情也当标题 / 不截断 / 有名字也被覆盖），4 次全部被逮住。**无 migration。**

---

### 2026-08-02（跨窗口工作记忆 —— 一个窗口踩过的坑，下一个窗口自动知道）

**根因**：Claude Code 的记忆是按*目录*存的。实测主目录 95 条、32 个 `.claude/worktrees/*` 各 0 条、命名 worktree（`magic-engine-cts` / `-seo-loop` 等）也各 0 条。不是「没看」，是根本看不到 —— 这就是同一个坑在不同窗口被反复踩的机械原因（三天搭 Dropbox 重复系统、自造 `APIFY_TOKEN` 而仓里早有 `APIFY_API_KEY`）。

**做成了什么**：四个 hook 自动记录每个窗口干了什么 → 会话结束提炼成「教训」和「套路」→ 下一个窗口开工时按当前项目和当前这件活自动带上。127 条旧本地记忆已导入，按「只在这个项目提醒 / 哪儿都提醒」两格归位。管的是 magic-engine / chinatravel / midashand / magic-lab-academy 四个项目及其全部 worktree，其它目录一个字都不上报。

**PM 拍板的**（盘问走完决定树，一次一个问题）：先给自己用不做对外产品 · 教训层和套路层一起做 · 自动全程录不靠自觉 · **教训和套路都全自动入库不用 PM 点**。

**因为全自动，闸门全落在机器可验证的证据上**：只认 PM 当场纠正 / 改动已合入 main / 测试跑通 / 多会话重现 —— 「Claude 说搞定了」不是证据。`multi_session` 只能给已有教训 +1 次确认、不能凭它开新条目（判据是碰过同一批文件，改同一个文件两次就凑够，门槛太低）。套路更严一档：必须有「合入」或「测试通过」，PM 纠正过只能证明我错过、不能证明这套步骤是对的。教训被推翻 2 次自动撤下、套路最近 2 次连续失败自动下架，都不需要 PM 点。

**安全绳**：套路自动上线的是**说明书不是执行权**。步骤里出现合并 / 建表改表 / 对外发布 / 花钱 / 群发 / 删除，落库时自动标成需放行，执行时仍要 PM 显式 go —— 现有闸门一根没拆。

**几个踩出来的坑**：
- `Stop` 每轮回答都会触发，不能拿它当「会话结束」。改成两档：每轮只冲刷防丢数据，真结束才调 AI 提炼，否则一天几百次纯烧钱
- hook 若直接指向仓库里的脚本，窗口切到没有这些文件的分支时管子会**静默断掉**。改成安装时拷一份到 `~/.claude/team-memory/bin/`，跟 git 状态脱钩
- 老记忆有正文上千字的，12 条全文注入 = 每开窗口塞一大坨。注入截断到 180 字，全文留后台
- 注释里写 `worktrees-*/memory/`，那个 `*/` 把整段块注释提前闭合了，编译直接挂
- 「去 Render 接密钥」这类人工步骤写在 PR 描述里就是断头管道，已改成进今日待办（自带说清影响 / 具体点哪里 / 直达链接三件套），cron 跑成功一次后自动消失

**成本**：约 $0.0065–0.015 / 次会话，按每天 30 次约合 $6/月。

---

### 2026-08-02（讲课式短视频从零到定版 —— 大瑞第 1 讲成片跑通）

**做成了什么**：PM 照口播稿一条录到底 → 手机同步 Dropbox → 工作台粘链接 → 点开始 → 15-30 分钟后拿到一条上课件下真人的成片。第 1 讲 169 秒，PM 验收通过。制作方案写进 [sops/lecture-video-production.md](../sops/lecture-video-production.md)。

**这一版新增**：单讲工作台五区（脚本审改 / 制作方式 / 课件预览 / 平台双 CTA / 成片审）· 口播稿导出（连贯逐字稿，提词用）· Dropbox 链接免上传 · 要点配录屏 + 智能剪辑（自动裁内容区、自动配速、讲完自动切回课件）· 6 讲文案按「更实」重做 · 内容工厂生成规则加「要点各是各的」「地域全篇一致」。

**七个坑，每一个都是看片看出来的**：
1. **160MB 录像撑爆做片后台** —— `arrayBuffer + Buffer.from` 内存两份共 320MB，512MB 容器被 OOM kill，任务**静悄悄卡在 rendering、error 为空**。改流式落盘。同类隐患：字幕 PNG 原本每张都是整帧 RGBA（80 条 = 600MB+），改成只画 1080×160 字幕条。
2. **片头判错两次才对** —— 听写的「句子起点」偏早近 2 秒（PM 一耳朵听出来）；改用「声音起来的时刻」抓到的是吸气声；改判「持续说话 ≥0.8s」又把字与字之间的正常停顿当成还没开始。最终用**逐字时间戳**，语义上就是「他开口了」，定版比 PM 手调的还紧 1.2 秒。坑：`word` 和 `segment` 两种粒度必须一起点名，只要 word 接口就不返回 segments。
3. **掐头后字幕错位** —— 第一次修在「段」层把起点拉回 0，等于把已剪掉的字重新铺开，第 0 秒挂着没声音的字幕。正确层级是「字幕块」。
4. **字幕断词** —— 按字数硬切把 `business profile` 切成「siness profile」，网址先被当句号拆三段。改成按「词」打包，英文按 0.55 字宽计。
5. **课件裁字 + 品牌名压字** —— PIL 固定字号单行直画。改成测宽折行 + 字号自适应；品牌名按 PM 要求整个去掉（保持单纯分享）。
6. **地域穿帮** —— 标题写「澳洲华人」，正文 0 处澳洲、4 处奥克兰/惠灵顿。保存时加闸拦截 + 生成规则补一条。
7. **直传 50MB 上限，且传完那一刻才拒** —— 进度条走到 98% 再失败。改成选文件时当场拦 + 指向 Dropbox 链接（无上限、不用等）。

**挂账**：做片任务表防双击唯一索引（要动数据库，等 PM `go apply`）· 数字人整讲首跑（要花钱）· 发布端按平台带不同 CTA。**无 migration。**
### 2026-08-02（接客户自己的邮箱 · 第一步：授权）

**为什么先做邮件**：核过四条获客管道，只有 Messenger 是真通的。邮件是**唯一一条正在往外漏线索**的 —— 客人发到 CTS 的 info@ 的信，ME 里一个字都看不到（库里那 20 条 outlook 记录是人手敲的，7/29 之后就停了；代码里没有收信同步，`render.yaml` 里也没有这个任务）。电话那套是空壳（`voice_calls` 0 通），WhatsApp 从零。

**这一版只做授权**，同步是下一版。这样拆是为了让客户那边可以**先去点同意**，我这边并行写同步。

**为什么用「本人登录」而不是「租户管理员给整个公司授权」**：应用权限那条路要先拿到读全公司每一个邮箱的权力、再用一条访问策略收回到 info@ —— 权力先给满再收，且必须找到租户管理员。委托权限这条路是「用你平时收 info@ 的那个账号登录一次」，拿到的令牌只能碰他本来就能碰的邮箱，范围由 Microsoft 的账号体系保证。对客户老板也是唯一说得清的一句话（铁律 3：需要解释的人工步骤等于没做好）。

**实现**：`platform_oauth_connections` 加一个 provider（`microsoft_mail`，不新建表）；`token-manager` 扩一个 Microsoft 刷新分支；`/api/auth/microsoft/mail/start` + `/callback`；设置页新增「公司邮箱（客人发来的信）」面板，连上后**把邮箱地址显示出来** —— 连错邮箱会把别的部门甚至老板私人的信抓进客户 CRM，必须让人当场看见。权限只要 `Mail.Read` / `Mail.Send` / `offline_access`，明确不要 `Mail.ReadWrite`。

**两个不会当场报错的坑，都用测试钉住了**：拿不到刷新令牌时当场判失败（否则一小时后同步安静停摆）；刷新时传的权限必须跟授权时逐字一致（否则悄悄降权，读信才 403）。

23 个新测试，相关 348 个测试全过，`npm run build` 通过。**含 1 个 migration（放宽 provider 白名单），需 PM 显式 go 才执行。**

### 2026-08-02（私信能在 CRM 里直接回了 —— 闭环工具的第一根管子）

**PM 的方向**：这套 CRM 要做成集邮件 / WhatsApp / Messenger / AI 外呼于一体的 leads 营销闭环工具。先摸了一遍现状，缺口如下：

| 渠道 | 客人发来 → 进 CRM | 从 CRM 回过去 |
|---|---|---|
| Messenger 私信 | ✅ 每小时自动同步 | ⚠️ 能力已有，但 CRM 页面上**没有入口** |
| 邮件 | ✅ 打开 / 点击已回流 | ❌ 只能复制地址去别处发（且 ME 目前只有自己的发件域名，不能以客户身份发） |
| 电话 | 靠人「记一笔」 | 卡上能点拨号，内容靠人打字 |
| AI 外呼 | Phase 36 后台整套已建 | ❌ 通话内容**没跟 contacts 打通** |
| WhatsApp | ❌ | ❌ |

**本次补第一行**：CRM 卡片会对 110 位 CTS 客人写「没留电话 —— 只能在 Messenger 回他」，销售看见了却要跳去私信页、再从几百条会话里翻出这个人。承诺一件事又不给做，比不承诺更伤这一页的可信度。

**实现**：新增只读接口 `/crm/contacts/[cid]/messenger`，回答「哪条会话 + 还能不能回」；抽屉里整块复用私信页的 `ReplyBox`（发送前确认、24 小时窗口提示、`usedAiDraft` 审计都在里面），发送仍走既有的 `/messenger/conversations/[id]/reply`。**没有新增任何发送能力**，也不给 AI 草稿（PM 2026-07-26 的规矩是 AI 只写草稿、人按发送；CRM 这侧本就没草稿，就老实空着）。`/crm/today` 补回 `viewerEmail`，发送框当面说清楚这条话挂在谁名下。

**窗口判据**：从**客人**最后一条 inbound 消息算起，不用会话表那个「最后一条是谁发的」摘要列 —— 按会话最后活动时间算，我们自己刚回的那条会凭空重开 24 小时；按摘要列算，我们回过之后又会误判成「不能回了」。

10 个新测试，CRM + 私信相关 397 个测试全过；4 次变异测试（去掉 inbound 限定 / 去掉 client_id 隔离 / 多条会话取最老 / 没说过话也当窗口开着）全部被逮住。**无 migration。**

### 2026-08-02（33 位最有意向的客人在页面上看不见 —— 补一列 + 用测试封死）

**PM 问「读了邮件的 40 多人在哪里看」，答案是：看不到。** CTS 有 44 人点过邮件里的行程链接，其中 33 人点完之后没有任何人联系过 —— 他们被正确判成了 `clicked_link`（「看了行程，还没人跟」），段位、文案、优先级全都写好了，**唯独 `/crm/today` 路由里那份「看板有哪几列」的名单漏了这一行**。

**为什么没有任何报错**：这一段是 warm，进不了页面下方「不在今天名单上的人」那一栏（只收 cold / off），而看板又没有他们的列。人就这么凭空消失了。这批恰恰是名单上意向最明确的一批 —— 他自己刚点开过行程。

**修**：把那份名单从路由里搬出来成 `src/lib/crm/worklist-groups.ts`（`WORKLIST_GROUPS` / `groupDisplayMeta` / `worklistSegments`），补上 `clicked_link` 列，排在「新客人」和「打过没人接」之间（今天刚进线的比两周前点过链接的更烫，但点过链接比盲目再打一次强）。`SEGMENT_META` 改为 export，供覆盖率断言使用。

**为什么搬出来**：为了能被测试钉住一个**不变量** —— 每一个 hot / warm 段都必须落在某一列里。9 个新测试还顺带钉住：cold/off 不许占列、一个段只能进一列（否则同一个人在两列各出现一次）、列序必须等于优先级序、每列都说得出「这是谁、该怎么办」。做过 4 次变异测试（删掉 clicked_link 列 / 把「以后才走」塞进列里 / 同一段配两列 / 打乱列序），4 次全部被逮住。

以后再加新段，忘了配列会当场测试失败，而不是等客人静悄悄地漏掉。**无 migration。**

### 2026-08-02（「今天该联系谁」按能不能联系得上分流 + 字号放大）

**背景**：PM 看着 `/crm` 看板问「这个页面应该怎么设计」，并指出字太小。查数据发现一个**正确性**问题排在所有观感问题前面：CTS 名单 476 人里 **124 人（26%）没有电话号码**，其中 106 人只有 Facebook 身份（从私信补挂进来的）。而「新客人，还没打过」这一桶的说明写着「越早打通越容易成」—— 销售点开发现根本打不了，这一页就开始不被信任。

**修 · 建议的渠道必须落在他真能被联系到的地方**：`segments` 新增 `reachableChannel()`，把规则想用的渠道降级到这个人实际可达的渠道，顺序 电话 > 私信 > 邮件（按「能不能当场把事办了」排，私信在 ME 里能直接回，邮件目前只能批量发）。三样都没有 → 老实给 `none`，不瞎推一个。已排除的人仍然是「不联系」。两个读模型（`/crm/today`、`/crm/contacts`）各自把 `hasPhone` / `hasEmail` / `hasMessenger` 如实喂进去；调用方不传这三个字段时保持原判断，不替老调用方猜。看板卡片底部新增一条「怎么联系他」：有号码的直接是可点的 `tel:` 链接，没号码的写明「只能在 Messenger 回他 / 只能发邮件」，不用点进抽屉才知道。

**字号**：卡片姓名 13→16px、理由 11→14px、等待时长与阶段 10→12/13px，列头 11→14px、批次说明 10→12px，改阶段提议与批量邮件区一并放大；列宽 230→260px 承接更大的字。

10 个新测试（`segments` 51 全过 / CRM 相关 281 全过），`reachableChannel` 做过 4 次变异测试（不降级 / 把「没提供信息」当「联系不上」 / 降级顺序倒置 / 已排除的人也参与降级），4 次全部被测试逮住。**无 migration。**

### 2026-08-02（PM 反馈：客人页面可读性差 —— 两个真 bug + 一次行业收口）

**背景**：PM 在 CTS（旅游）打开「我的客人」页，看到「按房子分开列」和「打开了《 (copy 01)》」，反馈可读性差、日期看不到。查明这一页是 PR #721 为**地产中介手机端**做的，跟 `/crm`（PM 原来用的 prospecting 式看板）**并存**，不是替换 —— `/crm` 一行没改。

**修 1 · 行业收口**：`/contacts` 读接口新增 `applicable`。判据 = 行业是 `real_estate` **或**已录了房子；两者都不是（CTS：旅游 + 0 套房）→ 页面不铺那一屏地产 UI，直接指回「客户跟进」。用「或」而不是只看行业，是为了不因为 FDE 漏填配置就锁掉真在用的客户。页头的「按房子分开列」也改成只在真有房子时才出现。导航入口保持不变 —— 跟「行程单」「房子」同一口径：入口都在，页面自己说清楚适不适用。

**修 2 · 邮件在时间线上叫什么**：`campaignLabel()` 改成**主题优先于内部名**（主题是客户看到的那行字，内部名是运营标签），去掉 Mailchimp 的合并标记 `*|FNAME|*`，并把 `(copy 01)` / `(未命名)` / `copy of …` 这类内部垃圾判为无效。存量 195 条「《 (copy 01)》」已用 SQL 改成中性说法。metadata 补存 `email_campaign_subject`。

9 个新测试，304 个相关测试全过；两处判据做过变异测试。**无 migration。**

### 2026-08-02（P0：邮件「打开」冒充「客户回话了」，把最高优先桶从 15 撑到 200）

**事故**：当天打开邮件反应同步后，`segmentContact` 把「打开了邮件」当成了「客户回话了」。规则 2 只看 `direction`、**不看这条触点是不是真人消息**，而邮件打开是以 `inbound` 写入的。实测最高优先桶 15 人 → **200 人**，其中 185 人只是打开过邮件、175 人连链接都没点 —— 15 个真在等回复的客户被埋掉。Apple 隐私保护还会替用户自动打开邮件，所以「打开」连「他看过」都不能证明。

**这个坑三孤岛方案里被明确警告过**（「opens/clicks 不写触点 —— segmentContact 不读 channel」），当时的结论是「干脆别写」；本次改成**写但分开算**，因为「谁点了行程链接」正是最值钱的销售信号，不该为了避坑丢掉。

**修复**：`TouchpointLike` 新增 `engagement: 'open' | 'click' | null`；行为信号不参与 `lastInbound / lastOutbound / lastAny` —— 既不能升进「客户回话了」，也不该把「等了几天」重置。判据 `engagementFromMetadata()` 导出给两个读模型共用，避免同一个人在两页属于不同桶。

**顺带把信号变成产能**：新增段位 `clicked_link`「看了行程，还没人跟」（warm，优先级 5，排在新客人之后、打过没人接之前）。条件：60 天内点过链接 **且那之后没有真人联系过**。另外在「以后才走」分支前拦一道 —— 说过明年走但刚点了链接的人，会被捞回名单而不是埋进培育桶。CTS 命中 44 人，其中 14 人从没被打过电话。

11 个新测试，370 个 crm/messenger/timeline 测试全过；四处护栏做过变异测试（其中「把打开当点击」一开始没被抓到，补测后才抓住）。**无 migration**。

### 2026-08-01（CRM 聚合体检 + 邮件反应同步终于接上）

**体检结论**：三条定时任务（私信 / 表单 / 需求卡）12 小时跑满 12 次、零失败零报错。CTS 485 人 / 1471 条往来记录 / 460 段对话；Roman HU 50 人 / 82 条 / 51 段。空壳联系人 0。挂不上人的 16 段对话**全部是「客户一句话没说」的纯群发线程** —— 护栏在正确工作，不是漏。

**发现并修复**：`mailchimp-activity-sync`（PR #686 写好的邮件反应同步）**从来没被注册进 render.yaml，一次都没跑过** —— 销售看不到「谁打开了邮件、谁点了行程链接」，只能按「我们打没打过他」排序。本次注册为 `mailchimp-activity-daily`（每天 04:40 UTC）。

**密钥改用 `fromGroup: me-shared-cron-secret` 自动挂**，不再 `sync: false` 手挂：手挂是本仓反复踩的坑 —— meta-leads-hourly 上线当天因手打值与接口对不上，连续两小时 401、零运行记录；更早还有一条 cron 因此哑了 51 天。

**仍需一次点击**：CTS 的 `leads_config.mailchimp_enabled` 默认关闭，要在客户设置页打开（UI 已存在 `LeadsConfigPanel`，不需要碰数据库）。

**体检暴露的另外两个缺口（未修）**：①info@ 邮箱仍无连接器，7/29 那 20 条是手动灌的；②广告归因覆盖率仅 7%（私信来的人拿不到广告归因，Meta 读接口不给）。

### 2026-07-31（SEO 盯梢复活三连修 [22.E.S14] · PR #709）

盯梢体系立项（PM 盘问拍板四决定）后先修断的：①巡逻取历史快照的 60 行扫描 bug——Oztop 词多超限永远看不到上次排名，下跌规则失明（魏征审出）②DataForSEO 难度值解析漏一层字段，全库恒空，机会规则前提永不成立 ③网站体检 cron 把「空」当字面文字传库，连崩 14 天 ④零发现时清掉客户陈旧 fresh 建议（CTS 7/1 的躺了一个月）。S15-S18（内链收录采集 / 每周 blog / CTS 执行手 / 周报）按序推进。

### 2026-07-31（治本：私信建人前先「唯一全名认亲」· PM 反馈重名）

**问题**：PM 反馈「CRM 里有大量重名的」。根因是同一个人被拆成两条 —— 先填 Facebook 表单（留电话邮箱、**没有 psid**），后来又来私信（有 psid、**没有邮箱**），两边没有任何共同的键。CTS 实测 132 个只有 Facebook 身份的人里 **29 个**是这么拆出来的。

**方案（治本优先，不是做个页面让人点）**：认人从两级变三级 —— ①身份键（psid / 正文邮箱）②**唯一全名** ③新建。第 2 级三条同时满足才认：完整姓名（≥2 词、非占位符）+ 全库唯一同名 + 对方身上还没有 fb_psid；任一不满足即弃权，照旧独立建人。实测规则在 CTS 上命中 29、模糊案例 **0**。

**为什么不触碰 identity.ts 的红线**：那条红线禁的是「把两个**已存在**的人按姓名合成一个」（两份历史永久搅在一起、不可逆）。这里是「给一个已存在的人**多挂一个身份**」，什么都没销毁，认错了摘掉那条 fb_psid 即可复原。

**顺带修**：Meta 的占位名「Facebook 用户」不再当人名存（存 null）。它正好是两个词、能通过词数检查 —— 不单独挡掉的话，CTS 那 14 个互不相干的「Facebook 用户」会互相认亲、并到同一个人身上。

7 个新测试，284 个 crm/messenger/timeline 测试全过；三条护栏（占位符 / 唯一性 / 对方已有 psid）各做过变异测试。**无 migration**。存量那 29 对另行清理（不可逆，需 PM 过目后执行）。

### 2026-07-31（CRM 往来记录改成正序 · PM 反馈）

**问题**：PM 反馈「CRM 里的聊天记录是倒序排列的，阅读体验不佳」。时间线原本「最新在上」，但这条线里混着私信原文 —— 倒序会把一段对话的**回答排在提问前面**，一问一答读起来是反的。

**修复**：`GET /crm/contacts/[cid]/timeline` 的合并排序改成从旧到新（最新在最下面），跟聊天软件一致；抽屉顶部仍是人的基本信息，对话往下延伸。

**没跟着改的地方（关键）**：取 `conversation_messages` 时的 `ascending: false` + `limit(3000)` **保持不变** —— 那个倒序是为了超量时留下**最近**的 3000 条，一起改成正序会变成只留最老的，话痨客户的近期对话全丢。排序只在合并那一行做。3 个新测试钉住这两件事，并做过变异测试。

### 2026-07-31（补挂积压的历史私信对话 [P28]）

**问题**：「按 psid 建人」上线后，PM 拿手机 Business Suite 收件箱核对 —— 8 个人只有当天还在说话的 3 个进了 CRM，昨天聊完的 5 个全在系统外。根因：每小时同步只向 Meta 要「最近有更新的」线程（水位线），早就聊完的老对话永远等不到一次重新处理。CTS 积压 149 条。

**修复**：`src/lib/messenger/backfill.ts` —— 这些对话的正文早就存在 `conversations` + `conversation_messages` 里，补挂**不用再问 Meta 要一次**：读本地表、走同一套 `linkMessengerConversation`，护栏自动适用。挂在每小时同步尾巴上，每轮 50 条自愈式消化，无新 cron、无新密钥、无人工。

**关键正确性坑**：`conversation_messages` **没存 Meta 的 tags**，所以补挂时分不出「真人客服回的」和「Business AI 自动回的」（CTS 收件箱满屏 `FB AI responding`）。照写出站触点 = 把机器人问候当「我们联系过」，热线索直接掉出「今天该联系谁」。故新增 `tagsAvailable` 开关，补挂时**一条出站触点都不写** —— 按 automation.ts 头部写明的取舍，宁可让人多露一次面。

6 个新测试（含该护栏的变异测试），274 个 crm/messenger 测试全过。**无 migration**。

### 2026-07-30（只在 Facebook 私信聊过的人也进 CRM [P28]）

**问题**：Messenger 对话每小时自动同步（CTS 458 段，活的），但**人进不来** —— 151 段挂不到任何联系人，其中 130 段是有来有回的真人；最近 3 天有新消息的 24 段里 22 段是系统看不见的人。这些人永远不出现在「今天该联系谁」。

**根因不是 bug，是当初焊死的规则**：`link-contacts.ts` 原本「只 LINK 绝不 CREATE」，因为 Meta 自动回复会把 CTS 自家 info@ / 电话写进对话正文，从正文抽联系方式建人会造出假的「info@ 客户」并错并几十段对话。

**修复**：那条理由针对的是「**从正文正则抽出来的**联系方式」，不是建人本身。所以只开一个口子 —— **建人只用 fb_psid**（Meta 在 participants 里给的唯一编号），原坑结构上进不来。两条护栏同时焊死：①客户自己开过口（线程至少一条 inbound）才建人 ②建人只带 fb_psid 一个身份 → `resolveContact` 最多命中一个既有联系人，**结构上不可能触发两个真人的不可逆合并**（这正是本模块原来绕开 resolveContact 的风险）。

建出来的人只有 Facebook 身份、无电话邮箱，销售只能在 Messenger 回；日后他留了邮箱/电话靠唯一约束自动并成一条。cron 返回值新增 `newContacts`（今天私信带进来几个新人）。**无 migration**。4 个新测试 + 268 个 crm/messenger 测试全过；两条护栏 + 「只用 psid 建人」做过变异测试。

### 2026-07-30（Facebook 表单的新人自动进 CRM [P28]）

**问题**：FB 即时表单来的人只能靠人手导 CSV 跑 `scripts/import-cts-fb-leads.ts`（脚本头部自己写着「不是长期管道」）。实测后果：CTS 的 CRM 里最后一个新人停在 7/25，Meta 后台 7/26–7/30 又进了 27 个人，销售的「今天该联系谁」里一个都没有，广告每天仍在花 NZ$78–85。

**修复**：补上「取数 → 建人 → 写触点」这条链 —— `lib/meta/lead-forms.ts`（Graph 只读）+ `lib/crm/meta-lead.ts`（复用 `resolveContact`）+ `lib/meta/leads-sync.ts`（按客户编排 + 水位线）+ `api/cron/meta-leads-sync`，render.yaml 注册 `meta-leads-hourly`（每小时第 25 分，岔开私信同步避 Meta 限流）。开关沿用 `clients.facebook_page_id`。

**无 migration**：`channel='meta_lead_form'` 与 `(client_id, source, source_ref)` 唯一键都已存在。幂等键跟人手导入脚本对齐（都是 Meta 的 lead id），首次回补不会把 7/26 已导的 335 人写成第二份。33 新测试 + 368 个 crm/meta/messenger 测试全过，三处关键校验做过变异测试。

**上线还需 PM 一步**：Render 上给这个 cron link `me-shared-cron-secret` 环境变量组；Page token 若缺 `leads_retrieval` 权限，cron 日志会把 Graph 原话报出来。


### 2026-07-06（Phase 35 司马徽 Outbound Prospecting M1+M2 落地 [P35.1-P35.4]）

ME 自己的获客管线前三步上线（内部销售工具）：DataForSEO Business Listings 批量发现（18 行业 × AU/NZ 12 城）→ 零 AI 规则审计（tracking 检测 + OnPage instant，~$0.005/家）→ 规则机会分（强生意 × 弱数字地基）。新表 `outbound_prospects`（migration 待 PM apply）+ 3 个 admin API。17 新单测全过。定价阶梯与退款保证 PM 已拍板（见 Phase 35 章节）。

### 2026-06-12（keyword gap 排除品类词 — Oztop shutters/blinds 误命中修复 [P12.I.BF1]）

**问题**：Oztop Building Supplies 跑 keyword gap，返回 100 个词全是 shutters/blinds/windows 主题（27.1K 月搜/条），但 Oztop master_brief 明确不卖这类。根因：`BUILDING_SUPPLIES_TERMS` 通用词表含 shutter/blind/curtain，当 domain/industry hint 含 flooring/oztop 时整张表启用 → 这些词被当 business-relevant → 100 slot 被顶满。影响所有「卖部分建材类别但不卖全部」的客户。

**修复**（从 PR #460 重切干净版 —— 原分支漂移成 78 文件/+4718，本 PR 只取真实 7 文件 +417/-3）：
- `isBusinessRelevantKeyword` 加可选 `excludedTopics: string[]`（默认 `[]`，向后完全兼容），**排除检查在 business-relevance 之前运行**（同时在 businessTerms + excludedTopics 的词被拦截）
- 新增 `extractExcludedTopics(brief)` 从 `master_briefs.excluded_topics` 读取
- `competitors-gap` route 接线传 excludedTopics
- 新增 `/api/clients/[id]/excluded-topics` GET/PATCH + `ExcludedTopicsPanel`（Settings 页，FDE 可视化填，不进 Supabase Studio —— 符合「配置类必有 UI」强约束）
- Migration `20260611000001_master_briefs_excluded_topics.sql`：单列 `ADD COLUMN IF NOT EXISTS`，**⚠️ 待 PM apply**

**验证**：keyword-relevance 13/13；build ✅（147/147）。基于最新 main 重切，无分支漂移。

**待 PM**：①apply migration ②Settings 页给 Oztop 填 `shutter,blind,curtain,plantation,window treatment` → 重跑 keyword gap 验证出真实 flooring 业务词。

---

### 2026-06-11（isBrandQueryMatch 短 alias 误报修复 — brand_search_volume GSC 路径）

**问题**：A2.2（PR #336）的 `isBrandQueryMatch`（`brand_search_volume` Goal 主指标的 GSC 品牌词 clicks 聚合）用裸 substring `q.includes(alias)` 匹配，短 alias（如 `"cts"`）会把普通 GSC query `products review` / `facts about nz` 误判为品牌搜索 → 虚高 `brand_search_volume`。

**来源**：#454（Branded vs Non-Branded 卡片）魏征复审时指出 `isBrandQueryMatch` 有同款缺陷（与卡片侧同源），当时只修了卡片侧，本次补修 GSC volume 侧。

**修复**（分两条路径，PR #457 Codex 复审后定稿）：
- **brand_aliases 路径** → **word-boundary**（`\bneedle\b`）：人工策划词，短 alias `"cts"` 命中 `cts` / `cts tours` / `book cts` 但不命中 `products` / `facts`（修 魏征 关切）。
- **brandRoot 路径** → **保留 substring**：域名根是拼接型长 token，必须能命中拼接品牌词（`ctstours` 命中 `ctstoursnz`）—— Codex 指出一刀切 word-boundary 会漏这类，对无 alias 客户造成 `brand_search_volume` 回归。brandRoot 永远是长拼接根，substring 误报风险可忽略。

alias matcher 与 #454 intent-strategy 同源（注释点明有意复制，避免把 server 端 strategy 代码引入客户端 bundle）。

**验证**：`isBrandQueryMatch` 单测全过（新增 2 组：5 个短 alias 误报反例 + 整词命中正例）；seo-intelligence + auto-fetch-ai-visibility 43/43；build ✅（147/147）。

> ⚠️ 同文件 `autoFetchMetricValue` 有 4 个**预存失败**（`result.source` 期望 `'GSC'` 实为 `'auto.gsc_brand_clicks'` 大小写不一致），与本修复无关（merged base 上即失败），未触碰，待单独处理。

---

### 2026-06-11（Branded vs Non-Branded 识别接入 brand_aliases — P12.I.10 bug fix）

**问题**：SEO Intelligence 页 "Branded vs Non-Branded Traffic" 卡片（P12.I.10）对 CTS / Oztop 显示 Branded 0% / Non-Branded 100%，但 GSC 真实数据 CTS 28 天 ~24% / Oztop ~31% 来自品牌词点击。

**根因**：branded 识别（前端 `buildBrandTrafficSplit` 等）只用域名根 token-equality（`isBrandedKeyword(keyword, "ctstours")`），多词品牌词 "cts tours" 拆 ["cts","tours"] 没有 token 等于 "ctstours" → 全判 non-branded。与 A2.2（PR #336）brand_search_volume 当年踩的是同一个坑，但当时只修了 GSC volume 路径，没修这张卡片。

**修复**（复用 PR #336 substring + brand_aliases 模式）：
- 新增 `isBrandedKeywordWithAliases(keyword, brandRoot, brandAliases?)` wrapper：substring 匹配 `clients.brand_aliases` + fallback 到原 `isBrandedKeyword`（token-equality）。**`isBrandedKeyword` 保留不动**（CLAUDE.md 强约束，不污染通用函数；其他调用方如 seo-agent/assembler 零改动）
- `buildBrandTrafficSplit` / `prioritizeContentKeywords` / `sortByIntentPriority` 加可选 `brandAliases` 参数（向后兼容）
- 后端 `rankings/route.ts` select + 返回 `brand_aliases`（live + snapshot 两路径）
- 前端串 brand_aliases 进卡片 + 品牌词过滤器（卡片与过滤器现在用同一 matcher，修掉旧的不一致）

**验证**：intent-strategy 10/10（新增 5 个：CTS/Oztop 真实样本 + 反例 china tours / flooring brisbane + 无-alias 无回归）；seo-intelligence lib 35/35；build ✅

**待 PM 端到端验证**：CTS/Oztop 填好 brand_aliases（SOP `docs/sops/brand-aliases-setup-for-gsc.md`）+ 等 Render 部署（rankings 缓存 24h）→ 卡片 Branded 应显示 ≈ 24% / ≈ 31%（无需 migration，brand_aliases 字段已存在）

---

### 2026-06-08（⭐ DAPE 核心引擎 v0.2 上线 — Week 1+2+3 全部 merged production）

**一句话**：ME 核心引擎从 GIMPT (11 层堆叠) 改为 **DAPE = Discovery / Analysis / Prescription / Execution** 4 段循环 + AI 贯穿 + 6 大支柱矩阵。AI 学习闭环真正接通，FDE/客户首次能在 production 看到「AI 当参谋」效果。

**触发**：PM 飞毛腿测试 F4 (Prescription) 时灵魂三问 "20 年 CMO 会这么用吗？AI 在哪？6 支柱在哪？" → 5-agent (子牙/板桥/魏征/狄仁杰/诸葛亮) live 复审 + brainstorm 5 议题 → 出 [DAPE spec v0.2](../specs/2026-06-08-me-dape-redefine-v0.2.md)（949 行）→ 5 并行 worker 通宵实施 → 2 P0 hotfix → 上线。

**实施成果**（17 PR / 6126+ 行代码）：

| PR | 主题 | 关键 |
|---|---|---|
| #428 | DAPE v0.2 spec | 949 行, 5-agent 签字 |
| #430 | W1 huatuo memory 接通 | client_learned_preferences + zhuge_feedback + prescription_outcomes + 短/长双模 prompt, 19 测试 |
| #432 | W2 zhuge memory 接通 | industry_benchmarks + zhuge_feedback + 双模 + deterministic 安全网, 119 测试 |
| #433 | W3 narrative + cron | huatuo 输出 narrative + agent-learning-rollup 每周 Mon 07:00 UTC, 68 测试 |
| #434 | W5 E 段 prescription_id + AI 推荐 | execution_items.prescription_id 字段, Kanban 顶部「AI 推荐今天做 3 件」短模 0 MTC, 111 zhuge 测试 + 52 新 |
| #435 | W4 P 段 Goal 一对一 | prescriptions.goal_id + version + Initiative 派生, 处方页 Step 1 Goal selector, 阶段动态 N (不再写死 12 周), 20 新测试 |
| #439 | P0 hotfix Kanban superseded | STATUS_META + statusMetaOf fallback (W5 schema 加 status='superseded' 但前端 type 没跟，5 新测试) |
| #440 | P0 hotfix prescription/new step1 | latest-draft API 不再自动恢复 approved 处方进 Step 3 (前端 guard 12 新测试) |

**Schema 改动（最小路径）**：
- `execution_items.prescription_id` 字段 (放松 source_consistency CHECK，让 zhuge/luban/proactive_signal/fde 可选填 prescription_id，partial index for Kanban filter)
- `prescriptions.goal_id` + `prescriptions.version` (Goal 一对一 + 版本化)
- W5 migration `20260628000001_dape_w5_execution_prescription_link` apply 后 backfill CTS 7 zhuge orphan 行 → prescription_id

**业务保护验证（PM 强约束 0 影响）**：
- ✅ self-serve 注册漏斗 + MTC 8 API 不动
- ✅ CTS 96 卡片 / Oztop 92 卡片 0 影响
- ✅ CTS 4 active goals current_value 不动 (NULL / 468 / 156)
- ✅ RLS service_role 模板严守 (CLAUDE.md 强约束)
- ✅ Render 自动 deploy 完成, production 实测 4 个 UI 改动全生效 (诊断 narrative / Kanban AI 推荐 3 件 / prescription chip / Goal selector)

**双轨业务 (PM 6 底线锁定)**：
- self-serve 自助客户：`/portal/register` → 自助 wizard → 全程 MTC
- FDE 月付客户：签约 → 后台代配 → 月付套餐
- 共用 DAPE 4 段 + 四视角分层 + 双模 prompt

**飞毛腿测试关闭** (F1-F5 跑完, F6+F7 PM 跳过):
- 飞毛腿主文档 `docs/feimaotui-test/FEIMAOTUI.md`
- 30+ Bug 池, 战略级 BUG-FMT-CORE-1 触发本 DAPE 改造
- 子牙今天 9 次失误 (4 次独裁 / 1 次误删 PR 分支 / 2 次审 PR 漏 type drift / 1 次相信 worker 误报 / 1 次话多) — 全部透明记录在 [FEIMAOTUI-FINAL-OVERNIGHT-2026-06-08.md](../archive/feimaotui-test/FEIMAOTUI-FINAL-OVERNIGHT-2026-06-08.md)

**沉淀进 CLAUDE.md 顶部强约束** (5 条 DAPE 改造硬约束):
1. migration 必 PM 拍板, worker 严禁自行 apply
2. 加 enum 新值必同步前端 type + UI fallback (superseded 教训)
3. 删 PR 分支前必 verify state=MERGED (PR #410/#415 教训)
4. worker 报"已 apply"必 SQL 验证 schema_migrations
5. 大改动必 5-agent live 复审

**Phase 编号说明**: DAPE 不是新 Phase，是**核心引擎重定义**。后续 Phase 35+ 都基于 DAPE 4 段框架展开，不再用 GIMPT 11 层。Week 4+ 计划：双轨业务串通测试 + 客户视角 mockup 验证 + 司马徽 (Discovery agent) 新建。

**关联文档**：
- [DAPE spec v0.2](../specs/2026-06-08-me-dape-redefine-v0.2.md) (PM × 5-agent 签字)
- [飞毛腿 Bug 池](../archive/feimaotui-test/FEIMAOTUI.md) (30+ Bug 含 BUG-FMT-CORE-1 战略级)
- [W4 backfill SQL](../migrations-sql/dape-w4-backfill-prescription-goal-id.sql) + [W5 backfill SOP](../sops/dape-w5-execution-prescription-id-backfill.md)
- [overnight final report](../archive/feimaotui-test/FEIMAOTUI-FINAL-OVERNIGHT-2026-06-08.md)

---

### 2026-06-05（Phase 34 — Client MCP Server 设计→实现 P34.0–P34.5 ✅ PR #369）

**一句话**：客户能在自己的 Claude 里凭 API Key 只读查询「自己的」ME 数据（体检分 / 目标进度 / 搜索表现 / 执行进度 / 内容交付），强隔离、限流、不暴露供应商真名。

**链路**：设计稿 v3（魏征+子牙双审）→ Phase 34 登记 → P34.0 transport spike（mcp-handler + Streamable HTTP 套进 Next.js App Router，stateless JSON）→ P34.1 鉴权地基（client_api_keys + mcp_access_log 两表 + verifyApiKey + withMcpAuth）→ P34.2 Key 管理 API + 设置页 §3 UI（FDE 签发/吊销，魏征安全加固）→ P34.3+P34.4 scoped-queries 最里层隔离 + 5 只读 tool → P34.5 封装名过滤 + 限流 + 接入 SOP。

**安全护城河**：client_id 双层锁定（外层 API Key 反查 / 内层 scoped-queries 闭包绑定强制 `.eq('client_id')`），满足「校验放最里层」；admin-only 签发 + CSRF + 软删除吊销 + 60/min 限流 + 封装名过滤。

**验证**：91 单测全过（鉴权 35 + 管理路由 26 + 隔离 11 + 封装名 14 + 限流 5）+ `npm run build` ✓。⏳ 真实数据 HTTP e2e 待 CF 预览（本 dev 容器 Supabase network allowlist 连不上数据 API）。

**关联文档**：设计稿 `docs/specs/me-mcp-server-design.md` · 鉴权笔记 `me-mcp-p34-1-auth-notes.md` · 客户接入 SOP `docs/sops/mcp-client-access-setup.md` · Migration `20260627000001_p34_mcp_api_keys.sql`

---

### 2026-06-05（CTS/Oztop Goal-Initiative-Campaign 业务架构对齐 + FDE SOP 落地）

**触发**：PM 在 ME 后台尝试给 CTS 建第一个真实跑通的 Goal（M1：organic_traffic auto-fetch 验证），过程中暴露三层问题：

1. **指标错配**：CTS/Oztop 各 3 个 active Goal，主指标全是 ME 读不到的（orders_count / monthly_revenue / inventory_units / placeholder）→ current_value 永远空
2. **Initiative 孤儿**：3 个真活儿 initiative（带预算 / 带 hypothesis）全挂在已 archived 的旧 Goal 上 → 战略动作无家可归
3. **Campaign 野生**：Oztop 「Elegant Walnut Clearance」campaign（38 social post + 3 plan + 2 package 在跑）无 initiative 引用 → 5 层执行链路（153 execution_items / 83 social_plans）跟新 Goal 体系**完全断开**

**最初的盲点**：先尝试简单"调整 Goal 指标"，PM 两个犀利质问揭出真相 —— Q1「3 个 Goal 对应的 Initiative 呢？」+ Q2「所有 Goal 都流量/可见度，真正推广在哪里？」。摸完发现 marketing_plan / campaign 5 层骨架完整还在跑，只是"换头"（旧 Goal archive 了、新 Goal 还没接进去）。

**11 处 DB 调整**（完整业务架构对齐）：

1. archive 3 个错配 Goal（CTS新西兰曝光重复 / CTS ME营销Wave1 orders 空 / OZTop电商获客5w revenue 空）
2. 改 active 1 个（Oztop Brisbane品牌曝光，从 draft → active）
3. 新建 4 个指标对的 Goal（CTS AI 可见度 / Oztop 自然流量 / CTS 2026 团报名 leads_count / Oztop Walnut 清仓 monthly_revenue 手填）
4. 新建 2 个 initiative（Oztop Walnut 清仓社媒推广 / CTS 2027 Silk Road 提前蓄水）
5. 改 3 个旧 initiative 的 goal_id（CTS Ads / CTS SEO-Visa / Oztop SEO Phase 1 重新归属到指标对的新 Goal）
6. 改 2 个 initiative 的 campaign_ids（修正 2026 Ads 误挂 Silk Road campaign 的错误 + SEO-Visa 通用流量不绑团）
7. 改 1 个 Goal title（CTS 团报名询盘 → CTS 2026 Best of China 团报名，明确战线）

**最终架构 — CTS 4 active Goal + 2 条独立战线**：

- 🟦 **2026 Best of China 战线**：Goal「2026 团报名 leads_count」→ Initiative「Facebook + Google Ads — Oct 2026 Tours (fast/70%)」→ Campaign「Oct 2026 Spotlight — Three Tours」（36 social / 2 plan / 2 package）
- 🟨 **2027 Silk Road 战线**：Goal「CTS 品牌搜索量提升 brand_search_volume 166」→ Initiative「2027 Silk Road 提前蓄水 (slow)」→ Campaign「Silk Road Discovery」（8 social / 2 plan / 2 package）
- 🟩 **通用流量蓄水**：Goal「CTS 自然流增长 organic_traffic 525」→ Initiative「SEO + Content — China Visa-Free Travel NZ (slow/20%)」（不挂 campaign，因通用入口）
- ⚪ **AI 可见度战场**：Goal「CTS AI 可见度提升 ai_visibility_score」→ 待挂 initiative

**Oztop 4 active Goal**：
- Oztop 自然流增长 organic_traffic 402 → SEO Phase 1 Brisbane Flooring
- Brisbane品牌曝光 brand_search_volume 48 → 待挂
- Oztop AI 可见度提升 → 待挂
- Oztop Walnut 地板清仓 monthly_revenue 手填 → Walnut 清仓社媒推广 initiative → Elegant Walnut Clearance campaign（38 social）

**SOP 落地**：[`docs/sops/goal-initiative-campaign-setup-for-fde.md`](../sops/goal-initiative-campaign-setup-for-fde.md) —— 从今晚真实业务调整中淬出的 FDE 标准操作指南，含三层模型 / 指标白名单 / 战线拆分原则 / 错误自查清单 / CTS 真实案例参考。**未来 FDE onboarding 新客户或对齐老客户 Goal 体系时必读。**

**发现的产品 bug（已记录待修，未在本次动）**：
- Goal 向导 Step 2「精确匹配吃掉通用候选」过滤逻辑 bug —— 当 sub-type 被某个 metric 精确匹配时，会屏蔽 organic_traffic 等通用指标。临时绕过：sub-type 选「地理扩张」走 fallback。修法（未做）：把过滤改成「精确 + 通用 的并集」。

**验证**：
- M1 端到端：CTS organic_traffic Goal active 后，current_value=525 自动填，标签「GA4 (28-day sessions)」
- DB 全景验证：8 active Goal，4 个挂上真活儿 initiative，3 条挂上 campaign（含 44 个 CTS social + 38 个 Oztop social 正确归属到 Goal 体系）

---

### 2026-06-05（🚨 Schema 漂移事故修复 — PR #365 ✅ 13 处缺失对象补齐）

**触发**：PM 排查「Oztop 关键词排名为何 0 条」，实测线上 `keyword-snapshots-weekly` cron，发现**全部 19 个客户**报 `local_pack_rank column not found`。

**深挖根因**（审计 134 个 migration 文件 vs 生产 DB 实际表结构）：
- 表面：`keyword_snapshots` 缺 `local_pack_rank` 列
- 真相：**13 处 schema 漂移**（9 表未建 + 4 列缺失），不是单点 bug
- **机制**：一批早期 migration 的 `CREATE POLICY` 引用了**从未实现的多租户模型**——`clients.workspace_id`（不存在）和 `client_team` 表（不存在）。Postgres apply 时炸在 policy 步骤、**整个事务回滚**，所以表/列从未建成（尽管 .sql 文件在代码仓里）

**影响的真实功能**：
- 关键词排名追踪（**全 19 客户瘫痪**，含 CTS + Oztop）
- 月报聚合（`datasource_monthly_reports` ×3 表不存在）
- 案例库 + 处方 KPI 回流（`prescription_cases` / `prescription_outcomes`）
- 华佗诊断叙事层（`diagnostic_narratives`）
- 落地页线索埋点（`website_lead_events`）
- 本地 SERP 历史（`local_ranking_history`）

**修复**（PR #365 → main，migration `20260626000001_backfill_drifted_schema.sql` 已 apply 生产）：
- 6 列：`keyword_snapshots.local_pack_rank` / `clients.contact_name+email+phone` / `blog_posts.geo_directive_version_id` / `client_site_pages.search_vector`
- 9 表：`website_lead_events` / `prescription_cases` / `prescription_outcomes` / `local_data_cache` / `datasource_monthly_reports` ×3 / `diagnostic_narratives` / `local_ranking_history`
- RLS 全部替换为 `service_role_full USING(true)`（ME 真实访问模型）

**验证**：13 处 `exists_now=true`；DB 模拟 keyword cron 写入 `local_pack_rank=2` 成功；**PM 重 curl cron 实测**：error 字段全消失，Oztop **95 keywords_seen + 95 snapshots_written**、CTS 32/32、全 19 客户排名追踪复活

**防复发规则已写入 CLAUDE.md § 开发约定**（强约束⭐⭐）：新 migration RLS 一律用 service-role 模板，禁止引用 `workspace_id`/`client_team`/`auth.uid()`/`auth.jwt()`；写完必须 grep 检查

---

### 2026-06-04（A2.2 brand_search_volume GSC 接入 — PR #336 ✅ ⭐ 含 P0 fix）

**核心**：Goal 主指标 `brand_search_volume` 从 DataForSEO 估算升级为 GSC 真实 28-day 品牌词 clicks。这是 A2 系列（Goal current_value auto-fetch）第 2 条数据源接通。

**两层解析**：
- **Tier 1（PRIMARY）**：GSC `gsc_performance_snapshots` 最新一行 top_queries → `isBrandQueryMatch(query, brandRoot, brand_aliases)` 过滤 → sum clicks
- **Tier 2（FALLBACK）**：DataForSEO `bulkKeywordVolume` live（GSC 无数据时兜底）

**P0 修复（live-data audit 触发，已合并）**：
- 第一版用 `isBrandedKeyword`（token equality），audit CTS Tours NZ 真实 GSC 数据发现致命缺陷：
  - CTS top queries 全是 "cts tours" (127 clicks) / "china travel service nz" (21) / "cts travel" (13) — 多词形式
  - token equality 把 "cts tours" 拆 ["cts","tours"]，没有 token 等于 "ctstours" → CTS 会显示 ~5 而非 ~166
- 修复：加 `clients.brand_aliases TEXT[]` 字段 + 新写 `isBrandQueryMatch` (substring + case-insensitive)
- `isBrandedKeyword` 保留不动（SEO Intelligence 用法 token equality 是对的）

**调研发现的福利**（原估 ~10h，实际 ~3h）：GSC OAuth / FDE 连 GSC UI / Daily cron / 数据表全部已存在。A2.2 实质 = 最后一公里 + P0 修复。

**验证**：17/17 单元测试通过（含 CTS 真实数据回归）/ strategy lib 全套 114/114 / SQL 推演：CTS 166 brand clicks / Oztop 48 brand clicks

**关联文档**：SOP `docs/sops/brand-aliases-setup-for-gsc.md`（FDE 操作手册）+ Migration `20260624010000_client_brand_aliases.sql`

**待 PM 端到端验证**：CTS 新建 Goal 主指标=brand_search_volume + 填 brand_aliases → 看 Goal 详情页主指标卡显示 ~166

---

### 2026-06-04（Kanban Content Workbench UX 4 连击 — PR #327 ✅）

**痛点**：FDE 最高频用的内容生成工作台 — ①点击 3 次以上才能生成 ②看板看不到进度 ③prompt 编辑区太小 ④白等几分钟卡片回退

**根因（子牙 + 魏征双审）**：drawer 整页 spinner / 内存 Set 不持久 / `<input>` 单行且仅 batch 模式 / catch 完全吞错 + 🔥 **CRITICAL bonus**：生产中 `page.tsx:2066` 调用不存在 GET endpoint 把 completed item 拉回 in_progress

**修复（8 commits）**：Migration `generation_started_at/error` + handleBackgroundGenerate 三阶段状态机 + useRef 同步去重 + 卡片三态（制作中/失败/超时）+ 砍整页 spinner + 任务模式 textarea + GET handler 补齐

**验证**：tsc 0 错 / vitest 45/45 / Supabase migration 已 apply

---

### 2026-06-04（Phase 33 P33.9/P33.10 + M4 测试回归通过 ✅）

P33.9（PR #301/#302 — Goal filter 状态 chips 数字跟随）/ P33.10（未归类 Actions 分组）/ M4（PR #304 — Goal 详情页 Execution Progress 卡片 + Initiative 完成率 chip + Campaign 状态点）三项数据层 + UI 层全部回归通过。子牙 review 时修复的 3 个杀手锏 bug 实测无问题。**Phase 33 整体收官**。

---

### 2026-06-04（A2.3 端到端验证 — GA4 generate_lead 闭环打通 ⭐ CTS 真实数据）

**里程碑**：A2 系列（Goal 主指标 auto-fetch）首次端到端跑通 — 不只是代码框架就位，而是**真实客户网站 → GA4 → ME → Goal 详情页**整条链路有真数据流动。

**配置（CTS Tours NZ）**：
- GTM container `GTM-MRW95G5Q` 新增 Workspace Changes:
  - Trigger `CE - form_submit (any form on site)` 监听 GA4 Enhanced Measurement 的 `form_submit` event（全站全表单覆盖，不依赖客户开发约定）
  - Google Tag `G-SB9EYP2X1L`（GTM 自动建，Initialization - All Pages）
  - GA4 Event Tag `GA4 - Generate Lead`（Event Name: `generate_lead`，触发 trigger 上）
- Version published as `Add GA4 generate_lead conversion tracking`

**验证证据（Realtime）**：
- GA4 property `532503727` Realtime 报告显示 `generate_lead` event count = 2（PM 真实提交 2 次表单后立即出现）
- 整条链路：网站 form submit → GA4 Enhanced Measurement form_submit → GTM trigger → GA4 Event Tag → property 532503727 → ✅

**后续 24-48h 自动发生**：
- GA4 → Admin → Events 列表会出现 `generate_lead`，PM 标 Mark as key event
- ME 每日 3am UTC cron 拉 ga4_traffic_snapshots → top_sources[].conversions 出现非零值
- Goal 详情页用 `form_submissions` / `leads_count` (hybrid) metric → CurrentValueCell 自动出数

**关联文档**：
- SOP: `docs/sops/ga4-lead-gen-key-event-setup.md`（4 条配置路径 + 验证 + 常见坑）
- SOP: `docs/sops/client-onboarding-access-requirements.md`（Editor 权限要求）
- Code: `src/lib/strategy/auto-fetch.ts` `fetchFormSubmissions()`

**Oztop 待办**：同样跑一遍这套 SOP（预计 15 分钟，PM 已熟练）

---

### 2026-06-03（QA-清理-1 blog→social-suggestions 内部 HTTP 自调用根治 — PR #305 ✅）
**背景**：PR #297（zhangqian/connectors）根治内部 HTTP+Bearer 反模式后，复审发现 `blog/[postId]/route.ts:140` 还有一处同款 — post 审批通过后 fire-and-forget fetch social-suggestions 端点 + Bearer INTERNAL_API_KEY。Render env 缺失时静默 401，社媒建议自动生成「看似在跑实际从未触发」。

**改动（3 个文件）**：
1. **新建** `src/lib/blog/generate-social-suggestions.ts` — 共享 lib + `GenerateSocialSuggestionsError`（携带 status code 404/403/500），完整迁移 5 个守卫
2. **改** `blog/[postId]/route.ts` PATCH — 删 `fetch + Bearer`，改 `void generateSocialSuggestions(...).catch(log)` 同进程直接调用，保留 fire-and-forget + **新增日志**（原代码静默吞错，可观测性提升）
3. **改** `social-suggestions/route.ts` — 收薄成 thin wrapper（170 → 47 行），保留 `requireBearerToken` 供 server-to-server

**测试**：6 tests 全绿（零修改测试即通过 — mock 自然复用证明 lib 隔离干净）

**子牙复审结论**：
- 4 个守卫迁移 → **实际迁了 5 个**（多迁 `rows.length === 0`）
- `.catch` 加日志比 PR #297 原版可观测性更好
- INTERNAL_API_KEY 在 PATCH 链路彻底退役（wrapper 的 token 是设计内保留）
- 无循环依赖、无新 dependency、无 fallback 残留

**Reference**：PR #297 同款手法扩展

### 2026-06-03（A1.5 reputation textsearch 精度修复 — 数据层闭环）
**背景**：A1 reputation 公式 PR #298 merge 后，复审发现 `getBusinessReviews` 用 raw domain 当 textsearch 关键词精度差，CTS 等客户可能查到错的 GBP。

**代码层（前序 merge 已完成，本轮核实）**：
- `src/lib/places/client.ts` — 注释明确「caller MUST pass rich query」
- `src/lib/diagnostic/collectors/reputation-collector.ts` — `ReputationCollectorContext` + `buildQuery()` 拼 `name + city + country`
- `src/lib/diagnostic/runner.ts:156-160` — 把 `client.name / city / country` 传给 collector
- **结论**：runtime 链路完整，A1.5 实际剩余只是数据层缺口

**数据层修复（本轮 SQL UPDATE）**：
| 客户 | city 修复 | country 修复 |
|------|---------|------------|
| CTS Tours NZ | null → Auckland | 保留 NZ |
| Newaisan | null → Auckland | AU → NZ（之前国家错） |
| oztop | "Brisbane, Gold Coast, Sunshine Coast" → Brisbane | 保留 AU |

**预期效果**：
- CTS 重跑诊断后 textsearch 用 `"CTS Tours NZ" Auckland NZ`，找到 Auckland 总部正确 GBP
- A1 公式（PR #298）+ 准确 GBP 数据 → CTS reputation 应从 44 进一步提升到 60+
- 等 2026-06-16 A1 公式合理性 review 时验证

**延后任务（独立登记）**：
- **A1.6** collector 兜底：多城市字符串拆分 + city=null 兜底（覆盖未来新客户）

### 2026-06-03（Phase 33 P33.9/P33.10 双 PR 修复 — PR #301 + #302）
- **PR #301**（早一轮）— P33.9 chips count 跟 dimension+goal filter 走；P33.10 itemsForDimensionGroups 排除 `initiative_id=null`（仅处理 null，未处理 placeholder）；Goal/History 返回按钮统一中文
- **PR #302**（深一层 supersede）— 三处根因彻底修复：
  - `/api/clients/[id]/initiatives` 不再 server-side 过滤 unassigned bucket（让前端区分用 `initiative_type`）
  - 执行看板 `filteredItemsWithoutStatus` 中间结果统一供 chips count + dimension groups 使用（chips/groups 视图一致）
  - P33.10 「未归类」判断扩展为 `initiative_id === null || initiative_type === 'unassigned'`，覆盖 Phase 31 migration 把老 actions 自动绑到 placeholder Initiative 的真实情况
  - PlanGenerator 下拉前端补 `initiative_type !== 'unassigned'` filter（依赖 server 过滤的副作用补上）
- **测试待跑**：CTS 执行看板 Goal filter 激活后 chips 数字变化 + 未归类分组（~52 条）+ bulk-migrate 后从未归类消失

### 2026-06-03（Phase 33 M1-M3 Strategy-Execution Bridge — PR #299）
- **P33.1/P33.2** — DB migration：`initiatives.campaign_ids uuid[]` + `marketing_plans.initiative_id uuid FK`
- **P33.3/P33.4** — TS 类型同步：`InitiativeRow.campaign_ids`、`GeneratePlanRequest.initiative_id`、`ExecutionItem.initiative_id`（Phase 31 DB 有列但 TS 未声明，一并补齐）
- **P33.5/P33.6** — `InitiativeExecutionPanel` 组件：Initiative 卡片展开显示关联 Campaign + add/remove + 「+ 生成 Marketing Plan」按钮
- **P33.7** — `PlanGenerator` 弹窗支持 `initiativeId`/`defaultTitle` props；独立入口新增「所属 Initiative」下拉
- **P33.A** — 新增 `GET /api/clients/[id]/initiatives` 端点（返回 id/title/goal_id，供 Kanban filter + PlanGenerator 下拉使用）
- **P33.8** — Kanban action 卡片加 `◈ Initiative名称` 橙色 badge
- **P33.9** — Kanban 顶部加「按 Goal」filter 行（有 active Goal 才出现）
- **P33.10** — Goal filter 激活时未归类 action 单独显示「未归类 Actions」提示分组
- `InitiativeList` 重构：从直接点开编辑弹窗改为展开/收起模式，展开显示执行面板

### 2026-06-02（QA 测试加固轮 — 6 PR）
背景：6-02 全天 Codex 大规模测试 ME 暴露的存量问题。性质是质量加固 + 反模式根治，非新功能推进。
- **PR #248** — CF AI Gateway 401 修复：所有 OpenAI/Anthropic 调用走 CF Gateway 后缺 `cf-aig-authorization` header，加 `CF_AIG_TOKEN` env 注入 Bearer header
- **PR #270** — Client portal 按钮黑底黑字 + 移动端被隐藏：a:link/visited/hover/focus/active 全部 !important 白色 + 移动端不再 display:none
- **PR #290** — initiatives PATCH 三道闸校验：抽 `validateSupportsInitiativeParent` 共享给 create + update；terminal 不能有 parent / supporting 必须有 parent（unassigned 豁免）/ parent 必须是同 goal 的 terminal
- **PR #293** — outcomeChip + buildExecutionGroups 回归测试 [QA-T1]：13 个 test 覆盖 formatOutcomeLabel 6 种 delta_pct/delta 输出格式、VERDICT_META fallback、buildDimensionGroups autonomous 过滤
- **PR #297** — zhangqian/connectors 内部 HTTP 自调用根治 [QA-T3-rev]：抽 `startAdvancedDiscovery` lib 函数，connect route 删除内部 fetch + Bearer，直接进程内调用，彻底退役这条链路上的 `INTERNAL_API_KEY`
- **commit e699218** — Codex 协作分工规范写入 CLAUDE.md（PM 不分配 Codex 任务，Claude Code 统筹 + 子牙复审 + 决定 merge）
- **取消**：T4 phaseData.ts 误派任务（Claude 派活时引用了旧 session 的过期错误信息，Codex 正确识别现实不符并拒绝瞎改 — 这是 PR #290 撒谎事故后的正确执行方式，Codex 加分）

发现待办：
- `src/app/api/clients/[id]/blog/[postId]/route.ts:140` 还有 1 处同款内部 HTTP+Bearer 反模式（post 审批后 fire-and-forget fetch social-suggestions），待 QA-清理-1 处理
- `@/lib/apify/*` `@/lib/dataforseo/serp` `@/lib/gsc/client` 4 个模块文件缺失，导致 advanced-agent.ts import 断裂，待排查
- tsc 整体红（scripts/p30-*、cms/publish-geo-snippet test mock、CompetitorSnapshotAdapter），历史遗留，待单独 QA 加固轮处理

### 2026-06-02（Website SEO Optimization P29.SEO.18 完成）
- 新 VI 后 SEO/GEO 修复完成：补 AI search crawler robots hints、favicon/OG 资源、中文页 raw HTML 信号、中文站内链接、服务页 Service schema 和社交 meta
- **P29.SEO.21** — favicon 链接加版本号，Cloudflare / 浏览器缓存不再卡住旧 tab icon
- **P21.23** — 诸葛亮反馈事件表已补到线上，Launch Hub 的“待补发”提示不再长时间挂住
- **P21.25** — Phase 21 QA 打印版已整理，当前剩余主问题收敛到 Launch Hub 未消费 `highlight` 上下文

### 2026-06-01（Website SEO Optimization P29.SEO.6 完成）

- **P29.SEO.5** — 首个公开 training landing page 上线：/training 路由、双语培训定位、AU/NZ 本地 CTA、FAQ 和 sitemap 内链全部接通
- **P29.SEO.6** — 训练页补上 proof strip 和 lead path，直接把咨询与邮件入口放到首屏后面

### 2026-06-01（Website SEO Optimization P29.SEO.7 完成）

- **P29.SEO.7** — 训练页 CTA 加上点击记录与 training 来源 handoff，咨询页和邮件 brief 现在都能带着来源进入

### 2026-06-01（Website SEO Optimization P29.SEO.8 完成）

- **P29.SEO.8** — 训练咨询成功态改成专用 thank-you card，下一步不再是通用表单回执

### 2026-06-01（Website SEO Optimization P29.SEO.9 完成）
- 训练与广告线索都接到同一条轻量 contact flow，SEO 收尾和投放入口一起补齐

### 2026-06-01（Website Ads Launch Prep P29.ADS.1 完成）
- 首页补了 ads launch CTA，contact flow 也能识别 paid-media enquiry

### 2026-06-01（Website GEO Visibility P29.GEO.1-2 完成）
- 新增 /geo 公共页，首页和 sitemap 都接上了 GEO 导流

### 2026-06-01（SEO Title Cleanup）
- `/about` 和 `/contact` 的页面标题去掉重复品牌后缀，避免 layout template 叠加后出现 `| Magic Engine | Magic Engine`

### 2026-06-01（Website GEO Visibility P29.GEO.3 完成）
- 新增 /geo/glossary 轻量支撑页，给 GEO 主页面补了共享词汇和更清晰的搜索语境

### 2026-06-01（Website Public Root Sync P29.WEB.1 完成）
- 线上根域对应的 `website/` 站点已切到 AI upgrade / GEO / training 口径，并补了 `/geo`、`/training` 两个静态公开页

### 2026-06-01（Website Ads Launch Prep P29.ADS.2 完成）
- 新增 `/ads` landing page，并在首页补上 `Start ads launch` 入口，投放前转化路径已跑通

### 2026-06-01（Website Bilingual Routing P29.WEB.2 完成）
- 公开站已切成英文 `/` 和中文 `/cn.html` 两套 HTML 页面，切换语言后链接会继续留在同一语言里

### 2026-06-01（Phase 29 战略决策登记 + P21.B 看板来源标记上线）

- **Phase 29 登记** — Portal/Dashboard 双轨废弃、`self_serve` 用户身份、轻量 Brief 5 字段门槛、MTC 自服务打通；P29.A/B/C/D 任务清单写入 ROADMAP；Linear MAG-56 ~ MAG-64
- **P21.B 来源标记** — Reels Studio 草稿卡片补「📋 来自素材库」紫色徽章；reels 列表 API select 补 `source_storyboard_id`；`send-to-kanban` 引导文案修正指向 `/execution`

### 2026-05-31（Phase 18.A — Meta Ads 执行引擎 ✅ 完成 + ±20% 安全闸补齐）

- **盘点确认** — P18.A.1/2/3 代码早已建成（execute / actions / sync / snapshots 路由 + AdsFixDrawer + AdsAuditSection，均已接线执行看板），属 ROADMAP 漏勾的 drift
- **P18.A.2 安全闸补齐** — 预算调整加 ±20% 硬限：纯函数 `lib/meta/guardrails.ts`（12 单测全绿），execute 路由服务端强拦超限（422 + Talk to Us 文案），AdsFixDrawer 加区间提示 + 超限友好报错

### 2026-05-31（Phase 21 MVP 计划登记 + 21.B 视觉素材层补登记）

- **chore** — 盘点代码后确认 Phase 21 大部分积木已存在，真正缺 3 块连接组织（模型分层路由 / 变体扇出 reformat / 量产编排+熔断）；原五大子系统拆成 P21.1-9 可执行子任务 + MVP 垂直闭环 + M1/M2/M3 里程碑写入 ROADMAP
- **P21.1** — `MODEL_HAIKU` 常量 + `src/lib/ai/model-router.ts`（routeModel / calcCost，strategy→Sonnet / production→Haiku，11 单测全绿）
- **P21.2** — `src/lib/ai-factory/`（types / prompts / generator / index）；runFactoryJob 接 loadMemoryForClient + formatMemoryForPrompt；production 档位 Haiku；19 单测全绿，类型零错误。M1 产能内核完成
- **21.B 视觉素材智能层补登记** — `client_assets`+`asset_storyboards` 表、vision-analyzer cron、assets/storyboard API、素材库 UI 早已建成但从未登记（migration `20260612000001`）；⚠️ DB 是否已 apply 待 PM 在 Supabase 确认

### 2026-05-31（Phase 21 P21.5-9 — M2/M3 闭环全部完成 ✅）

- **P21.5** — `task-dispatcher.ts` `createProductionPackagesFromPlan`：Marketing Plan 任务批量调度 + 写 `production_packages` 聚合；M2 扇出闭环完成
- **P21.6** — `factory-budget.ts` `checkFactoryBudget`：月度熔断（默认 500 帖/月上限），fan-out 路由调用前检查，超限返回 429（PR #171）
- **P21.7** — `package-publish.ts` `logPackagePublishedAction` ← 已接线在 `PATCH /api/clients/[id]/production/[packageId]`：状态变 `published` 时非阻塞触发飞轮 action 落库（dimension→flywheel 映射完整）
- **P21.8** — 执行看板「⚡ 一键量产」按钮（marketing_plan 来源任务专用），调 `POST /api/clients/[id]/ai-factory/fan-out`，完成后绿色结果卡 + 内容库跳转（PR #171）
- **P21.9** — 端到端接线验证完成；M3 所有代码路径已接通；PM 人工验收阶段：CTS/Oztop 跑出 20-30 帖 → 标 published → 飞轮 outcome 卡片 + MTC 扣费验证

### 2026-06-02（Phase 21 P21.10 — Production Package 查看链接热修）

- **P21.10** — Production Package 详情页里 `content_post` 的「查看→」不再误跳 `/dashboard/clients/[id]/pages`；现已改为 `/dashboard/content?client={clientId}&highlight={postId}`，从生产包可直接深链回 Launch Hub 高亮对应帖子，避免误路由 / 401

### 2026-05-31（Phase 21 P21.4 — ai_factory intensity 档位 ✅）

- **P21.4** — Marketing Plan 加第 4 档强度 `ai_factory`（全速量产）：`types.ts` 联合类型 + `generator.ts` 新 cadence 分支（posts 7-8/周，对齐 MVP 20-30/周上限）+ `PlanGenerator.tsx` UI 加「AI 工厂」按钮（grid 3→4 列）；编译通过

### 2026-05-31（Phase 21 P21.3 — 变体扇出 + 多平台 reformat 引擎 ✅）

- **P21.3** — `fan-out.ts`（fanOutToPlatforms，Promise.allSettled 并发，单平台失败不阻断）+ `reformat.ts`（reformatForPlatform，Haiku reformat，5 平台专属格式规则）；22 单测全绿，TypeScript 零新增错误

### 2026-05-31（Phase 19.F — 修复 Phase 20.D 引入的鉴权回归）

- **P19.F** — `execution/manual` 路由换 `requireDashboardClientAccess`；`FdeManualEntryModal` 去掉 `NEXT_PUBLIC_INTERNAL_API_KEY`/`Authorization` 头，改走 session cookie（IDOR + 凭证泄漏双修）

### 2026-05-29（Phase 24.A — Platform OAuth Connector 全部完成 8/8）

- **P24.A.1** — DB migration `platform_oauth_connections` + vocabulary layer（类型、常量、`toConnectionSummary`）
- **P24.A.2** — Token Manager：`getValidToken` auto-refresh + `markConnectionError` + 自定义异常类
- **P24.A.3** — OAuth start 路由：CSRF state cookie（nonce:clientId，HttpOnly，SameSite=Lax，600s），302 → Google
- **P24.A.4** — OAuth callback 路由：CSRF 验证 + token 交换 + GBP 账户 API + 加密存储 + 清 cookie + 302 → settings
- **P24.A.5** — Connection Store CRUD：`upsertConnection` / `revokeConnection` / `listConnections` / `getConnectionById`
- **P24.A.6** — Client API `GET+DELETE /api/clients/[id]/platform/gbp`（列出 + 撤销，含租户隔离校验）
- **P24.A.7** — Settings 页面 `/dashboard/clients/[id]/settings` + SettingsDrawer 「平台连接」Tab
- **P24.A.8** — GbpPanel 5 态 UI（loading / error / disconnected / needs_reconnect / connected）；80 tests 全绿 PR #125

### 2026-05-29（Phase 14.C — SEO 生产期稳定性 + 飞轮闭环 全部完成 6/6）

- **P14.C.6** — GitHub PR merge webhook：HMAC 验签 + 回填 published_at + 自动 GSC 索引
- **P14.C.5** — 飞轮闭环：SEO outcome 按 content_mode 聚合，scorer 按历史成功率 +2/+6/+10 boost
- **P14.C.4** — JSON-LD BlogPosting schema 注入 WP/Shopify/GitHub 三条发布路径
- **P14.C.3** — 「重新生成策略」加 (client_id, proposed_title) unique index，upsert ignoreDuplicates
- **P14.C.2** — 看板「忽略」按钮持久化到 DB（PATCH status='dismissed' + 乐观更新 + 回滚）
- **P14.C.1** — blog `status='generating'` 殭尸状态自愈 cron（每 5 分钟扫 > 10 分钟标 failed）

### 2026-05-30（Phase 14.B — WP 发布质量改进 7 项）

- **P14.B.1–7 全部完成（PR #120）** — Yoast 探测+mu-plugin snippet、rollback 草稿、GEO 城市一致性、内链 QC check、primary_keyword 警告、WP 默认分类 ID、GSC 索引请求按钮

- **P23.E** — Memory 浏览/编辑/导出：FDE 仪表盘新增「客户记忆库」页（四 tab + 行级编辑 + 抽取 + 导出 JSON）
- **P23.C** — L3 记忆自动抽取器：从 flywheel_outcomes 推导 patterns/failed/preferences + 回填 decision_history
- **P23.D.2** — 张骞/华佗/鲁班三 Agent 注入 L3 记忆 + 共享 `formatMemoryForPrompt`，AI Factory 待 Phase 21
- **P23.B** — FDE 标注 UI：执行看板抽屉一键标记好模式/失败/偏好，落 L3 记忆三张表
- **P23.A+D** — L3 记忆层地基：4 张新表 + MemoryService + 诸葛亮 prompt 注入 + 决策历史自动写入
- **P13.UI.3** — Website homepage upgraded to shared UI language
- **P13.A.7** — Portal magic link can reach client portal

### 2026-05-28（Phase 20.D — 六支柱统一看板入口）

- **Phase 20.0 P20.0.7-9 完整** — Portal 三只读页：Diagnosis（六维评分卡+findings）、Prescription（处方摘要+KPI+分阶段行动）、Plan（执行进度按维度分组），互相 CTA 串联成 Discovery→Diagnosis→Prescription→Plan 闭环
- **Phase 20.0 P20.0.1-6 实施完成** — 打通陌生人自助入会漏斗：migration 加 `client_id` FK、`POST /api/onboard/self` 建 clients 行并写 client_discovery/portal_users、`/prospect` 加 ClaimWorkspace CTA、Portal Discovery 页面（服务端组件复用 ReportView）+ PortalNav Discovery 导航项 + 概览页 Discovery 摘要卡含四项评分
- **Phase 20.D 实施完成** — 执行看板新增「＋ 录入工作」统一入口（FDE 可从任意支柱直接录入工作，不绑定处方/Marketing Plan）；migration `20260603000001` 添加 `fde_manual` 来源；`FdeManualEntryModal` 组件；看板新增「📝 FDE 录入工作」分组（平铺 + 拖拽排序）；客户 Portal 新增「Active execution work」按支柱分组展示（透明度闭环）；`PlanTask.requires` 素材依赖标注（none/client_photo/client_video/client_info）；Phase 编号修正：Phase 24→Phase 20.D、Phase 22 明确为 Data Intelligence Engine、新增 Phase 22.D 主动任务生成器
- **ROADMAP 编号修正登记** — 文档化 Phase 24/22/22.D/23 正式命名，与 ME_Kanban_Evolution_Final.docx 保持一致

- **P13.UI.19** — Execution detail status menu is now contained inside the right-side FDE drawer instead of using a body-level floating portal over the board.

### 2026-05-27（OzTop 技术 SEO 修复 + FDE 看板需求登记）

- **OzTop Yoast 归档页 noindex 批量修复** — FDE 执行；在 oztopbuildingsupplies.com.au WP 后台完成 11 项 Taxonomy/Archive 关闭操作，预计消灭 150–180 个「已抓取未收录」URL（原计 211 个）：Tags ✅ Product tags ✅ Categories ✅ Product categories ✅ Brands ×2 ✅ Product Colour ✅ Product Flooring Colours ✅ Product shipping classes ✅ Author archives ✅ Date archives ✅ Format archives ✅ Media pages ✅；llms.txt 确认已开启（GEO 信号激活）
- **发现：Brands 分类重复** — 站点同时安装两个 Brand 插件，生成 `/brand/` 和 `/brands/` 两套重复 URL；两者均已 noindex，但需在下一次 FDE 会话清理重复插件并做 301 合并
- **新需求登记 `FDE-KANBAN-1`** — 技术 SEO 执行任务缺乏看板归宿：诊断引擎发现的技术 SEO findings（noindex 问题、robots.txt 泄漏、sitemap 异常等）当前不会自动生成看板卡片；FDE 执行的技术 SEO 工作只能手动记录 ROADMAP，无法与 Marketing Plan 内容任务在同一看板追踪。**需求**：SEO 诊断 findings → 自动生成 `task_type: technical_seo` 看板任务，与内容任务并排显示；待排入 Phase 12.I 或 Phase 15 SEO 执行闭环

### 2026-05-26（Oztop 手动发布 + Site Knowledge Graph 设计）

- **Oztop Pet Flooring 发布** — 手动发布「Pet Friendly Flooring in Brisbane」至 oztopbuildingsupplies.com.au；确认 SiteGround IP 封锁根因（nginx ipr 封 Render IP 74.220.48.245）；修复 Astra 全大写 CSS；修正 GEO 指令 Sydney→Brisbane 6 处；Yoast SEO 配置完成（focus keyphrase / SEO title / slug / meta description）；Google Search Console 提交收录；已发布 URL：`/pet-friendly-flooring-brisbane/`
- **Phase 14.F 登记** — 客户网站知识图谱（Site Knowledge Graph）：ME 生成博客缺内链根因确认 → 设计 `client_site_pages` 表 + sitemap 爬取流程 + 博客生成集成点；Oztop 38 个产品分类 URL 已首次爬取记录
- **Marketing Plan UX 两个待修 Bug**（Oztop 清仓 campaign 配置时发现）：
  - `MP-UX-1` Marketing Plan 日期应从关联 Campaign 自动继承（当前需手动填，无场景需求差异化）；选了 Campaign 后字段应只读或锁定到 Campaign 周期内
  - `MP-UX-2` Marketing Plan「FDE 关注点」缺 AI Generate 按钮；应基于 MB + Campaign + 上传文件自动起草，类似 Visual Direction 的体验；降低 FDE 起草门槛
- **Marketing Plan 生成质量三个根因 Bug**（Oztop 清仓 Plan 输出后发现，根因已定位至 `src/lib/marketing-plan/generator.ts`）：
  - `MP-GEN-1` 内容强度参数过于模糊：`intensity === 'aggressive'` 只是单句 prompt 提示「high volume, accept some lower-quality tasks」，没有给 Claude 具体数量基准。应改为：light=2-3/周，standard=4-6/周，aggressive=8-12/周，且按 campaign 类型（清仓/launch/sustain）有不同 baseline
  - `MP-GEN-2` System prompt 有「prefer fewer high-quality tasks」一句话，导致 Claude 识别到"premium positioning"就自动降量，与清仓/促销场景直接冲突，导致博客 monthly_count 永远偏低（Oztop 5 周清仓只生成 1 篇博客）。应根据 campaign 类型动态调整该指令
  - `MP-GEN-3` ⚠️ **viral_reference_library 表完全未被引用** — `generate/route.ts` 只读 master_briefs / campaign_briefs / content_strategy_items 三张表，Viral Reference 数据虽然采集了但从未注入 Marketing Plan 生成。应在 Reel 任务生成时拉取行业相关的爆款 hook 结构，注入 prompt 让 Claude 借鉴而非通用模板
- **Marketing Plan 架构级洞察 — 波次执行模型**（PM 现场提出，2026-05-26）：
  - `MP-ARCH-1` ⚡ ME 当前是「一次性生成 5 周 33 任务」的预生成模型，与真实 marketing manager 工作方式背离。专业营销人的实际流程是：① 策略层（5周方向 + KPI + 渠道骨架，固定）② 波次层（1-2 周详细任务，迭代式生成）③ 波次结束后收集真实数据/反馈 → 重新生成下一波次任务
  - 当前模型问题：Week 5 任务在 Week 1 就写死，5 周内无法响应实际数据；浪费 LLM token 生成大概率会被改写的远期任务；FDE 拿到 33 个任务批量派发，与"先验证再投入"的现代营销原则冲突
  - 改造方向：Plan 保留策略层（exec summary + KPI + 社媒矩阵规格）；Tasks 字段从「全期任务」改为「当前波次任务」；新增「波次复盘 → 下一波次生成」按钮；后端在生成下一波次时注入上一波次的真实表现数据
  - 优先级比 MP-GEN-1/2/3 更根本，建议升级为独立 Phase（Phase 12.W 波次执行模型 或并入 Phase 8.M Marketing Agent 记忆系统），2-3 周内落地
- **Campaign 字段注入缺口两个 Bug**（Oztop 清仓配置时 PM 现场审计 `campaign-injector.ts` 发现，2026-05-26）：
  - `MP-GEN-4` ⚠️ **Visual Direction（vi_mood / vi_color_accent / vi_specific_dos / vi_specific_donts / vi_reference_note）完全未被注入 prompt** — 这些字段只在 UI 面板和 AI Generate 按钮里使用，`src/lib/content/campaign-injector.ts` 的 `formatCampaignForPrompt` 没有引用，因此 Marketing Plan 生成的任务 description 完全不知道这次活动的视觉方向。FDE 即使在 ME 里精心填写 Visual Direction（或点 AI Generate 让 ME 自动起草），生成的社媒任务 description 里也不会出现"深胡桃木色 + 浅墙 + 黄铜灯具"等关键视觉指令。**Visual Direction 当前是死端输入**。修复：在 `formatCampaignForPrompt` 添加 vi_* 字段块；下游 Reel/Post/Story 任务的视觉相关描述应受其约束。同时该数据应注入到 Phase 21 AI Factory 的图片/视频生成 prompt（更关键）
  - `MP-GEN-5` Campaign 的产品/落地页 URL（source_urls）也未被注入 prompt — Marketing Plan 任务即使提到产品也不知道客户网站的对应产品页 URL，无法生成内链锚点。修复：在 prompt 注入产品页清单，让 Claude 在任务 description 里使用（与 Phase 14.G Site Knowledge Graph 协同）

> 每次上线新功能时在此追加。格式：**[完成日期]** — Phase ID + 描述 + Commit 引用。
> 此日志从 CLAUDE.md §十五.C 迁移至此（2026-05-10），CLAUDE.md 不再维护历史日志。

### 2026-06-05

- **P17.A.4** — GSC 归因桥接：`gsc-bridge.ts`（runGscAttributionForClient：SEO action → GSC before/after → 3 维 flywheel_outcomes）+ POST `/flywheel/gsc-attribution` + vocabulary 扩充 3 GSC metric keys + attribution cron pass-2 接线 [P17.A.4]
- **P17.A.5** — 每日 Google 数据回流 cron：`google-data-pullback-daily`（遍历所有已连接 GSC/GA4 connector，自动快照写库）+ render.yaml 注册（每天 3am UTC）[P17.A.4]

### 2026-05-27

- **P17.A.6** — 客户主页「数据」tab：三 tab 切换器（概览/数据/工具）+ `ClientDataTab`（GSC 4 指标格 + top-10 关键词表、GA4 4 指标格 + top-10 来源/页面表、快速夺旗机会清单 position>10 && impressions>50） [feat/phase-17-a6-data-tab, PR #93]
- **P17.A.3** — GSC/GA4 快照 UI：`DataPullbackSection`（执行看板数据回流卡）+ connector 详情页「立即同步」按钮 + 快照指标预览 [feat/phase-17-a-gsc-pullback]
- **P13.UI.17** — Inline prescription supplement/revision drawer upgraded to the shared right-rail shell with stronger overlay layering, contained scrolling, and refreshed Magic Engine controls.
- **P13.UI.18** — Zhangqian customer-facing discovery report gained Save PDF + DOCX downloads; DOCX export refreshed into Magic Engine deliverable language and dashboard Zhangqian export controls aligned.

### 2026-06-04

- **P17.A.2** — GA4 数据回流：`GA4_SCOPE`/`COMBINED_GOOGLE_SCOPES` + `buildAuthUrl` scopes 参数 + `fetchGa4Snapshot()` 3 并行报告 + 新表 `ga4_traffic_snapshots` + POST `/ga4/sync` + GET `/ga4/snapshots` [feat/phase-17-a-gsc-pullback]

### 2026-06-03

- **P17.A.1** — GSC 数据回流基础设施：新表 `gsc_performance_snapshots`（含 top_queries/pages JSONB）+ `fetchGscSnapshot()` 并行拉取两维度 + POST `/gsc/sync` + GET `/gsc/snapshots` [feat/phase-17-a-gsc-pullback]

### 2026-05-20

- **UX 基础修复（两个 session）** — 全站标题 CrazyContent→Magic Engine；login-form try/finally 防卡死；BriefSourcesForm/zhangqian cards/Step2BriefUpload 客户可见供应商名替换；ContentHub 移除内嵌 Reels/图片 子Tab 改跳转快捷卡；客户页新增 WorkflowProgress（张骞→MB→执行）进度条；SEO 页标题/注释去 SEMrush 改 Keyword Intelligence（commits 34fe7fb, e7b2aff）
- **架构确认：四 Agent 链 + 诸葛亮命名** — C Agent 正式命名为「诸葛亮」（策略调度引擎）；确认定位：输入张骞证据+华佗诊断→输出 priority_actions→flywheel_actions，不直接执行；AI 抽屉为 UX 层（正交），首页驾驶舱与鲁班看板为两个缩放层级（不冲突）；登记为 Phase 12.G（接口规范已确认）
- **P8.3.2 代码收尾** — login try-catch 修复；middleware+whitelist 测试已在代码库；**剩余 PM 操作**：Render 后台填 `ADMIN_EMAILS=你的邮箱` + Supabase Auth Redirect URLs 加 `/auth/callback`

### 2026-05-31（Phase 14.A — Website Connector，插队 13.A）

- **P14.A.1** — 扩展 `cms_connections` 表加 WP 形态（`site_url`/`username`，per-provider CHECK），新增 `CMS_PROVIDER.WORDPRESS` + `WordpressConnectionStatus` 类型；复用已有 AES-256-GCM crypto（`CMS_TOKEN_ENCRYPTION_KEY`）零新代码；migration `20260531000001_cms_connections_wordpress.sql`
- **P14.A.2** — `website_publish_jobs` 表（FK 到 `cms_connections`），4 态状态机 CHECK（draft/published/failed/rolled_back）、`(connection_id, idempotency_key)` UNIQUE 防重复推送、SHA-256 `payload_hash`、`content_snapshot` JSON 快照；配套 `src/lib/website-publish/vocabulary.ts` 提供 `canTransition` / `payloadHash`（canonical JSON，键序无关）/ `buildIdempotencyKey`，9 个单测全绿；migration `20260531000002_website_publish_jobs.sql`
- **P14.A.3** — 客户设置抽屉「🔗 网站连接」标签升级多供应商 Tab（GitHub 现状保留 / WordPress 全功能上线 / Shopify「即将推出」占位）；新 `src/lib/cms/url-guard.ts` HTTPS+公网域名校验（拒绝 IP 字面量 / 私网 / IPv6 / `.local`/`.internal`/单标签主机），39 单测全绿；`connection-store.ts` 加 wordpress 系列函数（upsert/get-status/get（含解密 server-only）/delete）；新 `/api/clients/[id]/cms/wordpress` GET/POST/DELETE（INTERNAL_API_KEY 鉴权、site_url 保存时再校验、用户输入错误透传 UI、DB 错误吞掉）；Application Password 走现有 AES-256-GCM crypto，仅显示末四位。Test/Publish 留 P14.A.5（UI 已加 amber 提示）

### 2026-05-25（Phase 13.A — Prospect 注册流程）

- **P13.A.1（去 Apify）** — `agent.ts` 移除 `scrapeInstagramProfile`/`scrapeTiktokProfile` import + `FETCH_SOCIAL_METRICS_TOOL` + `handleFetchSocialMetrics()`；从 tools 数组和 switch case 中删除；社媒指标改由 web_search + fetch_url（Jina）原生发现；零外部 API 调用
- **P13.A.2（register API）** — 新建 `POST /api/discover/register`：validate → rate-limit → save discovery_leads → create public_scan_jobs → fire background Zhang Qian scan → `supabaseAdmin.auth.signInWithOtp(shouldCreateUser:true)` 发 magic link（redirectTo=/auth/callback?next=/prospect）→ 返回 202
- **P13.A.3（/discover 改版）** — `/discover` 表单切换到 `/api/discover/register`；成功后展示「Check your email」确认屏（不再跳扫描进度页）；移除 `useRouter` 依赖；按钮文案更新
- **P13.A.4（prospect 报告看板）** — 新建 `/prospect/page.tsx`：轮询 `/api/prospect/report`（按 email 查最新 scan）→ 扫描中显示 LoadingView + 实时日志流 → 完成显示 Discovery Report（含健康评分 / 竞品 / 关键词 / 社媒评价）→ 处方区域显示 `PrescriptionGate`（Talk to Us CTA）
- **P13.A.5（prospect report API）** — 新建 `GET /api/prospect/report`：Supabase session 鉴权 → 按 user.email 查 public_scan_jobs 最新行 → 返回 status + progress_log + result
- **P13.A.6（middleware + auth callback）** — middleware 加 `/prospect` 路由块（仅验证 Supabase auth，无角色要求）；matcher 加 `/prospect/:path*`；auth/callback 加 prospect 检测（有 public_scan_jobs 记录 + 无 portal/dashboard 权限 → 重定向 /prospect）；build ✅
- **P13.A.8（admin auth priority）** — 修复 admin 邮箱同时存在 portal/prospect 关系时被客户账号抢走的问题；`ADMIN_EMAILS` 优先进入 dashboard；清理 `bigbigraydeng@gmail.com` 的 CTS portal 绑定
- **P13.UI.4** — `/discover` 升级为新版官网一致的 prospect 入口；移除真实供应商名；表单、成功页、诊断产物预览统一视觉语言
- **P13.UI.5** — `/prospect` 报告页升级：扫描中、无报告、失败、完成报告四态统一为新版 prospect-to-portal 体验；报告卡片改为浅色可读版
- **P13.UI.6** — `/portal/[clientId]` 客户端 overview、monthly report、content library 与导航升级为新版 Magic Engine client portal 视觉语言
- **P13.UI.7** — `/portal/login`、`/login` 与 admin dashboard sidebar/layout 统一为新版 Magic Engine 入口外壳；清理乱码 icon/loading 文案
- **P13.UI.8** — admin mobile shell、Content Studio drawer、Social Plan Studio 与 Reels Studio 改为响应式新版工作区；移除右侧抽屉硬宽度
- **P13.UI.9** — execution board 修复 sidebar 内部滚动条、header action 旧按钮、task detail drawer 旧样式与主内容硬挤压
- **P14.A.4（Shopify connector）** — migration 扩展 provider shape 约束加 shopify；shopify-guard（SSRF 防护 17 单测全绿）；shopify-client（Admin REST 2024-01：testConnection / listBlogs / getOrCreateDefaultBlog / createArticleDraft / publishArticle / createPageDraft / publishPage）；html-sanitizer MVP；vocabulary 加 SHOPIFY + ShopifyConnectionStatus；connection-store 加 Shopify CRUD；/cms/shopify CRUD + 保存即测 token；/cms/publish-shopify 两步 draft→publish，幂等写 website_publish_jobs；TS 零错误，17 tests ✅
- **P14.A.5（WordPress connector）** — `wordpress-client.ts`（dns.promises.lookup SSRF guard；testWordpressConnection 验证 publish role；createWordpressPostDraft/Page draft-first；publishWordpressPost/Page status='publish'）；connection-store 加 `markWordpressConnectionTested`；/cms/wordpress 升级（保存即测）；/cms/publish-wordpress（两步 draft→publish，幂等，租户隔离，sanitizeHtml）；TS 新文件零错误
- **P14.A.6（Blog Studio 三步发布 UI）** — 新 `GET /api/clients/[id]/cms/providers` 聚合三平台状态；新 `PublishToWebsitePanel` 组件（WordPress/Shopify Draft→Preview→Publish 三步，GitHub 单步 PR）；blog/[postId]/page.tsx 替换旧 GitHub-only 按钮
- **P14.A.7（html-sanitizer allowlist 升级）** — 三遍扫描：Pass1 危险块删除（script/style/iframe/form/svg/math/…）+ Pass2 标签/属性白名单重写（仅允许 ~40 安全标签，href/src 限 https?，rel=noopener 强制注入）+ Pass3 未知关闭标签清除；零外部依赖
- **P14.A.8（飞轮回写）** — WordPress + Shopify publish 路由在成功 publish 后 insert `flywheel_actions`（flywheel=seo, action_type=cms_content_insert, execution_mode=in_house）；失败仅打日志不阻断响应

### 2026-05-24

- **P8.13.A** — DataForSEO Labs 关键词+竞品接入：`labs.ts` 新建；`fetch_keyword_data` + `fetch_competitors` 两个 tool 接入张骞 agent + prompts；零幻觉替换 web_search 猜关键词/竞品 (commit 175299a)
- **P8.13.B** — DataForSEO Domain Technologies + WHOIS 接入：`domain-analytics.ts` 新建；`fetch_domain_technologies` + `fetch_domain_whois` 注册到 agent；types.ts 新增 technology_stack / domain_whois 字段；TechStackCard + DomainWhoisCard 渲染；到期 < 90 天自动 quick_fix (commit a16e0ac)
- **P8.13.C** — Business Data API 替换 SerpAPI：`business-data.ts` 新建（getGmbInfo + getGoogleReviews + getTripadvisorInfo）；local-reviews/client.ts 切换到 DataForSEO + 新增 fetchTripadvisorReviews；tripadvisor 枚举加入 types + validators + cards；agent.ts fetch_local_reviews 新增 tripadvisor_keyword 参数
- **P8.13.D** — SERP DataForSEO 主/Apify 降级 + OnPage 审计接入：`serp.ts` 新建（getSerpPage，DataForSEO 优先）；handleFetchSerpResults 更新为双层 fallback；`onpage.ts` 新建（getOnPageInstant）；FETCH_ONPAGE_AUDIT_TOOL + handleFetchOnpageAudit 接入 agent；types.ts 新增 onpage_audit 字段；OnPageAuditCard + page.tsx 渲染；prompts.ts 步骤 1 新增必调 fetch_onpage_audit 要求

### 2026-05-25

- **P12.Q.0** — 产物表加 snapshot/score 列：blog_posts / content_posts / reels_drafts 各加 generation_context_snapshot JSONB + quality_score NUMERIC(4,2)；新增 ReelsDraft interface；build ✅
- **P12.Q.1** — Campaign 上下文修复（路线 A）：campaign_briefs 加 6 nullable 字段（offer/target_audience_detail/proof_points/primary_cta/channel_goal/campaign_angle）；CampaignBrief TS 类型同步；injector formatCampaignForPrompt 注入新字段；两个 Reels 路由 select 补齐；build ✅
- **P12.Q.2** — 统一 quality rubric 模块：src/lib/content/quality-rubric.ts，6 维混合评分（规则：platform-fit/cta/dimension-goal；LLM：brand-fit/campaign-fit/specificity），SDK 由 caller 注入，14 个 Vitest 测试全通过；build ✅
- **P12.Q.3** — Blog auditBlogPost + retry：新增 quality-audit.ts 包裹器，blog route 接入最多 3 次尝试，quality_score+snapshot 写入 blog_posts；7 Vitest 测试通过；build ✅
- **P12.Q.4a** — Social Route A/C 接入 rubric：新增 social-quality-audit.ts；batch-generate 接入 generatePostWithQualityRetry（refine retry 最多 3 次，失败维度回传下轮 prompt）；quality_score+snapshot 写入 content_posts；11 Vitest 测试通过；build ✅
- **P12.Q.4b** — Social Route B 接入 rubric：social_b contentType + viral-structure-preservation advisory 维度自动注入；Promise.allSettled 非阻断 audit 两变体；quality_score+snapshot 写入 content_posts；17 Vitest 测试通过；build ✅
- **P12.Q.5** — Reels 接入 rubric：新增 src/lib/reels/quality-audit.ts（auditReelsDraft，审计 fb_caption）；generate route 接入 generateWithQualityRetry（最多 3 次，失败维度回传 qualityHint）；quality_score+snapshot 写入 reels_drafts；14 Vitest 测试通过；build ✅
- **P12.Q.6** — 验证五条链路 snapshot/score 写入：发现 Route A/C 缺 audit 逻辑；补入 auditSocialPost（Promise.allSettled 非阻断）+ quality_score/snapshot 写入；build ✅，质量测试全绿
- **P12.Q.7** — CTS Tours 端到端 demo + before/after 对比报告：五条链路（Blog / Route A / B / C / Reels）Before 均分 3.5 → After 均分 8.4（+4.9），retry 机制全部触发，5/5 链路 pass=true；generation_context_snapshot 样例写出；报告写入 `docs/clients/cts-tours/p12q-quality-demo-report.md`（M3 ✅）
  `docs(quality): P12.Q.7 — CTS Tours before/after demo report [P12.Q.7]`
- **P12.G.1** — 诸葛亮接口层：types.ts（ZhugeInput/Output/PriorityAction/BusinessContext/LubanTool）+ conductor.ts（系统 prompt + buildUserPrompt + parseOutput + conductPriorityActions）；26 Vitest 测试全通过，build ✅
  `feat(zhuge): P12.G.1 — 诸葛亮 prompt 工程 + 接口层 [P12.G.1]`
- **P12.G.2** — 诸葛亮数据接入：tools-catalog.ts（5 个 Luban 工具）+ assembler.ts（从 Supabase 聚合张骞/华佗/处方数据）+ POST /api/clients/[id]/zhuge/conduct（真实 DB 查询，422/404 优雅降级）；34 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.2 — assembler + conduct API route [P12.G.2]`
- **P12.G.3** — action-persister.ts：buildSessionKey（sha256 16-char 幂等键）+ persistZhugeActions（SELECT 检查 → INSERT）；dimension→flywheel 映射，reputation/competitor 跳过；conduct route 非阻断调用，响应加 persisted 字段；12 Vitest 全通过（zhuge 49 total），build ✅
  `feat(zhuge): P12.G.3 — persist priority actions to flywheel_actions + idempotency [P12.G.3]`
- **P12.G.4** — 首页驾驶舱接入诸葛亮：GET /api/clients/[id]/zhuge/latest-actions（读最新会话）+ ZhugePriorityWidget（行动卡 + 重新计算按钮）接入 page.tsx；54 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.4 — 首页驾驶舱消费诸葛亮数据 [P12.G.4]`
- **P12.G.5** — ZhugeDrawer AI 抽屉：打开自动调 conduct，展示优先行动卡，每条 in_house 行动附一键「触发鲁班」跳转按钮（luban-router.ts 纯函数解析路由）；display-constants.ts 消除 DRY；Widget 移除内嵌 conduct 改为 onAskZhuge+refreshKey；57 Vitest 全通过，build ✅
  `feat(zhuge): P12.G.5 — ZhugeDrawer + luban-router + 一键触发鲁班 [P12.G.5]`
- **Phase 8.S.1–7（补录核实）** — SEMrush→DataForSEO 关键词 API 迁移全部完成：`src/lib/dataforseo/labs.ts` 含 7 个替换函数（getRelatedKeywords/getDomainOrganicKeywords/getKeywordGap/getDomainCompetitors/getQuestionKeywords/getDomainMetrics/getDomainTrafficTrend），调用方已全部切换，节省成本 96–99%（2026-05-25 代码核实）
- **Phase 9.0.10–17（补录核实）** — Visual Queue UX 测试套件 + QueueOverviewCard 全部完成：GenerationProgress/QueueOverviewCard 测试文件存在（`src/components/visual/__tests__/`），QueueOverviewCard 已集成进 visuals/page.tsx（2026-05-25 代码核实）
- **Phase 12.H.1–3（补录核实）** — GitHub CMS 执行闭环全部完成：`blog-publisher.ts`（博客序列化→PR），Blog Studio「推送到网站」按钮，执行看板「Fix」按钮，均已实现并回写 flywheel_actions（2026-05-25 代码核实）

### 2026-05-23

- **P13.E-pre** — Competitor snapshot persistence：新增 competitor_snapshots 表（含 production_package_id FK）；competitor-keywords POST 落库 snapshot + 接受可选 production_package_id；包详情 API 回读 competitor_snapshots 数组，build ✅
- **P13.E** — Flywheel feedback 闭环：flywheel_actions 加 production_package_id FK；4 adapter execute() + ExecuteActionInput/FlywheelActionRow 类型同步；新增 package-publish.ts（dimension→flywheel 映射 + on-publish 非阻断落 flywheel_action）；PATCH /api/clients/[id]/production/[packageId] 状态更新 + publish hook，build ✅
- **P12.J.1** — 博客头图配图：新增 `/api/clients/[id]/blog/[postId]/image` 路由（gpt-image-1 16:9 + Supabase blog-hero/ 存储）+ 工作台「🖼 头图配图」面板（一键生成/重新生成/编辑提示词）+ `generateVisualBrief()` 注入 Campaign 视觉线索，build ✅
- **P12.K.1** — Campaign 视觉方向（两层视觉继承体系）：`campaign_briefs` 加 5 nullable 字段（vi_mood/vi_color_accent/vi_specific_dos/vi_specific_donts/vi_reference_note）；新增 POST `/api/clients/[id]/campaign/[campaignId]/generate-visual`（读 MB vi_* 为品牌宪法 → Claude Sonnet 生成活动专化视觉方向，仅预览不落库）；CampaignPanel 新增 VisualDirectionSection（AI 生成按钮 + 5 字段编辑 + Save 触发 PATCH）；migration 20260523000003；commit `3f4e09e`
- **P12.I.fix** — 张骞 free tier 瘦身 + 超时根治：① `prompts.ts` 移除 `诊断评分标准`/`危机类型分类` 两节（~50行）+ JSON 示例中 diagnosis 块 + 所有 `diagnosis.actions.quick_fix` 引用改为 `notes`；② `agent.ts` `CLAUDE_FINAL_TIMEOUT_MS` 240s→90s + 6 个 DataForSEO 调用加 `withTimeout(30s)` 保护；③ `status/route.ts` 错误文案 "10 min"→"6 min"；④ `page.tsx` 用「⭐ 解锁完整诊断方案」会员 CTA 替换 DiagnosisCard/ActionPlanCard，时间估计 5-8分→3-4分；build ✅；commit `b3982b5`；push → Render 已触发部署
- **PR#61 review fix (P12.I.6 前置)** — `page.tsx` 的 `GroupData` 接口新增 `editable: boolean`，将可编辑性与归账状态解耦；`PrescriptionGroup` 改用 `group.editable` 传给 `PhaseColumn`；`prescriptionGroups.map()` 显式设 `editable: !archived`。自主行动泳道 view model 只需返回 `editable: false` 即可阻断 `prescription_id="__autonomous__"` 404 路径。
- **SEO Gap 竞品数据链路三层修复** — 根因：`seo-gap/route.ts` 完全没有过滤逻辑，直接把 DataForSEO 原始竞品（含 facebook.com）用于 gap 分析，且两条路由读的是 `clients.competitor_domains`（从未被任何流程写入）而非真实数据源；三个 commit 逐层修复：① `seo-gap/route.ts` 加入 GENERIC_DOMAIN_BLOCKLIST（含旅游聚合站）+ 动态跳过 SERP 调用（已有 ≥3 known domains 时）+ 域名 normalize（去 https://、/ 后缀）commits `42c0ea5`；② 两条路由改用 `getActiveBrief()` 读 `master_briefs.competitor_domains`（张骞 + 手动补充的真实来源）commit `ae10ded`；③ `zhangqian/confirm/route.ts` confirm 时把 direct/adjacent 竞品合并写入 active master brief（非破坏性 merge，保留手动条目），形成完整闭环 commit `f0ce301`

### 2026-05-22

- **P12.I.10** — Intent 优先内容策略：SEO Intelligence Panel A 新增 Branded vs Non-Branded 估算流量拆分 + Intent Priority Content；排名表/缺口词表 Transactional 优先；11 tests + build ✅

- **P12.I.9** — Position Changes 接入 SEO Intelligence：基于 `keyword_snapshots` 最近两期计算 New/Lost/Improved/Declined，Panel A 展示摘要 + movement 列表，测试 + build ✅

- **P12.I.8** — `keyword_snapshots` 趋势地基：新增快照表 migration、DataForSEO ranked keyword upsert service、weekly cron + Render 调度，10 tests + build ✅
- **P12.I.7** — Untapped 词与 strategy `new_blog` 卡片接入一键生成博客：复用 POST /blog，成功后回写 strategy item，测试 + build ✅
- **P12.I.6** — 执行看板新增「自主行动」泳道：无 execution_item 来源的 flywheel_actions 合成只读卡片，复用 OutcomeChip，测试 + build ✅
- **P12.J.2** — 博客推送 HTML 注入 hero figure：`buildBlogHtml`/CMS 推送共用 body builder，预览/复制/推送都带头图，目标测试 ✅
- **P8.3.2** — Dashboard Magic Link 鉴权收尾：AI Tracker dashboard API 加 session + client scope 守卫；38 个 auth 相关测试通过
- **P13.D** — Ads + Reputation 接入 production package：meta_ads_snapshots + project_reviews 加 production_package_id FK；两条路由接受可选参数；包详情页回读 ads_snapshots + reputation_reviews，build ✅

### 2026-05-21（续 2）

- **P12.I.5** — 博客生成接入 SEO 飞轮（接线缺口 1+2）：`blog/route.ts` 的 `persistAndReturn()` 持久化 `primary_keyword/keyword_volume/keyword_kd/keyword_intent` 到 `blog_posts`，并在博客落库后非阻断写一条 `flywheel_actions(flywheel='seo', action_type='seo.publish_blog', execution_mode='in_house')`；复用 `SeoContentAdapter.execute()`，try/catch 包裹保证飞轮写入失败不影响主流程；零 schema 改动；build ✅；未引入新测试失败

- **P12.I.3** — Panel B「了解对手」竞品并排对比 + 关键词缺口 Venn 图：GET `/api/clients/[id]/seo-intelligence/competitors-gap`（getSerpCompetitors top5 + getKeywordsGap top3 竞品，24h cache）；竞品卡片横向滚动；SVG Venn 图（你独有/共同词/缺口）；缺口词筛选表（意图/搜索）；TS 无新错误；build ✅

- **P12.I.4** — SEO Gap 页移除 SEMrush CSV 上传，改用 DataForSEO 自动拉取：route.ts POST 改为 JSON body，调 `getSerpCompetitors→getKeywordsGap`，`LabsKeyword→ParsedKeyword` 映射（search_volume/keyword_difficulty/intent）；前端移除 drag-drop/文件列表/useRef/useCallback，一键「Run」按钮；AI 分析链路+DOCX 生成+Storage 上传不变；TS 无新增错误

- **P12.I.2** — Panel A「了解自己」Organic Rankings 关键词表 + Intent 分布图：`getRankedKeywords()` 调 DataForSEO ranked_keywords/live（200 词含 position）；GET `/api/clients/[id]/seo-intelligence/rankings`（24h cache）；Panel A 完整 UI：Intent 分布徽章、Intent/排名段位/品牌词三维过滤器、搜索框、50 条分页表格（关键词/排名/月搜量/KD/意图）；TS 无新增错误；build ✅

- **P12.I.1** — SEO Intelligence 页面路由 + 顶部指标栏：新增 `/dashboard/clients/[id]/seo-intelligence` 页面；GET `/api/clients/[id]/seo-intelligence/metrics` 读 `flywheel_metrics(flywheel='seo')` 最新快照（4 指标：收录关键词/月均流量/权威分/已发布博客）；客户详情页「SEO 工具」区块新增导航入口；Panel A/B 占位面板；build ✅

### 2026-05-21（续）

- **P13.C** — Reels/generate + visual/image + visual/video 三条生成链路接入 production_package_id，异步创建 production_items + 回写 production_item_id，build ✅

### 2026-05-21

- **P13.B.2** — 客户级生产包列表页 + `GET /api/clients/[id]/production`：维度 tab 过滤、按 dimension 分组展示、item_count 批量计算，build ✅
- **P13.B.1** — Blog 生成路由接入 `production_package_id`：`GenerateBlogRequest` 加字段，`persistAndReturn` 创建 production_items 行 + 回写 production_item_id，覆盖 SEO + AI Visibility 两个 dimension，build ✅
- **P13.A.5** — 生产包只读详情页 + GET API 路由：展示 dimension/campaign/execution_item/items 列表/context snapshot，build ✅
- **P13.A.4** — Route A/C 接收 `production_package_id`，生成后创建 `production_items` 行并回写 `production_item_id`，build ✅
- **P13.A.3** — 四张内容表各加 `production_item_id` nullable FK → `production_items` + partial index，build ✅

### 2026-05-20

- **P13.A.2** — `production_items` migration：建表 + content_type CHECK + 跨 FK 一致性约束（chk_item_fk_matches_type）+ 6 索引 + updated_at trigger + RLS，build ✅
- **P13.A.1** — `production_packages` migration：建表（复用 `diagnostic_dimension` enum）+ 4 索引 + updated_at trigger + RLS 三策略（SELECT/INSERT/UPDATE via client_team），build ✅

### 2026-05-19

- **P8.3.2** — Dashboard Magic Link 鉴权重新启用：middleware matcher 改回 `/dashboard/:path*` + layout `redirect('/login')` 取消注释；whitelist.ts + middleware.ts 新增 23 个单元测试（fail-closed / admin / client-viewer scoping / 边界）；`/unauthorized` 已存在无需新建；Supabase 后台 Redirect URLs 白名单 + Render `ADMIN_EMAILS` 需 PM 上线前配齐
- **P8.10.S0.21** — 张骞首跑硬化 + Advanced Discovery 入口：HTTP 超时全封（Anthropic SDK 90s / SEMrush 20s / Apify ad-library 30s）+ `GLOBAL_TIMEOUT_MS` 270s→300s + stale-timeout 10min→6min + 新增 `/api/cron/zhangqian-sweeper` 兜底孤儿 job + 首跑工具瘦身（删 `fetch_meta_ads` + `fetch_social_metrics` 去 facebook，`MAX_TOOL_CALLS` 22→18，`MAX_COST_USD` $1.80→$1.50）+ prompts.ts 同步 + 报告页 Advanced Discovery CTA banner
- **P8.10.S0.23** — Advanced Discovery Phase 2：GSC connector（Service Account JWT + Search Analytics API，返回 28 天 top-25 query）+ Google Ads connector（Apify 透明度中心，公开数据）；`advanced-agent.ts` 按 triggeredBy 分流；types 新增 GscSearchData + DiscoveredGoogleAdsData；build ✅
- **P8.10.S0.24** — Advanced Discovery Phase 3：张骞报告页可视化 advanced 数据；新增 GscDataCard / GoogleAdsCard / AdvancedFacebookCard；MetaAdsCard 优先读 advanced.meta_ads；CTA banner 双态（已跑→绿色成功，未跑→蓝色 CTA）；build ✅
- **P8.10.S0.22** — Advanced Discovery Phase 1：新建 `client_connectors` 表 + `client_discovery_jobs.job_type` 列；`advanced-agent.ts` 实现 `runZhangqianAdvanced()`（Meta 广告库 + FB 主页抓取）；`persistor.ts` 加 `mergeAdvancedPayload()`（写入 payload.advanced 不覆盖 basic）；connectors status/connect API；`/dashboard/clients/[id]/connectors/[anchor]` 详情页；connector 授权自动触发高级发现（commit 94d8eaa）

### 2026-05-17

- **P12.A.1** — 飞轮数据骨架 migration：建 flywheel_actions/metrics/outcomes 三表 + execution_items 加 execution_target 列 + 存量回填
  `feat(flywheel): P12.A.1 — 建 3 张飞轮新表 + alter execution_items [P12.A.1]` (c8b518b)
- **P12.A.2** — GEO 受控词表：6 个 action_type 常量 + 5 个 metric_key 常量 + 运行时校验函数
  `feat(flywheel): P12.A.2 — GEO 受控词表 vocabulary.ts [P12.A.2]` (9738c04)
- **P12.A.3** — FlywheelAdapter 接口 + Registry：types.ts 定义接口 + DTO，registry.ts 提供注册/查找/列举函数
  `feat(flywheel): P12.A.3 — FlywheelAdapter 接口 + Registry [P12.A.3]`
- **P12.A.4** — GeoComposerAdapter：execute() 写 flywheel_actions 落库，pullMetrics() 留存根 [P12.A.7 填]
  `feat(flywheel): P12.A.4 — GeoComposerAdapter (in_house mode) [P12.A.4]`
- **P12.A.5** — 执行看板按钮按 execution_target.mode 分发：in_house 弹抽屉 / third_party 跳路由+打勾提示 / external_manual 静态标签；ExecutionItem 类型加 execution_target 字段；新建 FlywheelDrawer.tsx stub
  `feat(flywheel): P12.A.5 — 执行看板按钮按 execution_target.mode 分发 [P12.A.5]` (cd7018c)
- **P12.A.6** — FlywheelDrawer 填充：POST /api/flywheel/execute → adapter.execute() → flywheel_actions 落库；GEO 飞轮 actionType/expectedMetric/expectedDelta 表单；form/submitting/done/error 四态
  `feat(flywheel): P12.A.6 — FlywheelDrawer 落库 flywheel_actions [P12.A.6]` (4941c5c)
- **P12.A.7** — AI Tracker 重跑写 flywheel_metrics：mention_rate / avg_rank / engine_coverage，GeoComposerAdapter.pullMetrics() 实现
  `feat(flywheel): P12.A.7 — AI Tracker 重跑写 flywheel_metrics [P12.A.7]` (b1903d0)
- **P12.A.8** — 归因 Job：扫 flywheel_actions.expected_metric，算 baseline/after/verdict/confidence，写 flywheel_outcomes（14 测试全通过）
  `feat(flywheel): P12.A.8 — 归因 Job 写 flywheel_outcomes [P12.A.8]`
- **P12.A.9** — Cron 路由 POST /api/cron/attribution，每 6h 触发归因 Job，7 测试全通过
  `feat(flywheel): P12.A.9 — Cron 触发归因 Job [P12.A.9]`
- **P12.A.10** — 执行看板卡片显示 outcome chip（verdict+metric+delta_pct+confidence），8 测试全通过
  `feat(flywheel): P12.A.10 — 执行看板卡片显示 outcome [P12.A.10]`
- **P12.A.11** — 华佗新生成的处方自动带 execution_target（flywheel/mode/vendor），8 测试全通过
  `feat(flywheel): P12.A.11 — 华佗处方输出 execution_target [P12.A.11]`
- **P12.A.12** — 一次性回填脚本 backfill-execution-target.ts：按 (dimension, fix_type) 修正存量 execution_items.execution_target
  `feat(flywheel): P12.A.12 — 存量 execution_target 回填脚本 [P12.A.12]`
- **P12.A.13** — CTS E2E 验证脚本 p12-a13-cts-e2e.ts：用真实 prescription 的 ai_visibility 条目 + 真实 2026-04-27 snapshot 作 baseline，跑通 execution_item→action→metrics→attribution→outcome 全链路；outcome verdict=confirmed delta_pct=105.6% confidence=0.95（after 为标记 synthetic 的占位，等下次 Tracker 周跑替换）
  `feat(flywheel): P12.A.13 — CTS GEO 端到端验证 [P12.A.13]`
- **P12.A.14** — 新增 docs/flywheel-architecture.md（186 行）：系统目标、四飞轮×三执行形态、3 张表、端到端数据流图、FlywheelAdapter 契约、加新 adapter 的 10 步指南（以 MetaAdsAdapter 为例）、5 条不可偏离的设计原则
  `docs(flywheel): P12.A.14 — 架构 README 与 adapter 接入指南 [P12.A.14]`
- **P12.A.15** — ROADMAP § 9 Phase 12.A 总结追加 + CLAUDE.md 当前焦点切换到 Phase 12.B
  `chore(roadmap): P12.A.15 — Phase 12.A 总结 + 焦点切 Phase 12.B [P12.A.15]`
- **P12.B.1** — SEO adapter：vocabulary 填 4 action_type + 4 metric_key；SeoContentAdapter execute()+pullMetrics()（SEMrush domain_ranks + blog 计数）；9 单元测试；build 通过
  `feat(flywheel): P12.B.1 — SeoContentAdapter SEO 飞轮落库 [P12.B.1]`
- **P12.B.2** — Meta Ads adapter：migration(meta_ads_snapshots + clients.meta_ad_account_id)；ADS vocabulary 6+7 条；MetaAdsAdapter execute()+pullMetrics()；Meta Graph API client；sync 路由；10 单元测试；build 通过
  `feat(flywheel): P12.B.2 — MetaAdsAdapter Ads 飞轮落库 [P12.B.2]`
- **P12.B.3** — Social adapter：SocialContentAdapter；vocabulary SOCIAL_ACTION_TYPE(3)+SOCIAL_METRIC_KEY(2)；execute()+pullMetrics()；publer/create-post 静默挂载；11 单元测试
  `feat(flywheel): P12.B.3 — SocialContentAdapter 社媒飞轮落库 [P12.B.3]`
- **P12.B.4** — SEMrush 周快照 cron：GET /api/cron/flywheel-seo-weekly；拉所有有 domain 的客户 domain_ranks 写 flywheel_metrics；9 单元测试；build 通过
  `feat(flywheel): P12.B.4 — SEMrush 周快照 cron [P12.B.4]`
- **P12.C.1** — 跨客户 outcome 聚合：outcome-aggregate.ts 纯函数层（7 测试）；GET /api/admin/flywheel/aggregate；/dashboard/admin/flywheel 飞轮成效卡片（verdict bar + 置信度 badge）
  `feat(flywheel): outcome aggregate API + Admin 飞轮成效卡片 [P12.C.1]`
- **P12.C.2** — 反哺华佗置信度：outcome-confidence.ts（8 测试）；HuatuoLookupContext 新增 outcome_confidence；agent.ts 并行拉取；prompts.ts 注入「历史成效数据」段落；处方 action 末尾附置信度标签
  `feat(huatuo): 飞轮归因置信度反哺处方生成 [P12.C.2]`
- **P12.C.3** — 社媒 engagement 回流：engagement-pullback.ts（7 测试）；Publer GET /posts/{id}；GET /api/cron/social-engagement-pullback；vocabulary 新增 POST_LIKES/COMMENTS/SHARES；render.yaml 注册每日 4am UTC cron
  `feat(social): Publer engagement pullback → flywheel_metrics [P12.C.3]`

### 2026-05-24（Phase 8.13 Sprint A–E）

#### 🎉 Phase 8.13 总结（2026-05-24 完成，4 sprints + 1 收尾 session）

**核心交付**：张骞 Intelligence Layer — DataForSEO 全域情报接入（11 工具 · $0.57/客户）

- **P8.13.A** DataForSEO Labs 关键词+竞品接入（零幻觉替换 web_search）：`labs.ts` + `fetch_keyword_data` + `fetch_competitors`，空结果降级 web_search
- **P8.13.B** Domain Technologies + WHOIS：`domain-analytics.ts` + `fetch_domain_technologies` + `fetch_domain_whois`，到期 < 90 天自动注入 quick_fix；TechStackCard + DomainWhoisCard 上报告页
- **P8.13.C** Business Data API 替换 Apify 评论爬虫：`business-data.ts`（GMB + Google Reviews + Tripadvisor）；`tripadvisor` 枚举写入 `review_platforms`
- **P8.13.D** SERP + OnPage Audit 全链路：`serp.ts`（DataForSEO 优先 + Apify fallback）；`onpage.ts`（Core Web Vitals + checks 快审）；OnPageAuditCard 上报告页
- **P8.13.E** 集成测试收尾：21 个 mock 集成测试全覆盖 Sprint A-D；修复 `validators.ts` bug（`technology_stack` / `domain_whois` / `onpage_audit` 未被 pass-through）；agent.ts 顶部成本注释更新 ≈ $0.57/客户

**新增字段**：`technology_stack` / `domain_whois` / `onpage_audit` / `business.phone_numbers` / `business.emails` / `review_platforms: tripadvisor`

### 2026-05-18

- **P8.10.S0.12** — 新客户向导简化为真正 2 步：移除 5 步 StepIndicator + Steps 2-5 死代码；page.tsx 重写为纯净单页；按钮改为「🧭 派遣张骞」；ROADMAP P8.10.S0.1–14 全部勾选
  `feat(onboarding): P8.10.S0.12 — 2 步接入向导替换 5 步向导 [P8.10.S0.12]`
- **P8.10.S2.4** — Ads Collector 从零实现：Apify Meta Ad Library + Google Ads Transparency 双源 + 评分（platform/volume/creative 40/35/25）+ 4 类 finding（no_ads / single-platform / low-volume / weak-creative）+ runner 接入 + 13 单元测试
  `feat(diagnostic): P8.10.S2.4 — Ads Collector + Meta/Google 双源 [P8.10.S2.4]`
- **P8.10.S2.5** — AI Visibility 实时调用层：新 `ai-visibility-live-probe.ts`（默认 probe 接 OpenAI runner + parser，跑 3 个核心问句，45s 超时，OPENAI_API_KEY 缺失时静默降级）；collector 加 LiveProbe 注入 + 三态合并（无 snapshot→走 live 评分 / snapshot 0 mentions→附 live 证据 / snapshot 健康但 live 0→新增 `live_probe_no_mention` 高优 finding）；runner.ts 在 ai_visibility/full 模式注入默认 probe；14 测试全过；build 通过
  `feat(diagnostic): P8.10.S2.5 — AI Visibility live probe [P8.10.S2.5]`
- **P8.10.S2.6** — 统一 evidence schema：`src/lib/diagnostic/types.ts` 新增 `EvidenceEnvelope { raw, parsed, sources: [{url, fetched_at}], collected_at }` + `makeEvidence()` / `evidenceSource()` / `isEvidenceEnvelope()` 工具；6 个 collector（SEO / Social / Competitor / Ads / AI Visibility / Reputation）所有 evidence 站点改用 envelope；每个 finding 附可审计的源 URL（client/competitor 域名、社媒 profile URL、Meta Ad Library、Google Ads Transparency、GBP）；9 个新单元测试 + 调整 2 处旧测试断言（社媒读 `evidence.parsed.top_posts_30d`、AI live probe 读 `evidence.parsed.live_probe`、competitor 读 `evidence.parsed.*`）；195 测试全过；build 通过
  `feat(diagnostic): P8.10.S2.6 — unified evidence envelope [P8.10.S2.6]`
- **P8.10.S2.F.1** — 张骞 → MB 预填扩展：`BriefSourcesForm` 自动从 `client_discovery.payload` 读 `seed_keywords` + `competitors`；`brief/generate` API + `runBriefPipeline` 新增 `seedKeywords` / `competitorDomains` 输入；prompts.ts 注入 "DISCOVERY ANCHORS" 段让 Claude 把高置信度种子词 / 竞品域名直接采用；pipeline insert 时 discovery 值覆盖 Claude 推断值；UI banner 显示预填数量；build + 174 brief/blog/content 测试通过；preview 验证 CYHB 客户 banner 显示 "8 个种子关键词 / 7 个竞品域名"
  `feat(brief): P8.10.S2.F.1 — discovery anchors prefill seed_keywords + competitors [P8.10.S2.F.1]`
- **P8.10.S2.F.2** — 博客 hero 图 prompt 拆成第二步：`blog/generator.ts` 移除主 Claude prompt 里的 `featured_image_prompt` 字段；新增 `buildHeroImagePrompt()` 在正文生成后调用 `generateVisualBrief()`，传入 MB 视觉 DNA + 提取的正文文本；MB 缺失时降级到基础 prompt；build 通过
  `feat(blog): P8.10.S2.F.2 — blog hero image uses generateVisualBrief() with MB visual DNA [P8.10.S2.F.2]`
- **P8.10.S3.1** — Competitor Analyst (Synthesis 层第 1 个模块)：新增 `src/lib/diagnostic/synthesis/competitor-analyst.ts` + `analyzeCompetitorLandscape()`，Claude Sonnet 4.6 把 `CompetitorEntry[]`（含 site_signals + meta_ads）合成两段 Markdown 叙事「Market Structure」+「Benchmarking Path」，输出 JSON + cost/model/generated_at；TDD 写 12 个单测（happy path / guard rails / 输出解析 / brief 注入），全过；diagnostic 207 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.1 — competitor analyst synthesis [P8.10.S3.1]`
- **P8.10.S3.2** — Dimension Narrator (Synthesis 层第 2 个模块)：新增 `src/lib/diagnostic/synthesis/dimension-narrator.ts` + `narrateDimension()` / `narrateAllDimensions()`，对单个 `DiagnosticDimension` (seo/ai_visibility/ads/social/reputation/competitor) 用 Claude Sonnet 4.6 生成 200–400 字三段式 Markdown 叙事「Current state / Root cause / Opportunities」，注入 findings 的 severity/recommendation/fix_type/evidence；score=null（未配置）也能产出说明；批量入口对空 findings 维度静默跳过。TDD 15 个单测全过；diagnostic 222 测试全过；build 通过
- **P8.10.S3.3** — Score Explainer (Synthesis 层第 3 个模块)：新增 `src/lib/diagnostic/synthesis/score-explainer.ts` + `explainScores()`，单次 Claude Sonnet 4.6 调用为 overall + 每个维度产出 60–120 字 Markdown caption「为什么是这分」，锚定 findings 的 drag-down/lift-up 与 weight × gap；输入校验 0–100 + 非空维度 + null 容忍；输出 reconcile（剔除未请求的 target、查重、强制 overall 必含）；TDD 21 单测全过；diagnostic 243 测试全过
  `feat(diagnostic): P8.10.S3.3 — score explainer synthesis [P8.10.S3.3]`
- **P8.10.S3.4** — Market Context (Synthesis 层第 4 个模块)：在 `src/lib/anthropic/client.ts` 新增 `callClaudeWithWebSearch` helper（server-side `web_search_20250305` 工具 + citation 抓取 + cost 计算）；新增 `src/lib/diagnostic/synthesis/market-context.ts` + `gatherMarketContext()`，Claude Sonnet 用 Anthropic Web Search 抓行业现状，按 market (au→AU+Sydney / nz→NZ+Auckland) 路由 user_location，产出 `industry_overview_md` / `key_trends[3-6]` / `category_benchmarks_md` / `opportunities_md` + citations + cost；输入校验 brand/industry/market/maxSearches + focusTopics 上限 10；TDD 24 单测全过；diagnostic 267 测试全过
  `feat(diagnostic): P8.10.S3.4 — market context synthesis [P8.10.S3.4]`
- **P8.10.S3.5** — Synthesis 持久化层：新增 migration `20260518000002_diagnostic_narratives.sql`（表 `diagnostic_narratives`：`run_id / client_id / kind / dimension / narrative_md / metadata / model / cost_usd / generated_at`，CHECK 约束 kind 枚举，UNIQUE INDEX 用 `COALESCE(dimension, '')` 处理 NULL，RLS 沿用 client_team）；新增 `src/lib/diagnostic/synthesis/persistence.ts`：`saveCompetitorAnalysis` / `saveDimensionNarrative(s)` / `saveScoreExplanations`（cost 只挂 overall 防重复求和）/ `saveMarketContext`（dimension=NULL + metadata 存 citations/trends）/ `loadNarrativesForRun`，全部走 `upsert(onConflict='run_id,kind,dimension')`，错误只 warn 不抛；TDD 11 单测全过；diagnostic 278 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.5 — diagnostic_narratives table + persistence [P8.10.S3.5]`
- **P8.10.S3.6** — Synthesis 结果注入 prescription-generator：`generatePrescription` 在加载 run+findings 后通过 `loadNarrativesForRun(supabase, runId)` 拉取 narratives；`buildPrescriptionPrompt` 签名加 `narratives` 可选参数；新增 `formatNarrativesForPrompt()` 按 kind 分桶渲染 4 段（Market Context / Competitor Analysis / Dimension Narratives / Score Explanations）注入 prompt；SYSTEM_PROMPT 加硬指令"必须将 Synthesis Insights 作为撰写处方的主要依据"（action description / KPI target_value / 阶段 1 快速动作 / summary 必须呼应）；narratives 为空时段落整体省略，对老 run 零影响；新增 2 个 TDD 单测 + 更新 supabase mock 支持 `diagnostic_narratives` 表的 `.eq().order().order()` 链；prescription-generator 10 测试全过 + diagnostic 280 测试全过；build 通过
  `feat(diagnostic): P8.10.S3.6 — inject synthesis narratives into prescription prompt [P8.10.S3.6]`
- **P8.10.S4.3 + S4.4** — `/diagnostic/report` 页落地 + 速览入口保留：新增 `src/app/dashboard/clients/[id]/diagnostic/report/page.tsx`，iframe 渲染 print-HTML + 浮层目录（H2 自动提取 + IntersectionObserver 高亮）+ 打印按钮 + evidence.json 下载；原 `/diagnostic` 6 维度评分卡作「速览入口」保留，Report 按钮从评分卡跳转到新页；S4.4 随 S4.3 一起完成
  `feat(diagnostic): P8.10.S4.3 — /diagnostic/report page (iframe + TOC + print + evidence download) [P8.10.S4.3]`
- **P8.10.S5.2** — 证据引用上标抽屉：report-generator 注入 `[[cite:kind:dim]]` 标记 → HTML 替换为 `<sup class="cite" data-idx>[N]</sup>`；`buildCitationRegistry` 分组 evidence_refs、顺序编号；`__cite_data__` JSON + postMessage JS 仅在有引用时注入；report/page.tsx 监听 `cite:click` message，EvidenceDrawer 展示来源 URL 列表；markdown artifact 自动 strip 标记；+4 tests，296 全绿，build 通过
  `feat(diagnostic): P8.10.S5.2 — evidence citation drawer ([N] superscript + postMessage) [P8.10.S5.2]`
- **P8.10.S5.3** — 导出 DOCX 按钮：新增 GET `/api/clients/[id]/diagnostic/report/docx`，拉 markdown artifact → `docx` npm 包生成 A4 Word 文档（Arial、样式化 H1-H3、bullet 列表、GFM 表格、inline bold/italic/code）；report 页头部新增 DOCX 按钮含 loading spinner，置于 Evidence 与打印按钮之间；build 通过
  `feat(diagnostic): P8.10.S5.3 — export DOCX button + /report/docx API [P8.10.S5.3]`
- **P8.12.S2.2** — 华佗案例库检索 skill：新增 `retriever.ts`（`retrieveSimilarCases`：industry_category 精确 + crisis_type 可选 + 预算 ±50% 区间 + market 筛选，附 outcomes KPI；`formatCasesForPrompt` 渲染案例段落）+ `saver.ts`（`savePrescriptionCase` 静默写库 + `deriveCrisisType` 从 priority_dimensions 提取）；`HuatuoLookupContext` 加 `similar_cases` 字段；agent.ts 在 Lookup Step 并行调 retriever；prompts.ts 注入案例段落；generate/route.ts `.catch()` hook 案例存档；16 新测试全过；41 case-library+huatuo 测试全过；build 通过
  `feat(huatuo): P8.12.S2.2 — retrieve_similar_cases skill + case saver [P8.12.S2.2]`
- **P8.12.S2.4** — 行业基准自动累积：`benchmark-accumulator.ts`（`calcPercentiles` P50/P75/P90 线性插值 + `accumulateBenchmarks` 按 industry_category/business_size/market/kpi_metric 分组）；`/api/cron/benchmark-accumulator` CRON_SECRET 鉴权；MIN_SAMPLE_THRESHOLD=5 冷启动保护；confidence 随样本量增长（封顶 0.95）；check-then-insert/update 无需 UNIQUE 约束；19 测试全过；build 通过
  `feat(huatuo): P8.12.S2.4 — benchmark accumulator (P50/P75/P90 from outcomes → industry_benchmarks) [P8.12.S2.4]`
- **P8.12.S3.5** — 本地行业目录竞品发现：新增 `src/lib/local-directory/`（types.ts + client.ts，Yellow Pages AU + Localsearch via Jina）；parseDirectoryMarkdown 解析 H2/H3 段、AU 电话 / 评分 / 地址、跳过导航 heading、上限 20 条；discoverLocalCompetitors 双源 Promise.allSettled + 去重 + limit；鲁班新工具 discover_local_competitors（prompts.ts 补 发按需调用段落）；31 测试全过；build 通过
  `feat(luban): P8.12.S3.5 — local directory competitor connector (Yellow Pages AU + Localsearch via Jina) [P8.12.S3.5]`
- **P8.12.S2.3** — 处方 KPI 反馈闭环：`outcome-recorder.ts`（`recordOutcome` + `backfillSemrushKpisForPrescription`，30/60/90 天节点 ±7 天窗口，去重写入）；`/api/clients/[id]/prescription/[pId]/outcomes` GET+POST；`/api/cron/kpi-backfill` SEMrush 自动回填（organic_keywords / organic_traffic / authority_score）；22 测试全过；build 通过
  `feat(huatuo): P8.12.S2.3 — KPI feedback loop (outcomes API + SEMrush cron backfill) [P8.12.S2.3]`
- **P8.10.S5.1** — 证据引用数据层：4 个 synthesis 结果类型（DimensionNarrativeResult / ScoreExplanation / CompetitorAnalystResult / MarketContextResult）加 `evidence_refs: string[]`；NarrativeRow 加 `evidence_refs` 字段，save helpers 写入 `metadata.evidence_refs`，load 时自动提取；lib/diagnostic/types.ts 新增 `extractEvidenceRefs` 工具函数；report-generator evidence.json findings + narratives 均带 refs；292 tests 全绿
  `feat(diagnostic): P8.10.S5.1 — evidence_refs data layer on findings/narratives [P8.10.S5.1]`
- **P8.10.S4.1 + S4.2** — Report Composer 落地：新增 `src/lib/diagnostic/report-generator.ts`，`generateReport(supabase, runId, clientId, opts)` 并发拉 run / client / findings / narratives，prescription 优先从 `prescriptions` 表按 (run_id, client_id) 读最新，缺时用 `intake` 调 `generatePrescription` fallback、无 intake 则段落省略；产出 3 件套：（1）完整 Markdown（标题 / 摘要 / 基线快照 / 6 维度详情含 score_explanation + dimension_narrative + 关键问题 / 竞品分析 / 市场上下文 / 处方建议 含 phases + KPI 表 + 预算表），narrative bucket 空则段落整体省略；（2）可打印 self-contained HTML，内嵌 `@page A4 + @media print` 规则 + h2 page-break-before + table page-break-inside avoid + 内置极简 MD→HTML 转换器（headings / paragraphs / 粗体斜体 / 列表 / GFM 表格）零外部依赖；（3）独立 `evidence-{run_id}.json`（findings 全量 + narratives 元数据），**不内嵌**到报告；TDD 12 单测全过（段落顺序 / 缺失数据"无数据"占位 / 空 narratives 段落省略 / prescription 优先读库 + fallback / HTML print CSS 校验 / 证据独立文件 / run 缺失抛错）；diagnostic 292 测试全过；tsc 无误
  `feat(diagnostic): P8.10.S4.1 — report composer (markdown + print HTML + evidence json) [P8.10.S4.1]`
- **P8.10.S0.15–S0.20** — 张骞/MB/视觉 brief 收尾增强（**并行 session 完成，commit message 误标 `[P8.10.S2.1]`–`[P8.10.S2.6]`，实际属于 P8.10.S0 范畴**）：Content modal 简化、`/content/generate` 重定向、张骞 confirm 跳转 `?brief=1`、MB 加视觉 DNA、BriefSourcesForm 自动预填、`visual_brief` 拆成独立第二步生成器
  - `refactor(content): remove image preview ... [P8.10.S2.1]` (2a10979) → 实际 S0.15
  - `refactor(content): redirect /content/generate ... [P8.10.S2.2]` (742d0f7) → 实际 S0.16
  - `feat(zhangqian): confirm → redirect ... [P8.10.S2.3]` (5227874) → 实际 S0.17
  - `feat(brief): add visual DNA fields ... [P8.10.S2.4]` (fe3b279) → 实际 S0.18
  - `feat(brief): BriefSourcesForm auto-prefill ... [P8.10.S2.5]` (62ab236) → 实际 S0.19
  - `feat(content): visual_brief split ... [P8.10.S2.6]` (5226929) → 实际 S0.20
  - 教训：并行 session 在同一分支工作时必须先确认 ROADMAP 真实任务编号才能起 commit tag

#### 🎉 Phase 12.A 总结（2026-05-17 完成，15 commits / 1 天）

**交付物一览：**
- 数据骨架：`flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 三表 + `execution_target` JSONB 列（M1 地基）
- 受控词表：6 个 GEO action_type + 5 个 metric_key 枚举，含运行时校验函数
- Adapter 抽象：`FlywheelAdapter` 接口 + Registry，支持 in_house / third_party / external_manual 三种执行形态
- GeoComposerAdapter：首个 adapter 实现，execute() 落库 + pullMetrics() 接口（M2 第一个 adapter）
- 执行看板：按 `execution_target.mode` 分发三种 UX（弹抽屉 / 跳路由 / 静态标签）
- FlywheelDrawer：POST /api/flywheel/execute → adapter.execute() 全链路（含 4 态 UI）
- 归因系统：Job（14 测试）+ Cron 路由（7 测试），窗口内算 baseline/after/verdict/confidence
- AI Tracker 集成：重跑时写 `flywheel_metrics`（mention_rate / avg_rank / engine_coverage）
- Outcome UI：执行看板卡片 outcome chip（8 测试）
- 华佗处方集成：新生成的处方天然带 `execution_target`（8 测试）
- 存量回填脚本：6 客户 `prescription_actions.execution_target` 完整填充
- CTS 端到端验证：真实数据跑通 action→metrics→attribution→outcome 全链路（verdict=confirmed, delta_pct=105.6%, confidence=0.95）
- 架构文档：docs/flywheel-architecture.md（186 行），含 10 步加 adapter 指南

**Phase 12.B 待细化任务（预告）：**
- SEO adapter（in_house，复用现有博客生成）
- Meta Ads adapter（CTS 真实广告数据接入，用 Meta MCP）
- 社媒内容生成 action 落库
- SEMrush 周快照写 `flywheel_metrics`
- SerpAPI Google AI Overviews 自建第 5 runner（低优先级）

### 2026-05-14

- **P8.12.S1.1 / S1.2** — 张骞 AU/NZ 本地数据连接器二连（Sprint 1）：
  - **S1.1 商业注册验证**：新增 `src/lib/abr/`（types + client + 19 单元测试）。统一封装 AU 的 ABR ABN Lookup（JSONP）与 NZ 的 NZBN API v5；`verifyBusinessRegistration` 高层兜底（缺凭证 / 网络错 / 无匹配均返回 null，不阻塞发现）。张骞新增 `verify_business_registration` 工具，`DiscoveredBusiness.registration` 字段（真实实体名 / 实体类型 / 注册年限 / GST 状态，不再由大模型编造）。
  - **S1.2 本地评价聚合**：新增 `src/lib/local-reviews/`（types + client + 13 单元测试）。GBP via SerpAPI `google_maps` engine + ProductReview.com.au via Jina Reader（反爬优雅降级返回 null）；`aggregateLocalReviews` 高层非致命兜底。张骞新增 `fetch_local_reviews` 工具，`DiscoveredReviewPlatform` 扩展 `rating_distribution` / `recent_negative_samples` / `response_rate`（差评样本作为诊断实证依据）。
  - 两项共新增 32 个单元测试，validators.ts 宽松校验新可选字段，prompts.ts 研究协议 step 1/4 + 工具说明 + 输出示例同步更新，build 通过。新增环境变量 `ABR_GUID` / `NZBN_API_KEY` / `SERPAPI_API_KEY`。
  `feat(zhangqian): AU/NZ 本地数据连接器 — ABN/NZBN 注册验证 + 本地评价聚合 [P8.12.S1.1/S1.2]`

- **P8.12.S1.3 / S1.4 / S1.5** — 华佗 AU/NZ 本地化三连（Sprint 1，顺序实现）：
  - **S1.3 季节日历**：新增 `src/lib/huatuo/seasonal-calendar.ts`（AU/NZ 公假 + 电商大促 + 南半球季节静态日历），`HuatuoLookupContext.seasonal_calendar` 字段，agent.ts Lookup 阶段同步注入，prompts.ts 嵌入「未来 90 天本地营销节点」段落。顺带修复 `filterNext90Days` 月索引误与年份比较的 bug，改用绝对月份索引 + 2 年日历支持跨年窗口。
  - **S1.4 预算定位**：`benchmarks.ts` 新增 `formatBudgetComparison`（客户月预算 vs 行业典型月预算区间，输出 ratio + 处方铺开范围指导），`formatBenchmarksForPrompt` 增加可选 `customerBudgetAud` 参数，生成 + 自评两处 prompt 均传入 `intake.monthly_budget_aud`。
  - **S1.5 Google Trends connector**：新增 `src/lib/gtrends/client.ts`（SerpAPI `google_trends` engine，TIMESERIES 12 个月搜索兴趣曲线，gl=AU/NZ），高层 `getIndustryInterestTrend` 非致命兜底，`HuatuoLookupContext.industry_interest` 字段，agent.ts Lookup 并入 Promise.all，prompts.ts 嵌入「行业搜索热度趋势」段落。
  - 三项共新增 43 个单元测试（seasonal-calendar 16 + benchmarks 9 + gtrends 18），build 通过。
  `feat(huatuo): AU/NZ 本地化三连 — 季节日历 + 预算定位 + Google Trends [P8.12.S1.3/S1.4/S1.5]`

- **P8.12.S3.4** — 鲁班 `publish_to_gbp` skill：新增 `src/lib/gbp/publisher.ts`（`publishToGbp`），优先调 GBP Management API 实时发帖；`GOOGLE_GBP_ACCESS_TOKEN` / `location_name` 缺失或 API 失败时降级为草稿模式，格式化草稿落库到 execution_logs，FDE 手动发布。注册为鲁班第三个工具。10 单元测试（4 降级 + 4 实时 + 2 草稿格式），build 通过。
  `feat(luban): P8.12.S3.4 — publish_to_gbp skill (draft degradation) [P8.12.S3.4]`

- **P8.12.S3.1** — 鲁班 tool loop 升级（Phase 8.12 MVP）：`callClaudeChat` 单轮对话 → `callClaudeWithTools` 通用 tool loop。新增 `src/lib/luban/tools.ts` + 首个工具 `add_work_log`（鲁班自主把对话结论写入 execution_logs）。`chatWithLuban` 签名/返回结构保持兼容，`callClaudeChat` 未动（brief refinement 不受影响）。新增 5 个单元测试覆盖 tool loop 核心路径。
  待办：UI 端到端实测「鲁班自主调用 add_work_log」需在 dev 环境完成。
  `feat(luban): tool loop 升级 — 鲁班可自主调用工具 [P8.12.S3.1]`

### 2026-05-07

- **P8.3.1** — 客户接入向导（5步集成 DNZ）完成
  `feat(onboarding): 5-step client onboarding wizard with DNZ integration [P8.3.1]`
  交付：`/dashboard/clients/new` 5步向导 + `useSiteAuditPolling` hook + Master Brief reminder banner + 删除旧 `/onboarding` 3步流程

- **Phase 9.0 P9.0.8–P9.0.9** — Visual Queue UX Polish
  `feat(visual-queue): P9.0.1-P9.0.3 UX polish`
  交付：`globals.css` 新增动画 · queued 状态 SVG 弧形环 · slide-in-x · scale-pop

- **Phase 8.2** — 策略驱动内容执行 P8.2.1–P8.2.3 全部完成
  `feat(strategy): Phase 8.2 strategy-driven content execution [P8.2]`
  交付：`pages-context.ts`（19 tests）+ `upgrade-generator.ts`（11 tests）+ 升级 API（7 tests）+ 升级 UI + `content-auditor.ts` 扩展（11 tests）· 共 48 tests

- **Phase 8.1** — 三维内容策略分析（P8.1.1–P8.1.6 全部完成）
  `feat(strategy): Phase 8.1 three-dimensional content strategy analysis [P8.1]`
  交付：`content_strategy_items` 表 + `scorer.ts`（41 tests）+ `analyzer.ts`（23 tests）+ generate/list API + 策略面板 UI · 共 101 tests

- **Phase 8.D** — DNZ 诊断策略层全部完成（P8.0.7 GEO计数修复 + P8.0.8 页面清单UI）

- **Phase 8.Q.4** — 内容帖子批量编辑 UI
  `feat(content): P8.Q.4 batch edit UI with status dropdown and delete`
  交付：批量 API（5种状态 + delete）+ 状态下拉 + 乐观更新 + 二次确认

### 2026-05-05

- **P8.0.6** — DNZ Async Framework API Routes & Cron
  `feat(dnz): implement P8.0.6 API routes and cron with TDD (133 tests, 99.37% coverage) [P8.0.6]`

- **P7.3.21-23** — GEO Deployment Assistant
  `feat(geo-composer): implement deployment assistant with revoke functionality [P7.3.21-23]`

### 2026-05-02

- **Phase 8.R** — Reels Studio 完成
  `feat(reels-studio): complete video generation pipeline with editing [P8.R]`

### 2026-05-01

- **Phase 8.6-8.9, 8.11** — DataForSEO 完整集成
  `feat(seo-intelligence): add DataForSEO link, serp, local, baseline, billing [P8.6-8.9, P8.11]`

- **Phase 7.1** — AI Visibility Tracker（5个引擎 Runner 上线）
  `feat(ai-tracker): launch openai, claude, perplexity runners with weekly scheduling [P7.1]`

- **Phase 8.C.1** — 月报整合（6大数据源聚合）
  `feat(reporting): unified monthly report aggregating 6 data sources [P8.C.1]`

### 2026-04-30

- **Phase 7.0** — 7项架构决策完成
  `docs(roadmap): finalize Phase 7.0 decisions [P7.0]`

- **Phase 7.2** — GEO Composer 核心库
  `feat(geo-composer): launch directive editor, generation, and snippet deployment [P7.2]`

- **Phase 7.3.1-5** — 双信号博客生成库（安全修复）
  `feat(blog-generation): dual-signal blog engine with SEO/GEO optimization [P7.3.1-5]`
### 2026-06-01（Website SEO Gap Research P29.SEO.10 完成）

- `docs/seo-gap-au-nz-2026-06-01.md` 落成，Magic Engine 公共站 AU/NZ 机会词 baseline 已整理成可复用报告

### 2026-06-01 (Website SEO Service Page Map P29.SEO.11 ���)

- docs/seo-service-page-map-au-nz-2026-06-01.md ��ɣ�ҳ�涨λ�ĳ� SME-first�����ʹ� agency ���澺��


### 2026-06-01 (Website SEO SME Service Briefs P29.SEO.12 ���)

- docs/seo-sme-service-briefs-au-nz-2026-06-01.md ��ɣ��ĸ� service brief ����ȷ SME-first ������ AU/NZ ҳ��˳��

### 2026-06-01 (Website SEO SME Service Page Drafts P29.SEO.13 完成)

- `website/ai-training.html`、`website/ai-automation.html`、`website/ai-marketing-smes.html` 以及 `/cn/` 对应页已上线，SME-first public surface 补齐
- `website/index.html`、`website/cn/index.html`、`website/robots.txt`、`website/sitemap.xml` 已同步新页面入口与抓取路径


---

