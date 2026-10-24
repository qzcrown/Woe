# Woe 部署指南

本指南对应当前版本源码。请在实际目标版本源码根执行命令。

## 1. 创建资源

前置：Node.js ≥22.12、Cloudflare 账号，以及该账号可使用的 Workers/D1/R2/Queues/Images/SQLite-backed Durable Objects 配额。

```bash
npm ci
npm --prefix frontend ci
npx wrangler login
npx wrangler d1 create woe-db
npx wrangler r2 bucket create woe-storage
npx wrangler queues create woe-plugin-jobs
```

记录 D1 UUID。首次部署会按 DO 的 [[migrations]] 创建 MessageStreamHubObject，无需手工创建。Images 使用 Worker binding，不需创建 Images 图片存储资源。

## 2. 配置 wrangler.toml

```bash
cp example.wrangler.toml wrangler.toml
```

必改 database_id 为真实 UUID，bucket_name 与实际 R2 桶一致；选择 workers_dev=true 或配置 [[routes]] 自定义域名。默认模板未开放 workers.dev，不能同时不配置路由。

模板保留 DB/R2/IMAGES/ASSETS/MESSAGE_STREAM_HUB，以及 Webhooker 所需的 PLUGIN_JOB_QUEUE producer/consumer。队列参数 max_batch_size=1、max_retries=2、max_concurrency=1：首次加两次重试共三次尝试。并发限制不保证投递顺序或恰好一次。

队列默认名 woe-plugin-jobs；若改名，producer、consumer 和 [vars].PLUGIN_JOB_QUEUE_NAME 必须同步。名称不匹配会在未知队列分支被确认丢弃。当前默认功能不需要 Workers AI（AI binding）、QUOTA_KV 或推送队列（PUSH_QUEUE）；若以后扩展任务/配额/provider，再按其声明补齐资源和对应队列名变量。

REGISTRATION 默认 false。保留模板的 SQL 文本模块 rules、DO 迁移历史与 cron；daily cron 清理创建已超30天的终态 Plugin Jobs，将未终态且创建已超24h的 pending 标为 dead，不兜底补发 Job Queue。通用 push core 和历史表仍保留。

## 3. 设置 Secrets

首次设置：

```bash
npx wrangler secret put DEFAULT_ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put PLUGIN_SECRET_MASTER_KEY
```

引导密码需强随机，拒绝 password/admin/123456。插件主密钥必须是 base64 编码32字节；PLUGIN_SECRET_KEY_VERSION 是 [vars] 中的正整数元数据，默认 "1"。保存 Webhooker 配置时即校验主密钥，即使未填写 authToken。

升级必须复用既有主密钥与版本，不能重复生成。若确需更换主密钥，必须同时提升 PLUGIN_SECRET_KEY_VERSION，并让用户重新输入真实 authToken；旧密文不能靠改版本恢复，*** 不能作为新凭据。Secrets 不写 [vars]、Git 或日志。

本地开发把独立测试的 DEFAULT_ADMIN_PASSWORD/PLUGIN_SECRET_MASTER_KEY 写入被忽略的根 .dev.vars；它不会自动同步到云端。

## 4. 构建与部署

```bash
npm run build:frontend
npx wrangler deploy --dry-run
npm run deploy
```

build:frontend 含类型检查并输出根 public/；deploy 刷新 buildInfo 后部署，但不自动重建前端。裸 npx wrangler deploy 不会刷新 buildInfo。dry-run 只验证打包/配置解析，不创建或验收真实资源。

Worker 首次 HTTP 请求自动执行固定 0000_initial_schema 与后续增量迁移（包括0013_plugin_jobs）。空库无需 db:push 或手工导入基线；迁移失败返回503 DATABASE_MIGRATION_FAILED，详细原因在 Worker 日志。禁止删除 _migrations 或重复灌入基线解决不一致库。

## 5. 初始化管理员

部署不会自动创建日常管理员。DEFAULT_ADMIN_USER（默认admin）与步骤3的引导密码只用于授权初始化。

打开 /setup，先填写引导用户名/密码，再设置实际管理员用户名和独立强密码，完成后用实际账户登录。不要让用户名和密码同时与引导凭据完全相同；相同用户名、不同密码可用。初始化一次成功后不能重放，修改引导变量不会更改已有账户。

API 等价流程（请替换占位符）：

```bash
curl -u '<DEFAULT_ADMIN_USER>:<DEFAULT_ADMIN_PASSWORD>' -X POST 'https://<your-domain>/api/v1/init/admin' \
  -H 'Content-Type: application/json' -d '{"name":"woe-owner","pass":"<独立的管理员强密码>"}'
```

API 只检查用户名/密码非空，请自行使用强密码。Web UI 要求至少8字符。

## 6. 配置与验证 Webhooker

管理员默认有插件权限。非管理员由管理员用 PUT /user/<userId>/plugin-permissions 授权，body为 {"modulePaths":["builtin/webhooker","builtin/displayer"]}；该请求替换该用户的授权列表，先读取现有列表再合并。

浏览器创建 Webhooker 实例，保存 YAML 并启用。最小配置：

```yaml
targetUrl: https://example.com/webhook  # 替换为实际已验证的接收端
method: POST
timeoutMs: 5000
# 首次需要 Bearer 时输入真实值；平台加密存储，GET 读取配置时返回掩码：
# authToken: '<接收端凭据>'
```

不用认证可省略 authToken。GET 读取配置返回 authToken 掩码；再次保存时保留 `authToken: "***"` 表示沿用已有密文，不得作为首次凭据。删除 authToken 字段或设为 null / 空字符串会清除已存凭据；输入真实新值则替换。旧 headers.Authorization 明文兼容，但不得与 authToken 并存，且不受 authToken 的掩码和加密保护；建议改用加密字段。默认 body 包含 pluginId/userId/event/message/at，message 内含 appId；应用名称等信息可用自定义 body 模板添加。不要把真实正文、密钥或完整 YAML 提交到 Git。

先查 /api/v1/health、/api/v1/version；使用 app token POST /api/v1/message，记录 messageId；用属主 Basic 或 client token GET /api/v1/message/<messageId>/jobs?pluginId=<pluginId> 检查状态，并确认接收端真实收到请求。status=success 才表示任务成功；消息创建成功、已建job或已入队都不代表已送达。

Webhooker 只能由 message.create 事件触发；POST /message/<messageId>/jobs 对它返回 409 Conflict（内部拒绝原因为 plugin-unavailable，HTTP 响应不提供该 code 字段），不能用来手动重投。可能重复外发，接收端应按业务需要处理重复请求；不可宣称恰好一次。

默认仅允许 HTTPS，静态阻断可识别的私网/环回地址与主机名，拒绝 userinfo/fragment、路径遍历和自动跟随重定向；Webhooker 支持 query。该检查不预解析 DNS，不能防止 DNS rebinding；应使用自己信任并核对解析结果的接收域名。确需可信内网目标时由部署者设置 WEBHOOKER_ALLOW_HTTP / WEBHOOKER_ALLOW_PRIVATE_NETWORK 为字符串 "true"（大小写不敏感），前者允许HTTP，后者允许私网；改值需重部署。1/yes/on均不生效，其他限制仍强制。

并行验证 client token WebSocket 收到同ID消息、displayer启停/展示、浏览器登录与图标上传/读取/删除。displayer没有消息事件日志，空日志正常。真实Queue/D1/HTTP和浏览器结果应单独记录，不能用单测或dry-run替代。

## 7. 升级与回滚

```bash
git fetch --tags
release_tag=vX.Y.Z  # 替换为实际发布的公开tag
git switch --detach "$release_tag"
npx wrangler d1 export woe-db --remote --output ../woe-before-upgrade.sql
npm ci
npm --prefix frontend ci
npm run build:frontend
npm run deploy
```

部署前逐段合并新模板，保留原DB/R2、DO迁移、路由、Secrets及cron。由旧displayer版升级，需创建Plugin Jobs Queue并设置插件主密钥，再创建/授权/配置/启用Webhooker；不会自动建立实例。旧同步Webhooker升级后变为异步尽力投递，URL/空YAML/字段类型校验更严格，需测试下游兼容。

未包含插件的配置行不自动删除，实例不可加载。旧push_outbox/队列不自动清空：没有provider时有效pending可持续挂起；需保留待恢复或经过审阅人工终止，不能误称自动清理。保留迁移链与设备兼容字段，不自动删历史数据。

回滚不回退schema。先停用任务入口并处理积压，避免新异步任务与旧同步插件重复外发；保留原主密钥。核对旧版本对新schema/密文/口令哈希的兼容，不要删除迁移记录或重生成密钥来回滚。

## 8. 故障排查

| 现象 | 检查 |
|---|---|
| 保存配置503 secret-key-unavailable | 主密钥是否存在且base64解码为32字节，版本是否正整数 |
| 保存配置409 secret-reentry-required | 密钥版本变化后需重新输入真实authToken，不能保留旧掩码 |
| job error.code=secret-decrypt-failed | 已存密文无法用当前主密钥解密；核对原密钥，或重输真实authToken |
| 消息成功但无job | 插件权限、enabled、filter、保存配置和入队拒绝日志 |
| job failed / enqueue-send-failed | PLUGIN_JOB_QUEUE绑定/名称；cron不补发 |
| outbound-blocked | 目标URL与部署出站策略；不要用重定向绕过 |
| pending长时间不动 | Queue consumer、实际队列名和Worker日志；不要只看producer |
| 数据库503 | 日志与_migrations/sqlite_master，先备份并检查结构 |
| 前端旧页面或404 | 重建public/后部署；检查ASSETS与域名路由 |

GET /message/<id>/jobs 返回状态/错误/结果，不暴露任务payload。任务快照可能含业务内容，随终态保留策略清理；备份按敏感数据保存。
