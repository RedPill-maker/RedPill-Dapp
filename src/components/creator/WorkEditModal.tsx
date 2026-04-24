/**
 * Work edit modal
 * Edit title, description, thumbnail (16:9 crop, max width 720px)
 * Uses updateWork for FVM mode to update on-chain metadata
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { IPFS_CONFIG, getKnownTokens } from '../../../config'
import IPFSDropzone from '../IPFSDropzone'
import WalletSelectorModal, { PaymentConfig, TransactionResult } from '../../global_modal/WalletSelectorModal'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import { privateDataMgr } from '../../utils/privateDataMgr'

//ItemCard thumbnail area is aspect-video (16:9)
const THUMBNAIL_ASPECT = 16 / 9
const THUMBNAIL_MAX_WIDTH = 720

interface WorkEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  work: {
    cid: string
    title: string
    description: string | null
    img_cid: string | null
    content_type: number
  }
  ipnsMode?: boolean
  onIpnsSave?: (updatedWork: { cid: string; title: string; description: string; img_cid: string }) => Promise<void>
}

const WorkEditModal: React.FC<WorkEditModalProps> = ({ isOpen, onClose, onSuccess, work, ipnsMode, onIpnsSave }) => {
  const { t } = useTranslation()
  const [title, setTitle] = useState(work.title)
  const [description, setDescription] = useState(work.description || '')
  const [imgCid, setImgCid] = useState(work.img_cid || '')
  const [showWallet, setShowWallet] = useState(false)
  const [ipnsSaving, setIpnsSaving] = useState(false)

  if (!isOpen) return null

  const creatorInfo = privateDataMgr.getCreatorInfo()

  const paymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: getKnownTokens()[0].address,
    tokenSymbol: getKnownTokens()[0].symbol,
    description: t('myHome.editWork.txDesc', { title }),
  }

  const handleConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    try {
      // Use updateWork for lazy update: empty string = no change, max uint256 = no change for workType
      const updatedTitle = title !== work.title ? title : ''
      const updatedDescription = description !== (work.description || '') ? description : ''
      const updatedImgCid = imgCid !== (work.img_cid || '') ? imgCid : ''
      // workType is not editable in this modal, pass max uint256 to skip
      const UINT256_MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

      const result = await creatorHubMgr.updateWork(
        address,
        password,
        work.cid,
        updatedTitle,
        updatedDescription,
        UINT256_MAX,
        updatedImgCid,
      )
      if (result.success) {
        onSuccess()
        return { success: true, txHash: result.txHash }
      }
      return { success: false, error: result.error, rawError: result.rawError }
    } catch (err: any) {
      return { success: false, error: err.message, rawError: err }
    }
  }

  const handleIpnsSubmit = async () => {
    if (!onIpnsSave || !title.trim()) return
    setIpnsSaving(true)
    try {
      await onIpnsSave({
        cid: work.cid,
        title: title.trim(),
        description,
        img_cid: imgCid,
      })
    } finally {
      setIpnsSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-xl w-[560px] max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {t('myHome.editWork.title')}
            </h3>
            <button 
              onClick={onClose} 
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-4 space-y-4">
            {/*Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('workPublish.workTitle')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 64))}
                maxLength={64}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
              <p className="text-xs text-gray-400 mt-0.5 text-right">{title.length}/64</p>
            </div>

            {/*describe */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('workPublish.workDescription')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 256))}
                maxLength={256}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm resize-none"
              />
              <p className="text-xs text-gray-400 mt-0.5 text-right">{description.length}/256</p>
            </div>

            {/*Thumbnail: 16:9 cropped, maximum width 720px */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('workPublish.thumbnailOptional')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <IPFSDropzone
                  allowedTypes={['img']}
                  value={imgCid}
                  onChange={setImgCid}
                  enableCrop
                  cropAspectRatio={THUMBNAIL_ASPECT}
                  cropMaxSize={THUMBNAIL_MAX_WIDTH}
                  className="[&>div]:min-h-[120px]"
                />
                <div className="border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 flex items-center justify-center min-h-[120px] overflow-hidden">
                  {imgCid ? (
                    <img
                      src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${imgCid}`}
                      alt="thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-gray-400">{t('workPublish.thumbnailPreviewLabel')}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={ipnsMode ? handleIpnsSubmit : () => setShowWallet(true)}
              disabled={!title.trim() || ipnsSaving}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ipnsSaving ? t('common.saving') : t('myHome.editWork.submit')}
            </button>
          </div>
        </div>
      </div>

      {!ipnsMode && showWallet && (
        <WalletSelectorModal
          isOpen={showWallet}
          onClose={() => setShowWallet(false)}
          paymentConfig={paymentConfig}
          onConfirm={handleConfirm}
          highlightAddress={creatorInfo?.walletAddress}
          allowedAddresses={creatorInfo?.walletAddress ? [creatorInfo.walletAddress] : []}
        />
      )}
    </>
  )
}

export default WorkEditModal
