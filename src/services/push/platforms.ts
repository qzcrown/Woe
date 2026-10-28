









import { moduleDescriptors } from "../../generated/plugins/catalog.ts";
import { createModuleCatalog } from "../../plugins/moduleCatalog.ts";


export const DECLARED_PUSH_PLATFORMS: readonly string[] = createModuleCatalog(
  moduleDescriptors
).pushPlatforms();
