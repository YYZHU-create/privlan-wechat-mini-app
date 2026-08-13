const core = require("./common");

exports.main = async () => {
  const id = core.requestId();
  try {
    let faqVersion = "builtin";
    try {
      const records = await core.searchRecords("FEISHU_FAQ_TABLE_ID", [], 1);
      if (records[0]) faqVersion = records[0].record_id;
    } catch (error) {
      if (!String(error.code || "").includes("CONFIGURED")) throw error;
    }
    return core.ok({
      faqVersion,
      answerProvider: core.env("DEEPSEEK_API_KEY") ? "deepseek_rag" : "rules",
      modelProvider: core.env("DEEPSEEK_API_KEY") ? "deepseek" : "rules",
      model: core.env("DEEPSEEK_MODEL", "deepseek-v4-flash"),
      authMode: core.env("AUTH_MODE", "test") === "wechat" ? "wechat" : "test",
      humanServiceEnabled: core.env("HUMAN_SERVICE_ENABLED", "false") === "true"
    }, "客服配置已加载", id);
  } catch (error) {
    return core.handleError(error, id);
  }
};
