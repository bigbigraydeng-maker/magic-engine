# 证据 · 2026-11-01-me-provider-event-intake-p1-live-check · 2026-11-02（①–④；⑤ 要等上线满 7 天）
fetched_at: 2026-11-02T09:26:00+13:00

查了什么：回调启用后，生产链路是否按设计工作——伪造被拒、封数×事件数=行数、Replay 不重复、重发能不能通过验签。

数字（样本：1 封内部测试信 → 2 条事件；三边取数状态——Resend 回调页、Supabase 库、接收口响应——都取到了）：
- ① 伪造请求：2026-11-02 09:13:10 NZDT 向接收口发带假签名的 POST（事件号 msg_forged_check）→ HTTP 401 {"ok":false,"error":"invalid_signature"}；随后查库：该事件号 0 行，全表仍 0 行。成。
- ② 封数 × 事件数 = 行数：09:16:55 NZDT 通过官网留言表单（POST /api/contact，PM 当面回「发测试」同意）向 ME 内部收件箱发 1 封。Resend 回调页事件列表出现 2 条（email.sent、email.delivered），都是 Success、HTTP 200、首次投递 Attempts 1；库里 2 行（sent 1 条、delivered 1 条），provider_event_id 与 Resend 页显示的事件 ID 一致（delivered 为 msg_3LWK7gTIEsWt1hcenxbbikcIyMh），同一个 provider_message_id；入库时间比事件发生晚约 1.2 秒。1 封 × 2 条事件 = 2 行。成。
  入库内容核对（只查结构，没读 payload 内容）：provider = resend、account = system；payload 里没有 subject（按设计已删）；data 的键是 created_at、email_id、from、headers、message_id、to；每行约 430 字节。
- ③ Replay：09:18 左右在 Resend 后台对 email.delivered 点 Replay，约 09:22:35 再点一次（距原投递 5 分半以上）。两次之后事件页 Attempts 依次是 2、3，最新响应都是 {"ok":true,"duplicate":true}（HTTP 200）；库里始终 2 行（delivered 仍 1 行，最后入库时间没变）。结论：Replay 沿用同一个事件号，被当成重复，不会重复入库。成。
- ④ 重试是否被接受：上线以来没有出现过失败投递（2 条都是 Success），所以「失败后 Resend 自动重试」本身未观察到。但第二次 Replay 发生在原投递约 330 秒之后，超过我们 300 秒的时间窗仍被接受（200），说明 Resend 重发时会重新签名、带新时间戳；自动重试大概率同理，不会被时间窗挡掉（自动重试本身要等真遇到失败才能最终确认）。
- ⑤ 上线满 7 天（Failed = 0 且表里有行）：未到期，留给 verify_by；日历提醒 11-09。

副作用与清理（务必知道）：
- 留言表单在网站线索表 website_lead_events 多写了 1 行：id 7b63ba52-b3d0-41a0-9c6e-285f35eb6228，2026-11-02 09:16:55 NZDT，source = internal_test_resend_p1（用它过滤）。没有删（删生产数据要 PM 点头）。
- ME 内部收件箱收到 1 封标题含「内部测试 Resend回执核验」的邮件。
- 库里这 2 行是原始流水，按设计保留 180 天后由后续清理任务处理（保留期清理卡另跟踪）。

来源/命令：
- 接收口探测与伪造请求：curl 对 https://app.magicengine.com.au/api/webhooks/resend/system（无签名空 POST、假签名 POST）。
- 库：Supabase 只读 SQL（项目 CrazyContent），查 provider_webhook_events 的计数、事件类型、事件号、入库时间与 payload 结构（不 select payload 内容）；查 website_lead_events 里 source = internal_test_resend_p1 的 1 行。
- Resend 回调页（Webhooks → 该回调 → Events）截图与 Replay 按钮；没有点、没有读 Signing secret。

结论：①–④ 成（④ 的「自动重试」子项未观察到）；⑤ 待到期。
