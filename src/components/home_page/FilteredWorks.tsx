import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import ContentFilter, { FilterOptions } from './ContentFilter'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'
import { useBlacklist } from '../../hooks/useBlacklist'

const DB_API_BASE = 'http://localhost:3001'

interface FilteredWorksProps {
  onCreatorClick?: (ipns: string) => void
}

// Language detection utility
const detectLanguage = (text: string): string[] => {
  const languages: string[] = []
  if (/[\u4e00-\u9fff]/.test(text)) languages.push('zh-CN')
  if (/[a-zA-Z]/.test(text)) languages.push('en-US')
  return languages
}

const FilteredWorks: React.FC<FilteredWorksProps> = ({ onCreatorClick }) => {
  const [works, setWorks] = useState<ItemCardData[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [initialized, setInitialized] = useState(false)
  const { t } = useTranslation()
  const { filterItems } = useBlacklist()

  const observerRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef(false)
  const filterOptionsRef = useRef<FilterOptions>({ sortBy: 'latest', languages: [] })

  // Reload data when dbSync becomes ready
  useEffect(() => {
    const handleDbSyncReady = () => {
      if (initialized) {
        setWorks([])
        setPage(1)
        setHasMore(true)
        loadWorks(1, true)
      }
    }
    window.addEventListener('dbsync-ready', handleDbSyncReady)
    return () => window.removeEventListener('dbsync-ready', handleDbSyncReady)
  }, [initialized])

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingRef.current) {
          setPage(prev => prev + 1)
        }
      },
      { threshold: 0.1 }
    )
    if (observerRef.current) observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore])

  // Load more works when page increments beyond 1
  useEffect(() => {
    if (page > 1 && !isLoadingRef.current) {
      loadWorks(page, false)
    }
  }, [page])

  const loadWorks = async (pageNum: number, isReset: boolean) => {
    if (isLoadingRef.current) return
    isLoadingRef.current = true

    try {
      if (isReset) setLoading(true)
      else setLoadingMore(true)

      const filter = filterOptionsRef.current
      let endpoint: string
      if (filter.sortBy === 'latest') {
        endpoint = `/api/works/latest?page=${pageNum}&pageSize=20`
      } else {
        const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)
        endpoint = `/api/works/top-tipped?limit=100&after=${thirtyDaysAgo}`
      }

      const res = await fetch(`${DB_API_BASE}${endpoint}`)
      const json = await res.json()

      if (json.success && json.data) {
        let items: ItemCardData[] = json.data.map((w: any) => ({
          id: w.cid,
          title: w.title || t('common.unnamed'),
          desc: w.description || '',
          type: w.content_type || 0,
          img_cid: w.img_cid || '',
          cid: w.cid,
          source_ipns: w.creator_wallet,
          creator_name: w.creator_username,
          creator_avatar_cid: w.creator_avatar || undefined,
          published_at: w.created_at || undefined,
        }))

        if (filter.languages.length > 0) {
          items = items.filter(item => {
            const textToCheck = `${item.title} ${item.desc}`.toLowerCase()
            const detected = detectLanguage(textToCheck)
            return filter.languages.some(lang => detected.includes(lang))
          })
        }

        if (filter.sortBy === 'popularity') {
          const start = (pageNum - 1) * 20
          const end = pageNum * 20
          const pageItems = items.slice(start, end)
          if (isReset) setWorks(pageItems)
          else setWorks(prev => [...prev, ...pageItems])
          setHasMore(end < items.length && end < 100)
        } else {
          if (isReset) setWorks(items)
          else setWorks(prev => [...prev, ...items])
          setHasMore(json.data.length === 20)
        }
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load works:', error)
      setHasMore(false)
    } finally {
      setLoading(false)
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }

  const handleFilterChange = useCallback((options: FilterOptions) => {
    // On first mount, just record initial value; loading is controlled by initialized flag
    const isFirstCall = !initialized
    filterOptionsRef.current = options

    if (isFirstCall) {
      // First call: load directly
      setInitialized(true)
      setPage(1)
      setHasMore(true)
      loadWorks(1, true)
    } else {
      // Subsequent filter changes: reset and reload
      setWorks([])
      setPage(1)
      setHasMore(true)
      loadWorks(1, true)
    }
  }, [initialized])

  // Skeleton for content area only
  const renderSkeleton = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-md animate-pulse">
          <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-t-lg" />
          <div className="p-4 space-y-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Filter Component - always rendered, CSS sticky */}
      <ContentFilter
        onFilterChange={handleFilterChange}
      />

      {/* Content Area */}
      {loading ? renderSkeleton() : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
            {filterItems(works).map((item) => (
              <ItemCard key={item.id} item={item} onCreatorClick={onCreatorClick} />
            ))}
          </div>

          {works.length === 0 && !loadingMore && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <MagnifyingGlassIcon className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
              <p className="text-lg">{t('common.noContent')}</p>
              <p className="text-sm mt-2">{t('filteredWorks.adjustFilter')}</p>
            </div>
          )}
        </>
      )}

      {/* Loading More Indicator */}
      {loadingMore && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-md animate-pulse">
              <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-t-lg" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* End of Results */}
      {!hasMore && works.length > 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <p>{t('common.allLoaded')}</p>
        </div>
      )}

      {/* Intersection Observer Target */}
      <div ref={observerRef} className="h-4" />
    </div>
  )
}

export default FilteredWorks
