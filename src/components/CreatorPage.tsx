import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_CONFIG } from '../../config'
import { ipfsConnector } from '../utils/ipfsConnector'
import { privateDataMgr } from '../utils/privateDataMgr'
import { getCreatorByUsername, getWorksByCreator, Creator, Work } from '../utils/dbConnector'
import ItemCard, { ItemCardData } from './work_item/ItemCard'
import BoringAvatar from './BoringAvatar'
import LoadingSpinner from './LoadingSpinner'
import {
  ClipboardDocumentIcon,
  UserPlusIcon,
  UserMinusIcon,
  InboxIcon,
} from '@heroicons/react/24/outline'

interface SiteInfo {
  title?: string
  desc?: string
  bg_cid?: string
  avatar_cid?: string
  username?: string
  works?: any[]
  items?: ItemCardData[]
}

export interface CreatorPageProps {
  ipnsId?: string
  data?: SiteInfo
  username?: string
  canEdit?: boolean
  refreshKey?: number
  onDeleteItem?: (item: ItemCardData, index: number) => void
  onEditItem?: (item: ItemCardData) => void
  onBatchClaim?: () => void
}

const PAGE_SIZE = 20

const CreatorPage: React.FC<CreatorPageProps> = ({
  ipnsId,
  data,
  username,
  canEdit = false,
  refreshKey,
  onDeleteItem,
  onEditItem,
  onBatchClaim,
}) => {
  const { t } = useTranslation()
  const [creator, setCreator] = useState<Creator | null>(null)
  const [works, setWorks] = useState<Work[]>([]) // on-chain works
  const [ipnsWorks, setIpnsWorks] = useState<ItemCardData[]>([]) // IPNS works
  const [deletingCids, setDeletingCids] = useState<Set<string>>(new Set()) // Track deleting items
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [pageData, setPageData] = useState<SiteInfo | null>(data || null)
  const [loading, setLoading] = useState(false)
  const [loadingIpns, setLoadingIpns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Helper: convert site data works to ItemCardData array
  const buildIpnsWorksList = useCallback((siteData: SiteInfo, ipnsId: string): ItemCardData[] => {
    return (siteData.works || []).map((w: any, idx: number) => ({
      id: w.id || w.cid || String(idx),
      title: w.title || t('common.unnamed'),
      desc: w.desc || w.description || '',
      type: w.type ?? w.content_type ?? 0,
      img_cid: w.img_cid || '',
      cid: w.cid || '',
      source_ipns: ipnsId,
      creator_name: siteData.username || siteData.title,
      published_at: w.published_at || w.created_at,
      isPending: w.isPending,
    }))
  }, [t])

  const loadCreatorPage = useCallback(async (id: string) => {
    console.log('[CreatorPage] loadCreatorPage called with IPNS ID:', id)
    setError(null)

    // For the creator's own page (canEdit), use cache as authoritative source
    if (canEdit) {
      const cache = privateDataMgr.getIPNSSiteInfoCache()
      if (cache) {
        console.log('[CreatorPage] Using cache as authoritative source (IPNS mode)')
        setPageData(cache.data)
        setIpnsWorks(buildIpnsWorksList(cache.data, id))
        return
      }
    }

    // No cache (first load or non-owner) — fetch from network
    setLoadingIpns(true)
    try {
      const resolvedCid = await ipfsConnector.resolveIPNS(id)
      console.log('[CreatorPage] IPNS resolved to CID:', resolvedCid)
      const files = await ipfsConnector.listFiles(resolvedCid)
      const siteFile = files.find((f) => f.name === APP_CONFIG.SITE_FILE_NAME)
      if (!siteFile) {
        console.log('[CreatorPage] No site_info.json found')
        setError(t('creatorPage.notCreatorFolder'))
        return
      }
      const siteData = await ipfsConnector.downloadFileAsJSON<SiteInfo>(siteFile.hash)
      console.log('[CreatorPage] Loaded IPNS site data:', {
        title: siteData.title,
        worksCount: siteData.works?.length || 0,
      })
      // For own page with no cache yet, seed the cache from network
      if (canEdit) {
        privateDataMgr.setIPNSSiteInfoCache(siteData)
        privateDataMgr.markIPNSSiteInfoCacheSynced()
      }
      setPageData(siteData)
      setIpnsWorks(buildIpnsWorksList(siteData, id))
    } catch (err) {
      console.error('Failed to load creator page:', err)
      setError(t('common.loadFailed'))
    } finally {
      setLoadingIpns(false)
    }
  }, [t, canEdit, buildIpnsWorksList])

  const loadOnchainCreator = useCallback(async (uname: string, pg: number) => {
    setLoading(true)
    try {
      if (pg === 1) {
        const creatorData = await getCreatorByUsername(uname)
        console.log('[CreatorPage] Loaded creator data from database:', {
          username: creatorData?.username,
          hasIpnsAddress: !!creatorData?.ipns_address,
          ipnsAddress: creatorData?.ipns_address,
        })
        setCreator(creatorData)
        
        // Note: IPNS works are now loaded via ipnsId prop from privateDataMgr, not from database
        // This is more reliable as it doesn't depend on contract event sync
      }
      const newWorks = await getWorksByCreator(uname, pg, PAGE_SIZE)
      console.log('[CreatorPage] Loaded onchain works:', { count: newWorks.length, page: pg })
      setWorks((prev) => (pg === 1 ? newWorks : [...prev, ...newWorks]))
      setHasMore(newWorks.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load onchain creator:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    console.log('[CreatorPage] useEffect triggered with:', { username, ipnsId, hasData: !!data })
    
    if (username) {
      console.log('[CreatorPage] Loading onchain creator:', username)
      setPage(1); setWorks([]); setCreator(null); setIpnsWorks([])
      loadOnchainCreator(username, 1)
      setSubscribed(privateDataMgr.isSubscribedByUsernameOrIpns(username))
      
      // If ipnsId is provided (from privateDataMgr), load IPNS works directly
      if (ipnsId) {
        console.log('[CreatorPage] IPNS ID provided from privateDataMgr, loading IPNS works:', ipnsId)
        loadCreatorPage(ipnsId)
      }
    } else if (ipnsId && !data) {
      console.log('[CreatorPage] Loading IPNS creator:', ipnsId)
      loadCreatorPage(ipnsId)
      setSubscribed(privateDataMgr.isSubscribed(ipnsId))
    } else if (data) {
      console.log('[CreatorPage] Using provided data')
      setPageData(data)
      setIpnsWorks(buildIpnsWorksList(data, ipnsId || ''))
    }
  }, [username, ipnsId, data, refreshKey, t, buildIpnsWorksList, loadCreatorPage, loadOnchainCreator])

  const handleSubscribeToggle = () => {
    if (username) {
      if (subscribed) {
        privateDataMgr.removeSubscriptionByUsernameOrIpns(username)
        setSubscribed(false)
      } else {
        privateDataMgr.addSubscriptionEx({
          username,
          ipns: creator?.ipns_address || '',
          title: creator?.title || username,
          desc: creator?.description || '',
        })
        setSubscribed(true)
      }
    } else if (ipnsId) {
      if (subscribed) {
        privateDataMgr.removeSubscription(ipnsId)
        setSubscribed(false)
      } else {
        privateDataMgr.addSubscription(ipnsId, pageData?.title, pageData?.desc)
        setSubscribed(true)
      }
    }
  }

  const handleCopyIpns = async () => {
    const toCopy = ipnsId || creator?.ipns_address || ''
    if (!toCopy) return
    try {
      await navigator.clipboard.writeText(toCopy)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch { /* ignore */ }
  }

  const handleLoadMore = () => {
    if (!username || loading || !hasMore) return
    const next = page + 1
    setPage(next)
    loadOnchainCreator(username, next)
  }

  // Wrapper for delete with optimistic update
  const handleDeleteWithOptimisticUpdate = async (item: ItemCardData, index: number) => {
    if (deletingCids.has(item.cid)) return // Prevent duplicate operations

    // Mark as deleting
    setDeletingCids((prev) => new Set(prev).add(item.cid))

    try {
      // Call parent delete handler first (may show confirm dialog)
      if (onDeleteItem) {
        await onDeleteItem(item, index)
      }
      // Only remove from UI after parent handler succeeds (no exception)
      setIpnsWorks((prev) => prev.filter((w) => w.cid !== item.cid))
    } catch (err) {
      // Rollback on error - reload works
      console.error('Delete failed, reloading:', err)
      if (ipnsId) {
        loadCreatorPage(ipnsId)
      }
    } finally {
      // Remove from deleting set
      setDeletingCids((prev) => {
        const next = new Set(prev)
        next.delete(item.cid)
        return next
      })
    }
  }

  const renderHeader = (
    avatarCid: string | null | undefined,
    bgCid: string | null | undefined,
    title: string | null | undefined,
    subtitle: string | null | undefined,
    description: string | null | undefined,
    ipnsAddress: string | null | undefined,
    hashKey: string,
  ) => {
    const bgUrl = bgCid ? ipfsConnector.getGatewayUrl(bgCid) : null
    const avatarUrl = avatarCid && !avatarError ? ipfsConnector.getGatewayUrl(avatarCid) : null

    return (
      <div className="relative pb-8">
        {/* Background image — tall, bleeds into works area */}
        <div className="absolute inset-x-0 top-0 h-[22rem] md:h-[26rem] z-0 bg-gradient-to-r from-blue-500 to-purple-600 overflow-hidden">
          {bgUrl && (
            <img
              src={bgUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => {}}
            />
          )}
          {/* bottom fade — blends into page bg */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-gray-50 dark:to-gray-900" />
        </div>

        {/* Avatar + info — sits over background */}
        <div className="relative z-10 px-6 pt-44 md:pt-52 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <div className="w-20 h-20 rounded-full border-4 border-white/80 dark:border-gray-800/80 shadow-lg overflow-hidden bg-gray-200 dark:bg-gray-700">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={t('creatorPage.avatarAlt')}
                    className="w-full h-full object-cover"
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <BoringAvatar hash={hashKey} size={80} variant="beam" />
                )}
              </div>
            </div>

            {/* Info — frosted glass pill */}
            <div className="mt-3 sm:mt-0 flex-1 min-w-0 backdrop-blur-md bg-white/50 dark:bg-gray-900/50 border border-white/30 dark:border-gray-700/40 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {title && (
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                      {title}
                    </h1>
                  )}
                  {subtitle && (
                    <h2 className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      @{subtitle}
                    </h2>
                  )}
                  {description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                      {description}
                    </p>
                  )}
                  {ipnsAddress && (
                    <button
                      onClick={handleCopyIpns}
                      className="mt-1 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      title={t('creatorPage.copyIpnsId')}
                    >
                      <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                      {copySuccess ? t('common.copySuccess') : `${ipnsAddress.substring(0, 20)}...`}
                    </button>
                  )}
                </div>

                {/* Subscribe button */}
                {!canEdit && (ipnsId || username) && (
                  <button
                    onClick={handleSubscribeToggle}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      subscribed
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {subscribed ? (
                      <>
                        <UserMinusIcon className="w-4 h-4" />
                        {t('subscribe.unsubscribe')}
                      </>
                    ) : (
                      <>
                        <UserPlusIcon className="w-4 h-4" />
                        {t('creatorList.subscribe')}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderWorks = (items: ItemCardData[]) => {
    // Filter out items that are being deleted
    const visibleItems = items.filter((item) => !deletingCids.has(item.cid))

    if (visibleItems.length === 0 && !loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <InboxIcon className="w-12 h-12 mb-3" />
          <p>{t('creatorPage.noContent')}</p>
        </div>
      )
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {visibleItems.map((item, idx) => (
          <ItemCard
            key={item.id || idx}
            item={item}
            mode={canEdit ? 'editable' : 'default'}
            onDelete={canEdit && !username ? (it) => handleDeleteWithOptimisticUpdate(it, idx) : onDeleteItem ? (it) => onDeleteItem(it, idx) : undefined}
            onEdit={onEditItem}
          />
        ))}
      </div>
    )
  }

  // ---- onchain mode ----
  if (username) {
    if (loading && !creator) {
      return (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner />
          <span className="ml-3 text-gray-500 dark:text-gray-400">{t('creatorPage.loading')}</span>
        </div>
      )
    }

    if (!loading && !creator) {
      return (
        <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
          {t('creatorPage.notFound')}
        </div>
      )
    }

    const onchainItems: ItemCardData[] = works.map((w) => ({
      id: w.cid,
      title: w.title,
      desc: w.description || '',
      type: w.content_type,
      img_cid: w.img_cid || '',
      cid: w.cid,
      creator_name: w.creator_username,
      published_at: w.created_at,
    }))

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {creator && renderHeader(
          creator.avatar_cid,
          creator.background_cid,
          creator.title || creator.username,
          creator.username,
          creator.description,
          creator.ipns_address,
          creator.username,
        )}

        <div className="px-6 py-6">
          {/* On-chain works */}
          {works.length > 0 && (
            <>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                {t('creatorPage.onchainWorks')}
              </h2>
              {renderWorks(onchainItems)}

              {hasMore && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-full text-sm font-medium transition-colors"
                  >
                    {loading ? t('common.loading') : t('common.loadMore')}
                  </button>
                </div>
              )}
              {!hasMore && (
                <p className="text-center text-sm text-gray-400 dark:text-gray-500 mt-8">
                  {t('common.allLoaded')}
                </p>
              )}
            </>
          )}

          {/* IPNS works */}
          {(() => {
            console.log('[CreatorPage] Rendering IPNS works section:', {
              ipnsWorksLength: ipnsWorks.length,
              onchainWorksLength: works.length,
              hasOnBatchClaim: !!onBatchClaim,
            })
            return ipnsWorks.length > 0 && (
              <div className={works.length > 0 ? 'mt-12' : ''}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {t('creatorPage.ipnsWorks')}
                  </h2>
                  {onBatchClaim && (
                    <button
                      onClick={onBatchClaim}
                      className="ml-auto px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      {t('myHome.publishAllToChain')}
                    </button>
                  )}
                </div>
                {loadingIpns ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner />
                    <span className="ml-3 text-gray-500 dark:text-gray-400">{t('creatorPage.loading')}</span>
                  </div>
                ) : (
                  renderWorks(ipnsWorks)
                )}
              </div>
            )
          })()}

          {/* No work prompt */}
          {works.length === 0 && ipnsWorks.length === 0 && !loading && !loadingIpns && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <InboxIcon className="w-12 h-12 mb-3" />
              <p>{t('creatorPage.noContent')}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- IPNS / data mode ----
  if (loadingIpns && !pageData) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner />
        <span className="ml-3 text-gray-500 dark:text-gray-400">{t('creatorPage.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500 dark:text-red-400">
        {error}
      </div>
    )
  }

  if (!pageData) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        {t('creatorPage.noData')}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {renderHeader(
        pageData.avatar_cid,
        pageData.bg_cid,
        pageData.title,
        pageData.username,
        pageData.desc,
        ipnsId,
        ipnsId || pageData.username || 'creator',
      )}
      <div className="px-6 py-6">
        {renderWorks(ipnsWorks)}
      </div>
    </div>
  )
}

export default CreatorPage
