# Woe 前端

基于 Vue 3、TypeScript 和 Scoped CSS 构建的现代化、功能丰富的 Gotify 服务器前端。

## 功能特性

### 核心功能
- **仪表板**: 系统状态概览、近期消息和统计信息
- **消息管理**: 支持分页、过滤和批量操作的实时消息查看
- **应用管理**: 支持图标上传和详细视图的应用管理
- **客户端管理**: 包含令牌处理的客户端设备管理
- **用户管理**: 基于角色的用户访问控制管理
- **插件系统**: 完整的插件系统，支持配置和显示功能

### 增强功能
- **实时更新**: WebSocket 集成，带有连接状态指示器
- **应用图标**: 上传和管理应用图标
- **消息过滤**: 按应用、优先级和搜索词进行过滤
- **批量操作**: 一次性选择和删除多条消息
- **插件管理**: 启用/禁用插件并通过 YAML 进行配置
- **响应式设计**: 移动友好的界面，支持自适应布局
- **错误处理**: 全局错误通知系统，提供用户友好的错误信息
- **加载状态**: 一致的加载指示器和骨架屏幕
- **空状态**: 有用的空状态显示，带有操作提示

## 技术栈

- **框架**: Vue 3 with Composition API
- **语言**: TypeScript
- **状态管理**: Pinia
- **路由**: Vue Router
- **HTTP 客户端**: Axios
- **构建工具**: Vite
- **测试**: Vitest
- **样式**: Scoped CSS with custom design system

## 项目结构

```
src/
├── components/          # 可复用的 UI 组件
│   ├── ApplicationIcon.vue
│   ├── ConnectionStatus.vue
│   ├── EmptyState.vue
│   ├── Layout.vue
│   ├── LoadingSpinner.vue
│   ├── MessageFilters.vue
│   └── Notification.vue
├── services/           # API 和外部服务
│   ├── api.ts
│   ├── auth.ts
│   └── websocket.ts
├── stores/             # Pinia 状态管理
│   ├── auth.ts
│   └── messages.ts
├── types/              # TypeScript 类型定义
│   └── index.ts
├── utils/              # 工具函数
│   └── errorHandler.ts
├── views/              # 页面组件
│   ├── ApplicationDetail.vue
│   ├── Applications.vue
│   ├── Clients.vue
│   ├── Dashboard.vue
│   ├── Login.vue
│   ├── Messages.vue
│   ├── PluginDetail.vue
│   ├── Plugins.vue
│   ├── Setup.vue
│   └── Users.vue
├── router/
│   └── index.ts
├── App.vue
└── main.ts
```

## 快速开始

### 前置要求
- Node.js 16+
- npm 或 yarn
- Gotify 服务器实例

### 安装步骤

1. 克隆仓库：
   ```bash
   git clone <repository-url>
   cd woe/frontend
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置环境变量：

   开发环境，复制开发环境文件：
   ```bash
   cp .env.development .env.local
   # 编辑 .env.local 文件配置您的设置
   ```

   生产环境，使用：
   ```bash
   cp .env.production .env.local
   # 编辑 .env.local 文件配置您的生产环境设置
   ```

4. 启动开发服务器：
   ```bash
   npm run dev
   ```

5. 构建生产版本：
   ```bash
   npm run build
   ```

### 环境变量

- `VITE_API_BASE_URL`: API 请求的基础 URL（默认: `/`）
- `VITE_AUTH_ENCRYPTION_KEY`: 用于加密认证数据的密钥

## API 集成

前端与 Gotify 服务器 REST API 集成：

- 通过 Basic Auth 进行身份验证
- 支持分页的消息管理
- 应用和客户端管理
- 插件配置和显示
- 通过 WebSocket 实现实时更新

## 测试

测试基础设施计划在将来版本中添加。目前建议进行手动测试。

## 浏览器支持

- Chrome（最新版本）
- Firefox（最新版本）
- Safari（最新版本）
- Edge（最新版本）

## 贡献指南

1. Fork 本仓库
2. 创建功能分支
3. 进行您的更改
4. 为新功能添加测试
5. 确保所有测试通过
6. 提交 Pull Request

## 许可证

本项目基于 MIT 许可证发布。