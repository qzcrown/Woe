











import { parse } from 'yaml'
import type { Env } from '../../../../../../src/types/index.ts'
import type { PluginHostContext } from '../../../../../../src/plugins/jobs/types.ts'
import { createOutboundHttp } from '../../../../../../src/services/http/outboundPolicy.ts'
import {
  createWebhookerDefinition
} from '../../../../../../src/plugins/builtin/webhooker/definition.ts'





const YAML_CONFIG = `
targetUrl: https://mail.example.com/v3/example.com/messages
method: POST
timeoutMs: 5000

# Mailgun API expects form-urlencoded data, not JSON
body: from=noreply@example.com&to=user@example.com&subject=#{MESSAGE_TITLE}&text=#{MESSAGE}%0A#{APP_NAME}%0A#{NOW}

# Custom headers can override the default Content-Type
headers:
  Content-Type: application/x-www-form-urlencoded
  Authorization: Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA==
`





const NOW = new Date().toISOString()

const HOST: PluginHostContext = {
  userId: 12345,
  pluginId: 1,
  messages: {
    getMessage: async () => ({
      id: 1001,
      appId: 1,
      date: NOW,
      priority: 5,
      title: 'Test Alert - YAML Config Test',
      content: 'This is a test email sent via webhooker plugin with YAML config.',
      extras: {}
    })
  },
  applications: { getApplication: async () => ({ id: 1, name: 'TestApp' }) },
  tags: { getTags: async () => ({ ok: true, tags: [] }), appendTags: async () => ({ status: 'unchanged', tags: [] }) },
  secrets: { get: async () => null, has: async () => false, paths: () => [] },

  http: createOutboundHttp({ policy: { allowQuery: true } })
}





function printSection(title: string) {
  console.log('\n' + '='.repeat(60))
  console.log(`  ${title}`)
  console.log('='.repeat(60))
}

async function testWebhookerWithYamlConfig() {
  printSection('WEBHOOKER YAML CONFIGURATION TEST')


  console.log('\n📋 YAML Configuration:')
  console.log(YAML_CONFIG)

  const config = parse(YAML_CONFIG) as Record<string, any>
  if (!config) {
    console.error('❌ Failed to parse YAML configuration')
    return { success: false }
  }

  console.log('\n📦 Parsed Config:')
  console.log(JSON.stringify(config, null, 2))


  const definition = createWebhookerDefinition({} as Env)

  const prepared = await definition.prepareJob!({
    userId: HOST.userId,
    pluginId: HOST.pluginId,
    subjectType: 'message',
    subjectId: 1001,
    config,
    host: HOST,
    now: NOW
  })
  if (!('payload' in prepared)) {
    console.error(`❌ prepareJob rejected: ${JSON.stringify(prepared)}`)
    return { success: false }
  }
  console.log('\n📦 Rendered Snapshot (payload):')
  console.log(JSON.stringify(prepared.payload, null, 2))

  const task = await definition.createTask({
    config,
    job: {
      jobId: 1,
      userId: HOST.userId,
      pluginId: HOST.pluginId,
      subjectType: 'message',
      subjectId: 1001,
      payload: prepared.payload
    },
    host: HOST
  })

  printSection('SENDING REQUEST VIA WEBHOOKER TASK')
  console.log('Triggering task.run (prepareJob -> createTask -> run)...')
  console.log('This will send a REAL email to user@example.com')

  const result = await task.run({ attempt: 1, timeoutMs: 20_000 })

  printSection('TEST COMPLETED')
  console.log('📦 Task Result:')
  console.log(JSON.stringify(result, null, 2))
  console.log(
    result.ok
      ? '✅ Delivery succeeded (see result.status/result.httpStatus above)'
      : '❌ Delivery failed (see failure.errorCode above; expected 200 for a valid Mailgun key)'
  )

  return { success: true }
}





async function main() {
  console.log('\n🔧 WEBHOOKER YAML CONFIGURATION TEST')
  console.log('   Testing webhooker job pipeline with YAML configuration')
  console.log('   Verifying Content-Type override fix')

  const result = await testWebhookerWithYamlConfig()

  console.log('\n' + '='.repeat(60))
  if (result.success) {
    console.log('  ✅ Test executed - Check result above')
  } else {
    console.log('  ❌ Test failed')
  }
  console.log('='.repeat(60) + '\n')
}


main()
