














import type { DrizzleDB } from "../../drizzle/index.ts";
import type { Env } from "../../types/index.ts";
import type { PushPluginDefinition, PushProviderFactoryContext } from "../../plugins/push/types.ts";
import { BUILTIN_PUSH_PLUGINS } from "../../plugins/builtin/pushPlugins.ts";
import type { ProviderResolver } from "./contracts.ts";
import { DEFAULT_PUSH_DELIVERY_POLICY } from "./contracts.ts";
import type { ProviderRegistryEntry } from "./providerRegistry.ts";
import { ProviderRegistry } from "./providerRegistry.ts";


export interface CreatePushRuntimeOptions {
  definitions?: readonly PushPluginDefinition[];
  fetchFn?: typeof fetch;
}


export interface PushRuntime {
  providers: ProviderRegistry;
}


const PUSH_PROVIDER_INIT_FAILED = "PUSH_PROVIDER_INIT_FAILED";






function assertUniqueCatalog(definitions: readonly PushPluginDefinition[]): void {
  const modulePaths = new Set<string>();
  const platforms = new Set<string>();
  for (const definition of definitions) {
    if (modulePaths.has(definition.modulePath)) {
      throw new Error(`Duplicate push plugin modulePath in catalog: ${definition.modulePath}`);
    }
    if (platforms.has(definition.platform)) {
      throw new Error(`Duplicate push plugin platform in catalog: ${definition.platform}`);
    }
    modulePaths.add(definition.modulePath);
    platforms.add(definition.platform);
  }
}









export async function createPushRuntime(
  drizzle: DrizzleDB,
  env: Env,
  options?: CreatePushRuntimeOptions
): Promise<PushRuntime> {
  const definitions = options?.definitions ?? BUILTIN_PUSH_PLUGINS;


  assertUniqueCatalog(definitions);

  const ctx: PushProviderFactoryContext = {

    async getStateValue(key: string): Promise<string | null> {
      try {
        const row = await drizzle.$client
          .prepare("SELECT value FROM system_state WHERE key = ? LIMIT 1")
          .bind(key)
          .first<{ value: string }>();
        return row?.value ?? null;
      } catch {
        return null;
      }
    },

    getBinding(name: string): string | undefined {
      const value = (env as unknown as Record<string, unknown>)[name];
      return typeof value === "string" ? value : undefined;
    },

    fetchFn: options?.fetchFn ?? fetch.bind(globalThis)
  };

  const registrations: ProviderRegistryEntry[] = [];
  for (const definition of definitions) {
    try {
      const registration = await definition.createRuntime(ctx);
      if (registration.platform !== definition.platform) {
        throw new Error("push provider registration platform mismatch");
      }
      if (registration.provider && registration.provider.name !== definition.platform) {
        throw new Error("push provider name mismatch");
      }
      registrations.push(registration);
    } catch {



      console.error(PUSH_PROVIDER_INIT_FAILED, {
        modulePath: definition.modulePath,
        platform: definition.platform
      });
      registrations.push({
        platform: definition.platform,
        provider: null,
        policy: DEFAULT_PUSH_DELIVERY_POLICY,
        initFailed: true
      });
    }
  }

  return { providers: new ProviderRegistry(registrations) };
}









export function createPushResolverFactory(
  drizzle: DrizzleDB,
  env: Env,
  options?: CreatePushRuntimeOptions
): () => Promise<ProviderResolver> {
  return async () => (await createPushRuntime(drizzle, env, options)).providers;
}
