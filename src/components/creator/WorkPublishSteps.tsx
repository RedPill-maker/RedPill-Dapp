/**
 *WorkPublish step subcomponent
 * StepIndicator, StepUpload, StepInfo, StepStorage, StepPublish
 */

import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ITEM_TYPE, IPFS_CONFIG } from '../../../config'
import IPFSDropzone, { DropzoneFileMetadata } from '../IPFSDropzone'
import ItemCard, { ItemCardData } from '../work_item/ItemCard'

import {
  CheckIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  RocketLaunchIcon,
  ShieldExclamationIcon,
  ArrowPathIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline'

//==================== Step constants ====================

const STEPS = [
  { key: 'upload', labelKey: 'workPublish.steps.upload', icon: CloudArrowUpIcon },
  { key: 'info', labelKey: 'workPublish.steps.info', icon: DocumentTextIcon },
  { key: 'publish', labelKey: 'workPublish.steps.publish', icon: RocketLaunchIcon },
] as const

// ==================== Step Indicator ====================

export const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => {
  const { t } = useTranslation()
  return (
  <div className="flex items-center justify-between max-w-lg mx-auto px-4">
    {STEPS.map((step, index) => {
      const Icon = step.icon
      const isActive = index === currentStep
      const isCompleted = index < currentStep
      return (
        <React.Fragment key={step.key}>
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isCompleted
                  ? 'bg-green-500 text-white'
                  : isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
              }`}
            >
              {isCompleted ? <CheckIcon className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
            </div>
            <span
              className={`text-xs font-medium ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : isCompleted
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {t(step.labelKey)}
            </span>
          </div>
          {index < STEPS.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 mt-[-20px] ${
                index < currentStep ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
          )}
        </React.Fragment>
      )
    })}
  </div>
  )
}

//==================== Step 1: Upload the work ====================

export const StepUpload: React.FC<{
  contentMeta: DropzoneFileMetadata | null
  onMetadata: (meta: DropzoneFileMetadata | null) => void
  onNext: () => void
}> = ({ contentMeta, onMetadata, onNext }) => {
  const { t } = useTranslation()
  return (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('workPublish.uploadWork')}</h3>

    <IPFSDropzone
      allowedTypes={['img', 'video', 'audio', 'markdown', 'file']}
      onMetadata={onMetadata}
      className="min-h-[240px]"
    />

    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
      <div className="flex items-start gap-2">
        <ShieldExclamationIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-700 dark:text-amber-300">
          <p className="font-medium mb-1">{t('workPublish.uploadNotice')}</p>
          <p>{t('workPublish.uploadNoticeContent')}</p>
          <p className="mt-1">{t('workPublish.uploadSizeNotice')}</p>
        </div>
      </div>
    </div>

    <div className="flex justify-center">
      <button
        onClick={onNext}
        disabled={!contentMeta?.cid}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('common.nextStep')}
      </button>
    </div>
  </div>
  )
}

//==================== Step 2: Complete the information ====================

interface StepInfoProps {
  title: string
  setTitle: (v: string) => void
  description: string
  setDescription: (v: string) => void
  contentType: number
  contentMeta: DropzoneFileMetadata | null
  thumbnailMeta: DropzoneFileMetadata | null
  thumbnailCid: string
  autoThumbnailUploading: boolean
  onThumbnailMetadata: (meta: DropzoneFileMetadata | null) => void
  extractVideoThumbnail: (file: File) => Promise<void>
  onPrev: () => void
  onNext: () => void
}

export const StepInfo: React.FC<StepInfoProps> = ({
  title,
  setTitle,
  description,
  setDescription,
  contentType,
  contentMeta,
  thumbnailCid,
  autoThumbnailUploading,
  onThumbnailMetadata,
  extractVideoThumbnail,
  onPrev,
  onNext,
}) => {
  const { t } = useTranslation()
  const videoExtractedRef = useRef(false)

  //Automatically extract thumbnails from the video (only executed once)
  useEffect(() => {
    if (
      contentMeta?.type === 'video' &&
      contentMeta.fileName &&
      !thumbnailCid &&
      !videoExtractedRef.current
    ) {
      videoExtractedRef.current = true
      const extractFromGateway = async () => {
        try {
          const response = await fetch(
            `${IPFS_CONFIG.GATEWAY_URL}/ipfs/${contentMeta.cid}/${contentMeta.fileName}`,
          )
          if (!response.ok) return
          const blob = await response.blob()
          const file = new File([blob], contentMeta.fileName || 'video.mp4', {
            type: contentMeta.mimeType || 'video/mp4',
          })
          await extractVideoThumbnail(file)
        } catch (err) {
          console.warn(t('workPublish.videoThumbnailFailed'), err)
        }
      }
      extractFromGateway()
    }
  }, [contentMeta, thumbnailCid, extractVideoThumbnail])

  const getFileTypeName = (type: number): string => ITEM_TYPE[type]?.label || t('workPublish.unknownType')

  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('workPublish.workInfo')}</h3>

      {/*Content type hint */}
      {contentMeta && (
        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <CheckIcon className="w-4 h-4 text-green-500" />
          {t('workPublish.uploaded')} {contentMeta.fileName} · {t('workPublish.type')} {getFileTypeName(contentType)}
        </div>
      )}

      {/* title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('workPublish.workTitle')}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 64))}
          maxLength={64}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
          placeholder={t('workPublish.workTitle')}
        />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">{title.length}/64</p>
      </div>

      {/* describe */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('workPublish.workDescription')}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 128))}
          maxLength={128}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
          placeholder={t('workPublish.workDescription')}
        />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">{description.length}/128</p>
      </div>

      {/*Thumbnails: left and right columns */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('workPublish.thumbnailOptional')}
          {autoThumbnailUploading && (
            <span className="ml-2 text-xs text-blue-500">{t('workPublish.extractingCover')}</span>
          )}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Upload area */}
          <IPFSDropzone
            allowedTypes={['img']}
            value={thumbnailCid}
            onMetadata={onThumbnailMetadata}
            className="min-h-[200px]"
          />
          {/*Right: preview area */}
          <div className="min-h-[200px] border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 flex items-center justify-center overflow-hidden">
            {thumbnailCid ? (
              <img
                src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${thumbnailCid}`}
                alt={t('workPublish.thumbnailPreviewAlt')}
                className="max-h-[200px] w-auto object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  if (e.currentTarget.parentElement) {
                    e.currentTarget.parentElement.innerHTML =
                      `<span class="text-sm text-gray-500 dark:text-gray-400">${t('workPublish.imageLoadFailed')}</span>`
                  }
                }}
              />
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500">{t('workPublish.thumbnailPreviewLabel')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-center gap-4 pt-2">
        <button
          onClick={onPrev}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('common.prevStep')}
        </button>
        <button
          onClick={onNext}
          disabled={!title.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.nextStep')}
        </button>
      </div>
    </div>
  )
}

//==================== Step 3: Complete publishing ====================

interface StepPublishProps {
  previewCardData: ItemCardData
  published: boolean
  isIpnsMode: boolean
  isPublishing: boolean
  showPublishWallet: boolean
  setShowPublishWallet: (v: boolean) => void
  onIpnsPublish?: () => void
  onReset: () => void
  onPrev: () => void
  // On-chain storage related / オンチェーンストレージ関連
  filecoinPayEnabled?: boolean
  storeToChain: boolean
  setStoreToChain: (v: boolean) => void
}

export const StepPublish: React.FC<StepPublishProps> = ({
  previewCardData,
  published,
  isIpnsMode,
  isPublishing,
  showPublishWallet,
  setShowPublishWallet,
  onIpnsPublish,
  onReset,
  onPrev,
  filecoinPayEnabled,
  storeToChain,
  setStoreToChain,
}) => {
  const { t } = useTranslation()
  return (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
      {published ? t('workPublish.publishSuccess') : t('workPublish.confirmPublish')}
    </h3>

    {!published && (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {isIpnsMode ? t('workPublish.confirmPublishDescIpns') : t('workPublish.confirmPublishDesc')}
      </p>
    )}

{/*Work preview */}
    <div className="flex justify-center">
      <div className="w-full max-w-sm">
        <ItemCard item={previewCardData} mode="preview" />
      </div>
    </div>

    {published && (
      <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
        <CheckIcon className="w-5 h-5" />
        <span className="text-sm font-medium">
          {isIpnsMode ? t('workPublish.ipnsPublishedCached') : t('workPublish.publishedToChain')}
        </span>
      </div>
    )}

    {/*On-chain storage options (only displayed in on-chain mode and FilecoinPay is enabled) */}
    {!published && !isIpnsMode && filecoinPayEnabled && (
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={storeToChain}
            onChange={(e) => setStoreToChain(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="flex items-center gap-2">
              <ServerStackIcon className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {t('workPublish.storeToChainOption')}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('workPublish.storeToChainDesc')}
            </p>
          </div>
        </label>
      </div>
    )}

    {/* Navigator */}
    <div className="flex justify-center gap-4 pt-2">
      {!published ? (
        <>
          <button
            onClick={onPrev}
            disabled={isPublishing}
            className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.prevStep')}
          </button>
          <button
            onClick={isIpnsMode ? onIpnsPublish : () => setShowPublishWallet(true)}
            disabled={isPublishing}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPublishing && <ArrowPathIcon className="animate-spin w-4 h-4" />}
            {t('workPublish.publish')}
          </button>
        </>
      ) : (
        <button
          onClick={onReset}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          {t('workPublish.publishNewWork')}
        </button>
      )}
    </div>
  </div>
  )
}
