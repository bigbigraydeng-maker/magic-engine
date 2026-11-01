# 证据 · 2026-11-01-me-provider-event-intake-p1-await-pm · 2026-11-02
fetched_at: 2026-11-02T09:24:00+13:00

查了什么：这张卡判据里的四件事是不是真做完了（逐件对系统核，不是听 PM 说做了）。

数字（带样本量、取数方式）：
- ①生产库有表 provider_webhook_events：Supabase 只读 SQL（项目 CrazyContent）`select count(*) ... from public.provider_webhook_events` 能查到；2026-11-02 09:14 NZDT 读到 0 行，09:17 起读到 2 行（见 live-check 卡证据）。建表是 2026-11-01 PM 回「go apply」后应用的，应用的 SQL 与 PR 3483 头提交里的迁移文件逐字节一致（应用前先比过 SHA-256）。样本=全部（1 张表）。
- ②改动单已合并：pr:3483，合并提交 8b8472b27；是 PM 2026-11-01 18:41 NZDT 亲手合的（碰迁移，agent 不得用管理员权限）。
- ③Resend 后台已建回调并只勾 7 个事件：回调页头部「Listening for」显示 email.bounced、email.complained 另加 5 个，共 7 个；端点是 https://app.magicengine.com.au/api/webhooks/resend/system。2026-11-02 09:13 NZDT 在列表页行菜单点 Enable endpoint，页面提示 enabled successfully，列表状态 Enabled。同账号里另一条 portal 回调（别人建、早已启用）没动，仍是 Enabled。
- ④Render 已填 RESEND_WEBHOOK_SECRET_SYSTEM 并手动部署、部署时间晚于改变量：Render 事件页显示 2026-11-02 09:07 「Manually triggered by you via Dashboard」，09:12 Deploy live（用时 4 分 05 秒，提交 11dc86f）。部署上线前 09:08–09:12 对接收口发无签名空 POST，一直回 503 unavailable（密钥未读到）；09:12:31 起回 401 invalid_signature（密钥已读到、验签在跑）。变量值全程没被读取、没进聊天。
- 两边取数状态：Supabase 只读查询、Render 事件页截图、Resend 回调页截图、接收口探测，均取到。

结论：成。四件事都做到了，接收口已在真实收信（真实事件的核验见 live-check 卡证据）。
