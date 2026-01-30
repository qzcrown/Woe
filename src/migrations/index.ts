// ⚠️ 自动生成文件 - 请勿手动修改
// 由 scripts/update-migration-index.js 生成

// @ts-ignore - Loaded as text modules via wrangler rules
// @ts-ignore
import migration0000 from './sql/0001_conscious_karen_page.sql';
// @ts-ignore
import migration0001 from './sql/0002_light_spectrum.sql';
// @ts-ignore
import migration0002 from './sql/0003_steady_ted_forrester.sql';

export const migrations: Record<string, string> = {
  '0001_conscious_karen_page': migration0000,
  '0002_light_spectrum': migration0001,
  '0003_steady_ted_forrester': migration0002,
};

export default migrations;
