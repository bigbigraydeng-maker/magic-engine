# 氛围片样片（外滩日落）· 工单与素材登记

- 素材：Pexels 两条（PM 10-18 批准，18 号执行下载），已核对 sha256 / ffprobe 与清单一致，已入 `CTS/remotion-assets/clips/`（`atm1_…`、`atm2_…`）及本机镜像；出处见 `credits-v10.json`。`atm1` 是 29.97fps（样片按秒取值，帧率由引擎换算）。
- 样片工单草稿：`atmosphere-sample.order.json`（**未提交**；PR 2772 合并 + 出片机升级（需 PM 授权）后才能提交）。参数：外滩日落单镜头 16s、`sourceIn` 2s、推镜 1.03、无字、乐曲 `jade_river_journey`（登记窗口 20s → 成片 ≤19s，1+16=17 ≤20 ✓）。
- 配方对账：真人背影/真人出镜 = **未满足**；其余列见设计稿 §4。
- 样片只发 PM 看，不发布，不进广告素材池。

## 结果（2026-10-18，出片机 dfb7656ba）
- 样片工单 **17419d99-9986-49c5-ba3a-2dfe9f245a7e**（v2，到待审）；v1 faefcde6 因首评 CTA/链接缺失导致 2 项自动体检 FAIL，已 superseded（画面相同）。
- 自检：16.0s、1080×1920、−16.8 LUFS、封面 0.5s 亮度 95.5/范围 228、7 项自动体检全 PASS、无品控标记；`atmosphere_preflight` upscale=1.0 画质 ok；`recipe_gaps`：真人背影/真人出镜=未满足；人声闸回执 jade_river_journey sha 5e4ef1ac… window [0,16] cleanUntil 20。9 宫格：`17419d99-self-check-grid.jpg`（与 v1 同画面）。
