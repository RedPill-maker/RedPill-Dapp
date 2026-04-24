/**
 * Sidebar ads area component (refactored version) / サイドバー広告エリアコンポーネント（リファクタリング版）
 * Query the AdGroup of the passed creatorAddress and display the ad space list / 渡されたcreatorAddressのAdGroupをクエリして広告スペースリストを表示
 * Use ItemCard component to display ad spaces, click button to open AdModal / ItemCardコンポーネントを使用して広告スペースを表示し、ボタンをクリックしてAdModalを開く
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { adsMgr, AdSpace, AdGroup } from '../../utils/adsMgr'
import { ethers } from 'ethers'
import { walletMgr } from '../../utils/walletMgr'
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import AdModal from './AdModal'
import { privateDataMgr } from '../../utils/privateDataMgr'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'
import { getWorkByCid } from '../../utils/dbConnector'

interface SidebarAdsProps {
  creatorAddress: string
}

interface AdSpaceWithWork extends AdSpace {
  workTitle?: string
  workImgCid?: string
  workType?: number
}

const SidebarAds: React.FC<SidebarAdsProps> = ({ creatorAddress }) => {
  const { t } = useTranslation()
  const [adGroup, setAdGroup] = useState<AdGroup | null>(null)
  const [adSpaces, setAdSpaces] = useState<AdSpaceWithWork[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000))
  const [userWalletAddresses, setUserWalletAddresses] = useState<string[]>([])
  const [creatorUsername, setCreatorUsername] = useState('')

  // Rules modal state / ルールモーダル状態
  const [showRules, setShowRules] = useState(false)

  // AdModal state / AdModalの状態
  const [showAdModal, setShowAdModal] = useState(false)
  const [selectedAdSpaceId, setSelectedAdSpaceId] = useState<number | undefined>(undefined)
  const [lockedAddress, setLockedAddress] = useState<string | undefined>(undefined)

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    loadUserWallets()
    loadCreatorUsername()
  }, [])

  useEffect(() => {
    if (creatorAddress) loadAdGroup()
  }, [creatorAddress])

  const loadUserWallets = async () => {
    try {
      const wallets = await walletMgr.getWalletList()
      setUserWalletAddresses(wallets.map((w) => w.ethAddress.toLowerCase()))
    } catch {}
  }

  const loadCreatorUsername = () => {
    try {
      const creatorData = privateDataMgr.getCreatorInfo()
      if (creatorData && creatorData.mode === 'fvm') {
        setCreatorUsername(creatorData.username || '')
      }
    } catch {}
  }

  const loadAdGroup = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const group = await adsMgr.getAdGroupByCreator(creatorAddress)
      setAdGroup(group)
      if (group && group.exists) {
        const spaces = await adsMgr.getAdSpacesByGroup(group.adGroupId)
        
        // Load work info for each ad space / 各広告スペースの作品情報を読み込む
        const spacesWithWork = await Promise.all(
          spaces.map(async (space) => {
            if (space.targetCID) {
              try {
                const work = await getWorkByCid(space.targetCID)
                return {
                  ...space,
                  workTitle: work?.title,
                  workImgCid: work?.img_cid || undefined,
                  workType: work?.content_type,
                }
              } catch (err) {
                console.error(`Failed to load work info (CID: ${space.targetCID}):`, err)
                return space
              }
            }
            return space
          })
        )
        
        setAdSpaces(spacesWithWork)
      } else {
        setAdSpaces([])
      }
    } catch (err: any) {
      setError(err.message || t('sidebarAds.noAds'))
    } finally {
      setLoading(false)
    }
  }, [creatorAddress, t])

  const isAdWonByUser = (ad: AdSpace): boolean => {
    if (!ad.bidder || ad.bidder === ethers.ZeroAddress) return false
    const isUserBidder = userWalletAddresses.includes(ad.bidder.toLowerCase())
    // After auction ends (protectionExpiry passed), bidder has won / オークション終了後（protectionExpiry経過）、入札者が落札
    // Settlement window is protectionExpiry + 24 hours / 決済ウィンドウはprotectionExpiry + 24時間
    const settlementDeadline = Number(ad.protectionExpiry) + 24 * 60 * 60
    return isUserBidder && Number(ad.protectionExpiry) <= currentTime && currentTime <= settlementDeadline
  }

  const isAdBiddingByUser = (ad: AdSpace): boolean => {
    if (!ad.bidder || ad.bidder === ethers.ZeroAddress) return false
    return userWalletAddresses.includes(ad.bidder.toLowerCase()) && Number(ad.protectionExpiry) > currentTime
  }

  const getAdStatus = (ad: AdSpace): 'normal' | 'my-bid' | 'won' => {
    if (isAdWonByUser(ad)) return 'won'
    if (isAdBiddingByUser(ad)) return 'my-bid'
    return 'normal'
  }

  const handleCreateAd = () => {
    setSelectedAdSpaceId(undefined)
    setShowAdModal(true)
  }

  const handleAdPurchase = (adSpaceId: number, winnerAddress?: string) => {
    setSelectedAdSpaceId(adSpaceId)
    setLockedAddress(winnerAddress)
    setShowAdModal(true)
  }

  const handleModalSuccess = () => {
    setTimeout(() => loadAdGroup(), 2000)
  }

  // Convert AdSpace to ItemCardData / AdSpaceをItemCardDataに変換
  const convertAdSpaceToItemCard = (ad: AdSpaceWithWork): ItemCardData => {
    const status = getAdStatus(ad)
    
    return {
      id: ad.id.toString(),
      title: ad.workTitle || t('sidebarAds.adSpace', { id: ad.id }),
      desc: status === 'won'
        ? t('sidebarAds.bidSuccess')
        : ad.bidder && ad.bidder !== ethers.ZeroAddress
          ? t('sidebarAds.otherBidding')
          : t('sidebarAds.noBid'),
      type: ad.workType ?? 0,
      img_cid: ad.workImgCid || '',
      cid: ad.targetCID || '',
      adStatus: status,
      adWinnerAddress: status === 'won' ? ad.bidder : undefined,
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('sidebarAds.sectionTitle')}
          </span>
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 transition-colors"
          >
            {t('sidebarAds.rulesLink')}
          </button>
        </div>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {(!adGroup || !adGroup.exists || adSpaces.length === 0) && !error && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 text-center">
            <p className="text-gray-500 dark:text-gray-400">{t('sidebarAds.noAds')}</p>
          </div>
        )}

        {adSpaces.map((ad) => (
          <ItemCard
            key={ad.id}
            item={convertAdSpaceToItemCard(ad)}
            mode="ad"
            onAdPurchase={(item) => handleAdPurchase(ad.id, item.adWinnerAddress)}
          />
        ))}

        {/* Create ad space button / 広告スペース作成ボタン */}
        {adGroup && adGroup.exists && (
          <button onClick={handleCreateAd}
            className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white py-4 rounded-lg font-medium hover:from-green-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg">
            <div className="flex items-center justify-center space-x-2">
              <PlusIcon className="w-5 h-5" />
              <span>{t('sidebarAds.createYourAd')}</span>
            </div>
          </button>
        )}
      </div>

      {/* Ad rules modal / 広告ルールモーダル */}
      {showRules && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowRules(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
            style={{ maxHeight: '60vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t('sidebarAds.rulesModalTitle')}
              </h2>
              <button
                onClick={() => setShowRules(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-4">
              {['1','2','3','4','5','6','7'].map((n) => (
                <div key={n}>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
                    {t(`sidebarAds.rulesQ${n}`)}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {t(`sidebarAds.rulesA${n}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ad transaction modal / 広告トランザクションモーダル */}
      {showAdModal && adGroup && (
        <AdModal
          isOpen={showAdModal}
          onClose={() => setShowAdModal(false)}
          adGroupId={adGroup.adGroupId}
          creatorId={creatorUsername}
          adSpaceId={selectedAdSpaceId}
          lockedAddress={lockedAddress}
          onSuccess={handleModalSuccess}
        />
      )}
    </>
  )
}

export default SidebarAds
