const TRUSTED_PUBLIC_MESSAGE = Symbol.for("feeldao.trustedPublicMessage");

function markTrustedPublicMessage(error, publicMessage) {
  Object.defineProperty(error, TRUSTED_PUBLIC_MESSAGE, { value: true, enumerable: false });
  Object.defineProperty(error, "publicMessage", { value: String(publicMessage ?? ""), enumerable: false, configurable: false });
  return error;
}

function hasTrustedPublicMessage(error) {
  return Boolean(error && error[TRUSTED_PUBLIC_MESSAGE] === true);
}

function trustedDomainError(status, code, publicMessage) {
  return markTrustedPublicMessage(Object.assign(new Error(publicMessage), { status, code }), publicMessage);
}

module.exports = { markTrustedPublicMessage, hasTrustedPublicMessage, trustedDomainError };
