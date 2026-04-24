import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { toggleSidebar } from '../../store/slices/sidebarSlice'
import { setSearchQuery, VideoState } from '../../store/slices/videoSlice'
import { setCurrentPage } from '../../store/slices/pageSlice'
import Logo from '../Logo'
import { APP_CONFIG } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { searchCreators, searchWorks } from '../../utils/dbConnector'
import { ipfsConnector } from '../../utils/ipfsConnector'
import type { Creator, Work } from '../../utils/dbConnector'

interface SearchSuggestions {
  creators: Creator[]
  works: Work[]
}

const SEARCH_DEBOUNCE_MS = 300
const MAX_SUGGESTIONS = 10

// Split suggestions between creators and works (up to 10 total, prefer balance)
function splitLimit(creators: Creator[], works: Work[]): { creators: Creator[]; works: Work[] } {
  const half = Math.floor(MAX_SUGGESTIONS / 2)
  if (creators.length <= half) {
    return { creators, works: works.slice(0, MAX_SUGGESTIONS - creators.length) }
  }
  if (works.length <= half) {
    return { creators: creators.slice(0, MAX_SUGGESTIONS - works.length), works }
  }
  return { creators: creators.slice(0, half), works: works.slice(0, MAX_SUGGESTIONS - half) }
}

const SearchIcon = () => (
  <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const ClockIcon = () => (
  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

interface SearchDropdownProps {
  query: string
  suggestions: SearchSuggestions | null
  history: string[]
  loading: boolean
  onSelect: (value: string) => void
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({ query, suggestions, history, loading, onSelect }) => {
  const { t } = useTranslation()
  const hasQuery = query.trim().length > 0

  if (!hasQuery && history.length === 0) return null

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-rp-gray-800 border border-gray-200 dark:border-rp-gray-600 rounded-xl shadow-lg z-50 overflow-hidden">
      {/* Search history (shown when no query) */}
      {!hasQuery && history.length > 0 && (
        <div>
          <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            {t('header.recentSearches')}
          </div>
          {history.map((item) => (
            <button
              key={item}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(item) }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-rp-gray-700 text-left"
            >
              <ClockIcon />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item}</span>
            </button>
          ))}
        </div>
      )}

      {/* Live suggestions */}
      {hasQuery && (
        <>
          {loading && (
            <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{t('common.loading')}</div>
          )}
          {!loading && suggestions && (
            <>
              {/* Creators group */}
              {suggestions.creators.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    {t('header.suggestCreators')}
                  </div>
                  {suggestions.creators.map((creator) => (
                    <button
                      key={creator.username}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); onSelect(creator.username) }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-rp-gray-700 text-left"
                    >
                      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-gray-200 dark:bg-rp-gray-600">
                        {creator.avatar_cid ? (
                          <img
                            src={ipfsConnector.getGatewayUrl(creator.avatar_cid)}
                            alt={creator.username}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 font-medium">
                            {creator.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{creator.username}</div>
                        {creator.title && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{creator.title}</div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {t('header.worksCount', { count: creator.work_count })}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Works group */}
              {suggestions.works.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    {t('header.suggestWorks')}
                  </div>
                  {suggestions.works.map((work) => (
                    <button
                      key={work.cid}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); onSelect(work.title) }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-rp-gray-700 text-left"
                    >
                      <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0 bg-gray-200 dark:bg-rp-gray-600">
                        {work.img_cid ? (
                          <img
                            src={ipfsConnector.getGatewayUrl(work.img_cid)}
                            alt={work.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <SearchIcon />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{work.title}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{work.creator_username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* No results */}
              {suggestions.creators.length === 0 && suggestions.works.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{t('header.noSuggestions')}</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Search input with dropdown ──────────────────────────────────────────────
interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onClear: () => void
  placeholder: string
  autoFocus?: boolean
}

const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, onSubmit, onClear, placeholder, autoFocus }) => {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load history when focused with no query
  useEffect(() => {
    if (focused && !value.trim()) {
      setHistory(privateDataMgr.getSearchHistory())
    }
  }, [focused, value])

  // Debounced live search
  useEffect(() => {
    if (!value.trim()) {
      setSuggestions(null)
      setLoading(false)
      return
    }
    setLoading(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const [creators, works] = await Promise.all([
          searchCreators(value, MAX_SUGGESTIONS),
          searchWorks(value, MAX_SUGGESTIONS),
        ])
        setSuggestions(splitLimit(creators, works))
      } catch {
        setSuggestions({ creators: [], works: [] })
      } finally {
        setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  const handleSelect = (selected: string) => {
    onChange(selected)
    setFocused(false)
    setSuggestions(null)
    // Trigger search immediately
    setTimeout(() => onSubmit(), 0)
  }

  const showDropdown = focused && (value.trim() ? true : history.length > 0)

  return (
    <div className="flex-1 relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter') { setFocused(false); onSubmit() } }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full px-4 py-2 border border-gray-300 dark:border-rp-gray-600 rounded-l-full bg-white dark:bg-rp-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
      />
      {value && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onClear() }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label={t('common.close')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {showDropdown && (
        <SearchDropdown
          query={value}
          suggestions={suggestions}
          history={history}
          loading={loading}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}

// ─── Main Header ──────────────────────────────────────────────────────────────
const Header: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const videosState = useAppSelector((state) => state.videos) as VideoState
  const { searchQuery } = videosState
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [showMobileSearch, setShowMobileSearch] = useState(false)

  const commitSearch = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    privateDataMgr.addSearchHistory(trimmed)
    dispatch(setSearchQuery(trimmed))
    dispatch(setCurrentPage('search'))
  }, [dispatch])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    commitSearch(localSearch)
    setShowMobileSearch(false)
  }

  const clearSearch = () => {
    setLocalSearch('')
    dispatch(setSearchQuery(''))
    dispatch(setCurrentPage('home'))
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white dark:bg-rp-gray-900 border-b border-gray-200 dark:border-rp-gray-700">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left - Logo and menu */}
        <div className="flex items-center space-x-4">
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-rp-gray-700"
          >
            <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center space-x-2">
            <Logo className="text-red-600 dark:text-red-500" width={28} height={28} />
            <span className="text-xl font-bold text-gray-900 dark:text-white hidden sm:block">{APP_CONFIG.NAME}</span>
          </div>
        </div>

        {/* Center - Search bar (desktop) */}
        <div className="flex-1 max-w-2xl mx-8 hidden md:block">
          <form onSubmit={handleSearch} className="flex">
            <SearchInput
              value={localSearch}
              onChange={setLocalSearch}
              onSubmit={() => commitSearch(localSearch)}
              onClear={clearSearch}
              placeholder={t('header.searchPlaceholder')}
            />
            <button
              type="submit"
              className="px-6 py-2 bg-gray-50 dark:bg-rp-gray-700 border border-l-0 border-gray-300 dark:border-rp-gray-600 rounded-r-full hover:bg-gray-100 dark:hover:bg-rp-gray-600"
            >
              <SearchIcon />
            </button>
          </form>
        </div>

        {/* Right - Mobile search button */}
        <div className="flex items-center space-x-2">
          <button
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-rp-gray-700 md:hidden"
            onClick={() => setShowMobileSearch(true)}
          >
            <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile search bar */}
      {showMobileSearch && (
        <div className="md:hidden bg-white dark:bg-rp-gray-900 border-t border-gray-200 dark:border-rp-gray-700 p-4">
          <form onSubmit={handleSearch} className="flex space-x-2">
            <button
              type="button"
              onClick={() => setShowMobileSearch(false)}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-rp-gray-700"
            >
              <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 flex">
              <SearchInput
                value={localSearch}
                onChange={setLocalSearch}
                onSubmit={() => { commitSearch(localSearch); setShowMobileSearch(false) }}
                onClear={clearSearch}
                placeholder={t('header.search')}
                autoFocus
              />
              <button
                type="submit"
                className="px-6 py-2 bg-gray-50 dark:bg-rp-gray-700 border border-l-0 border-gray-300 dark:border-rp-gray-600 rounded-r-full hover:bg-gray-100 dark:hover:bg-rp-gray-600"
              >
                <SearchIcon />
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  )
}

export default Header
