import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { SUPPORTED_LANGUAGES, type LanguageConfig } from '../../../config'

export type SortType = 'latest' | 'popularity'

export interface FilterOptions {
  sortBy: SortType
  languages: string[]
}

interface ContentFilterProps {
  onFilterChange: (options: FilterOptions) => void
}

const ContentFilter: React.FC<ContentFilterProps> = ({ onFilterChange }) => {
  const [sortBy, setSortBy] = useState<SortType>('latest')
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false)
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([])
  const [isAllLanguages, setIsAllLanguages] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLanguageDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Notify parent of filter changes
  useEffect(() => {
    const filterOptions = {
      sortBy,
      languages: isAllLanguages ? [] : selectedLanguages
    }
    onFilterChange(filterOptions)
  }, [sortBy, selectedLanguages, isAllLanguages]) // remove onFilterChange dependency

  const handleSortChange = (newSort: SortType) => {
    setSortBy(newSort)
  }

  const handleLanguageToggle = (langCode: string) => {
    if (isAllLanguages) {
      setIsAllLanguages(false)
      setSelectedLanguages([langCode])
    } else {
      const newSelected = selectedLanguages.includes(langCode)
        ? selectedLanguages.filter(l => l !== langCode)
        : [...selectedLanguages, langCode]
      
      if (newSelected.length === 0) {
        setIsAllLanguages(true)
        setSelectedLanguages([])
      } else {
        setSelectedLanguages(newSelected)
      }
    }
  }

  const handleAllLanguagesToggle = () => {
    setIsAllLanguages(!isAllLanguages)
    if (!isAllLanguages) {
      setSelectedLanguages([])
    }
  }

  const handleAIRecommendClick = () => {
    alert(t('contentFilter.aiRecommendComingSoon'))
  }

  const getLanguageDisplayText = () => {
    if (isAllLanguages) return t('contentFilter.noLimit')
    if (selectedLanguages.length === 0) return t('contentFilter.noLimit')
    if (selectedLanguages.length === 1) {
      const lang = SUPPORTED_LANGUAGES.find((l: LanguageConfig) => l.code === selectedLanguages[0])
      return lang?.nativeName || selectedLanguages[0]
    }
    return t('contentFilter.languageCount', { count: selectedLanguages.length })
  }

  return (
    <div 
      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sticky top-16 z-40 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-4">
        {/* Sort Options */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSortChange('latest')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sortBy === 'latest'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {t('contentFilter.latest')}
          </button>
          <button
            onClick={() => handleSortChange('popularity')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sortBy === 'popularity'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {t('contentFilter.popularity')}
          </button>
        </div>

        {/* AI Recommendation */}
        <button
          onClick={handleAIRecommendClick}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-all"
        >
          {t('contentFilter.aiRecommend')}
        </button>

        {/* Language Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">{t('contentFilter.language')}</span>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <span>{getLanguageDisplayText()}</span>
              <ChevronDownIcon 
                className={`w-4 h-4 transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`} 
              />
            </button>

            {showLanguageDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                <div className="p-2">
                  {/* All Languages Option */}
                  <label className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllLanguages}
                      onChange={handleAllLanguagesToggle}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{t('contentFilter.allLanguages')}</span>
                  </label>

                  <hr className="my-2 border-gray-200 dark:border-gray-600" />

                  {/* Individual Language Options */}
                  {SUPPORTED_LANGUAGES.map((lang: LanguageConfig) => (
                    <label 
                      key={lang.code}
                      className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!isAllLanguages && selectedLanguages.includes(lang.code)}
                        onChange={() => handleLanguageToggle(lang.code)}
                        disabled={isAllLanguages}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                      />
                      <span className={`text-sm ${isAllLanguages ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                        {lang.nativeName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ContentFilter