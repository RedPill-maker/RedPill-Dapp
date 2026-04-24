/**
 * WorkPublish - Step-by-step work publishing component
 *
 * Step flow:
 * 1. Upload work - IPFSDropzone uploads content file
 * 2. Complete info - Title, description, thumbnail
 * 3. Complete publish - Preview and publish to chain (optional async storage to Filecoin)
 */

import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { useAppSelector } from '../../hooks/redux'
import { ITEM_TYPE, getKnownTokens, IPFS_CONFIG, APP_CONFIG, SITE_INFO_TEMPLATE, SiteWork } from '../../../config'
import CreatorHubABI from '../../../contract_info/CreatorHub_abi.json'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { rpcConnectorInstance, getCreatorHubAddress } from '../../utils/rpcConnector'
import { ipfsConnector } from '../../utils/ipfsConnector'
import { fileStoreMgr } from '../../utils/fileStoreMgr'
import { DropzoneFileMetadata } from '../IPFSDropzone'
import { ItemCardData } from '../work_item/ItemCard'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
  GasEstimateCallback,
} from '../../global_modal/WalletSelectorModal'
import { notify } from '../../global_modal/ToastNotification'
import { withCreatorCheck, CreatorCheckProps } from './withCreatorCheck'
import ChainStorage from './ChainStorage'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  StepIndicator,
  StepUpload,
  StepInfo,
  StepPublish,
} from './WorkPublishSteps'

interface WorkPublishProps extends CreatorCheckProps {}

const WorkPublishContent: React.FC<WorkPublishProps> = ({
  refreshCreatorStatus,
}) => {
  const { t } = useTranslation()
  const unstoredBadgeCount = useAppSelector((state) => state.chainStorage.unstoredBadgeCount)
  // Tab selection
  const [activeTab, setActiveTab] = useState<'publish' | 'storage'>('publish')
  const [unstoredCount, setUnstoredCount] = useState(0)

  const [currentStep, setCurrentStep] = useState(0)

  // Step 1
  const [contentCid, setContentCid] = useState('')
  const [contentMeta, setContentMeta] = useState<DropzoneFileMetadata | null>(null)

  // Step 2
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contentType, setContentType] = useState(0)
  const [thumbnailCid, setThumbnailCid] = useState('')
  const [thumbnailMeta, setThumbnailMeta] = useState<DropzoneFileMetadata | null>(null)
  const [autoThumbnailUploading, setAutoThumbnailUploading] = useState(false)

  // Step 3 (publish)
  const [showPublishWallet, setShowPublishWallet] = useState(false)
  const [published, setPublished] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [storeToChain, setStoreToChain] = useState(true) // async store to Filecoin after publish

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const creatorInfo = privateDataMgr.getCreatorInfo()

  // ==================== Step 1 ====================

  const handleContentMetadata = (meta: DropzoneFileMetadata | null) => {
    setContentMeta(meta)
    if (meta?.cid) {
      setContentCid(meta.cid)
      const typeIndex = ITEM_TYPE.findIndex((t) => t.name === meta.type)
      if (typeIndex !== -1) setContentType(typeIndex)
      if (!title.trim() && meta.fileName) {
        setTitle(meta.fileName.replace(/\.[^/.]+$/, '').slice(0, 64))
      }
    }
  }

  // ==================== Step 2 ====================

  const extractVideoThumbnail = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) return
    setAutoThumbnailUploading(true)
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true

      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error(t('workPublish.videoLoadFailed')))
        video.src = url
      })

      video.currentTime = 0.1
      await new Promise<void>((r) => { video.onseeked = () => r() })

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      URL.revokeObjectURL(url)

      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, 'image/jpeg', 0.85),
      )
      if (!blob) return

      const result = await ipfsConnector.uploadFileDirectly(
        new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }),
      )
      if (result.hash) {
        setThumbnailCid(result.hash)
        setThumbnailMeta({
          cid: result.hash,
          type: 'img',
          fileName: 'thumbnail.jpg',
          fileSize: blob.size,
          mimeType: 'image/jpeg',
          previewUrl: `${IPFS_CONFIG.GATEWAY_URL}/ipfs/${result.hash}`,
        })
      }
    } catch (err) {
      console.warn(t('workPublish.videoThumbnailFailed'), err)
    } finally {
      setAutoThumbnailUploading(false)
    }
  }, [])

  const handleThumbnailMetadata = (meta: DropzoneFileMetadata | null) => {
    setThumbnailMeta(meta)
    if (meta?.cid) setThumbnailCid(meta.cid)
  }

  // ==================== Step 3: Publish ====================

  const isIpnsMode = creatorInfo?.mode === 'ipns'
  const filecoinPayEnabled = creatorInfo?.filecoinPayEnabled || false

  // Initialize storeToChain state (default checked if FilecoinPay is enabled)
  React.useEffect(() => {
    if (filecoinPayEnabled && !isIpnsMode) {
      setStoreToChain(true)
    }
  }, [filecoinPayEnabled, isIpnsMode])

  const publishPaymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('workPublish.claimOwnership', { title: title || t('common.unnamed') }),
  }

  const handleClaimWork = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      const result = await creatorHubMgr.claimWork(
        address, password, contentCid, title, description, contentType, thumbnailCid,
      )
      if (result.success) {
        setPublished(true)
        await refreshCreatorStatus()
        setSuccess(t('workPublish.workPublishedSuccess', { title }))

        // Async store to Filecoin if checked (progress tracked by singleton)
        if (storeToChain) {
          const cidsToStore = [contentCid]
          if (thumbnailCid) cidsToStore.push(thumbnailCid)

          // Ensure Synapse is initialized for this wallet
          if (!fileStoreMgr.hasSynapse(address)) {
            await fileStoreMgr.initSynapse(address, password)
          }

          // Fire-and-forget — progress is tracked by fileStoreMgr singleton
          // and visible in ChainStorage via subscription
          fileStoreMgr.storeContent(cidsToStore, address, password)
            .then((storageResults) => {
              const results = Array.isArray(storageResults) ? storageResults : [storageResults]
              const successCount = results.filter((r) => r.success).length
              const failedCount = results.filter((r) => !r.success).length

              // Save successful mappings locally
              if (creatorInfo?.username) {
                for (const r of results) {
                  if (r.success && r.pieceCid) {
                    privateDataMgr.addStoredCid(creatorInfo.username, r.cid, r.pieceCid, undefined, r.dataSetId)
                  }
                }
              }

              if (successCount > 0) {
                const failedMsg = failedCount > 0 ? String(t('workPublish.storageFilesFailed', { count: failedCount })) : ''
                const msg = String(t('workPublish.storageFilesSubmitted', { success: successCount, failed: failedMsg }))
                notify(msg).success(msg)
              } else {
                const errMsg = String(t('workPublish.storageFailed'))
                notify(errMsg).error(errMsg)
              }
            })
            .catch((err) => {
              console.error('Async storage failed:', err)
              const errMsg = String(t('workPublish.storageFailed'))
              notify(errMsg).error(errMsg)
            })
        }
      }
      return { success: result.success, txHash: result.txHash, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message || t('workPublish.publishFailed') }
    }
  }

  const handleClaimGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      const contract = new ethers.Contract(getCreatorHubAddress(), CreatorHubABI, rpcConnectorInstance.getProvider())
      const data = contract.interface.encodeFunctionData('claimWork', [
        contentCid,
        title,
        description,
        contentType,
        thumbnailCid
      ])
      return await rpcConnectorInstance.estimateContractGas(address, getCreatorHubAddress(), data, 0n)
    } catch (err: any) {
      console.error('Failed to estimate gas for claim work:', err)
      return { success: false, error: err.message }
    }
  }

  const handleIpnsPublish = async () => {
    if (!creatorInfo?.ipnsId) {
      setError(t('workPublish.ipnsPublishFailed'))
      return
    }
    setError(null)
    setIsPublishing(true)
    try {
      // Build new work entry
      const newWork: SiteWork = {
        title,
        desc: description,
        type: contentType,
        img_cid: thumbnailCid,
        cid: contentCid,
        published_at: new Date().toISOString(),
      }

      // Read current cache (authoritative source) and prepend new work
      const cache = privateDataMgr.getIPNSSiteInfoCache()
      const currentData = cache?.data || { ...SITE_INFO_TEMPLATE, works: [] }
      const updatedData = {
        ...currentData,
        works: [newWork, ...(Array.isArray(currentData.works) ? currentData.works : [])],
      }

      // Write to cache — sync hook will push to IPNS in background
      privateDataMgr.setIPNSSiteInfoCache(updatedData)

      setPublished(true)
      await refreshCreatorStatus()
      const successMsg = t('workPublish.ipnsPublishedCached', { title })
      setSuccess(successMsg)
    } catch (err: any) {
      const errMsg = err.message || t('workPublish.ipnsPublishFailed')
      setError(errMsg)
    } finally {
      setIsPublishing(false)
    }
  }

  // ==================== Navigation ====================

  const handleReset = () => {
    setCurrentStep(0)
    setContentCid('')
    setContentMeta(null)
    setTitle('')
    setDescription('')
    setContentType(0)
    setThumbnailCid('')
    setThumbnailMeta(null)
    setPublished(false)
    setIsPublishing(false)
    setStoreToChain(filecoinPayEnabled && !isIpnsMode)
    setError(null)
    setSuccess(null)
  }

  const goNext = () => {
    if (currentStep < 2) { setCurrentStep(currentStep + 1); setError(null) }
  }
  const goPrev = () => {
    if (currentStep > 0) { setCurrentStep(currentStep - 1); setError(null) }
  }

  const previewCardData: ItemCardData = {
    id: contentCid,
    title: title || t('common.unnamed'),
    desc: description,
    type: contentType,
    img_cid: thumbnailCid,
    cid: contentCid,
    creator_name: creatorInfo?.username || '',
    published_at: new Date().toISOString(),
  }

  if (!creatorInfo) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">{t('workPublish.registerFirst')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
          <div className="flex items-start">
            <CheckCircleIcon className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-green-700 dark:text-green-300 flex-1">{success}</p>
            <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 ml-2">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('workPublish.title')}</h1>
        {creatorInfo.username && (
          <div className="text-sm text-gray-600 dark:text-gray-400">{t('workPublish.creator')} {creatorInfo.username}</div>
        )}
      </div>

      {/* Tab selection */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('publish')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'publish'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t('workPublish.workPublish')}
        </button>
        <button
          onClick={() => setActiveTab('storage')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'storage'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t('workPublish.chainStorage')}
          {unstoredBadgeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-orange-500 rounded-full">
              {unstoredBadgeCount > 99 ? '99+' : unstoredBadgeCount}
            </span>
          )}
        </button>
      </div>

      {/* Work publish tab */}
      {activeTab === 'publish' && (
        <>
          <StepIndicator currentStep={currentStep} />

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            {currentStep === 0 && (
              <StepUpload contentMeta={contentMeta} onMetadata={handleContentMetadata} onNext={goNext} />
            )}
            {currentStep === 1 && (
              <StepInfo
                title={title} setTitle={setTitle}
                description={description} setDescription={setDescription}
                contentType={contentType} contentMeta={contentMeta}
                thumbnailMeta={thumbnailMeta} thumbnailCid={thumbnailCid}
                autoThumbnailUploading={autoThumbnailUploading}
                onThumbnailMetadata={handleThumbnailMetadata}
                extractVideoThumbnail={extractVideoThumbnail}
                onPrev={goPrev} onNext={goNext}
              />
            )}
            {currentStep === 2 && (
              <StepPublish
                previewCardData={previewCardData} published={published}
                isIpnsMode={isIpnsMode}
                isPublishing={isPublishing}
                showPublishWallet={showPublishWallet}
                setShowPublishWallet={setShowPublishWallet}
                onIpnsPublish={handleIpnsPublish}
                onReset={handleReset} onPrev={goPrev}
                filecoinPayEnabled={filecoinPayEnabled}
                storeToChain={storeToChain}
                setStoreToChain={setStoreToChain}
              />
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded flex items-center gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}
          </div>

          <WalletSelectorModal
            isOpen={showPublishWallet}
            onClose={() => setShowPublishWallet(false)}
            paymentConfig={publishPaymentConfig}
            onConfirm={handleClaimWork}
            onGasEstimate={handleClaimGasEstimate}
            highlightAddress={creatorInfo.walletAddress}
            allowedAddresses={creatorInfo.walletAddress ? [creatorInfo.walletAddress] : []}
          />
        </>
      )}

      {/* On-chain storage tab */}
      {activeTab === 'storage' && (
        <ChainStorage
          creatorInfo={creatorInfo}
          unstoredCount={unstoredCount}
          onUnstoredCountChange={setUnstoredCount}
        />
      )}
    </div>
  )
}

const WorkPublish = withCreatorCheck(WorkPublishContent)
export default WorkPublish
