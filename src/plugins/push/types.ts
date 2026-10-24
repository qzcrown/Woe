






import type { PushPlatform, PushProviderRegistration } from '../../services/push/contracts.ts';


export interface PushProviderFactoryContext {

  getStateValue(key: string): Promise<string | null>;

  getBinding(name: string): string | undefined;

  fetchFn: typeof fetch;
}


export interface PushPluginDefinition {

  modulePath: string;
  platform: PushPlatform;
  createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration>;
}
