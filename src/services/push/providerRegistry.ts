














import {
  ProviderResolution,
  ProviderResolver,
  PushDeliveryPolicy,
  PushPlatform,
  PushProvider,
  PushProviderRegistration
} from "./contracts.ts";


function clonePolicy(policy: PushDeliveryPolicy): PushDeliveryPolicy {
  return { ...policy };
}





export interface ProviderRegistryEntry extends PushProviderRegistration {

  initFailed?: boolean;
}


export class ProviderRegistry implements ProviderResolver {
  private readonly providers = new Map<PushPlatform, PushProvider | null>();
  private readonly policies = new Map<PushPlatform, PushDeliveryPolicy>();
  private readonly initFailedPlatforms = new Set<PushPlatform>();

  constructor(entries: readonly ProviderRegistryEntry[] = []) {
    for (const entry of entries) {
      if (this.providers.has(entry.platform)) {
        throw new Error(`Duplicate push provider registration for platform: ${entry.platform}`);
      }
      if (entry.provider && entry.provider.name !== entry.platform) {
        throw new Error(
          `Push provider name mismatch: registration platform ${entry.platform} but provider name ${entry.provider.name}`
        );
      }
      this.providers.set(entry.platform, entry.provider);
      this.policies.set(entry.platform, clonePolicy(entry.policy));
      if (entry.initFailed) {
        this.initFailedPlatforms.add(entry.platform);
      }
    }
  }


  get(platform: PushPlatform): PushProvider | null {
    return this.providers.get(platform) ?? null;
  }


  getPolicy(platform: PushPlatform): PushDeliveryPolicy | null {
    const policy = this.policies.get(platform);
    return policy ? clonePolicy(policy) : null;
  }


  resolve(platform: PushPlatform): ProviderResolution {
    if (!this.providers.has(platform) || !this.policies.has(platform)) {
      return { status: "unregistered", provider: null, policy: null };
    }
    const provider = this.providers.get(platform) ?? null;
    const policy = clonePolicy(this.policies.get(platform) as PushDeliveryPolicy);
    if (provider) {
      return { status: "ready", provider, policy };
    }
    return this.initFailedPlatforms.has(platform)
      ? { status: "init-failed", provider: null, policy }
      : { status: "disabled", provider: null, policy };
  }
}
