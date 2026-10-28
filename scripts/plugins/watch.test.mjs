import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createDevSupervisor, waitForExit } from './watch.mjs'


function fakeChild() {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.killCalls = []
  child.kill = signal => {
    child.killCalls.push(signal)
    if (child.exitCode !== null || child.signalCode !== null) return false
    child.exitCode = 1
    child.signalCode = signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
    child.emit('exit', child.exitCode, child.signalCode)
    return true
  }
  return child
}


async function until(predicate, message, deadlineMs = 2000) {
  const deadline = Date.now() + deadlineMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${message}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function harness(overrides = {}) {
  const children = []
  const regenerations = []
  const exits = []
  const state = { failRegeneration: false }
  const supervisor = createDevSupervisor({
    spawnChild: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    regenerate: async () => {
      regenerations.push(true)
      if (state.failRegeneration) throw new Error('invalid plugin.json')
    },
    onExit: code => exits.push(code),
    restartDebounceMs: 1,
    killGraceMs: 50,
    logger: () => {},
    ...overrides
  })
  return { supervisor, children, regenerations, exits, state }
}

test('waitForExit resolves immediately for an already-exited child', async () => {


  const child = fakeChild()
  child.kill('SIGTERM')
  await Promise.race([
    waitForExit(child),
    new Promise((_, reject) => setTimeout(() => reject(new Error('waitForExit hung on an exited child')), 100))
  ])
})

test('waitForExit resolves when the child exits later or fails to spawn', async () => {
  const late = fakeChild()
  const waited = waitForExit(late)
  setTimeout(() => late.kill('SIGTERM'), 10)
  await Promise.race([waited, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))])


  const errored = fakeChild()
  const failed = waitForExit(errored)
  setTimeout(() => errored.emit('error', new Error('spawn ENOENT')), 10)
  await Promise.race([failed, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))])
})

test('restart kills the running child, regenerates, and starts a new child', async () => {
  const { supervisor, children, regenerations, exits } = harness()
  const first = supervisor.start()
  supervisor.notifyChange()
  await until(() => children.length === 2, 'second child to start')
  assert.equal(first.killCalls.includes('SIGTERM'), true)
  assert.equal(first.exitCode !== null, true)
  assert.equal(regenerations.length, 1)

  assert.deepEqual(exits, [])
})

test('a failed regeneration keeps the dev process down yet later changes still restart it', async () => {


  const { supervisor, children, exits, state } = harness()
  supervisor.start()
  state.failRegeneration = true
  supervisor.notifyChange()
  await until(() => children[0].exitCode !== null, 'old child to be killed')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(children.length, 1, 'a failed regeneration must not start a new child')
  assert.equal(supervisor.isRestarting(), false, 'restarting flag must be released')

  state.failRegeneration = false
  supervisor.notifyChange()
  await until(() => children.length === 2, 'recovery restart to start a new child')
  assert.deepEqual(exits, [])
})

test('exit forwarding is attached to every restarted child, not only the first', async () => {

  const { supervisor, children, exits } = harness()
  supervisor.start()
  supervisor.notifyChange()
  await until(() => children.length === 2, 'second child to start')
  children[1].kill('SIGTERM')
  await until(() => exits.length === 1, 'exit code of the restarted child to be forwarded')
  assert.equal(exits[0], 1)
})

test('stop kills the child without forwarding an exit', async () => {
  const { supervisor, children, exits } = harness()
  supervisor.start()
  await supervisor.stop()
  assert.equal(children[0].killCalls.includes('SIGTERM'), true)
  assert.deepEqual(exits, [])
})
