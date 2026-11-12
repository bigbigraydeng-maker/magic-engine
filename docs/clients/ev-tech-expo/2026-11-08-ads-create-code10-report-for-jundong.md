# 给 Jundong：EV Expo 在新 ME 里建不了广告（Meta code 10）

**一句话**：11/8 18:18 起（新西兰时间），通过新 ME 给 EV Expo 建广告（ads.create）连续 3 次被 Meta 拒绝，报 code 10（没有权限）；同一时间改广告组（ads.act）全部成功。中午和下午建广告都是正常的。

## 失败的 3 次（都是视频广告，加进已有广告组）

| 时间（NZDT） | run_id | 加进的广告组 | 按钮 |
|---|---|---|---|
| 18:18 | dad34e32-89bb-4641-98df-fb2daa76b803 | 120253685553660589（G1 周末带娃 · 女 30-55） | BOOK_TRAVEL |
| 18:18 | dc350de9-acc9-40db-ad78-31143531fbc2 | 120253685553660589（同上） | LEARN_MORE |
| 18:19 | 2d92268d-6871-47bf-8ec4-6ed59ba8f00a | 120253700464570589（G1 · EB直跳，当天 12:2x 由 ME 自己建的组） | BOOK_TRAVEL |

- 客户：EV Expo（新 ME），广告账户 act_1018365291238494。
- 素材：素材库视频 eabff880-0843-46bf-ac2c-9d3c4b43b826（Robots up close）。这条视频当天中午已经被 ME 成功用来建过广告。
- 请求：objective=traffic，destination=website，带 adset_id，链接是 Eventbrite 购票页 + url_tags。
- ME 返回：「Meta 拒绝了这次请求（code 10）」，「外部副作用未产生（rollback: noop）」；状态 dead_letter，campaign/adset/ad/creative id 全空。
- 换按钮（BOOK_TRAVEL → LEARN_MORE）、换广告组都一样失败，所以不是按钮、也不是某个广告组的问题。

## 同一天成功的操作（对照）

- 12:28–13:04：ads.create 新建 5 个系列（EB直跳 G1/G2/G3/G4/视频），全部成功。12:38 往 G2 EB直跳组（120253700466310589）里再加第二条广告，也成功（按当时的做法应该走的是带 adset_id 的路径，没有回头核对 run 记录）。
- 约 15:30：ads.create 新建 Messenger 广告系列（120253701242670589），成功。
- 18:1x：ads.act kind=targeting 改了 4 个广告组的 age_max，全部 succeeded / verified。
- 也就是说：令牌有效，改广告组的权限在；坏的是「建广告 / 建创意」这一步，而且是 15:30 以后才坏的。

## 已排除

- 令牌：系统用户 EVExpo（Magic Engine Portal 应用）的令牌是 14:20 重新生成、14:20:36 在新 ME 重新关联的，比 15:30 建广告成功还早。137 号窗口确认之后没人动过应用、系统用户或令牌的权限。
- 按钮和广告组：见上。

## 想请你查的

1. 这 3 个 run 的日志里，Meta 返回 code 10 的是哪一个请求（上传视频 / 建创意 / 建广告），以及完整的 error_subcode 和 message。
2. 用 debug_token 看一下当前令牌的权限：主页那边的 pages_manage_ads、pages_read_engagement 还在不在。建视频创意要用主页身份，code 10 常见于主页权限。
3. 线索（未核实）：你今天邮件里说这个应用的 pages_messaging 还没过审。15:30 建 Messenger 广告之后，是不是有哪里把主页授权或主页令牌改了。

## 顺带一个小问题（不急）

- ME 的 CTAS 表（app/ads/creative.py）里，traffic 目标没有 BUY_TICKETS。卖票类客户跳 Eventbrite 想用「Buy tickets」按钮，现在只能退而用 BOOK_TRAVEL。麻烦核实一下 Meta 是否允许 traffic 目标用 BUY_TICKETS，允许的话请加上。

## 更新（18:56）：重试成功了

- 18:56 再提交一次，ME 在 run 2d92268d 原记录上重跑成功，建出广告 120253702210710589（暂停）。随后 18:56–18:58 又连建 3 条，全部成功。
- 所以 code 10 只出现在 18:18–18:19 这一阵子。仍然想请你看一下当时是哪一步被拒、为什么，免得开展前再碰上。
- 另一个小问题：这几条 ME 回执写「已上线（delivery: live）」，但 Meta 读回都是 PAUSED（暂停），ME 的状态文字跟实际对不上。
