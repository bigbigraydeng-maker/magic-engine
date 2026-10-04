# Remotion 渲染引擎（R1 模板试做）

通用「费用包含清单」竖版视频（1080×1920，30fps）：开场三行字 → 3–7 个条目各配一段镜头 → 价格揭晓 → 常驻 logo → 可选音乐。
**模板里没有任何客户内容**：文案、价格、颜色、素材文件名、节拍全部来自一份 props JSON，换客户只换这份文件。

这是独立的 npm 包，自带依赖和锁文件，**不是**主站的一部分：根目录的类型检查、lint、`npm test` 都不会扫它（见根 `tsconfig.json` / `vitest.config.ts` 的排除项）。
目前没有接入任何运行中的流程（没有接出片机、没有读 Master Brief、没有每日计划）。

## 安装

```bash
cd scripts/factory-worker/engines/remotion
npm ci
```

需要 Node ≥ 22.18（props 校验文件是 TypeScript，Node 直接运行；渲染本身走 Remotion 自带打包）。

## 渲染

```bash
node render.mjs --props <props.json> --out <out.mp4> [--public-dir <素材目录>] [--concurrency 2] [--timeout-sec 600]
```

- `--public-dir`：props 里写的所有文件名都相对这个目录，默认是本目录下的 `public/`（已 gitignore，视频/音乐/大图一律不进仓库）。
- `--timeout-sec`：总超时，默认 600 秒（10 分钟），超时会终止并以退出码 124 结束。
- `--browser-executable` 或环境变量 `REMOTION_BROWSER_EXECUTABLE`：指定已有的 Chrome Headless Shell，省去首次下载。

退出码：`0` 成功 · `2` 命令写错 · `3` props 不合格 · `4` 素材文件缺失 · `5` 渲染失败 · `124` 超时。每种失败都会打印一句中文原因。

渲染前一定先校验：缺字段、多字段、超长、网址、绝对路径、`..`、条目数越界、颜色非法，全部在**打开浏览器之前**拒绝。**没有任何默认值**：缺哪项就报哪项。

## props 规则

| 字段 | 规则 |
|---|---|
| `brandColor` | `#RRGGBB` |
| `logoFile` / `musicFile` / 各 `clip` | 只允许相对文件名（可带子目录），禁止网址、绝对路径、`..`、空格；扩展名限制：logo `png/jpg/jpeg/webp`，音乐 `mp3/wav/m4a`，镜头 `mp4/mov/webm`。`musicFile` 可为 `null`（无音乐） |
| `beats` | 剪辑节拍时间（秒），严格递增，最多 80 个；条目数 N 时至少需要 `2N+13` 个；用到的最后一个节拍不得超过 90 秒 |
| `hook.lines` | 恰好 3 行，每行 `{ badge, text }`：`badge` 可为 `null`（最长 6 字符），`text` 最长 **12** 字符（再长会自动折行，版面会乱）；第 3 行带高亮底色 |
| `items` | 3–7 条，每条 `{ text(≤48), clip, blurBackdrop }`；`blurBackdrop=true` 表示该条是抽象概念，镜头只当模糊氛围背景，避免画面假装在表现它 |
| `itemLabel` / `revealTitle` | 条目上方小字、价格上方标题 |
| `price` | `{ backdropClip, fromLabel, currency, amount(正整数), qualifier, departLine, footnote }` |

时长随 `beats` 与条目数动态计算：开场 4 拍，每条目 2 拍，价格揭晓 8 拍（`src/timing.ts`），没有写死条目数。

### 例子（虚构，非任何真实客户）

`examples/sydney-apartment.props.json`：4 条目、无音乐。生成占位素材后可以直接渲：

```bash
node tools/make-placeholder-assets.mjs --out /tmp/remotion-demo
node render.mjs --props examples/sydney-apartment.props.json --public-dir /tmp/remotion-demo --out /tmp/remotion-demo/out.mp4
```

占位素材是 ffmpeg 生成的渐变色块，只用来验证流程，不是真实镜头。

## 测试

```bash
npm test                 # 校验 / 源码扫描 / 命令行护栏，几秒钟，不开浏览器
npm run type-check       # 本包自己的类型检查
RUN_REMOTION_RENDER=1 npm run test:render   # 真渲染冒烟（本机，需要 Chrome + ffmpeg，约 1 分钟；不进 CI）
```

`test/no-client-facts.test.mjs` 会扫描 `src/`、`examples/`、`tools/`、`render.mjs`，出现客户事实字样（客户名、官网域名、货币+价格、地名、产品名，词表在测试文件里）就失败，防止客户内容混进共享模板。

## 授权结论与已知限制

- **Remotion 授权**：官网写明个人和 3 人以内的公司免费（含商用）；4 人及以上要付费，自动出片系统走 Automators 档（每次渲染 $0.01、每月最低 $100）。2026-10-05 PM 确认 Magic Lab 目前 3 人以内，可以免费用；**团队长到 4 人时必须改买授权**。「3 人」是否含兼职/外包、免费档下自动出片是否有额外限制，官网摘要没有说明，不能当结论。
- **音乐**：模板支持音乐，但音乐文件的商用来源没有确认前，带音乐的成片不得用于广告。
- **本机需要 Chrome**：首次渲染会自动下载 Chrome Headless Shell；也可用 `--browser-executable` 指向已有的。
- **字体**：Montserrat 通过 `@remotion/google-fonts` 在渲染时联网加载，离线环境会等到超时。
- **素材不随包提供**：镜头、logo、音乐都要放进素材目录；客户真实产品/价格的画面只能用客户自己提供的素材。
- **版面**：针对 1080×1920 与 Meta Reels 安全区设计（文字在 y≈270–1248、右侧留 120px）；价格串很长时字号会自动缩小，但整体仍是为「一行价格」设计的。
- 只迁了 `ListReel` 一个模板；原来的「运营在 X 国 / 已经 N 年」徽章因为带客户声明没有迁移。
