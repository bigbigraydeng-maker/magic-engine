只做 GET，不改任何东西。读 act_2775766642787274/adsets?fields=id,name,campaign_id,status,effective_status,daily_budget,targeting,created_time 和新组的 ads{id,status,creative{id,object_story_spec,asset_feed_spec}}，再读系列 120250459565520307 下全部组。原始结果原样贴出，不加结论。

核对要求（逐条对照）：
1. 放进 7274 现有的系列，没有新建系列。
2. 每天预算 30 美元。
3. Advantage+ 受众关闭，只投放再营销池，没有扩到池子以外的人。
4. 受众是「打开表单没提交」和「已提交」这两个再营销受众。
5. 素材用的是 7274 上现有的素材，没有新建。
6. 状态是暂停，没有开投，没有动 A 组的预算。
7. 没有复用 7 月 7 日那个旧再营销组。

另外特别注意：这两个受众只收 4 个旧表单的人，不包括现在在用的 v6.1 表单，v6.1 的提交者既进不了池子也排除不掉，有可能被当成新客再投一次。
