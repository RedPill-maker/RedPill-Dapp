import React, { useState, useEffect, useRef, useCallback } from 'react'
import { FilmIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { useAppDispatch } from '../../hooks/redux'
import { clearTipsBadge } from '../../store/slices/myHomeSlice'
import { setItemPage } from '../../store/slices/pageSlice'
import { getTipsByCreator, getWorkByCid } from '../../utils/dbConnector'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { getKnownTokens } from '../../../config'
import type { TipRecord, WorkDetail } from '../../utils/dbConnector'
import LoadingSpinner from '../LoadingSpinner'
import ChainModePrompt from './ChainModePrompt'
import { ethers } from 'ethers'

const PAGE_SIZE = 20

interface TipsTabProps {
  badgeCount: number
  currentSiteInfo?: any
  onSuccess?: () => void
}

const TipsTab: React.FC<TipsTabProps> = ({ badgeCount, currentSiteInfo, onSuccess }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const creatorInfo = privateDataMgr.getCreatorInfo()
  const isFvm = creatorInfo?.mode === 'fvm'
  const walletAddress = creatorInfo?.walletAddress || ''

  const [tips, setTips] = useState<TipRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [enabledTokens, setEnabledTokens] = useState<Set<string>>(
    new Set(getKnownTokens().map((tk) => tk.address)),
  )
  const [lastSeenBlock, setLastSeenBlock] = useState(0)
  // Cache work details keyed by work_cid
  const [workCache, setWorkCache] = useState<Record<string, WorkDetail | null>>({})

  const sentinelRef = useRef<HTMLDivElement>(null)
  const allTipsRef = useRef<TipRecord[]>([])

  useEffect(() => {
    if (!isFvm || !walletAddress) return
    setLastSeenBlock(privateDataMgr.getTipsLastSeen(walletAddress))
    loadTips()
  }, [isFvm, walletAddress])

  useEffect(() => {
    if (!isFvm || !walletAddress) return
    dispatch(clearTipsBadge())
  }, [])

  const loadTips = async () => {
    if (!walletAddress) return
    setLoading(true)
    try {
      const data = await getTipsByCreator(walletAddress, 500)
      allTipsRef.current = data
      setTips(data.slice(0, PAGE_SIZE))
      setPage(1)
      setHasMore(data.length > PAGE_SIZE)
      if (data.length > 0) {
        const maxBlock = Math.max(...data.map((t) => t.block_number))
        privateDataMgr.setTipsLastSeen(walletAddress, maxBlock)
      }
    } catch (e) {
      console.error('Failed to load tips:', e)
    } finally {
      setLoading(false)
    }
  }

  // Fetch work details for visible tips (batch, deduplicated)
  const fetchWorkDetails = useCallback(async (visibleTips: TipRecord[]) => {
    const missing = visibleTips
      .map((t) => t.work_cid)
      .filter((cid, i, arr) => arr.indexOf(cid) === i && !(cid in workCache))
    if (missing.length === 0) return
    const results = await Promise.all(missing.map((cid) => getWorkByCid(cid).catch(() => null)))
    setWorkCache((prev) => {
      const next = { ...prev }
      missing.forEach((cid, i) => { next[cid] = results[i] })
      return next
    })
  }, [workCache])

  // Fetch work details whenever visible tips change
  useEffect(() => {
    if (tips.length > 0) fetchWorkDetails(tips)
  }, [tips])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const nextPage = page + 1
          const all = allTipsRef.current.filter((tip) => enabledTokens.has(tip.token_address))
          const nextSlice = all.slice(0, nextPage * PAGE_SIZE)
          setTips(nextSlice)
          setPage(nextPage)
          setHasMore(nextSlice.length < all.length)
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loading, page, enabledTokens])

  const toggleToken = (addr: string) => {
    setEnabledTokens((prev) => {
      const next = new Set(prev)
      if (next.has(addr)) {
        if (next.size === 1) return prev
        next.delete(addr)
      } else {
        next.add(addr)
      }
      return next
    })
    // Re-filter from full dataset
    setPage(1)
  }

  // Re-apply filter when enabledTokens changes
  useEffect(() => {
    const filtered = allTipsRef.current.filter((tip) => enabledTokens.has(tip.token_address))
    setTips(filtered.slice(0, PAGE_SIZE))
    setHasMore(filtered.length > PAGE_SIZE)
    setPage(1)
  }, [enabledTokens])

  const getTokenSymbol = (addr: string) =>
    getKnownTokens().find((tk) => tk.address.toLowerCase() === addr.toLowerCase())?.symbol || addr.slice(0, 6)

  const formatAmount = (wei: string) => {
    try { return parseFloat(ethers.formatEther(wei)).toFixed(4) } catch { return wei }
  }

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString()

  const handleWorkClick = (tip: TipRecord) => {
    const work = workCache[tip.work_cid]
    dispatch(setItemPage({ cid: tip.work_cid, title: work?.title || tip.work_cid }))
  }

  if (!isFvm) {
    return <ChainModePrompt currentSiteInfo={currentSiteInfo} onSuccess={onSuccess} />
  }

  return (
    <div className="space-y-4">
      {/* Token filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">{t('myHome.tips.filterToken')}:</span>
        {getKnownTokens().map((tk) => (
          <label key={tk.address} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={enabledTokens.has(tk.address)}
              onChange={() => toggleToken(tk.address)}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">{tk.symbol}</span>
          </label>
        ))}
        {loading && <LoadingSpinner />}
      </div>

      {/* List */}
      {tips.length === 0 && !loading ? (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
          {t('myHome.tips.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {tips.map((tip) => {
            const isNew = tip.block_number > lastSeenBlock && lastSeenBlock > 0
            const work = workCache[tip.work_cid]
            const imgUrl = work?.img_cid ? ipfsConnector.getGatewayUrl(work.img_cid) : null

            return (
              <div
                key={tip.id}
                className={`p-3 rounded-lg border text-sm ${
                  isNew
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Work thumbnail + title */}
                  <button
                    onClick={() => handleWorkClick(tip)}
                    className="flex-shrink-0 w-16 h-12 rounded overflow-hidden bg-gray-200 dark:bg-gray-700 hover:opacity-80 transition-opacity"
                    title={work?.title || tip.work_cid}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} alt={work?.title || ''} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        {work === undefined ? (
                          <span className="text-xs">…</span>
                        ) : (
                          <FilmIcon className="w-5 h-5" />
                        )}
                      </div>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isNew && (
                            <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded">
                              {t('myHome.tips.new')}
                            </span>
                          )}
                          <button
                            onClick={() => handleWorkClick(tip)}
                            className="font-medium text-gray-900 dark:text-white truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
                            title={work?.title || tip.work_cid}
                          >
                            {work?.title || `${tip.work_cid.slice(0, 16)}...`}
                          </button>
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(tip.timestamp)}</span>
                        </div>
                        {tip.message && (
                          <p className="mt-1 text-gray-600 dark:text-gray-400 text-xs line-clamp-2 flex items-start gap-1">
                            <ChatBubbleLeftIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            {tip.message}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-gray-400">
                          {t('myHome.tips.from')}: {tip.tipper_address.slice(0, 10)}...{tip.tipper_address.slice(-6)}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-semibold text-green-600 dark:text-green-400">
                          +{formatAmount(tip.creator_share)} {getTokenSymbol(tip.token_address)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {t('myHome.tips.total')}: {formatAmount(tip.amount_sent)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {!hasMore && tips.length > 0 && (
        <p className="text-center text-xs text-gray-400 pb-2">{t('common.allLoaded')}</p>
      )}
    </div>
  )
}

export default TipsTab
