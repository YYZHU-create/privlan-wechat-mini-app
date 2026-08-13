function normalizeBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?/i.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?/i.test(baseUrl)) {
    throw new Error("模型接口必须使用 HTTPS；本机开发地址可使用 localhost");
  }
  return baseUrl;
}

function endpointFor(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, text, context, timeoutMs = 12000, temperature = 0.2, maxTokens = 500 }) {
  if (!apiKey) throw new Error("API Key 未配置");
  if (!model) throw new Error("模型名称未配置");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000, Math.max(3000, Number(timeoutMs) || 12000)));
  try {
    const response = await fetch(endpointFor(baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: Math.min(1, Math.max(0, Number(temperature) || 0.2)),
        max_tokens: Math.min(2000, Math.max(100, Number(maxTokens) || 500)),
        messages: [
          { role: "system", content: "你是零售品牌客服。只能依据提供的店铺知识回答；不得编造价格、库存、订单、量体、退款或承诺；不得执行交易和敏感数据操作；资料不足时明确说明并建议人工。回答简洁、中文、无营销夸张。" },
          { role: "system", content: `店铺知识：${context || "暂无额外知识"}` },
          { role: "user", content: String(text || "") }
        ]
      })
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (error) { throw new Error(`模型接口返回了无法解析的数据（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(data.error?.message || data.message || `模型接口请求失败（HTTP ${response.status}）`);
    const content = String(data.choices?.[0]?.message?.content || "").trim();
    if (!content) throw new Error("模型接口未返回回答内容");
    return {
      content,
      model: String(data.model || model),
      usage: {
        prompt_tokens: Number(data.usage?.prompt_tokens || 0),
        completion_tokens: Number(data.usage?.completion_tokens || 0),
        total_tokens: Number(data.usage?.total_tokens || 0)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callOpenAiCompatible, normalizeBaseUrl };
