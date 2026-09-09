# v12 候选 —— 精确复现命令与环境要求（§6）

> 本文件的每条命令都是**产出当前证据时实际执行过的原文**，未作改写。

## 身份

```
CANDIDATE=v12
CANDIDATE_SHA256=0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55
CANDIDATE_SIZE_BYTES=99193
CANDIDATE_LINE_COUNT=2390
V11_ROLLBACK_SHA256=692a7da254ab4f479762aaba2e219f603b57a41b6e283d8e35b8681ede86bb7a
SUPABASE_EXACT_IMPORT=https://esm.sh/@supabase/supabase-js@2.115.0
FLOATING_SUPABASE_IMPORT_COUNT=0
OTHER_REMOTE_IMPORTS=import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";   import * as ScryptModule from "https://esm.sh/@noble/hashes@1.4.0/scrypt";
```

## 复现步骤（在仓库根执行）

```bash
# 0) 前置：安装依赖（typescript 供 build.mjs:50 调用）
pnpm install

# 1) 把台架产物从被测源码机械转译出来（生成 tmp/mbuild/out，属缓存，勿提交）
node tests/privlan-merchant-login/build.mjs

# 2) 全量台架
node --test tests/privlan-merchant-login/*.test.mjs

# 3) 依赖轴证明（强制回源，排除 lockfile 与缓存两个混淆源）
deno check --no-lock --reload functions/privlan-merchant-api/index.ts
```

## 期望结果

```
BUILD_COMMAND=node tests/privlan-merchant-login/build.mjs   -> "built -> <repo>/tmp/mbuild/out", exit 0
FUNCTION_TEST_COMMAND=node --test tests/privlan-merchant-login/*.test.mjs
  # tests 169
  # pass 169
  # fail 0
DENO_DEPENDENCY_CHECK_COMMAND=deno check --no-lock --reload functions/privlan-merchant-api/index.ts
  CHECK_EXIT=0 / SUPABASE_RESOLUTION=2.115.0 / FLOATING_SUPABASE_IMPORTS=0 / ESM_URL_COUNT=46
```

## 产出本包证据的环境（不是目标环境）

```
CURRENT_MEOO_NODE_VERSION=v20.19.4
CURRENT_DENO_VERSION=deno 2.9.2 (stable, release, x86_64-unknown-linux-gnu)
TYPESCRIPT_INSTALLED=5.9.3（package.json 声明 ^5.8.3 → 实装 5.9.3；build.mjs:50 直接调 <repo>/node_modules/typescript/bin/tsc）
OS=Debian GNU/Linux 12 (bookworm) x86_64
```

## 🔴 Node 22 门槛仍未过 —— 这条是本包存在的唯一理由

```
NODE22_VALIDATION=BLOCKED
STAGING_DEPLOY_READY=NO
EXPECTED_FUNCTION_TEST_COUNT=169
BASELINE_PRODUCED_ON=v20.19.4
```

169/169 是 **v20.19.4** 证据，**不得**冒充声明的 Node 22 runtime 证据。
接收方在 Node 22.x 下复跑并得到同样的 169/169，才算解除 `NODE22_VALIDATION=BLOCKED`。
除该动作外没有其他路径 —— 它不依赖凭据、不依赖部署、不依赖云服务。

## 解包后的还原（先对账，再落盘）

```bash
# A. 先验 MANIFEST（务必在跑任何测试之前）
#    对包内每个文件复算 sha256 并与 PRIVLAN_MERCHANT_API_V12_HANDOFF_MANIFEST.json 比对

# B. 落到仓库根（仓库根建议就是 /home/project，见 TEST_HARNESS_CLOSURE.md 的绝对路径说明）
cp <HANDOFF>/source/index.ts                     <repo>/functions/privlan-merchant-api/index.ts
cp -r <HANDOFF>/tests/privlan-merchant-login     <repo>/tests/
cp <HANDOFF>/archive/index.v11.ts                <repo>/archive/privlan-merchant-api/index.v11.ts
```

落盘后立刻复算 `functions/privlan-merchant-api/index.ts` 的 sha256，必须等于
`0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55`；不等则**停止**，说明传输或落盘改动了字节。

## 本包不含、也不声称的东西

- 未部署：`STAGING_DEPLOYMENT_PERFORMED=NO`、`PRODUCTION_DEPLOYMENT_PERFORMED=NO`，线上 Staging 仍是 **v11**
- 无 Schema / migration / secret 变更，无任何凭据值
- 不决定哪些文件最终进 canonical Git —— 那是 Codex/canonical 仓库阶段的裁定，本包只出证据
- `DEPLOYMENT_USED_LOCKFILE=NOT_VERIFIED` 仍未闭合（根 `deno.lock` 是工作区级产物，不被函数目录版本化，`deploy-function` 输入面只有 `functions/{name}/index.ts`）

## ⚠️→✅ 导出后追加的 clean-workspace 复现确认

**先说首版的一处取证缺陷**：本文件首次生成时，本沙箱工作区的 `node_modules` 处于
**缺失**状态（工作区恢复未携带依赖），脚本读 `node_modules/typescript/package.json` 失败，
于是留下了 `TYPESCRIPT_INSTALLED=UNKNOWN`。上面已就地校正为真实值，并在此说明根因 ——
不是掩盖。

由此得出一条对接收方**有实际后果**的结论：

```
REPRODUCTION_STEP_0_PNPM_INSTALL=MANDATORY_NOT_OPTIONAL
```

第 0 步 `pnpm install` 不是可选优化。缺它则 `build.mjs:47` 的 `execFileSync` 会因
`node_modules/typescript/bin/tsc` 不存在而直接抛 `ENOENT`，台架一步都跑不起来。

补齐依赖后，在**同一份冻结候选**上重跑，结果与基线一致：

```
PNPM_INSTALL=ok（249 包；typescript=5.9.3）
BUILD_COMMAND=node tests/privlan-merchant-login/build.mjs
  -> "built -> /home/project/tmp/mbuild/out", exit 0
FUNCTION_TEST_COMMAND=node --test tests/privlan-merchant-login/*.test.mjs
  -> # tests 169 / # pass 169 / # fail 0
CANDIDATE_SHA256_AFTER_RERUN=0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55
  （与基线逐字符一致 ⇒ 复跑过程未改动被测字节；台架只写 tmp/mbuild）
```

## 线上版本证据（只读，零部署）

```
ONLINE_FUNCTION=privlan-merchant-api
ONLINE_STATUS=READY
ONLINE_VERSION=11            ← 仍是 v11，本包未部署
ONLINE_VERIFY_JWT=false
ONLINE_UPDATED_AT=1788636939804（未位移）
STAGING_DEPLOYMENT_PERFORMED=NO
PRODUCTION_DEPLOYMENT_PERFORMED=NO
```

注：平台侧只有自增版本号，**没有**历史版本列表 / 切换 / 回滚控制面，也不回读远端源码。
因此「线上 = v11」是平台自增计数器 + `updated_at` 未位移的**间接**证据，
不等于远端 artifact 字节已核对；v12 与 v11 的字节差只存在于本地归档链。
