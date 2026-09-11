/**
 * 把 functions/privlan-merchant-api/index.ts 变成可在 Node 20 里执行的被测产物。
 *
 * 只做 4 处机械替换，不复制、不改写任何业务逻辑：
 *   1. esm.sh/@supabase/supabase-js  → 本地 fake-supabase（可注入故障 + 记录调用）
 *   2. esm.sh/@noble/hashes/scrypt   → 本地 fake-scrypt（node:crypto 同算法）
 *   3. Deno.env                      → globalThis.__DenoEnv（测试可控）
 *   4. Deno.serve                    → globalThis.__DenoServe（捕获 handler，不起服务）
 * 另在末尾追加 `export { handle }`，让测试直接驱动真实路由。
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = `${ROOT}/functions/privlan-merchant-api/index.ts`;
const OUT_DIR = `${ROOT}/tmp/mbuild`;
const SRC_DIR = `${OUT_DIR}/src`;
const JS_DIR = `${OUT_DIR}/out`;

const source = readFileSync(SRC, "utf8");

const transformed = source
  .replace(
    'import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";',
    'import { createClient } from "./fake-supabase.js";\ntype SupabaseClient = any;',
  )
  .replace(
    'import * as ScryptModule from "https://esm.sh/@noble/hashes@1.4.0/scrypt";',
    'import * as ScryptModule from "./fake-scrypt.js";',
  )
  .replace(/\bDeno\.env\b/g, "globalThis.__DenoEnv")
  .replace(/\bDeno\.serve\b/g, "globalThis.__DenoServe")
  .concat(
    "\nexport { handle, failure, newRequestId, PROBE_ROUTE, PROBE_TENANT_ID, PROBE_WORKSPACE_ID, PROBE_BASENAME, MERCHANT_ASSETS_BUCKET, EXECUTE_ROUTE, EXECUTE_EXPECTED_BYTES, EXECUTE_EXPECTED_SHA256, EXECUTE_EXPECTED_MIMETYPE, PROXY_ROUTE, PROXY_MAX_BASE64_CHARS, CAPACITY_ROUTE, CAPACITY_PREFIX, CAPACITY_SIZES, CAPACITY_BASENAME, CAPACITY_EXPECTED_SHA256, CAPACITY_CONTENT_TYPE, CAPACITY_MAX_BASE64_CHARS, AUTHORIZATION_CONTRACT, ALLOWED_ROLES, isRoleAuthorized, roleClassOf, entrypointClassOf };\n",
  );

if (transformed.includes("https://esm.sh") || /\bDeno\./.test(transformed)) {
  throw new Error("transform 未清理干净，测试将不可信：" + transformed.match(/.*esm\.sh.*/)?.[0]);
}

mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(JS_DIR, { recursive: true });
writeFileSync(`${SRC_DIR}/index.ts`, transformed);
copyFileSync(`${ROOT}/tests/privlan-merchant-login/fakes/fake-supabase.ts`, `${SRC_DIR}/fake-supabase.ts`);
copyFileSync(`${ROOT}/tests/privlan-merchant-login/fakes/fake-scrypt.ts`, `${SRC_DIR}/fake-scrypt.ts`);

execFileSync(
  process.execPath,
  [
    `${ROOT}/node_modules/typescript/bin/tsc`,
    "--target", "es2022",
    "--module", "esnext",
    "--moduleResolution", "bundler",
    "--noCheck",
    "--skipLibCheck",
    "--outDir", JS_DIR,
    `${SRC_DIR}/index.ts`,
    `${SRC_DIR}/fake-supabase.ts`,
    `${SRC_DIR}/fake-scrypt.ts`,
  ],
  { stdio: "inherit" },
);

console.log("built ->", JS_DIR);
