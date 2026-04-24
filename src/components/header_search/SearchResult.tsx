import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSelector, useAppDispatch } from '../../hooks/redux'
import { VideoState } from '../../store/slices/videoSlice'
import { SidebarState } from '../../store/slices/sidebarSlice'
import { setCurrentPage } from '../../store/slices/pageSlice'
import {
  searchCreators,
  searchWorks,
  Work,
  Creator,
} from '../../utils/dbConnector'
import { ItemCardData } from '../work_item/ItemCard'
import CategoryGrid from '../CategoryGrid'
import CreatorSearchCard from './CreatorSearchCard'
import CIDResult from './CIDResult'
import CreatorList from './CreatorList'
import LoadingSpinner from '../LoadingSpinner'
import { useBlacklist } from '../../hooks/useBlacklist'
import {
  UserIcon,
  DocumentTextIcon,
  FaceFrownIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline'

interface SearchResults {
  creators: Creator[]
  works: Work[]
}

const SearchResult: React.FC = () => {
  const dispatch = useAppDispatch()
  const videosState = useAppSelector((state) => state.videos) as VideoState
  const sidebarState = useAppSelector((state) => state.sidebar) as SidebarState
  const { searchQuery } = videosState
  const { isOpen } = sidebarState

  const [searchResults, setSearchResults] = useState<SearchResults>({
    creators: [],
    works: [],
  })
  const [loading, setLoading] = useState(false)
  const [searchType, setSearchType] = useState<'keyword' | 'ipns' | 'cid'>('keyword')
  const { t } = useTranslation()
  const PAGE_SIZE = 60
  const { isCreatorBlacklisted, isWorkBlacklisted } = useBlacklist()

  useEffect(() => {
    if (!searchQuery) {
      dispatch(setCurrentPage('home'))
      return
    }
    performSearch()
  }, [searchQuery])

  const isCID = (query: string): boolean => {
    const cidV0Regex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
    const cidV1Regex = /^b[a-z2-7]{58}$/
    const cidV1Base58Regex = /^z[1-9A-HJ-NP-Za-km-z]{48,}$/
    const cidV1Base16Regex = /^f[0-9a-f]{76,}$/
    return (
      cidV0Regex.test(query) ||
      cidV1Regex.test(query) ||
      cidV1Base58Regex.test(query) ||
      cidV1Base16Regex.test(query)
    )
  }

  const isIPNSAddress = (query: string): boolean => {
    const ipnsRegex = /^k[0-9a-z]{50,}$/i
    if (query.startsWith('Qm') && query.length === 46) {
      return !isCID(query)
    }
    return ipnsRegex.test(query)
  }
  const performSearch = async () => {
    if (!searchQuery) return

    setLoading(true)
    try {
      if (isCID(searchQuery)) {
        setSearchType('cid')
        return
      } else if (isIPNSAddress(searchQuery)) {
        setSearchType('ipns')
        return
      } else {
        setSearchType('keyword')
        const [creators, works] = await Promise.all([
          searchCreators(searchQuery, PAGE_SIZE),
          searchWorks(searchQuery, PAGE_SIZE),
        ])
        setSearchResults({
          creators: creators || [],
          works: works || [],
        })
      }
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }

  // CID search: show database + IPFS results
  if (searchType === 'cid') {
    return <CIDResult />
  }

  // IPNS search: show creator page + IPFS results
  if (searchType === 'ipns') {
    return <CreatorList />
  }

  // Convert work data to ItemCard format
  const workItems: ItemCardData[] = searchResults.works
    .filter((work) => !isWorkBlacklisted(work.cid) && !isCreatorBlacklisted(work.creator_username))
    .map((work) => ({
      id: work.cid || `work_${Date.now()}_${Math.random()}`,
      title: work.title || t('searchResult.unnamedWork'),
      desc: work.description || t('common.noDescription'),
      type: work.content_type ?? 0,
      img_cid: work.img_cid || '',
      cid: work.cid || '',
      source_ipns: work.creator_username || undefined,
      creator_name: work.creator_username || undefined,
      published_at: work.created_at || undefined,
    }))

  const visibleCreators = searchResults.creators.filter((c) => !isCreatorBlacklisted(c.username))

  // Keyword search results
  return (
    <main
      className={`pt-20 pb-8 transition-all duration-300 ${
        isOpen ? 'lg:ml-60' : 'ml-0'
      }`}
    >
      <div className="px-4 md:px-6">
        {/* Search title */}
        <div className="mb-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('searchResult.title', { query: searchQuery })}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('searchResult.foundCount', { creatorCount: searchResults.creators.length, workCount: searchResults.works.length })}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/*Creator results */}
            {visibleCreators.length > 0 && (
              <div className="mb-8">
                <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                  <UserIcon className="w-5 h-5 mr-2" />
                  {t('searchResult.creators')} ({visibleCreators.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {visibleCreators.map((creator) => (
                    <CreatorSearchCard
                      key={creator.username}
                      creator={creator}
                    />
                  ))}
                </div>
              </div>
            )}

            {/*work results */}
            {searchResults.works.length > 0 && (
              <div>
                <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                  <DocumentTextIcon className="w-5 h-5 mr-2" />
                  {t('searchResult.works')} ({searchResults.works.length})
                </h3>
                <CategoryGrid
                  items={workItems}
                  emptyMessage={t('searchResult.noWorksFound')}
                  emptyIcon="🔍"
                />
              </div>
            )}

            {/*No results */}
            {visibleCreators.length === 0 &&
              workItems.length === 0 &&
              !loading && (
                <div className="text-center py-12">
                  <div className="flex justify-center mb-4">
                    <FaceFrownIcon className="w-16 h-16 text-gray-400 dark:text-gray-600" />
                  </div>
                  <div className="text-gray-900 dark:text-white text-lg font-medium mb-2">
                    {t('searchResult.noResults')}
                  </div>
                  <p className="text-gray-500 dark:text-gray-500 mb-6">
                    {t('searchResult.tryOtherKeywords')}
                  </p>
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 max-w-md mx-auto">
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center justify-center">
                      <LightBulbIcon className="w-4 h-4 mr-1" />
                      {t('searchResult.searchTips')}
                    </h4>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 text-left">
                      <li>• {t('searchResult.tip1')}</li>
                      <li>• {t('searchResult.tip2')}</li>
                      <li>• {t('searchResult.tip3')}</li>
                      <li>• {t('searchResult.tip4')}</li>
                    </ul>
                  </div>
                </div>
              )}
          </>
        )}
      </div>
    </main>
  )
}

export default SearchResult
