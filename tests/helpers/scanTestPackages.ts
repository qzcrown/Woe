









import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createModuleCatalog } from '../../src/plugins/moduleCatalog'
import type { ModuleDescriptor } from '../../src/plugins/moduleCatalog'


const DISCOVERY_MODULE = path.resolve(__dirname, '../../scripts/plugins/discovery.mjs')


const ACME_MANIFEST = {
  modulePath: 'builtin/acme-push',
  name: 'Acme Push',
  capabilities: ['push-acme', 'messenger'],
  author: 'fixture-author',
  license: 'fixture-license',
  website: 'https://example.invalid/acme-push',
  backend: {
    push: { entry: 'index.ts', export: 'acmePushDefinition', platform: 'acme-push' }
  }
}


function scanManifests(rootDir: string): ReadonlyArray<Record<string, any>> {
  const stdout = execFileSync(
    process.execPath,
    [DISCOVERY_MODULE, '--print-packages', '--root', rootDir],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
  return JSON.parse(String(stdout))
}


function toDescriptor(manifest: Record<string, any>): ModuleDescriptor {
  return {
    modulePath: manifest.modulePath,
    name: manifest.name,
    capabilities: manifest.capabilities,
    author: manifest.author,
    license: manifest.license,
    website: manifest.website,
    secretFields: manifest.config?.secretFields ?? [],
    ...(manifest.backend?.push ? { push: { platform: manifest.backend.push.platform } } : {})
  }
}


export interface ScannedPushPackageFixture {

  pushPlatforms: readonly string[]

  dispose(): void
}


export function scanAcmePushPackage(): ScannedPushPackageFixture {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'woe-acme-push-scan-'))
  const packageDir = path.join(rootDir, 'src/plugins/builtin/acme-push')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'plugin.json'), JSON.stringify(ACME_MANIFEST, null, 2))

  writeFileSync(path.join(packageDir, 'index.ts'), 'export const acmePushDefinition = {}\n')

  const manifests = scanManifests(rootDir)
  const catalog = createModuleCatalog(manifests.map(toDescriptor))
  return {
    pushPlatforms: catalog.pushPlatforms(),
    dispose: () => rmSync(rootDir, { recursive: true, force: true })
  }
}
