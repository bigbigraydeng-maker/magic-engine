# 证据：通话后选模板发邮件 · 10-29 试跑（台账卡 2026-10-28-crm-post-call-template-email-impl）

取数人：127 号窗口。取数时间：2026-10-29 16:11–17:15（新西兰夏令时）。只读查询 + 在 PM 已登录的浏览器里亲手点「发送」真发 1 封（PM 回 `试跑` 授权，只许发给 hello@magicengine.cloud 这个测试联系人）。
样本：1 个测试联系人、1 封真发、7 次被拦；不代表群发多的情形。

| 判据（来自卡片 verify_how） | 取数 | 结果 |
|---|---|---|
| 三张新表在库里 | 迁移 `crm_email_templates`（版本 20261029030255）应用后只读核对：3 表开启行级权限且只有服务端角色的策略、6 个触发器、`crm_email_send_receipts_attempt_key` 唯一索引；另在一次整体回滚的事务里跑 18 条行为断言（追加型表改 / 删被拒、匿名读写被拒），18/18 通过，事后三表仍为 0 行 | 通过 |
| 真发 1 封并收到，线程里只有一封 | 16:20:55 真发（回执 `sent`、`human_click`，有消息编号和会话编号）；hello@ 的 Gmail 按主题核对恰好 1 封；CRM 邮箱同步（每小时 :12 一轮）17:12 那一轮跑完后（17:14 只读复核）：该联系人今天的邮件会话仍 1 个、消息 1 条（不同消息编号 1 个）、发出邮件的记录（触点）仍只有这封信那 1 行，没有被同步记成两条 | 通过 |
| 回执表有一行 sent 和一行因 7 天上限被拦的 blocked | `crm_email_send_receipts` 共 8 行：1 行 `sent` + 7 行 `blocked`（`frequency_cap` count=4、`content_blocked`、`link_host_not_allowed` ×3、`placeholder_left`、`duplicate_template`），没有 `failed` / `unknown` | 通过 |
| Inngest 云端看得到对应事件和成功的函数运行 | production：16:20:56–16:23:40 共 8 次 `CRM email: settle a send whose outcome was unknown`，触发事件都是 `crm.email_send.attempted`，全部 Completed、每次不到 1 秒；抽开 `sent` 那次（耗时 442ms）输出 `{"status":"skipped"}`，与设计一致 | 通过 |

没覆盖到（别当成已验证）：「状态不明 → 10 分钟后对账补结论」线上没触发过；「7 天最多 2 封」的数值 2 没直接触发（试跑把上限临时调到 4，触发的是同一套计数逻辑，结束已改回 2）；邮件客户端会不会把中文域名整串变链接；群发很多人时逐封查 Mailchimp 的耗时。
两边取数状态：数据库（只读查询成功）、Inngest 云端控制台（只读查看成功）、Gmail（按主题搜索成功）。试跑结束时开关已关回、两份模板已停用、上限已改回 2。
