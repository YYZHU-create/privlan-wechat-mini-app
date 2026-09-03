# PrivLan WeChat Mini App

PRIVLAN 的微信小程序、云函数和本地运营后台。小程序包含首页、分类、商品详情、购物车、会员中心、预约、预约记录、客服与活动页面；云函数负责微信身份、预约、提醒、量体资料和客服数据；`admin/` 提供本地内容与生成工具。

## 项目记忆

新环境或新 Codex 会话应先读取 [AGENTS.md](./AGENTS.md)，再按其中顺序阅读：

- [当前状态](./docs/PROJECT_STATE.md)
- [当前架构](./docs/ARCHITECTURE.md)
- [重要决策](./docs/DECISIONS.md)
- [阶段路线图](./docs/ROADMAP.md)
- [下一步](./docs/NEXT_STEPS.md)

这些文件是跨电脑、跨会话的项目上下文；详细历史仍以 Git 为准。

## 目录

- `pages/`：小程序页面。
- `components/`、`custom-tab-bar/`：共享组件与自定义导航。
- `cloudfunctions/`：微信云开发函数；部署要求见 `cloudfunctions/README.md`。
- `admin/`：本地 Express 运营后台、同步/生成工具和 Node 测试。
- `platform/`：平台数据契约与数据库参考。
- `images/`、`design-assets/`：产品和设计资源。

## 小程序开发

1. 在微信开发者工具中导入仓库根目录。
2. 使用本机的 `project.private.config.json` 保存个人开发工具设置；该文件不能提交。
3. 按 `cloudfunctions/README.md` 创建集合、配置云函数环境变量并部署所需云函数。
4. 正式发布前配置业务域名、手机号授权、客服能力、订阅消息模板和生产认证模式。

开发工具中的 `urlCheck=false` 不能替代微信公众平台的生产域名配置。开发版二维码也不等于已上传、审核或发布。

## 运营后台

```powershell
cd admin
npm ci
npm test
npm start
```

默认运行方式和端口以 `admin/server.js` 与本机配置为准。AI 网关和第三方服务凭据只允许放在本地 `.env` 或部署平台的 Secret/环境变量中。

## 验证

- 后台测试：`cd admin && npm test`
- JavaScript 语法检查：对 `git ls-files "*.js"` 返回的文件运行 `node --check`。
- 微信端交互、授权、预约、提醒和真机能力必须在微信开发者工具及测试设备上做人工验证。

## 跨电脑工作

开始前执行 `git fetch` 和 `git pull --ff-only`。每台电脑使用独立任务分支；切换电脑前完成测试、提交并推送。不得通过 Git 同步 `.env`、私钥、Token、个人微信开发工具配置或本地日志。
