# Woe

Gotify 兼容的自托管通知服务，运行在 Cloudflare Workers，提供消息 API、WebSocket、Web UI、用户/应用/客户端与插件管理。

## 公开范围

本版内置 **displayer** 和 **Webhooker**。AI Tagger 与厂商移动推送插件不包含在公开包中；相关专用配置表单和消息操作入口也不提供。通用插件任务、Secret、配额、标签、AI provider/runtime 及推送可靠性框架保留为源码扩展能力，不代表默认已启用 AI 或移动推送。

插件为随 Worker 编译的静态源码，没有上传或运行时安装入口。Webhooker 经独立 Plugin Jobs Queue 异步尽力投递，只由 message.create 触发，最多三次尝试，可能重复投递；不提供手动重投入口。displayer 通过 GET /plugin/{id}/display 返回展示内容。

## 部署与升级

完整步骤见 [部署指南](DEPLOY.md)，英文见 [English deployment guide](DEPLOY.en.md)。

需要 Node.js ≥22.12、Cloudflare 账号、D1、R2、Images、Durable Object，以及 Webhooker 的 Plugin Jobs Queue 与插件主密钥。

```bash
npm ci
npm --prefix frontend ci
npx wrangler login
cp example.wrangler.toml wrangler.toml
# 先按 DEPLOY 创建资源、修改实际 ID/域名并设置 Secrets
npm run build:frontend
npm run deploy
```

默认公开功能不需要 Workers AI、QUOTA_KV 或推送队列（PUSH_QUEUE）。若自行接入声明配额或 AI provider 的任务插件，按其契约恢复对应绑定。不要把完整版模板中的所有能力误认为公开包已提供。

## 首次初始化与认证

部署不会自动创建日常管理员。DEFAULT_ADMIN_USER（默认 admin）与 Secret DEFAULT_ADMIN_PASSWORD 只授权首次初始化；打开 /setup，填写引导凭据，再设置实际管理员账户。详见 [初始化管理员](DEPLOY.md#5-初始化管理员)。引导凭据不能用于日常登录；实际管理员不要同时使用与引导凭据完全相同的用户名和密码。

Basic 用于用户管理、提权与初始化。Application Token 用于发消息，Client Token 用于客户端与 /stream；Bearer 与 X-Gotify-Key 均受支持。新 token 的完整凭据只在创建/应用轮换响应中返回；应用列表不返回 token，详情返回存储形态（增强 token 为公钥形态）。

消息 priority 接受安全整数并保留原值；Web UI 按低≤0、普通1、高2、紧急≥3展示，手动控件提供0–3四档。缺省或 JSON null 使用应用默认值。

## 运维注意

Webhooker 保存配置需要 PLUGIN_SECRET_MASTER_KEY，包括未填写 authToken 的配置。升级保留既有主密钥及版本，不要重新生成。新请求成功不等于 Webhook 已送达，应核对 job 状态和下游结果。

新增插件不自动授权给非管理员用户；配置保存后还需启用。默认出站采用 HTTPS 与静态私网地址限制；Webhooker 放宽策略、secret 掩码和升级/回滚步骤见部署指南。

## License

[GPL-3.0-only](LICENSE)
