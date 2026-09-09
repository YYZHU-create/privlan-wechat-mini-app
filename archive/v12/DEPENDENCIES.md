# v12 候选 —— 依赖可复现性证据

命令（对**重切后的最终候选**执行，强制回源、同时排除 lockfile 与本地缓存两个混淆源）：

```
deno check --no-lock --reload functions/privlan-merchant-api/index.ts
```

原始输出留档：`tmp/v121-deno-check.txt`

## 结论

```
SUPABASE_RESOLUTION=2.115.0
FLOATING_SUPABASE_IMPORTS=0
CHECK_EXIT=0
ESM_URL_COUNT=46
DEPENDENCY_GRAPH_REPRODUCIBLE=YES(仅就顶层 specifier 而言)
DEPLOYMENT_USED_LOCKFILE=NOT_VERIFIED
```

本轮源码改动（`merchant.login` 审计实参升级 + 两处注释重写）**不新增任何 import**，
remote import 仍恰好 2 条，故依赖轴与首切片一致；重跑是为了排除「改完源码就没再 check」这类交接漏洞。

## 可部署源码的 remote import（恰好 2 条，零本地模块）

| 行 | specifier | 形态 |
|----|-----------|------|
| `index.ts:18` | `https://esm.sh/@supabase/supabase-js@2.115.0` | exact（P1 由 `@2` 钉死） |
| `index.ts:19` | `https://esm.sh/@noble/hashes@1.4.0/scrypt` | exact |

源码内 `@supabase/supabase-js@2` 浮动写法命中数：**0**（判据：出现该子串但其后不是 `.115.0`，注释行除外；由 `authorization-contract.test.mjs` A22 长期钉住）。

## `--no-lock --reload` 实测解析轴（46 条 esm.sh URL，去重后 46 条）

| 包 | 解析版本 |
|----|----------|
| `@supabase/supabase-js` | 2.115.0 |
| `@supabase/auth-js` | 2.115.0 |
| `@supabase/functions-js` | 2.115.0 |
| `@supabase/postgrest-js` | 2.115.0 |
| `@supabase/realtime-js` | 2.115.0 |
| `@supabase/storage-js` | 2.115.0 |
| `@supabase/phoenix` | 0.4.5 |

裸 `@supabase/supabase-js@2`（无 patch 段）在解析日志中出现 **0 次** ⇒ 钉住顶层即钉死整棵传递闭包，与 esm.sh shim 正文内嵌 exact 子包绝对路径的机制一致。

## 未闭合项与既有约束（不得被本文件掩盖）

1. `DEPLOYMENT_USED_LOCKFILE=NOT_VERIFIED`：根 `deno.lock` 是工作区级产物，不在函数目录内、不被本归档版本化；`deploy-function` 的输入面只有 `functions/{name}/index.ts`。工程上按「部署未消费 lock」设防。
2. 因此真正的承重墙是**源码内的 exact specifier**，不是 lockfile。这也是 A22 把它做成常驻测试的原因。
3. `minor` 位移仍可能改变 postgrest-js 内部兜底信封形状，而 v10 的 `classifyDbError` gateway 分类依赖该形状。exact pin 已把这一风险冻结在 2.115.0，但**只有在 Staging 真人登录才能确证线上运行时行为**，台架证不了 esm.sh 侧 scrypt 与网关重试。
4. 严禁用沙箱 `fetch` 的 sha256 去比对 lock integrity —— esm.sh 按 UA 做内容协商（Deno UA 与浏览器/Node UA 返回不同产物），摘要轴天然不可比。判定漂移只能用版本轴。
