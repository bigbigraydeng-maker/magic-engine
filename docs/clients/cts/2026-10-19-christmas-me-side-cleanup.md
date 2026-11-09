# Christmas 团下架：ME 侧清理（2026-10-19）

只读排查结论（排查员 10-19）：没有在线中的圣诞团广告；没有已排期的发布；ME 订单表 0 单、0 笔定金；但有若干「仍开着、会再长出来」的口子。

## 已做（统筹，读回核对）
- 3 份圣诞团简报（campaign_briefs）active → archived。回滚：把这 3 条 status 改回 active（原 updated_at 分别为 2026-08-24 / 2026-09-14 / 2026-10-06）。
- 待办「Launch Christmas Tour Social Campaign」pending → superseded。回滚：改回 pending。
- 团目录：两个产品停用（isActive=false）；两个 2026-12-22 班期 open → closed。
- 团目录 16 个班期新价格见 2026-10-19-price-update-and-early-bird.md。

## 已派出（各窗口，做完回统筹）
- 74 号：Meta 官方户两个已暂停圣诞系列归档；留资表单里的圣诞选项记入清单。
- 97 号：过期每日计划 3 个、帖子 5 条、博客草稿 4 条作废/归档；再扫发布队列。
- 95 号：SEO 巡检待办关闭；post-publish-watch.json 摘 3 行；关键词清单停用圣诞词。
- 121 号（官网窗口）：官网 PR #249 全站下架 + 机器闸；PR #250 价格；#244 价格改 2,899。

## 还没人认领
- Mailchimp「Welcome new contacts」自动流程仍在发 Nov-Dec 2026 行程邮件；10-14 台账已定暂停但未见执行。
- offerings.yaml 与 clients.factory_config 里的 xmas-nye-akl / xmas-nye-chch（视频工厂价格事实）。
- ME 目标 goals ×2 / initiatives ×3 / 每周开方（含「圣诞团 + Golden China 招募」）：目标含 Golden China，不能整体归档，需负责人改标题与指标。
- 已报价 6 位客人、销售名单 11 人、留资表单选过圣诞团的 68 人：需 CTS 销售逐一告知（PM 决定）。
- 官网公开小册子 PDF 仍列这两个团（二进制素材，需重新导出）。
