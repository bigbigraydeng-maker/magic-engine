#!/usr/bin/env python3
"""
纸面事实卡渲染器 —— 给 build-cinematic-reel.mjs 供片段。

设计意图:跟深色实景镜头**交替**出现。明暗反差本身就是最硬的「切」,
而且这些卡是程序化生成的 —— 别人拿同一批免费图库照抄不出这个节奏。

🔴 所有文字必须落在 Meta Reels 安全带 y=270~1248 内(顶 270 / 底 672 被平台 UI 盖住)。
   今天已经在两个地方踩过这个洞(旧引擎字幕画在 1556;我自己第一版 CTA 放 1760)。
"""
import json, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
SAFE_TOP, SAFE_BOT = 270, 1248
RED, INK, PAPER, MUTED = (209, 29, 58), (26, 26, 28), (247, 245, 240), (120, 118, 112)
F = "/System/Library/Fonts/Supplemental/%s"
BLACK = lambda s: ImageFont.truetype(F % "Arial Black.ttf", s)
BOLD = lambda s: ImageFont.truetype(F % "Arial Bold.ttf", s)
REG = lambda s: ImageFont.truetype(F % "Arial.ttf", s)

ease = lambda t: 1 - (1 - t) ** 3


def paper():
    img = Image.new("RGB", (W, H), PAPER)
    ImageDraw.Draw(img).rectangle([0, 0, W, 14], fill=RED)
    return img


def center(d, cy, text, f, fill):
    b = d.textbbox((0, 0), text, font=f)
    d.text(((W - (b[2] - b[0])) / 2 - b[0], cy - (b[3] - b[1]) / 2 - b[1]), text, font=f, fill=fill)


def card_frame(t, day, what, sub):
    """一张事实卡:日期块从左滑入,主句砸出,副句跟上。1.3 秒一张,够读不拖。"""
    img = paper()
    d = ImageDraw.Draw(img)
    p = ease(min(t / 0.22, 1))
    x = 150 + (1 - p) * 70
    y = 700
    d.rounded_rectangle([x, y - 8, x + 168, y + 58], 10, fill=RED)
    d.text((x + 20, y + 6), day, font=BOLD(36), fill=(255, 255, 255))
    if t > 0.10:
        q = ease(min((t - 0.10) / 0.20, 1))
        d.text((x + 196, y - 6 + (1 - q) * 14), what, font=BLACK(int(56 * (0.9 + 0.1 * q))), fill=INK)
    if t > 0.30:
        d.text((x + 198, y + 66), sub, font=REG(34), fill=MUTED)
    return img


def end_frame(t):
    """收尾卡:三个硬事实砸出 → 印章落下 → CTA。全部在安全带内。"""
    img = paper()
    d = ImageDraw.Draw(img)
    facts = [("18", "people max"), ("0", "middlemen"), ("25", "years Kiwi-led")]
    for i, (n, label) in enumerate(facts):
        ts = i * 0.26
        if t < ts:
            break
        p = ease(min((t - ts) / 0.16, 1))
        cx = 200 + i * 340
        sz = int(180 * (0.55 + 0.45 * p))
        b = d.textbbox((0, 0), n, font=BLACK(sz))
        d.text((cx - (b[2] - b[0]) / 2 - b[0], 600 - (b[3] - b[1]) / 2 - b[1]), n, font=BLACK(sz), fill=RED)
        if p > 0.6:
            f3 = BOLD(30)
            b2 = d.textbbox((0, 0), label, font=f3)
            d.text((cx - (b2[2] - b2[0]) / 2 - b2[0], 700), label, font=f3, fill=INK)

    ts = 0.26 * len(facts) + 0.20
    if t > ts:
        p = min((t - ts) / 0.16, 1)
        sc = 2.1 - 1.1 * ease(p)
        stamp = Image.new("RGBA", (900, 240), (0, 0, 0, 0))
        sd = ImageDraw.Draw(stamp)
        sd.rounded_rectangle([6, 6, 894, 234], 16, outline=RED + (255,), width=10)
        f2 = BLACK(92)
        bb = sd.textbbox((0, 0), "CTS TOURS", font=f2)
        sd.text(((900 - (bb[2] - bb[0])) / 2 - bb[0], (240 - (bb[3] - bb[1])) / 2 - bb[1]),
                "CTS TOURS", font=f2, fill=RED + (255,))
        s2 = stamp.rotate(6 * (1 - ease(p)), resample=Image.BICUBIC, expand=True)
        s2 = s2.resize((max(1, int(s2.width * sc * 0.55)), max(1, int(s2.height * sc * 0.55))), Image.LANCZOS)
        img.paste(s2, (int(W / 2 - s2.width / 2), int(950 - s2.height / 2)), s2)
        if t > ts + 0.35:
            center(d, 1160, "Search CTS Tours NZ", BOLD(42), INK)
    return img


def hook_overlay(payload, out_png):
    """
    🔴 开场钩子:画在**透明层**上,叠到那条真实的长城雪景上 ——
    既保住那张冲击力最强的实景,又不让开场 3 秒空着没字。
    第一版把钩子文案定义了却没接进渲染,成片开头 3 秒一个字都没有,
    正好违反我自己总结的「开场是生死线」。
    """
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    main, sub = payload["hook"][0], payload["hook"][1]
    f1, f2 = BLACK(96), BOLD(44)
    for cy, txt, f in ((470, main, f1), (580, sub, f2)):
        b = d.textbbox((0, 0), txt, font=f)
        x = (W - (b[2] - b[0])) / 2 - b[0]
        y = cy - (b[3] - b[1]) / 2 - b[1]
        d.text((x + 3, y + 4), txt, font=f, fill=(0, 0, 0, 150))          # 投影,压住亮雪景
        d.text((x, y), txt, font=f, fill=(255, 255, 255, 255),
               stroke_width=5 if f is f1 else 3, stroke_fill=(0, 0, 0, 210))
    d.rectangle([W / 2 - 70, 524, W / 2 + 70, 530], fill=RED + (255,))
    img.save(out_png)


def encode(frames_dir, n, out):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
                    "-i", f"{frames_dir}/f_%05d.png", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "18", out], check=True)


def main():
    work, payload = sys.argv[1], json.loads(sys.argv[2])
    for i, (day, what, sub) in enumerate(payload["cards"]):
        tmp = tempfile.mkdtemp(prefix=f"card{i}_")
        n = int(1.4 * FPS)
        for k in range(n):
            card_frame(k / FPS, day, what, sub).save(f"{tmp}/f_{k:05d}.png")
        encode(tmp, n, f"{work}/card_{i}.mp4")
        print(f"card_{i} OK")
    hook_overlay(payload, f"{work}/hook.png")
    print("hook.png OK")
    tmp = tempfile.mkdtemp(prefix="cardend_")
    n = int(3.5 * FPS)
    for k in range(n):
        end_frame(k / FPS).save(f"{tmp}/f_{k:05d}.png")
    encode(tmp, n, f"{work}/card_end.mp4")
    print("card_end OK")


if __name__ == "__main__":
    main()
