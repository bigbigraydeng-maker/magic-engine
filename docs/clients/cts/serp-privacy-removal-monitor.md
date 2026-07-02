# CTS Tours NZ — SERP 私人信息移除监控

> 客户: CTS Tours NZ · Google Ads owner Gmail: `bigbigraydeng@gmail.com`
> 建档: 2026-06-28 · 状态: **🔴 未彻底清除 — 待 PM 修 Location Asset source**

## 背景：泄漏了什么

PM 个人的 Google Business Profile (GBP) listing 数据被 Google Ads 自动当作 CTS C2
campaign 的 location asset，挂在 paid sponsored 卡上。泄漏内容：

| 项 | 值 | 归属 |
|---|---|---|
| 业务名 | `WARM VOYAGE` | PM 个人 GBP |
| 业务类型 | `Transportation service` | PM 个人 GBP |
| 地址 | `29 Mauranui Avenue, Epsom, Auckland` | **PM 个人家庭住址** |
| 电话 | `027 752 0888` | **PM 个人手机** |
| 营业时间 | `Open 24 hours` | PM 个人 GBP |
| 照片 | 黑色 SUV "WARM VOYAGE" logo | PM 个人 GBP |

**归属 = PM 个人**（非 CTS 老板/员工/CTS 官方 GBP）。根因链：Google Ads owner =
`bigbigraydeng@gmail.com`，该 Gmail 同时是 PM 个人 GBP 的 owner → Google 自动 link
进来当 ad location asset。

## 触发它的搜索词（google.co.nz, gl=nz, hl=en）

主：`best of china tour`。其他受影响（CTS C2 出广告的 NZ query）：
`china tours from nz` · `china tour packages including airfare from nz` · `cts tours` ·
`china tours from auckland` · `[best china tour]` Exact · `[china tours from nz]` Exact。

出现位置：**Google Ads paid sponsored 卡内嵌的 Location Asset / Business Profile Card**
（非第三方站、非 organic、非知识面板）。落地页是 CTS `/campaigns/best-of-china`，但卡上
业务名/地址/电话/照片全来自 PM 个人 GBP。

## 处理历史

### 2026-06-26 NZT (~11:00–13:00) — 第一次止血（不彻底）

- **A. PM 在 GBP 端**：登 `business.google.com` 切 `bigbigraydeng@gmail.com` →
  删除 `WARM VOYAGE` listing。
- **B. Claude 在 Google Ads 端**：`Tools → Shared Library → Location manager →
  Settings` → uncheck "Give Google Ads permission to use merchant-uploaded photos…"
  → Save → 确认 dialog "Opt out"。
- **故意没做**：未断 `Linked accounts → GBP: bigbigraydeng@gmail.com` 这条 location
  source；未 Reset Advertiser Identity（`PENG YU DENG` → `CTS Tours`，长期 root fix,
  Google Ads task #82 pending）；未用 Remove outdated content / SC URL removal（不适用,
  非 organic 收录）。
- 当天约 30 分钟后**登录态**复测 `best of china tour`：业务名/类型/照片消失 —— 当时误判为
  "已清"，但**没做隐身复测、也没逐项核查地址/电话**。

### 2026-06-28 — 48h 验证（登录态 + NZ IP，Chrome MCP get_page_text，未点广告）

跑 `best of china tour` + `china tours from nz` 两条 query。结果：

| 项 | 状态 |
|---|---|
| 业务名 `WARM VOYAGE` | ✅ 清除（卡显示 "CTS Tours"）|
| 业务类型 `Transportation service` | ✅ 清除 |
| 照片 | ✅ 应已清（merchant photo opt-out 生效）|
| 地址 `29 Mauranui Avenue, Epsom, Auckland` | 🔴 **仍显示** |
| 电话 `027 752 0888` | 🔴 **仍显示** |
| `Open today · Open 24 hours` | 🔴 **仍显示** |

两条 query 的 CTS sponsored 卡底部均带：
`29 Mauranui Avenue, Epsom, Auckland‎ - 027 752 0888‎ - Open today · Open 24 hours`。
（`china tours from nz` 上 "Differentiation Angles" 变体干净不带地址，"Brand Defense"
变体带。）

## 根因诊断

6/26 的两个动作各自只解决一半：删 GBP listing + opt-out merchant photos 杀掉了
**业务名 / 类型 / 照片**；但**地址 / 电话 / 营业时间来自独立的 Location Asset**，绑在
`Linked accounts → Google Business Profile: bigbigraydeng@gmail.com` source 上，6/26
故意没动。"删 GBP listing = location source 自动清空" 的假设是错的 —— Google 仍用缓存
location asset serve，48h 后照旧。

## 修复（待 PM 授权 + 操作 Google Ads）

二选一/都做：

1. **断 source（推荐，根治）**：`Tools → Linked accounts → Google Business Profile
   → Unlink`，斩断 `bigbigraydeng@gmail.com` location source。
2. **删 location asset**：`Campaigns → Assets → 筛 Locations → 找 29 Mauranui Avenue
   那条 → Remove`（account + campaign 两层都查）。

注：移除 location asset/extension 非 keyword 改动，一般不重置 learning。这是个人 PII
泄漏的隐私紧急情况，优先级高于 "learning 期别动" 常规约束。**操作权在 PM。**

长期 root fix 仍是 task #82：Reset Advertiser Identity `PENG YU DENG` → `CTS Tours`
（提交 CTS 营业执照走 5-15 工作日审核，未启动）。

## "彻底清" 成功标准（修复后复验用）

> 隐身模式 `google.co.nz`（NZ IP / gl=nz）搜 `best of china tour` /
> `china tours from nz` / `cts tours` / `china tour packages including airfare from nz`，
> CTS sponsored 卡上无任何 `WARM VOYAGE` / `29 Mauranui Avenue` / `027 752 0888` /
> `Transportation service` / `Open 24 hours` / 黑车照片，且 CTS sponsored ad 仍正常
> serve（有 headline / description / sitelinks）。

### 隐身手动复验步骤（PM 30 秒）

1. Chrome 新开 **隐身窗口**（⌘⇧N），确保未登录任何 Google 账号。
2. 逐条搜上述 4 个 query（已在 NZ，无需 VPN）。
3. 看每条 CTS sponsored 卡底部是否还有 `29 Mauranui Avenue` / `027 752 0888`。
4. 全部不带地址/电话 + CTS 广告仍出 = 通过；否则修复未生效，回到上面「修复」。

## 凭证

- 2026-06-28 Chrome MCP `get_page_text` 输出（本 session transcript）确证地址/电话仍在。
- 2026-06-26 处理无 Google removal request ID / 回执（走的是改 ad settings，非 takedown）。
