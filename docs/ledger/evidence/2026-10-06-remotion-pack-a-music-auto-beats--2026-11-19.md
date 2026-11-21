# 证据 · 2026-10-06-remotion-pack-a-music-auto-beats · 2026-11-19
fetched_at: 2026-11-19T06:19:24+13:00
查了什么：判据第二半「待听的歌逐首量过后转 ready」——主干音乐目录里每首歌的状态。
数字（带样本量、两边取数状态）：scripts/factory-worker/engines/remotion/catalog/music.json 共 31 首，status=beats_unverified 30 首，ready 1 首（取数成功；文件最近一次改动 2026-10-26，commit 93bd5ff45）。
来源/命令：node -e 统计 catalog/music.json 各 status 个数（主干 origin/main 5340eb731）。
结论：不成——到期 37 天后仍有 30/31 首节拍没量过，没转 ready；判据前半「真实 CTS 成片音画偏差 ±50 毫秒」也没找到量测记录。
