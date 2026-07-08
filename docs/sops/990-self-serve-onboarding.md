# $990 自助 Onboarding SOP（🟩 self_serve 轨专用）

> **轨道边界**：本 SOP 只适用于 **$990 founding 中小客户**（`client_portal_users.access_type = 'self_serve'`）。FDE 月付客户走 [`client-onboarding-access-requirements.md`](./client-onboarding-access-requirements.md)。
> **更新日期**：2026-07-08
> **产品依据**：[$990 增长引擎启动包 spec](../superpowers/specs/2026-07-07-990-growth-engine-package-v1.md) · [自助 onboarding 向导 spec](../superpowers/specs/2026-07-08-990-self-serve-onboarding-wizard-v0.1.md)

---

## 🎯 核心原则：自助优先，上门兜底

> $990 面向水电/屋顶/装修等小 trades 老板。他们**很多自己搞不定 OAuth 授权**。所以 onboarding = **客户能自助的自助（省 FDE 工时，守 B5 ≤15h 红线），搞不定的用上门那一次（B2 承诺）当场帮连。**
>
> 不假设 100% 自助，也不退回 100% 人工。

---

## 📋 客户自助部分（客户在 ME 里自己走）

> 注：自助向导本身在建（见向导 spec，待 3 审）。向导上线前，这些字段由 FDE 在客户 dashboard 代填——**但目标状态是客户自己走完下面 5 步**。

| 步 | 客户做什么 | 完成判定 |
|---|---|---|
| 1 生意档案 | 确认名称/行业/服务城市/主关键词 | `brief_completed_at` 有值 |
| 2 网站 | 填域名；无网站 → 走 $99 单页站分支 | `domain` 有值 或 $99 单页站建站单已建 |
| 3 连接账户 | GBP + GA4/GSC（真授权）· Meta（填广告账户 ID） | 对应连接器 status = connected |
| 4 上传素材 | logo · 作品照 · 老客户名单 | `client_assets` 有上传 |
| 5 提交完成 | 触发首次诊断，通知 FDE 复核 | `onboarding_completed_at` 有值 |

**✅ 守卫已放开（2026-07-08）**：self_serve 现在能走连接器 connect/status + gsc/ga4/platform 绑定路由 + 域名写入（`requireOnboardingClientAccess`，四审通过）。向导 UI 未上线前，这些字段仍可由 FDE 在客户 dashboard 代填/上门代连——但**目标状态是客户自己走完**。

---

## 🤝 FDE 兜底部分（客户自助搞不定时）

### 签约后 0–3 天：Kickoff（含上门，B2 硬边界）

- [ ] **上门见面一次**（B2 承诺，也是信任差异化）——带什么：
  - 笔记本 + 手机热点（现场帮客户连 OAuth 用）
  - 服务清单一页纸（客户老板留存）
  - 收款/合同确认（签约收全款，见合同）
- [ ] 现场帮客户走完向导卡住的步骤（尤其 Step 3 授权：GBP Manager / Meta 商务权限 / GA4）
- [ ] 现场收素材：翻拍/收老板手机里的作品照 + 老客户名单（评价引擎用）
- [ ] 当场装一次询盘表单到客户网站（验证权限够不够）

### 客户义务追踪（spec §5：签约后 7 天内提供）

| 义务项 | 收到? | 逾期处理 |
|---|---|---|
| 网站后台权限 | ☐ | 逾期该项**顺延**，不计入退款判定（合同写明） |
| GBP 管理员授权 | ☐ | 同上 |
| Meta 商务账户授权（种草轨） | ☐ | 同上 |
| 老客户名单（评价引擎） | ☐ | 同上 |
| 作品照片/素材 | ☐ | 同上 |
| 投放预算（若走蓄水池承诺） | ☐ | 无预算 → 蓄水池承诺不生效（方案 A） |

> **关键**：逾期是客户责任，**顺延不算我们违约**（退款挂交付、不挂客户不配合）。每项收到打勾，逾期登记，别默默扛。

---

## 🔐 权限分级（对齐 $990，比 FDE 轨轻）

| 平台 | 需要角色 | 必要性 | 备注 |
|---|---|---|---|
| **GBP** | Manager | 🔴 必须 | 即时搜索轨的命脉 |
| **网站后台** | Editor/Admin | 🔴 必须 | 装表单 + SEO + GEO snippet |
| **Meta 商务**（种草轨） | Ads + Insights | 🟡 种草轨必须 | 装修/建筑/园林/地板客户 |
| GA4/GTM | 我们帮建 | 🟢 不要求预存 | **$990 客户多半没有——我们在他账户下新建**，不是要他先有 Editor |

> **和 FDE 轨的关键区别**：FDE 轨硬门槛「GA4/GSC 必须给 Editor，不齐不能签」。**$990 轨不套这条**——GA4/GTM 是交付项（我们帮建，spec §1.3），不是签约前置。

---

## 🚨 无网站客户分支（$99 单页站）

spec §1：无网站客户 → **$99 单页信息站为前置门票**（单页站 + 表单 + GBP 挂接），完成后才进 90 天主流程。

- [ ] 收 $99 → 建单页站（客户自己域名，红线：不建在 ME 域名）
- [ ] 挂询盘表单 + GBP 链接
- [ ] 完成后回到上面 Step 3 起继续

---

## 🔒 红线（沿用既有规则）

- 评价只**请求真实老客户**，绝不代写/买评
- 客户对外页面**必须在客户自己域名**
- 不凭空注入客户业务数据、不编数字
- 单客户人工 **≤15 FDE 小时**（B5）——超出靠自助向导/模板扛

---

## 📚 关联文档

- [$990 服务边界 spec](../superpowers/specs/2026-07-07-990-growth-engine-package-v1.md)
- [自助 onboarding 向导 spec（待 3 审）](../superpowers/specs/2026-07-08-990-self-serve-onboarding-wizard-v0.1.md)
- [FDE 月付轨 onboarding SOP](./client-onboarding-access-requirements.md)
- [90 天交付驾驶舱](../../src/lib/delivery/template.ts)（onboarding 是第 1 步）
