/**
 * Webhooker YAML Configuration Test
 *
 * This script tests the webhooker plugin with YAML configuration
 * to verify the Content-Type override fix works correctly.
 *
 * Usage: bun run tests/manual/webhooker-yaml-test.ts
 */

import { createWebhooker } from '../../src/plugins/builtin/webhooker'
import { parseYaml } from '../../src/utils/yaml'
import type { PluginContext } from '../../src/plugins/types'

// ============================================================================
// 1. YAML Configuration (User's Mailgun config)
// ============================================================================

const YAML_CONFIG = `
targetUrl: https://api.mailgun.net/v3/qzcrown.xyz/messages
method: POST
timeoutMs: 5000

# Mailgun API expects form-urlencoded data, not JSON
body: from=noreply@qzcrown.xyz&to=wgwg112233@gmail.com&subject=#{MESSAGE_TITLE}&text=#{MESSAGE}%0A#{APP_NAME}%0A#{NOW}

# Custom headers can override the default Content-Type
headers:
  Content-Type: application/x-www-form-urlencoded
  Authorization: Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA==
`

// ============================================================================
// 2. Mock Context (Test data)
// ============================================================================

const MOCK_CONTEXT: PluginContext = {
  userId: 12345,
  now: new Date().toISOString(),
  message: {
    id: 1001,
    appId: 1,
    title: 'Test Alert - YAML Config Test',
    content: 'This is a test email sent via webhooker plugin with YAML config.',
    priority: 5
  },
  application: {
    id: 1,
    name: 'TestApp'
  }
}

// ============================================================================
// 3. Test Functions
// ============================================================================

function printSection(title: string) {
  console.log('\n' + '='.repeat(60))
  console.log(`  ${title}`)
  console.log('='.repeat(60))
}

async function testWebhookerWithYamlConfig() {
  printSection('WEBHOOKER YAML CONFIGURATION TEST')

  // Parse YAML configuration
  console.log('\n📋 YAML Configuration:')
  console.log(YAML_CONFIG)

  const config = parseYaml(YAML_CONFIG)
  if (!config) {
    console.error('❌ Failed to parse YAML configuration')
    return { success: false }
  }

  console.log('\n📦 Parsed Config:')
  console.log(JSON.stringify(config, null, 2))

  // Create webhooker plugin
  const plugin = createWebhooker({ id: 1, name: 'mailgun-test' })
  await plugin.init({ config })

  printSection('SENDING REQUEST VIA WEBHOOKER PLUGIN')
  console.log('Triggering onMessageCreate event...')
  console.log('This will send a REAL email to wgwg112233@gmail.com')

  // Trigger the webhook
  await plugin.onMessageCreate!(MOCK_CONTEXT)

  // Note: The webhooker plugin logs response to console
  // We can't capture it directly since it uses console.log internally

  printSection('TEST COMPLETED')
  console.log('✅ Check the console output above for webhooker response')
  console.log('   Look for "Webhooker response:" log message')
  console.log('   Expected: Status 200 OK with Mailgun success message')

  return { success: true }
}

// ============================================================================
// 4. Main Execution
// ============================================================================

async function main() {
  console.log('\n🔧 WEBHOOKER YAML CONFIGURATION TEST')
  console.log('   Testing webhooker plugin with YAML configuration')
  console.log('   Verifying Content-Type override fix')

  const result = await testWebhookerWithYamlConfig()

  console.log('\n' + '='.repeat(60))
  if (result.success) {
    console.log('  ✅ Test executed - Check response above')
  } else {
    console.log('  ❌ Test failed')
  }
  console.log('='.repeat(60) + '\n')
}

// Run the test
main()
