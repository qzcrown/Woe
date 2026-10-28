import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'
import { pluginLocaleMessages } from '@/generated/plugins/locales'


const savedLocale = localStorage.getItem('locale')
const browserLocale = navigator.language.toLowerCase()
const defaultLocale = savedLocale || (browserLocale.startsWith('zh') ? 'zh-CN' : 'en-US')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)






function deepMergeLocale<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key]
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMergeLocale(existing, value) : value
  }
  return merged as T
}


const mergePluginLocales = <T extends Record<string, unknown>>(
  core: T,
  contributions: readonly Record<string, unknown>[]
): T => contributions.reduce<T>((acc, module) => deepMergeLocale(acc, module), core)

const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': mergePluginLocales(zhCN, pluginLocaleMessages['zh-CN']),
    'en-US': mergePluginLocales(enUS, pluginLocaleMessages['en-US'])
  }
})

export default i18n
