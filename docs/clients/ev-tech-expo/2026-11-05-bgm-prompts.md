# EV Tech Expo · BGM 生成提示词（6 条）· 2026-11-05

**状态**：只写了提示词，**没有在 Suno 上试跑，没有生成任何音乐**。生成出来的曲子必须先过人声检测和人声登记，才能进成片。
**依据**：社媒手册 BGM 章节（纯器乐、一丝人声都不能有、≥40 秒）、`2026-11-05-video-angles-brief-for-factory.md`、曲库 `scripts/factory-worker/engines/remotion/catalog/music.json`、人声登记表 `music-vocals.json`。
**PM 要求**：不要中国风；要更劲的动感；PM 认可的方向是 Dropbox 库里的「Snap the Floor」（合成器电子风，约 119 BPM）。

## 通用排除串（每条都要带，粘进 Suno 的排除风格栏；没有这一栏就拼在风格行末尾）

```
vocals, voice, singing, humming, choir, backing vocals, vocal chops, vocal samples, spoken word, rap, chant, crowd shouts, vocoder, robot voice, talkbox, "ooh/aah" pads, Chinese instruments, pipa, guzheng, erhu, pentatonic, sitar, tabla, acoustic guitar, orchestral strings, sound effects, sirens, engine noise
```

BPM 全部压在 128 以内：节拍检测脚本会把快曲误判成两倍或 1.5 倍。

## 一、快剪无人声版（音乐是主角，12–15 秒，踩鼓点）

### E1 · 同路线升级版（贴近 Snap the Floor）
- **Style**：`energetic electronic dance instrumental, synth-pop, punchy four-on-the-floor kick, tight snappy claps, pumping sidechained bass, bright arpeggiated synth, futuristic tech expo energy, clean modern production, instrumental only`
- **BPM**：120；调性 A minor
- **结构**：前 2 小节只有底鼓和滤波琶音（约 4 秒），第 3 小节全开，接 8 小节主循环、8 小节变奏、2 小节渐强、再全开，收在一个干净重音上。总长 60–90 秒（不少于 40 秒），前 30 秒底鼓不断。
- **适合**：角度 1（机器人钩子）、角度 5（本周末见）。

### E2 · 机器感科技律动
- **Style**：`tech house, electro, driving rolling bassline, metallic percussion, glitchy hi-hats, short synth stabs, futuristic robotics vibe, hard-hitting but clean, instrumental only`
- **BPM**：124；调性 D minor
- **结构**：前 2 小节踩镲加低音脉冲，第 3 小节全开，16 小节稳定循环，每 8 小节只换打击乐，不断鼓；渐强后再全开，收尾重音。不用拖长的合成器长音（容易被听成人声）。
- **适合**：机器人、机器狗近景镜头多的版本；角度 3（试驾）。

### E3 · 明亮冲劲（偏家庭、年轻人）
- **Style**：`uplifting energetic electronic pop instrumental, bright synth pluck hook, punchy kick, big claps, pulsing bass, optimistic, festival-friendly, electric future, instrumental only`
- **BPM**：128；调性 G minor（可选）
- **结构**：前 2 小节进场，第 3 小节全开，8 小节带短钩子的循环、8 小节更满的变奏，渐强后再来一次，收尾重音。
- **适合**：角度 2（带娃免费）、角度 4（排灯节周末）。

## 二、真人讲解版（音乐压在人声下面：不要大 drop，不要主旋律，中频留空）

### T1 · 深度浩室底
- **Style**：`deep house, minimal tech house, soft four-on-the-floor kick, warm sub bass, airy ambient synth pad, sparse tiny plucks, dark and low-passed, no lead melody, background music for voiceover, space in the midrange, instrumental only`
- **BPM**：110；调性 F minor（可选）
- **结构**：第 1 小节就起律动，每 8 小节滤波慢慢打开一点，不要突变，没有空白段；60 秒以上（不少于 40 秒）。
- **另加排除**：`no big drop, no lead synth, no melody hook`
- **适合**：通用讲解版，每个角度都能配。

### T2 · 渐进式科技纪录片感
- **Style**：`cinematic electronic underscore, driving pulsing eighth-note synth bass, low tom pulse, ambient pad, subtle rising tension, tech documentary feel, restrained, slow build, instrumental only`
- **BPM**：100；调性 E minor（可选）
- **结构**：第 1 小节就有脉冲，能量缓慢爬升，约 15–20 秒到最满，对上口播结尾的号召；全程没有突然的重音或停顿。
- **另加排除**：`no melody, no hook, no sudden stops`
- **适合**：现在这三条真人介绍版（hookA/B/C），推进感最强、又不抢话。

### T3 · 轻快友好律动
- **Style**：`light electronic pop groove, tight kick, rim click, soft hi-hats, rounded bass, warm analog pad, tiny high-register arpeggio, friendly and clean, family-safe, background for voiceover, instrumental only`
- **BPM**：116；调性 C minor（可选）
- **结构**：第 1 小节起稳定律动，不断鼓，每 8 小节换一个很小的高频点缀，没有 drop；60 秒以上。
- **另加排除**：`no lead melody, no big drop`
- **适合**：角度 2（带娃免费）的讲解版。

## 三、用之前必须做的（踩过的坑）

1. **选了「instrumental」也可能混进人声。** 上次的 river-pandas-peaks 是从 8 首候选里挑人声最安静的那首，PM 听过才签字。这次每条也要多生成几首再筛，生成后先跑人声检测。
2. **没登记的新曲子会被出片流程拦下。** 人声登记按文件指纹登记，要 PM 本人听过并签字。裁剪、转格式后指纹会变，要另外登记。
3. **鼓点要稳、速度不变**，否则节拍检测会测错，切点就对不上。
4. **文件名**：曲库 id 加扩展名，不带空格，放 `_shared/music`。
5. **只用 PM 的 Suno 付费账号生成**：商用权取决于生成时的账号档位。

## 四、没找到依据的

- Suno 风格栏的字数上限、有没有单独的「排除风格」输入框，仓库里没有记录。
- 上次 river-pandas-peaks 用的原始提示词没有留存。
- 中频 1–4 kHz 只能靠提示词引导，Suno 不保证；需要的话后期再压低 3–6 dB（通用做法，不是仓库里的规定）。
- Snap the Floor 是否已经正式登记过人声检查：按名字搜不到，不等于没登记。本窗口用 Mac 自带声音识别筛过，整首 0 处人声，但这不是正式登记。
