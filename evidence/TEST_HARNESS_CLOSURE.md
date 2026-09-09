# 台架真实本地依赖闭包（§5）

## 入口

```
TEST_ENTRYPOINTS=tests/privlan-merchant-login/authorization-contract.test.mjs  tests/privlan-merchant-login/build.mjs  tests/privlan-merchant-login/capacity-gate.test.mjs  tests/privlan-merchant-login/login.test.mjs  tests/privlan-merchant-login/mp-images.test.mjs  tests/privlan-merchant-login/proxy-upload.test.mjs  tests/privlan-merchant-login/signed-upload-execute.test.mjs  tests/privlan-merchant-login/signed-upload-probe.test.mjs
BUILD_ENTRY=tests/privlan-merchant-login/build.mjs
```

## 本地依赖文件（共 11 个，含入口）

| 文件 | 字节 | sha256 前 12 | 角色 |
|------|------|--------------|------|
| `tests/privlan-merchant-login/authorization-contract.test.mjs` | 32951 | d62706e0d918 | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/build.mjs` | 2959 | a7761706d08b | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/capacity-gate.test.mjs` | 28288 | 22cd4e351e5e | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/login.test.mjs` | 26091 | cc037a276801 | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/mp-images.test.mjs` | 11701 | 22a163535873 | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/proxy-upload.test.mjs` | 22988 | cdd33a20844d | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/signed-upload-execute.test.mjs` | 18355 | d0bf214afc20 | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/signed-upload-probe.test.mjs` | 23596 | 076a6096b958 | 测试入口 / 构建脚本 |
| `tests/privlan-merchant-login/fakes/fake-scrypt.ts` | 917 | ee2a069fd593 | fake 替身（被 build.mjs 复制进转译输入） |
| `tests/privlan-merchant-login/fakes/fake-supabase.ts` | 11207 | 53117538c4c8 | fake 替身（被 build.mjs 复制进转译输入） |
| `functions/privlan-merchant-api/index.ts` | 99193 | 0010ca398495 | 被测 Function 源码本体 |

```
TEST_LOCAL_DEPENDENCY_FILE_COUNT=11
TEST_HARNESS_CLOSURE_COMPLETE=YES
```

## 闭包是怎么算出来的（不是靠猜目录）

`build.mjs` 的依赖不是静态 import，而是**运行期字符串路径**，所以纯 import 图会漏：

- `build.mjs:44-45` 用 `${ROOT}/tests/privlan-merchant-login/fakes/fake-{supabase,scrypt}.ts` 模板串 `copyFileSync` ⇒ `fakes/` 两个 .ts 是真依赖
- `build.mjs:50` 调 `${ROOT}/node_modules/typescript/bin/tsc` ⇒ **typescript 是外部依赖，不是仓库文件**（见下）
- 7 个 .test.mjs 用 `new URL("fake-supabase.js", BUILT)` 加载 **tmp/mbuild/out/** 下的转译产物 ⇒ 那是生成缓存，按 §9 排除，由 `build.mjs` 现场重建
- `authorization-contract.test.mjs:26` 用绝对路径 `/home/project/functions/privlan-merchant-api/index.ts` 做源码级断言（A22-A26、A29）⇒ 函数源码同时是"被测物"和"被测断言的输入"

## 排除项及理由（不是遗漏）

| 路径 | 处置 | 理由 |
|------|------|------|
| `tmp/mbuild/**` | 排除 | 生成缓存，§9 明令排除；由 build.mjs 重建 |
| `node_modules/**` | 排除 | §9 明令排除；见下"外部前置条件" |
| `secret.png` | **不是依赖** | 只出现在 `mp-images.test.mjs:177-211` 等处的遍历断言字符串里，测试注释原文即「本工作区没有该对象」。它必须**不存在**才是有效断言 |
| `.env` / `.env.miniprogram` / 任何凭据 | 排除 | §9 明令；本包零凭据 |

## 外部前置条件（接收方必须自备，无法打包）

1. Node **22.x**（本包基线是 v20.19.4 产出的，见 REPRODUCTION.md）
2. `typescript@UNKNOWN`（声明范围 `^5.8.3`）必须装在 `<repo>/node_modules/typescript/bin/tsc`，否则 build.mjs:47 直接抛错
3. 若只跑依赖轴证明，还需 `deno`（本机 deno 2.9.2 (stable, release, x86_64-unknown-linux-gnu)）

## ⚠️ 台架里写死的两个绝对路径（本切片刻意不改，只披露）

```
tests/privlan-merchant-login/build.mjs:14                 const ROOT = "/home/project";
tests/privlan-merchant-login/authorization-contract.test.mjs:26   const FUNCTION_SRC = "/home/project/functions/privlan-merchant-api/index.ts";
```

§0 禁止我改测试，所以这两处**原样交接**。接收方二选一：

- **推荐**：把仓库根放在 `/home/project`（容器内 bind-mount 或直接把包解到该路径），零改动即可复跑；
- 若必须换路径：只改上面两个常量属于**台架寻址调整**，不触碰任何被测字节。但必须在回报里显式写明"改过 ROOT 寻址"，否则 `TESTED_SOURCE = HANDOFF_SOURCE` 这条链会被质疑。

还原用的三条 cp 见 REPRODUCTION.md。
