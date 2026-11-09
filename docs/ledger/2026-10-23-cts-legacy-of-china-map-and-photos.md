---
id: 2026-10-23-cts-legacy-of-china-map-and-photos
title: 给 CTS「锦绣中华」团补一张路线地图、给两个团（丝绸之路/锦绣中华）补几张免授权风险的照片
status: decided
owner: agent
decided_on: 2026-10-23
source: session:8d76116b
verify_how: 查 chinatravel 仓库 public/tour-maps/ 下有没有 imperial-heritage(-mobile).svg；查 Legacy of China / Silk Road 官网相册有没有新增的 migratedUnsplash 图片
---
起因：Fuzion Travel（旅行社合作方）要给 Silk Road / Legacy of China 两个团做邮件推广，查出 Legacy of China 没有路线地图、两个团照片都是付费 Getty/iStock 图库图（标准授权不含转授权给第三方，不能直接发文件给 Fuzion）。PM 10-23 决定排专门窗口补齐。
查明的具体做法（不是从零开始）：
- 地图：用 `docs/specs/prototypes/tour-route-map/gen.py`（已生成现有 8 张团地图的同一工具）。需要：①在 `specs.py` 加一条 `imperial-heritage` 的行程 spec（真实行程数据已在 `chinatravel/src/lib/data/tours.ts` 的 `imperial-heritage`，17 天：北京→西安→拉萨→成都(熊猫)→重庆→长江三峡游轮→宜昌→上海）②补 Lhasa、Yichang 两个城市的经纬度坐标（`gen.py` 的 `C` 字典 + 网站 `city-geo-coordinates.ts`）③跑生成脚本，产出 `imperial-heritage.svg` + `-mobile.svg`，照着 `be500e1` 那次提交的样子接进 `TourRouteMap.tsx`。
- 照片：用网站已有的 `migratedUnsplash(photoId)` + Supabase 流程（CLAUDE.md 已记录的人工流程：在 unsplash.com 挑图→给 Claude 图片 ID→下载上传进 `migrated/unsplash/` bucket→接进 `tours.ts`），给两个团各补几张（长江三峡、成都熊猫基地、西安、故宫等），不用新开发。
下一步：找一个有 `chinatravel` 仓库写权限的窗口，按上面两步做完，验收用 verify_how 那两条查。
