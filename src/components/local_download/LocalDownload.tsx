import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { getWorkByCid, getCreatorByUsername, WorkDetail } from '../../utils/dbConnector'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'
import LoadingSpinner from '../LoadingSpinner'

const LocalDownload: React.FC = () => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ItemCardData[]>([])

  useEffect(() => {
    loadDownloadedWorks()
  }, [])

  const loadDownloadedWorks = async () => {
    setLoading(true)
    try {
      const downloaded = privateDataMgr.getAllDownloaded()
      if (downloaded.length === 0) {
        setItems([])
        return
      }

      // Only query these CIDs, small amount, no concurrency issues
      const results = await Promise.allSettled(
        downloaded.map((d) => getWorkByCid(d.cid))
      )

      const works: WorkDetail[] = []
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          works.push(result.value)
        }
      })

  // Batch fetch creator avatars / クリエイターのアバターをバッチ取得
      const creatorMap = new Map<string, string | null>()
      await Promise.allSettled(
        [...new Set(works.map((w) => w.creator_username))].map(async (username) => {
          const creator = await getCreatorByUsername(username)
          creatorMap.set(username, creator?.avatar_cid ?? null)
        })
      )

      // Async check pin status (only query small amount of CIDs, no concurrency issues)
      const pinnedCids = await ipfsConnector.listPinnedFiles().catch(() => [] as string[])

      setItems(
        works.map((w) => ({
          id: w.cid,
          title: w.title,
          desc: w.description ?? '',
          type: w.content_type,
          img_cid: w.img_cid ?? '',
          cid: w.cid,
          creator_name: w.creator_username,
          creator_avatar_cid: creatorMap.get(w.creator_username) ?? undefined,
          published_at: w.created_at,
          isPinned: pinnedCids.includes(w.cid),
        }))
      )
    } catch (err) {
      console.error('Failed to load local downloads:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = (cid: string) => {
    privateDataMgr.removeDownloaded(cid)
    setItems((prev) => prev.filter((item) => item.cid !== cid))
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
          {t('localDownload.title')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">{t('localDownload.description')}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📥</div>
          <p className="text-gray-500 dark:text-gray-400">{t('localDownload.empty')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('localDownload.count', { count: items.length })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item) => (
              <ItemCard
                key={item.cid}
                item={item}
                onCacheStatusChange={(cid, isDownloaded) => {
                  if (!isDownloaded) handleRemove(cid)
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default LocalDownload
