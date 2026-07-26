#!/usr/bin/env python3
"""
「行程单自己写出来」—— 一种全片零照片的短视频形态。

为什么做这个(2026-07-26,PM 连说五轮「千篇一律」之后):
我们的素材全是所有同行都在用的免费图库地标照,靠排列组合永远撞脸。
这个形态**一张照片都不用** —— 物理上不可能退化成「好看的风景照慢推」。
留人机制不是「好看」,是「这张单子还没写完」——一个未完成的过程本身就是钩子。

护城河在哪:抄它需要一个逐帧渲染器,不是换一张图。而且内容是 CTS 官网上
真实存在、别家写不出来的行程事实(G89 车次、最多 18 人、慕田峪缆车上滑道下)。

技术路线:PIL 逐帧画 → ffmpeg 编码。不碰 make_promo(那个引擎不在 git 里、
三条产线共用、改坏没有回滚),所以这条形态的风险跟现有产线完全隔离。

用法:
  python3 scripts/render-itinerary-reel.py out.mp4
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30

# 🔴 Meta Reels 安全带:顶部 270px 和底部 672px 会被平台 UI(头像/文案/按钮)盖住。
# 所有**必须被看到**的内容只能落在 y=270~1248 之间。
# 第一版我把 CTA 放 1760、数字放 1500 —— 在手机上等于没有。
# (这跟旧引擎里那个「字幕画在 1556/1620」的洞是同一个,我自己又犯了一遍。)
SAFE_TOP, SAFE_BOT = 270, 1248
RED = (209, 29, 58)
INK = (26, 26, 28)
PAPER = (247, 245, 240)
MUTED = (120, 118, 112)

F = "/System/Library/Fonts/Supplemental/%s"
def font(name, size):
    return ImageFont.truetype(F % name, size)

BLACK  = lambda s: font("Arial Black.ttf", s)
BOLD   = lambda s: font("Arial Bold.ttf", s)
REG    = lambda s: font("Arial.ttf", s)

# ── 内容:全部来自 CTS 官网可溯源事实 ────────────────────────────────────────────
# 🔴 红线:这里每一行都必须能在官网指出出处。禁止为了好看编行程。
TITLE_1 = "CHINA. 10 DAYS."
TITLE_2 = "Here's the actual plan."
LINES = [
    ("DAY 1",  "Auckland — Beijing",            "flight included"),
    ("DAY 3",  "The Great Wall",                "Mutianyu section"),
    ("DAY 5",  "Hutong by pedi-cab",            "a local family visit"),
    ("DAY 6",  "Beijing — Xi'an",               "train G89, seats booked"),
    ("DAY 7",  "Terracotta Warriors",           "entrance included"),
    ("DAY 9",  "Xi'an city wall",               "sunset ride"),
]
FACTS = [("18", "people max"), ("0", "middlemen"), ("25", "years Kiwi-led")]
STAMP = "CTS TOURS"
CTA = "Search CTS Tours NZ"


def ease(t):
    """缓出 —— 线性位移看起来像 PPT,这是「有没有质感」的分界线"""
    return 1 - (1 - t) ** 3


def base_paper():
    """纸底 + 极轻的暗角。不用纯白:纯白在手机上刺眼,也显廉价。"""
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for i in range(90):                      # 顶部渐深,给标题压住重量
        a = int(10 * (1 - i / 90))
        d.line([(0, i), (W, i)], fill=(PAPER[0]-a, PAPER[1]-a, PAPER[2]-a))
    d.rectangle([0, 0, W, 14], fill=RED)     # 顶部红条 = 品牌锚点,不占正文空间
    return img


def draw_center(d, cy, text, f, fill):
    b = d.textbbox((0, 0), text, font=f)
    d.text(((W - (b[2]-b[0])) / 2 - b[0], cy - (b[3]-b[1]) / 2 - b[1]), text, font=f, fill=fill)


def frame(t):
    """t = 秒。整片时间轴写在这一个函数里,便于调节奏。"""
    img = base_paper()
    d = ImageDraw.Draw(img)

    # 时间轴锚点
    T_LIST = 0.95                       # 行程开始落
    STEP = 0.42                         # 每条间隔(比第一版快 1.5 倍)
    T_FACTS = T_LIST + len(LINES) * STEP + 0.20
    T_STAMP = T_FACTS + 1.05

    # ① 0-0.95s 标题(第一帧就有字 —— 开场 3 秒是生死线)
    if t < T_LIST:
        p = ease(min(t / 0.30, 1))
        draw_center(d, 620 + (1 - p) * -50, TITLE_1, BLACK(int(100 + 14 * (1 - p))), INK)
        if t > 0.26:
            q = ease(min((t - 0.26) / 0.26, 1))
            draw_center(d, 750, TITLE_2, BOLD(int(46 * q + 8)), MUTED)
        return img

    # ── 后半段:列表整体在 T_FACTS 之后收起,给数字腾地方(不再堆成一堵文字墙)
    collapse = 0.0 if t < T_FACTS else ease(min((t - T_FACTS) / 0.35, 1))

    # ② 行程逐条落下,像有人当场在写
    draw_center(d, SAFE_TOP + 50, TITLE_1, BLACK(58), INK)
    d.line([(140, SAFE_TOP + 110), (W - 140, SAFE_TOP + 110)], fill=(210, 206, 198), width=3)

    y0, gap = SAFE_TOP + 175, 132
    for i, (day, what, sub) in enumerate(LINES):
        ts = T_LIST + i * STEP
        if t < ts:
            break
        p = ease(min((t - ts) / 0.22, 1))
        x = 140 + (1 - p) * 80
        y = y0 + i * gap
        # 收起阶段:整列往上滑并变淡,不是硬切消失
        y -= collapse * 110
        fade = 1 - collapse
        if fade <= 0.05:
            continue
        ink = tuple(int(c + (PAPER[j] - c) * collapse) for j, c in enumerate(INK))
        mut = tuple(int(c + (PAPER[j] - c) * collapse) for j, c in enumerate(MUTED))
        red = tuple(int(c + (PAPER[j] - c) * collapse) for j, c in enumerate(RED))
        d.rounded_rectangle([x, y - 6, x + 158, y + 56], 10, fill=red)
        d.text((x + 18, y + 6), day, font=BOLD(34), fill=tuple(int(255 + (PAPER[j] - 255) * collapse) for j in range(3)))
        d.text((x + 184, y - 4), what, font=BLACK(48), fill=ink)
        if t > ts + 0.14:
            d.text((x + 186, y + 54), sub, font=REG(31), fill=mut)

    # ③ 三个硬事实:一次一个砸出来,落在安全带正中
    if t > T_FACTS:
        for i, (n, label) in enumerate(FACTS):
            ts = T_FACTS + i * 0.30
            if t < ts:
                break
            p = ease(min((t - ts) / 0.18, 1))
            cx = 200 + i * 340
            sz = int(190 * (0.55 + 0.45 * p))       # 从小砸大
            b = d.textbbox((0, 0), n, font=BLACK(sz))
            d.text((cx - (b[2]-b[0]) / 2 - b[0], 700 - (b[3]-b[1]) / 2 - b[1]), n, font=BLACK(sz), fill=RED)
            if p > 0.6:
                f3 = BOLD(30)
                b2 = d.textbbox((0, 0), label, font=f3)
                d.text((cx - (b2[2]-b2[0]) / 2 - b2[0], 810), label, font=f3, fill=INK)

    # ④ 印章落下 —— 收尾不淡出,用一个实体动作;落在数字下方的空白处
    if t > T_STAMP:
        p = min((t - T_STAMP) / 0.18, 1)
        sc = 2.2 - 1.2 * ease(p)
        ang = 7 * (1 - ease(p))
        stamp = Image.new("RGBA", (900, 240), (0, 0, 0, 0))
        sd = ImageDraw.Draw(stamp)
        sd.rounded_rectangle([6, 6, 894, 234], 16, outline=RED + (255,), width=9)
        f2 = BLACK(92)
        bb = sd.textbbox((0, 0), STAMP, font=f2)
        sd.text(((900-(bb[2]-bb[0]))/2 - bb[0], (240-(bb[3]-bb[1]))/2 - bb[1]), STAMP, font=f2, fill=RED + (255,))
        s2 = stamp.rotate(ang, resample=Image.BICUBIC, expand=True)
        s2 = s2.resize((max(1, int(s2.width * sc * 0.55)), max(1, int(s2.height * sc * 0.55))), Image.LANCZOS)
        img.paste(s2, (int(W/2 - s2.width/2), int(1010 - s2.height/2)), s2)
        if t > T_STAMP + 0.35:
            draw_center(d, 1190, CTA, BOLD(42), INK)   # 仍在安全带内
    return img


def main(out="itinerary.mp4"):
    total = 0.95 + len(LINES) * 0.42 + 0.20 + 1.05 + 0.18 + 1.6
    tmp = tempfile.mkdtemp(prefix="itin_")
    n = int(total * FPS)
    for i in range(n):
        frame(i / FPS).save(f"{tmp}/f_{i:05d}.png")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
                    "-i", f"{tmp}/f_%05d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-crf", "18", out], check=True)
    print(f"DONE -> {out}  {total:.1f}s  {n} frames")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "itinerary.mp4")
