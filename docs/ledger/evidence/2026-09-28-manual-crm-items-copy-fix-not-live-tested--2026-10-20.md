# 证据 · 2026-09-28-manual-crm-items-copy-fix-not-live-tested · 2026-10-20
fetched_at: 2026-10-20T22:30:00+13:00
查了什么：PM 每日待办邮件（hello@magicengine.cloud 收件箱，主题「📋 今日待办 · 周二 · 35 件」，发送于 2026-10-19T19:01:47Z 即新西兰 10-20 早上）里是否有「永久别再联系」条目，文案是否为新写法。
数字（样本量 1 条、邮件取数成功）：邮件中 1 条 Christine Matehaere「被标成永久别再联系」条目，其行动说明为「点链接直接就打开他的抽屉了 —— 联系方式下面有一条黄条…」，没有旧文案「就地展开」；整封邮件全文搜不到「就地展开」。
来源/命令：Gmail 只读 search_threads(subject:待办 newer_than:5d) → get_thread PLAIN_TEXT，线程 1a1558a97abd98b4。
结论：成。真实发出的邮件里已是新文案「打开他的抽屉」，旧文案已不出现。
