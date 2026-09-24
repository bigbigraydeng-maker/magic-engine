import OpenAI from 'openai';

export interface ExtractedCustomer {
  customerName: string | null;
  pax: number | null;
  tripType: string | null;
  travelDates: string | null;
  specificNeeds: string | null;
}

export interface AgentCustomerExtractInput {
  clientId: string;
  agentContactId: string;
  emails: Array<{
    subject: string | null;
    bodyPreview: string | null;
    direction: 'inbound' | 'outbound';
    occurredAt: string; // ISO
  }>;
}

export interface AgentCustomerExtractResult {
  customers: ExtractedCustomer[];
  reason: string | null;
}

const MODEL = 'gpt-4o-mini';
const MAX_STRING_LENGTH = 500;

const SYSTEM_PROMPT = `你是一个旅游行业 CRM 的信息提取助手。

你面对的是同行旅行社（Agent）发来的邮件。Agent 会代他们的终端客户向你（旅行社）询价或沟通订团事宜。

你的任务：从邮件中提取 0..N 个终端客户的信息。一封邮件可能同时提到多个客户。

对每个客户，提取以下字段：
- customerName：终端客户姓名（原文，如 "Chris Brown"）
- pax：人数（整数，如 2）。无法确定时为 null
- tripType：团型 / 线路名称（如 "China Panorama 17D"）。无法确定时为 null
- travelDates：出发日期（原文，如 "March 2027"）。无法确定时为 null
- specificNeeds：特殊需求（饮食、无障碍、房型等）。无法确定时为 null

规则：
1. 只提取终端客户，不要把 Agent 本人当成客户。
2. 如果邮件是发票、行政沟通、内部协调等跟订团无关的内容，返回空数组，并在 reason 里说明原因。
3. 如果邮件是 Agent 回复询价（而非首次询价），只提取新增或变更的信息。
4. 不要编造信息。无法确定的字段一律填 null。

输出严格的 JSON，格式如下：
{
  "customers": [
    {
      "customerName": "Chris Brown",
      "pax": 2,
      "tripType": "China Panorama 17D",
      "travelDates": "March 2027",
      "specificNeeds": null
    }
  ],
  "reason": null
}

当 customers 为空数组时，reason 必须说明原因（如 "邮件是发票沟通，跟订团无关"）。`;

function truncate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_STRING_LENGTH);
}

function parsePax(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function sanitizeCustomer(raw: unknown): ExtractedCustomer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const customer: ExtractedCustomer = {
    customerName: truncate(record.customerName),
    pax: parsePax(record.pax),
    tripType: truncate(record.tripType),
    travelDates: truncate(record.travelDates),
    specificNeeds: truncate(record.specificNeeds),
  };
  const hasAnyField = Object.values(customer).some((v) => v !== null);
  return hasAnyField ? customer : null;
}

function buildUserPrompt(input: AgentCustomerExtractInput): string {
  const emails = input.emails
    .map((email, index) => {
      const subject = email.subject ?? '(无主题)';
      const body = email.bodyPreview ?? '(无正文预览)';
      return [
        `--- 邮件 ${index + 1} ---`,
        `方向：${email.direction === 'inbound' ? 'Agent 发来' : '我方发出'}`,
        `时间：${email.occurredAt}`,
        `主题：${subject}`,
        `正文预览：${body}`,
      ].join('\n');
    })
    .join('\n\n');
  return `请从以下 ${input.emails.length} 封邮件中提取终端客户信息：\n\n${emails}`;
}

function parseResult(content: string): AgentCustomerExtractResult {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null) {
    return { customers: [], reason: '提取失败：返回内容不是 JSON 对象' };
  }
  const record = parsed as Record<string, unknown>;
  const rawCustomers = Array.isArray(record.customers) ? record.customers : [];
  const customers = rawCustomers
    .map(sanitizeCustomer)
    .filter((c): c is ExtractedCustomer => c !== null);
  const reason = truncate(record.reason);
  return { customers, reason };
}

export async function extractAgentCustomers(
  input: AgentCustomerExtractInput,
): Promise<AgentCustomerExtractResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 未配置');
  }
  if (input.emails.length === 0) {
    return { customers: [], reason: '没有可提取的邮件' };
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return { customers: [], reason: '提取失败：OpenAI 返回空内容' };
    }
    return parseResult(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { customers: [], reason: `提取失败：${message}` };
  }
}
