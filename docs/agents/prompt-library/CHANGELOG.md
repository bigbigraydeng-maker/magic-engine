# Prompt Library — 变更日志

> 管理人：李白 Agent  
> 规则：每次修改任何提示词文件，必须在此追加一条记录。

---

## 格式

```
## YYYY-MM-DD [文件名] vX.Y
- 变更内容：[具体改了什么]
- 变更原因：[为什么改，来自哪个数据/反馈]
- 影响 Agent：[哪些 agent 的行为会变化]
- 验收：[马良验收 / 李白自评 / 魏征审查]
```

---

## 2026-06-02 初始化

所有提示词文件初始建立，待各 agent 代码完成后填充版本 v1.0。

待建文件：
- `seo-blog.md` ← 博客生成 system prompt
- `geo-directive.md` ← GEO 指令生成 prompt
- `social-campaign.md` ← 社媒 campaign 批量生成 prompt
- `brief-generator.md` ← Master Brief 生成 prompt
- `image-generation.md` ← 图片生成提示词标准
- `video-i2v.md` ← 视频 I2V 提示词标准（Seedance）

## 2026-10-24 script-agent-long.md v0.1
- 变更内容：登记脚本 Agent 长稿模式提示词副本；运行时 prompt 拆到 `src/lib/content-factory/prompts.ts`，长稿生成接入既有选题助理。
- 变更原因：用户要求对完整抖音逐字稿按大瑞人设改写，并指出先前稿件内容不足。
- 影响 Agent：选题助理的长稿模式；短稿模式保持原有 prompt。
- 验收：李白待审；子牙/魏征已指出阈值、来源回执和费用闸缺口，五关未通过。
