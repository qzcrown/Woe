# 自动化部署脚本

本目录包含用于数据库迁移和部署的自动化脚本。

## 脚本列表

### 1. dev-with-migration.sh

**用途：** 本地开发时自动检查和生成迁移

**使用方法：**
```bash
npm run dev:auto
# 或
./scripts/dev-with-migration.sh
```

**执行流程：**
1. 检查 `src/models/` 目录是否有比最新迁移文件更新的文件
2. 如果有变更，自动运行 `drizzle-kit generate` 生成迁移
3. 提示用户更新 `src/migrations/index.ts`
4. 启动开发服务器 `wrangler dev`

**特点：**
- 自动化迁移生成，减少手动操作
- 友好的提示信息
- 10秒超时自动继续（如果用户不操作）

---

### 2. deploy-with-migration.sh

**用途：** 生产部署时确保迁移已生成并执行

**使用方法：**
```bash
npm run deploy:auto
# 或
./scripts/deploy-with-migration.sh
```

**执行流程：**
1. 检查是否有未生成迁移的模型变更
2. 如果有，自动生成迁移并显示需要添加的代码
3. 要求用户确认已更新 `src/migrations/index.ts`
4. 构建前端（如果存在）
5. 执行 `wrangler deploy`
6. 显示部署摘要

**特点：**
- 防止遗漏迁移文件
- 强制确认流程，确保数据安全
- 彩色输出，清晰易读
- 完整的错误处理

---

## 工作流程示例

### 场景 1：添加新字段

```bash
# 1. 修改模型
vim src/models/user.ts

# 2. 使用自动化脚本启动开发
npm run dev:auto
# 脚本会自动生成迁移并提醒你更新 index.ts

# 3. 更新迁移索引（根据脚本提示）
vim src/migrations/index.ts

# 4. 访问 http://localhost:8787
# 迁移会在首次请求时自动执行
```

### 场景 2：生产部署

```bash
# 1. 修改并测试模型
vim src/models/application.ts
npm run dev:auto

# 2. 提交代码
git add .
git commit -m "Add new field to application"

# 3. 部署到生产
npm run deploy:auto
# 脚本会确保迁移已生成，构建前端，并部署
```

---

## 注意事项

1. **脚本需要执行权限**
   ```bash
   chmod +x scripts/*.sh
   ```

2. **更新迁移索引**
   每次生成新迁移后，必须手动更新 `src/migrations/index.ts`：
   ```typescript
   // @ts-ignore
   import migration0001 from './sql/0001_xxx.sql';
   
   export const migrations: Record<string, string> = {
     '0000_colorful_giant_girl': migration0000,
     '0001_xxx': migration0001,  // 添加这一行
   };
   ```

3. **迁移文件命名**
   drizzle-kit 自动生成的文件名格式为：`XXXX_description.sql`
   - 前缀数字保证顺序
   - description 是自动生成的描述

4. **回滚机制**
   目前脚本不支持自动回滚，如需回滚：
   - 手动编写反向迁移 SQL
   - 作为新的迁移文件执行

---

## 环境要求

- **Bash Shell** (Linux/macOS 自带，Windows 可用 Git Bash 或 WSL)
- **Node.js 18+**
- **npm**
- **wrangler CLI**

---

## 故障排查

### 问题：脚本提示 "Permission denied"

**解决方案：**
```bash
chmod +x scripts/dev-with-migration.sh scripts/deploy-with-migration.sh
```

### 问题：迁移检测不准确

**原因：** 基于文件修改时间判断，可能受 git 操作影响

**解决方案：**
- 手动运行 `npm run db:generate`
- 或删除最新迁移文件重新生成

### 问题：部署时提示"未更新 migrations/index.ts"

**原因：** 忘记在索引文件中导入新的迁移

**解决方案：**
1. 打开 `src/migrations/index.ts`
2. 按照脚本提示添加 import 和映射
3. 重新运行 `npm run deploy:auto`

---

## 集成到 CI/CD

### GitHub Actions 示例

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Deploy with auto migration
        run: npm run deploy:auto
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### GitLab CI 示例

```yaml
deploy:
  stage: deploy
  image: node:18
  script:
    - npm ci
    - npm run deploy:auto
  only:
    - main
```

---

## 相关文档

- [数据库迁移使用指南](../docs/database-migration-guide.md)
- [Drizzle Kit 文档](https://orm.drizzle.team/kit-docs/overview)
- [Wrangler 文档](https://developers.cloudflare.com/workers/wrangler/)
