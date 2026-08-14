const core = require("./common");

exports.main = async event => {
  const id = core.requestId();
  const openId = core.currentOpenId();
  try {
    await core.enforceRateLimit(openId, "customerAuth", 8, 10 * 60 * 1000);
    const action = String(event.action || "");
    let phone = "";
    let customer = null;

    if (action === "verifyTest") {
      if (core.env("AUTH_MODE", "wechat") !== "test") throw core.createError("INVALID_INPUT", "测试验证模式已关闭");
      const memberNo = String(event.memberNo || "").trim();
      phone = String(event.phone || "").trim();
      const code = String(event.code || "").trim();
      const expectedCode = core.env("TEST_AUTH_CODE");
      if (!expectedCode) throw core.createError("INVALID_CODE", "测试验证码尚未在云环境中配置", 503);
      if (!memberNo || !/^1\d{10}$/.test(phone)) throw core.createError("INVALID_INPUT", "会员号或手机号格式不正确");
      if (code !== expectedCode) throw core.createError("INVALID_CODE", "测试验证码不正确");
      const records = await core.searchRecords("FEISHU_CUSTOMERS_TABLE_ID", [
        { field: core.fieldName("FEISHU_FIELD_MEMBER_NO", "会员号"), value: memberNo },
        { field: core.fieldName("FEISHU_FIELD_PHONE", "手机号"), value: phone }
      ], 2);
      customer = records[0];
    } else if (action === "verifyWechatPhone") {
      if (core.env("AUTH_MODE") !== "wechat") throw core.createError("WECHAT_PHONE_UNAVAILABLE", "当前尚未启用微信手机号验证", 503);
      if (!event.phoneCode) throw core.createError("INVALID_INPUT", "缺少微信手机号授权凭证");
      let phoneResult;
      try { phoneResult = await core.cloud.openapi.phonenumber.getPhoneNumber({ code: event.phoneCode }); }
      catch (error) { throw core.createError("WECHAT_PHONE_UNAVAILABLE", "微信手机号验证失败，请确认小程序已完成企业认证", 503); }
      phone = phoneResult.phoneInfo && (phoneResult.phoneInfo.purePhoneNumber || phoneResult.phoneInfo.phoneNumber);
      const records = await core.searchRecords("FEISHU_CUSTOMERS_TABLE_ID", [{ field: core.fieldName("FEISHU_FIELD_PHONE", "手机号"), value: phone }], 2);
      customer = records[0];
    } else {
      throw core.createError("INVALID_INPUT", "不支持的身份验证方式");
    }

    if (!customer) throw core.createError("CUSTOMER_NOT_FOUND", "未找到匹配的客户档案，请联系品牌顾问核对信息", 404);
    const session = await core.createSession(openId, customer.record_id);
    await core.audit("customer_auth_success", openId, { customerRecordId: customer.record_id, phone });
    return core.ok({ ...session, customerName: core.fieldValue(customer, "FEISHU_FIELD_CUSTOMER_NAME", "姓名") || "PRIVLAN 客户" }, "身份验证成功", id);
  } catch (error) {
    await core.audit("customer_auth_failed", openId, { code: error.code || "UNKNOWN" });
    return core.handleError(error, id);
  }
};
