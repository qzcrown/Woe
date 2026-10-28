import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function preparePluginGeneration(rootDir: string): void {
  execFileSync(process.execPath, [resolve(rootDir, 'scripts/plugins/generate.mjs')], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'inherit']
  })
}

export default function globalSetup(): void {
  preparePluginGeneration(fileURLToPath(new URL('../../', import.meta.url)))
}
