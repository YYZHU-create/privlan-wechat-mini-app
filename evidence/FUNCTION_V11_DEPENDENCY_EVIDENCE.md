# PRIVLAN-MERCHANT-API v11 — DEPENDENCY EVIDENCE EXPORT

- **MODE**: `STRICT_READ_ONLY`（取证阶段零源码修改 / 零部署 / 零 Secret 读写 / 零数据库写入）
- **TARGET_PROJECT**: `asmhysidbg5g`（Staging）
- **TARGET_FUNCTION**: `privlan-merchant-api` **v11**（平台自增计数器值）
- **DATE**: 2026-09-08
- **PURPOSE**: 为 Feeldao OS Merchant Auth Runtime Hardening 提供 Staging redeploy 前的依赖可复现性证据
- **HEADLINE**: Codex 的三项结论**全部被实测证实**，且漂移**不是假设，已经发生**（`2.115.0 → 2.116.0`），并且是**静默漂移**（两个版本下 `deno check` 均通过）。

> **📌 阅读指引**：§1–§8 描述的是**取证时点的 v11 基线**（浮动 `@2`）。§9 记录用户裁定 **P1 已在本地应用之后**的状态差异与自证结果。**线上远端至今未变**（未部署）。

---

## 1. IDENTIFY CANONICAL V11 SOURCE

| 项 | 值（取证时点） |
|---|---|
| `FUNCTION_SOURCE_FILE` | `/home/project/functions/privlan-merchant-api/index.ts` |
| `FUNCTION_WORKING_SOURCE_SHA256` | `692a7da254ab4f479762aaba2e219f603b57a41b6e283d8e35b8681ede86bb7a` |
| `V11_ARCHIVE_SOURCE_SHA256` | `692a7da254ab4f479762aaba2e219f603b57a41b6e283d8e35b8681ede86bb7a` |
| `WORKING_SOURCE_EQUALS_V11_ARCHIVE` | **YES**（`Buffer.equals` 逐字节比对 = true） |
| `FUNCTION_SOURCE_SIZE` | 90,225 bytes |
| `FUNCTION_SOURCE_LINES` | 2,179（`split("\n")` 口径，文件以换行结尾 ⇒ 2,178 行内容 + 尾换行；与交接说明「约 2,179 行」一致） |

**证据强度：STRONG（本地）**。三方对账（工作文件 / `archive/privlan-merchant-api/index.v11.ts` / 摘要）完全一致。

**证据强度：NOT_VERIFIED（远端）**。⚠️ 「工作文件 = 线上 v11 源码」这一等式**无法从平台侧回读证明**，沿用本项目既有定案：
- `cloud list-functions` 仅返回自增 `version:11`，**不回读远端源码**、无 build id / commit id、`ezbr_sha256` 恒空串、`entrypoint_path` 恒空串；
- 匿名 HTTP 探针**不能**证明部署身份（`resolveSession` 在路径匹配之前全局执行，未知路径与已知路径对匿名请求签名完全一致）；
- 沙箱文件 mtime 不构成 provenance 证据。

⇒ 本地一致性 = 确证；「本地 = 线上」= 仍是**间接对应**（版本号计数器 + 归档摘要吻合），不是远端源码回读。

---

## 2. EXTRACT COMPLETE IMPORT GRAPH

对 v11 源码全文扫描：static `import ... from` / bare `import "…"` / `export … from` / 动态 `import("…")` / `require(` / `npm:` / `jsr:` / `deno.land` / 任意 `https://` specifier。

**扫描结果：全文件恰好 2 条模块说明符，均在文件头。**

```
:16  import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
:17  import * as ScryptModule        from "https://esm.sh/@noble/hashes@1.4.0/scrypt";
```

| 说明符类别 | 命中数 |
|---|---|
| static imports | **2** |
| dynamic `import()` | **0** |
| bare side-effect import | 0 |
| `export … from` re-export | 0 |
| remote URL imports | **2**（全部为 remote，无一条相对路径） |
| esm.sh imports | 2 |
| `npm:` / `jsr:` / `deno.land` | 0 / 0 / 0 |
| `require(` | 0 |
| Supabase imports | 1（`@supabase/supabase-js@2`） |
| **indirect locally referenced modules** | **0** — `functions/privlan-merchant-api/` 目录经 Glob 确认**只有 `index.ts` 一个文件**，函数为完全自包含单体 |
| `Deno.serve` | 1（`:2178`） |

### IMPORT_GRAPH

```
functions/privlan-merchant-api/index.ts   (2,179 L, self-contained, 0 local modules)
├── https://esm.sh/@supabase/supabase-js@2        ← FLOATING MAJOR  ⚠️
└── https://esm.sh/@noble/hashes@1.4.0/scrypt     ← EXACTLY PINNED ✅
```

### 运行时传递闭包（实测下载日志，非源码声明）

顶层只有 2 条，但**真实 runtime graph 大得多**。`deno check` 的下载日志揭示闭包含 9 个包：

| 包 | 在 lock 模式（2.115.0 轴） | 在 no-lock 模式（2.116.0 轴） |
|---|---|---|
| `@supabase/supabase-js` | 2.115.0 | **2.116.0** |
| `@supabase/auth-js` | 2.115.0 | **2.116.0** |
| `@supabase/functions-js` | 2.115.0 | **2.116.0** |
| `@supabase/postgrest-js` | 2.115.0 | **2.116.0** |
| `@supabase/realtime-js` | 2.115.0 | **2.116.0** |
| `@supabase/storage-js` | 2.115.0 | **2.116.0** |
| `@supabase/phoenix` | 0.4.5 | 缓存命中，未重新下载 ⇒ 该轴版本 **NOT_VERIFIED** |
| `iceberg-js` | 0.8.1 | 缓存命中，未重新下载 ⇒ 该轴版本 **NOT_VERIFIED** |
| `@noble/hashes` | 1.4.0 | 1.4.0（缓存命中） |

⚠️ 诚实标注：no-lock 那轮少下载了 13 个 URL（46 → 33 行），**原因是 DENO_DIR 缓存命中，不能据此推断 2.116.0 不再依赖 phoenix/iceberg-js**。2.115.0 轴已由 §9 的 `--reload` 强制回源完整确证。

**关键架构事实（决定了修复方案的形状）**：esm.sh 顶层 shim 模块的**内容里内嵌了 exact 版本的子包绝对路径**（实测 shim 正文：`import "/@supabase/auth-js@2.115.0/es2022/auth-js.mjs"`）。⇒ **只要顶层 shim 的版本被钉住，整棵传递闭包自动被钉死**；反之顶层浮动，6 个 `@supabase/*` 子包会**整体同步位移**。不存在"只漂一个子包"的情况，也不需要在源码里逐个子包加 pin。

### DEPENDENCY 明细

```
DEPENDENCY=1
IMPORT_SPECIFIER=https://esm.sh/@supabase/supabase-js@2
VERSION_SPECIFIER=2            ← 单个整数，非 semver exact
EXACTLY_PINNED=NO
REMOTE_RESOLVER=esm.sh（CDN 版本解析器；对浮动 specifier 执行 302 redirect 到当前满足 range 的最新版）

DEPENDENCY=2
IMPORT_SPECIFIER=https://esm.sh/@noble/hashes@1.4.0/scrypt
VERSION_SPECIFIER=1.4.0
EXACTLY_PINNED=YES
REMOTE_RESOLVER=esm.sh（exact URL，无 redirect；返回子路径 /scrypt 的 shim）
```

---

## 3. SUPABASE EXACT EVIDENCE

| 项 | 值（取证时点） |
|---|---|
| `SUPABASE_IMPORT_SPECIFIER` | `https://esm.sh/@supabase/supabase-js@2` |
| `SUPABASE_VERSION_DECLARATION` | `@2` —— 仅 major 号 |
| `SUPABASE_EXACT_VERSION` | **`NOT_PINNED`** |
| `SUPABASE_FLOATING_RANGE` | **YES** |

### ⚠️ 必须写清的一条：`@2` 不是 exact version

`@2` 是**版本范围（range）**，语义等价于 semver `2.x` → `>=2.0.0 <3.0.0`，由 **esm.sh 在解析时**决定落到哪个具体 patch/minor。把它读成「钉在 2」是错误解释。真正的 exact 写法必须含完整 `major.minor.patch`（如同文件另一条 `@1.4.0`）。

### 实测的浮动解析结果（三向 UA 一致，2026-09-08）

| 探针 | 结果 |
|---|---|
| `GET https://esm.sh/@supabase/supabase-js@2`，UA=`Deno/1.46.0` | **HTTP 302 → `Location: https://esm.sh/@supabase/supabase-js@2.116.0`** |
| 同 URL，Node 默认 UA | 200，shim 首行注释 `/* esm.sh - @supabase/supabase-js@2.116.0 */` |
| 同 URL，Chrome UA | 200，同上，`@2.116.0` |
| `GET …/@noble/hashes@1.4.0/scrypt`（对照） | 200，无 redirect，`/* esm.sh - @noble/hashes@1.4.0/scrypt */` |

⇒ **重新解析浮动声明，得到的是 `2.116.0`，不是 `2.115.0`。** 三种 UA 结论一致 ⇒ 版本解析与 UA 无关（UA 只影响产物 target，见下）。

### 附带发现：同一 URL 对不同 UA 返回不同字节（方法论警告）

`@noble/hashes@1.4.0/scrypt` 实测：Deno UA → **304 bytes**，内部 import `/@noble/hashes@1.4.0/**denonext**/_assert.mjs`；浏览器/Node UA → **294 bytes**，import `/**es2022**/`。

⇒ **严禁**用「我 fetch 到的字节 sha256 ≠ `deno.lock` 的 integrity」来推断篡改或漂移 —— 那只是 esm.sh 的 target 内容协商。正确验证方式：由 **Deno 自己**在 `--lock` 模式下取 `2.115.0`，integrity 校验**通过**（无报错、exit 0），证明 lock 记录的字节就是 Deno target 下的真实字节。

---

## 4. LOCKFILE / IMPORT MAP

| 项 | 值 | 证据 |
|---|---|---|
| `DENO_LOCK_PRESENT` | **YES（仅"沙箱里存在"这一层）** | `/home/project/deno.lock`，2,937 B，sha256 `c01dfc385ac1eaa510ba61b3dd4fdef92ddb379ea4a1695dd5c543b3f3981b65` |
| `DENO_LOCK_PATH` | `/home/project/deno.lock`（**项目根**，非函数目录） | `functions/privlan-merchant-api/deno.lock` = **ABSENT** |
| `DENO_LOCK_CONTROLLED_BY_SOURCE_ARCHIVE` | **NO** | `archive/privlan-merchant-api/` 下只有 `index.v2/v5/v6/v7/v9/v10/v11.ts`，**不含任何 lock**；lock 也不随版本快照走 ⇒ v11 归档**无法**还原当时的依赖解析状态 |
| `DENO_LOCK_HAS_INTEGRITY_ENTRIES` | **YES = 2 条**（sha256 / 64 hex） | `https://esm.sh/@noble/hashes@1.4.0/scrypt` → `884341164864992a…bbb299c08`；`https://esm.sh/@supabase/supabase-js@2.115.0` → `f4e488ef8059a64b…26ab9585` |
| `DENO_LOCK_REDIRECT_ENTRIES` | **1 条** | `…/supabase-js@2` → `…/supabase-js@2.115.0` |
| `IMPORT_MAP_PRESENT` | **NO** | 沙箱无 `import_map.json` / `deno.json` / `deno.jsonc`；平台侧 `import_map:false`、`import_map_path:""` |
| `IMPORT_MAP_PATH` | （空） | 同上 |
| `OTHER_DEPENDENCY_LOCK_MECHANISM` | `pnpm-lock.yaml`（59 项前端依赖，`@supabase/supabase-js@2.115.0`）、`package.json`（`^2.98.0`）、`.npmrc`（仅 `registry` 键）—— **全部属于前端 Vite 构建轴，与 Edge Function 的 Deno 运行时无关** | 函数 runtime 不读 pnpm-lock；`pnpm install` 实测解析得 2.115.0 |
| `MEOO_BUILD_METADATA` | 无可用水印：`ezbr_sha256=""`、`entrypoint_path=""`、无 build id、无 commit id | `cloud list-functions` |
| **`DEPLOYMENT_USED_LOCKFILE`** | **NOT_VERIFIED** | 见下 |

### 「沙箱里存在」≠「v11 部署消费了它」——必须分开

三条独立的反向线索（都指向"未消费"，但都不构成证明）：

1. **部署输入面不含根 lock**。平台文档 `edge-functions.md` 原文：「`/functions/{functionName}/` 下的代码修改是本地的，直到再次运行 deploy 命令才会更新在线函数」；部署命令签名只有 `-n <name>`（+ `-j <bool>`）。函数目录内**只有 `index.ts`**。
2. **平台文档零提及 lock**。`edge-functions.md` 全文 223 行，无 `deno.lock` / import map / bundle / 依赖锁定 任何一处；其官方 Supabase 示例**本身就是浮动写法** `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`。
3. **平台不暴露任何 lock 字段**。`import_map:false`、`ezbr_sha256:""`。

⚠️ 但我也**无法证明平台在别处读取了根 lock**（沙箱看不到部署管线）。⇒ 严格结论：`DEPLOYMENT_USED_LOCKFILE = NOT_VERIFIED`，且**工程上必须按"未消费"来设防**。

### 该 lock 的真实归属

`deno.lock` 的 `workspace.packageJson.dependencies` 有 **59 条 `npm:` 前端包**（react/vite/radix…），说明它是**工作区级 Deno 解析产物**（覆盖前端 `package.json`），其 `remote` 段恰好也记到了函数的 2 个 URL。它**不是**为 v11 部署而存在、也**没有**被 v11 归档管控。

---

## 5. RESOLUTION REPRODUCIBILITY —— 决定性 A/B 实验

**实验设计**：对**同一份未修改的 v11 源码**跑两次 `deno check`，唯一变量是是否提供 lockfile。为避免污染项目，`--lock` 指向 `tmp/lock-probe.json`（根 lock 的副本）。

| 实验 | 命令 | Deno 实际下载的 URL | exit |
|---|---|---|---|
| **A（消费 lock）** | `deno check --lock=tmp/lock-probe.json functions/…/index.ts` | `@supabase/supabase-js@**2.115.0**` + 全部 6 个子包 2.115.0 | **0** |
| **B（不消费 lock）** | `deno check --no-lock functions/…/index.ts` | `@supabase/supabase-js@2` → `@supabase/supabase-js@**2.116.0**` + 全部 6 个子包 2.116.0 | **0** |

**实验后完整性复核**：`sha256sum deno.lock` == `sha256sum tmp/lock-probe.json` == `c01dfc38…`，`diff` 无输出 ⇒ 根 lock **未被改写**、副本 **未被追加条目**（即该 lock 对本函数两个顶层 specifier 是自洽且完整的稳定锁态）。

### 判定

| 项 | 值 | 依据 |
|---|---|---|
| `SOURCE_UNCHANGED_CAN_RUNTIME_DEPENDENCIES_CHANGE` | **YES** | 源码逐字节不变，仅 lock 输入不同，解析结果从 2.115.0 变 2.116.0（9 个包轴整体位移）。**实测，非推理** |
| `DEPENDENCY_GRAPH_REPRODUCIBLE` | **NO** | 浮动 `@2` 的最终版本由 **esm.sh 服务端状态**决定，不由源码决定；且 lock 不在部署输入面内（§4） |
| `REDEPLOY_CAN_CAUSE_DEPENDENCY_DRIFT` | **YES（且已发生）** | lock 记 2.115.0，解析得 2.116.0 —— 漂移窗口已被跨越，不是未来风险 |

### ⚠️ 最危险的性质：SILENT DRIFT（无 fail-fast）

A、B 两轮 `deno check` **都 exit 0**。即 2.115.0 → 2.116.0 的位移**不会**在部署前自检（文档称部署返回 `preflight / deno check` 错误）中被拦住。⇒ 漂移会**静默进入运行时**。

**具体失效模式（不是泛泛而谈）**：本项目 v10 的线上修复**依赖 `postgrest-js` 的错误信封形状** —— `classifyDbError` 把「响应体不是合法 PostgREST 错误 JSON」的兜底信封（固定 `code:"UNKNOWN"` + 真实 HTTP `statusCode`）归类为 `gateway` 并视为瞬时错误，才让 503 抖动可被有界重试吸收。该分类规则**读的就是 `@supabase/postgrest-js` 的内部行为**。postgrest-js 从 2.115.0 → 2.116.0 若改变该兜底信封，**v10 修复会静默失效、503 复发**（AGENTS.md 已记该定案：决定性错误必带 SQLSTATE 或 PGRST 码，绝不可能是 UNKNOWN）。

同理受影响：`resolveCanonicalScope` 的 7 跳读、`recordAudit` 的无重试丢行行为、storage-js `upload()` 返回字段 `Path`（而非常见的 `Key`）—— 都是**具体 SDK 实现细节**，不是公开契约。

---

## 6. MINIMAL PINNING REQUIREMENT（取证阶段只制定方案）

### 版本取值合法性审计

按任务规定的四个合法来源逐条对照：

| 候选版本 | 合法来源 | 证据 | 是否可作 pin 值 |
|---|---|---|---|
| **`2.115.0`** | ③ lock metadata | `deno.lock.redirects` + `remote` integrity；且**由 Deno 亲自校验通过**（实验 A） | ✅ 合法，且是**当前 lock 的权威锚点** |
| **`2.116.0`** | ①/④ 当前实际解析版本 | 302 `Location` 头（Deno UA）+ 实验 B 的 Deno 下载 URL，两者互证 | ✅ 合法，是**实时解析值** |
| v11 部署当时真实运行的版本 | ② deployment artifact | **不可得**：`ezbr_sha256=""`、无 build/commit id、不回读源码 | ❌ `NOT_VERIFIED` |

⇒ 两个候选**都有合法来源**，因此这不是"猜版本"，而是**必须由使用方裁定采用哪一个**。

| 项 | 值 |
|---|---|
| `CURRENT_RESOLVED_VERSION` | **`2.116.0`**（实测的浮动解析结果；但 **v11 线上当时运行版本 = `NOT_VERIFIED`**） |
| `PINNING_REQUIRES_VERSION_DECISION` | **YES** → 用户已裁定 **P1**（见 §9） |

### 最小修复方案（单行改动，零依赖新增）

```
CURRENT（取证时点）:
  import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

RECOMMENDED_PINNING_FORM（二选一，取决于版本裁定）:
  方案 P1（推荐 · 以 lock 为权威锚点，可复现实验 A 的已校验字节）
    "https://esm.sh/@supabase/supabase-js@2.115.0"
  方案 P2（以实时解析为权威，接受 2.116.0 的行为变化）
    "https://esm.sh/@supabase/supabase-js@2.116.0"
```

- **改动面**：仅 `:16` 一行；`:17` 的 `@1.4.0` 已是 exact，无需动。
- **无需逐子包加 pin**：§2 已证 shim 内嵌 exact 子包绝对路径，钉顶层即钉全树。
- **验证手法（不依赖部署、不依赖平台）**：`deno check --no-lock --reload` —— 若 pin 生效，下载日志里**不应再出现** `@supabase/supabase-js@2` 这条浮动 URL；出现即说明仍浮动。⚠️ 必须带 `--reload`：不带时全部缓存命中、零 Download 行，只能证明「没出现浮动 URL」，不能**正面**证明请求打到了哪。
- **P1 的额外好处**：`2.115.0` 的字节已被 `deno.lock` 的 integrity 记录并校验通过 ⇒ 选 P1 等于把 runtime 锚定到一份**已有内容级指纹**的产物上；P2 目前**没有任何 integrity 指纹**，需先补算。
- ⚠️ 落地要走「先归档 v11 → redeploy」的既有流程（平台无版本控制面，deploy 即不可逆覆盖）。

---

## 7. PLATFORM LOCK SUPPORT

| 项 | 值 | 依据 |
|---|---|---|
| `MEOO_DENO_LOCK_SUPPORT` | **NOT_VERIFIED**（文档零声明；且函数目录外文件不在部署输入面 ⇒ 工程上应按"不支持"设防） | `edge-functions.md` 全文无 lock 概念；`functions/privlan-merchant-api/` 只有 `index.ts`；`import_map:false`；`ezbr_sha256:""` |
| `EXACT_REMOTE_IMPORT_SUPPORTED` | **YES**（强证据） | 同一份 v11 源码里 `@noble/hashes@1.4.0/scrypt` 就是 exact remote import，且该函数已在线上 v11 正常运行（历史实测 `/healthz` 返回 `kdf:"verified"`，其 KAT 自检必须真正执行到 noble scrypt 才可能为 verified）⇒ exact remote import 在生产 Deno runtime **确实可用** |
| IMPORT MAP 支持 | **NOT_VERIFIED** | 平台有 `import_map` / `import_map_path` 字段但恒 `false` / `""`；无任何文档说明如何启用 |
| BUNDLED DEPENDENCIES | **NOT_VERIFIED** | 文档未提；`ezbr_sha256`（唯一像 runtime image hash 的字段）恒空串，无法观测产物 |
| `RECOMMENDED_REPRODUCIBILITY_MECHANISM` | **源码内 exact remote import specifier**（即 §6 的 P1/P2） | 这是**唯一可证明生效**的机制：exact URL 无 redirect，解析结果由源码自身决定、不依赖任何平台侧锁支持；而 lockfile 依赖一个平台从未声明、也无法验证的消费行为 |

**理由链**：把一个不可证明的机制（平台是否读根 lock）当作可复现性的承重墙，等于把安全性挂在一个未验证假设上。而 exact specifier 的确定性**完全在源码里**，并且已用 `deno check --no-lock --reload` 证明它能自证。

---

## 8. EVIDENCE STRENGTH SUMMARY

| 结论 | 强度 | 说明 |
|---|---|---|
| 工作文件 = v11 归档（逐字节，取证时点） | **STRONG** | 双 sha256 + Buffer.equals |
| 本地源码 = 线上 v11 源码 | **NOT_VERIFIED** | 平台不回读源码，仅版本号计数器间接对应 |
| import graph 恰为 2 条、零本地模块 | **STRONG** | 全语法类别扫描 + 函数目录 Glob 双证 |
| `@2` 是浮动 range、无 exact | **STRONG** | 源码字面量 + 302 Location 实测 |
| 浮动解析 = 2.116.0 | **STRONG** | 三向 UA 一致 + Deno 自身下载 URL 互证 |
| lock 记 2.115.0 且 integrity 有效 | **STRONG** | 实验 A：Deno 亲自校验通过、exit 0 |
| 漂移已发生（2.115.0 → 2.116.0） | **STRONG** | A/B 对照，唯一变量是 lock 输入 |
| 漂移是静默的（无 fail-fast） | **STRONG** | A、B 两轮 check 均 exit 0 |
| 2.115.0 轴完整闭包含 phoenix/iceberg-js | **STRONG** | §9 `--reload` 强制回源，48 条 Download 全轴确证 |
| v11 部署是否消费 lock | **NOT_VERIFIED** | 三条反向线索指向"未消费"，但无正向证明 |
| v11 线上当时运行的 supabase 版本 | **NOT_VERIFIED** | 无 artifact 指纹可回读 |
| 2.116.0 轴上 phoenix/iceberg-js 的版本 | **NOT_VERIFIED** | 缓存命中导致未重新下载，不可推断 |
| 漂移导致 v10 gateway 重试修复失效 | **PLAUSIBLE / 未实测** | 依赖 postgrest-js 内部信封形状，需 2.116.0 上的台架用例才能确证 |

---

## 9. REMEDIATION APPLIED — P1（2026-09-08，仅本地，**未部署**）

用户裁定采用 **P1**（以 lock 为权威锚点）。已执行：

| 文件 | 改动 |
|---|---|
| `functions/privlan-merchant-api/index.ts:18`（原 `:16`） | `@supabase/supabase-js@2` → **`@supabase/supabase-js@2.115.0`**，并加 2 行注释说明「`@2` 是浮动 range、曾实测静默漂移」——防止后人按平台文档示例把它改回 `@2` |
| `tests/privlan-merchant-login/build.mjs:24` | 同步替换匹配字面量。**必须同批改**：该处用完整字符串做 `String.replace`，不同步改会静默不匹配，但 `:37` 的 `includes("https://esm.sh")` 守卫会抛错 ⇒ fail-closed，不会产出假绿测试 |

**改后源码身份**：`d6d1817225c77655e9e2b48e9ac8aafe560a4b6542119dfd20bcf765f2756758`，90,441 B / 2,181 行。
**`WORKING_SOURCE_EQUALS_V11_ARCHIVE` 现为 `NO`**（预期结果）。`archive/privlan-merchant-api/index.v11.ts` 保持 `692a7da2…` **未动** ⇒ **回滚锚点完好**：把该归档复制回工作文件并部署，即可精确还原线上 v11。

### 自证结果（不依赖平台、不依赖部署）

`deno check --no-lock --reload functions/privlan-merchant-api/index.ts`（`--reload` 强制回源，排除缓存掩盖）→ **exit 0**，48 条 Download 行：

- ✅ **`https://esm.sh/@supabase/supabase-js@2`（浮动裸 URL）一次都未出现** —— 对比 §5 实验 B，它当时是**第 1 行**且紧跟一串 2.116.0
- ✅ 全部落在 2.115.0 轴：`supabase-js` / `auth-js` / `functions-js` / `postgrest-js` / `realtime-js` / `storage-js` 均 `2.115.0`
- ✅ 顺带闭合 §2 遗留项：该轴传递闭包确认为 `iceberg-js@0.8.1` + `@supabase/phoenix@0.4.5`（此前因缓存命中而 NOT_VERIFIED 的是 **2.116.0 轴**，本轴现已确证）
- ✅ `@noble/hashes@1.4.0` 保持 exact，行为不变

**回归**：`node --test tests/privlan-merchant-login/*.test.mjs` → **140 tests / 140 pass / 0 fail**（含四条写入面 tripwire 的「恰好 2 处 upload」断言，证明改动未越界引入写入）。

### 仍未闭合（下一步）

1. **线上 v11 仍是浮动 `@2`** —— 本次改动只在本地。要生效必须走「归档 v11 → `deploy-function`」，而**平台无版本控制面，deploy 即不可逆覆盖**。
2. **漂移的实际运行时影响仍未实测**：`classifyDbError` 的 `gateway` 分类依赖 postgrest-js 内部兜底信封形状。现在 pin 已把该轴钉死在 2.115.0（即 v10 修复被验证时的同一版本），风险从「未知漂移」降为「已知固定」；但**若要升级到 2.116.0 必须先补台架用例**。
3. **归档流程补 lock 快照**：`archive/privlan-merchant-api/` 只存 `index.vN.ts`、不含 lock，这是 v2–v11 全部无法还原依赖态的根因。现已无此必要（版本进了源码），但建议把「specifier 必须含完整 `major.minor.patch`」纳入部署前检查。

---

## SAFETY DECLARATION

| 项 | 取证阶段（§1–§8） | P1 应用后（§9） |
|---|---|---|
| `SOURCE_CHANGED` | **NO**（工作文件与 v11 归档均为 `692a7da2…`） | **YES（本地 2 个文件，按用户裁定执行）**；`archive/…/index.v11.ts` 未动 |
| `FUNCTION_CHANGED` | **NO** | **NO** — 未部署，线上仍为 v11 |
| `DEPLOYMENT_RUN` | **NO** — 仅 `deno check`（本地静态类型检查 + 公共 CDN 只读下载） | **NO** |
| `SECRET_VALUES_EXPOSED` | **NO** — 仅出现 secret **变量名**（平台 `list-functions` 自身返回），未读取/输出任何值；`.npmrc` 只输出键名 | **NO** |
| `STAGING_CHANGED` | **NO** — 零数据库写入、零迁移、零 Storage 写入 | **NO** |
| `PRODUCTION_CHANGED` | **NO** — 全程未触碰 `g8o5cv1om41o` | **NO** |

**本轮新增文件**（均为取证产物，不进入任何构建）：`tmp/dep-graph.mjs`、`tmp/esm-resolve.mjs`、`tmp/esm-ua.mjs`、`tmp/lock-probe.json`（根 lock 副本，已验证与根逐字节相同）。
