













import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePluginArtifacts } from './generate.mjs'
import { generateWranglerConfig } from './resourceConfig.mjs'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))







export function resolveWranglerEnvironment({ argv, env, cwd = repositoryRoot }) {
  if (!Array.isArray(argv)) throw new Error('resolveWranglerEnvironment: argv must be an array')
  const forwardedArgs = []
  const cliEnvironments = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--cwd' || argument.startsWith('--cwd=')) {
      throw new Error('--cwd is reserved for the wrapper; run it from the intended worktree')
    }
    if (argument === '--config' || argument.startsWith('--config=') || argument.startsWith('-c')) {
      throw new Error(
        `Explicit --config is reserved for the wrapper and cannot be passed through (${argument}); ` +
          `the wrapper regenerates wrangler.generated.json itself - run: npm run wrangler -- <command>`
      )
    }
    if (argument === '-e' || argument === '--env') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`Missing value for ${argument}; usage: npm run wrangler -- <command> ${argument} <environment>`)
      }
      cliEnvironments.push(value)
      index += 1
      continue
    }
    if (argument.startsWith('-e=') || argument.startsWith('--env=')) {
      cliEnvironments.push(argument.slice(argument.indexOf('=') + 1))
      continue
    }
    forwardedArgs.push(argument)
  }

  if (forwardedArgs[0]?.startsWith('-') && !(forwardedArgs.length === 1 && ['--help', '--version', '-h', '-v'].includes(forwardedArgs[0]))) {
    throw new Error('Put the Wrangler command before options; environment flags may precede it')
  }
  const distinct = [...new Set(cliEnvironments)]
  if (distinct.length > 1) {
    throw new Error(
      `Conflicting target environments on the command line: ${distinct.map(value => `"${value}"`).join(' vs ')}`
    )
  }

  const targetEnvironment = distinct[0] ?? env.CLOUDFLARE_ENV ?? 'production'
  const childEnv = { ...env }
  delete childEnv.CLOUDFLARE_ENV

  if (['d1', 'secret', 'tail'].includes(forwardedArgs[0])) {
    forwardedArgs.push('--config', path.resolve(cwd, 'wrangler.generated.json'))
  }
  return { targetEnvironment, forwardedArgs, childEnv }
}

function wranglerEntry() {
  const require = createRequire(import.meta.url)
  const wranglerDirectory = path.dirname(require.resolve('wrangler/package.json'))
  return path.join(wranglerDirectory, 'bin', 'wrangler.js')
}

export async function runWranglerCli({ argv, env = process.env, cwd = repositoryRoot, stdio = 'inherit' }) {
  const { targetEnvironment, forwardedArgs, childEnv } = resolveWranglerEnvironment({ argv, env, cwd })


  await generatePluginArtifacts({ rootDir: cwd, check: false })
  const generated = generateWranglerConfig({ rootDir: cwd, targetEnvironment })
  process.stderr.write(
    `[wrangler wrapper] target environment: ${targetEnvironment}; generated ${generated.files.join(', ')}\n`
  )

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerEntry(), ...forwardedArgs], {
      cwd,
      env: childEnv,
      stdio
    })
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
}

async function main() {
  const code = await runWranglerCli({ argv: process.argv.slice(2) })
  if (code !== 0) process.exitCode = code
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
