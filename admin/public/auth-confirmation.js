"use strict";
(() => {
  // Read the implicit confirmation proof into private memory, then remove the
  // entire query/fragment before loading any other page resources.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  let proof = fragment.get("type") === "signup" && !fragment.has("error")
    ? fragment.get("access_token") : null;
  try { window.history.replaceState(null, "", window.location.pathname); }
  catch { proof = null; }
  let submitted = false;
  window.addEventListener("pagehide", () => { proof = null; });
  window.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("confirmation-form");
    const status = document.getElementById("confirmation-status");
    const button = document.getElementById("complete-button");
    if (!proof) {
      status.textContent = "验证链接缺失或已失效，请使用邮件中的商户注册验证链接。";
      return;
    }
    form.hidden = false;
    status.textContent = "请填写商户资料，确认后由服务端核验邮箱并开通。";
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submitted || !proof || !form.reportValidity()) return;
      submitted = true; button.disabled = true;
      status.textContent = "正在核验并开通…";
      try {
        const response = await fetch("/auth/register/complete", {
          method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${proof}` },
          body: JSON.stringify({ storeName: document.getElementById("store-name").value.trim(),
            contactName: document.getElementById("contact-name").value.trim(),
            template: document.getElementById("template").value })
        });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.ok === true) {
          form.hidden = true;
          status.textContent = "商户已开通，请返回登录并使用邮箱和密码登录。";
        } else {
          status.textContent = "本次开通未确认成功，请返回登录检查账号状态或联系管理员。";
        }
      } catch {
        status.textContent = "本次请求结果尚未确认，请返回登录检查；页面不会自动再次提交。";
      } finally { proof = null; }
    });
  });
})();
