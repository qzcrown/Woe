# Woe

Gotify 兼容的自托管通知服务，运行在 Cloudflare Workers，提供消息 API、WebSocket、Web UI、用户/应用/客户端与插件管理。

## 部署与升级

完整步骤见 [部署指南](DEPLOY.md)，英文见 [English deployment guide](DEPLOY.en.md)。

需要 Node.js ≥22.12、Cloudflare 账号、D1、R2、KV（配额覆盖存储 QUOTA_KV）、Images、Durable Object，以及 Webhooker 的 Plugin Jobs Queue 与插件主密钥。

```bash
npm ci
npm --prefix frontend ci
npx wrangler login
cp resources.json wrangler.resources.json
# 先按 DEPLOY 修改 wrangler.resources.json 中的实际资源 ID/名称并设置 Secrets
npm run build:frontend
npm run deploy
```

部署不经由手写 `wrangler.toml`：`npm run wrangler -- <command>` 会按目标环境生成 `wrangler.generated.json` 后调用官方 Wrangler；`template.toml` 是按当前包集合确定性生成的只读示意（`node scripts/plugins/renderWranglerExample.mjs --check` 防漂移）。资源 ID/名称等运维参数集中在 `wrangler.resources.json`。

默认部署需要 QUOTA_KV 作为配额覆盖存储；如启用声明 AI provider 能力的插件，按其契约补齐绑定。

## 首次初始化与认证

部署不会自动创建日常管理员。DEFAULT_ADMIN_USER（默认 admin）与 Secret DEFAULT_ADMIN_PASSWORD 只授权首次初始化；打开 /setup，填写引导凭据，再设置实际管理员账户。详见 [初始化管理员](DEPLOY.md#5-初始化管理员)。引导凭据不能用于日常登录；实际管理员不要同时使用与引导凭据完全相同的用户名和密码。

Basic 用于用户管理、提权与初始化。Application Token 用于发消息，Client Token 用于客户端与 /stream；Bearer 与 X-Gotify-Key 均受支持。新 token 的完整凭据只在创建/应用轮换响应中返回；应用列表不返回 token，详情返回存储形态（增强 token 为公钥形态）。

消息 priority 接受安全整数并保留原值；Web UI 按低≤0、普通1、高2、紧急≥3展示，手动控件提供0–3四档。缺省或 JSON null 使用应用默认值。

## 运维注意

Webhooker 保存配置需要 PLUGIN_SECRET_MASTER_KEY，包括未填写 authToken 的配置。升级保留既有主密钥及版本，不要重新生成。新请求成功不等于 Webhook 已送达，应核对 job 状态和下游结果。

新增插件不自动授权给非管理员用户；配置保存后还需启用。默认出站采用 HTTPS 与静态私网地址限制；Webhooker 放宽策略、secret 掩码和升级/回滚步骤见部署指南。

## License

[GPL-3.0-only](LICENSE)
