# 出片机开机自启（一页纸）

**作用**：Mac 开机登录后，出片机自己起来；崩了自己重启；不用人手动开。
**还没装。** 装上去是改这台 Mac 的常驻配置，要 PM 同意后再装。

## 装

在**放着代码主目录**的那台 Mac 上，终端里一段一段跑（`REPO` 换成代码主目录，不要用临时的 worktree 目录）：

```bash
REPO=/Users/raydeng/Projects/magic-engine
sed -e "s#__NODE__#$(which node)#" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  $REPO/scripts/factory-worker/launchd/com.magicengine.factory-worker.plist \
  > ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
plutil -lint ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
```

装之前确认：`node -v` 是 22.18 以上；`scripts/factory-worker/.env` 里已经有出片用的密钥（模板里不放任何密钥）。

## 看它在不在

```bash
launchctl print gui/$(id -u)/com.magicengine.factory-worker | grep -E "state|pid"
tail -f ~/Library/Logs/magicengine-factory-worker.log
```

日志里每 30 秒一行「无 queued 工单,等待…」就是正常。如果日志里反复出现 `FATAL` 或找不到 `.env`，是 `.env` 没配好（它每 30 秒会被拉起一次），先补 `.env`，再重启。

## 重启（改了代码、或今日待办提示出片机离线时）

```bash
launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker
```

## 卸载

```bash
launchctl bootout gui/$(id -u)/com.magicengine.factory-worker
rm ~/Library/LaunchAgents/com.magicengine.factory-worker.plist
```

## 要知道的三件事

1. **合盖睡觉不算崩，但睡久了会提醒。** Mac 睡着时它也睡着；醒来继续。睡着超过 10 分钟，在做的单会被系统收回队列，醒来重新领，不扣重试次数。队列里有活、又睡了 30 分钟以上，今日待办会提醒——这时唤醒那台 Mac 就行，不用重启。
2. **掉线怎么发现。** 出片机空闲时每 4 分钟报一次「我还活着」。队列里有活、等了 30 分钟、又没收到任何信号，今日待办会出现「出片机离线」，机器恢复后自己消失。
3. **更新代码后要重启一次**（上面的重启命令），它跑的是启动时那份代码。

## 素材镜像自动同步（2026-11-03 加）

**为什么要它**：出片机不读 Dropbox，读的是本机镜像 `~/Library/Application Support/magicengine/studio/`（Dropbox「仅云端」的文件读不出来）。这份镜像以前只靠人手抄，Dropbox 里新加的片段、配乐一直进不去，下单就报「找不到文件」。2026-11-03 实查：CTS 缺 5 段片段和 8 首配乐，当天另一张单因镜像缺曲子失败两次。

**它做什么**：每天早上 8:00 跑一次 `tools/sync-studio-mirror.mjs --apply`（电脑当时在睡眠，醒来后补跑；开机登录时也跑一次）。当天急用刚放进 Dropbox 的素材，手动跑一次 `node scripts/factory-worker/tools/sync-studio-mirror.mjs --apply` 即可。PM 2026-11-04 定：不需要高频，每天一次足够。对每个客户文件夹的 `remotion-assets`、`brandkit`，以及共享的 `Music`、`_shared/music`：
- Dropbox 有、镜像没有 → 补进去；Dropbox 的版本更新且内容不同 → 覆盖成新的。
- 大小一样只是修改时间新 → 先比内容，一样就只对齐时间，不重抄。
- 镜像里的版本更新（有人直接改了镜像）→ 不覆盖，日志里标 `!`。
- 只在镜像里有的文件 → **永远不删**，日志里标 `?`。
- 有文件补进去后，重建 `MIRROR-MANIFEST.json`（每个文件的大小和 sha256）。

客户文件夹按镜像里已有的顶层文件夹来（现在是 `CTS`、`East_Inter`）。新客户第一次要出片时，先在镜像里建一个同名空文件夹，下一轮就会自动补齐。

**先手动看一眼（不动任何文件）**：
```bash
node scripts/factory-worker/tools/sync-studio-mirror.mjs --check
```
退出码 0 = 已经同步；1 = 有文件要补（会逐个列出）；2 = 目录找不到或参数不对。

**装**（`REPO` 换成出片机跑的那份代码目录，现在是 `/Users/raydeng/Projects/magic-engine-worker`；要等这个工具合进主干、出片机目录更新后再装）：
```bash
REPO=/Users/raydeng/Projects/magic-engine-worker
sed -e "s#__NODE__#$(which node)#" -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  $REPO/scripts/factory-worker/launchd/com.magicengine.studio-mirror-sync.plist \
  > ~/Library/LaunchAgents/com.magicengine.studio-mirror-sync.plist
plutil -lint ~/Library/LaunchAgents/com.magicengine.studio-mirror-sync.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.magicengine.studio-mirror-sync.plist
```

**看它跑没跑**：日志最后一行是一条 `{"event":"studio_mirror_sync",...}`，`failed` 为 0 就是好的。
```bash
tail -3 ~/Library/Logs/magicengine-studio-mirror-sync.log
```

**卸载**：
```bash
launchctl bootout gui/$(id -u)/com.magicengine.studio-mirror-sync
rm ~/Library/LaunchAgents/com.magicengine.studio-mirror-sync.plist
```
