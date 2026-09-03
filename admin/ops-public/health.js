function isHealthyApplicationResponse(responseOk, payload) {
  return responseOk === true
    && payload !== null
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.status === "ok";
}

if (typeof module !== "undefined" && module.exports) module.exports = { isHealthyApplicationResponse };
if (typeof window !== "undefined") window.FeeldaoOpsHealth = { isHealthyApplicationResponse };
