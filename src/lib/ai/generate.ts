/**
 * Content Generation Engine
 * Integrates with OpenAI to generate platform-specific captions
 */

import OpenAI from 'openai';
import { getOpenAIClient } from '@/lib/ai/openai-client';

export type Platform = 'facebook' | 'xiaohongshu';
export type Language = 'zh' | 'en';

export interface GenerationInput {
  topic: string;
  keywords: string[];
  targetAudience?: string;
  tone: 'professional' | 'casual' | 'inspirational';
  platform: Platform;
  language: Language;
}

export interface GenerationOutput {
  captions: string[];
  hashtags: string[];
  cost_usd: number;
  tokens_used: number;
}

/**
 * Generate captions for a given topic and platform
 */
export async function generateCaptions(input: GenerationInput): Promise<GenerationOutput> {
  const openai = getOpenAIClient()
  const prompt = buildPrompt(input);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: getSystemPrompt(input.platform, input.language),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 1200,
    });

    const content = response.choices[0].message.content || '';
    const { captions, hashtags } = parseGenerationResponse(content);

    // Calculate cost: gpt-4o is $2.50 per 1M input tokens, $10.00 per 1M output tokens
    const inputCost = (response.usage?.prompt_tokens || 0) * 0.0000025;
    const outputCost = (response.usage?.completion_tokens || 0) * 0.00001;
    const totalCost = inputCost + outputCost;

    return {
      captions,
      hashtags,
      cost_usd: parseFloat(totalCost.toFixed(6)),
      tokens_used: (response.usage?.total_tokens || 0),
    };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get system prompt based on platform and language
 */
function getSystemPrompt(platform: Platform, language: Language): string {
  const languageName = language === 'zh' ? '简体中文' : 'English';

  if (platform === 'xiaohongshu') {
    return `你是一位拥有50万粉丝的小红书头部创作者，擅长写出高互动、高收藏的爆款笔记。

核心要求：
- 使用${languageName}
- 标题要吸引眼球，使用数字、反问、悬念等技巧（如"3个月涨粉10万的秘密"）
- 正文分段清晰，用emoji分隔段落，增加可读性
- 开头用hook抓住读者（痛点共鸣/反常识/故事开头）
- 中间提供干货价值（步骤、清单、对比、案例）
- 结尾引导互动（提问、投票、"你觉得呢？"）
- 字数控制在300-500字
- 语气真诚、像朋友分享，不像广告
- 包含5-8个精准话题标签

输出格式（严格遵守）：
主文案：[完整文案，包含标题和正文]
标签：[多个标签，用空格分隔]`;
  }

  return `You are a top-tier Facebook content strategist managing pages with 100K+ followers. You create viral, high-engagement posts.

Core Requirements:
- Use ${languageName}
- Write a compelling hook in the first line (question, bold statement, or story opener)
- Use storytelling or data-driven insights to provide real value
- Include a clear call-to-action (comment, share, tag a friend)
- Use line breaks and emojis strategically for readability
- Length: 150-400 characters for the main caption
- Tone should feel authentic and human, not corporate
- Include 5-8 targeted hashtags mixing popular and niche tags
- Add a conversation starter question at the end

Output format (follow strictly):
Caption: [full caption with hook, body, and CTA]
Hashtags: [space-separated hashtags]`;
}

/**
 * Build user prompt from input
 */
function buildPrompt(input: GenerationInput): string {
  const parts = [
    `Topic: ${input.topic}`,
    `Keywords: ${input.keywords.join(', ')}`,
  ];

  if (input.targetAudience) {
    parts.push(`Target Audience: ${input.targetAudience}`);
  }

  parts.push(`Tone: ${input.tone}`);
  parts.push(`Generate 3 different caption options for this topic.`);

  return parts.join('\n');
}

/**
 * Parse generation response — robust parser with fallback
 */
function parseGenerationResponse(content: string): { captions: string[]; hashtags: string[] } {
  const allHashtags: Set<string> = new Set();

  // Extract all hashtags from the entire content first
  const hashtagMatches = content.match(/#[\w\u4e00-\u9fff\u3400-\u4dbf]+/g) || [];
  hashtagMatches.forEach(tag => allHashtags.add(tag));

  // Try to extract caption part (remove hashtag lines)
  const captionLines: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip metadata labels and pure hashtag lines
    if (/^(Caption|主文案|标签|Hashtags?|Tags|Option\s*\d+)\s*[:：]/i.test(trimmed)) {
      // If this is a caption label, grab everything after the colon
      const afterColon = trimmed.replace(/^[^:：]+[:：]\s*/, '');
      if (afterColon && !/^#/.test(afterColon)) {
        captionLines.push(afterColon);
      }
      continue;
    }
    // Skip lines that are only hashtags
    if (/^[#\s]+$/.test(trimmed) || /^(#[\w\u4e00-\u9fff]+\s*)+$/.test(trimmed)) {
      continue;
    }
    if (trimmed) {
      captionLines.push(trimmed);
    }
  }

  // Build the caption: either parsed lines or the entire content as fallback
  let caption = captionLines.join('\n').trim();
  if (!caption || caption.length < 20) {
    // Fallback: use original content minus hashtags at the end
    caption = content.replace(/\n*(?:标签|Hashtags?|Tags)\s*[:：][\s\S]*$/i, '').trim();
  }

  return {
    captions: caption ? [caption] : [],
    hashtags: Array.from(allHashtags).slice(0, 8),
  };
}

/**
 * Generate image search queries for content
 */
export async function generateImageQueries(input: {
  topic: string;
  keywords: string[];
  platform: Platform;
}): Promise<string[]> {
  const openai = getOpenAIClient()
  const prompt = `For the topic "${input.topic}" with keywords [${input.keywords.join(', ')}],
generate 3 different search queries that would find relevant, high-quality images suitable for ${input.platform}.
Return only the 3 search queries, one per line, without numbering or explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });

    const content = response.choices[0].message.content || '';
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 3);
  } catch (error) {
    console.error('Error generating image queries:', error);
    return [];
  }
}

/**
 * Validate OpenAI API key at startup
 */
export async function validateOpenAIKey(): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not configured');
    return false;
  }

  const openai = getOpenAIClient()
  try {
    // Make a minimal API call to validate the key
    await openai.models.list();
    console.log('✓ OpenAI API key validated');
    return true;
  } catch (error) {
    console.error('✗ OpenAI API key validation failed:', error);
    return false;
  }
}

/**
 * Mock generation for development
 */
export async function generateCaptionsMock(input: GenerationInput): Promise<GenerationOutput> {
  const mockCaptions = {
    facebook_en: [
      `Hey entrepreneurs! 🚀 Did you know that AI-powered content can boost your engagement by 300%? Here's how...`,
      `Your CEO could be using ${input.keywords[0]} to scale faster. Learn the secret today!`,
      `We built a $1B AI company by focusing on ${input.keywords[0]}. What's holding you back?`,
    ],
    facebook_zh: [
      `AI创业者必看！🚀 你知道吗，用AI生成的内容能让你的数据翻倍增长！`,
      `我们的CEO用${input.keywords[0]}打造了十亿美金的公司。你呢？`,
      `想要像我们一样成功？先掌握这个${input.keywords[0]}的秘诀...`,
    ],
    xiaohongshu_zh: [
      `【${input.topic}秘籍】\n作为一个${input.tone}的内容创作者，我想告诉你，${input.keywords[0]}真的改变了我的创业之路。最关键的是...`,
      `小红书创作者必读！\n你有没有想过，为什么有些账号一个月粉丝增长10倍？秘密就在于懂${input.keywords[0]}...`,
      `${input.topic}不止这样简单\n我在创业的这3年，学到了最值得分享的是...`,
    ],
    xiaohongshu_en: [
      `AI Entrepreneur's Guide\nIf you're serious about building a unicorn, ${input.keywords[0]} should be your priority. Here's why...`,
      `The Secret to Scaling\nMost entrepreneurs miss this crucial step about ${input.keywords[0]}...`,
      `CEO Tips & Tricks\nUsing ${input.keywords[0]} helped us reach $1B valuation faster. Let me share...`,
    ],
  };

  const key = `${input.platform}_${input.language}` as keyof typeof mockCaptions;
  const captions = mockCaptions[key] || mockCaptions.facebook_en;

  const mockHashtags = [
    '#AI', '#创业', '#内容运营',
    '#企业家', '#科技',
  ];

  return {
    captions: captions.slice(0, 3),
    hashtags: mockHashtags.slice(0, 5),
    cost_usd: 0.001, // Mock cost
    tokens_used: 150,
  };
}
