"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { readHiddenPassword, migrateWithHiddenPassword } = require("../hidden-password-input");
function terminal() {
  const input = new PassThrough();
  input.isTTY = true; input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  input.pause();
  let printed = "";
  return { input, output: { write: value => { printed += value; } }, printed: () => printed };
}
test("hidden input returns password only in memory and restores terminal", async () => {
  const t = terminal(), pending = readHiddenPassword(t);
  t.input.write("synthetic-pass\r");
  assert.equal(await pending, "synthetic-pass");
  assert.equal(t.printed().includes("synthetic-pass"), false);
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.isPaused(), true);
  assert.equal(t.input.listenerCount("data"), 0);
});
test("backspace edits input without printing characters", async () => {
  const t = terminal(), pending = readHiddenPassword(t);
  t.input.write("abc\u007fd\r");
  assert.equal(await pending, "abd");
});
test("cancellation and empty input fail closed and restore terminal", async () => {
  for (const key of ["\u0003", "\u0004", "\r"]) {
    const t = terminal(), pending = readHiddenPassword(t);
    t.input.write(key);
    await assert.rejects(pending, /AUTH_PASSWORD_/);
    assert.equal(t.input.isRaw, false);
  }
});
test("redirected input rejects rather than reading password from pipes", async () => {
  await assert.rejects(readHiddenPassword({ input: new PassThrough() }), /INTERACTIVE_TERMINAL_REQUIRED/);
});
test("split UTF-8 input preserves the actual password", async () => {
  const t = terminal(), pending = readHiddenPassword(t);
  const bytes = Buffer.from("合成密码");
  t.input.write(bytes.subarray(0, 2)); t.input.write(bytes.subarray(2)); t.input.write("\r");
  assert.equal(await pending, "合成密码");
});
test("escape sequences cancel instead of corrupting password", async () => {
  const t = terminal(), pending = readHiddenPassword(t);
  t.input.write("abc\u001b[A");
  await assert.rejects(pending, /CANCELLED/);
});
test("controller rejects password arguments and cancellation before migration", async () => {
  await assert.rejects(migrateWithHiddenPassword({ password: "synthetic" }), /INTERACTIVE_INPUT_ONLY/);
  const t = terminal(), pending = migrateWithHiddenPassword({}, t);
  t.input.write("\u0003");
  await assert.rejects(pending, /CANCELLED/);
});
