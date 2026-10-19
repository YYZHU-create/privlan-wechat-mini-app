// Only expose recognized remediation; raw CLI output can contain local details.
function classifyWechatPreviewError(error) {
  const output = [error?.message, error?.stdout, error?.stderr].map(value => String(value || "")).join("\n");
  if (/需要重新登录|请先登录|not logged in/i.test(output)) {
    return { status: 409, code: "WECHAT_DEVTOOLS_LOGIN_REQUIRED", message: "请先在本机微信开发者工具中重新扫码登录，再返回重试手机扫码预览。" };
  }
  return null;
}
module.exports = { classifyWechatPreviewError };
