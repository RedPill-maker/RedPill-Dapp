import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getKnownTokens, IPFS_CONFIG, APP_CONFIG } from '../../../config'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { adsMgr, AdSpace, AdGroup } from '../../utils/adsMgr'
import { ethers } from 'ethers'
import { useAppSelector } from '../../hooks/redux'
import { useIpnsSync } from '../../hooks/useIpnsSync'
import LoadingSpinner from '../LoadingSpinner'
import CreatorPage from '../CreatorPage'
import IPFSSyncNotice from '../IPFSSyncNotice'
import WalletSelectorModal, { PaymentConfig, TransactionResult } from '../../global_modal/WalletSelectorModal'
import WorkEditModal from './WorkEditModal'
import TipsTab from './TipsTab'
import EditTab from './EditTab'
import { withCreatorCheck, CreatorCheckProps } from './withCreatorCheck'
import ChainModePrompt from './ChainModePrompt'
import { MegaphoneIcon, ExclamationTriangleIcon, ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { ItemCardData } from '../work_item/ItemCard'

interface SiteInfo {
  title: string
  desc: string
  bg_cid: string
  avatar_cid?: string
  username?: string
  items: ItemCardData[]
  works?: any[]
}

type TabType = 'home' | 'tips' | 'ads' | 'edit'

interface MyHomeProps extends CreatorCheckProps {}

interface AdSpaceWithContent extends AdSpace {
  title?: string
  description?: string
  imageCID?: string
}

// ==================== Ads tab content / 広告タブコンテンツ ====================

interface AdsTabContentProps {
  creatorInfo: ReturnType<typeof privateDataMgr.getCreatorInfo>
  adGroup: AdGroup | null
  adSpaces: AdSpaceWithContent[]
  adsLoading: boolean
  adGroupCreationFee: string
  showCreateAdGroupWallet: boolean
  setShowCreateAdGroupWallet: (v: boolean) => void
  onAdGroupCreated: () => void
  currentSiteInfo?: any
  onSuccess?: () => void
}

const AdsTabContent: React.FC<AdsTabContentProps> = ({
  creatorInfo, adGroup, adSpaces, adsLoading, adGroupCreationFee,
  showCreateAdGroupWallet, setShowCreateAdGroupWallet, onAdGroupCreated,
  currentSiteInfo, onSuccess,
}) => {
  const { t } = useTranslation()
  const isFvm = creatorInfo?.mode === 'fvm'
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const getRemainingTime = (expiry: bigint): string => {
    const remaining = Number(expiry) - currentTime
    if (remaining <= 0) return t('sidebarAds.expired')
    const d = Math.floor(remaining / 86400)
    const h = Math.floor((remaining % 86400) / 3600)
    const m = Math.floor((remaining % 3600) / 60)
    const s = remaining % 60
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const createAdGroupPaymentConfig: PaymentConfig = {
    type: 'fixed',
    amount: adGroupCreationFee,
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('myHome.ads.createAdGroupDesc'),
  }

  const handleCreateAdGroupConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    try {
      const result = await adsMgr.createAdGroup(address, password, adGroupCreationFee)
      if (result.success) {
        setTimeout(() => onAdGroupCreated(), 2000)
      }
      return { success: result.success, txHash: result.txHash, error: result.error, rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  if (adsLoading) {
    return <div className="text-center py-12"><LoadingSpinner /><p className="mt-4 text-gray-600 dark:text-gray-400">{t('common.loading')}</p></div>
  }

  // IPNS mode prompt / IPNS モードプロンプト
  if (!isFvm) {
    return <ChainModePrompt currentSiteInfo={currentSiteInfo} onSuccess={onSuccess} />
  }

  // No ad group - show creation interface / 広告グループなし - 作成インターフェースを表示
  if (!adGroup || !adGroup.exists) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <MegaphoneIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{t('myHome.ads.createTitle')}</h3>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
            <h4 className="font-medium text-yellow-900 dark:text-yellow-100 mb-2 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
              {t('myHome.ads.noticeTitle')}
            </h4>
            <ul className="text-sm text-yellow-800 dark:text-yellow-200 space-y-2">
              <li>• {t('myHome.ads.noticeReplace')}</li>
              <li>• {t('myHome.ads.noticeRevenue')}</li>
              <li>• {t('myHome.ads.noticeNoDelete')}</li>
            </ul>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600 dark:text-gray-400">{t('myHome.ads.creationFee')}</span>
              <span className="font-medium text-gray-900 dark:text-white">{adGroupCreationFee} FIL</span>
            </div>
          </div>

          <button onClick={() => setShowCreateAdGroupWallet(true)}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white py-3 rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all">
            {t('myHome.ads.createButton')}
          </button>
        </div>

        {showCreateAdGroupWallet && (
          <WalletSelectorModal
            isOpen={showCreateAdGroupWallet}
            onClose={() => setShowCreateAdGroupWallet(false)}
            paymentConfig={createAdGroupPaymentConfig}
            onConfirm={handleCreateAdGroupConfirm}
            highlightAddress={creatorInfo?.walletAddress}
            allowedAddresses={creatorInfo?.walletAddress ? [creatorInfo.walletAddress] : []}
          />
        )}
      </div>
    )
  }

  // Has ad group - show ad space list / 広告グループあり - 広告スペースリストを表示
  return (
    <div>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">{t('myHome.ads.groupTitle')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('myHome.ads.adCount', { count: adSpaces.length })}
            </p>
          </div>
          <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded-full font-medium">
            {t('myHome.ads.active')}
          </span>
        </div>
      </div>

      {adSpaces.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">{t('sidebarAds.noAds')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {adSpaces.map((ad) => (
            <div key={ad.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-start gap-4 p-4">
                {ad.imageCID && (
                  <img src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${ad.imageCID}`} alt={ad.title || `Ad ${ad.id}`}
                    className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.display = 'none' }} />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 dark:text-white truncate">
                    {ad.title || t('sidebarAds.adSpace', { id: ad.id })}
                  </h4>
                  {ad.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">{ad.description}</p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">{t('sidebarAds.currentPrice')}</span>
                      <span className="ml-1 font-medium text-gray-900 dark:text-white">
                        {ad.bidAmount > 0n ? ethers.formatEther(ad.bidAmount) : ethers.formatEther(ad.originalPrice)} FIL
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">{t('sidebarAds.protectionPeriod')}</span>
                      <span className="ml-1 font-medium text-gray-900 dark:text-white">{getRemainingTime(ad.protectionExpiry)}</span>
                    </div>
                    {ad.bidder && ad.bidder !== ethers.ZeroAddress && (
                      <>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">{t('myHome.ads.bidder')}</span>
                          <span className="ml-1 font-mono text-gray-900 dark:text-white">{ad.bidder.slice(0, 6)}...{ad.bidder.slice(-4)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">{t('sidebarAds.auctionDeadline')}</span>
                          <span className="ml-1 font-medium text-gray-900 dark:text-white">{getRemainingTime(ad.protectionExpiry)}</span>
                        </div>
                      </>
                    )}
                    {(!ad.bidder || ad.bidder === ethers.ZeroAddress) && (
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">{t('sidebarAds.statusLabel')}</span>
                        <span className="ml-1 text-gray-600 dark:text-gray-300">{t('sidebarAds.noBid')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== MyHome main component / MyHome メインコンポーネント ====================

const MyHomeContent: React.FC<MyHomeProps> = ({
  currentSiteInfo: initialSiteInfo,
  refreshCreatorStatus,
}) => {
  const { t } = useTranslation()
  const tipsBadgeCount = useAppSelector((state) => state.myHome.tipsBadgeCount)

  // Start background IPNS sync for IPNS mode creators
  const { syncStatus, setSyncStatus } = useIpnsSync()

  const VALID_TABS: TabType[] = ['home', 'tips', 'ads', 'edit']

  const getTabFromHash = (): TabType => {
    const hash = window.location.hash.slice(1)
    if (hash.startsWith('myHome/')) {
      const tab = hash.slice(7) as TabType
      return VALID_TABS.includes(tab) ? tab : 'home'
    }
    return 'home'
  }

  const [activeTab, setActiveTab] = useState<TabType>(getTabFromHash)

  // Keep hash in sync when activeTab changes (e.g. on mount with default 'home')
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const expected = activeTab === 'home' ? 'myHome' : `myHome/${activeTab}`
    if (hash !== expected) window.location.hash = expected
  }, [activeTab])
  const [currentSiteInfo, setCurrentSiteInfo] = useState<SiteInfo | null>(initialSiteInfo)
  const [loading, setLoading] = useState(true)
  const [showSyncNotice, setShowSyncNotice] = useState(false)
  const [syncNoticeType, setSyncNoticeType] = useState<'takedown' | 'edit'>('takedown')

  // IPNS works shown separately in FVM mode (for batch claim)
  const [showBatchClaimWallet, setShowBatchClaimWallet] = useState(false)

  // Home tab: pagination handled internally by CreatorPage / ホームタブ：ページネーションは CreatorPage 内部で処理

  // Takedown
  const [takedownWork, setTakedownWork] = useState<ItemCardData | null>(null)
  const [showTakedownWallet, setShowTakedownWallet] = useState(false)

  // Edit work / 作品を編集
  const [editWork, setEditWork] = useState<ItemCardData | null>(null)

  // Refresh key to trigger CreatorPage reload after IPNS edit/delete
  const [ipnsRefreshKey, setIpnsRefreshKey] = useState(0)

  // Ad group / 広告グループ
  const [adGroup, setAdGroup] = useState<AdGroup | null>(null)
  const [adSpaces, setAdSpaces] = useState<AdSpaceWithContent[]>([])
  const [adsLoading, setAdsLoading] = useState(false)
  const [showCreateAdGroupWallet, setShowCreateAdGroupWallet] = useState(false)
  const [adGroupCreationFee, setAdGroupCreationFee] = useState('0')

  useEffect(() => {
    loadCreatorWorks()
  }, [initialSiteInfo])

  useEffect(() => {
    loadAdGroupInfo()
  }, [])

  const loadAdGroupInfo = async () => {
    const ci = privateDataMgr.getCreatorInfo()
    if (!ci?.walletAddress) return
    setAdsLoading(true)
    try {
      const [group, fee] = await Promise.all([
        adsMgr.getAdGroupByCreator(ci.walletAddress),
        adsMgr.getAdGroupCreationFee(),
      ])
      setAdGroup(group)
      setAdGroupCreationFee(fee)
      if (group && group.exists) {
        const spaces = await adsMgr.getAdSpacesByGroup(group.adGroupId)
        
        // Load work info for each ad space (similar to SidebarAds)
        const { getWorkByCid } = await import('../../utils/dbConnector')
        const spacesWithContent = await Promise.all(
          spaces.map(async (space) => {
            if (space.targetCID) {
              try {
                const work = await getWorkByCid(space.targetCID)
                return {
                  ...space,
                  title: work?.title,
                  description: work?.description || undefined,
                  imageCID: work?.img_cid || undefined,
                }
              } catch (err) {
                console.error(`Failed to load work info (CID: ${space.targetCID}):`, err)
                return space
              }
            }
            return space
          })
        )
        
        setAdSpaces(spacesWithContent)
      }
    } catch (err) {
      console.error('Failed to load ad group info:', err)
    } finally {
      setAdsLoading(false)
    }
  }

  const loadCreatorWorks = async () => {
    setLoading(true)
    try {
      const creatorInfo = privateDataMgr.getCreatorInfo()
      if (!creatorInfo) { setLoading(false); return }
      // Just initialize siteInfo header — CreatorPage handles all work loading
      setCurrentSiteInfo({
        title: creatorInfo.title || t('myHome.title'),
        desc: creatorInfo.desc || t('myHome.welcome'),
        bg_cid: creatorInfo.backgroundCid || '',
        avatar_cid: creatorInfo.avatarCid || '',
        username: creatorInfo.username || '',
        items: [],
      })
    } catch (error) {
      console.error(t('myHome.loadWorksFailed'), error)
    } finally {
      setLoading(false)
    }
  }

  //Delete the work (deleteWork on the chain)
  const handleTakedown = (item: ItemCardData) => {
    if (item.isPending) return
    setTakedownWork(item)
    setShowTakedownWallet(true)
  }

  const takedownPaymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('myHome.takedownConfirm', { title: takedownWork?.title || '' }),
  }

  const handleTakedownConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    if (!takedownWork) return { success: false, error: 'No work selected' }
    try {
      const result = await creatorHubMgr.deleteWork(address, password, takedownWork.cid)
      if (result.success) {
        setCurrentSiteInfo((prev) =>
          prev ? { ...prev, items: prev.items.filter((i) => i.cid !== takedownWork.cid) } : prev,
        )
        setTakedownWork(null)
        setSyncNoticeType('takedown')
        setShowSyncNotice(true)
        setTimeout(() => setShowSyncNotice(false), 8000)
        return { success: true, txHash: result.txHash }
      }
      return { success: false, error: result.error, rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message, rawError: err }
    }
  }

  // Batch claim IPNS works on-chain (FVM mode)
  const batchClaimPaymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('myHome.publishAllToChain'),
  }

  const handleBatchClaimConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (!creatorInfo?.ipnsId) return { success: false, error: t('myHome.publishAllNone') }

    // Read works from cache (authoritative source)
    const cache = privateDataMgr.getIPNSSiteInfoCache()
    const worksToPublish: ItemCardData[] = (Array.isArray(cache?.data?.works) ? cache.data.works : [])
      .filter((w: any) => w.cid)
      .map((w: any) => ({ id: w.cid, title: w.title || '', desc: w.desc || '', type: w.type || 0, img_cid: w.img_cid || '', cid: w.cid, published_at: w.published_at || '' }))

    if (worksToPublish.length === 0) return { success: false, error: t('myHome.publishAllNone') }
    if (worksToPublish.length > 50) return { success: false, error: t('myHome.publishAllTooMany') }

    try {
      const result = await creatorHubMgr.batchClaimWorks(
        address, password,
        worksToPublish.map((w) => w.cid),
        worksToPublish.map((w) => w.title),
        worksToPublish.map((w) => w.desc),
        worksToPublish.map((w) => w.type),
        worksToPublish.map((w) => w.img_cid),
      )

      if (result.success) {
        // Remove published works from cache
        const publishedCids = new Set(worksToPublish.map((w) => w.cid))
        const updatedData = cache?.data
          ? { ...cache.data, works: (cache.data.works || []).filter((w: any) => !publishedCids.has(w.cid)) }
          : { works: [] }
        privateDataMgr.setIPNSSiteInfoCache(updatedData)
        setSyncStatus('pending')
        setIpnsRefreshKey((k) => k + 1)
        return { success: true, txHash: result.txHash }
      }
      return { success: false, error: result.error, rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message, rawError: err }
    }
  }

  // IPNS delete
  const handleDeleteIpnsItem = async (item: ItemCardData, _index: number) => {
    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (!creatorInfo?.ipnsId) return

    const confirmDelete = confirm(t('myHome.confirmDeleteWork', { title: item.title }))
    if (!confirmDelete) {
      throw new Error('cancelled')
    }

    // Update cache directly — sync hook will push to IPNS in background
    const cache = privateDataMgr.getIPNSSiteInfoCache()
    const currentWorks = Array.isArray(cache?.data?.works) ? cache.data.works : []
    const updatedWorks = currentWorks.filter((w: any) => w.cid !== item.cid)
    const updatedData = cache?.data ? { ...cache.data, works: updatedWorks } : { works: updatedWorks }
    privateDataMgr.setIPNSSiteInfoCache(updatedData)
    setSyncStatus('pending')

    setIpnsRefreshKey((k) => k + 1)
  }

  // Edit IPNS work metadata
  const handleEditIpnsItem = (item: ItemCardData) => {
    setEditWork(item)
  }

  // Save IPNS work edit — update cache, sync hook handles IPNS push
  const handleSaveIpnsEdit = async (updatedWork: { cid: string; title: string; description: string; img_cid: string }) => {
    const cache = privateDataMgr.getIPNSSiteInfoCache()
    const currentWorks = Array.isArray(cache?.data?.works) ? cache.data.works : []
    const updatedWorks = currentWorks.map((w: any) =>
      w.cid === updatedWork.cid
        ? { ...w, title: updatedWork.title, desc: updatedWork.description, img_cid: updatedWork.img_cid }
        : w,
    )
    const updatedData = cache?.data ? { ...cache.data, works: updatedWorks } : { works: updatedWorks }
    privateDataMgr.setIPNSSiteInfoCache(updatedData)
    setSyncStatus('pending')

    setEditWork(null)
    setIpnsRefreshKey((k) => k + 1)
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <LoadingSpinner />
        <p className="mt-4 text-gray-600 dark:text-gray-400">{t('myHome.loading')}</p>
      </div>
    )
  }

  if (!currentSiteInfo) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">{t('myHome.noContent')}</p>
      </div>
    )
  }

  const creatorInfo = privateDataMgr.getCreatorInfo()
  const isFvm = creatorInfo?.mode === 'fvm'


  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        {(['home', 'tips', 'ads', 'edit'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              window.location.hash = tab === 'home' ? 'myHome' : `myHome/${tab}`
            }}
            className={`relative px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t(`myHome.tabs.${tab}`)}
            {tab === 'tips' && tipsBadgeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center leading-none">
                {tipsBadgeCount > 99 ? '99+' : tipsBadgeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* IPNS sync status indicator */}
      {!isFvm && syncStatus === 'pending' && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg text-xs text-yellow-700 dark:text-yellow-300">
          <ArrowPathIcon className="w-4 h-4 flex-shrink-0 animate-spin" />
          {t('myHome.ipnsSyncPending')}
        </div>
      )}
      {!isFvm && syncStatus === 'synced' && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-xs text-green-700 dark:text-green-300">
          <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
          {t('myHome.ipnsSyncDone')}
        </div>
      )}

      {showSyncNotice && isFvm && (
        <div className="mb-6">
          <IPFSSyncNotice
            type="success"
            title={syncNoticeType === 'edit' ? t('myHome.editSuccess') : t('myHome.takedownSuccess')}
            message={syncNoticeType === 'edit' ? t('myHome.editSyncNotice') : t('myHome.deleteNotice')}
          />
        </div>
      )}

      {/* Home tab */}
      {activeTab === 'home' && (
        <div>
          {(() => {
            console.log('[MyHome] Rendering CreatorPage with:', {
              isFvm,
              username: isFvm ? (creatorInfo?.username || undefined) : undefined,
              ipnsId: isFvm ? (creatorInfo?.ipnsId || undefined) : (!isFvm ? (creatorInfo?.ipnsId || undefined) : undefined),
              hasIpnsId: !!creatorInfo?.ipnsId,
              creatorMode: creatorInfo?.mode,
              showBatchClaim: isFvm && creatorInfo?.ipnsId,
            })
            return null
          })()}
          <CreatorPage
            username={isFvm ? (creatorInfo?.username || undefined) : undefined}
            ipnsId={creatorInfo?.ipnsId || undefined}
            canEdit={true}
            refreshKey={ipnsRefreshKey}
            onDeleteItem={isFvm
              ? (item) => handleTakedown(item)
              : handleDeleteIpnsItem
            }
            onEditItem={isFvm ? (item) => setEditWork(item) : (item) => handleEditIpnsItem(item)}
            onBatchClaim={isFvm && creatorInfo?.ipnsId ? () => setShowBatchClaimWallet(true) : undefined}
          />
        </div>
      )}

      {/*tipping tab */}
      {activeTab === 'tips' && (
        <TipsTab badgeCount={tipsBadgeCount} currentSiteInfo={currentSiteInfo} onSuccess={refreshCreatorStatus} />
      )}

      {/* advertising tab */}
      {activeTab === 'ads' && (
        <AdsTabContent
          creatorInfo={creatorInfo}
          adGroup={adGroup}
          adSpaces={adSpaces}
          adsLoading={adsLoading}
          adGroupCreationFee={adGroupCreationFee}
          showCreateAdGroupWallet={showCreateAdGroupWallet}
          setShowCreateAdGroupWallet={setShowCreateAdGroupWallet}
          onAdGroupCreated={loadAdGroupInfo}
          currentSiteInfo={currentSiteInfo}
          onSuccess={refreshCreatorStatus}
        />
      )}

      {/*edit tab */}
      {activeTab === 'edit' && (
        <div className="max-w-xl mx-auto">
          <EditTab onSuccess={refreshCreatorStatus} currentSiteInfo={currentSiteInfo} />
        </div>
      )}

      {/* Remove WalletSelectorModal */}
      {showTakedownWallet && takedownWork && (
        <WalletSelectorModal
          isOpen={showTakedownWallet}
          onClose={() => { setShowTakedownWallet(false); setTakedownWork(null) }}
          paymentConfig={takedownPaymentConfig}
          onConfirm={handleTakedownConfirm}
          highlightAddress={creatorInfo?.walletAddress}
          allowedAddresses={creatorInfo?.walletAddress ? [creatorInfo.walletAddress] : []}
        />
      )}

      {/* Batch claim IPNS works WalletSelectorModal */}
      {showBatchClaimWallet && (
        <WalletSelectorModal
          isOpen={showBatchClaimWallet}
          onClose={() => setShowBatchClaimWallet(false)}
          paymentConfig={batchClaimPaymentConfig}
          onConfirm={handleBatchClaimConfirm}
          highlightAddress={creatorInfo?.walletAddress}
          allowedAddresses={creatorInfo?.walletAddress ? [creatorInfo.walletAddress] : []}
        />
      )}

      {/* Edit work modal */}
      {editWork && (
        isFvm ? (
          <WorkEditModal
            isOpen={!!editWork}
            onClose={() => setEditWork(null)}
            onSuccess={() => { setEditWork(null); loadCreatorWorks(); setSyncNoticeType('edit'); setShowSyncNotice(true); setTimeout(() => setShowSyncNotice(false), 8000) }}
            work={{
              cid: editWork.cid,
              title: editWork.title,
              description: editWork.desc,
              img_cid: editWork.img_cid,
              content_type: editWork.type,
            }}
          />
        ) : (
          <WorkEditModal
            isOpen={!!editWork}
            onClose={() => setEditWork(null)}
            onSuccess={() => {}}
            work={{
              cid: editWork.cid,
              title: editWork.title,
              description: editWork.desc,
              img_cid: editWork.img_cid,
              content_type: editWork.type,
            }}
            ipnsMode
            onIpnsSave={handleSaveIpnsEdit}
          />
        )
      )}
    </div>
  )
}

const MyHome = withCreatorCheck(MyHomeContent)

export default MyHome
