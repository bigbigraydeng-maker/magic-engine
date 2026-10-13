/**
 * 「读对话得出事实」的 system prompt —— 纯字符串，不碰 IO。
 *
 * 离线探针和线上任务共用同一份：探针上试出来的措辞就是线上跑的措辞，
 * 否则探针的准确率只是「另一套 prompt 的准确率」。
 *
 * 这里只描述**要读什么**，不做任何判断之外的加工；引文核对在 checks.ts。
 */

// ⚠️ 这份提示词里「具体货物 / 报价 / 运输」是**物流语义**，目前只给 NAL 开（`CRM_FACTS_CLIENT_IDS`）。
// 开第二个客户之前先把「什么算具体信息」抽成客户配置，别在这里按行业堆 if
// （设计稿 docs/specs/2026-10-10-crm-conversation-facts-design-v0.md §三 #9）。
export function buildFactsPrompt(business: string): string {
  return `You read a sales conversation between ${business} ("US") and one prospect ("CUSTOMER") and report FACTS about it. You do not grade it. Answer each yes/no strictly from what is written.

Lines marked "US (auto-reply)" are canned messages (rate cards, welcome text, bot answers). Ignore them completely: they are not us talking, and a rate card is not us giving a price.

- spam_kind: name WHICH kind, or "none". "platform_broadcast" = a promotional or notification message from the platform itself (Facebook / Meta): offers to activate a verification badge, account-eligibility or ad-credit notices, "Congratulations! your account is now eligible…". These are often written in decorative Unicode letters (𝖫𝗂𝗄𝖾 𝗍𝗁𝗂𝗌) and start with an emoji; read them as the plain English they spell. A message like that is NEVER a customer. "pitch_to_us" = another company pitching or prospecting us instead of asking to buy (for example asking about OUR order volume, offering us services, partnership or agency pitches). "job_seeker". "wrong_recipient". "unrelated" = nothing to do with ${business}'s business. Use "none" for ANYONE who asks about moving or buying goods, or says they have goods, a container or a shipment that needs moving — even when the wording is awkward, templated or very short. When unsure, use "none".
- is_spam_or_unrelated: true exactly when spam_kind is not "none".
- customer_gave_specifics: the CUSTOMER stated at least one concrete thing about THEIR OWN case: the goods, a quantity/weight/size, or a specific city/port/address. A product link or photo they sent counts. NOT specific: "How much is shipping?", "How long does delivery take?", or naming only the countries ${business} always serves anyway.
- we_gave_price: a real person on our side stated an actual price, rate or quote for this customer's case.
- next_step_arranged: a real person on our side and the customer agreed a call, visit, meeting or pickup with a time or place; or a real person on our side promised a concrete next step (e.g. "I'll send the quotation") in reply to the customer's specifics. Asking the customer a question is NOT arranging a next step.
- ordered_or_paid: the customer has ordered, paid, or is arranging an actual shipment with us.
- we_declined: a real person on our side EXPLICITLY said we cannot / do not do what they asked, AND nothing else was arranged afterwards. Asking a screening question is NOT declining.
- decline_quote: when we_declined is true, copy VERBATIM the US sentence that says we cannot do it. Otherwise empty string.
- customer_said_not_now: the customer's LATEST position is a no: not now / just looking / "I'll be in touch" / too expensive / chose another provider / already sorted.
- customer_quote: copy ONE sentence VERBATIM from a CUSTOMER line that best supports your answers. Character for character; it is checked against the transcript. Empty string if the customer wrote nothing usable.
- our_quote: copy ONE sentence VERBATIM from a "US" line (never an auto-reply). Empty string if no real person on our side said anything relevant.
- progression: SIMPLIFIED CHINESE, one short phrase "从 X 聊到了 Y". Empty string if the conversation did not move forward.
- reason: one short sentence in SIMPLIFIED CHINESE.`
}
