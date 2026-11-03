# 证据：通话后发邮件 · 对所有客人放开（台账卡 2026-11-02-crm-post-call-email-opened-to-all）

取数人：127 号窗口。取数时间：2026-11-02 21:02–21:10（新西兰夏令时）。PM 在 127 号窗口回「开」。动作 = 在 PM 已登录的 ME 后台页面里调 `PUT /api/clients/<CTS>/crm/email-settings`（`baseVersion: 6`、`confirmUnrestricted: true`），追加发信设置第 7 版；这个接口只有全局管理员能写，「功能开着又清空灰度名单」必须带明确确认。

| 判据 | 取数 | 结果 |
|---|---|---|
| 第 7 版写入 | 响应 200 `{ok:true, version:7}`；库里 `crm_email_settings` 第 7 版：created_by = PM 账号，created_at = 11-02 21:02:45，change_note 写明「回『开』：清空灰度名单…」 | 通过 |
| 只改了灰度名单 | 第 7 版 enabled=true、recipient_allowlist=null（原来是 2 个地址）；两版 jsonb 各去掉名单后直接比较，结果为真，即逐项相同：7 天最多 2 封、同模板冷却 24 小时、通话提示 24 小时、不允许对没咨询过的人发第一封、每人每小时 30 / 每天 100、邮箱每天 200、发信邮箱 info@、链接白名单 2 个域名、禁用规则 3 条、页脚为空 | 通过 |
| 放开生效 | 改前对 4 位真实客人（都没有邮件线程）调 `GET .../crm/contacts/<客人>/email`：4 位都是 `canCompose:false`，原因 `recipient_not_allowed`（「试运行期间只能发给测试地址」）；改后同样 4 位：都是 `canCompose:true`，发信邮箱 info@ctstours.co.nz | 通过 |
| 这一步没有发出任何邮件 | `crm_email_send_receipts` 与 `conversation_outbound_log` 自改动前 5 分钟起都是 0 行 | 通过 |
| 两份模板仍停用 | `post-call-single-tour` 最新版第 7 版 disabled，`spring-2027-follow-up` 最新版第 5 版 disabled | 通过 |
| 发信邮箱连接正常 | `platform_oauth_connections`：info@ctstours.co.nz 状态 active，令牌 11-02 20:11 刷新（bdm@ 为 10-15 退役的 revoked，不用于发信） | 通过 |

怎么收回：用同一个接口再追加一版设置，把 `recipient_allowlist` 写回地址名单（比如只留 hello@magicengine.cloud），或把 `enabled` 改成 false；需要全局管理员账号。

没覆盖（别当成已验证）：放开后的真实使用情况（看第一周的发信记录，见卡的 verify_how）；一对一跟进信是否需要退订说明（NZ 反垃圾邮件法）未问过法务，页脚现在为空；放开后销售自己写的第一封信走的是「咨询过我们才能发」那条规则，这次没有对真客人发过信去验它。
