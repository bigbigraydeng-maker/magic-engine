---
id: 2026-10-25-crm-non-enquiry-senders-and-retire-decisions
title: CRM 两件 P0：群发营销来信不再出现在「今天要联系」（挪到「先放着」并写明原因，不删不藏），今日决策清单页退役并入「Magic Engine 智能」（PM 回「修」；判据经子牙+魏征两轮复审后大幅收紧）
status: decided
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 合并部署后，①打开 CTS 的「全部客人 → ✨ Magic Engine 智能 → 今天要联系」，Vietnam Tours Direct(anzacvn@221832422.mailchimpapp.com) 和 Afterpay Team(hello@info.e.afterpay.com) 不应再出现；②展开「先放着」能找到这两个，原因写着「看着不是客人来咨询（群发…）」，抽屉、历史、联系方式都在，抽屉里仍可点「回了他」类按钮（= 没有凭空消失、没有变成死胡同）；③ZORAVYO、Twilio 通知、grokbot、chajense 这 4 个**仍会出现**（判据刻意不管它们，靠人点一次抽屉里的「不是有效咨询（退回）」永久清掉）；④访问 /dashboard/clients/<CTS>/crm/decisions 应自动跳到 /crm/all?view=smart，导航条不再有「决策清单（只读）」；⑤本地 `npx vitest run src/lib/crm src/app/dashboard/clients` 全绿
---
起因：PM 2026-10-25「这个窗口开始负责 CRM 持续优化，站在用户视角体验」。用他已登录的 Chrome 只读逐页实测 6 个 CRM 页面（清单见 docs/audits/2026-10-25-crm-pages-user-view-audit.md）。按 §11 三维打分两件判 P0（频率高/IMPACT 高/收入高），PM 回「修」。

**P0-1 垃圾来信排在「今天要联系」第 5 位**。根因：PM 10-21 要的「只留有效咨询」筛选器（src/lib/crm/enquiry-screen/）虽已合并，但名单路由和 contact-list-view 里 `grep decideScreen` 零命中——当时设计就是「开关先关、机器不自动移人」，等于需求没落地。

第一版做法是一个较宽的发件人形状判据，干跑在 CTS 当天数据上挡掉 7 个、看起来零误伤。**子牙 + 魏征两轮复审把它否了**，两人各自实跑出现有数据盖不住的真实误杀：
- `mail.tsinghua.edu.cn` / `mail.ncku.edu.tw` / `mail.sysu.edu.cn` —— 中国与台湾高校邮箱标准前缀就是 `mail.`，而 CTS 正在投 Natural China，这是核心客群；
- `info.co.nz` / `news.com.au` / `info.govt.nz` —— `co.nz`/`com.au` 本身占两段，被当成了营销子域；
- `chinatravel@chinatravel.co.nz` / `smithfamily@smithfamily.co.nz` / `stmarys@stmarys.school.nz` —— 「本地部分=域名首段」这条把自有品牌邮箱、家庭团、学校团全打了；
- `partnerships@flightcentre.co.nz` / `bd@trip.com` / `biz@jtb.co.jp` —— 这些是**送客来的同行**，而既有 `eligibility.ts` 本来就刻意豁免同行，新判据无声推翻了它；
- `li.wei@microsoft.com` / `jane.smith@google.com` —— 大厂分部订团建是真实高价单。

**改法：按「宁可漏筛，不错筛真客人」把判据砍到只剩三条高确信规则**——①发件域是群发服务中转（复用既有 RELAY_DOMAIN_SUFFIXES）；②本地部分是 noreply / mailer-daemon 这类机器发信地址；③域名里有明确的 ESP 发信子域标签（e / em / news / campaign / marketing / click…，**不含** mail / info / email 这些真机构也在用的），且根域不是 edu / ac / govt / school。删掉了供应商域名表、推销词表、「本地部分=域名首段」、系统账号名四条（系统账号那条另有实据：`contacts/route.ts:656` 早就在名单引擎之前过滤掉了，是死代码；而 `facebook 用户` 其实是「这个客人没留名」的占位词，按系统账号处理会误杀）。

接线也按复审改了四处：①只对「进线了还没人联系」这一段降级，**客户刚回信、员工自己约好今天回电的人绝不动**（魏征 P0-2）；②真人把阶段往前推过（已联系/已报价…）的人机器不再降级——这是唯一能推翻机器的通道，跟 `eligibility.ts` 的 `human_stage_change` 同口径（子牙 P0-2）；③保留原本的建议渠道，不改成 'none'，否则被误判的真客人抽屉里连「回了他」都点不了（子牙 P1-2）；④`verbOf` 补上新分段，否则名单上会出现「回他 —— 看着不是客人来咨询（…）」这种自相矛盾的指令（两人都指出）。

当场试跑（CTS 真实数据 1210 人 / 6952 条触点，只读、未写库）：今天要联系 372 → 370，只挪走 2 个（都是群发营销），逐个核对无误；「今天要联系」里剩余命中判据的发件人 = 0。**说明白：收紧之后 ZORAVYO(推销)、Twilio 系统通知、grokbot、chajense 这 4 个机器不再自动挡**，要靠人在抽屉里点一次「不是有效咨询（退回）」，点完阶段变「非咨询」永久不再出现——这个按钮已经存在且对这些人可用（`ReturnLeadPanel` 在阶段非 not_enquiry 时渲染的就是退回）。

**P0-2 今日决策清单页**：和「Magic Engine 智能」是同一批人同一套建议，但它是最慢的一页（实测 8.3 秒，`/api/clients/[id]/crm/today` 一个接口 6.9 秒/79KB），且按「等了多久」排序 → 等 127 天的排最前、昨天刚进线的真客人排到第 300 多位。做法：该页改成跳转 `/crm/all?view=smart`（保留老书签），导航移除入口；顺带让智能视图可用网址直达（以前刷新就跳回平铺名单，且初版写在 useState 初始值里会导致水合不一致，已按本文件既有的 `?contact=` 写法改到 useEffect）。
核实过：`/api/clients/[id]/crm/today` 全仓除这个已退役页面外**没有别的调用方**（魏征怀疑今日待办邮件在用，实查不成立），但它和 `src/lib/crm/decision-list.ts` 现在是第三份名单判据且不过新降级，留着没删，另开卡清理并在文件头标注「已退役，不要在此加判据」。

遗留：①上面那 4 个靠人点；要机器自动管，得启用既有的 enquiry-screen 完整管道（读消息内容 + 模型 + 写阶段 + 反馈学习），那是另一刀、要 PM 先看干跑；②判据三张表仍是源码常量、全客户默认生效——现在因为只剩高确信规则，跨行业是安全的（不再含 `bd@`/`biz@` 这类物流/OTA 的正常形状），但下一轮若要放宽必须先下沉成客户/行业配置并加开关；③审计清单里的 P1/P2/P3（团名显示机器代号、待认领页混进系统邮件、重复客户档案、测试数据在名单里）本轮没做。
