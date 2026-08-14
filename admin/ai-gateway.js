const dns = require("dns").promises;
const net = require("net");

function providerError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  let parsed;
  try { parsed = new URL(raw); } catch (error) { throw providerError("AI_PROVIDER_URL_INVALID", "模型接口地址无效", 400); }
  if (parsed.username || parsed.password) throw providerError("AI_PROVIDER_URL_INVALID", "模型接口地址不能包含账号或密码", 400);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(hostname) && process.env.NODE_ENV !== "production";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalDevelopment)) {
    throw providerError("AI_PROVIDER_URL_INSECURE", "模型接口必须使用 HTTPS；本机开发地址仅可使用 localhost", 400);
  }
  return raw;
}

function endpointFor(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase().split("%")[0];
  if (!normalized) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (net.isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

async function assertSafeProviderEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const localDevelopment = ["localhost", "127.0.0.1", "::1"].includes(host) && process.env.NODE_ENV !== "production";
  if (localDevelopment) return;
  if (net.isIP(host) && isPrivateAddress(host)) throw providerError("AI_PROVIDER_URL_BLOCKED", "模型接口不能指向本机、内网或保留地址", 400);
  let addresses;
  try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
  catch (error) { throw providerError("AI_PROVIDER_DNS_FAILED", "无法解析模型接口域名，请检查地址", 502); }
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw providerError("AI_PROVIDER_URL_BLOCKED", "模型接口域名解析到了本机、内网或保留地址", 400);
  }
}

function safeUsage(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, text, context, timeoutMs = 12000, temperature = 0.2, maxTokens = 500 }) {
  if (!apiKey) throw providerError("AI_PROVIDER_KEY_MISSING", "API Key 未配置", 400);
  if (!model) throw providerError("AI_PROVIDER_MODEL_MISSING", "模型名称未配置", 400);
  const endpoint = endpointFor(baseUrl);
  await assertSafeProviderEndpoint(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000, Math.max(3000, Number(timeoutMs) || 12000)));
  try {
    let response;
    try {
      response = await fetch(endpoint, {
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
    } catch (error) {
      if (error?.name === "AbortError") throw providerError("AI_PROVIDER_TIMEOUT", "模型接口响应超时", 504);
      throw providerError("AI_PROVIDER_UNREACHABLE", "无法连接模型接口", 502);
    }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch (error) { throw providerError("AI_PROVIDER_INVALID_RESPONSE", `模型接口返回了无法解析的数据（HTTP ${response.status}）`, 502); }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw providerError("AI_PROVIDER_UNAUTHORIZED", "模型接口拒绝认证，请检查 API Key", 502);
      if (response.status === 429) throw providerError("AI_PROVIDER_RATE_LIMITED", "模型供应商当前限流或额度不足", 503);
      if (response.status >= 500) throw providerError("AI_PROVIDER_UNAVAILABLE", `模型供应商暂时不可用（HTTP ${response.status}）`, 502);
      throw providerError("AI_PROVIDER_REQUEST_REJECTED", `模型接口拒绝了请求（HTTP ${response.status}）`, 502);
    }
    const content = String(data.choices?.[0]?.message?.content || "").trim();
    if (!content) throw providerError("AI_PROVIDER_EMPTY_RESPONSE", "模型接口未返回回答内容", 502);
    const promptTokens = safeUsage(data.usage?.prompt_tokens);
    const completionTokens = safeUsage(data.usage?.completion_tokens);
    return {
      content,
      model: String(data.model || model),
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: safeUsage(data.usage?.total_tokens) || promptTokens + completionTokens
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callOpenAiCompatible, normalizeBaseUrl, assertSafeProviderEndpoint, isPrivateAddress };
