# SIGNED_UPLOAD_CAPABILITY_AUDIT — 终态报告

日期：2026-09-05 ｜ 项目代号：asmhysidbg5g（ATELIER OS B1 Staging）
执行边界：只做能力审计，不上传文件、不建 bucket、不加 RLS policy、不改 Auth、不改前端代码、不碰 Production、不读取或打印任何 service_role 值
取证脚本：`tmp/asset-delivery/signed-upload-audit.mjs`、`tmp/asset-delivery/signed-upload-audit-2.mjs`（均零写入、零凭据）

---

## 一、最终输出（第九节格式）

```
=== SIGNED UPLOAD CAPABILITY AUDIT ===

PROJECT_ID=asmhysidbg5g（项目代号；内部实例标识按平台规则不输出）
PRODUCTION_TOUCHED=NO

SIGNED_UPLOAD_API_PRESENT=YES
SIGNED_DOWNLOAD_ROUTE=POST|GET /storage/v1/object/sign/{bucket}/{key}
SIGNED_UPLOAD_ROUTE=POST /storage/v1/object/upload/sign/{bucket}/{key}（签发）
                    PUT  /storage/v1/object/upload/sign/{bucket}/{key}?token=***（上传）

SIGNED_UPLOAD_PRIVATE_BUCKET_SUPPORTED=NOT_VERIFIED
SIGNED_UPLOAD_NESTED_PATH_SUPPORTED=ROUTE_LAYER_YES / END_TO_END_NOT_VERIFIED
SIGNED_UPLOAD_TOKEN_PATH_BOUND=NOT_VERIFIED
SIGNED_UPLOAD_TOKEN_EXPIRY=SERVER_FIXED_NOT_CLIENT_CONFIGURABLE（时长 NOT_VERIFIED）

SERVER_STORAGE_SIGNING_CREDENTIAL_PRESENT=YES

CAN_PRIVILEGED_SERVER_CREATE_SIGNED_UPLOAD_WITH_ZERO_OBJECT_POLICIES=NOT_VERIFIED

SERVICE_ROLE_CLIENT_EXPOSED=NO
CLIENT_CAN_CHANGE_CANONICAL_PATH=NOT_VERIFIED（端点尚未实现；设计约束已定）

STORAGE_UPLOAD_CORS_ALLOWS_BROWSER_ORIGIN=YES（发布域 + 预览域；localhost=NO）
SIGNED_UPLOAD_TOKEN_REPLAYABLE=NOT_VERIFIED
SIGNED_UPLOAD_UPSERT_SEMANTICS=FIXED_AT_SIGNING_TIME（x-upsert 在签发阶段固化）
MIGRATION_SOURCE_BYTES_IN_SANDBOX=NO（1/64）

FLAT_RESIDUE_PRESERVED=YES

CODE_CHANGED=NO
DB_CHANGED=NO
STORAGE_OBJECTS_CHANGED=NO

SIGNED_UPLOAD_ARCHITECTURE=NOT_VERIFIED
FAILED_GATES=NONE_HARD_FAILED
NEXT_ACTION=见第五节
```

**一句话结论**：E 方案的平台能力、生产侧 SDK、路由、CORS、服务端签发凭据**全部到位**，没有任何一项硬失败；但**唯一且关键的未知**是「service_role 在 0 policies 下签发能否成功」，而闭合它**必然产生一行 `storage.objects` 记录**，因此按你第七节的规则，本轮正确地停在 capability audit。

---

## 二、逐项证据

### 2.1 `SIGNED_UPLOAD_API_PRESENT = YES`（直接证据，非类型、非推论）

生产侧 bundle（函数 `import ... from "https://esm.sh/@supabase/supabase-js@2"` 实际解析到的东西）：

```
GET https://esm.sh/@supabase/supabase-js@2
→ 200，首行注释 /* esm.sh - @supabase/supabase-js@2.115.0 */
GET https://esm.sh/@supabase/storage-js@2.115.0/es2022/storage-js.mjs
→ 200，23,221 bytes
   has_createSignedUploadUrl = true
   has_uploadToSignedUrl     = true
   has_upload_sign_route     = true   (/object/upload/sign/)
   has_download_sign_route   = true   (/object/sign/)
```

**生产侧版本 2.115.0 与本地 `node_modules` 完全一致**，所以本地静态分析可直推生产。实现体（esm.sh 压缩版原文）：

```js
async createSignedUploadUrl(t,e){
  let a=r._getFinalPath(t), n=c({},r.headers);
  e?.upsert && (n["x-upsert"]="true");
  let s=await f(r.fetch, `${r.url}/object/upload/sign/${a}`, {}, {headers:n}),
      o=new URL(r.url+s.url), u=o.searchParams.get("token");
  if(!u) throw new b("No token returned by API");
  return {signedUrl:o.toString(), path:t, token:u}
}
```

本地未压缩版同形（`dist/index.mjs`，110,833 bytes，sha256 前 16 位 `b5ce0c2f8aafd44d`），方法出现次数：`createSignedUploadUrl` 4、`uploadToSignedUrl` 3。

### 2.2 第五节担心的 download/upload 混淆 —— 有代码级依据，且已分清

| 用途 | 路由 | 证据 |
|---|---|---|
| signed **DOWNLOAD** | `/object/sign/{bucket}/{key}` | bundle 字面量 + `createSignedUrl` 实现传 `{expiresIn}` |
| signed **UPLOAD** | `/object/upload/sign/{bucket}/{key}` | bundle 字面量 + `createSignedUploadUrl` 实现 |

SDK 官方 JSDoc 示例本身就是嵌套路径：
`https://example.supabase.co/storage/v1/object/upload/sign/avatars/folder/cat.jpg?token=<TOKEN>`

⇒ 上一轮探到的 `/object/sign/{key}` 确实是 **download**，不能拿它当 upload 可用的证据。你第五节这条要求是对的。

### 2.3 网关活体探测（anon key，零对象产生）

| 探针 | status | 响应 | 判读 |
|---|---|---|---|
| `POST /object/upload/sign/{bucket}/{canonical_nested_key}` | 400 | 包络 `{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}` | **路由存在**；签发动作会 INSERT `storage.objects`；被拦原因是 **RLS 身份**，不是 path 非法 |
| `PUT /object/upload/sign/{bucket}/{canonical}?token=***` | 400 | `{"statusCode":"400","message":"querystring/token must be string"}` | **上传路由存在**且在校验 token 参数 |
| `GET /object/sign/{bucket}/{canonical}` | 400 | `querystring must have required property 'token'` | download 签发/读取路由存在 |
| `POST /object/upload/sign/{bucket}/__route_probe__.png` | 400 | 同 RLS 签名 | 与 nested key 同签名 ⇒ **path 形状不是拒绝原因** |

**关键推论**：nested canonical path 的请求走到了 **INSERT 阶段**才被 RLS 拦，说明网关**已接受该 path 形状**。这是 `SIGNED_UPLOAD_NESTED_PATH_SUPPORTED=ROUTE_LAYER_YES` 的依据。但「接受形状」≠「写入会成功」，端到端仍 `NOT_VERIFIED`。

### 2.4 ⚠️ CONTROL 组推翻了我上一轮的一个推断（方法论修正）

| 探针 | status | 响应 |
|---|---|---|
| `/storage/v1/object/__no_such_route__/x.png` | 400 | `{"statusCode":"404","error":"Bucket not found"}` |
| `/storage/v1/object/__no_such_bucket__/x.png` | 400 | 同上，**76 bytes 完全一致** |
| `/storage/v1/object/public/merchant-assets/icon-back.png` | 400 | 同上 |
| `/storage/v1/object/public/__no_such_bucket__/x.png` | 400 | 同上 |
| `/storage/v1/zzz/qqq`（脱离 storage 路由前缀） | 404 | `{"message":"Route GET:/zzz/qqq not found"}` |

⇒ **`Bucket not found` 是 storage-api 的通用兜底签名，区分力为零**：它对「路由不存在」「桶不存在」「私有桶走 public 路径」返回**逐字节相同**的响应。只有完全脱离 `/storage/v1` 前缀才得到 Fastify 的 `Route not found`。

**因此我上一轮写的「`public=false` 的桶在公开路径上不被承认存在，比预期更强」是过度推断，现予撤回。** 安全结论本身不变（公开路径确实拿不到私有桶字节，本轮与上一轮共 4 次探测一致），但**推理强度从「桶不被承认存在」下调为「该请求未匹配到可用桶」**。AGENTS.md 对应条目已同步修正。

同时这条 control 也校准了判据：**只有 `Route ... not found`（Fastify 层）才能证明路由不存在；`Bucket not found` 不能。**

### 2.5 `STORAGE_UPLOAD_CORS_ALLOWS_BROWSER_ORIGIN = YES`（你补的门禁，结果最好）

`OPTIONS` 预检，`Access-Control-Request-Method: PUT`、`Request-Headers: content-type,x-upsert,authorization,apikey`：

| Origin | status | allow-origin | allow-methods | allow-credentials |
|---|---|---|---|---|
| `https://asmhysidbg5g.meoo.pub`（发布域） | 200 | 精确回显 | 含 **PUT** | true |
| `https://3015-asmhysidbg5g.sandbox.meoo.host` | 200 | 精确回显 | 含 PUT | true |
| `https://asmhysidbg5g-3015.sandbox.meoo.host` | 200 | 精确回显 | 含 PUT | true |
| `https://3015.sandbox.meoo.host` | 200 | 精确回显 | 含 PUT | true |
| `http://localhost:3015` | **403** | 无 | — | — |
| `https://example.invalid` | **403** | 无 | — | — |

`allow-headers` 精确回显 `content-type,x-upsert,authorization,apikey` —— **浏览器直传所需的头全部放行**。

三点判读：
1. **不是 `ACAO: *` 配凭据**，而是精确回显 + `allow-credentials: true` ⇒ 符合你第十九节的安全要求
2. `localhost` 被拒 ⇒ **本地开发环境无法直传 Storage**，E2E 只能在预览域或发布域做（与 Edge Function CORS 规则一致）
3. ⚠️ **三个 sandbox 预览域候选形状全部放行** ⇒ 白名单是 `*.sandbox.meoo.host` 级别的宽匹配，不是精确匹配。含义：同平台其他项目的预览页也能对本项目 Storage 路由发起带凭据的跨源请求。这是**平台既有配置，非本轮引入**；实际可利用性低（anon 无 policy、商户 token 是 opaque 且需 Cookie）。但要注意真正的风险不在 CORS：**signed upload URL 的 token 在 URL query 里，任何拿到该 URL 的人都能上传** —— 这必须靠「token 只经 HTTPS 返回给已鉴权的 operator 浏览器、不落日志、不落库」来控制。

### 2.6 `SERVER_STORAGE_SIGNING_CREDENTIAL_PRESENT = YES`（上一轮已定案，本轮复核）

- `functions/privlan-merchant-api/index.ts:320-323`：`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` → `createClient(url, key, {auth:{persistSession:false, autoRefreshToken:false}})`
- 函数环境变量清单含该 secret 名（**只查名，未读取值、未打印值**）
- `src/lib/supabase.ts:5,7`：前端只用 `VITE_SUPABASE_ANON_KEY` ⇒ `SERVICE_ROLE_CLIENT_EXPOSED = NO`
- 「未进入 response / 未进入 logs」由既有 47 项测试断言 + `logEvent` 字段白名单覆盖

⇒ 你第 254-256 行「若 NO 则立即停止该分支」**不触发**。

### 2.7 `CAN_PRIVILEGED_SERVER_CREATE_SIGNED_UPLOAD_WITH_ZERO_OBJECT_POLICIES = NOT_VERIFIED`

**支持 YES 的间接证据（两条，都强）**：
1. SDK 官方 JSDoc 对 `uploadToSignedUrl` 明写：`RLS policy permissions required: buckets table permissions: none; objects table permissions: none`
2. anon 签发被拦的原因是 `new row violates row-level security policy`（RLS 身份问题），而 service_role 在 Supabase 语义下 BYPASSRLS；本项目 admin 角色实测 `rolbypassrls=true`

**为什么仍不写 YES**：这两条都是推论。真实签发一次才能定案，而你第 276 行明确要求「不要根据通用 Supabase 知识直接修改 RLS」、第 447 行要求「不要把 NOT_VERIFIED 写成 NO」—— 同理我也不把推论写成 YES。

### 2.8 token 语义（你补的两项）

| 项 | 结论 | 依据 |
|---|---|---|
| `SIGNED_UPLOAD_TOKEN_EXPIRY` | **服务端固定，客户端不可指定**；时长 NOT_VERIFIED | `createSignedUploadUrl(path, options)` 的 options **只处理 `upsert`**，无 `expiresIn`；对比 `createSignedUrl`（download）明确传 `{expiresIn}`。bundle 内 `expiresIn` 6 次出现全部属于 download 路径 |
| `SIGNED_UPLOAD_UPSERT_SEMANTICS` | **在签发阶段固化** | 实现里 `e?.upsert && (n["x-upsert"]="true")` 发生在**签发请求的 header** 上，不是上传时 ⇒ 签发端点必须显式决定 upsert，迁移场景应固定 `upsert=false` 以防覆盖已迁移素材 |
| `SIGNED_UPLOAD_TOKEN_PATH_BOUND` | NOT_VERIFIED | 路由形状把 path 放在 URL 里、token 在 query，服务端**必然要**校验绑定，否则 token 可跨 path 重用 —— 但这是推断，未实测 |
| `SIGNED_UPLOAD_TOKEN_REPLAYABLE` | NOT_VERIFIED | 需真实签发 + 两次使用同一 token 才能定案；本轮禁止 |

**另一个实现差异（会影响前端写法）**：`uploadToSignedUrl` 的 body 构造是 `new FormData()` 或 `fileBody`，bundle 内 `mentions_arraybuffer=false`、`mentions_blob=true`、`mentions_formdata=true`。而平台 storage.md 要求「前端上传必须 ArrayBuffer」—— **那条规则是针对 `supabase.storage.upload`，不适用于 `uploadToSignedUrl`**。将来实现时不能照搬 ArrayBuffer 口径，需按 `uploadToSignedUrl` 的实际 body 语义写，并单独验证。

### 2.9 `MIGRATION_SOURCE_BYTES_IN_SANDBOX = NO`（1/64）

`/home/user-files` 实测只有 `icon-back.png` 一个真实素材字节，其余 63 个只有 MANIFEST 声明（`FEELDAO_PRIVLAN_FINAL_MIGRATION_MANIFEST.json` 等），**字节从未进入沙箱**。

⇒ 浏览器直传要求**用户在浏览器里选本地文件** ⇒ 需要上传 UI ⇒ 而上传 UI 属于「改前端代码」，本轮禁止。
⇒ **即使 E 全部 PASS，64 文件迁移仍需一轮专门的「operator 上传界面 + 身份校验」工作**，不是签发端点 alone 能完成。这条必须提前写进路线，否则 E PASS 后会立刻卡住。
⇒ 另：64 个里有 27.26MiB 的 GIF，signed upload 的大小上限取决于 bucket `file_size_limit`（当前 NULL）与网关限制，**不是**面板那个 50MB ⇒ `SIGNED_UPLOAD_MAX_BYTES = NOT_VERIFIED`。

---

## 三、安全模型验收（第六节）

```
SIGNED_UPLOAD_SCOPE_MODEL=CANDIDATE（operator session → membership → tenant/workspace → server 派生；端点未实现）
SERVICE_ROLE_CLIENT_EXPOSED=NO
CLIENT_CAN_CHANGE_CANONICAL_PATH=NOT_VERIFIED
```

设计约束（按你的修正，签发端点挂 **operator session** 而非 merchant session）：
- canonical path 只能由服务端从 operator 会话派生，浏览器传入的 tenantId/workspaceId 仅作 conflict probe（复用现有 `assertScopeNotOverridden` 模式）
- 签发时固定 `upsert=false`
- token 只经 HTTPS 返回给已鉴权的 operator 浏览器；**不落 `logEvent`、不落库、不进 response 之外的任何通道**
- 迁移期端点不向商户会话开放 —— 商户自助上传留待 Merchant Upload Architecture 单独立项

现有 `/mp-images` resolver 已用 47 项测试证明「canonical key 只由 session 派生、浏览器参数不参与拼装」，同一模式可直接复用到签发端点。

---

## 四、本轮副作用复核（全部为零）

```
storage.objects 行数      = 1（仍是上一轮面板上传的 flat residue，all_names='icon-back.png'）
storage.objects 策略数    = 0（未加任何 RLS policy）
storage.buckets 数        = 1（未建新桶）
merchant-assets.public    = false（仍 PRIVATE；查询返回的是 public 列值 false）
public.assets             = 65（未动）
public.audit_events       = 202（未动）
前端代码                  = 未改（src/lib/supabase.ts 等零改动）
函数代码                  = 未改、未重新部署（线上仍 v6）
Auth schema               = 未动
Production                = 未触碰
service_role 值           = 未读取、未打印（只查环境变量名清单）
CODE_CHANGED=NO  DB_CHANGED=NO  STORAGE_OBJECTS_CHANGED=NO  FLAT_RESIDUE_PRESERVED=YES
```

`pnpm run build` PASS，预览正常运行。新增文件仅两个取证脚本（`tmp/` 下，非业务代码）。

---

## 五、`SIGNED_UPLOAD_ARCHITECTURE = NOT_VERIFIED` 的精确含义与 NEXT_ACTION

按你第 431-445 行的判定规则逐档核对：

| 档位 | 是否成立 | 原因 |
|---|---|---|
| `VIABLE` | **否** | 要求「平台能力、签发身份、nested path、安全边界**全部**有实际依据」；nested path 端到端与 0-policy 签发仍是 NOT_VERIFIED |
| `NOT_SUPPORTED` | **否** | 路由、API、CORS 全部实测存在且放行，无任何硬失败 |
| `BLOCKED_ON_SERVER_CREDENTIAL` | **否** | 凭据 = YES |
| `NOT_VERIFIED` | **是** | 唯一未闭合项见下 |

**唯一未闭合项**：`CAN_PRIVILEGED_SERVER_CREATE_SIGNED_UPLOAD_WITH_ZERO_OBJECT_POLICIES`

**为什么本轮不去闭合它（这是本轮最重要的判断）**：
从 anon 签发的错误签名 `new row violates row-level security policy` 可知，**`createSignedUploadUrl` 的动作本身就会 INSERT 一行 `storage.objects`**（Supabase 在签发时预创建对象记录，上传时再填字节）。

⇒ **「签发但不使用 token」并不是零写入**：service_role 签发成功会留下一行对象记录（很可能是 0 字节或 pending 状态），而沙箱**无法用 SQL 清理**（`42501 Direct deletion from storage tables is not allowed`），只能由你在面板删。

⇒ 这正好命中你第 364-365 行的规则：**「不能做到无写入验证时，停在 capability audit」**。所以本轮不部署签发探针是正确的，不是保守。

**NEXT_ACTION（三选一，交回你裁决，我不自动执行）**：

- **E1（推荐）**：授权一次**受控签发探针**。我会新增一个只接受 operator 会话的端点，签发 canonical path 的 upload token，**只在服务端判断是否成功、立即丢弃 token、绝不返回给任何客户端、绝不上传**，然后回报 `issued=YES/NO` 与 `storage.objects` 的行数变化。代价：① 需部署 v7（覆盖 v6 不可逆，回滚基线 `archive/privlan-merchant-api/index.v5.ts` 与当前 v6 源码）；② **会在 `storage.objects` 留下 1 行残留**，需你事后在面板删除。收益：把最后两个 NOT_VERIFIED 一次性转为事实。
- **E2**：先不探针，直接按 E 架构实现完整迁移端点 + operator 上传界面，在真实迁移第一个文件时顺带定案。代价：把「能力未知」推迟到「已有实现」之后，若签发失败则实现白做。
- **D**：走 one-shot admin migration（你本地持凭据直传 nested key）。按你第 462-470 行，密钥不进聊天、我只给命令模板。注意：D 同样会遇到「签发/直传需要 service_role」这一点，但你本地持有凭据时不受沙箱限制。

**无论选哪个，都绕不过的两件事**：
1. 真人 operator/merchant 会话 —— `CLIENT_CAN_CHANGE_CANONICAL_PATH` 与「Deno 读 PRIVATE Storage 是否被网关放行」只能在真人会话下闭合
2. 63 个素材的源字节仍在沙箱外 —— 需要 operator 上传界面或由你本地直传
