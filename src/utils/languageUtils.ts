import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../config'

/**
 * Get the localized name of the language
 */
export function getLanguageNativeName(code: SupportedLanguage): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
  return lang?.nativeName || code
}

/**
 * Get the English name of the language
 */
export function getLanguageName(code: SupportedLanguage): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
  return lang?.name || code
}

/**
 * Check if it is a supported language
 */
export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return SUPPORTED_LANGUAGES.some(l => l.code === code)
}

/**
 * Get all supported language codes
 */
export function getSupportedLanguageCodes(): SupportedLanguage[] {
  return SUPPORTED_LANGUAGES.map(l => l.code)
}

/**
 * Filter content based on language code (for content filtering functionality)
 */
export function filterContentByLanguage<T extends { language?: string }>(
  content: T[],
  targetLanguage: SupportedLanguage
): T[] {
  return content.filter(item => 
    !item.language || item.language === targetLanguage
  )
}