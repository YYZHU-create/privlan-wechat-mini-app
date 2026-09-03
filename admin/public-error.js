const TRUSTED_PUBLIC_MESSAGE = Symbol.for("feeldao.trustedPublicMessage");

function markTrustedPublicMessage(error, publicMessage) {
  Object.defineProperty(error, TRUSTED_PUBLIC_MESSAGE, { value: true, enumerable: false });
  Object.defineProperty(error, "publicMessage", { value: String(publicMessage ?? ""), enumerable: false, configurable: false });
  return error;
}

function hasTrustedPublicMessage(error) {
  return Boolean(error && error[TRUSTED_PUBLIC_MESSAGE] === true);
}

module.exports = { markTrustedPublicMessage, hasTrustedPublicMessage };
