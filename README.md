# Woe

Woe 是一个基于 Cloudflare Workers 的 Gotify 服务端实现，提供简单、可靠的通知推送服务。

## What's New

- 🔔 **浏览器通知支持** - 支持在浏览器中接收桌面通知
- 🗄️ **Drizzle ORM 集成** - 更好的数据库管理和迁移支持
- ✉️ **前端发送通知** - Web UI 支持直接发送测试通知
- 🔒 **安全性改进** - 修复用户状态字段问题

## 特性

- 🚀 基于 Cloudflare Workers，全球部署，自动扩展
- 📱 Gotify v2.0.2 兼容，支持现有客户端
- 🔐 灵活的认证机制，支持多种令牌类型
- 📨 实时消息推送，WebSocket 支持
- 🔌 插件系统，支持功能扩展
- 🖼️ 图片存储支持（Cloudflare R2）
- 🌐 现代化 Web UI - 基于 Vue 3，支持中英文

## 快速开始

### 前置要求

- Cloudflare 账户
- Node.js 18+
- Wrangler CLI

### 部署

```bash
# 1. 克隆仓库
git clone https://github.com/qzcrown/woe.git && cd woe

# 2. 安装依赖
npm install && npm run setup:frontend

# 3. 登录 Cloudflare 并创建资源
wrangler login
wrangler d1 create woe-db      # 记录输出的 database_id
wrangler r2 bucket create woe-storage

# 4. 配置
cp example.wrangler.toml wrangler.toml
# 编辑 wrangler.toml，替换 database_id 为实际值

# 5. 构建并部署
npm run build:frontend
npm run deploy
```

详细配置请参考 [example.wrangler.toml](example.wrangler.toml)。

## 基本使用

### Web UI

部署完成后访问 Worker 域名，使用默认凭据登录：

- 用户名：`admin`
- 密码：`password`
- 登录后请立即修改默认密码

### API

```bash
# 创建应用
curl -X POST https://your-domain.workers.dev/application \
  -H "Content-Type: application/json" \
  -H "X-Gotify-Key: your-client-token" \
  -d '{"name": "My App", "description": "测试应用"}'

# 发送消息
curl -X POST https://your-domain.workers.dev/message \
  -H "Content-Type: application/json" \
  -H "X-Gotify-Key: your-app-token" \
  -d '{"title": "Hello", "message": "World", "priority": 5}'
```

## 客户端支持

Woe 兼容所有 Gotify 客户端：

- [Gotify Android](https://github.com/gotify/android)
- [Gotify iOS](https://github.com/gotify/ios)
- [Gotify CLI](https://github.com/gotify/cli)
- [更多客户端](https://gotify.net/docs/libraries)

## 技术栈

| 后端 | 前端 | 基础设施 |
|------|------|----------|
| Cloudflare Workers | Vue 3 | Cloudflare D1 |
| Hono | TypeScript | Cloudflare R2 |
| Drizzle ORM | Pinia | WebSocket |

## 许可证

[GPLv3 License](LICENSE)

## 相关链接

- [Gotify 官网](https://gotify.net/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [项目 GitHub](https://github.com/qzcrown/woe)
