# 交 119 号：ME 建测试广告时「自动改创意 / 自动混入别的素材」开关现状 · 2026-10-18

> 来源卡：`2026-10-18-skill-handoff-119-test-ads-auto-creative-off`（120 号交接，到期 10-25）。只读：读主干代码 + 想用 Meta 原始接口回读一条现有广告。

## 已确定的（读代码，`origin/main`）

**ME 的代码一个字都没设置过这类开关。** 全仓在 `src/lib/meta`、`src/lib/ads-strategy`、`src/lib/capabilities/ads`、`meta-ads` 接口里搜 `degrees_of_freedom_spec`、`creative_features_spec`、`standard_enhancements`、`advantage_plus_creative`、`is_dynamic_creative` 等：**零命中**。

ME 有两条建广告路径，发给 Meta 的创意参数都很干净：
1. `src/lib/meta/ad-publisher.ts:171-213`（留资 / 私信 / 视频三类草稿）：创意只带 `name` + `object_story_spec`（页面、视频或图片、文案、行动按钮）。
2. `src/lib/meta/ads-manager.ts:59-80` 的 `createAdFromPost`（赢家 Reel 自动建广告）：创意只带 `object_story_id`（引用一条已有帖子）。

→ **结论：ME 没有主动「关」它们，也没有主动「开」它们；实际生效的是 Meta 对没带这个字段的创意的默认值。**

## 没法确定的（并说清为什么）

**Meta 的默认值到底是开还是关，我没有查实。** 凭印象这个默认值随 Meta 接口版本和广告系列类型变过，不能当事实写。

要查实只有一个办法：回读一条 ME 建出来的现有广告的 `degrees_of_freedom_spec` / `creative_features_spec`。我试了，**三条路都没走通**：
1. Meta 官方只读工具（`ads_get_creatives`）：创意只暴露 15 个字段（正文、标题、行动按钮、图片、视频等），**没有这两个字段**，看不到。
2. 本机 `.env.local` 里 CTS 的系统用户令牌：Meta 返回「会话已失效」。正式环境的每日拉数今天仍成功拉了 CTS 数据，所以这是**本机副本过期，不是正式环境坏了**，但本机这份需要有人更新。
3. 本机另外两个通用令牌：令牌有效，但对这个广告账户**没有权限**。

我没有继续换着试令牌（再试就成了猜钥匙），也没有读 Render 后台的正式令牌。

## 建议

- 这一问**不阻塞任何事**：它只关系「测试结果准不准」，目前广告没有在跑测试。
- 要查实，需要二选一：①有人把本机 `.env.local` 里 CTS 的令牌更新成有效的（然后我 1 条只读命令就能回读）；②在 Meta 广告管理器里随便点开一条 ME 建的测试广告，看「创意」里 Advantage+ 增强选项开没开，截图或口述给我。
- 无论默认值是什么，**写测试广告的代码时应该显式关掉**：这样不依赖 Meta 的默认值，也不会随版本漂移。这是一个小改动（在创意参数里加一个明确关闭的字段），属 B 级，要写代码，等 AD-EXPL-1 一起设计，不单独开工。
- 卡要求的「若是开着就给出要不要关的建议」：**建议关**（理由见上一条），但「现在是不是开着」未证实。
