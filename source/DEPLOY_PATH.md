# source/index.ts 的落点绑定

```
DEPLOYABLE_PATH=functions/privlan-merchant-api/index.ts
EDGE_FUNCTION_NAME=privlan-merchant-api
CANDIDATE=v12
SHA256=0010ca398495fb2e06ae5b6b13032f241ef80dbed1c342fcd0d4ec2301defa55
SIZE_BYTES=99193
LINE_COUNT=2390
```

本文件与 `functions/privlan-merchant-api/index.ts` 是同一份字节（复制后已复算 sha256 相等）。
链路的四段同一性依赖它：

```
TESTED_SOURCE = ARCHIVED_SOURCE = HANDOFF_SOURCE = FUTURE_DEPLOY_SOURCE
```

部署时**必须**直接取本文件（或 archive/v12/index.ts）落到 `functions/privlan-merchant-api/index.ts`，
不得在外部环境重新格式化、重新排版或"顺手修一下"任何字符 —— 一旦 sha256 变了，本包的全部证据即失效。
