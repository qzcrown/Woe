
import { registerPluginTask, hasPluginTask } from '../../src/plugins/jobs/registry'
import { register } from '../../src/plugins/registry'
import type { PluginTaskDefinition } from '../../src/plugins/jobs/types'
export const PUBLIC_TASK_MODULE = 'test/public-task'
export function registerPublicTaskFixture(): void {
  if (!hasPluginTask(PUBLIC_TASK_MODULE)) {
    const definition: PluginTaskDefinition = {
      modulePath: PUBLIC_TASK_MODULE,
      supportedSubjectTypes: ['message'],
      quotaNamespace: 'ai',
      secretFields: ['apiKey'],
      async validateConfig({config, host}) {
        const value = config as {valid?: boolean; requireSecret?: boolean} | null
        if (!value?.valid) return {errorCode: 'config'}
        if (value.requireSecret && !await host.secrets.has('apiKey')) return {errorCode:'secret-config'}
      },
      async createTask() {
        return {run: async()=>({ok:true, result:{status:'complete'}, quotaConsumed:true})}
      }
    }
    registerPluginTask(definition)
  }
  register(PUBLIC_TASK_MODULE, ({id,name})=>({
    id, name, capabilities:['messenger'], init() {},
    async onMessageCreate(ctx) {
      if(!ctx.message || !ctx.jobs) return {status:'skipped',code:'plugin-unavailable'}
      return ctx.jobs.enqueue({subjectType:'message',subjectId:ctx.message.id})
    }
  }))
}
registerPublicTaskFixture()
