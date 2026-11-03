# Celine 6 大社媒对接 —— Codex → Claude 交接（2026-10-20）

Codex 额度用尽，工作由 Claude 接手。来源：Codex 线程 `01a14536-24bd-7d51-ad9d-77dab9449295`（Celine 主线程）与 `01a15624-d1a8-75a1-925a-fdf1d04f7294`（Google 应用验证子线程）。

## 目标
把 Celine（client `f7d093d6-96d4-4b73-b5c9-0cdc03924149`）的 6 个社媒平台（Facebook / Instagram / TikTok / YouTube / Threads / X）接入 ME，授权记录写入连接表并能被核验。

## 各平台现状（截至 2026-10-20 10:53 NZ，Codex 最后汇报）
| 平台 | 状态 | 备注 |
|---|---|---|
| TikTok | 已连接 | 授权已保存，含发布权限 + refresh token；过期后 ME 不支持自动刷新，需重新授权 |
| YouTube | 已连接 | 通道 `UC2s7CY2-zLgsECm9fiJ07iA`（hello@magicengine.cloud 下的 Celine 品牌频道）；仅私享上传+读回，公开发布需另行授权；实时调用/上传未测 |
| Instagram | 未通 | ME 原生授权入口未开放 |
| Facebook | 搁置 | 按 PM 决定等公司认证（Meta Business verification） |
| Threads | 未通 | 无原生授权入口 |
| X | 未通 | 无原生授权入口 |

## 已有代码（未合并）
- PR #2926 `codex/social-oauth-verified-onboarding`：回跳时先读回保存记录再显示"连接成功"。评审遗留一处待修：读回校验只检查 `scopes` 是数组且含所需权限，未校验元素全为字符串（需补校验 + 测试）。
- 台账卡 `docs/ledger/2026-10-20-social-oauth-readback-confirmation.md` 在该分支。

## Codex 本地未提交改动（在 Codex 的目录，云端拿不到）
目录 `/Users/raydeng/Documents/ChatGPT/头脑风暴/magic-engine-social-oauth`，分支同上：
- 改动：`.env.example`、`docs/ENV.md`、`src/app/api/auth/google/connect/route.ts`
- 新文件：`docs/audits/2026-10-20-google-oauth-policy-draft.md`、`docs/audits/2026-10-20-google-oauth-verification.md`、`docs/ledger/2026-10-20-google-oauth-verification-preparation.md`
→ 这是"Google 应用验证"子任务的草稿。需要先由本机把这些文件提交推送，云端才看得到。

## Google 应用验证子任务（进行中）
ME 的 Google 应用还没通过验证，授权页显示"应用尚未验证"。Codex 已在 Google 授权流程里建了测试工作区 `[TEST] Google OAuth Verification`，正要用 `hello@magicengine.cloud` 走 9 项权限授权并录屏。PM 批准的范围：只动测试资源，不碰 Celine；**政策发布和正式提交前必须再问 PM**。最后一步停在：授权页显示的账号是管理员邮箱而非测试账号，Codex 正在切回 hello 账号，尚未给管理员账号新增权限。

## 下一步建议（按优先级）
1. 修 PR #2926 的 scopes 元素类型校验，补测试，推送。
2. 取回 Codex 本地未提交的 Google 验证草稿并入库。
3. 评估 Instagram 原生授权入口怎么开（`origin/codex/instagram-native-onboarding` 分支已有前序工作）。
4. Threads / X：先判断是 Build 还是 Connect（走 me-platform-tier-gate）。
5. 提交 Google 验证前停下问 PM。

## 红线
不替 PM 越过 Google 未验证警告；不发布、不上传视频；不碰 Celine 之外的客户授权。
