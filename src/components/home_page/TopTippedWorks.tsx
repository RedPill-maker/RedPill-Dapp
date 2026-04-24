/**
 * Reward ranking component
 * Display the Top 12 works sorted by total reward amount
 * Rules: FIL and USDFC each take the top 6 and display them alternately. If there is insufficient, another token will be used to supplement it.
 */

import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FireIcon } from '@heroicons/react/24/solid'
import ItemCard, { ItemCardData, EpochRankInfo } from '../work_item/ItemCard'
import { APP_CONFIG, getKnownTokens } from '../../../config'
import { useBlacklist } from '../../hooks/useBlacklist'

const DB_API_BASE = 'http://localhost:3001'
const NATIVE_FIL_ADDRESS = getKnownTokens()[0].address
const USDFC_ADDRESS = getKnownTokens()[1]?.address

interface TopTippedWorksProps {
  claimedAfter?: number
  onCreatorClick?: (ipns: string) => void
}

const TopTippedWorks: React.FC<TopTippedWorksProps> = ({
  claimedAfter = 0,
  onCreatorClick,
}) => {
  const { t } = useTranslation()
  const [works, setWorks] = useState<ItemCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [epoch, setEpoch] = useState<number | null>(null)
  const { filterItems } = useBlacklist()

  useEffect(() => {
    loadTopTippedWorks()
  }, [claimedAfter])

  // Reload data when dbSync becomes ready
  useEffect(() => {
    const handleDbSyncReady = () => { loadTopTippedWorks() }
    window.addEventListener('dbsync-ready', handleDbSyncReady)
    return () => window.removeEventListener('dbsync-ready', handleDbSyncReady)
  }, [])

  const loadTopTippedWorks = async () => {
    try {
      setLoading(true)

      // Fetch top 6 works for both FIL and USDFC, plus jackpot info for epoch number
      // The server automatically scopes results to the current jackpot epoch
      const [filRes, usdfcRes, jackpotRes] = await Promise.all([
        fetch(`${DB_API_BASE}/api/works/top-tipped?token=${NATIVE_FIL_ADDRESS}&after=${claimedAfter}&limit=6`),
        fetch(`${DB_API_BASE}/api/works/top-tipped?token=${USDFC_ADDRESS}&after=${claimedAfter}&limit=6`),
        fetch(`${DB_API_BASE}/api/jackpots`),
      ])

      const filJson = await filRes.json()
      const usdfcJson = await usdfcRes.json()
      const jackpotJson = await jackpotRes.json()

      // Derive current epoch: take the max epoch across all jackpots
      if (jackpotJson.success && Array.isArray(jackpotJson.data) && jackpotJson.data.length > 0) {
        const maxEpoch = Math.max(...jackpotJson.data.map((j: any) => j.current_epoch ?? 1))
        setEpoch(maxEpoch)
      }

      const filWorks = filJson.success ? filJson.data : []
      const usdfcWorks = usdfcJson.success ? usdfcJson.data : []

      // Build a map keyed by cid, merging epoch rank info from both token lists
      const cidMap = new Map<string, ItemCardData>()

      const addToMap = (list: any[], token: string, rank: number) => {
        const w = list[rank]
        if (!w) return
        const rankInfo: EpochRankInfo = {
          token,
          rank: rank + 1,
          amount: w.total_tips ?? '0',
        }
        if (cidMap.has(w.cid)) {
          cidMap.get(w.cid)!.epochRanks!.push(rankInfo)
        } else {
          cidMap.set(w.cid, {
            id: w.cid,
            title: w.title || t('topTippedWorks.noTitle'),
            desc: w.description || '',
            type: w.content_type || 0,
            img_cid: w.img_cid || '',
            cid: w.cid,
            source_ipns: w.creator_wallet,
            creator_name: w.creator_username,
            creator_avatar_cid: w.creator_avatar || undefined,
            published_at: w.created_at || undefined,
            epochRanks: [rankInfo],
          })
        }
      }

      // Process FIL list first (rank 1..6), then USDFC (rank 1..6)
      for (let i = 0; i < filWorks.length; i++) addToMap(filWorks, 'FIL', i)
      for (let i = 0; i < usdfcWorks.length; i++) addToMap(usdfcWorks, 'USDFC', i)

      // Preserve interleaved order: walk both lists and insert into result preserving first-seen order
      const seen = new Set<string>()
      const ordered: ItemCardData[] = []
      const maxLen = Math.max(filWorks.length, usdfcWorks.length)
      for (let i = 0; i < maxLen; i++) {
        if (filWorks[i] && !seen.has(filWorks[i].cid)) {
          seen.add(filWorks[i].cid)
          ordered.push(cidMap.get(filWorks[i].cid)!)
        }
        if (usdfcWorks[i] && !seen.has(usdfcWorks[i].cid)) {
          seen.add(usdfcWorks[i].cid)
          ordered.push(cidMap.get(usdfcWorks[i].cid)!)
        }
      }

      setWorks(ordered.slice(0, APP_CONFIG.TOP_TIPPED_WORKS_LIMIT))
    } catch (error) {
      console.error('Failed to load tip rankings:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center mb-6">
          <FireIcon className="w-7 h-7 mr-3 text-orange-500" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {epoch != null ? t('topTippedWorks.titleWithEpoch', { epoch }) : t('topTippedWorks.title')}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
          {[1, 2, 3, 4].map((i) => (
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
        <FireIcon className="w-7 h-7 mr-3 text-orange-500" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {epoch != null ? t('topTippedWorks.titleWithEpoch', { epoch }) : t('topTippedWorks.title')}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {filterItems(works).map((item) => (
          <ItemCard key={item.id} item={item} onCreatorClick={onCreatorClick} />
        ))}
      </div>
      {works.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {t('topTippedWorks.empty')}
        </div>
      )}
    </div>
  )
}

export default TopTippedWorks
