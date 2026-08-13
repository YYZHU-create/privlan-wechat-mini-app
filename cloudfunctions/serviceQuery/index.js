const core = require("./common");

const builtinFaq = [
  { keywords: ["价格", "价位", "多少钱"], answer: "价格会根据品类、面料和定制需求确定。告诉我感兴趣的商品或服务后，我可以提供更准确的价格范围。", source: "品牌价格政策" },
  { keywords: ["面料", "材质"], answer: "我们会根据季节、穿着场景和版型选择天然及高品质混纺面料，具体成分请以商品详情或顾问确认为准。", source: "商品与面料说明" },
  { keywords: ["版型", "款式", "剪裁"], answer: "PRIVLAN 注重克制轮廓与合体剪裁，顾问会结合身形、场合和偏好提供款式建议。", source: "品牌服务说明" },
  { keywords: ["周期", "多久", "制作时间"], answer: "制作周期会随品类、面料和工艺变化。完成量体和款式确认后，顾问会给出准确交付时间。", source: "定制服务政策" }
];

function splitKeywords(value) {
  return String(value || "").split(/[，,、;；\s]+/).map(item => item.trim()).filter(Boolean);
}

function sensitiveAction(text) {
  if (/量体|我的尺寸|身体数据/.test(text)) return { type: "action", action: "measurements", text: "量体信息属于私人数据，请先完成身份验证。" };
  if (/订单|物流|发货/.test(text)) return { type: "action", action: "orders", text: "查询订单需要先验证手机号并选择对应订单。" };
  if (/预约/.test(text)) return { type: "action", action: "appointment", text: "可以进入预约页选择日期和时间。系统会预留 135 分钟并避免时段冲突。" };
  if (/退款|退货|售后/.test(text)) return { type: "action", action: "afterSales", text: "退款与售后需要从对应订单发起，系统会校验订单和支付状态。" };
  return null;
}

async function searchFaq(text) {
  try {
    const records = await core.searchRecords("FEISHU_FAQ_TABLE_ID", [], 200);
    const matched = records.find(record => {
      const enabled = core.fieldValue(record, "FEISHU_FIELD_FAQ_ENABLED", "启用").toLowerCase();
      if (["false", "否", "0"].includes(enabled)) return false;
      const terms = splitKeywords(core.fieldValue(record, "FEISHU_FIELD_FAQ_KEYWORDS", "关键词"));
      const question = core.fieldValue(record, "FEISHU_FIELD_FAQ_QUESTION", "问题");
      return terms.some(term => text.includes(term)) || (question && text.includes(question));
    });
    if (!matched) return null;
    const answer = core.fieldValue(matched, "FEISHU_FIELD_FAQ_ANSWER", "回答");
    return answer ? { type: "faq", text: answer, faqId: matched.record_id, citations: ["飞书 FAQ"] } : null;
  } catch (error) {
    if (!String(error.code || "").includes("CONFIGURED")) throw error;
    return null;
  }
}

async function queryDeepSeek(text, faqContext = "") {
  const apiKey = core.env("DEEPSEEK_API_KEY");
  if (!apiKey) return null;
  const baseUrl = core.env("DEEPSEEK_BASE_URL", "https://api.deepseek.com").replace(/\/$/, "");
  const model = core.env("DEEPSEEK_MODEL", "deepseek-v4-flash");
  const response = await core.httpJson(`${baseUrl}/chat/completions`, {
    timeout: Number(core.env("DEEPSEEK_TIMEOUT_MS", "12000")),
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: "你是零售品牌客服。只能依据店铺知识回答，不得编造价格、库存、订单、量体、退款或承诺；不得执行交易和敏感数据操作；资料不足时说明并建议人工。回答简洁、中文。" },
        { role: "system", content: `可用知识：${faqContext || "暂无额外知识"}` },
        { role: "user", content: text }
      ]
    }
  });
  const answer = String(response.choices?.[0]?.message?.content || "").trim();
  return answer ? { type: "faq", text: answer, provider: "deepseek", model, citations: faqContext ? ["店铺 FAQ"] : [] } : null;
}

exports.main = async event => {
  const id = core.requestId();
  const openId = core.currentOpenId();
  try {
    await core.enforceRateLimit(openId, "serviceQuery", 30, 60 * 1000);
    const text = String(event.text || "").trim().slice(0, 400);
    if (!text) throw core.createError("INVALID_INPUT", "请输入想了解的问题");

    const action = sensitiveAction(text);
    if (action) return core.ok(action, "请通过安全操作继续", id);

    const matchedFaq = await searchFaq(text);
    try {
      const aiAnswer = await queryDeepSeek(text, matchedFaq?.text || builtinFaq.map(item => `${item.keywords[0]}：${item.answer}`).join("\n"));
      if (aiAnswer) return core.ok(aiAnswer, "已生成回答", id);
    } catch (error) {
      await core.audit("service_ai_fallback", openId, { code: String(error.code || "AI_ERROR"), requestId: id });
    }

    if (matchedFaq) return core.ok({ ...matchedFaq, provider: "rules", fallback: true }, "已从店铺知识中找到回答", id);
    const local = builtinFaq.find(item => item.keywords.some(term => text.includes(term)));
    if (local) return core.ok({ type: "faq", text: local.answer, faqId: "builtin", provider: "rules", fallback: true, citations: [local.source] }, "已从基础知识中找到回答", id);
    return core.ok({ type: "action", action: "human", provider: "rules", fallback: true, text: "现有知识中没有足够信息回答这个问题。你可以补充具体商品或需求，或转接人工顾问。" }, "建议联系人工顾问", id);
  } catch (error) {
    return core.handleError(error, id);
  }
};
