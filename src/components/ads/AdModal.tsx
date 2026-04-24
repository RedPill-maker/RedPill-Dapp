/**
 * Ad modal component - unified handling of create, bid, and won modes / 広告モーダルコンポーネント - 作成、入札、落札モードの統一処理
 * 
 * Mode explanation: / モード説明：
 * - create: Create ad space mode (no adSpaceId) / 広告スペース作成モード（adSpaceIdなし）
 * - bid: Bidding mode (has adSpaceId, not won) / 入札モード（adSpaceIdあり、未落札）
 * - won: Won mode (has adSpaceId, already won) / 落札モード（adSpaceIdあり、既に落札）
 */

import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { adsMgr, AdSpace } from '../../utils/adsMgr'
import { ethers } from 'ethers'
import { getKnownTokens, IPFS_CONFIG } from '../../../config'
import WalletSelectorModal, { PaymentConfig, TransactionResult } from '../../global_modal/WalletSelectorModal'
import { getWorksByCreator, Work } from '../../utils/dbConnector'
import ItemCard from '../work_item/ItemCard'
import { XMarkIcon, TrophyIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface AdModalProps {
  isOpen: boolean
  onClose: () => void
  adGroupId: number
  creatorId: string // creator username
  adSpaceId?: number // optional, if set means bid/win mode, otherwise create mode
  lockedAddress?: string // optional, lock wallet selection to this address (for won mode)
  onSuccess?: () => void
}

type ModalMode = 'create' | 'bid' | 'won'
type Step = 'info' | 'publish'

const AdModal: React.FC<AdModalProps> = ({
  isOpen,
  onClose,
  adGroupId,
  creatorId,
  adSpaceId,
  lockedAddress,
  onSuccess
}) => {
  const { t } = useTranslation()
  
  // Mode determination / モード判定
  const [mode, setMode] = useState<ModalMode>('create')
  const [step, setStep] = useState<Step>('info')
  
  // Ad space data / 広告スペースデータ
  const [adSpace, setAdSpace] = useState<AdSpace | null>(null)
  const [loading, setLoading] = useState(false)
  
  // Bidding information / 入札情報
  const [bidAmount, setBidAmount] = useState('')
  const [currentPrice, setCurrentPrice] = useState('0')
  const [bidderAddress, setBidderAddress] = useState('')
  const [protectionExpiry, setProtectionExpiry] = useState(0)
  
  // Ad content / 広告コンテンツ
  const [contentCid, setContentCid] = useState('')
  const [selectedWork, setSelectedWork] = useState<Work | null>(null)
  const [creatorWorks, setCreatorWorks] = useState<Work[]>([])
  const [loadingWorks, setLoadingWorks] = useState(false)
  
  // Wallet modal / ウォレットモーダル
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  
  // Bidding rules text / 入札ルールテキスト
  const biddingRules = [
    t('ads.rule1'),
    t('ads.rule2'),
    t('ads.rule3'),
    t('ads.rule4'),
    t('ads.rule5'),
    t('ads.rule6'),
    t('ads.rule7')
  ]

  useEffect(() => {
    if (isOpen) {
      initModal()
    }
  }, [isOpen, adSpaceId])

  const initModal = async () => {
    setStep('info')
    setContentCid('')
    setSelectedWork(null)
    setBidAmount('')
    
    if (adSpaceId !== undefined) {
      // Bidding or won mode / 入札または落札モード
      await loadAdSpace()
    } else {
      // Create mode / 作成モード
      setMode('create')
      await loadCreationFee()
    }
    
    // Load creator works / クリエイター作品を読み込む
    await loadCreatorWorks()
  }

  const loadAdSpace = async () => {
    if (adSpaceId === undefined) return
    
    setLoading(true)
    try {
      const space = await adsMgr.getAdSpace(adSpaceId)
      setAdSpace(space)
      
      const currentValue = await adsMgr.getCurrentValue(adSpaceId)
      setCurrentPrice(currentValue)
      
      // Determine if bid or won mode / 入札モードか落札モードかを判定
      const now = Math.floor(Date.now() / 1000)
      const settlementDeadline = Number(space.protectionExpiry) + 24 * 60 * 60 // protectionExpiry + 24 hours / protectionExpiry + 24時間
      const isWon = space.bidder !== ethers.ZeroAddress && 
                    Number(space.protectionExpiry) <= now && 
                    now <= settlementDeadline
      
      setMode(isWon ? 'won' : 'bid')
      setBidderAddress(space.bidder)
      setProtectionExpiry(Number(space.protectionExpiry))
      
      // Set minimum bid / 最小入札を設定
      if (!isWon) {
        const minBid = space.bidAmount > 0n 
          ? ethers.formatEther(space.bidAmount) 
          : currentValue
        setBidAmount(minBid)
      }
    } catch (err) {
      console.error('Failed to load ad space:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadCreationFee = async () => {
    try {
      const constants = await adsMgr.getContractConstants()
      setCurrentPrice(constants.minPrice)
      setBidAmount(constants.minPrice)
    } catch (err) {
      console.error('Failed to load creation fee:', err)
    }
  }

  const loadCreatorWorks = async () => {
    setLoadingWorks(true)
    try {
      const works = await getWorksByCreator(creatorId, 1, 50)
      setCreatorWorks(works)
    } catch (err) {
      console.error('Failed to load works:', err)
    } finally {
      setLoadingWorks(false)
    }
  }

  const handleWorkSelect = (work: Work) => {
    setSelectedWork(work)
    setContentCid(work.cid)
  }

  const handleCidBlur = () => {
    // When CID input loses focus, if CID changed, clear selected work / CID入力がフォーカスを失ったとき、CIDが変わった場合は選択した作品をクリア
    if (selectedWork && selectedWork.cid !== contentCid) {
      setSelectedWork(null)
    }
  }

  const handleNextStep = () => {
    if (mode === 'bid') {
      // Bid mode: execute bid transaction / 入札モード：入札トランザクションを実行
      const config: PaymentConfig = {
        type: 'fixed',
        amount: bidAmount,
        token: getKnownTokens()[0].address,
        tokenSymbol: getKnownTokens()[0].symbol,
        description: t('ads.bidDesc', { id: adSpaceId })
      }
      setPaymentConfig(config)
      setShowWalletModal(true)
    } else {
      // Create or won mode: enter publish step / 作成または落札モード：発行ステップに進む
      setStep('publish')
    }
  }

  const handlePublish = () => {
    if (!contentCid) {
      alert(t('ads.cidRequired'))
      return
    }
    
    if (mode === 'create') {
      // Create ad space / 広告スペースを作成
      const config: PaymentConfig = {
        type: 'fixed',
        amount: bidAmount,
        token: getKnownTokens()[0].address,
        tokenSymbol: getKnownTokens()[0].symbol,
        description: t('ads.createDesc')
      }
      setPaymentConfig(config)
      setShowWalletModal(true)
    } else if (mode === 'won') {
      // Update ad content / 広告コンテンツを更新
      const config: PaymentConfig = {
        type: 'gas-only',
        token: getKnownTokens()[0].address,
        tokenSymbol: getKnownTokens()[0].symbol,
        description: t('ads.updateDesc', { id: adSpaceId })
      }
      setPaymentConfig(config)
      setShowWalletModal(true)
    }
  }

  const handleTransaction = async (
    address: string,
    password: string,
    amount?: string
  ): Promise<TransactionResult> => {
    try {
      let result
      
      if (mode === 'create') {
        // Create ad space / 広告スペースを作成
        result = await adsMgr.createAdSpace(
          address,
          password,
          adGroupId,
          contentCid,
          amount || bidAmount
        )
      } else if (mode === 'bid') {
        // Bid / 入札
        result = await adsMgr.bidAdSpace(
          address,
          password,
          adSpaceId!,
          amount || bidAmount
        )
      } else if (mode === 'won') {
        // Update ad content / 広告コンテンツを更新
        result = await adsMgr.updateAdContent(
          address,
          password,
          adSpaceId!,
          contentCid
        )
      } else {
        return { success: false, error: 'Unknown mode' }
      }
      
      if (result.success) {
        onSuccess?.()
        setTimeout(() => onClose(), 2000)
      }
      
      return {
        success: result.success,
        txHash: result.txHash,
        error: result.error,
        rawError: result.rawError
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  const getRemainingTime = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000)
    const remaining = timestamp - now
    if (remaining <= 0) return t('ads.expired')
    
    const days = Math.floor(remaining / 86400)
    const hours = Math.floor((remaining % 86400) / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    const seconds = remaining % 60
    
    if (days > 0) return `${days}${t('topAdBanner.time.days')}${hours}${t('topAdBanner.time.hours')}${minutes}${t('topAdBanner.time.minutes')}`
    if (hours > 0) return `${hours}${t('topAdBanner.time.hours')}${minutes}${t('topAdBanner.time.minutes')}`
    if (minutes > 0) return `${minutes}${t('topAdBanner.time.minutes')}${seconds}${t('topAdBanner.time.seconds')}`
    return `${seconds}${t('topAdBanner.time.seconds')}`
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          {/*Head */}
          <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-4 px-6 z-10">
            <div className="flex items-center justify-between">
              {/* Step indicator -centered */}
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center space-x-8">
                  {/* first step */}
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full border-4 transition-colors ${
                      step === 'info' 
                        ? 'border-blue-600 bg-blue-600' 
                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                    }`}></div>
                    <span className={`mt-1.5 text-sm font-medium ${step === 'info' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
                      {mode === 'create' ? t('ads.stepCreate') : mode === 'bid' ? t('ads.stepBid') : t('ads.stepWon')}
                    </span>
                  </div>
                  
                  {/*connecting line */}
                  <div className="w-32 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
                  
                  {/* Step 2 */}
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full border-4 transition-colors ${
                      step === 'publish' 
                        ? 'border-blue-600 bg-blue-600' 
                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                    }`}></div>
                    <span className={`mt-1.5 text-sm font-medium ${step === 'publish' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
                      {t('ads.stepPublish')}
                    </span>
                  </div>
                </div>
              </div>
              
              {/*Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-6 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* content area */}
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {/* Step 1: Bid to purchase/create advertising space/win */}
                {step === 'info' && (
                  <div className="space-y-6">
                    {/* Top information display */}
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-700">
                      {mode === 'create' && (
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {t('ads.creationFee')}: {currentPrice} FIL
                          </h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {t('ads.createNotice')}
                          </p>
                        </div>
                      )}
                      
                      {mode === 'bid' && adSpace && (
                        <div className="space-y-3">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {t('ads.currentBid')}: {currentPrice} FIL
                          </h3>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600 dark:text-gray-400">{t('ads.bidder')}:</span>
                              <span className="ml-2 text-gray-900 dark:text-white font-mono">
                                {bidderAddress === ethers.ZeroAddress ? t('ads.noBidder') : `${bidderAddress.slice(0, 6)}...${bidderAddress.slice(-4)}`}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600 dark:text-gray-400">{t('ads.bidExpiry')}:</span>
                              <span className="ml-2 text-gray-900 dark:text-white">
                                {getRemainingTime(protectionExpiry)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              {t('ads.yourBid')} (FIL)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min={currentPrice}
                              value={bidAmount}
                              onChange={(e) => setBidAmount(e.target.value)}
                              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t('ads.minBid')}: {currentPrice} FIL
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {mode === 'won' && adSpace && (
                        <div className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <TrophyIcon className="w-7 h-7 text-yellow-500" />
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {t('ads.congratsWon')}
                            </h3>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600 dark:text-gray-400">{t('ads.wonPrice')}:</span>
                              <span className="ml-2 text-green-600 dark:text-green-400 font-semibold">
                                {ethers.formatEther(adSpace.bidAmount)} FIL
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600 dark:text-gray-400">{t('ads.settlementDeadline')}:</span>
                              <span className="ml-2 text-orange-600 dark:text-orange-400 font-semibold">
                                {getRemainingTime(protectionExpiry + 24 * 60 * 60)}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-700">
                            <p className="text-sm text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
                              <ExclamationTriangleIcon className="w-4 h-4 shrink-0" /> {t('ads.settlementWarning')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/*Bidding instructions */}
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                        {t('ads.biddingRules')}:
                      </h4>
                      <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                        {biddingRules.map((rule, index) => (
                          <li key={index} className="flex items-start">
                            <span className="mr-2">{index + 1}.</span>
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/*Step 2: Advertisement release */}
                {step === 'publish' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: cid input and work selection */}
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t('ads.contentCid')}
                        </label>
                        <input
                          type="text"
                          value={contentCid}
                          onChange={(e) => setContentCid(e.target.value)}
                          onBlur={handleCidBlur}
                          placeholder="Qm..."
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {t('ads.selectWork')}
                        </label>
                        {loadingWorks ? (
                          <div className="text-center py-4 text-gray-500">{t('common.loading')}</div>
                        ) : creatorWorks.length === 0 ? (
                          <div className="text-center py-4 text-gray-500">{t('ads.noWorks')}</div>
                        ) : (
                          <div className="max-h-96 overflow-y-auto space-y-2 border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                            {creatorWorks.map((work) => (
                              <div
                                key={work.cid}
                                onClick={() => handleWorkSelect(work)}
                                className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-colors ${
                                  selectedWork?.cid === work.cid
                                    ? 'bg-blue-100 dark:bg-blue-900/30 border-2 border-blue-500'
                                    : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 border border-transparent'
                                }`}
                              >
                                {work.img_cid && (
                                  <img
                                    src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${work.img_cid}`}
                                    alt={work.title}
                                    className="w-16 h-16 object-cover rounded"
                                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {work.title}
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {work.cid.slice(0, 20)}...
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/*Right side: Work preview */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('ads.preview')}
                      </label>
                      {contentCid ? (
                        <ItemCard
                          mode="preview"
                          item={{
                            id: contentCid,
                            title: selectedWork?.title || '',
                            desc: selectedWork?.description || '',
                            type: selectedWork?.content_type || 0,
                            img_cid: selectedWork?.img_cid || '',
                            cid: contentCid,
                            creator_name: creatorId,
                            published_at: ''
                          }}
                        />
                      ) : (
                        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-12 text-center">
                          <p className="text-gray-500 dark:text-gray-400">{t('ads.selectOrInputCid')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/*Bottom button */}
          <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
            <button
              onClick={step === 'info' ? onClose : () => setStep('info')}
              className="px-6 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {step === 'info' ? t('common.cancel') : t('common.back')}
            </button>
            <button
              onClick={step === 'info' ? handleNextStep : handlePublish}
              disabled={loading || (step === 'info' && mode === 'bid' && !bidAmount)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === 'info' 
                ? (mode === 'bid' ? t('ads.submitBid') : t('common.nextStep'))
                : t('ads.publish')
              }
            </button>
          </div>
        </div>
      </div>

      {/*Wallet selection pop-up window */}
      {showWalletModal && paymentConfig && (
        <WalletSelectorModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          paymentConfig={paymentConfig}
          onConfirm={handleTransaction}
          allowedAddresses={lockedAddress ? [lockedAddress] : undefined}
          highlightAddress={lockedAddress}
        />
      )}
    </>
  )
}

export default AdModal
