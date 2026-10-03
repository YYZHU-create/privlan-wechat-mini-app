"use strict";
const { StringDecoder } = require("node:string_decoder");

// Interactive-only input: callers must never serialize the returned password.
function readHiddenPassword({ input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("AUTH_PASSWORD_INTERACTIVE_TERMINAL_REQUIRED"));
  }
  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(input.isRaw), wasPaused = input.isPaused();
    const decoder = new StringDecoder("utf8");
    let password = "", finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write("\n");
      const value = password;
      password = "";
      if (error) reject(error); else resolve(value);
    }
    function onError() { finish(new Error("AUTH_PASSWORD_INPUT_FAILED")); }
    function onEnd() { finish(new Error("AUTH_PASSWORD_INPUT_CLOSED")); }
    function onData(chunk) {
      for (const character of decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
        if (character === "\r" || character === "\n") {
          finish(password ? null : new Error("AUTH_PASSWORD_REQUIRED"));
          return;
        }
        if (character === "\u0003" || character === "\u0004" || character === "\u001b") {
          finish(new Error("AUTH_PASSWORD_INPUT_CANCELLED"));
          return;
        }
        if (character === "\u007f" || character === "\b") password = Array.from(password).slice(0, -1).join("");
        else if (character >= " " && character !== "\u001b") password += character;
      }
    }
    input.on("data", onData);
    input.on("error", onError);
    input.on("end", onEnd);
    input.setRawMode(true);
    output.write("请输入原密码（输入不显示）：");
    input.resume();
  });
}

async function migrateWithHiddenPassword(options, terminal) {
  if (!options || Object.hasOwn(options, "password")) throw new Error("AUTH_PASSWORD_INTERACTIVE_INPUT_ONLY");
  const { migrateExistingAccounts } = require("./managed-existing-account-migration");
  let password = await readHiddenPassword(terminal);
  try { return await migrateExistingAccounts({ ...options, password }); }
  finally { password = ""; }
}

module.exports = { readHiddenPassword, migrateWithHiddenPassword };
