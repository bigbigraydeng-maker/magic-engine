# Winner Reel Auto-Sync · SOP

**Phase 34.A · Level 1 试点版**

## 一句话

每天扫客户 FB Page 的 organic Reels,winner 自动加进 paid Pool Builder Ad Set,fatigue Ad 自动 pause。FDE 不用手工挑 winner,系统跟内容 pipeline 自动同步。

---

## 1. 决策模型(高层)

```
每天 03:00 NZST 每个 enabled 客户:

Step 1 · Pull recent 30 posts from FB Page (published_posts)
Step 2 · Score = reactions + comments×2 + shares×3
         × recency_boost (< 7d: 1.5, < 30d: 1.2, else 1.0)
Step 3 · Filter to video type + drop blacklisted keywords + score ≥ winner_min_score
Step 4 · Diff current Ad Set post IDs vs winners → missing = candidates
Step 5 · Add up to max_new_ads_per_run new Ads (default PAUSED)
Step 6 · Fatigue pause pass:
         • Ad Set 有 ≥ min_active_ads active AND
         • Ad 存活 ≥ ad_min_age_days AND  
         • 该 Ad CTR < 该 Ad Set 组 median × 0.5 AND
         • 至少 3 个 Ad 有 CTR 数据(否则 skip 判定)
Step 7 · Write log to winner_reel_sync_log + Slack notify
```

---

## 2. 客户级配置

表 `winner_reel_sync_config` · 每客户 1 行(可多 Ad Set 时后续扩)

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | bool | false | 主开关 |
| `fb_page_id` | text | — | CTS 客户: `1616575215312482` |
| `ad_account_id` | text | — | `act_2775766642787274`(带前缀) |
| `target_adset_id` | text | — | Pool Builder Ad Set,如 CTS ThruPlay `120248221094190307` |
| `min_active_ads` | int | 3 | Ad Set 少于此数不 pause |
| `ad_min_age_days` | int | 14 | Ad 存活期低于此天不 pause(防误伤新 Ad) |
| `max_new_ads_per_run` | int | 3 | 单次最多加 N 个新 Ad(防批量 flood) |
| `winner_min_score` | int | 5 | 低于此 engagement score 不算 winner |
| `new_ad_default_status` | text | 'PAUSED' | Level 1 试点:PAUSED · Level 2 试点后:ACTIVE |
| `blacklist_keywords` | text[] | `{}` | 帖子文本包含任一关键词 → 跳过(如 "sale", "clearance") |
| `slack_webhook_url` | text | null | 决策 notify;可选 |

---

## 3. Token 配置

`META_SYSTEM_USER_TOKEN_<CLIENT_KEY>` 优先,fallback `META_SYSTEM_USER_TOKEN`。

CLIENT_KEY = `clients.domain` 大写,非 `[A-Z0-9]` 全转 `_`(`clients` 无 `slug` 列;domain 是稳定唯一 field)。
- `ctstours.co.nz` → `META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ`
- `oztopbuildingsupplies.com.au` → `META_SYSTEM_USER_TOKEN_OZTOPBUILDINGSUPPLIES_COM_AU`

**Token 权限要求**:
- `ads_management`
- `ads_read`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`

**Token 类型选择**:
- **有 Business Manager 的客户**:System User Token(无过期,BM → 商务管理器 → 系统用户 生成)
- **个人广告账户客户(如 CTS)**:User Access Token
  (60 天过期 · Graph API Explorer 生成 · 需 60 天前 refresh · 无 BM 时的唯一路径)

**60 天 refresh 触发规则(手工版,Level-1 pilot 时期)**:
- Token 生成后写到 Render env,同时记 expiry 到 `Clients/<client>/notes/meta-token-expiry.md`
- Google Calendar 提前 7 天 alert PM 去 Graph API Explorer 换新 token 贴到 Render env

**Meta App 状态**:必须 **Live**(Development 模式下 API 拒绝 fresh creative — 但引用现有 Page post 建 Ad(`object_story_id`)仍可走通,这正是本 module 使用的模式)

---

## 4. Guards(硬约束)

| Guard | 含义 |
|---|---|
| `min_active_ads` | Ad Set 少于 N active 时不 pause,不管 CTR 多低 |
| `min_active_ads_pause_stop` | Pause 循环中如果 pause 后会 < min_active_ads,立刻停止 |
| `ad_min_age_days` | 存活 < N 天不 pause(冷启动期 CTR 波动大) |
| `max_new_ads_per_run` | 单次最多加 N 个(防批量 flood + Meta rate limit) |
| `insufficient_ctr_signal` | 有 CTR 数据的 Ad 少于 3 个时 skip 判定(median 不稳定) |
| `create_failed:<postId>` | 单条 create 失败不 block 其他 |
| `pause_failed:<adId>` | 单条 pause 失败不 block 其他 |

---

## 5. 触发方式

**Cron endpoint**: `GET /api/cron/winner-reel-sync-daily`

Auth: `Authorization: Bearer $CRON_SECRET`

实际实现走 GitHub Actions(`.github/workflows/winner-reel-sync-daily.yml`,PR #545):
```yaml
schedule: "0 15 * * *"    # UTC · 03:00 NZST = 15:00 UTC (NZST = UTC+12, winter)
                          # 夏令时期(NZDT = UTC+13)对应 14:00 UTC,若需精确对齐可届时调整
```
> ⚠️ 修正:早期草稿误写 "03:00 NZST = 14:00 UTC"。NZST = UTC+12,03:00 NZST = **15:00 UTC**(14:00 UTC 实为 02:00 NZST)。

**手动触发**(测试):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://magic-engine.onrender.com/api/cron/winner-reel-sync-daily
```

---

## 6. 试点分级(rollout)

| 阶段 | 时长 | new_ad_default_status | 说明 |
|---|---|---|---|
| **Level 1 · 试点** | 前 2 周 CTS only | PAUSED | 全部决策 pause,Slack 通知 FDE 手动 approve |
| **Level 2 · beta** | 3-4 周 | ACTIVE(但 daily_budget cap 需另 config) | 自动 activate,pause 前 24h Slack 通知 |
| **Level 3 · production** | 4 周+ | ACTIVE | 全自动 with 硬 guards,决策 log 审计 |

---

## 7. 回滚

**24 小时内所有决策**:
```sql
-- 查最近 24h 加的 Ad
SELECT jsonb_array_elements(ads_added) 
  FROM winner_reel_sync_log 
  WHERE run_at > now() - interval '24h' 
    AND status = 'ok';

-- 手动 pause 全部
```

**紧急 kill switch**:
```sql
UPDATE winner_reel_sync_config SET enabled = false;
```
Cron 会 skip 全部客户,write log status='skipped'。

---

## 8. 数据审计

```sql
-- 最近 30 天每个客户的决策统计
SELECT
  c.name,
  count(*)                   AS runs,
  sum(jsonb_array_length(l.ads_added))   AS added,
  sum(jsonb_array_length(l.ads_paused))  AS paused,
  count(*) FILTER (WHERE l.status = 'error')  AS errors
FROM winner_reel_sync_log l
JOIN clients c ON c.id = l.client_id
WHERE l.run_at > now() - interval '30 days'
GROUP BY c.name
ORDER BY runs DESC;
```

---

## 9. 已知限制

1. **只支持 FB Page organic posts** — 目前不拉 Instagram Reels(需 IG Business Account 关联 + `instagram_basic` scope)
2. **video type only** — photo / album / link 不算 winner
3. **不改 Ad Set 预算** — 让 Meta CBO / Ad Set 层预算自然分配
4. **不改 Campaign 结构** — 只增删 Ad 层
5. **Meta App 必须 Live**:客户如果没配好 Meta App(Development 模式),create Ad 用 `object_story_id` 引用现有 post 一般 OK,但如需 fresh creative(video_data spec) 会撞 error 1885183

---

## 10. 未来演进

- **P34.B**:接 IG Business Account,支持 IG Reels sync
- **P34.C**:自动调 Ad Set daily_budget 基于 organic winner 数量
- **P34.D**:winner 反哺 organic 内容策略(FDE 提示"这类主题过去 4 周赢 3 次")
- **P34.E**:客户接入 Settings UI · toggle + config 可视化管理(目前只支持 SQL 手工写 config)
