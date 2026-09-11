/**
 * scrypt 替身：Deno 侧走 esm.sh/@noble/hashes，本地测试用 node:crypto 的同算法实现。
 * 项目里的 KAT 向量本来就是由 node crypto.scryptSync 生成的（见 index.ts:32-47 注释），
 * 因此自检在本 harness 里同样能验证「参数形状 + 已知答案」是否一致。
 * 注意：这不能替代对生产 Deno 侧 scrypt 的验证，那一层由已部署函数的 /healthz 与真人登录证明。
 */
import { scryptSync as nodeScrypt } from "node:crypto";

export function scryptSync(
  password: Uint8Array,
  salt: Uint8Array,
  opts: { N: number; r: number; p: number; dkLen?: number; maxMemory?: number },
): Uint8Array {
  return new Uint8Array(
    nodeScrypt(Buffer.from(password), Buffer.from(salt), opts.dkLen ?? 64, {
      cost: opts.N,
      blockSize: opts.r,
      parallelization: opts.p,
      maxmem: opts.maxMemory ?? 64 * 1024 * 1024,
    }),
  );
}
