












import {
  ProviderResolver,
  PushDeliveryPolicy,
  PushPlatform,
  PushProvider,
  PushProviderRegistration
} from "./contracts.ts";


function clonePolicy(policy: PushDeliveryPolicy): PushDeliveryPolicy {
  return { ...policy };
}


export class ProviderRegistry implements ProviderResolver {
  private readonly providers = new Map<PushPlatform, PushProvider | null>();
  private readonly policies = new Map<PushPlatform, PushDeliveryPolicy>();

  constructor(entries: readonly PushProviderRegistration[] = []) {
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
    }
  }


  get(platform: PushPlatform): PushProvider | null {
    return this.providers.get(platform) ?? null;
  }


  getPolicy(platform: PushPlatform): PushDeliveryPolicy | null {
    const policy = this.policies.get(platform);
    return policy ? clonePolicy(policy) : null;
  }
}
