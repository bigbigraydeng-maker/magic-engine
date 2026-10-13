---
id: 2026-10-12-story-lite-preview-page
title: Story 预览页（授权这一周 / 停）已做出来，等 PM 看过再合；真发开关仍没开
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 看 PR 是否经 PM 本人回「合」后合并；合并后 PM 在 /dashboard/clients/<CTS 客户 id>/story 打开页面，顶部应写「演练模式：不会真发」，没有周包时应写「现在还没有要授权的 Story 周包」；周包入库、真实 Meta 调用、真发开关每一项 PM 没另批就保持未做
---
PM 10-12 回「做预览页」。页面地址：/dashboard/clients/<客户 id>/story（CTS 的客户页「内容生产」里有「Story 自动发布」入口）；只有全局管理员能用。
页面只调已合并的预览 / 授权 / 停接口，另加一个只读的「周包列表」接口 GET /api/clients/<客户 id>/story-lite。
未做：周包入库（含公开存储上传）· 真实 Meta 调用 · 真发开关 · Instagram。
