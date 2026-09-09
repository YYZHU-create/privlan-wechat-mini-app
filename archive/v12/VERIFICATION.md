# v12 候选 —— 验证证据（PRE-DEPLOY，未部署）

```
CANDIDATE=v12 (re-cut, 含 v12.1 授予侧 fail-closed 修订)
DEPLOYED=NO
STAGING_DEPLOYMENT_PERFORMED=NO
PRODUCTION_TOUCHED=NO
SCHEMA_CHANGES=NONE
SECRETS_CHANGED=NONE
ONLINE_VERSION_UNCHANGED=v11
```

## 台架结果

```
node tests/privlan-merchant-login/build.mjs        -> built（exit 0，无 esm.sh/Deno 残留）
node --test tests/privlan-merchant-login/*.test.mjs
  # tests 169
  # pass 169
  # fail 0
deno check --no-lock --reload functions/privlan-merchant-api/index.ts
  # CHECK_EXIT=0 / SUPABASE_RESOLUTION=2.115.0 / FLOATING_SUPABASE_IMPORTS=0
```

被测对象是 `build.mjs` 机械转译后的**真实可部署 Function 源码**（同一份 `functions/privlan-merchant-api/index.ts`，sha256 `0010ca398495…`），不是 admin legacy 代码、不是重写版。

构成：既有 140 项（回归全绿，未删任一用例）+ `authorization-contract.test.mjs` 29 项（首切片 26 项 + 本轮新增 A27/A28/A29）。

## 本轮（v12.1 授予侧）改动清单

| # | 位置 | 改动 |
|---|------|------|
| 1 | `index.ts:1348-1357` | `merchant.login` 审计追加 `required=true` —— 全函数**唯一**一处「成功授予」路径升级 |
| 2 | `index.ts:672-685` | `recordAudit` 的 fail-closed 注释重写为**三级策略**（拒绝 / 授予 / 其余），取代首切片「Legacy 6 点全保持 false」的旧表述 |
| 3 | `index.ts:1334-1341` | 授予点就地注释：说明抛错如何落进既有 `catch` → 补偿撤销 → token 不下发 |
| 4 | 无 | **未新增机制**：`createSession`/`issueSession` 早已把 `sessionId` 预先在内存生成并返回（注释原文即为「会话已落库但响应未能下发时才能精确撤销这一行」），`compensateRevokeSession`（`:695`）已按 `.eq("id", sessionId)` 主键定界。本轮只是把授予侧审计接进这条既有链路 |

源码净变化：+16 行 / +1427 字节（2374→2390 行，97766→99193 字节）。

## §4 要求的 12 项直接覆盖 → 用例映射

| 要求 | 用例 |
|------|------|
| owner authorized | A1, A2 |
| arbitrary role denied | A3, A4, A5, A6, A7, A8 |
| missing membership denied | A9 |
| scope mismatch denied | A11, A12 |
| `merchant.authorization_denied` persisted/observable | A3, A7, A9, A11, A12（逐条断言行数与 metadata） |
| audit write failure fail-closed（拒绝侧） | A13（角色闸门）, A14（内部端点身份锁） |
| **audit write failure fail-closed（授予侧 + 补偿撤销 + token 不返回）** | **A16, A27** |
| **非授予路径不得因 audit sink 故障降级** | **A28（失败登录 401 / logout 200）, A29（策略集合封闭）** |
| login success compatibility | A15 |
| login failure compatibility | A10, A17 |
| session resolution | A18 |
| subscription resolution | A19, A20 |
| no sensitive audit fields | A21（另 A4/A8 单独锁「不回显角色原文 / pathname」） |
| Supabase import exact pin | A22 |
| 附加：append-only | A23 |
| 附加：撤销可按主键定界 | A24 |
| 附加：写入面 tripwire 仍恰好 2 处 | A25 |
| 附加：闸门只挂一处汇聚点 | A26 |

## 新契约的三条关键断言（A16 / A27 逐条钉住）

1. **token 物理不返回**：`res.body.data === undefined`、`getSetCookie().length === 0`、响应头不含 `set-cookie`。不是「过滤掉 token」，而是 `return success(...)`（`:1361`）在 `recordAudit` 抛错时根本没被执行到。
2. **撤销按主键定界**：`dbState.calls` 里 `merchant_sessions:update` 的 filters 必须**恰好**等于 `["eq(id,<本轮 sessionId>)"]`，values 的键集合必须**恰好**等于 `["revoked_at"]` —— 既防「扩大撤销范围」，也防「顺带改 expires_at」。
3. **补偿也失败时仍不返回凭据**（A27）：注入 `merchant_sessions:update` 持续失败 ⇒ 两次有界尝试后 `login_compensation_failed` 落日志、`login_session_compensated` **不得**出现，响应仍是 503 且零 set-cookie。取舍写死：宁可留一条孤儿会话，也不下发一个无法追溯的凭据。该孤儿会话的明文 token 从未离开服务端，且会随 TTL 自然失效。

## 两处刻意保留的不完美（必须随候选一起交接，勿当作已完成）

1. **`required` 是三级策略，不是全函数开关。**
   恰好 6 处 `required=true` = 5 处 `merchant.authorization_denied` + 1 处 `merchant.login`；其余 5 处（`login_failed` / `logout` / `login_session_revoked` / `asset_proxy_upload` / `asset_capacity_probe`）刻意**完全不传**该实参（走默认 false），A29 同时禁止「显式写 false」以免策略失去唯一真源。
   ⇒ 后果：`audit_events` sink 故障期间，**该租户无法登录**（授予侧 fail-closed 的定价），但失败登录仍返回 401、logout 仍返回 200。这是「可用性换可追溯性」的有意识交换，不能当作无成本的安全增强宣传。
   ⚠️ 更正：首切片本文件与交付报告曾断言「属性 6 与属性 10 物理对立」。**该论断错误**，对立的只是「无补偿的 fail-closed」这一种实现；加上补偿撤销后两侧可同时成立。

2. **「拒绝路径零业务表写入」断言被收窄，未被删除。**
   涉及 `signed-upload-probe.test.mjs` test 16、`signed-upload-execute.test.mjs` E13 两处。原断言 `Object.keys(dbState.written) === []` 与属性 5 直接对立。现改为：`audit_events` 从禁止表除外，但**正向锁定**其内容只能是 `action=merchant.authorization_denied` 且 `metadata.contract=OWNER_ONLY_FAIL_CLOSED` 且 `reason ∈ {scope_identity_mismatch, scope_override_attempt}`；其余任何表、任何 action、任何多余行仍一律失败。依据本项目既有定案「tripwire 必须收窄而非删除」。

## 台架保真度补充（不改被测源码）

`fake-supabase.ts` 的 INSERT 只记进 `dbState.written`、不回写 `dbState.rows`（`:143-146`），故「本轮登录刚签发的 token」默认读不到。新增 `promoteSession()` 把该行提升为可读，等价于真实库事务已提交，用于真正测通「登录 → token → 已认证路由」链路。这是台架侧补齐，未触碰 Function 源码。

另一处台架限制需诚实标注：`dbState.written` 与 `dbState.rows` 不连通，因此**无法**在 A16 里直接观察「那一行的 `revoked_at` 真被写进了库」。A16 的观察面是 `dbState.calls`（op / filters / values 逐字段），等价于「服务端确实发出了一条按主键定界的 UPDATE」，不等价于「该行最终状态为已撤销」。后者只能在 Staging 部署后用真实 SQL 回查确证。

## 未验证 / 不可验证项（诚实清单）

- `NODE22_VALIDATION=BLOCKED`：沙箱 Node 为 **v20.19.4**，无 Node 22。本轮 169 项全绿是 **Node 20** 证据，**不得**当作声明的 Node 22 runtime 证据使用。
- 线上运行时行为未确证：v12 从未部署，`/healthz` 的 `kdf:"verified"` 冷启动自检、真实网关下的 `classifyDbError` 分诊、真实 Storage 往返、以及**本轮新增的「审计失败 → 补偿撤销」在真实并发下的表现**都只能在 Staging 部署后验证。
- 补偿撤销的「可靠性」上限是**两次有界尝试**（既有实现，本轮未加强）。若 `merchant_sessions` 在两次尝试内都不可写，则确实会留下孤儿会话 —— 已按 A27 钉住「此时绝不返回 token」，但「不泄漏」不等于「已撤销」。
- `memberships.role` 在库内仍是裸 text（无 CHECK、无枚举）⇒ v12 实现的是「读角色并判定」，**没有**收紧数据层约束（属 Schema 变更，本切片范围外）。
- 已知缺陷未夹带修复：`echoKeyMatchesCanonical` 恒假（`upload()` 返回 `Path` 而非 `Key`）、`/healthz` 的 `readOnly:true` 写死字面量、`proxy_upload` 的 409 分支无日志、登录审计 `tenant_id` 为 NULL 的既有历史行。
