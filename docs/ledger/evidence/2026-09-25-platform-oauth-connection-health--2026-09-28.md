# 证据 · 2026-09-25-platform-oauth-connection-health · 2026-09-28

fetched_at: 2026-09-28T09:15:00Z

查了什么：直接读 2026-09-27 19:01 UTC 那封真实「今日待办」邮件全文（hello@magicengine.cloud 收件箱，Gmail 只读）

数字：
- 🔌 系统进不去、要你点一次的 栏里，逐字出现：
  - 「CTS Tours NZ：客户邮箱（bdm@ctstours.co.nz）的授权已经断了 12 天」
  - 「NZCPE 2026：Facebook / Instagram（New Zealand China Products Expo）的授权已经断了 21 天」
  - 「Roman HU：Facebook / Instagram（Roman Hu Real Estate）的授权已经断了 21 天」
  - 三条都带可点的重连链接（Roman HU 那条是 ?settings=platform，即客户页平台连接抽屉）
- NAL 谷歌搜索数据「不在取数名单里」这条**没有**出现在邮件正文——邮件末尾写着
  「23 件开发欠账...在后台「开发欠账」清单里，转给开发窗口就行...都不算你的事」

来源/命令：mcp Gmail search_threads + get_message（PLAIN_TEXT），线程 id 1a0e43e409a849ae；
代码交叉核对 src/lib/pm-todo/platform-connection-items.ts（devLaneItem 分支，注释写明"dev 车道"）

结论：成（含一处口径更新）。卡上要求的 Roman HU / NZCPE Facebook 断线、CTS bdm@ 邮箱断线三条，
在真实今日待办邮件里逐字确认命中，链接格式正确。卡上另一半要求（NAL 谷歌数据"不在取数名单里"要出现在
"系统欠账"栏）现在结构性地不会出现在 PM 邮件里——这是 2026-09-26 台账 pm-todo-five-kinds 那次 PM 拍板
"今日待办只留 5 类、开发欠账挪出邮件"的后果，不是这条 OAuth 断线告警功能本身坏了。devLaneItem 分支代码
还在（platform-connection-items.ts 210-244 行），这类判定会进「开发欠账」看板，只是不再塞进 PM 每日邮件。
