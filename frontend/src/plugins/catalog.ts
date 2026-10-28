import { defineAsyncComponent, type Component } from 'vue'
import { frontendModuleDescriptors } from '@/generated/plugins/catalog'
import { pluginUiLoaders } from '@/generated/plugins/ui'







const configEditors = new Map<string, Component>()
for (const [modulePath, loaders] of Object.entries(pluginUiLoaders)) {
  const loader = (loaders as { configEditor?: () => Promise<unknown> }).configEditor
  if (loader !== undefined) {
    configEditors.set(modulePath, defineAsyncComponent(loader as () => Promise<Component>))
  }
}





export function getPluginConfigEditor(modulePath: string): Component | null {
  return configEditors.get(modulePath) ?? null
}


export interface PluginMessageActionsSlot {
  modulePath: string
  component: Component
}


export interface PluginAdminPanelSlot {
  modulePath: string
  component: Component
  namespace: string
}

const asyncSlot = (loaders: unknown, field: 'messageActions' | 'adminPanel'): Component | null => {
  const loader = (loaders as Record<string, (() => Promise<unknown>) | undefined>)[field]
  return loader === undefined ? null : defineAsyncComponent(loader as () => Promise<Component>)
}


export function getPluginMessageActions(): PluginMessageActionsSlot[] {
  const slots: PluginMessageActionsSlot[] = []
  for (const [modulePath, loaders] of Object.entries(pluginUiLoaders)) {
    const component = asyncSlot(loaders, 'messageActions')
    if (component !== null) slots.push({ modulePath, component })
  }
  return slots
}





export function getPluginAdminPanels(): PluginAdminPanelSlot[] {
  const namespaces = new Map(
    frontendModuleDescriptors
      .filter(descriptor => descriptor.quotaNamespace !== undefined)
      .map(descriptor => [descriptor.modulePath, descriptor.quotaNamespace as string])
  )
  const slots: PluginAdminPanelSlot[] = []
  for (const [modulePath, loaders] of Object.entries(pluginUiLoaders)) {
    const component = asyncSlot(loaders, 'adminPanel')
    const namespace = namespaces.get(modulePath)
    if (component === null || namespace === undefined || namespace === '') continue
    slots.push({ modulePath, component, namespace })
  }
  return slots
}





export function getClientPlatformLabels(): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const descriptor of frontendModuleDescriptors) {
    const contributed = descriptor.frontend?.clientPlatformLabels
    if (contributed === undefined) continue
    for (const [platform, key] of Object.entries(contributed)) {
      labels[platform] = key
    }
  }
  return labels
}
