# PRIVLAN MERCHANT API — V12 CANDIDATE RECONCILIATION

```
MODE=PRE_DEPLOY_RUNTIME_RECONCILIATION
TARGET=privlan-merchant-api next Staging candidate
CURRENT_ONLINE_VERSION=v11
NEXT_VERSION_CANDIDATE=v12
DEPLOYED=NO
STAGING_DEPLOYMENT_PERFORMED=NO
PRODUCTION_TOUCHED=NO
SCHEMA_CHANGES=NONE
MIGRATIONS_CREATED=NONE
SECRETS_CHANGED=NONE
CREDENTIAL_VALUES_EMITTED=NONE
```

## 0. 前置事实与一处必须澄清的判据限制

`CODEX_HARDENING_IMPLEMENTED` 这一列**在本沙箱无法逐行取证**：Merchant Auth Runtime Hardening 的 Codex 侧改动（Node/admin 代码树）不在 `/home/project` 内，本沙箱只有 Meoo Function 源码、台架与归档。因此该列填的是「按 10 条属性所声明的意图，Function 侧是否达成等价行为」，**不是**两份代码的 diff 结果。凡以 Function 侧证据支持的地方，`SOURCE_ANCHOR` 都给了真实行号（本轮由脚本复扫取得，非估写）。

判据口径：`MATCH=` 给**本轮结束时的终态**；改前不达标者在下表 `PRE_V12=` 标出，避免把「我本轮才补的」说成「本来就有」。

## 1. RECONCILE HARDENING INTO ACTUAL FUNCTION RUNTIME

### 属性 1 — 正常已认证 scope 由 membership 派生
```
PROPERTY=normal authenticated scope is membership-derived
CODEX_HARDENING_IMPLEMENTED=YES(按其声明意图)
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮之前即成立)
SOURCE_ANCHOR=resolveCanonicalScope index.ts:434；memberships 读取 .select("tenant_id,workspace_id,role") :472；role 赋值 :541-542；登录侧 membership 派生 :1236-1242(order created_at + limit 1)；resolveSession :591-595
MATCH=YES
```
Scope 的 tenant/workspace/role 全部来自数据库读，浏览器无任何输入面。

### 属性 2 — generic Merchant Auth 不使用真实 PrivLan scope
```
PROPERTY=real PrivLan scope is not used by generic Merchant Auth
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮之前即成立)
SOURCE_ANCHOR=PROBE_TENANT_ID/PROBE_WORKSPACE_ID :1056-1057（全文件仅这 2 个 UUID 字面量）；四条内部端点身份锁 :1470/:1638/:1753/:1981；/auth/* /v1/* /api/platform/bootstrap 对该常量零引用
MATCH=YES
```
真实 PRIVLAN 商户身份只作为「内部存储端点的允许名单」出现，通用认证链路从不据它派生 scope。

### 属性 3 — 未知/非 owner 角色默认 DENY
```
PROPERTY=unknown / non-owner role defaults to DENY
PRE_V12=NO（v11 全文 10 处 role 无一处参与授权分支）
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮移植)
SOURCE_ANCHOR=isRoleAuthorized :894 + ALLOWED_ROLES :891（封闭 Set，仅 owner）；汇聚点调用 :1402；登录侧 :1282
MATCH=YES
```
移植保持 Function 原生架构：判定读 `scope.role`（已由 membership 派生），不引入任何新数据面。`trim().toLowerCase()` 后与白名单比对，非字符串/空/null 一律落到 DENY。

### 属性 4 — 当前临时契约 OWNER_ONLY_FAIL_CLOSED
```
PROPERTY=current interim contract is OWNER_ONLY_FAIL_CLOSED
PRE_V12=NO
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮移植)
SOURCE_ANCHOR=AUTHORIZATION_CONTRACT :890；section 6.5 :881-981（含 roleClassOf :899、entrypointClassOf :907、assertAuthorizedRole :921、recordScopeIdentityDenial :955）
MATCH=YES
```
契约名以常量形式存在并写进每条审计的 `metadata.contract`，便于日后放开角色时按审计回溯。刻意未做 RBAC 表、未做权限矩阵 —— 那是 Schema 变更，超出本切片。

### 属性 5 — 实质性授权拒绝必须产生 merchant.authorization_denied
```
PROPERTY=material authorization denial emits merchant.authorization_denied
PRE_V12=NO（recordAudit 原 6 个调用点零该 action；九类 403 分支零审计）
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮移植)
SOURCE_ANCHOR=落点 :855(scope 覆盖) :937(角色闸门) :970(内部端点身份锁) :1260(登录无 membership) :1282(登录角色不达标)；身份锁调用 :1470/:1638/:1753/:1981
MATCH=YES
```
覆盖面上刻意做成**中心化**：角色闸门只挂一处汇聚点（:1402），杜绝「漏挂某条路由」这一类失效；四条内部端点身份锁共用 `recordScopeIdentityDenial` 同一实现。

### 属性 6 — 审计写入失败保持 fail-closed
```
PROPERTY=audit write failure remains fail-closed
PRE_V12=NO（v11 只 logEvent 后静默继续）
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(授予侧 + 拒绝侧，带补偿撤销)
SOURCE_ANCHOR=recordAudit :643（required 形参）；insert :652；失败抛 503 AUDIT_WRITE_UNAVAILABLE :686；三级策略注释 :672-685；授予侧升级点 :1348-1357（末实参 true）；补偿撤销 :695 / 调用点 :1377；success 构造点 :1361
MATCH=YES(v12.1 裁定口径) / NO(全函数无差别口径，已否决)
```
**v12.1 修订：本属性已在「拒绝侧 + 授予侧」两侧同时闭合，代价被明确定价。**

本段原文曾断言属性 6 与属性 10「物理对立」。**该论断已被用户裁定推翻，此处自我更正**：对立的只是「无补偿的 fail-closed」这一种实现方式；补上「审计失败即撤销刚落库的会话、且不下发 token」之后，两侧可以同时成立。

现契约是**三级**，不是全函数开关：

1. **拒绝侧**（5 处 `merchant.authorization_denied`）`required=true` —— 无证据即 503，绝不产出无法追溯的授权判定。（本轮不动，保持 fail-closed）
2. **授予侧**（唯一一处 `merchant.login` / 会话签发，`index.ts:1348-1357`）`required=true` —— 抛错落进该路径**既有**的 `catch`，由 `compensateRevokeSession`（`:695`，调用点 `:1377`）按主键 `eq(id, 本轮 sessionId)` 只撤销这一行；`return success(...)`（`:1361`）尚未构造，故 token 与两个 set-cookie 物理上不可能出现在响应里。**未新增任何机制**：`issueSession` 早就把 `sessionId` 预先在内存生成并返回，注释原文即为「会话已落库但响应未能下发时才能精确撤销这一行」。
3. **其余全部** `required=false`（失败登录、logout、补偿审计、资产类普通审计）—— 审计 sink 故障**不得**把它们拖成 5xx。

策略集合由台架 A29 封闭钉住：恰好 6 处 `true` = 5 拒绝 + 1 授予；其余 5 处一律**完全不传**该实参（也禁止显式写 `false`，以免策略失去唯一真源）。

残余代价（这是定价，不是缺陷）：`audit_events` sink 故障期间**该租户无法登录** —— 用可用性换可追溯性，有意的交换。若补偿撤销本身也失败，则宁可留下一条「已落库但凭据从未离开服务端」的孤儿会话（A27 钉住此时仍 503、仍零 set-cookie）；该会话随 TTL 自然失效，但「不泄漏」不等于「已撤销」，这点必须说清。

⇒ 属性 6 达成度：`MATCH=YES（按 v12.1 裁定口径）` / `NO（全函数无差别口径 —— 该口径已被明确否决，不再追求）`。

### 属性 7 — 敏感凭据/token 材料从不进审计
```
PROPERTY=sensitive credential/token material is never audited
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES
SOURCE_ANCHOR=logEvent 字段白名单注释 :177-179；新增审计字段全为封闭字面量（reason/contract/entrypoint/endpoint/parameter/roleClass）；roleClassOf :899 与 entrypointClassOf :907 的职责就是「把可控原文降为有界类别」
MATCH=YES
```
本轮新增面里唯一可能带浏览器可控信息的是 `parameter`，其取值来自 `assertScopeNotOverridden` 内**硬编码的三元组键名**，不是浏览器传入值；被拒的取值本身不回显（A11 断言 FOREIGN_WORKSPACE_ID 不出现在审计行）。

### 属性 8 — UAT 会话清理可定界
```
PROPERTY=UAT session cleanup can be scoped
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES(本轮之前即成立，本轮补 tripwire)
SOURCE_ANCHOR=compensateRevokeSession .eq("id", sessionId) 与 logout .eq("id", scope.sessionId)（两处 update）；全函数无 bulk revoke；台架 A24 钉住
MATCH=YES
```
仅有的两条撤销路径都是单行主键等值，不存在「按 workspace/user 批量撤销」的语句，因此 UAT 清理天然可收窄到单会话。**注意**：这是「函数侧能做到定界」的证据，不是「已对 UAT 做过清理」的证据 —— 本轮零部署、零数据写入。

### 属性 9 — 审计证据 append-only
```
PROPERTY=audit evidence is append-only
CODEX_HARDENING_IMPLEMENTED=YES
FUNCTION_RUNTIME_IMPLEMENTED=YES
SOURCE_ANCHOR=全文件 from("audit_events") 仅 :652 一处 .insert；零 update/delete/upsert（台架 A23 同时锁定「只允许一处写入入口」）
MATCH=YES
```

### 属性 10 — 既有 login/session/subscription 行为保持兼容
```
PROPERTY=existing login/session/subscription behavior remains compatible
CODEX_HARDENING_IMPLEMENTED=N/A(未触碰 Function)
FUNCTION_RUNTIME_IMPLEMENTED=YES
SOURCE_ANCHOR=回归：既有 140 项用例全绿未删任一条；新增 A15/A16(登录成功契约) A10/A17(登录失败契约) A18(会话三条件) A19/A20(订阅解析)
MATCH=YES
```
兼容性的边界要说清楚：新增的角色闸门确实**改变了「非 owner 能登录」这一既有行为**（v11 允许、v12 拒绝）。这是属性 3/4 要求的、有意的收紧，不是回归；但它是**用户可见的行为变更**，Staging 验证时必须专门确认真实 PRIVLAN owner 账号（role=owner）仍可正常登录，且任何 role 非 owner 的现存账号会开始收到 403 `ROLE_NOT_AUTHORIZED`。

## 2. PRESERVE DEPENDENCY PIN

```
SUPABASE_IMPORT=https://esm.sh/@supabase/supabase-js@2.115.0
FLOATING_SUPABASE_IMPORTS_IN_SOURCE=0
REMOTE_IMPORT_COUNT=2（supabase-js exact + @noble/hashes@1.4.0/scrypt exact，零本地模块）
PIN_TEST=authorization-contract.test.mjs A22（常驻，防后人按平台文档示例改回浮动写法）
```
本轮未触碰 import 行（P1 已钉，属既有状态）。

## 3. VERSION IDENTITY

```
NEXT_VERSION_CANDIDATE=v12
WORKING_SOURCE=functions/privlan-merchant-api/index.ts
  bytes=99193  lines=2390  sha256=0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55
  [re-cut] 首切片为 97766 / 2374 / 2e6ea235…；v12 从未部署，故按「同一候选重新出片」重切，
  两个哈希均保留在 source.sha256 内可完整追溯。v11 回滚锚点全程未动。
V11_ARCHIVE=archive/privlan-merchant-api/index.v11.ts
  bytes=90225  lines=2179  sha256=692a7da254ab4f479762aaba2e219f603b57a41b6e283d8e35b8681ede86bb7a
  V11_MODIFIED=NO（sha256 与既有锚点逐字符一致，本轮只读）
V12_ARCHIVE(不可变，源码对账+测试全绿之后才创建)
  archive/privlan-merchant-api/v12/index.ts        99193  0010ca39…
  archive/privlan-merchant-api/v12/source.sha256
  archive/privlan-merchant-api/v12/DEPENDENCIES.md
  archive/privlan-merchant-api/v12/VERIFICATION.md
  archive/privlan-merchant-api/index.v12.ts        99193  0010ca39…（兼容既有扁平回滚约定）
  三份 v12 副本由同一次 cp 产生，sha256 复算一致 ⇒ 字节同一性由构造保证
```
说明：项目既有归档约定是扁平 `index.vN.ts`，用户推荐结构是 `v12/` 目录。两者不冲突，故**同时提供**，并在 `source.sha256` 里记录唯一哈希，避免「两份哪个算权威」的歧义。回滚 v11 的动作 = 把 `index.v11.ts` 复制回工作文件后 deploy。

## 4. DIRECT FUNCTION TESTS

被测对象 = **实际可部署的 Function 候选**（`build.mjs` 对同一份 `index.ts` 做 4 处机械替换后 `tsc --noCheck` 转译），不是 admin legacy 代码。

```
node tests/privlan-merchant-login/build.mjs                 -> built, exit 0
node --test tests/privlan-merchant-login/*.test.mjs         -> # tests 169 / # pass 169 / # fail 0
  既有回归 140 项（未删任一用例）+ 29 项 authorization-contract.test.mjs（首切片 26 项 + v12.1 新增 A27/A28/A29）
```
12 项要求全覆盖，映射表见 `archive/privlan-merchant-api/v12/VERIFICATION.md`。

过程中修掉的两类问题，性质完全不同，分开交代：
1. **契约冲突（真冲突，需裁定）**：`signed-upload-probe.test.mjs` test 16 与 `signed-upload-execute.test.mjs` E13 把「拒绝路径零业务表写入」钉成 `Object.keys(dbState.written) === []`，与属性 5 直接对立。按项目既有定案「tripwire 必须收窄而非删除」处理：`audit_events` 除外，但正向锁定其内容只能是 `merchant.authorization_denied` + `contract=OWNER_ONLY_FAIL_CLOSED` + `reason ∈ {scope_identity_mismatch, scope_override_attempt}`，其余任何表/任何 action/任何多余行仍一律失败。
2. **测试自身缺陷（与被测源码无关）**：A1/A11/A12/A14/A19/A20/A21 首轮 401/404，根因是台架 `fake-supabase.ts:143-146` 的 INSERT 不回写 `rows`（故刚签发的 token 读不到）与夹具缺 `subscriptions.tenant_id`（`getSubscription` :754-755 双条件过滤）。补 `promoteSession()` 与夹具字段后通过，**未因此改动 Function 源码一行**。

## 5. DEPENDENCY PROOF

```
COMMAND=deno check --no-lock --reload functions/privlan-merchant-api/index.ts
SUPABASE_RESOLUTION=2.115.0
FLOATING_SUPABASE_IMPORTS=0
CHECK_EXIT=0
RESOLVED_URLS=46（去重后仍 46）
SUBPACKAGE_AXIS=supabase-js/auth-js/functions-js/postgrest-js/realtime-js/storage-js 全部 2.115.0；phoenix 0.4.5
BARE_AT_2_IN_RESOLUTION_LOG=0
```
`--no-lock --reload` 是关键：排除 lockfile 与本地缓存两个混淆源，逼 Deno 真去 esm.sh 解析。裸 `@2` 一次未出现 ⇒ 钉住顶层即钉死整棵传递闭包（机制：esm.sh shim 正文内嵌 exact 子包绝对路径）。

仍未闭合、不得掩盖：`DEPLOYMENT_USED_LOCKFILE=NOT_VERIFIED`。部署输入面只有 `functions/{name}/index.ts`，根 `deno.lock` 是工作区级产物、不被本归档版本化。工程上按「部署未消费 lock」设防 ⇒ 真正的承重墙是源码内 exact specifier（已被 A22 常驻钉住）。

## 6. NODE 22 VALIDATION

```
NODE22_VALIDATION=BLOCKED
SANDBOX_NODE_VERSION=v20.19.4
STAGING_DEPLOY_READY=NO
NODE20_EVIDENCE=# tests 169 / # pass 169 / # fail 0（本轮实测）
NODE22_EVIDENCE=NONE
```
沙箱只有 Node 20.19.4，无 Node 22，且沙箱不能安装系统级版本切换工具。按用户逐字约束：**本轮 169 项全绿是 Node 20 证据，不得冒充声明的 Node 22 runtime 证据**；因此 `STAGING_DEPLOY_READY=NO`。补齐方式：在具备 Node 22.x 的环境执行 `node tests/privlan-merchant-login/build.mjs && node --test tests/privlan-merchant-login/*.test.mjs`，期望同样 169/169；该动作不依赖凭据、不依赖部署，是唯一能解除本阻塞的路径。

## 7. PRE-DEPLOY DECISION

```
FUNCTION_CONTAINS_SCOPE_HARDENING=YES
FUNCTION_CONTAINS_OWNER_FAIL_CLOSED=YES
FUNCTION_CONTAINS_AUTHORIZATION_AUDIT=YES
FUNCTION_AUDIT_FAILURE_FAIL_CLOSED=YES_GRANT_AND_DENY_PATHS_ONLY
FUNCTION_SUPABASE_PINNED_2_115_0=YES
V11_ARCHIVE_UNCHANGED=YES
V12_CANDIDATE_READY=YES_WITH_NODE22_BLOCKED
NODE22_VALIDATION=BLOCKED
READY_FOR_INDEPENDENT_RE_REVIEW=YES
STAGING_DEPLOYMENT_PERFORMED=NO
```

逐字段依据：
- `FUNCTION_AUDIT_FAILURE_FAIL_CLOSED=YES_GRANT_AND_DENY_PATHS_ONLY` —— 授予侧与拒绝侧均 fail-closed（v12.1 裁定口径）；不写 `ALL_PATHS` 是因为「失败登录 / logout / 普通审计」被明确要求不得因 audit sink 故障降级，该集合由 A29 封闭钉住（6 处 true / 5 处不传）。
- `V12_CANDIDATE_READY=YES_WITH_NODE22_BLOCKED` —— 源码对账、169 项台架、依赖证明三项均达标；候选归档已落盘（v12 因从未部署而**重切一次**，首切片哈希在 `source.sha256` 内保留可追溯，v11 回滚锚点全程未动）；但 Node 22 门槛未过，故不写成无条件 YES。
- `READY_FOR_INDEPENDENT_RE_REVIEW=YES` —— 复核者需要看的四件东西都在：`archive/privlan-merchant-api/v12/{index.ts,source.sha256,DEPENDENCIES.md,VERIFICATION.md}`、`tests/privlan-merchant-login/authorization-contract.test.mjs`、被收窄的 2 处既有断言、以及本报告的 10 条锚点。
- 复核者若只有一小时，优先级：① 授予侧 fail-closed 的**定价**是否接受（audit sink 故障期间该租户登不进去，且补偿撤销两次都失败时会留下不可用的孤儿会话）；② 角色闸门收紧对线上非 owner 账号的影响面是否已评估；③ A26「闸门只挂一处」+ A29「required 集合封闭」是否真能防漏挂与防无差别扩散。

## 8. 部署后必须验证的清单（本切片刻意不做）

1. 真实 PRIVLAN owner 账号（`login_identifier` 取 Legacy 侧值）在 Staging 能 200 登录 —— 角色闸门最坏失效模式是误拒真实 owner。
2. `/healthz` 的 `data.kdf:"verified"` 冷启动自检通过（台架证不了 esm.sh 侧 scrypt）。
3. v10 的 `classifyDbError` gateway 分类在 2.115.0 exact pin 下仍有效（观察是否复现 503 `SESSION_LOOKUP_UNAVAILABLE`）。
4. 故意用非 owner 会话打一条 `/v1/*`，回查 `audit_events` 是否落 `merchant.authorization_denied` 且 `tenant_id` 非 NULL。
5. 部署前务必再确认一次线上仍是 v11（`cloud list-functions` 的自增 `version`），因为平台无版本控制面、deploy 即覆盖不可逆。

## 9. 已知缺陷（本轮刻意未夹带修复）

- `echoKeyMatchesCanonical` 恒假：`upload()` 返回 `Path` 而非 `Key`，4 处消费自上线从未生效。
- `/healthz` 的 `readOnly:true` 是写死字面量，与真实写入闸门无关（改形状要跨 3 文件动契约）。
- `proxy_upload` 的 409 分支无 `logEvent`（幂等重放在服务端不可见）。
- 历史登录审计 `tenant_id` 恒 NULL（163/243 行无法按租户归属）—— 新写的授权审计已带 tenantId，历史行不回填。
- `memberships.role` 仍是裸 text、无 CHECK、无枚举 —— v12 只实现「读角色并判定」，未收紧数据层（属 Schema 变更，超出本切片）。
