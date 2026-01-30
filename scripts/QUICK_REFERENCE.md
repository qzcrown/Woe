# 🚀 快速参考：自动化部署与迁移

## 日常开发命令

```bash
# 本地开发（推荐）- 自动检查迁移
npm run dev:auto

# 普通开发（不检查迁移）
npm run dev

# 仅前端开发
npm run dev:frontend
```

## 部署命令

```bash
# 自动部署（推荐）- 检查迁移 + 构建 + 部署
npm run deploy:auto

# 普通部署（不检查迁移）
npm run deploy
```

## 数据库迁移命令

```bash
# 生成迁移 SQL（模型变更后）
npm run db:generate

# 直接推送 schema（仅开发环境）
npm run db:push
```

## 修改模型后的完整流程

### 方式 1：使用自动化脚本（推荐）✨

```bash
# 1. 修改模型
vim src/models/user.ts

# 2. 运行开发脚本（会自动生成迁移）
npm run dev:auto

# 3. 根据提示更新 src/migrations/index.ts
vim src/migrations/index.ts
# 添加: import migration0001 from './sql/0001_xxx.sql';
# 添加: '0001_xxx': migration0001,

# 4. 测试完成后部署
npm run deploy:auto
```

### 方式 2：手动操作

```bash
# 1. 修改模型
vim src/models/user.ts

# 2. 生成迁移
npm run db:generate

# 3. 更新迁移索引
vim src/migrations/index.ts

# 4. 本地测试
npm run dev

# 5. 部署
npm run deploy
```

## 迁移索引文件模板

```typescript
// src/migrations/index.ts
// @ts-ignore
import migration0000 from './sql/0000_colorful_giant_girl.sql';
// @ts-ignore
import migration0001 from './sql/0001_new_migration.sql';

export const migrations: Record<string, string> = {
  '0000_colorful_giant_girl': migration0000,
  '0001_new_migration': migration0001,  // 👈 添加新迁移
};

export default migrations;
```

## 常见场景

### 添加新字段
```typescript
// src/models/user.ts
export const users = sqliteTable('users', {
  // ... 现有字段
  email: text('email'),  // 👈 新增
});
```
然后运行：`npm run dev:auto`

### 修改字段类型
```typescript
// 将 integer 改为 text
status: text('status').notNull(),  // 之前是 integer
```
然后运行：`npm run db:generate`

### 添加新表
```typescript
// src/models/newTable.ts
export const newTable = sqliteTable('new_table', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});
```
记得在 `src/models/index.ts` 中导出

## 故障排查速查

| 问题 | 解决方案 |
|------|----------|
| 脚本无法执行 | `chmod +x scripts/*.sh` |
| 迁移未生成 | 手动运行 `npm run db:generate` |
| 迁移未执行 | 检查 `src/migrations/index.ts` 是否导入 |
| 部署失败 | 查看日志 `wrangler tail` |
| Worker 错误 | 检查 `_migrations` 表记录 |

## 重要提醒 ⚠️

1. ✅ **始终使用** `npm run dev:auto` 和 `npm run deploy:auto`
2. ✅ **每次生成迁移后** 必须更新 `src/migrations/index.ts`
3. ✅ **测试后再部署** 先本地验证，再推送到生产
4. ❌ **不要手写 SQL** 让 drizzle-kit 自动生成
5. ❌ **不要跳过迁移** 所有模型变更都要生成迁移

## 文档链接

- 📖 [完整迁移指南](../docs/database-migration-guide.md)
- 📖 [脚本详细说明](./README.md)
- 🔗 [Drizzle ORM](https://orm.drizzle.team/)
- 🔗 [Cloudflare Workers](https://workers.cloudflare.com/)
