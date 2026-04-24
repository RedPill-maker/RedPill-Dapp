import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import enUS from './locales/en-US.json'
import jaJP from './locales/ja-JP.json'
import koKR from './locales/ko-KR.json'
import esES from './locales/es-ES.json'
import { DEFAULT_LANGUAGE } from '../../config'
import { privateDataMgr } from '../utils/privateDataMgr'

const savedLanguage = privateDataMgr.getLanguage() || DEFAULT_LANGUAGE

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    'en-US': { translation: enUS },
    'ja-JP': { translation: jaJP },
    'ko-KR': { translation: koKR },
    'es-ES': { translation: esES },
  },
  lng: savedLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
