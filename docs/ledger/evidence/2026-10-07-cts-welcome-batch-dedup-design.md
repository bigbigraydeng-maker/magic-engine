# CTS 每日 8:02 欢迎批次去重 · 生成者查明 + 最小改法设计（只读调查，2026-10-07；未改任何配置）

承接 `docs/ledger/evidence/2026-10-07-cts-welcome-batch-compliance.md`（98% 的批次收件人早已收过自动流程的 Welcome email）。
本文件回答：谁每天建批次、为什么会重复、批次还有没有价值、怎么改最小。邮箱不落盘。

## 一、生成者：PM 自己 Google 账号里的表格脚本（Apps Script），不是 Zapier / Make / 本仓库

- 项目名 `CTS CRM Mailchimp Tag Sync`（5 个任务线的脚本，v5），在 Apps Script「我的触发器」里有一条定时触发：`dailySendE1Batch`，每天新西兰 8:02 前后跑，最近一次 10/6 8:02:36，错误率 0%。
- 同项目还有：`dailySendE2Batch`(8:13)、`dailySendE3Batch`(9:05, 错误率 50%)、`dailySendE4Batch`(9:15, 错误率 33%)、`syncNewLeadsToMailchimp`(每小时，错误率 0.63%)、开信回填、客户回复检测。
- 代码实际做的事（`runE1Batch_`，只读看过，没改）：读 Meta 表单那张 Sheet1 → 凡是「E1 已发」那一列为空且有邮箱的行 = 待发 → 查每人的 Mailchimp 标签，只排除三种：`sales_active`、`suppressed_do_not_email`、`nurture_2027` → 剩下的人建当天的标签 `auto_e1_batch_日期` + 静态分群 → 复制模板活动（E1 模板）→ 立即发送 → 回填 Sheet1「已发 日期」。
- **它从头到尾不知道 Mailchimp 里有个「Welcome new contacts」自动流程**，所以流程已经发过的人，照样进批次。这就是重复的原因。
- 排除清单里没有 `paid_customer`，这是合规核查里「9/1 那封有 2 个已付款的人」的来源（另一件事，本次不动）。
- 其他排除项：Make 里 3 个场景全是关闭状态且不含建活动步骤；本机定时任务、`render.yaml`、`src/app/api/cron` 里都没有；Zapier 的「Sheets→Mailchimp」那条 Zap 9/15 已被 Zapier 因试用到期自动停用，而批次 9/15 以后每天照发 → 与 Zapier 无关。（Zapier 网页我没登录，未去看，也不需要。）

## 二、欢迎流程那边（Mailchimp 后台只读看过）

- 流程 `Welcome new contacts`，编号 3209，状态 Active，只有一步：有人订阅 CTS Tours 名单 → 立刻发 `Welcome email`（主题 Your Nov-Dec 2026 China itinerary is ready）。
- 唯一筛选条件：不带 `suppressed_do_not_email`。没有延迟，所以新人几分钟内收到；批次要等次日 8:02，这就是「通常早约 18 小时」。
- 成绩（后台报告，7/27–10/7）：发 443 封，打开 56.3%，点击 22.7%，退订 0.93%。
- 批次 E1（9/2 起 31 个批次、263 人，API 汇总）：独立打开 137 人(52%)，点过链接 39 人(15%)。

## 三、两封信是不是同一封？

| | 欢迎流程那封 | 8:02 批次那封（E1 模板） |
|---|---|---|
| 主题 | Your Nov-Dec 2026 China itinerary is ready | Your China itinerary inside · Baker from CTS Tours |
| 开头文案 | Baker 个人自我介绍 + 20 年经验 + 邀请回信 | 同一段 Baker 自我介绍，文字几乎一致 |
| 内容 | 短（约 4KB），只有 1 个团列表链接 | 长（约 18KB），带 34 页电子手册 + 多个具体团页链接 |
| 发出时间 | 订阅后几分钟 | 次日 8:02 |

结论：**同一个人设、同一段开场白，发两遍，不是「新模板 vs 旧模板」。** 批次那封内容更丰富（有具体团页链接，符合 `docs/sops/cts-newsletter-send-checklist.md` 第 1 条），欢迎流程那封更快但内容薄。

## 四、批次还有没有存在价值？—— 作为「第二封欢迎信」没有；作为「流程漏网兜底」有一点

- 只读推演：9/2 起 263 个收件名额里 259 个已收 Welcome；**此刻待发的 18 个新订阅者（10/6 8:02 之后进名单的人）18 个全部已收过 Welcome。** 明早 8:02 若不改，这 18 人会又收一封。
- 批次里不在流程范围内的情况极少（4/263）。要兜底的是「流程没发到的人」，这件事用「先查是否已发，没发才发」就能自动做到，不需要整个批次继续对所有人发。
- E2–E4 后续信：9/2 起 0 封发出（每个模板各只有 7 月的零星活动），链条实际已经不在产出；但代码要求 E1 那一格以「已发 日期」开头才会排 E2/E3/E4，所以**不能直接把 E1 整个停掉或留空**，否则以后要复活后续信就没起点。
- 建议：**不退役脚本、不停触发器，在选人那一处加一个「已收过欢迎流程那封信就跳过」的判断，并把那格写成「已发 日期（欢迎流程）」**。效果等于批次只剩兜底，重复归零，后续链条的起点保留。

## 五、最小改法设计（Apps Script 里约 25 行，PM 点头后才动）

判断「某人是否已收过欢迎流程那封信」：Mailchimp 报告接口 `GET /reports/{Welcome email 的活动 id}/sent-to/{邮箱md5}`，200 = 发过，404 = 没发过（只读，我用真实 18 人试过，18/18 返回 200；该活动 id 以 ef66 开头，见上文表格里的活动）。

在 `runE1Batch_` 里、`getExclusionReason_` 之后加：

```js
const WELCOME_JOURNEY_CAMPAIGN_ID = 'ef66fec9b0'; // journey 3209 "Welcome email"

function gotWelcomeJourney_(email, apiKey) { // true 已发 / false 没发 / null 查不到
  const url = 'https://' + MAILCHIMP_DC + '.api.mailchimp.com/3.0/reports/' + WELCOME_JOURNEY_CAMPAIGN_ID + '/sent-to/' + md5Hex_(email);
  const resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Basic ' + Utilities.base64Encode('anystring:' + apiKey) }, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  return code === 200 ? true : code === 404 ? false : null;
}
```

循环里（在原有 `reason` 判断后的 else 分支）：

```js
const got = gotWelcomeJourney_(t.email, apiKey);
if (got === null) return;                       // 查不到：这次不发，留空，明天再试（宁可少发不重发）
if (got) { sheet.getRange(t.rowNum, S1_COL_E1_SENT).setValue('已发 ' + new Date().toISOString().slice(0, 10) + ' (欢迎流程)'); return; }
sendable.push(t);
```

dry-run 分支（`if (dryRun)` 之前那一行）同样调用并只打日志「X 个已收欢迎流程、Y 个会发」，不写表格、不建活动。

- **怎么试跑**：PM 点头、脚本改好后，先跑现成的 dry-run 入口只看日志；真实对象用当时 Sheet1 里 E1 那格为空的行。我已用 Mailchimp 数据做了只读推演：18/18 已收，改后明早批次应是「0 人可发」。
- **怎么回滚**：Apps Script 的「版本历史」一键恢复改前版本；已被写成「已发 …(欢迎流程)」的格子是文字，不会发信，可保留或手工清空。回滚前后都没有任何邮件被误发的路径（改动只会让发的更少）。
- 风险：报告接口限流/超时 → 返回 null → 这次不发，只会少发不会多发；欢迎流程那封活动 id 若将来换了，判断会一律 404 → 退回今天的行为（重复），所以换流程时要同步改这个常量。

## 六、本次没做、也不建议顺手做

- 没改 Apps Script、Zapier、Mailchimp 任何配置，没发/暂停任何邮件。明早 8:02 那批会照常发。
- 欢迎流程那封内容偏薄、只有一个团列表链接（对照发送清单第 1 条），是否把批次那封的具体团页链接并进欢迎流程，是内容决定，另开一件事。
- `paid_customer` 不在批次排除清单里，另开一件事。
- 调查过程中的一次误操作：读脚本编辑器时键盘翻页把几个字敲进了编辑缓冲区（未保存），已撤销，页面恢复「已保存到云端」且第 14 行是原文；没有任何改动落到脚本。
