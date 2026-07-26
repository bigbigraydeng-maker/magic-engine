/**
 * 视觉相关性闸的 OpenAI 调用层(抽出来是为了让判定逻辑可以纯函数测试)。
 * 写法沿用 src/lib/assets/vision-analyzer.ts —— 同一个模型、同一套 detail:'low'。
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'

export async function callOpenAIVision(imageUrl: string, systemPrompt: string): Promise<string> {
  const client = getOpenAIClient()
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          // detail:'low' 足够判断「画面是什么」,且便宜一个量级
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          { type: 'text', text: 'Screen this image.' },
        ],
      },
    ],
  })
  return res.choices[0]?.message?.content ?? '{}'
}
