


// @ts-ignore - Loaded as text modules via wrangler rules
// @ts-ignore
import migration0000 from './sql/0000_initial_schema.sql';
// @ts-ignore
import migration0001 from './sql/0001_conscious_karen_page.sql';
// @ts-ignore
import migration0002 from './sql/0002_light_spectrum.sql';
// @ts-ignore
import migration0003 from './sql/0003_steady_ted_forrester.sql';
// @ts-ignore
import migration0004 from './sql/0004_gorgeous_kang.sql';
// @ts-ignore
import migration0005 from './sql/0005_free_siren.sql';
// @ts-ignore
import migration0006 from './sql/0006_lone_atom.sql';
// @ts-ignore
import migration0007 from './sql/0007_application_sort_key.sql';
// @ts-ignore
import migration0008 from './sql/0008_client_elevated_until.sql';
// @ts-ignore
import migration0009 from './sql/0009_unusual_human_cannonball.sql';
// @ts-ignore
import migration0010 from './sql/0010_same_firestar.sql';
// @ts-ignore
import migration0011 from './sql/0011_active_device_token_unique.sql';
// @ts-ignore
import migration0012 from './sql/0012_wonderful_random.sql';
// @ts-ignore
import migration0013 from './sql/0013_plugin_jobs.sql';

export const migrations: Record<string, string> = {
  '0000_initial_schema': migration0000,
  '0001_conscious_karen_page': migration0001,
  '0002_light_spectrum': migration0002,
  '0003_steady_ted_forrester': migration0003,
  '0004_gorgeous_kang': migration0004,
  '0005_free_siren': migration0005,
  '0006_lone_atom': migration0006,
  '0007_application_sort_key': migration0007,
  '0008_client_elevated_until': migration0008,
  '0009_unusual_human_cannonball': migration0009,
  '0010_same_firestar': migration0010,
  '0011_active_device_token_unique': migration0011,
  '0012_wonderful_random': migration0012,
  '0013_plugin_jobs': migration0013,
};

export default migrations;
