/**
 * Latest Works component
 * Displays a list of works sorted by publish time
 */

import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BoltIcon } from '@heroicons/react/24/solid'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'
import { useBlacklist } from '../../hooks/useBlacklist'

const DB_API_BASE = 'http://localhost:3001'

interface LatestWorksProps {
  onCreatorClick?: (ipns: string) => void
}

const LatestWorks: React.FC<LatestWorksProps> = ({ onCreatorClick }) => {
  const [works, setWorks] = useState<ItemCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const { t } = useTranslation()
  const { filterItems } = useBlacklist()

  useEffect(() => {
    loadLatestWorks()
  }, [page])

  const loadLatestWorks = async () => {
    try {
      setLoading(true)
      const res = await fetch(
        `${DB_API_BASE}/api/works/latest?page=${page}&pageSize=20`,
      )
      const json = await res.json()

      if (json.success && json.data) {
        const items: ItemCardData[] = json.data.map((w: any) => ({
          id: w.cid,
          title: w.title || t('latestWorks.noTitle'),
          desc: w.description || '',
          type: w.content_type || 0,
          img_cid: w.img_cid || '',
          cid: w.cid,
          source_ipns: w.creator_wallet,
          creator_name: w.creator_username,
          creator_avatar_cid: w.creator_avatar || undefined,
          published_at: w.created_at || undefined,
        }))
        setWorks(items)
      }
    } catch (error) {
      console.error('Failed to load latest works:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center mb-6">
          <BoltIcon className="w-7 h-7 mr-3 text-yellow-500" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('latestWorks.title')}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md animate-pulse"
            >
              <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-t-lg" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center mb-6">
        <BoltIcon className="w-7 h-7 mr-3 text-yellow-500" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('latestWorks.title')}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {filterItems(works).map((item) => (
          <ItemCard key={item.id} item={item} onCreatorClick={onCreatorClick} />
        ))}
      </div>
      {works.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('latestWorks.empty')}
        </div>
      )}
    </div>
  )
}

export default LatestWorks
