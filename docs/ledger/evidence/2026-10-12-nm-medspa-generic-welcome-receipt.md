# NM Medspa Messenger 欢迎语改通用 · 回执（2026-10-12，PM 回「改」）

方式：Meta 官方接口（NM 主页授权，只在内存里用）。素材不可原地改，故新建素材 + 新建暂停广告，审核过再开新停旧。

| 对象 | 编号 | 最终状态（开新停旧后） |
|---|---|---|
| 旧素材（旧广告在用，未动） | 2345835076259645 | 未动 |
| 旧广告 | 120253210692010216 | PAUSED（已停） |
| 第一版新素材/新广告（只换欢迎语，作废不用） | 1091268433687659 / 120253241855580216 | 广告保持 PAUSED，不启用 |
| **第二版新素材**（欢迎语 + 自动跟进语都去掉新客限定） | 1970457273619995 | 已建 |
| **第二版新广告**（原广告组 120253076137240216 内） | 120253241930970216 | ACTIVE（审核通过，已开） |

改前欢迎语（三处：文字版/图片版/视频版）：`Welcome to NM MedSpa! Ask us about our NZ$158 Signature Escape for new clients.`
改后欢迎语（同三处）：`Welcome to NM MedSpa! Ask us about our NZ$158 Signature Escape – 75 minutes of head-to-toe relaxation.`
改前自动跟进语：`Hi! Still interested in the 75-minute NZ$158 Signature Escape for new clients? Send us your preferred day and time and we’ll check availability.`
改后自动跟进语（PM 12 日回「去」）：`Hi! Still interested in the 75-minute NZ$158 Signature Escape? Send us your preferred day and time and we’ll check availability.`
未动：三条常见问答及自动回答、标题/正文/按钮/视频/主页/IG 身份。

读回核对：新旧素材逐字段比对，只有上述四处文字不同（欢迎语三处+自动跟进语一处）；AI 增强开关两边都是全 OPT_OUT。
差异（未验证项）：新素材读回时欢迎语在 video_data 里，旧素材是素材顶层字段；预览图不显示欢迎语，实际投递是否一致未能验证，需开新后发测试消息确认。
回滚：第二版新广告改回 PAUSED；旧广告保持/改回 ACTIVE（旧素材 2345835076259645 未动）。

## 开新停旧（PM 12 日回「换」，审核通过后执行）
- 第二版新广告 120253241930970216：PAUSED → ACTIVE，读回 ACTIVE/ACTIVE（启用后短暂 IN_PROCESS，约 1 分钟内转 ACTIVE）。
- 旧广告 120253210692010216：ACTIVE → PAUSED（素材 2345835076259645 未动，可随时改回）。
- 广告组仍 ACTIVE，结束时间 2026-10-19 不变。
- 回滚：新广告改回 PAUSED、旧广告改回 ACTIVE。
- 未验证：客人侧是否真看到新欢迎语（预览不显示），需发测试消息确认；本次未发。

## 待核实（PM 已知悉并拍板，仍须核实）
- 套餐优惠是否仅限新客：客户没有官网，系统里查不到条款；依据只有客户自己写的广告欢迎语/跟进语（含「for new clients」）和旧问答「Is the NZ$158 offer for new clients?」（见 docs/ledger/2026-10-10-nm-medspa-ad-faq-published.md）。
- 12 日汇报时已向 PM 明说「去掉限定后老客可能误以为也能享受、条款未核实」，PM 仍回「改」「去」「换」，风险由 PM 接受；不因机器评审意见自行暂停广告或恢复限定。
- 若之后客户确认仍限新客：把新广告改回 PAUSED、旧广告改回 ACTIVE 即恢复限定文案。
- 验收（夜巡之外还需人做）：从在投新广告发一条测试私信，核对欢迎语和自动跟进语是新文案；本次未发。
