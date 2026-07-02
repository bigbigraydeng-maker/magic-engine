# CTS Tours NZ — 2026-07-03 Session Log: SERP PII 修复 + Google Ads IS 诊断与 Rebalance

> 客户: CTS Tours NZ · Google Ads 账号: China Travel (105-817-1329, ocid 8055941472)
> Google Ads owner: `bigbigraydeng@gmail.com` · ME client_id: `c0000000-0000-0000-0000-000000000000`

## 1. SERP 私人信息 48h 复测 — 未通过, 已根治

6/26 首次处理 (删 GBP listing + opt-out merchant photos) 只清了业务名/类型/照片,
**地址 `29 Mauranui Avenue` + 电话 `027 752 0888` 仍挂在 CTS sponsored 卡上** —— 根源是
账号级 Location Asset 关联 (`Business profile: bigbigraydeng@gmail.com`, All locations
selected) 未断, 删 GBP listing 不会自动清空它。

**处理**: Google Ads → Campaigns → Assets → Associations (筛 Location) → 勾选该关联 →
Remove → Confirm。**未撞 2FA**, 一次生效。

完整背景/触发词/凭证见 [serp-privacy-removal-monitor.md](./serp-privacy-removal-monitor.md)。

## 2. 冲突负面词解封

`[china tour packages including airfare from nz]` (Exact, Differentiation Angles) 被
account 级 negative `"including airfare"` 挡住两天。走 Recommendations → Remove conflicting
negative keywords → Apply。优化评分 87.5%→89.4%(→92.9%, 系统后续自动吸收新建议)。

30 天累计首日追踪: 4 clicks / 9 impr / $10.03 / 0 conv — 印证是低量长尾词, 解封是流程卫生
而非流量爆发。

## 3. Google Ads Impression Share 诊断 + 预算 Rebalance

**背景**: 两个 campaign 均标 "Eligible (Limited) — Targeting fewer searches", NZ 大盘相关
搜索量 +56% 但账号 clicks 未同步跟涨。

**诊断方法**: 走新沉淀的 SOP [google-ads-impression-share-diagnosis.md](../../sops/google-ads-impression-share-diagnosis.md)
(IS 三件套 + 30天/7天双窗口 + keyword 级下钻 + 信心分级)。关键发现:

- **Differentiation Angles ($60/d)**: 30 天 lost-budget 20.7%, 但 7 天仅 **5.7%** —— learning
  成熟后预算问题已大幅缓解, Google budget simulator 用的旧窗口数据会误导加预算。
- **Three Tours + Brand Defense ($30/d)**: IS 仅 12.9%, lost-budget 37.5% + lost-rank
  49.6% 两头挨打。keyword 级下钻确认品牌词 `"cts tours"` (全账号最便宜转化, $5.57/conv)
  IS 55.3% 但预算丢失仍 ≈41% —— 搜品牌名的场次四成因预算耗尽输给竞品广告。

**PM 拍板 `go rebalance`**, 总预算 $90/d 不变, 内部重分配:

| Campaign | 改前 | 改后 |
|---|---|---|
| Differentiation Angles | $60/day | **$50/day** |
| Three Tours + Brand Defense | $30/day | **$40/day** |

**执行**: Chrome MCP 逐行编辑, 第二笔 Save 撞 "Confirm that it's you" 2FA, PM 本人过认证后
重按 Save 生效。两笔均已核实生效, 账号总额仍 $90/day。

**待验证 (下次 session 跟进)**: 3-7 天后回查同组 IS 三件套 —
① Brand Defense lost-budget 是否如预期从 37.5% 收窄、品牌词展示份额是否回升
② Differentiation Angles 降预算后 lost-rank/转化量是否维持 (验证"该 campaign 已不缺预算"成立)。
