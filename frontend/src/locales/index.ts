import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'

// 从 localStorage 获取保存的语言，或检测浏览器语言
const savedLocale = localStorage.getItem('locale')
const browserLocale = navigator.language.toLowerCase()
const defaultLocale = savedLocale || (browserLocale.startsWith('zh') ? 'zh-CN' : 'en-US')

const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

export default i18n
