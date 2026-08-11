const core = require("./common");

exports.main = async event => {
  const id = core.requestId();
  const openId = core.currentOpenId();
  try {
    await core.enforceRateLimit(openId, "customerMeasurements", 12, 10 * 60 * 1000);
    const session = await core.requireSession(event.sessionToken, openId);
    const customer = await core.getRecord("FEISHU_CUSTOMERS_TABLE_ID", session.customerRecordId);
    if (!customer) throw core.createError("CUSTOMER_NOT_FOUND", "客户档案不存在或已被移除", 404);
    const configuredFields = core.env("FEISHU_MEASUREMENT_FIELDS").split(",").map(value => value.trim()).filter(Boolean);
    const excluded = new Set([
      core.fieldName("FEISHU_FIELD_PHONE", "手机号"), core.fieldName("FEISHU_FIELD_MEMBER_NO", "会员号"),
      core.fieldName("FEISHU_FIELD_CUSTOMER_NAME", "姓名"), "OpenID", "客户ID", "备注"
    ]);
    const sourceFields = configuredFields.length ? configuredFields : Object.keys(customer.fields || {}).filter(name => !excluded.has(name));
    const items = sourceFields.map(label => ({ label, value: core.plainValue(customer.fields[label]) })).filter(item => item.value);
    await core.audit("measurements_viewed", openId, { customerRecordId: session.customerRecordId, itemCount: items.length });
    return core.ok({ items }, "量体信息读取成功", id);
  } catch (error) {
    await core.audit("measurements_failed", openId, { code: error.code || "UNKNOWN" });
    return core.handleError(error, id);
  }
};
