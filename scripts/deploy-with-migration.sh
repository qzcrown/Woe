#!/bin/bash
# 生产部署自动迁移脚本
# 用法: npm run deploy:auto 或 ./scripts/deploy-with-migration.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署流程..."
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否有未提交的迁移变更
echo "🔍 检查迁移文件状态..."

MODELS_DIR="src/models"
MIGRATIONS_DIR="src/migrations/sql"
MIGRATIONS_INDEX="src/migrations/index.ts"

# 获取最新的迁移文件
LATEST_MIGRATION=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f 2>/dev/null | sort -r | head -n 1)

# 检查是否需要生成新迁移
NEED_GENERATE=false

if [ -z "$LATEST_MIGRATION" ]; then
  echo -e "${RED}❌ 错误: 未找到任何迁移文件${NC}"
  echo "   请先运行: npm run db:generate"
  exit 1
fi

# 检查 models 目录下是否有比最新迁移更新的文件
if [ -n "$(find "$MODELS_DIR" -type f -newer "$LATEST_MIGRATION" 2>/dev/null)" ]; then
  echo -e "${YELLOW}⚠️  检测到模型变更但未生成迁移${NC}"
  NEED_GENERATE=true
fi

if [ "$NEED_GENERATE" = true ]; then
  echo ""
  echo -e "${YELLOW}📝 发现未生成的模型变更，自动生成迁移...${NC}"
  
  # 生成迁移
  npm run db:generate
  
  echo -e "${GREEN}🪄  自动更新迁移索引...${NC}"
  node scripts/update-migration-index.js
  
  echo ""
  echo -e "${GREEN}✅ 迁移已生成并自动完成注册。${NC}"
  echo ""
fi

echo ""
echo "✅ 迁移检查通过"
echo ""

# 构建前端（如果需要）
if [ -d "frontend" ]; then
  echo "🔨 构建前端..."
  npm run build:frontend
  echo "✅ 前端构建完成"
  echo ""
fi

# 部署到 Cloudflare Workers
echo "🚀 部署到 Cloudflare Workers..."
echo "   迁移将在 Worker 启动时自动执行"
echo ""

wrangler deploy

echo ""
echo -e "${GREEN}✅ 部署完成！${NC}"
echo ""
echo "📊 部署摘要:"
echo "   - Worker 已更新"
echo "   - 迁移文件已打包"
echo "   - 数据库将在首次请求时自动迁移"
echo ""
echo "🔗 查看部署状态: wrangler tail"
echo ""
