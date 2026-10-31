# 音乐库人声整库转写表（2026-10-16 · 106 号）

方法：openai-whisper small 对**整首**转写（`temperature=0`，不限语言），按文件内容 sha256 去重（共 47 首不同的曲子，100 个文件副本）。纯音乐常被识别成「Music / you / Thanks for watching」或乱码，这类算**无人声**；有连贯文字且 no_speech 低才算有人声。原始转写与逐段时间在证据包 `~/Library/Application Support/magicengine/evidence/2026-10-16-tale-vocals/music-scan.json`。

扫描范围：Dropbox `01_Platform/shared/music`（含 `cts-winter-20261015`）、`01_Platform/music`、`CTS/remotion-assets/music`、本机镜像 CTS / East_Inter / `_shared` 的音乐副本。

| 曲名（副本名） | 时长(s) | 人声判定 | 转写片段 | 被工单用过(查库) | sha256前12 |
|---|---|---|---|---|---|
| Jayden小弟.mp3 | 180 | **有人声·禁用** | ZANDA ZANDA ZANDA ZANDA ZANDA ZANDA ZANDA ZANDA ZANDA ZANDA  | 0 | 8a882fb706d4 |
| MiniMax_2026-06-24_03_39_52_Analytical_Scholar.mp3 / analytical-schola | 26 | **有人声·禁用** | Brand new in Rosset Bay. Open plan living, premium finishes. | 0 | e2c7220995f1 |
| analytical-scholar_n.mp3 | 26 | **有人声·禁用** | Brand new in Rosset Bay. Open plan living, premium finishes. | 3 张（ccff4bb9/abd7a705/19c191c5，均待审未发布） | be125da5055f |
| Jade River Journey.mp3 / jade_river_journey.mp3 | 235 | 待人听（疑似，先别用） | Music I'm not sure if you can hear me. I'm not sure if you c | 4+ 张（含已发布 03e58fe4/9fcb4ae6，仅用前 15 秒） | 5e4ef1ac304d |
| Sunlit Kitchen Window (1).mp3 | 60 | 待人听（疑似，先别用） | අපි කින් පින් පින් පින් පින් පින් පින් පින් පින් පින් පින් ප | fd7e3e5a(已发布)等 4 张，仅用前 15 秒 | 4ae10f28038a |
| Sunlit Kitchen Window.mp3 / sunlit-kitchen-window.mp3 | 102 | 待人听（疑似，先别用） | Music You | fd7e3e5a(已发布)等 4 张，仅用前 15 秒 | 1efc49f91de4 |
| jade_river_journey_q.mp3 | 235 | 待人听（疑似，先别用） | Music | 同上 | d37e2ed9cae4 |
| sunlit-kitchen-window_n.mp3 | 102 | 待人听（疑似，先别用） | Music | 同上 | 16e7f6fe0245 |
| A_intro_0s.mp3 | 15 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | a02010fd80eb |
| B_energetic_42s.mp3 | 15 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 43f151c72da1 |
| Bass Drop.m4a | 120 | 无人声（整首转写仅空/「Music」类幻听） | සිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවි | 0 | 76e96a94a1cd |
| Big Stomp Kick.m4a | 122 | 无人声（整首转写仅空/「Music」类幻听） | Music you | 0 | 673772e78d87 |
| Building Momentum.m4a | 120 | 无人声（整首转写仅空/「Music」类幻听） | Music | 13 张 | e3780bc11477 |
| C_build_143s.mp3 | 15 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 494e40c3ffad |
| Clean Final Hit.m4a | 32 | 无人声（整首转写仅空/「Music」类幻听） | you | 0 | ea64865b4d77 |
| Feel Good Travel.m4a / feel-good-travel.m4a | 162 | 无人声（整首转写仅空/「Music」类幻听） | සිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවිවි | 0 | 8c171e120f34 |
| Founders at Dawn.mp3 / founders-at-dawn.mp3 | 154 | 无人声（整首转写仅空/「Music」类幻听） | you | 0 | d88e4253e41f |
| Founders in Motion.mp3 | 88 | 无人声（整首转写仅空/「Music」类幻听） | (无) | 0 | e0053330c3aa |
| Horizon's Breath.m4a / horizons-breath.m4a | 29 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 493f6e4a8264 |
| Horizon's Call.mp3 / horizons-call.mp3 | 30 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 53e201d14996 |
| Reveal Hit.m4a | 29 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 10c643104a09 |
| Second Hand Sunrise (1).mp3 | 64 | 无人声（整首转写仅空/「Music」类幻听） | you | 0 | 86206d7c942e |
| Second Hand Sunrise.mp3 / second-hand-sunrise.mp3 | 51 | 无人声（整首转写仅空/「Music」类幻听） | Thanks for watching! | 0 | 0a83ee7f5495 |
| Snap the Floor (1).mp3 | 175 | 无人声（整首转写仅空/「Music」类幻听） | (无) | 0 | d958bd183650 |
| Snap the Floor.mp3 | 146 | 无人声（整首转写仅空/「Music」类幻听） | වවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවව | 0 | 4650d7056d60 |
| Sunday Hammer (1).mp3 | 60 | 无人声（整首转写仅空/「Music」类幻听） | වවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවව | 0 | 9be060044bb8 |
| Sunday Hammer.mp3 | 63 | 无人声（整首转写仅空/「Music」类幻听） | ස්වින්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න් | 0 | 7f9009212ed6 |
| Tension Building.mp3 | 120 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 6b775b274e07 |
| The Dragon's Dance.mp3 | 19 | 无人声（整首转写仅空/「Music」类幻听） | (无) | 0 | e2969abbb780 |
| Vinyl Groove.m4a | 168 | 无人声（整首转写仅空/「Music」类幻听） | (无) | 2 张（5bc8dc7d 已发布） | 4d2fed585fec |
| cts-beyond-the-postcard-v1-preview.mp3 | 69 | 无人声（整首转写仅空/「Music」类幻听） | Music you | 0 | 8e58af159d9e |
| cts-beyond-the-postcard-v2-preview.mp3 | 70 | 无人声（整首转写仅空/「Music」类幻听） | Music | 0 | 8202f3e04fb8 |
| cts_xmas_suno.mp3 | 122 | 无人声（整首转写仅空/「Music」类幻听） | වවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවව | 0 | 63158925d3da |
| curious-journey-v1.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music Music Music Music | 0 | d76cd2c8c36d |
| curious-journey-v2.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music Music Music Music | 0 | f5293982c9e3 |
| ice-light-v1.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music You | 0 | aac1b5a6866b |
| ice-light-v2.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music you | 0 | 6c10a57dd693 |
| momentum.mp3 | 40 | 无人声（整首转写仅空/「Music」类幻听） | Music Thanks for watching guys! | 13 张 | f2274f45b5bf |
| momentum_q.mp3 | 40 | 无人声（整首转写仅空/「Music」类幻听） | Music Thanks for watching! | 13 张 | a62a88e214cb |
| road-afar.m4a / 远方的路.m4a | 30 | 无人声（整首转写仅空/「Music」类幻听） | Music | 3 张(已拒) | 7deaaef5dabb |
| second-hand-sunrise_n.mp3 | 51 | 无人声（整首转写仅空/「Music」类幻听） | Thanks for watching! | 4 张（含已发布 2ef627ff） | 67f6fbf47006 |
| warm-streets-v1.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music You | 0 | 3dd15de27a79 |
| warm-streets-v2.mp3 | 180 | 无人声（整首转写仅空/「Music」类幻听） | Music You You You you | 0 | b571779d9788 |
| 琵琶陷阱.m4a | 64 | 无人声（整首转写仅空/「Music」类幻听） | වවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවවව | 0 | 52c508907ca4 |
| 青瓷回声.mp3 | 30 | 无人声（整首转写仅空/「Music」类幻听） | සින්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න්න් | 0 | 8be48181ac5a |
| 龙旗破云 (1).mp3 | 77 | 无人声（整首转写仅空/「Music」类幻听） | МУЗЫКАЛЬНАЯ ЗАСТАВКА Редактор субтитров А.Семкин Корректор А | 0 | 80abf2c44808 |
| 龙旗破云.mp3 | 61 | 无人声（整首转写仅空/「Music」类幻听） | МУЗЫКАЛЬНАЯ ЗАСТАВКА Редактор субтитров Н.Закомолдина | 0 | 52d1d48c580a |

## 结论
- **确认有人声（3 个文件，实为 2 首）**：`Analytical Scholar`（地产广告英文旁白，含 `analytical-scholar(.mp3/_n.mp3)` 副本）、`Jayden小弟.mp3`（中文歌词，从 30 秒起；库里没有工单用过）。
- **待人听**：`Jade River Journey`（108–136 秒处重复一句「I'm not sure if you can hear me」，no_speech 0.87，多半是幻听，但已发布的片只用前 15 秒不受影响）、`Sunlit Kitchen Window`（60 秒后疑似零星人声，同样只用前 15 秒）。
- 其余全部无人声。
- 目录表 `catalog/music.json` 的 `status` 是代码强校验的枚举（只允许 ready / beats_unverified），直接加「含人声·禁用」会让校验报错，所以标记要走「出片机音乐人声检查」那个 PR（见 `docs/specs/2026-10-16-music-vocal-gate-design.md`）；在那之前，以本表为准。Dropbox 里的 `music_library.json` 是 Codex 的 11 首选曲表，不含这两首，未改动。
