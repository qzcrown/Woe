# Woe

A self-hosted Gotify-compatible notification service on Cloudflare Workers, with message APIs, WebSocket streaming, a Web UI, and user/application/client/plugin management.

## Public scope

This build includes **displayer** and **Webhooker**. AI Tagger and vendor mobile-push plugins, their dedicated forms and message actions are excluded. Generic plugin jobs, secrets, quotas, tags, AI provider/runtime and push reliability code remain source extension points; they do not enable AI or mobile push by default.

Plugins are statically compiled source, with no upload or runtime installation endpoint. Webhooker delivers asynchronously through a separate Plugin Jobs Queue, only from message.create, with at most three attempts and possible duplicate delivery. It has no manual redelivery endpoint. Displayer returns display content through GET /plugin/{id}/display.

## Deployment and upgrades

Follow the [English deployment guide](DEPLOY.en.md) or [中文部署指南](DEPLOY.md).

Use Node.js ≥22.12, a Cloudflare account, D1, R2, Images, a Durable Object, and the Plugin Jobs Queue and master key required by Webhooker.

```bash
npm ci
npm --prefix frontend ci
npx wrangler login
cp example.wrangler.toml wrangler.toml
# Create resources, replace IDs/routes and set Secrets as described in DEPLOY.en.md
npm run build:frontend
npm run deploy
```

Default functionality needs no Workers AI, QUOTA_KV or push queue (PUSH_QUEUE). Add bindings only when implementing an extension that declares the corresponding capabilities. Retained framework code does not mean every full-source plugin is available.

## Initialization and authentication

Deployment does not create an everyday administrator. DEFAULT_ADMIN_USER (default admin) and the DEFAULT_ADMIN_PASSWORD Secret only authorize first initialization. Open /setup, enter bootstrap credentials and create the actual administrator. See [Initialize the administrator](DEPLOY.en.md#5-initialize-the-administrator). Bootstrap credentials cannot sign in normally; do not use both the same username and password for the actual administrator.

Basic authenticates user management, elevation and initialization. Application tokens send messages; client tokens authenticate clients and /stream. Bearer and X-Gotify-Key are supported. Full new credentials are returned only on creation or application rotation; application lists omit tokens and detail returns the stored form (the public form for enhanced tokens).

Priority preserves safe integers. The UI groups low≤0, normal1, high2 and urgent≥3; manual controls offer 0–3. Missing values or JSON null use the application's default.

## Operations

Saving Webhooker configuration requires PLUGIN_SECRET_MASTER_KEY even without authToken. Retain the existing master key and version across upgrades. A successful message request does not prove Webhook delivery: inspect jobs and the downstream receiver.

Non-administrator users need plugin permission, and instances need saved configuration and explicit enablement. Outbound requests default to HTTPS with static private-address checks; see the guide for DNS limitations. See the deployment guide for policy overrides, masked secrets, upgrades and rollback.

## License

[GPL-3.0-only](LICENSE)
