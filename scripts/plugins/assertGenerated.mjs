









import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePluginArtifacts } from './generate.mjs'
import { assertWranglerConfigCurrent } from './resourceConfig.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const staleHint = 'Generated inputs are stale or missing; regenerate with the project wrapper: npm run wrangler -- <command>'


export async function assertGeneratedInputs({ rootDir = repositoryRoot, core, resources }) {
  try {
    await generatePluginArtifacts({ rootDir, check: true })
  } catch (error) {
    throw new Error(`${error.message}\n${staleHint}`)
  }
  try {
    return assertWranglerConfigCurrent({ rootDir, core, resources })
  } catch (error) {
    throw new Error(`${error.message}\n${staleHint}`)
  }
}

async function main() {
  const summary = await assertGeneratedInputs({ rootDir: repositoryRoot })
  process.stdout.write(
    `[assertGenerated] plugin artifacts and deployment inputs are current (targetEnvironment: ${summary.targetEnvironment})\n`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
