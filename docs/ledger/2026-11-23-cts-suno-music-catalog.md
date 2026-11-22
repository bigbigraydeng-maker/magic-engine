---
id: 2026-11-23-cts-suno-music-catalog
title: CTS 新配乐 8 首（琵琶/古筝/二胡/竹笛各 A/B）全部收录进视频工厂曲库；本次黑五广告选用竹笛和古筝两种
status: decided
owner: agent
decided_on: 2026-11-23
source: session:ec90bb17
verify_by: 2026-11-26
verify_how: 视频工厂用竹笛或古筝曲出第一条黑五片时，渲染没被人声闸或找不到文件拦下，成片里能听到这首曲子，就算成；被拦就读出片机日志里的绝对路径，对着曲库条目改
---
PM 2026-11-23：「这几组都收录，本次黑五选用 dizi 和古筝」。

- 生成：Muapi 的 suno-create-music，纯器乐。每次 US$0.10，一共 4 次，合计 US$0.40；4 种风格，每种出 A/B 两版。
- 测量：节拍都在每分钟 100 拍左右（pipa-drums-b 测出 134 拍，是检测器取了快一倍的拍子）。
- 人声检查：whisper small 跑过，5 首完全没有识别出人声；另外 3 首只出现音乐常见的幻听文字。large-v3-turbo 没跑。
- 文件位置：
  - Dropbox `MagicLab_Studio/01_Platform/shared/music/cts-*-20261123/`
  - 出片机 `studio/_shared/music/`
  - `studio/CTS/remotion-assets/music/<id>.mp3`
