(function (root, factory) {
  const client = factory();
  if (typeof module === "object" && module.exports) module.exports = client;
  if (root) root.MediaUploadClient = client;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const ERROR_MESSAGES = Object.freeze({
    MEDIA_IDEMPOTENCY_KEY_REUSE: "本次上传内容与已记录的重试不一致，请重新选择文件开始新的上传。",
    MEDIA_UPLOAD_CLEANUP_INDETERMINATE: "服务器仍在确认上次上传结果，请稍后重试本次上传。",
    MEDIA_UPLOAD_ATTEMPT_CLEANED: "本次上传已清理完成。请重新选择文件开始新的上传。",
    MEDIA_UPLOAD_IN_PROGRESS: "本次上传仍在处理中，请稍后重试。",
    MEDIA_UPLOAD_STORAGE_STATE_UNKNOWN: "存储结果尚未确认，请稍后重试本次上传。",
    MEDIA_UPLOAD_RETRY_FINGERPRINT_MISMATCH: "重试内容与原上传不一致，请重新选择文件。",
    MEDIA_PURPOSE_INVALID: "当前文件类型或用途不受支持。",
    INVALID_MEDIA_DATA: "文件数据无效，请重新选择文件。",
    MEDIA_TYPE_MISMATCH: "文件扩展名与文件内容不匹配。",
    MEDIA_CONTENT_MISMATCH: "文件内容校验失败，请重新选择文件。",
    MEDIA_TOO_LARGE: "文件超过 80 MB 限制。",
    PRODUCT_SCOPE_DENIED: "商品不属于当前工作区，无法关联图片。",
    AUTH_REQUIRED: "登录状态已失效，请重新登录后再上传。",
    CSRF_INVALID: "页面安全校验已过期，请刷新后重试。"
  });

  function createIdempotencyKey(cryptoApi = globalThis.crypto) {
    if (!cryptoApi || typeof cryptoApi.randomUUID !== "function") throw new Error("SECURE_RANDOM_UNAVAILABLE");
    return cryptoApi.randomUUID();
  }

  function createUploadAttempt(file, context = {}, cryptoApi = globalThis.crypto) {
    return {
      id: createIdempotencyKey(cryptoApi),
      idempotencyKey: createIdempotencyKey(cryptoApi),
      file,
      status: "queued",
      attemptState: "new",
      progress: 0,
      error: "",
      result: null,
      folderId: String(context.folderId || ""),
      uploadContext: { ...context }
    };
  }

  function retireAttempt(attempt, terminalState) {
    attempt.idempotencyKey = null;
    attempt.attemptState = terminalState;
    return attempt;
  }

  function safeError(code, status, fallbackMessage) {
    const message = ERROR_MESSAGES[code] || (status === 401 || status === 403
      ? "当前登录或工作区权限已失效，请重新登录后重试。"
      : status >= 500
        ? "上传结果暂未确认，请稍后重试本次上传。"
        : "上传未完成，请检查文件后重试。");
    const error = new Error(message || fallbackMessage || "上传未完成，请重试。");
    error.code = code || "MEDIA_UPLOAD_FAILED";
    error.status = Number(status || 0);
    error.retryable = ![400, 401, 403, 404, 409, 413, 415, 422].includes(error.status)
      || ["MEDIA_UPLOAD_CLEANUP_INDETERMINATE", "MEDIA_UPLOAD_IN_PROGRESS", "MEDIA_UPLOAD_STORAGE_STATE_UNKNOWN"].includes(error.code);
    if (error.code === "MEDIA_IDEMPOTENCY_KEY_REUSE" || error.code === "MEDIA_UPLOAD_ATTEMPT_CLEANED" || error.code === "PRODUCT_SCOPE_DENIED") error.retryable = false;
    return error;
  }

  function sendUploadRequest({ payload, idempotencyKey, onProgress = () => {}, xhrFactory = () => new XMLHttpRequest(), csrfToken = "", endpoint = "/api/media/v1/upload" }) {
    if (!idempotencyKey) return Promise.reject(safeError("MEDIA_IDEMPOTENCY_KEY_MISSING", 400));
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory();
      xhr.open("POST", endpoint);
      xhr.withCredentials = true;
      if (csrfToken) xhr.setRequestHeader("x-atelier-csrf", csrfToken);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => {
        const error = safeError("MEDIA_UPLOAD_NETWORK_UNCERTAIN", 0);
        error.retryable = true;
        reject(error);
      };
      xhr.onabort = () => {
        const error = safeError("MEDIA_UPLOAD_ABORTED", 0);
        error.retryable = true;
        reject(error);
      };
      xhr.onload = () => {
        let envelope = {};
        try { envelope = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && envelope?.ok === true && envelope.data && typeof envelope.data === "object") {
          resolve(envelope.data);
          return;
        }
        reject(safeError(String(envelope.code || envelope.error?.code || "MEDIA_UPLOAD_FAILED"), xhr.status, envelope.message));
      };
      try { xhr.send(JSON.stringify(payload)); }
      catch { const error = safeError("MEDIA_UPLOAD_NETWORK_UNCERTAIN", 0); error.retryable = true; reject(error); }
    });
  }

  function csrfCookie(documentObject = globalThis.document) {
    const pair = String(documentObject?.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith("atelier_csrf="));
    if (!pair) return "";
    try { return decodeURIComponent(pair.slice("atelier_csrf=".length)); } catch { return ""; }
  }

  function asLegacyMediaItem(data, file, folderId = "") {
    const bytes = Number(data?.bytes || 0);
    const kind = String(data?.mimeType || file?.type || "").startsWith("video/") ? "video" : "image";
    return {
      ...data,
      name: String(file?.name || ""),
      path: String(data?.path || ""),
      mpPath: String(data?.path || ""),
      kind,
      size: bytes,
      sizeKB: Math.round(bytes / 1024),
      large: bytes > 5 * 1024 * 1024,
      packageEligible: bytes <= 5 * 1024 * 1024,
      folderId: String(folderId || "")
    };
  }

  return { ERROR_MESSAGES, createIdempotencyKey, createUploadAttempt, retireAttempt, safeError, sendUploadRequest, csrfCookie, asLegacyMediaItem };
});
