# 做片拼片 worker 容器：node(跑编排/上传) + python3-PIL(画字幕) + ffmpeg(拼接) + 中文字体。
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pil ffmpeg fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖(利用缓存)。worker 复用 src/lib，需要 @supabase / openai / @anthropic-ai / tsx 等。
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN npm install tsx

COPY . .

# 中文字体路径(PIL 画字幕用)。fonts-noto-cjk 装到此处。
ENV FACTORY_CJK_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc

# 常驻轮询做片任务
CMD ["npx", "tsx", "scripts/render-worker/worker.ts"]
