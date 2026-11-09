# 缺登录检查的写接口审计（2026-10-05）

范围：`src/app/api/**/route.ts` 里 372 个 POST/PUT/PATCH/DELETE 接口，逐个读过代码（中间件不覆盖 `/api`）。
已修：content/route-a、route-b、route-c（PR #2247）。下表是**其余**需要处理的，按优先级排；其余 ~290 个已有真实检查，不在表内。
优先级判据（ENGINEERING_QUALITY_GATES §11）：花钱或写客户数据 = 高；只写平台级数据 / 可被滥用但不花钱 = 中；低影响 = 低。
调用方均来自 grep `src/ scripts/ render.yaml .github/`；"无"表示全仓没找到，外部调用未查。

| 接口路径（src/app/api/…） | 花钱 | 写库 | 调用方 | 优先级 / 建议 |
|---|---|---|---|---|
| visual/video | 是（Seedance） | 是（任意客户素材） | 后台 visuals 页 | 高：requirePaidClientAccess |
| visual/upload | 存储 | 是（公开桶，≤500MB，还会改桶配置） | 后台 visuals 页 | 高：登录 + 归属 + 收紧桶 |
| visual-assets/[assetId]/upload-version | 存储 | 是（可覆盖别家交付素材） | 后台 visuals 页 | 高：按素材所属客户校验 |
| reports/[clientId]/monthly/recommendations | 是（GPT-4o） | 否（但泄露别家月报数据） | 后台月报页 | 高：requirePaidClientAccess |
| admin/viral-references（POST/GET） | 是（Gemini，一次≤30条） | 是 | 后台爆款库页 | 高：guardGlobalAdmin |
| admin/viral-references/discover | 是（YouTube 配额 + Gemini） | 是 | 同上 | 高：guardGlobalAdmin |
| admin/viral-references/upload | 是（Gemini） | 是（写服务器临时文件无大小上限） | 同上 | 高：guardGlobalAdmin + 大小上限 |
| admin/viral-references/[id]/retry | 是（Gemini） | 是 | 同上 | 中：guardGlobalAdmin |
| admin/viral-references/analyze-pending | 否 | 否（只读计数） | 同上 | 低：guardGlobalAdmin |
| baselines/domains/[id]/collect | 是（Semrush） | 是 | 后台行业基线页（推断） | 中：guardGlobalAdmin |
| baselines/domains/[id]（PATCH/DELETE） | 否 | 是（请求体整包 update） | 同上 | 中：guardGlobalAdmin + 字段白名单 |
| baselines/domains（GET/POST） | 否 | 是 | 同上 | 中：guardGlobalAdmin |
| visual-assets/[assetId]/edit-status | 否 | 是（改终稿状态） | 后台 visuals 页 | 中：按素材所属客户校验 |
| flywheel/execute | 否 | 是（可伪造飞轮动作记录） | 后台 FlywheelDrawer | 中：requireDashboardClientAccess |
| visual/avatar | 是（HeyGen） | 是 | **无** | 中：确认无外部调用后删除路由 |
| transcript | 是（Supadata） | 否 | **无** | 中：确认无外部调用后删除路由 |
| visual/queue、visual-assets/[assetId]/versions | 待查 | 待查 | 后台 visuals 页 | 待确认：扫描时才发现，需读代码 |
| voice/tenants/**（requireVoiceAdmin 偏松） | 间接（语音） | 是 | 后台语音页 | 中：改用 guardGlobalAdmin 判据（受限管理员可改任意租户） |
| webhooks/publer-published（无来源校验） | 否 | 是（可伪造"已发布"） | Publer | 中：加密钥/回查 |
| reel-batch/start、approve；team-memory/*（密钥比较写法） | 间接（渲染） | 是 | 无 / 本机钩子 | 中：独立密钥 + 常数时间比较 |
| public-scan/keyword-gap | 是（DataForSEO） | 否 | 无 | 中：公开接口，加限流 |
| contact | 是（邮件，可被当垃圾邮件中继） | 是 | 官网表单 | 中：限流 + 人机验证 |
| scan/run、public-scan/start、discover/register、clients/[id]/leads、auth/self-register | 是 | 是 | 官网/注册页 | 中：限流靠可伪造的 X-Forwarded-For，改用 Cloudflare 访客标识 |
| discover/leads、training/leads、report/[id]/interest、unsubscribe/[id] | 低 | 是 | 官网 | 低：公开，仅需限流 |
| content/route-b 的 video_url、三路由 platforms | 登录后付费用户自烧额度 | 是 | 后台抽屉 | 低：限定 http(s) 与枚举 |
| 自助版用户点"生成内容"被拒的提示 | — | — | 后台抽屉 | 低：需 PM 定自助版是否该能用 |
