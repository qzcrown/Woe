const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../src/migrations/sql');
const indexFile = path.join(__dirname, '../src/migrations/index.ts');

console.log('🔄 正在自动更新迁移索引...');

try {
  // 读取所有 .sql 文件
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️  未发现 SQL 迁移文件。');
    process.exit(0);
  }

  // 生成导入语句
  const imports = files.map((file, index) => {
    const varName = `migration${index.toString().padStart(4, '0')}`;
    return `// @ts-ignore\nimport ${varName} from './sql/${file}';`;
  }).join('\n');

  // 生成映射对象
  const mapping = files.map((file, index) => {
    const varName = `migration${index.toString().padStart(4, '0')}`;
    const key = file.replace('.sql', '');
    return `  '${key}': ${varName},`;
  }).join('\n');

  // 生成完整内容
  const content = `// ⚠️ 自动生成文件 - 请勿手动修改
// 由 scripts/update-migration-index.js 生成

// @ts-ignore - Loaded as text modules via wrangler rules
${imports}

export const migrations: Record<string, string> = {
${mapping}
};

export default migrations;
`;

  fs.writeFileSync(indexFile, content);
  console.log(`✅ 已成功更新 ${files.length} 个迁移到 src/migrations/index.ts`);
} catch (error) {
  console.error('❌ 更新迁移索引失败:', error.message);
  process.exit(1);
}