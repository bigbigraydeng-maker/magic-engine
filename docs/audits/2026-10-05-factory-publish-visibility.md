# 视频工厂发布环节可见性（A 级）— 设计审、实施审、测试证据

日期 2026-10-05 · 分支 claude/gracious-heyrovsky-93b282 · 范围见 PR 正文。

## 改动
1. `markFailed` 与「上次发布中断」分支写 `reject_reason`（经 `sanitizeFailReason` 脱敏：令牌、网址、存储路径、`fbtrace_id`、≥40 位长串；截断 200 字）；发布成功时清空旧原因。
2. `flywheel_actions.vendor` 改为渠道常量（facebook→`meta_graph`，与 `factory-reel-measurement-adapter` 同名；其它→`publer`），不再写死 `oztop_facebook`。客户靠每行的 `client_id` 区分。标题回退：brief.angle → 工单 angle 列 → 品牌名 → `Reel`。
3. `GET /api/factory/work-orders` 补取 `published_ref`，只外发 `published = {video_state, permalink, published_at, provisional}`；永久链接只接受 facebook.com / fb.watch 的 https，无账号密码。
4. 看板：已发布（草稿，未公开）/ 已公开（带链接）/ 发到一半中断 / 已在平台上（公开状态未核实）四种徽章；失败原因仅在失败类状态显示。
5. `ReviewInbox` 过期文案「定时器尚未启用」已更正。

## 审查
- 设计审：子牙（vendor 应是渠道而非客户；成功要清 reject_reason；路由必须拆掉原始 published_ref）、魏征（sanitize 的 URL 正则会吞 JSON、中断分支没写原因、provisional 要区分）——全部采纳。
- 实施审：子牙放行；魏征要求改的（链接带账号密码、存储路径/fbtrace_id 漏网、测试假绿、中断分支无测试）已改。页 id 不算敏感，未抹。
- 未采纳：把测试压到 150 行以内（实际超出，PR 正文已说明）。

## 偏离 PM 指令之处
PM 原文「vendor 按客户配置推导，没有就写通用 facebook」→ 实际写 `meta_graph`：两位审查员都指出 vendor 是执行渠道、客户已在 client_id 列，且同一动作的另一处写入已用 `meta_graph`。
