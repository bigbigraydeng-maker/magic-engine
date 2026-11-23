# Natural China v4（换曲，替代 cc876dc3）

- 选曲：`jade_river_journey`（登记：弱证据「PM 审片已通过」，窗口≤20s；本片 15.07s + 起点 0.133s + 1s 余量 = 16.2s ✓）。CTS 上次用：10-05 发布单 9fcb4ae6（Facebook video_state=DRAFT）、10-14 一条被打回的草稿；比其它已登记曲都早（其余 10-14～10-16 刚用过）；与主页最近几条（founders-in-motion / sunlit / second-hand / founders-at-dawn / horizons）不同曲。氛围片样片也想用它，样片未发布，不算占用。
- 节拍：`analyze-music.py` 复测 132 BPM、首拍 0.164s（与目录 0.14 接近）；原 cc876dc3 的 19 个切点（hook 4 拍 + 3 景×2 拍 + 价格 8 拍）逐个吸附到最近的 jade 拍点，总长 15.07s（原 14.93s）。
- 画面/文案沿用 cc876dc3：价格悬念 NZ$7,XXX → NZ$7,349、片尾含单房差；无倒计时/限时/还剩几周。
- `insert-v4.sql` 未执行（等出片机升级授权）。v4 到待审后，把 cc876dc3 标 superseded；Facebook 草稿先不删。

## 结果（2026-10-18，出片机 dfb7656ba）
- v4 工单 **7049d162-d4b0-4eea-a1d8-192ae4e64af9** 到待审；15.08s、−16.9 LUFS、封面 0.5s 亮度 127.7、7 项自动体检全 PASS、无品控/红线标记；人声闸回执 window [0.133,15.2] cleanUntil 20。画面文案与 cc876dc3 一致（含开头「BOOK YOUR MARCH 2027 TOUR / DEPARTS 26 MARCH 2027」横幅，旧片同样有）。cc876dc3 已标 superseded（Facebook 草稿未动）。9 宫格：`7049d162-self-check-grid.jpg`。
