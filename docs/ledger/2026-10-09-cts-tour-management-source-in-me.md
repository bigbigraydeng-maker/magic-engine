---
id: 2026-10-09-cts-tour-management-source-in-me
title: CTS 的团目录（名字/行程/展示价/出发日期/班期状态）由 Magic Engine 统一管理，网站、邮件、广告、社媒、内容工厂、客户回复都读同一份，与客户将来的下单系统用 CSV 对接；表单先做三项（房型 Double/Twin、两层团下拉、护照自查）
status: decided
owner: agent
decided_on: 2026-10-09
source: session:1a85e0eb
verify_how: 打开 CTS traveller-details 表单，确认有 Double/Twin 房型、两层团下拉、护照自查三项；ME 后台能看到团目录，且网站、邮件、内容工厂、客户回复读到的是同一份；订单/付款/剩余座位数/正式报价单不在 ME 里
---
PM 2026-10-09 拍板并明确同意边界：团目录源头放 ME（CTS 无团管理系统，团数据全写在网站代码里），ME 只存对外展示的团目录（团名/行程/展示价/出发日期/班期可售状态快照），不存订单、付款、剩余座位数、正式报价单；客户自建的下单系统是交易事实源，双方用 CSV 同步。此决定覆盖 2026-09-14 方案「价格/出发日期不进 ME」的旧口径；待办：另开 A 级 PR 改 ME_PRODUCT_DEFINITION §3.2，问 PM 后才合。
设计稿 docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md（子牙+魏征两轮复审已吸收，未授权实施）；2027 出团表与官网班期差异见 docs/clients/cts/2026-10-09-2027-departures-vs-website.md。PM 补充：CTS 网站没有后台，放进 ME 正好补上"能在页面里管理"这一块；护照自查方案 PM 已看过认可，做好后由 PM 直接验收。
现状（按实际调用方盘点）：①网站内部读取口返回 33 个团；②`clients.factory_config.render.creatomate.offers`（`src/lib/content/price-fact-gate.ts`）；③`client_knowledge_facts`（`src/lib/messenger-agent/tools.ts` 的 `getClientKnowledge`）；④`group_tours` 表 `payload.price`（`src/lib/conversions/cts-tour-price.ts` 的 `lookupTourPrice` 优先读它，调用方 `src/lib/conversions/cts-crm-sheet-sync-run.ts:498` 用它写 CRM 成交金额，须改接目录，否则陈旧价格会写进成交金额）；⑤手工 offerings.yaml（无生产调用方）、`master_briefs.products`、市场分析副本。收拢清单必须含 `group_tours` 及 `lookupTourPrice` 调用方。
做法：①traveller-details 表单加房型/两层团下拉/护照自查（草稿 PR bigbigraydeng-maker/chinatravel#227，未上线）；②客人档案表另立台账卡 2026-10-09-cts-guest-profile-shared-table 单独验收；③团目录建表+CSV 导入+切换网站与各渠道（动已上线网站，需 2 审）。
2026-10-10 进展（表单①）：PM 两轮体验反馈后简化成「每间房一行 + 床型按钮 + 需要时才展开换搭配」，一位旅客时不出现房间步骤。我在内置浏览器手机/桌面各走一遍，测试 agent 独立实测 12 项 10 过，2 个真问题（先选床型再加人后加的人没房；单人房仍能点 Double/Twin）与 2 处小瑕疵已在 chinatravel 提交 c796c15 修完并复测；PR #227 仍为草稿，等 PM 本机确认后交 CTS 审核，未上线。本机试用页 http://localhost:3010/traveller-details。 2026-10-10 上线（表单①）：PM 在对话里说「安排上线」。chinatravel#227 两项检查通过后 squash 合并（主干提交 9ba7095，01:43 UTC），Render 自动发布约 4 分钟后生效。线上 https://www.ctstours.co.nz/traveller-details 手机宽度实测：团三级联动（Best of China 出 11 March / 13 May 2027）、填表人名字带入旅客 1、单人提示单房差 NZD $800、生日填未来日期被拦、两人自动同房、无横向滚动、控制台无报错。未验证：真实提交后 CTS 邮箱收信（未点提交，避免给客户邮箱发假登记）。本卡其余两项（客人档案表、团目录）未上线，状态保持 decided。
