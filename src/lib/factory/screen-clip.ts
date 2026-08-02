// 录屏智能剪辑 — 把整屏录制的操作过程，变成能塞进课件位(1080x960)且看得清的一段插入画面。
//
// 「智能」在两件事上：
// 1. 自动裁到「真正在变化的区域」：整屏录制里侧边栏/标签页/Dock 全程不动，
//    只有正文在滚动/打字。取多帧两两做差，把有变化的像素框出来 = 客户想让人看的地方。
//    不这么裁的话，3360 宽的桌面缩到 1080，字小到看不清。
// 2. 自动配速：录屏比讲这段的时间长就加速(最多 3 倍，再长就掐尾)，短就播完定格补满。
//
// 纯计算部分(配速)在这里可测；裁切框检测要跑 ffmpeg + PIL，放 worker 容器里执行。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const exec = promisify(execFile)

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export interface FitPlan {
  /** 播放速度倍率(>1 = 加速)。 */
  speed: number
  /** 加速后仍超出目标时长时，掐掉尾巴只取前多少秒(null = 不掐)。 */
  trimTo: number | null
  /** 播完还差多少秒(用定格最后一帧补满)。 */
  padSeconds: number
}

const MAX_SPEED = 3
const MIN_SPEED = 1

/**
 * 把 clipSec 的录屏配到 targetSec 的段落里。
 * 长了先加速(封顶 3 倍)再掐尾；短了原速播完定格补满(不硬拉慢，慢放很假)。
 */
export function planClipFit(clipSec: number, targetSec: number): FitPlan {
  if (!(clipSec > 0) || !(targetSec > 0)) throw new Error('时长必须为正数')
  if (clipSec <= targetSec) {
    return { speed: MIN_SPEED, trimTo: null, padSeconds: targetSec - clipSec }
  }
  const needed = clipSec / targetSec
  const speed = Math.min(needed, MAX_SPEED)
  const afterSpeed = clipSec / speed
  return {
    speed,
    trimTo: afterSpeed > targetSec + 0.05 ? targetSec : null,
    padSeconds: 0,
  }
}

/**
 * 把检测到的变化区扩成目标宽高比，并夹回画面内。
 * 宁可多带一点上下文，也不要把字切掉：先按比例撑，再整体推回边界内。
 */
export function fitBoxToAspect(box: CropBox, frameW: number, frameH: number, aspect: number): CropBox {
  // 安全边距按各轴自己的尺寸给(3.5%)：能量法会把行首序号、左边框这种低能量像素修掉，
  // 边距不够就会看到「8个」被切成「个」。宁可多带一圈背景。
  const padX = Math.round(frameW * 0.035)
  const padY = Math.round(frameH * 0.035)
  let w = Math.min(box.w + padX * 2, frameW)
  let h = Math.min(box.h + padY * 2, frameH)
  let cx = box.x + box.w / 2
  let cy = box.y + box.h / 2

  // 按目标比例撑到能包住变化区
  if (w / h > aspect) h = w / aspect
  else w = h * aspect
  // 撑出画面就整体缩回来
  if (w > frameW) { w = frameW; h = w / aspect }
  if (h > frameH) { h = frameH; w = h * aspect }

  cx = Math.min(Math.max(cx, w / 2), frameW - w / 2)
  cy = Math.min(Math.max(cy, h / 2), frameH - h / 2)

  // ffmpeg 的 crop 要偶数：宽高向下取偶(不许变大)；位置也向下取偶，且允许为 0
  // (位置最小值必须是 0 不是 2，否则贴边时 x+w 会溢出画面一格)
  const evenSize = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
  const evenPos = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
  const outW = evenSize(Math.min(w, frameW))
  const outH = evenSize(Math.min(h, frameH))
  return {
    x: Math.min(evenPos(cx - outW / 2), evenPos(frameW - outW)),
    y: Math.min(evenPos(cy - outH / 2), evenPos(frameH - outH)),
    w: outW,
    h: outH,
  }
}

// 取样帧两两做差，累加出「哪些像素在变」，返回归一化(0-1)的包围盒。
// 只用 PIL(容器里已有)，不依赖 numpy。
const DIFF_PY = `
import sys, json, glob
from PIL import Image, ImageChops
files = sorted(glob.glob(sys.argv[1] + "/probe_*.png"))
if len(files) < 2:
    print(json.dumps(None)); sys.exit(0)
imgs = [Image.open(f).convert("L") for f in files]
acc = None
for a, b in zip(imgs, imgs[1:]):
    d = ImageChops.difference(a, b)
    acc = d if acc is None else ImageChops.lighter(acc, d)
# 阈值化:抖动/压缩噪点不算变化
mask = acc.point(lambda p: 1 if p > 28 else 0)
W, H = mask.size
px = list(mask.getdata())

# 只取包围盒会被「零星变化」带跑偏(菜单栏时钟在跳、Dock 图标在动、标签页在切),
# 于是整屏都算有变化。改成看变化能量的分布:掐掉两端各 8% 能量的稀疏尾巴,
# 留下真正在滚动/打字的主体区域。
def main_span(energy, pct=0.08):
    total = sum(energy)
    if total <= 0:
        return None
    lo, e = 0, 0
    while lo < len(energy) - 1 and e + energy[lo] < total * pct:
        e += energy[lo]; lo += 1
    hi, e = len(energy) - 1, 0
    while hi > lo and e + energy[hi] < total * pct:
        e += energy[hi]; hi -= 1
    return (lo, hi + 1)

cols = [0] * W
rows = [0] * H
for y in range(H):
    base = y * W
    r = 0
    for x in range(W):
        if px[base + x]:
            r += 1
            cols[x] += 1
    rows[y] = r

sx = main_span(cols)
sy = main_span(rows)
print(json.dumps(None if not sx or not sy else {
    "x": sx[0] / W, "y": sy[0] / H,
    "w": (sx[1] - sx[0]) / W, "h": (sy[1] - sy[0]) / H,
}))
`

/**
 * 检测录屏里「真正在变化」的区域，返回可直接用于 ffmpeg crop 的框(源分辨率坐标)。
 * 检测不出来(整段几乎静止)→ 返回 null，由调用方退回整屏等比裁切。
 */
export async function detectActiveRegion(params: {
  videoFile: string
  frameW: number
  frameH: number
  durationSec: number
  aspect: number
  dir: string
}): Promise<CropBox | null> {
  const { videoFile, frameW, frameH, durationSec, aspect, dir } = params
  const shots = 6
  for (let i = 0; i < shots; i++) {
    const t = (durationSec * (i + 0.5)) / shots
    await exec('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', videoFile,
      '-frames:v', '1', '-vf', 'scale=480:-2',
      join(dir, `probe_${String(i).padStart(2, '0')}.png`),
    ])
  }
  const { stdout } = await exec('python3', ['-c', DIFF_PY, dir])
  const norm = JSON.parse(stdout.trim() || 'null') as CropBox | null
  if (!norm || norm.w < 0.08 || norm.h < 0.08) return null   // 变化太小 = 没抓到内容区

  return fitBoxToAspect(
    { x: norm.x * frameW, y: norm.y * frameH, w: norm.w * frameW, h: norm.h * frameH },
    frameW, frameH, aspect,
  )
}
