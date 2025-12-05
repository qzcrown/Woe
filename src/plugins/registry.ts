import { ExecutablePlugin } from './types.ts'

type Factory = (params: { id: number; name: string }) => ExecutablePlugin

const factories: Record<string, Factory> = {}

export function register(modulePath: string, factory: Factory) {
  factories[modulePath] = factory
}

export function resolve(modulePath: string, id: number, name: string): ExecutablePlugin | null {
  const f = factories[modulePath]
  return f ? f({ id, name }) : null
}

export function has(modulePath: string): boolean {
  return !!factories[modulePath]
}

