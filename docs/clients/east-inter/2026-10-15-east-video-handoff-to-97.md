# East Inter 视频出片交接（111 号 → 97 号统筹，2026-10-15）

**一句话**：东际第一条 Facebook 视频（混剪 v5，工单 `9ddac532-2441-480b-9dd5-3e5ad10eca8f`）已过苏东坡（文案/价格）+ 马良（真实渲染件）复审，**没有发布、没有设任何开关**，等 PM 授权。PM 定了先做完统筹规划功能，再安排 CTS/East 社媒与广告发布。

## 1. 工单现状（生产库 `content_work_orders`，客户 East `2e3f040d-4497-4527-89f6-50b6fa91e205`）
| 工单 | 是什么 | 状态 |
|---|---|---|
| **9ddac532-2441-480b-9dd5-3e5ad10eca8f** | **混剪 v5，当前定稿** | in_review，苏东坡+马良已通过 |
| b872551f-… | v4（仅结尾板未过） | 旧版，建议作废/归档 |
| bf7fe47c-… / c716f7ee-… | v3 / v2（均不通过） | 旧版，建议作废/归档 |
| 6403582c-… | A 版纯数字价格卡（出片机链路验证，配文含「link-check」字样） | **绝对不能发**，建议作废 |
共同：`goal_id` 用的是 **占位草稿目标** `4160565f-df4a-403c-a725-ad7e9a0f9d74`（18 号建，不参与广告自治，正式目标由广告计划另定）；`master_brief_id=09aae30e-160e-494f-b25c-98ff22a1ef72`；花费 0；预算上限 0.5 美元；全部纯出片机本机渲染，**没调任何付费生成接口**。
我没有处理旧工单（没有写库权限之外的授权）；作废要走审核页/PM 或 97 号。

## 2. 成品内容（v5）
- 16.8 秒、1080×1920、有音轨（共享乐库 `Horizon's Call`，PM 听过无人声）。字幕序列：1 / CBM / CHINA / TO / SYDNEY / ≈A$378 / DOOR / TO / DOOR / CLEARANCE / INCLUDED / CURRENT / PRICES / ONLINE / NO / SIGN-UP / ≈（结尾静止价格板）。
- **post 配文**（工单 `brief.copy.caption`，苏东坡定稿）：`Indicative estimate. Final charges are subject to a binding quote. China to Sydney by sea (from Guangzhou), door to door, current rates: about A$378 for 1 CBM (1 m³); 5 m³ A$1,238; 10 m³ A$2,252. Please confirm taxes, duties and insurance with the team before booking. Illustrative footage only, not East Inter's own vessels, facilities or staff. Live estimate in the first comment.` 首条评论链接 `https://www.eastinter.com.au/eastinter-pricing-calculator`（系统会加追踪参数）。
- **Story 首帧**（静图，不是 Story 成片，与封面不同）：Dropbox `MagicLab_Studio/East_Inter/review-assets/v4-story-first-frame.png`（5 m³ to Sydney · Melbourne · Brisbane / A$1,238 / Same estimate for all three）。封面帧参考 `review-assets/v5-frame-0.png`。
- 素材：Pexels 授权的通用物流场景，全部写「Illustrative footage」，来源逐条登记在 `MagicLab_Studio/East_Inter/remotion-assets/clips/SOURCES.txt`；**不是东际实拍**，不得暗示是东际的船/仓库/员工。

## 3. 证据位置
- 仓库 `docs/clients/east-inter/2026-10-14-east-trial-video-plan.md`（方案；第 7–9 节竞品报价与 Spotyard 分析，第 10–14 节各版过程与自检）。
- **价格回执（线上计算器真实页面截图）**：`docs/clients/east-inter/evidence/2026-10-15-live-calculator-{sydney-1cbm,sydney-5cbm,sydney-10cbm,melbourne-5cbm,brisbane-5cbm}.jpg`；v5 结尾帧 `…v5-endcard-frames.jpg`；各版分镜 9 宫格/封面/Story 首帧同目录。
- 复现用参数：`docs/clients/east-inter/2026-10-15-east-montage-preview.props.json`（v5 montage props）。
- 台账卡：`docs/ledger/2026-10-15-east-trial-video-a-done-b-pending.md`、`2026-10-14-east-redline-phrases-added.md`、`2026-10-14-east-video-factory-wiring-plan.md`。

## 4. 发布前必须再核（我没做的）
1. **PM 本人另授权发布**（谁发、发哪个 Page、何时）。发布走工厂发布口，不另写脚本。
2. **再对一次线上计算器**：悉尼 1/5/10 m³ = A$378 / A$1,238 / A$2,252；墨尔本/布里斯班 5 m³ = A$1,238（布里斯班约 25 天）。官网没有生效日期，价格会变；变了要重出片。
3. **真播放一次出片机渲的存储桶文件**（我没有存储钥匙，审片页要登录，我自己看的是本机同参数预览；马良已看过真实件）。
4. 东际禁用词已入库 22 个（countdown/limited time/ends soon/last chance/deadline/early bird/cheapest/lowest price/best price/倒计时/限时/截止/最低价/最便宜 等）；**配文与评论不要写「最便宜/最低价」**：澳洲本地 Spotyard 公开价（A$245–274/m³，写称税已含，口径很窄）与 FB 广告「from AUD 170」都低于东际；东际只在同类中文圈货代里更低（好望角 A$439、递接 A$510，1 m³）。
5. 官网域名：`eastinter.com.au`（`www.` 会跳转）。
6. 结尾 CTA/评论里的链接必须是上面计算器页；不要用 `magicengine.com.au/<客户>`。
7. 发布后按 `docs/clients/east-inter/2026-10-14-ads-plan-one-pager.md` 的口径做 7/14 天对比；询盘归因是已知后续项（见 `2026-10-14-east-ads-plan-followups-from-2618` 卡）。

## 5. 模板限制（别再反复试）
- montage 模板**第一个词必须以数字开头**；每个词开头 3 帧从 1.7 倍「砸入」，宽词那 0.1 秒会超边（马良已认可）；镜头层每段开头 5 帧 1.22→1.04 缩放+抖动；**logo 固定左上、只在最后 2 拍**，不能居中放大；字幕里的「m³」会被规范成「m3」，所以视频里写 CBM。
- 结尾板的绕法：节拍数组允许任意间隔，把结尾做成一个 3 秒长镜头段（只在入场缩放一次），内容放安全区 y≈470–1250（y>1248 是 FB 界面遮挡区）。要 logo 居中/全屏结尾板必须改模板（加 endcard 参数），属开发窗口，按规矩由 DeepSeek 写、子牙+魏征审。
- 第一帧缩略图：模板第 0 帧最大放大，内容必须在安全边距内（封面板 X 130–950）。

## 6. 运维踩过的坑（出片机/线上）
- 线上白名单 Render `FACTORY_WORKER_CLIENT_IDS` 已含 CTS、Oztop、East；出片机 `.env` 的 `FACTORY_REMOTION_CLIENT_IDS`/`FACTORY_CLIENT_STUDIO` 已含 East（`East_Inter`）；素材/品牌包在 `MagicLab_Studio/East_Inter/{brandkit,remotion-assets,review-assets}`。
- 出片机开机自启文件（launchd plist）里曾写死「只领 CTS」，会盖住 `.env`；现已由 106/18 号去掉，**以后看出片机配置要先看启动文件**，不能只看 `.env`。
- Render 页顶有红条「Payment failed」，PM 需处理，否则线上可能停服务。
- 提交 remotion 工单需 `goal_id`（NOT NULL）；East 暂无正式目标，沿用占位目标。
