const core = require("./common");

const builtinFaq = [
  { keywords: ["价格", "价位", "多少钱"], answer: "PRIVLAN 的价格会根据品类、面料和定制需求确定。留下你的需求后，品牌顾问会提供对应的价格区间。" },
  { keywords: ["面料", "材质"], answer: "我们会根据季节、穿着场景和版型选择适合的天然及高品质混纺面料，具体成分可在商品详情或咨询顾问时确认。" },
  { keywords: ["版型", "款式", "剪裁"], answer: "PRIVLAN 注重克制的轮廓与合体剪裁，可根据个人身形、场合和偏好由顾问提供款式建议。" },
  { keywords: ["周期", "多久", "制作时间"], answer: "制作周期会随品类、面料与工艺变化。完成量体和款式确认后，顾问会给出准确交付时间。" }
];

function keywords(value) {
  return String(value || "").split(/[，,、;；\s]+/).map(item => item.trim()).filter(Boolean);
}

exports.main = async event => {
  const id = core.requestId();
  const openId = core.currentOpenId();
  try {
    await core.enforceRateLimit(openId, "serviceQuery", 30, 60 * 1000);
    const text = String(event.text || "").trim().slice(0, 200);
    if (!text) throw core.createError("INVALID_INPUT", "请输入想了解的问题");
    let matched = null;
    try {
      const records = await core.searchRecords("FEISHU_FAQ_TABLE_ID", [], 200);
      matched = records.find(record => {
        const enabled = core.fieldValue(record, "FEISHU_FIELD_FAQ_ENABLED", "启用");
        if (["false", "否", "0"].includes(enabled.toLowerCase())) return false;
        const terms = keywords(core.fieldValue(record, "FEISHU_FIELD_FAQ_KEYWORDS", "关键词"));
        const question = core.fieldValue(record, "FEISHU_FIELD_FAQ_QUESTION", "问题");
        return terms.some(term => text.includes(term)) || (question && text.includes(question));
      });
    } catch (error) {
      if (!String(error.code || "").includes("CONFIGURED")) throw error;
    }

    if (matched) {
      const answer = core.fieldValue(matched, "FEISHU_FIELD_FAQ_ANSWER", "回答");
      if (answer) return core.ok({ type: "faq", text: answer, faqId: matched.record_id }, "已找到相关回答", id);
    }
    const local = builtinFaq.find(item => item.keywords.some(term => text.includes(term)));
    if (local) return core.ok({ type: "faq", text: local.answer, faqId: "builtin" }, "已找到相关回答", id);
    return core.ok({ type: "action", action: "human", text: "这个问题需要品牌顾问进一步确认。你可以转人工服务，或补充具体品类和需求。" }, "建议联系人工顾问", id);
  } catch (error) {
    return core.handleError(error, id);
  }
};
